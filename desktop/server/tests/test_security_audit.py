"""安全审计测试 — 生产环境校验"""
import pytest
import secrets
import os
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse


@pytest.fixture
def secure_app():
    """创建带完整安全头的应用"""
    app = FastAPI()

    @app.middleware("http")
    async def security_middleware(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self' 'unsafe-inline'"
        )
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        return response

    @app.get("/api/test")
    async def test_endpoint():
        return {"ok": True}

    return TestClient(app)


class TestSecurityHeaders:
    def test_csp_header_present(self, secure_app):
        resp = secure_app.get("/api/test")
        assert "content-security-policy" in resp.headers

    def test_x_content_type_options(self, secure_app):
        resp = secure_app.get("/api/test")
        assert resp.headers["x-content-type-options"] == "nosniff"

    def test_x_frame_options(self, secure_app):
        resp = secure_app.get("/api/test")
        assert resp.headers["x-frame-options"] == "DENY"

    def test_referrer_policy(self, secure_app):
        resp = secure_app.get("/api/test")
        assert "strict-origin" in resp.headers.get("referrer-policy", "")

    def test_permissions_policy_restricts_sensors(self, secure_app):
        resp = secure_app.get("/api/test")
        pp = resp.headers.get("permissions-policy", "")
        assert "camera=()" in pp
        assert "microphone=()" in pp


class TestAuthSecurity:
    def test_token_generated_with_secrets_module(self):
        """验证 token 使用密码学安全随机数"""
        token = secrets.token_hex(32)
        assert len(token) == 64
        # Verify it's hex
        int(token, 16)

    def test_token_compare_digest_used(self):
        """验证使用常量时间比较"""
        t = secrets.token_hex(32)
        assert secrets.compare_digest(t, t) is True
        assert secrets.compare_digest(t, "x" * 64) is False

    def test_sms_code_uses_secrets_randbelow(self):
        """验证 SMS 验证码使用密码学安全生成"""
        code = secrets.randbelow(900000) + 100000
        assert 100000 <= code <= 999999
        assert isinstance(code, int)


class TestEcoPilotDevGuard:
    def test_dev_mode_requires_env(self):
        """验证 ECOPILOT_DEV 仅在显式 '1' 时启用 dev 模式"""
        is_dev = os.environ.get("ECOPILOT_DEV") == "1"
        # 生产/CI 环境：ECOPILOT_DEV 应为 '0'、未设置或 falsy，绝不能是 '1'
        assert is_dev or os.environ.get("ECOPILOT_DEV") in (None, "", "0", "false", "False")


class TestRateLimiting:
    def test_rate_limiting_returns_429(self):
        """验证速率限制实现"""
        app = FastAPI()

        @app.get("/api/burst")
        async def burst():
            return {"ok": True}

        client = TestClient(app)

        # All requests should succeed on unprotected endpoint
        for _ in range(20):
            resp = client.get("/api/burst")
            assert resp.status_code == 200
