"""
SOUL 提示词动态调优器 — 生成 volatile tier 内容

利用 Hermes Agent 三层提示词架构中的 volatile tier:
  - stable:  SOUL.md 核心人格（不变，保持 prompt cache 热）
  - context: 行业专家化段（中期调整，每月重写）
  - volatile: 企业画像 + 用户偏好 + 服务边界 + 行业技能提示（每轮动态）

本模块负责生成 volatile tier 内容，由 chat_api 注入到系统提示词末尾。

"越用越懂"机制:
  - 短期（每轮）: 注入最近3轮话题 + 用户偏好
  - 中期（每周）: Curator 归档低频 skill
  - 长期（每月）: 重写 SOUL.md 的行业上下文段
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from service_boundary import build_service_boundary, get_enterprise_context

logger = logging.getLogger(__name__)

_HERMES_HOME = Path.home() / ".ecopilot-home"
_TZ = timezone(timedelta(hours=8))


def _load_json(path: Path) -> dict:
    """安全加载 JSON"""
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def _load_enterprise_profile() -> dict:
    return _load_json(_HERMES_HOME / "enterprise.json")


def _load_permit_data() -> dict:
    obj = _load_json(_HERMES_HOME / "permit-data.json")
    return obj.get("parsed", {}) if isinstance(obj, dict) else {}


def _load_user_info() -> dict:
    return _load_json(_HERMES_HOME / "user.json")


def _load_hermes_memory() -> dict:
    """加载 hermes_adapter 的企业画像记忆"""
    return _load_json(_HERMES_HOME / "memory" / "enterprises.json")


def _load_learning_log() -> dict:
    """加载学习日志（用户反馈）"""
    return _load_json(_HERMES_HOME / "memory" / "learning_log.json")


def _load_installed_skills() -> list[str]:
    """获取已安装的行业技能列表"""
    skills_dir = Path.home() / ".hermes" / "skills"
    if not skills_dir.exists():
        return []
    return [
        d.name for d in skills_dir.iterdir()
        if d.is_dir() and (d / "SKILL.md").exists()
    ]


def _get_recent_topics(session_id: str = "", limit: int = 3) -> list[str]:
    """获取最近对话话题"""
    sessions = _load_json(_HERMES_HOME / "memory" / "sessions.json")
    if session_id and session_id in sessions:
        ctx = sessions[session_id].get("context", {})
        return ctx.get("recent_topics", [])[-limit:]
    return []


def _get_user_preferences(user_info: dict) -> dict:
    """从用户信息和反馈中推导沟通偏好"""
    prefs = {
        "name": user_info.get("name", ""),
        "role": user_info.get("role", "环保专员"),
        "style": "简洁",  # 默认简洁
    }

    # 从学习日志分析偏好
    learning = _load_learning_log()
    feedback = learning.get("feedback", [])

    if feedback:
        # 统计满意度
        positive = sum(1 for f in feedback if f.get("rating") in ("positive", "helpful"))
        total = len(feedback)
        if total > 0:
            positive_rate = positive / total
            # 如果正面率低，可能需要更详细的解释
            if positive_rate < 0.5:
                prefs["style"] = "详细"

    return prefs


def build_volatile_tier(
    session_id: str = "",
    enterprise_id: str = "",
) -> str:
    """生成 volatile tier 内容 — 每轮对话动态注入

    包含:
      1. 企业画像快照（行业/管理等级/许可证/排放口）
      2. 用户偏好（称呼/角色/沟通风格）
      3. 最近对话话题
      4. 动态服务边界
      5. 已安装行业技能提示

    Args:
        session_id: 会话 ID（用于读取最近话题）
        enterprise_id: 企业 ID（用于读取企业画像）

    Returns:
        volatile tier 文本，追加到系统提示词末尾
    """
    parts: list[str] = []
    now_str = datetime.now(_TZ).strftime("%Y-%m-%d %H:%M %Z")

    parts.append(f"【运行时上下文 — {now_str}】")

    # ── 1. 企业画像 ──
    permit = _load_permit_data()
    profile = _load_enterprise_profile()
    hermes_mem = _load_hermes_memory()

    # 优先用 hermes_adapter 记忆中的企业画像（包含历史累积信息）
    eid = enterprise_id or permit.get("creditCode") or profile.get("credit_code", "")
    mem_profile = hermes_mem.get(eid, {}) if eid else {}

    enterprise_name = (
        permit.get("enterpriseName")
        or profile.get("name")
        or mem_profile.get("name", "")
    )

    if enterprise_name:
        ctx = get_enterprise_context()
        parts.append(f"\n【企业画像】")
        parts.append(f"企业: {enterprise_name}")
        if ctx["industry_name"]:
            parts.append(f"行业: {ctx['industry_name']}（代码: {ctx['industry_code'] or '待识别'}）")
        if ctx["management_level"]:
            parts.append(f"管理等级: {ctx['management_level']}")

        permit_number = permit.get("permitNumber") or profile.get("permit_number", "")
        if permit_number:
            parts.append(f"许可证编号: {permit_number}")

        outlets = permit.get("emissionOutlets", [])
        if outlets:
            air = sum(1 for o in outlets if isinstance(o, dict) and o.get("code", "").startswith("DA"))
            water = sum(1 for o in outlets if isinstance(o, dict) and o.get("code", "").startswith("DW"))
            parts.append(f"排放口: 废气{air}个 / 废水{water}个")

        # 历史交互次数（越用越懂的体现）
        interaction_count = mem_profile.get("interaction_count", 0)
        if interaction_count > 0:
            parts.append(f"历史交互: {interaction_count} 次")

        # 企业特定关注点（从记忆中读取）
        concerns = mem_profile.get("concerns", [])
        if concerns:
            parts.append(f"企业关注: {', '.join(concerns[-3:])}")

    # ── 2. 用户偏好 ──
    user_info = _load_user_info()
    prefs = _get_user_preferences(user_info)

    if prefs["name"]:
        parts.append(f"\n【用户画像】")
        parts.append(f"称呼: {prefs['name']}")
        parts.append(f"角色: {prefs['role']}")
        parts.append(f"沟通风格: {prefs['style']}")
        # 首次对话时用姓名打招呼
        if prefs["name"]:
            parts.append(f"（首次对话时请称呼「{prefs['name']}」，体现个性化）")

    # ── 3. 最近话题 ──
    recent_topics = _get_recent_topics(session_id)
    if recent_topics:
        parts.append(f"\n【最近话题】")
        parts.append(f"本次会话已讨论: {', '.join(recent_topics)}")

    # ── 4. 动态服务边界 ──
    boundary = build_service_boundary()
    parts.append(f"\n{boundary}")

    # ── 5. 已安装行业技能 ──
    installed = _load_installed_skills()
    if installed:
        parts.append(f"\n【已加载技能】")
        parts.append(f"已安装 {len(installed)} 项技能: {', '.join(installed[:5])}")
        if len(installed) > 5:
            parts.append(f"（及其他 {len(installed) - 5} 项）")

    return "\n".join(parts)


def build_context_tier_industry() -> str:
    """生成 context tier 的行业专家化段（中期调整，每月重写）

    根据 企业行业 + 管理等级 生成行业专家模式提示词，
    可追加到 SOUL.md 的"行业上下文"段。

    Returns:
        行业专家化文本
    """
    from service_boundary import INDUSTRY_EXPERT, resolve_industry_code

    permit = _load_permit_data()
    profile = _load_enterprise_profile()

    industry_name = (
        permit.get("industryCategory")
        or permit.get("industry")
        or profile.get("industry")
        or ""
    )
    industry_code_input = permit.get("industryCode") or profile.get("industryCode", "")
    code = resolve_industry_code(industry_name, industry_code_input)

    if not code or code not in INDUSTRY_EXPERT:
        return ""

    cfg = INDUSTRY_EXPERT[code]
    return f"""【行业专家化 — {cfg['name']}】

