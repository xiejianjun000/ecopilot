"""HttpClient 单测：GBK 解码、头注入、重试、Cookie 导出。"""

from __future__ import annotations

import pytest
import requests

from eco_permit_enterprise_mcp.http.http_client import HttpClient, HttpResponse


class FakeResponse:
    def __init__(self, content: bytes, headers: dict, url: str, status_code: int = 200):
        self.content = content
        self.headers = headers
        self.url = url
        self.status_code = status_code


class FakeCookie:
    def __init__(self, name, value, domain="", path="/"):
        self.name = name
        self.value = value
        self.domain = domain
        self.path = path


class FakeCookies:
    def __init__(self, cookies):
        self._cookies = cookies

    def __iter__(self):
        return iter(self._cookies)


class FakeSession:
    def __init__(self, response=None, fail_times=0, exc=requests.ConnectionError):
        self.headers = {}
        self._response = response
        self._fail_times = fail_times
        self._calls = 0
        self._exc = exc
        self.cookies = FakeCookies([FakeCookie("JSESSIONID", "abc123")])

    def request(self, method, url, **kwargs):
        self._calls += 1
        if self._calls <= self._fail_times:
            raise self._exc("boom")
        return self._response


def test_decode_gbk_default(config):
    resp = FakeResponse("中文内容".encode("gbk"), {"Content-Type": "text/html;charset=GBK"},
                       "http://x", 200)
    text = HttpClient._decode(resp)  # type: ignore[arg-type]
    assert text == "中文内容"


def test_decode_utf8_when_header_says(config):
    resp = FakeResponse("中文内容".encode("utf-8"),
                       {"Content-Type": "application/json;charset=UTF-8"}, "http://x", 200)
    assert HttpClient._decode(resp) == "中文内容"  # type: ignore[arg-type]


def test_decode_gbk_no_charset_header(config):
    # 无 charset 头 → GBK 兜底
    resp = FakeResponse("重新申请".encode("gbk"), {"Content-Type": "text/html"}, "http://x", 200)
    assert HttpClient._decode(resp) == "重新申请"  # type: ignore[arg-type]


def test_inject_headers(config):
    client = HttpClient(config, session=FakeSession(response=None))
    assert client._session.headers["X-Requested-With"] == "XMLHttpRequest"
    assert "User-Agent" in client._session.headers


def test_retry_then_success(config):
    resp = FakeResponse("ok".encode("gbk"), {"Content-Type": "text/html"}, "http://x", 200)
    session = FakeSession(response=resp, fail_times=1)
    client = HttpClient(config, session=session)
    result = client.get("http://x")
    assert isinstance(result, HttpResponse)
    assert result.text == "ok"
    assert session._calls == 2


def test_retry_exhausted_raises(config):
    session = FakeSession(response=None, fail_times=3)
    client = HttpClient(config, session=session)
    with pytest.raises(requests.ConnectionError):
        client.get("http://x", retries=2)


def test_export_cookies(config):
    client = HttpClient(config, session=FakeSession(response=None))
    cookies = client.export_cookies()
    assert any(c["name"] == "JSESSIONID" for c in cookies)
