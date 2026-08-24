"""
EcoSkill 技能市场桥接 — EcoPilot 的唯一技能来源

支持两种数据源:
  1. 远程 EcoSkills 官方站点 (http://111.230.89.107/  ecoskill.cn)
     - tRPC API: /api/trpc/skills.list, /api/trpc/skills.detail
     - 返回真实行业技能 + 完整 SKILL.md 内容 (readme 字段)
  2. 本地 skills.json (离线兜底)

用法:
    from ecoskill.bridge import search_skills, install_skill, get_installed_skills, install_skills_for_industry

    results = search_skills("水质")
    install_skill("eco-metallurgy-1195845", platform="hermes")
    install_skills_for_industry("C31")  # 钢铁行业自动安装
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional, Union

logger = logging.getLogger(__name__)

ECOSKILL_DIR = Path(__file__).parent
SKILLS_JSON = ECOSKILL_DIR / "skills.json"
CLI_PATH = ECOSKILL_DIR / "cli.py"
HERMES_SKILLS_DIR = Path.home() / ".hermes" / "skills"

# EcoSkills 远程注册广场（域名备案中，先用 IP；上线后改 https://ecoskill.cn）
ECOSKILL_REGISTRY_URL = os.environ.get("ECOSKILL_REGISTRY_URL", "http://111.230.89.107").rstrip("/")


def _trpc_get(procedure: str, params: dict, timeout: float = 8.0) -> dict | None:
    """调用 EcoSkills 广场 tRPC 查询接口，失败返回 None"""
    try:
        input_json = json.dumps({"json": params}, ensure_ascii=False)
        url = f"{ECOSKILL_REGISTRY_URL}/api/trpc/{procedure}?input={urllib.parse.quote(input_json)}"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data.get("result", {}).get("data", {}).get("json")
    except Exception:
        return None


def remote_list_skills(limit: int = 600, offset: int = 0) -> list[dict] | None:
    """从远程广场拉取技能目录；网络不可达返回 None（调用方应回退本地目录）"""
    result = _trpc_get("skills.list", {"limit": limit, "offset": offset})
    if result is None:
        return None
    return result.get("rows", [])


def remote_skill_detail(skill_id: str) -> dict | None:
    """获取远程技能详情（含 readme 完整 SKILL.md 内容）"""
    return _trpc_get("skills.detail", {"id": skill_id})


def _safe_skill_id(skill_id: str) -> str | None:
    """校验技能 ID 合法性，防路径穿越（远程注册中心数据不可信）"""
    import re
    if re.fullmatch(r"[A-Za-z0-9._-]{1,120}", skill_id or "") and ".." not in skill_id:
        return skill_id
    return None


def install_remote_skill(skill_id: str, detail: dict | None = None) -> dict:
    """从远程广场安装技能到 ~/.hermes/skills

    Returns: {"ok": bool, "detail": str, "installed_path": str | None}
    """
    if not _safe_skill_id(skill_id):
        return {"ok": False, "detail": f"非法技能 ID: {skill_id!r}", "installed_path": None}
    target_dir = HERMES_SKILLS_DIR / skill_id
    if target_dir.exists() and (target_dir / "SKILL.md").exists():
        return {"ok": True, "detail": f"技能已安装: {skill_id}", "installed_path": str(target_dir)}

    if detail is None:
        detail = remote_skill_detail(skill_id)
    if not detail:
        return {"ok": False, "detail": f"无法从 EcoSkills 广场获取技能详情: {skill_id}", "installed_path": None}

    readme = (detail.get("readme") or "").strip()
    if not readme:
        # 无 readme 时用元数据生成最小 SKILL.md
        readme = f"""---
name: {detail.get('name', skill_id)}
description: "{detail.get('description', '')}"
version: {detail.get('version', '1.0.0')}
author: {detail.get('author', '')}
category: {detail.get('category', '')}
license: {detail.get('license', '')}
source: EcoSkills Registry ({ECOSKILL_REGISTRY_URL})
---

# {detail.get('name', skill_id)}

