"""
EcoPilot 客户端用量追踪模块

职责:
  - 本地记录报告生成次数
  - 与 api_pool (81.71.49.185:8095) 同步用量
  - 定时心跳上报在线状态
  - 轮询获取新许可证(升级/续费场景)

初始化:
  from usage_tracker import UsageTracker
  tracker = UsageTracker(website_url="http://81.71.49.185", user_id="u_xxx")
"""

import json
import os
import threading
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

DATA_DIR = Path.home() / ".ecopilot-home"
USAGE_FILE = DATA_DIR / "usage.json"
POLL_INTERVAL = 1800  # 30分钟轮询一次新许可证


class UsageTracker:
    def __init__(self, website_url: str = "http://81.71.49.185", user_id: str = ""):
        self.website_url = website_url.rstrip("/")
        self.user_id = user_id
        self._poll_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._new_license_callback = None
        DATA_DIR.mkdir(parents=True, exist_ok=True)

    # ── 本地用量 ──────────────────────────────────────

    def _read_usage(self) -> dict:
        if USAGE_FILE.exists():
            return json.loads(USAGE_FILE.read_text(encoding="utf-8"))
        return {"user_id": self.user_id, "total_reports": 0, "daily": {}}

    def _write_usage(self, data: dict):
        USAGE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def record_report(self) -> int:
        """记录一次报告生成，返回总计数"""
        data = self._read_usage()
        data["total_reports"] = data.get("total_reports", 0) + 1
        today = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d")
        if "daily" not in data:
            data["daily"] = {}
        data["daily"][today] = data["daily"].get(today, 0) + 1
        self._write_usage(data)

        # 异步同步到 api_pool（fire-and-forget）
        self._sync_async(data["total_reports"])
        return data["total_reports"]

    def get_total_reports(self) -> int:
        return self._read_usage().get("total_reports", 0)

    # ── 服务器同步 ────────────────────────────────────

    def _sync_async(self, count: int):
        """异步发送用量到 api_pool"""
        def _send():
            try:
                body = json.dumps({
                    "user_id": self.user_id,
                    "report_count": count,
                    "timestamp": datetime.now(timezone(timedelta(hours=8))).isoformat(),
                }).encode("utf-8")
                req = urllib.request.Request(
                    f"{self.website_url}/api/pool/usage/sync",
                    data=body,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                urllib.request.urlopen(req, timeout=10)
            except Exception:
                pass  # 静默失败，不影响主流程

        t = threading.Thread(target=_send, daemon=True)
        t.start()

    def heartbeat(self, version: str = ""):
        """发送心跳"""
        def _send():
            try:
                body = json.dumps({
                    "user_id": self.user_id,
                    "timestamp": datetime.now(timezone(timedelta(hours=8))).isoformat(),
                    "version": version,
                }).encode("utf-8")
                req = urllib.request.Request(
                    f"{self.website_url}/api/pool/usage/heartbeat",
                    data=body,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                urllib.request.urlopen(req, timeout=10)
            except Exception:
                pass

        t = threading.Thread(target=_send, daemon=True)
        t.start()

    # ── 许可证轮询 ────────────────────────────────────

    def set_new_license_callback(self, callback):
        """设置新许可证回调: callback(license_key)"""
        self._new_license_callback = callback

    def start_license_poll(self):
        """启动后台许可证轮询线程"""
        if self._poll_thread and self._poll_thread.is_alive():
            return
        self._stop_event.clear()
        self._poll_thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._poll_thread.start()

    def stop_license_poll(self):
        """停止轮询"""
        self._stop_event.set()

    def _poll_loop(self):
        """后台轮询线程: 每 POLL_INTERVAL 秒检查一次新许可证"""
        # 从本地读取上次签发时间
        last_checked = ""
        while not self._stop_event.wait(POLL_INTERVAL):
            try:
                url = f"{self.website_url}/api/pool/license/check?user_id={self.user_id}"
                if last_checked:
                    url += f"&last_issue_time={last_checked}"
                req = urllib.request.Request(url, method="GET")
                resp = urllib.request.urlopen(req, timeout=10)
                data = json.loads(resp.read().decode("utf-8"))
                if data.get("has_new") and data.get("license_key"):
                    last_checked = data.get("issued_at", "")
                    if self._new_license_callback:
                        self._new_license_callback(data["license_key"])
            except Exception:
                pass

    def check_new_license_now(self) -> Optional[str]:
        """立即检查是否有新许可证(非阻塞)，返回新 license key 或 None"""
        try:
            url = f"{self.website_url}/api/pool/license/check?user_id={self.user_id}"
            req = urllib.request.Request(url, method="GET")
            resp = urllib.request.urlopen(req, timeout=10)
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("has_new") and data.get("license_key"):
                return data["license_key"]
        except Exception:
            pass
        return None
