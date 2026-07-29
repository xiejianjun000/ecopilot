"""
EcoPilot 共享运行时状态

chat_api.py 在启动时初始化这些变量，所有路由模块通过此模块读取。
Python 模块缓存保证单例。
"""

# ═══ AI 客户端（由 chat_api lifespan 初始化）═══
ds_client = None
kimi_client = None
TEXT_MODEL = "deepseek-v4-flash"
KIMI_VISION_MODEL = "moonshot-v1-32k-vision-preview"

# ═══ 认证状态 ═══
AUTH_TOKEN = ""
LICENSE_VALID = False

# ═══ SMS 验证码 ═══
sms_codes: dict = {}

# ═══ 速率限制 ═══
import threading, time
_rate_limits: dict[str, list[float]] = {}
_rate_lock = threading.Lock()
RATE_WINDOW = 60
RATE_MAX = 300
