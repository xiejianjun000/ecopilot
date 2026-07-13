"""
EcoPilot 认证服务
- 用户注册/登录
- JWT Token 管理
- 密码重置
- 登录限流

启动: python3 auth_service.py
端口: 8091
"""

import hashlib
import hmac
import json
import os
import re
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from typing import Optional

import jwt
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import bcrypt as _bcrypt
from pydantic import BaseModel, Field, field_validator

# ── 配置 ──────────────────────────────────────────────
# JWT_SECRET: 多服务共享密钥。生产环境必须通过环境变量设置。
_default_secret_file = Path(__file__).parent / "data" / ".jwt_secret"
_default_secret_file.parent.mkdir(parents=True, exist_ok=True)
if _default_secret_file.exists():
    _DEFAULT_SECRET = _default_secret_file.read_text().strip()
else:
    _DEFAULT_SECRET = secrets.token_hex(32)
    _default_secret_file.write_text(_DEFAULT_SECRET)
JWT_SECRET = os.environ.get("JWT_SECRET", _DEFAULT_SECRET)
JWT_ALGORITHM = "HS256"
JWT_DEFAULT_EXPIRE = 86400       # 24h
JWT_REMEMBER_EXPIRE = 2592000     # 30d
MAX_LOGIN_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = int(os.environ.get("LOGIN_WINDOW", "300"))        # 5min (可测试时设为10)

# ── 数据目录 ──────────────────────────────────────────
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
USERS_FILE = DATA_DIR / "users.json"
RESET_CODES_FILE = DATA_DIR / "reset_codes.json"
LOGIN_ATTEMPTS_FILE = DATA_DIR / "login_attempts.json"

# ── 密码哈希 ──────────────────────────────────────────
def _hash_password(password: str) -> str:
    """bcrypt 哈希密码"""
    return _bcrypt.hashpw(password.encode("utf-8"), _bcrypt.gensalt(rounds=12)).decode("utf-8")

def _verify_password(password: str, hash_str: str) -> bool:
    """验证密码"""
    try:
        return _bcrypt.checkpw(password.encode("utf-8"), hash_str.encode("utf-8"))
    except Exception:
        return False

# ── FastAPI 应用 ───────────────────────────────────────
app = FastAPI(title="EcoPilot Auth Service", version="1.0.0")

# CORS
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


def _generate_user_id() -> str:
    """生成用户 ID: u_ + 8位随机hex"""
    return f"u_{secrets.token_hex(4)}"


def _mask_phone(phone: str) -> str:
    """手机号脱敏: 138****8000"""
    if len(phone) == 11:
        return phone[:3] + "****" + phone[7:]
    return phone


def _now_iso() -> str:
    """当前 UTC+8 时间 ISO 格式"""
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


def _create_token(user_id: str, remember: bool = False) -> tuple[str, int]:
    """签发 JWT Token，返回 (token, expires_in)"""
    expires_in = JWT_REMEMBER_EXPIRE if remember else JWT_DEFAULT_EXPIRE
    exp = int(time.time()) + expires_in
    payload = {
        "sub": user_id,
        "exp": exp,
        "iat": int(time.time()),
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token, expires_in


def _decode_token(token: str) -> dict:
    """验证并解码 JWT Token"""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token 已过期")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="无效的 Token")


def _get_user_by_id(user_id: str) -> Optional[dict]:
    """通过 ID 查找用户"""
    users = _read_json(USERS_FILE)
    for u in users:
        if u["id"] == user_id:
            return u
    return None


def _get_user_by_email(email: str) -> Optional[dict]:
    """通过邮箱查找用户"""
    users = _read_json(USERS_FILE)
    for u in users:
        if u.get("email") == email.lower():
            return u
    return None


def _get_user_by_phone(phone: str) -> Optional[dict]:
    """通过手机号查找用户"""
    users = _read_json(USERS_FILE)
    for u in users:
        if u.get("phone") == phone:
            return u
    return None


def _check_login_rate_limit(login: str, ip: str) -> None:
    """检查登录失败限流"""
    attempts = _read_json(LOGIN_ATTEMPTS_FILE)
    now = time.time()
    window_start = now - LOGIN_WINDOW_SECONDS

    # 清理过期记录（同时清理当前窗口外的）
    recent = [
        a for a in attempts
        if a["success"] is False
        and a["timestamp"] >= window_start
        and (a["login"] == login or a["ip"] == ip)
    ]

    if len(recent) >= MAX_LOGIN_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail="登录失败次数过多，请5分钟后再试",
        )


def _record_login_attempt(login: str, ip: str, success: bool):
    """记录登录尝试"""
    attempts = _read_json(LOGIN_ATTEMPTS_FILE)
    attempts.append({
        "login": login,
        "ip": ip,
        "success": success,
        "timestamp": time.time(),
    })
    # 仅保留最近 24h 的记录，防止文件无限增长
    cutoff = time.time() - 86400
    attempts = [a for a in attempts if a["timestamp"] >= cutoff]
    _write_json(LOGIN_ATTEMPTS_FILE, attempts)


