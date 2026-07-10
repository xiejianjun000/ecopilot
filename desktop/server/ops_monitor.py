#!/usr/bin/env python3
"""
EcoPilot 运维监控平台 — 后端核心
================================
职责：
  1. 事件采集 API（前端 SDK + 后端中间件上报）
  2. SQLite 存储（零依赖）
  3. 看板数据查询 API
  4. 反馈实时聚合 + 告警

数据模型：
  events(id, ts, type, user_id, enterprise, event_data, severity)
    type: page_view|chat|tool_call|error|feedback|download|login|upload|api_latency
    severity: info|warning|error|critical
"""
from __future__ import annotations
import sqlite3, json, time, os, threading
from pathlib import Path
from datetime import datetime, timedelta
from typing import Any, Optional
from collections import defaultdict

# ─── 存储路径 ───
MONITOR_DIR = Path.home() / ".ecopilot-home" / "monitor"
MONITOR_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = MONITOR_DIR / "events.db"

# ─── 线程安全锁 ───
_DB_LOCK = threading.Lock()

# ─── 事件类型枚举 ───
EVENT_TYPES = {
    "page_view", "chat", "tool_call", "error", "feedback",
    "download", "login", "upload", "api_latency", "license_verify",
    "onboarding_step", "vault_sync", "knowledge_search",
}

SEVERITY_LEVELS = {"info", "warning", "error", "critical"}


