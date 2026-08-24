"""认证层：CAS 登录 + kaptcha 识别 + 会话管理。"""

from .auth_manager import AuthManager
from .captcha import CaptchaRecognizer

__all__ = ["AuthManager", "CaptchaRecognizer"]
