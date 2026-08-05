#!/usr/bin/env python3
"""
EcoSkill CLI — 多 AI 平台自适应技能安装通道
仿 ClawHub `clawhub install` / SkillHub `skills install`

支持平台: WorkBuddy | Hermes | OpenClaw | Claude Code | QClaw | CodeBuddy | Cursor | Codex
自动检测已安装的 AI 平台，安装到对应 skills 目录。

Usage:
    ecoskill search <keyword>        # 搜索技能
    ecoskill install <id>            # 自动检测平台并安装
    ecoskill install <id> -t wb      # 指定安装到 WorkBuddy
    ecoskill install <id> --all      # 安装到所有可用平台
    ecoskill list                    # 列出已安装
    ecoskill catalog                 # 显示全部目录
    ecoskill info <id>               # 查看技能详情
    ecoskill platforms               # 显示可用平台
"""

import json
import sys
import os
from pathlib import Path

SKILLS_JSON = Path(__file__).parent / "skills.json"
HOME = Path.home()

# 多 AI 平台定义（自动检测已安装的平台）
PLATFORMS = {
    "wb":     {"name": "WorkBuddy",   "dir": HOME / ".workbuddy" / "skills", "icon": "🦀"},
    "hermes": {"name": "Hermes",      "dir": HOME / ".hermes" / "skills",     "icon": "🔮"},
    "claw":   {"name": "OpenClaw",    "dir": HOME / ".claw" / "skills",      "icon": "🦞"},
    "claude": {"name": "Claude Code", "dir": HOME / ".claude" / "skills",     "icon": "📦"},
    "qclaw":  {"name": "QClaw",       "dir": HOME / ".qclaw" / "skills",      "icon": "🐉"},
    "cb":     {"name": "CodeBuddy",   "dir": HOME / ".codebuddy" / "skills",  "icon": "💻"},
    "cursor": {"name": "Cursor",      "dir": HOME / ".cursor" / "skills",     "icon": "🎯"},
    "codex":  {"name": "Codex",       "dir": HOME / ".codex" / "skills",      "icon": "⚡"},
}


def detect_platforms():
    """检测已安装的 AI 平台"""
    return {k: v for k, v in PLATFORMS.items() if v["dir"].parent.exists()}


def get_target_platforms(target_arg):
    """解析目标平台参数"""
    available = detect_platforms()
    if not target_arg or target_arg == "auto":
        # 优先 WorkBuddy，其次按检测顺序
        return [next(iter(available.values()))] if available else [PLATFORMS["wb"]]
    if target_arg == "--all":
        return list(available.values()) if available else list(PLATFORMS.values())
    # 指定平台
    key = target_arg.lstrip("-")
    if key in PLATFORMS:
        p = PLATFORMS[key]
        return [p] if p["dir"].parent.exists() else [p]  # 强制安装即使目录不存在
    # 可能是完整名称
    for k, v in PLATFORMS.items():
        if v["name"].lower() == key.lower():
            return [v] if v["dir"].parent.exists() else [v]
    print(f"⚠ 未知平台: {key}，可用: {', '.join(PLATFORMS.keys())}")
    return [list(available.values())[0]] if available else [PLATFORMS["wb"]]


def load_skills():
    with open(SKILLS_JSON, "r", encoding="utf-8") as f:
        return json.load(f)


def find_skill(skills, skill_id):
    for s in skills:
        if s["id"] == skill_id:
            return s
    return None


def search(skills, keyword):
    keyword = keyword.lower()
    results = []
    for s in skills:
        if (keyword in s["name"].lower() or
            keyword in s["category"].lower() or
            keyword in s["description"].lower() or
            any(keyword in t.lower() for t in s.get("tags", []))):
            results.append(s)
    return results