# ══════════════════════════════════════════════════════
# 依赖注入：获取当前用户
# ══════════════════════════════════════════════════════

async def get_current_user(request: Request) -> dict:
    """从 Authorization header 中提取并验证用户"""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="缺少认证 Token")

    token = auth_header[7:].strip()
    payload = _decode_token(token)
    user = _get_user_by_id(payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    return user


# ══════════════════════════════════════════════════════
# Pydantic Models
# ══════════════════════════════════════════════════════

class RegisterRequest(BaseModel):
    company: str = Field(..., min_length=2, max_length=100, description="企业名称")
    name: str = Field(..., min_length=2, max_length=50, description="联系人姓名")
    phone: str = Field(..., min_length=11, max_length=11, description="手机号")
    email: str = Field(..., min_length=5, max_length=200, description="邮箱")
    password: str = Field(..., min_length=8, max_length=128, description="密码")

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        if not re.fullmatch(r"1[3-9]\d{9}", v):
            raise ValueError("手机号格式不正确")
        return v

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        if not re.fullmatch(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", v):
            raise ValueError("邮箱格式不正确")
        return v.lower()

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if not re.search(r"[a-zA-Z]", v):
            raise ValueError("密码必须包含字母")
        if not re.search(r"\d", v):
            raise ValueError("密码必须包含数字")
        return v


class LoginRequest(BaseModel):
    login: str = Field(..., min_length=1, max_length=200, description="邮箱或手机号")
    password: str = Field(..., min_length=1, max_length=128, description="密码")
    remember: bool = Field(False, description="记住我")


class ChangePasswordRequest(BaseModel):
    old_password: str = Field(..., min_length=1, max_length=128, description="旧密码")
    new_password: str = Field(..., min_length=8, max_length=128, description="新密码")

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        if not re.search(r"[a-zA-Z]", v):
            raise ValueError("密码必须包含字母")
        if not re.search(r"\d", v):
            raise ValueError("密码必须包含数字")
        return v


class ForgotPasswordRequest(BaseModel):
    email: str = Field(..., min_length=1, max_length=200, description="邮箱")


class ResetPasswordRequest(BaseModel):
    email: str = Field(..., min_length=1, max_length=200, description="邮箱")
    code: str = Field(..., min_length=1, max_length=32, description="重置码")
    new_password: str = Field(..., min_length=8, max_length=128, description="新密码")

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        if not re.search(r"[a-zA-Z]", v):
            raise ValueError("密码必须包含字母")
        if not re.search(r"\d", v):
            raise ValueError("密码必须包含数字")
        return v


# ══════════════════════════════════════════════════════
# API: 健康检查
# ══════════════════════════════════════════════════════

@app.get("/api/auth/health")
async def health():
    return {
        "status": "ok",
        "service": "ecopilot-auth-service",
        "version": "1.0.0",
    }


# ══════════════════════════════════════════════════════
# API: 注册
# ══════════════════════════════════════════════════════

@app.post("/api/auth/register", status_code=201)
async def register(req: RegisterRequest):
    # 唯一性校验
    if _get_user_by_email(req.email):
        raise HTTPException(status_code=409, detail="该邮箱已注册")
    if _get_user_by_phone(req.phone):
        raise HTTPException(status_code=409, detail="该手机号已注册")

    # 创建用户
    user = {
        "id": _generate_user_id(),
        "company": req.company,
        "name": req.name,
        "phone": req.phone,
        "email": req.email,
        "password_hash": _hash_password(req.password),
        "plan": "free",
        "plan_expires": None,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }

    users = _read_json(USERS_FILE)
    users.append(user)
    _write_json(USERS_FILE, users)

    # 返回不含密码的用户信息
    safe_user = {k: v for k, v in user.items() if k != "password_hash"}
    return {
        "success": True,
        "message": "注册成功",
        "user": safe_user,
    }


# ══════════════════════════════════════════════════════
# API: 登录
# ══════════════════════════════════════════════════════

@app.post("/api/auth/login")
async def login(req: LoginRequest, request: Request):
    # 获取客户端 IP
    client_ip = request.client.host if request.client else "unknown"

    # 限流检查
    _check_login_rate_limit(req.login, client_ip)

    # 查找用户（支持邮箱或手机号）
    user = _get_user_by_email(req.login) or _get_user_by_phone(req.login)
    if not user:
        _record_login_attempt(req.login, client_ip, False)
        raise HTTPException(status_code=401, detail="账号或密码错误")

    # 验证密码
    if not _verify_password(req.password, user["password_hash"]):
        _record_login_attempt(req.login, client_ip, False)
        raise HTTPException(status_code=401, detail="账号或密码错误")

    # 记录成功登录
    _record_login_attempt(req.login, client_ip, True)

    # 签发 Token
    token, expires_in = _create_token(user["id"], req.remember)

    # 返回用户信息（手机号不脱敏）
    safe_user = {k: v for k, v in user.items() if k != "password_hash"}
    return {
        "success": True,
        "token": token,
        "expires_in": expires_in,
        "user": safe_user,
    }


# ══════════════════════════════════════════════════════
# API: 获取当前用户
# ══════════════════════════════════════════════════════

@app.get("/api/auth/me")
async def get_me(user: dict = Depends(get_current_user)):
    safe = {k: v for k, v in user.items() if k != "password_hash"}
    # 手机号脱敏
    if "phone" in safe:
        safe["phone"] = _mask_phone(safe["phone"])
    return safe


# ══════════════════════════════════════════════════════
# API: 修改密码
# ══════════════════════════════════════════════════════

@app.post("/api/auth/change-password")
async def change_password(
    req: ChangePasswordRequest,
    user: dict = Depends(get_current_user),
):
    # 验证旧密码
    if not _verify_password(req.old_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="旧密码不正确")

    # 更新密码
    users = _read_json(USERS_FILE)
    for u in users:
        if u["id"] == user["id"]:
            u["password_hash"] = _hash_password(req.new_password)
            u["updated_at"] = _now_iso()
            break
    _write_json(USERS_FILE, users)

    return {"success": True, "message": "密码修改成功"}


# ══════════════════════════════════════════════════════
# API: 忘记密码
# ══════════════════════════════════════════════════════

@app.post("/api/auth/forgot-password")
async def forgot_password(req: ForgotPasswordRequest):
    email = req.email.strip().lower()

    # 查找用户
    user = _get_user_by_email(email)
    if not user:
        # 不暴露用户是否存在
        return {"success": True, "message": "如果该邮箱已注册，重置码将发送到邮箱"}

    # 生成6位数字重置码
    code = str(secrets.randbelow(900000) + 100000)  # 100000-999999

    # 存储重置码，15分钟有效
    now = time.time()
    reset_record = {
        "email": email,
        "code": code,
        "expires_at": now + 900,  # 15min
        "used": False,
        "created_at": _now_iso(),
    }

    codes = _read_json(RESET_CODES_FILE)
    codes.append(reset_record)
    _write_json(RESET_CODES_FILE, codes)

    # 开发环境直接返回重置码（生产环境应发送邮件）
    is_dev = os.environ.get("ECOPILOT_ENV", "development") == "development"
    resp = {"success": True, "message": "如果该邮箱已注册，重置码将发送到邮箱"}
    if is_dev:
        resp["code"] = code  # 开发环境返回重置码便于测试
    return resp


# ══════════════════════════════════════════════════════
# API: 重置密码
# ══════════════════════════════════════════════════════

@app.post("/api/auth/reset-password")
async def reset_password(req: ResetPasswordRequest):
    email = req.email.strip().lower()
    code = req.code.strip()
    now = time.time()

    # 查找有效重置码
    codes = _read_json(RESET_CODES_FILE)
    valid_code = None
    for c in codes:
        if (
            c["email"] == email
            and c["code"] == code
            and c["used"] is False
            and c["expires_at"] > now
        ):
            valid_code = c
            break

    if not valid_code:
        raise HTTPException(status_code=400, detail="重置码无效或已过期")

    # 查找用户
    user = _get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=400, detail="用户不存在")

    # 更新密码
    users = _read_json(USERS_FILE)
    for u in users:
        if u["id"] == user["id"]:
            u["password_hash"] = _hash_password(req.new_password)
            u["updated_at"] = _now_iso()
            break
    _write_json(USERS_FILE, users)

    # 标记重置码已使用
    valid_code["used"] = True
    _write_json(RESET_CODES_FILE, codes)

    return {"success": True, "message": "密码重置成功"}


# ══════════════════════════════════════════════════════
# API: 刷新 Token
# ══════════════════════════════════════════════════════

@app.post("/api/auth/refresh")
async def refresh_token(user: dict = Depends(get_current_user)):
    # 签发新 Token（默认有效期）
    token, expires_in = _create_token(user["id"], remember=False)

    safe_user = {k: v for k, v in user.items() if k != "password_hash"}
    return {
        "success": True,
        "token": token,
        "expires_in": expires_in,
        "user": safe_user,
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

    # 启动信息
    is_custom_secret = bool(os.environ.get("JWT_SECRET"))
    user_count = len(_read_json(USERS_FILE))

    print("=" * 50)
    print("  EcoPilot 认证服务")
    print("=" * 50)
    print(f"  端口:         8091")
    print(f"  JWT 密钥:     {'自定义配置' if is_custom_secret else '自动生成（重启后失效）'}")
    print(f"  JWT 算法:     {JWT_ALGORITHM}")
    print(f"  Token 有效期: 默认 {JWT_DEFAULT_EXPIRE // 3600}h / Remember {JWT_REMEMBER_EXPIRE // 86400}d")
    print(f"  登录限流:     {MAX_LOGIN_ATTEMPTS}次 / {LOGIN_WINDOW_SECONDS // 60}min")
    print(f"  已注册用户:   {user_count}")
    print(f"  数据目录:     {DATA_DIR}")
    print(f"  环境:         {os.environ.get('ECOPILOT_ENV', 'development')}")
    print("=" * 50)

    uvicorn.run(app, host="0.0.0.0", port=8091)
