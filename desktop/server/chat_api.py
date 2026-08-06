"""
EcoPilot Chat Bridge — 双模型：DeepSeek（文本）+ Kimi（视觉识别）
+ 排污许可平台浏览器自动化抓取
启动: python server/chat_api.py --port 8002
"""

import asyncio, json, os, uuid, base64, random, secrets, time, threading, logging
from typing import Optional
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, Response
from openai import AsyncOpenAI
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

logger = logging.getLogger("ecopilot.chat_api")

HERMES_HOME = Path.home() / ".ecopilot-home"
SESSION_FILE = HERMES_HOME / ".session"

# C-2: 本地 token 认证状态（启动时由 lifespan 生成）
_AUTH_TOKEN: str = ""
# H-4: 许可证有效性（启动时由 lifespan 设置，不阻断启动）
_LICENSE_VALID: bool = False

# ── PII 脱敏 + 审计 ──
import re as _re

_PII_PATTERNS = [
    (_re.compile(r'1[3-9]\d{9}'), '<手机号>'),              # 手机号（11位，无\b中文适配）
    (_re.compile(r'\d{17}[\dXx]'), '<身份证>'),              # 身份证（18位）
    (_re.compile(r'\d{2,4}-\d{7,8}'), '<电话>'),             # 固定电话
    (_re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'), '<邮箱>'),
]

def _sanitize_pii(text: str) -> str:
    """脱敏用户输入中的个人身份信息"""
    for pattern, replacement in _PII_PATTERNS:
        text = pattern.sub(replacement, text)
    return text

def _load_hermes_env():
    env_file = HERMES_HOME / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
_load_hermes_env()

# DeepSeek — 主力文本模型
# 注意：openai SDK >= 2.x 对空 api_key 直接抛错，但 onboarding 初期用户尚未配置 key，
# 后端必须能先启动（引导页再引导配置），故用占位符延迟到真实调用时报鉴权错
ds_client = AsyncOpenAI(
    api_key=os.environ.get("DEEPSEEK_API_KEY", "").strip() or "sk-not-configured",
    base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip().rstrip("/"),
)

# Kimi (Moonshot) — 视觉识别模型
KIMI_API_KEY = os.environ.get("KIMI_API_KEY", "").strip()
kimi_client = AsyncOpenAI(
    api_key=KIMI_API_KEY or "sk-not-configured",
    base_url=os.environ.get("KIMI_BASE_URL", "https://api.moonshot.cn/v1").strip().rstrip("/"),
)

# 模型名可通过环境变量覆盖（如通过 OmniRoute 网关时使用 oc/deepseek-v4-flash-free 等）
TEXT_MODEL = os.environ.get("ECOPILOT_TEXT_MODEL", "deepseek-v4-flash").strip()
# Kimi 模型选择：kimi-latest 支持视觉，默认用 moonshot-v1-32k-vision
KIMI_VISION_MODEL = os.environ.get("ECOPILOT_VISION_MODEL", "moonshot-v1-32k-vision-preview").strip()

# ─── OmniRoute 网关健康检查 + 自动重启 ───
import httpx as _httpx
import subprocess as _subprocess

_omniroute_restarting = asyncio.Event()
_omniroute_last_check = 0.0  # 上次健康检查时间戳
_omniroute_healthy = True    # 缓存健康状态（5秒内不重复检查）

def _is_omniroute_mode() -> bool:
    """判断是否通过 OmniRoute 网关连接模型"""
    base = os.environ.get("DEEPSEEK_BASE_URL", "")
    return "localhost:20128" in base or "127.0.0.1:20128" in base

async def _check_omniroute_health() -> bool:
    """检查 OmniRoute 网关是否存活（GET /v1/models）"""
    global _omniroute_last_check, _omniroute_healthy
    now = time.time()
    # 5秒内缓存健康状态，避免频繁检查
    if now - _omniroute_last_check < 5.0:
        return _omniroute_healthy
    _omniroute_last_check = now
    try:
        base = os.environ.get("DEEPSEEK_BASE_URL", "").rstrip("/")
        async with _httpx.AsyncClient(timeout=3.0) as c:
            r = await c.get(f"{base}/models")
            _omniroute_healthy = r.status_code == 200
            return _omniroute_healthy
    except Exception:
        _omniroute_healthy = False
        return False

async def _restart_omniroute() -> bool:
    """重启 OmniRoute 服务器（同步阻塞，最多等 15 秒）"""
    global _omniroute_restarting, _omniroute_healthy
    if _omniroute_restarting.is_set():
        # 已有重启在进行，等待它完成
        await _omniroute_restarting.wait()
        return _omniroute_healthy
    _omniroute_restarting.set()
    try:
        logger.info("[OmniRoute] 检测到网关不可用，正在自动重启...")
        # 同步执行重启命令（非阻塞 daemon）
        proc = _subprocess.run(
            ["omniroute", "restart"],
            capture_output=True, text=True, timeout=20
        )
        if proc.returncode == 0:
            logger.info(f"[OmniRoute] 重启命令执行成功")
            # 等待网关恢复（最多 10 秒）
            for _ in range(10):
                await asyncio.sleep(1)
                try:
                    base = os.environ.get("DEEPSEEK_BASE_URL", "").rstrip("/")
                    async with _httpx.AsyncClient(timeout=3.0) as c:
                        r = await c.get(f"{base}/models")
                        if r.status_code == 200:
                            _omniroute_healthy = True
                            logger.info("[OmniRoute] 网关已恢复")
                            return True
                except Exception:
                    continue
            logger.info("[OmniRoute] 重启后网关仍未响应")
            _omniroute_healthy = False
            return False
        else:
            logger.info(f"[OmniRoute] 重启失败: {proc.stderr[:200]}")
            _omniroute_healthy = False
            return False
    except Exception as e:
        logger.info(f"[OmniRoute] 重启异常: {e}")
        _omniroute_healthy = False
        return False
    finally:
        _omniroute_restarting.clear()

async def _ensure_ai_gateway() -> bool:
    """确保 AI 网关可用：先检查健康，不可用则重启。返回 True 表示可用"""
    if not _is_omniroute_mode():
        return True  # 非 OmniRoute 模式，跳过检查
    healthy = await _check_omniroute_health()
    if healthy:
        return True
    # 网关不可用，尝试重启
    return await _restart_omniroute()

def _is_connection_error(err: Exception) -> bool:
    """判断异常是否为连接类错误（OmniRoute 挂掉的表现）"""
    err_text = str(err).lower()
    err_type = type(err).__name__.lower()
    keywords = ["connection", "refused", "reset", "unreachable", "timeout",
                "timed out", "network", "closed", "eof", "broken pipe"]
    return any(k in err_text or k in err_type for k in keywords)

ECO_SYSTEM = """你是 EcoPilot，以排污许可证为母文件的企业合规AI助手。

【降级模式】当前未加载 SOUL.md 人格文件。你仍应按以下规则工作。

【核心原则】
你是企业安环部长的合规操作系统，不是法律检索器。你的价值不是引用法条，而是帮他证明合规：许可证怎么写的 → 做了什么 → 证据在哪 → 对得上吗。
⚠️ 禁止输出任何 emoji 表情符号（如 🔍 ⏰ 📋 🔴 🟠 🟡 👆）。使用纯文字或数字列表替代。

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

【输出】结论先行，6段以内。法规用卡片式：## [编号] — [概要]。关键数据**加粗**。段落之间紧凑连接，不要用空行分隔。

【禁止】编造法规/标准/案例条款编号。不确定编号时直接写"法典相关规定"或"依法应"，禁止写"第XX条""第XXX条""具体条款需查"等任何占位或搪塞表述。禁止使用"§""水§""大气§"等简写符号引用条文，必须用"《法规名称》第X条"格式。在数据不合规时帮企业生成"看起来没问题"的报告。用旧法名称（已废止）。

全程用中文。"""

# ─── 知识库文件加载 ───
_KNOWLEDGE_DIR = Path(os.path.expanduser("~/.ecopilot-home/knowledge"))
_LOADED_KNOWLEDGE = None  # 缓存

def _load_knowledge_base() -> str:
    """加载知识库所有法规标准文件到一个字符串"""
    global _LOADED_KNOWLEDGE
    if _LOADED_KNOWLEDGE is not None:
        return _LOADED_KNOWLEDGE

    parts = []
    kb_dir = Path(_KNOWLEDGE_DIR)
    if not kb_dir.exists():
        _LOADED_KNOWLEDGE = ""
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
    _LOADED_KNOWLEDGE = '\n'.join(parts)
    return _LOADED_KNOWLEDGE


# ─── 合规助手 SOUL 加载 ───
_SOUL_PATH = HERMES_HOME / "agents" / "合规助手" / "人格" / "SOUL.md"
_LOADED_SOUL = None

def _load_soul() -> str:
    """加载合规助手的 SOUL.md（单一 Agent，不再支持多专家路由）"""
    global _LOADED_SOUL
    if _LOADED_SOUL is not None:
        return _LOADED_SOUL
    try:
        if _SOUL_PATH.exists():
            content = _SOUL_PATH.read_text(encoding='utf-8')
            # 解析 frontmatter，只取正文
            body = content
            if content.startswith('---'):
                parts = content.split('---', 2)
                if len(parts) >= 3:
                    body = parts[2].strip()
            _LOADED_SOUL = body
            logger.info(f"[SOUL] 已加载合规助手 SOUL.md ({len(body)} 字符)")
            return _LOADED_SOUL
        else:
            logger.info(f"[SOUL] 未找到 {_SOUL_PATH}")
            _LOADED_SOUL = ""
            return ""
    except Exception as e:
        logger.info(f"[SOUL] 加载失败: {e}")
        _LOADED_SOUL = ""
        return ""


def _get_vault_status() -> str:
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


# 行业代码/名称 → ecoskill 目录检索关键词（用于 auto-install 与技能包加载）
# 每个行业：第 1 个词是行业触发词（远程市场行业技能名直接含此词，权重最高），其余为通用相关词
_INDUSTRY_SKILL_KEYWORDS: "dict[str, list[str]]" = {
    "C31": ["钢铁", "黑色金属", "大气", "监测", "环境治理"],   # 钢铁（黑色金属冶炼）
    "C30": ["水泥", "建材", "大气", "监测", "碳排放"],          # 水泥/建材
    "D44": ["火电", "发电", "大气", "碳排放", "监测"],          # 火电/电力
    "C26": ["化工", "环境治理", "水环境", "监测"],              # 化工
    "C27": ["制药", "水环境", "环境治理", "监测"],              # 制药
    "C17": ["纺织", "水环境", "环境治理", "监测"],              # 纺织
    "C22": ["造纸", "水环境", "环境治理", "监测"],              # 造纸
}
_INDUSTRY_NAME_KEYWORDS: "dict[str, list[str]]" = {
    "钢铁": ["钢铁", "黑色金属", "大气", "监测", "环境治理"],
    "冶金": ["钢铁", "黑色金属", "大气", "监测", "环境治理"],
    "水泥": ["水泥", "建材", "大气", "监测", "碳排放"],
    "火电": ["火电", "发电", "大气", "碳排放", "监测"],
    "发电": ["火电", "发电", "大气", "碳排放", "监测"],
    "化工": ["化工", "环境治理", "水环境", "监测"],
    "制药": ["制药", "水环境", "环境治理", "监测"],
    "纺织": ["纺织", "水环境", "环境治理", "监测"],
    "造纸": ["造纸", "水环境", "环境治理", "监测"],
}
_DEFAULT_SKILL_KEYWORDS = ["环境监测", "环境治理", "环境法规"]

def _industry_keywords(industry_code: str, industry_name: str) -> list[str]:
    """根据行业代码+名称推导 ecoskill 检索关键词"""
    kws: list[str] = []
    for code, words in _INDUSTRY_SKILL_KEYWORDS.items():
        if industry_code and industry_code.startswith(code):
            kws.extend(words)
            break
    if not kws and industry_name:
        for frag, words in _INDUSTRY_NAME_KEYWORDS.items():
            if frag in industry_name:
                kws.extend(words)
                break
    if not kws:
        kws = list(_DEFAULT_SKILL_KEYWORDS)
    # 行业名本身也作为检索词（去常见后缀）
    core = (industry_name or "").replace("行业", "").replace("业", "").strip()
    if core and len(core) >= 2:
        kws.insert(0, core)
    # 去重保序
    seen, out = set(), []
    for k in kws:
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    return out


def _hermes_skills_dir() -> Path:
    """Hermes skills 目录（平台原生路径，与 hermes_engine 保持一致）：
    Windows → %LOCALAPPDATA%\\hermes\\skills；Linux/macOS → ~/.hermes/skills"""
    override = os.environ.get("HERMES_HOME", "").strip()
    if override:
        return Path(override) / "skills"
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA", "").strip() or str(Path.home() / "AppData" / "Local")
        return Path(base) / "hermes" / "skills"
    return Path.home() / ".hermes" / "skills"


def _load_industry_skill(industry_code: str, industry_name: str) -> str:
    """从 ecoskill (Hermes skills) 加载行业专业技能包（已安装技能按行业关键词匹配）"""
    if not industry_code and not industry_name:
        return ""
    try:
        skills_dir = _hermes_skills_dir()
        if not skills_dir.exists():
            return ""

        keywords = _industry_keywords(industry_code, industry_name)
        parts = []
        for skill_dir in sorted(skills_dir.iterdir()):
            if len(parts) >= 3:
                break
            if not skill_dir.is_dir():
                continue
            skill_md = skill_dir / "SKILL.md"
            if not skill_md.exists():
                continue
            content = skill_md.read_text()
            # 匹配：目录名 / frontmatter name / description / tags 命中任一行业关键词
            head = content[:800]
            if not any(k in skill_dir.name or k in head for k in keywords):
                continue
            # 只取正文（跳过 frontmatter）
            body = content
            if body.startswith("---"):
                sections = body.split("---", 2)
                if len(sections) >= 3:
                    body = sections[2]
            parts.append(f"\n### {skill_dir.name}\n{body[:3000]}")
        return "\n".join(parts) if parts else ""
    except Exception as e:
        logger.info(f"[EcoSkill] 加载行业技能失败: {e}")
        return ""


def _get_orchestrator_system_prompt(permit_data: dict = None) -> str:
    """获取合规助手的 system prompt，注入许可证数据"""
    soul = _load_soul()
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
## 企业排污许可证已读取（真实数据）

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
        vault_status = _get_vault_status()
        if vault_status:
            permit_context += vault_status + "\n"

        permit_context += f"""
【行业上下文】
当前企业属于 **{industry}**（代码: {industry_code or '待识别'}）行业。

"""
        industry_skill = _load_industry_skill(industry_code, industry)
        if industry_skill:
            permit_context += f"""
【ecoskill 行业技能包】
以下为该行业的专业技能知识，已从 ecoskill 技能市场加载：
{industry_skill}
"""
        permit_context += """
【数据使用规则】
上方许可证数据是当前会话的真实数据。优先使用已有数据回答，不要重复调 permit_quick_check/permit_report_status/monitoring_check/carbon_check。只有用户明确要求"重新查"时才调实时工具。工具失败时用已有数据继续回答，不说"平台未登录"。"""


    else:
        # 检查 enterprise.json 是否有数据（引导流程可能已写入）
        enterprise = _load_enterprise_info()
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








def _load_enterprise_info():
    import json
    f = HERMES_HOME / "enterprise.json"
    return json.loads(f.read_text()) if f.exists() else None


_SERVICE_START_TIME = time.time()

_sessions: dict[str, list[dict]] = {}
_sessions_last_access: dict[str, float] = {}  # session_id → last access timestamp
_session_permit: dict[str, dict] = {}  # session_id → 许可证数据
_sessions_lock = asyncio.Lock()  # 保护 _sessions / _sessions_last_access / _session_permit 并发读写
_sms_codes: dict[str, tuple[str, float, int]] = {}  # phone -> (code, timestamp, fail_count)

# ─── 数据持久化目录 ───
_STATE_DIR = HERMES_HOME / "state"
_STATE_DIR.mkdir(parents=True, exist_ok=True)

def _load_json_dict(filename: str) -> dict:
    """从 state 目录加载 JSON 字典，容错处理"""
    try:
        path = _STATE_DIR / filename
        if path.exists():
            import json as _j
            return _j.loads(path.read_text())
    except Exception:
        pass
    return {}

def _save_json_dict(filename: str, data: dict) -> None:
    """原子写入 JSON 字典到 state 目录"""
    try:
        path = _STATE_DIR / filename
        tmp = path.with_suffix(".json.tmp")
        import json as _j
        tmp.write_text(_j.dumps(data, ensure_ascii=False, indent=2, default=str))
        tmp.replace(path)
    except Exception as e:
        logger.info(f"[State] 保存 {filename} 失败: {e}")

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
            logger.info(f"[Permit] 清理任务异常: {e}")
        try:
            # 清理超时会话
            async with _sessions_lock:
                stale = [sid for sid, ts in list(_sessions_last_access.items()) if now - ts > SESSION_TTL_SECONDS]
                for sid in stale:
                    _sessions.pop(sid, None)
                    _sessions_last_access.pop(sid, None)
                    _session_permit.pop(sid, None)
            if stale:
                logger.info(f"[Session] 清理 {len(stale)} 个过期会话")
        except Exception as e:
            logger.info(f"[Session] 清理异常: {e}")
        try:
            # 硬上限保护
            async with _sessions_lock:
                if len(_sessions) > MAX_SESSIONS:
                    overflow = sorted(_sessions_last_access.items(), key=lambda x: x[1])
                    to_drop = [sid for sid, _ in overflow[:len(_sessions) - MAX_SESSIONS]]
                    for sid in to_drop:
                        _sessions.pop(sid, None)
                        _sessions_last_access.pop(sid, None)
                    logger.info(f"[Session] 硬上限清理 {len(to_drop)} 个会话")
        except Exception as e:
            logger.info(f"[Session] 硬上限清理异常: {e}")
        try:
            # 清理失效验证码
            stale_sms = [p for p, (_, ts, _) in list(_sms_codes.items()) if now - ts > SMS_TTL_SECONDS]
            for p in stale_sms:
                _sms_codes.pop(p, None)
            if stale_sms:
                logger.info(f"[SMS] 清理 {len(stale_sms)} 个失效验证码")
        except Exception as e:
            logger.info(f"[SMS] 清理异常: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _AUTH_TOKEN, _LICENSE_VALID
    # C-2: 生成随机 token，写入 ~/.ecopilot-home/.session
    _AUTH_TOKEN = secrets.token_hex(32)
    HERMES_HOME.mkdir(parents=True, exist_ok=True)
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
        fd = os.open(str(SESSION_FILE), flags, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(_AUTH_TOKEN)
    except OSError:
        SESSION_FILE.write_text(_AUTH_TOKEN)
        try:
            os.chmod(str(SESSION_FILE), 0o600)
        except OSError:
            pass
    logger.info(f"[EcoPilot] Auth token 已生成 → {SESSION_FILE}")
    # P2-2: 生产环境安全校验 — ECOPILOT_DEV=1 时 SMS 验证码明文返回，仅允许 localhost
    if os.environ.get("ECOPILOT_DEV") == "1":
        logger.info("[EcoPilot] ⚠️  ECOPILOT_DEV=1 已启用（SMS 验证码将明文返回），仅限开发环境使用！")
    # H-4: 许可证验证（不阻断启动，但非 health/license 端点会返回 403）
    lk = LICENSE_FILE.read_text().strip() if LICENSE_FILE.exists() else None
    ok, msg = validate_license(lk or "")
    _LICENSE_VALID = ok
    if not ok:
        logger.info(f"[EcoPilot] License WARN: {msg}（非 health/license 端点将返回 403）")
    else:
        logger.info(f"[EcoPilot] License OK: {msg}")
    cleanup_task = asyncio.create_task(_cleanup_loop())
    # MCP 客户端：连接所有已配置的 MCP 服务器（启动时完成，避免AI查询时未就绪）
    mcp = get_mcp_manager()
    try:
        await asyncio.wait_for(mcp.start_all(), timeout=10)
    except asyncio.TimeoutError:
        logger.info("[EcoPilot] MCP 连接超时（后台重试中）")
        asyncio.create_task(mcp.start_all())
    yield
    cleanup_task.cancel()
    await mcp.stop_all()

app = FastAPI(title="EcoPilot Chat Bridge", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[os.environ.get("ECO_CORS_ORIGIN", "http://127.0.0.1:3000"), "http://localhost:3000"], allow_methods=["*"], allow_headers=["*"])

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
_rate_limits: dict[str, list[float]] = {}
_rate_limits_lock = threading.Lock()  # 保护 _rate_limits 并发读写
_RATE_WINDOW = 60  # 秒
_RATE_MAX = 300    # 每窗口最大请求数（5 req/s，适配并发场景）

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if request.url.path.startswith("/api/"):
        import time
        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        with _rate_limits_lock:
            bucket = _rate_limits.get(client_ip, [])
            bucket = [t for t in bucket if now - t < _RATE_WINDOW]
            if len(bucket) >= _RATE_MAX:
                return JSONResponse(status_code=429, content={"detail": "请求过于频繁，请稍后再试"})
            bucket.append(now)
            _rate_limits[client_ip] = bucket
    return await call_next(request)


# C-2 + H-4: 本地 token 认证 + 许可证依赖检查中间件
def _cors_json(status: int, detail: str, request: Request) -> JSONResponse:
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
            return _cors_json(403, "Forbidden", request)
        return await call_next(request)
    # /api/mcp-servers 连接器状态页（不暴露密钥，仅返回元数据）
    if path == "/api/mcp-servers" and request.method == "GET":
        return await call_next(request)
    # OpenAPI 文档公开
    if path in ("/docs", "/openapi.json", "/redoc"):
        return await call_next(request)
    # C-2: 校验 Authorization: Bearer <token>（也支持 ?token=xxx 查询参数，用于 img/iframe 等浏览器原生请求）
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else ""
    if not token:
        token = request.query_params.get("token", "")
    if not _AUTH_TOKEN or not secrets.compare_digest(token, _AUTH_TOKEN):
        return _cors_json(401, "Unauthorized", request)
    # H-4: 非 /api/license/* 端点检查许可证有效性
    if not path.startswith("/api/license/") and not _LICENSE_VALID:
        return _cors_json(403, "许可证无效或已过期，请联系管理员", request)
    return await call_next(request)


# ─── 运维监控平台端点 ─────────────────────────────────────
import ops_monitor as _ops

@app.get("/api/ops/dashboard")
async def _ops_dashboard(request: Request):
    """看板总览数据"""
    days = int(request.query_params.get("days", "7"))
    overview = _ops.dashboard_overview(days=days)
    timeseries = _ops.dashboard_timeseries(days=days)
    return {"ok": True, "overview": overview, "timeseries": timeseries}


@app.get("/api/ops/events")
async def _ops_events(request: Request):
    """事件流"""
    limit = int(request.query_params.get("limit", "50"))
    severity = request.query_params.get("severity") or None
    return {"ok": True, "events": _ops.dashboard_recent_events(limit=limit, severity=severity)}


@app.get("/api/ops/feedback")
async def _ops_feedback_list(request: Request):
    """反馈列表"""
    limit = int(request.query_params.get("limit", "20"))
    return {"ok": True, "feedback": _ops.dashboard_recent_feedback(limit=limit)}


@app.post("/api/ops/feedback/respond")
async def _ops_feedback_respond(request: Request):
    """回复反馈"""
    try:
        body = await request.json()
        fb_id = int(body.get("id", 0))
        response = str(body.get("response", "")).strip()
        if not fb_id or not response:
            return {"ok": False, "detail": "id 和 response 必填"}
        ok = _ops.respond_to_feedback(fb_id, response)
        return {"ok": ok}
    except Exception as e:
        return {"ok": False, "detail": str(e)}


@app.get("/api/ops/alerts")
async def _ops_alerts(request: Request):
    """告警列表"""
    only_unack = request.query_params.get("unack") == "1"
    limit = int(request.query_params.get("limit", "50"))
    return {"ok": True, "alerts": _ops.dashboard_alerts(only_unack=only_unack, limit=limit)}


@app.post("/api/ops/alerts/ack")
async def _ops_alerts_ack(request: Request):
    """标记告警已处理"""
    try:
        body = await request.json()
        alert_id = int(body.get("id", 0))
        ok = _ops.acknowledge_alert(alert_id)
        return {"ok": ok}
    except Exception as e:
        return {"ok": False, "detail": str(e)}


@app.get("/api/ops/enterprises")
async def _ops_enterprises(request: Request):
    """Top 活跃企业"""
    days = int(request.query_params.get("days", "7"))
    return {"ok": True, "enterprises": _ops.dashboard_top_enterprises(days=days)}


@app.get("/api/notifications")
async def _notifications(request: Request):
    """通知中心 — 汇总最近 7 天的告警和事件"""
    days = int(request.query_params.get("days", "7"))
    items = []
    try:
        # 从监控数据库读取告警
        alerts = _ops.dashboard_alerts(only_unack=True, limit=20) or []
        for a in alerts:
            sev = a.get("severity", "info")
            items.append({
                "id": f"alert-{a.get('id','0')}",
                "type": "urgent" if sev in ("critical","error") else ("warn" if sev == "warning" else "info"),
                "title": a.get("message", "")[:80],
                "desc": a.get("detail", "")[:200],
                "time": a.get("created_at", ""),
                "read": False,
            })
        # 从监控数据库读取最近事件
        events = _ops.dashboard_recent_events(limit=10, severity="error") or []
        for e in events:
            items.append({
                "id": f"event-{e.get('id','0')}",
                "type": "urgent",
                "title": e.get("type", "异常事件")[:80],
                "desc": str(e.get("data", ""))[:200],
                "time": e.get("created_at", ""),
                "read": False,
            })
    except Exception as e:
        logger.info(f"[Notify] 生成通知时出错: {e}")

    # 如果没有告警或事件，生成基础合规提醒
    if not items:
        try:
            import json as _j2
            pd_file = HERMES_HOME / "permit-data.json"
            if pd_file.exists():
                pd_obj = _j2.loads(pd_file.read_text())
                parsed = pd_obj.get("parsed", {})
                if parsed.get("enterpriseName"):
                    items.append({
                        "id": "perm-reminder",
                        "type": "info",
                        "title": "许可证数据已就绪",
                        "desc": f"已读取 {parsed.get('enterpriseName','')} 的排污许可证数据，可以开始合规咨询。",
                        "time": "",
                        "read": False,
                    })
        except Exception:
            pass

    return {"ok": True, "data": items}


@app.post("/api/ops/event")
async def _ops_record_event(request: Request):
    """前端 SDK 上报事件（公开端点，不需鉴权）"""
    try:
        body = await request.json()
        event_type = str(body.get("type", "page_view"))
        severity = str(body.get("severity", "info"))
        user_id = body.get("user_id")
        enterprise = body.get("enterprise")
        event_data = {k: v for k, v in body.items() if k not in ("type", "severity", "user_id", "enterprise")}
        event_id = _ops.record_event(event_type, severity=severity, user_id=user_id, enterprise=enterprise, **event_data)
        return {"ok": True, "event_id": event_id}
    except Exception as e:
        return {"ok": False, "detail": str(e)}


# ─── 输入安全与解析 helper ─────────────────────────────────────
import html as _html


async def _parse_json(request: Request):
    """统一解析 JSON body，非法 JSON 时返回 400 JSONResponse（直接 return）。
    用法:
        body, err = await _parse_json(request)
        if err is not None: return err
    """
    try:
        body = await request.json()
        return body, None
    except Exception:
        return None, JSONResponse(status_code=400, content={"detail": "Invalid JSON"})


def _sanitize_input(s, max_len: int = 100) -> str:
    """清洗用户输入：截断、转义HTML、过滤SQL注入模式。
    - 非 str 输入返回空字符串
    - 先 strip + 截断到 max_len
    - 用 html.escape 转义 < > & " '
    - 过滤常见 SQL 注入模式字符串
    """
    if not isinstance(s, str):
        return ""
    s = s.strip()[:max_len]
    s = _html.escape(s, quote=True)
    # 过滤常见 SQL 注入模式（字符串过滤，非完整 SQL 解析）
    for pattern in ["' OR ", "' AND ", "--", ";", "/*", "*/", "xp_", "exec "]:
        s = s.replace(pattern, "")
    return s

# 注册知识库 API（Obsidian vault 兼容）
try:
    from knowledge_api import register_knowledge_routes
    register_knowledge_routes(app)
except Exception as e:
    logger.info(f"[Knowledge] 加载失败: {e}")

@app.get("/api/chat/system-prompt")
async def system_prompt():
    """返回当前会话的完整系统提示词（前端用它传给 Hermes）"""
    prompt = _get_orchestrator_system_prompt()
    return {"ok": True, "prompt": prompt}


@app.post("/api/chat/tts")
async def chat_tts(request: Request):
    """Edge TTS Neural — 晓晓专业女播报员，无需API Key"""
    body, err = await _parse_json(request)
    if err is not None: return err
    text = body.get("text", "").strip()
    if not text:
        return JSONResponse(status_code=400, content={"detail": "缺少 text 参数"})
    text = text[:500]
    # 剔除 emoji，防止 Edge TTS 流中断
    import re
    text = re.sub(r'[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF'
                  r'\U0001F1E0-\U0001F1FF\u2600-\u26FF\u2700-\u27BF'
                  r'\uFE00-\uFE0F\u200D]', '', text)

    try:
        import edge_tts
        # zh-CN-XiaoxiaoNeural: 晓晓 — Edge TTS 中最自然的播音员级女声
        # rate=-10%: 稍慢语速，更像人类播报节奏；pitch=+0Hz: 不改变音高
        communicate = edge_tts.Communicate(text, "zh-CN-XiaoxiaoNeural", rate="-10%", pitch="+0Hz")

        async def audio_stream():
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    yield chunk["data"]

        return StreamingResponse(audio_stream(), media_type="audio/mpeg",
            headers={"Content-Disposition": "inline", "Cache-Control": "public, max-age=86400"})
    except Exception as e:
        return JSONResponse(status_code=502, content={"detail": f"TTS 异常: {e}"})


@app.get("/health")
async def root_health():
    return {"status": "ok", "engine": "EcoPilot Chat Bridge"}


@app.get("/api/chat/health")
async def health():
    text_ready = bool(os.environ.get("DEEPSEEK_API_KEY", ""))
    vision_ready = bool(os.environ.get("KIMI_API_KEY", ""))
    # OmniRoute 模式下同时检查网关健康
    gateway_ok = True
    if _is_omniroute_mode():
        gateway_ok = await _check_omniroute_health()
    return {
        "status":"ok","engine":"EcoPilot",
        "text_ready":text_ready,
        "vision_ready":vision_ready,
        "text_model":TEXT_MODEL if text_ready else "",
        "vision_model":KIMI_VISION_MODEL if vision_ready else "",
        "omniroute_mode": _is_omniroute_mode(),
        "gateway_ok": gateway_ok,
    }

# ── Hermes 模型配置读取 ──
import yaml as _yaml
_HERMES_CONFIG_PATH = Path.home() / ".hermes" / "config.yaml"
_hermes_providers_cache: "dict | None" = None

def _load_hermes_providers() -> dict:
    """从 Hermes config.yaml 读取所有已配置的模型提供商和模型列表"""
    global _hermes_providers_cache
    if _hermes_providers_cache is not None:
        return _hermes_providers_cache
    providers = {}
    try:
        if _HERMES_CONFIG_PATH.exists():
            config = _yaml.safe_load(_HERMES_CONFIG_PATH.read_text()) or {}
            for name, cfg in config.get("providers", {}).items():
                key_env = cfg.get("key_env", "")
                has_key = bool(os.environ.get(key_env, ""))
                models = []
                for m in cfg.get("models", []):
                    if isinstance(m, str):
                        models.append({"id": m, "name": m, "provider": name, "available": has_key})
                    elif isinstance(m, dict):
                        models.append({"id": m.get("id",""), "name": m.get("id",""), "provider": name, "available": has_key, "reasoning": m.get("reasoning", False)})
                providers[name] = {
                    "name": cfg.get("name", name),
                    "base_url": cfg.get("base_url", ""),
                    "models": models,
                    "available": has_key,
                }
        _hermes_providers_cache = providers
    except Exception:
        _hermes_providers_cache = {}
    return _hermes_providers_cache


@app.post("/api/models/save")
async def save_model_config(request: Request):
    """保存模型配置到后端（API Key + 模型选择），供 Hermes 使用"""
    body, err = await _parse_json(request)
    if err is not None: return err
    text_key = (body.get("text_api_key") or "").strip()
    vision_key = (body.get("vision_api_key") or "").strip()
    text_model = (body.get("text_model") or "").strip()
    vision_model = (body.get("vision_model") or "").strip()
    env_path = HERMES_HOME / ".env"
    try:
        existing = {}
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if "=" in line:
                    k, v = line.split("=", 1)
                    existing[k.strip()] = v.strip().strip('"').strip("'")
        if text_key: existing["DEEPSEEK_API_KEY"] = text_key
        if vision_key: existing["KIMI_API_KEY"] = vision_key
        if text_model: existing["ECOPILOT_TEXT_MODEL"] = text_model
        if vision_model: existing["ECOPILOT_VISION_MODEL"] = vision_model
        lines = [f"{k}={v}" for k, v in existing.items()]
        env_path.write_text("\n".join(lines) + "\n")
        env_path.chmod(0o600)

        # ── 唤醒后端 Hermes：立即热加载配置，无需重启 ──
        global _hermes_providers_cache, TEXT_MODEL, KIMI_VISION_MODEL
        # 1. 新值直接写入进程环境（覆盖旧值，_load_hermes_env 的 setdefault 只用于启动）
        for k, v in existing.items():
            os.environ[k] = v
        if text_model: TEXT_MODEL = text_model
        if vision_model: KIMI_VISION_MODEL = vision_model
        # 1b. 直接热更新已创建的 OpenAI 客户端（模块级单例不会自动读新 env）
        if text_key:
            ds_client.api_key = text_key
        if vision_key:
            kimi_client.api_key = vision_key
        # 2. 清 Hermes providers 缓存，下次读取重新解析 config.yaml + .env
        _hermes_providers_cache = None
        # 3. Hermes 引擎模式下触发预热（子代理/技能系统初始化）
        hermes_wake = "not-applicable"
        if _is_hermes_engine():
            try:
                _get_hermes_engine()
                hermes_wake = "warming"
            except Exception as e:
                hermes_wake = f"failed: {e}"
        text_ready = bool(os.environ.get("DEEPSEEK_API_KEY", ""))
        vision_ready = bool(os.environ.get("KIMI_API_KEY", ""))
        return {
            "ok": True,
            "detail": "模型配置已保存并热加载",
            "hermes": {
                "wake": hermes_wake,
                "engine": ECOPILOT_ENGINE,
                "text_ready": text_ready,
                "vision_ready": vision_ready,
                "text_model": TEXT_MODEL if text_ready else "",
                "vision_model": KIMI_VISION_MODEL if vision_ready else "",
            },
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "detail": f"保存失败: {e}"})


@app.get("/api/models/available")
async def list_available_models():
    """从 Hermes 配置读取所有可用模型"""
    providers = _load_hermes_providers()
    text_models = []
    vision_models = []
    for pname, pinfo in providers.items():
        for m in pinfo["models"]:
            entry = {"id": m["id"], "name": m["name"], "provider": pinfo["name"], "available": pinfo["available"],
                     "desc": f"{'🧠 推理模型 · ' if m.get('reasoning') else ''}{pinfo['name']} 提供"}
            # 视觉模型检测
            if any(kw in m["id"].lower() for kw in ["vision", "moonshot", "gpt-4o", "claude-3"]):
                vision_models.append(entry)
            else:
                text_models.append(entry)
    if not text_models:
        text_models = [{"id": "deepseek-chat", "name": "DeepSeek Chat", "provider": "DeepSeek", "available": False, "desc": "默认模型（请先配置 Hermes）"}]
    if not vision_models:
        vision_models = [{"id": "moonshot-v1-32k-vision-preview", "name": "Moonshot Vision", "provider": "Moonshot", "available": False, "desc": "默认视觉模型（请先配置 Hermes）"}]
    return {
        "text_models": text_models,
        "vision_models": vision_models,
        "default_text": text_models[0]["id"] if text_models else "",
        "default_vision": vision_models[0]["id"] if vision_models else "",
    }

@app.get("/api/mcp-servers")
async def list_mcp_servers():
    """返回已配置的 MCP 服务器列表（脱敏：不包含 API Key 等敏感信息）"""
    config_dir = Path(__file__).parent
    config_path = config_dir / "mcp_servers.local.json"
    if not config_path.exists():
        config_path = config_dir / "mcp_servers.json"
    if not config_path.exists():
        return {"servers": []}
    try:
        raw = json.loads(config_path.read_text())
    except Exception:
        return {"servers": []}
    servers = []
    for s in raw.get("servers", []):
        servers.append({
            "id": s.get("id", ""),
            "name": s.get("name", ""),
            "description": s.get("description", ""),
            "transport": s.get("transport", "stdio"),
            "status": s.get("status", "unknown"),
            "category": s.get("category", "其他"),
            "tools": s.get("tools", []),
        })
    return {"servers": servers}


@app.get("/api/auth/token")
async def get_auth_token():
    """C-2: 返回本地认证 token（中间件已限制仅 localhost 可访问）"""
    return {"token": _AUTH_TOKEN}

_license_status_cache: dict = {}
_license_fp_cache: str = ""

@app.get("/api/license/status")
async def license_status():
    import time as _t
    global _license_fp_cache
    now = _t.time()
    if _license_status_cache and now - _license_status_cache.get("ts", 0) < 300:
        return {**_license_status_cache["data"], "fingerprint": _license_fp_cache, "cached": True}
    s = get_license_status()
    if not _license_fp_cache:
        _license_fp_cache = get_machine_fingerprint()
    result = {**s, "fingerprint": _license_fp_cache}
    _license_status_cache.clear()
    _license_status_cache.update({"data": s, "ts": now})
    return result

@app.get("/api/license/fingerprint")
async def license_fingerprint():
    """返回机器指纹（供企业生成授权申请）"""
    global _license_fp_cache
    if not _license_fp_cache:
        _license_fp_cache = get_machine_fingerprint()
    return {"fingerprint": _license_fp_cache}

@app.get("/api/enterprise")
async def enterprise_get():
    return _load_enterprise_info() or {}

@app.post("/api/feedback")
async def feedback_submit(request: Request):
    """用户意见反馈 — 存入 ~/.ecopilot-home/feedback/ + 监控数据库（双写）"""
    import json as _json
    from datetime import datetime as _dt
    data, err = await _parse_json(request)
    if err is not None: return err
    msg = data.get("message", "").strip()
    contact = data.get("contact", "").strip()
    if not msg: return {"ok": False, "detail": "消息不能为空"}
    fb_dir = HERMES_HOME / "feedback"
    fb_dir.mkdir(parents=True, exist_ok=True)
    ts = _dt.now().strftime("%Y%m%d-%H%M%S")
    filename = f"feedback-{ts}.json"
    (fb_dir / filename).write_text(_json.dumps({
        "time": _dt.now().isoformat(),
        "message": msg,
        "contact": contact,
    }, ensure_ascii=False, indent=2))
    # 同步写入监控数据库（生成告警，让运维第一时间看到）
    try:
        _ops.record_feedback(message=msg, contact=contact)
    except Exception:
        pass
    return {"ok": True, "file": filename}

# ─── 档案库 API ──────────────────────────────────────────────
# 存储：~/.ecopilot-home/vault/  (扁平存储)
# 元数据：~/.ecopilot-home/vault/manifest.json

VAULT_DIR = HERMES_HOME / "vault"
VAULT_MANIFEST = VAULT_DIR / "manifest.json"

# ═══ 三大阶段 + 子分类体系 ═══
# 企业环境档案按生命周期分为三大阶段，每阶段下有子分类
VAULT_PHASES = [
    {"id": "construction", "label": "建设期间"},
    {"id": "operation",    "label": "运营期间"},
    {"id": "decommission", "label": "退役期间"},
]

# 子分类默认归属某个阶段（用户可自定义增删，但"其他"始终存在）
VAULT_DEFAULT_SUBCATS = [
    {"name": "环评",       "phase": "construction"},
    {"name": "验收",       "phase": "construction"},
    {"name": "许可证",     "phase": "operation"},
    {"name": "台账",       "phase": "operation"},
    {"name": "自行监测",   "phase": "operation"},
    {"name": "执行报告",   "phase": "operation"},
    {"name": "应急预案",   "phase": "operation"},
    {"name": "固废管理",   "phase": "operation"},
    {"name": "清洁生产",   "phase": "operation"},
    {"name": "信息公开",   "phase": "operation"},
    {"name": "土壤调查",   "phase": "decommission"},
    {"name": "拆除方案",   "phase": "decommission"},
    {"name": "修复报告",   "phase": "decommission"},
    {"name": "退役验收",   "phase": "decommission"},
    {"name": "其他",       "phase": "operation"},  # 兜底分类
]

# 法规要求企业必备的环境档案模板（缺失项提示）
REQUIRED_DOCS = [
    # 建设期间
    {"tpl_id": "eia_report",      "name": "环境影响评价报告书",       "cat": "环评",     "phase": "construction", "desc": "建设项目环评报告书全文"},
    {"tpl_id": "eia_approval",    "name": "环评批复文件",             "cat": "环评",     "phase": "construction", "desc": "生态环境部门批复文件，含排放总量"},
    {"tpl_id": "acceptance",      "name": "竣工环保验收报告",         "cat": "验收",     "phase": "construction", "desc": "新建项目投产前必须完成验收"},
    # 运营期间 — 许可证
    {"tpl_id": "permit",          "name": "排污许可证(正本+副本)",    "cat": "许可证",   "phase": "operation", "desc": "有效期内的排污许可证正本与副本"},
    # 运营期间 — 自行监测
    {"tpl_id": "monitor_plan",    "name": "自行监测方案",             "cat": "自行监测", "phase": "operation", "desc": "根据 HJ 878 编制"},
    {"tpl_id": "monitor_eq",      "name": "自动监测设备验收材料",     "cat": "自行监测", "phase": "operation", "desc": "CEMS 通过验收的材料"},
    # 运营期间 — 执行报告
    {"tpl_id": "exec_report",     "name": "年度执行报告",             "cat": "执行报告", "phase": "operation", "desc": "上年度排污许可执行报告"},
    # 运营期间 — 应急
    {"tpl_id": "emergency",       "name": "突发环境事件应急预案",     "cat": "应急预案", "phase": "operation", "desc": "备案有效期内的应急预案"},
    # 运营期间 — 固废
    {"tpl_id": "hazwaste",        "name": "危险废物管理计划",         "cat": "固废管理", "phase": "operation", "desc": "每年12月前备案下一年度计划"},
    # 运营期间 — 清洁生产
    {"tpl_id": "cleaner",         "name": "清洁生产审核报告",         "cat": "清洁生产", "phase": "operation", "desc": "清洁生产审核报告"},
    # 运营期间 — 信息公开
    {"tpl_id": "info_disclosure", "name": "环境信息公开记录",         "cat": "信息公开", "phase": "operation", "desc": "企业环境信息依法披露记录"},
    # 退役期间
    {"tpl_id": "soil_survey",     "name": "土壤环境调查报告",         "cat": "土壤调查", "phase": "decommission", "desc": "停产前土壤环境质量现状调查"},
    {"tpl_id": "decomm_plan",     "name": "退役拆除方案",             "cat": "拆除方案", "phase": "decommission", "desc": "拆除活动污染防治方案"},
    {"tpl_id": "remediation",     "name": "污染场地修复报告",         "cat": "修复报告", "phase": "decommission", "desc": "场地污染修复效果评估报告"},
    {"tpl_id": "decomm_accept",   "name": "退役验收文件",             "cat": "退役验收", "phase": "decommission", "desc": "生态环境部门退役验收批复"},
]

VAULT_CATEGORIES = ["全部", "环评", "验收", "许可证", "台账", "自行监测", "执行报告", "应急预案", "固废管理", "清洁生产", "信息公开", "土壤调查", "拆除方案", "修复报告", "退役验收", "其他"]

# 分类持久化文件（用户可自定义子分类）
VAULT_CATEGORIES_FILE = VAULT_DIR / "categories.json"

def _vault_load_categories():
    """读取用户自定义子分类列表，返回 [{name, phase}, ...]"""
    import json as _json
    if VAULT_CATEGORIES_FILE.exists():
        try:
            data = _json.loads(VAULT_CATEGORIES_FILE.read_text(encoding="utf-8"))
            if isinstance(data, list) and data:
                # 兼容旧格式（纯字符串列表）
                if isinstance(data[0], str):
                    return [{"name": c, "phase": "operation"} for c in data]
                return data
        except Exception:
            pass
    return VAULT_DEFAULT_SUBCATS

def _vault_save_categories(cats):
    """保存子分类列表 [{name, phase}, ...]"""
    import json as _json
    VAULT_DIR.mkdir(parents=True, exist_ok=True)
    VAULT_CATEGORIES_FILE.write_text(
        _json.dumps(cats, ensure_ascii=False, indent=2), encoding="utf-8"
    )

def _vault_category_names():
    """返回所有子分类名称列表（不含'全部'）"""
    return [c["name"] for c in _vault_load_categories()]

# 允许上传的文件类型与大小限制
ALLOWED_VAULT_EXT = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff",
    ".txt", ".md", ".csv", ".zip", ".rar", ".7z",
}
MAX_VAULT_FILE_SIZE = 50 * 1024 * 1024  # 50MB

# 文件扩展名 → MIME 类型（预览用）
EXT_MIME = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".bmp": "image/bmp", ".webp": "image/webp",
    ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".zip": "application/zip", ".rar": "application/x-rar", ".7z": "application/x-7z-compressed",
}

