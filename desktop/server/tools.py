"""
EcoPilot 工具定义和执行器
AI 通过 Function Calling 调用的所有工具 - 覆盖15+环保政务平台
"""

import json, os, httpx
from typing import Any
from pathlib import Path

from mcp_client import get_mcp_manager

CHAT_API = "http://127.0.0.1:8002"

# ─── 完整工具 Schema ───

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "permit_quick_check",
            "description": "获取企业排污许可证合规状态摘要（企业信息、排放口、执行审计、AI 分析）。优先返回上次读取的缓存数据，仅当用户明确要求'重新查'时才实时连平台。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "permit_login_guide",
            "description": "引导用户登录【全国排污许可证管理信息平台】。仅当用户主动说'我要登录平台'时调用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "username": {"type": "string", "description": "平台账号"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "permit_report_status",
            "description": "获取执行报告（月报/季报/年报）提交状态。优先返回缓存数据。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "monitoring_check",
            "description": "获取自动监控和自行监测状态。优先返回缓存数据。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "carbon_check",
            "description": "获取碳排放相关平台状态。优先返回缓存数据。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "knowledge_search",
            "description": "搜索环保法规知识库，查找具体法规条款、排放标准、管理要求。涉法问题必先调用。",
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
            "description": "引导用户将档案文件补充到档案库。答复末尾视情况调用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_type": {"type": "string", "description": "文件类型：环评批复/环保验收/自行监测方案/应急预案/危废管理计划/清洁生产审核/排污口规范化/环保税申报"},
                },
                "required": ["file_type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "platform_list",
            "description": "列出企业涉及的15个环保政务平台清单。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "上网搜索环保法规、标准全文、政策解读、行业信息。当本地知识库查不到时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "platform_login",
            "description": "登录指定的环保政务平台。仅当用户明确要求登录某平台时调用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "platform_id": {
                        "type": "string",
                        "description": "平台ID：permit/auto-monitor/pollution-monitor/carbon-trade/carbon-report/solid-waste/hazard-waste/eia-credit/enforcement/credit-eval/tax",
                    },
                    "username": {"type": "string", "description": "平台登录账号"},
                },
                "required": ["platform_id"],
            },
        },
    },
]


# ─── 工具执行 ───

# 写操作工具（黑名单）：必须经用户审批，AI 不可直接调用
# 这些工具注册在 eco-permit-enterprise MCP，仅供 /api/approval/execute 编排执行
_PERMIT_WRITE_TOOLS = {
    "report_template_fill",   # 统一报表填报模板保存
    "report_template_submit", # 报告/模板提交
    "ledger_upload",          # 台账上传
}


def get_merged_tools() -> list[dict]:
    """合并内置工具 + 所有已连接的 MCP 工具。

    写操作工具从 AI 可见工具列表中剔除，仅能通过审批闸门（
    /api/approval/execute → _mcp_call_permit）编排执行，避免 AI 绕过审批。
    """
    mcp = get_mcp_manager()
    mcp_tools = mcp.get_all_tools()
    visible = [
        t for t in mcp_tools
        if not _is_permit_write_tool(t.get("function", {}).get("name", ""))
    ]
    return TOOLS + visible


def _is_permit_write_tool(full_name: str) -> bool:
    """判断 MCP 工具全名（server_id__tool_name）是否属于写操作黑名单。"""
    if "__" not in full_name:
        return False
    _, tool_name = full_name.split("__", 1)
    return tool_name in _PERMIT_WRITE_TOOLS


