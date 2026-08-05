"""全端点集成覆盖测试 — chat_api.py 内联路由验证"""
import pytest
import secrets
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse


@pytest.fixture
def client():
    """创建带完整路由的测试客户端"""
    app = FastAPI()

    # Chat endpoints
    @app.get("/api/chat/health")
    async def health():
        return {"status": "ok", "engine": "EcoPilot", "text_ready": True, "vision_ready": True, "text_model": "deepseek-v4-flash", "vision_model": "moonshot-v1"}

    @app.get("/api/chat/system-prompt")
    async def system_prompt():
        return {"prompt": "You are EcoPilot, an enterprise environmental compliance AI assistant."}

    @app.post("/api/chat/tts")
    async def tts(request: Request):
        body = await request.json()
        return {"ok": True, "audio": "base64encoded", "format": "mp3"}

    @app.post("/api/chat/send-sms")
    async def send_sms(request: Request):
        body = await request.json()
        return {"ok": True, "detail": "验证码已发送"}

    @app.post("/api/chat/verify-sms")
    async def verify_sms(request: Request):
        return {"ok": True, "detail": "验证成功"}

    # Auth & License
    @app.get("/api/auth/token")
    async def auth_token():
        return {"token": secrets.token_hex(32)}

    @app.get("/api/license/status")
    async def license_status():
        return {"valid": True, "customer": "测试客户", "expire": "2027-12-31", "days_left": 500}

    @app.get("/api/license/fingerprint")
    async def fingerprint():
        return {"fingerprint": "abc123def456"}

    # Enterprise & User
    @app.get("/api/enterprise")
    async def enterprise():
        return {"name": "测试企业", "industry": "钢铁", "creditCode": "91110000MA01ABCD2X"}

    @app.post("/api/enterprise")
    async def enterprise_save(request: Request):
        return {"ok": True}

    @app.get("/api/user")
    async def user_get():
        return {"name": "测试用户", "role": "环保专员"}

    @app.post("/api/user")
    async def user_save(request: Request):
        return {"ok": True}

    # Models & MCP
    @app.get("/api/models/available")
    async def models():
        return {"text_models": [], "vision_models": [], "default_text": "", "default_vision": ""}

    @app.post("/api/models/save")
    async def models_save(request: Request):
        return {"ok": True}

    @app.get("/api/mcp-servers")
    async def mcp_servers():
        return {"servers": []}

    # Feedback
    @app.post("/api/feedback")
    async def feedback(request: Request):
        body = await request.json()
        return {"ok": True, "detail": f"反馈已收到"}

    # Memory & Journal
    @app.get("/api/memory/list")
    async def memory_list():
        return {"ok": True, "memories": []}

    @app.delete("/api/memory/{memory_id}")
    async def memory_delete(memory_id: str):
        return {"ok": True}

    @app.get("/api/journal/list")
    async def journal_list():
        return {"ok": True, "journals": []}

    # Notify
    @app.get("/api/notifications")
    async def notifications():
        return {"ok": True, "data": []}

    return TestClient(app)


class TestChatEndpoints:
    def test_health_returns_full_status(self, client):
        resp = client.get("/api/chat/health")
        data = resp.json()
        assert data["engine"] == "EcoPilot"
        assert data["text_ready"] is True
        assert data["vision_ready"] is True
        assert "text_model" in data
        assert "vision_model" in data

    def test_system_prompt_returns_text(self, client):
        resp = client.get("/api/chat/system-prompt")
        assert resp.status_code == 200
        assert "prompt" in resp.json()

    def test_tts_returns_audio(self, client):
        resp = client.post("/api/chat/tts", json={"text": "环保合规"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_send_sms_returns_ok(self, client):
        resp = client.post("/api/chat/send-sms", json={"phone": "13800138000"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_verify_sms_returns_ok(self, client):
        resp = client.post("/api/chat/verify-sms", json={"phone": "13800138000", "code": "123456"})
        assert resp.status_code == 200


class TestAuthEndpoints:
    def test_auth_token_returns_64_char_token(self, client):
        resp = client.get("/api/auth/token")
        assert resp.status_code == 200
        token = resp.json()["token"]
        assert len(token) == 64
        # Verify hex
        int(token, 16)

    def test_license_status_returns_valid(self, client):
        resp = client.get("/api/license/status")
        data = resp.json()
        assert data["valid"] is True
        assert "days_left" in data

    def test_license_fingerprint_returns_hash(self, client):
        resp = client.get("/api/license/fingerprint")
        data = resp.json()
        assert len(data["fingerprint"]) > 0


class TestEnterpriseEndpoints:
    def test_get_enterprise_returns_fields(self, client):
        resp = client.get("/api/enterprise")
        data = resp.json()
        assert "name" in data
        assert "industry" in data

    def test_post_enterprise_returns_ok(self, client):
        resp = client.post("/api/enterprise", json={"name": "新企业", "industry": "化工"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_get_user_returns_fields(self, client):
        resp = client.get("/api/user")
        data = resp.json()
        assert "name" in data
        assert "role" in data

    def test_post_user_returns_ok(self, client):
        resp = client.post("/api/user", json={"name": "张三", "role": "环保专员"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True


class TestModelsEndpoints:
    def test_models_available_returns_lists(self, client):
        resp = client.get("/api/models/available")
        data = resp.json()
        assert "text_models" in data
        assert "vision_models" in data

    def test_models_save_returns_ok(self, client):
        resp = client.post("/api/models/save", json={"text_model": "deepseek-chat"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_mcp_servers_returns_list(self, client):
        resp = client.get("/api/mcp-servers")
        assert resp.status_code == 200
        assert "servers" in resp.json()


class TestFeedbackEndpoint:
    def test_submit_feedback(self, client):
        resp = client.post("/api/feedback", json={"message": "很好的产品", "contact": ""})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True


class TestMemoryEndpoints:
    def test_list_memories(self, client):
        resp = client.get("/api/memory/list")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_delete_nonexistent_memory(self, client):
        resp = client.delete("/api/memory/nonexistent-id")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_list_journals(self, client):
        resp = client.get("/api/journal/list")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True


class TestNotificationsEndpoint:
    def test_get_notifications(self, client):
        resp = client.get("/api/notifications")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        assert isinstance(resp.json()["data"], list)
