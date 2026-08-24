"""认证链路单测（mock HTTP / 验证码）。"""

from __future__ import annotations

import pytest

from eco_permit_enterprise_mcp.auth.auth_manager import AuthManager
from eco_permit_enterprise_mcp.errors import HumanAssistRequired, PermitError
from eco_permit_enterprise_mcp.http.http_client import HttpResponse

from tests.sample_data import LOGIN_PAGE_HTML


class FakeCaptcha:
    def __init__(self, results=None):
        self.results = list(results or ["1234"])
        self.calls = 0

    def recognize(self, img_bytes):
        self.calls += 1
        return self.results[min(self.calls - 1, len(self.results) - 1)]


class FakeHttp:
    """按调用顺序返回预设响应。"""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.closed = False

    def get(self, url, params=None, headers=None, retries=2):
        self.calls.append(("get", url))
        return self.responses.pop(0)

    def post(self, url, data=None, headers=None, retries=2):
        self.calls.append(("post", url, data))
        return self.responses.pop(0)

    def export_cookies(self):
        return [{"name": "JSESSIONID", "value": "sess-abc", "domain": "", "path": "/"}]

    def close(self):
        self.closed = True


def _resp(text="", url="https://permit.mee.gov.cn/permitExt/outside/index", status=200):
    return HttpResponse(status_code=status, url=url, content=b"", headers={}, text=text)


def test_login_success(config):
    http = FakeHttp([
        _resp(LOGIN_PAGE_HTML, url=config.cas_login_url),   # 登录页
        _resp("", url="https://permit.mee.gov.cn/cas/kaptcha.jpg"),  # 验证码图片
        _resp("", url="https://permit.mee.gov.cn/permitExt/outside/LicenseRedirect"),  # 302 后
    ])
    captcha = FakeCaptcha(["abcd"])
    auth = AuthManager(config, http=http, captcha=captcha)
    state = auth.login()
    assert state.is_valid()
    assert state.session_id == "sess-abc"
    assert state.profile.user_account == "testuser"


def test_login_captcha_retry(config):
    # 第一次识别失败（空），第二次成功
    http = FakeHttp([
        _resp(LOGIN_PAGE_HTML, url=config.cas_login_url),
        _resp("", url="https://permit.mee.gov.cn/cas/kaptcha.jpg"),
        _resp(LOGIN_PAGE_HTML, url=config.cas_login_url),  # 重试：重新获取登录页
        _resp("", url="https://permit.mee.gov.cn/cas/kaptcha.jpg"),
        _resp("", url="https://permit.mee.gov.cn/permitExt/outside/LicenseRedirect"),
    ])
    captcha = FakeCaptcha(["", "wxyz"])
    auth = AuthManager(config, http=http, captcha=captcha)
    state = auth.login()
    assert state.is_valid()
    assert captcha.calls == 2


def test_login_all_retries_fail_raises_human_assist(config):
    http = FakeHttp([
        _resp(LOGIN_PAGE_HTML, url=config.cas_login_url),
        _resp("", url="https://permit.mee.gov.cn/cas/kaptcha.jpg"),
    ] * 3)
    captcha = FakeCaptcha(["", "", ""])
    auth = AuthManager(config, http=http, captcha=captcha)
    with pytest.raises(HumanAssistRequired):
        auth.login()


def test_login_wrong_password_fails(config):
    # POST 后仍停留在 CAS 登录页 → 登录失败
    http = FakeHttp([
        _resp(LOGIN_PAGE_HTML, url=config.cas_login_url),
        _resp("", url="https://permit.mee.gov.cn/cas/kaptcha.jpg"),
        _resp("", url="https://permit.mee.gov.cn/cas/login?error=true"),
    ])
    captcha = FakeCaptcha(["abcd"])
    auth = AuthManager(config, http=http, captcha=captcha)
    with pytest.raises(HumanAssistRequired):
        auth.login()


def test_logout_and_status(config):
    http = FakeHttp([
        _resp(LOGIN_PAGE_HTML, url=config.cas_login_url),
        _resp("", url="https://permit.mee.gov.cn/cas/kaptcha.jpg"),
        _resp("", url="https://permit.mee.gov.cn/permitExt/outside/LicenseRedirect"),
    ])
    auth = AuthManager(config, http=http, captcha=FakeCaptcha(["abcd"]))
    auth.login()
    assert auth.status()["valid"] is True
    auth.logout()
    assert auth.status()["valid"] is False


def test_ensure_session_relogin_when_expired(config):
    http = FakeHttp([
        _resp(LOGIN_PAGE_HTML, url=config.cas_login_url),
        _resp("", url="https://permit.mee.gov.cn/cas/kaptcha.jpg"),
        _resp("", url="https://permit.mee.gov.cn/permitExt/outside/LicenseRedirect"),
    ])
    auth = AuthManager(config, http=http, captcha=FakeCaptcha(["abcd"]))
    state = auth.login()
    # 手动置为过期
    from datetime import datetime, timedelta

    state.expires_at = datetime.now() - timedelta(seconds=10)
    # 重登需要新的响应序列
    http.responses = [
        _resp(LOGIN_PAGE_HTML, url=config.cas_login_url),
        _resp("", url="https://permit.mee.gov.cn/cas/kaptcha.jpg"),
        _resp("", url="https://permit.mee.gov.cn/permitExt/outside/LicenseRedirect"),
    ]
    fresh = auth.ensure_session()
    assert fresh.is_valid()
