#!/usr/bin/env python3
"""
生成本地测试用的模拟 failed_callbacks.jsonl 文件。

用法:
  python3 scripts/gen_test_callbacks.py --count 5        # 生成 5 条模拟记录
  python3 scripts/gen_test_callbacks.py --count 3 --from-users  # 从现有 users.json 随机取用户
  python3 scripts/gen_test_callbacks.py --reset           # 清空 failed_callbacks.jsonl

本地测试补偿机制:
  1. python3 scripts/gen_test_callbacks.py --count 5
  2. python3 scripts/retry_failed_callbacks.py --dry-run   # 查看待处理
  3. bash scripts/auto_retry_callbacks.sh                   # 执行补偿
  4. python3 scripts/retry_failed_callbacks.py --dry-run   # 验证已清除
  5. curl http://localhost:8091/api/auth/metrics | python3 -m json.tool
"""

import json
import os
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
USERS_FILE = DATA_DIR / "users.json"
FAILED_FILE = DATA_DIR / "failed_callbacks.jsonl"


def gen_fake_user_ids(count: int, from_users: bool = False) -> list[dict]:
    """生成测试用的 user_id 和 email 列表。"""
    records = []

    if from_users and USERS_FILE.exists():
        with open(USERS_FILE) as f:
            users = json.load(f)
        sampled = random.sample(users, min(count, len(users)))
        for u in sampled:
            records.append({
                "user_id": u["id"],
                "email": u["email"],
            })
    else:
        for i in range(count):
            uid = f"test_pending_{int(time.time())}_{i:04d}"
            records.append({
                "user_id": uid,
                "email": f"{uid}@ecopilot.test",
            })

    return records


def generate(count: int = 5, from_users: bool = False, reset: bool = False):
    if reset:
        FAILED_FILE.write_text("")
        print(f"✓ 已清空 {FAILED_FILE}")
        return

    records = gen_fake_user_ids(count, from_users)
    error_types = ["URLError", "URLError", "TimeoutError", "ConnectionError"]
    messages = [
        "<urlopen error [Errno 61] Connection refused>",
        "<urlopen error [Errno 60] Operation timed out>",
        "timed out",
        "<urlopen error [Errno 111] Connection refused>",
    ]

    lines = []
    for rec in records:
        record = {
            "user_id": rec["user_id"],
            "email": rec["email"],
            "error_type": random.choice(error_types),
            "error_message": random.choice(messages),
            "total_attempts": 3,
            "failed_at": (datetime.now(timezone(timedelta(hours=8)))
                          .isoformat(timespec="seconds")),
            "resolved": False,
        }
        lines.append(json.dumps(record, ensure_ascii=False))

    # 追加模式（不覆盖已有记录）
    with open(FAILED_FILE, "a", encoding="utf-8") as f:
        for line in lines:
            f.write(line + "\n")
            rec_display = json.loads(line)
            print(f"  + {rec_display['user_id']}  {rec_display['error_type']}  {rec_display['failed_at']}")

    # 统计
    total = sum(1 for _ in open(FAILED_FILE, "r") if _.strip())
    print(f"\n✓ 已写入 {len(lines)} 条 (当前共 {total} 条 unresolved)")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="生成测试用的 failed_callbacks.jsonl")
    parser.add_argument("--count", type=int, default=5, help="生成数量")
    parser.add_argument("--from-users", action="store_true", help="从现有 users.json 取用户")
    parser.add_argument("--reset", action="store_true", help="清空 failed_callbacks.jsonl")
    args = parser.parse_args()

    generate(count=args.count, from_users=args.from_users, reset=args.reset)
