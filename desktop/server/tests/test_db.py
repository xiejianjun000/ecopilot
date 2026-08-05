"""SQLite 数据库层测试"""
import pytest
import tempfile
from pathlib import Path


@pytest.fixture
def db(monkeypatch):
    """创建临时数据库进行测试"""
    import db.connection as conn
    tmp = Path(tempfile.mkdtemp()) / "test.db"
    monkeypatch.setattr(conn, "DB_PATH", tmp)
    monkeypatch.setattr(conn, "DB_DIR", tmp.parent)
    # Reset thread-local
    if hasattr(conn._local, "conn"):
        conn._local.conn = None
    db_conn = conn.get_db()
    yield db_conn
    conn.close_db()


class TestDatabaseConnection:
    def test_connection_created(self, db):
        import db.connection as conn
        assert db is not None
        assert hasattr(conn._local, "conn")

    def test_wal_mode(self, db):
        row = db.execute("PRAGMA journal_mode").fetchone()
        assert row[0] == "wal"

    def test_foreign_keys_on(self, db):
        row = db.execute("PRAGMA foreign_keys").fetchone()
        assert row[0] == 1


class TestEnterpriseTable:
    def test_table_exists(self, db):
        row = db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='enterprises'"
        ).fetchone()
        assert row is not None

    def test_insert_and_query(self, db):
        db.execute(
            "INSERT OR REPLACE INTO enterprises (id, name, industry) VALUES (?, ?, ?)",
            ("test-1", "测试企业", "钢铁"),
        )
        db.commit()
        row = db.execute("SELECT * FROM enterprises WHERE id = ?", ("test-1",)).fetchone()
        assert row["name"] == "测试企业"
        assert row["industry"] == "钢铁"


class TestComplianceMemoriesTable:
    def test_table_exists(self, db):
        row = db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='compliance_memories'"
        ).fetchone()
        assert row is not None

    def test_insert_memory(self, db):
        db.execute(
            "INSERT INTO compliance_memories (category, content, risk_level) VALUES (?, ?, ?)",
            ("法规", "排污许可管理条例第21条", "info"),
        )
        db.commit()
        row = db.execute(
            "SELECT * FROM compliance_memories WHERE category = ?", ("法规",)
        ).fetchone()
        assert row is not None
        assert row["content"] == "排污许可管理条例第21条"


class TestWorkJournalsTable:
    def test_table_exists(self, db):
        row = db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='work_journals'"
        ).fetchone()
        assert row is not None

    def test_insert_journal(self, db):
        db.execute(
            "INSERT INTO work_journals (date, title, content) VALUES (?, ?, ?)",
            ("2026-01-01", "测试日志", "今日完成合规巡检"),
        )
        db.commit()
        row = db.execute(
            "SELECT * FROM work_journals WHERE date = ?", ("2026-01-01",)
        ).fetchone()
        assert row["title"] == "测试日志"


class TestOpsEventsTable:
    def test_table_exists(self, db):
        row = db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='ops_events'"
        ).fetchone()
        assert row is not None

    def test_insert_event(self, db):
        db.execute(
            "INSERT INTO ops_events (type, severity, data) VALUES (?, ?, ?)",
            ("page_view", "info", '{"path":"/dashboard"}'),
        )
        db.commit()
        row = db.execute(
            "SELECT * FROM ops_events WHERE type = ?", ("page_view",)
        ).fetchone()
        assert row["severity"] == "info"


class TestIndexes:
    def test_memory_category_index(self, db):
        rows = db.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memories_category'"
        ).fetchall()
        assert len(rows) == 1

    def test_events_severity_index(self, db):
        rows = db.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_events_severity'"
        ).fetchall()
        assert len(rows) == 1