{detail.get('description', '')}
"""
    target_dir.mkdir(parents=True, exist_ok=True)
    (target_dir / "SKILL.md").write_text(readme, encoding="utf-8")
    return {"ok": True, "detail": f"已从 EcoSkills 广场安装 {detail.get('name', skill_id)}", "installed_path": str(target_dir)}
# ── 远程 EcoSkills 官方站点 ──────────────────────────────
# 域名 ecoskill.cn 正在备案，当前通过 IP 访问
ECOSKILL_REMOTE_BASE = "http://111.230.89.107"
ECOSKILL_TRPC_BASE = f"{ECOSKILL_REMOTE_BASE}/api/trpc"
REMOTE_TIMEOUT = 15  # 秒


def _log(level: str, event: str, **fields):
    """统一结构化日志打印 — 方便排查 ecoskill 下载异常
    输出格式: [EcoSkill] [LEVEL] event key=value ...
    只用 print 到 stdout（立即 flush，方便实时排查），
    不走 logging 避免 root logger 重复输出。
    """
    extra = " ".join(f"{k}={v!r}" for k, v in fields.items())
    line = f"[EcoSkill] [{level.upper()}] {event} {extra}" if extra else f"[EcoSkill] [{level.upper()}] {event}"
    print(line, flush=True)


def _trpc_get_batch(procedure: str, input_obj: Optional[dict] = None) -> Optional[Union[dict, list]]:
    """调用远程 tRPC GET 端点（batch 协议）

    Args:
        procedure: tRPC procedure 名（如 "skills.list", "skills.detail"）
        input_obj: 输入参数（如 {"json": {"id": "xxx"}}）

    Returns:
        解析后的 JSON 数据，失败返回 None
    """
    try:
        params = [("batch", "1")]
        if input_obj is not None:
            params.append(("input", json.dumps({"0": input_obj}, ensure_ascii=False)))
        query = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
        url = f"{ECOSKILL_TRPC_BASE}/{procedure}?{query}"
        _log("info", "trpc_request_start", procedure=procedure, url=url, timeout=REMOTE_TIMEOUT)
        t0 = time.time()
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=REMOTE_TIMEOUT) as resp:
            raw = resp.read().decode("utf-8")
            ms = int((time.time() - t0) * 1000)
            _log("info", "trpc_response_recv", procedure=procedure, status=resp.status, bytes=len(raw), ms=ms)
            data = json.loads(raw)
            # tRPC batch 返回数组，取第一个
            if isinstance(data, list) and data:
                item = data[0]
                if isinstance(item, dict) and "error" in item:
                    _log("warning", "trpc_returned_error", procedure=procedure, error=item["error"])
                    return None
                if isinstance(item, dict) and "result" in item:
                    result_data = item["result"].get("data", {}).get("json")
                    _log("info", "trpc_parse_ok", procedure=procedure, has_data=result_data is not None)
                    return result_data
            _log("warning", "trpc_unexpected_shape", procedure=procedure, shape=type(data).__name__)
            return data
    except urllib.error.URLError as e:
        _log("error", "trpc_url_error", procedure=procedure, error=str(e), reason=str(getattr(e, "reason", "")))
        return None
    except Exception as e:
        _log("error", "trpc_call_failed", procedure=procedure, error=str(e), exc_type=type(e).__name__)
        return None


def fetch_remote_catalog() -> list[dict]:
    """从远程 EcoSkills 站点拉取全部技能列表

    Returns:
        技能列表（每项含 id/name/category/description 等字段），
        远程不可用时返回空列表
    """
    _log("info", "fetch_catalog_start")
    data = _trpc_get_batch("skills.list")
    if isinstance(data, dict):
        rows = data.get("rows", [])
        if isinstance(rows, list):
            _log("info", "fetch_catalog_done", count=len(rows))
            return rows
        _log("warning", "fetch_catalog_bad_rows", shape=type(rows).__name__)
    else:
        _log("warning", "fetch_catalog_empty", data_type=type(data).__name__)
    return []


def fetch_remote_skill_detail(skill_id: str) -> dict | None:
    """从远程拉取单个技能详情（含完整 readme/SKILL.md 内容）

    Args:
        skill_id: 技能 ID（如 "eco-metallurgy-1195845"）

    Returns:
        技能详情 dict（含 readme 字段），失败返回 None
    """
    _log("info", "fetch_detail_start", skill_id=skill_id)
    data = _trpc_get_batch("skills.detail", {"json": {"id": skill_id}})
    if data is None:
        _log("warning", "fetch_detail_failed", skill_id=skill_id)
        return None
    if isinstance(data, dict):
        readme = data.get("readme")
        _log("info", "fetch_detail_done", skill_id=skill_id, has_readme=bool(readme), readme_len=len(readme) if readme else 0)
    return data


def load_catalog() -> list[dict]:
    """加载技能目录 — 优先远程，失败回退本地 skills.json

    远程站点有 24 个真实行业技能（含完整 SKILL.md），
    本地 skills.json 有 100 个学术分类技能（离线兜底）。
    """
    # 1. 优先远程
    remote = fetch_remote_catalog()
    if remote:
        return remote
    # 2. 回退本地
    if SKILLS_JSON.exists():
        try:
            with open(SKILLS_JSON, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return []


def search_skills(keyword: str) -> list[dict]:
    """在 EcoSkill 市场搜索技能"""
    catalog = load_catalog()
    keyword = keyword.lower()
    results = []
    for s in catalog:
        # tags 在远程数据中可能是字符串（空）或列表，统一处理
        tags = s.get("tags", [])
        if isinstance(tags, str):
            tags = [tags] if tags else []
        if (keyword in s.get("name", "").lower() or
            keyword in s.get("category", "").lower() or
            keyword in s.get("description", "").lower() or
            any(keyword in str(t).lower() for t in tags)):
            results.append(s)
    return results


def install_skill(skill_id: str, platform: str = "hermes") -> dict:
    """从 EcoSkill 安装技能到指定平台

    安装流程:
      1. 从远程拉取技能详情（含完整 readme/SKILL.md 内容）
      2. 远程失败则用列表数据生成简化 SKILL.md
      3. 写入 ~/.hermes/skills/<skill_id>/SKILL.md

    Returns:
        {"ok": bool, "detail": str, "installed_path": str | None, "skipped": bool}
    """
    _log("info", "install_skill_start", skill_id=skill_id, platform=platform)
    t0 = time.time()
    # 先从 catalog 拿基础信息
    catalog = load_catalog()
    skill = next((s for s in catalog if s.get("id") == skill_id), None)
    if not skill:
        _log("error", "install_skill_not_found", skill_id=skill_id)
        return {"ok": False, "detail": f"EcoSkill 市场中未找到技能: {skill_id}"}

    target_dir = HERMES_SKILLS_DIR / skill_id
    skill_name = skill.get('name', skill_id)

    if target_dir.exists():
        _log("info", "install_skill_skipped", skill_id=skill_id, name=skill_name, path=str(target_dir))
        return {"ok": True, "detail": f"技能 {skill_name} 已安装", "installed_path": str(target_dir), "skipped": True}

    target_dir.mkdir(parents=True, exist_ok=True)

    # 优先从远程拉取完整 readme（包含真实 SKILL.md 内容）
    detail = fetch_remote_skill_detail(skill_id)
    readme = None
    if detail and isinstance(detail, dict):
        readme = detail.get("readme")
        # 用详情数据补充 catalog 中缺失的字段
        for k, v in detail.items():
            if k not in skill or not skill.get(k):
                skill[k] = v

    if readme:
        # 远程返回的 readme 已经是完整的 SKILL.md 格式（含 frontmatter），直接写入
        (target_dir / "SKILL.md").write_text(readme, encoding="utf-8")
        ms = int((time.time() - t0) * 1000)
        _log("info", "install_skill_done_remote", skill_id=skill_id, name=skill_name, readme_len=len(readme), ms=ms, path=str(target_dir))
        return {"ok": True, "detail": f"已安装 {skill_name}（含完整内容）", "installed_path": str(target_dir), "skipped": False, "source": "remote"}

    # 远程失败，用 catalog 数据生成简化 SKILL.md
    _log("warning", "install_skill_fallback_no_readme", skill_id=skill_id, name=skill_name, hint="使用 catalog 数据生成简化版")
    tags = skill.get("tags", [])
    if isinstance(tags, str):
        tags = [tags] if tags else []
    platforms = skill.get("platforms", [])
    if isinstance(platforms, list) and platforms and isinstance(platforms[0], str):
        # 远程数据 platforms 是字符串列表 ["Claude Code", ...]
        platforms_text = "\n".join(f"- {p}" for p in platforms)
    elif isinstance(platforms, list) and platforms and isinstance(platforms[0], dict):
        platforms_text = "\n".join(f"- {p.get('name', '')}" for p in platforms)
    else:
        platforms_text = "- Hermes"

    sec = skill.get("securityScan", {}) or {}
    sec_status = sec.get("status", "unknown") if isinstance(sec, dict) else "unknown"

    skill_md = f"""---
