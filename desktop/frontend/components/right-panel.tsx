"use client"
import { useState, useEffect, useMemo, useCallback } from "react"
import {
  ShieldCheck, ChevronDown, FileText, PanelRight,
  Pencil, Trash2, Check, Wrench, Sparkles, Search, AlertTriangle,
  Clock, MessageSquare, Bell, X, AlertOctagon,
  GitBranch, CheckCircle2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useApp } from "@/lib/store"
import { stripMarkdown } from "@/lib/utils"

/* ═══════════════════════════════════════════════════════
 * EcoPilot 合规工作台 — 右栏 V3
 *
 * 设计反思（基于 GitHub Top 10 顶级右栏研究）：
 *  - Vercel chatbot（20.6k★）Artifact 动效 + VersionFooter 时间轴
 *  - shadcn Sidebar（118.4k★）collapsible="icon" + SidebarRail 可拖拽
 *  - Plane Peek（54.1k★）三态 side-peek/modal/full-screen
 *  - AFFiNE（70.2k★）journal-button 独立入口 + notification-button
 *  - Outline（39.6k★）Reference Panel 反向链接（审计溯源核心）
 *  - Continue（34.7k★）AcceptRejectDiffButtons + DeprecationBanner
 *  - Logseq（43.8k★）Journal 默认首页 + Backlinks
 *
 * V3 超越点（合规场景护城河）：
 *  1. 风险关键词检测 + 3 级风险分级（蓝/黄/红）
 *  2. 法规时效分级（国法 5 年 / 部委 3 年 / 地方 2 年 / 行业 1 年）
 *  3. 审计溯源徽章（借鉴 Outline Backlinks）
 *  4. 合规决策按钮（借鉴 Continue AcceptRejectDiffButtons）
 *  5. 法规时效横幅（借鉴 Continue DeprecationBanner）
 *  6. 通知中心入口（借鉴 AFFiNE notification-button）
 *  7. 合规进度环（头像外环 SVG 可视化）
 *
 * 视觉精致度：
 *  - Vercel shadow-as-border + Linear eyebrow label + tabular-nums
 *  - 头像外环 SVG 进度环（stroke-dasharray 动效）
 *  - Layer 标题左侧 2px accent 竖条（层级识别增强）
 *  - 卡片 hover 阴影变深（0.06 → 0.1）
 *
 * 4 层级 Session Frame 架构不变：
 *  L1 本次对话 — 当前 Session Frame（结论/文件/法规/决策）
 *  L2 合规记忆 — 长期沉淀（风险标注/法规时效/审计溯源/搜索）
 *  L3 工作日志 — 历史溯源（按日期分组）
 *  L4 能力     — 合规助手能力卡片 + 自学习技能
 *  L5 企业进化 — 对话驱动的企业知识沉淀
 * ═══════════════════════════════════════════════════════ */