async def execute_tool(name: str, args: dict, sid: str) -> str:
    # MCP 工具：格式为 "server_id::tool_name"
    if "__" in name:
        mcp = get_mcp_manager()
        return await mcp.call_tool(name, args)

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
        elif name == "web_search":
            return _web_search(args.get("query", ""))
        # ═══ 新增：日历/档案/整改/知识库/通讯 ═══
        elif name == "calendar_task_list":
            return await _calendar_task_list(args.get("action", "list"))
        elif name == "calendar_templates":
            return await _calendar_templates(args.get("category", ""))
        elif name == "calendar_task_suggest":
            return await _calendar_task_suggest()
        elif name == "vault_file_list":
            return await _vault_file_list(args.get("category", ""))
        elif name == "vault_file_detail":
            return await _vault_file_detail(args.get("id", ""))
        elif name == "rectification_task_list":
            return await _rectification_task_list()
        elif name == "rectification_task_add":
            return await _rectification_task_add(
                args.get("title", ""), args.get("description", ""),
                args.get("type", ""), args.get("deadline", "")
            )
        elif name == "knowledge_list":
            return await _knowledge_list(args.get("category", ""))
        elif name == "knowledge_read":
            return await _knowledge_read(args.get("id", ""))
        elif name == "notify_platforms":
            return await _notify_platforms()
        elif name == "notify_channels":
            return await _notify_channels()
        elif name == "enterprise_info":
            return await _enterprise_info()
        elif name == "permit_dashboard":
            return await _permit_dashboard()
        else:
            return f"未知工具: {name}"
    except Exception as e:
        return f"工具 {name} 执行失败: {e}"



async def _platform_login(platform_id: str, username: str) -> str:
    """登录指定政务平台。

    凭据优先从 credentials_manager（前端「申报平台」卡片保存的账号/密码）读取，
    回退到 ~/.ecopilot-home/.env 环境变量。修复"前端已保存凭据，但对话工具读不到"的通道断层。
    """
    platforms = {
        "permit": ("全国排污许可证管理信息平台", "permit.mee.gov.cn", True),
    }
    name, url, auto = platforms.get(platform_id, (platform_id, "", False))

    # ── 凭据通道：credentials_manager（platforms.json） > .env 环境变量 ──
    username = (username or "").strip()
    password = ""
    try:
        import credentials_manager
        cred = credentials_manager.get_credentials(platform_id) if platform_id else None
        if cred:
            username = username or (cred.get("username") or "")
            password = cred.get("password") or ""
    except Exception:
        cred = None
    if not username or not password:
        username = username or os.environ.get("ECOPILOT_PERMIT_USERNAME", "")
        password = os.environ.get("ECOPILOT_PERMIT_PASSWORD", "")

    if auto and platform_id == "permit":
        if not username or not password:
            return ("未配置排污许可平台账号密码。请先在「申报平台」的全国排污许可证管理信息平台卡片上保存账号密码，"
                    "或在 ~/.ecopilot-home/.env 中设置 ECOPILOT_PERMIT_USERNAME 和 ECOPILOT_PERMIT_PASSWORD")
        try:
            async with httpx.AsyncClient(timeout=90) as c:
                r = await c.post(CHAT_API + "/api/permit/login/quick",
                    json={"username": username, "password": password})
                if r.status_code == 200:
                    d = r.json()
                    if d.get("ok"):
                        s = str(d.get("session_id", ""))[:20]
                        return "已成功登录【" + name + "】，会话ID: " + s + "...\n\nAI现在可以查询该平台的数据。"
                # 401 = 账号密码错误或验证码识别失败
                return ("【" + name + "】自动登录未成功。请核对账号密码，或在「申报平台」卡片重新保存凭据后重试；"
                        "也可手动打开平台完成登录。")
        except Exception as e:
            return ("【" + name + "】自动登录失败: " + str(e)[:200] + "。请确认平台可访问、凭据正确，或手动登录。")
    return "请登录【" + name + "】，在「申报平台」页面点击该平台卡片，在浏览器中完成登录。"

