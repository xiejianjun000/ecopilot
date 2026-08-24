"""
Hermes AI 引擎适配层
将 Hermes 的 4层记忆、自学习、GEPA 进化、多Agent协作
适配为 EcoPilot 合规助手的增强能力

集成方式：
1. 记忆层 (Phase 1) — 企业信息自动记忆、法规查询缓存、合规历史
2. 自学习层 (Phase 2) — 从用户反馈中学习、合规模式识别、个性化建议
3. 多Agent层 (Phase 3) — 法规Agent、许可Agent、监测Agent、税务Agent
4. GEPA进化层 (Phase 4) — 提示词自动优化、响应质量评估、持续改进

启动: hermes_adapter.py 作为模块被 chat_api.py 引入
"""

import json
import os
import time
import hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, Dict, List, Any

from logging_config import get_logger
logger = get_logger("hermes_adapter")

# ── 配置 ──
HERMES_ENABLED = os.environ.get("HERMES_ENABLED", "true").lower() == "true"
HERMES_BASE_URL = os.environ.get("HERMES_BASE_URL", "http://localhost:20128/v1")
HERMES_API_KEY = os.environ.get("HERMES_API_KEY", "hermes-ecopilot-key")
HERMES_MODEL = os.environ.get("HERMES_MODEL", "hermes-v1")

# ── 子代理技能路径配置 ──
# 优先从 ~/.hermes/skills/ecopilot-<agent>.md 加载
# 兜底（如 Hermes 未安装）从 ~/.ecopilot-home/agents/合规助手/子代理/<agent>.md 加载
_HERMES_SKILLS_DIR = Path.home() / ".hermes" / "skills"
_ECOPILOT_AGENTS_DIR = Path.home() / ".ecopilot-home" / "agents" / "合规助手" / "子代理"

# agent_id（hermes_adapter 内部用）→ skill_id（用于 Hermes 技能目录） → 子代理 MD 文件名
AGENT_SKILL_MAP: Dict[str, Dict[str, str]] = {
    "central_orchestrator": {
        "skill_id": "ecopilot-central-orchestrator",
        "md_name": "合规管家主理人.md",
    },
    "regulation_search": {
        "skill_id": "ecopilot-regulation-search",
        "md_name": "法规检索.md",
    },
    "industry_compliance": {
        "skill_id": "ecopilot-industry-compliance",
        "md_name": "行业合规.md",
    },
    "data_verification": {
        "skill_id": "ecopilot-data-verification",
        "md_name": "数据核验.md",
    },
    "risk_warning": {
        "skill_id": "ecopilot-risk-warning",
        "md_name": "风险预警.md",
    },
    "enforcement_response": {
        "skill_id": "ecopilot-enforcement-response",
        "md_name": "应对执法.md",
    },
    "doc_generation": {
        "skill_id": "ecopilot-doc-generation",
        "md_name": "文书生成.md",
    },
}

_AGENT_SKILL_TEXT_CACHE: Dict[str, str] = {}


