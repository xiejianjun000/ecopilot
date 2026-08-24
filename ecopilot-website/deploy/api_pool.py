"""
EcoPilot API 聚合池 — 许可证签发 + 用量聚合 + 客户端轮询

闭环中的核心枢纽:
  - 支付成功后自动签发许可证
  - 客户端心跳同步用量
  - 客户端轮询获取新证(升级/续费)

部署: 与 hermes_admin 同一服务器(81.71.49.185)
端口: 8095
"""

import json
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# ── 配置 ──────────────────────────────────────────────
PORT = int(os.environ.get("API_POOL_PORT", "8095"))
POOL_SECRET = os.environ.get("API_POOL_SECRET", secrets.token_hex(32))

# ── 数据目录 ──────────────────────────────────────────
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
LICENSES_FILE = DATA_DIR / "pool_licenses.json"
USAGE_FILE = DATA_DIR / "pool_usage.json"
HEARTBEATS_FILE = DATA_DIR / "pool_heartbeats.json"

# 与 desktop/server/license_manager.py 共享密钥
LICENSE_SECRET = os.environ.get("ECO_LICENSE_SECRET", "")
if not LICENSE_SECRET:
    _secret_file = Path.home() / ".ecopilot-home" / ".license_secret"
    if _secret_file.exists():
        LICENSE_SECRET = _secret_file.read_bytes()[:32].hex()
    else:
        LICENSE_SECRET = secrets.token_hex(32)

# ── 套餐配额映射 ─────────────────────────────────────
TIER_QUOTA = {
    "free":         {"report_quota": 0,    "trial_days": 0,   "chat": True},
    "pro_trial":    {"report_quota": 3,    "trial_days": 15,  "chat": True},
    "pro":          {"report_quota": -1,   "trial_days": 0,   "chat": True},
    "enterprise":   {"report_quota": -1,   "trial_days": 0,   "chat": True},
}


def _now_iso() -> str:
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


def _now_dt() -> datetime:
    return datetime.now(timezone(timedelta(hours=8)))


def _read_json(path: Path) -> list:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return []


def _write_json(path: Path, data: list):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ══════════════════════════════════════════════════════
# 许可证签发逻辑（与 desktop license_manager 共享签名算法）
# ══════════════════════════════════════════════════════

def _sign_payload(payload_str: str) -> str:
    import hmac
    import hashlib
    key = bytes.fromhex(LICENSE_SECRET) if len(LICENSE_SECRET) == 64 else LICENSE_SECRET.encode()
    if len(key) < 32:
        key = key.ljust(32, b'\0')
    return hmac.new(key, payload_str.encode(), hashlib.sha256).hexdigest()


def _issue_license_v2(fingerprint: str, customer: str, tier: str,
                      report_quota: int, trial_days: int, expire_days: int) -> str:
    """签发 v2 许可证"""
    import base64
    expire = (_now_dt() + timedelta(days=expire_days)).strftime('%Y-%m-%d')
    issue_date = _now_dt().strftime('%Y-%m-%d')
    payload = json.dumps({
        "f": fingerprint,
        "c": customer,
        "i": issue_date,
        "e": expire,
        "v": "2",
        "tier": tier,
        "report_quota": report_quota,
        "reports_used": 0,
        "trial_days": trial_days,
    }, sort_keys=True)
    sig = _sign_payload(payload)
    return f'ECOPILOT-{base64.b64encode(f"{payload}|{sig}".encode()).decode()}'


# ══════════════════════════════════════════════════════
# FastAPI 应用
# ══════════════════════════════════════════════════════

