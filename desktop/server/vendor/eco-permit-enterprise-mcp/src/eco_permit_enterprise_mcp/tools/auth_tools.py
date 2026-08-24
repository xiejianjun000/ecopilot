"""认证与会话工具：auth_login / auth_logout / auth_status。"""

from __future__ import annotations

import asyncio
from typing import Optional

from ..context import AppContext
from ..errors import ErrorCode, PermitError


async def auth_login(
    username: Optional[str] = None,
    password: Optional[str] = None,
) -> dict:
    """CAS 登录（含 kaptcha 验证码 OCR 识别，失败自动重试）。

    入参：
    - username: 登录账号（可选，缺省用服务端 .env 配置的 PERMIT_USERNAME）
    - password: 登录密码（可选，缺省用服务端 .env 配置的 PERMIT_PASSWORD）

    出参：会话状态（sessionId 脱敏）、企业基础信息、剩余有效期。
    """
    auth = AppContext.get("auth")
    try:
        state = await asyncio.to_thread(auth.login, username, password)
    except PermitError as exc:
        return {"code": int(exc.code), "data": None, "msg": exc.msg}
    except Exception as exc:  # noqa: BLE001
        return {"code": int(ErrorCode.INTERNAL_ERROR), "data": None, "msg": f"服务器内部错误: {exc}"}

    return {
        "code": int(ErrorCode.SUCCESS),
        "data": {
            "sessionId": "***",
            "username": username or AppContext.config().username,
            "valid": state.is_valid(),
            "remaining_seconds": state.remaining_seconds(),
            "enterprise": state.profile.to_dict() if state.profile else None,
        },
        "msg": "登录成功",
    }


async def auth_logout() -> dict:
    """登出并销毁内存态会话。入参：无。出参：操作结果。"""
    auth = AppContext.get("auth")
    try:
        await asyncio.to_thread(auth.logout)
    except Exception as exc:  # noqa: BLE001
        return {"code": int(ErrorCode.INTERNAL_ERROR), "data": None, "msg": str(exc)}
    return {"code": int(ErrorCode.SUCCESS), "data": {"loggedOut": True}, "msg": "已登出"}


async def auth_status() -> dict:
    """查询会话有效性。入参：无。出参：valid 布尔、剩余有效期、当前企业信息。"""
    auth = AppContext.get("auth")
    try:
        status = await asyncio.to_thread(auth.status)
    except Exception as exc:  # noqa: BLE001
        return {"code": int(ErrorCode.INTERNAL_ERROR), "data": None, "msg": str(exc)}
    return {"code": int(ErrorCode.SUCCESS), "data": status, "msg": "成功"}


def register(mcp) -> None:
    mcp.add_tool(auth_login)
    mcp.add_tool(auth_logout)
    mcp.add_tool(auth_status)


def tool_count() -> int:
    return 3


__all__ = ["auth_login", "auth_logout", "auth_status", "register", "tool_count"]