def _load_agent_skill_content(agent_id: str) -> str:
    """根据路由到的 agent_id，加载对应的子代理 SKILL.md/MD 内容。

    搜索顺序：
      1. ~/.hermes/skills/<skill_id>/SKILL.md（Hermes 技能目录，优先）
      2. ~/.ecopilot-home/agents/合规助手/子代理/<md_name>（兜底源文件）
      3. "" （两个路径都不存在时返回空串，不注入）

    结果做内存缓存（进程生命周期内），避免每次请求都读文件。
    """
    if agent_id not in AGENT_SKILL_MAP:
        logger.info(f"[SKILL] ⚠️ 未知 agent_id '{agent_id}'，不在 AGENT_SKILL_MAP 中")
        return ""

    cached = _AGENT_SKILL_TEXT_CACHE.get(agent_id)
    if cached is not None:
        logger.info(f"[SKILL] 📦 缓存命中 {agent_id} ({len(cached)} 字符)")
        return cached

    meta = AGENT_SKILL_MAP[agent_id]
    skill_id = meta["skill_id"]
    md_name = meta["md_name"]

    content: str = ""

    # 1) Hermes 技能目录
    hermes_skill_file = _HERMES_SKILLS_DIR / skill_id / "SKILL.md"
    if hermes_skill_file.exists():
        try:
            content = hermes_skill_file.read_text(encoding="utf-8")
            logger.info(f"[SKILL] 📄 从 Hermes 加载: {hermes_skill_file} ({len(content)} 字符)")
        except Exception as e:
            logger.info(f"[SKILL] ⚠️ Hermes 文件读取失败: {hermes_skill_file} — {e}")
            content = ""

    # 2) 兜底：.ecopilot-home 的子代理源 MD（更完整）
    if not content:
        agent_md_file = _ECOPILOT_AGENTS_DIR / md_name
        if agent_md_file.exists():
            try:
                raw = agent_md_file.read_text(encoding="utf-8")
                logger.info(f"[SKILL] 📄 从兜底目录加载: {agent_md_file} ({len(raw)} 字符)")
                # 为了不把系统提示词塞得太长，只取前 1/3 内容
                # （身份/信念/边界/核心能力）跳过交付物模板等冗长部分
                lines = raw.splitlines()
                cut_idx = len(lines)
                for i, line in enumerate(lines):
                    if line.strip().startswith("## 我的技术交付物") or \
                       line.strip().startswith("## 技术交付物") or \
                       line.strip().startswith("## 输出规范"):
                        cut_idx = i
                        break
                content = "\n".join(lines[:cut_idx])
            except Exception as e:
                logger.info(f"[SKILL] ⚠️ 兜底文件读取失败: {agent_md_file} — {e}")
                content = ""
        else:
            logger.info(f"[SKILL] ⚠️ 两个路径都不存在: Hermes={hermes_skill_file} 兜底={agent_md_file}")

    _AGENT_SKILL_TEXT_CACHE[agent_id] = content
    return content


# 记忆存储路径 — 优先使用 ~/.ecopilot-home/memory，否则使用本地 memory 目录
_HERMES_HOME = Path.home() / ".ecopilot-home"
MEMORY_DIR = _HERMES_HOME / "memory"
if not _HERMES_HOME.exists():
    MEMORY_DIR = Path(__file__).parent / "memory"
MEMORY_DIR.mkdir(parents=True, exist_ok=True)

SESSION_MEMORY = MEMORY_DIR / "sessions.json"
ENTERPRISE_MEMORY = MEMORY_DIR / "enterprises.json"
REGULATION_CACHE = MEMORY_DIR / "regulations_cache.json"
LEARNING_LOG = MEMORY_DIR / "learning_log.json"


