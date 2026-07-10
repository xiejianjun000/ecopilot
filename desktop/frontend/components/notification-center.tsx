"use client"
import { useEffect, useState } from "react"
import { Bell, X, AlertTriangle, Calendar, CheckCircle2, Clock } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { apiGet } from "@/lib/api"

/** 通知项 — 后端 /api/notifications 返回结构 */
interface Notification {
  id: string
  type: "urgent" | "warn" | "info"
  title: string
  desc: string
  time: string
  read?: boolean
}

/** 通知类型 → 图标 + 配色映射 */
const TYPE_META: Record<Notification["type"], { icon: LucideIcon; col: string }> = {
  urgent: { icon: AlertTriangle, col: "bg-destructive/10 border-destructive/30 text-destructive" },
  warn: { icon: Calendar, col: "bg-warning/10 border-warning/30 text-warning" },
  info: { icon: CheckCircle2, col: "bg-info/10 border-info/30 text-info" },
}

/** 未知类型回退到 info 样式 + Clock 图标 */
const FALLBACK_META = { icon: Clock, col: TYPE_META.info.col }

interface Props { open: boolean; onClose: () => void }
export function NotificationCenter({ open, onClose }: Props) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    apiGet<Notification[]>("/api/notifications")
      .then(res => {
        if (res.ok && Array.isArray(res.data)) {
          setNotifications(res.data)
        } else {
          // 后端无此端点或返回异常 → 回退到空数组
          setNotifications([])
        }
      })
      .catch(() => setNotifications([]))
      .finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  const unread = notifications.filter(n => !n.read).length

  return (
    <div className="fixed inset-0 z-[200]" onClick={onClose}>
      {/* 通知面板贴右上方（与右侧栏外缘对齐） */}
      <div className="absolute right-4 top-16 w-[360px] rounded-2xl border border-border bg-popover shadow-popover overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Bell className="size-5 text-eco-600" />
            <span className="text-body font-semibold text-foreground">通知中心</span>
          </div>
          <div className="flex items-center gap-2">
            {unread > 0 && (
              <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-caption font-medium text-destructive">{unread} 项未读</span>
            )}
            <button onClick={onClose} aria-label="关闭" className="rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"><X className="size-4" /></button>
          </div>
        </div>
        <div className="max-h-[400px] overflow-y-auto p-3 space-y-2">
          {loading ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">加载中…</div>
          ) : notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">暂无通知</div>
          ) : (
            notifications.map(n => {
              const meta = TYPE_META[n.type] || FALLBACK_META
              const Icon = meta.icon
              return (
                <div key={n.id} className={cn("rounded-xl border px-4 py-3 cursor-pointer hover:opacity-80 transition-opacity", meta.col)}>
                  <div className="flex items-start gap-2.5">
                    <Icon className="size-4 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-body font-medium">{n.title}</p>
                      <p className="mt-0.5 text-xs opacity-80">{n.desc}</p>
                      <p className="mt-1.5 text-caption opacity-60">{n.time}</p>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
