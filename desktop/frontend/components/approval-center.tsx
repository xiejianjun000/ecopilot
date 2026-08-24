"use client"
import { useEffect, useState, useCallback } from "react"
import { ShieldCheck, X, Check, Play, Clock, Loader2, AlertTriangle, CheckCircle2, Ban } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { fetchApprovals, approveApproval, rejectApproval, executeApproval, type ApprovalItem } from "@/lib/api"

/* ═══════════════════════════════════════════════════════
 * 审批中心 — 写操作 human-in-the-loop 闸门
 *
 * 所有对排污许可平台的写操作（统一报表填报模板保存/报告提交/
 * 台账上传）必须经用户审批后执行：
 *   pending  → 用户审查 preview，点「批准」或「拒绝」
 *   approved → 点「执行」真正写入平台（一次性令牌，执行后置为 executed）
 *   executed/rejected → 历史记录
 * ═══════════════════════════════════════════════════════ */

const STATUS_META: Record<ApprovalItem["status"], { label: string; icon: LucideIcon; cls: string }> = {
  pending:   { label: "待审批",       icon: Clock,          cls: "bg-warning/10 text-warning border-warning/30" },
  approved:  { label: "已批准·待执行", icon: CheckCircle2,   cls: "bg-info/10 text-info border-info/30" },
  rejected:  { label: "已拒绝",       icon: Ban,            cls: "bg-destructive/10 text-destructive border-destructive/30" },
  executed:  { label: "已执行",       icon: CheckCircle2,   cls: "bg-success/10 text-success border-success/30" },
}

function fmtTime(ts: number | null): string {
  if (!ts) return ""
  return new Date(ts * 1000).toLocaleString("zh-CN", { hour12: false })
}

interface Props { open: boolean; onClose: () => void }

export function ApprovalCenter({ open, onClose }: Props) {
  const [items, setItems] = useState<ApprovalItem[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ id: string; ok: boolean; text: string } | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetchApprovals(false)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!open) return
    load()
  }, [open, load])

  const handleApprove = async (id: string) => {
    setBusyId(id)
    const ok = await approveApproval(id)
    setBusyId(null)
    setFeedback({ id, ok, text: ok ? "已批准，可点击「执行」写入平台" : "批准失败" })
    load()
  }

  const handleReject = async (id: string) => {
    setBusyId(id)
    const ok = await rejectApproval(id)
    setBusyId(null)
    setFeedback({ id, ok, text: ok ? "已拒绝该写操作" : "拒绝失败" })
    load()
  }

  const handleExecute = async (id: string) => {
    setBusyId(id)
    const res = await executeApproval(id)
    setBusyId(null)
    setFeedback({
      id,
      ok: res.ok,
      text: res.ok ? "写操作已执行" : `执行失败：${res.error || "未知错误"}`,
    })
    load()
  }

  if (!open) return null

  const pending = items.filter(i => i.status === "pending")
  const approved = items.filter(i => i.status === "approved")
  const history = items.filter(i => i.status === "rejected" || i.status === "executed")

  return (
    <div className="fixed inset-0 z-[200]" onClick={onClose}>
      <div
        className="absolute right-4 top-16 w-[400px] rounded-2xl border border-border bg-popover shadow-popover overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-eco-600" />
            <span className="text-body font-semibold text-foreground">审批中心</span>
          </div>
          <div className="flex items-center gap-2">
            {pending.length > 0 && (
              <span className="rounded-full bg-warning/10 px-2 py-0.5 text-caption font-medium text-warning">
                {pending.length} 项待审批
              </span>
            )}
            <button
              onClick={onClose}
              aria-label="关闭"
              className="rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* 内容 */}
        <div className="max-h-[520px] overflow-y-auto p-3 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-8 text-caption text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> 加载中…
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <div className="flex size-9 items-center justify-center rounded-xl bg-success/10">
                <CheckCircle2 className="size-4 text-success" strokeWidth={1.5} />
              </div>
              <p className="text-caption text-muted-foreground">暂无待审批的写操作</p>
            </div>
          ) : (
            <>
              {pending.length + approved.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-success/10">
                    <CheckCircle2 className="size-4 text-success" strokeWidth={1.5} />
                  </div>
                  <p className="text-caption text-muted-foreground">暂无待处理审批</p>
                </div>
              )}

              {[...pending, ...approved].map(item => (
                <ApprovalCard
                  key={item.id}
                  item={item}
                  busy={busyId === item.id}
                  feedback={feedback?.id === item.id ? feedback : null}
                  onApprove={() => handleApprove(item.id)}
                  onReject={() => handleReject(item.id)}
                  onExecute={() => handleExecute(item.id)}
                />
              ))}

              {history.length > 0 && (
                <>
                  <div className="flex items-center gap-2 px-1 pt-2">
                    <div className="h-px flex-1 bg-border/60" />
                    <span className="text-caption font-mono text-muted-foreground">历史记录</span>
                    <div className="h-px flex-1 bg-border/60" />
                  </div>
                  {history.map(item => (
                    <div key={item.id} className="rounded-xl border border-border/50 px-4 py-2.5 opacity-70">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-body font-medium text-foreground leading-snug">{item.op_label}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">{item.preview}</p>
                        </div>
                        <StatusBadge status={item.status} />
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: ApprovalItem["status"] }) {
  const meta = STATUS_META[status]
  const Icon = meta.icon
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-caption font-medium", meta.cls)}>
      <Icon className="size-3" />
      {meta.label}
    </span>
  )
}

function ApprovalCard({ item, busy, feedback, onApprove, onReject, onExecute }: {
  item: ApprovalItem
  busy: boolean
  feedback: { id: string; ok: boolean; text: string } | null
  onApprove: () => void
  onReject: () => void
  onExecute: () => void
}) {
  return (
    <div className="rounded-xl border border-border px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldCheck className="size-4 shrink-0 text-eco-600" />
          <p className="text-body font-medium text-foreground leading-snug truncate">{item.op_label}</p>
        </div>
        <StatusBadge status={item.status} />
      </div>

      {/* 人类可读预览 */}
      <div className="mt-2 rounded-lg bg-secondary/40 px-3 py-2">
        <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap break-words">{item.preview}</p>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-caption font-mono text-muted-foreground tabular-nums">
          {fmtTime(item.created_at)}
        </span>
        {feedback && (
          <span className={cn("text-caption", feedback.ok ? "text-success" : "text-destructive")}>
            {feedback.ok && <Check className="size-3 inline mr-0.5" />}
            {!feedback.ok && <AlertTriangle className="size-3 inline mr-0.5" />}
            {feedback.text}
          </span>
        )}
      </div>

      {/* 操作按钮 */}
      {item.status === "pending" && (
        <div className="mt-2.5 flex items-center gap-2">
          <button
            onClick={onApprove}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-eco-600 px-3 py-1.5 text-caption font-medium text-white hover:bg-eco-500 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            批准
          </button>
          <button
            onClick={onReject}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-caption font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
            拒绝
          </button>
        </div>
      )}

      {item.status === "approved" && (
        <div className="mt-2.5">
          <button
            onClick={onExecute}
            disabled={busy}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-caption font-medium text-background hover:opacity-90 disabled:opacity-50 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            执行写操作
          </button>
        </div>
      )}
    </div>
  )
}
