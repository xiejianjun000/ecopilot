"""错误码、统一返回结构与自定义异常。

所有 MCP 工具统一返回 ``{code, data, msg}``；错误码语义见 :class:`ErrorCode`。
"""

from __future__ import annotations

from enum import IntEnum
from typing import Any


class ErrorCode(IntEnum):
    """统一错误码枚举（与架构设计 §7.1 对齐）。"""

    SUCCESS = 0          # 成功
    BAD_REQUEST = 400    # 参数错误
    UNAUTHORIZED = 401   # 未登录 / 会话失效
    INTERNAL_ERROR = 500  # 服务器内部错误
    RESTRICTED = 501     # 模块受限 / 未启用
    UPSTREAM_ERROR = 502  # 上游异常 / 需人工介入


class PermitError(Exception):
    """项目基础异常，携带统一错误码。"""

    def __init__(self, msg: str, code: ErrorCode = ErrorCode.INTERNAL_ERROR):
        super().__init__(msg)
        self.msg = msg
        self.code = code


class ConfigError(PermitError):
    """配置缺失 / 非法。"""

    def __init__(self, msg: str):
        super().__init__(msg, ErrorCode.BAD_REQUEST)


class HumanAssistRequired(PermitError):
    """验证码多次识别失败，需要人工介入。"""

    def __init__(self, msg: str = "验证码识别多次失败，请人工介入登录"):
        super().__init__(msg, ErrorCode.UPSTREAM_ERROR)


class SessionExpired(PermitError):
    """会话过期且自动重登失败。"""

    def __init__(self, msg: str = "会话已失效且自动重登失败"):
        super().__init__(msg, ErrorCode.UNAUTHORIZED)


class UpstreamError(PermitError):
    """上游系统异常。"""

    def __init__(self, msg: str = "上游系统异常"):
        super().__init__(msg, ErrorCode.UPSTREAM_ERROR)


class ApiResponse:
    """统一出参结构 ``{code, data, msg}``。

    服务层方法返回 :class:`ApiResponse`，工具层转换为 dict 后输出给 Agent。
    """

    __slots__ = ("code", "data", "msg")

    def __init__(self, code: int, data: Any = None, msg: str = ""):
        self.code = int(code)
        self.data = data
        self.msg = msg

    @classmethod
    def ok(cls, data: Any = None, msg: str = "成功") -> "ApiResponse":
        return cls(ErrorCode.SUCCESS, data, msg)

    @classmethod
    def fail(cls, code: int, msg: str, data: Any = None) -> "ApiResponse":
        return cls(code, data, msg)

    @classmethod
    def restricted(cls, msg: str = "模块受限/未启用") -> "ApiResponse":
        return cls(ErrorCode.RESTRICTED, None, msg)

    def to_dict(self) -> dict:
        return {"code": self.code, "data": self.data, "msg": self.msg}

    def __repr__(self) -> str:  # pragma: no cover - 调试辅助
        return f"ApiResponse(code={self.code}, msg={self.msg!r}, data={self.data!r})"
