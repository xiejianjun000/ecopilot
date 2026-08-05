"""
EcoPilot 网站管理后台 API
提供网站数据统计、联系人管理、用户管理、内容配置、系统设置等能力

启动: python3 hermes_admin_api.py
端口: 8094
"""

import json
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import jwt

# ══════════════════════════════════════════════════════
# 配置
# ══════════════════════════════════════════════════════

_default_secret_file = Path(__file__).parent / "data" / ".jwt_secret"
if _default_secret_file.exists():
    JWT_SECRET = _default_secret_file.read_text().strip()
else:
    JWT_SECRET = os.environ.get("JWT_SECRET", secrets.token_hex(32))
    _default_secret_file.parent.mkdir(parents=True, exist_ok=True)
    _default_secret_file.write_text(JWT_SECRET)
JWT_ALGORITHM = "HS256"

# 数据目录
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

CONTACTS_FILE = DATA_DIR / "contacts.json"
VISITS_FILE = DATA_DIR / "visits.json"
USERS_FILE = DATA_DIR / "test_users.json"
DOWNLOADS_FILE = DATA_DIR / "downloads.json"
CONTENT_CONFIG_FILE = DATA_DIR / "content_config.json"
ADMIN_SETTINGS_FILE = DATA_DIR / "admin_settings.json"

# ══════════════════════════════════════════════════════
# FastAPI 应用
# ══════════════════════════════════════════════════════