class HermesMemoryLayer:
    """第一层：记忆管理"""

    def __init__(self):
        self.sessions = self._load(SESSION_MEMORY, {})
        self.enterprises = self._load(ENTERPRISE_MEMORY, {})
        self.reg_cache = self._load(REGULATION_CACHE, {})

    def _load(self, path, default):
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                return default
        return default

    def _save(self, path, data):
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def save_session_context(self, session_id: str, enterprise_id: str, context: dict):
        """保存会话上下文到记忆"""
        if session_id not in self.sessions:
            self.sessions[session_id] = {}
        self.sessions[session_id].update({
            "enterprise_id": enterprise_id,
            "context": context,
            "updated_at": datetime.now(timezone(timedelta(hours=8))).isoformat()
        })
        self._save(SESSION_MEMORY, self.sessions)

    def get_session_context(self, session_id: str) -> Optional[dict]:
        """获取会话记忆"""
        return self.sessions.get(session_id)

    def save_enterprise_profile(self, enterprise_id: str, profile: dict):
        """保存企业画像（越用越懂你的企业）"""
        existing = self.enterprises.get(enterprise_id, {})
        # 合并更新（保留历史）
        for key, value in profile.items():
            if key in existing and isinstance(existing[key], list):
                existing[key].extend(value if isinstance(value, list) else [value])
            else:
                existing[key] = value
        existing["updated_at"] = datetime.now(timezone(timedelta(hours=8))).isoformat()
        self.enterprises[enterprise_id] = existing
        self._save(ENTERPRISE_MEMORY, self.enterprises)

    def get_enterprise_profile(self, enterprise_id: str) -> Optional[dict]:
        """获取企业画像"""
        return self.enterprises.get(enterprise_id)

    def cache_regulation_query(self, query_hash: str, result: dict):
        """缓存法规查询结果"""
        self.reg_cache[query_hash] = {
            "result": result,
            "cached_at": datetime.now(timezone(timedelta(hours=8))).isoformat()
        }
        self._save(REGULATION_CACHE, self.reg_cache)

    def get_cached_regulation(self, query_hash: str) -> Optional[dict]:
        """获取缓存的法规查询"""
        entry = self.reg_cache.get(query_hash)
        if entry:
            # 缓存有效期7天
            try:
                cached_at = datetime.fromisoformat(entry["cached_at"])
                if datetime.now(timezone(timedelta(hours=8))) - cached_at < timedelta(days=7):
                    return entry["result"]
            except Exception:
                pass
        return None


class HermesSelfLearningLayer:
    """第二层：自学习"""

    def __init__(self):
        self.log = self._load(LEARNING_LOG, {"patterns": [], "feedback": []})

    def _load(self, path, default):
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                return default
        return default

    def _save(self):
        MEMORY_DIR.mkdir(parents=True, exist_ok=True)
        LEARNING_LOG.write_text(json.dumps(self.log, ensure_ascii=False, indent=2), encoding="utf-8")

    def record_feedback(self, session_id: str, query: str, response: str, rating: str, comment: str = ""):
        """记录用户反馈"""
        self.log["feedback"].append({
            "session_id": session_id,
            "query": query,
            "response": response,
            "rating": rating,
            "comment": comment,
            "recorded_at": datetime.now(timezone(timedelta(hours=8))).isoformat()
        })
        self._save()

    def identify_patterns(self, enterprise_id: str) -> List[dict]:
        """识别企业的合规模式"""
        patterns = []
        feedback_list = [f for f in self.log["feedback"] if f.get("session_id", "").startswith(enterprise_id)]
        # 分析高频问题类型
        if feedback_list:
            patterns.append({
                "enterprise_id": enterprise_id,
                "total_interactions": len(feedback_list),
                "positive_rate": sum(1 for f in feedback_list if f["rating"] in ("positive", "helpful")) / len(feedback_list),
                "common_topics": list(set(f["query"][:20] for f in feedback_list[-20:])),
                "identified_at": datetime.now(timezone(timedelta(hours=8))).isoformat()
            })
        return patterns


