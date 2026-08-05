"""
EcoPilot 认证与授权中间件

提取自 chat_api.py — 负责 Token 认证 + 许可证校验
"""

import os
import secrets
from fastapi import Request
from fastapi.responses import JSONResponse

# 这些在应用启动时由 lifespan 设置
_AUTH_TOKEN: str = ""
_LICENSE_VALID: bool = False

# 公开路径白名单（无需认证）
PUBLIC_PATHS = {
    "/api/chat/health",
    "/api/ops/event",
    "/api/license/status",
    "/api/license/fingerprint",
    "/api/auth/token",
}

# 无需许可证的路径前缀
LICENSE_FREE_PREFIXES = ("/api/license/",)


def _cors_json(status: int, detail: str, request: Request) -> JSONResponse:
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
        status_code=status, content={"detail": detail}, headers=headers
    )


def set_auth_state(token: str, license_valid: bool):
    """由 lifespan 调用，设置运行时认证状态"""
    global _AUTH_TOKEN, _LICENSE_VALID
    _AUTH_TOKEN = token
    _LICENSE_VALID = license_valid


def get_auth_token() -> str:
    return _AUTH_TOKEN


def is_license_valid() -> bool:
    return _LICENSE_VALID


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

    # 许可证校验
    if not path.startswith(LICENSE_FREE_PREFIXES) and not _LICENSE_VALID:
        return _cors_json(
            403, "许可证无效或已过期，请联系管理员", request
        )

    return await call_next(request)
