"""执行报告 / 统一报表服务（模块 13/17，Playwright 路径）。

通过 :class:`PlaywrightDriver` 复用 CAS Cookie 注入会话，SPA 自算 sign+AES
完成 autoLogin，拦截响应拿 token/companyInfo，再触发 reportList 拦截报告列表。
"""

from __future__ import annotations

import logging
import threading
from typing import Optional

from ..browser.playwright_driver import PlaywrightDriver
from ..constants import BusinessType
from ..errors import ApiResponse, ErrorCode
from ..models import ListResult
from .base_service import BaseService

logger = logging.getLogger("eco_permit_enterprise_mcp.services.report")


class ReportService(BaseService):
    """执行报告 / 统一报表服务。"""

    def __init__(self, config, auth, http, driver: Optional[PlaywrightDriver] = None):
        super().__init__(config, auth, http)
        self._driver = driver or PlaywrightDriver(config)
        self._driver_lock = threading.Lock()

    # ------------------------------------------------------------------
    # 业务接口
    # ------------------------------------------------------------------
    def report_list(
        self,
        year: int = 2026,
        business_type: str = BusinessType.REPORT,
    ) -> ApiResponse:
        """执行报告列表（模块 13）。"""
        return self._list(year, business_type)

    def unified_report_list(
        self,
        year: int = 2026,
        business_type: str = BusinessType.UNIFIED,
    ) -> ApiResponse:
        """统一报表列表（模块 17）。"""
        return self._list(year, business_type)

    def report_detail(self, record: dict) -> ApiResponse:
        """深度穿透式读取报告正文（模块 13，P1）。

        点击季报/月报/年报卡片进入填报详情页，遍历左侧菜单逐页提取文本，
        合并返回完整填报内容（能源消耗、产品产量、排放量、治理设施等）。

        参数：
            record: report_list 返回的单条记录字典。

        出参：报告正文文本（多页合并）。
        """
        if not record or not record.get("id"):
            return self.fail(ErrorCode.BAD_REQUEST, "record 缺少 id 字段（未提交的报告无正文）")
        try:
            cookies = self.auth.export_cookies()
            with self._driver_lock:
                self._driver.start(cookies)
                content = self._driver.report_detail(record)
            if not content:
                return self.fail(ErrorCode.UPSTREAM_ERROR, "未能读取报告正文（卡片未找到或页面未加载）")
            report_type = record.get("reportType", "")
            quarter = record.get("reportQuarter")
            month = record.get("reportMonth")
            year = record.get("reportYear")
            title = f"{year}年"
            if quarter:
                title += f"{quarter}季度"
            elif month:
                title += f"{month}月"
            title += f"执行报告（{report_type}）"
            data = {
                "title": title,
                "record": record,
                "content": content,
                "content_length": len(content),
            }
            return self.ok(data, f"成功，正文 {len(content)} 字符")
        except Exception as exc:  # noqa: BLE001
            logger.exception("报告正文读取失败: %s", exc)
            return self.fail(ErrorCode.UPSTREAM_ERROR, f"报告正文读取失败: {exc}")

    def report_export(self, record: dict, fmt: str = "pdf") -> ApiResponse:
        """导出执行报告为 PDF/Word（模块 13，P1）。

        参数：
            record: report_list 返回的单条记录字典。
            fmt: 导出格式（pdf 或 word，默认 pdf）。

        出参：二进制内容（base64 编码）与字节数。
        """
        if not record or not record.get("id"):
            return self.fail(ErrorCode.BAD_REQUEST, "record 缺少 id 字段")
        if fmt not in ("pdf", "word"):
            return self.fail(ErrorCode.BAD_REQUEST, f"fmt 非法: {fmt}（仅支持 pdf/word）")
        try:
            cookies = self.auth.export_cookies()
            with self._driver_lock:
                self._driver.start(cookies)
                content = self._driver.report_export(record, fmt)
            if not content:
                return self.fail(ErrorCode.UPSTREAM_ERROR, "导出失败（未找到卡片或导出接口无返回）")
            import base64
            return self.ok(
                {
                    "format": fmt,
                    "size": len(content),
                    "content_base64": base64.b64encode(content).decode("ascii"),
                    "record": record,
                },
                f"成功，导出 {len(content)} 字节",
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("报告导出失败: %s", exc)
            return self.fail(ErrorCode.UPSTREAM_ERROR, f"报告导出失败: {exc}")

    def report_transact_list(self, record: dict) -> ApiResponse:
        """读取报告办理记录/审批流程（模块 13，P1）。

        参数：
            record: report_list 返回的单条记录字典。

        出参：办理记录列表（审批环节、时间、办理人、意见）。
        """
        if not record or not record.get("id"):
            return self.fail(ErrorCode.BAD_REQUEST, "record 缺少 id 字段")
        try:
            cookies = self.auth.export_cookies()
            with self._driver_lock:
                self._driver.start(cookies)
                records = self._driver.report_transact_list(record)
            return self.ok(
                {"record": record, "transact": records},
                f"成功，共 {len(records)} 条办理记录",
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("办理记录读取失败: %s", exc)
            return self.fail(ErrorCode.UPSTREAM_ERROR, f"办理记录读取失败: {exc}")

    def report_template_detail(self, template_name: str = "年报", category: str = "统一报表") -> ApiResponse:
        """读取统一报表填报模板内容（模块 17，写功能基础）。

        进入填报模板编辑页，遍历 8 个菜单（企业基本信息/生产活动情况/
        生产单元信息/燃料及原辅材料/工业固废/污染治理设施/自行监测/排放口）
        逐页提取文本，合并返回。

        参数：
            template_name: 填报模板名称（年报/季报/月报）
            category: 模板类型（统一报表/执行报告）

        出参：模板填报内容（多菜单合并文本）。
        """
        try:
            cookies = self.auth.export_cookies()
            with self._driver_lock:
                self._driver.start(cookies)
                content = self._driver.report_template_detail(template_name, category)
            if not content:
                return self.fail(ErrorCode.UPSTREAM_ERROR, "未能读取填报模板（模板未找到或页面未加载）")
            return self.ok(
                {
                    "template_name": template_name,
                    "category": category,
                    "content": content,
                    "content_length": len(content),
                },
                f"成功，模板内容 {len(content)} 字符",
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("填报模板读取失败: %s", exc)
            return self.fail(ErrorCode.UPSTREAM_ERROR, f"填报模板读取失败: {exc}")

    def report_template_fill(self, template_name: str = "年报", category: str = "统一报表", data: dict | None = None) -> ApiResponse:
        """在统一报表填报模板编辑页填写数据并保存草稿（模块 17，写功能）。

        参数：
            template_name: 填报模板名称（年报/季报/月报）
            category: 模板类型（统一报表/执行报告）
            data: 待写入数据，含 ``fields``（{字段名/标签: 值}）字典

        出参：``{ok, filled_count, error}``（filled_count 为成功填充的字段数）。
        """
        data = data or {}
        try:
            cookies = self.auth.export_cookies()
            with self._driver_lock:
                self._driver.start(cookies)
                result = self._driver.report_template_fill(template_name, category, data)
            if result.get("ok"):
                return self.ok(
                    {
                        "template_name": template_name,
                        "category": category,
                        "filled_count": result.get("filled_count", 0),
                    },
                    f"成功，填充 {result.get('filled_count', 0)} 个字段",
                )
            return self.fail(ErrorCode.UPSTREAM_ERROR, result.get("error") or "保存草稿失败")
        except Exception as exc:  # noqa: BLE001
            logger.exception("填报模板保存失败: %s", exc)
            return self.fail(ErrorCode.UPSTREAM_ERROR, f"填报模板保存失败: {exc}")

    def report_template_submit(self, template_name: str = "年报", category: str = "统一报表") -> ApiResponse:
        """提交统一报表填报模板（模块 17，写功能）。

        参数：
            template_name: 填报模板名称
            category: 模板类型

        出参：``{ok, error}``。
        """
        try:
            cookies = self.auth.export_cookies()
            with self._driver_lock:
                self._driver.start(cookies)
                result = self._driver.report_template_submit(template_name, category)
            if result.get("ok"):
                return self.ok(
                    {"template_name": template_name, "category": category},
                    "提交成功",
                )
            return self.fail(ErrorCode.UPSTREAM_ERROR, result.get("error") or "提交失败")
        except Exception as exc:  # noqa: BLE001
            logger.exception("填报模板提交失败: %s", exc)
            return self.fail(ErrorCode.UPSTREAM_ERROR, f"填报模板提交失败: {exc}")

    def profile(self) -> ApiResponse:
        """返回最近一次 autoLogin 捕获的企业画像。"""
        profile = self._driver.get_profile()
        if profile is None:
            return self.fail(ErrorCode.UPSTREAM_ERROR, "尚未获取企业画像（先调用 report_list）")
        return self.ok(profile.to_dict(), "成功")

    def auto_login(self) -> ApiResponse:
        """触发 autologin，返回 token + 企业画像（companyName/industryName/managementType 等富信息）。

        供 company_profile 补全画像使用：纯 HTTP CAS 登录只拿到最小画像
        （enterid/permitCode/userAccount），富信息需 Playwright 拦截 autoLogin 响应。
        """
        try:
            cookies = self.auth.export_cookies()  # 确保会话有效并导出 Cookie
            with self._driver_lock:
                self._driver.start(cookies)
                data = self._driver.auto_login()
            profile = data.get("profile")
            return self.ok(
                {
                    "token": data.get("token", ""),
                    "profile": profile.to_dict() if profile else None,
                },
                "成功",
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("autologin 失败: %s", exc)
            return self.fail(ErrorCode.UPSTREAM_ERROR, f"autologin 失败: {exc}")

    # ------------------------------------------------------------------
    # 内部实现
    # ------------------------------------------------------------------
    def _list(self, year: int, business_type: str) -> ApiResponse:
        if business_type not in BusinessType.VALUES:
            return self.fail(ErrorCode.BAD_REQUEST, f"businessType 非法: {business_type}")
        try:
            cookies = self.auth.export_cookies()  # 确保会话有效并导出 Cookie
            with self._driver_lock:
                self._driver.start(cookies)
                result = self._driver.report_list(year, business_type)
            data = {
                "businessType": business_type,
                "businessTypeName": BusinessType.VALUES.get(business_type, ""),
                "year": year,
                "profile": self._driver.get_profile().to_dict()
                if self._driver.get_profile() else None,
                **result.to_dict(),
            }
            return self.ok(data, f"成功，共 {result.total} 条")
        except Exception as exc:  # noqa: BLE001
            logger.exception("报告列表查询失败: %s", exc)
            return self.fail(ErrorCode.UPSTREAM_ERROR, f"报告查询失败: {exc}")

    def close(self) -> None:
        """关闭浏览器驱动（server 关闭时调用）。"""
        try:
            self._driver.close()
        except Exception:  # noqa: BLE001
            pass


__all__ = ["ReportService"]
