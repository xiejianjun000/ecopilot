"""Playwright 报告服务单测（mock driver，不启动浏览器）。"""

from __future__ import annotations

from eco_permit_enterprise_mcp.models import EnterpriseProfile, ListResult
from eco_permit_enterprise_mcp.services.report_service import ReportService


class FakeDriver:
    def __init__(self):
        self.started_cookies = None
        self.profile = EnterpriseProfile(
            enterid="2d3ee2db-0e80-4ec4-a3d7-322aeafc580e",
            permit_code="91431381748373560G001P",
            company_name="冷水江钢铁有限责任公司",
            industry_code="C31",
            industry_name="黑色金属冶炼和压延加工业",
            management_type="important2",
            user_id="30089",
            user_account="yuanbin",
            company_id="13615",
        )

    def start(self, cookies):
        self.started_cookies = cookies

    def report_list(self, year, business_type):
        return ListResult(
            total=2,
            page_no=1,
            records=[
                {"year": year, "businessType": business_type, "status": "已填报"},
                {"year": year, "businessType": business_type, "status": "待填报"},
            ],
        )

    def get_profile(self):
        return self.profile

    def close(self):
        pass


class StubAuth:
    def export_cookies(self):
        return [{"name": "JSESSIONID", "value": "sess", "domain": "", "path": "/"}]


class StubHttp:
    pass


def _make_service(config, driver=None):
    return ReportService(config, StubAuth(), StubHttp(), driver=driver or FakeDriver())


def test_report_list(config):
    svc = _make_service(config)
    resp = svc.report_list(2026, "RT")
    assert resp.code == 0
    assert resp.data["total"] == 2
    assert resp.data["businessType"] == "RT"
    assert resp.data["profile"]["companyName"] == "冷水江钢铁有限责任公司"


def test_unified_report_list(config):
    svc = _make_service(config)
    resp = svc.unified_report_list(2026, "ENV")
    assert resp.code == 0
    assert resp.data["businessType"] == "ENV"


def test_invalid_business_type(config):
    svc = _make_service(config)
    resp = svc.report_list(2026, "INVALID")
    assert resp.code == 400
    assert resp.data is None


def test_driver_receives_cookies(config):
    driver = FakeDriver()
    svc = _make_service(config, driver=driver)
    svc.report_list(2026, "RT")
    assert driver.started_cookies is not None
    assert driver.started_cookies[0]["name"] == "JSESSIONID"