def cmd_search(args):
    skills = load_skills()
    if not args:
        print("用法: ecoskill search <关键词>")
        print("示例: ecoskill search 水质")
        return
    keyword = " ".join(args)
    results = search(skills, keyword)
    if not results:
        print(f"未找到与 \"{keyword}\" 相关的技能")
        return
    print(f"\n找到 {len(results)} 个相关技能:\n")
    for s in results:
        sec = s.get("securityScan", {})
        sec_status = "✓ 安全" if sec.get("status") == "pass" else "⚠ 待审核"
        print(f"  [{s['id']}] {s['name']}")
        print(f"       分类: {s['category']} | 版本: {s['version']} | {sec_status}")
        print(f"       作者: {s['author']} ({s.get('authorOrg', '')})")
        print(f"       {s['description'][:80]}")
        print(f"       安装: ecoskill install {s['id']}")
        print()


def cmd_catalog(args):
    skills = load_skills()
    books = [s for s in skills if "书籍" in s.get("tags", [])]
    non_books = [s for s in skills if "书籍" not in s.get("tags", [])]

    print(f"\nEcoSkill 技能目录 ({len(skills)} 项)")
    print("=" * 60)

    if non_books:
        print(f"\n📦 技能工具 ({len(non_books)} 项):\n")
        for s in non_books:
            print(f"  [{s['id']}] {s['name']}")
            print(f"       {s['category']} | {s['author']} | {s['version']}")

    if books:
        print(f"\n📚 环境类书籍 ({len(books)} 项):\n")
        for s in books[:10]:
            print(f"  [{s['id']}] {s['name']}")
            print(f"       {s['category']} | {s['version']} | 安全:{s['securityScan']['status']}")
        if len(books) > 10:
            print(f"  ... 还有 {len(books)-10} 本书籍，使用 'ecoskill search 书籍' 查看")
    print()


def cmd_install(args):
    if not args:
        print("用法: ecoskill install <skill-id> [-t <平台>] [--all]")
        print("平台: wb=WorkBuddy hermes=Hermes claw=OpenClaw claude=ClaudeCode qclaw=QClaw cb=CodeBuddy cursor=Cursor codex=Codex")
        print("示例: ecoskill install book-001 --all")
        return

    skill_id = args[0]
    skills = load_skills()
    skill = find_skill(skills, skill_id)

    if not skill:
        print(f"❌ 未找到技能: {skill_id}")
        print(f"   使用 'ecoskill search <关键词>' 搜索")
        return

    # 解析目标平台
    target_arg = None
    if len(args) > 1:
        if args[1] == "--all":
            target_arg = "--all"
        elif args[1] in ("-t", "--target") and len(args) > 2:
            target_arg = args[2]
        elif args[1].startswith("-"):
            target_arg = args[1]

    targets = get_target_platforms(target_arg)
    
    if target_arg == "--all":
        print(f"📦 安装到全部 {len(targets)} 个平台:\n")
        installed = 0
        for platform in targets:
            result = _install_skill(skill, platform)
            if result:
                installed += 1
        print(f"\n✅ 已安装到 {installed}/{len(targets)} 个平台")
    else:
        platform = targets[0]
        _install_skill(skill, platform)