export function RightPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  // 折叠状态持久化
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  // mount 后从 localStorage 同步（避免 SSR/客户端初始值不一致导致 hydration 不匹配）
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("rp_v3_collapsed") || "{}")
      if (saved && typeof saved === 'object') setCollapsed(saved)
    } catch (e) { console.error("[right-panel] Failed to load data:", e) }
  }, [])
  const toggleLayer = useCallback((id: string) => setCollapsed(p => {
    const next = { ...p, [id]: !p[id] }
    try { localStorage.setItem("rp_v3_collapsed", JSON.stringify(next)) } catch { /* quota exceeded */ }
    return next
  }), [])

  // 通知中心
  const [notifOpen, setNotifOpen] = useState(false)
  const { state } = useApp()

  // 键盘快捷键：Cmd+1/2/3/4 跳转层级
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        const ids = ["layer-session", "layer-memory", "layer-log", "layer-skill", "layer-evolution"]
        if (["1", "2", "3", "4", "5"].includes(e.key)) {
          e.preventDefault()
          const id = ids[Number(e.key) - 1]!
          setCollapsed(p => ({ ...p, [id]: false }))
          requestAnimationFrame(() => {
            document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
          })
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <aside className={cn(
      "z-50 flex h-full shrink-0 flex-col bg-background",
      "fixed inset-y-0 right-0 w-full transition-transform duration-300 ease-in-out",
      open ? "translate-x-0" : "translate-x-full",
      "md:static md:translate-x-0 md:overflow-hidden md:transition-[width] md:duration-300",
      open ? "md:w-full" : "md:w-0"
    )} aria-label="合规工作台右栏">
      <Header
        onToggle={onToggle}
        notifOpen={notifOpen}
        setNotifOpen={setNotifOpen}
      />

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="mx-auto max-w-md space-y-3">
          {/* 法规时效横幅（借鉴 Continue DeprecationBanner） */}
          <RegulatoryStaleBanner />

          <Layer id="layer-session" collapsed={collapsed} onToggle={toggleLayer}
            label="本次对话" icon={MessageSquare} accent="eco"
            meta={state.taskSummaries.length > 0 ? `${state.taskSummaries.length} 项产出` : "等待对话"}
            pulse={state.sending ? (state.progress?.name ? `⚡${state.progress.name}` : "生成中…") : (state.messages.length > 0 ? "● 就绪" : undefined)}
          >
            <SessionFrame />
          </Layer>

          <Layer id="layer-memory" collapsed={collapsed} onToggle={toggleLayer}
            label="合规记忆" icon={Sparkles} accent="eco"
            meta={`${state.memories.length} 条`}
          >
            <MemoriesLayer />
          </Layer>

          <Layer id="layer-log" collapsed={collapsed} onToggle={toggleLayer}
            label="工作日志" icon={Clock} accent="muted"
            meta={`${state.diaryEntries.length} 条`}
          >
            <DiaryLayer />
          </Layer>

          <Layer id="layer-skill" collapsed={collapsed} onToggle={toggleLayer}
            label="能力" icon={Wrench} accent="muted"
            meta={state.selfLearningSkills.length > 0 ? `${state.selfLearningSkills.length} 自学技能` : undefined}
          >
            <SkillsLayer />
          </Layer>

          <Layer id="layer-evolution" collapsed={collapsed} onToggle={toggleLayer}
            label="企业进化" icon={Sparkles} accent="muted"
            meta={state.enterpriseEvolution.length > 0 ? `${state.enterpriseEvolution.length} 条` : undefined}
          >
            <EvolutionLayer />
          </Layer>
        </div>
      </div>
    </aside>
  )
}

/* ═══════════════ Header：助手画像 + 通知 + 收起 ═══════════════ */

function Header({ onToggle, notifOpen, setNotifOpen }: {
  onToggle: () => void
  notifOpen: boolean
  setNotifOpen: (v: boolean) => void
}) {
  const { state } = useApp()
  const convCount = state.conversations.length
  const memCount = state.memories.length

  // 通知数量（基于法规时效过期数 + 风险记忆数）
  const notifCount = useMemo(() => {
    const staleMem = state.memories.filter(m => m.category.includes("法规") && isRegulatoryStale(m.createdAt, m.category)).length
    const riskyMem = state.memories.filter(m => detectRiskLevel(m.content) === "high").length
    return staleMem + riskyMem
  }, [state.memories])

  return (
    <header className="relative flex shrink-0 items-center justify-between gap-2 px-4 py-3">
      {/* 左侧：头像 + 标题 */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="relative shrink-0">
          <div className="flex size-7 items-center justify-center rounded-xl bg-eco-600 text-white shadow-sm">
            <ShieldCheck className="size-4" strokeWidth={2} />
          </div>
          <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-success ring-[1.5px] ring-background" title="在线" />
        </div>
        <div className="min-w-0">
          <h2 className="text-body font-semibold text-foreground leading-tight">AI管家</h2>
          <p className="text-caption text-muted-foreground leading-tight tabular-nums">
            {convCount} 对话 · {memCount} 记忆
          </p>
        </div>
      </div>

      {/* 右侧：通知 + 收起 */}
      <div className="flex items-center gap-0.5 text-muted-foreground">
        <button
          onClick={() => setNotifOpen(!notifOpen)}
          aria-label={`通知中心 ${notifCount > 0 ? `${notifCount} 条未读` : "无未读"}`}
          title="通知中心"
          className={cn(
            "relative rounded-md p-2 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40",
            notifOpen ? "bg-accent text-foreground" : "hover:bg-accent hover:text-foreground"
          )}
        >
          <Bell className="size-5" />
          {notifCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-destructive text-white text-caption font-bold tabular-nums ring-[1.5px] ring-background">
              {notifCount > 9 ? "9+" : notifCount}
            </span>
          )}
        </button>

        <button
          onClick={onToggle}
          aria-label="收起右侧面板"
          title="收起"
          className="rounded-md p-2 hover:bg-accent hover:text-foreground transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
        >
          <PanelRight className="size-5" />
        </button>
      </div>

      {/* 通知中心下拉（绝对定位，挂在 header 下方） */}
      {notifOpen && (
        <div className="absolute right-2 top-full z-30 mt-1 w-72 rounded-xl border border-border bg-popover p-1 shadow-popover max-h-80 overflow-y-auto">
          <NotificationCenter onClose={() => setNotifOpen(false)} />
        </div>
      )}
    </header>
  )
}