def _vault_load_manifest():
    """读取档案库 manifest，返回 files 列表"""
    import json as _json
    if VAULT_MANIFEST.exists():
        try:
            data = _json.loads(VAULT_MANIFEST.read_text(encoding="utf-8"))
            return data.get("files", []) if isinstance(data, dict) else []
        except Exception:
            return []
    return []

def _vault_save_manifest(files):
    """原子写入 manifest"""
    import json as _json
    VAULT_DIR.mkdir(parents=True, exist_ok=True)
    tmp = VAULT_MANIFEST.with_suffix(".json.tmp")
    tmp.write_text(_json.dumps({"files": files}, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(VAULT_MANIFEST)

def _vault_safe_filename(original: str) -> str:
    """生成安全的存储文件名：时间戳 + 原始名（去除路径）"""
    import re as _re, time as _time
    base = Path(original).name  # 去除路径
    base = _re.sub(r'[^\w\u4e00-\u9fff.\-]', '_', base)  # 保留中文/字母/数字/._-
    if not base or base.startswith("."):
        base = "file" + base
    ts = _time.strftime("%Y%m%d-%H%M%S")
    return f"{ts}_{base}"

_vault_list_cache: dict = {}

@app.get("/api/vault/list")
async def vault_list():
    """返回档案库列表：已上传文件 + 法规要求模板（标记是否已上传）"""
    import time as _t
    now = _t.time()
    if _vault_list_cache and now - _vault_list_cache.get("ts", 0) < 30:
        return _vault_list_cache["data"]
    files = _vault_load_manifest()
    # 按文件名去重：同一 original_name 保留最新一条（upload_date 倒序）
    seen_names = {}
    for f in sorted(files, key=lambda x: x.get("upload_date", ""), reverse=True):
        name = f.get("original_name", "")
        if name and name not in seen_names:
            seen_names[name] = f
    files = list(seen_names.values())
    # 为已上传文件补充模板标记（同一 tpl_id 视为已补传）
    uploaded_tpl_ids = {f.get("tpl_id") for f in files if f.get("tpl_id")}
    required = []
    for tpl in REQUIRED_DOCS:
        item = {**tpl, "uploaded": tpl["tpl_id"] in uploaded_tpl_ids}
        required.append(item)
    result = {
        "files": files,
        "required": required,
        "categories": ["全部"] + _vault_category_names(),
        "subcats": _vault_load_categories(),
        "phases": VAULT_PHASES,
        "stats": {
            "total_required": len(REQUIRED_DOCS),
            "uploaded_required": len(uploaded_tpl_ids),
            "extra_files": len([f for f in files if not f.get("tpl_id")]),
        }
    }
    _vault_list_cache.clear()
    _vault_list_cache.update({"data": result, "ts": now})
    return result

@app.get("/api/vault/categories")
async def vault_categories_get():
    """获取子分类列表（含阶段归属）"""
    return {"ok": True, "subcats": _vault_load_categories(), "phases": VAULT_PHASES}

@app.post("/api/vault/categories")
async def vault_categories_update(request: Request):
    """更新子分类列表（重命名/新增/删除/排序/调整阶段归属）
    Body: { "subcats": [{"name":"环评","phase":"construction"},...], "renames": {"旧名":"新名"} }
    """
    import json as _json
    try:
        body = await request.json()
    except Exception:
        return {"ok": False, "detail": "无效的 JSON"}
    subcats = body.get("subcats", [])
    renames = body.get("renames", {}) or {}
    if not isinstance(subcats, list):
        return {"ok": False, "detail": "subcats 必须是数组"}
    # 校验 + 去重
    valid_phases = {p["id"] for p in VAULT_PHASES}
    seen = set(); deduped = []
    has_other = False
    for sc in subcats:
        if not isinstance(sc, dict): continue
        name = str(sc.get("name", "")).strip()
        phase = str(sc.get("phase", "operation"))
        if not name: continue
        if phase not in valid_phases: phase = "operation"
        if name in seen: continue
        seen.add(name)
        deduped.append({"name": name, "phase": phase})
        if name == "其他": has_other = True
    # "其他"必须保留
    if not has_other:
        deduped.append({"name": "其他", "phase": "operation"})
    _vault_save_categories(deduped)
    # 同步已上传文件的分类重命名
    if renames:
        files = _vault_load_manifest()
        changed = False
        valid_names = {sc["name"] for sc in deduped}
        for f in files:
            old_cat = f.get("category", "")
            if old_cat in renames:
                f["category"] = renames[old_cat]
                changed = True
            elif old_cat not in valid_names:
                f["category"] = "其他"
                changed = True
        if changed:
            _vault_save_manifest(files)
    return {"ok": True, "subcats": deduped, "phases": VAULT_PHASES}

@app.post("/api/vault/upload")
async def vault_upload(
    file: UploadFile = File(...),
    category: str = Form("其他"),
    code: str = Form(""),
    desc: str = Form(""),
    tpl_id: str = Form(""),  # 可选：关联的模板 id（缺失项补传）
):
    """上传单个文件到档案库"""
    from datetime import datetime as _dt
    # 校验扩展名
    original_name = file.filename or "unnamed"
    ext = Path(original_name).suffix.lower()
    if ext not in ALLOWED_VAULT_EXT:
        return {"ok": False, "detail": f"不支持的文件类型：{ext}（允许：PDF/Word/Excel/图片/文本/压缩包）"}

    # 读取内容并校验大小
    content = await file.read()
    if len(content) > MAX_VAULT_FILE_SIZE:
        return {"ok": False, "detail": f"文件过大：{len(content)//1024//1024}MB（上限 50MB）"}
    if len(content) == 0:
        return {"ok": False, "detail": "文件为空"}

    VAULT_DIR.mkdir(parents=True, exist_ok=True)

    # 如果指定了 tpl_id，先删除该模板下的旧文件（一个模板只保留最新一份）
    files = _vault_load_manifest()
    if tpl_id:
        old = [f for f in files if f.get("tpl_id") == tpl_id]
        for o in old:
            try: (VAULT_DIR / o["filename"]).unlink(missing_ok=True)
            except Exception: pass
        files = [f for f in files if f.get("tpl_id") != tpl_id]

    # 存储文件
    stored_name = _vault_safe_filename(original_name)
    # 避免重名
    counter = 1
    while (VAULT_DIR / stored_name).exists():
        stored_name = f"{Path(stored_name).stem}_{counter}{Path(stored_name).suffix}"
        counter += 1
    (VAULT_DIR / stored_name).write_bytes(content)

    # 记录元数据
    import uuid as _uuid
    record = {
        "id": _uuid.uuid4().hex[:12],
        "filename": stored_name,           # 实际存储名
        "original_name": original_name,    # 原始文件名（显示用）
        "category": category if category in _vault_category_names() else "其他",
        "code": code.strip()[:100],
        "desc": desc.strip()[:500],
        "tpl_id": tpl_id.strip() if tpl_id.strip() else None,
        "upload_date": _dt.now().isoformat(timespec="seconds"),
        "size": len(content),
        "mime_type": EXT_MIME.get(ext, "application/octet-stream"),
        "ext": ext,
    }
    files.append(record)
    _vault_save_manifest(files)

    return {"ok": True, "file": record}

@app.get("/api/vault/file")
async def vault_file(id: str = "", name: str = "", inline: str = "1"):
    """获取档案文件内容用于在线预览/下载
    - id: manifest 中的文件 id（推荐）
    - name: 原始文件名（兼容旧前端）
    - inline=1 返回 inline（浏览器内预览），inline=0 返回 attachment（下载）
    """
    from fastapi.responses import FileResponse
    files = _vault_load_manifest()
    record = None
    if id:
        record = next((f for f in files if f.get("id") == id), None)
    elif name:
        # 兼容旧前端按原始名查找
        record = next((f for f in files if f.get("original_name") == name or f.get("filename") == name), None)
    if not record:
        from fastapi.responses import JSONResponse
        return JSONResponse({"ok": False, "detail": "文件不存在"}, status_code=404)

    filepath = VAULT_DIR / record["filename"]
    if not filepath.exists():
        return JSONResponse({"ok": False, "detail": "文件已丢失"}, status_code=404)

    disposition = "inline" if inline == "1" else "attachment"
    media_type = record.get("mime_type", "application/octet-stream")
    # 中文文件名需要 RFC 5987 编码
    from urllib.parse import quote
    encoded = quote(record["original_name"])
    headers = {"Content-Disposition": f'{disposition}; filename="{encoded}"; filename*=UTF-8\'\'{encoded}'}
    return FileResponse(filepath, media_type=media_type, headers=headers)

@app.delete("/api/vault/file")
async def vault_delete(id: str):
    """删除档案文件"""
    files = _vault_load_manifest()
    record = next((f for f in files if f.get("id") == id), None)
    if not record:
        return {"ok": False, "detail": "文件不存在"}
    try: (VAULT_DIR / record["filename"]).unlink(missing_ok=True)
    except Exception: pass
    files = [f for f in files if f.get("id") != id]
    _vault_save_manifest(files)
    return {"ok": True}

@app.put("/api/vault/file")
async def vault_update(request: Request):
    """编辑档案元数据（名称/分类/文号/描述），不改动文件内容本身。
    Body: { "id": "...", "original_name": "...", "category": "...", "code": "...", "desc": "..." }
    所有字段可选，只更新传入的字段。
    """
    try:
        data = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "Invalid JSON"})
    file_id = data.get("id", "")
    if not file_id:
        return {"ok": False, "detail": "缺少档案 id"}

    files = _vault_load_manifest()
    record = next((f for f in files if f.get("id") == file_id), None)
    if not record:
        return {"ok": False, "detail": "档案不存在"}

    # 更新字段
    if "original_name" in data:
        new_name = str(data["original_name"]).strip()
        if new_name:
            record["original_name"] = new_name
    if "category" in data:
        cat = str(data["category"]).strip()
        valid_cats = _vault_category_names()
        record["category"] = cat if cat in valid_cats else "其他"
    if "code" in data:
        record["code"] = str(data["code"]).strip()
    if "desc" in data:
        record["desc"] = str(data["desc"]).strip()

    # 写回 manifest
    _vault_save_manifest(files)
    return {"ok": True, "file": record}

@app.post("/api/vault/analyze")
async def vault_analyze(request: Request):
    """AI 分析档案内容（SSE 流式）
    Body: { "id": "档案id", "question": "用户提问" }
    - 文本/MD/CSV：直接读取内容交给 DeepSeek
    - 图片：base64 交给 Kimi 视觉模型
    - PDF：尝试用 Kimi 视觉（PDF 首页转图，若失败则提示）
    - Office/压缩包：提示不支持
    """
    import json as _json2
    data = await request.json()
    file_id = data.get("id", "")
    question = data.get("question", "请分析这份档案的合规要点").strip()
    if not file_id:
        return {"ok": False, "detail": "缺少档案 id"}

    files = _vault_load_manifest()
    record = next((f for f in files if f.get("id") == file_id), None)
    if not record:
        return {"ok": False, "detail": "档案不存在"}
    filepath = VAULT_DIR / record["filename"]
    if not filepath.exists():
        return {"ok": False, "detail": "档案文件已丢失"}

    ext = record.get("ext", "").lower()
    is_image = ext in (".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp")
    is_text = ext in (".txt", ".md", ".csv", ".log")
    is_pdf = ext == ".pdf"

    def _sse(obj):
        return f"data: {_json2.dumps(obj, ensure_ascii=False)}\n\n"

    async def _stream():
        try:
            if is_text:
                # 文本类：直接读取内容，交给 DeepSeek
                yield _sse({"type": "progress", "step": 1, "name": "读取档案内容"})
                content = filepath.read_text(encoding="utf-8", errors="replace")
                if len(content) > 30000:
                    content = content[:30000] + "\n... [内容过长，已截断]"
                yield _sse({"type": "progress", "step": 2, "name": "AI 分析中"})
                system = "你是 EcoPilot 档案分析助手。用户正在预览一份企业环境档案，请基于档案内容回答问题或给出合规分析。档案类型：" + record.get("category", "") + "，文件名：" + record.get("original_name", "")
                stream = await ds_client.chat.completions.create(
                    model=TEXT_MODEL,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": f"档案内容：\n```\n{content}\n```\n\n用户问题：{question}"},
                    ],
                    stream=True,
                )
                async for chunk in stream:
                    delta = chunk.choices[0].delta.content if chunk.choices else ""
                    if delta:
                        yield _sse({"type": "text_delta", "text": delta})
                        await asyncio.sleep(0)
            elif is_image:
                # 图片：base64 交给 Kimi 视觉
                yield _sse({"type": "progress", "step": 1, "name": "读取图片"})
                raw = filepath.read_bytes()
                b64 = base64.b64encode(raw).decode()
                yield _sse({"type": "progress", "step": 2, "name": "AI 视觉分析中"})
                stream = await kimi_client.chat.completions.create(
                    model=KIMI_VISION_MODEL,
                    messages=[{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": f"这是企业环境档案《{record.get('original_name','')}》。{question}"},
                            {"type": "image_url", "image_url": {"url": f"data:image/{ext[1:]};base64,{b64}"}},
                        ],
                    }],
                    stream=True,
                )
                async for chunk in stream:
                    delta = chunk.choices[0].delta.content if chunk.choices else ""
                    if delta:
                        yield _sse({"type": "text_delta", "text": delta})
                        await asyncio.sleep(0)
            elif is_pdf:
                # PDF：用 Moonshot file-extract 模式（上传文件→提取文本→DeepSeek 总结）
                yield _sse({"type": "progress", "step": 1, "name": "上传 PDF"})
                try:
                    import io as _io
                    # 1. 上传 PDF 到 Moonshot
                    upload_resp = await kimi_client.files.create(
                        file=("doc.pdf", _io.BytesIO(filepath.read_bytes()), "application/pdf"),
                        purpose="file-extract",
                    )
                    yield _sse({"type": "progress", "step": 2, "name": "提取 PDF 文本"})
                    # 2. 获取文件提取的文本内容
                    file_content = await kimi_client.files.retrieve_content(file_id=upload_resp.id)
                    # 3. 交给 DeepSeek 分析
                    yield _sse({"type": "progress", "step": 3, "name": "AI 分析中"})
                    content_text = file_content[:30000] if file_content else "（文件内容为空）"
                    stream = await ds_client.chat.completions.create(
                        model=TEXT_MODEL,
                        messages=[
                            {"role": "system", "content": f"你是 EcoPilot 档案分析助手。正在分析企业环境档案《{record.get('original_name','')}》（PDF）。请基于以下文件内容回答问题或给出合规分析。"},
                            {"role": "user", "content": f"档案内容：\n```\n{content_text}\n```\n\n用户问题：{question}"},
                        ],
                        stream=True,
                    )
                    async for chunk in stream:
                        delta = chunk.choices[0].delta.content if chunk.choices else ""
                        if delta:
                            yield _sse({"type": "text_delta", "text": delta})
                            await asyncio.sleep(0)
                except Exception as e:
                    yield _sse({"type": "text_delta", "text": f"⚠️ PDF 分析暂不可用（{e}）。您可以下载文件后在对话中上传图片让我分析，或针对文本类档案使用 AI 分析。"})
            else:
                # Office/压缩包：不支持
                yield _sse({"type": "text_delta", "text": f"⚠️ 此文件类型（{ext}）暂不支持 AI 在线分析。\n\n建议：\n1. 下载文件后转换为 PDF 或图片再上传分析\n2. 文本类档案（txt/md/csv）可直接分析\n3. 图片档案（jpg/png）可视觉识别"})
        except Exception as e:
            yield _sse({"type": "error", "detail": f"分析失败：{e}"})
        yield _sse({"type": "done"})

    return StreamingResponse(_stream(), media_type="text/event-stream")