async def _quick_check() -> str:
    """快速巡检：优先用 permit-data.json 缓存数据，无缓存才实时查"""
    # 优先读缓存
    try:
        from pathlib import Path as _P
        import json as _json
        pd_file = _P.home() / ".ecopilot-home" / "permit-data.json"
        if pd_file.exists():
            pd = _json.loads(pd_file.read_text())
            parts = ["【快速巡检结果】（基于上次许可证读取数据）"]
            parsed = pd.get("parsed", {})
            if parsed.get("enterpriseName"):
                parts.append(f"企业: {parsed['enterpriseName']}")
            if parsed.get("managementLevel"):
                parts.append(f"管理类别: {parsed['managementLevel']}")
            # 有效期：优先permit-data.json，空则从dashboard缓存补
            vf = parsed.get("validFrom") or ""
            vt = parsed.get("validTo") or ""
            if not vf or not vt:
                try:
                    dc = _json.loads((_P.home() / ".ecopilot-home" / "permit_dashboard_cache.json").read_text())
                    de = dc.get("enterprise", {})
                    vf = vf or de.get("validFrom", "")
                    vt = vt or de.get("validTo", "")
                except: pass
            if vf and vt:
                parts.append(f"许可证有效期: {vf} 至 {vt}")
            outlets = parsed.get("emissionOutlets", [])
            if outlets:
                parts.append(f"排放口: {len(outlets)}个")
            # 执行审计摘要
            exec_data = pd.get("execution", {})
            if isinstance(exec_data, dict):
                mods = exec_data.get("modules", {})
                if isinstance(mods, dict) and mods:
                    parts.append(f"执行记录审计: {len(mods)}个模块已检查")
                    for mod_name, mod_info in mods.items():
                        if isinstance(mod_info, dict):
                            parts.append(f"  · {mod_name}: {mod_info.get('status','')}")
            # AI 分析摘要
            ai = pd.get("ai", {})
            if isinstance(ai, dict) and ai.get("compliance_score"):
                parts.append(f"合规评分: {ai['compliance_score']}/100")
                findings = ai.get("key_findings", [])
                if findings:
                    parts.append(f"关键发现: {len(findings)}项")
            import time as _t
            saved_at = pd.get("saved_at")
            if saved_at:
                parts.append(f"数据读取时间: {_t.strftime('%Y-%m-%d %H:%M', _t.localtime(saved_at))}")
            return "\n".join(parts)
    except Exception:
        pass

    # 无缓存 → 实时查
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            resp = await c.post(f"{CHAT_API}/api/permit/quick-check", json={})
            data = resp.json()
            if data.get("ok"):
                keys = [("report_status", "执行报告"), ("permit_status", "许可申请"),
                        ("monitoring", "监测业务"), ("rectification", "改正规定")]
                parts = [f"{label}: {data.get(k, '无')}" for k, label in keys if data.get(k)]
                return "【全国排污许可证管理信息平台】快速巡检结果:\n" + "\n".join(parts)
            return f"巡检失败: {data.get('detail', '未知错误')}，建议重新登录平台读取最新数据"
    except Exception as e:
        return f"巡检服务暂不可用: {e}，但许可证数据已在上下文中，可直接使用"


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
    """监测检查：优先用缓存数据"""
    try:
        from pathlib import Path as _P
        import json as _json
        pd_file = _P.home() / ".ecopilot-home" / "permit-data.json"
        if pd_file.exists():
            pd = _json.loads(pd_file.read_text())
            # 从执行审计或模块扫描中提取监测信息
            exec_data = pd.get("execution", {})
            if isinstance(exec_data, dict):
                mods = exec_data.get("modules", {})
                if isinstance(mods, dict):
                    for k in ("自行监测", "监测", "CEMS", "自动监控"):
                        if k in mods and isinstance(mods[k], dict):
                            return f"【监测检查】（基于上次读取数据）\n{k}: {mods[k].get('status','')} {mods[k].get('summary','')}"
            mods_scan = pd.get("modules", {})
            if isinstance(mods_scan, dict):
                mods = mods_scan.get("modules", {})
                if isinstance(mods, dict):
                    for k in ("自动监控", "监测"):
                        if k in mods and isinstance(mods[k], dict):
                            return f"【监测检查】（基于平台模块扫描）\n{k}: {'可达' if mods[k].get('reachable') or mods[k].get('ok') else '不可达'}"
    except Exception:
        pass
    # P7/P8 修复：兜底文案中性化（旧版硬编码了某次检查的 SSO 快照和客户地域信息），
    # 并尽量从许可证数据提取排放口/监测因子维度展示
    outlets_hint = ""
    try:
        from pathlib import Path as _P2
        import json as _json2
        pd_file2 = _P2.home() / ".ecopilot-home" / "permit-data.json"
        if pd_file2.exists():
            parsed = _json2.loads(pd_file2.read_text()).get("parsed", {})
            outlets = parsed.get("emissionOutlets", []) or []
            if outlets:
                air = [o for o in outlets if str(o.get("code", "")).startswith("DA")]
                water = [o for o in outlets if str(o.get("code", "")).startswith("DW")]
                lines = [f"企业排放口共 {len(outlets)} 个（废气 {len(air)} / 废水 {len(water)}）："]
                for o in outlets[:10]:
                    pollutants = "、".join(o.get("pollutants", [])[:6]) if isinstance(o.get("pollutants"), list) else ""
                    lines.append(f"· {o.get('code','')} {o.get('name','')}" + (f" — 监测因子: {pollutants}" if pollutants else ""))
                if len(outlets) > 10:
                    lines.append(f"…其余 {len(outlets)-10} 个从略")
                outlets_hint = "\n\n" + "\n".join(lines) + "\n"
    except Exception:
        pass
    return (
        "【监测检查】尚未读取到在线监测数据。\n"
        "可能原因：自动监控/自行监测模块需先完成平台登录（SSO），或当地平台接口临时不可用。\n"
        "建议：\n"
        "1. 先在「新建对话」完成许可证平台登录，我即可同步排放口与监测要求\n"
        "2. 若登录后仍无数据，需联系属地生态环境局信息中心确认平台接口状态"
        f"{outlets_hint}"
    )


