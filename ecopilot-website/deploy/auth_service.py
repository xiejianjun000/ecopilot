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
import logging
import os
import re
import secrets
import sys
import threading
import time
import uuid
import urllib.request
import urllib.error
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

# ── 日志 ──────────────────────────────────────────────
logger = logging.getLogger("ecopilot.auth")
logger.setLevel(logging.DEBUG)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter(
        "[%(asctime)s] %(levelname)s %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    ))
    logger.addHandler(_handler)

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
# 服务间内部鉴权 Key（与 subscription_service 共享）
INTERNAL_API_KEY = os.environ.get("ECO_INTERNAL_API_KEY", "eco-internal-dev-key-change-in-production")
CALLBACK_TIMEOUT = 3  # 下游回调超时（秒）
CALLBACK_MAX_RETRIES = 2  # 超时/连接失败时额外重试次数（总共最多3次）

# ── 回调监控指标（进程内计数器，Prometheus 格式导出）───
_callback_metrics = {
    "total": 0,           # 回调总次数
    "success": 0,         # 成功次数
    "failed": 0,          # 失败次数（含 HTTP 错误和网络错误）
    "last_failure_at": None,  # 最近一次失败时间 ISO
    "last_failure_error": "", # 最近一次失败原因
    "registrations": 0,   # 注册总数
}
_METRICS_LOCK = threading.Lock() if "threading" in sys.modules else None

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
    industry: str = Field("", max_length=50, description="所属行业")
    position: str = Field("", max_length=50, description="职位")

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
# API: Prometheus 指标（供监控系统拉取）
# ══════════════════════════════════════════════════════

def _record_callback_metric(success: bool, error_type: str = ""):
    """记录一次回调结果到进程内计数器。"""
    _callback_metrics["total"] += 1
    if success:
        _callback_metrics["success"] += 1
    else:
        _callback_metrics["failed"] += 1
        _callback_metrics["last_failure_at"] = _now_iso()
        _callback_metrics["last_failure_error"] = error_type[:200]


@app.get("/api/auth/metrics")
async def metrics(request: Request):
    """
    暴露 Prometheus 格式指标 + JSON 详情。
    - 请求头 Accept: text/plain → Prometheus 格式
    - 否则 → JSON 格式（人/脚本可读）
    """
    pending = _count_failed_callbacks()
    m = _callback_metrics

    accept = request.headers.get("accept", "")

    if "text/plain" in accept or "prometheus" in accept:
        # ── Prometheus 格式 ──────────────────────────
        lines = [
            "# HELP ecopilot_callback_total 回调总次数（含成功+失败）",
            "# TYPE ecopilot_callback_total counter",
            f"ecopilot_callback_total {m['total']}",
            "",
            "# HELP ecopilot_callback_success_total 回调成功次数",
            "# TYPE ecopilot_callback_success_total counter",
            f"ecopilot_callback_success_total {m['success']}",
            "",
            "# HELP ecopilot_callback_failed_total 回调失败次数",
            "# TYPE ecopilot_callback_failed_total counter",
            f"ecopilot_callback_failed_total {m['failed']}",
            "",
            "# HELP ecopilot_callback_pending_count 待处理的降级回调数",
            "# TYPE ecopilot_callback_pending_count gauge",
            f"ecopilot_callback_pending_count {pending}",
            "",
            "# HELP ecopilot_registrations_total 注册总数",
            "# TYPE ecopilot_registrations_total counter",
            f"ecopilot_registrations_total {m['registrations']}",
            "",
            "# HELP ecopilot_callback_last_failure_timestamp 最近一次回调失败时间(Unix秒)",
            "# TYPE ecopilot_callback_last_failure_timestamp gauge",
        ]
        # last_failure_timestamp 转换
        if m["last_failure_at"]:
            try:
                ts = datetime.fromisoformat(m["last_failure_at"]).timestamp()
            except ValueError:
                ts = 0
            lines.append(f"ecopilot_callback_last_failure_timestamp {ts}")
        else:
            lines.append("ecopilot_callback_last_failure_timestamp 0")

        from fastapi.responses import PlainTextResponse
        return PlainTextResponse("\n".join(lines) + "\n", media_type="text/plain")

    # ── JSON 格式 ──────────────────────────────────
    return {
        "status": "ok",
        "metrics": {
            "callback_total": m["total"],
            "callback_success": m["success"],
            "callback_failed": m["failed"],
            "callback_failure_ratio": round(m["failed"] / max(m["total"], 1), 4),
            "callback_pending": pending,
            "callback_last_failure_at": m["last_failure_at"],
            "callback_last_failure_error": m["last_failure_error"],
            "registrations": m["registrations"],
        },
        "thresholds": {
            "pending_warn": 10,
            "pending_critical": 50,
            "failure_ratio_warn": 0.3,
        },
        "recovery": "python3 scripts/retry_failed_callbacks.py",
    }


# ══════════════════════════════════════════════════════
# 下游回调辅助函数
# ══════════════════════════════════════════════════════

def _call_subscription_create_free(user_id: str, email: str) -> dict:
    """调用 subscription_service 创建免费订阅。
    支持超时/连接失败自动重试（最多额外重试 CALLBACK_MAX_RETRIES 次）。
    HTTP 错误（4xx/5xx）不重试。
    每次重试记录详细参数和响应，重试耗尽后写入降级文件。
    返回状态字典供日志记录。"""
    url = "http://127.0.0.1:8092/api/subscription/create-free"
    payload = json.dumps({"user_id": user_id, "email": email, "plan": "free"}).encode("utf-8")

    logger.debug("  📤 回调请求参数: user_id=%s email=%s plan=free timeout=%ds retries=%d",
                 user_id, email, CALLBACK_TIMEOUT, CALLBACK_MAX_RETRIES)

    last_error = None
    for attempt in range(1 + CALLBACK_MAX_RETRIES):
        logger.debug("  ⏳ 尝试 %d/%d 发起请求 → %s",
                     attempt + 1, 1 + CALLBACK_MAX_RETRIES, url)

        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "x-internal-key": INTERNAL_API_KEY,
            },
            method="POST",
        )

        start = time.time()
        try:
            resp = urllib.request.urlopen(req, timeout=CALLBACK_TIMEOUT)
            elapsed = round((time.time() - start) * 1000)
            raw_body = resp.read().decode("utf-8")
            data = json.loads(raw_body)

            logger.info("  ✅ 第%d次成功: HTTP %d, %dms, body=%s",
                        attempt + 1, resp.status, elapsed,
                        raw_body[:150] + "..." if len(raw_body) > 150 else raw_body)

            _record_callback_metric(success=True)

            return {
                "success": True,
                "status_code": resp.status,
                "elapsed_ms": elapsed,
                "attempts": attempt + 1,
                "data": data,
            }

        except urllib.error.HTTPError as e:
            elapsed = round((time.time() - start) * 1000)
            raw_body = e.read().decode("utf-8", errors="replace")
            logger.warning("  ⚠️ 第%d次 HTTP错误: %d, %dms, body=%s",
                          attempt + 1, e.code, elapsed,
                          raw_body[:150] + "..." if len(raw_body) > 150 else raw_body)

            _record_callback_metric(success=False, error_type=f"HTTP_{e.code}")

            return {
                "success": False,
                "error_type": f"HTTP {e.code}",
                "elapsed_ms": elapsed,
                "attempts": attempt + 1,
                "body": raw_body[:200],
            }

        except (urllib.error.URLError, TimeoutError, OSError) as e:
            elapsed = round((time.time() - start) * 1000)
            error_msg = str(e)[:200]
            err_type = type(e).__name__

            last_error = {
                "success": False,
                "error_type": err_type,
                "elapsed_ms": elapsed,
                "attempts": attempt + 1,
                "message": error_msg,
            }

            logger.warning("  ❌ 第%d次失败: %s, %dms, detail=%s",
                          attempt + 1, err_type, elapsed, error_msg)

            if attempt < CALLBACK_MAX_RETRIES:
                backoff = 0.5 * (attempt + 1)
                logger.warning("  ↻ 重试 %d/%d (退避 %.1fs): user_id=%s email=%s",
                              attempt + 2, 1 + CALLBACK_MAX_RETRIES,
                              backoff, user_id, email)
                time.sleep(backoff)
            continue

    # ── 所有重试耗尽 → 降级处理 ──
    _record_callback_metric(success=False, error_type=last_error.get("error_type", "exhausted"))
    _record_failed_callback(user_id, email, last_error)
    return last_error


