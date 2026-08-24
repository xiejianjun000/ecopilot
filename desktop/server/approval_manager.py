"""写操作审批闸门（human-in-the-loop）。

所有对排污许可平台的**写操作**（填报模板保存/提交、台账上传等）必须经用户审批
后才能执行。本模块提供审批请求的创建、批准、拒绝、查询与持久化。

安全模型：
1. AI/系统准备待写入的数据 → 调用 ``create`` 生成审批请求（含人类可读预览）。
2. 用户在前端查看审批请求，选择批准或拒绝。
3. 写工具（MCP/后端）仅接受 ``approval_id``，校验状态为 ``approved`` 后才执行
   真实写操作；``pending``/``rejected`` 一律拒绝执行。

审批请求为一次性令牌：批准后执行即置为 ``executed``，不可复用。
"""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

logger = logging.getLogger("chat_api.approval")

APPROVALS_FILE = Path.home() / ".ecopilot-home" / "approvals.json"

# 审批操作类型
OP_REPORT_TEMPLATE_FILL = "report_template_fill"   # 统一报表填报模板保存
OP_REPORT_SUBMIT = "report_submit"                 # 报告/模板提交
OP_LEDGER_UPLOAD = "ledger_upload"                 # 台账上传

_OP_LABELS = {
    OP_REPORT_TEMPLATE_FILL: "统一报表填报模板保存",
    OP_REPORT_SUBMIT: "报告提交",
    OP_LEDGER_UPLOAD: "台账上传",
}


class ApprovalManager:
    """写操作审批管理器（进程内单例 + 文件持久化）。"""

    _instance: Optional["ApprovalManager"] = None
    _instance_lock = threading.Lock()

    def __init__(self):
        self._lock = threading.Lock()
        self._approvals: dict = {}
        self._load()

    @classmethod
    def instance(cls) -> "ApprovalManager":
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    # ------------------------------------------------------------------
    # 持久化
    # ------------------------------------------------------------------
    def _load(self) -> None:
        try:
            if APPROVALS_FILE.exists():
                data = json.loads(APPROVALS_FILE.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    self._approvals = data
        except Exception as exc:  # noqa: BLE001
            logger.warning("审批记录加载失败: %s", exc)

    def _save(self) -> None:
        try:
            APPROVALS_FILE.parent.mkdir(parents=True, exist_ok=True)
            APPROVALS_FILE.write_text(
                json.dumps(self._approvals, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("审批记录保存失败: %s", exc)

    # ------------------------------------------------------------------
    # 对外接口
    # ------------------------------------------------------------------
    def create(self, op_type: str, payload: dict, preview: str, source: str = "") -> dict:
        """创建审批请求。

        参数：
            op_type: 操作类型（见 OP_* 常量）
            payload: 待执行写操作的数据（完整、结构化）
            preview: 人类可读的预览文本（供用户判断是否批准）
            source: 触发来源（如 "ai" / "user"）
        """
        if op_type not in _OP_LABELS:
            raise ValueError(f"未知审批操作类型: {op_type}")
        with self._lock:
            approval_id = uuid.uuid4().hex
            record = {
                "id": approval_id,
                "op_type": op_type,
                "op_label": _OP_LABELS[op_type],
                "status": "pending",
                "payload": payload,
                "preview": preview,
                "source": source,
                "created_at": time.time(),
                "reviewed_at": None,
                "executed_at": None,
                "reject_reason": "",
            }
            self._approvals[approval_id] = record
            self._save()
            logger.info("审批请求创建: id=%s type=%s", approval_id, op_type)
            return self._public(record)

    def approve(self, approval_id: str) -> dict:
        """批准审批请求（状态 pending -> approved）。"""
        with self._lock:
            rec = self._approvals.get(approval_id)
            if rec is None:
                raise KeyError(f"审批请求不存在: {approval_id}")
            if rec["status"] != "pending":
                raise ValueError(f"审批请求状态非 pending（当前 {rec['status']}）")
            rec["status"] = "approved"
            rec["reviewed_at"] = time.time()
            self._save()
            return self._public(rec)

    def reject(self, approval_id: str, reason: str = "") -> dict:
        """拒绝审批请求（状态 pending -> rejected）。"""
        with self._lock:
            rec = self._approvals.get(approval_id)
            if rec is None:
                raise KeyError(f"审批请求不存在: {approval_id}")
            if rec["status"] != "pending":
                raise ValueError(f"审批请求状态非 pending（当前 {rec['status']}）")
            rec["status"] = "rejected"
            rec["reviewed_at"] = time.time()
            rec["reject_reason"] = reason or ""
            self._save()
            return self._public(rec)

    def get(self, approval_id: str) -> dict:
        """查询审批请求。"""
        rec = self._approvals.get(approval_id)
        if rec is None:
            raise KeyError(f"审批请求不存在: {approval_id}")
        return self._public(rec)

    def consume(self, approval_id: str) -> dict:
        """执行时校验并消费审批令牌（approved -> executed）。

        供写工具调用：只有 approved 状态才能消费；消费后置为 executed，
        返回 payload 供写工具执行。pending/rejected/executed 均拒绝。
        """
        with self._lock:
            rec = self._approvals.get(approval_id)
            if rec is None:
                raise KeyError(f"审批请求不存在: {approval_id}")
            if rec["status"] != "approved":
                raise PermissionError(
                    f"审批请求未通过（当前 {rec['status']}），禁止执行写操作"
                )
            rec["status"] = "executed"
            rec["executed_at"] = time.time()
            self._save()
            return dict(rec["payload"])

    def list_pending(self) -> list:
        """待审批列表。"""
        with self._lock:
            return [
                self._public(r)
                for r in self._approvals.values()
                if r["status"] == "pending"
            ]

    def list_all(self) -> list:
        """全部审批记录（含历史）。"""
        with self._lock:
            return [self._public(r) for r in self._approvals.values()]

    # ------------------------------------------------------------------
    # 内部
    # ------------------------------------------------------------------
    @staticmethod
    def _public(rec: dict) -> dict:
        """对外返回的审批记录（不含内部完整 payload，避免泄露；用 preview 代替）。"""
        out = {k: v for k, v in rec.items() if k != "payload"}
        out["payload_size"] = len(json.dumps(rec.get("payload", {}), ensure_ascii=False))
        return out


__all__ = [
    "ApprovalManager",
    "OP_REPORT_TEMPLATE_FILL",
    "OP_REPORT_SUBMIT",
    "OP_LEDGER_UPLOAD",
]