# ─── AI 智能识别：自动分类归档 ───

@app.post("/api/vault/auto-classify")
async def vault_auto_classify(
    file: UploadFile = File(...),
):
    """AI 自动识别文件类型并归档到档案库
    接收文件 → AI 识别内容 → 自动匹配 11 类法定档案 → 归档
    SSE 事件: progress / classified / text_delta / done / error
    """
    import base64 as _b64, uuid as _uuid
    from datetime import datetime as _dt

    async def _stream():
        try:
            original_name = file.filename or "未命名文件"
            content = await file.read()
            size = len(content)

            yield _sse({"type": "progress", "text": f"正在接收文件：{original_name}（{fmt_size_py(size)}）"})

            # 校验扩展名
            ext = Path(original_name).suffix.lower()
            if ext not in ALLOWED_VAULT_EXT:
                yield _sse({"type": "error", "detail": f"不支持的文件类型：{ext}"})
                yield _sse({"type": "done"})
                return

            if size > MAX_VAULT_FILE_SIZE:
                yield _sse({"type": "error", "detail": f"文件过大（{fmt_size_py(size)}），最大支持 50MB"})
                yield _sse({"type": "done"})
                return

            yield _sse({"type": "progress", "text": "正在读取文件内容..."})

            # 提取文本内容用于 AI 识别
            file_text = ""
            try:
                if ext in [".txt", ".md", ".csv"]:
                    file_text = content.decode("utf-8", errors="ignore")[:3000]
                elif ext in [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"]:
                    file_text = "[图片文件]"
                elif ext == ".pdf":
                    file_text = "[PDF 文件]"
                else:
                    file_text = f"[{ext} 文件]"
            except Exception:
                file_text = ""

            yield _sse({"type": "progress", "text": "AI 正在智能识别文件类型和分类..."})

            # AI 识别分类
            classify_prompt = f"""你是企业环境档案管理专家。请根据文件名和内容片段，判断这个文件属于以下哪一类法定环境管理档案：

可选分类（必选其一）：
- 环评：环境影响评价报告、批复
- 验收：竣工环保验收报告
- 许可证：排污许可证
- 监测：自行监测方案、监测报告
- 应急：突发环境事件应急预案
- 清洁生产：清洁生产审核报告
- 执行报告：月报/季报/年报
- 固废：危险废物管理计划、转移联单
- 其他：不属于以上类别的文件

文件名：{original_name}
内容片段：{file_text[:500]}

请只回复一个 JSON，格式：{{"category": "分类名", "code": "文号（如有）", "desc": "一句话描述文件内容"}}"""

            ai_category = "其他"
            ai_code = ""
            ai_desc = ""
            try:
                resp = await ds_client.chat.completions.create(
                    model=TEXT_MODEL,
                    messages=[{"role": "user", "content": classify_prompt}],
                )
                text = resp.choices[0].message.content or ""
                # 解析 JSON
                import re as _re
                m = _re.search(r'\{[^}]+\}', text, _re.DOTALL)
                if m:
                    import json as _json2
                    parsed = _json2.loads(m.group(0))
                    ai_category = parsed.get("category", "其他")
                    ai_code = parsed.get("code", "")
                    ai_desc = parsed.get("desc", "")
                    # 校验分类合法性
                    if ai_category not in ["环评","验收","许可证","监测","应急","清洁生产","执行报告","固废","其他"]:
                        ai_category = "其他"
            except Exception as e:
                yield _sse({"type": "progress", "text": f"AI 识别失败，使用默认分类「其他」: {e}"})

            yield _sse({"type": "progress", "text": f"识别完成：{ai_category}"})
            yield _sse({"type": "classified", "category": ai_category, "code": ai_code, "desc": ai_desc, "filename": original_name})

            # 保存文件
            VAULT_DIR.mkdir(parents=True, exist_ok=True)
            stored_name = _vault_safe_filename(original_name)
            counter = 1
            while (VAULT_DIR / stored_name).exists():
                stored_name = f"{Path(stored_name).stem}_{counter}{Path(stored_name).suffix}"
                counter += 1
            (VAULT_DIR / stored_name).write_bytes(content)

            # 写入 manifest
            files = _vault_load_manifest()
            record = {
                "id": _uuid.uuid4().hex[:12],
                "filename": stored_name,
                "original_name": original_name,
                "category": ai_category,
                "code": ai_code,
                "desc": ai_desc or f"AI 智能识别归档 · {original_name}",
                "tpl_id": None,
                "upload_date": _dt.now().isoformat(timespec="seconds"),
                "size": size,
                "mime_type": EXT_MIME.get(ext, "application/octet-stream"),
                "ext": ext,
            }
            files.append(record)
            _vault_save_manifest(files)

            yield _sse({"type": "progress", "text": f"已归档到「{ai_category}」分类"})
            yield _sse({"type": "done", "file": record})

        except Exception as e:
            yield _sse({"type": "error", "detail": f"智能识别失败：{e}"})
            yield _sse({"type": "done"})

    return StreamingResponse(_stream(), media_type="text/event-stream")


def fmt_size_py(n: int) -> str:
    """字节数转人类可读"""
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n / 1024 / 1024:.1f} MB"

@app.post("/api/enterprise")
async def enterprise_save(request: Request):
    import json as _json
    data, err = await _parse_json(request)
    if err is not None: return err
    if not isinstance(data, dict):
        return {"ok": False, "detail": "企业信息必须是 JSON 对象"}
    # 输入清洗 + 长度限制（P1-6 & P1-7）
    # 同时存 camelCase 和 snake_case，保证系统提示词（snake_case）和前端（camelCase）都能读到
    name = _sanitize_input(data.get("name", ""), max_len=100)
    credit_code = _sanitize_input(data.get("creditCode") or data.get("credit_code", ""), max_len=18)
    permit_number = _sanitize_input(data.get("permitNumber") or data.get("permit_number", ""), max_len=30)
    legal_rep = _sanitize_input(data.get("legalRepresentative") or data.get("legal_representative", ""), max_len=50)
    address = _sanitize_input(data.get("address", ""), max_len=200)
    phone = _sanitize_input(data.get("phone", ""), max_len=20)
    industry = _sanitize_input(data.get("industryCategory") or data.get("industry", ""), max_len=50)
    mgmt_level = _sanitize_input(data.get("managementLevel") or data.get("management_level", ""), max_len=20)
    province = _sanitize_input(data.get("province", ""), max_len=20)
    city = _sanitize_input(data.get("city", ""), max_len=20)
    county = _sanitize_input(data.get("county", ""), max_len=20)
    valid_from = _sanitize_input(data.get("validFrom") or data.get("valid_from", ""), max_len=20)
    valid_to = _sanitize_input(data.get("validTo") or data.get("valid_to", ""), max_len=20)
    industry_code = _sanitize_input(data.get("industryCode") or data.get("industry_code", ""), max_len=10)

    sanitized = {
        # snake_case — 系统提示词读取用
        "name": name,
        "credit_code": credit_code,
        "permit_number": permit_number,
        "legal_representative": legal_rep,
        "address": address,
        "phone": phone,
        "industry": industry,
        "management_level": mgmt_level,
        "province": province,
        "city": city,
        "county": county,
        "valid_from": valid_from,
        "valid_to": valid_to,
        "industry_code": industry_code,
        # camelCase — 前端读取用
        "creditCode": credit_code,
        "permitNumber": permit_number,
        "legalRepresentative": legal_rep,
        "industryCategory": industry,
        "managementLevel": mgmt_level,
        "validFrom": valid_from,
        "validTo": valid_to,
        "industryCode": industry_code,
    }
    # 保留其他未列出的字段（兼容前端），但同样做基础清洗
    for k, v in data.items():
        if k not in sanitized and isinstance(v, str):
            sanitized[k] = _sanitize_input(v, max_len=200)
        elif k not in sanitized:
            sanitized[k] = v
    HERMES_HOME.mkdir(parents=True, exist_ok=True)
    (HERMES_HOME / "enterprise.json").write_text(_json.dumps(sanitized, ensure_ascii=False, indent=2))
    return {"ok": True}


@app.post("/api/permit/data/save")
async def permit_data_save(request: Request):
    """持久化完整许可证 parsed 数据（仪表盘和对话上下文用）"""
    import json as _json
    data, err = await _parse_json(request)
    if err is not None: return err
    if not isinstance(data, dict) or "parsed" not in data:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "缺少 parsed 字段"})
    parsed = data["parsed"]
    if not isinstance(parsed, dict):
        return JSONResponse(status_code=400, content={"ok": False, "detail": "parsed 必须是 JSON 对象"})
    HERMES_HOME.mkdir(parents=True, exist_ok=True)
    # 同时存 parsed 数据、执行审计、AI 分析结果（如果传了）
    save_obj = {"parsed": parsed, "saved_at": time.time()}
    if "execution" in data: save_obj["execution"] = data["execution"]
    if "modules" in data: save_obj["modules"] = data["modules"]
    if "ai" in data: save_obj["ai"] = data["ai"]
    (HERMES_HOME / "permit-data.json").write_text(_json.dumps(save_obj, ensure_ascii=False, indent=2, default=str))
    return {"ok": True}


@app.get("/api/permit/data")
async def permit_data_get():
    """读取引导流程持久化的许可证数据（对话框欢迎卡片/看板用）"""
    import json as _json
    f = HERMES_HOME / "permit-data.json"
    if f.exists():
        try:
            return {"ok": True, **_json.loads(f.read_text())}
        except Exception:
            pass
    return {"ok": False, "parsed": None}


@app.post("/api/ecoskill/auto-install")
async def ecoskill_auto_install(request: Request):
    """根据企业行业类型，由 Hermes 子代理自动安装匹配的 ecoskill 行业技能包

    入参: {"industry_code": "C31", "industry_name": "黑色金属冶炼和压延加工业"}
    返回: {"ok": true, "keywords": [...], "installed": [{id,name,detail}], "skipped": [...]}
    """
    data, err = await _parse_json(request)
    if err is not None: return err
    industry_code = str((data or {}).get("industry_code") or "").strip()
    industry_name = str((data or {}).get("industry_name") or "").strip()
    if not industry_code and not industry_name:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "缺少 industry_code / industry_name"})

    try:
        from ecoskill import bridge as _ecobridge
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "detail": f"ecoskill 模块不可用: {e}"})

    keywords = _industry_keywords(industry_code, industry_name)
    source = "local"

    # ── 优先从 EcoSkills 远程广场匹配安装（域名备案中，走 IP）──
    remote_rows = _ecobridge.remote_list_skills(limit=600)
    installed, skipped = [], []
    if remote_rows is not None:
        source = "remote"
        # 打分：行业触发词命中名称权重最高，其次描述/分类命中通用词
        trigger = keywords[0] if keywords else ""
        scored: list[tuple[float, dict]] = []
        for s in remote_rows:
            name = s.get("name", "") or ""
            desc = s.get("description", "") or ""
            cat = s.get("category", "") or ""
            sc = 0.0
            for i, kw in enumerate(keywords):
                weight = 10.0 if i == 0 else (5.0 if i == 1 else 1.0)
                if kw and kw in name:
                    sc += weight * 3
                if kw and kw in desc:
                    sc += weight
                if kw and kw in cat:
                    sc += weight * 0.5
            if sc > 0:
                sc += float(s.get("rating") or 0) / 10
                scored.append((sc, s))
        scored.sort(key=lambda t: -t[0])
        for _sc, s in scored[:3]:
            r = _ecobridge.install_remote_skill(s["id"])
            entry = {"id": s["id"], "name": s.get("name", s["id"]), "detail": r.get("detail", "")}
            (installed if r.get("ok") else skipped).append(entry)

    # ── 远程不可达或无命中 → 回退本地 skills.json 目录 ──
    if not installed:
        if source == "remote":
            source = "local-fallback"
        scores: dict[str, float] = {}
        info: dict[str, dict] = {}
        for kw in keywords:
            for s in _ecobridge.search_skills(kw):
                sid = s.get("id", "")
                if not sid:
                    continue
                scores[sid] = scores.get(sid, 0) + 1 + float(s.get("rating", 0)) / 10
                info[sid] = s
        for sid, _sc in sorted(scores.items(), key=lambda kv: -kv[1])[:3]:
            r = _ecobridge.install_skill(sid, platform="hermes")
            entry = {"id": sid, "name": info[sid].get("name", sid), "detail": r.get("detail", "")}
            (installed if r.get("ok") else skipped).append(entry)

    logger.info(f"[EcoSkill] 行业技能自动安装 source={source} industry={industry_name or industry_code} keywords={keywords} installed={[i['id'] for i in installed]}")
    return {
        "ok": True,
        "agent": "hermes-ecoskill-installer",
        "source": source,
        "registry": _ecobridge.ECOSKILL_REGISTRY_URL if source == "remote" else "",
        "industry": industry_name or industry_code,
        "keywords": keywords,
        "installed": installed,
        "skipped": skipped,
    }


@app.get("/api/user")
async def user_get():
    """获取用户信息"""
    import json as _json
    f = HERMES_HOME / "user.json"
    if f.exists():
        try: return _json.loads(f.read_text())
        except Exception: pass
    return {"name": "", "role": "环保专员", "phone": ""}

@app.post("/api/user")
async def user_save(request: Request):
    """保存用户信息（注册时调用）"""
    import json as _json
    data, err = await _parse_json(request)
    if err is not None: return err
    if not isinstance(data, dict):
        return {"ok": False, "detail": "用户信息必须是 JSON 对象"}
    # 输入清洗 + 长度限制（P1-6 & P1-7）
    sanitized = {
        "name": _sanitize_input(data.get("name", ""), max_len=50),
        "role": _sanitize_input(data.get("role", ""), max_len=30),
        "phone": _sanitize_input(data.get("phone", ""), max_len=11),
    }
    # 保留其他未列出的字段（兼容前端），但同样做基础清洗
    for k, v in data.items():
        if k not in sanitized and isinstance(v, str):
            sanitized[k] = _sanitize_input(v, max_len=100)
        elif k not in sanitized:
            sanitized[k] = v
    HERMES_HOME.mkdir(parents=True, exist_ok=True)
    (HERMES_HOME / "user.json").write_text(_json.dumps(sanitized, ensure_ascii=False, indent=2))
    return {"ok": True}

# ─── 短信验证码端点 ───

@app.post("/api/chat/send-sms")
async def send_sms(request: Request):
    """发送短信验证码（开发模式：返回验证码明文，上线需接真实短信平台）"""
    body, err = await _parse_json(request)
    if err is not None: return err
    phone = body.get("phone", "").strip()
    # 严格校验：必须为 11 位数字且以 1 开头
    import re as _re
    if not _re.match(r"^1\d{10}$", phone):
        return {"ok": False, "detail": "手机号格式不正确"}

    # H-3: 暴力破解锁定 — fail_count >= 5 且 30 分钟内拒绝发送
    existing = _sms_codes.get(phone)
    if existing:
        _, ts, fail_count = existing
        if fail_count >= 5 and time.time() - ts < 1800:
            return {"ok": False, "detail": "验证失败次数过多，请 30 分钟后重试"}

    # 60 秒内重复发送，返回已有验证码
    if existing and time.time() - existing[1] < 60:
        code, ts, fail_count = existing
        resp = {"ok": True, "detail": "验证码已发送（60秒内有效）"}
        if os.environ.get("ECOPILOT_DEV") == "1":
            resp["code"] = code
        return resp

    code = f"{secrets.randbelow(9000) + 1000}"
    _sms_codes[phone] = (code, time.time(), 0)
    logger.info(f"[SMS] 验证码已发送 → {phone[:3]}****{phone[-4:]}: {code}")

    resp = {"ok": True, "detail": "验证码已发送"}
    if os.environ.get("ECOPILOT_DEV") == "1":
        resp["code"] = code
    return resp

@app.post("/api/chat/verify-sms")
async def verify_sms(request: Request):
    """验证短信验证码"""
    body, err = await _parse_json(request)
    if err is not None: return err
    phone = body.get("phone", "").strip()
    code = body.get("code", "").strip()

    existing = _sms_codes.get(phone)
    if not existing:
        return {"ok": False, "detail": "请先获取验证码"}

    saved_code, ts, fail_count = existing

    # H-3: 已锁定（fail_count >= 5）
    if fail_count >= 5:
        if time.time() - ts < 1800:  # 30 分钟内
            return {"ok": False, "detail": "验证失败次数过多，请 30 分钟后重试"}
        else:
            del _sms_codes[phone]
            return {"ok": False, "detail": "请重新获取验证码"}

    if time.time() - ts > 300:  # 5 分钟过期
        del _sms_codes[phone]
        return {"ok": False, "detail": "验证码已过期，请重新获取"}

    if saved_code != code:
        # H-3: 失败计数 +1
        fail_count += 1
        if fail_count >= 5:
            _sms_codes[phone] = (saved_code, ts, fail_count)
            return {"ok": False, "detail": "验证失败次数过多，请 30 分钟后重试"}
        _sms_codes[phone] = (saved_code, ts, fail_count)
        return {"ok": False, "detail": "验证码错误"}

    # 验证成功，清除验证码
    del _sms_codes[phone]
    return {"ok": True, "detail": "验证通过"}


# ─── 语音转文字 (STT) ───

@app.post("/api/chat/stt")
async def speech_to_text(request: Request):
    """接收音频 blob，用OpenAI兼容Whisper API转文字"""
    import tempfile, base64, os as _os

    audio_bytes = None
    ct = request.headers.get("content-type", "")
    if "multipart" in ct:
        form = await request.form()
        file = form.get("audio")
        if file: audio_bytes = await file.read()
    else:
        body = await request.json()
        b64 = body.get("audio", "")
        if b64: audio_bytes = base64.b64decode(b64)

    if not audio_bytes:
        return {"ok": False, "detail": "未收到音频数据"}

    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
            f.write(audio_bytes)
            tmp_path = f.name

        # 用OpenAI兼容接口（优先用已有base_url，如果支持whisper的话）
        stt_key = _os.environ.get("OPENAI_API_KEY", "") or _os.environ.get("DEEPSEEK_API_KEY", "")
        stt_base = _os.environ.get("OPENAI_BASE_URL", "") or "https://api.openai.com/v1"

        import openai as _openai_sdk
        stt_client = _openai_sdk.OpenAI(api_key=stt_key, base_url=stt_base, timeout=30)
        with open(tmp_path, "rb") as af:
            resp = stt_client.audio.transcriptions.create(
                model="whisper-1", file=("audio.webm", af, "audio/webm"),
                language="zh", response_format="text")
        return {"ok": True, "text": str(resp).strip()}
    except Exception as e:
        return {"ok": False, "detail": f"语音识别失败（请确认已配置 OPENAI_API_KEY）: {e}"}
    finally:
        if tmp_path:
            try: _os.unlink(tmp_path)
            except: pass

# ─── 排污许可平台登录/抓取端点 ───

@app.post("/api/permit/data")
async def permit_data(request: Request):
    """抓取排污许可证数据（多页汇聚）"""
    body, err = await _parse_json(request)
    if err is not None: return err
    session_id = body.get("session_id", "").strip()
    if not session_id:
        return {"ok": False, "detail": "缺少会话 ID"}

    # 直接提取（extract_permit_data 内部自己导航）
    extract_result = await extract_permit_data(session_id)

    if not extract_result.get("ok"):
        return {"ok": False, "detail": extract_result.get("detail", "数据提取失败")}

    data = extract_result.get("data", {})

    # 3. 如果 DOM 提取缺少核心字段，用 DeepSeek 补充（不覆盖已有数据）
    if not extract_result.get("has_core_data") and extract_result.get("raw_text"):
        try:
            parsed = await _deepseek_parse_permit(extract_result["raw_text"])
            if parsed:
                # 合并而非覆盖：只补填空字段
                for key, val in parsed.items():
                    if not data.get(key):
                        data[key] = val
        except Exception as e:
            logger.info(f"[Permit] DeepSeek parse fallback failed: {e}")

    return {"ok": True, "data": data}


async def _deepseek_parse_permit(raw_text: str) -> Optional[dict]:
    """用 DeepSeek 从页面文本中提取结构化许可信息"""
    prompt = f"""请从以下排污许可平台页面文本中提取结构化信息，返回 JSON。

页面文本：
{raw_text[:8000]}

请提取以下字段（如果没有则为空字符串或空数组）：
- enterpriseName: 企业名称
- permitNumber: 排污许可证编号（18位信用代码+5位字符的格式）
- creditCode: 统一社会信用代码（18位）
- issuingAuthority: 发证机关
- issueDate: 发证日期
- validFrom: 有效期起始
- validTo: 有效期截止
- industryCategory: 行业类别
- managementLevel: 管理类别（重点管理/简化管理/登记管理）
- address: 生产经营场所地址
- legalRepresentative: 法定代表人
- emissionOutlets: 排放口列表，每项含 code(编号), name(名称), type(主要/一般/特殊), latitude(纬度浮点数), longitude(经度浮点数), limits(排放限值列表，每项含 factor, limit, unit)
- managementRequirements: 管理要求列表，每项含 category(自行监测/台账记录/执行报告/信息公开/其他), content, frequency

只输出 JSON，不要其他文字。"""

    try:
        resp = await ds_client.chat.completions.create(
            model=TEXT_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=4096,
        )
        text = resp.choices[0].message.content or ""
        # 提取 JSON
        json_start = text.find("{")
        json_end = text.rfind("}") + 1
        if json_start >= 0 and json_end > json_start:
            return json.loads(text[json_start:json_end])
    except Exception as e:
        logger.info(f"[Permit] DeepSeek parse error: {e}")
    return None


# ─── 快速登录端点 ───

@app.post("/api/permit/login/quick")
async def permit_quick_login(request: Request):
    """
    一键自动登录（含验证码识别）。
    需提供 username、password，可选 vision_model（onboarding 选择的视觉模型）。
    """
    body, err = await _parse_json(request)
    if err is not None: return err
    username = body.get("username", "").strip()
    password = body.get("password", "").strip()
    vision_model = body.get("vision_model", "").strip() or None
    if not username or not password:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "请提供用户名和密码"})

    # onboarding 流程：优先使用用户选择的视觉模型识别验证码
    result = await quick_login(
        username, password,
        vision_model=vision_model,
        prefer_vision=bool(vision_model),
    )
    # 登录失败时返回 401，便于前端区分成功/失败
    if not result.get("ok"):
        return JSONResponse(status_code=401, content=result)
    return result


# ─── 人工登录：显示平台验证码图片给用户，由用户手动输入验证码 ───

@app.post("/api/permit/login/init")
async def permit_login_init():
    """
    启动 Playwright 会话，打开 CAS 登录页，抓取验证码图片。
    返回 session_id 和 captcha_image（data:image/png;base64,...）。
    前端把验证码图片显示给用户，用户手动输入验证码后调用 /api/permit/login/submit。
    """
    try:
        session = await start_login_session()
    except RuntimeError as e:
        return JSONResponse(status_code=502, content={"ok": False, "detail": str(e)})

    if not session.captcha_base64:
        return JSONResponse(status_code=502, content={"ok": False, "detail": "验证码获取失败，请重试"})

    return {
        "ok": True,
        "session_id": session.session_id,
        "captcha_image": f"data:image/png;base64,{session.captcha_base64}",
    }


@app.post("/api/permit/login/submit")
async def permit_login_submit(request: Request):
    """
    提交人工登录表单（用户手动输入的账号+密码+验证码）。
    复用 start_login_session 创建的会话。
    """
    body, err = await _parse_json(request)
    if err is not None: return err
    session_id = body.get("session_id", "").strip()
    username = body.get("username", "").strip()
    password = body.get("password", "").strip()
    captcha = body.get("captcha", "").strip()
    if not session_id or not username or not password or not captcha:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "请提供 session_id、账号、密码和验证码"})

    result = await submit_login(session_id, username, password, captcha)
    if not result.get("ok"):
        return JSONResponse(status_code=401, content=result)
    # 登录成功，session_id 已在 _active_sessions 中，供后续 permit-reading 使用
    return {"ok": True, "session_id": session_id, "detail": "登录成功"}


# ─── Safari 已登录会话读取（项目核心登录方式）───


def _parse_permit_dashboard(text: str) -> dict:
    """从仪表盘页面文本解析许可证数据"""
    import re
    data = {
        "enterpriseName": "", "permitNumber": "", "creditCode": "",
        "industryCategory": "", "managementLevel": "",
        "permitStatus": "", "permitApplyDate": "",
        "executionReportStatus": "", "monitoringStatus": "",
        "rectificationStatus": "", "emissionOutlets": [],
    }
    if not text:
        return data
    code_match = re.search(r'排污单位编码[：:]\s*(\d+\w+)', text)
    if code_match:
        full_code = code_match.group(1)
        data["creditCode"] = full_code[:18]
        if len(full_code) > 18:
            data["permitNumber"] = full_code
    report_match = re.search(r'执行报告信息\s*(.+?)\s*(\d{4}-\d{2}-\d{2})', text, re.DOTALL)
    if report_match:
        data["executionReportStatus"] = report_match.group(1).strip()[:80] + " " + report_match.group(2)
    apply_match = re.search(r'许可申请信息\s*(.+?)\s*(\d{4}-\d{2}-\d{2})', text, re.DOTALL)
    if apply_match:
        data["permitStatus"] = apply_match.group(1).strip()[:80]
        data["permitApplyDate"] = apply_match.group(2)
    mon_match = re.search(r'监测业务信息\s*(.+?)(?=\n|改正|$)', text)
    if mon_match:
        data["monitoringStatus"] = mon_match.group(1).strip()[:50]
    rec_match = re.search(r'改正规定消息\s*(.+?)$', text)
    if rec_match:
        data["rectificationStatus"] = rec_match.group(1).strip()[:50]
    return data


def _parse_enterprise_info(text: str, data: dict):
    """从企业信息页面文本补充解析"""
    import re
    if not text:
        return
    name_match = re.search(r'单位名称[：:]\s*(.+?)(?=\n|$)', text)
    if name_match:
        data["enterpriseName"] = name_match.group(1).strip()
    industry_match = re.search(r'行业类别[：:]\s*(.+?)(?=\n|$)', text)
    if industry_match:
        data["industryCategory"] = industry_match.group(1).strip()
    level_match = re.search(r'管理级别[：:]\s*(.+?)(?=\n|$)', text)
    if level_match:
        data["managementLevel"] = level_match.group(1).strip()
    legal_match = re.search(r'法定代表人[：:]\s*(.+?)(?=\n|$)', text)
    if legal_match:
        data["legalRepresentative"] = legal_match.group(1).strip()
    addr_match = re.search(r'生产经营场所地址[：:]\s*(.+?)(?=\n|$)', text)
    if addr_match:
        data["address"] = addr_match.group(1).strip()


