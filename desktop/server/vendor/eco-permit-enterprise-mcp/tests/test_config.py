"""配置加载单测。"""

from __future__ import annotations

import pytest

from eco_permit_enterprise_mcp.config import Config
from eco_permit_enterprise_mcp.errors import ConfigError


def _set_all_env(monkeypatch):
    monkeypatch.setenv("PERMIT_BASE_URL", "https://permit.mee.gov.cn")
    monkeypatch.setenv("PERMIT_USERNAME", "u")
    monkeypatch.setenv("PERMIT_PASSWORD", "p")
    monkeypatch.setenv("PERMIT_PERMIT_CODE", "CODE")
    monkeypatch.setenv("PERMIT_ENTERID", "EID")
    monkeypatch.setenv("PERMIT_CITY_CODE", "CITY")
    monkeypatch.setenv("PERMIT_USER_CODE", "u")
    monkeypatch.setenv("PERMIT_QYBH", "Q")
    monkeypatch.setenv("PERMIT_SHENG", "430000")
    monkeypatch.setenv("PERMIT_SHI", "431300")
    monkeypatch.setenv("PERMIT_XIAN", "431381")


def test_load_ok(monkeypatch):
    _set_all_env(monkeypatch)
    cfg = Config.load()
    assert cfg.username == "u"
    assert cfg.base_url == "https://permit.mee.gov.cn"
    assert cfg.session_ttl == 3600
    assert cfg.cas_login_url.startswith("https://permit.mee.gov.cn/cas/login?service=")
    assert cfg.kaptcha_url == "https://permit.mee.gov.cn/cas/kaptcha.jpg"
    # 派生 URL
    assert cfg.internal_url("/syssb/ckxm/ckxm!listCxsq.action").endswith(
        "/permitExt/syssb/ckxm/ckxm!listCxsq.action"
    )


def test_load_missing_required(monkeypatch):
    # 屏蔽 .env 文件读取（否则测试环境存在 .env 时会回填必填项，导致不抛错）
    import eco_permit_enterprise_mcp.config as config_module

    monkeypatch.setattr(config_module, "load_dotenv", lambda: None)
    for key in ("PERMIT_USERNAME", "PERMIT_PASSWORD", "PERMIT_PERMIT_CODE",
                "PERMIT_ENTERID", "PERMIT_CITY_CODE", "PERMIT_USER_CODE",
                "PERMIT_QYBH", "PERMIT_SHENG", "PERMIT_SHI", "PERMIT_XIAN"):
        monkeypatch.delenv(key, raising=False)
    with pytest.raises(ConfigError):
        Config.load()


def test_get(config):
    assert config.get("username") == "testuser"
    assert config.get("nonexistent", "fallback") == "fallback"


def test_playwright_headless_default(monkeypatch):
    _set_all_env(monkeypatch)
    monkeypatch.setenv("PERMIT_PLAYWRIGHT_HEADLESS", "false")
    assert Config.load().playwright_headless is False
