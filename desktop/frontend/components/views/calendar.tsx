"use client"
import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import {
  ChevronLeft, ChevronRight, X, Loader2,
  Calendar as CalendarIcon, List,
  Factory, Recycle, Package, Trash2, Activity,
  FileText, AlertTriangle, ShieldAlert, Clock, Sparkles, Plus,
  ClipboardList, ChevronDown, ChevronRight as ChevR, Bell,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { apiPost, apiGet, getComplianceObligations } from "@/lib/api"
import type { ComplianceObligation } from "@/lib/api"
import { useApp } from "@/lib/store"
import { DocEditor } from "./doc-editor"

/* ═══════════════════════════════════════════════════════
 * EcoPilot 合规日历 V4 — 极简重构
 *
 * 设计哲学（对标 Notion Calendar / Linear）：
 *  合规日历 = 合规义务的时间可视化
 *  一次只看一件事，层级递进
 *
 * 四区职责分离：
 *  Zone 1：顶部总览条 — 单行 KPI，一眼扫完
 *  Zone 2：月历网格 — 色点替代色条，72px 紧凑格
 *  Zone 3：选中日详情 — 点击日期才出现，280px 侧栏
 *  Zone 4：台账模板 — 折叠式，默认收起
 *
 * 删除：看板视图、KPI Hero 大卡、进度环、迷你趋势条
 * ═══════════════════════════════════════════════════════ */

type EvtType = 'permit' | 'report' | 'monitor' | 'ledger' | 'alert'
type EvtStatus = 'todo' | 'doing' | 'review' | 'done'
type ViewMode = 'month' | 'timeline'

interface CalendarEvent {
  id: string
  date: string
  title: string
  type: EvtType
  status: EvtStatus
  urgent?: boolean
  desc?: string
  freq?: string
  templateId?: string
  autoTaskStatus?: 'ready' | 'running' | 'idle'  // 关联自动任务状态
  obligationId?: string   // 关联的合规义务 id（台账/自行监测周期义务）
  source?: 'platform' | 'regulation'
}

interface CalendarTask {
  date: string
  title: string
  level?: string
  desc?: string
  category?: string
  description?: string
  repeat?: string
}

interface Template {
  id: string; name: string; category: string; description: string; icon: string
}

interface TemplatesResponse { ok: boolean; templates?: Template[] }

/** 事件类型元数据 — 色点 + 图标 */
const EVT_META: Record<EvtType, {
  label: string
  dot: string
  bg: string
  border: string
  bar: string
  icon: typeof Bell
  text: string
}> = {
  permit:  { label: '许可证到期', dot: 'bg-destructive', bg: 'bg-destructive/10', border: 'border-destructive/30', bar: 'bg-destructive', icon: ShieldAlert, text: 'text-destructive' },
  report:  { label: '执行报告',   dot: 'bg-warning', bg: 'bg-warning/10', border: 'border-warning/30', bar: 'bg-warning', icon: FileText, text: 'text-warning' },
  monitor: { label: '自行监测',   dot: 'bg-success', bg: 'bg-success/10', border: 'border-success/30', bar: 'bg-success', icon: Activity, text: 'text-success' },
  ledger:  { label: '台账记录',   dot: 'bg-info', bg: 'bg-info/10', border: 'border-info/30', bar: 'bg-info', icon: Clock, text: 'text-info' },
  alert:   { label: '排放告警',   dot: 'bg-destructive', bg: 'bg-destructive/10', border: 'border-destructive/40', bar: 'bg-destructive', icon: AlertTriangle, text: 'text-destructive' },
}

/** 状态元数据 */
const STATUS_META: Record<EvtStatus, { label: string; dot: string; text: string; bg: string }> = {
  todo:   { label: '待开始', dot: 'bg-muted-foreground/40', text: 'text-muted-foreground', bg: 'bg-muted/30' },
  doing:  { label: '进行中', dot: 'bg-info', text: 'text-info', bg: 'bg-info/10' },
  review: { label: '待审核', dot: 'bg-warning', text: 'text-warning', bg: 'bg-warning/10' },
  done:   { label: '已完成', dot: 'bg-success', text: 'text-success', bg: 'bg-success/10' },
}

/** 后端模板 icon → Lucide 图标映射 */
const ICON_MAP: Record<string, typeof Factory> = {
  Factory, Recycle, Package, PackageOpen: Package, Trash2, Activity,
  FileText, ClipboardList,
}

/** 模板分组 */
const TEMPLATE_GROUPS: { key: string; label: string }[] = [
  { key: "ledger", label: "台账记录" },
  { key: "monitor", label: "自行监测" },
  { key: "report", label: "执行报告" },
]

const EVENT_TEMPLATE_MAP: Record<string, string> = {
  '生产设施运行': 'tpl-ledger-production',
  '治污设施运行': 'tpl-ledger-treatment',
  '原辅材料消耗': 'tpl-ledger-materials',
  '固废产生处置': 'tpl-ledger-solid-waste',
  '自行监测': 'tpl-monitor-self',
  '执行报告': 'tpl-report-quarterly',
  '季度执行报告': 'tpl-report-quarterly',
  '年度执行报告': 'tpl-report-annual',
  '月度执行报告': 'tpl-report-monthly',
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"]
const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"]

function inferType(task: CalendarTask): EvtType {
  const cat = (task.level || task.category || "").toLowerCase()
  if (cat.includes("permit") || cat.includes("许可")) return "permit"
  if (cat.includes("report") || cat.includes("报告")) return "report"
  if (cat.includes("monitor") || cat.includes("监测")) return "monitor"
  if (cat.includes("ledger") || cat.includes("台账")) return "ledger"
  if (cat.includes("alert") || cat.includes("告警") || cat.includes("超标")) return "alert"
  return "ledger"
}

/** 智能推断事件状态（基于剩余天数 + 是否有模板 + 自动任务状态） */
function inferStatus(ev: Pick<CalendarEvent, 'date' | 'templateId'>): EvtStatus {
  const daysLeft = Math.ceil((new Date(ev.date).getTime() - Date.now()) / 86400000)
  if (daysLeft < 0) return 'done'
  if (daysLeft <= 7 && ev.templateId) return 'doing'
  if (daysLeft <= 30) return 'review'
  return 'todo'
}

function findTemplateId(title: string): string | undefined {
  for (const [key, id] of Object.entries(EVENT_TEMPLATE_MAP)) {
    if (title.includes(key)) return id
  }
  return undefined
}

/** 推断自动任务关联状态 — 报告类模板有自动生成草稿能力 */
function inferAutoTaskStatus(ev: CalendarEvent): 'ready' | 'running' | 'idle' {
  if (ev.type !== 'report' || !ev.templateId) return 'idle'
  // 执行报告类：7天内到期且有模板 → 草稿应已就绪
  const daysLeft = Math.ceil((new Date(ev.date).getTime() - Date.now()) / 86400000)
  if (daysLeft <= 7) return 'ready'
  if (daysLeft <= 14) return 'running'
  return 'idle'
}

/** 每种频次在时间轴内展开的最大次数（避免 daily 台账撑爆月历） */
const FREQ_MAX_OCCUR: Record<string, number> = {
  daily: 7, weekly: 4, monthly: 3, quarterly: 2, 'semi-annual': 1, annual: 1,
}

/**
 * 把台账/自行监测周期义务展开为未来 90 天内的具体日历事件。
 * 按批次 / 每次发生（intervalDays<=0）无固定日期，不展开。
 */
function expandObligations(obls: ComplianceObligation[]): CalendarEvent[] {
  const out: CalendarEvent[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const horizon = new Date(today)
  horizon.setDate(horizon.getDate() + 90)

  for (const o of obls) {
    const interval = o.intervalDays
    if (interval <= 0) continue
    const maxOccur = FREQ_MAX_OCCUR[o.frequency] ?? 3
    const type: EvtType = o.type === 'monitor' ? 'monitor' : 'ledger'
    const templateId = findTemplateId(o.title)
    let d = new Date(today)
    d.setDate(d.getDate() + interval) // 首个为下次执行日
    let occur = 0
    while (d <= horizon && occur < maxOccur) {
      const ds = d.toISOString().split("T")[0]
      out.push({
        id: `ob-${o.id}-${ds}`,
        date: ds,
        title: o.title,
        type,
        status: 'todo',
        desc: `${o.desc}（${o.law}）`,
        freq: o.freqLabel,
        templateId,
        obligationId: o.id,
        source: o.source,
      })
      d = new Date(d)
      d.setDate(d.getDate() + interval)
      occur++
    }
  }
  return out
}

/* ═══════════════════════════════════════════════════════
 * 主组件
 * ═══════════════════════════════════════════════════════ */
export function CalendarView() {
  const { dispatch } = useApp()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [selDate, setSelDate] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>("month")
  const [filters, setFilters] = useState<Record<EvtType, boolean>>({
    permit: true, report: true, monitor: true, ledger: true, alert: true,
  })
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [docEditor, setDocEditor] = useState<{
    open: boolean; templateId?: string; templateName?: string
    eventTitle?: string; eventDate?: string
  }>({ open: false })
  const [addOpen, setAddOpen] = useState(false)
  const [tmplExpanded, setTmplExpanded] = useState<Record<string, boolean>>({})
  const today = new Date().toISOString().split("T")[0]

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  // 从后端加载日程 + 模板
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    Promise.all([
      apiPost<{ ok: boolean; tasks: CalendarTask[] }>('/api/calendar/tasks', { action: 'list' })
        .then(res => {
          if (cancelled) return []
          if (res.ok && res.data?.ok && Array.isArray(res.data.tasks)) {
            return res.data.tasks
              .filter(t => t && t.date && t.title)
              .map((t, i) => {
                const type = inferType(t)
                const templateId = findTemplateId(t.title)
                const baseEv = {
                  id: `t-${i}`,
                  date: t.date,
                  title: t.title,
                  type,
                  desc: t.desc || t.description,
                  freq: t.repeat,
                  urgent: type === "permit" || type === "alert",
                  templateId,
                }
                const ev = { ...baseEv, status: inferStatus(baseEv) } as CalendarEvent
                ev.autoTaskStatus = inferAutoTaskStatus(ev)
                return ev
              })
          }
          return []
        })
        .catch(() => []),
      apiGet<TemplatesResponse>('/api/calendar/templates')
        .then(res => {
          if (cancelled) return []
          if (res.ok && res.data?.ok && Array.isArray(res.data.templates)) {
            return res.data.templates
          }
          return []
        })
        .catch(() => []),
      getComplianceObligations()
        .then(obls => (cancelled ? [] : expandObligations(obls)))
        .catch(() => []),
    ]).then(([evts, tmpls, obligationEvts]) => {
      if (cancelled) return
      // 台账/自行监测周期义务事件优先，手动日程与 AI 建议日程合并其后
      setEvents([...obligationEvts, ...evts])
      setTemplates(tmpls)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [])

  // AI 生成合规日程
  const generateSchedule = useCallback(async () => {
    setGenerating(true)
    try {
      const res = await apiPost<{ ok: boolean; suggestions?: CalendarTask[] }>('/api/calendar/tasks', { action: 'suggest' })
      if (res.ok && res.data?.ok && Array.isArray(res.data.suggestions)) {
        for (const task of res.data.suggestions) {
          await apiPost('/api/calendar/tasks', { action: 'add', task })
        }
        const listRes = await apiPost<{ ok: boolean; tasks: CalendarTask[] }>('/api/calendar/tasks', { action: 'list' })
        if (listRes.ok && listRes.data?.ok && Array.isArray(listRes.data.tasks)) {
          const evts = listRes.data.tasks
            .filter(t => t && t.date && t.title)
            .map((t, i) => {
              const type = inferType(t)
              const templateId = findTemplateId(t.title)
              const baseEv = {
                id: `t-${i}`,
                date: t.date,
                title: t.title,
                type,
                desc: t.desc || t.description,
                freq: t.repeat,
                urgent: type === "permit" || type === "alert",
                templateId,
              }
              const ev = { ...baseEv, status: inferStatus(baseEv) } as CalendarEvent
              ev.autoTaskStatus = inferAutoTaskStatus(ev)
              return ev
            })
          setEvents(evts)
        }
        setToast(`AI 已生成 ${res.data.suggestions.length} 条合规日程`)
      } else {
        setToast("AI 生成失败，请稍后重试")
      }
    } catch (e) { console.error("[calendar] Load failed:", e)
      setToast("网络错误，无法生成日程")
    }
    setGenerating(false)
  }, [])

  const filtered = useMemo(() => events.filter(e => filters[e.type]), [events, filters])
  const filteredMonth = useMemo(() =>
    filtered.filter(e => e.date.startsWith(`${year}-${String(month + 1).padStart(2, "0")}-`)),
    [filtered, year, month]
  )
  const selEvents = selDate ? filtered.filter(e => e.date === selDate) : []

  // KPI — 精简为3个核心数字
  const kpi = useMemo(() => {
    const permitEvents = events.filter(e => e.type === 'permit')
    const permitDaysLeft = permitEvents.length > 0
      ? Math.min(...permitEvents.map(e => {
        const d = new Date(e.date)
        return Math.ceil((d.getTime() - Date.now()) / 86400000)
      }))
      : null

    const monthReport = events.filter(e =>
      e.type === 'report' && e.date.startsWith(`${year}-${String(month + 1).padStart(2, "0")}-`)
    ).length

    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)
    const weekLedgers = events.filter(e =>
      e.type === 'ledger' &&
      e.date >= weekStart.toISOString().split("T")[0] &&
      e.date <= weekEnd.toISOString().split("T")[0]
    ).length

    return { permitDaysLeft, monthReport, weekLedgers }
  }, [events, year, month])

  // 预警横幅 — 仅许可证紧急时显示
  const permitWarning = useMemo(() => {
    if (kpi.permitDaysLeft === null || kpi.permitDaysLeft < 0) return null
    if (kpi.permitDaysLeft <= 30) return { level: 'critical' as const, days: kpi.permitDaysLeft }
    if (kpi.permitDaysLeft <= 90) return { level: 'warning' as const, days: kpi.permitDaysLeft }
    return null
  }, [kpi.permitDaysLeft])

  const openDocEditor = (templateId: string, eventTitle: string, eventDate: string) => {
    const tmpl = templates.find(t => t.id === templateId)
    setDocEditor({
      open: true,
      templateId,
      templateName: tmpl?.name || eventTitle,
      eventTitle,
      eventDate,
    })
  }

  const askAI = (text: string) => {
    dispatch({ type: "SET_PREFILL_INPUT", text: `请基于合规日历回答：${text}` })
    dispatch({ type: "SET_NAV", nav: "chat" })
  }

  const reloadEvents = useCallback(async () => {
    const listRes = await apiPost<{ ok: boolean; tasks: CalendarTask[] }>('/api/calendar/tasks', { action: 'list' })
    if (listRes.ok && listRes.data?.ok && Array.isArray(listRes.data.tasks)) {
      const evts = listRes.data.tasks
        .filter(t => t && t.date && t.title)
        .map((t, i) => {
          const type = inferType(t)
          const templateId = findTemplateId(t.title)
          const baseEv = {
            id: `t-${i}`,
            date: t.date,
            title: t.title,
            type,
            desc: t.desc || t.description,
            freq: t.repeat,
            urgent: type === "permit" || type === "alert",
            templateId,
          }
          const ev = { ...baseEv, status: inferStatus(baseEv) } as CalendarEvent
          ev.autoTaskStatus = inferAutoTaskStatus(ev)
          return ev
        })
      setEvents(evts)
    }
  }, [])

  // 合规义务 → 关联自动任务 id（双向联动：日历事件触发自动任务检查）
  const obligationAutoTask: Record<string, string> = {
    monitor: "manual-monitor-remind",
    ledger: "ledger-patrol",
  }

  const runObligationCheck = useCallback(async (ev: CalendarEvent) => {
    const taskId = obligationAutoTask[ev.type]
    if (!taskId) return
    setToast(`正在检查「${ev.title}」…`)
    try {
      const res = await apiPost<{ ok: boolean; state?: { lastMessage?: string } }>("/api/auto-tasks", {
        action: "run", taskId, name: ev.title,
      })
      const msg = res.ok && res.data?.ok ? res.data.state?.lastMessage : undefined
      setToast(msg || "检查完成")
    } catch {
      setToast("自动任务执行失败：后端服务不可用")
    }
  }, [])

  // Calendar grid
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startDow = (firstDay.getDay() + 6) % 7
  const days = lastDay.getDate()

  // 时间轴视图 — 未来 90 天
  const timelineEvents = useMemo(() => {
    const todayStr = new Date().toISOString().split("T")[0]
    const future90 = new Date()
    future90.setDate(future90.getDate() + 90)
    const future90Str = future90.toISOString().split("T")[0]
    return filtered
      .filter(e => e.date >= todayStr && e.date <= future90Str)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [filtered])

  // 视图切换 Tab
  const VIEW_TABS: { key: ViewMode; label: string; icon: typeof CalendarIcon }[] = [
    { key: 'month', label: '月视图', icon: CalendarIcon },
    { key: 'timeline', label: '时间轴', icon: List },
  ]

  // ════════════════════════════════════════
  // 渲染
  // ════════════════════════════════════════
  return (
    <div className="flex h-full flex-col">
      {/* ─── Header（极简） ─── */}
      <header className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <p className="text-caption text-muted-foreground">合规义务时间轴 · 许可证 · 报告 · 监测 · 台账</p>
          <div className="flex items-center gap-0.5 rounded-lg bg-secondary/60 p-0.5">
            {VIEW_TABS.map(tab => {
              const Icon = tab.icon
              const active = viewMode === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => setViewMode(tab.key)}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-caption transition-all",
                    active
                      ? "bg-card text-foreground font-medium shadow-card-hover"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/80"
                  )}
                >
                  <Icon className="size-3.5" /> {tab.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-medium text-foreground shadow-sm hover:border-eco-300 hover:bg-eco-50/50 transition-all"
          >
            <Plus className="size-3.5" />
            新建日程
          </button>
          <button
            onClick={generateSchedule}
            disabled={generating}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-eco-strong px-3.5 py-2 text-xs font-medium text-white shadow-card-hover hover:shadow-card-pop transition-all disabled:opacity-50"
          >
            {generating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {generating ? "AI 生成中..." : "AI 生成合规日程"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-6xl gap-5">
          {/* ─── 主列 ─── */}
          <div className="flex-1 min-w-0 space-y-4">

            {/* Zone 1：顶部总览条 — 单行 KPI */}
            <div className="flex items-center gap-6 rounded-xl border border-border bg-card px-5 py-3">
              {/* 许可证 */}
              <div className="flex items-center gap-2">
                <ShieldAlert className={cn(
                  "size-4",
                  kpi.permitDaysLeft === null ? "text-muted-foreground/50" :
                    kpi.permitDaysLeft <= 30 ? "text-destructive" :
                      kpi.permitDaysLeft <= 90 ? "text-warning" : "text-eco-500"
                )} />
                <span className="text-caption text-muted-foreground">许可证剩余</span>
                <span className={cn(
                  "num-display text-body font-bold tabular-nums",
                  kpi.permitDaysLeft === null ? "text-muted-foreground/60" :
                    kpi.permitDaysLeft <= 30 ? "text-destructive" :
                      kpi.permitDaysLeft <= 90 ? "text-warning" : "text-foreground"
                )}>
                  {kpi.permitDaysLeft === null ? "—" : `${kpi.permitDaysLeft}天`}
                </span>
              </div>
              <div className="h-4 w-px bg-border" />
              {/* 本月报告 */}
              <div className="flex items-center gap-2">
                <FileText className={cn("size-4", kpi.monthReport > 0 ? "text-warning" : "text-muted-foreground/50")} />
                <span className="text-caption text-muted-foreground">本月报告</span>
                <span className={cn(
                  "num-display text-body font-bold tabular-nums",
                  kpi.monthReport > 0 ? "text-warning" : "text-muted-foreground"
                )}>
                  {kpi.monthReport}
                </span>
              </div>
              <div className="h-4 w-px bg-border" />
              {/* 本周台账 */}
              <div className="flex items-center gap-2">
                <Clock className={cn("size-4", kpi.weekLedgers > 0 ? "text-info" : "text-muted-foreground/50")} />
                <span className="text-caption text-muted-foreground">本周台账</span>
                <span className={cn(
                  "num-display text-body font-bold tabular-nums",
                  kpi.weekLedgers > 0 ? "text-info" : "text-muted-foreground"
                )}>
                  {kpi.weekLedgers}
                </span>
              </div>
            </div>

            {/* 预警横幅 — 仅紧急时显示 */}
            {permitWarning && (
              <div
                role="alert"
                className={cn(
                  "relative overflow-hidden rounded-xl border p-3 pl-4",
                  permitWarning.level === 'critical'
                    ? "border-destructive/30 bg-gradient-destructive-tint"
                    : "border-warning/30 bg-gradient-warning-tint"
                )}
              >
                <div className={cn(
                  "absolute left-0 top-0 bottom-0 w-1",
                  permitWarning.level === 'critical' ? "bg-destructive" : "bg-warning"
                )} />
                <div className="flex items-center gap-3 pl-1">
                  <ShieldAlert className={cn(
                    "size-4 shrink-0",
                    permitWarning.level === 'critical' ? "text-destructive" : "text-warning"
                  )} />
                  <span className={cn(
                    "text-caption font-medium flex-1",
                    permitWarning.level === 'critical' ? "text-destructive" : "text-warning"
                  )}>
                    排污许可证将于 {permitWarning.days} 天后到期，请尽快启动延续程序
                  </span>
                  <button
                    onClick={() => askAI("排污许可证即将到期，延续程序是什么？")}
                    className="shrink-0 rounded bg-card/80 px-2.5 py-1 text-caption text-eco-700 font-medium hover:bg-card shadow-sm transition-all"
                  >
                    问 AI
                  </button>
                </div>
              </div>
            )}

            {/* Zone 2a：月视图 */}
            {viewMode === "month" && (
              <>
                {/* 月份导航 */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { const nm = month === 0 ? 11 : month - 1; if (month === 0) setYear(y => y - 1); setMonth(nm) }}
                    aria-label="上一月"
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <span className="num-display text-section font-semibold min-w-[110px] text-center text-foreground">
                    {year}年 {MONTHS[month]}
                  </span>
                  <button
                    onClick={() => { const nm = month === 11 ? 0 : month + 1; if (month === 11) setYear(y => y + 1); setMonth(nm) }}
                    aria-label="下一月"
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                  <button
                    onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()) }}
                    className="rounded-md bg-secondary px-2.5 py-1 text-caption text-foreground hover:bg-accent transition-colors ml-1"
                  >
                    今天
                  </button>
                  {/* 图例 */}
                  <div className="ml-auto flex items-center gap-3">
                    {(Object.keys(EVT_META) as EvtType[]).map(k => (
                      <button
                        key={k}
                        onClick={() => setFilters(p => ({ ...p, [k]: !p[k as EvtType] }))}
                        className="flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground transition-colors"
                        title={EVT_META[k].label}
                      >
                        <span className={cn("size-1.5 rounded-full", EVT_META[k].dot, !filters[k] && "opacity-30")} />
                        {EVT_META[k].label}
                      </button>
                    ))}
                  </div>
                </div>

                {loading ? (
                  <div className="rounded-xl border border-border bg-card flex items-center justify-center py-20">
                    <Loader2 className="size-6 animate-spin text-eco-600" />
                  </div>
                ) : (
                  <div className="rounded-xl border border-border bg-card overflow-hidden">
                    {/* 周标题行 */}
                    <div className="grid grid-cols-7 bg-secondary/30">
                      {WEEKDAYS.map((d, i) => (
                        <div
                          key={d}
                          className={cn(
                            "px-2 py-2 text-center text-caption font-medium border-b border-border",
                            i >= 5 ? "text-muted-foreground/70" : "text-muted-foreground"
                          )}
                        >
                          {d}
                        </div>
                      ))}
                    </div>
                    {/* 日期格 — 72px 紧凑 + 色点 */}
                    <div className="grid grid-cols-7">
                      {Array.from({ length: 42 }).map((_, i) => {
                        const dn = i - startDow + 1
                        const isDay = dn > 0 && dn <= days
                        const ds = isDay ? `${year}-${String(month + 1).padStart(2, "0")}-${String(dn).padStart(2, "0")}` : ""
                        const dayEvts = filteredMonth.filter(e => e.date === ds)
                        const isToday = ds === today
                        const isSel = ds === selDate
                        const isWeekend = i % 7 >= 5
                        const hasUrgent = dayEvts.some(e => e.urgent)
                        return (
                          <button
                            key={i}
                            onClick={() => isDay && setSelDate(isSel ? null : ds)}
                            aria-label={isDay ? `${ds}，${dayEvts.length} 个事件` : undefined}
                            className={cn(
                              "h-[72px] p-1.5 text-left transition-all border-b border-r border-border/50",
                              "hover:bg-accent/40",
                              isToday && "bg-eco-50/60 ring-1 ring-eco-500/30 ring-inset",
                              isSel && "ring-2 ring-eco-500 ring-inset z-10",
                              isWeekend && isDay && "bg-secondary/10",
                              !isDay && "opacity-30 pointer-events-none bg-secondary/5"
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <span className={cn(
                                "num-display text-caption font-medium",
                                isToday ? "text-eco-700 font-bold" : hasUrgent ? "text-destructive font-semibold" : "text-foreground"
                              )}>
                                {isDay ? dn : ""}
                              </span>
                              {hasUrgent && (
                                <span className="size-1.5 rounded-full bg-destructive animate-pulse" aria-hidden="true" />
                              )}
                            </div>
                            {/* 色点 — 最多5个，多了显示+N */}
                            {dayEvts.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {dayEvts.slice(0, 5).map(ev => (
                                  <span
                                    key={ev.id}
                                    className={cn("size-1.5 rounded-full", EVT_META[ev.type].dot)}
                                    title={ev.title}
                                  />
                                ))}
                                {dayEvts.length > 5 && (
                                  <span className="text-caption leading-none text-muted-foreground tabular-nums">
                                    +{dayEvts.length - 5}
                                  </span>
                                )}
                              </div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {!loading && events.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
                    <CalendarIcon className="size-10 mx-auto mb-3 text-muted-foreground/30" />
                    <p className="text-body text-foreground font-medium">暂无合规日程</p>
                    <p className="text-caption text-muted-foreground mt-1">点击右上角「AI 生成合规日程」自动创建</p>
                  </div>
                )}
              </>
            )}

            {/* Zone 2b：时间轴视图 */}
            {viewMode === "timeline" && (
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-section font-semibold text-foreground">未来 90 天合规义务</h3>
                  <span className="text-caption text-muted-foreground tabular-nums">{timelineEvents.length} 项</span>
                </div>
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="size-6 animate-spin text-eco-600" />
                  </div>
                ) : timelineEvents.length === 0 ? (
                  <div className="text-center py-12">
                    <CalendarIcon className="size-10 mx-auto mb-3 text-muted-foreground/30" />
                    <p className="text-body text-muted-foreground">未来 90 天暂无合规义务</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {timelineEvents.map(ev => {
                      const Icon = EVT_META[ev.type].icon
                      const daysLeft = Math.ceil((new Date(ev.date).getTime() - Date.now()) / 86400000)
                      return (
                        <button
                          key={ev.id}
                          onClick={() => { if (ev.templateId) openDocEditor(ev.templateId, ev.title, ev.date) }}
                          className={cn(
                            "group flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all",
                            ev.urgent
                              ? "border-destructive/30 bg-destructive/[0.04] hover:bg-destructive/[0.08]"
                              : "border-border bg-card hover:border-eco-200 hover:shadow-card-hover",
                            !ev.templateId && "cursor-default"
                          )}
                        >
                          <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", EVT_META[ev.type].bg)}>
                            <Icon className={cn("size-4", EVT_META[ev.type].text)} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-body font-medium text-foreground truncate">{ev.title}</span>
                              {/* 自动任务状态标记 */}
                              {ev.autoTaskStatus === 'ready' && (
                                <span className="shrink-0 rounded bg-success/10 px-1.5 py-0.5 text-caption text-success font-medium">
                                  草稿已就绪
                                </span>
                              )}
                              {ev.autoTaskStatus === 'running' && (
                                <span className="shrink-0 rounded bg-info/10 px-1.5 py-0.5 text-caption text-info font-medium">
                                  AI 生成中
                                </span>
                              )}
                              {ev.templateId && (
                                <span className="shrink-0 rounded bg-eco-50 px-1.5 py-0.5 text-caption text-eco-700 group-hover:bg-eco-100 transition-colors">
                                  可编辑
                                </span>
                              )}
                            </div>
                            {ev.desc && <p className="text-caption text-muted-foreground truncate mt-0.5">{ev.desc}</p>}
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-caption text-muted-foreground tabular-nums">{ev.date}</div>
                            <div className={cn(
                              "num-display text-caption font-semibold tabular-nums mt-0.5",
                              daysLeft <= 7 ? "text-destructive" : daysLeft <= 30 ? "text-warning" : "text-muted-foreground"
                            )}>
                              {daysLeft > 0 ? `${daysLeft} 天后` : "已到期"}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Zone 4：台账/报告模板 — 折叠式 */}
            {!docEditor.open && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                {TEMPLATE_GROUPS.map((group, gi) => {
                  const groupItems = templates.filter(t => t.category === group.key)
                  if (groupItems.length === 0) return null
                  const expanded = tmplExpanded[group.key] ?? false
                  return (
                    <div key={group.key} className={gi > 0 ? "border-t border-border/50" : ""}>
                      <button
                        onClick={() => setTmplExpanded(p => ({ ...p, [group.key]: !expanded }))}
                        className="flex w-full items-center justify-between px-4 py-3 hover:bg-accent/30 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          {expanded ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevR className="size-3.5 text-muted-foreground" />}
                          <span className="text-body font-medium text-foreground">{group.label}</span>
                          <span className="text-caption text-muted-foreground tabular-nums">({groupItems.length})</span>
                        </div>
                        <span className="text-caption text-muted-foreground">{expanded ? "收起" : "展开"}</span>
                      </button>
                      {expanded && (
                        <div className="px-4 pb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                          {groupItems.map(tpl => {
                            const Icon = ICON_MAP[tpl.icon] || FileText
                            return (
                              <button
                                key={tpl.id}
                                onClick={() => openDocEditor(tpl.id, tpl.name, today)}
                                className="group relative overflow-hidden rounded-lg border border-border bg-card p-3 text-left transition-all hover:border-eco-300 hover:shadow-card-hover"
                              >
                                <div className="absolute inset-0 -z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-eco-tint" />
                                <div className="flex size-8 items-center justify-center rounded-lg bg-eco-50 mb-2 group-hover:bg-eco-100 group-hover:scale-105 transition-all">
                                  <Icon className="size-4 text-eco-600" />
                                </div>
                                <div className="text-caption font-medium text-foreground leading-snug">{tpl.name}</div>
                                <div className="text-caption text-muted-foreground mt-0.5 line-clamp-2">
                                  {tpl.description}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ─── 右侧：选中日详情 / DocEditor ─── */}
          {docEditor.open ? (
            <div className="w-[520px] shrink-0">
              <DocEditor
                embedded
                open={docEditor.open}
                templateId={docEditor.templateId}
                templateName={docEditor.templateName}
                eventTitle={docEditor.eventTitle}
                eventDate={docEditor.eventDate}
                onClose={() => setDocEditor({ open: false })}
              />
            </div>
          ) : (
            <div className="w-[280px] shrink-0">
              <div className="sticky top-0">
                {/* 选中日详情 */}
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  {selDate ? (
                    <>
                      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                        <div>
                          <h3 className="num-display text-body font-semibold text-foreground tabular-nums">{selDate}</h3>
                          <p className="text-caption text-muted-foreground mt-0.5">
                            {selEvents.length > 0 ? `${selEvents.length} 项合规义务` : "无事件"}
                          </p>
                        </div>
                        <button
                          onClick={() => setSelDate(null)}
                          aria-label="关闭详情"
                          className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                      <div className="p-3 max-h-[60vh] overflow-y-auto">
                        {selEvents.length === 0 ? (
                          <div className="text-center py-6">
                            <CalendarIcon className="size-6 mx-auto mb-2 text-muted-foreground/30" />
                            <p className="text-caption text-muted-foreground">该日无事件</p>
                            <button
                              onClick={() => { setAddOpen(true) }}
                              className="mt-3 rounded-lg border border-border bg-card px-3 py-1.5 text-caption text-foreground hover:bg-accent transition-colors"
                            >
                              + 添加临时任务
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {selEvents.map(ev => {
                              const Icon = EVT_META[ev.type].icon
                              return (
                                <div
                                  key={ev.id}
                                  className={cn(
                                    "rounded-lg p-3 border",
                                    EVT_META[ev.type].bg, EVT_META[ev.type].border
                                  )}
                                >
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <Icon className={cn("size-3.5", EVT_META[ev.type].text)} />
                                    <span className={cn(
                                      "text-body font-medium flex-1",
                                      ev.urgent ? "text-destructive" : "text-foreground"
                                    )}>
                                      {ev.title}
                                    </span>
                                  </div>
                                  {/* 状态标签 */}
                                  <div className="flex items-center gap-1.5 mb-2">
                                    <span className={cn(
                                      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-caption",
                                      STATUS_META[ev.status].bg, STATUS_META[ev.status].text
                                    )}>
                                      <span className={cn("size-1.5 rounded-full", STATUS_META[ev.status].dot)} />
                                      {STATUS_META[ev.status].label}
                                    </span>
                                    {ev.autoTaskStatus === 'ready' && (
                                      <span className="inline-flex items-center gap-1 rounded bg-success/10 px-1.5 py-0.5 text-caption text-success">
                                        <Sparkles className="size-2.5" />
                                        草稿已就绪
                                      </span>
                                    )}
                                  </div>
                                  {ev.desc && <p className="text-caption text-muted-foreground">{ev.desc}</p>}
                                  {ev.freq && (
                                    <p className="text-caption text-muted-foreground/70 mt-0.5">
                                      频次: {ev.freq}
                                    </p>
                                  )}
                                  {ev.source && (
                                    <p className="text-caption text-muted-foreground/70 mt-0.5">
                                      来源: {ev.source === "platform" ? "平台解析" : "法规兜底"}
                                    </p>
                                  )}
                                  <div className="flex gap-1.5 mt-2">
                                    {ev.templateId && (
                                      <button
                                        onClick={() => openDocEditor(ev.templateId!, ev.title, ev.date)}
                                        className="rounded bg-gradient-eco-strong px-2.5 py-1 text-caption text-white font-medium hover:shadow-card-hover transition-all"
                                      >
                                        {ev.type === 'report' ? "从台账生成" : "编辑文档"}
                                      </button>
                                    )}
                                    {ev.obligationId && (
                                      <button
                                        onClick={() => runObligationCheck(ev)}
                                        className="rounded border border-eco-200 bg-eco-50/60 px-2.5 py-1 text-caption text-eco-700 font-medium hover:bg-eco-100 transition-colors"
                                      >
                                        触发自动检查
                                      </button>
                                    )}
                                    <button
                                      onClick={() => askAI(ev.title)}
                                      className="rounded bg-secondary px-2.5 py-1 text-caption text-foreground hover:bg-accent transition-colors"
                                    >
                                      问 AI
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="px-4 py-8 text-center">
                      <CalendarIcon className="size-8 mx-auto mb-2 text-muted-foreground/30" />
                      <p className="text-body text-muted-foreground">点击日历日期</p>
                      <p className="text-caption text-muted-foreground/70 mt-1">查看该日合规义务详情</p>
                    </div>
                  )}
                </div>

                {/* 状态图例 */}
                <div className="mt-3 rounded-xl border border-border bg-card/60 p-4">
                  <h3 className="mb-2.5 text-caption font-semibold uppercase tracking-wider text-muted-foreground">状态图例</h3>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(Object.keys(STATUS_META) as EvtStatus[]).map(k => (
                      <div key={k} className="flex items-center gap-1.5 text-caption text-foreground">
                        <span className={cn("size-1.5 rounded-full", STATUS_META[k].dot)} />
                        {STATUS_META[k].label}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 pt-2 border-t border-border/50">
                    <div className="flex items-center gap-1.5 text-caption text-foreground">
                      <Sparkles className="size-2.5 text-success" />
                      草稿已就绪
                    </div>
                    <p className="text-caption text-muted-foreground/70 ml-4 mt-0.5">自动任务已生成报告草稿</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* toast 提示 */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-foreground px-4 py-2 text-body text-background shadow-card-pop"
        >
          {toast}
        </div>
      )}

      {/* 新建日程 Modal */}
      <AddEventModal
        open={addOpen}
        defaultDate={selDate || today}
        onClose={() => setAddOpen(false)}
        onSuccess={(msg) => { setAddOpen(false); setToast(msg); reloadEvents() }}
      />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════
 * 新建日程 Modal — 手动录入临时任务
 * ═══════════════════════════════════════════════════════ */
function AddEventModal({
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
                      "flex flex-col items-center gap-1 rounded-lg border px-1 py-2 transition-all",
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
