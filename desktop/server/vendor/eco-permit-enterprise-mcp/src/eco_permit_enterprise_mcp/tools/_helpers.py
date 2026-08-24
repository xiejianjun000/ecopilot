"""工具层公共辅助：异步调用包装。

阻塞的服务层调用统一串行到单线程执行器（见 ``call``），并将异常映射为统一
``{code, data, msg}`` 结构。
"""

from __future__ import annotations

import asyncio
import functools
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from ..errors import ApiResponse, ErrorCode, PermitError

# Playwright 同步 API 内部以 greenlet 桥接异步事件循环，greenlet 与线程强绑定：
# 若 ``sync_playwright().start()`` 与后续 ``page.goto()`` 落在不同线程，会触发
# ``Cannot switch to a different thread``。因此所有阻塞服务调用统一串行到同一
# 单线程执行器，保证 Playwright 生命周期始终在同一线程内完成。
_BLOCKING_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mcp-blocking")


async def call(fn: Callable[..., Any], *args, **kwargs) -> dict:
    """在单线程执行器中串行执行阻塞函数，返回统一 dict。"""
    try:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            _BLOCKING_EXECUTOR, functools.partial(fn, *args, **kwargs)
        )
        if isinstance(result, ApiResponse):
            return result.to_dict()
        if isinstance(result, dict):
            return result
        return {"code": int(ErrorCode.SUCCESS), "data": result, "msg": "成功"}
    except (ValueError, TypeError) as exc:
        return {"code": int(ErrorCode.BAD_REQUEST), "data": None, "msg": f"参数错误: {exc}"}
    except PermitError as exc:
        return {"code": int(exc.code), "data": None, "msg": exc.msg}
    except Exception as exc:  # noqa: BLE001
        return {"code": int(ErrorCode.INTERNAL_ERROR), "data": None, "msg": f"服务器内部错误: {exc}"}


def service(name: str):
    """获取已注册服务。"""
    from ..context import AppContext

    return AppContext.get(name)


__all__ = ["call", "service"]
