"""
EcoPilot SQLite 数据库连接 — WAL 模式，单例

用法:
    from db.connection import get_db
    db = get_db()
    db.execute("SELECT * FROM enterprises WHERE id = ?", [eid])
"""

import sqlite3
import threading
from pathlib import Path

DB_DIR = Path.home() / ".ecopilot-home" / "db"
DB_PATH = DB_DIR / "ecopilot.db"

_local = threading.local()


def get_db() -> sqlite3.Connection:
    """获取线程本地数据库连接（WAL 模式）"""
    if not hasattr(_local, "conn") or _local.conn is None:
        DB_DIR.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=5000")
        _local.conn = conn
        _migrate(conn)
    return _local.conn


def _migrate(conn: sqlite3.Connection):
    """自动建表（幂等）"""
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS enterprises (
        id TEXT PRIMARY KEY DEFAULT 'default',
        name TEXT NOT NULL DEFAULT '',
        credit_code TEXT DEFAULT '',
        permit_number TEXT DEFAULT '',
        industry TEXT DEFAULT '',
        address TEXT DEFAULT '',
        management_level TEXT DEFAULT '',
        legal_person TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        data TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS permit_data (
        id TEXT PRIMARY KEY DEFAULT 'default',
        parsed TEXT DEFAULT '{}',
        saved_at REAL DEFAULT 0,
        execution TEXT,
        modules TEXT,
        ai_analysis TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY DEFAULT 'default',
        name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT '环保专员',
        phone TEXT DEFAULT '',
        data TEXT DEFAULT '{}',
        updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS compliance_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL DEFAULT '其他',
        content TEXT NOT NULL DEFAULT '',
        risk_level TEXT DEFAULT 'info',
        source_session TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS work_journals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        title TEXT DEFAULT '',
        content TEXT DEFAULT '',
        entries_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS ops_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL DEFAULT 'unknown',
        severity TEXT DEFAULT 'info',
        user_id TEXT,
        enterprise TEXT,
        data TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_memories_category ON compliance_memories(category);
    CREATE INDEX IF NOT EXISTS idx_memories_created ON compliance_memories(created_at);
    CREATE INDEX IF NOT EXISTS idx_journals_date ON work_journals(date);
    CREATE INDEX IF NOT EXISTS idx_events_type ON ops_events(type);
    CREATE INDEX IF NOT EXISTS idx_events_severity ON ops_events(severity);
    CREATE INDEX IF NOT EXISTS idx_events_created ON ops_events(created_at);
    """)
    conn.commit()


def close_db():
    """关闭当前线程的数据库连接"""
    if hasattr(_local, "conn") and _local.conn is not None:
        _local.conn.close()
        _local.conn = None
