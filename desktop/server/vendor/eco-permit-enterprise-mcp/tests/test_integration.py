"""端到端 smoke（真实凭证联网）。

默认跳过；设置环境变量 ``PERMIT_LIVE_E2E=1`` 后执行：

    PERMIT_LIVE_E2E=1 python -m pytest tests/test_integration.py -v

覆盖：
1. auth_login 真实登录（ddddocr 识别真实验证码）。
2. license_reapply_list 真实查询（本企业 4 条重新申请记录）。
3. 受限工具返回 code=501 不崩溃。
"""

from __future__ import annotations

import os

import pytest

from eco_permit_enterprise_mcp.config import Config
from eco_permit_enterprise_mcp.context import AppContext
from eco_permit_enterprise_mcp.server import PermitMcpServer
from eco_permit_enterprise_mcp.tools import auth_tools, license_tools, restricted_tools

pytestmark = pytest.mark.skipif(
    os.getenv("PERMIT_LIVE_E2E") != "1",
    reason="需 PERMIT_LIVE_E2E=1 且配置真实 .env 凭证",
)


def _build_live_server():
    cfg = Config.load()
    server = PermitMcpServer(config=cfg)
    server.build()
    return server


@pytest.mark.asyncio
async def test_live_login():
    server = _build_live_server()
    result = await auth_tools.auth_login()
    assert result["code"] == 0, result
    assert result["data"]["valid"] is True


@pytest.mark.asyncio
async def test_live_license_reapply():
    server = _build_live_server()
    await auth_tools.auth_login()
    result = await license_tools.license_reapply_list()
    assert result["code"] == 0, result
    assert result["data"]["total"] >= 1
    companies = {r["company_name"] for r in result["data"]["records"]}
    assert "冷水江钢铁有限责任公司" in companies


@pytest.mark.asyncio
async def test_live_restricted_501():
    server = _build_live_server()
    result = await restricted_tools.auto_monitor()
    assert result["code"] == 501
