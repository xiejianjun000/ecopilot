"""许可证业务服务（模块 2/3/4/5/6/7/8/9/10/11）。

覆盖 11 个许可证业务工具：
- apply_list（模块 3）：预检统一社会信用代码 / 注销状态，返回可用申请入口。
- reapply_list（模块 4）：重新申请列表。
- change_list（模块 5）：变更列表（基本信息 / 其他情况）。
- adjust_list（模块 6）：调整列表。
- renew_list（模块 7）：延续列表。
- reissue_list（模块 8）：补办（遗失声明）列表。
- soil_list（模块 9）：土壤管理（涉重登记）列表。
- register_list（模块 10）：排污登记（Velocity .vm 页面）列表。
- disclosure_list（模块 11）：信息公开列表。
- apply_check（模块 3/4）：许可证申请预检。
- self_acceptance（模块 2）：自主验收预检。

内部模块统一：POST ``/permitExt/<action>``（GBK SSR HTML）→ ``HtmlParser.parse_table``。
"""

from __future__ import annotations

import logging
import re
from typing import Optional

import threading
from bs4 import BeautifulSoup

from ..browser.playwright_driver import PlaywrightDriver
from ..constants import (
    ApplyType,
    ChangeType,
    Endpoints,
    LICENSE_CARDS,
    PUBLIC_LICENSE_INFO_PATH,
    RegisterType,
    SearchType,
)
from ..errors import ApiResponse, ErrorCode, UpstreamError
from ..http.parser import HtmlParser
from ..models import ListResult
from .base_service import BaseService

logger = logging.getLogger("eco_permit_enterprise_mcp.services.license")

# 各列表的列名（输出字段键，与研究报告列名对齐）
_REAPPLY_COLUMNS = ["index", "company_name", "audit_status", "submit_time", "action"]
_CHANGE_COLUMNS = ["index", "company_name", "audit_status", "submit_time", "action"]
_ADJUST_COLUMNS = ["index", "company_name", "audit_status", "submit_time", "action"]
_RENEW_COLUMNS = ["index", "company_name", "audit_status", "submit_time", "action"]
_REISSUE_COLUMNS = ["index", "declaration_no", "status", "publish_time", "action"]
_SOIL_COLUMNS = ["index", "company_name", "register_type", "status", "submit_time", "action"]
_REGISTER_COLUMNS = ["index", "company_name", "status", "submit_time", "action"]
_DISCLOSURE_COLUMNS = [
    "index", "publish_status", "publish_date", "start_end_date",
    "feedback", "action",
]