name: {skill.get('id', skill_id)}
description: "{skill.get('description', '')}"
version: {skill.get('version', '1.0.0')}
author: {skill.get('author', 'EcoSkills')}
category: {skill.get('category', '未分类')}
tags: {json.dumps(tags, ensure_ascii=False)}
license: {skill.get('license', 'CC-BY-4.0')}
source: EcoSkill Marketplace (http://111.230.89.107)
installed_by: ecoskill install {skill_id}
---

# {skill.get('name', skill_id)}

{skill.get('description', '')}

## 基本信息

- 作者: {skill.get('author', '')} ({skill.get('authorOrg', '') or ''})
- 分类: {skill.get('category', '')}
- 版本: {skill.get('version', '')}
- 安全审计: {sec_status}
- 最后更新: {skill.get('lastUpdated', 'N/A')}

## 安装来源

通过 EcoSkill CLI 安装:
```
ecoskill install {skill_id}
```

## 平台兼容
{platforms_text}
"""
    (target_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
    ms = int((time.time() - t0) * 1000)
    _log("info", "install_skill_done_fallback", skill_id=skill_id, name=skill_name, ms=ms, path=str(target_dir))
    return {"ok": True, "detail": f"已安装 {skill_name}（简化版）", "installed_path": str(target_dir), "skipped": False, "source": "fallback"}


def get_installed_skills() -> list[str]:
    """列出已安装的 EcoSkill 技能"""
    if not HERMES_SKILLS_DIR.exists():
        return []
    return [
        d.name for d in HERMES_SKILLS_DIR.iterdir()
        if d.is_dir() and (d / "SKILL.md").exists()
    ]


def get_marketplace_summary() -> str:
    """生成 EcoSkill 市场摘要供 AI 使用"""
    catalog = load_catalog()
    categories = {}
    for s in catalog:
        cat = s.get("category", "其他")
        categories.setdefault(cat, []).append(s["name"])

    summary = f"EcoSkill 技能市场: {len(catalog)} 项可用技能\n"
    for cat, names in sorted(categories.items()):
        summary += f"- {cat}: {', '.join(names[:8])}"
        if len(names) > 8:
            summary += f" (+{len(names)-8}项)"
        summary += "\n"
    return summary


# ═══════════════════════════════════════════════════════════════
# 行业 → 技能映射（根据排污许可证行业自动安装对应技能）
# 远程 EcoSkills 站点真实技能 ID，按行业代码精确匹配
# ═══════════════════════════════════════════════════════════════

# 行业代码 → 远程 EcoSkills 真实技能 ID 列表
# 数据源: http://111.230.89.107/api/trpc/skills.list
#
# 注意：远程站点当前仅上架 4 个行业合规技能（钢铁/水泥/火电/酒饮料），
# 外加 3 个对应行业的大气污染源指纹技能。其余行业（化工/食品/污水处理/
# 垃圾焚烧等）远程无对应技能，改走本地 INDUSTRY_CUSTOM_SKILLS 兜底生成，
# 避免安装到已下架/不存在的技能 ID 导致失败。
INDUSTRY_REMOTE_SKILL_IDS = {
    # 钢铁 (C31) — 行业合规技能 + 大气污染源指纹
    "C31": [
        "eco-metallurgy-1195845",                                  # 钢铁（31）固定污染源合规技能
        "atmospheric-steel-industry-fingerprint-1785636391395",    # 钢铁行业大气污染源指纹识别
    ],
    # 水泥 (C301) — 行业合规技能 + 大气污染源指纹
    "C301": [
        "eco-nonmetal-mineral-1195848",                            # 水泥（30）固定污染源合规技能
        "atmospheric-cement-industry-fingerprint-1785636391397",   # 水泥行业大气污染源指纹识别
    ],
    # 火电 (D4411) — 行业合规技能 + 大气污染源指纹
    "D4411": [
        "eco-power-1195851",                                       # 火电（44）固定污染源合规技能
        "atmospheric-thermal-power-fingerprint-1785636391396",     # 火电行业大气污染源指纹识别
    ],
    # 酒饮料茶 (C15) — 行业合规技能
    "C15": [
        "eco-beverage-1195833",                                    # 酒、饮料（15）固定污染源合规技能
    ],
}

# 通用技能（所有行业都安装）— 大气源解析方法学
UNIVERSAL_REMOTE_SKILL_IDS = [
    "atmospheric-industrial-fingerprint-1785635774245",   # 工业源指纹识别（通用）
    "atmospheric-dust-source-diagnosis-1785635774248",    # 扬尘源诊断（通用）
    "atmospheric-mobile-source-segment-1785635774247",    # 移动源细分诊断（通用）
    "atmospheric-secondary-aerosol-1785635774249",        # 二次气溶胶形成分析（通用）
    "atmospheric-biomass-burning-id-1785635774246",       # 生物质燃烧识别（通用）
    "atmospheric-rto-abatement-emissions-1785635774250",  # RTO治理设备排放诊断（通用）
    "atmospheric-pmf-source-guide-1785635774251",         # PMF源解析应用指南（通用方法学）
    "atmospheric-cmb-source-guide-1785635774252",         # CMB源解析应用指南（通用方法学）
    "atmospheric-hysplit-trajectory-1785635774253",       # HYSPLIT后向轨迹分析（通用方法学）
    "atmospheric-tropomi-satellite-1785635774254",        # TROPOMI卫星数据解读（通用方法学）
]

# 保留旧字段名兼容（行业 → 分类匹配，用于离线兜底）
INDUSTRY_SKILL_CATEGORIES = {
    "C31":  ["大气环境", "环境监测", "环境法规", "碳排放", "环境治理"],
    "C301": ["大气环境", "环境监测", "环境法规", "环境治理"],
    "D4411":["大气环境", "碳排放", "环境监测", "环境法规", "环境治理"],
    "C26":  ["环境法规", "水环境", "大气环境", "固体废物", "环境治理", "环境监测"],
    "C27":  ["水环境", "环境治理", "固体废物", "环境法规", "环境监测"],
    "C17":  ["水环境", "环境治理", "环境法规", "环境监测"],
    "C22":  ["水环境", "环境治理", "环境法规"],
    "C13":  ["水环境", "环境治理", "环境监测"],
    "A03":  ["水环境", "土壤环境", "环境治理", "生态环境", "环境监测"],
    "D462": ["水环境", "环境治理", "环境监测", "环境法规"],
    "N782": ["大气环境", "固体废物", "环境治理", "环境监测", "环境法规"],
}

# 行业专属自定义技能（远程无对应技能时，本地动态生成）
# 仅在远程技能不可用时作为兜底
INDUSTRY_CUSTOM_SKILLS = {
    "C17": {
        "id": "eco-textile-industry",
        "name": "纺织印染行业合规专家",
        "category": "行业专属",
        "description": "纺织印染行业排污许可合规：前处理/染色印花/后整理工艺，GB 4287 纺织染整工业水污染物排放标准，废水色度/COD/苯胺类",
        "tags": ["纺织", "印染", "色度", "COD", "GB4287"],
    },
    "C22": {
        "id": "eco-paper-industry",
        "name": "造纸行业合规专家",
        "category": "行业专属",
        "description": "造纸行业排污许可合规：制浆/抄纸/涂布工艺，GB 3544 制浆造纸工业水污染物排放标准，碱回收/白水回用/污泥",
        "tags": ["造纸", "制浆", "碱回收", "AOX", "GB3544"],
    },
    "C27": {
        "id": "eco-pharma-industry",
        "name": "制药行业合规专家",
        "category": "行业专属",
        "description": "制药行业排污许可合规：HJ 863 化学原料药，HJ 1062 发酵类制药，发酵尾气/VOCs/高COD废水/药渣危废",
        "tags": ["制药", "发酵", "VOCs", "药渣", "HJ863"],
    },
    "A03": {
        "id": "eco-livestock-industry",
        "name": "畜禽养殖行业合规专家",
        "category": "行业专属",
        "description": "畜禽养殖行业排污许可合规：HJ 1029 畜禽养殖业污染物排放标准，粪污资源化/恶臭/高氨氮废水/病死畜禽无害化",
        "tags": ["畜禽养殖", "粪污", "恶臭", "氨氮", "HJ1029"],
    },
    "C26": {
        "id": "eco-chemical-industry",
        "name": "化工行业合规专家",
        "category": "行业专属",
        "description": "化工行业排污许可合规：反应/分离/精馏/合成工艺，GB 31571 石油化学工业、HJ 863 化学原料药，VOCs治理/特征污染物废水/危险废物管理/突发环境事件应急",
        "tags": ["化工", "VOCs", "危废", "应急", "GB31571"],
    },
    "C13": {
        "id": "eco-food-industry",
        "name": "食品加工行业合规专家",
        "category": "行业专属",
        "description": "食品加工行业排污许可合规：原料处理/加工/包装工艺，GB 25461 淀粉、GB 27631 发酵酒精，高BOD/COD/SS/氨氮废水/恶臭/锅炉烟气",
        "tags": ["食品", "淀粉", "发酵", "氨氮", "恶臭"],
    },
    "D462": {
        "id": "eco-sewage-industry",
        "name": "污水处理行业合规专家",
        "category": "行业专属",
        "description": "污水处理行业排污许可合规：预处理/生化处理/深度处理/污泥处置工艺，GB 18918 城镇污水处理厂，出水水质(COD/氨氮/总磷/总氮)/恶臭(硫化氢)/污泥处置路径",
        "tags": ["污水处理", "GB18918", "氨氮", "总磷", "污泥"],
    },
    "N782": {
        "id": "eco-waste-incineration-industry",
        "name": "垃圾焚烧行业合规专家",
        "category": "行业专属",
        "description": "垃圾焚烧行业排污许可合规：垃圾接收/焚烧/烟气净化/飞灰处置工艺，GB 18485 生活垃圾焚烧，二噁英/重金属/HCl/SO2/NOx烟气/飞灰危废/渗滤液处理",
        "tags": ["垃圾焚烧", "二噁英", "飞灰", "渗滤液", "GB18485"],
    },
}


def get_skills_by_industry(industry_code: str) -> dict:
    """获取行业对应的技能列表（远程行业技能 + 通用技能 + 兜底自定义技能）

    Returns:
        {
            "industry_code": str,
            "industry_name": str,
            "industry_skill_ids": [...],     # 行业专属技能 ID（远程）
            "universal_skill_ids": [...],    # 通用技能 ID（远程）
            "custom_skills": [...],          # 兜底自定义技能定义
            "market_skills": [...],          # 从 catalog 解析出的技能详情
            "total": int,
        }
    """
    from service_boundary import INDUSTRY_EXPERT, resolve_industry_code

    # 归一化行业代码：许可证给 4 位细分码（如 C3120），映射表用大类码（如 C31）
    industry_code = resolve_industry_code("", industry_code) or industry_code
    industry_name = INDUSTRY_EXPERT.get(industry_code, {}).get("name", "未知行业")
    industry_ids = INDUSTRY_REMOTE_SKILL_IDS.get(industry_code, [])
    universal_ids = UNIVERSAL_REMOTE_SKILL_IDS
    custom_skill_def = INDUSTRY_CUSTOM_SKILLS.get(industry_code)

    # 从 catalog 拉取技能详情（用于前端展示）
    catalog = load_catalog()
    catalog_map = {s.get("id"): s for s in catalog if s.get("id")}
    market_skills = []
    for sid in industry_ids + universal_ids:
        if sid in catalog_map:
            market_skills.append(catalog_map[sid])

    return {
        "industry_code": industry_code,
        "industry_name": industry_name,
        "industry_skill_ids": industry_ids,
        "universal_skill_ids": universal_ids,
        "custom_skills": [custom_skill_def] if custom_skill_def else [],
        "market_skills": market_skills,
        "total": len(industry_ids) + len(universal_ids) + (1 if custom_skill_def else 0),
    }


def _install_custom_skill(skill_def: dict) -> dict:
    """安装行业专属自定义技能（动态生成 SKILL.md）"""
    skill_id = skill_def["id"]
    target_dir = HERMES_SKILLS_DIR / skill_id

    if target_dir.exists():
        return {"ok": True, "detail": f"技能 {skill_def['name']} 已安装", "installed_path": str(target_dir), "skipped": True}

    target_dir.mkdir(parents=True, exist_ok=True)

    skill_md = f"""---
name: {skill_id}
description: "{skill_def['description']}"
version: v1.0.0
author: EcoPilot 行业专家
category: {skill_def['category']}
tags: {json.dumps(skill_def.get('tags', []), ensure_ascii=False)}
license: CC-BY-NC-SA 4.0
source: EcoPilot 行业技能自动生成
installed_by: ecoskill install-industry
---

# {skill_def['name']}

{skill_def['description']}

## 行业合规要点

本技能为 {skill_def['name']} 的专属合规知识包，覆盖该行业的：
- 行业专用排放标准
- 关键工艺环节的合规要求
- 行业典型合规风险点
- 行业专属监测指标

## 使用场景

当企业属于该行业时，EcoPilot 合规管家应主动调用本技能，结合企业排污许可证数据，
给出行业针对性的合规建议。
"""
    (target_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
    return {"ok": True, "detail": f"已安装 {skill_def['name']}", "installed_path": str(target_dir), "skipped": False}


def install_skills_for_industry(industry_code: str) -> dict:
    """为指定行业批量安装所有匹配技能

    安装顺序：
      1. 行业专属远程技能（INDUSTRY_REMOTE_SKILL_IDS）
      2. 通用远程技能（UNIVERSAL_REMOTE_SKILL_IDS，所有行业都装）
      3. 行业兜底自定义技能（仅当远程无对应技能时）

    每个远程技能安装时：
      - 调用 skills.detail 拉取完整 readme（含真实 SKILL.md 内容）
      - 远程失败则用 catalog 数据生成简化 SKILL.md

    Returns:
        {
            "ok": bool,
            "industry_code": str,
            "industry_name": str,
            "installed": [...],      # 新安装的技能名
            "skipped": [...],        # 已安装跳过的技能名
            "failed": [...],         # 安装失败的技能 {id, name, error}
            "total": int,            # 已安装 + 跳过
            "sources": {"remote": n, "fallback": n},  # 安装来源统计
        }
    """
    from service_boundary import INDUSTRY_EXPERT, resolve_industry_code

    # 归一化行业代码：许可证给 4 位细分码（如 C3120），映射表用大类码（如 C31）
    industry_code = resolve_industry_code("", industry_code) or industry_code

    _log("info", "install_industry_start", industry_code=industry_code)
    t0 = time.time()

    industry_name = INDUSTRY_EXPERT.get(industry_code, {}).get("name", "未知行业")
    info = get_skills_by_industry(industry_code)

    _log("info", "install_industry_resolved",
         industry_code=industry_code,
         industry_name=industry_name,
         industry_skill_count=len(info["industry_skill_ids"]),
         universal_skill_count=len(info["universal_skill_ids"]),
         custom_skill_count=len(info["custom_skills"]),
         total_target=info["total"])

    installed: list[str] = []
    skipped: list[str] = []
    failed: list[dict] = []
    sources = {"remote": 0, "fallback": 0}

    # 合并所有需要安装的远程技能 ID（行业专属 + 通用）
    all_remote_ids = info["industry_skill_ids"] + info["universal_skill_ids"]
    _log("info", "install_industry_remote_ids", count=len(all_remote_ids), ids=all_remote_ids)

    # 1. 安装远程技能
    for idx, skill_id in enumerate(all_remote_ids, 1):
        _log("info", "install_industry_progress", idx=idx, total=len(all_remote_ids), skill_id=skill_id)
        try:
            result = install_skill(skill_id)
            if result.get("ok"):
                src = result.get("source", "fallback")
                sources[src] = sources.get(src, 0) + 1
                if result.get("skipped"):
                    skipped.append(skill_id)
                    _log("info", "install_industry_skill_skipped", idx=idx, skill_id=skill_id)
                else:
                    installed.append(skill_id)
                    _log("info", "install_industry_skill_installed", idx=idx, skill_id=skill_id, source=src)
            else:
                failed.append({"id": skill_id, "name": skill_id, "error": result.get("detail", "")})
                _log("error", "install_industry_skill_failed", idx=idx, skill_id=skill_id, detail=result.get("detail", ""))
        except Exception as e:
            failed.append({"id": skill_id, "name": skill_id, "error": str(e)})
            _log("error", "install_industry_skill_exception", idx=idx, skill_id=skill_id, error=str(e), exc_type=type(e).__name__)

    # 2. 安装行业兜底自定义技能（仅当远程无行业专属技能时）
    if not info["industry_skill_ids"]:
        _log("info", "install_industry_no_remote_for_industry",
             industry_code=industry_code,
             custom_count=len(info["custom_skills"]),
             hint="将安装本地兜底技能")
        for skill_def in info["custom_skills"]:
            try:
                _log("info", "install_industry_custom_start", skill_id=skill_def["id"], name=skill_def["name"])
                result = _install_custom_skill(skill_def)
                if result.get("ok"):
                    if result.get("skipped"):
                        skipped.append(skill_def["name"])
                        _log("info", "install_industry_custom_skipped", name=skill_def["name"])
                    else:
                        installed.append(skill_def["name"])
                        sources["fallback"] += 1
                        _log("info", "install_industry_custom_installed", name=skill_def["name"])
                else:
                    failed.append({"id": skill_def["id"], "name": skill_def["name"], "error": result.get("detail", "")})
                    _log("error", "install_industry_custom_failed", name=skill_def["name"], detail=result.get("detail", ""))
            except Exception as e:
                failed.append({"id": skill_def["id"], "name": skill_def["name"], "error": str(e)})
                _log("error", "install_industry_custom_exception", name=skill_def["name"], error=str(e))
    else:
        _log("info", "install_industry_has_remote_skills",
             industry_code=industry_code,
             count=len(info["industry_skill_ids"]),
             hint="跳过本地兜底技能")

    ms = int((time.time() - t0) * 1000)
    _log("info", "install_industry_complete",
         industry_code=industry_code,
         industry_name=industry_name,
         installed_count=len(installed),
         skipped_count=len(skipped),
         failed_count=len(failed),
         total=len(installed) + len(skipped),
         sources=sources,
         ms=ms)

    return {
        # 只要至少有一个技能就位（已安装或已存在）即视为成功；
        # 单个技能下架/网络异常不应导致整体"失败"。
        "ok": len(installed) + len(skipped) > 0,
        "industry_code": industry_code,
        "industry_name": industry_name,
        "installed": installed,
        "skipped": skipped,
        "failed": failed,
        "total": len(installed) + len(skipped),
        "sources": sources,
    }


def resolve_industry_from_permit(permit_data: dict) -> str:
    """从排污许可证数据解析行业代码

    Args:
        permit_data: 解析后的许可证数据（parsed 字段）

    Returns:
        行业代码（如 "C31"），未识别返回空字符串
    """
    from service_boundary import resolve_industry_code

    industry_name = (
        permit_data.get("industryCategory")
        or permit_data.get("industry")
        or permit_data.get("industryType")
        or ""
    )
    industry_code = (
        permit_data.get("industryCode")
        or permit_data.get("industry_code")
        or ""
    )
    return resolve_industry_code(industry_name, industry_code)
