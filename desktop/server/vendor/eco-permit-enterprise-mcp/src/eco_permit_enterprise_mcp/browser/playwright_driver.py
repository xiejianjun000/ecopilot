"""Playwright 驱动：注入 CAS Cookie 复用会话，网络拦截捕获 token/companyInfo。

模块 13/17（执行报告 / 统一报表）为 Vue SPA，其 JSON API 请求体 ``userAccount``
/ ``permitCode`` 为 AES 加密、请求头含 ``sign``(MD5)。**不逆向**，改为驱动浏览器
让 SPA 自行计算签名，通过 ``page.on("response")`` 拦截响应拿干净 JSON（架构 §1.5）。

使用同步 Playwright API（``playwright.sync_api``）；上层工具以 ``asyncio.to_thread``
调用，避免阻塞事件循环。惰性启动 + 复用，token 失效自动重建。
"""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Optional
from urllib.parse import urlencode

from ..config import Config
from ..constants import LICENSE_CARDS
from ..errors import UpstreamError
from ..models import EnterpriseProfile, ListResult

logger = logging.getLogger("eco_permit_enterprise_mcp.browser")

# 关键接口 URL 片段（用于响应拦截匹配）
_AUTOLOGIN_PATTERN = "report/report/api/autoLogin"
_REPORTLIST_PATTERN = "report/report/api/reportList"
_UNIFIED_PATTERN = "report/report/api/unifiedReport"
_BOOK_ACCOUNT_PATTERN = "report/api/bookAccount/v1/list"

# 报告列表页 SPA hash 路由（businessType -> 路由）
_REPORT_ROUTES = {
    "RT": "#/list-rt",   # 执行报告
    "ENV": "#/list-env",  # 统一报表（试运行）
}


