"""
Hermes Bridge — 封装 Hermes Agent CLI 为结构化 JSON API

将 Hermes 的全部能力（curator/skills/journey/memory/insights/cron）
以可编程接口暴露给 EcoPilot 后端和前端。

用法:
    from hermes_bridge import HermesBridge
    bridge = HermesBridge()
    status = await bridge.curator_status()
    skills = await bridge.skills_list()
    journey = await bridge.journey()
"""

import asyncio
import json
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

_SERVER_DIR = Path(__file__).resolve().parent
_ECOPILOT_ROOT = _SERVER_DIR.parent.parent
_HERMES_AGENT_DIR = _ECOPILOT_ROOT / "hermes-agent"
_HERMES_PYTHON = _HERMES_AGENT_DIR / ".venv" / "bin" / "python"
_HERMES_SCRIPT = _HERMES_AGENT_DIR / "hermes"


class HermesBridge:
    """Hermes Agent CLI 的异步封装层"""

    def __init__(self):
        self._python = str(_HERMES_PYTHON)
        self._script = str(_HERMES_SCRIPT)

    async def _run(self, *args, timeout: int = 30) -> str:
        """执行 Hermes CLI 命令，返回 stdout"""
        cmd = [self._python, self._script] + list(args)

        def _sync() -> str:
            try:
                result = subprocess.run(
                    cmd, capture_output=True, text=True,
                    timeout=timeout,
                )
                if result.returncode != 0:
                    logger.warning("Hermes %s failed: %s", args[0], result.stderr.strip()[:200])
                    return ""
                return result.stdout
            except subprocess.TimeoutExpired:
                logger.warning("Hermes %s timeout after %ds", args[0], timeout)
                return ""
            except FileNotFoundError:
                logger.error("Hermes binary not found: %s", self._script)
                return ""
            except Exception as e:
                logger.error("Hermes %s error: %s", args[0], e)
                return ""

        return await asyncio.to_thread(_sync)

    # ─── Curator (技能管家/进化) ───────────────────────────

    async def curator_status(self) -> dict[str, Any]:
        """获取 Curator 状态"""
        text = await self._run("curator", "status", timeout=30)
        if not text:
            return {"enabled": False}

        result: dict[str, Any] = {"enabled": "ENABLED" in text}

        # 解析基础状态
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("runs:"):
                result["runs"] = int(line.split(":")[1].strip())
            elif line.startswith("last run:"):
                result["last_run"] = line.split(":", 1)[1].strip()
            elif line.startswith("interval:"):
                result["interval"] = line.split(":", 1)[1].strip()
            elif line.startswith("stale after:"):
                result["stale_after"] = line.split(":", 1)[1].strip()
            elif line.startswith("archive after:"):
                result["archive_after"] = line.split(":", 1)[1].strip()
            elif line.startswith("consolidate:"):
                result["consolidate"] = line.split(":", 1)[1].strip()

        # 解析技能统计
        m = re.search(r"agent-created skills:\s*(\d+)", text)
        if m:
            result["agent_skills_total"] = int(m.group(1))

        for state in ("active", "stale", "archived"):
            m = re.search(rf"\s{state}\s+(\d+)", text)
            if m:
                result[f"agent_skills_{state}"] = int(m.group(1))

        # 解析最活跃/最不活跃
        def _parse_section(lines: list[str], start_marker: str) -> list[dict]:
            items = []
            in_section = False
            for line in lines:
                if start_marker in line:
                    in_section = True
                    continue
                if in_section:
                    if not line.strip() or line.startswith("most active") or line.startswith("least active"):
                        break
                    parts = line.strip().split(None, 1)
                    if len(parts) >= 2:
                        name = parts[0]
                        # 解析 activity=xx use=xx view=xx patches=xx last_activity=xx
                        metrics = {}
                        for kv in re.findall(r'(\w+)=([^\s]+)', parts[1]):
                            metrics[kv[0]] = kv[1]
                        items.append({"name": name, **metrics})
            return items

        lines = text.splitlines()
        result["most_active"] = _parse_section(lines, "most active")
        result["least_active"] = _parse_section(lines, "least active")
        result["least_recently_active"] = _parse_section(lines, "least recently active")

        return result

    async def curator_run(self) -> dict[str, Any]:
        """手动触发 Curator 运行"""
        text = await self._run("curator", "run", timeout=120)
        return {"triggered": bool(text), "output": text[:500] if text else ""}

    async def curator_pause(self) -> dict[str, Any]:
        """暂停 Curator"""
        text = await self._run("curator", "pause", timeout=15)
        return {"paused": "paused" in text.lower()}

    async def curator_resume(self) -> dict[str, Any]:
        """恢复 Curator"""
        text = await self._run("curator", "resume", timeout=15)
        return {"resumed": "resumed" in text.lower()}

    async def curator_prune(self, days: int = 90) -> dict[str, Any]:
        """清理闲置技能"""
        text = await self._run("curator", "prune", str(days), timeout=60)
        return {"pruned": bool(text), "output": text[:300] if text else ""}

    # ─── Skills (技能管理) ────────────────────────────────

    async def skills_list(self, source: str = "all") -> list[dict[str, Any]]:
        """列出已安装技能"""
        text = await self._run("skills", "list", "--source", source, "--enabled-only", timeout=30)
        if not text:
            return []

        skills = []
        in_table = False
        for line in text.splitlines():
            # 表格边界: rich 使用 box-drawing 字符
            if any(c in line for c in ("┏", "┗", "┣", "┻", "┫", "┛")):
                continue
            if "━" in line or "┃" not in line and "│" not in line:
                continue
            if "Name" in line or "Category" in line:
                continue
            if not line.strip() or all(c in " ││┃┆—" for c in line.strip()):
                continue

            # 解析: rich 表格以 │ 或 ┃ 分隔
            parts = [p.strip() for p in re.split(r'[│┃]', line) if p.strip()]
            if len(parts) >= 5:
                skills.append({
                    "name": parts[0],
                    "category": parts[1],
                    "source": parts[2],
                    "trust": parts[3],
                    "status": parts[4],
                })

        return skills

    async def skills_search(self, query: str) -> list[dict[str, Any]]:
        """搜索可安装技能"""
        text = await self._run("skills", "search", query, timeout=30)
        if not text:
            return []
        results = []
        for line in text.splitlines():
            if line.strip() and not line.startswith(" ") and not line.startswith("No"):
                results.append({"name": line.strip()})
        return results

    async def skills_install(self, name: str) -> dict[str, Any]:
        """安装技能"""
        text = await self._run("skills", "install", name, timeout=60)
        return {"installed": "installed" in text.lower() or "already" in text.lower(), "output": text[:300]}

    async def skills_uninstall(self, name: str) -> dict[str, Any]:
        """卸载技能"""
        text = await self._run("skills", "uninstall", name, timeout=30)
        return {"uninstalled": "removed" in text.lower(), "output": text[:300]}

    async def skills_inspect(self, name: str) -> dict[str, Any]:
        """查看技能详情"""
        text = await self._run("skills", "inspect", name, timeout=15)
        if not text:
            return {}
        result: dict[str, Any] = {"name": name}
        for line in text.splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                result[k.strip().lower().replace(" ", "_")] = v.strip()
        return result

    # ─── Journey (学习旅程/记忆图谱) ─────────────────────

    async def journey(self) -> dict[str, Any]:
        """获取学习旅程（JSON 格式返回）"""
        text = await self._run("journey", "--json", timeout=30)
        if not text:
            return {"nodes": [], "edges": []}
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return {"nodes": [], "edges": [], "raw": text[:500]}

    async def journey_stats(self) -> dict[str, Any]:
        """学习旅程统计摘要"""
        data = await self.journey()
        nodes = data.get("nodes", [])
        edges = data.get("edges", [])

        categories: dict[str, int] = {}
        states: dict[str, int] = {}
        kinds: dict[str, int] = {}

        for n in nodes:
            cat = n.get("category", "uncategorized")
            categories[cat] = categories.get(cat, 0) + 1
            state = n.get("state", "unknown")
            states[state] = states.get(state, 0) + 1
            kind = n.get("kind", "unknown")
            kinds[kind] = kinds.get(kind, 0) + 1

        return {
            "total_nodes": len(nodes),
            "total_edges": len(edges),
            "categories": categories,
            "states": states,
            "kinds": kinds,
        }

    # ─── Memory (记忆) ─────────────────────────────────────

    async def memory_status(self) -> dict[str, Any]:
        """获取记忆系统状态"""
        text = await self._run("memory", timeout=15)
        return {"status": text[:500] if text else ""}

    # ─── Insights (洞察/用量分析) ─────────────────────────

    async def insights(self) -> dict[str, Any]:
        """获取用量洞察"""
        text = await self._run("insights", timeout=30)
        if not text:
            return {}
        # 解析各维度数据
        result: dict[str, Any] = {}
        sections = text.split("\n\n")
        for section in sections:
            lines = section.strip().splitlines()
            if not lines:
                continue
            header = lines[0].strip().rstrip(":")
            items = {}
            for line in lines[1:]:
                if ":" in line:
                    k, v = line.split(":", 1)
                    items[k.strip()] = v.strip()
            if header:
                result[header.lower().replace(" ", "_")] = items
        return result

    # ─── Config (配置) ─────────────────────────────────────

    async def config(self) -> dict[str, Any]:
        """获取 Hermes 配置"""
        text = await self._run("config", timeout=15)
        if not text:
            return {}
        result: dict[str, Any] = {}
        for line in text.splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                result[k.strip()] = v.strip()
        return result

    # ─── Health (健康检查) ────────────────────────────────

    async def doctor(self) -> dict[str, Any]:
        """运行 Hermes 健康检查"""
        text = await self._run("doctor", timeout=60)
        return {"healthy": bool(text), "output": text[:1000] if text else ""}

    # ─── Version ────────────────────────────────────────────

    async def version(self) -> str:
        """获取 Hermes 版本"""
        text = await self._run("--version", timeout=10)
        return text.strip()
