"""
支付配置 — 支付宝当面付 + 微信 Native 扫码支付
当面付适合 PC 网站场景：
用户在网站下单 → 后端创建预付单 → 返回二维码 → 用户扫码付款 → 异步通知支付结果
"""
import os
from pathlib import Path

# ── 支付宝应用配置 ──────────────────────────────────────
ALIPAY_APP_ID = os.environ.get("ALIPAY_APP_ID", "2021000000000000")  # 替换为真实 AppID
ALIPAY_PRIVATE_KEY_PATH = os.environ.get("ALIPAY_PRIVATE_KEY_PATH", "")
ALIPAY_PUBLIC_KEY_PATH = os.environ.get("ALIPAY_PUBLIC_KEY_PATH", "")

# ── 支付宝网关 ──────────────────────────────────────────
ALIPAY_GATEWAY = "https://openapi.alipay.com/gateway.do"  # 生产环境
ALIPAY_GATEWAY_DEV = "https://openapi-sandbox.d.alipaydev.com/gateway.do"  # 沙箱环境

# 是否使用沙箱环境
ALIPAY_USE_SANDBOX = os.environ.get("ALIPAY_USE_SANDBOX", "true").lower() == "true"

# ── 异步通知 & 回调地址 ──────────────────────────────────
ALIPAY_NOTIFY_URL = os.environ.get(
    "ALIPAY_NOTIFY_URL",
    "https://ecopilot.example.com/api/payment/notify",
)
ALIPAY_RETURN_URL = os.environ.get(
    "ALIPAY_RETURN_URL",
    "https://ecopilot.example.com/pricing.html?payment=success",
)

# ── 订单超时（分钟）────────────────────────────────────
ORDER_TIMEOUT = 30

# ── RSA2 密钥 ──────────────────────────────────────────
# 沙箱环境使用支付宝提供的密钥，生产环境需要自行配置
SANDBOX_PRIVATE_KEY = os.environ.get("ALIPAY_SANDBOX_PRIVATE_KEY", "")
SANDBOX_PUBLIC_KEY = os.environ.get("ALIPAY_SANDBOX_PUBLIC_KEY", "")


def get_gateway() -> str:
    """根据环境变量返回对应的支付宝网关地址"""
    return ALIPAY_GATEWAY_DEV if ALIPAY_USE_SANDBOX else ALIPAY_GATEWAY


def get_private_key() -> str:
    """获取应用私钥（用于签名请求）"""
    # 优先使用沙箱环境变量
    if ALIPAY_USE_SANDBOX and SANDBOX_PRIVATE_KEY:
        return SANDBOX_PRIVATE_KEY
    # 其次读取密钥文件
    if ALIPAY_PRIVATE_KEY_PATH and Path(ALIPAY_PRIVATE_KEY_PATH).exists():
        return Path(ALIPAY_PRIVATE_KEY_PATH).read_text().strip()
    # 最后尝试环境变量
    return os.environ.get("ALIPAY_PRIVATE_KEY", "")


def get_alipay_public_key() -> str:
    """获取支付宝公钥（用于验签异步通知）"""
    # 优先使用沙箱环境变量
    if ALIPAY_USE_SANDBOX and SANDBOX_PUBLIC_KEY:
        return SANDBOX_PUBLIC_KEY
    # 其次读取密钥文件
    if ALIPAY_PUBLIC_KEY_PATH and Path(ALIPAY_PUBLIC_KEY_PATH).exists():
        return Path(ALIPAY_PUBLIC_KEY_PATH).read_text().strip()
    # 最后尝试环境变量
    return os.environ.get("ALIPAY_PUBLIC_KEY", "")


# ── 微信支付配置 ──────────────────────────────────────
WECHAT_APP_ID = os.environ.get("WECHAT_APP_ID", "wx0000000000000000")
WECHAT_MCH_ID = os.environ.get("WECHAT_MCH_ID", "1900000000")  # 商户号
WECHAT_API_KEY_V3 = os.environ.get("WECHAT_API_KEY_V3", "")  # API v3 密钥
WECHAT_SERIAL_NO = os.environ.get("WECHAT_SERIAL_NO", "")  # 商户API证书序列号
WECHAT_PRIVATE_KEY_PATH = os.environ.get("WECHAT_PRIVATE_KEY_PATH", "")  # 商户API私钥路径
WECHAT_NOTIFY_URL = os.environ.get("WECHAT_NOTIFY_URL", "https://ecopilot.example.com/api/payment/notify/wechat")

# 微信支付网关
WECHAT_GATEWAY = "https://api.mch.weixin.qq.com"
# 沙箱环境
WECHAT_SANDBOX = os.environ.get("WECHAT_SANDBOX", "false").lower() == "true"


def get_wechat_private_key() -> str:
    """获取微信商户API私钥"""
    if WECHAT_PRIVATE_KEY_PATH and Path(WECHAT_PRIVATE_KEY_PATH).exists():
        return Path(WECHAT_PRIVATE_KEY_PATH).read_text().strip()
    return os.environ.get("WECHAT_PRIVATE_KEY", "")


def get_wechat_gateway() -> str:
    """微信支付网关地址"""
    if WECHAT_SANDBOX:
        return "https://api.mch.weixin.qq.com/sandboxnew/pay/transactions/native"
    return WECHAT_GATEWAY
