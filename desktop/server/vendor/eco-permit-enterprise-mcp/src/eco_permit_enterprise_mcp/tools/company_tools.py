"""企业基础信息工具：company_profile / company_menu。"""

from __future__ import annotations

from typing import Optional

from ._helpers import call, service


async def company_profile(permit_code: Optional[str] = None) -> dict:
    """获取企业画像。

    入参：
    - permitCode: 排污许可证编号（可选，缺省用服务端 .env 配置值）

    出参：enterid、permitCode、企业名、行业代码/名称、管理类型、userId。
    """
    return await call(service("company").profile, permit_code)


async def company_menu() -> dict:
    """获取 18 模块菜单/路由可达性清单（含受限标注）。入参：无。

    出参：18 个模块的名称、分组、state、是否受限及受限原因。
    """
    return await call(service("company").menu)


def register(mcp) -> None:
    mcp.add_tool(company_profile)
    mcp.add_tool(company_menu)


def tool_count() -> int:
    return 2


__all__ = ["company_profile", "company_menu", "register", "tool_count"]