app = FastAPI(title="EcoPilot API Pool", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ══════════════════════════════════════════════════════
# Pydantic Models
# ══════════════════════════════════════════════════════

class LicenseIssueRequest(BaseModel):
    user_id: str = Field(..., min_length=3, description="官网用户ID")
    fingerprint: str = Field(..., min_length=8, description="客户端机器指纹")
    tier: str = Field("pro_trial", description="套餐等级")
    customer: str = Field("", description="企业名称")
    expire_days: int = Field(15, description="有效天数")
    override_quota: Optional[int] = Field(None, description="手动覆盖配额，None=使用默认")


class LicenseRevokeRequest(BaseModel):
    user_id: str = Field(..., description="用户ID")
    reason: str = Field("管理操作", description="吊销原因")


class LicenseExtendRequest(BaseModel):
    user_id: str = Field(..., description="用户ID")
    new_expire_days: int = Field(365, description="新的有效天数(从今天起)")


class UsageSyncRequest(BaseModel):
    user_id: str = Field(..., description="用户ID")
    report_count: int = Field(0, description="报告总使用量")
    timestamp: str = Field("", description="客户端时间戳")


class HeartbeatRequest(BaseModel):
    user_id: str = Field(..., description="用户ID")
    timestamp: str = Field("", description="心跳时间")
    version: str = Field("", description="客户端版本")


# ══════════════════════════════════════════════════════
# API: 健康检查
# ══════════════════════════════════════════════════════

@app.get("/api/pool/health")
async def health():
    return {
        "status": "ok",
        "service": "ecopilot-api-pool",
        "version": "1.0.0",
        "licenses_count": len(_read_json(LICENSES_FILE)),
    }


# ══════════════════════════════════════════════════════
# API: 签发许可证（支付成功后自动调用 / 管理后台手动签发）
# ══════════════════════════════════════════════════════

@app.post("/api/pool/license/issue")
async def issue_license(req: LicenseIssueRequest):
    """签发许可证，返回 ECO PILOT-xxx 授权码"""
    quota_info = TIER_QUOTA.get(req.tier, TIER_QUOTA["free"])
    report_quota = req.override_quota if req.override_quota is not None else quota_info["report_quota"]
    trial_days = quota_info["trial_days"]

    license_key = _issue_license_v2(
        fingerprint=req.fingerprint,
        customer=req.customer,
        tier=req.tier,
        report_quota=report_quota,
        trial_days=trial_days,
        expire_days=req.expire_days,
    )

    # 记录到许可证池
    licenses = _read_json(LICENSES_FILE)
    licenses.append({
        "user_id": req.user_id,
        "fingerprint": req.fingerprint,
        "tier": req.tier,
        "customer": req.customer,
        "license_key": license_key,
        "issued_at": _now_iso(),
        "expire_days": req.expire_days,
        "revoked": False,
    })
    _write_json(LICENSES_FILE, licenses)

    print(f"[API Pool] 签发许可证: user={req.user_id}, tier={req.tier}, quota={report_quota}")
    return {
        "success": True,
        "license_key": license_key,
        "tier": req.tier,
        "report_quota": report_quota,
        "trial_days": trial_days,
        "expire_days": req.expire_days,
    }


# ══════════════════════════════════════════════════════
# API: 吊销许可证
# ══════════════════════════════════════════════════════

@app.post("/api/pool/license/revoke")
async def revoke_license(req: LicenseRevokeRequest):
    licenses = _read_json(LICENSES_FILE)
    for lic in licenses:
        if lic["user_id"] == req.user_id and not lic.get("revoked"):
            lic["revoked"] = True
            lic["revoke_reason"] = req.reason
            lic["revoked_at"] = _now_iso()
            _write_json(LICENSES_FILE, licenses)
            print(f"[API Pool] 吊销许可证: user={req.user_id}, reason={req.reason}")
            return {"success": True, "message": "许可证已吊销"}
    raise HTTPException(status_code=404, detail="未找到有效许可证")


# ══════════════════════════════════════════════════════
# API: 延长许可证（续费成功后调用）
# ══════════════════════════════════════════════════════

@app.post("/api/pool/license/extend")
async def extend_license(req: LicenseExtendRequest):
    """续费后延长有效期，签发新许可证"""
    licenses = _read_json(LICENSES_FILE)
    current = None
    for lic in reversed(licenses):
        if lic["user_id"] == req.user_id and not lic.get("revoked"):
            current = lic
            break

    if not current:
        raise HTTPException(status_code=404, detail="未找到有效许可证")

    license_key = _issue_license_v2(
        fingerprint=current["fingerprint"],
        customer=current.get("customer", ""),
        tier=current["tier"],
        report_quota=TIER_QUOTA.get(current["tier"], {}).get("report_quota", -1),
        trial_days=0,
        expire_days=req.new_expire_days,
    )

    licenses.append({
        "user_id": req.user_id,
        "fingerprint": current["fingerprint"],
        "tier": current["tier"],
        "customer": current.get("customer", ""),
        "license_key": license_key,
        "issued_at": _now_iso(),
        "expire_days": req.new_expire_days,
        "revoked": False,
        "renewal": True,
        "previous_license": current["license_key"][:40] + "...",
    })
    _write_json(LICENSES_FILE, licenses)

    print(f"[API Pool] 延长许可证: user={req.user_id}, days={req.new_expire_days}")
    return {"success": True, "license_key": license_key, "expire_days": req.new_expire_days}


# ══════════════════════════════════════════════════════
# API: 客户端轮询（检查是否有新许可证）
# ══════════════════════════════════════════════════════

@app.get("/api/pool/license/check")
async def check_license(user_id: str, last_issue_time: str = ""):
    """客户端轮询: 检查是否有比 last_issue_time 更新的许可证"""
    licenses = _read_json(LICENSES_FILE)
    latest = None
    for lic in reversed(licenses):
        if lic["user_id"] == user_id and not lic.get("revoked"):
            if not last_issue_time or lic["issued_at"] > last_issue_time:
                latest = lic
            break

    if latest and (not last_issue_time or latest["issued_at"] > last_issue_time):
        return {
            "has_new": True,
            "license_key": latest["license_key"],
            "tier": latest["tier"],
            "issued_at": latest["issued_at"],
        }
    return {"has_new": False}


# ══════════════════════════════════════════════════════
# API: 用量同步（客户端上报）
# ══════════════════════════════════════════════════════

@app.post("/api/pool/usage/sync")
async def sync_usage(req: UsageSyncRequest):
    """客户端上报报告使用量"""
    usage_list = _read_json(USAGE_FILE)
    ts = req.timestamp or _now_iso()

    # 查找今日记录
    today = _now_dt().strftime("%Y-%m-%d")
    updated = False
    for u in usage_list:
        if u["user_id"] == req.user_id and u["date"] == today:
            u["report_count"] = req.report_count
            u["last_sync"] = ts
            updated = True
            break

    if not updated:
        usage_list.append({
            "user_id": req.user_id,
            "date": today,
            "report_count": req.report_count,
            "last_sync": ts,
        })

    _write_json(USAGE_FILE, usage_list)
    return {"success": True}


# ══════════════════════════════════════════════════════
# API: 心跳（客户端在线状态 + 版本上报）
# ══════════════════════════════════════════════════════

@app.post("/api/pool/usage/heartbeat")
async def heartbeat(req: HeartbeatRequest):
    """客户端心跳上报"""
    beats = _read_json(HEARTBEATS_FILE)
    ts = req.timestamp or _now_iso()

    # 去重更新
    for b in beats:
        if b["user_id"] == req.user_id:
            b["last_beat"] = ts
            b["version"] = req.version
            _write_json(HEARTBEATS_FILE, beats)
            return {"success": True, "online": True}

    beats.append({
        "user_id": req.user_id,
        "last_beat": ts,
        "version": req.version or "unknown",
        "first_seen": ts,
    })
    _write_json(HEARTBEATS_FILE, beats)
    return {"success": True, "online": True}


# ══════════════════════════════════════════════════════
# API: 用量汇总（管理后台用）
# ══════════════════════════════════════════════════════

@app.get("/api/pool/usage/summary")
async def usage_summary(user_id: str = "", days: int = 30):
    """管理后台: 查看指定用户的用量汇总"""
    usage_list = _read_json(USAGE_FILE)
    if user_id:
        usage_list = [u for u in usage_list if u["user_id"] == user_id]

    # 限制日期范围
    cutoff = (_now_dt() - timedelta(days=days)).strftime("%Y-%m-%d")
    usage_list = [u for u in usage_list if u["date"] >= cutoff]

    total_reports = sum(u.get("report_count", 0) for u in usage_list)
    return {
        "total_reports": total_reports,
        "days": days,
        "daily_breakdown": sorted(usage_list, key=lambda x: x["date"]),
        "record_count": len(usage_list),
    }


# ══════════════════════════════════════════════════════
# 全局异常处理
# ══════════════════════════════════════════════════════

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    print(f"[API Pool] 未预期异常: {exc}")
    return JSONResponse(status_code=500, content={"detail": "服务器内部错误"})


# ══════════════════════════════════════════════════════
# 启动
# ══════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn

    license_count = len(_read_json(LICENSES_FILE))
    usage_count = len(_read_json(USAGE_FILE))

    print("=" * 50)
    print("  EcoPilot API 聚合池")
    print("=" * 50)
    print(f"  端口:         {PORT}")
    print(f"  已签发许可证: {license_count}")
    print(f"  用量记录:     {usage_count}")
    print(f"  数据目录:     {DATA_DIR}")
    print("=" * 50)

    uvicorn.run(app, host="0.0.0.0", port=PORT)
