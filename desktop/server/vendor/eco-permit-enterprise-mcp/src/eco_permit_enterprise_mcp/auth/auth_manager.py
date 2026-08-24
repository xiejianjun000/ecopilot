"""认证管理器：CAS 登录 + 内存态会话 + 失效自动重登。

认证链路（架构设计 §4.1）：
1. GET 登录页 → 提取 ``lt`` / ``execution``。
2. GET ``/cas/kaptcha.jpg`` → 下载验证码图片。
3. :class:`CaptchaRecognizer` 识别验证码。
4. POST ``/cas/login`` 提交表单（username/password/captcha/lt/execution/_eventId=submit）。
5. 302 建立会话 → 生成 :class:`LoginState`（含 expires_at）。

验证码识别失败自动重试（≤ ``login_retry``），仍失败抛
:class:`HumanAssistRequired`。任一工具调用前经 ``ensure_session()`` 检查，
过期自动重登。
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime
from typing import Optional

from ..config import Config
from ..constants import Endpoints
from ..errors import HumanAssistRequired, PermitError, SessionExpired
from ..http.http_client import HttpClient
from ..http.parser import HtmlParser
from ..models import EnterpriseProfile, LoginState, default_expiry
from .captcha import CaptchaRecognizer
from .crypto import rsa_encrypt

logger = logging.getLogger("eco_permit_enterprise_mcp.auth")

# 登录失败特征：跳转后仍停留在 CAS 登录页
_CAS_PATHS = ("/cas/login", "/cas/")
_SESSION_COOKIE_NAMES = {"JSESSIONID", "SESSION", "CASTGC"}


class AuthManager:
    """CAS 认证与会话管理（进程内单例）。"""

    def __init__(
        self,
        config: Config,
        http: Optional[HttpClient] = None,
        captcha: Optional[CaptchaRecognizer] = None,
    ):
        self.config = config
        self.http = http or HttpClient(config)
        self.captcha = captcha or CaptchaRecognizer()
        self.parser = HtmlParser()
        self._state: Optional[LoginState] = None
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # 对外接口
    # ------------------------------------------------------------------
    def login(self, username: Optional[str] = None, password: Optional[str] = None) -> LoginState:
        """执行 CAS 登录，返回登录态。已登录且未过期则直接复用。"""
        username = username or self.config.username
        password = password or self.config.password
        if not username or not password:
            raise PermitError("缺少登录账号或密码", 400)

        with self._lock:
            if self._state and self._state.is_valid():
                logger.info("已存在有效会话，复用登录态")
                return self._state

            last_error: Optional[Exception] = None
            for attempt in range(1, self.config.login_retry + 1):
                try:
                    state = self._do_login(username, password)
                    self._state = state
                    logger.info(
                        "登录成功: 账号=%s, session=%s",
                        username,
                        self._mask(state.session_id),
                    )
                    return state
                except HumanAssistRequired:
                    raise
                except Exception as exc:  # noqa: BLE001 - 捕获后重试
                    last_error = exc
                    logger.warning("登录第 %d 次尝试失败: %s", attempt, exc)
            raise HumanAssistRequired(
                f"登录失败（已重试 {self.config.login_retry} 次）：{last_error}"
            )

    def logout(self) -> None:
        """登出并销毁内存态会话。"""
        with self._lock:
            self._state = None
            # 尽力销毁服务端会话 Cookie
            try:
                self.http.close()
            except Exception:  # noqa: BLE001
                pass
            logger.info("已登出并销毁会话")

    def status(self) -> dict:
        """返回会话状态摘要（不泄露敏感信息）。"""
        state = self._state
        if state is None:
            return {"valid": False, "remaining_seconds": 0, "enterprise": None}
        return {
            "valid": state.is_valid(),
            "remaining_seconds": state.remaining_seconds(),
            "enterprise": state.profile.to_dict() if state.profile else None,
        }

    def ensure_session(self) -> LoginState:
        """确保存在有效会话；过期则自动重登。"""
        state = self._state
        if state and state.is_valid():
            return state
        logger.info("会话缺失或过期，触发自动重登")
        try:
            return self.login()
        except HumanAssistRequired as exc:
            raise SessionExpired(f"会话失效且自动重登失败：{exc.msg}") from exc

    def export_cookies(self) -> list:
        """导出会话 Cookie（供 Playwright 注入）。"""
        self.ensure_session()
        return self.http.export_cookies()

    # ------------------------------------------------------------------
    # 内部实现
    # ------------------------------------------------------------------
    def _do_login(self, username: str, password: str) -> LoginState:
        login_page = self._fetch_login_page()
        parsed = self.parser.parse_login_page(login_page)
        lt = parsed.get("lt", "")
        execution = parsed.get("execution", "")
        modulus = parsed.get("modulus", "")
        exponent = parsed.get("exponent", "")
        salt = parsed.get("salt", "")
        if not lt or not execution:
            raise HumanAssistRequired("登录页未提取到 lt/execution，登录页结构可能变更")
        if not modulus or not exponent:
            raise HumanAssistRequired("登录页未提取到 RSA 公钥(hid_modulus/hid_exponent)，结构可能变更")
        if not salt:
            raise HumanAssistRequired("登录页未提取到加密盐，结构可能变更")

        # 下载验证码并识别（识别无效视为普通失败，允许重试）
        img_bytes = self.http.get(self.config.kaptcha_url).content
        captcha_text = self.captcha.recognize(img_bytes)
        if not captcha_text or len(captcha_text.strip()) < 4:
            raise PermitError("验证码识别结果无效（空或长度不足）")

        state = self._submit_form(
            username, password, captcha_text, lt, execution, modulus, exponent, salt
        )
        return state

    def _fetch_login_page(self) -> str:
        resp = self.http.get(self.config.cas_login_url)
        return resp.text

    def _submit_form(
        self,
        username: str,
        password: str,
        captcha: str,
        lt: str,
        execution: str,
        modulus: str,
        exponent: str,
        salt: str,
    ) -> LoginState:
        # RSA 加密凭证（复现登录页 JS：明文 + 动态盐）
        enc_username = rsa_encrypt(username, modulus, exponent, salt)
        enc_password = rsa_encrypt(password, modulus, exponent, salt)
        data = {
            "username": enc_username,
            "password": enc_password,
            "captcha": captcha,
            "lt": lt,
            "execution": execution,
            "_eventId": "submit",
        }
        resp = self.http.post(self.config.cas_login_url, data=data)

        if self._is_login_failed(resp):
            raise PermitError("用户名/密码/验证码错误，登录失败")

        cookies = self.http.export_cookies()
        if not self._has_session_cookie(cookies):
            raise PermitError("登录后未建立会话 Cookie")

        profile = EnterpriseProfile(
            enterid=self.config.enterid,
            permit_code=self.config.permit_code,
            user_account=username,
        )
        return LoginState(
            session_id=self._extract_session_id(cookies),
            cookies=cookies,
            lt=lt,
            execution=execution,
            profile=profile,
            login_at=datetime.now(),
            expires_at=default_expiry(self.config.session_ttl),
        )

    # ------------------------------------------------------------------
    # 辅助
    # ------------------------------------------------------------------
    def _is_login_failed(self, resp) -> bool:
        """登录失败判定：最终 URL 仍停留在 CAS 登录页。"""
        return any(p in resp.url for p in _CAS_PATHS)

    @staticmethod
    def _has_session_cookie(cookies: list) -> bool:
        return any(c.get("name", "").upper() in _SESSION_COOKIE_NAMES for c in cookies)

    @staticmethod
    def _extract_session_id(cookies: list) -> str:
        for c in cookies:
            if c.get("name", "").upper() in _SESSION_COOKIE_NAMES:
                return c.get("value", "")
        return ""

    @staticmethod
    def _mask(value: str) -> str:
        if not value:
            return "<empty>"
        return value[:4] + "***"


__all__ = ["AuthManager"]
