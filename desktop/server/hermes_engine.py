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
        self._ensure_hermes_home()

    @staticmethod
    def _ensure_hermes_home() -> None:
        """首次使用时初始化 ~/.hermes：写入模型配置并安装 EcoPilot skill。

        模型配置复用 EcoPilot 的 DeepSeek 配置（OpenAI 兼容接口），
        避免用户重复配置；skill 从后端目录同步到 hermes skills 目录。
        """
        try:
            # 与 hermes_constants 的平台默认路径保持一致：
            # Windows → %LOCALAPPDATA%\hermes；Linux/macOS → ~/.hermes
            home = os.environ.get("HERMES_HOME", "").strip()
            if not home:
                if os.name == "nt":
                    base = os.environ.get("LOCALAPPDATA", "").strip() or \
                        os.path.join(os.path.expanduser("~"), "AppData", "Local")
                    home = os.path.join(base, "hermes")
                else:
                    home = os.path.join(os.path.expanduser("~"), ".hermes")
            skills_dir = os.path.join(home, "skills")
            os.makedirs(skills_dir, exist_ok=True)

            # 1. 模型配置（.env：OpenAI 兼容的 key/base_url；config.yaml：默认模型）
            # 每次唤醒都用当前 EcoPilot 配置重写，保证用户在 onboarding 改 key 后
            # hermes 立即用上最新配置
            env_path = os.path.join(home, ".env")
            api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
            base_url = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip().rstrip("/")
            if api_key:
                with open(env_path, "w", encoding="utf-8") as f:
                    f.write(f"OPENAI_API_KEY={api_key}\nOPENAI_BASE_URL={base_url}/v1\n")
                try:
                    os.chmod(env_path, 0o600)
                except OSError:
                    pass
            cfg_path = os.path.join(home, "config.yaml")
            model = os.environ.get("ECOPILOT_TEXT_MODEL", "deepseek-v4-flash").strip()
            with open(cfg_path, "w", encoding="utf-8") as f:
                f.write(f"model: {model}\n")

            # 2. 安装/更新 ecopilot-compliance-butler skill
            src = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "hermes_skill", "ecopilot-compliance-butler")
            dst = os.path.join(skills_dir, "ecopilot-compliance-butler")
            if os.path.isdir(src):
                # 手动读写复制，避免 shutil.copytree 在旧 Windows 上调用
                # CopyFile2 的兼容性问题
                os.makedirs(dst, exist_ok=True)
                for fname in os.listdir(src):
                    s_file = os.path.join(src, fname)
                    if os.path.isfile(s_file):
                        with open(s_file, "rb") as fi:
                            data = fi.read()
                        with open(os.path.join(dst, fname), "wb") as fo:
                            fo.write(data)
                logger.info("Hermes skill 已同步 → %s", dst)
        except Exception as e:
            logger.warning("Hermes home 初始化跳过（非关键）: %s", e)

    @staticmethod
    def _find_hermes() -> str:
        """查找 hermes 可执行文件"""
        import shutil
        import sys
        h = shutil.which("hermes")
        if h:
            return h
        # 回退路径：内嵌运行时 Scripts 目录（打包版）→ 常见安装位置
        _scripts = os.path.join(os.path.dirname(sys.executable), "Scripts")
        candidates = [
            os.path.join(_scripts, "hermes.bat"),          # Windows 内嵌运行时
            os.path.join(_scripts, "hermes.exe"),          # pip 标准安装
            os.path.join(_scripts, "hermes"),              # Linux/macOS 内嵌运行时
            os.path.expanduser("~/.local/bin/hermes"),
            os.path.expanduser("~/Desktop/ecopilot/hermes-agent/hermes"),
        ]
        for c in candidates:
            if os.path.isfile(c):
                if c.endswith((".bat", ".cmd", ".exe")) or os.access(c, os.X_OK):
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
                # Windows 下 .bat/.cmd 需要经 cmd.exe 执行
                _shell = os.name == "nt" and self._bin.lower().endswith((".bat", ".cmd"))
                result = subprocess.run(
                    cmd, capture_output=True, text=True,
                    timeout=HERMES_TIMEOUT, shell=_shell,
                    encoding="utf-8", errors="replace",
                )
                if result.returncode != 0:
                    logger.error("Hermes error (code=%d): %s",
                                 result.returncode, result.stderr.strip()[:200])
                    return f"⚠️ Hermes 调用失败: {result.stderr.strip()[:200]}"
                text = result.stdout.strip()
                        # 去掉 session_id 元数据行
                lines = [l for l in text.splitlines() if not l.startswith("session_id:")]
                result = "\n".join(lines).strip()
                # 强制紧凑：无论\r\n还是\n，全压成单个\n
                import re as _re
                result = _re.sub(r'(\r\n|\r|\n){2,}', '\n', result)
                return result
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
            _shell = os.name == "nt" and self._bin.lower().endswith((".bat", ".cmd"))
            await asyncio.to_thread(lambda: subprocess.run(
                [self._bin, "chat", "-q", "hello", "-s", self.skill, "-Q"],
                capture_output=True, text=True, timeout=90, shell=_shell,
                encoding="utf-8", errors="replace",
            ))
            logger.info("Hermes warmup 完成")
        except Exception as e:
            logger.warning("Hermes warmup 跳过 (非关键): %s", e)
