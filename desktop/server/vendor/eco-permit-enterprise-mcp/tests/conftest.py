"""pytest fixtures：构造配置、mock 会话/HTTP/验证码，隔离网络。"""

from __future__ import annotations

import pytest

from eco_permit_enterprise_mcp.config import Config
from eco_permit_enterprise_mcp.context import AppContext


@pytest.fixture
def config() -> Config:
    """构造一个全字段的测试配置（不读 .env）。"""
    return Config(
        base_url="https://permit.mee.gov.cn",
        username="testuser",
        password="testpass",
        permit_code="91431381748373560G001P",
        enterid="2d3ee2db-0e80-4ec4-a3d7-322aeafc580e",
        city_code="431300000000",
        user_code="testuser",
        qybh="247112131331248",
        sheng="430000",
        shi="431300",
        xian="431381",
        cas_login_url="https://permit.mee.gov.cn/cas/login?service=x",
        kaptcha_url="https://permit.mee.gov.cn/cas/kaptcha.jpg",
        session_ttl=3600,
        login_retry=3,
        http_timeout=5,
    )


@pytest.fixture(autouse=True)
def _reset_context(config):
    """每个测试前初始化 AppContext（用测试配置），测试后清理。"""
    AppContext.init(config)
    yield
    AppContext.reset()


__all__ = [
    "config",
    "_reset_context",
]
