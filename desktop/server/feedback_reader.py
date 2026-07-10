#!/usr/bin/env python3
"""读取用户反馈消息 — Claude 用此脚本查看企业反馈"""
import json, sys
from pathlib import Path

FB_DIR = Path.home() / ".ecopilot-home" / "feedback"

def list_feedback(n: int = 10):
    if not FB_DIR.exists():
        print("暂无反馈")
        return
    files = sorted(FB_DIR.glob("feedback-*.json"), reverse=True)[:n]
    if not files:
        print("暂无反馈")
        return
    for f in files:
        d = json.loads(f.read_text())
        print(f"[{d['time']}] {d.get('contact','匿名')}")
        print(f"  {d['message']}")
        print()

if __name__ == "__main__":
    list_feedback()
