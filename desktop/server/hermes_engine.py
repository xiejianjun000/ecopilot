"""
Hermes AI 对话引擎 — EcoPilot 的 AI 基座

EcoPilot 前端 → 本模块 → Hermes Agent CLI (hermes chat -q)
                          ├─ 加载 ecopilot-compliance-butler skill
                          ├─ 自动发现 MCP 工具
                          ├─ 读许可证/查法规/调工具
                          └─ 返回完整回答

用法: engine = HermesEngine(); text = await engine.chat("问题")
"""

import asyncio
import json
import logging
import os
import subprocess
from typing import Optional

logger = logging.getLogger(__name__)

# 默认 skill
HERMES_SKILL = os.environ.get("ECOPILOT_HERMES_SKILL", "ecopilot-compliance-butler")
HERMES_BIN = "hermes"
# 调用超时（秒）
HERMES_TIMEOUT = int(os.environ.get("ECOPILOT_HERMES_TIMEOUT", "120"))


class HermesEngine:
    """Hermes Agent 对话引擎封装"""

    def __init__(self, skill: str = HERMES_SKILL):
        self.skill = skill
        self._bin = self._find_hermes()

    @staticmethod
    def _find_hermes() -> str:
        """查找 hermes 可执行文件"""
        import shutil
        h = shutil.which("hermes")
        if h:
            return h
        # 回退到相对路径
        candidates = [
            os.path.expanduser("~/.local/bin/hermes"),
            os.path.expanduser("~/Desktop/ecopilot/hermes-agent/hermes"),
        ]
        for c in candidates:
            if os.path.isfile(c) and os.access(c, os.X_OK):
                return c
        raise FileNotFoundError(
            "Hermes 未找到。请先安装 Hermes Agent。"
        )

    async def chat(self, message: str, session_id: str = "") -> str:
        """
        发送消息给 Hermes，返回完整回答。

        Args:
            message: 用户消息
            session_id: 仅用于日志记录，不传给 Hermes CLI

        Returns:
            Hermes 的回答文本
        """
        cmd = [
            self._bin, "chat", "-q", message,
            "-s", self.skill,
            "-Q",  # 静默模式
        ]

        logger.info("Hermes call: skill=%s | sid=%s | msg=%.50s",
                     self.skill, session_id, message)

        def _run_sync() -> str:
            """在同步线程中运行 Hermes CLI"""
            try:
                result = subprocess.run(
                    cmd, capture_output=True, text=True,
                    timeout=HERMES_TIMEOUT
                )
                if result.returncode != 0:
                    logger.error("Hermes error (code=%d): %s",
                                 result.returncode, result.stderr.strip()[:200])
                    return f"⚠️ Hermes 调用失败: {result.stderr.strip()[:200]}"
                text = result.stdout.strip()
                # 去掉 session_id 元数据行
                lines = [l for l in text.splitlines() if not l.startswith("session_id:")]
                return "\n".join(lines).strip()
            except subprocess.TimeoutExpired:
                logger.error("Hermes timeout after %ds", HERMES_TIMEOUT)
                return "⚠️ Hermes 响应超时，请稍后重试。"
            except FileNotFoundError:
                return "⚠️ 找不到 Hermes 可执行文件。"
            except Exception as e:
                logger.error("Hermes call failed: %s", e)
                return f"⚠️ Hermes 调用异常: {e}"

        return await asyncio.to_thread(_run_sync)

    async def warmup(self):
        """预加热：后台执行一次轻量查询，让 Hermes 加载环境和 MCP 连接"""
        logger.info("Hermes warmup: 预加载 skill 和 MCP 连接...")
        try:
            await asyncio.to_thread(lambda: subprocess.run(
                [self._bin, "chat", "-q", "hello", "-s", self.skill, "-Q"],
                capture_output=True, text=True, timeout=90
            ))
            logger.info("Hermes warmup 完成")
        except Exception as e:
            logger.warning("Hermes warmup 跳过 (非关键): %s", e)
