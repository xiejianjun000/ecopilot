"""台账记录工具：ledger_list（深度穿透）。"""

from __future__ import annotations

from ._helpers import call, service


async def ledger_list(
    page_no: int = 1,
    entry_type: str = "1",
    start_year: int = 2020,
    end_year: int = 2026,
) -> dict:
    """台账记录列表（模块 12，P1，深度穿透）。

    导航台账系统，拦截 bookAccount/v1/list 响应，
    返回台账记录列表 + 5 个子表单数据量（监测信息/生产设施/燃料分析/废气处理/污水处理）。

    入参：
    - page_no: 页码（默认 1）
    - entry_type: 台账类型（1=台账记录，2=一般工业固废电子台账）
    - start_year: 起始年度（默认 2020）
    - end_year: 截止年度（默认 2026）

    出参：台账记录列表、子表单统计、企业画像。
    """
    return await call(service("ledger").ledger_list, page_no, entry_type, start_year, end_year)


async def ledger_upload(
    entry_type: str = "1",
    data: dict | None = None,
) -> dict:
    """【写操作·需审批】上传电子台账（模块 12，写功能）。

    导航台账系统，定位「上传/导入」入口并进入上传界面；若 data 提供
    ``file_base64`` 则解码为临时文件写入文件上传 input。

    入参：
    - entry_type: 台账类型（1=台账记录，2=一般工业固废电子台账）
    - data: 上传数据，可含 file_name / file_base64 / year

    出参：{ok, error}。

    安全：本工具为写操作，仅能通过审批闸门（/api/approval/execute）编排调用，
    AI 不可直接触发。
    """
    return await call(service("ledger").ledger_upload, entry_type, data or {})


def register(mcp) -> None:
    mcp.add_tool(ledger_list)
    mcp.add_tool(ledger_upload)


def tool_count() -> int:
    return 2


__all__ = ["ledger_list", "ledger_upload", "register", "tool_count"]
