"""工具层：41 个 MCP 工具的注册与导出。"""

from __future__ import annotations

from . import (
    auth_tools,
    company_tools,
    ledger_tools,
    license_tools,
    monitor_tools,
    report_tools,
    restricted_tools,
)

_ALL_MODULES = (
    auth_tools,
    company_tools,
    license_tools,
    report_tools,
    monitor_tools,
    ledger_tools,
    restricted_tools,
)


def register_all(mcp) -> None:
    """向 FastMCP 实例注册全部 41 个工具。"""
    for mod in _ALL_MODULES:
        mod.register(mcp)


def tool_count() -> int:
    """返回已注册工具总数（用于自检）。"""
    return sum(mod.tool_count() for mod in _ALL_MODULES)


__all__ = ["register_all", "tool_count"]
