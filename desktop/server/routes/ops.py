"""
EcoPilot 运维监控路由 — 看板/事件/反馈/告警/通知

提取自 chat_api.py (v1.1 模块化)
"""

import json as _json
from fastapi import APIRouter, Request
from core.config import HERMES_HOME
import ops_monitor as _ops

router = APIRouter(prefix="/api", tags=["ops"])


@router.get("/ops/dashboard")
async def ops_dashboard(request: Request):
    """看板总览数据"""
    days = int(request.query_params.get("days", "7"))
    overview = _ops.dashboard_overview(days=days)
    timeseries = _ops.dashboard_timeseries(days=days)
    return {"ok": True, "overview": overview, "timeseries": timeseries}


@router.get("/ops/events")
async def ops_events(request: Request):
    """事件流"""
    limit = int(request.query_params.get("limit", "50"))
    severity = request.query_params.get("severity") or None
    return {
        "ok": True,
        "events": _ops.dashboard_recent_events(limit=limit, severity=severity),
    }


@router.get("/ops/feedback")
async def ops_feedback_list(request: Request):
    """反馈列表"""
    limit = int(request.query_params.get("limit", "20"))
    return {"ok": True, "feedback": _ops.dashboard_recent_feedback(limit=limit)}


@router.post("/ops/feedback/respond")
async def ops_feedback_respond(request: Request):
    """回复反馈"""
    try:
        body = await request.json()
        fb_id = int(body.get("id", 0))
        response = str(body.get("response", "")).strip()
        if not fb_id or not response:
            return {"ok": False, "detail": "id 和 response 必填"}
        ok = _ops.respond_to_feedback(fb_id, response)
        return {"ok": ok}
    except Exception as e:
        return {"ok": False, "detail": str(e)}


@router.get("/ops/alerts")
async def ops_alerts(request: Request):
    """告警列表"""
    only_unack = request.query_params.get("unack") == "1"
    limit = int(request.query_params.get("limit", "50"))
    return {
        "ok": True,
        "alerts": _ops.dashboard_alerts(only_unack=only_unack, limit=limit),
    }


@router.post("/ops/alerts/ack")
async def ops_alerts_ack(request: Request):
    """标记告警已处理"""
    try:
        body = await request.json()
        alert_id = int(body.get("id", 0))
        ok = _ops.acknowledge_alert(alert_id)
        return {"ok": ok}
    except Exception as e:
        return {"ok": False, "detail": str(e)}


@router.get("/ops/enterprises")
async def ops_enterprises(request: Request):
    """Top 活跃企业"""
    days = int(request.query_params.get("days", "7"))
    return {"ok": True, "enterprises": _ops.dashboard_top_enterprises(days=days)}


@router.get("/notifications")
async def notifications(request: Request):
    """通知中心 — 汇总最近 7 天的告警和事件"""
    items = []
    try:
        alerts = _ops.dashboard_alerts(only_unack=True, limit=20) or []
        for a in alerts:
            sev = a.get("severity", "info")
            items.append({
                "id": f"alert-{a.get('id', '0')}",
                "type": "urgent" if sev in ("critical", "error") else (
                    "warn" if sev == "warning" else "info"
                ),
                "title": a.get("message", "")[:80],
                "desc": a.get("detail", "")[:200],
                "time": a.get("created_at", ""),
                "read": False,
            })

        events = _ops.dashboard_recent_events(limit=10, severity="error") or []
        for e in events:
            items.append({
                "id": f"event-{e.get('id', '0')}",
                "type": "urgent",
                "title": e.get("type", "异常事件")[:80],
                "desc": str(e.get("data", ""))[:200],
                "time": e.get("created_at", ""),
                "read": False,
            })
    except Exception:
        pass

    if not items:
        try:
            pd_file = HERMES_HOME / "permit-data.json"
            if pd_file.exists():
                pd_obj = _json.loads(pd_file.read_text())
                parsed = pd_obj.get("parsed", {})
                if parsed.get("enterpriseName"):
                    items.append({
                        "id": "perm-reminder",
                        "type": "info",
                        "title": "许可证数据已就绪",
                        "desc": f"已读取 {parsed.get('enterpriseName', '')} 的排污许可证数据，可以开始合规咨询。",
                        "time": "",
                        "read": False,
                    })
        except Exception:
            pass

    return {"ok": True, "data": items}


@router.post("/ops/event")
async def ops_record_event(request: Request):
    """前端 SDK 上报事件（公开端点，不需鉴权）"""
    try:
        body = await request.json()
        event_type = str(body.get("type", "page_view"))
        severity = str(body.get("severity", "info"))
        user_id = body.get("user_id")
        enterprise = body.get("enterprise")
        event_data = {
            k: v
            for k, v in body.items()
            if k not in ("type", "severity", "user_id", "enterprise")
        }
        event_id = _ops.record_event(
            event_type,
            severity=severity,
            user_id=user_id,
            enterprise=enterprise,
            **event_data,
        )
        return {"ok": True, "event_id": event_id}
    except Exception as e:
        return {"ok": False, "detail": str(e)}
