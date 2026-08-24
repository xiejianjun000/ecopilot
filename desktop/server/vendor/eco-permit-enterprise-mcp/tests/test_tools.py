"""41 工具注册 + 出参结构断言 + 服务/工具联动（mock）。"""

from __future__ import annotations

import pytest

from eco_permit_enterprise_mcp.context import AppContext
from eco_permit_enterprise_mcp.http.http_client import HttpResponse
from eco_permit_enterprise_mcp.models import LoginState, default_expiry
from eco_permit_enterprise_mcp.server import PermitMcpServer
from eco_permit_enterprise_mcp.services.license_service import LicenseService
from eco_permit_enterprise_mcp.tools import company_tools, license_tools, restricted_tools

EXPECTED_TOOLS = {
    # 认证与会话（3）
    "auth_login", "auth_logout", "auth_status",
    # 企业基础信息（2）
    "company_profile", "company_menu",
    # 许可证业务（18）
    "license_apply_list", "license_reapply_list", "license_change_list",
    "license_adjust_list", "license_renew_list", "license_reissue_list",
    "soil_manage_list", "register_list", "disclosure_list", "license_apply_check",
    "license_public_info", "self_acceptance", "license_detail", "license_detail_cards",
    "license_reissue_detail", "soil_detail", "disclosure_detail", "register_detail",
    # 执行报告 / 统一报表（9）
    "report_list", "unified_report_list", "report_detail", "report_auto_login",
    "report_export", "report_transact", "report_template",
    "report_template_fill", "report_template_submit",
    # 监测记录（3）
    "monitor_info", "monitor_month_status", "monitor_detail",
    # 台账（2）
    "ledger_list", "ledger_upload",
    # 受限/预留（4）
    "auto_monitor", "eia_apply", "carbon_report", "correction_status",
}


class StubAuth:
    def ensure_session(self):
        return LoginState(
            session_id="sess",
            cookies=[{"name": "JSESSIONID", "value": "x", "domain": "", "path": "/"}],
            profile=None,
            login_at=default_expiry(0),
            expires_at=default_expiry(3600),
        )


class StubHttp:
    def __init__(self, text):
        self._text = text

    def get_text(self, url, params=None, headers=None):
        return self._text

    def post(self, url, data=None, headers=None, retries=2):
        return HttpResponse(status_code=200, url=url, content=b"", headers={}, text=self._text)


@pytest.mark.asyncio
async def test_41_tools_registered(config):
    server = PermitMcpServer(config=config)
    server.build()
    tools = await server.mcp.list_tools()
    names = {t.name for t in tools}
    assert names == EXPECTED_TOOLS, f"缺失/多余工具: {names ^ EXPECTED_TOOLS}"
    assert len(names) == 41


@pytest.mark.asyncio
async def test_company_menu_tool(config):
    server = PermitMcpServer(config=config)
    server.build()
    result = await company_tools.company_menu()
    assert result["code"] == 0
    assert len(result["data"]) == 18
    assert all(set(r) >= {"no", "name", "group", "restricted"} for r in result["data"])


@pytest.mark.asyncio
async def test_restricted_tools_return_501(config):
    server = PermitMcpServer(config=config)
    server.build()
    for fn in (restricted_tools.auto_monitor, restricted_tools.eia_apply,
               restricted_tools.carbon_report, restricted_tools.correction_status):
        result = await fn()
        assert result["code"] == 501, fn.__name__
        assert "msg" in result and result["msg"]
        assert "data" in result


@pytest.mark.asyncio
async def test_license_reapply_tool_mocked(config):
    """用 mock HTTP 验证 license_reapply_list 工具端到端（服务层解析表格）。"""
    from tests.sample_data import REAPPLY_TABLE_HTML

    svc = LicenseService(config, StubAuth(), StubHttp(REAPPLY_TABLE_HTML))
    AppContext.register_service("license", svc)
    result = await license_tools.license_reapply_list()
    assert result["code"] == 0
    assert result["data"]["total"] == 4
    assert result["data"]["records"][0]["company_name"] == "冷水江钢铁有限责任公司"


@pytest.mark.asyncio
async def test_license_reapply_invalid_search_type(config):
    svc = LicenseService(config, StubAuth(), StubHttp("<html></html>"))
    AppContext.register_service("license", svc)
    result = await license_tools.license_reapply_list(search_type="INVALID")
    assert result["code"] == 400


@pytest.mark.asyncio
async def test_tool_result_structure(config):
    """所有受限/菜单工具返回统一 {code,data,msg} 结构。"""
    server = PermitMcpServer(config=config)
    server.build()
    for result in [await company_tools.company_menu(),
                   await restricted_tools.auto_monitor()]:
        assert set(result.keys()) == {"code", "data", "msg"}
        assert isinstance(result["code"], int)
