"""数据模型：登录态、企业画像、通用列表结果。

纯数据结构（dataclass），不依赖任何 I/O，便于单测与序列化。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Optional


@dataclass
class EnterpriseProfile:
    """企业画像。

    字段与研究报告模块 13 ``autoLogin`` 响应 ``companyInfo`` 对齐：
    ``userAccount / userId / managementType / companyId / enterId /
    companyName / industryName / industryCode / permitCode``。
    """

    enterid: str = ""
    permit_code: str = ""
    company_name: str = ""
    industry_code: str = ""
    industry_name: str = ""
    management_type: str = ""
    user_id: str = ""
    user_account: str = ""
    company_id: str = ""

    @classmethod
    def from_company_info(cls, info: Optional[dict]) -> "EnterpriseProfile":
        """从 autoLogin 的 companyInfo dict 构造画像。"""
        info = info or {}
        return cls(
            enterid=info.get("enterId", "") or "",
            permit_code=info.get("permitCode", "") or "",
            company_name=info.get("companyName", "") or "",
            industry_code=info.get("industryCode", "") or "",
            industry_name=info.get("industryName", "") or "",
            management_type=info.get("managementType", "") or "",
            user_id=str(info.get("userId", "") or ""),
            user_account=info.get("userAccount", "") or "",
            company_id=str(info.get("companyId", "") or ""),
        )

    def to_dict(self) -> dict:
        return {
            "enterid": self.enterid,
            "permitCode": self.permit_code,
            "companyName": self.company_name,
            "industryCode": self.industry_code,
            "industryName": self.industry_name,
            "managementType": self.management_type,
            "userId": self.user_id,
            "userAccount": self.user_account,
            "companyId": self.company_id,
        }


@dataclass
class LoginState:
    """内存态登录会话。"""

    session_id: str = ""
    cookies: list = field(default_factory=list)
    lt: str = ""
    execution: str = ""
    profile: Optional[EnterpriseProfile] = None
    login_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None

    def is_valid(self) -> bool:
        """会话是否仍有效（未过期且存在 Cookie）。"""
        if not self.cookies:
            return False
        if self.expires_at is None:
            return True
        return datetime.now() < self.expires_at

    def remaining_seconds(self) -> int:
        if self.expires_at is None:
            return -1
        return max(0, int((self.expires_at - datetime.now()).total_seconds()))


@dataclass
class ListResult:
    """通用列表返回结构。"""

    total: int = 0
    page_no: int = 1
    records: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "total": self.total,
            "pageNo": self.page_no,
            "records": self.records,
        }


def default_expiry(ttl_seconds: int) -> datetime:
    """生成会话过期时间（now + ttl）。"""
    return datetime.now() + timedelta(seconds=ttl_seconds)


__all__ = [
    "Any",
    "EnterpriseProfile",
    "ListResult",
    "LoginState",
    "default_expiry",
]