class HermesAgentRouter:
    """第三层：多Agent路由（7个业务流程子代理，企业视角，全要素覆盖）

    架构设计：
    - 业务流程为主：按"法条/合规/数据/预警/执法/文书"6个业务流程分工
    - 要素技能装配：行业+要素专业纵深通过 EcoSkills 技能市场动态装配
    - 合规管家主理人为默认路由：无法明确路由或需多代理协作时走编排
    """

    AGENTS = {
        "central_orchestrator": {
            "name": "合规管家主理人",
            "description": "多代理协作路由、融合、裁决。不面向用户，是管家内部的编排人格。",
            "layer": "sub-agent",
            "perspective": "enterprise",
            "skill_assembly": [],
        },
        "regulation_search": {
            "name": "法规检索",
            "description": "法条定位、版本对照、引用核查、企业义务解读。一条法款编号错了就是全错。",
            "layer": "sub-agent",
            "perspective": "enterprise",
            "skill_assembly": [],
        },
        "industry_compliance": {
            "name": "行业合规",
            "description": "工艺合规判断、监测方案审查、行业规范对标、环评分类、三同时核验。要素专业纵深来自：水污染/大气污染/危废管理/土壤地下水/噪声/辐射/碳排放等要素技能装配。",
            "layer": "sub-agent",
            "perspective": "enterprise",
            "skill_assembly": ["water_pollution", "air_pollution", "hazardous_waste",
                              "soil_groundwater", "noise", "radiation", "carbon_emission",
                              "new_pollutants", "emission_trading"],
        },
        "data_verification": {
            "name": "数据核验",
            "description": "监测数据达标、台账完整性、报告一致性、超标计算、标准版本核查。企业自检自纠，不是执法取证。要素数据核验能力来自要素技能装配。",
            "layer": "sub-agent",
            "perspective": "enterprise",
            "skill_assembly": ["water_pollution", "air_pollution", "hazardous_waste",
                              "soil_groundwater", "noise", "radiation", "carbon_emission",
                              "environmental_tax"],
        },
        "risk_warning": {
            "name": "风险预警",
            "description": "许可证到期预警、报告截止提醒、监测数据异常识别、案例教训预警、应急演练提醒。管家不等问就说的主动能力。时限预警能力来自要素技能装配（危废贮存时限/辐射安全/碳排放履约/应急预案修订）。",
            "layer": "sub-agent",
            "perspective": "enterprise",
            "skill_assembly": ["hazardous_waste", "radiation", "environmental_emergency",
                              "carbon_emission", "soil_groundwater"],
        },
        "enforcement_response": {
            "name": "应对执法",
            "description": "现场检查配合、执法文书应对、违法行为自查、整改方案指引、类案参照（正向借鉴）、权利告知。站在企业这边，不替执法者定性。",
            "layer": "sub-agent",
            "perspective": "enterprise",
            "skill_assembly": ["environmental_emergency"],
        },
        "doc_generation": {
            "name": "文书生成",
            "description": "执行报告、监测报告、整改报告、信息公开稿。要素专项文书来自技能装配（危废管理计划/土壤隐患排查/碳排放履约/环境应急预案/环境税申报）。不出执法文书。",
            "layer": "sub-agent",
            "perspective": "enterprise",
            "skill_assembly": ["hazardous_waste", "soil_groundwater", "carbon_emission",
                              "environmental_emergency", "environmental_tax",
                              "emission_trading"],
        },
    }

    # 要素技能ID → 人类可读名称映射（与 EcoSkills 市场的 skill_id 对应）
    ELEMENT_SKILL_NAMES = {
        "water_pollution": "水污染合规技能",
        "air_pollution": "大气污染合规技能",
        "hazardous_waste": "危废管理技能",
        "soil_groundwater": "土壤地下水技能",
        "noise": "噪声管理技能",
        "radiation": "辐射管理技能",
        "carbon_emission": "碳排放管理技能",
        "environmental_emergency": "环境应急技能",
        "new_pollutants": "新污染物技能",
        "environmental_tax": "环境税技能",
        "emission_trading": "排污权交易技能",
    }

    def route(self, query: str, context: dict = None) -> dict:
        """根据用户查询路由到最合适的业务流程子代理（企业视角）

        路由优先级：
        1. 执法应对相关关键词（最高优先级，避免被法规检索抢走）
        2. 风险预警相关关键词
        3. 文书生成相关关键词
        4. 数据核验相关关键词
        5. 行业合规相关关键词
        6. 法规检索相关关键词
        7. 默认 → 合规管家主理人

        Args:
            query: 用户输入
            context: 可选上下文 {industry_code, management_level, elements: [...]}
                     用于要素技能装配提示
        """
        # ── 关键词匹配路由（企业视角业务流程） ──
        routing_rules = {
            # 执法应对（最高优先级：避免被法规检索抢走"处罚/违法"）
            "enforcement_response": [
                "检查", "现场", "执法", "来了", "明天", "今天到",
                "决定书", "责令改正", "处罚告知", "处罚决定", "听证通知",
                "陈述申辩", "复议", "诉讼", "笔录", "配合", "应对",
                "整改方案", "怎么改", "怎么办", "风险", "自查",
            ],
            # 风险预警
            "risk_warning": [
                "到期", "过期", "截止", "还有", "剩下", "多少天",
                "预警", "提醒", "快到了", "今天有什么事", "必须处理",
                "异常", "突变", "连续", "案例教训", "同行业", "执法动态",
                "演练", "预案修订",
            ],
            # 文书生成
            "doc_generation": [
                "报告", "编制", "出具", "写", "做一份", "生成", "模板",
                "公开稿", "公开内容", "信息公开",
                "申请表", "延续申请", "变更申请",
                "管理计划", "隐患排查报告", "履约报告", "预案", "申报表",
                "方案", "整改方案", "监测方案",
            ],
            # 数据核验
            "data_verification": [
                "达标吗", "合不合规数据", "对不对", "一致吗",
                "超标", "多少倍", "计算", "浓度", "限值",
                "台账", "完整吗", "缺", "漏",
                "排放数据", "监测数据", "实测值", "在线监控", "CEMS",
                "核查", "比对", "核验", "审计",
                "环保税核算", "应税",
            ],
            # 行业合规
            "industry_compliance": [
                "合不合规", "合规吗", "规范", "要求", "允许",
                "工艺", "改造", "新建", "项目",
                "监测方案", "监测因子", "监测频次", "点位",
                "环评", "环境影响", "评价", "三同时", "验收", "验收",
                "排污许可", "许可证", "续期", "变更", "核发", "持证",
                "行业标准", "HJ标准", "GB标准", "分类",
                "危废识别", "贮存规范", "防渗", "隐患排查",
                "碳配额", "碳足迹", "履约",
            ],
            # 法规检索
            "regulation_search": [
                "法典", "条款", "法条", "法规", "法律", "条例",
                "第", "条", "款", "项", "编", "章节",
                "处罚规定", "罚款区间", "法律依据", "怎么规定的",
                "义务", "应该", "必须", "应当", "可以",
                "废止", "替代", "版本", "新旧对比",
                "引用", "核查引用",
            ],
            # 合规管家主理人（需要多代理协作的场景词）
            "central_orchestrator": [
                "综合分析", "全面", "总体", "合规体检", "合规评估",
                "团队", "协作", "多个", "同时", "一起",
                "怎么做", "从哪入手", "路线图", "规划", "体系",
            ],
        }

        scores = {}
        for agent, keywords in routing_rules.items():
            score = 0
            for kw in keywords:
                if kw in query:
                    # 多字词给更高权重，避免"第"这种单字干扰
                    score += 3 if len(kw) >= 3 else 1
            if score > 0:
                scores[agent] = score

        if scores:
            best_agent = max(scores, key=scores.get)
            confidence = scores.get(best_agent, 0) / max(sum(scores.values()), 1)
        else:
            # 默认走合规管家主理人（由管家决定是否编排/或直给）
            best_agent = "central_orchestrator"
            confidence = 0.0

        # ── 要素技能装配提示（从 context 推断） ──
        agent_info = dict(self.AGENTS[best_agent])
        assembled_skills = agent_info.get("skill_assembly", [])
        if context and isinstance(context, dict):
            ctx_elements = context.get("elements", [])
            # 企业画像里明确涉及的要素，补充装配对应技能
            for elem in ctx_elements:
                if elem in self.ELEMENT_SKILL_NAMES and elem not in assembled_skills:
                    assembled_skills.append(elem)

        # 把装配的要素技能ID转成人类可读名称，用于提示词注入
        if assembled_skills:
            agent_info["assembled_skill_names"] = [
                self.ELEMENT_SKILL_NAMES.get(sid, sid)
                for sid in assembled_skills
            ]

        # 视角标注（给 chat_api.py 注入提示词时用）
        agent_info["perspective_note"] = (
            "本子代理服务于企业视角：帮助企业避免违法、自检自纠、应对执法、主动预警，"
            "不替执法机关做定性、不替执法机关算罚款、不出执法文书。"
            if agent_info.get("perspective") == "enterprise" else ""
        )

        return {
            "agent": best_agent,
            "agent_info": agent_info,
            "confidence": round(confidence, 3),
            "assembled_skill_ids": assembled_skills,
        }

    def list_agents(self) -> list:
        """返回子代理列表（给前端 /api/agents 接口用）"""
        result = []
        for agent_id, info in self.AGENTS.items():
            result.append({
                "id": agent_id,
                "name": info["name"],
                "description": info["description"],
                "layer": info.get("layer", "sub-agent"),
                "perspective": info.get("perspective", "enterprise"),
                "assembles_element_skills": info.get("skill_assembly", []),
            })
        return result


