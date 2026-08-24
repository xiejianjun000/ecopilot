"""
EcoPilot 平台账号凭证管理器

自动保存各环保政务平台的登录凭证（账号/密码），
验证码每次手动输入，不自动识别。
"""

from __future__ import annotations

import json
import os
from pathlib import Path

CREDENTIALS_DIR = Path.home() / ".ecopilot-home" / "credentials"
CREDENTIALS_FILE = CREDENTIALS_DIR / "platforms.json"


def _ensure_dir():
    CREDENTIALS_DIR.mkdir(parents=True, exist_ok=True)


def _load_all() -> dict:
    """加载所有已保存的凭证"""
    if not CREDENTIALS_FILE.exists():
        return {}
    try:
        return json.loads(CREDENTIALS_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save_all(data: dict):
    """保存所有凭证到文件"""
    _ensure_dir()
    # 写前备份（防止写入中断导致数据丢失）
    if CREDENTIALS_FILE.exists():
        backup = CREDENTIALS_FILE.with_suffix(".json.bak")
        CREDENTIALS_FILE.rename(backup)
    CREDENTIALS_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def save_credentials(platform_id: str, username: str, password: str) -> bool:
    """
    保存指定平台的登录凭证。
    验证码不保存，每次手动输入。
    """
    if not platform_id or not username or not password:
        return False
    data = _load_all()
    data[platform_id] = {
        "username": username,
        "password": password,
        "saved_at": __import__("datetime").datetime.now().isoformat(),
    }
    _save_all(data)
    return True


def get_credentials(platform_id: str) -> dict | None:
    """获取指定平台的已保存凭证（含密码）"""
    data = _load_all()
    return data.get(platform_id)


def list_platforms() -> list[dict]:
    """列出所有已保存凭证的平台（不含密码）"""
    data = _load_all()
    result = []
    for pid, cred in data.items():
        result.append({
            "platform_id": pid,
            "username": cred.get("username", ""),
            "has_password": bool(cred.get("password")),
            "saved_at": cred.get("saved_at", ""),
        })
    return result


def delete_credentials(platform_id: str) -> bool:
    """删除指定平台的凭证"""
    data = _load_all()
    if platform_id in data:
        del data[platform_id]
        _save_all(data)
        return True
    return False


def clear_all():
    """清空所有凭证"""
    _save_all({})


# 平台名称映射（与 links.tsx 一一对应）
PLATFORM_NAMES = {
    "permit": "全国排污许可证管理信息平台",
    "solid-waste": "国家固体废物污染环境防治信息平台",
    "online-monitoring": "在线监测管理平台",
}

# 平台登录页 URL（供无头浏览器手动登录时打开）
PLATFORM_URLS = {
    "permit": "https://permit.mee.gov.cn",
    "solid-waste": "https://swmd.mee.gov.cn",
    "online-monitoring": "https://wryjc.cnemc.cn",
}

# 反向映射：平台名 → platform_id
NAME_TO_ID = {v: k for k, v in PLATFORM_NAMES.items()}