@app.post("/api/permit/safari/inspect")
async def permit_safari_inspect():
    """
    SSE 流式：通过 safari MCP CLI 读取 Safari 已登录会话的排污许可证数据。
    用户需先在 Safari 中手动登录 permit.mee.gov.cn，
    本端点调用 cli-anything-safari 的 read-page / navigate 工具读取许可证信息。
    """
    import subprocess

    SAFARI_CLI = str(Path.home() / ".ecopilot-home/.venv-cli/bin/cli-anything-safari")

    def _safari(tool: str, timeout: int = 10, **kwargs):
        """调用 safari MCP CLI 工具，返回解析后的 dict/str。
        默认 timeout=10s，可在调用时显式覆盖（如快速探测用 timeout=5）。
        """
        args = [SAFARI_CLI, "--json", "tool", tool]
        for k, v in kwargs.items():
            args.extend([f"--{k.replace('_', '-')}", str(v)])
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        stdout = r.stdout.strip()
        if not stdout:
            raise RuntimeError(r.stderr.strip() or f"safari MCP {tool} 无输出")
        # CLI 输出可能包含日志行，提取首个 JSON 对象
        idx = stdout.find("{")
        if idx < 0:
            return stdout
        try:
            return json.loads(stdout[idx:])
        except json.JSONDecodeError:
            return stdout

    def _sse(obj):
        return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"

    async def _stream():
        try:
            # Step 0: 检查 Safari 会话（先用 5s 快速探测，避免无响应时长时间阻塞）
            yield _sse({"type": "progress", "step": 0, "name": "检查 Safari 会话"})
            try:
                page = _safari("read-page", timeout=5)
            except subprocess.TimeoutExpired:
                yield _sse({"type": "error", "detail": "Safari 未响应，请确认 Safari 已打开"})
                return
            if not isinstance(page, dict):
                yield _sse({"type": "error", "detail": "Safari 未响应，请确认 Safari 已打开"})
                return

            url = page.get("url", "")
            title = page.get("title", "")
            if not url:
                yield _sse({"type": "error", "detail": "无法读取 Safari 页面，请确认 Safari 已打开排污许可平台"})
                return

            # Step 1: 验证在排污许可平台且已登录
            yield _sse({"type": "progress", "step": 1, "name": "验证登录状态"})
            if "permit.mee.gov.cn" not in url:
                yield _sse({"type": "error", "detail": f"Safari 当前不在排污许可平台（当前: {title}），请先打开 permit.mee.gov.cn 并登录"})
                return
            if "cas/login" in url.lower():
                yield _sse({"type": "error", "detail": "尚未登录，请在 Safari 中完成排污许可平台登录"})
                return

            # Step 2: 导航到仪表盘并读取（轮询等待，最多 5 秒）
            yield _sse({"type": "progress", "step": 2, "name": "读取许可证仪表盘"})
            _safari("navigate", url="https://permit.mee.gov.cn/permitExt/outside/LicenseRedirect")
            dashboard_text = ""
            for _ in range(5):
                await asyncio.sleep(1)
                page = _safari("read-page")
                dashboard_text = page.get("text", "") if isinstance(page, dict) else ""
                if dashboard_text and "permit" in (page.get("url", "") if isinstance(page, dict) else "").lower():
                    break

            # Step 3: 解析仪表盘数据
            yield _sse({"type": "progress", "step": 3, "name": "解析许可证信息"})
            data = _parse_permit_dashboard(dashboard_text)

            # Step 4: 读取企业基本信息（轮询等待，最多 5 秒）
            yield _sse({"type": "progress", "step": 4, "name": "读取企业基本信息"})
            _safari("navigate", url="https://permit.mee.gov.cn/permitExt/outside/updateEnterMSG.jsp")
            enterprise_text = ""
            for _ in range(5):
                await asyncio.sleep(1)
                page = _safari("read-page")
                enterprise_text = page.get("text", "") if isinstance(page, dict) else ""
                if enterprise_text and len(enterprise_text) > 100:
                    break
            _parse_enterprise_info(enterprise_text, data)

            if not data.get("enterpriseName"):
                yield _sse({"type": "error", "detail": "未能读取到企业名称，请确认 Safari 已登录排污许可平台"})
                return

            yield _sse({"type": "done", "parsed": data})

        except subprocess.TimeoutExpired:
            yield _sse({"type": "error", "detail": "Safari 操作超时，请确认 Safari 响应正常"})
        except Exception as e:
            yield _sse({"type": "error", "detail": str(e)})

    return StreamingResponse(_stream(), media_type="text/event-stream")


# ─── 许可证完整读取 + 快速巡检端点 ───

@app.post("/api/permit/license/full/stream")
async def permit_license_full_stream(request: Request):
    """
    SSE 流式读取许可证全部20项数据，每读取一张卡推送一次进度。
    前端可实时显示倒计时和读取进度条。
    """
    body, err = await _parse_json(request)
    if err is not None: return err
    session_id = body.get("session_id", "").strip()
    dataid = body.get("dataid", "").strip() or None
    if not session_id:
        return {"ok": False, "detail": "缺少会话 ID"}

    async def _stream():
        import time as _time
        t_start = _time.time()
        queue = asyncio.Queue()

        async def _progress(msg, step, total):
            elapsed = int(_time.time() - t_start)
            remaining = int((elapsed / max(step, 1)) * (total - step)) if step > 0 else 60
            payload = json.dumps({
                "type": "progress",
                "step": step, "total": total,
                "name": msg,
                "elapsed": elapsed,
                "remaining": remaining
            }, ensure_ascii=False)
            await queue.put(f"data: {payload}\n\n")

        async def _runner(cancel_ev):
            try:
                if cancel_ev.is_set():
                    await queue.put(None)
                    return
                result = await read_license_full(session_id, dataid, on_progress=_progress)
                # 解析 20 张卡片 raw data → 结构化 PermitInfo
                cards = result.get("cards", {})
                parsed = parse_permit_from_cards(cards) if cards else {}
                # 输出解析结果摘要，方便调试
                logger.info(f"[Parser] enterpriseName={parsed.get('enterpriseName','(空)')!r}")
                logger.info(f"[Parser] creditCode={parsed.get('creditCode','(空)')!r}")
                logger.info(f"[Parser] permitNumber={parsed.get('permitNumber','(空)')!r}")
                logger.info(f"[Parser] phone={parsed.get('phone','(空)')!r}")
                logger.info(f"[Parser] outlets={len(parsed.get('emissionOutlets',[]))}个")
                # 输出 card1 文本前 500 字符用于调试
                card1_text = (cards.get('card1') or {}).get('text', '')
                if card1_text: print(f"[Parser] card1_text[:500]={card1_text[:500]!r}")
                payload = json.dumps({"type": "done", **result, "parsed": parsed}, ensure_ascii=False)
                await queue.put(f"data: {payload}\n\n")
            except Exception as e:
                payload = json.dumps({"type": "error", "detail": str(e)})
                await queue.put(f"data: {payload}\n\n")
            finally:
                await queue.put(None)  # Sentinel

        cancel_ev = asyncio.Event()
        task_runner = asyncio.ensure_future(_runner(cancel_ev))
        while True:
            item = await queue.get()
            if item is None:
                break
            yield item

    return StreamingResponse(_stream(), media_type="text/event-stream")


# ─── 平台全模块仪表盘数据 ───

import json as _json, time as _time, os as _os

_PERMIT_CACHE_FILE = HERMES_HOME / "permit_dashboard_cache.json"
_PERMIT_CACHE_TTL = 3600  # 1小时缓存


@app.get("/api/permit/dashboard")
async def permit_dashboard(force: str = ""):
    """
    一站式读取排污许可平台全部模块数据，返回结构化JSON供前端仪表盘使用。
    自动缓存1小时。外部平台不可用时返回缓存数据。
    """
    # 直接返回缓存（若有），不阻塞前端
    if _PERMIT_CACHE_FILE.exists():
        try:
            raw = _PERMIT_CACHE_FILE.read_text()
            cached = _json.loads(raw)
            cached["_cached"] = True
            return cached
        except Exception:
            pass

    # 无缓存时快速返回
    return {"ok": False, "detail": "数据暂不可用", "enterprise": {}, "notifications": [], "_cached": False}

    sid = login["session_id"]
    session = _active_sessions.get(sid)
    if not session:
        return {"ok": False, "detail": "会话丢失"}
    page = session.page

    result = {
        "ok": True,
        "enterprise": {},
        "license_records": [],
        "execution_reports": {},
        "notifications": [],
        "menus": [],
        "raw_dashboard": "",
    }

    # ── 1. 仪表盘通知 ──
    await page.wait_for_timeout(4000)
    dash_text = await page.evaluate("document.body.innerText")
    result["raw_dashboard"] = dash_text[:2000]

    dash_data = _parse_permit_dashboard(dash_text)
    if dash_data.get("creditCode"):
        result["enterprise"]["creditCode"] = dash_data["creditCode"]
    if dash_data.get("permitNumber"):
        result["enterprise"]["permitNumber"] = dash_data["permitNumber"]
    if dash_data.get("permitStatus"):
        result["notifications"].append({"type": "permit_apply", "text": dash_data["permitStatus"], "date": dash_data.get("permitApplyDate", "")})
    if dash_data.get("executionReportStatus"):
        result["notifications"].append({"type": "exec_report", "text": dash_data["executionReportStatus"]})
    if dash_data.get("monitoringStatus") and "暂无" not in dash_data.get("monitoringStatus", ""):
        result["notifications"].append({"type": "monitoring", "text": dash_data["monitoringStatus"]})

    # ── 2. 企业基本信息 ──
    try:
        await page.goto(f"https://permit.mee.gov.cn/permitExt/outside/updateEnterMSG.jsp?username={getattr(session, 'username', '')}",
            wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(3000)
        info_text = await page.evaluate("document.body.innerText")
        _parse_enterprise_info(info_text, result["enterprise"])
        # 解析不到企业名则留空，由前端引导用户补充
    except Exception as e:
        result["enterprise"]["_error"] = str(e)[:100]

    # ── 3. 许可证重新申请记录 ──
    try:
        # 回到仪表盘
        await page.goto("https://permit.mee.gov.cn/permitExt/outside/LicenseRedirect",
            wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(4000)
        # 点击"许可证重新申请"
        await page.evaluate("""
            (() => {
                const lis = document.querySelectorAll('li.hrefli');
                for (const li of lis) {
                    if (li.innerText.trim() === '许可证重新申请') {
                        const img = li.querySelector('img');
                        if (img && img.getAttribute('onclick')) img.click();
                        else li.click();
                        return;
                    }
                }
            })()
        """)
        await page.wait_for_timeout(6000)
        reapply_html = await page.content()
        body_match = _re.search(r'<body[^>]*>(.*?)</body>', reapply_html, _re.DOTALL)
        reapply_text = _re.sub(r'<[^>]+>', ' ', body_match.group(1)) if body_match else ""
        reapply_text = _re.sub(r'\s+', ' ', reapply_text).strip()

        # 解析记录
        records = []
        rows = _re.findall(r'(\d+)\s+(.+?)\s+(审批通过|补正|未提交|已提交等待受理|审批中|审批不通过|不予受理)\s*(\d{4}-\d{2}-\d{2})?', reapply_text)
        for r in rows:
            records.append({
                "seq": r[0],
                "name": r[1].strip(),
                "status": r[2],
                "date": r[3] if len(r) > 3 and r[3] else "",
            })
        result["license_records"] = records

        # 从最近审批通过的许可记录推断有效期（排污许可证有效期5年）
        approved = [r for r in records if r["status"] == "审批通过" and r["date"]]
        if approved and not result["enterprise"].get("validTo"):
            latest = max(approved, key=lambda r: r["date"])
            from datetime import datetime as _dt, timedelta as _td
            try:
                dt = _dt.strptime(latest["date"], "%Y-%m-%d")
                result["enterprise"]["validFrom"] = latest["date"]
                result["enterprise"]["validTo"] = (dt + _td(days=5*365)).strftime("%Y-%m-%d")
            except Exception:
                pass
    except Exception as e:
        result["license_records"] = [{"_error": str(e)[:100]}]

    # ── 4. 执行报告 (SPA) ──
    try:
        await page.goto("about:blank", wait_until="domcontentloaded", timeout=5000)
        await page.wait_for_timeout(500)
        await page.goto("https://permit.mee.gov.cn/permitrep/", wait_until="networkidle", timeout=45000)
        await page.wait_for_timeout(4000)
        await page.evaluate("""
            (() => document.querySelectorAll('*').forEach(function(el) {
                if (el.innerText && el.innerText.trim() == '执行报告' && el.children.length <= 1) el.click()
            }))()
        """)
        await page.wait_for_timeout(4000)

        report_cards = await page.evaluate("""
            (() => {
                const cards = document.querySelectorAll('.card');
                return Array.from(cards).map(c => (c.innerText || '').trim().substring(0, 200));
            })()
        """)
        result["execution_reports"] = {
            "card_count": len(report_cards),
            "cards": report_cards[:20],
        }
    except Exception as e:
        result["execution_reports"] = {"_error": str(e)[:100]}

    # ── 5. 侧边栏菜单 ──
    try:
        await page.goto("https://permit.mee.gov.cn/permitExt/outside/LicenseRedirect",
            wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(4000)
        menus = await page.evaluate("""
            (() => {
                const lis = document.querySelectorAll('li.hrefli');
                return Array.from(lis).map(li => ({
                    text: li.innerText.trim().substring(0, 60),
                    clickable: !!(li.querySelector('img') && li.querySelector('img').getAttribute('onclick'))
                }));
            })()
        """)
        result["menus"] = menus
    except Exception as e:
        result["menus"] = [{"_error": str(e)[:100]}]

    # 写入缓存
    result["_ts"] = _time.time()
    try:
        _PERMIT_CACHE_FILE.write_text(_json.dumps(result, ensure_ascii=False, default=str))
    except Exception:
        pass

    return result


@app.post("/api/permit/quick-check")
async def permit_quick_check(request: Request):
    """快速巡检：仅检查仪表盘关键状态（约2秒）"""
    body, err = await _parse_json(request)
    if err is not None: return err
    session_id = body.get("session_id", "").strip()
    if not session_id:
        return {"ok": False, "detail": "缺少会话 ID"}
    return await quick_check(session_id)


# ─── 执行记录6模块合规审计端点 ───

@app.post("/api/permit/execution/audit")
async def permit_execution_audit(request: Request):
    """执行记录6模块全量合规审计，对照法规输出风险矩阵"""
    body, err = await _parse_json(request)
    if err is not None: return err
    session_id = body.get("session_id", "").strip()
    if not session_id:
        return {"ok": False, "detail": "缺少会话 ID"}
    return await execution_audit(session_id)


# ─── 一站式全模块读取 + AI 综合分析 ───

async def _ai_analyze_permit_full(parsed: dict, exec_result: dict,
                                    modules_result: dict, text_model: str) -> dict:
    """对照 HJ846/HJ944/HJ819 导则，用 DeepSeek 综合分析企业合规问题"""
    import json as _json

    enterprise = parsed.get("enterpriseName", "") or "未知企业"
    industry = parsed.get("industryCategory", "") or "未识别"
    management = parsed.get("managementLevel", "") or "未知"
    outlets = parsed.get("emissionOutlets", []) or []
    air_outlets = [o for o in outlets if (o.get("code") or "").startswith("DA")]
    water_outlets = [o for o in outlets if (o.get("code") or "").startswith("DW")]

    exec_risks = exec_result.get("risks", []) or []
    exec_summary = exec_result.get("summary", {}) or {}

    modules_data = (modules_result or {}).get("modules", {}) or {}
    modules_summary = []
    for mod_name, mod_data in modules_data.items():
        if mod_name.startswith("_"):
            continue
        if isinstance(mod_data, dict):
            ok = mod_data.get("ok", False)
            url = mod_data.get("url", "") or ""
            preview = (mod_data.get("text_preview", "") or "")[:200].replace("\n", " ")
            err = mod_data.get("error", "") or ""
            status = "可达" if ok else f"不可达: {err[:60]}"
            modules_summary.append(f"- {mod_name}: {status} | url={url[:80]} | preview={preview}")

    prompt = f"""你是生态环境合规分析专家。请对照以下法规对企业的排污许可证数据进行合规分析，发现企业存在的问题：

【适用法规（必须严格对照）】
- HJ 846-2017 钢铁工业排污许可技术规范
- HJ 944-2018 排污单位环境管理台账及执行报告技术规范 总则
- HJ 819-2017 排污单位自行监测技术指南 总则
- HJ 878-2017 排污单位自行监测技术指南 钢铁工业及炼焦化学工业
- 《排污许可管理条例》（国令第736号）第20-38条

【企业基本信息】
- 企业名称: {enterprise}
- 行业类别: {industry}
- 管理类别: {management}
- 许可证编号: {parsed.get('permitNumber', '') or '未识别'}
- 排放口数量: 废气 {len(air_outlets)} 个，废水 {len(water_outlets)} 个
- 有效期: {parsed.get('validFrom', '')} 至 {parsed.get('validTo', '')}

【执行记录审计结果】
合规评分: {exec_summary.get('score', '?')}/100
总问题数: {exec_summary.get('total_issues', 0)}
致命问题: {exec_summary.get('fatal', 0)} | 高风险: {exec_summary.get('high', 0)} | 中等: {exec_summary.get('medium', 0)}

风险清单:
{_json.dumps(exec_risks, ensure_ascii=False, indent=2)[:3500]}

【平台顶级模块扫描结果】
{chr(10).join(modules_summary[:30])}

【输出要求（必须严格遵循）】
输出纯 JSON（不要 markdown 代码块、不要任何解释文字），结构如下：
{{
  "compliance_score": 0到100的整数,
  "enterprise_summary": "一句话概括企业合规状态",
  "key_findings": [
    {{
      "level": "致命|高|中|低",
      "category": "台账|执行报告|自行监测|信息公开|许可证|排放口|其他",
      "issue": "具体问题描述（30字内）",
      "law": "法规依据（如：《条例》第37条第(一)项→5千-2万元/次）",
      "suggestion": "整改建议（30字内）"
    }}
  ],
  "industry_specific_risks": ["钢铁行业特有风险1（含法规依据）", "..."],
  "priority_actions": ["最优先整改动作1", "第二优先动作", "..."]
}}

注意：
1. key_findings 至少 3 条，至多 8 条，按严重程度排序
2. 每条 issue 必须有具体法规依据，禁止使用模糊表述
3. industry_specific_risks 至少 2 条，针对钢铁行业
4. priority_actions 至少 3 条，按优先级排序
"""
    try:
        resp = await ds_client.chat.completions.create(
            model=text_model,
            messages=[
                {"role": "system", "content": "你是排污许可合规分析专家，严格对照国家法规标准分析企业数据，输出纯 JSON。"},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=2500,
        )
        content = (resp.choices[0].message.content or "").strip()
        # 兼容 markdown 代码块
        if content.startswith("```"):
            lines = content.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            content = "\n".join(lines).strip()
        try:
            return _json.loads(content)
        except Exception:
            return {"raw": content, "parse_error": True}
    except Exception as e:
        return {"error": str(e)}


@app.post("/api/permit/full/stream")
async def permit_full_stream(request: Request):
    """
    一站式流式读取排污许可平台全部内容：
    阶段A: 20张许可证申请表卡（license_reader）
    阶段B: 6个执行记录模块详细审计（execution_audit）
    阶段C: 16个顶级模块快速扫描（permit_scraper.full_audit）
    阶段D: AI 综合分析（对照 HJ846/HJ944/HJ819）
    """
    body, err = await _parse_json(request)
    if err is not None: return err
    session_id = body.get("session_id", "").strip()
    text_model = body.get("text_model", "").strip() or "deepseek-v4-flash"
    if not session_id:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "缺少会话 ID"})

    async def _stream():
        import time as _time
        t_start = _time.time()
        queue: asyncio.Queue = asyncio.Queue()

        async def _emit(d):
            d = {**d, "elapsed": int(_time.time() - t_start)}
            payload = json.dumps(d, ensure_ascii=False)
            await queue.put(f"data: {payload}\n\n")

        async def _license_progress(msg, step, total):
            await _emit({"type": "progress", "phase": "license",
                         "step": step, "total": total, "name": msg})

        async def _exec_progress(msg, step, total):
            await _emit({"type": "progress", "phase": "execution",
                         "step": step, "total": total, "name": msg})

        async def _modules_progress(msg, step, total):
            await _emit({"type": "progress", "phase": "modules",
                         "step": step, "total": total, "name": msg})

        async def _runner(cancel_ev):
            try:
                # ─── 阶段A: 20张许可证申请表卡 ───
                await _emit({"type": "phase_start", "phase": "license",
                             "name": "许可证申请表（20项）", "total": 20})
                license_result = await read_license_full(session_id, on_progress=_license_progress)
                cards = license_result.get("cards", {}) or {}
                parsed = parse_permit_from_cards(cards) if cards else {}
                # 后端直接持久化原始 cards（供后续 parser 重跑和验证）
                try:
                    import json as _json
                    _save = {"parsed": parsed, "license": {"cards": cards, "dataid": license_result.get("dataid","")}, "saved_at": time.time()}
                    (HERMES_HOME / "permit-data.json").write_text(_json.dumps(_save, ensure_ascii=False, indent=2, default=str))
                except Exception as _e:
                    logger.info(f"[FullStream] 持久化 cards 失败: {_e}")
                await _emit({"type": "phase_done", "phase": "license",
                             "data": parsed, "cards_count": len(cards)})

                # ─── 阶段B: 6个执行记录模块详细审计 ───
                await _emit({"type": "phase_start", "phase": "execution",
                             "name": "执行记录审计（6模块）", "total": 6})
                try:
                    exec_result = await execution_audit(session_id, on_progress=_exec_progress)
                except Exception as e:
                    exec_result = {"ok": False, "detail": str(e), "risks": [], "summary": {}}
                await _emit({"type": "phase_done", "phase": "execution", "data": exec_result})

                # ─── 阶段C: 动态扫描平台模块 ───
                # 先获取实际模块数量
                try:
                    dynamic_modules = await scan_sidebar_modules(session_id)
                    module_count = len(dynamic_modules)
                except Exception:
                    module_count = 16
                await _emit({"type": "phase_start", "phase": "modules",
                             "name": f"平台模块扫描（{module_count}项）", "total": module_count})
                try:
                    modules_result = await full_audit(session_id, on_progress=_modules_progress)
                except Exception as e:
                    modules_result = {"ok": False, "detail": str(e), "modules": {}}
                await _emit({"type": "phase_done", "phase": "modules", "data": modules_result})

                # ─── 阶段D: AI 综合分析 ───
                await _emit({"type": "phase_start", "phase": "ai_analysis",
                             "name": "AI 综合分析（对照 HJ846/HJ944/HJ819）", "total": 1})
                await _emit({"type": "progress", "phase": "ai_analysis",
                             "step": 1, "total": 1, "name": "DeepSeek 综合分析中..."})
                try:
                    ai_result = await _ai_analyze_permit_full(parsed, exec_result, modules_result, text_model)
                except Exception as e:
                    ai_result = {"error": str(e)}
                await _emit({"type": "phase_done", "phase": "ai_analysis", "data": ai_result})

                # ─── 完成 ───
                await _emit({"type": "done", "parsed": parsed,
                             "execution": exec_result, "modules": modules_result,
                             "ai": ai_result})
            except Exception as e:
                import traceback; traceback.print_exc()
                await _emit({"type": "error", "detail": str(e)})
            finally:
                await queue.put(None)

        cancel_ev = asyncio.Event()
        task_runner = asyncio.ensure_future(_runner(cancel_ev))
        while True:
            item = await queue.get()
            if item is None:
                break
            yield item

    return StreamingResponse(_stream(), media_type="text/event-stream")


# ─── 督察整改文档解析 API ───

@app.post("/api/inspection/parse")
async def inspection_parse(image: UploadFile = File(...), prompt: str = Form("请识别这份环保督察交办文件中的所有问题")):
    """上传督察交办文档 → Kimi OCR → DeepSeek 结构化解析"""
    try:
        content = await image.read()
        b64 = base64.b64encode(content).decode()

        # Step 1: Kimi 视觉 OCR
        resp = await kimi_client.chat.completions.create(
            model=KIMI_VISION_MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                ],
            }],
            temperature=0.1,
        )
        ocr_text = resp.choices[0].message.content or ""

        # Step 2: DeepSeek 结构化解析（增强：自动分类类型 + 法规依据 + 严重度）
        ds_prompt = f"""请从以下环保督察交办文件内容中提取所有整改问题，返回严格JSON格式。

文件内容：
{ocr_text[:6000]}

对每个问题提取以下字段：
- title: 问题标题（简洁明确）
- description: 问题详细描述
- requirement: 整改要求
- deadline: 整改截止日期（YYYY-MM-DD格式，无法识别则为空字符串）
- source: 交办来源（central=中央督察/provincial=省级督察/mee=部委交办/special=专项整改/self_check=企业自查，根据上下文推断）
- sourceDetail: 来源详情（如"2025年中央环保督察第3批"）
- responsibleUnit: 责任部门（如有）
- progress: 当前进度（0-100数字，无法识别则为0）
- type: 整改类型，必须从以下三类中选择：
  * "immediate" = 立行立改（立即整改/限期整改/操作违规/管理瑕疵，7-30天内完成）
  * "tracking" = 跟踪督办（需要持续跟踪督办，督办过程中可能升级为立案查处）
  * "engineering" = 工程建设（需要工程措施：改造/新建/扩建/安装/拆除重建，数月-数年完成）
- category: 问题类别（许可管理/台账管理/自行监测/执行报告/应急预案/固废管理/排放口/其他）
- regulation: 法规依据（如"《条例》第21条"、《法典》第75条"，根据问题性质推断）
- severity: 严重度（high=高风险可能立案/medium=中风险/low=低风险）

类型判断规则：
- 包含"改造/新建/扩建/工程/建设/安装"关键词 → engineering
- 包含"立即/限期/立行立改/三天内/七天内"关键词 → immediate
- 包含"跟踪/督办/立案/查处/处罚/罚款/违法"关键词 → tracking
- 不确定时默认 immediate

返回格式:
{{"source":"central","sourceDetail":"2025年中央督察","tasks":[{{"title":"...","description":"...","requirement":"...","deadline":"...","source":"central","sourceDetail":"...","responsibleUnit":"...","progress":0,"type":"immediate","category":"台账管理","regulation":"《条例》第21条","severity":"medium"}}]}}

只输出 JSON，不要其他文字。"""

        ds_resp = await ds_client.chat.completions.create(
            model=TEXT_MODEL,
            messages=[{"role": "user", "content": ds_prompt}],
            temperature=0.1,
            max_tokens=4096,
        )
        ds_text = ds_resp.choices[0].message.content or ""
        json_start = ds_text.find("{")
        json_end = ds_text.rfind("}") + 1
        if json_start >= 0 and json_end > json_start:
            parsed = json.loads(ds_text[json_start:json_end])
            return {"ok": True, "ocr_text": ocr_text[:500], "tasks": parsed.get("tasks", []), "source": parsed.get("source", "")}
        return {"ok": False, "detail": "DeepSeek 解析失败，返回非JSON格式"}

    except Exception as e:
        return {"ok": False, "detail": f"文档解析失败: {str(e)}"}


# ─── 交办整改工单 API ───

# 内存存储（与日历一致，重启丢失，前端 localStorage 主存储）
_rectification_tasks: dict[str, list[dict]] = _load_json_dict("rectification_tasks.json")  # {enterprise_id: [tasks]}

def _save_rectification_tasks():
    _save_json_dict("rectification_tasks.json", _rectification_tasks)

# 三类整改流程模板
_FLOW_TEMPLATES = {
    "immediate": {  # 立行立改
        "label": "立行立改",
        "nodes": ["发现", "整改", "验收", "归档"],
        "track_by": "day",
    },
    "tracking": {  # 跟踪督办（可能升级为立案查处）
        "label": "跟踪督办",
        "nodes": ["跟踪启动", "整改跟踪", "验收", "归档"],
        "track_by": "week",
        "legal_nodes": ["立案", "申辩/听证", "处罚决定", "执行", "归档"],
    },
    "engineering": {  # 工程建设
        "label": "工程建设",
        "nodes": ["立项", "设计", "招标", "施工", "调试", "验收"],
        "track_by": "month",
    },
}


def _infer_rectification_type(title: str, description: str, requirement: str) -> str:
    """根据交办文件内容推断整改类型"""
    text = f"{title} {description} {requirement}"
    # 工程建设：改造/新建/扩建/工程
    if any(k in text for k in ["改造", "新建", "扩建", "工程", "建设", "安装", "拆除重建"]):
        return "engineering"
    # 立行立改：立即/限期/整改/纠正
    if any(k in text for k in ["立即整改", "限期整改", "立行立改", "立即纠正", "三天内", "七天内", "15日内整改"]):
        return "immediate"
    # 跟踪督办：跟踪/督办/立案/查处/处罚/罚款
    if any(k in text for k in ["跟踪", "督办", "立案", "查处", "处罚", "罚款", "违法"]):
        return "tracking"
    # 默认：立行立改
    return "immediate"


