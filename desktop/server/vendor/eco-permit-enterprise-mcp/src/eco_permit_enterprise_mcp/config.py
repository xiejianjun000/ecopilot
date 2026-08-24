"""配置加载：环境变量 + 本地配置覆盖，预留多租户 ``accounts``。

加载顺序（后者覆盖前者）：
1. 代码默认值
2. ``.env`` 文件（python-dotenv）
3. 进程环境变量
4. 本地配置文件（JSON，可选，``PERMIT_CONFIG_FILE`` 指定）

必填项缺失时抛出 :class:`ConfigError`，给出清晰提示。
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

from dotenv import load_dotenv

from .constants import DEFAULT_BASE_URL, LICENSE_REDIRECT_PATH
from .errors import ConfigError

# 必填环境变量 → 中文说明（仅账号/密码，登录必需）
_REQUIRED_FIELDS = {
    "PERMIT_USERNAME": "登录账号",
    "PERMIT_PASSWORD": "登录密码",
}

# 可选企业标识（登录后由平台数据动态填充，缺失不阻止启动）：
#   PERMIT_PERMIT_CODE  排污许可证编号
#   PERMIT_ENTERID      企业 ID
#   PERMIT_CITY_CODE    城市编码
#   PERMIT_USER_CODE    登录账号别名（通常=用户名）
#   PERMIT_QYBH         监测记录企业编号
#   PERMIT_SHENG        监测记录省份编码
#   PERMIT_SHI          监测记录市编码
#   PERMIT_XIAN         监测记录县编码


def _as_bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _as_int(value: Any, default: int) -> int:
    if value in (None, ""):
        return default
    return int(value)


@dataclass
class Config:
    """全局配置对象（单企业，预留多租户）。"""

    base_url: str = DEFAULT_BASE_URL
    username: str = ""
    password: str = ""
    permit_code: str = ""
    enterid: str = ""
    city_code: str = ""
    user_code: str = ""
    qybh: str = ""
    sheng: str = ""
    shi: str = ""
    xian: str = ""

    cas_login_url: str = ""
    kaptcha_url: str = ""

    session_ttl: int = 3600
    login_retry: int = 5
    http_timeout: int = 10
    playwright_headless: bool = True
    log_level: str = "INFO"
    config_file: str = ""

    accounts: dict = field(default_factory=dict)  # 多租户预留，MVP 不启用

    # ------------------------------------------------------------------
    # 构造
    # ------------------------------------------------------------------
    @classmethod
    def load(cls) -> "Config":
        """从环境变量 / 本地配置加载，校验必填项。"""
        load_dotenv()  # 读取项目根 .env（若存在）

        env = os.environ
        base_url = (env.get("PERMIT_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")

        # 本地配置文件覆盖（多租户预留）
        config_file = env.get("PERMIT_CONFIG_FILE") or ""
        file_overrides: dict = {}
        if config_file:
            file_overrides = cls._load_config_file(config_file)

        def pick(key: str, default: str = "") -> str:
            return str(file_overrides.get(key, env.get(key, default)) or default)

        cas_login_url = pick("PERMIT_CAS_LOGIN_URL") or (
            f"{base_url}/cas/login?service="
            f"{quote(base_url + LICENSE_REDIRECT_PATH, safe='')}"
        )
        kaptcha_url = pick("PERMIT_KAPTCHA_URL") or f"{base_url}/cas/kaptcha.jpg"

        cfg = cls(
            base_url=base_url,
            username=pick("PERMIT_USERNAME"),
            password=pick("PERMIT_PASSWORD"),
            permit_code=pick("PERMIT_PERMIT_CODE"),
            enterid=pick("PERMIT_ENTERID"),
            city_code=pick("PERMIT_CITY_CODE"),
            user_code=pick("PERMIT_USER_CODE"),
            qybh=pick("PERMIT_QYBH"),
            sheng=pick("PERMIT_SHENG"),
            shi=pick("PERMIT_SHI"),
            xian=pick("PERMIT_XIAN"),
            cas_login_url=cas_login_url,
            kaptcha_url=kaptcha_url,
            session_ttl=_as_int(pick("PERMIT_SESSION_TTL"), 3600),
            login_retry=_as_int(pick("PERMIT_LOGIN_RETRY"), 5),
            http_timeout=_as_int(pick("PERMIT_HTTP_TIMEOUT"), 10),
            playwright_headless=_as_bool(pick("PERMIT_PLAYWRIGHT_HEADLESS"), True),
            log_level=pick("PERMIT_LOG_LEVEL") or "INFO",
            config_file=config_file,
            accounts=file_overrides.get("accounts", {}) or {},
        )
        cfg.validate()
        return cfg

    @staticmethod
    def _load_config_file(path: str) -> dict:
        p = Path(path)
        if not p.exists():
            raise ConfigError(f"本地配置文件不存在: {path}")
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:  # pragma: no cover
            raise ConfigError(f"本地配置文件解析失败: {exc}") from exc

    # ------------------------------------------------------------------
    # 校验 / 访问
    # ------------------------------------------------------------------
    def validate(self) -> None:
        missing = [f"{k}({desc})" for k, desc in _REQUIRED_FIELDS.items()
                   if not getattr(self, _env_to_attr(k))]
        if missing:
            raise ConfigError(
                "缺少必填配置项: " + ", ".join(missing) + "。请检查 .env 或环境变量。"
            )

    def get(self, key: str, default: Any = None) -> Any:
        """通用取值接口（兼容设计类图 ``get(key, default)``）。"""
        return getattr(self, key, default)

    # ------------------------------------------------------------------
    # 派生属性
    # ------------------------------------------------------------------
    @property
    def internal_base(self) -> str:
        """内部 Struts2 模块前缀（/permitExt）。"""
        return f"{self.base_url}/permitExt"

    @property
    def license_redirect(self) -> str:
        return f"{self.base_url}{LICENSE_REDIRECT_PATH}"

    def url(self, path: str) -> str:
        """拼接绝对 URL（path 以 / 开头时基于 base_url）。"""
        if path.startswith("http"):
            return path
        return f"{self.base_url}{path}"

    def internal_url(self, endpoint: str) -> str:
        """拼接内部 action 绝对 URL。"""
        if endpoint.startswith("http"):
            return endpoint
        return f"{self.internal_base}{endpoint}"


def _env_to_attr(env_key: str) -> str:
    """PERMIT_USERNAME -> username。"""
    return env_key.removeprefix("PERMIT_").lower()


__all__ = ["Config"]
