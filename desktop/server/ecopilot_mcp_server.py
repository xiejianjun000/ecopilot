"""
EcoPilot MCP Server — 将 EcoPilot 工具暴露给 Hermes Agent
启动: python ecopilot_mcp_server.py
"""
import sys, os, json, asyncio

# 确保可以导入同目录模块
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

server = Server("ecopilot")

# ─── 工具注册 ───
@server.list_tools()
async def list_tools():
    return [
        Tool(
            name="permit_quick_check",
            description="获取企业排污许可证合规状态摘要（企业信息、排放口、执行审计、AI分析）。返回上次读取的缓存数据。",
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="knowledge_search",
            description="搜索环保法规知识库，查找具体法规条款、排放标准、管理要求。涉法问题必先调用。",
            inputSchema={
                "type": "object",
                "properties": {"query": {"type": "string", "description": "搜索关键词"}},
                "required": ["query"],
            },
        ),
        Tool(
            name="permit_report_status",
            description="获取执行报告（月报/季报/年报）提交状态。",
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="monitoring_check",
            description="获取自动监控和自行监测状态。",
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="carbon_check",
            description="获取碳排放相关平台状态。",
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="vault_guide",
            description="引导用户将档案文件补充到档案库。",
            inputSchema={
                "type": "object",
                "properties": {"file_type": {"type": "string", "description": "文件类型"}},
                "required": ["file_type"],
            },
        ),
        Tool(
            name="platform_list",
            description="列出企业涉及的12个环保政务平台清单。",
            inputSchema={"type": "object", "properties": {}},
        ),
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
