"use client"
import { useState, useEffect, useRef } from "react"
import {
  X, Plus, Calendar, Clock, MapPin,
  AlertTriangle, CheckCircle2, Loader2, Send,
  ChevronDown,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { apiPost } from "@/lib/api"


type EvtType = "permit" | "report" | "monitor" | "ledger" | "alert"

const EVT_META: Record<EvtType, { label: string; color: string; bg: string; text: string; dot: string }> = {
  permit: { label: "许可", color: "#0ea5e9", bg: "bg-sky-100", text: "text-sky-700", dot: "bg-sky-500" },
  report: { label: "报告", color: "#f97316", bg: "bg-orange-100", text: "text-orange-700", dot: "bg-orange-500" },
  monitor: { label: "监测", color: "#22c55e", bg: "bg-green-100", text: "text-green-700", dot: "bg-green-500" },
  ledger: { label: "台账", color: "#8b5cf6", bg: "bg-violet-100", text: "text-violet-700", dot: "bg-violet-500" },
  alert: { label: "告警", color: "#ef4444", bg: "bg-red-100", text: "text-red-700", dot: "bg-red-500" },
}

export function AddEventModal({
  open, defaultDate, onClose, onSuccess,
}: {
  open: boolean
  defaultDate: string
  onClose: () => void
  onSuccess: (msg: string) => void
}) {
  const [title, setTitle] = useState("")
  const [date, setDate] = useState(defaultDate)
  const [type, setType] = useState<EvtType>("ledger")
  const [desc, setDesc] = useState("")
  const [repeat, setRepeat] = useState("")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  // 打开时重置 + 聚焦
  useEffect(() => {
    if (!open) return
    setTitle("")
    setDate(defaultDate)
    setType("ledger")
    setDesc("")
    setRepeat("")
    setErr(null)
    setSaving(false)
    const t = requestAnimationFrame(() => closeBtnRef.current?.focus())
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        if (!focusables.length) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    window.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { window.removeEventListener("keydown", onKey); cancelAnimationFrame(t); document.body.style.overflow = prev }
  }, [open, defaultDate, onClose])

  if (!open) return null

  const handleSubmit = async () => {
    if (!title.trim()) { setErr("请输入日程标题"); return }
    if (!date) { setErr("请选择日期"); return }
    setSaving(true); setErr(null)
    try {
      const res = await apiPost<{ ok: boolean }>('/api/calendar/tasks', {
        action: 'add',
        task: {
          title: title.trim(),
          date,
          level: EVT_META[type].label,
          desc: desc.trim(),
          repeat: repeat.trim() || undefined,
        },
      })
      if (res.ok && res.data?.ok) {
        onSuccess("日程已添加")
      } else {
        setErr(res.error || "保存失败")
      }
    } catch {
      setErr("网络错误")
    }
    setSaving(false)
  }

  const typeOptions = (Object.keys(EVT_META) as EvtType[]).map(k => ({
    value: k, label: EVT_META[k].label, dot: EVT_META[k].dot,
  }))

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="新建日程"
        tabIndex={-1}
        className="relative w-[440px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-border/60 bg-popover shadow-[0_20px_60px_-12px_rgba(0,0,0,0.25),0_8px_24px_-8px_rgba(0,0,0,0.12)] focus:outline-none"
        onClick={e => e.stopPropagation()}
      >
        {/* 浮动关闭按钮 */}
        <button
          ref={closeBtnRef}
          onClick={onClose}
          aria-label="关闭"
          className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground transition-colors"
        >
          <X className="size-4" />
        </button>

        <div className="px-6 py-6 space-y-4">
          {/* 标题 */}
          <div>
            <h2 className="text-title font-semibold text-foreground">新建日程</h2>
            <p className="text-caption text-muted-foreground mt-0.5">手动录入临时合规任务</p>
          </div>

          {/* 表单 */}
          <div className="space-y-3">
            {/* 日程标题 */}
            <div>
              <label className="block text-caption text-muted-foreground mb-1.5">日程标题 <span className="text-destructive">*</span></label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="如：季度执行报告提交"
                autoFocus
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-body text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-eco-500/40 focus:border-eco-500"
              />
            </div>

            {/* 日期 */}
            <div>
              <label className="block text-caption text-muted-foreground mb-1.5">日期 <span className="text-destructive">*</span></label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-eco-500/40 focus:border-eco-500"
              />
            </div>

            {/* 类型 */}
            <div>
              <label className="block text-caption text-muted-foreground mb-1.5">事件类型</label>
              <div className="grid grid-cols-5 gap-1.5">
                {typeOptions.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setType(opt.value)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border px-1 py-2 transition-all text-caption whitespace-nowrap",
                      type === opt.value
                        ? "border-eco-500 bg-eco-50/50 text-eco-700 dark:bg-eco-500/15 dark:text-eco-300"
                        : "border-border bg-card text-muted-foreground hover:bg-accent/60"
                    )}
                  >
                    <span className={cn("size-2 rounded-full", opt.dot)} />
                    <span className="text-caption leading-tight">{opt.label.slice(0, 3)}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 描述 */}
            <div>
              <label className="block text-caption text-muted-foreground mb-1.5">备注描述</label>
              <textarea
                value={desc}
                onChange={e => setDesc(e.target.value)}
                placeholder="可选：补充说明..."
                rows={2}
                className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-body text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-eco-500/40 focus:border-eco-500"
              />
            </div>

            {/* 重复频次 */}
            <div>
              <label className="block text-caption text-muted-foreground mb-1.5">重复频次（可选）</label>
              <input
                value={repeat}
                onChange={e => setRepeat(e.target.value)}
                placeholder="如：每月 / 每季度 / 每年"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-body text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-eco-500/40 focus:border-eco-500"
              />
            </div>
          </div>

          {/* 错误提示 */}
          {err && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-caption text-destructive">
              {err}
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-border bg-card px-4 py-2 text-body text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving || !title.trim() || !date}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-eco-strong px-4 py-2 text-body text-white font-medium shadow-sm hover:shadow-card-hover transition-all disabled:opacity-50"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              {saving ? "保存中..." : "添加日程"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
