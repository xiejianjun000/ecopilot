"use client"
import { useEffect, useMemo, useState } from "react"
import {
  ShieldCheck, TrendingUp, FileText, CalendarClock, Activity,
  ArrowRight, Sparkles, AlertTriangle, CheckCircle2, Clock,
} from "lucide-react"
import { useApp } from "@/lib/store"
import { apiGet } from "@/lib/api"
import { cn } from "@/lib/utils"

interface EnterpriseInfo {
  name: string
  credit_code?: string
  management_level?: string
  industry?: string
  permit_number?: string
  valid_to?: string
  valid_from?: string
  legal_representative?: string
  address?: string
  phone?: string
}

/** 根据许可证有效期推算剩余天数 */
function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86400000)
}

/** 根据剩余天数评级 */
function permitStatus(days: number | null): {
  label: string
  tone: "ok" | "warn" | "danger"
  desc: string
} {
  if (days === null) return { label: "未读取", tone: "warn", desc: "许可证数据未读取" }
  if (days < 0) return { label: "已过期", tone: "danger", desc: `已逾期 ${-days} 天` }
  if (days <= 30) return { label: "即将到期", tone: "danger", desc: `剩余 ${days} 天` }
  if (days <= 90) return { label: "临近到期", tone: "warn", desc: `剩余 ${days} 天` }
  return { label: "有效", tone: "ok", desc: `剩余 ${days} 天` }
}

const TONE_STYLE: Record<"ok" | "warn" | "danger", { card: string; dot: string; text: string }> = {
  ok: { card: "border-success/30 bg-success/5", dot: "bg-success", text: "text-success" },
  warn: { card: "border-warning/30 bg-warning/5", dot: "bg-warning", text: "text-warning" },
  danger: { card: "border-destructive/30 bg-destructive/5", dot: "bg-destructive", text: "text-destructive" },
}