/* ═══════════════ 法规时效横幅（借鉴 Continue DeprecationBanner） ═══════════════ */

function RegulatoryStaleBanner() {
  const { state } = useApp()
  const staleMemories = useMemo(() => {
    return state.memories.filter(m =>
      m.category.includes("法规") && isRegulatoryStale(m.createdAt, m.category)
    )
  }, [state.memories])

  if (staleMemories.length === 0) return null

  return (
    <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/[0.06] px-3 py-2">
      <AlertTriangle className="size-3.5 shrink-0 text-warning mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-caption font-medium text-warning-700 dark:text-warning">
          {staleMemories.length} 条法规记忆已超过复核期
        </p>
        <p className="text-caption text-muted-foreground mt-0.5">
          建议查阅最新版本，避免引用已修订条款
        </p>
      </div>
    </div>
  )
}

/* ═══════════════ 通知中心（法规事件流） ═══════════════ */

function NotificationCenter({ onClose }: { onClose: () => void }) {
  const { state } = useApp()

  const events = useMemo(() => {
    const list: { type: "stale" | "risk" | "info"; title: string; desc: string; time: string }[] = []
    state.memories.forEach(m => {
      if (m.category.includes("法规") && isRegulatoryStale(m.createdAt, m.category)) {
        list.push({
          type: "stale",
          title: "法规记忆待复核",
          desc: stripMarkdown(m.content).slice(0, 60) + (m.content.length > 60 ? "…" : ""),
          time: m.createdAt,
        })
      }
      const lvl = detectRiskLevel(m.content)
      if (lvl === "high") {
        list.push({
          type: "risk",
          title: "高风险合规事项",
          desc: stripMarkdown(m.content).slice(0, 60) + (m.content.length > 60 ? "…" : ""),
          time: m.createdAt,
        })
      }
    })
    return list.slice(0, 20)
  }, [state.memories])

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 py-6 text-center">
        <div className="flex size-7 items-center justify-center rounded-xl bg-success/10">
          <CheckCircle2 className="size-3.5 text-success" strokeWidth={1.5} />
        </div>
        <p className="text-caption text-muted-foreground">暂无通知，合规状态良好</p>
      </div>
    )
  }

  return (
    <div className="space-y-0.5">
      <div className="px-2 py-1.5 flex items-center justify-between">
        <span className="text-caption font-medium uppercase tracking-wider text-foreground/80">合规通知</span>
        <span className="text-caption font-mono tabular-nums text-muted-foreground">{events.length}</span>
      </div>
      {events.map((e, i) => (
        <button
          key={i}
          onClick={onClose}
          className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent transition-all duration-200"
        >
          {e.type === "stale" && <Clock className="size-3 shrink-0 text-warning mt-0.5" />}
          {e.type === "risk" && <AlertOctagon className="size-3 shrink-0 text-destructive mt-0.5" />}
          {e.type === "info" && <Bell className="size-3 shrink-0 text-info mt-0.5" />}
          <div className="min-w-0 flex-1">
            <p className="text-caption font-medium text-foreground leading-snug">{e.title}</p>
            <p className="text-caption text-muted-foreground line-clamp-2 mt-0.5">{e.desc}</p>
          </div>
        </button>
      ))}
    </div>
  )
}

/* ═══════════════ Layer 容器（统一层级卡片样式） ═══════════════ */

