"""受限模块服务（模块 1/15/16/18）。

自动监控 / 环评申报 / 碳排放报送 / 改正规定 四个模块本期预留，统一返回
``code=501`` 语义化说明，不触发任何网络请求、不崩溃（架构 §7.1）。
"""

from __future__ import annotations

import logging
from typing import Optional

from ..errors import ApiResponse, ErrorCode
from .base_service import BaseService

logger = logging.getLogger("eco_permit_enterprise_mcp.services.restricted")


class RestrictedService(BaseService):
    """受限模块服务（返回 501）。"""

    def auto_monitor(self, enterid: Optional[str] = None) -> ApiResponse:
        """自动监控（模块 16，受限）。"""
        return self.fail(
            ErrorCode.RESTRICTED,
            "自动监控模块受限：需滑块拼图验证 + 环保部门维护的独立账号，本期预留",
        )

    def eia_apply(self, enterid: Optional[str] = None) -> ApiResponse:
        """环评申报（模块 1，受限）。"""
        return self.fail(
            ErrorCode.RESTRICTED,
            "环评申报模块受限：存在 JS challenge 反爬（HTTP 412），本期预留",
        )

    def carbon_report(self, token: Optional[str] = None) -> ApiResponse:
        """碳排放报送（模块 18，受限）。"""
        return self.fail(
            ErrorCode.RESTRICTED,
            "碳排放报送模块受限：内部测试系统 + headless 浏览器被拦截，本期预留",
        )

    def correction_status(self) -> ApiResponse:
        """改正规定（模块 15，未启用）。"""
        return self.fail(
            ErrorCode.RESTRICTED,
            "改正规定模块暂未启用（系统返回「改正规定模块暂未启用」）",
        )


__all__ = ["RestrictedService"]
