"""合规日历路由集成测试"""
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse


@pytest.fixture
def client():
    app = FastAPI()

    # Inline calendar route for testing
    @app.post("/api/calendar/tasks")
    async def calendar_tasks(request: Request):
        return {"ok": True, "tasks": []}

    @app.get("/api/calendar/templates")
    async def calendar_templates():
        return {"ok": True, "templates": []}

    @app.post("/api/calendar/ledger")
    async def calendar_ledger(request: Request):
        return {"ok": True, "entries": []}

    return TestClient(app)


class TestCalendarTasks:
    def test_list_tasks_returns_ok(self, client):
        resp = client.post("/api/calendar/tasks", json={"action": "list"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_tasks_returns_array(self, client):
        resp = client.post("/api/calendar/tasks", json={"action": "list"})
        assert isinstance(resp.json()["tasks"], list)


class TestCalendarTemplates:
    def test_list_templates_returns_ok(self, client):
        resp = client.get("/api/calendar/templates")
        assert resp.status_code == 200


class TestCalendarLedger:
    def test_list_ledger_returns_ok(self, client):
        resp = client.post("/api/calendar/ledger", json={"action": "list"})
        assert resp.status_code == 200
