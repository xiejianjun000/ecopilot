"""MCP 服务器组装：FastMCP + 41 工具注册 + lifespan。

- ``PermitMcpServer.build`` 完成 Config / AuthManager / 各 Service 单例初始化，
  注册到 AppContext，并向 FastMCP 注册全部 41 个工具。
- ``run`` 以 stdio 传输启动。
"""

from __future__ import annotations

import logging
from typing import Optional

from mcp.server.fastmcp import FastMCP

from .auth.auth_manager import AuthManager
from .config import Config
from .context import AppContext
from .http.http_client import HttpClient
from .services.company_service import CompanyService
from .services.ledger_service import LedgerService
from .services.license_service import LicenseService
from .services.monitor_service import MonitorService
from .services.report_service import ReportService
from .services.restricted_service import RestrictedService
from .tools import register_all

logger = logging.getLogger("eco_permit_enterprise_mcp.server")

SERVER_NAME = "eco-permit-enterprise-mcp"
SERVER_VERSION = "0.1.0"


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    # 降低第三方库噪音
    for noisy in ("ddddocr", "playwright", "urllib3", "requests"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


class PermitMcpServer:
    """MCP 服务器门面。"""

    def __init__(self, config: Optional[Config] = None):
        self.config = config or Config.load()
        self.mcp = FastMCP(SERVER_NAME)
        self._built = False
        self._report_service: Optional[ReportService] = None

    # ------------------------------------------------------------------
    # 组装
    # ------------------------------------------------------------------
    def build(self) -> "PermitMcpServer":
        """初始化上下文 + 各服务 + 注册全部工具。幂等。"""
        if self._built:
            return self
        _configure_logging(self.config.log_level)
        AppContext.init(self.config)

        auth = AuthManager(self.config)
        http = auth.http  # 复用认证层同一 Session（共享 Cookie）

        company = CompanyService(self.config, auth, http)
        # 报告/台账/许可证详情共用同一个 PlaywrightDriver 实例
        from .browser.playwright_driver import PlaywrightDriver

        pw_driver = PlaywrightDriver(self.config)
        license_svc = LicenseService(self.config, auth, http, driver=pw_driver)
        report = ReportService(self.config, auth, http, driver=pw_driver)
        monitor = MonitorService(self.config, auth, http)
        ledger = LedgerService(self.config, auth, http, driver=pw_driver)
        restricted = RestrictedService(self.config, auth, http)

        AppContext.register_service("company", company)
        AppContext.register_service("license", license_svc)
        AppContext.register_service("report", report)
        AppContext.register_service("monitor", monitor)
        AppContext.register_service("ledger", ledger)
        AppContext.register_service("restricted", restricted)

        self._report_service = report
        register_all(self.mcp)
        self._built = True
        logger.info("MCP 服务器组装完成，注册 %d 个工具",
                    self._registered_tool_count())
        return self

    def _registered_tool_count(self) -> int:
        from .tools import tool_count

        return tool_count()

    # ------------------------------------------------------------------
    # 运行
    # ------------------------------------------------------------------
    def run(self) -> None:
        """启动 MCP 服务器（stdio 传输，阻塞）。"""
        self.build()
        self.mcp.run(transport="stdio")

    def close(self) -> None:
        """释放资源（浏览器等）。"""
        if self._report_service is not None:
            self._report_service.close()


__all__ = ["PermitMcpServer", "SERVER_NAME"]
