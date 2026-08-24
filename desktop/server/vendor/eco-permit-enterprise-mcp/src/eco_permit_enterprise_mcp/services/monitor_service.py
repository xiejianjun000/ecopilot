"""监测记录服务（模块 14，独立 REST 子系统）。

入口：主平台菜单「监测记录」实际调用 ``openurl('../jcjl/jcjl!jcjl.action','jcjl',enterid)``。
真实 SSO 为两步：

1. ``GET {internal_base}/jcjl/jcjl!jcjl.action?enterid=xxx`` —— 主平台返回一个自动提交
   表单，隐藏字段 ``tokenId`` / ``bh`` / ``lb`` / ``act``（``tokenId`` 一次性）。
2. ``POST https://wryjc.cnemc.cn/eap/SingleSignOnXKZ`` 携带上述字段 —— 监测子系统
   校验票据后下发 ``sid`` Cookie，建立会话。

业务接口为 RESTful GET，鉴权依赖 ``sid`` Cookie（落地页 ``var csrfToken = ""`` 为空
字符串，非必需）。若 SSO 失败，返回 code=502 语义化说明，不崩溃阻塞主流程。
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Optional
from urllib.parse import urlencode

from ..constants import (
    Endpoints,
    MONITOR_API_BASE,
    MONITOR_CURRENT_USER,
    MONITOR_ENTERPRISE_INFO,
    MONITOR_MANUAL_RECORDS,
    MONITOR_MONTH_DATA,
    MONITOR_MONTH_STATUS,
    MONITOR_ONLINE_RECORDS,
    MONITOR_SSO_URL,
)
from ..errors import ApiResponse, ErrorCode
from .base_service import BaseService

logger = logging.getLogger("eco_permit_enterprise_mcp.services.monitor")

_HIDDEN_INPUT_RE = re.compile(
    r'name=["\']([^"\']+)["\']\s+value=["\']([^"\']*)["\']'
)


class MonitorService(BaseService):
    """监测记录服务。"""

    def __init__(self, config, auth, http):
        super().__init__(config, auth, http)
        self._session_ready = False

    # ------------------------------------------------------------------
    # 业务接口
    # ------------------------------------------------------------------
    def monitor_info(
        self,
        qybh: Optional[str] = None,
        sheng: Optional[str] = None,
        shi: Optional[str] = None,
        xian: Optional[str] = None,
    ) -> ApiResponse:
        """企业监测信息（模块 14）。"""
        self.require_login()
        if not self._ensure_session():
            return self.fail(ErrorCode.UPSTREAM_ERROR, self._sso_fail_msg())

        params = {
            "qybh": qybh or self.config.qybh,
            "sheng": sheng or self.config.sheng,
            "shi": shi or self.config.shi,
            "xian": xian or self.config.xian,
        }
        try:
            data = self._get_json(MONITOR_ENTERPRISE_INFO, params)
            return self.ok(data, "成功")
        except Exception as exc:  # noqa: BLE001
            logger.warning("企业监测信息查询失败: %s", exc)
            return self.fail(ErrorCode.UPSTREAM_ERROR, f"监测信息查询失败: {exc}")

    def monitor_month_status(
        self,
        uuid: str = "",
        sheng: Optional[str] = None,
        shi: Optional[str] = None,
        xian: Optional[str] = None,
        qybh: Optional[str] = None,
        yue: str = "",
    ) -> ApiResponse:
        """企业月度监测数据/完成率（模块 14）。"""
        self.require_login()
        if not self._ensure_session():
            return self.fail(ErrorCode.UPSTREAM_ERROR, self._sso_fail_msg())

        yue = yue or datetime.now().strftime("%Y-%m-01")
        params = {
            "uuid": uuid,
            "sheng": sheng or self.config.sheng,
            "shi": shi or self.config.shi,
            "xian": xian or self.config.xian,
            "qybh": qybh or self.config.qybh,
            "yue": yue,
        }
        try:
            data = self._get_json(MONITOR_MONTH_STATUS, params)
            return self.ok(data, "成功")
        except Exception as exc:  # noqa: BLE001
            logger.warning("月度监测数据查询失败: %s", exc)
            return self.fail(ErrorCode.UPSTREAM_ERROR, f"月度监测数据查询失败: {exc}")

    def monitor_detail(
        self,
        qybh: Optional[str] = None,
        sheng: Optional[str] = None,
        shi: Optional[str] = None,
        xian: Optional[str] = None,
        yue: str = "",
    ) -> ApiResponse:
        """监测记录明细（模块 14，穿透式读取监测数据条目）。

        合并读取监测子系统的企业信息、手工监测结果明细、在线监测数据、
        月度数据情况，返回完整监测记录明细。

        参数：
            qybh: 企业编号（缺省取 .env 配置值，或从 currentUser 派生）
            sheng/shi/xian: 省/市/县编码（缺省取 .env 配置值）
            yue: 月份（如 2026-08，缺省取当月）

        出参：``{enterprise, manual_records, online_records, month_data}``。
        """
        self.require_login()
        if not self._ensure_session():
            return self.fail(ErrorCode.UPSTREAM_ERROR, self._sso_fail_msg())

        yue = yue or datetime.now().strftime("%Y-%m")
        qybh = qybh or self.config.qybh
        sheng = sheng or self.config.sheng

        result: dict = {"enterprise": None, "manual_records": None, "online_records": None, "month_data": None}
        try:
            # 1. 当前用户（含企业名称 / 监测账号）
            try:
                result["enterprise"] = self._get_json(MONITOR_CURRENT_USER, {})
            except Exception as exc:  # noqa: BLE001
                logger.debug("currentUser 读取失败: %s", exc)

            # 2. 手工监测结果明细
            try:
                result["manual_records"] = self._get_json(
                    MONITOR_MANUAL_RECORDS, {"qybh": qybh, "sheng": sheng}
                )
            except Exception as exc:  # noqa: BLE001
                logger.debug("手工监测结果明细读取失败: %s", exc)

            # 3. 在线监测数据明细
            try:
                result["online_records"] = self._get_json(
                    MONITOR_ONLINE_RECORDS, {"qybh": qybh, "sheng": sheng}
                )
            except Exception as exc:  # noqa: BLE001
                logger.debug("在线监测数据明细读取失败: %s", exc)

            # 4. 月度数据情况
            try:
                result["month_data"] = self._get_json(
                    MONITOR_MONTH_DATA, {"qybh": qybh, "sheng": sheng, "yue": yue}
                )
            except Exception as exc:  # noqa: BLE001
                logger.debug("月度数据情况读取失败: %s", exc)

            populated = sum(1 for v in result.values() if v is not None)
            return self.ok(result, f"成功，{populated}/4 类明细有数据")
        except Exception as exc:  # noqa: BLE001
            logger.warning("监测记录明细读取失败: %s", exc)
            return self.fail(ErrorCode.UPSTREAM_ERROR, f"监测记录明细读取失败: {exc}")

    # ------------------------------------------------------------------
    # SSO / 会话
    # ------------------------------------------------------------------
    def _ensure_session(self) -> bool:
        if self._session_ready:
            return True
        self._session_ready = self._establish_session()
        return self._session_ready

    def _establish_session(self) -> bool:
        """两步 SSO 建立监测子系统会话（下发 ``sid`` Cookie）。

        1. 主平台 ``jcjl!jcjl.action`` 返回一次性 ``tokenId`` 表单。
        2. 用 ``tokenId``/``bh``/``lb``/``act`` POST ``SingleSignOnXKZ``。
        """
        try:
            # 1. 主平台生成监测子系统 SSO 票据
            url = self.config.internal_url(Endpoints.JCJL)
            resp = self.http.get(url, params={"enterid": self.config.enterid})
            fields = self._parse_hidden(resp.text)
            token_id = fields.get("tokenId")
            if not token_id:
                logger.warning("jcjl!jcjl.action 未返回 tokenId（未登录或无许可证）")
                return False

            # 2. 一次性票据提交到监测子系统（禁重试 + 长超时，tokenId 不可复用）
            data = {
                "tokenId": token_id,
                "bh": fields.get("bh", ""),
                "lb": fields.get("lb", "1"),
                "act": fields.get("act", "login"),
            }
            resp2 = self.http.post(
                MONITOR_SSO_URL, data=data, retries=0, timeout=60.0
            )
            text = resp2.text
            if "error.png" in text or "tokenid验证失败" in text or "csrfToken" not in text:
                logger.warning("监测子系统 SSO 被拒: %s", self._first_error(text))
                return False

            logger.info("监测子系统会话建立成功（sid Cookie）")
            return True
        except Exception as exc:  # noqa: BLE001
            logger.warning("监测子系统 SSO 失败: %s", exc)
            return False

    @staticmethod
    def _parse_hidden(html: str) -> dict:
        return {m.group(1): m.group(2) for m in _HIDDEN_INPUT_RE.finditer(html)}

    @staticmethod
    def _first_error(html: str) -> str:
        m = re.search(r"(?:Error|错误)[^<]{0,80}", html)
        return m.group(0).strip() if m else "未知错误"

    def _get_json(self, path: str, params: dict):
        url = f"{MONITOR_API_BASE.rstrip('/')}/{path.lstrip('/')}?{urlencode(params)}"
        return self.http.get_json(url)

    @staticmethod
    def _sso_fail_msg() -> str:
        return (
            "监测记录子系统 SSO 跳转失败，该模块依赖独立子系统会话，"
            "请确认已登录且存在有效许可证后重试"
        )


__all__ = ["MonitorService"]
