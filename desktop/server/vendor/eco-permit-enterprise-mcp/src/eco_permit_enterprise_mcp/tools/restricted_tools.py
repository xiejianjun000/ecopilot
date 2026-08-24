"""受限/预留工具（4 个）：模块 1/15/16/18，统一返回 code=501。"""

from __future__ import annotations

from typing import Optional

from ._helpers import call, service


async def auto_monitor(enterid: Optional[str] = None) -> dict:
    """自动监控（模块 16，预留/受限）。入参：enterid。出参：受限说明（code=501）。"""
    return await call(service("restricted").auto_monitor, enterid)


async def eia_apply(enterid: Optional[str] = None) -> dict:
    """环评申报（模块 1，预留/受限）。入参：enterid。出参：受限说明（code=501）。"""
    return await call(service("restricted").eia_apply, enterid)


async def carbon_report(token: Optional[str] = None) -> dict:
    """碳排放报送（模块 18，预留/受限）。入参：token。出参：受限说明（code=501）。"""
    return await call(service("restricted").carbon_report, token)


async def correction_status() -> dict:
    """改正规定（模块 15，未启用）。入参：无。出参：暂未启用说明（code=501）。"""
    return await call(service("restricted").correction_status)


def register(mcp) -> None:
    mcp.add_tool(auto_monitor)
    mcp.add_tool(eia_apply)
    mcp.add_tool(carbon_report)
    mcp.add_tool(correction_status)


def tool_count() -> int:
    return 4


__all__ = [
    "auto_monitor",
    "eia_apply",
    "carbon_report",
    "correction_status",
    "register",
    "tool_count",
]
