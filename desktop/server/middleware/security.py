"""
EcoPilot 安全中间件：安全头 + CSP + 速率限制

提取自 chat_api.py
"""

import os
import time
import threading
from fastapi import Request
from fastapi.responses import JSONResponse

# ── 速率限制状态（内存，单进程）──
_rate_limits: dict[str, list[float]] = {}
_rate_limits_lock = threading.Lock()
_RATE_WINDOW = 60  # 秒
_RATE_MAX = 300    # 每窗口最大请求数


async def security_headers_middleware(request: Request, call_next):
    """注入安全响应头"""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    # CSP: 仅允许 localhost 和 moonshot/deepseek API
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob: https:; "
        "font-src 'self' data:; "
        "connect-src 'self' http://127.0.0.1:* http://localhost:* https://api.deepseek.com https://api.moonshot.cn blob:; "
        "media-src 'self' blob:; "
        "frame-ancestors 'none'; "
        "base-uri 'self'"
    )
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


async def rate_limit_middleware(request: Request, call_next):
    """简易速率限制（内存，单进程）"""
    if request.url.path.startswith("/api/"):
        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        with _rate_limits_lock:
            bucket = _rate_limits.get(client_ip, [])
            bucket = [t for t in bucket if now - t < _RATE_WINDOW]
            if len(bucket) >= _RATE_MAX:
                return JSONResponse(
                    status_code=429,
                    content={"detail": "请求过于频繁，请稍后再试"}
                )
            bucket.append(now)
            _rate_limits[client_ip] = bucket
    return await call_next(request)
