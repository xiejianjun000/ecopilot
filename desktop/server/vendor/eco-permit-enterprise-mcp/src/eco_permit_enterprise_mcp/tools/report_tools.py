"""执行报告 / 统一报表工具：report_list / unified_report_list / report_detail。"""

from __future__ import annotations

from ._helpers import call, service


async def report_list(year: int = 2026, business_type: str = "RT") -> dict:
    """执行报告列表（模块 13，P0）。

    入参：
    - year: 年度（默认 2026）
    - businessType: 业务类型，RT=执行报告

    出参：报告列表（年度/状态）、企业画像。
    """
    return await call(service("report").report_list, year, business_type)


async def unified_report_list(year: int = 2026, business_type: str = "ENV") -> dict:
    """统一报表列表（模块 17，P1，试运行）。

    入参：
    - year: 年度（默认 2026）
    - businessType: 业务类型，ENV=统一报表

    出参：报表列表、企业画像。
    """
    return await call(service("report").unified_report_list, year, business_type)


async def report_detail(
    report_id: str = "",
    report_type: str = "quarter",
    report_year: int = 2026,
    report_quarter: int | None = None,
    report_month: int | None = None,
) -> dict:
    """深度穿透式读取报告正文（模块 13，P1）。

    点击季报/月报/年报卡片进入填报详情页，遍历左侧菜单逐页提取文本，
    合并返回完整填报内容（能源消耗、产品产量、排放量、治理设施等）。

    入参：
    - report_id: 报告 ID（idStr），来自 report_list 返回的 record.id
    - report_type: 报告类型（quarter/month/year）
    - report_year: 年度
    - report_quarter: 季度（季报时传 1/2/3/4）
    - report_month: 月份（月报时传 1-12）

    出参：报告正文文本（多页合并，含能源消耗/产品产量/排放量/治理设施等）。
    """
    # 构造 record 字典传给服务层
    record = {
        "id": report_id,
        "idStr": report_id,
        "reportType": report_type,
        "reportYear": report_year,
        "reportQuarter": report_quarter,
        "reportMonth": report_month,
    }
    return await call(service("report").report_detail, record)


async def report_auto_login() -> dict:
    """触发执行报告 autologin，返回 token + 企业画像（模块 13 前置，P0）。

    出参：token、企业画像（companyName/industryName/industryCode/
    managementType/enterid/permitCode/userAccount 等富信息）。

    用途：纯 HTTP CAS 登录只拿到最小画像，富信息需 Playwright 拦截
    report/report/api/autoLogin 响应补全。
    """
    return await call(service("report").auto_login)


async def report_export(
    report_id: str = "",
    report_type: str = "quarter",
    report_year: int = 2026,
    report_quarter: int | None = None,
    report_month: int | None = None,
    fmt: str = "pdf",
) -> dict:
    """导出执行报告为 PDF/Word（模块 13，P1）。

    入参：
    - report_id: 报告 ID（idStr），来自 report_list 返回的 record.id
    - report_type: 报告类型（quarter/month/year）
    - report_year: 年度
    - report_quarter: 季度（季报时传 1/2/3/4）
    - report_month: 月份（月报时传 1-12）
    - fmt: 导出格式（pdf 或 word，默认 pdf）

    出参：二进制内容（base64 编码）+ 字节数。
    """
    record = {
        "id": report_id,
        "idStr": report_id,
        "reportType": report_type,
        "reportYear": report_year,
        "reportQuarter": report_quarter,
        "reportMonth": report_month,
    }
    return await call(service("report").report_export, record, fmt)


async def report_transact(
    report_id: str = "",
    report_type: str = "quarter",
    report_year: int = 2026,
    report_quarter: int | None = None,
    report_month: int | None = None,
) -> dict:
    """读取报告办理记录/审批流程（模块 13，P1）。

    入参：
    - report_id: 报告 ID（idStr），来自 report_list 返回的 record.id
    - report_type: 报告类型（quarter/month/year）
    - report_year: 年度
    - report_quarter: 季度（季报时传 1/2/3/4）
    - report_month: 月份（月报时传 1-12）

    出参：办理记录列表（审批环节、时间、办理人、意见）。
    """
    record = {
        "id": report_id,
        "idStr": report_id,
        "reportType": report_type,
        "reportYear": report_year,
        "reportQuarter": report_quarter,
        "reportMonth": report_month,
    }
    return await call(service("report").report_transact_list, record)


async def report_template(
    template_name: str = "年报",
    category: str = "统一报表",
) -> dict:
    """读取统一报表填报模板内容（模块 17，写功能基础，P1）。

    进入填报模板编辑页，遍历 8 个菜单（企业基本信息/生产活动情况/
    生产单元信息/燃料及原辅材料/工业固废/污染治理设施/自行监测/排放口）
    逐页提取文本，合并返回当前已填报内容。

    入参：
    - template_name: 填报模板名称（年报/季报/月报，默认年报）
    - category: 模板类型（统一报表/执行报告，默认统一报表）

    出参：模板填报内容（多菜单合并文本）。
    """
    return await call(service("report").report_template_detail, template_name, category)


async def report_template_fill(
    template_name: str = "年报",
    category: str = "统一报表",
    data: dict | None = None,
) -> dict:
    """【写操作·需审批】在统一报表填报模板编辑页填写数据并保存草稿（模块 17）。

    遍历 8 个菜单，按 payload 的 ``fields``（{字段名/标签: 值}）逐页填充表单，
    最后点击「保存」按钮。

    入参：
    - template_name: 填报模板名称（年报/季报/月报，默认年报）
    - category: 模板类型（统一报表/执行报告，默认统一报表）
    - data: 待写入数据，含 ``fields`` 字典

    出参：{ok, filled_count, error}。

    安全：本工具为写操作，仅能通过审批闸门（/api/approval/execute）编排调用，
    AI 不可直接触发。
    """
    return await call(service("report").report_template_fill, template_name, category, data or {})


async def report_template_submit(
    template_name: str = "年报",
    category: str = "统一报表",
) -> dict:
    """【写操作·需审批】提交统一报表填报模板（模块 17）。

    进入编辑页后点击「提交」按钮。

    入参：
    - template_name: 填报模板名称（年报/季报/月报，默认年报）
    - category: 模板类型（统一报表/执行报告，默认统一报表）

    出参：{ok, error}。

    安全：本工具为写操作，仅能通过审批闸门（/api/approval/execute）编排调用，
    AI 不可直接触发。
    """
    return await call(service("report").report_template_submit, template_name, category)


def register(mcp) -> None:
    mcp.add_tool(report_list)
    mcp.add_tool(unified_report_list)
    mcp.add_tool(report_detail)
    mcp.add_tool(report_auto_login)
    mcp.add_tool(report_export)
    mcp.add_tool(report_transact)
    mcp.add_tool(report_template)
    mcp.add_tool(report_template_fill)
    mcp.add_tool(report_template_submit)


def tool_count() -> int:
    return 9


__all__ = [
    "report_list", "unified_report_list", "report_detail", "report_auto_login",
    "report_export", "report_transact", "report_template",
    "report_template_fill", "report_template_submit", "register", "tool_count",
]