def _record_failed_callback(user_id: str, email: str, error: dict):
    """重试耗尽后记录降级数据，供后续补建订阅使用。
    写入 data/failed_callbacks.jsonl，每行一条 JSON 记录。"""
    failed_file = DATA_DIR / "failed_callbacks.jsonl"
    record = {
        "user_id": user_id,
        "email": email,
        "error_type": error.get("error_type", "unknown"),
        "error_message": error.get("message", ""),
        "total_attempts": error.get("attempts", 0),
        "failed_at": _now_iso(),
        "resolved": False,
    }
    try:
        with open(failed_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        logger.error("  📋 降级记录已写入: %s (共 %d 条待处理)",
                     failed_file.name, _count_failed_callbacks())
    except Exception as e:
        logger.critical("  💥 降级记录写入失败: %s", e)

    # ── 告警建议（日志级别示意）──────────────────────
    logger.error("  🚨 [ALERT] subscription_service 回调失败，已重试 %d 次:",
                 error.get("attempts", 0))
    logger.error("         user_id=%s, email=%s, 原因=%s",
                 user_id, email, error.get("error_type", "?"))
    logger.error("         → 用户已注册但订阅未创建")
    logger.error("         → 降级写入: data/failed_callbacks.jsonl")
    logger.error("         → 建议: 检查 subscription_service 健康状态")
    logger.error("         → 恢复后执行: python3 scripts/retry_failed_callbacks.py")


def _count_failed_callbacks() -> int:
    """统计未解决的降级回调数（resolved=False）。"""
    failed_file = DATA_DIR / "failed_callbacks.jsonl"
    if not failed_file.exists():
        return 0
    count = 0
    for line in open(failed_file, "r", encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
            if not rec.get("resolved", False):
                count += 1
        except json.JSONDecodeError:
            count += 1  # 脏数据也计入
    return count


def _now_iso() -> str:
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


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
        "industry": req.industry or "",
        "position": req.position or "",
        "password_hash": _hash_password(req.password),
        "plan": "free",
        "plan_expires": None,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }

    users = _read_json(USERS_FILE)
    users.append(user)
    _write_json(USERS_FILE, users)

    # 监控计数
    _callback_metrics["registrations"] += 1

    # ── 下游回调链路 ─────────────────────────────────
    uid = user["id"]
    logger.info("📝 用户注册成功: uid=%s email=%s", uid, user["email"])

    # [1/2] 调用 subscription_service 创建免费订阅
    logger.info("  [1/2] → subscription_service POST /api/subscription/create-free")
    sub_result = _call_subscription_create_free(uid, user["email"])
    attempts_str = f", 尝试 {sub_result.get('attempts', 1)} 次" if sub_result.get("attempts", 1) > 1 else ""
    if sub_result["success"]:
        logger.info("  ✅ 订阅创建成功 (%dms%s): plan=%s",
                    sub_result["elapsed_ms"], attempts_str,
                    sub_result["data"].get("plan", "?"))
    elif "HTTP" in sub_result.get("error_type", ""):
        logger.warning("  ⚠️  subscription_service 返回错误 (%dms): %s",
                       sub_result.get("elapsed_ms", 0),
                       sub_result.get("error_type", "?"))
    else:
        logger.error("  ❌ subscription_service 不可达 (%dms, 已重试所有%d次): %s — 注册不阻塞",
                     sub_result.get("elapsed_ms", 0),
                     sub_result.get("attempts", 1),
                     sub_result.get("error_type", "?"))

    # [2/2] 许可证签发 — 客户端首次启动时自动完成（需 fingerprint）
    logger.info("  [2/2] → api_pool 许可证签发（延迟到客户端首次启动）")

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
    is_dev = os.environ.get("ECOPILOT_DEV", "").strip() == "1"
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
