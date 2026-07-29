"""Core startup validation tests"""
import pytest
from core.startup import validate_startup, print_startup_report


class TestValidateStartup:
    def test_dev_mode_warning_when_set(self, monkeypatch):
        monkeypatch.setenv("ECOPILOT_DEV", "1")
        monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
        monkeypatch.delenv("KIMI_API_KEY", raising=False)
        report = validate_startup(dev_mode=True)
        warnings_text = " ".join(report["warnings"])
        assert "ECOPILOT_DEV" in warnings_text

    def test_dev_mode_error_in_production(self, monkeypatch):
        monkeypatch.setenv("ECOPILOT_DEV", "1")
        monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
        monkeypatch.delenv("KIMI_API_KEY", raising=False)
        report = validate_startup(dev_mode=False)
        errors_text = " ".join(report["errors"])
        assert "ECOPILOT_DEV" in errors_text

    def test_missing_api_keys_reported(self, monkeypatch):
        monkeypatch.delenv("ECOPILOT_DEV", raising=False)
        monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
        monkeypatch.delenv("KIMI_API_KEY", raising=False)
        report = validate_startup()
        assert report["ok"] is False
        errors_text = " ".join(report["errors"])
        assert "DEEPSEEK_API_KEY" in errors_text
        assert "KIMI_API_KEY" in errors_text

    def test_invalid_api_key_format_warns(self, monkeypatch):
        monkeypatch.delenv("ECOPILOT_DEV", raising=False)
        monkeypatch.setenv("DEEPSEEK_API_KEY", "not-a-valid-key")
        monkeypatch.setenv("KIMI_API_KEY", "also-bad")
        report = validate_startup()
        warnings_text = " ".join(report["warnings"])
        assert "sk-" in warnings_text

    def test_valid_keys_pass(self, monkeypatch):
        monkeypatch.delenv("ECOPILOT_DEV", raising=False)
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-test-deepseek-key")
        monkeypatch.setenv("KIMI_API_KEY", "sk-test-kimi-key")
        report = validate_startup()
        assert report["ok"] is True
        assert len(report["errors"]) == 0

    def test_recommended_vars_warn_when_missing(self, monkeypatch):
        monkeypatch.delenv("ECOPILOT_DEV", raising=False)
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-test")
        monkeypatch.setenv("KIMI_API_KEY", "sk-test")
        monkeypatch.delenv("HERMES_BASE_URL", raising=False)
        monkeypatch.delenv("HERMES_API_KEY", raising=False)
        report = validate_startup()
        warnings_text = " ".join(report["warnings"])
        # Recommended vars missing should produce warnings
        assert any(v in warnings_text for v in ["HERMES", "DEEPSEEK_BASE_URL", "KIMI_BASE_URL"])

    def test_all_env_vars_set_no_warnings_about_env(self, monkeypatch):
        monkeypatch.delenv("ECOPILOT_DEV", raising=False)
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-valid")
        monkeypatch.setenv("KIMI_API_KEY", "sk-valid")
        monkeypatch.setenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
        monkeypatch.setenv("KIMI_BASE_URL", "https://api.moonshot.cn/v1")
        monkeypatch.setenv("HERMES_BASE_URL", "http://localhost:20128/v1")
        monkeypatch.setenv("HERMES_API_KEY", "hermes-key-123")
        report = validate_startup()
        # Should be ok with no env-related errors
        env_errors = [e for e in report["errors"] if "缺少" in e]
        assert len(env_errors) == 0


class TestPrintStartupReport:
    def test_ok_report_printed(self, capsys):
        report = {"ok": True, "errors": [], "warnings": []}
        print_startup_report(report)
        captured = capsys.readouterr()
        assert "✅" in captured.out

    def test_error_report_printed(self, capsys):
        report = {"ok": False, "errors": ["missing key"], "warnings": ["hint"]}
        print_startup_report(report)
        captured = capsys.readouterr()
        assert "❌" in captured.out
        assert "missing key" in captured.out
        assert "hint" in captured.out