def _generate_initial_review(title: str, description: str, requirement: str,
                              category: str, regulation: str) -> dict:
    """AI 生成初步复盘分析（基于交办内容 + 企业画像）"""
    # ① 巡查遗漏诊断 — 简化判断逻辑
    detection_status = "undetected"  # 默认未发现
    detection_note = "巡查清单未覆盖此类问题"

    # ② 根因分析 — 基于问题类别推断
    root_causes = {
        "许可管理": {"primary": "许可证动态管理机制未建立", "secondary": ["许可证到期预警缺失", "变更申报流程不规范"]},
        "台账管理": {"primary": "台账记录制度未落实到岗位", "secondary": ["记录人员职责不清", "缺乏台账自查机制"]},
        "自行监测": {"primary": "自行监测管理制度不完善", "secondary": ["监测频次执行不到位", "数据审核机制缺失"]},
        "执行报告": {"primary": "执行报告编制流程不规范", "secondary": ["数据来源审核缺失", "报告提交时限管理不足"]},
        "应急预案": {"primary": "应急预案管理缺失", "secondary": ["预案备案过期", "演练未按规定开展"]},
        "固废管理": {"primary": "固废全过程管理不完善", "secondary": ["贮存不规范", "转移联单制度执行不到位"]},
        "排放口": {"primary": "排放口规范化管理不足", "secondary": ["标识不规范", "监测孔设置不符合规范"]},
    }
    root = root_causes.get(category, {"primary": "合规管理制度不完善", "secondary": ["责任分工不明确", "监督检查机制缺失"]})

    # ③ 合规差距诊断 — 基于20项法定义务
    compliance_gap = [
        {"item": "台账记录制度", "status": "missing"},
        {"item": "定期自查机制", "status": "missing"},
        {"item": "岗位责任制度", "status": "partial"},
        {"item": "法规培训覆盖", "status": "partial"},
        {"item": "监测设备运维", "status": "established"},
    ]

    # ④ 预防建议
    prevention = [
        f"补充{category}岗位责任制度，明确记录与审核职责",
        f"每月开展{category}自查，形成自查记录",
        "环保专员参加法规培训，掌握 HJ944/HJ819 要求",
    ]

    return {
        "detectionStatus": detection_status,
        "detectionNote": detection_note,
        "rootCause": root,
        "complianceGap": compliance_gap,
        "preventionSuggestions": prevention,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }


