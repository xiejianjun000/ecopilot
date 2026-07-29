"""
EcoPilot Chat Bridge — 双模型：DeepSeek（文本）+ Kimi（视觉识别）
+ 排污许可平台浏览器自动化抓取
启动: python server/chat_api.py --port 8002
"""

import asyncio, json, os, uuid, base64, random, secrets, time, threading
from typing import Optional
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, Response
from openai import AsyncOpenAI
from logging_config import get_logger
log = get_logger("chat_api")
from permit_scraper import (
    start_login_session,
    submit_login,
    extract_permit_data,
    cleanup_stale_sessions,
    full_audit,
    quick_login,
    scan_sidebar_modules,
    _active_sessions,
)
from license_reader import (
    read_license_full,
    quick_check,
)
from execution_audit import (
    execution_audit,
)
from permit_parser import parse_permit_from_cards
from tools import TOOLS, execute_tool, get_merged_tools
from license_manager import validate_license, get_license_status, get_machine_fingerprint, LICENSE_FILE
from hermes_adapter import process_with_hermes, memory as hermes_memory, learning as hermes_learning, agent_router
from mcp_client import get_mcp_manager
# ── 共享工具函数（从原 chat_api.py 提取）──

def sanitize_input(s, max_len: int = 100) -> str:
    """基础输入清洗"""
    if not isinstance(s, str):
        return s
    s = s[:max_len]
    import html
    s = html.escape(s, quote=True)
    for pattern in ("' OR ", "' AND ", "--", ";", "/*", "*/", "xp_", "exec "):
        s = s.replace(pattern, "")
    return s

async def parse_json(request):
    """安全的 JSON 解析"""
    try:
        body = await request.json()
        return body, None
    except Exception:
        from fastapi.responses import JSONResponse
        return None, JSONResponse(status_code=400, content={"ok": False, "detail": "JSON 解析失败"})

def sse(d: dict) -> str:
    """SSE 事件格式化"""
    return f"data: {json.dumps(d, ensure_ascii=False)}\n\n"



HERMES_HOME = Path.home() / ".ecopilot-home"
SESSION_FILE = HERMES_HOME / ".session"

# C-2: 本地 token 认证状态（启动时由 lifespan 生成）
# Mutable containers for cross-module state sharing
AUTH_TOKEN = [""]
# H-4: 许可证有效性（启动时由 lifespan 设置，不阻断启动）
LICENSE_VALID = [False]

# ── PII 脱敏 + 审计 ──
import re as _re