class PlaywrightDriver:
    """Playwright 浏览器驱动（惰性启动、复用上下文）。"""

    def __init__(self, config: Config):
        self.config = config
        self._pw = None
        self._browser = None
        self._context = None
        self._page = None
        self._token: Optional[str] = None
        self._profile: Optional[EnterpriseProfile] = None
        self._lock = threading.Lock()
        # Playwright 对象绑定的线程 id（sync API 的 greenlet 与线程强绑定，
        # 跨线程访问会抛 "Cannot switch to a different thread"）
        self._owner_thread_id: Optional[int] = None
        # 网络拦截缓存：pattern -> list[dict]
        self._captured: dict = {}
        # 变更列表提取的企业名称（供 license_detail 结果携带）
        self._change_list_company_name: str = ""
        # 许可证 dataid 缓存（dataid 是许可证稳定标识，提取成功后复用，
        # 避免变更列表加载慢/失败导致 "未找到 dataid"）
        self._license_dataid_cache: str = ""

    # ------------------------------------------------------------------
    # 生命周期
    # ------------------------------------------------------------------
    def start(self, cookies: Optional[list] = None) -> None:
        """启动浏览器并注入 CAS 会话 Cookie（复用纯 HTTP 层会话）。"""
        with self._lock:
            cur_thread = threading.get_ident()
            if self._context is not None and self._owner_thread_id == cur_thread:
                return
            # 线程已变化（ThreadPoolExecutor 空闲回收 worker 线程）或未启动：
            # 旧 Playwright 对象绑定旧线程，跨线程访问会抛
            # "Cannot switch to a different thread"，必须先丢弃再重建。
            if self._context is not None:
                self._discard()
            from playwright.sync_api import sync_playwright

            logger.info("启动 Playwright Chromium (headless=%s)",
                        self.config.playwright_headless)
            self._pw = sync_playwright().start()
            self._browser = self._pw.chromium.launch(
                headless=self.config.playwright_headless
            )
            self._context = self._browser.new_context()
            if cookies:
                try:
                    self._context.add_cookies(cookies)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("注入 Cookie 失败: %s", exc)
            self._page = self._context.new_page()
            self._page.on("response", self._on_response)
            self._owner_thread_id = cur_thread

    def close(self) -> None:
        """关闭浏览器，释放资源。"""
        with self._lock:
            try:
                if self._context:
                    self._context.close()
                if self._browser:
                    self._browser.close()
                if self._pw:
                    self._pw.stop()
            except Exception as exc:  # noqa: BLE001
                logger.debug("关闭浏览器异常: %s", exc)
            finally:
                self._context = None
                self._browser = None
                self._pw = None
                self._page = None
                self._token = None
                self._owner_thread_id = None

    def _discard(self) -> None:
        """丢弃当前 Playwright 实例（供线程切换时重建）。

        先断开引用再尽力优雅关闭：若线程已切换，close/stop 会抛
        "Cannot switch to a different thread"，忽略即可，旧对象交给 GC。
        """
        pw, browser, context = self._pw, self._browser, self._context
        self._pw = None
        self._browser = None
        self._context = None
        self._page = None
        self._token = None
        self._profile = None
        self._owner_thread_id = None
        try:
            if context is not None:
                context.close()
        except Exception:  # noqa: BLE001
            pass
        try:
            if browser is not None:
                browser.close()
        except Exception:  # noqa: BLE001
            pass
        try:
            if pw is not None:
                pw.stop()
        except Exception:  # noqa: BLE001
            pass

    # ------------------------------------------------------------------
    # 网络拦截
    # ------------------------------------------------------------------
    def _on_response(self, response):
        url = response.url
        if _AUTOLOGIN_PATTERN in url:
            self._capture(_AUTOLOGIN_PATTERN, response)
        elif _BOOK_ACCOUNT_PATTERN in url:
            self._capture(_BOOK_ACCOUNT_PATTERN, response)
        elif _REPORTLIST_PATTERN in url or _UNIFIED_PATTERN in url:
            self._capture(_REPORTLIST_PATTERN, response)

    def _capture(self, key: str, response):
        try:
            body = response.text()
            self._captured.setdefault(key, []).append(json.loads(body))
        except Exception as exc:  # noqa: BLE001
            logger.warning("拦截响应解析失败: %s - %s", response.url, exc)

    def _clear_captured(self) -> None:
        self._captured.clear()

    # ------------------------------------------------------------------
    # 业务接口
    # ------------------------------------------------------------------
    def auto_login(self) -> dict:
        """导航 autologin，拦截并返回 ``{token, profile}``。"""
        self._ensure_started()
        self._token = None
        self._profile = None
        self._clear_captured()

        url = self._autologin_url()
        logger.info("导航执行报告 autologin")
        self._page.goto(url, wait_until="domcontentloaded", timeout=30000)
        self._wait_for(lambda: _AUTOLOGIN_PATTERN in self._captured, timeout=30.0)

        payloads = self._captured.get(_AUTOLOGIN_PATTERN, [])
        if not payloads:
            raise UpstreamError("未能拦截到 autoLogin 响应")

        data = self._extract_autologin(payloads[0])
        self._token = data["token"]
        self._profile = data["profile"]
        return data

    def report_list(self, year: int, business_type: str = "RT") -> ListResult:
        """返回执行报告 / 统一报表列表（通过 SPA 触发 reportList 拦截）。"""
        self._ensure_started()
        if not self._token:
            self.auto_login()

        self._clear_captured()
        self._navigate_report_list(year, business_type)
        self._wait_for(
            lambda: bool(self._captured.get(_REPORTLIST_PATTERN)),
            timeout=25.0,
        )

        payloads = self._captured.get(_REPORTLIST_PATTERN, [])
        if not payloads:
            # 降级：返回空列表并提示，不抛异常阻塞主流程
            logger.warning("未能拦截到 reportList 响应，返回空列表")
            return ListResult(total=0, page_no=1, records=[])

        return self._parse_report_list(payloads[0])

    def report_detail(self, record: dict) -> str:
        """深度穿透式读取报告正文。

        点击季报/月报/年报卡片进入填报详情页，遍历左侧菜单逐页提取文本，
        合并返回完整填报内容（能源消耗、产品产量、排放量、治理设施等）。

        参数：
            record: report_list 返回的单条记录字典，需含
                    id/idStr/provinceSharding/yearSharding/reportType 等字段。
        """
        self._ensure_started()
        if not self._token:
            self.auto_login()

        year = record.get("reportYear") or 2026
        report_type = record.get("reportType") or "quarter"
        report_quarter = record.get("reportQuarter")
        report_month = record.get("reportMonth")
        report_label = self._report_label(report_type, report_quarter, report_month)

        # 导航列表页
        self._clear_captured()
        self._navigate_report_list(year, "RT")
        self._wait_for(
            lambda: bool(self._captured.get(_REPORTLIST_PATTERN)),
            timeout=25.0,
        )
        self._page.wait_for_timeout(1000)

        # 点击对应卡片进入填报详情
        card = self._page.locator(".card.select-none", has_text=report_label)
        if card.count() == 0:
            logger.warning("未找到报告卡片: %s", report_label)
            return ""
        card.first.click(timeout=5000)
        self._page.wait_for_timeout(4000)

        # 展开折叠的 el-sub-menu 子菜单
        self._page.evaluate("""() => {
            document.querySelectorAll('.el-sub-menu').forEach(el => {
                el.classList.add('is-opened');
            });
            document.querySelectorAll('.el-sub-menu .el-menu').forEach(el => {
                el.style.display = 'block';
            });
        }""")
        self._page.wait_for_timeout(500)

        # 遍历所有可见菜单项，逐页提取文本
        menu_els = self._page.query_selector_all(".el-menu-item:visible")
        sections = []
        for el in menu_els:
            t = (el.inner_text() or "").strip()
            if not t or len(t) >= 40:
                continue
            try:
                el.click(timeout=3000)
                self._page.wait_for_timeout(1500)
                txt = self._page.inner_text("body")
                # 去掉固定头部/菜单区域，只保留详情正文
                if "返回" in txt:
                    txt = txt[txt.index("返回") + 2:]
                sections.append(f"【{t}】\n{txt}")
            except Exception as exc:  # noqa: BLE001
                logger.debug("菜单项 '%s' 点击失败: %s", t, exc)

        return "\n\n".join(sections)

    # ------------------------------------------------------------------
    # 台账模块（模块 12）
    # ------------------------------------------------------------------
    _LEDGER_SUB_TABS = [
        "台账记录列表",
        "监测信息记录",
        "生产设施运行状况记录",
        "燃料分析记录",
        "废气处理设施运行情况记录",
        "污水处理设施运行情况记录",
    ]

    def ledger_list(self, start_year: int = 2020, end_year: int = 2026) -> dict:
        """穿透读取台账记录列表。

        导航台账系统（permitrep/account/autologin），拦截 bookAccount/v1/list
        响应，返回台账记录列表 + 各子表单数据量。

        参数：
            start_year: 起始年度
            end_year: 截止年度
        """
        self._ensure_started()
        if not self._token:
            self.auto_login()

        self._clear_captured()
        self._navigate_ledger()
        self._wait_for(
            lambda: bool(self._captured.get(_BOOK_ACCOUNT_PATTERN)),
            timeout=25.0,
        )

        payloads = self._captured.get(_BOOK_ACCOUNT_PATTERN, [])
        records = []
        total = 0
        if payloads:
            data = payloads[0].get("data") or payloads[0]
            if isinstance(data, dict):
                records = data.get("list") or data.get("records") or []
                total = data.get("total") or data.get("totalCount") or len(records)
            elif isinstance(data, list):
                records = data
                total = len(records)

        # 遍历子表单 tab，收集各 tab 数据量
        sub_tabs = {}
        for tab_name in self._LEDGER_SUB_TABS[1:]:  # 跳过 "台账记录列表"
            try:
                els = self._page.query_selector_all(f"text={tab_name}")
                if els:
                    els[0].click(timeout=3000)
                    self._page.wait_for_timeout(2000)
                    txt = self._page.inner_text("body")
                    # 提取 "共 N 条" 信息
                    import re
                    m = re.search(r"共\s*(\d+)\s*条", txt)
                    count = int(m.group(1)) if m else 0
                    sub_tabs[tab_name] = {"count": count, "has_data": count > 0}
            except Exception as exc:  # noqa: BLE001
                logger.debug("台账子表 '%s' 读取失败: %s", tab_name, exc)
                sub_tabs[tab_name] = {"count": 0, "has_data": False, "error": str(exc)[:100]}

        return {
            "total": total,
            "records": records,
            "sub_tabs": sub_tabs,
            "has_uploaded": total > 0,
        }

    def _navigate_ledger(self) -> None:
        """导航到台账记录系统。"""
        base = self.config.base_url
        url = (
            f"{base}/permitrep/account/autologin"
            f"?userAccount={self.config.user_code or self.config.username}"
            f"&permitCode={self.config.permit_code}"
            f"&entryType=1"
            f"&cityCode={self.config.city_code}"
        )
        try:
            self._page.goto(url, wait_until="networkidle", timeout=30000)
        except Exception as exc:  # noqa: BLE001
            logger.warning("导航台账系统超时（可能已捕获响应）: %s", exc)

    def ledger_upload(self, entry_type: str = "1", data: dict | None = None) -> dict:
        """上传电子台账（模块 12，写功能）。

        导航台账系统，定位「上传/导入」入口并进入上传界面；若 payload 提供
        ``file_base64``，则解码为临时文件并写入文件上传 input。

        参数：
            entry_type: 台账类型（1=台账记录，2=一般工业固废电子台账）
            data: 上传数据，可含 ``file_name`` / ``file_base64`` / ``year``

        出参：``{ok, error}``。
        """
        import base64
        import tempfile

        data = data or {}
        self._ensure_started()
        if not self._token:
            self.auto_login()

        self._clear_captured()
        self._navigate_ledger()
        self._page.wait_for_timeout(3000)

        # 定位上传/导入入口
        upload_btn = None
        for text in ("上传", "导入", "新增", "添加"):
            btn = self._page.query_selector(f"button:has-text('{text}')")
            if btn is not None:
                upload_btn = btn
                break
        if upload_btn is None:
            return {"ok": False, "error": "未找到台账上传/导入入口"}

        try:
            upload_btn.click(timeout=5000)
            self._page.wait_for_timeout(3000)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"点击上传入口失败: {exc}"}

        # 若提供文件内容，写入文件上传 input
        file_b64 = data.get("file_base64") or data.get("fileBase64") or ""
        if file_b64:
            try:
                raw = base64.b64decode(file_b64)
                suffix = (data.get("file_name") or data.get("fileName") or "ledger.xlsx").rsplit(".", 1)[-1]
                with tempfile.NamedTemporaryFile(delete=False, suffix=f".{suffix}") as tmp:
                    tmp.write(raw)
                    tmp_path = tmp.name
                file_input = self._page.query_selector("input[type='file']")
                if file_input is None:
                    return {"ok": False, "error": "上传界面未找到文件选择 input"}
                file_input.set_input_files(tmp_path, timeout=10000)
                self._page.wait_for_timeout(3000)
                return {"ok": True, "message": "台账文件已选择，待确认提交"}
            except Exception as exc:  # noqa: BLE001
                logger.warning("台账文件上传失败: %s", exc)
                return {"ok": False, "error": f"文件上传失败: {exc}"}

        return {"ok": True, "message": "已进入台账上传界面，未提供文件内容"}

    # ------------------------------------------------------------------
    # 许可证详情（模块 4/5/6/7「查看」详情 = 许可证 20 卡）
    # ------------------------------------------------------------------
    def license_detail(self, dataid: str = "", cards: Optional[list] = None) -> dict:
        """穿透读取许可证详情（模块 4/5/6/7 的「查看」详情）。

        通过 ``dataid`` 逐卡导航 ``hpsp!xxx.action`` 详情页（readonly 模式），
        提取每张卡的正文文本 + 表格。dataid 缺省时从变更列表的 zxtb 链接自动提取。

        参数：
            dataid: 许可证 dataid（30-40 位 UUID，缺省自动提取）
            cards: 要读取的卡片 cardid 列表（缺省读取全部 LICENSE_DATA_CARDS 数据卡）

        出参：``{ok, dataid, cards: {cardid: {name, text, tables}}}``。
        """
        self._ensure_started()
        if not dataid:
            dataid = self._get_license_dataid()
        if not dataid:
            return {"ok": False, "dataid": "", "cards": {}, "error": "未找到审批通过的许可记录 dataid"}

        cards = cards or [c[0] for c in LICENSE_CARDS if c[0] != "card50"]
        result: dict = {
            "ok": True,
            "dataid": dataid,
            "company_name": self._change_list_company_name,
            "cards": {},
        }
        for card_id, name, action_path in LICENSE_CARDS:
            if card_id not in cards:
                continue
            url = self._license_card_url(action_path, dataid, card_id)
            try:
                self._page.goto(url, wait_until="domcontentloaded", timeout=30000)
            except Exception as exc:  # noqa: BLE001
                # 填报主表单页（如 card1 排污单位基本情况 / card2 主要产品及产能）
                # 含大量慢 JS 组件，domcontentloaded 可能迟迟不触发，但正文往往已渲染。
                # 超时不视为失败，继续等待并读取已加载内容。
                logger.warning("许可证详情 %s %s 导航超时，尝试读取已加载内容: %s", card_id, name, exc)
            try:
                self._page.wait_for_timeout(3000)
                text = self._page.inner_text("body")
                tables = self._extract_tables()
                result["cards"][card_id] = {
                    "name": name, "text": text[:30000], "tables": tables[:50],
                }
                logger.info("许可证详情 %s %s 读取成功 text=%d tables=%d",
                            card_id, name, len(text), len(tables))
            except Exception as exc:  # noqa: BLE001
                result["cards"][card_id] = {"name": name, "error": str(exc), "text": "", "tables": []}
                logger.warning("许可证详情 %s %s 读取失败: %s", card_id, name, exc)
        return result

    def _get_license_dataid(self) -> str:
        """从变更列表的 zxtb 链接提取审批通过许可记录的 dataid。

        流程：LicenseRedirect（建立应用会话）→ 变更列表 → 扫描 ``a[href*=zxtb]``。
        """
        # 命中缓存直接返回（dataid 是许可证稳定标识，不因会话/页面重载而变）
        if self._license_dataid_cache:
            return self._license_dataid_cache
        # 1. 先经 LicenseRedirect 建立应用会话（避免直接导航 listBcbg 被 ERR_ABORTED）
        try:
            self._page.goto(self.config.license_redirect, wait_until="domcontentloaded", timeout=20000)
            try:
                self._page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:  # noqa: BLE001
                pass
            self._page.wait_for_timeout(3000)
        except Exception as exc:  # noqa: BLE001
            logger.warning("LicenseRedirect 导航失败: %s", exc)

        # 2. 导航变更列表（带重试）
        list_url = (
            f"{self.config.internal_base}/syssb/ckxm/ckxm!listBcbg.action"
            "?itemTypeID=XZXKTYPE_A&itemtype=TYPEC&searchItem=TYPEC_1"
        )
        for attempt in range(3):
            try:
                self._page.goto(list_url, wait_until="domcontentloaded", timeout=45000)
                break
            except Exception as exc:  # noqa: BLE001
                logger.warning("变更列表导航失败(第%d次): %s", attempt + 1, exc)
                self._page.wait_for_timeout(3000)
        else:
            logger.error("变更列表导航 3 次均失败")
            return ""
        self._page.wait_for_timeout(4000)

        # 3. 从 zxtb 链接提取 dataid，并顺带提取「单位名称」列作为企业名称。
        #    变更列表是 SSR 表格（通过 session 识别企业，不依赖 enterid 表单参数），
        #    比 HTTP license_change_list（enterid 为空时不可靠）更稳定。
        meta = self._page.evaluate("""() => {
            const out = { dataid: '', companyName: '' };
            const as = document.querySelectorAll('a');
            for (const el of as) {
                const h = el.href || '';
                if (!h.includes('zxtb')) continue;
                const m = h.match(/'([a-zA-Z0-9-]{30,40})'/);
                if (m && m[1].length > 30) { out.dataid = m[1]; break; }
            }
            // 单位名称：表格内长度合理、且非表头/状态列的文本（含「公司/厂/集团」等）
            const cells = document.querySelectorAll('table td');
            for (const td of cells) {
                const t = (td.innerText || '').trim();
                if (t.length < 4 || t.length > 60) continue;
                if (/序号|状态|时间|操作|查看|编辑|单位名称|企业名称/.test(t)) continue;
                if (/公司|集团|厂|中心|站|所|局|矿|水泥|钢铁|化工|电力/.test(t)) {
                    out.companyName = t;
                    break;
                }
            }
            return out;
        }""")
        dataid = str(meta.get("dataid") or "")
        company_name = str(meta.get("companyName") or "").strip()
        if dataid:
            self._license_dataid_cache = dataid
            logger.info("从变更列表提取许可证 dataid=%s... companyName=%s", str(dataid)[:20], company_name[:20])
        else:
            logger.warning("变更列表未找到 zxtb 链接（无审批通过的许可记录）")
        self._change_list_company_name = company_name
        return str(dataid or "")

    def _license_card_url(self, action_path: str, dataid: str, card_id: str) -> str:
        """构建许可证详情卡片完整 URL。"""
        base = self.config.internal_base
        if action_path.startswith("hpsp!"):
            prefix = f"{base}/syssb/wysb/hpsp"
        elif action_path.startswith("cpcn"):
            prefix = f"{base}/syssb/cpcn"
        elif action_path.startswith("hpsp/"):
            prefix = f"{base}/syssb/wysb"
        elif action_path.startswith("../"):
            prefix = f"{base}/common"
            action_path = action_path[3:]
        else:
            prefix = f"{base}/syssb/wysb/hpsp"
        # 附件卡（card18）自带固定 query（wysbtype=...），其余统一拼 dataid/operate/cardid
        if "?" in action_path:
            return f"{prefix}/{action_path}&dataid={dataid}&operate=readonly&cardid={card_id}&itemtypeid=XZXKTYPE_A"
        return f"{prefix}/{action_path}?dataid={dataid}&operate=readonly&cardid={card_id}&itemtypeid=XZXKTYPE_A"

    def _extract_tables(self) -> list:
        """提取当前页面所有表格（含表头/单元格文本，去空表格）。"""
        return self._page.evaluate("""() => {
            return Array.from(document.querySelectorAll('table')).map(t => ({
                rows: Array.from(t.querySelectorAll('tr')).slice(0, 100).map(r =>
                    Array.from(r.querySelectorAll('td, th')).map(c => c.innerText.trim().substring(0, 150))
                )
            })).filter(t => t.rows.length > 1 && t.rows.some(r => r.some(c => c.length > 2)));
        }""")

    # ------------------------------------------------------------------
    # 统一报表填报模板（模块 17 写功能基础）
    # ------------------------------------------------------------------
    def report_template_detail(self, template_name: str = "年报", category: str = "统一报表") -> str:
        """读取统一报表填报模板的填报内容（8 个菜单）。

        流程：统一报表列表页 → 点击未提交报告弹「创建报告」→「前往填报模板」
        → 模板列表页 → 找到目标模板点「编辑」→ template-detail-list 页面，
        遍历左侧菜单逐页提取文本，合并返回。

        参数：
            template_name: 填报模板名称（年报/季报/月报）
            category: 模板类型（统一报表/执行报告）
        """
        self._ensure_started()
        if not self._token:
            self.auto_login()

        if not self._navigate_template_edit(template_name, category):
            return ""
        self._expand_menus()

        sections = []
        menu_els = self._page.query_selector_all(".el-menu-item:visible")
        for el in menu_els:
            t = (el.inner_text() or "").strip()
            if not t or len(t) >= 40:
                continue
            try:
                el.click(timeout=3000)
                self._page.wait_for_timeout(1500)
                txt = self._page.inner_text("body")
                if "返回" in txt:
                    txt = txt[txt.index("返回") + 2:]
                sections.append(f"【{t}】\n{txt}")
            except Exception as exc:  # noqa: BLE001
                logger.debug("模板菜单项 '%s' 点击失败: %s", t, exc)

        return "\n\n".join(sections)

    def _navigate_template_edit(self, template_name: str, category: str) -> bool:
        """导航到统一报表填报模板编辑页（模块 17 写功能基础）。

        流程：统一报表列表页 → 点击未提交报告弹「创建报告」→「前往填报模板」
        → 模板列表页 → 找到目标模板点「编辑」→ template-detail-list 页面。

        返回是否成功进入编辑页。
        """
        # 1. 导航统一报表列表页
        self._navigate_report_list(2026, "ENV")
        self._page.wait_for_timeout(3000)

        # 2. 点击未提交报告（3季度）触发「创建报告」弹窗
        card = self._page.locator(".card.select-none", has_text="3季度").first
        if card.count() == 0:
            logger.warning("未找到未提交报告卡片（3季度）")
            return False
        card.locator(".left").first.click(timeout=5000)
        self._page.wait_for_timeout(4000)

        # 3. 点击「前往填报模板」
        goto_tpl = self._page.query_selector("text=前往填报模板")
        if not goto_tpl:
            logger.warning("未找到「前往填报模板」入口")
            return False
        goto_tpl.click(timeout=5000)
        self._page.wait_for_timeout(5000)

        # 4. 在模板列表页找到目标模板行，点击「编辑」
        target_row = None
        for row in self._page.query_selector_all("tr"):
            txt = (row.inner_text() or "").strip()
            if template_name in txt and category in txt:
                target_row = row
                break
        if target_row is None:
            logger.warning("未找到模板: %s / %s", template_name, category)
            return False
        edit_clicked = False
        for btn in target_row.query_selector_all("button, span, a"):
            if (btn.inner_text() or "").strip() == "编辑":
                btn.click(timeout=5000)
                edit_clicked = True
                break
        if not edit_clicked:
            logger.warning("模板「编辑」按钮未找到")
            return False
        self._page.wait_for_timeout(6000)
        return True

    def _expand_menus(self) -> None:
        """展开折叠的 el-sub-menu 子菜单（填报模板/报告详情共用）。"""
        self._page.evaluate("""() => {
            document.querySelectorAll('.el-sub-menu').forEach(el => {
                el.classList.add('is-opened');
            });
            document.querySelectorAll('.el-sub-menu .el-menu').forEach(el => {
                el.style.display = 'block';
            });
        }""")
        self._page.wait_for_timeout(500)

    # ------------------------------------------------------------------
    # 统一报表填报模板写操作（模块 17）
    # ------------------------------------------------------------------
    def report_template_fill(self, template_name: str, category: str, data: dict) -> dict:
        """在统一报表填报模板编辑页填写数据并保存草稿。

        遍历 8 个菜单，逐页用 payload 中的字段填充表单（按 label 文本模糊匹配），
        最后点击「保存」按钮。

        参数：
            template_name: 填报模板名称（年报/季报/月报）
            category: 模板类型（统一报表/执行报告）
            data: 待写入数据，含 ``fields``（{字段名/标签: 值}）字典

        出参：``{ok, filled_count, error}``
        """
        self._ensure_started()
        if not self._token:
            self.auto_login()

        if not self._navigate_template_edit(template_name, category):
            return {"ok": False, "filled_count": 0, "error": "导航填报模板失败"}
        self._expand_menus()

        fields = data.get("fields") if isinstance(data, dict) else {}
        if not fields:
            return {"ok": False, "filled_count": 0, "error": "payload 缺少 fields 字段"}

        filled = 0
        menu_els = self._page.query_selector_all(".el-menu-item:visible")
        for el in menu_els:
            t = (el.inner_text() or "").strip()
            if not t or len(t) >= 40:
                continue
            try:
                el.click(timeout=3000)
                self._page.wait_for_timeout(1500)
                filled += self._fill_current_form(fields)
            except Exception as exc:  # noqa: BLE001
                logger.debug("模板菜单 '%s' 填写失败: %s", t, exc)

        saved = self._click_button("保存", "暂存")
        return {"ok": saved, "filled_count": filled, "error": "" if saved else "保存草稿失败（未找到保存按钮）"}

    def report_template_submit(self, template_name: str, category: str) -> dict:
        """提交统一报表填报模板（模块 17）。

        进入编辑页后点击「提交」按钮。

        参数：
            template_name: 填报模板名称
            category: 模板类型

        出参：``{ok, error}``
        """
        self._ensure_started()
        if not self._token:
            self.auto_login()

        if not self._navigate_template_edit(template_name, category):
            return {"ok": False, "error": "导航填报模板失败"}
        self._expand_menus()

        submitted = self._click_button("提交", "上报")
        return {"ok": submitted, "error": "" if submitted else "提交失败（未找到提交按钮）"}

    # ------------------------------------------------------------------
    # 写操作内部辅助
    # ------------------------------------------------------------------
    def _fill_current_form(self, fields: dict) -> int:
        """在页面上下文中填充当前可见表单（按 label 模糊匹配 fields key）。"""
        script = """(fields) => {
            let filled = 0;
            const setVal = (el, v) => {
                try {
                    const proto = el.tagName === 'SELECT'
                        ? HTMLSelectElement.prototype
                        : (el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype);
                    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
                    setter.call(el, v);
                    el.dispatchEvent(new Event('input', {bubbles: true}));
                    el.dispatchEvent(new Event('change', {bubbles: true}));
                    filled++;
                } catch(e) {}
            };
            const labelOf = (el) => {
                if (el.id) {
                    const lbl = document.querySelector('label[for="' + el.id + '"]');
                    if (lbl && lbl.innerText.trim()) return lbl.innerText.trim();
                }
                const parentLabel = el.closest('label');
                if (parentLabel && parentLabel.innerText.trim()) return parentLabel.innerText.trim();
                let prev = el.previousElementSibling;
                while (prev) {
                    const t = (prev.innerText || '').trim();
                    if (t && t.length < 30) return t;
                    prev = prev.previousElementSibling;
                }
                return (el.placeholder || el.name || el.getAttribute('aria-label') || '').trim();
            };
            document.querySelectorAll('input:visible, textarea:visible, select:visible').forEach(el => {
                const label = labelOf(el);
                if (!label) return;
                let v = fields[label];
                if (v === undefined || v === null) {
                    for (const k in fields) {
                        if (label.includes(k) || k.includes(label)) { v = fields[k]; break; }
                    }
                }
                if (v !== undefined && v !== null) setVal(el, String(v));
            });
            return filled;
        }"""
        result = self._page.evaluate(script, fields)
        try:
            return int(result or 0)
        except (TypeError, ValueError):
            return 0

    def _click_button(self, *texts: str) -> bool:
        """点击指定文本的按钮，返回是否成功（点击后短暂等待页面反馈）。"""
        for text in texts:
            btn = self._page.query_selector(f"button:has-text('{text}')")
            if btn is None:
                btn = self._page.query_selector(f"[role='button']:has-text('{text}')")
            if btn is None:
                continue
            try:
                btn.click(timeout=5000)
                self._page.wait_for_timeout(3000)
                return True
            except Exception as exc:  # noqa: BLE001
                logger.debug("点击按钮 '%s' 失败: %s", text, exc)
                continue
        return False

    # ------------------------------------------------------------------
    # 执行报告写操作（导出/办理记录）
    # ------------------------------------------------------------------
    _EXPORT_PATTERN = "report/api/export/v1/downloadPdf"
    _EXPORT_WORD_PATTERN = "report/api/export/v1/downloadWord"
    _TRANSACT_PATTERN = "report/api/transact/v1/getRecordList"

    def report_export(self, record: dict, fmt: str = "pdf") -> bytes:
        """导出执行报告为 PDF/Word。

        通过 SPA 触发 export/v1/downloadPdf 或 downloadWord API，
        拦截 blob 响应返回二进制内容。

        参数：
            record: 报告记录字典（含 id/provinceSharding/yearSharding 等）
            fmt: 导出格式（pdf 或 word）
        """
        self._ensure_started()
        if not self._token:
            self.auto_login()

        year = record.get("reportYear") or 2026
        report_label = self._report_label(
            record.get("reportType", "quarter"),
            record.get("reportQuarter"),
            record.get("reportMonth"),
        )

        # 导航到报告列表页
        self._clear_captured()
        self._navigate_report_list(year, "RT")
        self._page.wait_for_timeout(2000)

        # 点击对应卡片进入详情页
        card = self._page.locator(".card.select-none", has_text=report_label)
        if card.count() == 0:
            logger.warning("导出报告：未找到卡片 %s", report_label)
            return b""
        card.first.click(timeout=5000)
        self._page.wait_for_timeout(3000)

        # 通过 JS 直接调用导出 API（SPA 内部 fetch，自动携带 sign/token）
        pattern = self._EXPORT_PATTERN if fmt == "pdf" else self._EXPORT_WORD_PATTERN
        api_path = f"/permitrep/report/{pattern}"

        # SPA 的导出 API 需要 oldData + record 字段
        export_data = {
            "oldData": True,
            "id": record.get("idStr") or record.get("id"),
            "idStr": record.get("idStr") or record.get("id"),
            "reportType": record.get("reportType"),
            "reportYear": record.get("reportYear"),
            "reportQuarter": record.get("reportQuarter"),
            "reportMonth": record.get("reportMonth"),
            "provinceSharding": record.get("provinceSharding"),
            "provinceShardingStr": record.get("provinceShardingStr"),
            "yearSharding": record.get("yearSharding"),
            "planProvinceSharding": record.get("planProvinceSharding"),
            "planProvinceShardingStr": record.get("planProvinceShardingStr"),
            "planYearSharding": record.get("planYearSharding"),
            "planId": record.get("planId"),
            "planIdStr": record.get("planIdStr"),
            "businessType": record.get("businessType", "RT"),
        }

        # 在页面上下文中发起请求（自动携带 SPA 的 sign 头）
        result = self._page.evaluate("""async (params) => {
            const apiUrl = params.url;
            const body = params.data;
            try {
                const resp = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(body),
                    responseType: 'blob'
                });
                const buf = await resp.arrayBuffer();
                const arr = Array.from(new Uint8Array(buf));
                return {ok: true, data: arr, size: buf.byteLength};
            } catch(e) {
                return {ok: false, error: e.message};
            }
        }""", {"url": api_path, "data": export_data})

        if not result or not result.get("ok"):
            logger.warning("导出报告失败: %s", result.get("error") if result else "无返回")
            return b""

        data_arr = result.get("data", [])
        return bytes(data_arr) if data_arr else b""

    def report_transact_list(self, record: dict) -> list:
        """读取报告办理记录（审批流程记录）。

        参数：
            record: 报告记录字典
        """
        self._ensure_started()
        if not self._token:
            self.auto_login()

        year = record.get("reportYear") or 2026
        report_label = self._report_label(
            record.get("reportType", "quarter"),
            record.get("reportQuarter"),
            record.get("reportMonth"),
        )

        self._clear_captured()
        self._navigate_report_list(year, "RT")
        self._page.wait_for_timeout(2000)

        # 点击卡片
        card = self._page.locator(".card.select-none", has_text=report_label)
        if card.count() == 0:
            return []
        card.first.click(timeout=5000)
        self._page.wait_for_timeout(3000)

        # 在页面上下文中调用 transact API
        api_path = "/permitrep/report/report/api/transact/v1/getRecordList"
        transact_data = {
            "enterId": self._profile.enterid if self._profile else "",
            "reportYear": record.get("reportYear"),
            "reportMonth": record.get("reportMonth"),
            "reportQuarter": record.get("reportQuarter"),
            "reportId": record.get("idStr") or record.get("id"),
            "reportProvinceSharding": record.get("provinceSharding"),
            "reportYearSharding": record.get("yearSharding"),
        }

        result = self._page.evaluate("""async (params) => {
            const apiUrl = params.url;
            const body = params.data;
            try {
                const resp = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(body)
                });
                const text = await resp.text();
                return text;
            } catch(e) {
                return JSON.stringify({error: e.message});
            }
        }""", {"url": api_path, "data": transact_data})

        if not result:
            return []
        try:
            data = json.loads(result)
            return data.get("data") or data.get("list") or []
        except Exception:
            return []

    def get_profile(self) -> Optional[EnterpriseProfile]:
        """返回最近一次 autoLogin 捕获的企业画像。"""
        return self._profile

    # ------------------------------------------------------------------
    # 内部实现
    # ------------------------------------------------------------------
    def _ensure_started(self) -> None:
        # 线程切换检测：Playwright sync 对象绑定创建它的线程，若当前线程
        # 与绑定线程不一致，必须重建，否则抛 "Cannot switch to a different thread"。
        if self._context is None or self._owner_thread_id != threading.get_ident():
            self.start()

    def _autologin_url(self) -> str:
        base = self.config.base_url
        params = {
            "userAccount": self.config.user_code or self.config.username,
            "permitCode": self.config.permit_code,
            "cityCode": self.config.city_code,
        }
        return f"{base}/permitrep/autologin?{urlencode(params)}"

    def _navigate_report_list(self, year: int, business_type: str) -> None:
        base = self.config.base_url
        route = _REPORT_ROUTES.get(business_type, "#/list-rt")
        url = f"{base}/permitrep/report/{route}?year={year}&businessType={business_type}"
        try:
            self._page.goto(url, wait_until="networkidle", timeout=25000)
        except Exception as exc:  # noqa: BLE001
            logger.warning("导航报告列表页超时（可能已捕获响应）: %s", exc)

    @staticmethod
    def _extract_autologin(payload: dict) -> dict:
        """从 autoLogin 响应中提取 token 与 companyInfo。"""
        data = payload.get("data") or {}
        token = data.get("token") or payload.get("token") or ""
        company_info = data.get("companyInfo") or payload.get("companyInfo") or {}
        profile = EnterpriseProfile.from_company_info(company_info)
        if not token:
            raise UpstreamError("autoLogin 响应缺少 token")
        return {"token": token, "profile": profile}

    @staticmethod
    def _parse_report_list(payload: dict) -> ListResult:
        """解析 reportList 响应为 ListResult。

        reportList 响应结构为 ``data.year`` / ``data.quarter`` / ``data.month``
        三个列表（年度/季度/月度报告），合并返回。
        """
        data = payload.get("data") or payload
        if isinstance(data, dict):
            records = []
            for key in ("year", "quarter", "month"):
                v = data.get(key)
                if isinstance(v, list):
                    records.extend(v)
            total = data.get("total") or data.get("totalCount") or len(records)
            page_no = data.get("pageNo") or data.get("pageNum") or 1
        elif isinstance(data, list):
            records = data
            total = len(records)
            page_no = 1
        else:
            records, total, page_no = [], 0, 1
        return ListResult(total=int(total), page_no=int(page_no), records=records)

    @staticmethod
    def _report_label(report_type: str, quarter: Optional[int], month: Optional[int]) -> str:
        """根据报告类型生成卡片文本标签（用于定位卡片）。"""
        if report_type == "quarter" and quarter:
            return f"{quarter}季度"
        if report_type == "month" and month:
            return f"{month}月"
        if report_type == "year":
            return "年报"
        return report_type or ""

    def _wait_for(self, predicate, timeout: float, interval: float = 0.5) -> bool:
        """轮询等待条件成立。

        关键：必须用 ``page.wait_for_timeout`` 而非 ``time.sleep``——
        Playwright sync API 的事件回调（response 等）在主线程分发，
        纯 ``time.sleep`` 会阻塞事件处理，导致响应事件积压、条件永远不满足。
        """
        deadline = time.time() + timeout
        while time.time() < deadline:
            if predicate():
                return True
            self._page.wait_for_timeout(int(interval * 1000))
        return False


__all__ = ["PlaywrightDriver"]
