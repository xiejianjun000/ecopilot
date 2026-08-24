"""
EcoPilot 订阅服务
- 订阅计划管理（免费/专业/企业）
- 订阅创建、变更、取消、恢复
- 使用量统计与限额检查
- 支付记录管理
- 14天试用期

合并说明: 本文件作为独立服务运行在 8092 端口，与 auth_service.py(:8091)
          和 website_api.py(:8090) 并行部署。如需合并到 website_api.py，
          可将 PLANS/data 路径/routes 导入后挂载到主 app 上：
            from subscription_service import router as sub_router
            app.include_router(sub_router, prefix="")

启动: python3 subscription_service.py
端口: 8092
"""

import json
import logging
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import jwt
from fastapi import FastAPI, HTTPException, Request, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

# ── 日志 ──────────────────────────────────────────────
logger = logging.getLogger("ecopilot.subscription")
logger.setLevel(logging.DEBUG)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter(
        "[%(asctime)s] %(levelname)s %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    ))
    logger.addHandler(_handler)

# ── 配置 ──────────────────────────────────────────────
# JWT_SECRET: 与 auth_service 共享同一密钥文件，确保 Token 跨服务有效。
_default_secret_file = Path(__file__).parent / "data" / ".jwt_secret"
_default_secret_file.parent.mkdir(parents=True, exist_ok=True)
if _default_secret_file.exists():
    _DEFAULT_SECRET = _default_secret_file.read_text().strip()
else:
    _DEFAULT_SECRET = secrets.token_hex(32)
    _default_secret_file.write_text(_DEFAULT_SECRET)
JWT_SECRET = os.environ.get("JWT_SECRET", _DEFAULT_SECRET)
JWT_ALGORITHM = "HS256"
TRIAL_DAYS = 14
PORT = 8092

# 服务间内部鉴权 Key（auth_service 回调时使用）
INTERNAL_API_KEY = os.environ.get("ECO_INTERNAL_API_KEY", "eco-internal-dev-key-change-in-production")

# ── 数据目录 ──────────────────────────────────────────
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
SUBSCRIPTIONS_FILE = DATA_DIR / "subscriptions.json"
INVOICES_FILE = DATA_DIR / "invoices.json"
USAGE_DAILY_FILE = DATA_DIR / "usage_daily.json"

# ── 订阅计划定义 ──────────────────────────────────────
PLANS = {
    "free": {
        "name": "基础版",
        "price_monthly": 0,
        "price_yearly": 0,
        "features": [
            "法典基础查询（每日20次）",
            "AI合规咨询（每日10次）",
            "单一企业管理",
            "基础排污许可证自查",
            "社区支持",
            "Web端使用",
            "基础行业指南",
            "CSV数据导出",
        ],
        "limits": {"daily_queries": 20, "daily_ai": 10, "max_enterprises": 1, "api_calls": 0},
    },
    "pro": {
        "name": "专业版",
        "price_monthly": 29900,   # 单位：分（¥299.00）
        "price_yearly": 239000,   # 单位：分（¥2390.00，省20%）
        "features": [
            "无限法典查询",
            "无限AI合规咨询",
            "最多5个企业管理",
            "排污许可证全流程辅助",
            "执行报告自动生成",
            "台账自动记录模板",
            "监测数据核验",
            "危废管理辅助",
            "环保税核算",
            "优先邮件支持",
            "Web + 桌面端",
            "PDF/Excel数据导出",
            "API接口（每月1000次）",
        ],
        "limits": {"daily_queries": -1, "daily_ai": -1, "max_enterprises": 5, "api_calls": 1000},
    },
    "enterprise": {
        "name": "企业版",
        "price_monthly": 0,
        "price_yearly": 0,
        "features": [
            "无限企业管理",
            "多Agent协作",
            "专属行业定制",
            "私有化部署支持",
            "对接企业现有系统",
            "专属技术支持（7x12h）",
            "SLA保障（99.9%）",
            "定期合规报告",
            "法规更新即时推送",
            "企业知识库定制",
            "API不限量",
            "培训服务",
        ],
        "limits": {"daily_queries": -1, "daily_ai": -1, "max_enterprises": -1, "api_calls": -1},
    },
}


# ══════════════════════════════════════════════════════
# FastAPI 应用
# ══════════════════════════════════════════════════════

app = FastAPI(title="EcoPilot Subscription Service", version="1.0.0")

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


def _today_str() -> str:
    """今日日期字符串 YYYY-MM-DD"""
    return datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d")


def _parse_iso(iso_str: str) -> datetime:
    """解析 ISO 8601 字符串为 datetime（UTC+8）"""
    return datetime.fromisoformat(iso_str)


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


def _get_subscription(user_id: str) -> Optional[dict]:
    """获取用户订阅记录"""
    subs = _read_json(SUBSCRIPTIONS_FILE)
    for s in subs:
        if s["user_id"] == user_id:
            return s
    return None


def _save_subscription(sub: dict):
    """保存/更新订阅记录"""
    subs = _read_json(SUBSCRIPTIONS_FILE)
    for i, s in enumerate(subs):
        if s["user_id"] == sub["user_id"]:
            sub["updated_at"] = _now_iso()
            subs[i] = sub
            _write_json(SUBSCRIPTIONS_FILE, subs)
            return
    # 新记录
    sub["created_at"] = _now_iso()
    sub["updated_at"] = _now_iso()
    subs.append(sub)
    _write_json(SUBSCRIPTIONS_FILE, subs)


def _get_or_create_free_subscription(user_id: str) -> dict:
    """获取订阅；不存在则自动创建 free 订阅"""
    sub = _get_subscription(user_id)
    if sub:
        # 检查试用是否到期
        if sub.get("trial") and sub.get("trial_end"):
            trial_end_dt = _parse_iso(sub["trial_end"])
            now_dt = datetime.now(timezone(timedelta(hours=8)))
            if now_dt >= trial_end_dt and sub["status"] == "trialing":
                sub["status"] = "active"
                sub["trial"] = False
                _save_subscription(sub)
        return sub

    # 创建默认 free 订阅
    now_dt = datetime.now(timezone(timedelta(hours=8)))
    period_start = now_dt.replace(hour=0, minute=0, second=0, microsecond=0).isoformat(timespec="seconds")
    period_end_dt = now_dt.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    period_end = period_end_dt.isoformat(timespec="seconds")

    free_sub = {
        "user_id": user_id,
        "plan": "free",
        "billing": "monthly",
        "status": "active",
        "trial": False,
        "trial_end": None,
        "current_period_start": period_start,
        "current_period_end": period_end,
        "cancel_at": None,
    }
    _save_subscription(free_sub)
    return free_sub


def _get_daily_usage(user_id: str) -> dict:
    """获取用户当日使用量"""
    today = _today_str()
    usage_list = _read_json(USAGE_DAILY_FILE)
    for u in usage_list:
        if u["date"] == today and u["user_id"] == user_id:
            return u
    return {"date": today, "user_id": user_id, "queries": 0, "ai_calls": 0, "api_calls": 0}


def _save_daily_usage(usage: dict):
    """保存/更新当日使用量"""
    usage_list = _read_json(USAGE_DAILY_FILE)
    for i, u in enumerate(usage_list):
        if u["date"] == usage["date"] and u["user_id"] == usage["user_id"]:
            usage_list[i] = usage
            _write_json(USAGE_DAILY_FILE, usage_list)
            return
    usage_list.append(usage)
    _write_json(USAGE_DAILY_FILE, usage_list)


def _create_invoice(user_id: str, plan: str, billing: str, amount: int,
                     period_start: str, period_end: str, status: str = "pending") -> dict:
    """创建支付记录"""
    invoice = {
        "id": f"inv_{secrets.token_hex(8)}",
        "user_id": user_id,
        "plan": plan,
        "billing": billing,
        "amount": amount,              # 内部以分为单位
        "status": status,              # pending / paid / failed / refunded
        "period_start": period_start,
        "period_end": period_end,
        "created_at": _now_iso(),
    }
    invoices = _read_json(INVOICES_FILE)
    invoices.append(invoice)
    _write_json(INVOICES_FILE, invoices)
    return invoice


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

VALID_PLANS = {"free", "pro", "enterprise"}
VALID_BILLING = {"monthly", "yearly"}
VALID_USAGE_TYPES = {"query", "ai", "api"}


class SubscribeRequest(BaseModel):
    plan: str = Field(..., description="订阅计划: free / pro / enterprise")
    billing: str = Field("monthly", description="计费周期: monthly / yearly")

    @field_validator("plan")
    @classmethod
    def validate_plan(cls, v: str) -> str:
        if v not in VALID_PLANS:
            raise ValueError(f"无效的订阅计划，可选: {', '.join(sorted(VALID_PLANS))}")
        return v

    @field_validator("billing")
    @classmethod
    def validate_billing(cls, v: str) -> str:
        if v not in VALID_BILLING:
            raise ValueError(f"无效的计费周期，可选: {', '.join(sorted(VALID_BILLING))}")
        return v


class UsageRequest(BaseModel):
    type: str = Field(..., description="使用类型: query / ai / api")

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in VALID_USAGE_TYPES:
            raise ValueError(f"无效的使用类型，可选: {', '.join(sorted(VALID_USAGE_TYPES))}")
        return v


class CreateFreeSubscriptionRequest(BaseModel):
    """auth_service 回调时使用的内部模型（不需要 Bearer Token）"""
    user_id: str = Field(..., min_length=3, description="用户ID")
    email: str = Field("", description="用户邮箱")
    plan: str = Field("free", description="订阅计划（仅 free）")

    @field_validator("plan")
    @classmethod
    def validate_plan(cls, v: str) -> str:
        if v != "free":
            raise ValueError("内部回调仅支持创建 free 订阅")
        return v


# ══════════════════════════════════════════════════════
# API: 健康检查
# ══════════════════════════════════════════════════════

@app.get("/api/subscription/health")
async def health():
    return {
        "status": "ok",
        "service": "ecopilot-subscription-service",
        "version": "1.0.0",
    }


# ══════════════════════════════════════════════════════
# API: 内部回调 — 注册时自动创建 free 订阅
# ══════════════════════════════════════════════════════

@app.post("/api/subscription/create-free")
async def create_free_subscription(
    req: CreateFreeSubscriptionRequest,
    x_internal_key: str = Header(..., alias="x-internal-key"),
):
    """内部端点：auth_service 注册成功后自动调用，创建 free 订阅。
    不需要 Bearer Token，用 x-internal-key header 鉴权。"""
    # 鉴权
    if x_internal_key != INTERNAL_API_KEY:
        logger.warning("create-free 鉴权失败: 无效的 internal key")
        raise HTTPException(status_code=403, detail="无权访问内部端点")

    # 检查是否已存在订阅（幂等性）
    existing = _get_subscription(req.user_id)
    if existing:
        logger.info("订阅已存在(幂等): user_id=%s plan=%s", req.user_id, existing["plan"])
        return {
            "success": True,
            "message": "订阅已存在",
            "subscription_id": existing.get("user_id"),
            "plan": existing["plan"],
            "status": existing["status"],
            "created_at": existing.get("created_at"),
        }

    # 创建 free 订阅
    sub = _get_or_create_free_subscription(req.user_id)
    logger.info("自动创建订阅: user_id=%s email=%s plan=%s", req.user_id, req.email, sub["plan"])
    return {
        "success": True,
        "message": "订阅创建成功",
        "subscription_id": req.user_id,
        "plan": sub["plan"],
        "status": sub["status"],
        "created_at": sub.get("created_at"),
    }


# ══════════════════════════════════════════════════════
# API: 获取所有计划
# ══════════════════════════════════════════════════════

@app.get("/api/subscription/plans")
async def get_plans():
    """获取所有订阅计划（价格以元为单位返回）"""
    plans_out = {}
    for key, plan in PLANS.items():
        plans_out[key] = {
            "name": plan["name"],
            "price_monthly": _cents_to_yuan(plan["price_monthly"]) if plan["price_monthly"] or key != "enterprise" else None,
            "price_yearly": _cents_to_yuan(plan["price_yearly"]) if plan["price_yearly"] or key != "enterprise" else None,
            "features": plan["features"],
        }
        # enterprise 价格返回 null
        if key == "enterprise":
            plans_out[key]["price_monthly"] = None
            plans_out[key]["price_yearly"] = None
    return {"plans": plans_out}


def _cents_to_yuan(cents: int) -> float:
    """分转元"""
    return round(cents / 100, 2)


# ══════════════════════════════════════════════════════
# API: 获取当前订阅
# ══════════════════════════════════════════════════════

@app.get("/api/subscription/current")
async def get_current_subscription(user_id: str = Depends(get_current_user_id)):
    """获取当前用户的订阅状态和使用量"""
    sub = _get_or_create_free_subscription(user_id)
    plan_info = PLANS[sub["plan"]]
    usage = _get_daily_usage(user_id)

    return {
        "plan": sub["plan"],
        "plan_name": plan_info["name"],
        "billing": sub["billing"],
        "status": sub["status"],
        "current_period_start": sub["current_period_start"],
        "current_period_end": sub["current_period_end"],
        "cancel_at": sub.get("cancel_at"),
        "usage": {
            "daily_queries_used": usage.get("queries", 0),
            "daily_ai_used": usage.get("ai_calls", 0),
            "api_calls_used": usage.get("api_calls", 0),
            "max_enterprises": plan_info["limits"]["max_enterprises"],
            "enterprises_count": 0,  # TODO: 从企业管理服务获取实际数量
        },
    }


# ══════════════════════════════════════════════════════
# API: 创建/变更订阅
# ══════════════════════════════════════════════════════

@app.post("/api/subscription/subscribe")
async def subscribe(req: SubscribeRequest, user_id: str = Depends(get_current_user_id)):
    """创建或变更订阅"""
    sub = _get_or_create_free_subscription(user_id)
    current_plan = sub["plan"]
    target_plan = req.plan
    target_billing = req.billing

    # enterprise: 返回联系销售信息
    if target_plan == "enterprise":
        return {
            "success": False,
            "message": "企业版需联系销售团队定制方案，请联系: sales@ecopilot.cn",
            "contact": "sales@ecopilot.cn",
        }

    now_dt = datetime.now(timezone(timedelta(hours=8)))

    # ── 从 free 升级到 pro ──
    if current_plan == "free" and target_plan == "pro":
        trial_end_dt = now_dt + timedelta(days=TRIAL_DAYS)
        period_start = now_dt.replace(hour=0, minute=0, second=0, microsecond=0).isoformat(timespec="seconds")
        period_end_dt = now_dt.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=30)

        sub["plan"] = "pro"
        sub["billing"] = target_billing
        sub["status"] = "trialing"
        sub["trial"] = True
        sub["trial_end"] = trial_end_dt.isoformat(timespec="seconds")
        sub["current_period_start"] = period_start
        sub["current_period_end"] = period_end_dt.isoformat(timespec="seconds")
        sub["cancel_at"] = None
        _save_subscription(sub)

        # 创建试用发票
        _create_invoice(user_id, "pro", target_billing, 0,
                        period_start, sub["current_period_end"], status="trial")

        plan_info = PLANS["pro"]
        return {
            "success": True,
            "subscription": {
                "plan": "pro",
                "plan_name": plan_info["name"],
                "billing": target_billing,
                "status": "trialing",
                "trial": True,
                "trial_end": sub["trial_end"],
                "current_period_end": sub["current_period_end"],
            },
        }

    # ── pro 变更计费周期 ──
    if current_plan == "pro" and target_plan == "pro":
        if sub["billing"] != target_billing:
            sub["billing"] = target_billing
            sub["current_period_start"] = now_dt.isoformat(timespec="seconds")

            if target_billing == "yearly":
                period_end_dt = now_dt + timedelta(days=365)
            else:
                period_end_dt = now_dt + timedelta(days=30)

            sub["current_period_end"] = period_end_dt.isoformat(timespec="seconds")

            if sub.get("cancel_at"):
                sub["cancel_at"] = None

            _save_subscription(sub)

            # 创建变更发票
            amount = PLANS["pro"][f"price_{target_billing}"]
            _create_invoice(user_id, "pro", target_billing, amount,
                            sub["current_period_start"], sub["current_period_end"])

            plan_info = PLANS["pro"]
            return {
                "success": True,
                "message": f"计费周期已变更为{('年付' if target_billing == 'yearly' else '月付')}",
                "subscription": {
                    "plan": "pro",
                    "plan_name": plan_info["name"],
                    "billing": target_billing,
                    "status": sub["status"],
                    "trial": sub.get("trial", False),
                    "trial_end": sub.get("trial_end"),
                    "current_period_end": sub["current_period_end"],
                },
            }
        else:
            raise HTTPException(status_code=400, detail="当前已是该计费周期，无需变更")

    # ── pro 降级到 free（期末生效） ──
    if current_plan == "pro" and target_plan == "free":
        sub["cancel_at"] = sub["current_period_end"]
        _save_subscription(sub)

        plan_info = PLANS["pro"]
        return {
            "success": True,
            "message": "已提交降级申请，当前周期结束（" + sub["current_period_end"] + "）后生效为基础版",
            "subscription": {
                "plan": "pro",
                "plan_name": plan_info["name"],
                "billing": sub["billing"],
                "status": sub["status"],
                "trial": sub.get("trial", False),
                "trial_end": sub.get("trial_end"),
                "current_period_end": sub["current_period_end"],
                "cancel_at": sub["cancel_at"],
            },
        }

    # ── 已经是 free，无需变更 ──
    if current_plan == "free" and target_plan == "free":
        raise HTTPException(status_code=400, detail="当前已是基础版")

    raise HTTPException(status_code=400, detail="不支持的订阅变更")


