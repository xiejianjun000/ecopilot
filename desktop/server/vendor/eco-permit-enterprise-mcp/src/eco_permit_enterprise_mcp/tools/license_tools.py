"""许可证业务工具（18 个）：模块 2/3/4/5/6/7/8/9/10/11。"""

from __future__ import annotations

from typing import Optional

from ._helpers import call, service


async def license_apply_list(apply_type: str = "first") -> dict:
    """许可证申请入口与预检（模块 3）。

    入参：
    - applyType: 申请子项，可选 first=首次申请 / supplement=补充申请 / rectification=整改后申请

    出参：统一社会信用代码/注销状态预检结果 + 可用申请入口。
    """
    return await call(service("license").apply_list, apply_type)


async def license_reapply_list(
    search_type: str = "ZT_0",
    page_no: int = 1,
    page_size: int = 10,
) -> dict:
    """许可证重新申请列表（模块 4，P0）。

    入参：
    - searchType: 审核状态，可选 ZT_0全部 / ZT_1未提交 / ZT_2已提交等待受理 / ZT_3审批中 / ZT_4审批通过 / ZT_5审批不通过 / ZT_7补正 / ZT_8不予受理
    - pageNo: 页码（默认 1）
    - pageSize: 每页条数（默认 10）

    出参：列表记录（序号/单位名称/审核状态/提交时间/操作）。
    """
    return await call(service("license").reapply_list, search_type, page_no, page_size)


async def license_change_list(
    change_type: str = "basic",
    search_type: str = "ZT_0",
    page_no: int = 1,
) -> dict:
    """许可证变更列表（模块 5，P0）。

    入参：
    - changeType: 变更子项，可选 basic=基本信息变更 / other=其他情况变更
    - searchType: 审核状态（同重新申请枚举）
    - pageNo: 页码（默认 1）

    出参：列表记录（序号/单位名称/审核状态/提交时间/操作）。
    """
    return await call(service("license").change_list, change_type, search_type, page_no)


async def license_adjust_list(
    search_type: str = "ZT_0",
    page_no: int = 1,
) -> dict:
    """许可证调整列表（模块 6，P0）。

    入参：
    - searchType: 审核状态（ZT_0~ZT_8）
    - pageNo: 页码（默认 1）

    出参：列表记录。
    """
    return await call(service("license").adjust_list, search_type, page_no)


async def license_renew_list(
    search_type: str = "ZT_0",
    page_no: int = 1,
) -> dict:
    """许可证延续列表（模块 7，P0）。

    入参：
    - searchType: 审核状态（ZT_0~ZT_8）
    - pageNo: 页码（默认 1）

    出参：列表记录。
    """
    return await call(service("license").renew_list, search_type, page_no)


async def license_reissue_list(page_no: int = 1) -> dict:
    """许可证补办（遗失声明）列表（模块 8，P0）。

    入参：
    - pageNo: 页码（默认 1）

    出参：遗失声明列表记录。
    """
    return await call(service("license").reissue_list, page_no)


async def soil_manage_list(page_no: int = 1) -> dict:
    """土壤管理-涉重登记列表（模块 9，P1）。

    入参：
    - pageNo: 页码（默认 1）

    出参：涉重登记列表记录。
    """
    return await call(service("license").soil_list, page_no)


async def register_list(register_type: str = "register") -> dict:
    """排污登记列表（模块 10，P1）。

    入参：
    - registerType: 登记子项，可选 register=排污登记 / bcbg=登记变更 / djyx=登记延续 / cancel=登记注销

    出参：登记列表记录。
    """
    return await call(service("license").register_list, register_type)


async def disclosure_list(
    search_fb_time: str = "",
    page_no: int = 1,
) -> dict:
    """信息公开列表（模块 11，P0）。

    入参：
    - searchFbTime: 发布日期筛选（可选，格式如 2026-08）
    - pageNo: 页码（默认 1）

    出参：发布状态/发布日期/信息公开起止日期/公众反馈及处理/操作。
    """
    return await call(service("license").disclosure_list, search_fb_time, page_no)


async def license_apply_check(enterid: Optional[str] = None) -> dict:
    """许可证申请预检（模块 3/4，P0）：检查统一社会信用代码注册状态与是否已注销。

    入参：
    - enterid: 企业 ID（可选，缺省用 .env 配置值）

    出参：registerStatus、cancelled。
    """
    return await call(service("license").apply_check, enterid)


async def self_acceptance(enterid: Optional[str] = None) -> dict:
    """自主验收预检（模块 2，P1）：checkEnter 返回 1 才允许进入。

    入参：
    - enterid: 企业 ID（可选，缺省用 .env 配置值）

    出参：预检结果与验收入口。
    """
    return await call(service("license").self_acceptance, enterid)


