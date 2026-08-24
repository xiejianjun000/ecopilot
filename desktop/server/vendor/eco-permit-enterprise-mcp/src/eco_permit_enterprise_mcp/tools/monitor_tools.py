"""监测记录工具：monitor_info / monitor_month_status / monitor_detail。"""

from __future__ import annotations

from typing import Optional

from ._helpers import call, service


async def monitor_info(
    qybh: Optional[str] = None,
    sheng: Optional[str] = None,
    shi: Optional[str] = None,
    xian: Optional[str] = None,
) -> dict:
    """企业监测信息（模块 14，P0，独立 REST 子系统）。

    入参（缺省取 .env 配置值）：
    - qybh: 企业编号
    - sheng/shi/xian: 省/市/县编码

    出参：企业监测基础信息。
    """
    return await call(service("monitor").monitor_info, qybh, sheng, shi, xian)


async def monitor_month_status(
    uuid: str = "",
    sheng: Optional[str] = None,
    shi: Optional[str] = None,
    xian: Optional[str] = None,
    qybh: Optional[str] = None,
    yue: str = "",
) -> dict:
    """企业月度监测数据/完成率（模块 14，P0）。

    入参：
    - uuid: 监测 uuid（可选）
    - sheng/shi/xian: 省/市/县编码（缺省取 .env 配置值）
    - qybh: 企业编号（缺省取 .env 配置值）
    - yue: 月份（如 202608）

    出参：月度数据情况、完成率。
    """
    return await call(
        service("monitor").monitor_month_status,
        uuid, sheng, shi, xian, qybh, yue,
    )


async def monitor_detail(
    qybh: Optional[str] = None,
    sheng: Optional[str] = None,
    shi: Optional[str] = None,
    xian: Optional[str] = None,
    yue: str = "",
) -> dict:
    """监测记录明细（模块 14，穿透式读取监测数据条目）。

    合并读取监测子系统的企业信息、手工监测结果明细、在线监测数据、
    月度数据情况，返回完整监测记录明细。

    入参（缺省取 .env 配置值）：
    - qybh: 企业编号
    - sheng/shi/xian: 省/市/县编码
    - yue: 月份（如 2026-08，缺省取当月）

    出参：{enterprise, manual_records, online_records, month_data}。
    """
    return await call(
        service("monitor").monitor_detail,
        qybh, sheng, shi, xian, yue,
    )


def register(mcp) -> None:
    mcp.add_tool(monitor_info)
    mcp.add_tool(monitor_month_status)
    mcp.add_tool(monitor_detail)


def tool_count() -> int:
    return 3


__all__ = ["monitor_info", "monitor_month_status", "monitor_detail", "register", "tool_count"]