你现在是 {cfg['mode']}。你的合规建议必须基于该行业的实际工艺和排放特征。

行业标准: {cfg['key_standards']}
关键工艺: {cfg['key_processes']}
监管重点: {cfg['focus']}

在回答该行业企业的合规问题时:
1. 优先引用行业专用标准（{cfg['key_standards']}）
2. 结合工艺环节给出针对性建议（{cfg['key_processes']}）
3. 重点关注: {cfg['focus']}
4. 行业常见问题主动提醒（如{cfg['name']}企业的典型合规风险点）"""


def should_rewrite_soul_context() -> bool:
    """判断是否需要重写 SOUL.md 的行业上下文段（每月一次）"""
    marker = _HERMES_HOME / ".soul-context-last-rewrite"
    if not marker.exists():
        return True
    try:
        last = datetime.fromisoformat(marker.read_text().strip())
        return datetime.now(_TZ) - last > timedelta(days=30)
    except Exception:
        return True


def mark_soul_context_rewritten() -> None:
    """标记 SOUL.md 行业上下文段已重写"""
    try:
        marker = _HERMES_HOME / ".soul-context-last-rewrite"
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(datetime.now(_TZ).isoformat())
    except Exception:
        pass


def get_tuner_summary() -> dict:
    """获取调优器状态摘要（供前端/调试展示）"""
    ctx = get_enterprise_context()
    user_info = _load_user_info()
    installed = _load_installed_skills()
    learning = _load_learning_log()
    feedback_count = len(learning.get("feedback", []))

    return {
        "enterprise": {
            "name": _load_permit_data().get("enterpriseName") or _load_enterprise_profile().get("name", ""),
            "industry": ctx["industry_name"],
            "industry_code": ctx["industry_code"],
            "management_level": ctx["management_level"],
        },
        "user": {
            "name": user_info.get("name", ""),
            "role": user_info.get("role", ""),
        },
        "skills_installed": len(installed),
        "feedback_count": feedback_count,
        "soul_context_needs_rewrite": should_rewrite_soul_context(),
    }
