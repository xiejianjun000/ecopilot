"""进程级应用上下文：持有 Config / AuthManager / 各 Service 单例。

工具层通过 :func:`AppContext.get` 获取共享组件；服务层通过 :class:`AppContext`
持有的单例互相协作（避免工具层与服务层循环 import）。这是对架构文件列表之外的
最小补充（依赖注入容器），不改动任何既有类图契约。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:  # pragma: no cover - 仅类型提示
    from .auth.auth_manager import AuthManager
    from .config import Config
    from .services.base_service import BaseService


class AppContext:
    """全局单例上下文。"""

    _config: Optional["Config"] = None
    _auth: Optional["AuthManager"] = None
    _services: dict = {}

    @classmethod
    def init(cls, config: "Config") -> None:
        """初始化上下文（server 启动 / 测试前调用）。"""
        cls._config = config
        cls._auth = None
        cls._services = {}

    @classmethod
    def reset(cls) -> None:
        """清空上下文（测试用）。"""
        cls._config = None
        cls._auth = None
        cls._services = {}

    @classmethod
    def config(cls) -> "Config":
        if cls._config is None:
            raise RuntimeError("AppContext 未初始化：请先调用 AppContext.init(config)")
        return cls._config

    @classmethod
    def auth(cls) -> "AuthManager":
        if cls._auth is None:
            # 延迟导入，避免循环依赖
            from .auth.auth_manager import AuthManager

            cls._auth = AuthManager(cls.config())
        return cls._auth

    @classmethod
    def service(cls, name: str) -> "BaseService":
        if name not in cls._services:
            raise RuntimeError(f"服务未注册: {name}")
        return cls._services[name]

    @classmethod
    def register_service(cls, name: str, service: "BaseService") -> None:
        cls._services[name] = service

    @classmethod
    def get(cls, name: str):
        """通用获取：config / auth / <service>。"""
        if name == "config":
            return cls.config()
        if name == "auth":
            return cls.auth()
        return cls.service(name)


__all__ = ["AppContext"]
