"use client"
/**
 * EcoPilot 运维监控看板 — 独立路由 /monitor
 * 不污染用户产品 UI，仅供开发/运维团队使用
 */
import { useState, useEffect, useCallback } from "react"
import {
  Activity, Users, Building2, AlertTriangle, MessageSquare,
  TrendingUp, Clock, Cpu, HardDrive, RefreshCw, Check,
  ChevronRight, Loader2, Zap, ShieldAlert,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { apiGet, apiPost, getApiBase, ensureAuthToken, authHeaders } from "@/lib/api"

type Overview = {
  days: number
  total_events: number
  by_type: Record<string, number>
  by_severity: Record<string, number>
  active_users: number
  active_enterprises: number
  error_rate: number
  feedback_count: number
  unack_alerts: number
}

type TimeSeriesItem = {
  bucket: string
  total: number
  errors: number
  chats: number
  logins: number
  unique_users: number
}

type EventItem = {
  id: number
  ts: number
  ts_str: string
  type: string
  severity: string
  user_id: string | null
  enterprise: string | null
  event_data: any
}

type FeedbackItem = {
  id: number
  ts: number
  ts_str: string
  user_id: string | null
  enterprise: string | null
  message: string
  contact: string
  status: string
  response: string | null
}

type AlertItem = {
  id: number
  ts: number
  ts_str: string
  severity: string
  source: string
  title: string
  detail: string | null
  acknowledged: number
}

type EnterpriseItem = {
  enterprise: string
  events: number
  users: number
  errors: number
  last_active: number
  last_active_str: string
}

const SEVERITY_META: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  info:     { label: "信息", color: "text-muted-foreground", bg: "bg-muted/40", dot: "bg-muted-foreground" },
  warning:  { label: "警告", color: "text-warning", bg: "bg-warning/10", dot: "bg-warning" },
  error:    { label: "错误", color: "text-destructive", bg: "bg-destructive/10", dot: "bg-destructive" },
  critical: { label: "严重", color: "text-destructive", bg: "bg-destructive/20", dot: "bg-destructive" },
}

const TYPE_LABELS: Record<string, string> = {
  page_view: "页面访问",
  chat: "对话",
  tool_call: "工具调用",
  error: "错误",
  feedback: "反馈",
  download: "下载",
  login: "登录",
  upload: "上传",
  api_latency: "API延迟",
  license_verify: "许可验证",
  onboarding_step: "Onboarding",
  vault_sync: "档案同步",
  knowledge_search: "知识检索",
}