# ══════════════════════════════════════════════════════
# API: 取消订阅
# ══════════════════════════════════════════════════════

@app.post("/api/subscription/cancel")
async def cancel_subscription(user_id: str = Depends(get_current_user_id)):
    """取消订阅（当前周期结束前仍可使用）"""
    sub = _get_or_create_free_subscription(user_id)

    if sub["plan"] == "free":
        raise HTTPException(status_code=400, detail="基础版订阅无需取消")

    if sub.get("cancel_at"):
        raise HTTPException(status_code=400, detail="订阅已处于取消状态")

    sub["cancel_at"] = sub["current_period_end"]
    _save_subscription(sub)

    plan_info = PLANS[sub["plan"]]
    return {
        "success": True,
        "message": "订阅已取消，您可在当前周期结束前继续使用所有功能",
        "subscription": {
            "plan": sub["plan"],
            "plan_name": plan_info["name"],
            "status": sub["status"],
            "cancel_at": sub["cancel_at"],
            "current_period_end": sub["current_period_end"],
        },
    }


# ══════════════════════════════════════════════════════
# API: 恢复订阅
# ══════════════════════════════════════════════════════

@app.post("/api/subscription/resume")
async def resume_subscription(user_id: str = Depends(get_current_user_id)):
    """恢复已取消的订阅"""
    sub = _get_or_create_free_subscription(user_id)

    if sub["plan"] == "free":
        raise HTTPException(status_code=400, detail="基础版订阅无需恢复")

    if not sub.get("cancel_at"):
        raise HTTPException(status_code=400, detail="当前订阅未被取消")

    sub["cancel_at"] = None
    _save_subscription(sub)

    plan_info = PLANS[sub["plan"]]
    return {
        "success": True,
        "message": "订阅已恢复",
        "subscription": {
            "plan": sub["plan"],
            "plan_name": plan_info["name"],
            "status": sub["status"],
            "current_period_end": sub["current_period_end"],
        },
    }


