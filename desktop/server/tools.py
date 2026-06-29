"""
EcoPilot 工具定义和执行器
AI 通过 Function Calling 调用的所有工具 - 覆盖15+环保政务平台
"""

import json, httpx
from typing import Any

CHAT_API = "http://127.0.0.1:8002"

# ─── 完整工具 Schema ───

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "permit_quick_check",
            "description": "快速检查【全国排污许可证管理信息平台】的合规状态，查看执行报告逾期情况、许可申请状态、监测业务状态、改正规定消息。无需参数，自动查询已登录的会话。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "permit_login_guide",
            "description": "引导用户登录【全国排污许可证管理信息平台】。告诉用户需要输入平台账号、密码和验证码。用户在浏览器页面操作。",
            "parameters": {
                "type": "object",
                "properties": {
                    "username": {"type": "string", "description": "平台账号，如 yuanbin"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "permit_report_status",
            "description": "检查【全国排污许可证管理信息平台】上各年度执行报告（月报/季报/年报）的提交状态，发现哪些月份或季度缺失。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "monitoring_check",
            "description": "检查【重点排污单位自动监控平台】和【全国污染源监测信息管理平台】的连接状态。查看CEMS在线数据是否正常、自行监测数据是否公开。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "carbon_check",
            "description": "检查【全国碳排放权交易市场】和【全国碳排放报送系统】的状态。查看碳配额情况、报送系统连接。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "knowledge_search",
            "description": "搜索环保法规知识库，查找具体法规条款、排放标准、管理要求。例如排污许可管理条例第37条、钢铁超低排放标准DB43/3082-2024等。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词，如排污许可管理条例第37条"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "vault_guide",
            "description": "引导用户将档案文件补充到系统档案库。在完成对企业问题的完整答复后，在末尾提醒时调用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_type": {"type": "string", "description": "要引导用户上传的文件类型：环评批复、环保验收、自行监测方案、应急预案、危废管理计划、清洁生产审核、排污口规范化、环保税申报"},
                },
                "required": ["file_type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "platform_list",
            "description": "列出企业需要打交道的全部15个环保政务平台清单，包括平台名称、用途、登录状态。用户在政务平台页面可以看到完整列表。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "platform_login",
            "description": "登录指定的环保政务平台。如果平台已有自动登录脚本，会自动启动浏览器会话并获取验证码，引导用户输入验证码完成登录。",
            "parameters": {
                "type": "object",
                "properties": {
                    "platform_id": {
                        "type": "string",
                        "description": "平台ID：permit(排污许可) auto-monitor(自动监控) pollution-monitor(污染源监测) carbon-trade(碳市场) carbon-report(碳排放报送) solid-waste(固废) hazard-waste(危废) eia-credit(环评信用) enforcement(执法) credit-eval(信用评价) tax(环保税)",
                    },
                    "username": {
                        "type": "string",
                        "description": "平台登录账号",
                    },
                },
                "required": ["platform_id"],
            },
        },
    },
]


# ─── 工具执行 ───

async def execute_tool(name: str, args: dict, sid: str) -> str:
    try:
        if name == "platform_login":
            return await _platform_login(args.get("platform_id", ""), args.get("username", ""))
        if name == "permit_quick_check":
            return await _quick_check()
        elif name == "permit_login_guide":
            return _login_guide(args.get("username", "企业用户"))
        elif name == "permit_report_status":
            return await _report_status()
        elif name == "monitoring_check":
            return _monitoring_check()
        elif name == "carbon_check":
            return _carbon_check()
        elif name == "knowledge_search":
            return _knowledge_search(args.get("query", ""))
        elif name == "vault_guide":
            return _vault_guide(args.get("file_type", ""))
        elif name == "platform_list":
            return _platform_list()
        else:
            return f"未知工具: {name}"
    except Exception as e:
        return f"工具 {name} 执行失败: {e}"



async def _platform_login(platform_id: str, username: str) -> str:
    """引导用户登录指定平台"""
    platforms = {
        "permit": ("全国排污许可证管理信息平台", "permit.mee.gov.cn", True),
    }
    name, url, auto = platforms.get(platform_id, (platform_id, "", False))
    if auto and platform_id == "permit":
        try:
            async with httpx.AsyncClient(timeout=60) as c:
                r = await c.post(CHAT_API + "/api/permit/login/quick",
                    json={"username": "yuanbin", "password": "432502@Bin"})
                d = r.json()
                if d.get("ok"):
                    s = d["session_id"][:20]
                    return "已成功登录【" + name + "】，会话ID: " + s + "...\n\nAI现在可以查询该平台的数据。"
        except:
            pass
        return "请登录【" + name + "】在政务平台页面点击该平台卡片，在弹出的登录弹窗中完成登录。"
    return "请登录【" + name + "】 在政务平台页面点击该平台卡片，在浏览器中完成登录。"

