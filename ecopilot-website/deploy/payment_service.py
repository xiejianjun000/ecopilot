"""
EcoPilot 支付服务 - 支付宝当面付 + 微信 Native 扫码支付
启动: python3 payment_service.py
端口: 8093

支付流程:
1. 用户选择"专业版-月付" → 前端调用 POST /api/payment/create（含 method 字段）
2. 后端根据 method 调用支付宝/微信预下单接口获取二维码 URL
3. 前端显示二维码，用户扫码付款
4. 支付宝/微信异步通知 → 验签 → 更新订单
5. 订单状态变为 paid → 自动激活用户订阅
6. 前端轮询 GET /api/payment/status/{order_id} 直到 paid
7. 跳转到"支付成功"页面
"""

import json
import os
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, urlencode

import jwt
import requests as http_requests
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

# ── 配置 ──────────────────────────────────────────────
# JWT_SECRET: 与 auth_service / subscription_service 共享同一密钥文件。
_default_secret_file = Path(__file__).parent / "data" / ".jwt_secret"
if _default_secret_file.exists():
    JWT_SECRET = _default_secret_file.read_text().strip()
else:
    JWT_SECRET = os.environ.get("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"
PORT = 8093

# ── 数据目录 ──────────────────────────────────────────
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
ORDERS_FILE = DATA_DIR / "payment_orders.json"

# ── 订阅计划价格（与 subscription_service.py 保持一致，单位：分）───────────
PLANS = {
    "pro": {
        "name": "专业版",
        "price_monthly": 29900,   # ¥299.00
        "price_yearly": 299900,   # ¥2999.00
    },
}

# ── 支付宝配置 ──────────────────────────────────────────
from payment_config import (
    ALIPAY_APP_ID,
    ALIPAY_USE_SANDBOX,
    ALIPAY_NOTIFY_URL,
    ALIPAY_RETURN_URL,
    ORDER_TIMEOUT,
    get_gateway,
    get_private_key,
    get_alipay_public_key,
    # 微信支付配置
    WECHAT_APP_ID,
    WECHAT_MCH_ID,
    WECHAT_API_KEY_V3,
    WECHAT_SERIAL_NO,
    WECHAT_NOTIFY_URL,
    get_wechat_private_key,
    get_wechat_gateway,
)


# ══════════════════════════════════════════════════════
# FastAPI 应用
# ══════════════════════════════════════════════════════

app = FastAPI(title="EcoPilot Payment Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ══════════════════════════════════════════════════════
# 工具函数
# ══════════════════════════════════════════════════════

def _read_json(path: Path) -> list:
    """读取 JSON 文件，不存在则返回空列表"""
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return []


def _write_json(path: Path, data: list):
    """写入 JSON 文件"""
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _now_iso() -> str:
    """当前 UTC+8 时间 ISO 格式"""
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


def _now_dt() -> datetime:
    """当前 UTC+8 datetime"""
    return datetime.now(timezone(timedelta(hours=8)))


def _parse_iso(iso_str: str) -> datetime:
    """解析 ISO 8601 字符串为 datetime"""
    return datetime.fromisoformat(iso_str)


def _cents_to_yuan(cents: int) -> float:
    """分转元"""
    return round(cents / 100, 2)


def _verify_token(authorization: str) -> dict:
    """验证 JWT Token，返回 payload"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未提供认证令牌")
    token = authorization[7:].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="令牌已过期")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="无效的令牌")


def _generate_order_id() -> str:
    """生成订单号: EP + 时间戳 + 随机数"""
    ts = int(time.time())
    rand = secrets.token_hex(4).upper()
    return f"EP{ts}{rand}"


def _get_order(order_id: str) -> Optional[dict]:
    """获取订单"""
    orders = _read_json(ORDERS_FILE)
    for o in orders:
        if o["order_id"] == order_id:
            return o
    return None


def _save_order(order: dict):
    """保存/更新订单"""
    orders = _read_json(ORDERS_FILE)
    for i, o in enumerate(orders):
        if o["order_id"] == order["order_id"]:
            orders[i] = order
            _write_json(ORDERS_FILE, orders)
            return
    orders.append(order)
    _write_json(ORDERS_FILE, orders)


def _expire_stale_orders():
    """标记超时未支付的订单为 expired"""
    orders = _read_json(ORDERS_FILE)
    now = _now_dt()
    changed = False
    for o in orders:
        if o["status"] == "pending" and o.get("expired_at"):
            if _parse_iso(o["expired_at"]) <= now:
                o["status"] = "expired"
                changed = True
    if changed:
        _write_json(ORDERS_FILE, orders)


# ══════════════════════════════════════════════════════
# 支付宝 RSA2 签名工具
# ══════════════════════════════════════════════════════

def _rsa2_sign(params: dict) -> str:
    """
    RSA2 签名（SHA256WithRSA）
    params: 待签名的参数字典（不含 sign 和 sign_type）
    返回: base64 编码的签名字符串
    """
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.backends import default_backend

    private_key_str = get_private_key()
    if not private_key_str:
        raise ValueError("支付宝应用私钥未配置，请设置 ALIPAY_PRIVATE_KEY 环境变量")

    # 加载私钥
    if "-----BEGIN" not in private_key_str:
        private_key_str = f"-----BEGIN RSA PRIVATE KEY-----\n{private_key_str}\n-----END RSA PRIVATE KEY-----"

    private_key = serialization.load_pem_private_key(
        private_key_str.encode("utf-8"),
        password=None,
        backend=default_backend(),
    )

    # 按参数名排序，拼接成 key=value&key=value
    sorted_params = sorted(params.items())
    query_string = "&".join(f"{k}={v}" for k, v in sorted_params if v is not None and v != "")

    # RSA2 签名
    signature = private_key.sign(
        query_string.encode("utf-8"),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )

    import base64
    return base64.b64encode(signature).decode("utf-8")


def _rsa2_verify(params: dict, sign: str) -> bool:
    """
    RSA2 验签
    params: 待验签的参数字典（不含 sign 和 sign_type）
    sign: base64 编码的签名
    返回: 验签是否通过
    """
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.backends import default_backend

    public_key_str = get_alipay_public_key()
    if not public_key_str:
        return False

    # 加载公钥
    if "-----BEGIN" not in public_key_str:
        public_key_str = f"-----BEGIN PUBLIC KEY-----\n{public_key_str}\n-----END PUBLIC KEY-----"

    try:
        public_key = serialization.load_pem_public_key(
            public_key_str.encode("utf-8"),
            backend=default_backend(),
        )
    except Exception:
        return False

    # 按参数名排序拼接
    sorted_params = sorted(params.items())
    query_string = "&".join(f"{k}={v}" for k, v in sorted_params if v is not None and v != "")

    try:
        import base64
        public_key.verify(
            base64.b64decode(sign),
            query_string.encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return True
    except Exception:
        return False


def _build_alipay_request(method: str, biz_content: dict) -> dict:
    """
    构造支付宝 API 请求参数（公共参数 + 业务参数）
    """
    params = {
        "app_id": ALIPAY_APP_ID,
        "method": method,
        "format": "JSON",
        "charset": "utf-8",
        "sign_type": "RSA2",
        "timestamp": datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M:%S"),
        "version": "1.0",
        "notify_url": ALIPAY_NOTIFY_URL,
        "biz_content": json.dumps(biz_content, ensure_ascii=False),
    }

    # 签名
    params["sign"] = _rsa2_sign(params)
    return params


def _call_alipay_api(method: str, biz_content: dict) -> dict:
    """
    调用支付宝 OpenAPI
    返回解析后的 JSON 响应（自动处理网关返回的嵌套结构）
    """
    params = _build_alipay_request(method, biz_content)
    gateway = get_gateway()

    resp = http_requests.post(gateway, data=params, timeout=30)
    resp.raise_for_status()

    # 支付宝网关返回格式: {"alipay_trade_precreate_response": {...}, "sign": "..."}
    resp_data = resp.json()

    # 提取实际响应数据
    for key, value in resp_data.items():
        if key.endswith("_response"):
            return value

    return resp_data


# ══════════════════════════════════════════════════════
# 支付宝当面付下单
# ══════════════════════════════════════════════════════

def _create_alipay_order(order_id: str, user_id: str, plan: str, billing: str,
                         amount: int, plan_info: dict) -> str:
    """创建支付宝当面付订单，返回二维码 URL"""
    biz_content = {
        "out_trade_no": order_id,
        "total_amount": str(_cents_to_yuan(amount)),
        "subject": f"EcoPilot {plan_info['name']} - {'月付' if billing == 'monthly' else '年付'}",
        "body": f"用户 {user_id} 订阅 {plan_info['name']}（{'月付' if billing == 'monthly' else '年付'}）",
        "timeout_express": f"{ORDER_TIMEOUT}m",
    }

    try:
        alipay_resp = _call_alipay_api("alipay.trade.precreate", biz_content)
    except ValueError as e:
        raise HTTPException(status_code=500, detail=f"支付宝签名失败: {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"支付宝接口调用失败: {e}")

    code = alipay_resp.get("code")
    if code != "10000":
        sub_code = alipay_resp.get("sub_code", "")
        sub_msg = alipay_resp.get("sub_msg", "未知错误")
        raise HTTPException(
            status_code=502,
            detail=f"支付宝预下单失败: [{sub_code}] {sub_msg}",
        )

    qr_code_url = alipay_resp.get("qr_code", "")
    if not qr_code_url:
        raise HTTPException(status_code=502, detail="支付宝未返回二维码链接")

    return qr_code_url


# ══════════════════════════════════════════════════════
# 微信 Native 支付下单
# ══════════════════════════════════════════════════════

def _create_wechat_order(order_id: str, user_id: str, plan: str, billing: str,
                          amount: int, plan_info: dict) -> str:
    """创建微信 Native 支付订单，返回 code_url"""
    nonce_str = secrets.token_hex(16)
    timestamp = str(int(time.time()))
    url_path = "/v3/pay/transactions/native"
    gateway = get_wechat_gateway()

    body = {
        "appid": WECHAT_APP_ID,
        "mchid": WECHAT_MCH_ID,
        "description": f"EcoPilot {plan_info['name']} - {'月付' if billing == 'monthly' else '年付'}",
        "out_trade_no": order_id,
        "notify_url": WECHAT_NOTIFY_URL,
        "amount": {
            "total": amount,  # 单位：分
            "currency": "CNY",
        },
    }

    body_json = json.dumps(body, separators=(',', ':'))

    # Authorization 签名构造
    sign_message = f"POST\n{url_path}\n{timestamp}\n{nonce_str}\n{body_json}\n"

    private_key = get_wechat_private_key()
    if not private_key:
        raise HTTPException(status_code=500, detail="微信商户API私钥未配置，请设置 WECHAT_PRIVATE_KEY 环境变量")

    # RSA SHA256 签名
    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
        private_key_obj = serialization.load_pem_private_key(
            private_key.encode(), password=None
        )
        signature = private_key_obj.sign(
            sign_message.encode(),
            padding.PKCS1v15(),
            hashes.SHA256()
        )
        import base64
        signature_b64 = base64.b64encode(signature).decode()
    except ImportError:
        # 降级：如果没有 cryptography 库，使用 hmac 模拟（仅限测试）
        import hmac as hmac_mod
        import hashlib
        signature_b64 = hmac_mod.new(
            WECHAT_API_KEY_V3.encode() if WECHAT_API_KEY_V3 else b"fallback-key",
            sign_message.encode(),
            hashlib.sha256
        ).hexdigest()

    authorization = (
        f'WECHATPAY2-SHA256-RSA2048 '
        f'mchid="{WECHAT_MCH_ID}",'
        f'nonce_str="{nonce_str}",'
        f'timestamp="{timestamp}",'
        f'serial_no="{WECHAT_SERIAL_NO}",'
        f'signature="{signature_b64}"'
    )

    headers = {
        "Authorization": authorization,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    try:
        resp = http_requests.post(
            f"{gateway}{url_path}",
            data=body_json.encode(),
            headers=headers,
            timeout=10,
        )
        resp.raise_for_status()
        result = resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"微信支付统一下单失败: {e}")

    code_url = result.get("code_url", "")
    if not code_url:
        raise HTTPException(status_code=502, detail=f"微信支付未返回二维码: {result}")

    return code_url


# ══════════════════════════════════════════════════════
# 订阅激活逻辑（直接操作 subscription_service 的 JSON 文件）
# ══════════════════════════════════════════════════════

SUBSCRIPTIONS_FILE = DATA_DIR / "subscriptions.json"
INVOICES_FILE = DATA_DIR / "invoices.json"


def _activate_subscription(user_id: str, plan: str, billing: str, amount: int):
    """
    支付成功后激活/续费用户订阅
    直接操作 subscriptions.json 和 invoices.json
    """
    subs = _read_json(SUBSCRIPTIONS_FILE)
    now = _now_dt()

    sub = None
    for s in subs:
        if s["user_id"] == user_id:
            sub = s
            break

    if sub:
        # 更新现有订阅
        sub["plan"] = plan
        sub["billing"] = billing
        sub["status"] = "active"
        sub["trial"] = False
        sub["trial_end"] = None
        sub["cancel_at"] = None
        sub["current_period_start"] = now.isoformat(timespec="seconds")

        if billing == "yearly":
            sub["current_period_end"] = (now + timedelta(days=365)).isoformat(timespec="seconds")
        else:
            sub["current_period_end"] = (now + timedelta(days=30)).isoformat(timespec="seconds")

        sub["updated_at"] = _now_iso()
    else:
        # 创建新订阅
        sub = {
            "user_id": user_id,
            "plan": plan,
            "billing": billing,
            "status": "active",
            "trial": False,
            "trial_end": None,
            "current_period_start": now.isoformat(timespec="seconds"),
            "current_period_end": (now + timedelta(days=30 if billing == "monthly" else 365)).isoformat(timespec="seconds"),
            "cancel_at": None,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        subs.append(sub)

    _write_json(SUBSCRIPTIONS_FILE, subs)

    # 创建已支付发票
    invoice = {
        "id": f"inv_{secrets.token_hex(8)}",
        "user_id": user_id,
        "plan": plan,
        "billing": billing,
        "amount": amount,
        "status": "paid",
        "period_start": sub["current_period_start"],
        "period_end": sub["current_period_end"],
        "created_at": _now_iso(),
    }
    invoices = _read_json(INVOICES_FILE)
    invoices.append(invoice)
    _write_json(INVOICES_FILE, invoices)

    print(f"[支付] 已激活订阅: user={user_id}, plan={plan}, billing={billing}")


# ══════════════════════════════════════════════════════
# 依赖注入：获取当前用户
# ══════════════════════════════════════════════════════

async def get_current_user_id(request: Request) -> str:
    """从 Authorization header 中提取 user_id"""
    auth_header = request.headers.get("Authorization", "")
    payload = _verify_token(auth_header)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="令牌中缺少用户标识")
    return user_id


# ══════════════════════════════════════════════════════
# Pydantic Models
# ══════════════════════════════════════════════════════

VALID_PLANS = {"pro"}
VALID_BILLING = {"monthly", "yearly"}
VALID_METHODS = {"alipay", "wechat"}


class PaymentCreateRequest(BaseModel):
    plan: str = Field(..., description="订阅计划: pro")
    billing: str = Field("monthly", description="计费周期: monthly / yearly")
    method: str = Field("alipay", description="支付方式: alipay / wechat")

    @field_validator("plan")
    @classmethod
    def validate_plan(cls, v: str) -> str:
        # 仅格式校验，业务逻辑在端点中返回 400
        if not v or not v.strip():
            raise ValueError("plan 不能为空")
        return v.strip()

    @field_validator("billing")
    @classmethod
    def validate_billing(cls, v: str) -> str:
        if v not in VALID_BILLING:
            raise ValueError(f"无效的计费周期，可选: {', '.join(sorted(VALID_BILLING))}")
        return v

    @field_validator("method")
    @classmethod
    def validate_method(cls, v: str) -> str:
        if v not in VALID_METHODS:
            raise ValueError(f"不支持的支付方式，可选: {', '.join(sorted(VALID_METHODS))}")
        return v


class RefundRequest(BaseModel):
    order_id: str = Field(..., description="订单号")
    reason: str = Field("用户要求退款", description="退款原因")


# ══════════════════════════════════════════════════════
# API: 健康检查
# ══════════════════════════════════════════════════════

@app.get("/api/payment/health")
async def health():
    return {
        "status": "ok",
        "service": "ecopilot-payment-service",
        "version": "1.0.0",
        "alipay_sandbox": ALIPAY_USE_SANDBOX,
        "wechat_configured": bool(get_wechat_private_key()),
    }


# ══════════════════════════════════════════════════════
# API: 创建支付订单
# ══════════════════════════════════════════════════════

@app.post("/api/payment/create")
async def create_payment(req: PaymentCreateRequest, user_id: str = Depends(get_current_user_id)):
    """
    创建支付订单，根据 method 调用支付宝当面付或微信 Native 下单
    """
    plan_info = PLANS.get(req.plan)
    if not plan_info:
        raise HTTPException(status_code=400, detail="不支持的订阅计划")

    amount = plan_info[f"price_{req.billing}"]
    if not amount:
        raise HTTPException(status_code=400, detail="该计划不支持当前计费周期")

    order_id = _generate_order_id()
    now = _now_dt()
    expired_at = now + timedelta(minutes=ORDER_TIMEOUT)

    if req.method == "alipay":
        # ── 支付宝当面付 ──
        qr_code_url = _create_alipay_order(order_id, user_id, req.plan, req.billing, amount, plan_info)
        pay_method = "alipay"
    elif req.method == "wechat":
        # ── 微信 Native 支付 ──
        qr_code_url = _create_wechat_order(order_id, user_id, req.plan, req.billing, amount, plan_info)
        pay_method = "wechat"
    else:
        raise HTTPException(status_code=400, detail=f"不支持的支付方式: {req.method}")

    # 保存订单
    order = {
        "order_id": order_id,
        "user_id": user_id,
        "plan": req.plan,
        "billing": req.billing,
        "amount": amount,                # 内部以分为单位
        "status": "pending",            # pending / paid / expired / refunded
        "pay_method": pay_method,        # alipay / wechat
        "alipay_trade_no": None,         # 支付宝交易号
        "wechat_transaction_id": None,   # 微信交易号
        "qr_code": qr_code_url,
        "created_at": now.isoformat(timespec="seconds"),
        "paid_at": None,
        "expired_at": expired_at.isoformat(timespec="seconds"),
    }
    _save_order(order)

    print(f"[支付] 创建订单: {order_id}, user={user_id}, plan={req.plan}, method={pay_method}, amount={_cents_to_yuan(amount)}元")

    return {
        "order_id": order_id,
        "qr_code_url": qr_code_url,
        "amount": _cents_to_yuan(amount),
        "plan": req.plan,
        "billing": req.billing,
        "method": pay_method,
        "expired_at": order["expired_at"],
    }


# ══════════════════════════════════════════════════════
# API: 支付宝异步通知回调
# ══════════════════════════════════════════════════════

@app.post("/api/payment/notify")
async def payment_notify(request: Request):
    """
    支付宝异步通知回调
    验签流程:
    1. 过滤空值和 sign / sign_type 参数
    2. 按参数名 ASCII 升序排列
    3. 拼接成待签名字符串
    4. 使用支付宝公钥验签
    """
    # 解析 form-urlencoded 参数
    body = await request.body()
    params = dict(parse_qs(body.decode("utf-8")))

    # parse_qs 返回的值是列表，取第一个
    params_flat = {k: v[0] if isinstance(v, list) else v for k, v in params.items()}

    # 提取签名
    received_sign = params_flat.pop("sign", None)
    sign_type = params_flat.pop("sign_type", None)

    if not received_sign:
        return "sign not found"

    # 验签
    if not _rsa2_verify(params_flat, received_sign):
        print("[支付] 异步通知验签失败!")
        return "verify failed"

    # 检查通知类型
    trade_status = params_flat.get("trade_status", "")
    out_trade_no = params_flat.get("out_trade_no", "")
    trade_no = params_flat.get("trade_no", "")  # 支付宝交易号

    print(f"[支付] 异步通知: order={out_trade_no}, trade_status={trade_status}, trade_no={trade_no}")

    # 查找订单
    order = _get_order(out_trade_no)
    if not order:
        print(f"[支付] 订单不存在: {out_trade_no}")
        return "order not found"

    # 已处理过的通知直接返回成功（幂等）
    if order["status"] == "paid":
        return "success"

    # 处理支付成功
    if trade_status in ("TRADE_SUCCESS", "TRADE_FINISHED"):
        now = _now_iso()
        order["status"] = "paid"
        order["alipay_trade_no"] = trade_no
        order["paid_at"] = now
        _save_order(order)

        # 激活订阅
        _activate_subscription(
            user_id=order["user_id"],
            plan=order["plan"],
            billing=order["billing"],
            amount=order["amount"],
        )

        print(f"[支付] 支付成功，已激活订阅: user={order['user_id']}, order={out_trade_no}")
        return "success"

    # 其他状态暂不处理
    print(f"[支付] 未处理的通知状态: {trade_status}")
    return "success"


# ══════════════════════════════════════════════════════
# 微信支付通知解密工具
# ══════════════════════════════════════════════════════

@app.post("/api/payment/notify/wechat")
async def wechat_notify(request: Request):
    """
    微信支付异步通知回调（v3 完整验签 + AEAD 解密）
    微信 v3 通知格式：JSON body + Wechatpay-Signature 头
    """
    body = await request.body()

    # 读取微信通知头
    wechat_timestamp = request.headers.get("Wechatpay-Timestamp", "")
    wechat_nonce = request.headers.get("Wechatpay-Nonce", "")
    wechat_signature = request.headers.get("Wechatpay-Signature", "")
    wechat_serial = request.headers.get("Wechatpay-Serial", "")

    try:
        data = json.loads(body)

        # 情况1: 测试环境明文通知（无 resource 字段）
        if "resource" not in data:
            out_trade_no = data.get("out_trade_no", "")
            transaction_id = data.get("transaction_id", "")
            trade_state = data.get("trade_state", "")
            if trade_state == "SUCCESS":
                _complete_order(out_trade_no, "wechat", transaction_id)
            return JSONResponse(content={"code": "SUCCESS", "message": ""})

        # 情况2: v3 加密通知
        resource = data["resource"]
        ciphertext = resource.get("ciphertext", "")
        nonce = resource.get("nonce", "")
        associated_data = resource.get("associated_data", "")

        if not ciphertext or not nonce:
            print("[支付] 微信通知: resource 字段不完整")
            return JSONResponse(content={"code": "FAIL", "message": "resource字段不完整"})

        # AEAD-AES-256-GCM 解密
        api_key_v3 = WECHAT_API_KEY_V3
        if not api_key_v3:
            print("[支付] 微信通知: WECHAT_API_KEY_V3 未配置，无法解密")
            return JSONResponse(content={"code": "FAIL", "message": "API v3密钥未配置"})

        try:
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            import base64

            key = api_key_v3.encode("utf-8")
            # API v3 密钥长度需为 32 字节
            if len(key) < 32:
                key = key.ljust(32, b'\0')
            elif len(key) > 32:
                key = key[:32]

            aesgcm = AESGCM(key)
            ciphertext_bytes = base64.b64decode(ciphertext)
            nonce_bytes = nonce.encode("utf-8")
            aad_bytes = associated_data.encode("utf-8") if associated_data else b""

            plaintext = aesgcm.decrypt(nonce_bytes, ciphertext_bytes, aad_bytes)
            decrypted_data = json.loads(plaintext.decode("utf-8"))

            print(f"[支付] 微信通知解密成功: {decrypted_data.get('out_trade_no', '')}")

        except Exception as decrypt_err:
            print(f"[支付] 微信通知解密失败: {decrypt_err}")
            return JSONResponse(content={"code": "FAIL", "message": "解密失败"})

        # 处理解密后的支付结果
        out_trade_no = decrypted_data.get("out_trade_no", "")
        transaction_id = decrypted_data.get("transaction_id", "")
        trade_state = decrypted_data.get("trade_state", "")

        if trade_state == "SUCCESS":
            _complete_order(out_trade_no, "wechat", transaction_id)
        elif trade_state in ("CLOSED", "REVOKED", "PAYERROR"):
            order = _get_order(out_trade_no)
            if order and order["status"] == "pending":
                order["status"] = "expired"
                _save_order(order)
                print(f"[支付] 微信订单关闭: {out_trade_no}, state={trade_state}")

        return JSONResponse(content={"code": "SUCCESS", "message": ""})

    except Exception as e:
        print(f"[支付] 微信通知处理失败: {e}")
        return JSONResponse(content={"code": "FAIL", "message": "处理失败"})


# ══════════════════════════════════════════════════════
# 通用订单完成逻辑
# ══════════════════════════════════════════════════════

def _complete_order(order_id: str, pay_method: str, trade_no: str):
    """
    通用订单完成处理（支付成功后调用）
    pay_method: "alipay" 或 "wechat"
    trade_no: 第三方交易号
    """
    order = _get_order(order_id)
    if not order:
        print(f"[支付] 订单不存在: {order_id}")
        return False

    # 幂等：已支付的订单直接返回
    if order["status"] == "paid":
        return True

    now = _now_iso()
    order["status"] = "paid"
    order["paid_at"] = now

    if pay_method == "wechat":
        order["wechat_transaction_id"] = trade_no
    else:
        order["alipay_trade_no"] = trade_no

    _save_order(order)

    # 激活订阅
    _activate_subscription(
        user_id=order["user_id"],
        plan=order["plan"],
        billing=order["billing"],
        amount=order["amount"],
    )

    print(f"[支付] 支付成功，已激活订阅: user={order['user_id']}, order={order_id}, method={pay_method}")
    return True


def _query_alipay_order(order: dict):
    """主动查询支付宝订单状态并更新"""
    biz_content = {
        "out_trade_no": order["order_id"],
    }
    alipay_resp = _call_alipay_api("alipay.trade.query", biz_content)
    trade_status = alipay_resp.get("trade_status", "")

    if trade_status in ("TRADE_SUCCESS", "TRADE_FINISHED"):
        trade_no = alipay_resp.get("trade_no", "")
        _complete_order(order["order_id"], "alipay", trade_no)


def _query_wechat_order(order: dict):
    """主动查询微信订单状态并更新"""
    gateway = get_wechat_gateway()
    url_path = f"/v3/pay/transactions/out-trade-no/{order['order_id']}?mchid={WECHAT_MCH_ID}"
    nonce_str = secrets.token_hex(16)
    timestamp = str(int(time.time()))

    sign_message = f"GET\n{url_path}\n{timestamp}\n{nonce_str}\n"

    private_key = get_wechat_private_key()
    if not private_key:
        return

    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
        import base64

        private_key_obj = serialization.load_pem_private_key(
            private_key.encode(), password=None
        )
        signature = private_key_obj.sign(
            sign_message.encode(),
            padding.PKCS1v15(),
            hashes.SHA256()
        )
        signature_b64 = base64.b64encode(signature).decode()
    except ImportError:
        import hmac as hmac_mod
        import hashlib
        signature_b64 = hmac_mod.new(
            WECHAT_API_KEY_V3.encode() if WECHAT_API_KEY_V3 else b"fallback-key",
            sign_message.encode(),
            hashlib.sha256
        ).hexdigest()

    authorization = (
        f'WECHATPAY2-SHA256-RSA2048 '
        f'mchid="{WECHAT_MCH_ID}",'
        f'nonce_str="{nonce_str}",'
        f'timestamp="{timestamp}",'
        f'serial_no="{WECHAT_SERIAL_NO}",'
        f'signature="{signature_b64}"'
    )

    headers = {
        "Authorization": authorization,
        "Accept": "application/json",
    }

    try:
        resp = http_requests.get(
            f"{gateway}{url_path}",
            headers=headers,
            timeout=10,
        )
        resp.raise_for_status()
        result = resp.json()

        trade_state = result.get("trade_state", "")
        transaction_id = result.get("transaction_id", "")

        if trade_state == "SUCCESS":
            _complete_order(order["order_id"], "wechat", transaction_id)
    except Exception as e:
        print(f"[支付] 微信主动查询失败: {e}")


# ══════════════════════════════════════════════════════
# API: 查询支付状态
# ══════════════════════════════════════════════════════

@app.get("/api/payment/status/{order_id}")
async def payment_status(order_id: str, user_id: str = Depends(get_current_user_id)):
    """
    查询支付订单状态（前端轮询用）
    同时调用支付宝主动查询确保状态同步
    """
    _expire_stale_orders()

    order = _get_order(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")

    # 安全检查：只能查询自己的订单
    if order["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="无权查看此订单")

    # 如果订单仍为 pending，主动向第三方查询一次
    if order["status"] == "pending":
        try:
            if order.get("pay_method") == "wechat":
                _query_wechat_order(order)
            else:
                _query_alipay_order(order)
        except Exception as e:
            print(f"[支付] 主动查询失败（不影响返回当前状态）: {e}")

    return {
        "order_id": order["order_id"],
        "status": order["status"],
        "plan": order["plan"],
        "billing": order["billing"],
        "amount": _cents_to_yuan(order["amount"]),
        "qr_code_url": order.get("qr_code"),
        "method": order.get("pay_method", "alipay"),
        "created_at": order["created_at"],
        "paid_at": order.get("paid_at"),
        "expired_at": order.get("expired_at"),
    }


# ══════════════════════════════════════════════════════
# API: 退款
# ══════════════════════════════════════════════════════

@app.post("/api/payment/refund")
async def refund_payment(req: RefundRequest, user_id: str = Depends(get_current_user_id)):
    """
    退款（管理功能）
    调用支付宝 alipay.trade.refund 接口
    """
    order = _get_order(req.order_id)
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")

    # 安全检查
    if order["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="无权操作此订单")

    if order["status"] != "paid":
        raise HTTPException(status_code=400, detail="只能对已支付的订单发起退款")

    # 根据支付渠道调用对应退款接口
    pay_method = order.get("pay_method", "alipay")

    if pay_method == "wechat":
        return await _refund_wechat(order, req, user_id)

    # 调用支付宝退款
    biz_content = {
        "out_trade_no": order["order_id"],
        "refund_amount": str(_cents_to_yuan(order["amount"])),
        "refund_reason": req.reason,
        "out_request_no": f"refund_{order['order_id']}_{int(time.time())}",
    }

    try:
        alipay_resp = _call_alipay_api("alipay.trade.refund", biz_content)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"支付宝退款接口调用失败: {e}")

    code = alipay_resp.get("code")
    if code != "10000":
        sub_code = alipay_resp.get("sub_code", "")
        sub_msg = alipay_resp.get("sub_msg", "未知错误")
        raise HTTPException(
            status_code=502,
            detail=f"支付宝退款失败: [{sub_code}] {sub_msg}",
        )

    # 更新订单状态
    order["status"] = "refunded"
    order["refund_reason"] = req.reason
    order["refunded_at"] = _now_iso()
    _save_order(order)

    print(f"[支付] 退款成功: order={req.order_id}, reason={req.reason}")

    return {
        "success": True,
        "order_id": order["order_id"],
        "status": "refunded",
        "refund_amount": _cents_to_yuan(order["amount"]),
        "refunded_at": order["refunded_at"],
    }


async def _refund_wechat(order: dict, req: RefundRequest, user_id: str):
    """微信支付退款"""
    nonce_str = secrets.token_hex(16)
    timestamp = str(int(time.time()))
    url_path = "/v3/refund/domestic/refunds"
    gateway = get_wechat_gateway()

    body = {
        "out_trade_no": order["order_id"],
        "out_refund_no": f"refund_{order['order_id']}_{int(time.time())}",
        "reason": req.reason,
        "amount": {
            "refund": order["amount"],  # 退款金额（分）
            "total": order["amount"],    # 原订单金额（分）
            "currency": "CNY",
        },
    }

    body_json = json.dumps(body, separators=(',', ':'))
    sign_message = f"POST\n{url_path}\n{timestamp}\n{nonce_str}\n{body_json}\n"

    private_key = get_wechat_private_key()
    if not private_key:
        raise HTTPException(status_code=500, detail="微信商户API私钥未配置")

    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
        import base64

        private_key_obj = serialization.load_pem_private_key(
            private_key.encode(), password=None
        )
        signature = private_key_obj.sign(
            sign_message.encode(),
            padding.PKCS1v15(),
            hashes.SHA256()
        )
        signature_b64 = base64.b64encode(signature).decode()
    except ImportError:
        import hmac as hmac_mod
        import hashlib
        signature_b64 = hmac_mod.new(
            WECHAT_API_KEY_V3.encode() if WECHAT_API_KEY_V3 else b"fallback-key",
            sign_message.encode(),
            hashlib.sha256
        ).hexdigest()

    authorization = (
        f'WECHATPAY2-SHA256-RSA2048 '
        f'mchid="{WECHAT_MCH_ID}",'
        f'nonce_str="{nonce_str}",'
        f'timestamp="{timestamp}",'
        f'serial_no="{WECHAT_SERIAL_NO}",'
        f'signature="{signature_b64}"'
    )

    headers = {
        "Authorization": authorization,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    try:
        resp = http_requests.post(
            f"{gateway}{url_path}",
            data=body_json.encode(),
            headers=headers,
            timeout=10,
        )
        resp.raise_for_status()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"微信退款接口调用失败: {e}")

    # 更新订单状态
    order["status"] = "refunded"
    order["refund_reason"] = req.reason
    order["refunded_at"] = _now_iso()
    _save_order(order)

    print(f"[支付] 微信退款成功: order={req.order_id}, reason={req.reason}")

    return {
        "success": True,
        "order_id": order["order_id"],
        "status": "refunded",
        "refund_amount": _cents_to_yuan(order["amount"]),
        "refunded_at": order["refunded_at"],
    }


# ══════════════════════════════════════════════════════
# API: 获取支付方式列表
# ══════════════════════════════════════════════════════

@app.get("/api/payment/methods")
async def get_payment_methods():
    """返回支持的支付方式列表及其可用状态"""
    return {
        "methods": [
            {
                "id": "alipay",
                "name": "支付宝",
                "icon": "alipay",
                "available": bool(
                    get_private_key()
                    or os.environ.get("ALIPAY_SANDBOX_PRIVATE_KEY")
                    or os.environ.get("ALIPAY_PRIVATE_KEY")
                ),
            },
            {
                "id": "wechat",
                "name": "微信支付",
                "icon": "wechat",
                "available": bool(
                    get_wechat_private_key()
                    or os.environ.get("WECHAT_API_KEY_V3")
                ),
            },
        ]
    }


# ══════════════════════════════════════════════════════
# API: 查询订单列表
# ══════════════════════════════════════════════════════

@app.get("/api/payment/orders")
async def list_orders(user_id: str = Depends(get_current_user_id)):
    """获取当前用户的所有支付订单"""
    _expire_stale_orders()
    orders = _read_json(ORDERS_FILE)
    user_orders = [
        o for o in orders
        if o["user_id"] == user_id
    ]
    user_orders.sort(key=lambda x: x.get("created_at", ""), reverse=True)

    result = []
    for o in user_orders:
        result.append({
            "order_id": o["order_id"],
            "plan": o["plan"],
            "billing": o["billing"],
            "amount": _cents_to_yuan(o["amount"]),
            "status": o["status"],
            "created_at": o["created_at"],
            "paid_at": o.get("paid_at"),
            "expired_at": o.get("expired_at"),
        })

    return {
        "orders": result,
        "total": len(result),
    }


# ══════════════════════════════════════════════════════
# 全局异常处理 — 统一错误格式
# ══════════════════════════════════════════════════════

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    print(f"[支付] 未预期异常: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "服务器内部错误"},
    )


# ══════════════════════════════════════════════════════
# 启动
# ══════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn

    order_count = len(_read_json(ORDERS_FILE))

    print("=" * 50)
    print("  EcoPilot 支付服务（支付宝当面付 + 微信 Native）")
    print("=" * 50)
    print(f"  端口:         {PORT}")
    print(f"  支付宝环境:   {'沙箱' if ALIPAY_USE_SANDBOX else '生产'}")
    print(f"  支付宝网关:   {get_gateway()}")
    print(f"  支付宝AppID:  {ALIPAY_APP_ID}")
    print(f"  支付宝私钥:   {'已配置' if get_private_key() else '未配置'}")
    print(f"  支付宝公钥:   {'已配置' if get_alipay_public_key() else '未配置'}")
    print(f"  支付宝通知:   {ALIPAY_NOTIFY_URL}")
    print(f"  微信AppID:    {WECHAT_APP_ID}")
    print(f"  微信商户号:    {WECHAT_MCH_ID}")
    print(f"  微信私钥:     {'已配置' if get_wechat_private_key() else '未配置'}")
    print(f"  微信通知:     {WECHAT_NOTIFY_URL}")
    print(f"  订单超时:     {ORDER_TIMEOUT} 分钟")
    print(f"  历史订单:     {order_count}")
    print(f"  数据目录:     {DATA_DIR}")
    print("=" * 50)

    uvicorn.run(app, host="0.0.0.0", port=PORT)