PII_PATTERNS = [
    (_re.compile(r'1[3-9]\d{9}'), '<手机号>'),              # 手机号（11位，无\b中文适配）
    (_re.compile(r'\d{17}[\dXx]'), '<身份证>'),              # 身份证（18位）
    (_re.compile(r'\d{2,4}-\d{7,8}'), '<电话>'),             # 固定电话
    (_re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'), '<邮箱>'),
]

def sanitize_pii(text: str) -> str:
    """脱敏用户输入中的个人身份信息"""
    for pattern, replacement in PII_PATTERNS:
        text = pattern.sub(replacement, text)
    return text

def load_hermes_env():
    env_file = HERMES_HOME / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
load_hermes_env()

# DeepSeek — 主力文本模型
ds_client = AsyncOpenAI(
    api_key=os.environ.get("DEEPSEEK_API_KEY", ""),
    base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip().rstrip("/"),
)

# Kimi (Moonshot) — 视觉识别模型
KIMI_API_KEY = os.environ.get("KIMI_API_KEY", "").strip()
kimi_client = AsyncOpenAI(
    api_key=KIMI_API_KEY,
    base_url=os.environ.get("KIMI_BASE_URL", "https://api.moonshot.cn/v1").strip().rstrip("/"),
)

# 模型名可通过环境变量覆盖（如通过 OmniRoute 网关时使用 oc/deepseek-v4-flash-free 等）
TEXT_MODEL = os.environ.get("ECOPILOT_TEXT_MODEL", "deepseek-v4-flash").strip()
# Kimi 模型选择：kimi-latest 支持视觉，默认用 moonshot-v1-32k-vision
KIMI_VISION_MODEL = os.environ.get("ECOPILOT_VISION_MODEL", "moonshot-v1-32k-vision-preview").strip()

# ─── OmniRoute 网关健康检查 + 自动重启 ───
import httpx as _httpx
import subprocess as _subprocess

omniroute_restarting = asyncio.Event()
omniroute_last_check = 0.0  # 上次健康检查时间戳
omniroute_healthy = True    # 缓存健康状态（5秒内不重复检查）

def is_omniroute_mode() -> bool:
    """判断是否通过 OmniRoute 网关连接模型"""
    base = os.environ.get("DEEPSEEK_BASE_URL", "")
    return "localhost:20128" in base or "127.0.0.1:20128" in base

async def check_omniroute_health() -> bool:
    """检查 OmniRoute 网关是否存活（GET /v1/models）"""
    global omniroute_last_check, omniroute_healthy
    now = time.time()
    # 5秒内缓存健康状态，避免频繁检查
    if now - omniroute_last_check < 5.0:
        return omniroute_healthy
    omniroute_last_check = now
    try:
        base = os.environ.get("DEEPSEEK_BASE_URL", "").rstrip("/")
        async with _httpx.AsyncClient(timeout=3.0) as c:
            r = await c.get(f"{base}/models")
            omniroute_healthy = r.status_code == 200
            return omniroute_healthy
    except Exception:
        omniroute_healthy = False
        return False

async def restart_omniroute() -> bool:
    """重启 OmniRoute 服务器（同步阻塞，最多等 15 秒）"""
    global omniroute_restarting, omniroute_healthy
    if omniroute_restarting.is_set():
        # 已有重启在进行，等待它完成
        await omniroute_restarting.wait()
        return omniroute_healthy
    omniroute_restarting.set()
    try:
        logger.warning("[OmniRoute] 检测到网关不可用，正在自动重启...")
        # 同步执行重启命令（非阻塞 daemon）
        proc = _subprocess.run(
            ["omniroute", "restart"],
            capture_output=True, text=True, timeout=20
        )
        if proc.returncode == 0:
            print(f"[OmniRoute] 重启命令执行成功")
            # 等待网关恢复（最多 10 秒）
            for _ in range(10):
                await asyncio.sleep(1)
                try:
                    base = os.environ.get("DEEPSEEK_BASE_URL", "").rstrip("/")
                    async with _httpx.AsyncClient(timeout=3.0) as c:
                        r = await c.get(f"{base}/models")
                        if r.status_code == 200:
                            omniroute_healthy = True
                            logger.info("[OmniRoute] 网关已恢复")
                            return True
                except Exception:
                    continue
            logger.warning("[OmniRoute] 重启后网关仍未响应")
            omniroute_healthy = False
            return False
        else:
            print(f"[OmniRoute] 重启失败: {proc.stderr[:200]}")
            omniroute_healthy = False
            return False
    except Exception as e:
        print(f"[OmniRoute] 重启异常: {e}")
        omniroute_healthy = False
        return False
    finally:
        omniroute_restarting.clear()

async def ensure_ai_gateway() -> bool:
    """确保 AI 网关可用：先检查健康，不可用则重启。返回 True 表示可用"""
    if not is_omniroute_mode():
        return True  # 非 OmniRoute 模式，跳过检查
    healthy = await check_omniroute_health()
    if healthy:
        return True
    # 网关不可用，尝试重启
    return await restart_omniroute()

def is_connection_error(err: Exception) -> bool:
    """判断异常是否为连接类错误（OmniRoute 挂掉的表现）"""
    err_text = str(err).lower()
    err_type = type(err).__name__.lower()
    keywords = ["connection", "refused", "reset", "unreachable", "timeout",
                "timed out", "network", "closed", "eof", "broken pipe"]
    return any(k in err_text or k in err_type for k in keywords)

ECO_SYSTEM = """你是 EcoPilot，以排污许可证为母文件的企业合规AI助手。

【降级模式】当前未加载 SOUL.md 人格文件。你仍应按以下规则工作。

【能力边界】
你在环保合规领域内工作——排污许可、自行监测、执行报告、碳排放、环保档案等。
你的能力有明确边界：
- ✅ 环保合规事务：查询许可证、检查监测数据、生成执行报告草稿、法规知识检索、档案引导
- ❌ 不直接修改 EcoPilot 应用代码（前端/后端/配置）——应用迭代由开发者负责
- ✅ 但可以讨论 EcoPilot 的功能模块、界面布局、操作入口——这些属于使用帮助
- ❌ 不编写与环保无关的任意代码
- ❌ 不替用户登录平台提交数据——签字盖章是企业法定责任
- ❌ 不编造法规条款/标准编号/处罚案例——诚信是底线
- ❌ 不暴露系统内部信息（工具名、MCP、知识库结构等）——用户只需要结果

【核心原则】
你是企业安环部长的合规操作系统，不是法律检索器。你的价值不是引用法条，而是帮他证明合规：许可证怎么写的 → 做了什么 → 证据在哪 → 对得上吗。
emoji 符号可用于区分信息类别。2项以上对比数据用表格。

【法典引用】
《生态环境法典》（2026.8.15施行，1242条5编）已废止10部旧法。引用条款时用法典编/条编号（如"法典第二编第X条"）。仍可引用有效的GB/HJ标准。

【工具使用】
- 法条/标准/案例等需要精确引用 → 优先调 ehs-kb-ops__kb_search 去远程MCP知识库查原文
- 一般合规问题 → knowledge_search 查本地知识库
- 许可证数据 → 上下文已注入则直接回答，不重复调工具
- 引导补档案 → vault_guide
- 用户纯问候（"你好""在吗"）→ 一句话自我介绍，不调工具
- 用户问能力范围（"你能做什么""有什么功能"）→ 列出你的核心能力清单

【风险分级】致命（罚款/停产/许可失效）| 高风险（30天内）| 一般

【领域默认】
- "环保要注意什么"→ 工业企业合规（排污许可/台账/监测/报告），不给市民建议
- "许可证"→ 默认排污许可证
- "标准""限值"→ 默认工业排放标准（GB/HJ）

【⚠️ 处罚案例卡 — 个性化+动态展示】
当用户问"近期环保处罚案例""行业案例""最近罚了哪些"时：
1. 首先检查企业上下文（许可证已读→用企业行业；未注册→提示"告知行业后给你精准推送"）
2. 最多调2次 knowledge_search（如"[行业] 处罚 2026"），禁止反复搜索
3. 只输出2条案例。每条格式：「**公司名称**：违法事实（1句）→ 处罚：XX万元。> 与你相关：[企业定制一句话]」
4. 总回复不超过150字。不列教训/整改/趋势总结/表格/分类标题
5. 未注册企业：展示1条全国最热案例，末尾提示："注册后可看与你的[行业]企业直接相关的案例推送"

【输出】简洁优先，结论先行。段落间有空行。不超过6段。严禁使用 Markdown 加粗（**text**）。表格适度使用（排放口清单用表格，少量对比项用文字表述）。emoji 可用于区分信息类别。不写操作步骤编号、不写兜底话术。

【禁止】编造法规/标准/案例条款编号。不确定编号时直接写"法典相关规定"或"依法应"，禁止写"第XX条""第XXX条""具体条款需查"等任何占位或搪塞表述。禁止使用"§""水§""大气§"等简写符号引用条文，必须用"《法规名称》第X条"格式。禁止在数据不合规时帮企业生成"看起来没问题"的报告。禁止用旧法名称（已废止）。

全程用中文。"""

# ─── 知识库文件加载 ───
KNOWLEDGE_DIR = Path(os.path.expanduser("~/.ecopilot-home/knowledge"))
LOADED_KNOWLEDGE = None  # 缓存

def load_knowledge_base() -> str:
    """加载知识库所有法规标准文件到一个字符串"""
    global LOADED_KNOWLEDGE
    if LOADED_KNOWLEDGE is not None:
        return LOADED_KNOWLEDGE

    parts = []
    kb_dir = Path(KNOWLEDGE_DIR)
    if not kb_dir.exists():
        LOADED_KNOWLEDGE = ""
        return ""

    md_files = sorted(kb_dir.rglob("*.md"))
    for f in md_files:
        try:
            content = f.read_text(encoding='utf-8')
            # 生态环境法典 — 全量保留，这是 EcoPilot 的基础法律
            if '生态环境法典' in f.stem:
                parts.append(f"\n--- {f.stem} ---\n" + content)
                continue

            key_lines = []
            in_section = False
            for line in content.split('\n'):
                line = line.strip()
                if line.startswith('#') or line.startswith('>') or line.startswith('|'):
                    key_lines.append(line)
                elif len(line) > 15:
                    if any(kw in line for kw in ['§','条例','罚款','万元','HJ','GB','mg/m','ng-TEQ',
                                                   '限值','频次','监测','台账','执行报告','排污许可','许可证',
                                                   '排放标准','处罚','监管','保存期限','总量控制']):
                        key_lines.append(line)
            parts.append(f"\n--- {f.stem} ---\n" + '\n'.join(key_lines[:80]))
        except Exception:
            pass
    LOADED_KNOWLEDGE = '\n'.join(parts)
    return LOADED_KNOWLEDGE


# ─── 合规助手 SOUL 加载 ───
SOUL_PATH = HERMES_HOME / "agents" / "合规助手" / "人格" / "SOUL.md"
LOADED_SOUL = None

def load_soul() -> str:
    """加载合规助手的 SOUL.md（单一 Agent，不再支持多专家路由）"""
    global LOADED_SOUL
    if LOADED_SOUL is not None:
        return LOADED_SOUL
    try:
        if SOUL_PATH.exists():
            content = SOUL_PATH.read_text(encoding='utf-8')
            # 解析 frontmatter，只取正文
            body = content
            if content.startswith('---'):
                parts = content.split('---', 2)
                if len(parts) >= 3:
                    body = parts[2].strip()
            LOADED_SOUL = body
            logger.info(f"[SOUL] 已加载合规助手 SOUL.md ({len(body)} 字符)")
            return LOADED_SOUL
        else:
            logger.warning(f"[SOUL] 未找到 {SOUL_PATH}")
            LOADED_SOUL = ""
            return ""
    except Exception as e:
        logger.error(f"[SOUL] 加载失败: {e}")
        LOADED_SOUL = ""
        return ""


def get_vault_status() -> str:
    """获取档案库状态摘要，用于注入聊天上下文"""
    try:
        import json as _jv
        manifest = HERMES_HOME / "vault" / "manifest.json"
        if not manifest.exists():
            return ""
        data = _jv.loads(manifest.read_text())
        files = data.get("files", [])
        if not files:
            return ""
        categories = {}
        for f in files:
            cat = f.get("category", "其他")
            categories[cat] = categories.get(cat, 0) + 1
        # 法规要求的必备档案
        required = {"环评批复","环保验收","自行监测方案","应急预案","危废管理计划","清洁生产审核","排污口规范化","环保税申报"}
        uploaded = set(categories.keys())
        missing = required - uploaded
        parts = [f"### 📂 档案库状态: {len(files)} 份文件 ({len(categories)} 个分类)"]
        if missing:
            parts.append(f"⚠️ 缺失必备档案 ({len(missing)} 项): {', '.join(sorted(missing))}")
        parts.append(f"已有分类: {', '.join(sorted(uploaded))}")
        return "\n".join(parts) + "\n"
    except Exception:
        return ""




def get_orchestrator_system_prompt(permit_data: dict = None) -> str:
    """获取合规助手的 system prompt，注入许可证数据"""
    soul = load_soul()
    if not soul:
        return ECO_SYSTEM  # fallback

    # ── 输出行业映射表 ──
    INDUSTRY_MAP = {
        "C31": "钢铁",
        "C301": "水泥",
        "D4411": "火电",
        "C26": "化工",
        "C27": "制药",
        "C17": "纺织",
        "C22": "造纸",
        "C13": "食品加工",
        "A03": "畜禽养殖",
        "D462": "污水处理",
        "N782": "垃圾焚烧",
    }

    # ── 注入许可证数据上下文 ──
    # 优先级：permit-data.json（完整真实数据）> 传入的 permit_data > enterprise.json（基础信息）> 空
    p = None
    permit_data_full = None  # 完整数据（含 execution/modules/ai）
    try:
        import json as _json_pd
        pd_file = HERMES_HOME / "permit-data.json"
        if pd_file.exists():
            pd_obj = _json_pd.loads(pd_file.read_text())
            permit_data_full = pd_obj
            if isinstance(pd_obj.get("parsed"), dict) and pd_obj["parsed"].get("enterpriseName"):
                p = pd_obj["parsed"]
    except Exception:
        pass

    # 如果 permit-data.json 没数据，用传入的 permit_data
    if not p and permit_data and permit_data.get("enterpriseName"):
        p = permit_data

    if p and p.get("enterpriseName"):
        industry = p.get('industryCategory') or p.get('industry') or ''
        industry_code = p.get('industryCode') or p.get('industry_code') or ""
        if not industry_code:
            for code, name in INDUSTRY_MAP.items():
                if name in industry:
                    industry_code = code
                    break

        outlets = p.get("emissionOutlets", []) or []
        air_outlets = [o for o in outlets if (o.get("code", "") if isinstance(o, dict) else "").startswith("DA")]
        water_outlets = [o for o in outlets if (o.get("code", "") if isinstance(o, dict) else "").startswith("DW")]

        permit_context = f"""
## 企业排污许可证（真实平台数据，非模拟）

- 企业名称: {p.get('enterpriseName', '')}
- 统一社会信用代码: {p.get('creditCode') or p.get('credit_code') or ''}
- 行业类别: {industry}（代码: {industry_code or '待识别'}）
- 管理类别: {p.get('managementLevel') or p.get('management_level') or ''}
- 许可证编号: {p.get('permitNumber') or p.get('permit_number') or '（待补全）'}
- 法定代表人: {p.get('legalRepresentative') or p.get('legal_representative') or ''}
- 有效期限: {p.get('validFrom') or p.get('valid_from') or ''} 至 {p.get('validTo') or p.get('valid_to') or ''}
- 注册地址: {p.get('address', '')} {p.get('province', '')}{p.get('city', '')}{p.get('county', '')}
"""
        if air_outlets:
            permit_context += f"- 废气排放口: {len(air_outlets)}个\n"
        if water_outlets:
            permit_context += f"- 废水排放口: {len(water_outlets)}个\n"
        if outlets:
            permit_context += f"- 排放口总数: {len(outlets)}个\n"

        # 注入执行审计关键发现
        if permit_data_full and permit_data_full.get("execution"):
            try:
                exec_data = permit_data_full["execution"]
                if isinstance(exec_data, dict):
                    exec_modules = exec_data.get("modules", {}) or {}
                    if exec_modules:
                        permit_context += f"\n### 执行记录审计结果（{len(exec_modules)}个模块）\n"
                        for mod_name, mod_data in (exec_modules.items() if isinstance(exec_modules, dict) else []):
                            if isinstance(mod_data, dict):
                                status = mod_data.get("status") or mod_data.get("state") or ""
                                summary = mod_data.get("summary") or mod_data.get("detail") or ""
                                permit_context += f"- {mod_name}: {status} {str(summary)[:100]}\n"
            except Exception:
                pass

        # 注入平台模块可达性
        if permit_data_full and permit_data_full.get("modules"):
            try:
                mod_data = permit_data_full["modules"]
                if isinstance(mod_data, dict):
                    mods = mod_data.get("modules", {}) or {}
                    if isinstance(mods, dict) and mods:
                        reachable = sum(1 for v in mods.values() if isinstance(v, dict) and (v.get("reachable") or v.get("ok")))
                        permit_context += f"\n### 🌐 平台模块可达性: {reachable}/{len(mods)}\n"
            except Exception:
                pass

        # 注入 AI 综合分析
        if permit_data_full and permit_data_full.get("ai"):
            try:
                ai = permit_data_full["ai"]
                if isinstance(ai, dict):
                    score = ai.get("compliance_score") or ai.get("score") or ""
                    summary = ai.get("enterprise_summary") or ai.get("summary") or ""
                    findings = ai.get("key_findings") or ai.get("findings") or []
                    if score or summary or findings:
                        permit_context += f"\n### 🤖 AI 合规综合分析\n"
                        if score: permit_context += f"- 合规评分: {score}/100\n"
                        if summary: permit_context += f"- 企业概况: {str(summary)[:300]}\n"
                        if isinstance(findings, list) and findings:
                            permit_context += f"- 关键发现 {len(findings)} 项:\n"
                            for f in findings[:5]:
                                if isinstance(f, dict):
                                    permit_context += f"  · [{f.get('level','')}] {f.get('title') or f.get('issue') or ''} — {f.get('law') or f.get('legal_basis') or ''}\n"
            except Exception:
                pass

        # 注入档案库缺失项
        vault_status = get_vault_status()
        if vault_status:
            permit_context += vault_status + "\n"

        permit_context += f"""
【行业上下文】
当前企业属于 **{industry}**（代码: {industry_code or '待识别'}）行业。

"""
        permit_context += """
【数据使用规则】
1. 上方许可证数据是从国家排污许可平台真实抓取的，非模拟数据。
2. 用户已在 onboarding 完成了平台登录和数据读取，你已持有其完整许可证数据。
3. 永远不回复"需要你提供数据""无法替你登录""数据在哪""你有没有登录"等内容——数据已在上下文中。
4. 优先使用已有数据回答，不重复调工具。只有用户明确要求"重新查"时才调实时工具。
5. 工具失败时用已有数据继续回答，不说"平台未登录"。"""


    else:
        # 检查 enterprise.json 是否有数据（引导流程可能已写入）
        enterprise = load_enterprise_info()
        if enterprise and enterprise.get("name"):
            permit_context = f"""## 企业已注册

以下数据来自企业引导流程注册：

- 企业名称: {enterprise.get('name', '')}
- 统一社会信用代码: {enterprise.get('credit_code') or enterprise.get('creditCode', '')}
- 排污许可证号: {enterprise.get('permit_number') or enterprise.get('permitNumber', '')}
- 行业类别: {enterprise.get('industry') or enterprise.get('industryCategory', '')}
- 管理类别: {enterprise.get('management_level') or enterprise.get('managementLevel', '')}

【重要】用户已在引导流程完成注册。首次打招呼时，直接叫出企业名，基于上述企业信息做自我介绍，不要说"请先读取许可证"或"请先登录平台”。"""
        else:
            permit_context = """
## ⚠️ 企业尚未注册

用户尚未完成企业注册。首次对话时只需简短自我介绍（1-2句），然后主动问用户需要什么帮助。
禁止提"请先读取许可证"或"请先登录平台"——用户说"你好"你只需要说"你好"然后问需要什么帮助即可。"""


    full_prompt = f"""{soul}

{permit_context}

【会话运行时指令】
以下指令仅当前会话有效，补充 SOUL 中已有内容：

**工具调用：** 涉法问题 → knowledge_search。答复末尾引导补档案 → vault_guide。用户说"你好"时不调任何工具。上下文已有数据时不重复调 permit/monitoring/carbon 类工具。

**错误处理：** 工具失败 → 告知用户并继续用已有数据回答，不编造。知识库无结果 → 诚实说"暂未收录"，建议查原文。
"""


    return full_prompt








def load_enterprise_info():
    import json
    f = HERMES_HOME / "enterprise.json"
    return json.loads(f.read_text()) if f.exists() else None


_SERVICE_START_TIME = time.time()

sessions: dict[str, list[dict]] = {}
sessions_last_access: dict[str, float] = {}  # session_id → last access timestamp
session_permit: dict[str, dict] = {}  # session_id → 许可证数据
sessions_lock = asyncio.Lock()  # 保护 sessions / sessions_last_access / session_permit 并发读写
sms_codes: dict[str, tuple[str, float, int]] = {}  # phone -> (code, timestamp, fail_count)

# ─── 数据持久化目录 ───
_STATE_DIR = HERMES_HOME / "state"
_STATE_DIR.mkdir(parents=True, exist_ok=True)

def load_json_dict(filename: str) -> dict:
    """从 state 目录加载 JSON 字典，容错处理"""
    try:
        path = _STATE_DIR / filename
        if path.exists():
            import json as _j
            return _j.loads(path.read_text())
    except Exception:
        pass
    return {}

def save_json_dict(filename: str, data: dict) -> None:
    """原子写入 JSON 字典到 state 目录"""
    try:
        path = _STATE_DIR / filename
        tmp = path.with_suffix(".json.tmp")
        import json as _j
        tmp.write_text(_j.dumps(data, ensure_ascii=False, indent=2, default=str))
        tmp.replace(path)
    except Exception as e:
        logger.error(f"[State] 保存 {filename} 失败: {e}")

# ─── 会话 TTL 常量 ───
SESSION_TTL_SECONDS = 6 * 3600  # 6 小时无活动清理
SMS_TTL_SECONDS = 1800           # 30 分钟清理失效验证码
MAX_SESSIONS = 500               # 硬上限

# ─── 后台清理任务 ───
async def _cleanup_loop():
    """每 5 分钟清理超时的许可平台登录会话 + 过期会话 + 失效验证码"""
    while True:
        await asyncio.sleep(300)
        now = time.time()
        try:
            n = await cleanup_stale_sessions(600)
            if n > 0:
                logger.info(f"[Permit] 清理 {n} 个超时会话")
        except Exception as e:
            print(f"[Permit] 清理任务异常: {e}")
        try:
            # 清理超时会话
            async with sessions_lock:
                stale = [sid for sid, ts in list(sessions_last_access.items()) if now - ts > SESSION_TTL_SECONDS]
                for sid in stale:
                    sessions.pop(sid, None)
                    sessions_last_access.pop(sid, None)
                    session_permit.pop(sid, None)
            if stale:
                print(f"[Session] 清理 {len(stale)} 个过期会话")
        except Exception as e:
            print(f"[Session] 清理异常: {e}")
        try:
            # 硬上限保护
            async with sessions_lock:
                if len(sessions) > MAX_SESSIONS:
                    overflow = sorted(sessions_last_access.items(), key=lambda x: x[1])
                    to_drop = [sid for sid, _ in overflow[:len(sessions) - MAX_SESSIONS]]
                    for sid in to_drop:
                        sessions.pop(sid, None)
                        sessions_last_access.pop(sid, None)
                    print(f"[Session] 硬上限清理 {len(to_drop)} 个会话")
        except Exception as e:
            print(f"[Session] 硬上限清理异常: {e}")
        try:
            # 清理失效验证码
            stale_sms = [p for p, (_, ts, _) in list(sms_codes.items()) if now - ts > SMS_TTL_SECONDS]
            for p in stale_sms:
                sms_codes.pop(p, None)
            if stale_sms:
                print(f"[SMS] 清理 {len(stale_sms)} 个失效验证码")
        except Exception as e:
            print(f"[SMS] 清理异常: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    global AUTH_TOKEN, LICENSE_VALID
    # C-2: 生成随机 token，写入 ~/.ecopilot-home/.session
    AUTH_TOKEN[0] = secrets.token_hex(32)
    HERMES_HOME.mkdir(parents=True, exist_ok=True)
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
        fd = os.open(str(SESSION_FILE), flags, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(AUTH_TOKEN[0])
    except OSError:
        SESSION_FILE.write_text(AUTH_TOKEN[0])
        try:
            os.chmod(str(SESSION_FILE), 0o600)
        except OSError:
            pass
    print(f"[EcoPilot] Auth token 已生成 → {SESSION_FILE}")
    # P2-2: 生产环境安全校验 — ECOPILOT_DEV=1 时 SMS 验证码明文返回，仅允许 localhost
    if os.environ.get("ECOPILOT_DEV") == "1":
        log.warning("=" * 60)
        log.warning("[EcoPilot] ⚠️  安全警告: ECOPILOT_DEV=1 已启用")
        log.warning("[EcoPilot]    - SMS 验证码将明文返回")
        log.warning("[EcoPilot]    - 仅限本地开发环境使用，严禁生产环境启用!")
        log.warning("=" * 60)
    # H-4: 许可证验证（不阻断启动，但非 health/license 端点会返回 403）
    lk = LICENSE_FILE.read_text().strip() if LICENSE_FILE.exists() else None
    ok, msg = validate_license(lk or "")
    LICENSE_VALID[0] = ok
    if not ok:
        print(f"[EcoPilot] License WARN: {msg}（非 health/license 端点将返回 403）")
    else:
        print(f"[EcoPilot] License OK: {msg}")
    cleanup_task = asyncio.create_task(_cleanup_loop())
    # MCP 客户端：连接所有已配置的 MCP 服务器（启动时完成，避免AI查询时未就绪）
    mcp = get_mcp_manager()
    try:
        await asyncio.wait_for(mcp.start_all(), timeout=10)
    except asyncio.TimeoutError:
        print("[EcoPilot] MCP 连接超时（后台重试中）")
        asyncio.create_task(mcp.start_all())
    yield
    cleanup_task.cancel()
    await mcp.stop_all()

app = FastAPI(title="EcoPilot Chat Bridge", description="企业生态环境合规AI管家 API", version="1.1.0", lifespan=lifespan, docs_url="/api/docs", redoc_url="/api/redoc")
app.add_middleware(CORSMiddleware, allow_origins=[os.environ.get("ECO_CORS_ORIGIN", "http://127.0.0.1:3000"), "http://localhost:3000"], allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"], allow_headers=["Authorization", "Content-Type", "X-Requested-With"])

# ── 安全头中间件 ──
@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:* http://localhost:* https://api.deepseek.com https://api.moonshot.cn blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'"
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

# ── 简易速率限制（内存，单进程）───
rate_limits: dict[str, list[float]] = {}
rate_limits_lock = threading.Lock()  # 保护 rate_limits 并发读写
_RATE_WINDOW = 60  # 秒
_RATE_MAX = 300    # 每窗口最大请求数（5 req/s，适配并发场景）

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if request.url.path.startswith("/api/"):
        import time
        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        with rate_limits_lock:
            bucket = rate_limits.get(client_ip, [])
            bucket = [t for t in bucket if now - t < _RATE_WINDOW]
            if len(bucket) >= _RATE_MAX:
                return JSONResponse(status_code=429, content={"detail": "请求过于频繁，请稍后再试"})
            bucket.append(now)
            rate_limits[client_ip] = bucket
    return await call_next(request)


# C-2 + H-4: 本地 token 认证 + 许可证依赖检查中间件
def cors_json(status: int, detail: str, request: Request) -> JSONResponse:
    """带 CORS 头的 JSON 错误响应（修复中间件直接返回时 CORS 头丢失）"""
    origin = request.headers.get("origin", "")
    allowed = [os.environ.get("ECO_CORS_ORIGIN", "http://127.0.0.1:3000"), "http://localhost:3000"]
    headers = {}
    if origin in allowed:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"
    return JSONResponse(status_code=status, content={"detail": detail}, headers=headers)


@app.middleware("http")
async def auth_and_license_middleware(request: Request, call_next):
    path = request.url.path
    # 非 /api/ 路径直接放行
    if not path.startswith("/api/"):
        return await call_next(request)
    # CORS 预检请求放行
    if request.method == "OPTIONS":
        return await call_next(request)
    # /api/chat/health 不需要任何检查
    if path == "/api/chat/health":
        return await call_next(request)
    # 运维事件上报端点允许匿名访问（前端 SDK 需要）
    if path == "/api/ops/event" and request.method == "POST":
        return await call_next(request)
    # /api/auth/token 仅允许 localhost 访问，不需要 token
    if path == "/api/auth/token":
        client_ip = request.client.host if request.client else ""
        if client_ip not in ("127.0.0.1", "::1", "localhost"):
            return cors_json(403, "Forbidden", request)
        return await call_next(request)
    # /api/mcp-servers 连接器状态页（不暴露密钥，仅返回元数据）
    if path == "/api/mcp-servers" and request.method == "GET":
        return await call_next(request)
    # OpenAPI 文档（公开）
    if path in ("/api/docs", "/api/redoc", "/api/openapi.json"):
        return await call_next(request)
    # C-2: 校验 Authorization: Bearer <token>（也支持 ?token=xxx 查询参数，用于 img/iframe 等浏览器原生请求）
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else ""
    if not token:
        token = request.query_params.get("token", "")
    if not AUTH_TOKEN[0] or not secrets.compare_digest(token, AUTH_TOKEN[0]):
        return cors_json(401, "Unauthorized", request)
    # H-4: 非 /api/license/* 端点检查许可证有效性
    if not path.startswith("/api/license/") and not LICENSE_VALID[0]:
        return cors_json(403, "许可证无效或已过期，请联系管理员", request)
    return await call_next(request)