async def license_public_info(
    permit_code: str = "",
    company_name: str = "",
) -> dict:
    """查询公开「许可信息公开」，提取许可证有效期限/发证日期（无需登录）。

    入参：
    - permitCode: 排污许可证编号（可选，缺省用 .env 配置值）
    - companyName: 单位名称（可选）

    出参：许可证编号、单位名称、行业、有效期限(validFrom/validTo)、发证日期、管理类别。
    该接口是许可证有效期的权威来源（申请/重新申请列表仅含审批日期）。
    """
    return await call(service("license").public_license_info, permit_code, company_name)


async def license_detail(
    dataid: str = "",
    cards: Optional[list] = None,
) -> dict:
    """穿透读取许可证详情（模块 4/5/6/7 的「查看」详情，20 张卡）。

    通过 dataid 逐卡导航 hpsp!xxx.action 详情页（readonly 模式），
    提取每张卡的正文文本 + 表格。dataid 缺省时从变更列表自动提取。

    入参：
    - dataid: 许可证 dataid（30-40 位 UUID，缺省自动从变更列表提取）
    - cards: 要读取的 cardid 列表（缺省读取全部数据卡）

    出参：{dataid, cards: {cardid: {name, text, tables}}}。

    覆盖模块：重新申请(4)/变更(5)/调整(6)/延续(7) 的「查看」详情均为本许可证详情。
    """
    return await call(service("license").license_detail, dataid, cards)


async def license_detail_cards() -> dict:
    """返回许可证详情可用卡片清单（cardid + 名称）。入参：无。

    出参：{cards: [{cardid, name}]}，用于按需指定 license_detail 的 cards 参数。
    """
    return await call(service("license").license_detail_cards)


async def license_reissue_detail(pkid: str = "") -> dict:
    """补办/遗失声明详情（模块 8，P0）。

    入参：
    - pkid: 遗失声明记录主键（来自 license_reissue_list 的「查看」链接）

    出参：{pkid, fields: {标签: 值}}（排污许可证编号/单位名称/核发机关/发证日期等）。
    """
    return await call(service("license").reissue_detail, pkid)


async def soil_detail(sqdjid: str = "") -> dict:
    """土壤管理-涉重登记详情 + 审批意见（模块 9，P1）。

    入参：
    - sqdjid: 涉重登记记录主键（来自 soil_manage_list 的「查看」链接）

    出参：{sqdjid, fields: {标签: 值}, opinion: {标签: 值}}。
    """
    return await call(service("license").soil_detail, sqdjid)


async def disclosure_detail(
    pkid: str = "",
    dataid: str = "",
    yy_flag: str = "false",
    with_feedback: bool = True,
) -> dict:
    """信息公开详情 + 公众反馈（模块 11，P0）。

    入参：
    - pkid: 信息公开记录主键（来自 disclosure_list 的「查看」链接）
    - dataid: 许可证 dataid（同来源）
    - yyFlag: false=许可申请前公开 / true=其他（默认 false）
    - withFeedback: 是否附带读取公众反馈（默认 true）

    出参：{pkid, dataid, fields: {标签: 值}, feedback: [...]}。
    """
    return await call(service("license").disclosure_detail, pkid, dataid, yy_flag, with_feedback)


async def register_detail(sqdjid: str = "") -> dict:
    """排污登记详情（模块 10，P1）。

    入参：
    - sqdjid: 登记记录主键（来自 register_list 的「查看/编辑」链接）

    出参：{sqdjid, fields: {标签: 值}}（统一社会信用代码/行业类别/主要产品/
    燃料/废气废水治理设施与排放口等填报字段）。
    """
    return await call(service("license").register_detail, sqdjid)


def register(mcp) -> None:
    mcp.add_tool(license_apply_list)
    mcp.add_tool(license_reapply_list)
    mcp.add_tool(license_change_list)
    mcp.add_tool(license_adjust_list)
    mcp.add_tool(license_renew_list)
    mcp.add_tool(license_reissue_list)
    mcp.add_tool(soil_manage_list)
    mcp.add_tool(register_list)
    mcp.add_tool(disclosure_list)
    mcp.add_tool(license_apply_check)
    mcp.add_tool(self_acceptance)
    mcp.add_tool(license_public_info)
    mcp.add_tool(license_detail)
    mcp.add_tool(license_detail_cards)
    mcp.add_tool(license_reissue_detail)
    mcp.add_tool(soil_detail)
    mcp.add_tool(disclosure_detail)
    mcp.add_tool(register_detail)


def tool_count() -> int:
    return 18


__all__ = [
    "license_apply_list",
    "license_reapply_list",
    "license_change_list",
    "license_adjust_list",
    "license_renew_list",
    "license_reissue_list",
    "soil_manage_list",
    "register_list",
    "disclosure_list",
    "license_apply_check",
    "self_acceptance",
    "license_public_info",
    "license_detail",
    "license_detail_cards",
    "license_reissue_detail",
    "soil_detail",
    "disclosure_detail",
    "register_detail",
    "register",
    "tool_count",
]
