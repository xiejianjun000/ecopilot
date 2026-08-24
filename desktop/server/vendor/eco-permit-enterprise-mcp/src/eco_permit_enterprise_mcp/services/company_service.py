"""企业画像 + 菜单服务（company_profile / company_menu）。

- ``profile``：优先复用执行报告 autoLogin 捕获的企业画像（公司名/行业等富信息），
  否则回退到配置派生的最小画像（enterid/permitCode/userAccount）。
- ``menu``：返回 18 模块可达性清单（含受限标注），来源为 constants.MODULE_MENU。
"""

from __future__ import annotations

import logging
from typing import Optional

from ..constants import MODULE_MENU
from ..context import AppContext
from ..errors import ApiResponse
from ..models import EnterpriseProfile
from .base_service import BaseService

logger = logging.getLogger("eco_permit_enterprise_mcp.services.company")


class CompanyService(BaseService):
    """企业信息聚合服务。"""

    def profile(self, permit_code: Optional[str] = None) -> ApiResponse:
        """获取企业画像。"""
        self.require_login()
        profile = self._profile_from_driver() or self._profile_from_config()
        # permit_code 参数仅作覆盖（默认取配置值）
        if permit_code:
            profile.permit_code = permit_code
        return self.ok(profile.to_dict(), "成功")

    def menu(self) -> ApiResponse:
        """获取 18 模块菜单可达性清单。"""
        return self.ok(MODULE_MENU, "成功")

    # ------------------------------------------------------------------
    # 内部实现
    # ------------------------------------------------------------------
    def _profile_from_driver(self) -> Optional[EnterpriseProfile]:
        """从报告服务驱动中复用已捕获的企业画像（若已运行过）。"""
        try:
            report_svc = AppContext.get("report")
            driver = getattr(report_svc, "_driver", None)
            if driver is not None:
                return driver.get_profile()
        except Exception:  # noqa: BLE001
            pass
        return None

    def _profile_from_config(self) -> EnterpriseProfile:
        return EnterpriseProfile(
            enterid=self.config.enterid,
            permit_code=self.config.permit_code,
            user_account=self.config.user_code or self.config.username,
        )


__all__ = ["CompanyService"]