# ── 全局实例 ──
memory = HermesMemoryLayer()
learning = HermesSelfLearningLayer()
agent_router = HermesAgentRouter()


def enhance_prompt_with_memory(prompt: str, enterprise_id: str, session_id: str) -> str:
    """用记忆增强用户提示词"""
    if not HERMES_ENABLED:
        return prompt

    enhancements = []

    # 企业画像
    profile = memory.get_enterprise_profile(enterprise_id)
    if profile:
        enhancements.append(f"[企业背景] 该企业为{profile.get('industry', '未知行业')}，")
        enhancements.append(f"所属行业：{profile.get('industry', '未知')}，")
        if profile.get("permit_type"):
            enhancements.append(f"许可证类型：{profile['permit_type']}，")

    # 会话上下文
    ctx = memory.get_session_context(session_id)
    if ctx and "context" in ctx:
        if ctx["context"].get("recent_topics"):
            enhancements.append(f"本次会话已讨论：{', '.join(ctx['context']['recent_topics'][-3:])}，")

    if enhancements:
        return "".join(enhancements) + "\n[用户提问] " + prompt
    return prompt


def process_with_hermes(prompt: str, enterprise_id: str = "", session_id: str = "") -> dict:
    """Hermes 完整处理流程（在 AI 调用前执行）

    返回:
        dict: {
            "hermes_enhanced": bool,
            "memory_used": bool,
            "enhanced_prompt": str | None,  # 增强后的提示词（与原始不同时才有）
            "agent_routed": dict | None,     # Agent 路由结果
            "cache_hit": bool,               # 是否命中法规缓存
            "cached_result": dict | None,     # 缓存内容
            "agent_skill_injection": str | None,  # 子代理 SKILL.md 内容，用于注入系统提示词
        }
    """
    if not HERMES_ENABLED:
        return {"hermes_enhanced": False}

    result = {
        "hermes_enhanced": True,
        "memory_used": False,
        "agent_routed": None,
        "cache_hit": False,
        "cached_result": None,
        "agent_skill_injection": None,
    }

    # 1. 记忆增强
    enhanced_prompt = enhance_prompt_with_memory(prompt, enterprise_id, session_id)
    if enhanced_prompt != prompt:
        result["memory_used"] = True
        result["enhanced_prompt"] = enhanced_prompt

    # 2. Agent路由
    routing = agent_router.route(prompt)
    result["agent_routed"] = routing

    # 2.1. 加载对应子代理的 SKILL.md 内容（用于 chat_api.py 注入系统提示词）
    routed_agent_id = routing.get("agent") if routing else None
    if routed_agent_id:
        skill_text = _load_agent_skill_content(routed_agent_id)
        if skill_text:
            result["agent_skill_injection"] = skill_text

    # 3. 缓存检查
    query_hash = hashlib.md5(prompt.encode()).hexdigest()
    cached = memory.get_cached_regulation(query_hash)
    if cached:
        result["cache_hit"] = True
        result["cached_result"] = cached

    return result