app = FastAPI(title="EcoPilot Website Admin API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 启动时间
_START_TIME = time.time()

# ══════════════════════════════════════════════════════
# 辅助函数
# ══════════════════════════════════════════════════════


def _read_json(path, default=None):
    if default is None:
        default = []
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return default
    return default


def _write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _now():
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


def _today_str():
    return datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d")


def _verify_token(authorization: str) -> dict:
    """验证 JWT Token"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未提供认证令牌")
    try:
        return jwt.decode(authorization[7:], JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="令牌已过期")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="无效的令牌")


def _get_current_user(request: Request) -> dict:
    """FastAPI 依赖注入：当前用户"""
    authorization = request.headers.get("Authorization", "")
    return _verify_token(authorization)


def _uptime_seconds() -> int:
    return int(time.time() - _START_TIME)


def _read_contacts() -> list:
    return _read_json(CONTACTS_FILE, [])


def _write_contacts(contacts: list):
    _write_json(CONTACTS_FILE, contacts)


def _read_visits() -> list:
    return _read_json(VISITS_FILE, [])


def _read_users() -> list:
    return _read_json(USERS_FILE, [])


def _read_downloads() -> list:
    return _read_json(DOWNLOADS_FILE, [])


def _read_content_config() -> dict:
    default = {
        "announcement": "",
        "pricing_enabled": True,
        "demo_enabled": True,
        "download_links": {"windows": "", "macos": ""},
    }
    return _read_json(CONTENT_CONFIG_FILE, default)


def _write_content_config(config: dict):
    _write_json(CONTENT_CONFIG_FILE, config)


def _read_admin_settings() -> dict:
    default = {}
    return _read_json(ADMIN_SETTINGS_FILE, default)


def _write_admin_settings(settings: dict):
    _write_json(ADMIN_SETTINGS_FILE, settings)


# ══════════════════════════════════════════════════════
# 数据模型
# ══════════════════════════════════════════════════════


class ContactStatusUpdate(BaseModel):
    status: str  # "contacted" | "closed"


class ContentConfigUpdate(BaseModel):
    announcement: Optional[str] = None
    pricing_enabled: Optional[bool] = None
    demo_enabled: Optional[bool] = None
    download_links: Optional[dict] = None


class AdminSettingsUpdate(BaseModel):
    text_model: Optional[str] = None
    vision_model: Optional[str] = None
    env: Optional[str] = None


# ══════════════════════════════════════════════════════
# 1. 统计 & 仪表盘
# ══════════════════════════════════════════════════════


@app.get("/api/admin/health")
async def health_check():
    """健康检查（无需认证）"""
    return {
        "status": "ok",
        "uptime_seconds": _uptime_seconds(),
        "timestamp": _now(),
    }


@app.get("/api/admin/stats")
async def get_stats(user: dict = Depends(_get_current_user)):
    """聚合统计数据"""
    visits = _read_visits()
    contacts = _read_contacts()
    downloads = _read_downloads()
    users = _read_users()

    today = _today_str()
    visits_today = sum(1 for v in visits if v.get("date") == today)
    contacts_pending = sum(1 for c in contacts if c.get("status") == "new")

    return {
        "visits": {
            "total": len(visits),
            "today": visits_today,
        },
        "contacts": {
            "total": len(contacts),
            "pending": contacts_pending,
        },
        "downloads": {
            "total": len(downloads),
        },
        "users": {
            "total": len(users),
        },
        "uptime_seconds": _uptime_seconds(),
    }


# ══════════════════════════════════════════════════════
# 2. 联系人管理
# ══════════════════════════════════════════════════════


@app.get("/api/admin/contacts")
async def list_contacts(
    status: Optional[str] = Query(None, description="筛选状态: new/contacted/closed"),
    search: Optional[str] = Query(None, description="搜索关键词（匹配姓名/邮箱/公司）"),
    user: dict = Depends(_get_current_user),
):
    """获取联系人列表"""
    contacts = _read_contacts()

    if status:
        contacts = [c for c in contacts if c.get("status") == status]

    if search:
        keyword = search.lower()
        contacts = [
            c for c in contacts
            if keyword in str(c.get("name", "")).lower()
            or keyword in str(c.get("email", "")).lower()
            or keyword in str(c.get("company", "")).lower()
        ]

    # 按时间倒序
    contacts.sort(key=lambda x: x.get("created_at", ""), reverse=True)

    return {
        "contacts": contacts,
        "total": len(contacts),
    }


@app.put("/api/admin/contacts/{contact_id}/status")
async def update_contact_status(
    contact_id: str,
    body: ContactStatusUpdate,
    user: dict = Depends(_get_current_user),
):
    """更新联系人状态"""
    if body.status not in ("contacted", "closed"):
        raise HTTPException(status_code=400, detail="状态值无效，仅支持 contacted 或 closed")

    contacts = _read_contacts()

    found = False
    for c in contacts:
        if c.get("id") == contact_id:
            c["status"] = body.status
            c["updated_at"] = _now()
            found = True
            break

    if not found:
        raise HTTPException(status_code=404, detail=f"联系人 '{contact_id}' 不存在")

    _write_contacts(contacts)

    return {"id": contact_id, "status": body.status}


# ══════════════════════════════════════════════════════
# 3. 用户管理
# ══════════════════════════════════════════════════════


@app.get("/api/admin/users")
async def list_users(
    plan: Optional[str] = Query(None, description="筛选套餐: free/pro/enterprise"),
    user: dict = Depends(_get_current_user),
):
    """获取注册用户列表"""
    users = _read_users()

    if plan:
        users = [u for u in users if u.get("plan") == plan]

    # 按注册时间倒序
    users.sort(key=lambda x: x.get("created_at", ""), reverse=True)

    return {
        "users": users,
        "total": len(users),
    }


# ══════════════════════════════════════════════════════
# 4. 内容管理
# ══════════════════════════════════════════════════════


@app.get("/api/admin/content")
async def get_content_config(user: dict = Depends(_get_current_user)):
    """获取网站内容配置"""
    config = _read_content_config()
    return config


@app.put("/api/admin/content")
async def update_content_config(
    body: ContentConfigUpdate,
    user: dict = Depends(_get_current_user),
):
    """更新网站内容配置"""
    config = _read_content_config()

    if body.announcement is not None:
        config["announcement"] = body.announcement
    if body.pricing_enabled is not None:
        config["pricing_enabled"] = body.pricing_enabled
    if body.demo_enabled is not None:
        config["demo_enabled"] = body.demo_enabled
    if body.download_links is not None:
        if "download_links" not in config:
            config["download_links"] = {}
        config["download_links"].update(body.download_links)

    _write_content_config(config)

    return config


# ══════════════════════════════════════════════════════
# 5. 系统设置
# ══════════════════════════════════════════════════════


@app.get("/api/admin/settings")
async def get_settings(user: dict = Depends(_get_current_user)):
    """获取系统设置信息"""
    text_model = os.environ.get("ECOPILOT_TEXT_MODEL", "")
    vision_model = os.environ.get("ECOPILOT_VISION_MODEL", "")
    env = os.environ.get("ECOPILOT_ENV", "production")

    # 检查支付方式配置状态
    payment_methods = {
        "alipay": bool(os.environ.get("ALIPAY_APP_ID")),
        "wechat": bool(os.environ.get("WECHAT_MCH_ID")),
    }

    # 读取持久化的管理员设置
    admin_settings = _read_admin_settings()

    return {
        "ai": {
            "text_model": text_model,
            "vision_model": vision_model,
        },
        "payment": payment_methods,
        "environment": env,
        "uptime_seconds": _uptime_seconds(),
        "custom": admin_settings,
    }


@app.put("/api/admin/settings")
async def update_settings(
    body: AdminSettingsUpdate,
    user: dict = Depends(_get_current_user),
):
    """更新系统设置（持久化到文件）"""
    admin_settings = _read_admin_settings()

    if body.text_model is not None:
        admin_settings["text_model"] = body.text_model
    if body.vision_model is not None:
        admin_settings["vision_model"] = body.vision_model
    if body.env is not None:
        admin_settings["env"] = body.env

    _write_admin_settings(admin_settings)

    return {
        "updated": True,
        "custom": admin_settings,
    }


# ══════════════════════════════════════════════════════
# 异常处理
# ══════════════════════════════════════════════════════


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return {
        "error": exc.detail,
        "status_code": exc.status_code,
    }


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    return {
        "error": "服务器内部错误",
        "detail": str(exc),
        "status_code": 500,
    }


# ══════════════════════════════════════════════════════
# 启动
# ══════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn

    print(f"{'='*60}")
    print(f"  EcoPilot 网站管理后台 API")
    print(f"  端口: 8094")
    print(f"  数据目录: {DATA_DIR}")
    print(f"{'='*60}")

    uvicorn.run(app, host="0.0.0.0", port=8094)
