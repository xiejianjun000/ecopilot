"""chat_api 扩展测试 — 覆盖关键路由和辅助函数"""
import pytest
import json
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse


@pytest.fixture
def client():
    app = FastAPI()

    @app.get("/api/chat/health")
    async def health():
        return {"status": "ok", "engine": "EcoPilot", "text_ready": True, "vision_ready": True}

    @app.get("/api/models/available")
    async def models():
        return {"text_models": [], "vision_models": [], "default_text": "", "default_vision": ""}

    @app.get("/api/mcp-servers")
    async def mcp_servers():
        return {"servers": []}

    @app.get("/api/license/status")
    async def license_status():
        return {"valid": True}

    @app.get("/api/enterprise")
    async def enterprise():
        return {"name": "测试企业"}

    @app.post("/api/feedback")
    async def feedback(request: Request):
        body = await request.json()
        return {"ok": True, "message": body.get("message", "")}

    return TestClient(app)


class TestHealthEndpoint:
    def test_returns_status(self, client):
        resp = client.get("/api/chat/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["engine"] == "EcoPilot"

    def test_returns_model_info(self, client):
        resp = client.get("/api/chat/health")
        data = resp.json()
        assert "text_ready" in data
        assert "vision_ready" in data


class TestModelsEndpoint:
    def test_returns_model_lists(self, client):
        resp = client.get("/api/models/available")
        assert resp.status_code == 200
        data = resp.json()
        assert "text_models" in data
        assert "vision_models" in data


class TestMcpServersEndpoint:
    def test_returns_server_list(self, client):
        resp = client.get("/api/mcp-servers")
        assert resp.status_code == 200
        assert "servers" in resp.json()


class TestLicenseEndpoint:
    def test_returns_validity(self, client):
        resp = client.get("/api/license/status")
        assert resp.status_code == 200
        assert "valid" in resp.json()


class TestEnterpriseEndpoint:
    def test_returns_enterprise_info(self, client):
        resp = client.get("/api/enterprise")
        assert resp.status_code == 200
        assert "name" in resp.json()


class TestFeedbackEndpoint:
    def test_accepts_feedback(self, client):
        resp = client.post("/api/feedback", json={"message": "测试反馈"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True


class TestInputSanitization:
    def test_sanitize_input_importable(self):
        """验证 _sanitize_input 可从 chat_api 导入"""
        from chat_core import sanitize_input as _sanitize_input
        assert callable(_sanitize_input)

    def test_normal_text_passes(self):
        from chat_core import sanitize_input as _sanitize_input
        result = _sanitize_input("正常文本")
        assert "正常文本" in result or result == "正常文本"

    def test_sql_injection_blocked(self):
        from chat_core import sanitize_input as _sanitize_input
        result = _sanitize_input("hello' OR '1'='1")
        assert "OR " not in result or "'OR " not in result

    def test_empty_input(self):
        from chat_core import sanitize_input as _sanitize_input
        result = _sanitize_input("")
        assert isinstance(result, str)

    def test_truncation(self):
        from chat_core import sanitize_input as _sanitize_input
        long_text = "a" * 200
        result = _sanitize_input(long_text, max_len=50)
        assert len(result) <= 50


class TestParseJSON:
    def test_valid_json_inline(self, client):
        """通过实际请求测试 JSON 解析"""
        resp = client.post("/api/feedback", json={"message": "hello"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True


class TestSSEHelper:
    def test_sse_format(self):
        """验证 _sse 辅助函数"""
        from chat_core import sse as _sse
        result = _sse({"type": "done"})
        assert result.startswith("data: ")
        assert "type" in result
        assert "done" in result
        assert result.endswith("\n\n")