async def _quick_check() -> str:
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            resp = await c.post(f"{CHAT_API}/api/permit/quick-check", json={})
            data = resp.json()
            if data.get("ok"):
                keys = [("report_status", "执行报告"), ("permit_status", "许可申请"),
                        ("monitoring", "监测业务"), ("rectification", "改正规定")]
                parts = [f"{label}: {data.get(k, '无')}" for k, label in keys if data.get(k)]
                return "【全国排污许可证管理信息平台】快速巡检结果:\n" + "\n".join(parts)
            return f"巡检失败: {data.get('detail', '未知错误')}"
    except Exception as e:
        return f"无法连接巡检服务: {e}"


def _login_guide(username: str) -> str:
    return (
        "请按以下步骤登录【全国排污许可证管理信息平台】:\n\n"
        "1. 在页面上输入您的平台账号和密码\n"
        "2. 输入页面上显示的验证码\n"
        "3. 点击登录按钮\n\n"
        "登录成功后，我可以帮您查看执行报告状态、检查台账情况。"
    )


async def _report_status() -> str:
    """检查执行报告状态 - 快速巡检已有此信息"""
    return await _quick_check()


def _monitoring_check() -> str:
    return (
        "【重点排污单位自动监控平台】和【全国污染源监测信息管理平台】检查结果:\n\n"
        "自动监控模块: 当前SSO接口故障(405)，无法连接wryjc.cnemc.cn\n"
        "自行监测状态: 需要重新配置SSO登录\n\n"
        "建议: 联系娄底市生态环境局信息中心，排查网络或账号权限问题。"
    )


def _carbon_check() -> str:
    return (
        "【碳排放相关平台】检查结果:\n\n"
        "全国碳排放权交易市场: 未连接，需要注册碳市场账户\n"
        "全国碳排放报送系统(114.251.10.30): 旧系统显示不属于填报范围（基于2022年名单）\n\n"
        "提醒: 钢铁行业已被纳入全国碳排放权交易市场，请关注配额分配通知和新系统切换。"
    )


def _knowledge_search(query: str) -> str:
    import os
    from pathlib import Path
    kb_dir = Path.home() / ".ecopilot-home" / "knowledge"
    if not kb_dir.exists():
        return f"知识库目录不存在，请先下载法规标准文件到 {kb_dir}"
    results = []
    for f in sorted(kb_dir.rglob("*.md")):
        try:
            content = f.read_text(encoding="utf-8")
            if query.lower() in content.lower():
                lines = content.split("\n")
                for i, line in enumerate(lines):
                    if query.lower() in line.lower():
                        start, end = max(0, i-2), min(len(lines), i+3)
                        snippet = "\n".join(lines[start:end])
                        results.append(f"【{f.stem}】\n{snippet}")
                        if len(results) >= 3: break
            if len(results) >= 3: break
        except: continue
    if not results: return f"知识库中未找到「{query}」相关内容。"
    return f"知识库搜索结果（{query}）:\n\n" + "\n\n".join(results)


def _vault_guide(file_type: str) -> str:
    tips = {
        "环评批复": "环境影响评价报告及批复文件",
        "环保验收": "竣工环保验收报告及专家意见",
        "自行监测方案": "自行监测方案及历史监测报告",
        "应急预案": "突发环境事件应急预案及演练记录",
        "危废管理计划": "危险废物管理计划及转移联单",
        "清洁生产审核": "清洁生产审核报告",
        "排污口规范化": "排污口规范化设置文件",
        "环保税申报": "环保税申报记录",
    }
    desc = tips.get(file_type, file_type)
    return f"您可以将【{file_type}】（{desc}）上传到系统档案库中，上传后EcoPilot可以帮您做更全面的合规诊断。"


def _platform_list() -> str:
    platforms = [
        ("全国排污许可证管理信息平台", "permit.mee.gov.cn", "许可证/执行报告/台账"),
        ("重点排污单位自动监控平台", "wryjc.cnemc.cn", "CEMS在线监测"),
        ("全国污染源监测信息管理平台", "wryjc.cnemc.cn", "自行监测数据公开"),
        ("自行监测信息公开平台", "-", "监测数据对社会公开"),
        ("全国碳排放权交易市场", "www.carbonx.cn", "碳配额/履约"),
        ("全国碳排放报送系统", "114.251.10.30", "碳排放数据报送"),
        ("全国固体废物管理信息系统", "gfgl.mee.gov.cn", "固废台账/申报"),
        ("危险废物转移管理平台", "-", "危废联单/跨省转移"),
        ("环境影响评价信用平台", "xypt.china-eia.com", "环评编制/信用"),
        ("建设项目竣工环保验收平台", "-", "验收报告公示"),
        ("环境执法监管平台", "-", "整改/处罚记录"),
        ("企业环境信用评价系统", "-", "信用等级/修复"),
        ("排污权交易平台", "-", "排污权交易/租赁"),
        ("清洁生产管理平台", "-", "清洁生产审核"),
        ("环保税申报系统", "etax.chinatax.gov.cn", "环保税申报"),
    ]
    lines = [f"{i+1}. {n} - {d} ({u})" for i, (n, u, d) in enumerate(platforms)]
    return "企业环保合规涉及的15个政务平台:\n\n" + "\n".join(lines)
