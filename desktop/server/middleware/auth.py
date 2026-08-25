"""
EcoPilot 认证与授权中间件 v2

提取自 chat_api.py — 负责 Token 认证 + 分级许可证校验

v2 升级:
  - _LICENSE_VALID: bool → _LICENSE_STATE: LicenseState
  - 支持 tier 分级鉴权: chat / report
  - 配额耗尽返回 402 QUOTA_EXCEEDED
  - 携带升级链接
"""

from __future__ import annotations

import os
import secrets
from fastapi import Request
from fastapi.responses import JSONResponse

# 官网地址（供客户端跳转升级/购买）
ECO_WEBSITE_URL = os.environ.get("ECO_WEBSITE_URL", "http://81.71.49.185/site")

# 报告生成端点列表（需要检查报告配额）
REPORT_PATHS = {
    "/api/chat/stream",          # 对话即可能触发生成报告
    "/api/permit/quick-check",   # 快速自查
    "/api/permit/full/stream",   # 全模块读取
    "/api/review/",              # 审查报告生成
    "/api/calendar/",            # 台账/报告模板
}

# 这些在应用启动时由 lifespan 设置
_AUTH_TOKEN: str = ""
_LICENSE_VALID: bool = False    # 兼容旧版
_LICENSE_STATE = None            # v2 LicenseState 对象

# 公开路径白名单（无需认证）
PUBLIC_PATHS = {
    "/api/chat/health",
    "/api/ops/event",
    "/api/license/status",
    "/api/license/fingerprint",
    "/api/auth/token",
}

# 无需许可证的路径前缀
LICENSE_FREE_PREFIXES = (
    "/api/license/",
    "/api/permit/login/",
    "/api/permit/credentials/",
    "/api/permit/browser/",
)


def _cors_json(status: int, detail: str | dict, request: Request) -> JSONResponse:
    """带 CORS 头的 JSON 错误响应"""
    origin = request.headers.get("origin", "")
    allowed = [
        os.environ.get("ECO_CORS_ORIGIN", "http://127.0.0.1:3000"),
        "http://localhost:3000",
    ]
    headers = {}
    if origin in allowed:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"
    return JSONResponse(
        status_code=status, content=detail if isinstance(detail, dict) else {"detail": detail}, headers=headers
    )


def _cors_headers(request: Request) -> dict:
    """仅返回 CORS 头字典"""
    origin = request.headers.get("origin", "")
    allowed = [
        os.environ.get("ECO_CORS_ORIGIN", "http://127.0.0.1:3000"),
        "http://localhost:3000",
    ]
    headers = {}
    if origin in allowed:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"
    return headers


def set_auth_state(token: str, license_valid: bool, license_state=None):
    """由 lifespan 调用，设置运行时认证状态"""
    global _AUTH_TOKEN, _LICENSE_VALID, _LICENSE_STATE
    _AUTH_TOKEN = token
    _LICENSE_VALID = license_valid
    _LICENSE_STATE = license_state


def get_auth_token() -> str:
    return _AUTH_TOKEN


def is_license_valid() -> bool:
    return _LICENSE_VALID


def get_license_state():
    """获取当前许可证状态 (LicenseState)"""
    return _LICENSE_STATE


def check_tier(path: str) -> tuple[bool, int, dict]:
    """分级鉴权: 返回 (allowed, status_code, error_detail)
    - chat: 需要 can_chat
    - report: 需要 can_report
    - 配额不足时返回 402
    """
    if _LICENSE_STATE is None:
        return False, 403, {"detail": "许可证无效或已过期，请联系管理员"}

    is_report = any(path.startswith(rp) for rp in REPORT_PATHS)

    # 积分余额检查（对主对话流生效；-1=无限、0=旧证无计量）
    if path.startswith("/api/chat/stream") and _LICENSE_STATE.points_quota > 0:
        points_left = _LICENSE_STATE.points_quota - _LICENSE_STATE.points_used
        if points_left <= 0:
            return False, 402, {
                "code": "POINTS_EXHAUSTED",
                "message": "试用积分额度已用完，请升级或等待每日免费额度刷新",
                "upgrade_url": f"{ECO_WEBSITE_URL}/pages/pricing.html",
                "current_tier": _LICENSE_STATE.tier,
                "points_used": _LICENSE_STATE.points_used,
                "points_quota": _LICENSE_STATE.points_quota,
            }

    if is_report:
        if not _LICENSE_STATE.can_report:
            if _LICENSE_STATE.tier == "pro_trial" and _LICENSE_STATE.reports_used >= _LICENSE_STATE.report_quota:
                # 试用配额耗尽 → 402 升级
                return False, 402, {
                    "code": "QUOTA_EXCEEDED",
                    "message": "试用版报告配额已用完",
                    "upgrade_url": f"{ECO_WEBSITE_URL}/pages/pricing.html",
                    "current_tier": _LICENSE_STATE.tier,
                    "reports_used": _LICENSE_STATE.reports_used,
                    "reports_quota": _LICENSE_STATE.report_quota,
                }
            return False, 403, {"detail": "当前套餐不支持报告生成，请升级"}
    else:
        if not _LICENSE_STATE.can_chat:
            return False, 403, {"detail": "当前套餐不支持对话功能，请升级"}

    return True, 200, {}


async def auth_middleware(request: Request, call_next):
    """认证 + 许可证校验中间件"""
    path = request.url.path

    # 非 /api/ 路径直接放行
    if not path.startswith("/api/"):
        return await call_next(request)

    # CORS 预检放行
    if request.method == "OPTIONS":
        return await call_next(request)

    # 健康检查直接放行
    if path == "/api/chat/health":
        return await call_next(request)

    # 运维事件上报允许匿名
    if path == "/api/ops/event" and request.method == "POST":
        return await call_next(request)

    # /api/auth/token 仅 localhost
    if path == "/api/auth/token":
        client_ip = request.client.host if request.client else ""
        if client_ip not in ("127.0.0.1", "::1", "localhost"):
            return _cors_json(403, "Forbidden", request)
        return await call_next(request)

    # MCP 服务器列表公开（不暴露密钥）
    if path == "/api/mcp-servers" and request.method == "GET":
        return await call_next(request)

    # OpenAPI 文档公开
    if path in ("/docs", "/openapi.json", "/redoc"):
        return await call_next(request)

    # License 端点公开
    if path.startswith("/api/license/"):
        return await call_next(request)

    # Bearer Token 校验
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else ""
    if not token:
        token = request.query_params.get("token", "")
    if not _AUTH_TOKEN or not secrets.compare_digest(token, _AUTH_TOKEN):
        return _cors_json(401, "Unauthorized", request)

    # 许可证校验（v2 分级）
    if not path.startswith(LICENSE_FREE_PREFIXES) and not _LICENSE_VALID:
        return _cors_json(
            403, "许可证无效或已过期，请联系管理员", request
        )

    # v2 分级鉴权: chat / report
    if not path.startswith(LICENSE_FREE_PREFIXES) and _LICENSE_STATE is not None:
        allowed, code, detail = check_tier(path)
        if not allowed:
            return JSONResponse(
                status_code=code, content=detail,
                headers=_cors_headers(request)
            )

    return await call_next(request)