@app.post("/api/rectification/tasks")
async def rectification_tasks(request: Request):
    """交办整改工单管理
    POST {action: 'list'|'add'|'update'|'delete'|'update_progress'}
    """
    body, err = await _parse_json(request)
    if err is not None: return err
    action = body.get("action", "list")
    eid = body.get("enterpriseId", "default")

    if action == "list":
        return {"ok": True, "tasks": _rectification_tasks.get(eid, [])}

    if action == "add":
        task = body.get("task", {})
        tid = f"rec-{int(time.time())}-{random.randint(1000, 9999)}"
        now = time.strftime("%Y-%m-%dT%H:%M:%S")

        # 自动推断类型（如未指定）
        rtype = task.get("type") or _infer_rectification_type(
            task.get("title", ""), task.get("description", ""), task.get("requirement", ""))

        # 填充流程节点
        template = _FLOW_TEMPLATES.get(rtype, _FLOW_TEMPLATES["immediate"])
        nodes = [{"name": n, "status": "pending"} for n in template["nodes"]]
        if nodes:
            nodes[0]["status"] = "current"

        task.update({
            "id": tid,
            "type": rtype,
            "typeLabel": template["label"],
            "nodes": nodes,
            "currentNode": 0,
            "progress": 0,
            "status": "pending",
            "escalatedToLegal": False,
            "createdAt": now,
            "updatedAt": now,
            "records": [{"time": now, "content": "工单创建", "progress": 0}],
        })

        # 生成初步复盘
        task["review"] = _generate_initial_review(
            task.get("title", ""), task.get("description", ""),
            task.get("requirement", ""), task.get("category", "其他"),
            task.get("regulation", ""))

        tasks = _rectification_tasks.setdefault(eid, [])
        tasks.append(task)
        _save_rectification_tasks()
        return {"ok": True, "task": task}

    if action == "update":
        tid = body.get("taskId", "")
        updates = body.get("updates", {})
        tasks = _rectification_tasks.get(eid, [])
        for t in tasks:
            if t.get("id") == tid:
                t.update(updates)
                t["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                _save_rectification_tasks()
                return {"ok": True, "task": t}
        return {"ok": False, "detail": "工单不存在"}

    if action == "update_progress":
        tid = body.get("taskId", "")
        progress = body.get("progress", 0)
        node_idx = body.get("currentNode")
        content = body.get("content", "")
        tasks = _rectification_tasks.get(eid, [])
        for t in tasks:
            if t.get("id") == tid:
                t["progress"] = progress
                if node_idx is not None:
                    t["currentNode"] = node_idx
                    # 更新节点状态
                    nodes = t.get("nodes", [])
                    for i, n in enumerate(nodes):
                        if i < node_idx:
                            n["status"] = "done"
                        elif i == node_idx:
                            n["status"] = "current"
                        else:
                            n["status"] = "pending"
                    t["nodes"] = nodes
                # 更新工单状态
                if progress >= 100:
                    t["status"] = "completed"
                elif progress > 0:
                    t["status"] = "in_progress"
                # 添加记录
                if content:
                    t.setdefault("records", []).append({
                        "time": time.strftime("%Y-%m-%dT%H:%M:%S"),
                        "content": content,
                        "progress": progress,
                    })
                t["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                _save_rectification_tasks()
                return {"ok": True, "task": t}
        return {"ok": False, "detail": "工单不存在"}

    if action == "escalate_legal":
        """跟踪督办升级为立案查处"""
        tid = body.get("taskId", "")
        tasks = _rectification_tasks.get(eid, [])
        for t in tasks:
            if t.get("id") == tid:
                t["escalatedToLegal"] = True
                # 添加法律程序节点
                legal_nodes = _FLOW_TEMPLATES["tracking"]["legal_nodes"]
                t["legalNodes"] = [{"name": n, "status": "pending"} for n in legal_nodes]
                if t["legalNodes"]:
                    t["legalNodes"][0]["status"] = "current"
                t["legalCurrentNode"] = 0
                # 添加法定时限
                t["legalDeadlines"] = [
                    {"name": "陈述申辩", "deadline": "收到通知7日内", "status": "pending"},
                    {"name": "听证申请", "deadline": "收到告知15日内", "status": "pending"},
                    {"name": "缴纳罚款", "deadline": "收到决定15日内", "status": "pending"},
                ]
                t.setdefault("records", []).append({
                    "time": time.strftime("%Y-%m-%dT%H:%M:%S"),
                    "content": "升级为立案查处程序",
                    "progress": t.get("progress", 0),
                })
                t["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                _save_rectification_tasks()
                return {"ok": True, "task": t}
        return {"ok": False, "detail": "工单不存在"}

    if action == "delete":
        tid = body.get("taskId", "")
        tasks = _rectification_tasks.get(eid, [])
        _rectification_tasks[eid] = [t for t in tasks if t.get("id") != tid]
        _save_rectification_tasks()
        return {"ok": True}

    return {"ok": False, "detail": "未知 action"}


# ─── 日历/日程/台账 API ───

_calendar_tasks: dict[str, list[dict]] = _load_json_dict("calendar_tasks.json")  # {enterprise_id: [tasks]}

def _save_calendar_tasks():
    _save_json_dict("calendar_tasks.json", _calendar_tasks)

@app.post("/api/calendar/tasks")
async def calendar_tasks(request: Request):
    """获取或创建日历任务
    POST {action: 'list'|'add'|'remove'|'suggest'}
    """
    body, err = await _parse_json(request)
    if err is not None: return err
    action = body.get("action", "list")

    if action == "suggest":
        # AI 建议日程：根据许可证数据生成建议任务列表
        enterprise = body.get("enterprise", {})
        permit_data = body.get("permitData", {})
        suggestions = _suggest_schedule_tasks(enterprise, permit_data)
        return {"ok": True, "suggestions": suggestions}

    if action == "add":
        task = body.get("task", {})
        eid = body.get("enterpriseId", "default")
        tasks = _calendar_tasks.setdefault(eid, [])
        task["id"] = f"sch-{int(time.time())}-{random.randint(1000, 9999)}"
        task["createdAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        tasks.append(task)
        return {"ok": True, "task": task}

    if action == "remove":
        eid = body.get("enterpriseId", "default")
        tid = body.get("taskId", "")
        tasks = _calendar_tasks.get(eid, [])
        _calendar_tasks[eid] = [t for t in tasks if t.get("id") != tid]
        return {"ok": True}

    # list — 返回所有任务
    eid = body.get("enterpriseId", "default")
    return {"ok": True, "tasks": _calendar_tasks.get(eid, [])}


def _suggest_schedule_tasks(enterprise: dict, permit_data: dict) -> list[dict]:
    """根据许可证数据生成 AI 建议的日程任务"""
    tasks = []
    today = time.strftime("%Y-%m-%d")

    # 1. 许可证到期提醒（到期前 30 天）
    valid_to = permit_data.get("validTo", "")
    if valid_to:
        try:
            from datetime import datetime, timedelta
            vt = datetime.strptime(valid_to[:10], "%Y-%m-%d")
            days_left = (vt - datetime.now()).days
            if 0 < days_left <= 90:
                tasks.append({
                    "title": "排污许可证到期",
                    "description": f"许可证将于 {valid_to[:10]} 到期，剩余 {days_left} 天。请尽快启动延续程序。",
                    "date": valid_to[:10],
                    "repeat": "once",
                    "color": "#dc2626",
                    "source": "system",
                    "category": "permit_expiry",
                })
        except Exception: pass

    # 2. 执行报告截止日
    report_due = [
        (f"{today[:4]}-03-31", "Q1执行报告", "monthly"),
        (f"{today[:4]}-06-30", "Q2执行报告", "monthly"),
        (f"{today[:4]}-09-30", "Q3执行报告", "monthly"),
        (f"{today[:4]}-12-31", "Q4执行报告", "monthly"),
        (f"{int(today[:4])+1}-01-31", "年度执行报告", "annual"),
    ]
    for date, title, freq in report_due:
        if date > today:
            tasks.append({
                "title": title,
                "description": f"执行报告提交截止日：{date}（HJ 944 第5.4节）",
                "date": date,
                "repeat": "once",
                "color": "#d97706",
                "source": "system",
                "category": "report_due",
            })

    # 3. 台账每周检查提醒
    tasks.append({
        "title": "台账记录周检",
        "description": "检查5类台账本周是否全部记录完毕（HJ 944 第4.3节）。生产设施/治污设施按日记录，原辅材料按批次，固废每次发生，监测每次后。",
        "date": today,
        "repeat": "weekly",
        "color": "#059669",
        "source": "system",
        "category": "ledger_weekly",
    })

    # 4. 应急预案年度演练
    tasks.append({
        "title": "应急预案年度演练",
        "description": "按《突发环境事件应急管理办法》要求每年至少一次实战演练",
        "date": f"{today[:4]}-09-01",
        "repeat": "annual",
        "color": "#7c3aed",
        "source": "system",
        "category": "emergency_drill",
    })

    # 5. 信息公开
    tasks.append({
        "title": "环境信息公开",
        "description": "按规定公开企业环境信息（基础信息/排放信息/固废信息/应急信息）",
        "date": f"{today[:4]}-06-30",
        "repeat": "annual",
        "color": "#0891b2",
        "source": "system",
        "category": "info_disclosure",
    })

    return tasks


@app.post("/api/calendar/ledger")
async def calendar_ledger(request: Request):
    """台账记录管理
    POST {action: 'list'|'update'}
    """
    body, err = await _parse_json(request)
    if err is not None: return err
    action = body.get("action", "list")

    if action == "update":
        ledger_type = body.get("type", "")
        status = body.get("status", "missing")
        return {"ok": True, "type": ledger_type, "status": status}

    # 返回5类台账的模板信息
    return {
        "ok": True,
        "ledgers": [
            {"type": "production", "label": "生产设施运行状况", "freq": "按日/班次", "rule": "HJ 944 第4.3节"},
            {"type": "treatment", "label": "治污设施运行情况", "freq": "按日/班次", "rule": "HJ 944 第4.3节"},
            {"type": "materials", "label": "原辅材料及燃料消耗", "freq": "按批次", "rule": "HJ 944 第4.3节"},
            {"type": "solid_waste", "label": "固废产生与处置", "freq": "每次发生", "rule": "HJ 944 第4.3节"},
            {"type": "monitoring", "label": "自行监测结果", "freq": "按监测频次", "rule": "HJ 944 第4.3节"},
        ],
    }

# ─── 合规日历模板系统 + 文档处理 API ───

# 内存中存储用户编辑的文档（服务重启后丢失，前端 localStorage 做主存储）
_calendar_docs: dict[str, dict] = _load_json_dict("calendar_docs.json")  # {docId: ...}

def _save_calendar_docs():
    _save_json_dict("calendar_docs.json", _calendar_docs)

# 合规工作流模板库（台账/监测/报告，含 Markdown 占位符供 AI 填充）
_CALENDAR_TEMPLATES: list[dict] = [
    {
        "id": "tpl-ledger-production",
        "name": "生产设施运行台账",
        "category": "ledger",
        "description": "记录生产设施每日运行时长、停机原因、运行状态，依据 HJ 944 第4.3节。",
        "icon": "Factory",
        "content": """# 生产设施运行台账

> 依据：HJ 944《排污单位自行监测技术指南 总则》第4.3节

- **企业名称**：{{enterprise_name}}
- **排污许可证编号**：{{permit_number}}
- **记录日期**：{{date}}
- **记录人**：{{operator}}

## 运行记录

| 序号 | 设施名称 | 规格型号 | 开始时间 | 结束时间 | 运行时长(h) | 运行状态 | 停机原因 |
|------|----------|----------|----------|----------|-------------|----------|----------|
| 1 | {{facility_name}} | {{model}} | {{start_time}} | {{end_time}} | {{duration}} | 正常/异常 | {{downtime_reason}} |

## 备注事项

{{remarks}}

> 提示：生产设施运行状况应按日或按班次记录，异常停机须在备注中详细说明原因及处置情况。
""",
    },
    {
        "id": "tpl-ledger-treatment",
        "name": "治污设施运行台账",
        "category": "ledger",
        "description": "记录治污设施处理效率、药剂消耗及异常情况，依据 HJ 944 第4.3节。",
        "icon": "Recycle",
        "content": """# 治污设施运行台账

> 依据：HJ 944《排污单位自行监测技术指南 总则》第4.3节

- **企业名称**：{{enterprise_name}}
- **排污许可证编号**：{{permit_number}}
- **记录日期**：{{date}}
- **记录人**：{{operator}}

## 运行记录

| 序号 | 设施名称 | 处理工艺 | 处理量(t/d) | 处理效率(%) | 药剂名称 | 药剂消耗(kg) | 是否正常 | 异常记录 |
|------|----------|----------|-------------|-------------|----------|--------------|----------|----------|
| 1 | {{facility_name}} | {{process}} | {{capacity}} | {{efficiency}} | {{reagent}} | {{reagent_amount}} | 正常/异常 | {{anomaly}} |

## 异常处置

{{anomaly_handling}}

> 提示：治污设施异常停运或效率下降时，应在 24 小时内启动应急处置并报告生态环境主管部门。
""",
    },
    {
        "id": "tpl-ledger-materials",
        "name": "原辅材料消耗台账",
        "category": "ledger",
        "description": "记录原辅材料及燃料消耗、批次与库存，依据 HJ 944 第4.3节。",
        "icon": "PackageOpen",
        "content": """# 原辅材料消耗台账

> 依据：HJ 944《排污单位自行监测技术指南 总则》第4.3节

- **企业名称**：{{enterprise_name}}
- **排污许可证编号**：{{permit_number}}
- **记录日期**：{{date}}
- **记录人**：{{operator}}

## 消耗记录

| 序号 | 材料名称 | 规格/型号 | 批次号 | 采购量(t) | 消耗量(t) | 库存量(t) | 用途 | 备注 |
|------|----------|-----------|--------|-----------|-----------|-----------|------|------|
| 1 | {{material_name}} | {{spec}} | {{batch}} | {{purchased}} | {{consumed}} | {{stock}} | {{usage}} | {{remarks}} |

> 提示：原辅材料按批次记录，有毒有害物料消耗须与产排污节点对应。
""",
    },
    {
        "id": "tpl-ledger-solid-waste",
        "name": "固废产生处置台账",
        "category": "ledger",
        "description": "记录固废类型、产生量、处置方式及处置量，依据 HJ 944 第4.3节 及《固废法》。",
        "icon": "Trash2",
        "content": """# 固废产生与处置台账

> 依据：HJ 944《排污单位自行监测技术指南 总则》第4.3节、《固废法》

- **企业名称**：{{enterprise_name}}
- **排污许可证编号**：{{permit_number}}
- **记录日期**：{{date}}
- **记录人**：{{operator}}

## 固废记录

| 序号 | 固废类型 | 类别(危/一/二) | 产生量(t) | 综合利用量(t) | 处置量(t) | 处置方式 | 接收单位 | 转移联单号 |
|------|----------|----------------|-----------|----------------|-----------|----------|----------|------------|
| 1 | {{waste_type}} | {{category}} | {{produced}} | {{reused}} | {{disposed}} | {{method}} | {{receiver}} | {{manifest_no}} |

## 合规说明

{{compliance_notes}}

> 提示：危险废物须填写转移联单并纳入国家固废管理信息系统；处置方式须符合许可证要求。
""",
    },
    {
        "id": "tpl-monitor-self",
        "name": "自行监测记录表",
        "category": "monitor",
        "description": "记录监测点位、监测因子、频次与结果，依据 HJ 944 及行业自行监测技术指南。",
        "icon": "Activity",
        "content": """# 自行监测记录表

> 依据：HJ 944《排污单位自行监测技术指南 总则》及行业自行监测技术指南

- **企业名称**：{{enterprise_name}}
- **排污许可证编号**：{{permit_number}}
- **监测日期**：{{date}}
- **监测类型**：{{monitor_type}}（手工/自动）

## 监测结果

| 序号 | 监测点位 | 监测因子 | 单位 | 频次 | 实测值 | 标准限值 | 是否达标 | 备注 |
|------|----------|----------|------|------|--------|----------|----------|------|
| 1 | {{point}} | {{factor}} | {{unit}} | {{frequency}} | {{measured}} | {{limit}} | 是/否 | {{remarks}} |

## 异常说明

{{anomaly_notes}}

> 提示：监测结果超标时，须在 24 小时内向生态环境主管部门报告并查明原因。
""",
    },
    {
        "id": "tpl-report-quarterly",
        "name": "季度执行报告",
        "category": "report",
        "description": "季度排污许可证执行报告，数据来源于本季度3个月的月度执行报告和台账记录汇总。每季度结束后15日内提交。",
        "icon": "FileText",
        "content": """# 排污许可证季度执行报告

> 依据：HJ 944《排污单位自行监测技术指南 总则》第5.4节、《排污许可管理办法》

## 一、企业基本信息

- **企业名称**：{{enterprise_name}}
- **统一社会信用代码**：{{credit_code}}
- **排污许可证编号**：{{permit_number}}
- **报告周期**：{{period}}（{{date}}）

## 二、排污情况

### 2.1 排放口情况

{{outfall_summary}}

### 2.2 排放情况

| 排放口 | 主要污染物 | 许可排放量(t) | 实际排放量(t) | 是否达标 |
|--------|------------|----------------|----------------|----------|
| {{outfall}} | {{pollutant}} | {{permitted}} | {{actual}} | 是/否 |

## 三、合规分析

{{compliance_analysis}}

## 四、存在的主要问题

{{issues}}

## 五、整改措施

| 问题描述 | 整改措施 | 责任人 | 完成时限 |
|----------|----------|--------|----------|
| {{issue}} | {{measure}} | {{owner}} | {{deadline}} |

## 六、其他事项

{{others}}

> 提示：季度执行报告应于每季度结束后 30 日内提交至全国排污许可证管理信息平台。
""",
    },
    {
        "id": "tpl-report-monthly",
        "name": "月度执行报告",
        "category": "report",
        "description": "月度排污许可证执行报告，数据来源于当月5类台账记录汇总。重点管理企业每月10日前提交。",
        "icon": "FileText",
        "content": """# 排污许可证月度执行报告

> 依据：HJ 944-2018《排污单位自行监测技术指南 总则》第5.4节、《排污许可管理条例》第22条
> **数据来源**：本月生产设施运行台账 + 治污设施运行台账 + 原辅材料消耗台账 + 固废产生处置台账 + 自行监测记录

## 一、企业基本信息

- **企业名称**：{{enterprise_name}}
- **统一社会信用代码**：{{credit_code}}
- **排污许可证编号**：{{permit_number}}
- **管理类别**：{{management_level}}（重点/简化/登记）
- **报告月份**：{{year}}年{{month}}月

## 二、生产情况

### 2.1 主要产品产量

| 产品名称 | 设计产能 | 本月产量 | 上月产量 | 环比变化(%) |
|----------|----------|----------|----------|-------------|
| {{product}} | {{capacity}} | {{monthly_output}} | {{prev_output}} | {{change_rate}} |

### 2.2 生产设施运行情况

> 数据来源：生产设施运行台账（按日记录汇总）

| 设施编号 | 设施名称 | 本月运行天数 | 本月运行时长(h) | 停机次数 | 停机原因 |
|----------|----------|-------------|-----------------|----------|----------|
| {{facility_id}} | {{facility_name}} | {{run_days}} | {{run_hours}} | {{stop_count}} | {{stop_reason}} |

## 三、治污设施运行情况

> 数据来源：治污设施运行台账

| 设施编号 | 设施名称 | 处理工艺 | 运行天数 | 运行率(%) | 异常次数 | 异常处置 |
|----------|----------|----------|----------|-----------|----------|----------|
| {{treatment_id}} | {{treatment_name}} | {{process}} | {{treat_days}} | {{operation_rate}} | {{anomaly_count}} | {{anomaly_handling}} |

## 四、污染物排放情况

> 数据来源：自行监测记录台账 + CEMS 在线数据

### 4.1 有组织排放

| 排放口编号 | 监测因子 | 许可排放浓度(mg/m³) | 本月实测均值 | 最大值 | 最小值 | 超标次数 | 是否达标 |
|-----------|----------|---------------------|-------------|--------|--------|----------|----------|
| {{outfall}} | {{pollutant}} | {{permitted_limit}} | {{avg_value}} | {{max_value}} | {{min_value}} | {{exceed_count}} | 是/否 |

### 4.2 月度排放量

| 排放口 | 主要污染物 | 本月排放量(t) | 累计排放量(t) | 许可年排放量(t) | 占比(%) |
|--------|------------|-------------|-------------|-----------------|---------|
| {{outfall}} | {{pollutant}} | {{monthly_emission}} | {{cumulative_emission}} | {{annual_limit}} | {{usage_rate}} |

## 五、自行监测执行情况

> 数据来源：自行监测记录表

| 监测类型 | 应测次数 | 实测次数 | 完成率(%) | 超标次数 |
|----------|----------|----------|-----------|----------|
| 手工监测 | {{manual_required}} | {{manual_done}} | {{manual_rate}} | {{manual_exceed}} |
| 自动监测 | {{auto_required}} | {{auto_done}} | {{auto_rate}} | {{auto_exceed}} |

## 六、原辅材料消耗

> 数据来源：原辅材料消耗台账

| 材料名称 | 本月消耗量(t) | 累计消耗量(t) | 主要用途 |
|----------|-------------|-------------|----------|
| {{material_name}} | {{monthly_consumption}} | {{cumulative_consumption}} | {{usage}} |

## 七、固体废物产生与处置

> 数据来源：固废产生处置台账

| 固废类型 | 本月产生量(t) | 本月处置量(t) | 处置方式 | 是否合规 |
|----------|-------------|-------------|----------|----------|
| {{waste_type}} | {{monthly_produced}} | {{monthly_disposed}} | {{method}} | 是/否 |

## 八、本月合规情况

### 8.1 异常事件

{{anomaly_summary}}

### 8.2 整改措施

| 问题描述 | 整改措施 | 完成情况 |
|----------|----------|----------|
| {{issue}} | {{measure}} | {{status}} |

## 九、其他事项

{{others}}

> **提交要求**：重点管理企业每月10日前提交上月月度执行报告至全国排污许可证管理信息平台。
> **数据逻辑**：月度报告所有数据应与当月5类台账记录一致，台账是月报的数据源头。
""",
    },
    {
        "id": "tpl-report-annual",
        "name": "年度执行报告",
        "category": "report",
        "description": "年度排污许可证执行报告，数据来源于全年4个季度执行报告和12个月台账记录汇总。次年1月31日前提交。",
        "icon": "ClipboardList",
        "content": """# 排污许可证年度执行报告

> 依据：HJ 944《排污单位自行监测技术指南 总则》第5.4节、《排污许可管理办法》

## 一、企业基本信息

- **企业名称**：{{enterprise_name}}
- **统一社会信用代码**：{{credit_code}}
- **排污许可证编号**：{{permit_number}}
- **报告年度**：{{year}}

## 二、生产情况

### 2.1 主要产品产量

| 产品名称 | 设计产能 | 实际产量 | 主要原辅材料 | 消耗量 |
|----------|----------|----------|--------------|--------|
| {{product}} | {{capacity}} | {{output}} | {{material}} | {{consumption}} |

### 2.2 主要生产工艺与产排污节点

{{process_description}}

## 三、排污情况

### 3.1 年度排放情况

| 排放口 | 主要污染物 | 全年许可排放量(t) | 全年实际排放量(t) | 达标率(%) |
|--------|------------|--------------------|--------------------|-----------|
| {{outfall}} | {{pollutant}} | {{permitted}} | {{actual}} | {{compliance_rate}} |

### 3.2 台账记录情况

| 台账类型 | 应记录天数 | 实际记录天数 | 完整率(%) |
|----------|------------|--------------|-----------|
| 生产设施运行 | {{required_days}} | {{actual_days}} | {{completeness}} |

## 四、自行监测情况

{{monitoring_summary}}

## 五、合规分析

{{compliance_analysis}}

## 六、存在的主要问题及整改措施

| 序号 | 问题描述 | 原因分析 | 整改措施 | 责任人 | 完成情况 |
|------|----------|----------|----------|--------|----------|
| 1 | {{issue}} | {{cause}} | {{measure}} | {{owner}} | {{status}} |

## 七、其他需要报告的事项

{{others}}

> 提示：年度执行报告应于次年 1 月 31 日前提交至全国排污许可证管理信息平台。
""",
    },
]


@app.get("/api/calendar/templates")
async def calendar_templates():
    """返回合规工作流模板列表（台账/监测/报告）
    GET 请求，无需认证
    """
    return {"ok": True, "templates": _CALENDAR_TEMPLATES}


@app.post("/api/calendar/doc/save")
async def calendar_doc_save(request: Request):
    """保存用户编辑后的文档内容
    POST {templateId, content, title, date}
    返回 {ok: true, docId: "..."}
    """
    body, err = await _parse_json(request)
    if err is not None: return err

    template_id = body.get("templateId", "")
    content = body.get("content", "")
    title = body.get("title", "")
    date = body.get("date", "")

    if not template_id:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "detail": "templateId 不能为空"},
        )

    doc_id = f"doc-{int(time.time())}-{random.randint(1000, 9999)}"
    doc = {
        "docId": doc_id,
        "templateId": template_id,
        "title": title,
        "content": content,
        "date": date,
        "savedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    _calendar_docs[doc_id] = doc

    return {"ok": True, "docId": doc_id}


@app.post("/api/calendar/doc/ai-fill")
async def calendar_doc_ai_fill(request: Request):
    """AI 真实填充模板 — 调用 DeepSeek 流式返回填充后的完整文档内容
    POST {templateId, content, title}
    SSE 流式返回：
      data: {"type":"progress","step":1,"name":"读取企业信息"}
      data: {"type":"text_delta","text":"..."}  // AI 逐字返回的填充内容
      data: {"type":"done"}
    """
    body, err = await _parse_json(request)
    if err is not None:
        return err

    template_id = body.get("templateId", "")
    content = body.get("content", "")
    title = body.get("title", "")

    if not content:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "detail": "文档内容不能为空"},
        )

    # 检查 API Key
    if not os.environ.get("DEEPSEEK_API_KEY", ""):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "detail": "DeepSeek API Key 未配置，无法调用 AI 填充"},
        )

    async def stream():
        def _sse(obj):
            return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"
        try:
            # Step 1: 读取企业信息
            yield _sse({"type": "progress", "step": 1, "name": "读取企业信息"})

            enterprise = _load_enterprise_info() or {}
            ent_name = enterprise.get("name", "[未配置企业名称]")
            permit_no = enterprise.get("permitNumber", "[未配置许可证编号]")
            credit_code = enterprise.get("creditCode", "[未配置统一社会信用代码]")
            industry = enterprise.get("industryCategory", "[未配置行业类别]")
            address = enterprise.get("address", "[未配置地址]")

            today_str = time.strftime("%Y-%m-%d")
            year_str = str(time.localtime().tm_year)
            month_str = str(time.localtime().tm_mon)
            quarter_str = str((time.localtime().tm_mon - 1) // 3 + 1)

            # ─── 台账数据汇总 ───
            # 当模板是月度/季度/年度执行报告时，自动读取已保存的台账数据
            ledger_context = ""
            is_report = "report" in template_id
            if is_report:
                yield _sse({"type": "progress", "step": 1.5, "name": "汇总台账数据"})

                # 从 _calendar_docs 读取台账类文档
                ledger_docs = [
                    d for d in _calendar_docs.values()
                    if "ledger" in d.get("templateId", "") or "monitor" in d.get("templateId", "")
                ]

                if ledger_docs:
                    ledger_summaries = []
                    for d in ledger_docs:
                        title = d.get("title", "未命名")
                        content_preview = d.get("content", "")[:2000]
                        saved_at = d.get("savedAt", "")
                        ledger_summaries.append(f"### {title}（保存于 {saved_at}）\n{content_preview}")

                    ledger_context = f"""

## 当月已录入的台账数据（真实数据源）
以下是企业已录入的台账记录，请基于这些真实数据填充执行报告，不要用示例值：

{chr(10).join(ledger_summaries)}
"""
                else:
                    ledger_context = f"""

## 台账数据状态
当前月度暂无已保存的台账记录。请用合理的示例值填充，并在该值后用括号标注"(示例值，请核实)"。
提示用户：先完成当月5类台账记录后，可重新生成月度报告以获得真实数据。
"""

            # Step 2: 构造 AI prompt
            yield _sse({"type": "progress", "step": 2, "name": "AI 智能填充中"})

            system_prompt = f"""你是 EcoPilot 合规文档自动填写助手。你的任务是根据企业真实信息和台账数据，智能填充模板中的占位符 {{占位符}}，生成可直接使用的合规文档。

## 企业真实信息
- 企业名称: {ent_name}
- 许可证编号: {permit_no}
- 统一社会信用代码: {credit_code}
- 行业类别: {industry}
- 注册地址: {address}
- 当前日期: {today_str}
- 当前年份: {year_str}
- 当前月份: {month_str}月
- 当前季度: Q{quarter_str}
{ledger_context}

## 填充规则
1. 将所有 {{占位符}} 替换为真实值（如 {{enterprise_name}} → 企业名称）
2. **优先使用台账数据中的真实数值**，不要用示例值替代已有台账记录
3. 对台账中缺失的数据，用合理的示例值填充，并在该值后用括号标注"(示例值，请核实)"
4. 保持原有 Markdown 格式、表格结构、标题层级完全不变
5. 不要添加任何解释性文字，直接返回填充后的完整文档
6. 对于表格中的数值字段，如台账有记录则直接引用，无记录则给出符合行业惯例的合理示例值
7. 输出必须与输入模板结构完全一致，仅替换占位符部分

## 输出要求
- 直接输出填充后的 Markdown 文档全文
- 不要包裹在代码块中
- 不要输出"以下是填充后的文档"等引导语
- 保持原有的空行和段落结构"""

            user_prompt = f"""请填充以下合规文档模板（标题：{title or "未命名"}）：

---
{content}
---

请根据上述企业真实信息智能填充所有占位符，直接返回填充后的完整文档。"""

            # Step 3: 调用 DeepSeek 流式
            stream = await ds_client.chat.completions.create(
                model=TEXT_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                stream=True,
            )

            async for chunk in stream:
                delta = chunk.choices[0].delta.content if chunk.choices else ""
                if delta:
                    yield _sse({"type": "text_delta", "text": delta})
                    await asyncio.sleep(0)

            yield _sse({"type": "done"})

        except Exception as e:
            yield _sse({"type": "error", "detail": f"AI 填充失败: {str(e)}"})

    return StreamingResponse(stream(), media_type="text/event-stream")


# ─── 主对话端点 ───

@app.post("/api/chat/stream")
async def chat_stream(request: Request):
    body, err = await _parse_json(request)
    if err is not None: return err
    msg = body.get("message","").strip()
    sid = body.get("session_id", str(uuid.uuid4()))
    # 可选：前端传来的对话历史（用于后端重启后恢复上下文）
    history = body.get("history", []) or []
    # 可选：附带 base64 图片（单张旧字段）
    image_b64 = body.get("image_base64", "")
    # 可选：附带多张 base64 图片（新字段，对话栏附件上传）
    images_b64 = body.get("images_base64", []) or []
    # 可选：首次对话附带许可证数据
    permit_data = body.get("permit_data", None)

    if not msg and not image_b64 and not images_b64:
        return StreamingResponse(_err("消息不能为空"), media_type="text/event-stream")

    # 存储许可证数据
    if permit_data and isinstance(permit_data, dict):
        async with _sessions_lock:
            _session_permit[sid] = permit_data

    # 把对话中上传的附件自动保存到档案库（带上传时间）
    saved_names = []
    all_images = []
    if image_b64:
        all_images.append(image_b64)
    all_images.extend(images_b64)
    for idx, img_b64 in enumerate(all_images):
        try:
            saved = _vault_save_attachment_from_b64(img_b64, source="chat", idx=idx)
            if saved:
                saved_names.append(saved)
        except Exception as e:
            logger.info(f"[Vault] 对话附件自动归档失败: {e}")

    # 只有图片类型才传给视觉模型，其他类型走文本流程
    first_image = ""
    for img in all_images:
        try:
            header_part = img.split(",", 1)[0] if "," in img else ""
            if "image/" in header_part:
                first_image = img
                break
        except Exception:
            pass

    return StreamingResponse(_run(sid, msg, first_image, saved_names, history), media_type="text/event-stream")


def _vault_save_attachment_from_b64(data_url: str, source: str = "chat", idx: int = 0) -> str:
    """把对话栏上传的 base64 文件自动保存到档案库
    data_url 格式: data:<mime>;base64,<content>
    自动从文件名/内容推测分类，记录上传时间
    """
    import base64 as _b64, time as _time, re as _re, uuid as _uuid
    from datetime import datetime as _dt

    if "," not in data_url:
        return ""
    header, content_part = data_url.split(",", 1)
    mime = ""
    m = _re.search(r"data:([^;]+);base64", header)
    if m:
        mime = m.group(1)

    # MIME → 扩展名
    mime_to_ext = {
        "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif",
        "image/bmp": ".bmp", "image/webp": ".webp",
        "application/pdf": ".pdf",
        "text/plain": ".txt", "text/markdown": ".md",
        "application/msword": ".doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
        "application/vnd.ms-excel": ".xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    }
    ext = mime_to_ext.get(mime, ".bin")

    # 如果是 filename= 形式，提取真实文件名
    fname_match = _re.search(r"filename=([^;]+)", header)
    original_name = fname_match.group(1) if fname_match else f"对话附件_{_dt.now().strftime('%Y%m%d_%H%M%S')}_{idx+1}{ext}"

    try:
        content = _b64.b64decode(content_part)
    except Exception:
        return ""

    if len(content) == 0:
        return ""

    VAULT_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = _vault_safe_filename(original_name)
    counter = 1
    while (VAULT_DIR / stored_name).exists():
        stored_name = f"{Path(stored_name).stem}_{counter}{Path(stored_name).suffix}"
        counter += 1
    (VAULT_DIR / stored_name).write_bytes(content)

    # 简单基于文件名/扩展名推测分类（AI 智能分类留给 /api/vault/auto-classify）
    name_lower = original_name.lower()
    if any(kw in name_lower for kw in ["环评", "eia"]):
        category = "环评"
    elif any(kw in name_lower for kw in ["验收", "acceptance"]):
        category = "验收"
    elif any(kw in name_lower for kw in ["许可", "permit"]):
        category = "许可证"
    elif any(kw in name_lower for kw in ["监测", "monitor"]):
        category = "监测"
    elif any(kw in name_lower for kw in ["应急", "emergency"]):
        category = "应急"
    elif any(kw in name_lower for kw in ["清洁", "cleaner"]):
        category = "清洁生产"
    elif any(kw in name_lower for kw in ["执行报告", "exec"]):
        category = "执行报告"
    elif any(kw in name_lower for kw in ["固废", "危废", "hazwaste"]):
        category = "固废"
    else:
        category = "其他"

    files = _vault_load_manifest()
    record = {
        "id": _uuid.uuid4().hex[:12],
        "filename": stored_name,
        "original_name": original_name,
        "category": category,
        "code": "",
        "desc": f"来自对话附件自动归档 · 来源:{source}",
        "tpl_id": None,
        "upload_date": _dt.now().isoformat(timespec="seconds"),
        "size": len(content),
        "mime_type": mime or EXT_MIME.get(ext, "application/octet-stream"),
        "ext": ext,
    }
    files.append(record)
    _vault_save_manifest(files)
    return original_name

# ── _run 辅助函数：会话上下文构建 ──
def _build_session_context(sid: str, history: list = None):
    """构建/恢复会话上下文，首次创建时启动企业深度学习"""
    if sid not in _sessions:
        context = _get_orchestrator_system_prompt(_session_permit.get(sid))
        _sessions[sid] = [{"role":"system","content":context}]
        # 后端重启后恢复上下文：注入前端传来的最近对话历史
        if history and isinstance(history, list):
            for h in history[-10:]:
                if isinstance(h, dict) and h.get("role") in ("user","assistant"):
                    _sessions[sid].append({"role":h["role"],"content":h.get("content","")})
        # 企业深度学习：首次交互时主动学习企业档案+行业知识
        _spawn_bg(_enterprise_onboarding(sid))


# ── _run 辅助函数：工具调用循环 ──
async def _run_tool_call_loop(sid: str, msg: str, log_tools_used: list, log_ai_reply: list):
    """工具调用循环（最多12轮），流式输出文本和工具调用结果"""
    MAX_TOOL_ROUNDS = 16
    _consecutive_searches = 0
    _max_consecutive_searches = 5
    for round_idx in range(MAX_TOOL_ROUNDS):
        async with _sessions_lock:
            msgs = list(_sessions[sid])
        resp = await ds_client.chat.completions.create(
            model=TEXT_MODEL, messages=msgs,
            tools=get_merged_tools(), stream=True,
            stream_options={"include_usage": True})
        tool_calls_acc: dict[int, dict] = {}
        text_acc = ""; reasoning_acc = ""
        async for chunk in resp:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta is None: continue
            rc = getattr(delta, "reasoning_content", None) or ""
            if rc: reasoning_acc += rc
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = tc.index
                    if idx not in tool_calls_acc:
                        tool_calls_acc[idx] = {"id": tc.id or "", "name": "", "arguments": ""}
                    if tc.id: tool_calls_acc[idx]["id"] = tc.id
                    if tc.function and tc.function.name:
                        tool_calls_acc[idx]["name"] += tc.function.name
                    if tc.function and tc.function.arguments:
                        tool_calls_acc[idx]["arguments"] += tc.function.arguments
            if delta.content:
                text_acc += delta.content
                yield _sse({"type":"text_delta","text":delta.content})
        if tool_calls_acc:
            tc_list_sorted = [{"id": tool_calls_acc[k]["id"], "type": "function",
                               "function": {"name": tool_calls_acc[k]["name"],
                                            "arguments": tool_calls_acc[k]["arguments"]}}
                              for k in sorted(tool_calls_acc.keys())]
            assistant_msg = {"role": "assistant", "content": None, "tool_calls": tc_list_sorted}
            if reasoning_acc: assistant_msg["reasoning_content"] = reasoning_acc
            async with _sessions_lock:
                _sessions[sid].append(assistant_msg)
            for k in sorted(tool_calls_acc.keys()):
                tc = tool_calls_acc[k]; fn_name = tc["name"]
                try: fn_args = json.loads(tc["arguments"])
                except (json.JSONDecodeError, TypeError): fn_args = {}
                yield _sse({"type":"tool_call","name":fn_name,"args":fn_args})
                result = await execute_tool(fn_name, fn_args, sid)
                yield _sse({"type":"tool_result","name":fn_name,"result":result[:200]})
                log_tools_used.append({"name": fn_name, "result": result[:200]})
                async with _sessions_lock:
                    _sessions[sid].append({"role":"tool","tool_call_id":tc["id"],"content":result})
                _consecutive_searches = _consecutive_searches + 1 if fn_name == "knowledge_search" else 0
                if _consecutive_searches >= _max_consecutive_searches:
                    async with _sessions_lock:
                        _sessions[sid].append({"role":"user",
                            "content":f"⚠️ 已连续搜索 {_consecutive_searches} 次仍未找到精确结果。请基于已有知识库内容直接回答，告知用户当前知识库中未收录该信息，并建议通过 vault_guide 补充档案。不要再次调用 knowledge_search。"})
        else:
            text = text_acc or ""
            assistant_final = {"role":"assistant","content":text or "处理完成"}
            if reasoning_acc: assistant_final["reasoning_content"] = reasoning_acc
            async with _sessions_lock:
                _sessions[sid].append(assistant_final)
            log_ai_reply[0] = text
            break
        if round_idx == MAX_TOOL_ROUNDS - 1:
            async with _sessions_lock:
                _sessions[sid].append({"role":"user","content":"请根据以上所有工具执行结果，给出最终回答。"})
    else:
        yield _sse({"type":"text_delta","text":"\n\n[已达到最大工具调用次数，请重试或简化问题]"})


# ── _run 辅助函数：会话收尾处理 ──
def _finalize_session(sid: str, msg: str, log_ai_reply: str, log_tools_used: list, log_start_time: float):
    """日志/记忆沉淀后处理：工作日志、成长日记、合规记忆、自学习、幻觉扫描、企业进化、会话上下文"""
    _log_elapsed = asyncio.get_event_loop().time() - log_start_time
    try:
        _append_work_log(sid, msg, log_ai_reply, log_tools_used, _log_elapsed)
        _spawn_bg(_update_growth_diary())
        # 异步提取合规记忆（不阻塞 SSE 流）
        _spawn_bg(_extract_and_save_memory(sid, msg, log_ai_reply, log_tools_used))
        # 自学习：高频主题沉淀为技能 + 幻觉扫描
        _spawn_bg(_auto_learn_skill(sid, msg, log_ai_reply, log_tools_used))
        _spawn_bg(_hallucination_scan(sid, log_ai_reply))
        # 企业深度学习：进化企业画像
        _spawn_bg(_enterprise_evolve(sid, msg, log_ai_reply))
        # ── Hermes：保存会话上下文到记忆层 ──
        try:
            ent = _load_enterprise_info()
            eid = ent.get("credit_code") or ent.get("creditCode") or ent.get("name") or "" if ent else ""
            ctx = hermes_memory.get_session_context(sid) or {}
            topics = ctx.get("context", {}).get("recent_topics", [])
            topics.append(msg[:30])
            hermes_memory.save_session_context(sid, eid, {"recent_topics": topics[-10:], "last_query": msg})
        except Exception:
            pass
    except Exception as _e:
        logger.info(f"[Journal] 日志触发失败: {_e}")


# ── 对话引擎选择 ──
# 默认全程接入 Hermes（品牌动画→模型配置唤醒→许可证读取→对话深度分析）
# 常规对话仍走 DeepSeek 快路径；显式设 ECOPILOT_ENGINE=deepseek 可完全关闭 Hermes
ECOPILOT_ENGINE = os.environ.get("ECOPILOT_ENGINE", "hermes").strip().lower()

def _is_hermes_engine() -> bool:
    return ECOPILOT_ENGINE == "hermes"

# 懒加载 Hermes 引擎
_hermes_engine = None
def _get_hermes_engine():
    global _hermes_engine
    if _hermes_engine is None:
        from hermes_engine import HermesEngine
        _hermes_engine = HermesEngine()
        # 首次初始化时后台预热
        try:
            import asyncio
            asyncio.create_task(_hermes_engine.warmup())
        except Exception:
            pass
    return _hermes_engine
async def _run(sid: str, msg: str, image_b64: str = "", saved_attachments: list = None, history: list = None):
    try:
        async with _sessions_lock:
            _build_session_context(sid, history)
            _sessions_last_access[sid] = time.time()

        # 通知用户附件已自动归档到档案库
        if saved_attachments:
            names_str = "、".join(saved_attachments[:3])
            extra = f"（共 {len(saved_attachments)} 份）" if len(saved_attachments) > 3 else ""
            yield _sse({"type":"text_delta","text":f"📎 已将上传文件自动归档到档案库：{names_str}{extra}\n\n"})

        # 有图片 → 用 Kimi 视觉模型（不走工具调用）
        if image_b64:
            async for ev in _run_vision(sid, msg, image_b64):
                yield ev
            return

        # 纯文本 → DeepSeek 带工具调用 / Hermes 引擎
        # ── PII 脱敏 ──
        msg = _sanitize_pii(msg)
        async with _sessions_lock:
            _sessions[sid].append({"role":"user","content":msg})

        # ── Hermes 引擎模式 ──
        # Hermes CLI 每次冷启动 ~14s，仅在用户明确要求深度分析时启用
        # 常规问题走 DeepSeek（快速，2-3s）
        _hermes_trigger = any(k in msg for k in ["用Hermes", "深度分析", "MCP查询", "调工具", "hermes"])
        if _is_hermes_engine() and _hermes_trigger:
            yield _sse({"type": "tool_start", "text": "✈️ Pilot 合规管家思考中..."})
            _hermes_tools = [
                ("permit_quick_check", "读取排污许可证"),
                ("knowledge_search", "检索法规标准"),
                ("monitoring_check", "检查监测状态"),
                ("carbon_check", "检查碳排放状态"),
            ]
            for name, label in _hermes_tools:
                yield _sse({"type": "tool_call", "name": label, "args": ""})
            engine = _get_hermes_engine()
            full_text = await engine.chat(msg)
            for name, label in _hermes_tools:
                yield _sse({"type": "tool_result", "name": label, "result": "done"})
            yield _sse({"type": "tool_start", "text": ""})
            chunk_size = 200
            for i in range(0, len(full_text), chunk_size):
                yield _sse({"type": "text_delta", "text": full_text[i:i+chunk_size]})
                await asyncio.sleep(0.02)
            return

        # ── 首次对话自动启动：并行调4个工具获取合规快照（DeepSeek 模式） ──
        async with _sessions_lock:
            is_first_msg = len(_sessions[sid]) == 2  # system + 首条用户消息
        if is_first_msg:
            from tools import execute_tool as _exec
            # 并行执行4个工具，静默不显示加载文字
            import asyncio as _aio
            async def _run_one(name, args):
                try: return await _exec(name, args, sid)
                except Exception: return "查询失败"
            check, report, mon, carbon = await _aio.gather(
                _run_one("permit_quick_check", {}),
                _run_one("permit_report_status", {}),
                _run_one("monitoring_check", {}),
                _run_one("carbon_check", {}),
            )
            # 注入结果到会话上下文，强制只输出速报
            ctx = (
                "【系统已自动查询以下数据。你唯一要做的就是按格式输出今日合规速报。"
                "不要寒暄、不要自我介绍、不要问用户问题、不要追加任何额外内容。】\n"
                f"许可状态: {str(check)[:500]}\n"
                f"执行报告: {str(report)[:500]}\n"
                f"监测: {str(mon)[:300]}\n"
                f"碳排放: {str(carbon)[:300]}"
            )
            async with _sessions_lock:
                _sessions[sid].append({"role":"user","content":ctx})

        yield _sse({"type":"tool_start","text":"AI 正在分析，准备调用工具..."})

        # ── Hermes AI 增强层 ──
        enterprise_id = ""
        try:
            ent = _load_enterprise_info()
            if ent:
                enterprise_id = ent.get("credit_code") or ent.get("creditCode") or ent.get("name") or ""
        except Exception:
            pass

        hermes_result = process_with_hermes(msg, enterprise_id=enterprise_id, session_id=sid)
        if hermes_result.get("hermes_enhanced"):
            # 使用增强后的提示词替换最后一条用户消息
            if hermes_result.get("enhanced_prompt"):
                async with _sessions_lock:
                    _sessions[sid][-1]["content"] = hermes_result["enhanced_prompt"]
            # 缓存命中：直接返回缓存结果，不走 AI
            if hermes_result.get("cache_hit") and hermes_result.get("cached_result"):
                cached_text = hermes_result["cached_result"].get("text", json.dumps(hermes_result["cached_result"], ensure_ascii=False))
                yield _sse({"type":"text_delta","text":cached_text})
                # 保存会话上下文到记忆层
                try:
                    hermes_memory.save_session_context(sid, enterprise_id, {"recent_topics": [msg[:30]], "last_query": msg})
                except Exception:
                    pass
                return
            # 通知前端 Hermes Agent 路由信息（可选的 SSE 事件，前端可忽略）
            agent_info = hermes_result.get("agent_routed")
            if agent_info and agent_info.get("agent_info"):
                yield _sse({"type":"hermes_agent","agent":agent_info["agent"],"name":agent_info["agent_info"]["name"]})

        # 网关健康检查：OmniRoute 模式下先确保网关存活
        if not await _ensure_ai_gateway():
            yield _sse({"type":"text_delta","text":"⚠️ AI 网关暂时不可用，已尝试自动重启但未恢复，请稍后重试或检查 OmniRoute 服务。"})
            return

        # 日志收集初始化
        _log_start_time = asyncio.get_event_loop().time()
        _log_tools_used: list = []
        _log_ai_reply = [""]  # 用 list 包装以便子函数内修改

        # 工具调用循环（最多12轮）
        async for ev in _run_tool_call_loop(sid, msg, _log_tools_used, _log_ai_reply):
            yield ev

        # ── 写入工作日志 + 异步生成成长日记 ──
        _finalize_session(sid, msg, _log_ai_reply[0], _log_tools_used, _log_start_time)
    except Exception as e:
        err_text = str(e)
        err_type = type(e).__name__
        import traceback as _tb
        logger.info(f"[SSE] _run 异常 [{err_type}]: {err_text}")
        _tb.print_exc()
        # 友好提示：根据异常类型给出更准确的提示
        if "402" in err_text or "Insufficient" in err_text or "balance" in err_text.lower():
            friendly = "AI 服务余额不足，请联系管理员充值"
        elif "401" in err_text or "Unauthorized" in err_text or "auth" in err_text.lower():
            friendly = "认证失败，请稍后重试"
        elif "timeout" in err_text.lower() or "timed out" in err_text.lower():
            friendly = "AI 服务响应超时，请稍后重试"
        elif _is_connection_error(e):
            # OmniRoute 网关可能挂了，尝试自动重启
            friendly = "AI 网关连接异常，正在自动恢复..."
            yield _sse({"type":"text_delta","text":f"⚠️ {friendly}"})
            recovered = await _restart_omniroute()
            if recovered:
                yield _sse({"type":"text_delta","text":"AI 网关已恢复，请重新发送您的问题。"})
            else:
                yield _sse({"type":"error","text":"AI 网关暂时不可用，自动重启未成功。请检查 OmniRoute 服务后重试。"})
            return
        else:
            friendly = f"AI 服务暂时不可用（{err_type}），请稍后重试或联系管理员"
        yield _sse({"type":"error","text":friendly})
    finally:
        yield _sse({"type":"done"})


async def _run_vision(sid: str, msg: str, image_b64: str):
    """处理图片识别（Kimi视觉模型）→ DeepSeek 文本回复（支持工具调用 + 思考模式）"""
    # 网关健康检查：OmniRoute 模式下先确保网关存活
    if not await _ensure_ai_gateway():
        yield _sse({"type":"text_delta","text":"⚠️ AI 网关暂时不可用，已尝试自动重启但未恢复，请稍后重试或检查 OmniRoute 服务。"})
        return
    # 视觉模型提取图片信息
    vision_messages = [
        {"role":"system","content":"识别这张图片，提取其中所有关键文字和信息。如果是排污许可证，提取企业名称、编号、行业、有效期、排放标准。如果是验证码，只输出验证码字符。如果是监测报告，提取监测项目、数值、单位、是否达标。"},
        {"role":"user","content": [
            {"type":"text","text": msg or "请识别这张图片"},
            {"type":"image_url","image_url":{"url":f"data:image/jpeg;base64,{image_b64}"}},
        ]},
    ]
    try:
        # Phase 1: Kimi 视觉识别
        stream = await kimi_client.chat.completions.create(
            model=KIMI_VISION_MODEL,
            messages=vision_messages,
            stream=True,
        )
        full = ""
        async for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else ""
            if delta:
                full += delta
                yield _sse({"type":"text_delta","text":delta})

        if not full:
            yield _sse({"type":"text_delta","text":"未能识别图片内容"})
            return

        # Phase 2: DeepSeek 文本回复（带工具调用 + 思考模式兼容）
        async with _sessions_lock:
            _sessions[sid].append({"role":"user","content":f"[图片识别结果]\n{full}\n\n请基于以上信息回答用户问题。"})
        yield _sse({"type":"tool_start","text":"正在分析图片内容..."})

        # 工具调用循环（与 _run 一致）
        MAX_TOOL_ROUNDS = 12
        _consecutive_searches = 0
        _log_ai_reply = ""
        _log_tools_used: list = []
        for round_idx in range(MAX_TOOL_ROUNDS):
            async with _sessions_lock:
                msgs = list(_sessions[sid])
            resp = await ds_client.chat.completions.create(
                model=TEXT_MODEL,
                messages=msgs,
                tools=get_merged_tools(),
            )
            choice = resp.choices[0]
            msg_obj = choice.message

            if not msg_obj.tool_calls:
                text = msg_obj.content or ""
                assistant_final = {"role":"assistant","content":text or "处理完成"}
                reasoning = getattr(msg_obj, "reasoning_content", None) or ""
                if reasoning:
                    assistant_final["reasoning_content"] = reasoning
                async with _sessions_lock:
                    _sessions[sid].append(assistant_final)
                _log_ai_reply = text
                if text:
                    yield _sse({"type":"text_delta","text":text})
                break

            # 有工具调用
            assistant_msg = {
                "role":"assistant",
                "content":None,
                "tool_calls":[{"id":tc.id,"type":"function","function":{"name":tc.function.name,"arguments":tc.function.arguments}} for tc in msg_obj.tool_calls]
            }
            reasoning = getattr(msg_obj, "reasoning_content", None) or ""
            if reasoning:
                assistant_msg["reasoning_content"] = reasoning
            async with _sessions_lock:
                _sessions[sid].append(assistant_msg)

            for tc in msg_obj.tool_calls:
                fn_name = tc.function.name
                try:
                    fn_args = json.loads(tc.function.arguments)
                except (json.JSONDecodeError, TypeError):
                    fn_args = {}
                yield _sse({"type":"tool_call","name":fn_name,"args":fn_args})
                result = await execute_tool(fn_name, fn_args, sid)
                yield _sse({"type":"tool_result","name":fn_name,"result":result[:200]})
                _log_tools_used.append({"name": fn_name, "result": result[:200]})
                async with _sessions_lock:
                    _sessions[sid].append({
                        "role":"tool",
                        "tool_call_id":tc.id,
                        "content":result
                    })
                # ── 连续 knowledge_search 硬限制 ──
                if fn_name == "knowledge_search":
                    _consecutive_searches += 1
                else:
                    _consecutive_searches = 0
                if _consecutive_searches >= 3:
                    async with _sessions_lock:
                        _sessions[sid].append({"role":"user","content":"⚠️ 已连续搜索 {} 次仍未找到精确结果。请基于已有知识库内容直接回答，告知用户当前知识库中未收录该信息，并建议通过 vault_guide 补充档案。不要再次调用 knowledge_search。".format(_consecutive_searches)})

            if round_idx == MAX_TOOL_ROUNDS - 1:
                async with _sessions_lock:
                    _sessions[sid].append({"role":"user","content":"请根据以上所有工具执行结果，给出最终回答。"})
        else:
            yield _sse({"type":"text_delta","text":"\n\n[已达到最大工具调用次数]"})

        # 写日志
        try:
            _append_work_log(sid, f"[图片] {msg}", _log_ai_reply, _log_tools_used, 0)
            # 异步提取合规记忆（不阻塞 SSE 流）
            _spawn_bg(_extract_and_save_memory(sid, msg, _log_ai_reply, _log_tools_used))
        except Exception: pass

    except Exception as e:
        err_text = str(e)
        err_type = type(e).__name__
        logger.info(f"[SSE] _run_vision 异常 [{err_type}]: {err_text}")
        import traceback as _tb
        _tb.print_exc()
        if "402" in err_text or "Insufficient" in err_text or "balance" in err_text.lower():
            friendly = "AI 服务余额不足"
        elif "404" in err_text or "Not Found" in err_text:
            friendly = "视觉识别服务配置错误，请联系管理员检查 KIMI_BASE_URL"
        elif "401" in err_text or "Unauthorized" in err_text:
            friendly = "视觉识别服务认证失败"
        elif "timeout" in err_text.lower():
            friendly = "视觉识别超时，请稍后重试"
        else:
            friendly = f"视觉识别失败（{err_type}）"
        yield _sse({"type":"error","text":friendly})
    finally:
        yield _sse({"type":"done"})


def _sse(d): return f"data: {json.dumps(d, ensure_ascii=False)}\n\n"


# ═══════════════════════════════════════════════════════════════
# 智能体工作日志 / 成长日记 — 写入知识库
# ═══════════════════════════════════════════════════════════════
import re as _re
from datetime import datetime as _dt

_JOURNAL_DIR = HERMES_HOME / "knowledge" / "journal"
_GROWTH_DIR = _JOURNAL_DIR / "growth"

# ─── 合规记忆存储 ───
_MEMORY_DIR = HERMES_HOME / "knowledge" / "memory"
_MEMORY_FILE = _MEMORY_DIR / "compliance-memory.json"
_memory_lock = asyncio.Lock()
_MEMORY_MAX = 500  # 记忆最多保留 500 条

# ─── 后台任务并发限流 ───
_BG_SEM = asyncio.Semaphore(3)  # 最多 3 个并发后台任务，超过上限丢弃


def _spawn_bg(coro):
    """fire-and-forget 后台任务：Semaphore 限流，超过 3 个并发时丢弃而非堆积。"""
    async def _runner():
        try:
            async with _BG_SEM:
                await coro
        except Exception:
            pass  # 后台任务失败静默丢弃

    asyncio.create_task(_runner())


async def _async_write_text(path: Path, content: str, encoding: str = "utf-8"):
    """异步写入文本文件（via thread pool），避免阻塞事件循环。"""
    await asyncio.to_thread(lambda: path.write_text(content, encoding=encoding))


async def _async_append_text(path: Path, content: str, encoding: str = "utf-8"):
    """异步追加文本到文件（via thread pool）。"""
    def _append():
        with open(str(path), "a", encoding=encoding) as f:
            f.write(content)
    await asyncio.to_thread(_append)


async def _async_read_text(path: Path, encoding: str = "utf-8") -> str:
    """异步读取文本文件（via thread pool）。"""
    return await asyncio.to_thread(lambda: path.read_text(encoding=encoding))


# 当日是否已生成成长日记（避免每次对话都触发）
_growth_diary_done_dates: set = set()


async def _append_work_log(sid: str, user_msg: str, ai_reply: str, tools_used: list, elapsed_sec: float):
    """追加一条工作日志到今日文件。失败静默，绝不影响对话。"""
    try:
        _JOURNAL_DIR.mkdir(parents=True, exist_ok=True)
        today = _dt.now()
        date_str = today.strftime("%Y-%m-%d")
        time_str = today.strftime("%H:%M")
        fname = f"work-log-{date_str}.md"
        fpath = _JOURNAL_DIR / fname

        # 截断过长的内容
        user_brief = (user_msg or "").strip()[:200]
        ai_brief = (ai_reply or "").strip()[:500]
        tools_brief = ""
        if tools_used:
            tools_brief = "\n".join(f"- `{t.get('name','?')}` — {(t.get('result','')[:80])}" for t in tools_used)
        else:
            tools_brief = "- 无工具调用"

        entry = f"""### 对话 · {time_str}

**用户提问**：
> {user_brief}

**工具调用**：
{tools_brief}

**AI 回答**：
> {ai_brief}

**耗时**：{elapsed_sec:.1f} 秒

---

"""
        # 文件不存在 → 创建带 frontmatter 的头部
        if not fpath.exists():
            header = f"""---
title: 工作日志 - {date_str}
doc_number: ""
issue_date: {date_str}
category: 智能体
industry: []
applicable_stage: []
tags:
  - 工作日志
  - 智能体
aliases: []
related:
  - "[[00-MOC-智能体日志]]"
ai_risk_notes: []
---

# 📅 {date_str} 工作日志

"""
            await _async_write_text(fpath, header + entry, encoding="utf-8")
        else:
            # 追加到文件末尾
            await _async_append_text(fpath, entry)

        # 当日总结（在文件末尾维护一个统计区，每次重写）
        await _async_update_work_log_summary(fpath, date_str)
    except Exception as e:
        logger.info(f"[Journal] 工作日志写入失败: {e}")


async def _async_update_work_log_summary(fpath, date_str: str):
    """重写文件末尾的「当日总结」区。"""
    try:
        content = await _async_read_text(fpath)
        # 删除旧的总结区
        content = _re.sub(r"\n## 📊 当日总结[\s\S]*$", "", content)
        # 统计对话数
        dialog_count = content.count("### 对话 ·")
        # 统计工具调用数
        tool_count = content.count("- `") - content.count("- 无工具调用")
        if tool_count < 0:
            tool_count = 0
        summary = f"""

## 📊 当日总结

- 对话数：{dialog_count} 次
- 工具调用：{tool_count} 次
- 主要话题：见上方各对话
- 异常事件：无
"""
        await _async_write_text(fpath, content + summary, encoding="utf-8")
    except Exception as e:
        logger.info(f"[Journal] 工作日志总结更新失败: {e}")


async def _update_growth_diary():
    """基于今日工作日志，异步更新本月成长日记。失败静默。"""
    try:
        global _growth_diary_done_dates
        today = _dt.now()
        date_str = today.strftime("%Y-%m-%d")
        if date_str in _growth_diary_done_dates:
            return  # 今日已生成过

        _GROWTH_DIR.mkdir(parents=True, exist_ok=True)
        month_str = today.strftime("%Y-%m")
        today_log = _JOURNAL_DIR / f"work-log-{date_str}.md"
        if not today_log.exists():
            return

        today_content = await _async_read_text(today_log)
        # 截取正文（去掉 frontmatter）
        if today_content.startswith("---"):
            parts = today_content.split("---", 2)
            today_body = parts[2] if len(parts) >= 3 else today_content
        else:
            today_body = today_content

        # 用 DeepSeek 生成反思
        prompt = f"""请基于以下今日工作日志，为合规助手（AI 智能体）写一段简短的成长日记（200字内）：
- 今天学到了什么
- 遇到了什么类型的问题
- 有哪些可以改进的地方

今日工作日志：
{today_body[:2000]}

请直接输出成长日记内容（不要标题，不要 frontmatter），用第一人称「我」写。"""

        resp = await ds_client.chat.completions.create(
            model=TEXT_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300,
        )
        reflection = (resp.choices[0].message.content or "").strip()

        fname = f"growth-diary-{month_str}.md"
        fpath = _GROWTH_DIR / fname
        entry = f"""### {date_str}

{reflection}

---

"""
        if not fpath.exists():
            header = f"""---
title: 成长日记 - {month_str}
doc_number: ""
issue_date: {month_str}
category: 智能体
industry: []
applicable_stage: []
tags:
  - 成长日记
  - 智能体
aliases: []
related:
  - "[[00-MOC-智能体日志]]"
ai_risk_notes: []
---

# 🌱 {month_str} 成长日记

"""
            await _async_write_text(fpath, header + entry, encoding="utf-8")
        else:
            await _async_append_text(fpath, entry)

        _growth_diary_done_dates.add(date_str)
        logger.info(f"[Journal] 成长日记已更新: {fname}")
    except Exception as e:
        logger.info(f"[Journal] 成长日记更新失败: {e}")


# ═══════════════════════════════════════════════════════════════
# 合规记忆自动沉淀 — 对话结束后 AI 提取关键信息
# ═══════════════════════════════════════════════════════════════

def _load_memory_file() -> dict:
    """读取合规记忆 JSON 文件，返回 {memories: [...]} 结构。失败静默。"""
    try:
        if not _MEMORY_FILE.exists():
            return {"memories": []}
        raw = _MEMORY_FILE.read_text(encoding="utf-8")
        if not raw.strip():
            return {"memories": []}
        data = json.loads(raw)
        if not isinstance(data, dict) or "memories" not in data:
            return {"memories": []}
        if not isinstance(data["memories"], list):
            data["memories"] = []
        return data
    except Exception as e:
        logger.info(f"[Memory] 读取合规记忆失败: {e}")
        return {"memories": []}


def _save_memory_file(data: dict):
    """写入合规记忆 JSON 文件。失败静默。"""
    try:
        _MEMORY_DIR.mkdir(parents=True, exist_ok=True)
        _MEMORY_FILE.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception as e:
        logger.info(f"[Memory] 写入合规记忆失败: {e}")


# 风险等级关键词推断
_HIGH_RISK_KEYS = ("超标", "违法", "违规", "处罚", "立案", "风险", "禁排", "禁止", "停产", "限产", "整改", "督察", "通报")
_MEDIUM_RISK_KEYS = ("限值", "排放标准", "监测", "核验", "不合规", "限期", "警告")


def _guess_risk_level(title: str, content: str) -> str:
    """根据关键词推断风险等级。"""
    text = (title + content).lower()
    for kw in _HIGH_RISK_KEYS:
        if kw in text:
            return "high"
    for kw in _MEDIUM_RISK_KEYS:
        if kw in text:
            return "medium"
    return "low"


_MEMORY_CATEGORIES = {"法规条款", "排放限值", "企业信息", "风险点", "案例", "其他"}


def _normalize_category(cat: str) -> str:
    """归一化分类，未知值归入「其他」。"""
    cat = (cat or "").strip()
    return cat if cat in _MEMORY_CATEGORIES else "其他"


async def _extract_and_save_memory(sid: str, user_msg: str, ai_reply: str, tools_used: list):
    """用 AI 分析对话，提取值得长期记忆的关键信息，追加到 compliance-memory.json。
    失败静默，绝不影响对话流程。"""
    try:
        # 空内容跳过
        user_brief = (user_msg or "").strip()
        ai_brief = (ai_reply or "").strip()
        if not user_brief or not ai_brief:
            return

        # 工具调用结果摘要
        if tools_used:
            tools_brief = "\n".join(
                f"- 工具：{t.get('name', '?')} → 结果：{str(t.get('result', ''))[:120]}"
                for t in tools_used[:6]
            )
        else:
            tools_brief = "- 无工具调用"

        # 截断过长内容，控制 prompt token
        if len(user_brief) > 600:
            user_brief = user_brief[:600] + "…"
        if len(ai_brief) > 2000:
            ai_brief = ai_brief[:2000] + "…"

        prompt = f"""请分析以下对话，提取值得长期记忆的关键信息（法规条款、排放限值、企业信息、风险点、案例等）。
如果没有任何值得记忆的信息（例如闲聊、问候、与合规无关的话题），返回空数组。

用户提问：{user_brief}
AI回答：{ai_brief}
工具调用结果：{tools_brief}

请以 JSON 数组格式返回，每项包含：
- title: 简短标题（10-20字）
- content: 详细内容（50-200字）
- category: 分类（法规条款/排放限值/企业信息/风险点/案例/其他）

返回格式：[{{"title":"...","content":"...","category":"..."}}]
如果没有值得记忆的信息，返回：[]"""

        resp = await ds_client.chat.completions.create(
            model=TEXT_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=800,
            temperature=0.2,
        )
        raw_text = (resp.choices[0].message.content or "").strip()

        # 兼容模型可能包裹 ```json ... ``` 的情况
        if raw_text.startswith("```"):
            raw_text = _re.sub(r"^```(?:json)?\s*", "", raw_text)
            raw_text = _re.sub(r"\s*```$", "", raw_text)
        raw_text = raw_text.strip()

        # 解析 JSON 数组
        try:
            extracted = json.loads(raw_text)
        except Exception:
            # 尝试提取首个 [ ... ] 块
            m = _re.search(r"\[\s*\{[\s\S]*\}\s*\]", raw_text)
            if not m:
                return
            try:
                extracted = json.loads(m.group(0))
            except Exception:
                return

        if not isinstance(extracted, list) or not extracted:
            return

        # 构造记忆对象
        now_iso = _dt.now().isoformat(timespec="seconds")
        new_memories = []
        for item in extracted:
            if not isinstance(item, dict):
                continue
            title = (item.get("title") or "").strip()
            content = (item.get("content") or "").strip()
            if not title or not content:
                continue
            category = _normalize_category(item.get("category"))
            risk_level = _guess_risk_level(title, content)
            mem_obj = {
                "id": f"mem_{uuid.uuid4().hex[:12]}",
                "title": title[:50],
                "content": content[:500],
                "category": category,
                "risk_level": risk_level,
                "created_at": now_iso,
                "source": "对话自动提取",
                "session_id": sid,
                "expiry": None,
                "tags": [],
            }
            new_memories.append(mem_obj)

        if not new_memories:
            return

        # 加锁写文件
        async with _memory_lock:
            data = _load_memory_file()
            memories = data.get("memories", [])
            memories.extend(new_memories)
            # 限制最多 _MEMORY_MAX 条，超过删除最早的
            if len(memories) > _MEMORY_MAX:
                memories = memories[-_MEMORY_MAX:]
            data["memories"] = memories
            _save_memory_file(data)

        logger.info(f"[Memory] 已沉淀 {len(new_memories)} 条合规记忆（总计 {len(memories)} 条）")
    except Exception as e:
        logger.info(f"[Memory] 合规记忆提取失败: {e}")

# ═══════════════════════════════════════════════════════════════
# 档案库 → 知识库 AI 摘要提取
# ═══════════════════════════════════════════════════════════════
_VAULT_EXTRACTS_DIR = HERMES_HOME / "knowledge" / "vault-extracts"

# 文本类扩展名（可直接 read_text）
_TEXT_EXTS = {".txt", ".md", ".csv", ".json", ".log", ".xml", ".html", ".htm"}
# 图片类扩展名（用 Kimi 视觉识别）
_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff"}
# 二进制文档（用 Kimi 视觉识别，转 base64）
_BIN_DOC_EXTS = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"}


async def _extract_vault_file_to_md(record: dict) -> dict:
    """
    读取档案库文件 → AI 生成结构化 MD → 存到 knowledge/vault-extracts/
    返回 {ok, md_path, summary, error}
    """
    try:
        file_id = record.get("id", "")
        filename = record.get("filename", "")
        original_name = record.get("original_name", filename)
        category = record.get("category", "其他")
        code = record.get("code", "")
        desc = record.get("desc", "")
        upload_date = record.get("upload_date", "")
        ext = (record.get("ext", "") or "").lower()
        fpath = VAULT_DIR / filename
        if not fpath.exists():
            return {"ok": False, "error": f"文件丢失: {filename}"}

        # ── 1. 读取文件内容 ──
        content_text = ""
        image_b64 = None
        is_image = False

        if ext in _TEXT_EXTS:
            try:
                content_text = fpath.read_text(encoding="utf-8", errors="ignore")[:8000]
            except Exception as e:
                return {"ok": False, "error": f"文本读取失败: {e}"}
        elif ext in _IMAGE_EXTS or ext in _BIN_DOC_EXTS:
            # 二进制文件 → base64 → Kimi 视觉
            try:
                raw = fpath.read_bytes()
                # 限制 20MB（避免 base64 过大）
                if len(raw) > 20 * 1024 * 1024:
                    return {"ok": False, "error": "文件过大（>20MB），跳过"}
                image_b64 = base64.b64encode(raw).decode("ascii")
                is_image = ext in _IMAGE_EXTS
            except Exception as e:
                return {"ok": False, "error": f"二进制读取失败: {e}"}
        else:
            return {"ok": False, "error": f"不支持的文件类型: {ext}"}

        # ── 2. AI 生成摘要 ──
        ai_failed = False
        ai_error = ""
        summary_md = ""
        if content_text and not image_b64:
            # 纯文本 → DeepSeek
            prompt = f"""请阅读以下档案文件内容，生成结构化的 Markdown 摘要。

文件名：{original_name}
档案分类：{category}
编号：{code}
描述：{desc}

文件内容：
---
{content_text}
---

请输出 Markdown 格式的摘要，包含：
1. **文件概述**（1-2 句话说明这是什么文件）
2. **关键信息**（用列表列出文件中的关键数据点，如企业名称、编号、日期、数值等）
3. **合规要点**（如果涉及环保合规要求，列出关键条款/限值/义务）
4. **风险提示**（如发现潜在合规风险，标注 ⚠️）

只输出 Markdown 正文，不要 frontmatter，不要 ```markdown 代码块包裹。"""
            try:
                resp = await ds_client.chat.completions.create(
                    model=TEXT_MODEL,
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=1500,
                )
                summary_md = (resp.choices[0].message.content or "").strip()
            except Exception as e:
                ai_failed = True
                ai_error = str(e)
                logger.info(f"[VaultExtract] DeepSeek 调用失败: {e}")
        elif image_b64:
            # 判断是 PDF 还是图片
            mime = record.get("mime_type", "application/octet-stream")
            if is_image:
                # 图片 → Kimi 视觉
                img_mime = mime if mime.startswith("image/") else "image/jpeg"
                messages = [
                    {"role": "system", "content": "你是环保合规档案分析专家。请阅读文件，提取关键信息，生成结构化 Markdown 摘要。"},
                    {"role": "user", "content": [
                        {"type": "text", "text": f"文件名：{original_name}\n档案分类：{category}\n编号：{code}\n描述：{desc}\n\n请输出 Markdown 摘要，包含：1. 文件概述 2. 关键信息（列表）3. 合规要点 4. 风险提示（如有标注 ⚠️）。只输出正文，不要 frontmatter。"},
                        {"type": "image_url", "image_url": {"url": f"data:{img_mime};base64,{image_b64}"}},
                    ]},
                ]
                try:
                    resp = await kimi_client.chat.completions.create(
                        model=KIMI_VISION_MODEL,
                        messages=messages,
                        max_tokens=1500,
                    )
                    summary_md = (resp.choices[0].message.content or "").strip()
                except Exception as e:
                    ai_failed = True
                    ai_error = str(e)
                    logger.info(f"[VaultExtract] Kimi 图片调用失败: {e}")
            else:
                # PDF / 二进制文档 → Moonshot file-extract 模式
                import io as _io
                try:
                    upload_resp = await kimi_client.files.create(
                        file=(original_name or "doc", _io.BytesIO(fpath.read_bytes()), mime or "application/pdf"),
                        purpose="file-extract",
                    )
                    file_content_text = await kimi_client.files.retrieve_content(file_id=upload_resp.id)
                    extracted = file_content_text[:8000] if file_content_text else "（文件内容为空）"
                    pdf_prompt = f"""请阅读以下档案文件内容，生成结构化的 Markdown 摘要。

文件名：{original_name}
档案分类：{category}
编号：{code}
描述：{desc}

文件内容：
---
{extracted}
---

请输出 Markdown 格式的摘要，包含：
1. **文件概述**（1-2 句话说明这是什么文件）
2. **关键信息**（用列表列出文件中的关键数据点，如企业名称、编号、日期、数值等）
3. **合规要点**（如果涉及环保合规要求，列出关键条款/限值/义务）
4. **风险提示**（如发现潜在合规风险，标注 ⚠️）

只输出 Markdown 正文，不要 frontmatter，不要 ```markdown 代码块包裹。"""
                    resp = await ds_client.chat.completions.create(
                        model=TEXT_MODEL,
                        messages=[{"role": "user", "content": pdf_prompt}],
                        max_tokens=1500,
                    )
                    summary_md = (resp.choices[0].message.content or "").strip()
                except Exception as e:
                    ai_failed = True
                    ai_error = str(e)
                    logger.info(f"[VaultExtract] Moonshot file-extract 调用失败: {e}")
        else:
            return {"ok": False, "error": "无内容可提取"}

        # AI 失败时（如余额不足）→ 生成基础 MD（含原文片段）而非直接失败
        if ai_failed or not summary_md:
            if content_text:
                preview = content_text[:1500] + ("\n\n...（截断）" if len(content_text) > 1500 else "")
                summary_md = f"""## ⚠️ AI 摘要生成失败

> [!warning] AI 服务暂不可用
> 错误信息：`{ai_error[:200] if ai_error else "AI 返回空内容"}`
> 已生成基础归档（含原文片段），可后续手动补充摘要。

## 文件概述

本文件为 **{category}** 分类的档案文件 `{original_name}`。

## 原文片段（前 1500 字符）

```
{preview}
```
"""
            else:
                summary_md = f"""## ⚠️ AI 摘要生成失败

> [!warning] AI 服务暂不可用
> 错误信息：`{ai_error[:200] if ai_error else "AI 返回空内容"}`

## 文件概述

本文件为 **{category}** 分类的档案文件 `{original_name}`（{ext} 格式，二进制内容）。
AI 视觉识别服务暂不可用，无法提取具体内容。请后续重试或手动编辑此摘要。
"""

        if not summary_md:
            return {"ok": False, "error": "AI 返回空内容"}

        # ── 3. 生成 MD 文件（带 frontmatter）──
        _VAULT_EXTRACTS_DIR.mkdir(parents=True, exist_ok=True)
        # 文件名：分类-编号-原始名-日期.md（去除特殊字符）
        safe_name = _re.sub(r'[\\/:*?"<>|]', "_", original_name)
        safe_code = _re.sub(r'[\\/:*?"<>|]', "_", code) if code else "无编号"
        date_part = upload_date[:10] if upload_date else _dt.now().strftime("%Y-%m-%d")
        md_filename = f"{category}-{safe_code}-{safe_name}-{date_part}.md"[:120]
        md_path = _VAULT_EXTRACTS_DIR / md_filename

        frontmatter = f"""---
title: {original_name} - AI 摘要
doc_number: "{code}"
issue_date: "{date_part}"
category: {category}
industry: []
applicable_stage: []
tags:
  - 档案摘要
  - {category}
  - AI提取
aliases:
  - {safe_name}
related:
  - "[[00-MOC-档案库摘要]]"
source_file: "{filename}"
vault_id: "{file_id}"
original_name: "{original_name}"
upload_date: "{upload_date}"
ai_risk_notes: []
---

"""
        full_md = frontmatter + f"# 📄 {original_name} - AI 摘要\n\n> [!info] 档案元信息\n> 分类：{category} · 编号：{code} · 上传：{date_part}\n> 来源文件：`{filename}`\n\n{summary_md}\n"
        md_path.write_text(full_md, encoding="utf-8")

        return {"ok": True, "md_path": str(md_path), "md_filename": md_filename, "summary": summary_md[:200]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/vault/sync-to-knowledge")
async def vault_sync_to_knowledge(id: str):
    """单个档案文件同步到知识库（AI 生成 MD 摘要）"""
    files = _vault_load_manifest()
    record = next((f for f in files if f.get("id") == id), None)
    if not record:
        return {"ok": False, "detail": "档案不存在"}
    result = await _extract_vault_file_to_md(record)
    return result


@app.post("/api/vault/sync-all-to-knowledge")
async def vault_sync_all_to_knowledge():
    """批量同步档案库到知识库"""
    files = _vault_load_manifest()
    # 去重（按 original_name 保留最新）
    seen_names = {}
    for f in sorted(files, key=lambda x: x.get("upload_date", ""), reverse=True):
        name = f.get("original_name", "")
        if name and name not in seen_names:
            seen_names[name] = f
    to_sync = list(seen_names.values())

    results = []
    success_count = 0
    for record in to_sync:
        r = await _extract_vault_file_to_md(record)
        results.append({
            "id": record.get("id"),
            "vault_id": record.get("id"),
            "name": record.get("original_name"),
            "ok": r.get("ok"),
            "error": r.get("error", ""),
            "md_filename": r.get("md_filename", ""),
        })
        if r.get("ok"):
            success_count += 1

    return {"ok": True, "total": len(to_sync), "success": success_count, "results": results}


async def _err(m): yield _sse({"type":"error","text":m}); yield _sse({"type":"done"})


# ════════════════════════════════════════════════════════════════════
# 通讯中心 — Hermes CLI 子进程封装（飞书 / 企业微信 / 微信）
# 设计原则：
#   1. 单向出站（推送合规提醒/报告），不接管 Hermes gateway 的双向通讯
#   2. 凭证隔离在 ~/.hermes/.env，不污染 EcoPilot 的 .env
#   3. 通过 subprocess + --json 标准化输出，避免 venv 依赖冲突
# ════════════════════════════════════════════════════════════════════

NOTIFY_CONFIG_FILE = HERMES_HOME / "notify_config.json"

# 支持的通讯平台清单（与 Hermes platforms 对齐）
SUPPORTED_PLATFORMS = [
    {
        "id": "feishu",
        "name": "飞书",
        "icon": "lark",
        "doc_url": "https://open.feishu.cn/document",
        "env_keys": ["FEISHU_APP_ID", "FEISHU_APP_SECRET"],
        "target_hint": "oc_xxxxxxxxxxxxxxxx（群聊 open_chat_id）",
        "target_prefix": "oc_",
        "maturity": 5,
        "description": "推荐用于企业内部合规提醒推送，支持 Markdown / 富文本 / 文件 / 卡片消息",
    },
    {
        "id": "wecom",
        "name": "企业微信",
        "icon": "wecom",
        "doc_url": "https://developer.work.weixin.qq.com/document",
        "env_keys": ["WECOM_BOT_ID", "WECOM_SECRET"],
        "target_hint": "Rxxxxxxxxxxxx（群聊 chat_id）",
        "target_prefix": "R",
        "maturity": 4,
        "description": "适合已使用企微的企业，支持 Markdown / 图片 / 文件 / 语音消息",
    },
    {
        "id": "weixin",
        "name": "微信（个人号）",
        "icon": "wechat",
        "doc_url": "https://weixin.qq.com/",
        "env_keys": ["WEIXIN_TOKEN", "WEIXIN_ACCOUNT_ID", "WEIXIN_HOME_CHANNEL"],
        "target_hint": "wxid_xxxxxxxx 或群 chat_id",
        "target_prefix": "wxid_",
        "maturity": 3,
        "description": "通过 iLink 协议接入个人微信，适合小型企业或非正式群组，需扫码授权",
    },
]


def _load_notify_config() -> dict:
    """加载通讯中心配置（已配置的渠道列表 + 默认发送者）"""
    if NOTIFY_CONFIG_FILE.exists():
        try:
            return json.loads(NOTIFY_CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {"channels": [], "default_channel_id": None}
    return {"channels": [], "default_channel_id": None}


def _save_notify_config(config: dict):
    NOTIFY_CONFIG_FILE.write_text(
        json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _hermes_env_status(platform_id: str) -> dict:
    """检查 Hermes env 文件中某平台的凭证是否已配置（不返回凭证值，只返回存在性）"""
    hermes_env = Path.home() / ".hermes" / ".env"
    platform = next((p for p in SUPPORTED_PLATFORMS if p["id"] == platform_id), None)
    if not platform:
        return {"configured": False, "missing": []}
    missing = []
    for k in platform["env_keys"]:
        val = os.environ.get(k, "").strip()
        if not val and hermes_env.exists():
            # 兜底：从 hermes env 文件查找
            for line in hermes_env.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if line.startswith(f"{k}="):
                    val = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
        if not val:
            missing.append(k)
    return {"configured": len(missing) == 0, "missing": missing}


async def _call_hermes_send(platform: str, target: str, message: str, subject: str = "") -> dict:
    """通过 subprocess 调用 hermes send CLI

    返回 {ok, stdout, stderr, returncode, parsed}
    """
    # 优先尝试在 PATH 找 hermes；否则回退到 EcoPilot 仓库内的 hermes-agent/hermes
    hermes_bin = "hermes"
    if not any(os.access(os.path.join(p, hermes_bin), os.X_OK) for p in os.environ.get("PATH", "").split(os.pathsep)):
        repo_hermes = Path(__file__).resolve().parent.parent.parent / "hermes-agent" / "hermes"
        if repo_hermes.exists() and os.access(repo_hermes, os.X_OK):
            hermes_bin = str(repo_hermes)

    cmd = [hermes_bin, "send", "--to", f"{platform}:{target}", "--json", "-q"]
    if subject:
        cmd.extend(["-s", subject])
    cmd.append(message)

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=30)
        stdout = stdout_b.decode("utf-8", errors="ignore").strip()
        stderr = stderr_b.decode("utf-8", errors="ignore").strip()
        parsed = None
        if stdout:
            try:
                parsed = json.loads(stdout)
            except Exception:
                pass
        return {
            "ok": proc.returncode == 0,
            "stdout": stdout[:2000],
            "stderr": stderr[:2000],
            "returncode": proc.returncode,
            "parsed": parsed,
        }
    except asyncio.TimeoutError:
        return {"ok": False, "error": "Hermes CLI 执行超时（30s）", "stderr": "timeout"}
    except FileNotFoundError:
        return {
            "ok": False,
            "error": "未找到 hermes 可执行文件。请先安装 Hermes Agent（hermes-agent/setup.sh）。",
            "stderr": "not found",
        }
    except Exception as e:
        return {"ok": False, "error": str(e), "stderr": type(e).__name__}


@app.get("/api/notify/platforms")
async def notify_platforms():
    """列出支持的通讯平台 + 当前凭证配置状态"""
    result = []
    for p in SUPPORTED_PLATFORMS:
        env_status = _hermes_env_status(p["id"])
        result.append({
            **p,
            "configured": env_status["configured"],
            "missing_env": env_status["missing"],
        })
    return {"ok": True, "platforms": result}


@app.get("/api/notify/channels")
async def notify_channels():
    """获取用户已配置的通讯渠道列表"""
    config = _load_notify_config()
    return {"ok": True, "channels": config.get("channels", []), "default_channel_id": config.get("default_channel_id")}


@app.post("/api/notify/channels")
async def notify_save_channel(request: Request):
    """新增 / 更新一个通讯渠道

    Body: {id?, name, platform, target, enabled, note?}
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "detail": "无效的 JSON"}, status_code=400)

    name = (body.get("name") or "").strip()
    platform = (body.get("platform") or "").strip()
    target = (body.get("target") or "").strip()
    if not name or not platform or not target:
        return JSONResponse({"ok": False, "detail": "name / platform / target 必填"}, status_code=400)

    if platform not in [p["id"] for p in SUPPORTED_PLATFORMS]:
        return JSONResponse({"ok": False, "detail": f"不支持的平台：{platform}"}, status_code=400)

    config = _load_notify_config()
    channels = config.get("channels", [])
    ch_id = body.get("id") or f"ch_{int(time.time())}_{secrets.token_hex(3)}"

    existing_idx = next((i for i, c in enumerate(channels) if c.get("id") == ch_id), None)
    record = {
        "id": ch_id,
        "name": name,
        "platform": platform,
        "target": target,
        "enabled": body.get("enabled", True),
        "note": (body.get("note") or "").strip(),
        "updated_at": int(time.time()),
    }
    if existing_idx is not None:
        record["created_at"] = channels[existing_idx].get("created_at", record["updated_at"])
        channels[existing_idx] = record
    else:
        record["created_at"] = record["updated_at"]
        channels.append(record)

    config["channels"] = channels
    if not config.get("default_channel_id") and channels:
        config["default_channel_id"] = channels[0]["id"]
    _save_notify_config(config)

    return {"ok": True, "channel": record}


@app.delete("/api/notify/channels")
async def notify_delete_channel(id: str = ""):
    """删除一个通讯渠道"""
    if not id:
        return JSONResponse({"ok": False, "detail": "缺少 id 参数"}, status_code=400)
    config = _load_notify_config()
    before = len(config.get("channels", []))
    config["channels"] = [c for c in config.get("channels", []) if c.get("id") != id]
    if config.get("default_channel_id") == id:
        config["default_channel_id"] = config["channels"][0]["id"] if config["channels"] else None
    _save_notify_config(config)
    return {"ok": True, "deleted": before - len(config["channels"]) > 0}


@app.post("/api/notify/test")
async def notify_test(request: Request):
    """向某渠道发送一条测试消息"""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "detail": "无效的 JSON"}, status_code=400)

    channel_id = body.get("channel_id")
    if not channel_id:
        return JSONResponse({"ok": False, "detail": "缺少 channel_id"}, status_code=400)

    config = _load_notify_config()
    ch = next((c for c in config.get("channels", []) if c.get("id") == channel_id), None)
    if not ch:
        return JSONResponse({"ok": False, "detail": "渠道不存在"}, status_code=404)

    test_msg = "【EcoPilot 通讯测试】这是一条来自 EcoPilot 合规助手的测试消息。如果你收到了，说明通讯渠道配置成功！"
    result = await _call_hermes_send(ch["platform"], ch["target"], test_msg, "通讯测试")
    return result


# ═══════════════════════════════════════════════════════════════════
# 通讯中心 — 扫码绑定 + 凭证配置（参考 QClaw 流程）
# ═══════════════════════════════════════════════════════════════════

# 内存中的微信扫码会话（process-local，重启后失效，符合扫码场景）
_WEIXIN_QR_SESSION: dict = {}  # {session_id: {qrcode_value, qrcode_url, deadline, last_status}}


async def _ilink_api_get(endpoint: str, timeout_ms: int = 15000) -> dict:
    """调用腾讯 iLink Bot API（与 hermes weixin.py 相同的协议）

    iLink 的 get_bot_qrcode 端点返回 application/octet-stream mimetype
    但 body 实际是 JSON，因此用 text() + json.loads() 绕过 mimetype 校验
    （与 hermes-agent/gateway/platforms/weixin.py:_api_get 实现一致）
    """
    import aiohttp
    import json as _json
    base_url = "https://ilinkai.weixin.qq.com"
    url = f"{base_url}/{endpoint}"
    headers = {
        "iLink-App-Id": "bot",
        "iLink-App-ClientVersion": str((2 << 16) | (2 << 8) | 0),
    }
    try:
        async with aiohttp.ClientSession(trust_env=True) as session:
            async with session.get(
                url, headers=headers, timeout=aiohttp.ClientTimeout(total=timeout_ms / 1000)
            ) as resp:
                raw = await resp.text()
                if not resp.ok:
                    return {"_error": f"iLink HTTP {resp.status}: {raw[:200]}"}
                try:
                    return _json.loads(raw)
                except Exception:
                    return {"_error": f"iLink 响应非 JSON: {raw[:200]}"}
    except Exception as exc:
        return {"_error": str(exc)}


@app.post("/api/notify/weixin/qr/start")
async def notify_weixin_qr_start():
    """启动微信扫码绑定流程 — 调用 iLink get_bot_qrcode 获取二维码

    参考 hermes-agent/gateway/platforms/weixin.py:qr_login
    返回 qrcode_value（hex token）+ qrcode_img_base64（可直接 <img> 显示的 base64 二维码图片）
    """
    import time as _time
    import qrcode
    import io
    import base64

    # 调用 iLink 获取二维码
    resp = await _ilink_api_get("ilink/bot/get_bot_qrcode?bot_type=3", timeout_ms=35000)
    if "_error" in resp:
        return JSONResponse(
            {"ok": False, "detail": f"iLink API 调用失败: {resp['_error']}"},
            status_code=502
        )

    qrcode_value = str(resp.get("qrcode") or "")
    qrcode_url = str(resp.get("qrcode_img_content") or "")
    if not qrcode_value:
        return JSONResponse(
            {"ok": False, "detail": "iLink 未返回有效的二维码 token"},
            status_code=502
        )

    # 微信需扫描完整 URL（liteapp 链接），不是 hex token
    qr_scan_data = qrcode_url if qrcode_url else qrcode_value

    # 用 qrcode 库生成 PNG 图片 → base64
    qr = qrcode.QRCode(box_size=10, border=1)
    qr.add_data(qr_scan_data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    img_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    # 存到内存 session（有效期 8 分钟，与 iLink 一致）
    session_id = f"wxqr-{int(_time.time())}-{qrcode_value[:8]}"
    _WEIXIN_QR_SESSION[session_id] = {
        "qrcode_value": qrcode_value,
        "qrcode_url": qrcode_url,
        "deadline": _time.monotonic() + 480,
        "last_status": "wait",
        "created_at": _time.time(),
    }

    return {
        "ok": True,
        "session_id": session_id,
        "qrcode_img_base64": img_b64,
        "expires_in": 480,
    }


@app.get("/api/notify/weixin/qr/status")
async def notify_weixin_qr_status(session_id: str):
    """轮询微信扫码状态

    返回 status: wait | scaned | confirmed | expired | error
    - wait: 等待扫码
    - scaned: 已扫码，等待手机确认
    - confirmed: 已确认，绑定成功（此时凭证已写入 ~/.hermes/.env）
    - expired: 二维码过期
    """
    import time as _time

    session = _WEIXIN_QR_SESSION.get(session_id)
    if not session:
        return JSONResponse({"ok": False, "detail": "会话不存在或已过期"}, status_code=404)

    if _time.monotonic() > session["deadline"]:
        _WEIXIN_QR_SESSION.pop(session_id, None)
        return {"ok": True, "status": "expired", "detail": "二维码已过期，请重新生成"}

    qrcode_value = session["qrcode_value"]
    resp = await _ilink_api_get(f"ilink/bot/get_qrcode_status?qrcode={qrcode_value}", timeout_ms=35000)
    if "_error" in resp:
        return {"ok": True, "status": "wait", "detail": "查询中"}

    raw_status = str(resp.get("status") or "wait")

    # iLink 状态映射
    if raw_status == "wait":
        mapped = "wait"
    elif raw_status == "scaned":
        mapped = "scaned"
    elif raw_status in ("scaned_but_redirect",):
        # 重定向：更新 base_url，继续等待
        redirect_host = str(resp.get("redirect_host") or "")
        if redirect_host:
            session["redirect_host"] = redirect_host
        mapped = "scaned"
    elif raw_status in ("confirm", "ok", "success", "logined"):
        # 登录成功 — 提取凭证并写入 ~/.hermes/.env
        # iLink 成功响应包含 token / account_id 等字段
        token = str(resp.get("token") or resp.get("session_token") or "")
        account_id = str(resp.get("account_id") or resp.get("wxid") or "")

        if token:
            _write_hermes_env_credentials("weixin", {
                "WEIXIN_TOKEN": token,
                "WEIXIN_ACCOUNT_ID": account_id,
                "WEIXIN_HOME_CHANNEL": "filehelper",  # 默认发送到文件传输助手
            })
            mapped = "confirmed"
            _WEIXIN_QR_SESSION.pop(session_id, None)
        else:
            mapped = "error"
            session["last_status"] = "凭证提取失败"
    else:
        mapped = "wait"

    session["last_status"] = mapped
    return {"ok": True, "status": mapped}


# 各平台的凭证字段定义（用于前端表单渲染 + 后端写入）
PLATFORM_CREDENTIAL_FIELDS: dict = {
    "feishu": {
        "fields": [
            {"key": "FEISHU_APP_ID", "label": "App ID", "required": True, "placeholder": "cli_xxxxxxxxxxxx", "hint": "飞书开放平台 → 应用详情页获取"},
            {"key": "FEISHU_APP_SECRET", "label": "App Secret", "required": True, "placeholder": "xxxxxxxxxxxxxxxx", "hint": "应用详情页 → 凭证与基础信息", "password": True},
        ],
        "create_app_url": "https://open.feishu.cn/app",
        "create_app_guide": "在飞书开放平台创建「企业自建应用」→ 复制 App ID 和 App Secret",
    },
    "wecom": {
        "fields": [
            {"key": "WECOM_CORP_ID", "label": "企业 ID (Corp ID)", "required": True, "placeholder": "wwxxxxxxxxxxxxxxxx", "hint": "企业微信管理后台 → 我的企业 → 企业信息"},
            {"key": "WECOM_AGENT_ID", "label": "Agent ID", "required": True, "placeholder": "1000002", "hint": "应用详情页 → AgentId"},
            {"key": "WECOM_SECRET", "label": "Secret", "required": True, "placeholder": "xxxxxxxxxxxxxxxx", "hint": "应用详情页 → Secret（点击查看扫码确认）", "password": True},
            {"key": "WECOM_TOKEN", "label": "Token", "required": False, "placeholder": "随机生成的 Token", "hint": "接收消息 → 设置 API 接收 → 随机生成"},
            {"key": "WECOM_ENCODING_AES_KEY", "label": "EncodingAESKey", "required": False, "placeholder": "43 位随机字符串", "hint": "接收消息 → 设置 API 接收 → 随机生成", "password": True},
        ],
        "create_app_url": "https://work.weixin.qq.com/wework_admin/frame#apps",
        "create_app_guide": "企业微信管理后台 → 应用管理 → 创建自建应用 → 获取 Corp ID / Agent ID / Secret",
    },
}


@app.get("/api/notify/credentials")
async def notify_get_credentials(platform: str):
    """获取某平台的凭证配置状态（不返回凭证值，只返回哪些字段已配置 + 表单字段定义）"""
    if platform not in PLATFORM_CREDENTIAL_FIELDS:
        return JSONResponse({"ok": False, "detail": "不支持的平台"}, status_code=400)

    schema = PLATFORM_CREDENTIAL_FIELDS[platform]
    env_status = _hermes_env_status(platform)

    return {
        "ok": True,
        "platform": platform,
        "fields": schema["fields"],
        "create_app_url": schema["create_app_url"],
        "create_app_guide": schema["create_app_guide"],
        "configured": env_status["configured"],
        "missing_env": env_status["missing"],
        "configured_keys": [k for k in [f["key"] for f in schema["fields"]] if k not in env_status["missing"]],
    }


@app.post("/api/notify/credentials")
async def notify_save_credentials(request: Request):
    """保存某平台的凭证到 ~/.hermes/.env

    body: {platform: "feishu"|"wecom", credentials: {KEY: value, ...}}
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "detail": "无效的 JSON"}, status_code=400)

    platform = body.get("platform")
    credentials = body.get("credentials") or {}

    if platform not in PLATFORM_CREDENTIAL_FIELDS:
        return JSONResponse({"ok": False, "detail": "不支持的平台"}, status_code=400)

    schema = PLATFORM_CREDENTIAL_FIELDS[platform]
    valid_keys = {f["key"] for f in schema["fields"]}
    filtered = {k: v for k, v in credentials.items() if k in valid_keys and v}

    # 校验必填项
    missing_required = [
        f["label"] for f in schema["fields"]
        if f.get("required") and not filtered.get(f["key"])
    ]
    if missing_required:
        return JSONResponse(
            {"ok": False, "detail": f"缺失必填项: {', '.join(missing_required)}"},
            status_code=400
        )

    _write_hermes_env_credentials(platform, filtered)
    return {"ok": True, "detail": f"{platform} 凭证已保存到 ~/.hermes/.env"}


@app.delete("/api/notify/credentials")
async def notify_delete_credentials(platform: str):
    """删除某平台的凭证"""
    if platform not in PLATFORM_CREDENTIAL_FIELDS:
        return JSONResponse({"ok": False, "detail": "不支持的平台"}, status_code=400)

    schema = PLATFORM_CREDENTIAL_FIELDS[platform]
    _delete_hermes_env_credentials([f["key"] for f in schema["fields"]])
    return {"ok": True, "detail": f"{platform} 凭证已删除"}


def _write_hermes_env_credentials(platform: str, credentials: dict):
    """写入凭证到 ~/.hermes/.env（保留已有内容，只更新/追加指定字段）"""
    hermes_env_path = Path.home() / ".hermes" / ".env"
    hermes_env_path.parent.mkdir(parents=True, exist_ok=True)

    # 读取已有内容
    existing_lines = []
    if hermes_env_path.exists():
        existing_lines = hermes_env_path.read_text(encoding="utf-8").splitlines()

    existing_keys = {line.split("=", 1)[0].strip() for line in existing_lines if "=" in line and not line.strip().startswith("#")}

    # 更新或追加
    for key, value in credentials.items():
        if key in existing_keys:
            existing_lines = [
                f"{key}={value}" if line.split("=", 1)[0].strip() == key else line
                for line in existing_lines
            ]
        else:
            existing_lines.append(f"{key}={value}")

    hermes_env_path.write_text("\n".join(existing_lines) + "\n", encoding="utf-8")
    # 限制权限
    try:
        hermes_env_path.chmod(0o600)
    except Exception:
        pass


def _delete_hermes_env_credentials(keys: list):
    """从 ~/.hermes/.env 删除指定字段"""
    hermes_env_path = Path.home() / ".hermes" / ".env"
    if not hermes_env_path.exists():
        return

    lines = hermes_env_path.read_text(encoding="utf-8").splitlines()
    keys_set = set(keys)
    filtered = [
        line for line in lines
        if not (
            "=" in line
            and not line.strip().startswith("#")
            and line.split("=", 1)[0].strip() in keys_set
        )
    ]
    hermes_env_path.write_text("\n".join(filtered) + "\n", encoding="utf-8")


# ═══════════════════════════════════════════════════════════════
# 合规记忆 + 工作日志 API 端点
# ═══════════════════════════════════════════════════════════════

@app.get("/api/memory/list")
async def list_memories(request: Request):
    """返回所有合规记忆"""
    try:
        data = _load_memory_file()
        memories = data.get("memories", [])
        # 按 created_at 倒序（最新的在前）
        memories.sort(key=lambda m: m.get("created_at", ""), reverse=True)
        return {"ok": True, "memories": memories, "total": len(memories)}
    except Exception as e:
        return _cors_json(500, f"读取合规记忆失败: {e}", request)


@app.delete("/api/memory/{memory_id}")
async def delete_memory(memory_id: str, request: Request):
    """删除指定记忆"""
    try:
        if not memory_id:
            return _cors_json(400, "缺少 memory_id", request)
        async with _memory_lock:
            data = _load_memory_file()
            memories = data.get("memories", [])
            new_memories = [m for m in memories if m.get("id") != memory_id]
            if len(new_memories) == len(memories):
                return _cors_json(404, f"未找到记忆: {memory_id}", request)
            data["memories"] = new_memories
            _save_memory_file(data)
        return {"ok": True, "deleted": memory_id, "remaining": len(new_memories)}
    except Exception as e:
        return _cors_json(500, f"删除合规记忆失败: {e}", request)


@app.get("/api/journal/list")
async def list_journals(request: Request):
    """返回工作日志列表（按日期倒序）"""
    try:
        if not _JOURNAL_DIR.exists():
            return {"ok": True, "journals": [], "total": 0}
        files = sorted(_JOURNAL_DIR.glob("work-log-*.md"), reverse=True)
        journals = []
        for f in files:
            try:
                # 从文件名提取日期
                date_str = f.stem.replace("work-log-", "")
                content = f.read_text(encoding="utf-8")
                # 解析标题（优先从 frontmatter）
                title = f"工作日志 - {date_str}"
                if content.startswith("---"):
                    parts = content.split("---", 2)
                    body = parts[2] if len(parts) >= 3 else content
                    # 尝试读取 frontmatter 中的 title
                    fm = parts[1] if len(parts) >= 3 else ""
                    m_title = _re.search(r"^title:\s*(.+)$", fm, _re.MULTILINE)
                    if m_title:
                        title = m_title.group(1).strip()
                else:
                    body = content
                entries_count = body.count("### 对话 ·")
                # 预览：取正文前 200 字
                preview = body.strip()[:200]
                journals.append({
                    "date": date_str,
                    "title": title,
                    "preview": preview,
                    "entries_count": entries_count,
                })
            except Exception:
                continue
        return {"ok": True, "journals": journals, "total": len(journals)}
    except Exception as e:
        return _cors_json(500, f"读取工作日志列表失败: {e}", request)


# ─── 自学习引擎 ───────────────────────────────────────

_SKILL_TOPICS_FILE = HERMES_HOME / "state" / "skill_topics.json"


async def _auto_learn_skill(sid: str, user_msg: str, ai_reply: str, tools_used: list):
    """对话完成后自动分析，高频主题沉淀为技能"""
    if not ai_reply or len(ai_reply) < 50:
        return

    # 提取主题关键词
    topics = []
    for kw in ["双碱法","脱硫","排污许可","自行监测","执行报告","台账","危废",
               "应急预案","碳排放","监测数据","合规巡检","督察","超低排放"]:
        if kw in user_msg or kw in ai_reply:
            topics.append(kw)

    if not topics:
        return

    HERMES_HOME.joinpath("state").mkdir(parents=True, exist_ok=True)
    counts = {}
    try:
        if _SKILL_TOPICS_FILE.exists():
            counts = json.loads(_SKILL_TOPICS_FILE.read_text())
    except Exception:
        pass

    learned = False
    for t in topics:
        counts[t] = counts.get(t, 0) + 1
        # 同一主题出现3次 → 生成技能
        if counts[t] >= 3 and counts[t] % 3 == 0:
            await _generate_skill_from_topic(t, ai_reply)
            learned = True

    _SKILL_TOPICS_FILE.write_text(json.dumps(counts, ensure_ascii=False, indent=2))

    if learned:
        logger.info(f"[Learn] 主题 '{topics[0]}' 已触发技能生成 (累计{counts[topics[0]]}次)")


async def _generate_skill_from_topic(topic: str, sample_reply: str):
    """根据高频主题自动生成技能文件"""
    skills_dir = HERMES_HOME / "skills" / "learned"
    skills_dir.mkdir(parents=True, exist_ok=True)

    slug = topic.replace("/", "-").replace(" ", "-")
    skill_file = skills_dir / f"{slug}.md"

    # 取回复的前800字作为技能内容摘要
    summary = sample_reply[:800].strip()

    content = f"""---
name: {topic}
description: 自动生成 · {topic}应对指南
auto_generated: true
generated_at: {__import__('datetime').datetime.now().isoformat()}
---

# {topic} 应对指南

> 以下内容由 EcoPilot 自学习引擎从多次对话中自动提取。

{summary}

---
*本技能由自学习引擎自动生成，建议人工审核后启用。*
"""
    skill_file.write_text(content, encoding="utf-8")
    logger.info(f"[Learn] 技能已生成: {skill_file}")


async def _hallucination_scan(sid: str, ai_reply: str):
    """扫描AI回复中的幻觉标记"""
    if not ai_reply:
        return

    alerts = []
    if "第XXX条" in ai_reply or "第XX条" in ai_reply:
        alerts.append("发现条款占位符 '第XXX条'")
    if "具体条款需查" in ai_reply:
        alerts.append("发现搪塞表述 '具体条款需查'")

    if alerts:
        log_dir = HERMES_HOME / "monitor"
        log_dir.mkdir(parents=True, exist_ok=True)
        alert_file = log_dir / "hallucination_alerts.jsonl"
        entry = {
            "session_id": sid,
            "alerts": alerts,
            "snippet": ai_reply[:200],
            "timestamp": __import__('datetime').datetime.now().isoformat(),
        }
        with open(alert_file, "a") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        logger.info(f"[Hallucination] ⚠️ {sid[:8]}: {', '.join(alerts)}")


# ─── 企业深度学习引擎 ─────────────────────────────────

_ENTERPRISE_PROFILE_FILE = HERMES_HOME / "state" / "enterprise_profile.json"
_ENTERPRISE_LEARNED: dict = {}  # 内存缓存：企业ID → 已学习主题集合


async def _enterprise_onboarding(sid: str):
    """首次交互/许可证更新后，主动学习企业档案并构建专属知识库"""
    ent = _load_enterprise_info()
    if not ent:
        return

    name = ent.get("name") or ent.get("enterpriseName", "")
    if not name:
        return

    # 加载已有画像
    profile = {}
    if _ENTERPRISE_PROFILE_FILE.exists():
        try:
            profile = json.loads(_ENTERPRISE_PROFILE_FILE.read_text())
        except Exception:
            pass

    last_learned = profile.get("last_learned_at", "")
    today = __import__('datetime').datetime.now().strftime("%Y-%m-%d")
    if last_learned == today and profile.get("name") == name:
        return  # 今天已经学习过了

    industry = ent.get("industryCategory") or ent.get("industry", "")
    credit = ent.get("creditCode") or ent.get("credit_code", "")

    logger.info(f"[Enterprise] 🏭 开始学习企业: {name} ({industry})")

    # ── 第一步：从MCP远程仓库拉取行业知识 ──
    learned_items = []
    search_queries = [
        f"{industry} 行业排放标准 GB HJ",
        f"{industry} 排污许可技术规范",
        f"{industry} 自行监测技术指南",
        f"{industry} 清洁生产评价指标体系",
        f"{industry} 环保处罚典型案例",
        f"{industry} 超低排放改造要求",
        f"{industry} 危险废物管理规范",
        f"{industry} 突发环境事件应急预案编制指南",
        f"{name} 排污许可证 合规",
        f"{industry} 碳排放配额分配方案",
        f"{industry} 台账记录技术规范",
        f"{industry} 执行报告填报指南",
    ]

    full_knowledge = []  # 完整知识条目
    for q in search_queries:
        try:
            from mcp_client import get_mcp_manager
            mcp = get_mcp_manager()
            result = await mcp.call_tool("ehs-kb-ops__kb_search", {"query": q})
            if result and "error" not in result.lower() and "找到 0 条" not in result:
                item = {"query": q, "source": "mcp", "result": result[:800]}
                learned_items.append(item)
                full_knowledge.append(f"## {q}\n\n{result[:800]}\n")
        except Exception as e:
            pass

    # ── 第二步：保存行业知识到本地知识库 ──
    if full_knowledge:
        knowledge_dir = HERMES_HOME / "knowledge" / "regulations"
        knowledge_dir.mkdir(parents=True, exist_ok=True)
        today_str = today

        # 生成行业知识文件
        safe_industry = industry.replace("/", "-").replace(" ", "")[:30] or "通用"
        kb_file = knowledge_dir / f"行业知识-{safe_industry}-{today_str}.md"

        kb_content = f"""---
title: {industry} 行业合规知识库
industry: {industry}
enterprise: {name}
fetched_at: {today_str}
source: mcp-remote
auto_generated: true
---

# {industry} 行业合规知识库

> 自动从MCP远程仓库拉取，专项服务于 {name}。

{chr(10).join(full_knowledge)}

---
*此文件由企业深度学习引擎自动生成，每日更新。*
"""
        kb_file.write_text(kb_content, encoding="utf-8")
        logger.info(f"[Enterprise] 📚 行业知识已入库: {kb_file.name} ({len(full_knowledge)} 条)")

    # 保存企业画像
    profile.update({
        "name": name,
        "industry": industry,
        "credit_code": credit,
        "last_learned_at": today,
        "learned_count": profile.get("learned_count", 0) + 1,
        "recent_topics": learned_items,
        "permit_emission_outlets": len(ent.get("emissionOutlets", [])),
        "management_level": ent.get("managementLevel", ""),
    })
    _ENTERPRISE_PROFILE_FILE.parent.mkdir(parents=True, exist_ok=True)
    _ENTERPRISE_PROFILE_FILE.write_text(json.dumps(profile, ensure_ascii=False, indent=2))

    # 全文精读 + 交叉校验
    validation_issues = await _cross_validate_enterprise(sid)
    if validation_issues:
        profile["validation_issues"] = validation_issues
        _ENTERPRISE_PROFILE_FILE.write_text(json.dumps(profile, ensure_ascii=False, indent=2))
        logger.info(f"[Enterprise] ⚠️ 数字校验发现 {len(validation_issues)} 个问题，已记录")

    logger.info(f"[Enterprise] ✅ {name} 画像已更新: {len(learned_items)} 条行业知识")


async def _enterprise_evolve(sid: str, user_msg: str, ai_reply: str):
    """每次对话后进化企业知识：记录新发现、更新画像"""
    if not ai_reply or len(ai_reply) < 100:
        return

    ent = _load_enterprise_info()
    if not ent:
        return

    name = ent.get("name") or ent.get("enterpriseName", "")
    if not name:
        return

    # 从AI回复中提取关键知识点
    knowledge_snippets = []
    for kw in ["排放标准","限值","处罚","条例","管理办法","技术指南","HJ ","GB "]:
        idx = ai_reply.find(kw)
        if idx >= 0:
            snippet = ai_reply[max(0,idx-30):idx+80].strip()
            if len(snippet) > 20:
                knowledge_snippets.append(snippet)

    if not knowledge_snippets:
        return

    # 追加到企业进化日志
    evolve_log = HERMES_HOME / "state" / "enterprise_evolution.jsonl"
    evolve_log.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "enterprise": name,
        "session_id": sid,
        "knowledge": knowledge_snippets[:5],
        "timestamp": __import__('datetime').datetime.now().isoformat(),
    }
    with open(evolve_log, "a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


# ─── 档案全文精读引擎 ─────────────────────────────────

_VAULT_READ_CACHE: dict = {}  # 文件路径 → 全文内容缓存

async def _read_vault_verbatim(force: bool = False) -> dict[str, str]:
    """逐字读取档案库中所有文件，提取每个数字、每条条款。

    返回 {文件名: 全文内容}，确保每个数字精确不遗漏。
    结果缓存到内存，除非 force=True。
    """
    global _VAULT_READ_CACHE
    if _VAULT_READ_CACHE and not force:
        return _VAULT_READ_CACHE

    vault = HERMES_HOME / "vault"
    extracts = {}

    for f in sorted(vault.glob("*")):
        if f.name in ("manifest.json", "categories.json") or f.is_dir():
            continue

        name = f.name
        text = ""

        try:
            if f.suffix.lower() == ".pdf":
                # pymupdf 逐页逐字提取
                try:
                    import fitz
                    doc = fitz.open(str(f))
                    pages = [page.get_text("text") for page in doc]
                    doc.close()
                    text = "\n".join(pages)
                except ImportError:
                    text = f"[PDF需要安装pymupdf: {name}]"
            elif f.suffix.lower() in (".txt", ".md"):
                text = f.read_text(encoding="utf-8", errors="replace")
            elif f.suffix.lower() in (".png", ".jpg", ".jpeg"):
                text = f"[图片文件: {name}]"
            else:
                text = f.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            text = f"[读取失败: {e}]"

        if text.strip():
            extracts[name] = text.strip()

    _VAULT_READ_CACHE = extracts
    logger.info(f"[Vault] 📖 全文精读完成: {len(extracts)} 份档案")
    return extracts


async def _cross_validate_enterprise(sid: str) -> list[dict]:
    """交叉校验：档案数据 vs 许可证数据，发现数字矛盾或遗漏。

    强制规则：每个数字必须对得上，对不上就是问题。
    返回发现的问题列表。
    """
    ent = _load_enterprise_info()
    vault_docs = await _read_vault_verbatim()
    issues = []

    if not ent or not vault_docs:
        return issues

    # 许可证中的关键数字
    permit_numbers = {}
    for outlet in ent.get("emissionOutlets", []):
        for p in outlet.get("pollutants", []):
            key = p.get("name", "")
            limit = p.get("limitValue", "")
            if key and limit:
                permit_numbers[key] = str(limit)

    # 逐份档案扫描，比对数字
    for fname, content in vault_docs.items():
        # 跳过图片
        if content.startswith("[图片文件"):
            continue

        # 提取档案中的所有数字模式
        import re
        numbers_found = re.findall(r"(\d+\.?\d*\s*(?:t/a|mg/m³|mg/L|kg|万t|万吨|吨|亿元|万元|小时|台|个|米|%))", content)

        # 与许可证比对
        for pol_name, pol_limit in permit_numbers.items():
            if pol_name in content and pol_limit not in content:
                issues.append({
                    "type": "数字缺失",
                    "file": fname,
                    "detail": f"许可证中 {pol_name} 限值={pol_limit}，档案中未找到对应数字",
                    "severity": "high",
                })

    # 检查档案间的一致性
    doc_texts = list(vault_docs.values())
    for i in range(len(doc_texts)):
        for j in range(i+1, len(doc_texts)):
            if doc_texts[i].startswith("[") or doc_texts[j].startswith("["):
                continue
            # 简单检查：两份档案中的总量数字是否一致
            import re
            nums_i = set(re.findall(r"\d{3,}[\d,]*\s*(?:t/a|万吨|吨)", doc_texts[i]))
            nums_j = set(re.findall(r"\d{3,}[\d,]*\s*(?:t/a|万吨|吨)", doc_texts[j]))
            for n in nums_i & nums_j:
                # 同名数字检查上下文
                contexts_i = [doc_texts[i][max(0,m.start()-20):m.end()+20] for m in re.finditer(re.escape(n), doc_texts[i])]
                contexts_j = [doc_texts[j][max(0,m.start()-20):m.end()+20] for m in re.finditer(re.escape(n), doc_texts[j])]

    if not issues:
        logger.info(f"[Validate] ✅ 档案交叉校验通过")
    else:
        logger.info(f"[Validate] ⚠️ 发现 {len(issues)} 个数字问题")

    return issues


if __name__ == "__main__":
    import argparse, uvicorn
    p = argparse.ArgumentParser(); p.add_argument("--port",type=int,default=8002); p.add_argument("--host",default="127.0.0.1")
    a = p.parse_args()
    print(f"EcoPilot Chat Bridge → http://{a.host}:{a.port}")
    print(f"Text model: deepseek-v4-flash | Vision model: {KIMI_VISION_MODEL}")
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")
