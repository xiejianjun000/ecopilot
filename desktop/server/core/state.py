"""
EcoPilot 共享运行时状态 — 替代模块级全局变量

所有路由模块通过此模块访问共享状态，解耦 chat_api.py 与子路由。
"""

import os
import threading
import time
from pathlib import Path

# ═══ 认证状态 ═══
AUTH_TOKEN: str = ""
LICENSE_VALID: bool = False

# ═══ 速率限制 ═══
_rate_limits: dict[str, list[float]] = {}
_rate_lock = threading.Lock()
RATE_WINDOW = 60
RATE_MAX = 300

# ═══ SMS 验证码 ═══
_sms_codes: dict = {}

# ═══ AI 客户端（由 chat_api.py 初始化）═══
ds_client = None
kimi_client = None
TEXT_MODEL = "deepseek-v4-flash"
KIMI_VISION_MODEL = "moonshot-v1-32k-vision-preview"

# ═══ 路径 ═══
HERMES_HOME = Path.home() / ".ecopilot-home"

# ═══ MCP ═══
mcp_manager = None


def set_auth(token: str, valid: bool):
    global AUTH_TOKEN, LICENSE_VALID
    AUTH_TOKEN = token
    LICENSE_VALID = valid


def check_rate_limit(client_ip: str) -> bool:
    """Returns True if request is within limit, False if exceeded"""
    now = time.time()
    with _rate_lock:
        bucket = _rate_limits.get(client_ip, [])
        bucket = [t for t in bucket if now - t < RATE_WINDOW]
        if len(bucket) >= RATE_MAX:
            return False
        bucket.append(now)
        _rate_limits[client_ip] = bucket
        return True


def init_clients(text_client, vision_client, text_model: str, vision_model: str):
    global ds_client, kimi_client, TEXT_MODEL, KIMI_VISION_MODEL
    ds_client = text_client
    kimi_client = vision_client
    TEXT_MODEL = text_model
    KIMI_VISION_MODEL = vision_model
