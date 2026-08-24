"""服务基类：提供 require_login / ok / fail 通用能力。

所有业务服务继承 :class:`BaseService`，通过共享的 :class:`AuthManager` /
:class:`HttpClient` / :class:`Config` 协作。
"""

from __future__ import annotations

import logging

from ..auth.auth_manager import AuthManager
from ..config import Config
from ..errors import ApiResponse, ErrorCode, PermitError, SessionExpired
from ..http.http_client import HttpClient
from ..models import LoginState

logger = logging.getLogger("eco_permit_enterprise_mcp.services.base")


class BaseService:
    """业务服务基类。"""

    def __init__(self, config: Config, auth: AuthManager, http: HttpClient):
        self.config = config
        self.auth = auth
        self.http = http

    # ------------------------------------------------------------------
    # 通用能力
    # ------------------------------------------------------------------
    def require_login(self) -> LoginState:
        """校验会话有效性；失效自动重登。抛出 :class:`SessionExpired` 若失败。"""
        try:
            return self.auth.ensure_session()
        except SessionExpired:
            raise
        except PermitError as exc:
            raise SessionExpired(f"会话校验失败: {exc.msg}") from exc

    @staticmethod
    def ok(data=None, msg: str = "成功") -> ApiResponse:
        return ApiResponse.ok(data, msg)

    @staticmethod
    def fail(code: int, msg: str, data=None) -> ApiResponse:
        return ApiResponse.fail(code, msg, data)

    # ------------------------------------------------------------------
    # 安全执行包装（统一异常 → ApiResponse）
    # ------------------------------------------------------------------
    def run(self, fn, *args, **kwargs) -> ApiResponse:
        """执行业务函数，将异常统一映射为 ApiResponse。

        - 参数错误 → 400
        - 会话失效 → 401
        - 上游/需人工 → 502
        - 其余 → 500
        """
        try:
            return fn(*args, **kwargs)
        except (ValueError, TypeError) as exc:
            logger.warning("参数错误: %s", exc)
            return self.fail(ErrorCode.BAD_REQUEST, f"参数错误: {exc}")
        except SessionExpired as exc:
            logger.warning("会话失效: %s", exc.msg)
            return self.fail(ErrorCode.UNAUTHORIZED, exc.msg)
        except PermitError as exc:
            logger.warning("业务异常(code=%s): %s", exc.code, exc.msg)
            return self.fail(exc.code, exc.msg)
        except Exception as exc:  # noqa: BLE001
            logger.exception("未预期异常: %s", exc)
            return self.fail(ErrorCode.INTERNAL_ERROR, f"服务器内部错误: {exc}")


__all__ = ["BaseService"]
