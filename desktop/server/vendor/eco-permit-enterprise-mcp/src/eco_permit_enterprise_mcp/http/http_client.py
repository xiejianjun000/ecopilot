"""requests Session 封装：统一请求头、GBK 解码、重试、Cookie 导出。

约定（架构设计 §7.3）：
- 响应解码：响应头显式 ``charset=UTF-8`` 按 UTF-8，其余默认 GBK 兜底。
- 请求头：POST 表单默认 ``Content-Type: application/x-www-form-urlencoded;
  charset=UTF-8`` + ``X-Requested-With: XMLHttpRequest``。
- 会话复用：单例 ``requests.Session`` 维护 CAS Cookie。
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Mapping, Optional

import requests
from requests import Session

from ..config import Config
from ..constants import DEFAULT_USER_AGENT

logger = logging.getLogger("eco_permit_enterprise_mcp.http")


@dataclass
class HttpResponse:
    """统一的 HTTP 响应封装（已做编码解码）。"""

    status_code: int
    url: str
    content: bytes
    headers: Mapping[str, str] = field(default_factory=dict)
    text: str = ""

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 400

    def json(self) -> Any:
        """解析 JSON（兼容 GBK 包裹的 JSON 字符串）。"""
        import json

        return json.loads(self.text)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<HttpResponse {self.status_code} {self.url}>"


class HttpClient:
    """基于 requests.Session 的 HTTP 客户端（同步阻塞，调用方走 to_thread）。"""

    def __init__(self, config: Config, session: Optional[Session] = None):
        self.config = config
        self._session: Session = session or Session()
        self.inject_headers()

    # ------------------------------------------------------------------
    # 基础能力
    # ------------------------------------------------------------------
    def inject_headers(self) -> None:
        """注入统一请求头（不含 Content-Type，避免污染 GET）。"""
        self._session.headers.update({
            "User-Agent": DEFAULT_USER_AGENT,
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        })

    def export_cookies(self) -> list:
        """导出会话 Cookie（供 Playwright 注入复用）。"""
        cookies = []
        for c in self._session.cookies:
            cookies.append({
                "name": c.name,
                "value": c.value,
                "domain": c.domain,
                "path": c.path,
            })
        return cookies

    # ------------------------------------------------------------------
    # 请求方法
    # ------------------------------------------------------------------
    def get(
        self,
        url: str,
        params: Optional[Mapping[str, Any]] = None,
        headers: Optional[Mapping[str, str]] = None,
        retries: int = 2,
        timeout: Optional[float] = None,
    ) -> HttpResponse:
        return self._request("GET", url, params=params, headers=headers, retries=retries, timeout=timeout)

    def post(
        self,
        url: str,
        data: Optional[Mapping[str, Any]] = None,
        headers: Optional[Mapping[str, str]] = None,
        retries: int = 2,
        timeout: Optional[float] = None,
    ) -> HttpResponse:
        return self._request("POST", url, data=data, headers=headers, retries=retries, timeout=timeout)

    def get_text(
        self,
        url: str,
        params: Optional[Mapping[str, Any]] = None,
        headers: Optional[Mapping[str, str]] = None,
    ) -> str:
        return self.get(url, params=params, headers=headers).text

    def get_json(
        self,
        url: str,
        params: Optional[Mapping[str, Any]] = None,
        headers: Optional[Mapping[str, str]] = None,
    ) -> Any:
        return self.get(url, params=params, headers=headers).json()

    # ------------------------------------------------------------------
    # 内部实现
    # ------------------------------------------------------------------
    def _request(
        self,
        method: str,
        url: str,
        params: Optional[Mapping[str, Any]] = None,
        data: Optional[Mapping[str, Any]] = None,
        headers: Optional[Mapping[str, str]] = None,
        retries: int = 2,
        timeout: Optional[float] = None,
    ) -> HttpResponse:
        headers = dict(headers or {})
        if method == "POST" and "Content-Type" not in headers:
            headers["Content-Type"] = (
                "application/x-www-form-urlencoded; charset=UTF-8"
            )

        last_exc: Optional[Exception] = None
        for attempt in range(retries + 1):
            try:
                resp = self._session.request(
                    method,
                    url,
                    params=params,
                    data=data,
                    headers=headers or None,
                    timeout=timeout or self.config.http_timeout,
                    allow_redirects=True,
                    verify=False,
                )
                return self._wrap(resp)
            except requests.RequestException as exc:
                last_exc = exc
                logger.warning("HTTP %s %s 失败(第%d次): %s",
                               method, url, attempt + 1, exc)
                if attempt < retries:
                    time.sleep(0.5 * (attempt + 1))
        raise last_exc  # type: ignore[misc]

    def _wrap(self, resp: requests.Response) -> HttpResponse:
        text = self._decode(resp)
        return HttpResponse(
            status_code=resp.status_code,
            url=resp.url,
            content=resp.content,
            headers=dict(resp.headers),
            text=text,
        )

    @staticmethod
    def _decode(resp: requests.Response) -> str:
        content_type = (resp.headers.get("Content-Type") or "").lower()
        # JSON 默认 UTF-8（RFC 8259），明确标注则按标注
        if "charset=utf-8" in content_type or "application/json" in content_type:
            return resp.content.decode("utf-8", errors="ignore")
        return resp.content.decode("gbk", errors="ignore")

    def close(self) -> None:
        self._session.close()


__all__ = ["HttpClient", "HttpResponse"]