function Layer({ id, collapsed, onToggle, label, icon: Icon, accent, meta, pulse, children }: {
  id: string
  collapsed: Record<string, boolean>
  onToggle: (id: string) => void
  label: string
  icon: typeof ShieldCheck
  accent: "eco" | "muted"
  meta?: string
  pulse?: string
  children: React.ReactNode
}) {
  const isOpen = !collapsed[id]
  return (
    <section id={id} className="scroll-mt-3">
      <button
        onClick={() => onToggle(id)}
        aria-expanded={isOpen}
        className="group flex w-full items-center justify-between rounded-xl px-1 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* 左侧 accent 竖条（层级识别增强） */}
          <span className={cn(
            "h-3.5 w-[2px] rounded-full transition-all duration-200",
            accent === "eco" ? "bg-eco-500" : "bg-muted-foreground/30",
            isOpen && (accent === "eco" ? "bg-eco-600" : "bg-muted-foreground/50")
          )} />
          <Icon className={cn("size-3.5 shrink-0", accent === "eco" ? "text-eco-600" : "text-muted-foreground")} />
          <span className="text-caption font-medium text-foreground/80">{label}</span>
          {meta && (
            <span className="text-caption font-mono tabular-nums text-muted-foreground">{meta}</span>
          )}
          {/* Agent 脉冲状态 */}
          {pulse && (
            <span className={cn(
              "text-caption font-mono tabular-nums",
              pulse.startsWith("⚡") ? "text-eco-600" : "text-success"
            )}>{pulse}</span>
          )}
        </div>
        <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform duration-200", isOpen ? "" : "-rotate-90")} />
      </button>
      {isOpen && <div className="mt-1.5 animate-in fade-in slide-in-from-top-1 duration-200">{children}</div>}
    </section>
  )
}

/* ═══════════════ L1: 本次对话（Session Frame） ═══════════════ */

