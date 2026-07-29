"""Ops route integration tests — test the extracted routes/ops.py module"""
import pytest
from fastapi.testclient import TestClient as FastAPITestClient


@pytest.fixture
def client():
    """Create a test client for the ops router only"""
    from fastapi import FastAPI
    from routes.ops import router as ops_router

    app = FastAPI()
    app.include_router(ops_router)
    return FastAPITestClient(app)


class TestOpsDashboard:
    def test_dashboard_returns_ok(self, client):
        resp = client.get("/api/ops/dashboard")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert "overview" in data
        assert "timeseries" in data

    def test_dashboard_respects_days_param(self, client):
        resp = client.get("/api/ops/dashboard?days=30")
        assert resp.status_code == 200

    def test_dashboard_default_days(self, client):
        resp = client.get("/api/ops/dashboard")
        assert resp.status_code == 200


class TestOpsEvents:
    def test_events_returns_list(self, client):
        resp = client.get("/api/ops/events")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert "events" in data

    def test_events_with_limit(self, client):
        resp = client.get("/api/ops/events?limit=10")
        assert resp.status_code == 200

    def test_events_filter_by_severity(self, client):
        resp = client.get("/api/ops/events?severity=error")
        assert resp.status_code == 200


class TestOpsAlerts:
    def test_alerts_returns_list(self, client):
        resp = client.get("/api/ops/alerts")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert "alerts" in data

    def test_alerts_unack_only(self, client):
        resp = client.get("/api/ops/alerts?unack=1")
        assert resp.status_code == 200


class TestOpsEventRecording:
    def test_record_event_anonymous(self, client):
        resp = client.post(
            "/api/ops/event",
            json={"type": "test_smoke", "severity": "info"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data.get("event_id") is not None

    def test_record_event_with_metadata(self, client):
        resp = client.post(
            "/api/ops/event",
            json={
                "type": "page_view",
                "severity": "info",
                "user_id": "test-user",
                "enterprise": "test-company",
                "path": "/dashboard",
            },
        )
        assert resp.status_code == 200


class TestOpsFeedback:
    def test_feedback_list(self, client):
        resp = client.get("/api/ops/feedback")
        assert resp.status_code == 200

    def test_feedback_respond_missing_fields(self, client):
        resp = client.post("/api/ops/feedback/respond", json={})
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is False
        assert "detail" in data


class TestOpsEnterprises:
    def test_enterprises_list(self, client):
        resp = client.get("/api/ops/enterprises")
        assert resp.status_code == 200


class TestNotifications:
    def test_notifications_returns_ok(self, client):
        resp = client.get("/api/notifications")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert "data" in data
        assert isinstance(data["data"], list)
