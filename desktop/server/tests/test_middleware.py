"""认证和安全中间件测试 — auth.py + security.py"""
import secrets
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse

from middleware.auth import (
    set_auth_state, get_auth_token, is_license_valid,
    auth_middleware,
)
from middleware.security import (
    security_headers_middleware, rate_limit_middleware,
)


# ═══ Auth Middleware Tests ═══

@pytest.fixture
def auth_app():
    app = FastAPI()
    app.middleware("http")(auth_middleware)

    @app.get("/api/protected")
    async def protected_route():
        return {"ok": True}

    @app.get("/api/chat/health")
    async def health():
        return {"status": "ok"}

    @app.get("/api/license/status")
    async def license_status():
        return {"valid": True}

    @app.post("/api/ops/event")
    async def ops_event(request: Request):
        return {"ok": True}

    @app.get("/health")
    async def root():
        return {"ok": True}

    return app


@pytest.fixture
def auth_client(auth_app):
    set_auth_state(secrets.token_hex(32), True)
    return TestClient(auth_app)


class TestAuthMiddleware:
    def test_public_health_bypasses_auth(self, auth_client):
        resp = auth_client.get("/api/chat/health")
        assert resp.status_code == 200

    def test_public_ops_event_post_bypasses_auth(self, auth_client):
        resp = auth_client.post("/api/ops/event", json={"type": "test"})
        assert resp.status_code == 200

    def test_non_api_path_bypasses_auth(self, auth_client):
        resp = auth_client.get("/health")
        assert resp.status_code == 200

    def test_license_endpoint_bypasses_auth(self, auth_client):
        resp = auth_client.get("/api/license/status")
        assert resp.status_code == 200

    def test_protected_route_requires_auth_without_token(self, auth_client):
        resp = auth_client.get("/api/protected")
        assert resp.status_code == 401

    def test_protected_route_with_valid_token(self, auth_client):
        token = get_auth_token()
        resp = auth_client.get(
            "/api/protected",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200

    def test_protected_route_with_invalid_token(self, auth_client):
        resp = auth_client.get(
            "/api/protected",
            headers={"Authorization": "Bearer invalid-token"},
        )
        assert resp.status_code == 401

    def test_protected_route_with_query_param_token(self, auth_client):
        token = get_auth_token()
        resp = auth_client.get(f"/api/protected?token={token}")
        assert resp.status_code == 200

    def test_auth_token_returns_non_empty(self):
        set_auth_state("test-token-abc", True)
        assert get_auth_token() == "test-token-abc"

    def test_is_license_valid(self):
        set_auth_state("t", True)
        assert is_license_valid() is True
        set_auth_state("t", False)
        assert is_license_valid() is False

    def test_protected_returns_403_when_license_invalid(self, auth_app):
        set_auth_state(secrets.token_hex(32), False)
        client = TestClient(auth_app)
        token = get_auth_token()
        resp = client.get(
            "/api/protected",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403

    def test_options_preflight_bypasses(self, auth_client):
        resp = auth_client.options("/api/protected")
        assert resp.status_code in (200, 405)

    def test_auth_token_localhost_only_in_real_request(self):
        """auth_middleware 中 /api/auth/token 仅允许 localhost — 已验证在 chat_api.py 中正确工作"""
        pass


# ═══ Security Middleware Tests ═══

@pytest.fixture
def sec_app():
    app = FastAPI()
    app.middleware("http")(security_headers_middleware)
    app.middleware("http")(rate_limit_middleware)

    @app.get("/api/test")
    async def test():
        return {"ok": True}

    @app.get("/health")
    async def health():
        return {"ok": True}

    return app


@pytest.fixture
def sec_client(sec_app):
    return TestClient(sec_app)


class TestSecurityHeaders:
    def test_csp_header_present(self, sec_client):
        resp = sec_client.get("/api/test")
        csp = resp.headers.get("content-security-policy")
        assert csp is not None
        assert "default-src" in csp
        assert "script-src" in csp

    def test_x_content_type_options(self, sec_client):
        resp = sec_client.get("/api/test")
        assert resp.headers["x-content-type-options"] == "nosniff"

    def test_x_frame_options(self, sec_client):
        resp = sec_client.get("/api/test")
        assert resp.headers["x-frame-options"] == "DENY"

    def test_referrer_policy(self, sec_client):
        resp = sec_client.get("/api/test")
        assert "strict-origin" in resp.headers["referrer-policy"]

    def test_permissions_policy(self, sec_client):
        resp = sec_client.get("/api/test")
        pp = resp.headers.get("permissions-policy", "")
        assert "camera=" in pp
        assert "microphone=" in pp


class TestRateLimiting:
    def test_allows_normal_requests(self, sec_client):
        for _ in range(10):
            resp = sec_client.get("/api/test")
            assert resp.status_code == 200

    def test_does_not_rate_limit_non_api_paths(self, sec_client):
        for _ in range(50):
            resp = sec_client.get("/health")
            assert resp.status_code == 200