# ══════════════════════════════════════════════════════
# API: 使用量统计
# ══════════════════════════════════════════════════════

@app.post("/api/subscription/usage")
async def record_usage(req: UsageRequest, user_id: str = Depends(get_current_user_id)):
    """记录一次使用并返回剩余额度"""
    sub = _get_or_create_free_subscription(user_id)
    plan_info = PLANS[sub["plan"]]
    limits = plan_info["limits"]
    usage = _get_daily_usage(user_id)

    # 确定限额和使用字段
    usage_field_map = {
        "query": ("queries", "daily_queries"),
        "ai": ("ai_calls", "daily_ai"),
        "api": ("api_calls", "api_calls"),
    }

    usage_field, limit_key = usage_field_map[req.type]
    limit = limits[limit_key]

    # -1 表示无限
    if limit != -1:
        current = usage.get(usage_field, 0)
        if current >= limit:
            raise HTTPException(
                status_code=429,
                detail=f"已达到今日{req.type}使用上限（{limit}次），请明天再试或升级到专业版",
            )

    # 递增使用量
    usage[usage_field] = usage.get(usage_field, 0) + 1
    _save_daily_usage(usage)

    # 计算剩余
    if limit == -1:
        remaining = -1  # 无限
    else:
        remaining = limit - usage.get(usage_field, 0)

    return {
        "success": True,
        "type": req.type,
        "used": usage[usage_field],
        "remaining": remaining,
        "limit": limit if limit != -1 else "unlimited",
        "plan": sub["plan"],
        "billing_cycle_end": sub["current_period_end"],
    }


