"""HTML 解析器：BeautifulSoup4 + lxml。

面向 Struts2 SSR 表格 / 登录页 / 隐藏字段的通用解析能力：
- :meth:`HtmlParser.parse_table` 将 ``<table>`` 逐行解析为 ``list[dict]``。
- :meth:`HtmlParser.parse_login_page` 提取 CAS 登录页 ``lt`` / ``execution``。
- :meth:`HtmlParser.extract_value` 提取指定 name/id 的 input 值或纯文本。
"""

from __future__ import annotations

import logging
import re
from typing import Any, List, Optional, Sequence

from bs4 import BeautifulSoup

from ..models import ListResult

logger = logging.getLogger("eco_permit_enterprise_mcp.http.parser")


class HtmlParser:
    """SSR HTML 解析器（无状态，可复用）。"""

    def __init__(self):
        self._soup_features = "lxml"

    def _soup(self, html: str) -> BeautifulSoup:
        return BeautifulSoup(html, self._soup_features)

    # ------------------------------------------------------------------
    # 表格解析
    # ------------------------------------------------------------------
    def parse_table(
        self,
        html: str,
        columns: Sequence[str],
        skip_header: bool = True,
    ) -> ListResult:
        """解析首个 ``<table>`` 为记录列表。

        Args:
            html: 页面 HTML。
            columns: 输出字段键列表（按列顺序，与研究报告列名对齐）。
            skip_header: 是否跳过表头行（首行含 ``<th>`` 或列为文本标题）。

        Returns:
            :class:`ListResult`，records 为 ``list[dict]``。
        """
        soup = self._soup(html)
        # 优先选择不含嵌套 <table> 的最内层数据表格（外层常为布局表格）
        table = None
        for t in soup.find_all("table"):
            if not t.find("table"):
                table = t
                break
        if table is None:
            table = soup.find("table")
        if table is None:
            logger.debug("未找到 <table>，返回空列表")
            return ListResult(total=0, page_no=1, records=[])

        rows: List[dict] = []
        first_data_row = True
        for tr in table.find_all("tr"):
            cells = tr.find_all(["td", "th"])
            if not cells:
                continue
            values = [self._cell_text(c) for c in cells]
            # 跳过空行 / 表头
            if skip_header and first_data_row and self._looks_like_header(cells, values):
                first_data_row = False
                continue
            first_data_row = False
            record = {}
            for idx, key in enumerate(columns):
                if idx < len(values):
                    record[key] = values[idx]
                else:
                    record[key] = ""
            if any(v != "" for v in values):
                rows.append(record)

        return ListResult(total=len(rows), page_no=1, records=rows)

    @staticmethod
    def _looks_like_header(cells: list, values: list) -> bool:
        """判断首行是否为表头（含 th 或全部为短文本标题）。"""
        if any(getattr(c, "name", "") == "th" for c in cells):
            return True
        return all(0 < len(v) <= 12 for v in values)

    @staticmethod
    def _cell_text(cell) -> str:
        # 编辑表单页（如排污登记 edit.vm）td 内是 <input>/<select>/<textarea>，
        # get_text 取不到控件 value，优先提取控件值，否则回退纯文本。
        control = cell.find(["input", "select", "textarea"])
        if control is not None:
            if control.name == "select":
                selected = control.find("option", selected=True) or control.find("option")
                if selected is not None:
                    return (selected.get_text(" ", strip=True) or selected.get("value") or "").strip()
            if control.name == "textarea":
                return re.sub(r"\s+", " ", control.get_text(" ", strip=True)).strip()
            value = control.get("value")
            if value:
                return str(value).strip()
        return re.sub(r"\s+", " ", cell.get_text(" ", strip=True)).strip()

    # ------------------------------------------------------------------
    # 登录页解析
    # ------------------------------------------------------------------
    def parse_login_page(self, html: str) -> dict:
        """解析 CAS 登录页，返回 ``{lt, execution, modulus, exponent, salt, action, has_error}``。

        ``modulus``/``exponent`` 为登录页动态下发的 RSA 公钥（每次加载变化），
        ``salt`` 为登录页 JS 加密时明文末尾拼接的动态盐（每次加载变化），
        均用于登录凭证加密（见 :mod:`eco_permit_enterprise_mcp.auth.crypto`）。
        """
        soup = self._soup(html)
        lt = self._input_value(soup, "lt")
        execution = self._input_value(soup, "execution")
        modulus = self._input_value_by_id(soup, "hid_modulus")
        exponent = self._input_value_by_id(soup, "hid_exponent")
        salt = self._extract_salt(html)
        form = soup.find("form")
        action = (form.get("action") if form else "") or ""
        error = soup.find(id="msg") or soup.find(class_="errors")
        return {
            "lt": lt,
            "execution": execution,
            "modulus": modulus,
            "exponent": exponent,
            "salt": salt,
            "action": action,
            "has_error": bool(error and error.get_text(strip=True)),
        }

    @staticmethod
    def _extract_salt(html: str) -> str:
        """提取登录页 JS 中的动态加密盐（``$("#username").val() + "盐"``）。"""
        m = re.search(r'\$\("#username"\)\.val\(\)\s*\+\s*"([^"]+)"', html)
        if m:
            return m.group(1)
        # 兜底：hideusername 加密语句
        m2 = re.search(r'encryptedString\([^)]*?\+ "([A-Za-z0-9]{4})"\)', html)
        return m2.group(1) if m2 else ""

    @staticmethod
    def _input_value(soup: BeautifulSoup, name: str) -> str:
        node = soup.find("input", attrs={"name": name})
        if node is None:
            return ""
        return (node.get("value") or "").strip()

    @staticmethod
    def _input_value_by_id(soup: BeautifulSoup, id_: str) -> str:
        node = soup.find(id=id_)
        if node is None:
            return ""
        return (node.get("value") or "").strip()

    # ------------------------------------------------------------------
    # 详情页解析（<th>label</th><td>value</td> 键值对）
    # ------------------------------------------------------------------
    def parse_detail(self, html: str) -> dict:
        """解析详情页表格为 ``{label: value}`` 键值对。

        详情页（遗失声明 / 信息公开 / 涉重登记）为 ``<th>标签</th><td>值</td>``
        两列表格。提取所有非空标签行，返回有序键值对。
        """
        soup = self._soup(html)
        pairs: dict = {}
        for tr in soup.find_all("tr"):
            th = tr.find("th")
            if th is None:
                continue
            label = re.sub(r"\s+", "", th.get_text(" ", strip=True)).rstrip("：:").strip()
            if not label:
                continue
            td = tr.find("td")
            value = self._cell_text(td) if td is not None else ""
            if label not in pairs or not pairs[label]:
                pairs[label] = value
        return pairs

    # ------------------------------------------------------------------
    # 字段提取
    # ------------------------------------------------------------------
    def extract_value(self, html: str, key: str) -> str:
        """提取指定 name/id 的 input 值；找不到时返回页面纯文本中的匹配。

        主要用于 Struts2 预检接口返回的裸字符串（如 "0"/"1"）。
        """
        soup = self._soup(html)
        node = soup.find("input", attrs={"name": key}) or soup.find(id=key)
        if node is not None:
            val = node.get("value")
            if val is not None:
                return str(val).strip()
        # 兜底：返回 body 纯文本
        text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True)).strip()
        return text


__all__ = ["HtmlParser"]
