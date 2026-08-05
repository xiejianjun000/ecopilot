"""
EcoPilot MCP Server — 全模块工具暴露给 Hermes Agent
启动: python ecopilot_mcp_server.py

Hermes 加载 ecopilot-compliance-butler skill 后自动发现这些工具，
前端各模块（日历/档案/整改/知识库/通讯等）全部通过 Hermes 驱动。
"""
import sys, os, json, asyncio

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

server = Server("ecopilot")


# ─── 工具注册（覆盖全部前端模块） ───
@server.list_tools()
async def list_tools():
    return [
        # ═══ 许可证 ═══
        Tool(name="permit_quick_check",
             description="获取企业排污许可证合规状态摘要（企业信息、排放口、执行审计、AI分析）。返回缓存数据。",
             inputSchema={"type": "object", "properties": {}}),
        Tool(name="permit_report_status",
             description="获取执行报告（月报/季报/年报）提交状态。按时间顺序列出已提交和未提交的报告。",
             inputSchema={"type": "object", "properties": {}}),
        Tool(name="permit_dashboard",
             description="获取许可证仪表盘完整数据：许可总量、排放口限值对比、各排口实际排放量。",
             inputSchema={"type": "object", "properties": {}}),

        # ═══ 监测 ═══
        Tool(name="monitoring_check",
             description="获取自动监控(CEMS)和自行监测状态。包括SSO连接状态、在线率、异常标记。",
             inputSchema={"type": "object", "properties": {}}),
        Tool(name="carbon_check",
             description="获取碳排放相关平台状态。碳市场账户注册状态、报送系统连接、配额分配情况。",
             inputSchema={"type": "object", "properties": {}}),
        Tool(name="platform_list",
             description="列出企业涉及的12个环保政务平台清单及登录状态。",
             inputSchema={"type": "object", "properties": {}}),

        # ═══ 合规日历 ═══
        Tool(name="calendar_task_list",
             description="列出合规日历任务（月报/季报/年报/监测/台账）。按提交截止时间排序，标注逾期/正常状态。",
             inputSchema={"type": "object", "properties": {
                 "action": {"type": "string", "description": "list=列出, suggest=AI建议生成", "default": "list"}
             }}),
        Tool(name="calendar_templates",
             description="获取台账和报告模板列表。含生产设施/治污设施/监测/异常等目录。",
             inputSchema={"type": "object", "properties": {
                 "category": {"type": "string", "description": "筛选分类", "default": ""}
             }}),
        Tool(name="calendar_task_suggest",
             description="AI根据许可证分析，建议需要添加的日历任务。",
             inputSchema={"type": "object", "properties": {}}),

        # ═══ 档案库 ═══
        Tool(name="vault_file_list",
             description="列出企业档案库中的文件。可按分类筛选（许可证/监测报告/台账/执行报告/其他）。",
             inputSchema={"type": "object", "properties": {
                 "category": {"type": "string", "description": "筛选分类", "default": ""}
             }}),
        Tool(name="vault_file_detail",
             description="读取档案库中某个文件的内容。需传入文件id。",
             inputSchema={"type": "object", "properties": {
                 "id": {"type": "string", "description": "文件id"}
             }, "required": ["id"]}),

        # ═══ 督察整改 ═══
        Tool(name="rectification_task_list",
             description="列出所有督察整改任务。含立行立改/跟踪督办/工程建设三类。每项标注状态和截止日期。",
             inputSchema={"type": "object", "properties": {}}),
        Tool(name="rectification_task_add",
             description="新增督察整改任务。指定问题、整改措施、责任人、截止日期。",
             inputSchema={"type": "object", "properties": {
                 "title": {"type": "string", "description": "任务标题"},
                 "description": {"type": "string", "description": "问题描述"},
                 "type": {"type": "string", "description": "任务类型: immediate=立行立改, supervise=跟踪督办, construction=工程建设"},
                 "deadline": {"type": "string", "description": "截止日期 YYYY-MM-DD"}
             }, "required": ["title", "description", "type", "deadline"]}),

        # ═══ 知识库 ═══
        Tool(name="knowledge_list",
             description="列出环保知识库中的文档列表。按分类/日期排序。",
             inputSchema={"type": "object", "properties": {
                 "category": {"type": "string", "description": "筛选分类", "default": ""}
             }}),
        Tool(name="knowledge_search",
             description="搜索环保法规知识库，查找具体法规条款、排放标准、管理要求、案例。涉法问题必调用。",
             inputSchema={"type": "object", "properties": {
                 "query": {"type": "string", "description": "搜索关键词"}
             }, "required": ["query"]}),
        Tool(name="knowledge_read",
             description="读取知识库中某篇文档的完整内容。需传入文档id。",
             inputSchema={"type": "object", "properties": {
                 "id": {"type": "string", "description": "文档id"}
             }, "required": ["id"]}),

        # ═══ 通讯中心 ═══
        Tool(name="notify_platforms",
             description="列出已连接的通讯平台（飞书/微信/企微等）及连接状态。",
             inputSchema={"type": "object", "properties": {}}),
        Tool(name="notify_channels",
             description="列出各通讯平台下的频道/群组列表。",
             inputSchema={"type": "object", "properties": {}}),

        # ═══ 企业信息 ═══
        Tool(name="enterprise_info",
             description="获取当前企业基本信息（名称、统一信用代码、许可证号、法人、地址、管理类别）。",
             inputSchema={"type": "object", "properties": {}}),

        # ═══ 法规检索 ═══
        Tool(name="web_search",
             description="上网搜索环保法规、标准全文、政策解读、行业信息。当本地知识库查不到时调用。",
             inputSchema={"type": "object", "properties": {
                 "query": {"type": "string", "description": "搜索关键词"}
             }, "required": ["query"]}),

        # ═══ 基础设施 ═══
        Tool(name="vault_guide",
             description="引导用户将档案文件补充到档案库。",
             inputSchema={"type": "object", "properties": {
                 "file_type": {"type": "string", "description": "文件类型"}
             }, "required": ["file_type"]}),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict):
    from tools import execute_tool
    result = await execute_tool(name, arguments, sid="mcp-bridge")
    return [TextContent(type="text", text=str(result))]


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
