"""Core config module tests — vault helpers, PII, file validation"""
import pytest
import tempfile
from pathlib import Path
from core.config import (
    sanitize_pii, load_json_dict, save_json_dict,
    vault_safe_filename, fmt_size_py, validate_file_magic,
)


class TestPII:
    def test_mobile_phone_masked(self):
        result = sanitize_pii("请联系 13800138000")
        assert "13800138000" not in result
        assert "<手机号>" in result

    def test_id_card_masked(self):
        result = sanitize_pii("身份证 110101199001011234")
        assert "110101199001011234" not in result

    def test_email_masked(self):
        result = sanitize_pii("邮箱 test@example.com")
        assert "test@example.com" not in result

    def test_clean_text_passes_through(self):
        result = sanitize_pii("普通文本内容")
        assert result == "普通文本内容"


class TestJSONPersistence:
    def test_roundtrip(self, monkeypatch, tmp_path):
        from core import config
        monkeypatch.setattr(config, "HERMES_HOME", tmp_path)
        monkeypatch.setattr(config, "_json", __import__("json"))

        save_json_dict("test.json", {"key": "value"})
        loaded = load_json_dict("test.json")
        assert loaded == {"key": "value"}

    def test_load_missing_returns_empty(self, monkeypatch):
        from core import config
        monkeypatch.setattr(config, "HERMES_HOME", Path("/nonexistent"))
        result = load_json_dict("never_exists.json")
        assert result == {}


class TestVaultSafeFilename:
    def test_preserves_chinese(self):
        name = vault_safe_filename("许可证.pdf")
        assert "许可证" in name
        assert name.endswith(".pdf")

    def test_replaces_slashes(self):
        name = vault_safe_filename("../../etc/passwd")
        # Slashes should be sanitized
        assert "/" not in name

    def test_handles_dotfile(self):
        name = vault_safe_filename(".bashrc")
        # Dot-prefixed files get "file" prefix
        assert "file" in name or ".bashrc" in name

    def test_appends_timestamp(self):
        name = vault_safe_filename("report.txt")
        # Format: YYYYMMDD-HHMMSS_filename
        parts = name.split("_")
        assert len(parts) >= 2


class TestFmtSize:
    def test_bytes(self):
        assert "500 B" in fmt_size_py(500)

    def test_kilobytes(self):
        result = fmt_size_py(2048)
        assert "KB" in result

    def test_megabytes(self):
        result = fmt_size_py(5 * 1024 * 1024)
        assert "MB" in result


class TestValidateFileMagic:
    def test_pdf_valid(self):
        ok, _ = validate_file_magic(b"%PDF-1.4\n...", ".pdf")
        assert ok is True

    def test_pdf_spoofed(self):
        ok, msg = validate_file_magic(b"evil content", ".pdf")
        assert ok is False
        assert "不匹配" in msg

    def test_empty_content(self):
        ok, msg = validate_file_magic(b"", ".pdf")
        assert ok is False
        assert "为空" in msg

    def test_small_content(self):
        ok, msg = validate_file_magic(b"a", ".pdf")
        assert ok is False
        assert "过小" in msg

    def test_unknown_ext_skips(self):
        ok, _ = validate_file_magic(b"any data", ".custom")
        assert ok is True