export default function MonitorPage() {
  const [tab, setTab] = useState<"overview" | "events" | "feedback" | "alerts" | "enterprises">("overview")
  const [days, setDays] = useState(7)
  const [loading, setLoading] = useState(true)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [timeseries, setTimeseries] = useState<TimeSeriesItem[]>([])
  const [events, setEvents] = useState<EventItem[]>([])
  const [feedback, setFeedback] = useState<FeedbackItem[]>([])
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [enterprises, setEnterprises] = useState<EnterpriseItem[]>([])
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true); setError("")
    try {
      await ensureAuthToken()
      const headers = authHeaders()
      const base = getApiBase()

      if (tab === "overview") {
        const r = await fetch(`${base}/api/ops/dashboard?days=${days}`, { headers })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
        if (data.ok) {
          setOverview(data.overview)
          setTimeseries(data.timeseries || [])
        }
      } else if (tab === "events") {
        const r = await fetch(`${base}/api/ops/events?limit=100`, { headers })
        const data = await r.json()
        if (data.ok) setEvents(data.events || [])
      } else if (tab === "feedback") {
        const r = await fetch(`${base}/api/ops/feedback?limit=50`, { headers })
        const data = await r.json()
        if (data.ok) setFeedback(data.feedback || [])
      } else if (tab === "alerts") {
        const r = await fetch(`${base}/api/ops/alerts?limit=100`, { headers })
        const data = await r.json()
        if (data.ok) setAlerts(data.alerts || [])
      } else if (tab === "enterprises") {
        const r = await fetch(`${base}/api/ops/enterprises?days=${days}`, { headers })
        const data = await r.json()
        if (data.ok) setEnterprises(data.enterprises || [])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [tab, days])

  useEffect(() => { load() }, [load])

  // 每 30 秒自动刷新
  useEffect(() => {
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  const ackAlert = async (id: number) => {
    try {
      await ensureAuthToken()
      await apiPost(`/api/ops/alerts/ack`, { id })
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged: 1 } : a))
    } catch (e) {}
  }

  const respondFeedback = async (id: number, response: string) => {
    try {
      await apiPost(`/api/ops/feedback/respond`, { id, response })
      setFeedback(prev => prev.map(f => f.id === id ? { ...f, response, status: "responded" } : f))
    } catch (e) {}
  }

  return (
    <div className="min-h-screen bg-background">
      {/* ═══ Header ═══ */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-eco-500 to-eco-700 text-white shadow-sm">
              <Activity className="size-5" />
            </div>
            <div>
              <h1 className="text-title font-bold text-foreground">EcoPilot 运维监控</h1>
              <p className="text-caption text-muted-foreground">生态环境合规AI管家 · 实时数据看板</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* 时间范围选择 */}
            <div className="flex rounded-lg border border-border p-0.5">
              {[1, 7, 30].map(d => (
                <button key={d} onClick={() => setDays(d)}
                  className={cn("rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    days === d ? "bg-eco-600 text-white" : "text-muted-foreground hover:text-foreground")}>
                  {d === 1 ? "24h" : `${d}天`}
                </button>
              ))}
            </div>
            <button onClick={load} disabled={loading}
              aria-label="刷新数据"
              className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-accent disabled:opacity-50">
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            </button>
          </div>
        </div>

        {/* Tab 切换 */}
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex gap-1 overflow-x-auto">
            {([
              { k: "overview", label: "总览", icon: TrendingUp, badge: undefined as number | undefined },
              { k: "events", label: "事件流", icon: Zap, badge: undefined as number | undefined },
              { k: "feedback", label: "用户反馈", icon: MessageSquare, badge: overview?.feedback_count },
              { k: "alerts", label: "告警", icon: AlertTriangle, badge: overview?.unack_alerts },
              { k: "enterprises", label: "企业", icon: Building2, badge: undefined as number | undefined },
            ] as const).map(t => (
              <button key={t.k} onClick={() => setTab(t.k)}
                className={cn("flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap",
                  tab === t.k ? "border-eco-600 text-eco-700" : "border-transparent text-muted-foreground hover:text-foreground")}>
                <t.icon className="size-3.5" />
                {t.label}
                {t.badge ? (
                  <span className="ml-0.5 rounded-full bg-destructive px-1.5 py-px text-caption font-bold text-white">{t.badge}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ═══ Content ═══ */}
      <main className="mx-auto max-w-7xl px-6 py-6">
        {error && (
          <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-body text-destructive">
            <ShieldAlert className="inline-block size-4 mr-2" />
            加载失败: {error}
            <button onClick={load} className="ml-3 underline">重试</button>
          </div>
        )}

        {loading && !overview && tab === "overview" ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-6 animate-spin text-eco-600" />
          </div>
        ) : (
          <>
            {/* ─── 总览 Tab ─── */}
            {tab === "overview" && overview && (
              <div className="space-y-6">
                {/* KPI 卡片 */}
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <KpiCard icon={Activity} label="总事件数" value={overview.total_events} color="text-eco-600" sub={`近 ${overview.days} 天`} />
                  <KpiCard icon={Users} label="活跃用户" value={overview.active_users} color="text-info" sub="去重" />
                  <KpiCard icon={Building2} label="活跃企业" value={overview.active_enterprises} color="text-success" sub="去重" />
                  <KpiCard icon={AlertTriangle} label="错误率" value={`${overview.error_rate}%`} color={overview.error_rate > 5 ? "text-destructive" : "text-success"} sub={`反馈 ${overview.feedback_count}`} />
                </div>

                {/* 告警提示 */}
                {overview.unack_alerts > 0 && (
                  <div className="rounded-xl border border-warning/30 bg-warning/10 p-4">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="size-5 text-warning" />
                      <span className="text-body font-semibold text-foreground">{overview.unack_alerts} 条未处理告警</span>
                      <button onClick={() => setTab("alerts")} className="ml-auto text-xs text-eco-600 hover:underline">查看 →</button>
                    </div>
                  </div>
                )}

                {/* 时间序列图 */}
                <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                  <h3 className="mb-4 text-body font-semibold text-foreground">事件趋势</h3>
                  {timeseries.length === 0 ? (
                    <p className="text-center text-body text-muted-foreground py-8">暂无数据</p>
                  ) : (
                    <div className="space-y-2">
                      {/* 简易条形图 */}
                      {timeseries.map(ts => {
                        const max = Math.max(...timeseries.map(t => t.total), 1)
                        const widthPct = (ts.total / max) * 100
                        return (
                          <div key={ts.bucket} className="flex items-center gap-3">
                            <span className="w-32 shrink-0 text-xs text-muted-foreground font-mono">{ts.bucket}</span>
                            <div className="flex-1 h-6 bg-secondary rounded relative overflow-hidden">
                              <div className="absolute inset-y-0 left-0 bg-eco-500/70 rounded" style={{ width: `${widthPct}%` }} />
                              {ts.errors > 0 && (
                                <div className="absolute inset-y-0 right-0 bg-destructive/40" style={{ width: `${(ts.errors / ts.total) * 100}%` }} />
                              )}
                            </div>
                            <span className="w-12 shrink-0 text-right text-xs font-medium text-foreground tabular-nums">{ts.total}</span>
                          </div>
                        )
                      })}
                      <div className="flex gap-4 pt-2 text-caption text-muted-foreground">
                        <span className="flex items-center gap-1"><span className="size-2 rounded bg-eco-500/70" /> 总事件</span>
                        <span className="flex items-center gap-1"><span className="size-2 rounded bg-destructive/40" /> 错误</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* 事件类型分布 + 严重度分布 */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                    <h3 className="mb-3 text-body font-semibold text-foreground">事件类型分布</h3>
                    {Object.keys(overview.by_type).length === 0 ? (
                      <p className="text-center text-body text-muted-foreground py-6">暂无数据</p>
                    ) : (
                      <div className="space-y-2">
                        {Object.entries(overview.by_type).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
                          const max = Math.max(...Object.values(overview.by_type), 1)
                          return (
                            <div key={type} className="flex items-center gap-3">
                              <span className="w-24 shrink-0 text-xs text-foreground">{TYPE_LABELS[type] || type}</span>
                              <div className="flex-1 h-2 bg-secondary rounded overflow-hidden">
                                <div className="h-full bg-eco-500 rounded" style={{ width: `${(count / max) * 100}%` }} />
                              </div>
                              <span className="w-10 shrink-0 text-right text-xs font-mono text-muted-foreground">{count}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                    <h3 className="mb-3 text-body font-semibold text-foreground">严重度分布</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {(["info", "warning", "error", "critical"] as const).map(sev => {
                        const count = overview.by_severity[sev] || 0
                        const meta = SEVERITY_META[sev]
                        return (
                          <div key={sev} className={cn("rounded-xl border p-3", meta.bg, "border-border")}>
                            <div className="flex items-center gap-2">
                              <span className={cn("size-2 rounded-full", meta.dot)} />
                              <span className="text-xs text-muted-foreground">{meta.label}</span>
                            </div>
                            <div className={cn("text-display font-bold mt-1", meta.color)}>{count}</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ─── 事件流 Tab ─── */}
            {tab === "events" && (
              <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
                <div className="border-b border-border px-4 py-3">
                  <h3 className="text-body font-semibold text-foreground">最近事件（{events.length} 条）</h3>
                </div>
                <div className="max-h-[70vh] overflow-y-auto">
                  {events.length === 0 ? (
                    <p className="text-center text-body text-muted-foreground py-12">暂无事件</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="bg-secondary/50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">时间</th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">类型</th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">严重度</th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">用户</th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">企业</th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">数据</th>
                        </tr>
                      </thead>
                      <tbody>
                        {events.map(ev => (
                          <tr key={ev.id} className="border-t border-border hover:bg-secondary/30">
                            <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">{ev.ts_str}</td>
                            <td className="px-3 py-2">
                              <span className="rounded bg-secondary px-1.5 py-0.5 text-caption font-medium">{TYPE_LABELS[ev.type] || ev.type}</span>
                            </td>
                            <td className="px-3 py-2">
                              <span className={cn("rounded px-1.5 py-0.5 text-caption font-medium", SEVERITY_META[ev.severity]?.bg, SEVERITY_META[ev.severity]?.color)}>
                                {SEVERITY_META[ev.severity]?.label || ev.severity}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{ev.user_id || "—"}</td>
                            <td className="px-3 py-2 text-muted-foreground">{ev.enterprise || "—"}</td>
                            <td className="px-3 py-2 text-muted-foreground font-mono text-caption max-w-xs truncate">
                              {ev.event_data ? JSON.stringify(ev.event_data) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {/* ─── 反馈 Tab ─── */}
            {tab === "feedback" && (
              <div className="space-y-3">
                {feedback.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border p-12 text-center">
                    <MessageSquare className="size-8 text-muted-foreground/50 mx-auto mb-2" />
                    <p className="text-body text-muted-foreground">暂无反馈</p>
                  </div>
                ) : (
                  feedback.map(fb => (
                    <FeedbackCard key={fb.id} fb={fb} onRespond={respondFeedback} />
                  ))
                )}
              </div>
            )}

            {/* ─── 告警 Tab ─── */}
            {tab === "alerts" && (
              <div className="space-y-2">
                {alerts.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border p-12 text-center">
                    <Check className="size-8 text-success/50 mx-auto mb-2" />
                    <p className="text-body text-muted-foreground">暂无告警</p>
                  </div>
                ) : (
                  alerts.map(al => (
                    <div key={al.id} className={cn(
                      "rounded-xl border p-4 flex items-start gap-3",
                      al.acknowledged ? "border-border bg-card opacity-60" : cn(SEVERITY_META[al.severity]?.bg, "border-current/20")
                    )}>
                      <AlertTriangle className={cn("size-4 shrink-0 mt-0.5", SEVERITY_META[al.severity]?.color)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-body font-medium text-foreground">{al.title}</span>
                          {al.acknowledged ? (
                            <span className="rounded bg-muted px-1.5 py-px text-caption text-muted-foreground">已处理</span>
                          ) : (
                            <span className={cn("rounded px-1.5 py-px text-caption", SEVERITY_META[al.severity]?.bg, SEVERITY_META[al.severity]?.color)}>
                              {SEVERITY_META[al.severity]?.label}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 font-mono">{al.ts_str} · 来源: {al.source}</p>
                        {al.detail && (
                          <pre className="mt-2 text-caption text-muted-foreground bg-secondary rounded p-2 overflow-x-auto max-h-32">{al.detail}</pre>
                        )}
                      </div>
                      {!al.acknowledged && (
                        <button onClick={() => ackAlert(al.id)}
                          className="shrink-0 rounded-lg border border-border px-3 py-1 text-xs hover:bg-accent">
                          标记已处理
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ─── 企业 Tab ─── */}
            {tab === "enterprises" && (
              <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
                <div className="border-b border-border px-4 py-3">
                  <h3 className="text-body font-semibold text-foreground">活跃企业 Top 10（近 {days} 天）</h3>
                </div>
                {enterprises.length === 0 ? (
                  <p className="text-center text-body text-muted-foreground py-12">暂无数据</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-secondary/50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">企业</th>
                        <th className="px-4 py-2 text-right font-medium text-muted-foreground">事件数</th>
                        <th className="px-4 py-2 text-right font-medium text-muted-foreground">用户数</th>
                        <th className="px-4 py-2 text-right font-medium text-muted-foreground">错误数</th>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">最后活跃</th>
                      </tr>
                    </thead>
                    <tbody>
                      {enterprises.map((e, i) => (
                        <tr key={i} className="border-t border-border hover:bg-secondary/30">
                          <td className="px-4 py-2.5 font-medium text-foreground">{e.enterprise}</td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">{e.events}</td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">{e.users}</td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            <span className={e.errors > 0 ? "text-destructive font-bold" : "text-muted-foreground"}>{e.errors}</span>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground font-mono text-caption">{e.last_active_str}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

// ─── 子组件 ───

function KpiCard({ icon: Icon, label, value, color, sub }: {
  icon: typeof Activity; label: string; value: string | number; color: string; sub?: string
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className={cn("size-4", color)} />
      </div>
      <div className={cn("text-display font-bold mt-2", color)}>{value}</div>
      {sub && <div className="text-caption text-muted-foreground mt-1">{sub}</div>}
    </div>
  )
}

function FeedbackCard({ fb, onRespond }: {
  fb: FeedbackItem
  onRespond: (id: number, response: string) => void
}) {
  const [responding, setResponding] = useState(false)
  const [response, setResponse] = useState("")

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-body font-semibold text-foreground">{fb.contact || "匿名用户"}</span>
            {fb.status === "responded" ? (
              <span className="rounded bg-success/10 px-1.5 py-px text-caption text-success">已回复</span>
            ) : (
              <span className="rounded bg-warning/10 px-1.5 py-px text-caption text-warning">待回复</span>
            )}
          </div>
          <p className="text-caption text-muted-foreground mt-0.5 font-mono">{fb.ts_str}</p>
        </div>
      </div>
      <p className="text-body text-foreground whitespace-pre-wrap bg-secondary rounded-lg p-3">{fb.message}</p>
      {fb.response && (
        <div className="mt-2 rounded-lg bg-eco-50/50 border border-eco-200 p-3">
          <p className="text-caption text-eco-700 font-medium mb-1">已回复：</p>
          <p className="text-body text-foreground whitespace-pre-wrap">{fb.response}</p>
        </div>
      )}
      {!fb.response && (
        responding ? (
          <div className="mt-3 space-y-2">
            <textarea value={response} onChange={e => setResponse(e.target.value)}
              placeholder="输入回复内容..."
              className="w-full rounded-lg border border-border bg-background p-2.5 text-body focus:outline-none focus:ring-2 focus:ring-eco-500/30 resize-none"
              rows={3} autoFocus />
            <div className="flex gap-2">
              <button onClick={() => { onRespond(fb.id, response); setResponding(false); setResponse("") }}
                disabled={!response.trim()}
                className="rounded-lg bg-eco-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-eco-700 disabled:opacity-50">
                发送回复
              </button>
              <button onClick={() => { setResponding(false); setResponse("") }}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">
                取消
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setResponding(true)}
            className="mt-3 rounded-lg border border-eco-300 bg-eco-50/50 px-3 py-1.5 text-xs font-medium text-eco-700 hover:bg-eco-100">
            回复
          </button>
        )
      )}
    </div>
  )
}
