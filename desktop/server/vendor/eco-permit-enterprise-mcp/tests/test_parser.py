"""HtmlParser 单测：表格解析、登录页解析（含研究报告真实 HTML 片段）。"""

from __future__ import annotations

from eco_permit_enterprise_mcp.http.parser import HtmlParser

from tests.sample_data import LOGIN_PAGE_HTML, REAPPLY_TABLE_HTML


def test_parse_login_page():
    parser = HtmlParser()
    parsed = parser.parse_login_page(LOGIN_PAGE_HTML)
    assert parsed["lt"] == "LT-123456-example"
    assert parsed["execution"] == "e1s1"
    assert parsed["action"] == "/cas/login"


def test_parse_table():
    parser = HtmlParser()
    columns = ["index", "company_name", "audit_status", "submit_time", "action"]
    result = parser.parse_table(REAPPLY_TABLE_HTML, columns)
    assert result.total == 4
    assert len(result.records) == 4
    first = result.records[0]
    assert first["company_name"] == "冷水江钢铁有限责任公司"
    assert first["audit_status"] == "审批通过"
    assert first["submit_time"] == "2021-01-22"


def test_parse_table_no_table():
    parser = HtmlParser()
    result = parser.parse_table("<html><body>无表格</body></html>", ["a", "b"])
    assert result.total == 0
    assert result.records == []


def test_extract_value_plain_text():
    parser = HtmlParser()
    assert parser.extract_value("<html><body>1</body></html>", "x") == "1"


def test_extract_value_input():
    parser = HtmlParser()
    html = '<html><body><input name="foo" value="bar"/></body></html>'
    assert parser.extract_value(html, "foo") == "bar"
