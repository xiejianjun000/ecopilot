"""
EcoSkill 技能市场桥接 — EcoPilot 的唯一技能来源

用法:
    from ecoskill.bridge import search_skills, install_skill, get_installed_skills

    results = search_skills("水质")
    install_skill("eco-compliance-001", platform="hermes")
"""

import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

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


def load_catalog() -> list[dict]:
    """加载完整的 EcoSkill 技能目录"""
    if not SKILLS_JSON.exists():
        return []
    with open(SKILLS_JSON, "r", encoding="utf-8") as f:
        return json.load(f)


def search_skills(keyword: str) -> list[dict]:
    """在 EcoSkill 市场搜索技能"""
    catalog = load_catalog()
    keyword = keyword.lower()
    results = []
    for s in catalog:
        if (keyword in s["name"].lower() or
            keyword in s["category"].lower() or
            keyword in s["description"].lower() or
            any(keyword in t.lower() for t in s.get("tags", []))):
            results.append(s)
    return results


def install_skill(skill_id: str, platform: str = "hermes") -> dict:
    """从 EcoSkill 安装技能到指定平台

    Returns:
        {"ok": bool, "detail": str, "installed_path": str | None}
    """
    catalog = load_catalog()
    skill = next((s for s in catalog if s["id"] == skill_id), None)
    if not skill:
        return {"ok": False, "detail": f"EcoSkill 市场中未找到技能: {skill_id}"}

    target_dir = Path.home() / ".hermes" / "skills" / skill_id

    if target_dir.exists():
        return {"ok": True, "detail": f"技能 {skill['name']} 已安装", "installed_path": str(target_dir)}

    target_dir.mkdir(parents=True, exist_ok=True)

    skill_md = f"""---
name: {skill['id']}
description: "{skill['description']}"
version: {skill['version']}
author: {skill['author']}
category: {skill['category']}
tags: {json.dumps(skill.get('tags', []), ensure_ascii=False)}
license: {skill.get('license', 'CC-BY-NC-SA 4.0')}
source: EcoSkill Marketplace (https://ecoskill.dev)
installed_by: ecoskill install {skill['id']}
---

# {skill['name']}

{skill['description']}

## 基本信息

- 作者: {skill['author']} ({skill.get('authorOrg', '')})
- 分类: {skill['category']}
- 版本: {skill['version']}
- 安全的: {skill.get('securityScan', {}).get('status', 'unknown')}

## 安装来源

通过 EcoSkill CLI 安装:
```
ecoskill install {skill['id']}
```

## 平台兼容
{chr(10).join(f"- {p['name']}" for p in skill.get('platforms', []))}
"""
    (target_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
    return {"ok": True, "detail": f"已安装 {skill['name']}", "installed_path": str(target_dir)}


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
