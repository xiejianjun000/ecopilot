"""
EcoPilot 网站后端 API
- 联系表单（邮件通知）
- 下载链接管理
- 访客统计
- 演示预约

启动: python3 website_api.py
端口: 8090
"""

import json
import os
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from pydantic import BaseModel, Field, EmailStr

app = FastAPI(title="EcoPilot Website API", version="1.0.0")

# ── CORS ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# ── 数据存储 ──
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
CONTACTS_FILE = DATA_DIR / "contacts.json"
VISITS_FILE = DATA_DIR / "visits.json"
DOWNLOADS_FILE = DATA_DIR / "downloads.json"


def _read_json(path: Path) -> list:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return []


def _write_json(path: Path, data: list):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ════════════════════════════════════════════════════
# Models
# ════════════════════════════════════════════════════

class ContactForm(BaseModel):
    name: str = Field(..., min_length=2, max_length=50, description="联系人姓名")
    company: str = Field(..., min_length=2, max_length=100, description="企业名称")
    phone: str = Field(..., min_length=11, max_length=15, description="联系电话")
    email: Optional[str] = Field(None, description="邮箱")
    industry: Optional[str] = Field(None, description="行业类型")
    message: Optional[str] = Field(None, max_length=500, description="留言")
    source: Optional[str] = Field("website", description="来源渠道")


class DownloadRecord(BaseModel):
    os_type: str = Field(..., description="操作系统: windows/macos")
    version: Optional[str] = Field(None, description="版本号")


class VisitRecord(BaseModel):
    page: str = Field(..., description="访问的页面")
    referrer: Optional[str] = Field(None, description="来源")


# ════════════════════════════════════════════════════
# API: 联系表单
# ════════════════════════════════════════════════════

@app.post("/contact")
async def submit_contact(form: ContactForm):
    """提交联系表单，保存到本地 JSON 并返回成功"""
    record = {
        "id": str(uuid.uuid4())[:8],
        "name": form.name,
        "company": form.company,
        "phone": form.phone,
        "email": form.email,
        "industry": form.industry,
        "message": form.message,
        "source": form.source,
        "created_at": datetime.now().isoformat(),
    }

    contacts = _read_json(CONTACTS_FILE)
    contacts.append(record)
    _write_json(CONTACTS_FILE, contacts)

    # TODO: 接入邮件通知（SMTP 或企业微信 webhook）
    # send_notification(record)

    return {"success": True, "message": "提交成功，我们会尽快联系您"}


@app.get("/contact/stats")
async def contact_stats():
    """联系表单统计（管理后台用）"""
    contacts = _read_json(CONTACTS_FILE)
    today = datetime.now().strftime("%Y-%m-%d")
    today_count = sum(1 for c in contacts if c["created_at"].startswith(today))
    return {
        "total": len(contacts),
        "today": today_count,
        "recent": contacts[-10:] if contacts else [],
    }


# ════════════════════════════════════════════════════
# API: 下载管理
# ════════════════════════════════════════════════════

@app.post("/download")
async def record_download(record: DownloadRecord):
    """记录下载行为"""
    entry = {
        "id": str(uuid.uuid4())[:8],
        "os_type": record.os_type,
        "version": record.version,
        "ip": "logged",  # 实际部署时从 request 获取
        "created_at": datetime.now().isoformat(),
    }

    downloads = _read_json(DOWNLOADS_FILE)
    downloads.append(entry)
    _write_json(DOWNLOADS_FILE, downloads)

    # TODO: 返回实际下载链接
    download_url = {
        "windows": "https://github.com/yourorg/ecopilot/releases/latest/download/EcoPilot-Setup.exe",
        "macos": "https://github.com/yourorg/ecopilot/releases/latest/download/EcoPilot.dmg",
    }.get(record.os_type, "")

    return {"success": True, "download_url": download_url}


@app.get("/download/stats")
async def download_stats():
    """下载统计"""
    downloads = _read_json(DOWNLOADS_FILE)
    win_count = sum(1 for d in downloads if d["os_type"] == "windows")
    mac_count = sum(1 for d in downloads if d["os_type"] == "macos")
    return {
        "total": len(downloads),
        "windows": win_count,
        "macos": mac_count,
        "recent": downloads[-20:] if downloads else [],
    }


# ════════════════════════════════════════════════════
# API: 访客统计
# ════════════════════════════════════════════════════

@app.post("/visit")
async def record_visit(record: VisitRecord):
    """记录页面访问"""
    entry = {
        "page": record.page,
        "referrer": record.referrer,
        "created_at": datetime.now().isoformat(),
    }
    visits = _read_json(VISITS_FILE)
    visits.append(entry)
    _write_json(VISITS_FILE, visits)
    return {"success": True}


@app.get("/visit/stats")
async def visit_stats():
    """访问统计"""
    visits = _read_json(VISITS_FILE)
    total = len(visits)

    # 按页面统计
    page_stats = {}
    for v in visits:
        page = v["page"]
        page_stats[page] = page_stats.get(page, 0) + 1

    # 今日访问
    today = datetime.now().strftime("%Y-%m-%d")
    today_count = sum(1 for v in visits if v["created_at"].startswith(today))

    return {
        "total": total,
        "today": today_count,
        "by_page": page_stats,
    }


# ════════════════════════════════════════════════════
# API: 健康检查
# ════════════════════════════════════════════════════

@app.get("/health")
async def health():
    return {"status": "ok", "service": "ecopilot-website-api", "version": "1.0.0"}


# ════════════════════════════════════════════════════
# 启动
# ════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    print("EcoPilot Website API starting on :8090")
    uvicorn.run(app, host="0.0.0.0", port=8090)
