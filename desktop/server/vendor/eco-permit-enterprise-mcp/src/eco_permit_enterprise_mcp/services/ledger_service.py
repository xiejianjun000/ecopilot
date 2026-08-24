"""台账记录服务（模块 12）。

通过 Playwright 驱动台账系统（permitrep/account），拦截 bookAccount/v1/list
响应读取台账记录列表，遍历子表单 tab 统计各表单数据量。
"""

from __future__ import annotations

import logging
import threading
from typing import Optional

from ..browser.playwright_driver import PlaywrightDriver
from ..errors import ApiResponse, ErrorCode
from .base_service import BaseService

logger = logging.getLogger("eco_permit_enterprise_mcp.services.ledger")


class LedgerService(BaseService):
    """台账记录服务。"""

    def __init__(self, config, auth, http, driver: Optional[PlaywrightDriver] = None):
        super().__init__(config, auth, http)
        self._driver = driver or PlaywrightDriver(config)
        self._driver_lock = threading.Lock()

    def ledger_list(
        self,
        page_no: int = 1,
        entry_type: str = "1",
        start_year: int = 2020,
        end_year: int = 2026,
    ) -> ApiResponse:
        """穿透读取台账记录列表（模块 12）。

        导航台账系统，拦截 bookAccount/v1/list 响应，
        返回台账记录列表 + 5 个子表单数据量。

        入参：
        - page_no: 页码（默认 1）
        - entry_type: 台账类型（1=台账记录，2=一般工业固废电子台账）
        - start_year: 起始年度
        - end_year: 截止年度
        """
        try:
            cookies = self.auth.export_cookies()
            with self._driver_lock:
                self._driver.start(cookies)
                if not self._driver.get_profile():
                    self._driver.auto_login()
                result = self._driver.ledger_list(start_year, end_year)
            data = {
                "total": result.get("total", 0),
                "records": result.get("records", []),
                "has_uploaded": result.get("has_uploaded", False),
                "sub_tabs": result.get("sub_tabs", {}),
                "entry_type": entry_type,
                "start_year": start_year,
                "end_year": end_year,
                "profile": self._driver.get_profile().to_dict()
                if self._driver.get_profile() else None,
            }
            total = result.get("total", 0)
            return self.ok(data, f"成功，共 {total} 份台账" if total > 0 else "成功，暂无台账记录")
        except Exception as exc:  # noqa: BLE001
            logger.exception("台账列表查询失败: %s", exc)
            return self.fail(ErrorCode.UPSTREAM_ERROR, f"台账查询失败: {exc}")

    def ledger_upload(self, entry_type: str = "1", data: dict | None = None) -> ApiResponse:
        """上传电子台账（模块 12，写功能）。

        参数：
            entry_type: 台账类型（1=台账记录，2=一般工业固废电子台账）
            data: 上传数据，可含 file_name / file_base64 / year

        出参：上传结果（{ok, error}）。
        """
        data = data or {}
        try:
            cookies = self.auth.export_cookies()
            with self._driver_lock:
                self._driver.start(cookies)
                if not self._driver.get_profile():
                    self._driver.auto_login()
                result = self._driver.ledger_upload(entry_type, data)
            if result.get("ok"):
                return self.ok(result, result.get("message") or "台账上传成功")
            return self.fail(ErrorCode.UPSTREAM_ERROR, result.get("error") or "台账上传失败")
        except Exception as exc:  # noqa: BLE001
            logger.exception("台账上传失败: %s", exc)
            return self.fail(ErrorCode.UPSTREAM_ERROR, f"台账上传失败: {exc}")

    def close(self) -> None:
        """关闭浏览器驱动。"""
        try:
            self._driver.close()
        except Exception:  # noqa: BLE001
            pass


__all__ = ["LedgerService"]
