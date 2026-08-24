#!/usr/bin/env python3
"""
降级恢复脚本：重试所有 failed_callbacks.jsonl 中未解决的订阅创建请求。

用法:
  python3 scripts/retry_failed_callbacks.py        # 重试所有未解决的
  python3 scripts/retry_failed_callbacks.py --dry-run  # 仅查看待处理列表
  python3 scripts/retry_failed_callbacks.py --user-id u_xxx  # 仅重试指定用户
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

# ── 配置 ──────────────────────────────────────────────
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
FAILED_FILE = DATA_DIR / "failed_callbacks.jsonl"
SUB_URL = "http://127.0.0.1:8092/api/subscription/create-free"
INTERNAL_KEY = os.environ.get("ECO_INTERNAL_API_KEY", "eco-internal-dev-key-change-in-production")
RETRY_MAX = 3
RETRY_BACKOFF = 1.0  # 秒


def cst_now() -> str:
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


def _call_sub_api(user_id: str, email: str) -> tuple[bool, str]:
    """调用 subscription_service 创建免费订阅。返回 (成功, 消息)。"""
    payload = json.dumps({"user_id": user_id, "email": email, "plan": "free"}).encode("utf-8")

    for attempt in range(RETRY_MAX):
        req = urllib.request.Request(
            SUB_URL,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "x-internal-key": INTERNAL_KEY,
            },
            method="POST",
        )
        try:
            resp = urllib.request.urlopen(req, timeout=5)
            return True, f"HTTP {resp.status}"
        except urllib.error.HTTPError as e:
            return False, f"HTTP {e.code}"
        except Exception as e:
            if attempt < RETRY_MAX - 1:
                time.sleep(RETRY_BACKOFF * (attempt + 1))
                continue
            return False, str(e)[:100]
    return False, "exhausted retries"


def retry_all(dry_run: bool = False, target_user_id: Optional[str] = None) -> dict:
    """遍历 failed_callbacks.jsonl，重试所有未解决项。返回汇总。"""
    if not FAILED_FILE.exists():
        print("✓ 没有待处理的回调记录")
        return {"total": 0, "resolved": 0, "failed": 0}

    records = []
    with open(FAILED_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))

    # 筛选未解决的
    pending = [r for r in records if not r.get("resolved", False)]
    if target_user_id:
        pending = [r for r in pending if r["user_id"] == target_user_id]

    if not pending:
        print("✓ 所有回调记录已解决")
        return {"total": 0, "resolved": 0, "failed": 0}

    print(f"📋 待处理回调: {len(pending)} 条")
    print("-" * 50)

    result = {"total": len(pending), "resolved": 0, "failed": 0}

    for i, rec in enumerate(pending, 1):
        uid = rec["user_id"]
        email = rec.get("email", "?")
        failed_at = rec.get("failed_at", "?")

        if dry_run:
            print(f"  [{i}/{len(pending)}] uid={uid} email={email} failed_at={failed_at}  (DRY RUN)")
            continue

        print(f"  [{i}/{len(pending)}] uid={uid} email={email} ...", end=" ")
        ok, msg = _call_sub_api(uid, email)
        if ok:
            rec["resolved"] = True
            rec["resolved_at"] = cst_now()
            result["resolved"] += 1
            print(f"✓ {msg}")
        else:
            result["failed"] += 1
            print(f"✗ {msg}")

    # 写回文件
    if not dry_run:
        with open(FAILED_FILE, "w", encoding="utf-8") as f:
            for rec in records:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    print("-" * 50)
    print(f"  解决: {result['resolved']}  失败: {result['failed']}  (dry_run={dry_run})")

    if result["failed"] == 0 and result["resolved"] > 0:
        print("✓ 所有降级回调已恢复")
    elif result["failed"] > 0:
        print(f"⚠ {result['failed']} 条仍然失败，请检查 subscription_service 状态")

    return result


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="重试失败的订阅创建回调")
    parser.add_argument("--dry-run", action="store_true", help="仅查看，不实际调用")
    parser.add_argument("--user-id", type=str, help="仅重试指定用户")
    args = parser.parse_args()

    retry_all(dry_run=args.dry_run, target_user_id=args.user_id)