def _install_skill(skill, platform):
    """安装单个技能到指定平台"""
    target_dir = platform["dir"] / skill['id']
    
    if target_dir.exists():
        print(f"  {platform['icon']} {platform['name']}: 已存在 (跳过)")
        return False

    target_dir.mkdir(parents=True, exist_ok=True)

    sec = skill.get("securityScan", {})
    sec_status = sec.get("status", "unknown")
    
    skill_md = f"""---
name: {skill['id']}
description: "{skill['description']}"
version: {skill['version']}
author: {skill['author']}
category: {skill['category']}
tags: {json.dumps(skill.get('tags', []), ensure_ascii=False)}
license: {skill.get('license', 'CC-BY-NC-SA 4.0')}
source: EcoSkill Marketplace
installed_by: ecoskill install {skill['id']}
---

# {skill['name']}

{skill['description']}

## 基本信息
- **作者**: {skill['author']} ({skill.get('authorOrg', '')})
- **分类**: {skill['category']}
- **版本**: {skill['version']}
- **安全审计**: {sec_status}
- **最后更新**: {skill.get('lastUpdated', 'N/A')}

## 安装来源
通过 EcoSkill CLI 安装:
```
ecoskill install {skill['id']}
```

## 平台兼容
{chr(10).join(f"- {p['name']} ({p['version']})" for p in skill.get('platforms', []))}
"""
    (target_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
    print(f"  {platform['icon']} {platform['name']}: ✅ 已安装 → {target_dir}")
    return True


def cmd_info(args):
    if not args:
        print("用法: ecoskill info <skill-id>")
        return
    skills = load_skills()
    skill = find_skill(skills, args[0])
    if not skill:
        print(f"❌ 未找到: {args[0]}")
        return
    print(f"\n📋 {skill['name']}")
    print(f"   ID: {skill['id']}")
    print(f"   分类: {skill['category']}")
    print(f"   作者: {skill['author']} ({skill.get('authorOrg', '')})")
    print(f"   版本: {skill['version']} | 许可: {skill.get('license', 'N/A')}")
    print(f"   安全审计: {skill['securityScan']['status']} ({skill['securityScan']['lastScan']})")
    print(f"   描述: {skill['description']}")
    print(f"   标签: {', '.join(skill.get('tags', []))}")
    print(f"   平台: {', '.join(p['name'] for p in skill.get('platforms', []))}")
    print()


def cmd_list(args):
    """列出所有平台已安装的技能"""
    available = detect_platforms()
    if not available:
        print("未检测到任何 AI 平台")
        return

    found_any = False
    for key, platform in available.items():
        skills_dir = platform["dir"]
        if not skills_dir.exists():
            continue
        installed = [d for d in skills_dir.iterdir() if d.is_dir() and (d / "SKILL.md").exists()]
        if installed:
            if not found_any:
                print(f"\n已安装的 EcoSkill 技能:\n")
                found_any = True
            print(f"  {platform['icon']} {platform['name']}:")
            for d in sorted(installed):
                print(f"      📦 {d.name}")

    if not found_any:
        print("尚未安装任何 EcoSkill 技能")
        print("使用 'ecoskill catalog' 浏览可用技能")


def cmd_platforms(args):
    """显示可用平台"""
    available = detect_platforms()
    print(f"\n已检测到 {len(available)} 个 AI 平台:\n")
    for key, platform in available.items():
        skills_exist = platform["dir"].exists() and any(platform["dir"].iterdir())
        status = "📂 已就绪" if skills_exist else "📁 空目录"
        print(f"  {platform['icon']} {platform['name']}")
        print(f"      别名: ecoskill install <id> -t {key}")
        print(f"      路径: {platform['dir']}")
        print(f"      状态: {status}")
        print()

    # 显示未安装但支持的平台
    missing = {k: v for k, v in PLATFORMS.items() if k not in available}
    if missing:
        print(f"未检测到但支持的平台:\n")
        for key, platform in missing.items():
            print(f"  {platform['icon']} {platform['name']} → {platform['dir']}")


def main():
    if len(sys.argv) < 2:
        available = detect_platforms()
        platform_list = ", ".join(f"{p['name']}" for p in available.values()) if available else "WorkBuddy (未检测到平台, 默认)"
        print("EcoSkill CLI — 多 AI 平台自适应技能安装工具")
        print(f"已检测平台: {platform_list}")
        print()
        print("命令:")
        print("  search    <关键词>      搜索技能")
        print("  catalog                 显示全部目录")
        print("  install   <id> [--all]  安装技能 (自动检测平台)")
        print("  install   <id> -t <平台> 安装到指定平台")
        print("  info      <id>          查看技能详情")
        print("  list                    列出已安装技能")
        print("  platforms               显示可用平台")
        print()
        print("示例:")
        print("  ecoskill search 碳")
        print("  ecoskill install book-001 --all")
        print("  ecoskill install book-001 -t wb")
        return

    cmd = sys.argv[1]
    args = sys.argv[2:]

    commands = {
        "search": cmd_search,
        "catalog": cmd_catalog,
        "install": cmd_install,
        "info": cmd_info,
        "list": cmd_list,
        "platforms": cmd_platforms,
    }

    if cmd in commands:
        commands[cmd](args)
    else:
        print(f"未知命令: {cmd}")
        print(f"可用命令: {', '.join(commands.keys())}")


if __name__ == "__main__":
    main()