# ══════════════════════════════════════════════════════
# API: 支付记录
# ══════════════════════════════════════════════════════

@app.get("/api/subscription/invoices")
async def get_invoices(user_id: str = Depends(get_current_user_id)):
    """获取用户的历史支付记录"""
    invoices = _read_json(INVOICES_FILE)
    user_invoices = [
        inv for inv in invoices
        if inv["user_id"] == user_id
    ]

    # 按创建时间倒序
    user_invoices.sort(key=lambda x: x.get("created_at", ""), reverse=True)

    # 转换金额为元
    result = []
    for inv in user_invoices:
        result.append({
            "id": inv["id"],
            "plan": inv["plan"],
            "plan_name": PLANS.get(inv["plan"], {}).get("name", inv["plan"]),
            "billing": inv["billing"],
            "amount": _cents_to_yuan(inv["amount"]) if inv["amount"] else 0,
            "status": inv["status"],
            "period_start": inv["period_start"],
            "period_end": inv["period_end"],
            "created_at": inv["created_at"],
        })

    return {
        "invoices": result,
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
    return JSONResponse(
        status_code=500,
        content={"detail": "服务器内部错误"},
    )


# ══════════════════════════════════════════════════════
# 启动
# ══════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn

    is_custom_secret = bool(os.environ.get("JWT_SECRET"))
    sub_count = len(_read_json(SUBSCRIPTIONS_FILE))
    invoice_count = len(_read_json(INVOICES_FILE))

    print("=" * 50)
    print("  EcoPilot 订阅服务")
    print("=" * 50)
    print(f"  端口:         {PORT}")
    print(f"  JWT 密钥:     {'自定义配置' if is_custom_secret else '自动生成（重启后失效）'}")
    print(f"  JWT 算法:     {JWT_ALGORITHM}")
    print(f"  试用天数:     {TRIAL_DAYS} 天")
    print(f"  订阅用户:     {sub_count}")
    print(f"  支付记录:     {invoice_count}")
    print(f"  数据目录:     {DATA_DIR}")
    print(f"  环境:         {os.environ.get('ECOPILOT_ENV', 'development')}")
    print("=" * 50)

    uvicorn.run(app, host="0.0.0.0", port=PORT)