export function DashboardView() {
  const { state, dispatch } = useApp()
  const [enterprise, setEnterprise] = useState<EnterpriseInfo | null>(null)

  useEffect(() => {
    apiGet<EnterpriseInfo>('/api/enterprise').then(({ ok, data }) => {
      if (ok && data) setEnterprise(data)
    }).catch(() => {})
  }, [])

  const goChat = () => dispatch({ type: "SET_NAV", nav: "chat" })
  const goInspection = () => dispatch({ type: "SET_NAV", nav: "inspection" })
  const goVault = () => dispatch({ type: "SET_NAV", nav: "vault" })
  const goCalendar = () => dispatch({ type: "SET_NAV", nav: "calendar" })

  // 派生：许可证状态
  const permit = useMemo(() => {
    const days = daysUntil(enterprise?.valid_to)
    return permitStatus(days)
  }, [enterprise?.valid_to])

  // 派生：合规评分（基于可用数据启发式计算）
  const score = useMemo(() => {
    let s = 60
    if (enterprise?.name) s += 5
    if (enterprise?.credit_code) s += 5
    if (enterprise?.permit_number && !enterprise.permit_number.includes("未读取")) s += 10
    if (enterprise?.management_level) s += 5
    if (state.taskSummaries.length > 0) s += 5
    if (state.memories.length > 0) s += 5
    if (permit.tone === "ok") s += 5
    if (permit.tone === "danger") s -= 15
    return Math.max(0, Math.min(100, s))
  }, [enterprise, state.taskSummaries.length, state.memories.length, permit.tone])

  const scoreTone = score >= 80 ? "text-success" : score >= 60 ? "text-warning" : "text-destructive"
  const scoreLabel = score >= 80 ? "良好" : score >= 60 ? "需关注" : "高风险"

  // 派生：最近活动
  const recentActivity = useMemo(() => {
    const items: { time: string; title: string; type: "task" | "diary" | "file" }[] = []
    state.taskSummaries.slice(-3).reverse().forEach(t => {
      items.push({ time: t.time, title: t.title, type: "task" })
    })
    state.diaryEntries.slice(-2).reverse().forEach(d => {
      items.push({ time: d.date, title: d.title, type: "diary" })
    })
    state.outputFiles.slice(-2).reverse().forEach(f => {
      items.push({ time: f.createdAt.slice(5, 10), title: f.name, type: "file" })
    })
    return items.slice(0, 5)
  }, [state.taskSummaries, state.diaryEntries, state.outputFiles])

  // 快捷操作
  const quickActions = [
    { label: "生成本月执行报告草稿", emoji: "📝", nav: "chat" as const },
    { label: "查许可证还有多久到期", emoji: "📋", nav: "chat" as const },
    { label: "台账缺失项排查", emoji: "🔍", nav: "chat" as const },
    { label: "查看巡查清单", emoji: "🛡️", nav: "inspection" as const },
  ]

  if (!enterprise?.name) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-eco-50">
            <TrendingUp className="size-8 text-eco-600" strokeWidth={1.5} />
          </div>
          <h2 className="text-section font-semibold text-foreground mb-2">尚未绑定企业</h2>
          <p className="text-body text-muted-foreground mb-6">
            请先在设置中录入企业信息，或通过排污许可平台登录后自动读取许可证数据。
          </p>
          <button onClick={() => dispatch({ type: "SET_NAV", nav: "settings" })}
            className="rounded-xl bg-eco-600 px-5 py-2.5 text-body font-medium text-white hover:bg-eco-700 transition-colors">
            前往设置
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-5xl space-y-5">
        {/* ═══ Hero：企业概览 + 合规评分 ═══ */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-xl bg-eco-600 text-white shadow-sm shrink-0">
              <ShieldCheck className="size-6" strokeWidth={1.5} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-section font-semibold text-foreground truncate">{enterprise.name}</h2>
              <p className="text-body text-muted-foreground mt-0.5">
                {enterprise.credit_code || "—"} · {enterprise.management_level || "—"} · {enterprise.industry || "—"}
              </p>
            </div>
            {/* 合规评分环 */}
            <div className="flex flex-col items-center justify-center shrink-0 px-4 py-2 rounded-xl bg-secondary/40 border border-border">
              <div className="relative size-14 flex items-center justify-center">
                <svg className="absolute inset-0 -rotate-90" viewBox="0 0 56 56">
                  <circle cx="28" cy="28" r="24" fill="none" stroke="currentColor" className="text-secondary" strokeWidth="4" />
                  <circle
                    cx="28" cy="28" r="24" fill="none" stroke="currentColor"
                    className={scoreTone} strokeWidth="4" strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 24 * score / 100} ${2 * Math.PI * 24}`}
                  />
                </svg>
                <span className={cn("text-title font-bold tabular-nums", scoreTone)}>{score}</span>
              </div>
              <span className="text-caption text-muted-foreground mt-1">合规评分 · {scoreLabel}</span>
            </div>
          </div>
        </div>

        {/* ═══ 4 张状态卡：许可证 / 执行报告 / 监测 / 台账 ═══ */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button onClick={goChat} className="text-left rounded-xl border bg-card p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40">
            <div className="flex items-center justify-between mb-2">
              <span className="text-caption text-muted-foreground">许可证状态</span>
              <span className={cn("size-2 rounded-full", TONE_STYLE[permit.tone].dot)} />
            </div>
            <p className={cn("text-title font-semibold", TONE_STYLE[permit.tone].text)}>{permit.label}</p>
            <p className="text-caption text-muted-foreground mt-0.5 truncate">{permit.desc}</p>
          </button>

          <button onClick={goChat} className="text-left rounded-xl border bg-card p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40">
            <div className="flex items-center justify-between mb-2">
              <span className="text-caption text-muted-foreground">执行报告</span>
              <FileText className="size-3.5 text-muted-foreground" />
            </div>
            <p className="text-title font-semibold text-foreground">{state.taskSummaries.length}</p>
            <p className="text-caption text-muted-foreground mt-0.5">已生成报告</p>
          </button>

          <button onClick={goInspection} className="text-left rounded-xl border bg-card p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40">
            <div className="flex items-center justify-between mb-2">
              <span className="text-caption text-muted-foreground">巡查事项</span>
              <Activity className="size-3.5 text-muted-foreground" />
            </div>
            <p className="text-title font-semibold text-foreground">{state.taskSummaries.reduce((n, t) => n + t.findings.length, 0)}</p>
            <p className="text-caption text-muted-foreground mt-0.5">待核查发现</p>
          </button>

          <button onClick={goVault} className="text-left rounded-xl border bg-card p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40">
            <div className="flex items-center justify-between mb-2">
              <span className="text-caption text-muted-foreground">档案库</span>
              <CheckCircle2 className="size-3.5 text-muted-foreground" />
            </div>
            <p className="text-title font-semibold text-foreground">{state.outputFiles.length}</p>
            <p className="text-caption text-muted-foreground mt-0.5">归档文档</p>
          </button>
        </div>

        {/* ═══ 双栏：最近活动 + 快捷操作 ═══ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* 最近活动 */}
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-muted-foreground" />
                <span className="text-body font-semibold text-foreground">最近活动</span>
              </div>
              <button onClick={goChat} className="text-caption text-eco-600 hover:text-eco-700 inline-flex items-center gap-1">
                全部 <ArrowRight className="size-3" />
              </button>
            </div>
            {recentActivity.length === 0 ? (
              <div className="text-center py-6">
                <Sparkles className="size-5 text-muted-foreground/60 mx-auto mb-2" />
                <p className="text-caption text-muted-foreground">暂无活动记录</p>
                <p className="text-caption text-muted-foreground/70 mt-0.5">开始一次对话即可生成活动</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {recentActivity.map((a, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className={cn(
                      "mt-1.5 size-1.5 rounded-full shrink-0",
                      a.type === "task" ? "bg-eco-500" : a.type === "diary" ? "bg-info" : "bg-warning"
                    )} />
                    <div className="flex-1 min-w-0">
                      <p className="text-body text-foreground truncate">{a.title}</p>
                      <p className="text-caption text-muted-foreground">{a.time}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 快捷操作 */}
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="size-4 text-muted-foreground" />
              <span className="text-body font-semibold text-foreground">快捷操作</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {quickActions.map(a => (
                <button
                  key={a.label}
                  onClick={() => dispatch({ type: "SET_NAV", nav: a.nav })}
                  className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-left text-body text-foreground hover:border-eco-300 hover:bg-eco-50/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
                >
                  <span className="text-title shrink-0">{a.emoji}</span>
                  <span className="flex-1 truncate">{a.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ═══ 提示卡：合规日程 ═══ */}
        <button
          onClick={goCalendar}
          className="w-full flex items-center justify-between rounded-xl border border-border bg-gradient-to-r from-eco-50/50 to-transparent p-4 hover:border-eco-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-eco-100 text-eco-700">
              <CalendarClock className="size-5" />
            </div>
            <div className="text-left">
              <p className="text-body font-medium text-foreground">查看本月合规日程</p>
              <p className="text-caption text-muted-foreground">监测 · 台账 · 报告 · 申报 截止时间</p>
            </div>
          </div>
          <ArrowRight className="size-4 text-muted-foreground" />
        </button>

        {/* ═══ 兜底 CTA（许可证未读取时） ═══ */}
        {permit.tone === "warn" && (
          <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 flex items-start gap-3">
            <AlertTriangle className="size-5 text-warning shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-body font-medium text-foreground">许可证数据尚未读取</p>
              <p className="text-caption text-muted-foreground mt-0.5">读取后合规评分与状态卡将自动更新</p>
            </div>
            <button onClick={goChat}
              className="shrink-0 rounded-lg bg-eco-600 px-3 py-1.5 text-caption font-medium text-white hover:bg-eco-700 transition-colors">
              立即读取
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