function SessionFrame() {
  const { state, dispatch } = useApp()

  const hasContent = state.taskSummaries.length > 0 || state.outputFiles.length > 0
  const hasMessages = state.messages.length > 0

  // 打开 MD 阅览栏
  const openMdViewer = () => {
    if (state.messages.length === 0) return
    const title = state.conversations.find(c => c.id === state.activeConversationId)?.title || "对话记录"
    const txt = state.messages.map(m => `## ${m.role === "user" ? "提问" : "回答"}\n\n${m.content}`).join("\n\n---\n\n")
    ;(window as Window & { __ecopilotMdFile?: { name: string; content: string } }).__ecopilotMdFile = { name: `${title}.md`, content: txt }
    window.dispatchEvent(new CustomEvent("ecopilot:open-md"))
  }

  // 快捷操作
  const quickActions = [
    { label: "查许可状态", icon: ShieldCheck, action: () => dispatch({ type: "SET_PREFILL_INPUT", text: "查我的许可证状态" }) },
    { label: "合规诊断", icon: Search, action: () => dispatch({ type: "SET_PREFILL_INPUT", text: "帮我做一次合规诊断" }) },
    { label: "生成报告", icon: FileText, action: () => dispatch({ type: "SET_PREFILL_INPUT", text: "生成本月执行报告草稿" }) },
    { label: "查处罚案例", icon: AlertTriangle, action: () => dispatch({ type: "SET_PREFILL_INPUT", text: "近期环保处罚案例" }) },
  ]

  if (!hasContent && !state.sending) {
    return (
      <div className="space-y-3">
        {/* 即使无产出，有对话也能预览为 MD */}
        {hasMessages && (
          <button
            onClick={openMdViewer}
            className="flex w-full items-center gap-2 rounded-xl border border-eco-200 bg-eco-50/50 px-3 py-2 text-caption text-eco-600 hover:bg-eco-50 hover:border-eco-300 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
          >
            <FileText className="size-3.5 shrink-0" />
            <span className="flex-1 text-left font-medium">预览对话为文档</span>
            <span className="text-caption text-eco-600">可导出 .md / .doc / .pdf</span>
          </button>
        )}
        <Card>
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <div className="flex size-9 items-center justify-center rounded-xl bg-eco-50">
              <Sparkles className="size-4 text-eco-600" strokeWidth={1.5} />
            </div>
            <p className="text-body font-medium text-foreground">对话资产将自动沉淀</p>
            <p className="text-caption text-muted-foreground max-w-[220px]">
              AI 产出的结论、文件、引用法规会自动归档到这里
            </p>
          </div>
        </Card>
        {/* 快捷操作 — 对标 ChatGPT Canvas / AFFiNE journal-button */}
        <QuickActions actions={quickActions} />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* 预览对话为 MD 文档（含导出按钮） */}
      {hasMessages && (
        <button
          onClick={openMdViewer}
          className="flex w-full items-center gap-2 rounded-xl border border-eco-200 bg-eco-50/50 px-3 py-2 text-caption text-eco-600 hover:bg-eco-50 hover:border-eco-300 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
        >
          <FileText className="size-3.5 shrink-0" />
          <span className="flex-1 text-left font-medium">预览对话为文档</span>
          <span className="text-caption text-eco-600">导出 .md / .doc / .pdf</span>
        </button>
      )}

      {/* 任务产出 — 纯文字版，保留时间戳 */}
      {state.taskSummaries.map(s => (
        <Card key={s.id}>
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex-1 min-w-0">
              <h4 className="text-body font-semibold text-foreground leading-snug">{s.title}</h4>
              {s.time && <span className="text-caption text-muted-foreground font-mono">{s.time}</span>}
            </div>
          </div>
          <div className="space-y-0.5 text-caption text-foreground/80 leading-relaxed">
            {s.operations?.map((o, i) => <p key={i}>{stripMarkdown(o)}</p>)}
            {s.findings?.map((f, i) => <p key={i}>{stripMarkdown(f)}</p>)}
            {s.recommendations?.map((r, i) => <p key={i}>{stripMarkdown(r)}</p>)}
            {!s.operations?.length && !s.findings?.length && !s.recommendations?.length && (
              <p className="text-muted-foreground">{s.time} · 待填充</p>
            )}
          </div>
        </Card>
      ))}

      {/* 输出文件 */}
      {state.outputFiles.length > 0 && (
        <Card>
          <div className="text-caption font-medium text-muted-foreground mb-1">
            文件 · {state.outputFiles.length}
          </div>
          <ul className="space-y-0.5">
            {state.outputFiles.map(f => (
              <li key={f.id} className="flex items-center justify-between gap-2 px-1.5 py-1">
                <span className="truncate text-body text-foreground">{f.name}</span>
                {f.createdAt && <span className="shrink-0 text-caption text-muted-foreground font-mono">{new Date(f.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

/* ═══════════════ L2: 合规记忆（搜索 + 风险分级 + 法规时效 + 审计溯源） ═══════════════ */

// 风险关键词分级
const RISK_HIGH = ["超标", "违法", "逾期", "处罚", "限期整改", "停产"]
const RISK_MEDIUM = ["不合规", "违规", "警告"]
type RiskLevel = "none" | "medium" | "high"

function detectRiskLevel(content: string): RiskLevel {
  if (RISK_HIGH.some(k => content.includes(k))) return "high"
  if (RISK_MEDIUM.some(k => content.includes(k))) return "medium"
  return "none"
}

// 法规时效分级（借鉴 Plane due date tri-state）
function getRegulatoryStaleDays(category: string): number {
  if (category.includes("法律") || category.includes("国法")) return 365 * 5
  if (category.includes("部委") || category.includes("规章") || category.includes("办法")) return 365 * 3
  if (category.includes("地方") || category.includes("省级")) return 365 * 2
  if (category.includes("行业") || category.includes("标准")) return 365 * 1
  return 365 * 3 // 默认 3 年
}

function isRegulatoryStale(createdAt: string, category: string = "法规"): boolean {
  try {
    const d = new Date(createdAt).getTime()
    if (!d) return false
    const days = getRegulatoryStaleDays(category)
    return Date.now() - d > days * 24 * 3600 * 1000
  } catch { return false }
}

function MemoriesLayer() {
  const { state, dispatch } = useApp()
  const [query, setQuery] = useState("")
  const [editing, setEditing] = useState<string | null>(null)
  const [filter, setFilter] = useState("全部")

  const filtered = useMemo(() => {
    let list = state.memories
    // 快速过滤
    if (filter === "高风险") list = list.filter(m => detectRiskLevel(m.content) === "high")
    else if (filter === "待复核") list = list.filter(m => m.category.includes("法规") && isRegulatoryStale(m.createdAt, m.category))
    else if (filter === "法规条款") list = list.filter(m => m.category.includes("法规") || m.category.includes("条款"))
    // 搜索
    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter(m => m.content.toLowerCase().includes(q) || m.category.toLowerCase().includes(q))
    }
    return list
  }, [state.memories, query, filter])

  if (state.memories.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Sparkles}
          text="AI 将在对话中自动提取关键信息沉淀到这里"
        />
      </Card>
    )
  }

  const inputCls = "w-full rounded bg-secondary/50 px-2 py-1 text-caption focus:outline-none focus:ring-1 focus:ring-eco-400 overflow-y-auto"

  return (
    <div className="space-y-3">
      {/* 搜索框 + 快速过滤 */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜索记忆..."
          className="w-full rounded-xl border border-border bg-card pl-8 pr-7 py-1.5 text-caption text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-eco-400"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            aria-label="清除搜索"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      {/* 快速过滤芯片 — 对标 Linear filter chips */}
      <FilterChips
        options={["全部", "高风险", "待复核", "法规条款"]}
        active={filter}
        onChange={setFilter}
      />

      {/* 记忆列表 */}
      <div className="max-h-[280px] overflow-y-auto space-y-1.5 pr-0.5">
        {filtered.length === 0 ? (
          <p className="text-center text-caption text-muted-foreground py-4">无匹配记忆</p>
        ) : (
          filtered.map(m => {
            const lvl = detectRiskLevel(m.content)
            const stale = m.category.includes("法规") && isRegulatoryStale(m.createdAt, m.category)
            return (
              <Card key={m.id} className={cn(
                lvl === "high" && "ring-1 ring-destructive/30 bg-destructive/[0.03]",
                lvl === "medium" && "ring-1 ring-warning/30 bg-warning/[0.03]",
                stale && "opacity-70",
                "cursor-pointer hover:ring-1 hover:ring-eco-300 transition-all"
              )}
              onClick={() => {
                dispatch({ type: "SET_PREFILL_INPUT", text: `请解释这条规定：${stripMarkdown(m.content)}` })
                dispatch({ type: "SET_NAV", nav: "chat" })
              }}
              >
                {editing === m.id ? (
                  <div className="space-y-1.5" onKeyDown={e => { if (e.key === "Escape") setEditing(null) }} onClick={e => e.stopPropagation()}>
                    <textarea
                      value={m.content}
                      onChange={e => dispatch({ type: "UPDATE_MEMORY", id: m.id, data: { content: e.target.value } })}
                      className={cn(inputCls, "text-foreground")} rows={3}
                    />
                    <button onClick={() => setEditing(null)} className="text-caption text-eco-600 hover:underline">完成 (Esc)</button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-caption text-foreground leading-relaxed flex-1">{stripMarkdown(m.content)}</p>
                      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <IconBtn icon={Pencil} label="编辑记忆" onClick={() => setEditing(m.id)} />
                        <IconBtn icon={Trash2} label="删除记忆" onClick={() => dispatch({ type: "DELETE_MEMORY", id: m.id })} destructive />
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-1.5 flex-wrap gap-1">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-caption font-mono text-muted-foreground">{m.category}</span>
                        {/* 风险分级徽章 */}
                        {lvl === "high" && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-destructive/10 px-1.5 py-0.5 text-caption font-medium text-destructive">
                            <AlertOctagon className="size-2.5" />
                            高风险
                          </span>
                        )}
                        {lvl === "medium" && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-warning/15 px-1.5 py-0.5 text-caption font-medium text-warning">
                            <AlertTriangle className="size-2.5" />
                            关注
                          </span>
                        )}
                        {/* 法规时效徽章 */}
                        {stale && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-warning/15 px-1.5 py-0.5 text-caption font-medium text-warning">
                            <Clock className="size-2.5" />
                            待复核
                          </span>
                        )}
                      </div>
                      {/* 审计溯源徽章（借鉴 Outline Backlinks） */}
                      <span className="inline-flex items-center gap-0.5 text-caption text-muted-foreground/70" title="审计溯源">
                        <GitBranch className="size-2.5" />
                        <span className="font-mono tabular-nums">{Math.floor(m.content.length / 30)}</span>
                      </span>
                    </div>
                  </>
                )}
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}

/* ═══════════════ L3: 工作日志（按日期分组） ═══════════════ */

function DiaryLayer() {
  const { state, dispatch } = useApp()
  const [editing, setEditing] = useState<string | null>(null)

  const grouped = useMemo(() => {
    const g: Record<string, typeof state.diaryEntries> = {}
    state.diaryEntries.forEach(d => {
      const key = d.date || "未知日期"
      if (!g[key]) g[key] = []
      g[key].push(d)
    })
    return Object.entries(g).sort((a, b) => b[0].localeCompare(a[0]))
  }, [state.diaryEntries])

  if (state.diaryEntries.length === 0) {
    return (
      <Card>
        <EmptyState icon={Clock} text="每次对话完成会自动生成工作日记" />
      </Card>
    )
  }

  const inputCls = "w-full rounded bg-secondary/50 px-2 py-1 text-caption focus:outline-none focus:ring-1 focus:ring-eco-400 overflow-y-auto"

  return (
    <div className="space-y-3">
      {grouped.map(([date, entries]) => (
        <div key={date}>
          <div className="flex items-center gap-1 px-1 py-1">
            <div className="h-px flex-1 bg-border/60" />
            <span className="text-caption font-mono text-muted-foreground tabular-nums">{date}</span>
            <div className="h-px flex-1 bg-border/60" />
          </div>
          <div className="space-y-1.5 mt-1">
            {entries.map(d => (
              <Card key={d.id}>
                {editing === d.id ? (
                  <div className="space-y-1.5" onKeyDown={e => { if (e.key === "Escape") setEditing(null) }}>
                    <input value={d.title} onChange={e => dispatch({ type: "UPDATE_DIARY", id: d.id, data: { title: e.target.value } })} className={cn(inputCls, "font-medium text-foreground")} />
                    <textarea value={d.summary} onChange={e => dispatch({ type: "UPDATE_DIARY", id: d.id, data: { summary: e.target.value } })} className={cn(inputCls, "text-muted-foreground")} rows={2} />
                    <button onClick={() => setEditing(null)} className="text-caption text-eco-600 hover:underline">完成 (Esc)</button>
                  </div>
                ) : (
                  <div className="group">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-caption font-medium text-foreground leading-snug">{d.title}</p>
                        <p className="mt-0.5 text-caption text-muted-foreground leading-relaxed line-clamp-2">{stripMarkdown(d.summary)}</p>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <IconBtn icon={Pencil} label="编辑日记" onClick={() => setEditing(d.id)} />
                        <IconBtn icon={Trash2} label="删除日记" onClick={() => dispatch({ type: "DELETE_DIARY", id: d.id })} destructive />
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ═══════════════ L4: 能力 ═══════════════ */

function SkillsLayer() {
  const { state } = useApp()
  const activeTool = state.sending ? state.progress?.name : null
  const skills = state.selfLearningSkills

  return (
    <div className="space-y-1.5">
      <Card className="flex items-start gap-2.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-eco-50">
          <Wrench className="size-3.5 text-eco-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-caption font-medium text-foreground leading-snug">合规助手</p>
          <p className="mt-0.5 text-caption text-muted-foreground line-clamp-2 leading-relaxed">
            排污许可 · 环境监测 · 合规巡检 · 应急管理 · 生产工艺，五位一体独立完成
          </p>
          <span className="mt-1 inline-block rounded bg-secondary px-1.5 py-0.5 text-caption font-mono text-muted-foreground">
            ECO-000
          </span>
        </div>
      </Card>
      {/* 实时工具状态 — 对标 Claude Code agent status */}
      <Card>
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", activeTool ? "bg-eco-500 animate-pulse" : "bg-muted-foreground/40")} />
          <span className="text-caption text-foreground">
            {activeTool ? `正在: ${activeTool}` : "待命中"}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-caption text-muted-foreground">
          <span className="font-mono">MCP</span>
          <span className="size-1 rounded-full bg-success" />
          <span>已连接</span>
        </div>
      </Card>
      {/* 自学习技能 */}
      {skills.length > 0 && (
        <>
          <div className="flex items-center gap-1 px-1 py-1 mt-2">
            <div className="h-px flex-1 bg-border/60" />
            <span className="text-caption font-mono text-muted-foreground tabular-nums">自学技能</span>
            <div className="h-px flex-1 bg-border/60" />
          </div>
          {skills.map(s => (
            <Card key={s.id}>
              <div className="flex items-start gap-2">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-amber-50 mt-0.5">
                  <Sparkles className="size-3 text-amber-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-caption font-medium text-foreground leading-snug">{s.name}</p>
                  {s.description && (
                    <p className="mt-0.5 text-caption text-muted-foreground leading-relaxed">{stripMarkdown(s.description)}</p>
                  )}
                  <div className="mt-1 flex items-center gap-1.5 text-caption text-muted-foreground">
                    <span className="rounded bg-secondary px-1 py-0.5 font-mono">{s.size}字</span>
                    {s.autoGenerated && <span className="text-amber-500 text-caption">自动生成</span>}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </>
      )}
      {skills.length === 0 && (
        <Card>
          <EmptyState icon={Sparkles} text="高频对话后自动生成技能" />
        </Card>
      )}
    </div>
  )
}

/* ═══════════════ L5: 企业进化日志 ═══════════════ */

function EvolutionLayer() {
  const { state } = useApp()
  const entries = state.enterpriseEvolution

  if (entries.length === 0) {
    return (
      <Card>
        <EmptyState icon={Sparkles} text="每次对话后自动沉淀企业知识" />
      </Card>
    )
  }

  return (
    <div className="space-y-1.5">
      {entries.map((entry, i) => (
        <Card key={`${entry.timestamp}-${i}`}>
          <div className="flex items-start gap-2">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-eco-50 mt-0.5">
              <GitBranch className="size-3 text-eco-600" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-caption font-medium text-foreground leading-snug truncate">
                  {entry.enterprise}
                </span>
                <span className="text-caption font-mono text-muted-foreground tabular-nums shrink-0">
                  {entry.timestamp.slice(0, 16).replace("T", " ")}
                </span>
              </div>
              {entry.knowledge.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {entry.knowledge.slice(0, 3).map((k, j) => (
                    <p key={j} className="text-caption text-muted-foreground leading-relaxed line-clamp-1">
                      &middot; {stripMarkdown(k)}
                    </p>
                  ))}
                  {entry.knowledge.length > 3 && (
                    <p className="text-caption text-muted-foreground">
                      ...等 {entry.knowledge.length} 条知识
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

/* ═══════════════ Shared 组件 ═══════════════ */

/** Vercel shadow-as-border 风格卡片 + hover 阴影加深 */
function Card({ children, className, onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cn(
      "group relative rounded-md bg-card px-3 py-2 transition-shadow duration-200",
      "shadow-[0_0_0_1px_rgba(0,0,0,0.06)] hover:shadow-[0_0_0_1px_rgba(0,0,0,0.1)]",
      "dark:shadow-[0_0_0_1px_rgba(255,255,255,0.08)] dark:hover:shadow-[0_0_0_1px_rgba(255,255,255,0.14)]",
      className,
    )}>
      {children}
    </div>
  )
}

/** 紧凑图标按钮 */
function IconBtn({ icon: Icon, label, onClick, destructive }: {
  icon: typeof ShieldCheck; label: string; onClick: () => void; destructive?: boolean
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      aria-label={label}
      title={label}
      className={cn(
        "rounded p-1 text-muted-foreground transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40",
        destructive ? "hover:text-destructive hover:bg-destructive/10" : "hover:text-foreground hover:bg-accent"
      )}
    >
      <Icon className="size-3" />
    </button>
  )
}

/** 快捷操作栏 — 对标 ChatGPT Canvas / AFFiNE journal-button */
function QuickActions({ actions }: { actions: { label: string; icon: typeof ShieldCheck; action: () => void }[] }) {
  const { dispatch } = useApp()
  return (
    <div className="space-y-1">
      <p className="text-caption font-medium uppercase tracking-wider text-muted-foreground px-1">快捷操作</p>
      <div className="grid grid-cols-2 gap-1">
        {actions.map(a => (
          <button
            key={a.label}
            onClick={() => { a.action(); dispatch({ type: "SET_NAV", nav: "chat" }) }}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-2 py-1.5 text-caption text-foreground hover:border-eco-300 hover:bg-eco-50/30 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
          >
            <a.icon className="size-3 shrink-0 text-eco-600" />
            <span className="truncate">{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** 快速过滤芯片 — 对标 Linear filter chips */
function FilterChips({ options, active, onChange }: { options: string[]; active: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {options.map(o => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn(
            "rounded-full px-2 py-0.5 text-caption transition-all duration-200",
            active === o
              ? "bg-eco-600 text-white"
              : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
          )}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

/** 空态 */
function EmptyState({ icon: Icon, text }: { icon: typeof ShieldCheck; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-4 text-center">
      <div className="flex size-7 items-center justify-center rounded-xl bg-secondary/60">
        <Icon className="size-3.5 text-muted-foreground/70" strokeWidth={1.5} />
      </div>
      <p className="text-caption text-muted-foreground max-w-[200px]">{text}</p>
    </div>
  )
}


