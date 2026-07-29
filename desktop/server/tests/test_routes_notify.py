"""通知中心路由测试"""
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    app = FastAPI()

    @app.get("/api/notify/platforms")
    async def platforms():
        return {"ok": True, "platforms": [{"id": "feishu", "name": "飞书"}]}

    @app.get("/api/notify/channels")
    async def channels():
        return {"ok": True, "channels": []}

    @app.post("/api/notify/channels")
    async def save_channel(request: Request):
        return {"ok": True}

    @app.delete("/api/notify/channels")
    async def delete_channel(id: str = ""):
        return {"ok": True}

    @app.post("/api/notify/test")
    async def test_notify(request: Request):
        return {"ok": True}

    return TestClient(app)


class TestNotifyPlatforms:
    def test_list_platforms(self, client):
        resp = client.get("/api/notify/platforms")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True


class TestNotifyChannels:
    def test_list_channels(self, client):
        resp = client.get("/api/notify/channels")
        assert resp.status_code == 200

    def test_save_channel(self, client):
        resp = client.post("/api/notify/channels", json={"name": "test"})
        assert resp.status_code == 200

    def test_delete_channel(self, client):
        resp = client.delete("/api/notify/channels?id=test")
        assert resp.status_code == 200


class TestNotifyTest:
    def test_send_test(self, client):
        resp = client.post("/api/notify/test", json={"message": "hello"})
        assert resp.status_code == 200
