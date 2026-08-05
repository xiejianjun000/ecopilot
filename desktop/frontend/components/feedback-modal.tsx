"use client"
import { useState, useEffect, useRef } from "react"
import { X, Send, CheckCircle2, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { apiPost } from "@/lib/api"

interface Props { open: boolean; onClose: () => void }

export function FeedbackModal({ open, onClose }: Props) {
  const [msg, setMsg] = useState("")
  const [contact, setContact] = useState("")
  const [status, setStatus] = useState<"idle"|"sending"|"done"|"error">("idle")
  const [error, setError] = useState("")
  const panelRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { if (open) { setMsg(""); setContact(""); setStatus("idle"); setError("") } }, [open])

  // ESC 关闭 + Tab/Shift+Tab 焦点陷阱
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  // 打开时：聚焦关闭按钮 + 锁定 body 滚动
  useEffect(() => {
    if (!open) return
    const t = requestAnimationFrame(() => closeBtnRef.current?.focus())
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      cancelAnimationFrame(t)
      document.body.style.overflow = prev
    }
  }, [open])

  const submit = async () => {
    if (!msg.trim()) return
    setStatus("sending"); setError("")
    try {
      const { ok } = await apiPost('/api/feedback', { message: msg.trim(), contact: contact.trim() })
      if (!ok) throw new Error("发送失败")
      setStatus("done"); setTimeout(onClose, 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : "发送失败"); setStatus("error")
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/40 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="意见反馈"
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-border bg-card shadow-modal mx-4 focus:outline-none"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-title font-semibold text-foreground">意见反馈</h3>
          <button ref={closeBtnRef} onClick={onClose} aria-label="关闭" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"><X className="size-4" /></button>
        </div>

        {status === "done" ? (
          <div className="flex flex-col items-center gap-3 py-10 px-5">
            <CheckCircle2 className="size-12 text-success" />
            <p className="text-body font-medium text-foreground">已发送</p>
            <p className="text-xs text-muted-foreground">我会尽快查看并回复</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-5 py-5">
            <div>
              <label htmlFor="feedback-msg" className="text-xs font-medium text-muted-foreground mb-1.5 block">您的意见或问题</label>
              <textarea id="feedback-msg" value={msg} onChange={e => setMsg(e.target.value)}
                placeholder="描述您遇到的问题或建议..." rows={4}
                className="w-full rounded-xl border border-border bg-secondary px-3.5 py-3 text-body text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-eco-500/30 resize-none" />
            </div>
            <div>
              <label htmlFor="feedback-contact" className="text-xs font-medium text-muted-foreground mb-1.5 block">联系方式（选填）</label>
              <input id="feedback-contact" value={contact} onChange={e => setContact(e.target.value)}
                placeholder="手机号 / 微信 / 邮箱"
                className="w-full rounded-xl border border-border bg-secondary px-3.5 py-2.5 text-body text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-eco-500/30" />
            </div>
            {status === "error" && <p className="text-xs text-destructive">{error}</p>}
            <button onClick={submit} disabled={!msg.trim() || status === "sending"}
              className={cn("flex items-center justify-center gap-2 rounded-xl bg-eco-600 px-4 py-3 text-body font-medium text-white transition-all",
                !msg.trim() ? "opacity-50 cursor-not-allowed" : "hover:bg-eco-700 active:scale-[0.98]")}>
              {status === "sending" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {status === "sending" ? "发送中..." : "发送反馈"}
            </button>
            <p className="text-center text-caption text-muted-foreground">消息会直接发给开发团队</p>
          </div>
        )}
      </div>
    </div>
  )
}