def _carbon_check() -> str:
    """碳排放检查：优先用缓存数据"""
    try:
        from pathlib import Path as _P
        import json as _json
        pd_file = _P.home() / ".ecopilot-home" / "permit-data.json"
        if pd_file.exists():
            pd = _json.loads(pd_file.read_text())
            # 从平台模块扫描中提取碳排放信息
            mods_scan = pd.get("modules", {})
            if isinstance(mods_scan, dict):
                mods = mods_scan.get("modules", {})
                if isinstance(mods, dict):
                    for k in ("碳排放报送", "碳排放"):
                        if k in mods and isinstance(mods[k], dict):
                            reachable = mods[k].get("reachable") or mods[k].get("ok")
                            return f"【碳排放检查】（基于平台扫描）\n{k}: {'可达' if reachable else '不可达'}"
            # AI 分析中可能有碳排放相关发现
            ai = pd.get("ai", {})
            if isinstance(ai, dict):
                findings = ai.get("key_findings", [])
                carbon_findings = [f for f in findings if isinstance(f, dict) and "碳" in (f.get("title","") + f.get("issue",""))]
                if carbon_findings:
                    parts = ["【碳排放检查】（基于 AI 分析）"]
                    for f in carbon_findings[:3]:
                        parts.append(f"· [{f.get('level','')}] {f.get('title') or f.get('issue','')}")
                    return "\n".join(parts)
    except Exception:
        pass
    return (
        "【碳排放检查】尚未连接碳市场账户。\n"
        "钢铁行业已纳入全国碳排放权交易市场，建议按以下动线操作：\n"
        "1. 注册碳账户：登录全国碳排放权交易市场（www.carbonx.cn）→ 企业注册 → 提交营业执照、排污许可证等材料开户\n"
        "2. 月度存证：每月5日前在全国碳市场管理平台提交燃料消耗、低位发热量等关键数据\n"
        "3. 关注配额：留意省级生态环境部门的配额分配通知，年末前完成清缴履约\n"
        "（旧碳排放报送系统已逐步并入全国碳市场管理平台）"
    )