def _get_db() -> sqlite3.Connection:
    """获取数据库连接（带 WAL 模式提升并发）"""
    conn = sqlite3.connect(str(DB_PATH), timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def _init_db() -> None:
    """初始化表结构"""
    with _DB_LOCK, _get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts REAL NOT NULL,
                type TEXT NOT NULL,
                severity TEXT DEFAULT 'info',
                user_id TEXT,
                enterprise TEXT,
                event_data TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
            CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
            CREATE INDEX IF NOT EXISTS idx_events_severity ON events(severity);
            CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);
        """)
        # 反馈表（独立，方便快速查看）
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts REAL NOT NULL,
                user_id TEXT,
                enterprise TEXT,
                message TEXT NOT NULL,
                contact TEXT,
                status TEXT DEFAULT 'pending',
                response TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_feedback_ts ON feedback(ts);
            CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
        """)
        # 告警表
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts REAL NOT NULL,
                severity TEXT NOT NULL,
                source TEXT,
                title TEXT NOT NULL,
                detail TEXT,
                acknowledged INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts(ts);
            CREATE INDEX IF NOT EXISTS idx_alerts_ack ON alerts(acknowledged);
        """)


# ═══════════════════════════════════════════════════════
# 事件采集
# ═══════════════════════════════════════════════════════

def record_event(
    event_type: str,
    severity: str = "info",
    user_id: Optional[str] = None,
    enterprise: Optional[str] = None,
    **event_data,
) -> int:
    """记录事件，返回事件 ID"""
    if event_type not in EVENT_TYPES:
        event_type = "info"
    if severity not in SEVERITY_LEVELS:
        severity = "info"

    ts = time.time()
    data_json = json.dumps(event_data, ensure_ascii=False, default=str) if event_data else None

    with _DB_LOCK, _get_db() as conn:
        cur = conn.execute(
            "INSERT INTO events (ts, type, severity, user_id, enterprise, event_data) VALUES (?, ?, ?, ?, ?, ?)",
            (ts, event_type, severity, user_id, enterprise, data_json),
        )
        event_id = cur.lastrowid

    # 严重事件自动生成告警
    if severity in ("error", "critical"):
        _create_alert(
            severity=severity,
            source=event_type,
            title=f"{event_type} 事件: {event_data.get('error', event_data.get('message', ''))[:100]}",
            detail=json.dumps(event_data, ensure_ascii=False, default=str),
        )

    return event_id


def record_feedback(
    message: str,
    contact: str = "",
    user_id: Optional[str] = None,
    enterprise: Optional[str] = None,
) -> int:
    """记录用户反馈"""
    ts = time.time()
    with _DB_LOCK, _get_db() as conn:
        cur = conn.execute(
            "INSERT INTO feedback (ts, user_id, enterprise, message, contact, status) VALUES (?, ?, ?, ?, ?, 'pending')",
            (ts, user_id, enterprise, message, contact),
        )
        fb_id = cur.lastrowid

    # 反馈自动生成 info 告警（让运维第一时间看到）
    _create_alert(
        severity="info",
        source="feedback",
        title=f"新用户反馈: {message[:80]}",
        detail=json.dumps({"feedback_id": fb_id, "contact": contact, "message": message}, ensure_ascii=False),
    )
    return fb_id


def _create_alert(severity: str, source: str, title: str, detail: str = "") -> int:
    """创建告警"""
    ts = time.time()
    with _DB_LOCK, _get_db() as conn:
        cur = conn.execute(
            "INSERT INTO alerts (ts, severity, source, title, detail) VALUES (?, ?, ?, ?, ?)",
            (ts, severity, source, title, detail),
        )
        return cur.lastrowid


def acknowledge_alert(alert_id: int) -> bool:
    """标记告警已处理"""
    with _DB_LOCK, _get_db() as conn:
        cur = conn.execute("UPDATE alerts SET acknowledged = 1 WHERE id = ?", (alert_id,))
        return cur.rowcount > 0


# ═══════════════════════════════════════════════════════
# 看板数据查询
# ═══════════════════════════════════════════════════════

def _ts_days_ago(days: int) -> float:
    return (datetime.now() - timedelta(days=days)).timestamp()


def dashboard_overview(days: int = 7) -> dict:
    """看板首页总览数据"""
    since = _ts_days_ago(days)
    with _get_db() as conn:
        # 总事件数
        total_events = conn.execute("SELECT COUNT(*) as c FROM events WHERE ts >= ?", (since,)).fetchone()["c"]

        # 按类型分组
        by_type = {
            row["type"]: row["c"]
            for row in conn.execute(
                "SELECT type, COUNT(*) as c FROM events WHERE ts >= ? GROUP BY type ORDER BY c DESC",
                (since,),
            )
        }

        # 按严重度分组
        by_severity = {
            row["severity"]: row["c"]
            for row in conn.execute(
                "SELECT severity, COUNT(*) as c FROM events WHERE ts >= ? GROUP BY severity",
                (since,),
            )
        }

        # 活跃用户数（去重 user_id）
        active_users = conn.execute(
            "SELECT COUNT(DISTINCT user_id) as c FROM events WHERE ts >= ? AND user_id IS NOT NULL AND user_id != ''",
            (since,),
        ).fetchone()["c"]

        # 企业数
        active_enterprises = conn.execute(
            "SELECT COUNT(DISTINCT enterprise) as c FROM events WHERE ts >= ? AND enterprise IS NOT NULL AND enterprise != ''",
            (since,),
        ).fetchone()["c"]

        # 错误率
        error_count = by_severity.get("error", 0) + by_severity.get("critical", 0)
        error_rate = (error_count / total_events * 100) if total_events > 0 else 0

        # 反馈数
        feedback_count = conn.execute("SELECT COUNT(*) as c FROM feedback WHERE ts >= ?", (since,)).fetchone()["c"]

        # 未处理告警数
        unack_alerts = conn.execute(
            "SELECT COUNT(*) as c FROM alerts WHERE acknowledged = 0 AND ts >= ?",
            (since,),
        ).fetchone()["c"]

        return {
            "days": days,
            "total_events": total_events,
            "by_type": by_type,
            "by_severity": by_severity,
            "active_users": active_users,
            "active_enterprises": active_enterprises,
            "error_rate": round(error_rate, 2),
            "feedback_count": feedback_count,
            "unack_alerts": unack_alerts,
        }


def dashboard_timeseries(days: int = 7, granularity: str = "day") -> list[dict]:
    """时间序列数据（按天或小时聚合）"""
    since = _ts_days_ago(days)
    fmt = "%Y-%m-%d" if granularity == "day" else "%Y-%m-%d %H:00"
    with _get_db() as conn:
        rows = conn.execute(
            f"""
            SELECT
                strftime('{fmt}', datetime(ts, 'unixepoch', 'localtime')) as bucket,
                COUNT(*) as total,
                SUM(CASE WHEN severity='error' OR severity='critical' THEN 1 ELSE 0 END) as errors,
                SUM(CASE WHEN type='chat' THEN 1 ELSE 0 END) as chats,
                SUM(CASE WHEN type='login' THEN 1 ELSE 0 END) as logins,
                COUNT(DISTINCT user_id) as unique_users
            FROM events
            WHERE ts >= ?
            GROUP BY bucket
            ORDER BY bucket
            """,
            (since,),
        ).fetchall()
        return [dict(r) for r in rows]


def dashboard_recent_events(limit: int = 50, severity: Optional[str] = None) -> list[dict]:
    """最近事件流"""
    with _get_db() as conn:
        if severity:
            rows = conn.execute(
                "SELECT * FROM events WHERE severity = ? ORDER BY ts DESC LIMIT ?",
                (severity, limit),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM events ORDER BY ts DESC LIMIT ?", (limit,)).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            if d.get("event_data"):
                try:
                    d["event_data"] = json.loads(d["event_data"])
                except Exception:
                    pass
            d["ts_str"] = datetime.fromtimestamp(d["ts"]).strftime("%Y-%m-%d %H:%M:%S")
            result.append(d)
        return result


def dashboard_recent_feedback(limit: int = 20) -> list[dict]:
    """最近反馈"""
    with _get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM feedback ORDER BY ts DESC LIMIT ?",
            (limit,),
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["ts_str"] = datetime.fromtimestamp(d["ts"]).strftime("%Y-%m-%d %H:%M:%S")
            result.append(d)
        return result


def dashboard_alerts(only_unack: bool = False, limit: int = 50) -> list[dict]:
    """告警列表"""
    with _get_db() as conn:
        if only_unack:
            rows = conn.execute(
                "SELECT * FROM alerts WHERE acknowledged = 0 ORDER BY ts DESC LIMIT ?",
                (limit,),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM alerts ORDER BY ts DESC LIMIT ?", (limit,)).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["ts_str"] = datetime.fromtimestamp(d["ts"]).strftime("%Y-%m-%d %H:%M:%S")
            result.append(d)
        return result


def dashboard_top_enterprises(days: int = 7, limit: int = 10) -> list[dict]:
    """Top 活跃企业"""
    since = _ts_days_ago(days)
    with _get_db() as conn:
        rows = conn.execute(
            """
            SELECT
                enterprise,
                COUNT(*) as events,
                COUNT(DISTINCT user_id) as users,
                SUM(CASE WHEN severity='error' THEN 1 ELSE 0 END) as errors,
                MAX(ts) as last_active
            FROM events
            WHERE ts >= ? AND enterprise IS NOT NULL AND enterprise != ''
            GROUP BY enterprise
            ORDER BY events DESC
            LIMIT ?
            """,
            (since, limit),
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["last_active_str"] = datetime.fromtimestamp(d["last_active"]).strftime("%Y-%m-%d %H:%M") if d["last_active"] else ""
            result.append(d)
        return result


def dashboard_api_latency(days: int = 1) -> dict:
    """API 延迟统计"""
    since = _ts_days_ago(days)
    with _get_db() as conn:
        rows = conn.execute(
            """
            SELECT event_data FROM events
            WHERE type = 'api_latency' AND ts >= ?
            """,
            (since,),
        ).fetchall()
        latencies = []
        by_endpoint: dict[str, list[float]] = defaultdict(list)
        for r in rows:
            try:
                data = json.loads(r["event_data"])
                latency = data.get("latency_ms")
                endpoint = data.get("endpoint", "unknown")
                if latency is not None:
                    latencies.append(latency)
                    by_endpoint[endpoint].append(latency)
            except Exception:
                continue

        if not latencies:
            return {"count": 0, "avg_ms": 0, "p50_ms": 0, "p95_ms": 0, "p99_ms": 0, "by_endpoint": {}}

        latencies.sort()
        n = len(latencies)
        endpoint_stats = {}
        for ep, vals in by_endpoint.items():
            vals.sort()
            m = len(vals)
            endpoint_stats[ep] = {
                "count": m,
                "avg_ms": round(sum(vals) / m, 1),
                "p50_ms": round(vals[m // 2], 1),
                "p95_ms": round(vals[int(m * 0.95)] if m > 20 else vals[-1], 1),
            }

        return {
            "count": n,
            "avg_ms": round(sum(latencies) / n, 1),
            "p50_ms": round(latencies[n // 2], 1),
            "p95_ms": round(latencies[int(n * 0.95)] if n > 20 else latencies[-1], 1),
            "p99_ms": round(latencies[int(n * 0.99)] if n > 100 else latencies[-1], 1),
            "by_endpoint": endpoint_stats,
        }


# ═══════════════════════════════════════════════════════
# 响应反馈
# ═══════════════════════════════════════════════════════

def respond_to_feedback(feedback_id: int, response: str) -> bool:
    """回复反馈"""
    with _DB_LOCK, _get_db() as conn:
        cur = conn.execute(
            "UPDATE feedback SET response = ?, status = 'responded' WHERE id = ?",
            (response, feedback_id),
        )
        return cur.rowcount > 0


# ═══════════════════════════════════════════════════════
# 初始化
# ═══════════════════════════════════════════════════════

_init_db()

# 启动时记录一条服务启动事件
record_event("page_view", severity="info", event_data={"message": "EcoPilot 后端服务启动", "pid": os.getpid()})
