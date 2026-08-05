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

# ── 配置 ──
HERMES_ENABLED = os.environ.get("HERMES_ENABLED", "true").lower() == "true"
HERMES_BASE_URL = os.environ.get("HERMES_BASE_URL", "http://localhost:20128/v1")
HERMES_API_KEY = os.environ.get("HERMES_API_KEY", "hermes-ecopilot-key")
HERMES_MODEL = os.environ.get("HERMES_MODEL", "hermes-v1")

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
    """第三层：多Agent路由"""

    AGENTS = {
        "regulation": {"name": "法规专家Agent", "description": "法典条款查询、法规解读、合规分析"},
        "permit": {"name": "排污许可Agent", "description": "许可证申报、证后管理、变更续期"},
        "monitoring": {"name": "监测数据Agent", "description": "监测数据核验、超标预警、数据分析"},
        "tax": {"name": "环保税Agent", "description": "环保税核算、申报辅助、减免政策"},
        "assessment": {"name": "环评辅助Agent", "description": "环评编制、三同时管理、验收辅助"},
        "hazardous": {"name": "危废管理Agent", "description": "危废台账、转移联单、贮存规范"},
    }

    def route(self, query: str, context: dict = None) -> dict:
        """根据用户查询路由到最合适的Agent"""
        # 关键词匹配路由
        routing_rules = {
            "regulation": ["法典", "条款", "法规", "法律", "第", "编", "处罚", "罚款", "违法"],
            "permit": ["排污许可", "许可证", "证后", "续期", "变更", "核发"],
            "monitoring": ["监测", "数据", "超标", "预警", "在线监控", "CEMS"],
            "tax": ["环保税", "税收", "核算", "申报", "减免", "排放量"],
            "assessment": ["环评", "环境影响", "三同时", "验收", "评价"],
            "hazardous": ["危废", "危险废物", "转移联单", "贮存", "处置"],
        }

        scores = {}
        for agent, keywords in routing_rules.items():
            score = sum(1 for kw in keywords if kw in query)
            if score > 0:
                scores[agent] = score

        if scores:
            best_agent = max(scores, key=scores.get)
        else:
            best_agent = "regulation"  # 默认法规Agent

        return {
            "agent": best_agent,
            "agent_info": self.AGENTS[best_agent],
            "confidence": scores.get(best_agent, 0) / max(sum(scores.values()), 1)
        }


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
    }

    # 1. 记忆增强
    enhanced_prompt = enhance_prompt_with_memory(prompt, enterprise_id, session_id)
    if enhanced_prompt != prompt:
        result["memory_used"] = True
        result["enhanced_prompt"] = enhanced_prompt

    # 2. Agent路由
    routing = agent_router.route(prompt)
    result["agent_routed"] = routing

    # 3. 缓存检查
    query_hash = hashlib.md5(prompt.encode()).hexdigest()
    cached = memory.get_cached_regulation(query_hash)
    if cached:
        result["cache_hit"] = True
        result["cached_result"] = cached

    return result