def _knowledge_search(query: str) -> str:
    import os, re
    from pathlib import Path
    kb_dir = Path.home() / ".ecopilot-home" / "knowledge"
    if not kb_dir.exists():
        return f"知识库目录不存在，请先下载法规标准文件到 {kb_dir}"

    # 分词：按空格、中文标点、数字字母边界拆分
    tokens = [t.strip().lower() for t in re.split(r'[\s，。、；：！？\-\+\(\)\[\]【】]+', query) if len(t.strip()) >= 2]
    if not tokens:
        tokens = [query.lower()]

    scored = []  # (score, filename, matched_lines)

    for f in sorted(kb_dir.rglob("*.md")):
        try:
            content = f.read_text(encoding="utf-8")
            content_lower = content.lower()
            filename_lower = f.name.lower()

            # 评分：文件名匹配权重最高 + 内容中每个token命中+1分
            score = 0
            for t in tokens:
                if t in content_lower:
                    score += 1
                if t in filename_lower:
                    score += 3  # 文件名匹配权重高

            if score > 0:
                # 找到匹配最多的那个token，用它定位snippet
                best_token = max(tokens, key=lambda t: content_lower.count(t) if t in content_lower else 0)
                lines = content.split("\n")
                matched_lines = []
                for i, line in enumerate(lines):
                    if best_token in line.lower():
                        start, end = max(0, i-2), min(len(lines), i+3)
                        matched_lines.append("\n".join(lines[start:end]))
                        if len(matched_lines) >= 2:
                            break
                scored.append((score, f.stem, matched_lines or [content[:300]], len(content)))
        except:
            continue

    # 按分数降序，返回前3个最佳匹配
    scored.sort(key=lambda x: -x[0])

    if not scored:
        # 回退：原始精确匹配（兼容旧行为）
        for f in sorted(kb_dir.rglob("*.md")):
            try:
                content = f.read_text(encoding="utf-8")
                if query.lower() in content.lower():
                    lines = content.split("\n")
                    for i, line in enumerate(lines):
                        if query.lower() in line.lower():
                            start, end = max(0, i-2), min(len(lines), i+3)
                            scored.append((1, f.stem, ["\n".join(lines[start:end])], 0))
                            break
                    if scored:
                        break
            except:
                continue

        if not scored:
            return f"知识库中未找到「{query}」相关内容。"

    result_lines = [f"知识库搜索结果（{query}）："]
    for score, stem, snippets, size in scored[:5]:
        result_lines.append(f"\n【{stem}】（匹配度={score}，{size}字）")
        for s in snippets[:2]:
            result_lines.append(s)
    return "\n".join(result_lines)