class LicenseService(BaseService):
    """许可证业务服务。"""

    def __init__(
        self,
        config,
        auth,
        http,
        parser: Optional[HtmlParser] = None,
        driver: Optional[PlaywrightDriver] = None,
    ):
        super().__init__(config, auth, http)
        self.parser = parser or HtmlParser()
        self._driver = driver or PlaywrightDriver(config)
        self._driver_lock = threading.Lock()
        self._register_session_ready = False

    # ------------------------------------------------------------------
    # 列表查询
    # ------------------------------------------------------------------
    def reapply_list(
        self,
        search_type: str = SearchType.ALL,
        page_no: int = 1,
        page_size: int = 10,
    ) -> ApiResponse:
        """重新申请列表（模块 4）。"""
        self.require_login()
        self._validate_search_type(search_type)
        form = self._list_form(search_type, page_no, page_size)
        form["itemtype"] = "TYPEI"
        form["itemTypeID"] = "XZXKTYPE_A"
        html = self._post_list(Endpoints.REAPPLY_LIST, form)
        result = self.parser.parse_table(html, _REAPPLY_COLUMNS)
        return self._list_response(result)

    def change_list(
        self,
        change_type: str = ChangeType.BASIC,
        search_type: str = SearchType.ALL,
        page_no: int = 1,
    ) -> ApiResponse:
        """变更列表（模块 5）。"""
        self.require_login()
        self._validate_search_type(search_type)
        if change_type == ChangeType.BASIC:
            item_type_id, itemtype, search_item = "XZXKTYPE_C", "TYPEC", "TYPEC_2"
        elif change_type == ChangeType.OTHER:
            item_type_id, itemtype, search_item = "XZXKTYPE_A", "TYPEC", "TYPEC_1"
        else:
            return self.fail(ErrorCode.BAD_REQUEST, f"changeType 非法: {change_type}")

        form = self._list_form(search_type, page_no)
        form["itemTypeID"] = item_type_id
        form["itemtype"] = itemtype
        form["searchItem"] = search_item
        html = self._post_list(Endpoints.CHANGE_LIST, form)
        result = self.parser.parse_table(html, _CHANGE_COLUMNS)
        return self._list_response(result)

    def adjust_list(
        self,
        search_type: str = SearchType.ALL,
        page_no: int = 1,
    ) -> ApiResponse:
        """调整列表（模块 6）。"""
        self.require_login()
        self._validate_search_type(search_type)
        form = self._list_form(search_type, page_no)
        form["itemTypeID"] = "XZXKTYPE_A"
        form["itemtype"] = "TYPEK"
        html = self._post_list(Endpoints.ADJUST_LIST, form)
        result = self.parser.parse_table(html, _ADJUST_COLUMNS)
        return self._list_response(result)

    def renew_list(
        self,
        search_type: str = SearchType.ALL,
        page_no: int = 1,
    ) -> ApiResponse:
        """延续列表（模块 7）。"""
        self.require_login()
        self._validate_search_type(search_type)
        form = self._list_form(search_type, page_no)
        form["itemTypeID"] = "XZXKTYPE_D"
        form["itemtype"] = "TYPED"
        html = self._post_list(Endpoints.RENEW_LIST, form)
        result = self.parser.parse_table(html, _RENEW_COLUMNS)
        return self._list_response(result)

    def reissue_list(self, page_no: int = 1) -> ApiResponse:
        """补办（遗失声明）列表（模块 8）。"""
        self.require_login()
        form = {
            "enterid": self.config.enterid,
            "page.pageNo": str(page_no),
            "page.orderBy": "",
            "page.order": "",
            "submit123": "",
        }
        html = self._post_list(Endpoints.REISSUE_LIST, form)
        result = self.parser.parse_table(html, _REISSUE_COLUMNS)
        return self._list_response(result)

    def soil_list(self, page_no: int = 1) -> ApiResponse:
        """土壤管理（涉重登记）列表（模块 9）。"""
        self.require_login()
        form = {
            "enterid": self.config.enterid,
            "page.pageNo": str(page_no),
            "page.orderBy": "",
            "page.order": "",
            "submit123": "",
        }
        html = self._post_list(Endpoints.SOIL_LIST, form)
        result = self.parser.parse_table(html, _SOIL_COLUMNS)
        return self._list_response(result)

    def register_list(self, register_type: str = RegisterType.REGISTER) -> ApiResponse:
        """排污登记列表（模块 10，Velocity .vm 页面，需先 SSO 建立会话）。"""
        self.require_login()
        page_map = {
            RegisterType.REGISTER: Endpoints.REGISTER_LIST,
            RegisterType.BCBG: Endpoints.REGISTER_BCBG,
            RegisterType.DJYX: Endpoints.REGISTER_DJYX,
            RegisterType.CANCEL: Endpoints.REGISTER_CANCEL,
        }
        if register_type not in page_map:
            return self.fail(ErrorCode.BAD_REQUEST, f"registerType 非法: {register_type}")

        if not self._ensure_register_session():
            return self.fail(ErrorCode.UPSTREAM_ERROR, "排污登记子系统 SSO 跳转失败，请确认已登录后重试")

        url = self.config.url(page_map[register_type])
        html = self.http.get_text(url)
        result = self.parser.parse_table(html, _REGISTER_COLUMNS)
        return self._list_response(result)

    def register_detail(self, sqdjid: str = "") -> ApiResponse:
        """穿透读取排污登记详情（模块 10）。

        通过排污登记列表记录的 sqdjid 请求 ``registration/edit.vm`` 详情页，
        提取登记填报字段键值对（统一社会信用代码/行业类别/主要产品/燃料/
        废气废水治理设施与排放口等）。该页为表单结构，``_cell_text`` 会
        提取输入控件 value（已填报）或回退纯文本（只读查看）。

        参数：
            sqdjid: 登记记录主键（来自 register_list 的「查看/编辑」链接）

        出参：``{sqdjid, fields: {标签: 值}}``。
        """
        self.require_login()
        if not sqdjid:
            return self.fail(ErrorCode.BAD_REQUEST, "缺少 sqdjid（请先调用 register_list 获取）")
        if not self._ensure_register_session():
            return self.fail(ErrorCode.UPSTREAM_ERROR, "排污登记子系统 SSO 跳转失败，请确认已登录后重试")
        try:
            url = self.config.url(Endpoints.REGISTER_DETAIL)
            html = self.http.get_text(url, params={"sqdjid": sqdjid})
            fields = self.parser.parse_detail(html)
            return self.ok({"sqdjid": sqdjid, "fields": fields}, f"成功，{len(fields)} 个字段")
        except Exception as exc:  # noqa: BLE001
            logger.exception("排污登记详情读取失败: %s", exc)
            return self.fail(ErrorCode.UPSTREAM_ERROR, f"排污登记详情读取失败: {exc}")

    def disclosure_list(
        self,
        search_fb_time: str = "",
        page_no: int = 1,
    ) -> ApiResponse:
        """信息公开列表（模块 11）。"""
        self.require_login()
        form = {
            "page.pageNo": str(page_no),
            "page.orderBy": "",
            "page.order": "",
            "searchFbTime": search_fb_time or "",
            "enterid": self.config.enterid,
        }
        html = self._post_list(Endpoints.DISCLOSURE_LIST, form)
        result = self.parser.parse_table(html, _DISCLOSURE_COLUMNS)
        return self._list_response(result)

    # ------------------------------------------------------------------
    # 预检
    # ------------------------------------------------------------------
    def apply_list(self, apply_type: str = ApplyType.FIRST) -> ApiResponse:
        """许可证申请入口与预检（模块 3）。"""
        self.require_login()
        if apply_type not in ApplyType.VALUES:
            return self.fail(ErrorCode.BAD_REQUEST, f"applyType 非法: {apply_type}")

        check = self.apply_check(self.config.enterid)
        if check.code != ErrorCode.SUCCESS:
            return check

        data = {
            "applyType": apply_type,
            "applyTypeName": ApplyType.VALUES[apply_type],
            "precheck": check.data,
            "entries": [
                {"name": "首次申请", "available": apply_type == ApplyType.FIRST},
                {"name": "补充申请", "available": apply_type == ApplyType.SUPPLEMENT},
                {"name": "整改后申请", "available": apply_type == ApplyType.RECTIFICATION},
            ],
        }
        return self.ok(data, "成功")

    def apply_check(self, enterid: Optional[str] = None) -> ApiResponse:
        """许可证申请预检（模块 3/4）：统一社会信用代码 + 是否已注销。"""
        self.require_login()
        enterid = enterid or self.config.enterid
        register = self._check_register(enterid)
        cancel = self._check_is_cancel(enterid)
        data = {
            "enterid": enterid,
            "registerStatus": register,
            "cancelled": cancel,
        }
        return self.ok(data, "成功")

    def self_acceptance(self, enterid: Optional[str] = None) -> ApiResponse:
        """自主验收预检（模块 2）：checkEnter 返回 "1" 才允许进入。"""
        self.require_login()
        enterid = enterid or self.config.enterid
        text = self.http.get_text(
            self.config.internal_url(Endpoints.CHECK_ENTER),
            params={"enterid": enterid},
        ).strip()
        allowed = text == "1"
        return self.ok(
            {
                "enterid": enterid,
                "allowed": allowed,
                "raw": text,
                "entry": "自主验收模块（预检通过后可进入）" if allowed else "预检未通过",
            },
            "成功",
        )

    def public_license_info(
        self,
        permit_code: str = "",
        company_name: str = "",
    ) -> ApiResponse:
        """查询公开「许可信息公开」，提取许可证有效期限/发证日期（无需登录）。

        公开端结果表含「有效期限」列（如 ``2024-09-10至2029-09-09``），
        是许可证正本有效期的权威来源；申请/重新申请列表仅含审批日期，
        不能据此推断有效期。
        """
        url = f"{self.config.base_url}{PUBLIC_LICENSE_INFO_PATH}"
        permit_code = permit_code or self.config.permit_code
        try:
            first = self.http.get(url)
            key = re.search(r'name="tempReportKey"\s+value="([^"]+)"', first.text)
            if not key:
                return self.fail(ErrorCode.UPSTREAM_ERROR, "公开许可信息页未提取到 tempReportKey")
            form = {
                "page.pageNo": "1",
                "page.orderBy": "",
                "page.order": "",
                "tempReportKey": key.group(1),
                "province": "",
                "city": "",
                "management": "",
                "registerentername": company_name,
                "xkznum": permit_code,
                "treadname": "",
                "treadcode": "",
                "publishtime": "",
            }
            html = self.http.post(url, data=form).text
            record = self._parse_public_license(html, permit_code, company_name)
            if record is None:
                return self.fail(ErrorCode.UPSTREAM_ERROR, "公开端未查询到匹配的许可证记录")
            return self.ok(record, "成功")
        except Exception as exc:  # noqa: BLE001
            logger.exception("公开许可信息查询失败: %s", exc)
            return self.fail(ErrorCode.UPSTREAM_ERROR, f"公开许可信息查询失败: {exc}")

    # ------------------------------------------------------------------
    # 详情穿透（模块 4/5/6/7「查看」详情 = 许可证 20 卡）
    # ------------------------------------------------------------------
    def license_detail(
        self,
        dataid: str = "",
        cards: Optional[list] = None,
    ) -> ApiResponse:
        """穿透读取许可证详情（模块 4/5/6/7 的「查看」详情）。

        通过 ``dataid`` 逐卡导航 ``hpsp!xxx.action`` 详情页（readonly 模式），
        提取每张卡的正文文本 + 表格。``dataid`` 缺省时从变更列表自动提取。

        参数：
            dataid: 许可证 dataid（30-40 位 UUID，缺省自动提取）
            cards: 要读取的 cardid 列表（缺省读取全部数据卡）

        出参：``{dataid, cards: {cardid: {name, text, tables}}}``。
        """
        self.require_login()
        try:
            cookies = self.auth.export_cookies()
            with self._driver_lock:
                self._driver.start(cookies)
                result = self._driver.license_detail(dataid, cards or None)
            if not result.get("ok"):
                return self.fail(ErrorCode.UPSTREAM_ERROR, result.get("error") or "许可证详情读取失败")
            cards_data = result.get("cards") or {}
            ok_cards = sum(
                1 for c in cards_data.values()
                if not c.get("error") and (c.get("text") or c.get("tables"))
            )
            return self.ok(
                {
                    "dataid": result.get("dataid"),
                    "company_name": result.get("company_name") or "",
                    "cards": cards_data,
                    "card_total": len(cards_data),
                    "ok_cards": ok_cards,
                },
                f"成功，{ok_cards}/{len(cards_data)} 张卡有内容",
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("许可证详情读取失败: %s", exc)
            return self.fail(ErrorCode.UPSTREAM_ERROR, f"许可证详情读取失败: {exc}")

    def license_detail_cards(self) -> ApiResponse:
        """返回许可证详情可用卡片清单（cardid + 名称），供调用方按需指定 cards。"""
        cards = [{"cardid": c[0], "name": c[1]} for c in LICENSE_CARDS]
        return self.ok({"cards": cards}, "成功")

    # ------------------------------------------------------------------
    # 详情穿透（模块 8/9/11 的「查看」详情，SSR GET + 键值对解析）
    # ------------------------------------------------------------------
    def reissue_detail(self, pkid: str = "") -> ApiResponse:
        """穿透读取遗失声明详情（模块 8）。

        通过补办列表记录的 pkid 请求 ``showYssm.action`` 详情页，
        提取遗失声明的键值对（排污许可证编号/单位名称/核发机关/发证日期等）。

        参数：
            pkid: 遗失声明记录主键（32 位 hex，来自 reissue_list 的「查看」链接）

        出参：``{pkid, fields: {标签: 值}}``。
        """
        self.require_login()
        if not pkid:
            return self.fail(ErrorCode.BAD_REQUEST, "缺少 pkid（请先调用 license_reissue_list 获取）")
        try:
            html = self._get_detail(Endpoints.REISSUE_DETAIL, {"pkid": pkid, "searchType": "read"})
            fields = self.parser.parse_detail(html)
            return self.ok({"pkid": pkid, "fields": fields}, f"成功，{len(fields)} 个字段")
        except Exception as exc:  # noqa: BLE001
            logger.exception("遗失声明详情读取失败: %s", exc)
            return self.fail(ErrorCode.UPSTREAM_ERROR, f"遗失声明详情读取失败: {exc}")

    def soil_detail(self, sqdjid: str = "") -> ApiResponse:
        """穿透读取涉重登记详情 + 审批意见（模块 9 土壤管理）。

        通过土壤列表记录的 sqdjid 请求 ``editSqdjZc.action`` 详情页
        与 ``showcommentSqdj.action`` 审批意见页，合并返回。

        参数：
            sqdjid: 涉重登记记录主键（来自 soil_manage_list 的「查看」链接）

        出参：``{sqdjid, fields: {标签: 值}, opinion: {标签: 值}}``。
        """
        self.require_login()
        if not sqdjid:
            return self.fail(ErrorCode.BAD_REQUEST, "缺少 sqdjid（请先调用 soil_manage_list 获取）")
        try:
            html = self._get_detail(Endpoints.SOIL_DETAIL, {"sqdjid": sqdjid, "operate": "read"})
            fields = self.parser.parse_detail(html)
            opinion: dict = {}
            try:
                ohtml = self._get_detail(Endpoints.SOIL_COMMENT, {"sqdjid": sqdjid})
                opinion = self.parser.parse_detail(ohtml)
            except Exception as exc:  # noqa: BLE001
                logger.debug("涉重登记审批意见读取失败: %s", exc)
            return self.ok(
                {"sqdjid": sqdjid, "fields": fields, "opinion": opinion},
                f"成功，{len(fields)} 个字段 + {len(opinion)} 条意见",
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("涉重登记详情读取失败: %s", exc)
            return self.fail(ErrorCode.UPSTREAM_ERROR, f"涉重登记详情读取失败: {exc}")

    def disclosure_detail(
        self,
        pkid: str = "",
        dataid: str = "",
        yy_flag: str = "false",
        with_feedback: bool = True,
    ) -> ApiResponse:
        """穿透读取信息公开详情 + 公众反馈（模块 11）。

        通过信息公开列表记录的 pkid/dataid 请求 ``show.action`` 详情页，
        可选附带 ``showCcfkPageList.action`` 公众反馈页。

        参数：
            pkid: 信息公开记录主键（来自 disclosure_list 的「查看」链接）
            dataid: 许可证 dataid（同来源）
            yyFlag: false=许可申请前公开 / true=其他（默认 false）
            withFeedback: 是否附带读取公众反馈（默认 true）

        出参：``{pkid, dataid, fields: {标签: 值}, feedback: [...]}``。
        """
        self.require_login()
        if not pkid or not dataid:
            return self.fail(ErrorCode.BAD_REQUEST, "缺少 pkid/dataid（请先调用 disclosure_list 获取）")
        try:
            html = self._get_detail(
                Endpoints.DISCLOSURE_DETAIL,
                {"pkid": pkid, "dataid": dataid, "yyFlag": yy_flag},
            )
            fields = self.parser.parse_detail(html)
            feedback: list = []
            if with_feedback:
                try:
                    fhtml = self._get_detail(Endpoints.DISCLOSURE_FEEDBACK, {"pkid": pkid})
                    feedback = self.parser.parse_table(
                        fhtml,
                        ["index", "feedback_content", "feedback_time", "handle_result"],
                    ).records
                except Exception as exc:  # noqa: BLE001
                    logger.debug("公众反馈读取失败: %s", exc)
            return self.ok(
                {"pkid": pkid, "dataid": dataid, "fields": fields, "feedback": feedback},
                f"成功，{len(fields)} 个字段 + {len(feedback)} 条反馈",
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("信息公开详情读取失败: %s", exc)
            return self.fail(ErrorCode.UPSTREAM_ERROR, f"信息公开详情读取失败: {exc}")

    def _get_detail(self, endpoint: str, params: dict) -> str:
        """GET 详情 action，返回 HTML 文本（复用已登录会话）。"""
        url = self.config.internal_url(endpoint)
        resp = self.http.get(url, params=params)
        if not resp.text:
            raise UpstreamError(f"上游返回空响应: {endpoint}")
        return resp.text

    def _ensure_register_session(self) -> bool:
        """排污登记子系统单步 SSO：``autoLoginExt.vm?userCode=`` 建立 jsessionid。

        排污登记是独立 Velocity 子系统（``/register/``），列表/详情页直接
        GET 返回空 body，必须先经 SSO 入口建立 jsessionid 会话。
        """
        if self._register_session_ready:
            return True
        try:
            user_code = self.config.user_code or self.config.username
            url = self.config.url(Endpoints.REGISTER_SSO)
            resp = self.http.get(url, params={"userCode": user_code})
            ok = resp.status_code < 400 and len(resp.text) > 0
            if ok:
                self._register_session_ready = True
                logger.info("排污登记子系统会话建立成功")
            else:
                logger.warning(
                    "排污登记子系统 SSO 返回异常: status=%s len=%s",
                    resp.status_code, len(resp.text),
                )
            return ok
        except Exception as exc:  # noqa: BLE001
            logger.warning("排污登记子系统 SSO 失败: %s", exc)
            return False

    # ------------------------------------------------------------------
    # 内部实现
    # ------------------------------------------------------------------
    @staticmethod
    def _parse_public_license(html: str, permit_code: str, company_name: str) -> Optional[dict]:
        """从公开许可信息结果表中解析第一条匹配记录。"""
        soup = BeautifulSoup(html, "lxml")
        for tr in soup.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) < 7:
                continue
            cells = [re.sub(r"\s+", " ", td.get_text(" ", strip=True)).strip() for td in tds]
            code, name = cells[2], cells[3]
            if not code or code == "许可证编号":
                continue
            if permit_code and permit_code not in code:
                continue
            if company_name and company_name not in name:
                continue
            valid_from, valid_to = LicenseService._split_validity(cells[5])
            return {
                "province": cells[0],
                "city": cells[1],
                "permitCode": code,
                "companyName": name,
                "industry": cells[4] if len(cells) > 4 else "",
                "validity": cells[5] if len(cells) > 5 else "",
                "validFrom": valid_from,
                "validTo": valid_to,
                "issueDate": cells[6] if len(cells) > 6 else "",
                "managementType": cells[7] if len(cells) > 7 else "",
            }
        return None

    @staticmethod
    def _split_validity(validity: str) -> tuple[str, str]:
        m = re.search(r"(\d{4}-\d{2}-\d{2})\s*[至到]\s*(\d{4}-\d{2}-\d{2})", validity or "")
        if m:
            return m.group(1), m.group(2)
        return "", ""

    def _list_form(
        self,
        search_type: str,
        page_no: int,
        page_size: int = 10,
    ) -> dict:
        return {
            "page.pageNo": str(page_no),
            "page.pageSize": str(page_size),
            "page.orderBy": "",
            "page.order": "",
            "enterid": self.config.enterid,
            "searchType": search_type,
            "submit123": "",
        }

    def _post_list(self, endpoint: str, form: dict) -> str:
        url = self.config.internal_url(endpoint)
        resp = self.http.post(url, data=form)
        if not resp.text:
            raise UpstreamError(f"上游返回空响应: {endpoint}")
        return resp.text

    def _check_register(self, enterid: str) -> str:
        text = self.http.get_text(
            self.config.internal_url(Endpoints.CHECK_REGISTER),
            params={"enterid": enterid},
        ).strip()
        return text

    def _check_is_cancel(self, enterid: str) -> str:
        text = self.http.get_text(
            self.config.internal_url(Endpoints.CHECK_IS_CANCEL),
            params={"enterid": enterid},
        ).strip()
        return text

    def _validate_search_type(self, search_type: str) -> None:
        if search_type not in SearchType.VALUES:
            raise ValueError(f"searchType 非法: {search_type}（可选 {list(SearchType.VALUES)}）")

    @staticmethod
    def _list_response(result: ListResult) -> ApiResponse:
        return ApiResponse.ok(result.to_dict(), f"成功，共 {result.total} 条")


__all__ = ["LicenseService"]