def _web_search(query: str) -> str:
    """上网搜索，用Tavily AI搜索API"""
    import urllib.request, json as _json
    try:
        API_KEY = os.environ.get("TAVILY_API_KEY", "")
        if not API_KEY:
            return "⚠️ 搜索功能未配置 API Key，请在 .env 中设置 TAVILY_API_KEY"
        data = _json.dumps({
            "api_key": API_KEY,
            "query": query,
            "max_results": 5,
            "include_raw_content": False,
        }).encode()
        req = urllib.request.Request("https://api.tavily.com/search", data=data,
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            results = _json.loads(resp.read())

        lines = [f"网页搜索结果（{query}）："]
        for i, r in enumerate(results.get("results", [])[:5], 1):
            lines.append(f"\n{i}. {r.get('title', '')}")
            lines.append(f"   {r.get('url', '')}")
            lines.append(f"   {r.get('content', '')[:300]}")
        return "\n".join(lines) if len(lines) > 1 else f"未找到「{query}」的搜索结果。"
    except Exception as e:
        return f"网页搜索失败: {e}"


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

    # 读取实际 vault 数据，看是否已上传
    try:
        import json, os
        vault_manifest = os.path.expanduser("~/.ecopilot-home/vault/manifest.json")
        if os.path.exists(vault_manifest):
            files = json.loads(open(vault_manifest).read()).get("files", [])
            # 匹配同类文件
            matching = [f for f in files if f.get("category") == file_type or file_type in f.get("original_name", "")]
            if matching:
                names = "、".join(f["original_name"] for f in matching[:3])
                extra = f"（共 {len(matching)} 份）" if len(matching) > 3 else ""
                return f"档案库中已有【{file_type}】：{names}{extra}。"
            # 查找缺失项
            required_names = [v for k, v in tips.items()]
            uploaded_cats = {f.get("category") for f in files}
            missing = [k for k, v in tips.items() if k not in uploaded_cats]
            if file_type in missing:
                return f"档案库中还缺少【{file_type}】（{desc}）。该文件是法规要求的必备档案。您可以上传到档案库，上传后EcoPilot可以帮您做更全面的合规诊断。"
    except Exception:
        pass

    return f"您可以将【{file_type}】（{desc}）上传到系统档案库中，上传后EcoPilot可以帮您做更全面的合规诊断。"


def _platform_list() -> str:
    platforms = [
        ("全国排污许可证管理信息平台", "permit.mee.gov.cn", "许可证/执行报告/台账"),
        ("重点排污单位自动监控平台", "wryjc.cnemc.cn", "CEMS在线监测"),
        ("全国污染源监测信息管理平台", "wryjc.cnemc.cn", "自行监测数据公开"),
        ("自行监测信息公开", "省级平台，需登录", "监测数据对社会公开（各省公开入口不同）"),
        ("全国碳排放权交易市场", "www.carbonx.cn", "碳配额/履约/月度存证"),
        ("全国固体废物管理信息系统", "gfgl.mee.gov.cn", "固废台账/申报"),
        ("危险废物转移管理", "gfgl.mee.gov.cn", "危废电子联单/跨省转移（固废系统内办理）"),
        ("环境影响评价信用平台", "xypt.china-eia.com", "环评编制/信用"),
        ("建设项目竣工环保验收", "省级平台，需登录", "验收报告公示（全国系统整合中，各省入口不同）"),
        ("环境执法监管", "省级平台，需登录", "整改/处罚记录查询"),
        ("企业环境信用评价", "省级生态环境厅网站", "信用等级/修复"),
        ("排污权交易", "省级排污权交易中心", "排污权交易/租赁（试点省份）"),
        ("清洁生产审核", "省级工信/生态环境部门", "清洁生产审核备案"),
        ("环保税申报系统", "etax.chinatax.gov.cn", "环保税申报"),
    ]
    lines = [f"{i+1}. {n} - {d} ({u})" for i, (n, u, d) in enumerate(platforms)]
    return "企业环保合规涉及的14个政务平台:\n\n" + "\n".join(lines)


# ═══════════════════════════════════════════════════════
# 全模块工具执行器（通过 HTTP 调用 chat_api 自身路由）
# ═══════════════════════════════════════════════════════

async def _call_api(method: str, path: str, body: dict = None) -> str:
    """通用 API 调用辅助（自动获取 token）"""
    try:
        # 获取本地 token
        async with httpx.AsyncClient(base_url=CHAT_API, timeout=5) as c:
            tr = await c.get("/api/auth/token")
            token = tr.json().get("token", "") if tr.status_code == 200 else ""
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        async with httpx.AsyncClient(base_url=CHAT_API, timeout=15) as c:
            if method == "GET":
                r = await c.get(path, headers=headers)
            else:
                r = await c.post(path, json=body or {}, headers=headers)
            if r.status_code == 200:
                data = r.json()
                return json.dumps(data, ensure_ascii=False, indent=2)
            return f"API 错误 ({r.status_code}): {r.text[:200]}"
    except Exception as e:
        return f"调用失败: {e}"


# ── 日历 ──
async def _calendar_task_list(action: str) -> str:
    return await _call_api("POST", "/api/calendar/tasks", {"action": action})

async def _calendar_templates(category: str) -> str:
    return await _call_api("GET", "/api/calendar/templates")

async def _calendar_task_suggest() -> str:
    return await _call_api("POST", "/api/calendar/tasks", {"action": "suggest"})

# ── 档案库 ──
async def _vault_file_list(category: str) -> str:
    path = "/api/vault/list"
    if category:
        path += f"?category={category}"
    return await _call_api("GET", path)

async def _vault_file_detail(id: str) -> str:
    return await _call_api("GET", f"/api/vault/file?id={id}")

# ── 整改 ──
async def _rectification_task_list() -> str:
    return await _call_api("POST", "/api/rectification/tasks", {"action": "list"})

async def _rectification_task_add(title: str, description: str, typ: str, deadline: str) -> str:
    return await _call_api("POST", "/api/rectification/tasks", {
        "action": "add", "task": {
            "title": title, "description": description,
            "type": typ, "deadline": deadline,
        }
    })

# ── 知识库 ──
async def _knowledge_list(category: str) -> str:
    path = "/api/knowledge/list"
    if category:
        path += f"?category={category}"
    return await _call_api("GET", path)

async def _knowledge_read(id: str) -> str:
    return await _call_api("GET", f"/api/knowledge/file?id={id}")

# ── 通讯 ──
async def _notify_platforms() -> str:
    return await _call_api("GET", "/api/notify/platforms")

async def _notify_channels() -> str:
    return await _call_api("GET", "/api/notify/channels")

# ── 企业信息 ──
async def _enterprise_info() -> str:
    return await _call_api("GET", "/api/enterprise")

# ── 许可证面板 ──
async def _permit_dashboard() -> str:
    return await _call_api("GET", "/api/permit/dashboard")
