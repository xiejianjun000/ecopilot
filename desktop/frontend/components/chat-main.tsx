"use client"
import { useRef, useCallback, useEffect, useState } from "react"
import { PanelRight, PanelLeft, ShieldCheck, Sparkles, Clock, ChevronRight, Calendar as CalIcon, ClipboardCheck, Zap, ExternalLink, FolderClosed, BookOpen, Plug, Send, FileKey, Building2, Scale, FileText, ClipboardList, AlertTriangle, BarChart3, ArrowDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { useApp } from "@/lib/store"
import { streamChat, apiGet } from "@/lib/api"
import { ChatMessage } from "@/components/chat-message"
import { ChatInput } from "@/components/chat-input"
import { DashboardView } from "@/components/dashboard-view"
import { InspectionView } from "@/components/views/inspection"
import { CalendarView } from "@/components/views/calendar"
import { LinksView } from "@/components/views/links"
import { VaultView } from "@/components/views/vault"
import { KnowledgeView } from "@/components/views/knowledge"
import { ConnectorView } from "@/components/views/connector"
import { TasksView } from "@/components/views/tasks"
import { NotifyView } from "@/components/views/notify"

const VIEWS: Record<string, (() => React.JSX.Element) | null> = {
  chat: null,
  inspection: InspectionView,
  calendar: CalendarView,
  links: LinksView,
  vault: VaultView,
  knowledge: KnowledgeView,
  connector: ConnectorView,
  tasks: TasksView,
  notify: NotifyView,
}

/**
 * 统一模块元信息 — 与 left-sidebar.tsx 的 NAV 数组保持单一来源
 * 这里复用相同的图标 + 标签，确保侧栏、顶部 toolbar、视图自身三处名称一致
 */
const NAV_META: Record<string, { name: string; Icon: typeof CalIcon }> = {
  calendar: { name: "合规日历", Icon: CalIcon },
  inspection: { name: "交办整改", Icon: ClipboardCheck },
  tasks: { name: "自动任务", Icon: Zap },
  links: { name: "申报平台", Icon: ExternalLink },
  vault: { name: "档案库", Icon: FolderClosed },
  knowledge: { name: "知识库", Icon: BookOpen },
  connector: { name: "连接器", Icon: Plug },
  notify: { name: "通讯中心", Icon: Send },
}

/** 工具名 → 友好显示名 */
const TOOL_LABELS: Record<string, string> = {
  check_permit_status: "检查许可证状态",
  check_report_status: "检查执行报告",
  check_monitoring_data: "检查监测数据",
  check_ledger_status: "检查台账记录",
  check_compliance: "合规性检查",
  search_knowledge: "检索知识库",
  get_permit_info: "读取许可证信息",
}

const QUICK_PROMPTS = [
  { label: "生成本月执行报告草稿", Icon: FileText },
  { label: "查我的许可证还有多久到期", Icon: FileKey },
  { label: "台账缺失项排查", Icon: ClipboardList },
  { label: "近期环保处罚案例", Icon: AlertTriangle },
]

function WelcomeCards({ onCardClick }: { onCardClick: (label: string) => void }) {
  const [cards, setCards] = useState<{ label: string; icon: typeof FileKey; urgency: "high"|"medium"|"low" }[]>([])
  useEffect(() => {
    apiGet<{ name?: string; permit_expiry?: string; credit_code?: string; management_level?: string }>('/api/enterprise')
      .then(r => {
        const data = r.data
        if (data?.name) {
          const issues: { label: string; icon: typeof FileKey; urgency: "high"|"medium"|"low" }[] = []
          const name = data.name || "企业"
          if (data.permit_expiry) {
            const days = Math.ceil((new Date(data.permit_expiry).getTime() - Date.now()) / 86400000)
            if (days <= 60) issues.push({ label: `${name}许可证还有${days}天到期`, icon: AlertTriangle, urgency: "high" })
            else issues.push({ label: `许可证有效期至${data.permit_expiry}`, icon: FileKey, urgency: "low" })
          }
          if (!data.credit_code) issues.push({ label: "企业信用代码未完善，可能影响申报", icon: AlertTriangle, urgency: "medium" })
          if (!data.management_level) issues.push({ label: "管理类别未设置，影响合规分析精度", icon: AlertTriangle, urgency: "medium" })
          if (issues.length < 1) issues.push({ label: "合规态势分析", icon: BarChart3, urgency: "low" })
          if (issues.length < 2) issues.push({ label: "执行报告提交状态检查", icon: FileText, urgency: "medium" })
          if (issues.length < 3) issues.push({ label: "环境管理台账完善度评估", icon: ClipboardList, urgency: "medium" })
          setCards(issues.slice(0, 3))
        } else {
          setCards([
            { label: "完成排污许可证读取", icon: FileKey, urgency: "high" },
            { label: "设置企业基本信息", icon: Building2, urgency: "medium" },
            { label: "查看生态环境法典核心条款", icon: Scale, urgency: "low" },
          ])
        }
      })
      .catch(() => setCards([
        { label: "完成排污许可证读取", icon: FileKey, urgency: "high" },
        { label: "设置企业基本信息", icon: Building2, urgency: "medium" },
        { label: "查看生态环境法典核心条款", icon: Scale, urgency: "low" },
      ]))
  }, [])

  const urgencyBorder = (u: string) => u === "high" ? "border-destructive/30 hover:border-destructive" : u === "medium" ? "border-warning/30 hover:border-warning" : "border-border hover:border-eco-300"
  const urgencyIconColor = (u: string) => u === "high" ? "text-destructive" : u === "medium" ? "text-warning" : "text-eco-600"

  return (
    <div className="flex flex-wrap justify-center gap-4">
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <button key={card.label} onClick={() => onCardClick(card.label)}
            className={cn("flex flex-col items-center gap-2 rounded-2xl border bg-card px-6 py-5 text-center min-w-[180px] max-w-[220px] transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98]", urgencyBorder(card.urgency))}>
            <Icon className={cn("size-7", urgencyIconColor(card.urgency))} strokeWidth={1.5} />
            <span className="text-body font-medium text-foreground leading-snug">{card.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function ChatMain({ leftOpen, onToggleLeft }: {
  leftOpen: boolean; onToggleLeft: () => void
}) {
  const { state, dispatch } = useApp()
  const chatRef = useRef<HTMLDivElement>(null)
  const [model] = useState<string>("deepseek-chat")
  const abortRef = useRef<AbortController | null>(null)
  const _throttleRef = useRef<{ buf: string; timer: ReturnType<typeof setTimeout> | null } | null>(null)
  /** 刷新节流缓冲区：确保积压文本不丢失 */
  const _flushThrottle = useCallback(() => {
    const t = _throttleRef.current
    if (!t) return
    if (t.timer) { clearTimeout(t.timer); t.timer = null }
    if (t.buf) { dispatch({ type: "UPDATE_LAST_MESSAGE", content: t.buf }); t.buf = "" }
  }, [dispatch])
  const enterpriseRef = useRef<Record<string, unknown> | null>(null)
  // 跟踪最后一条消息的内容长度，用于流式输出时自动滚动
  const lastContentLenRef = useRef(0)

  const scrollDown = useCallback(() => {
    requestAnimationFrame(() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" }))
  }, [])

  // 检测是否在底部（控制滚动到底按钮显示）
  const [isAtBottom, setIsAtBottom] = useState(true)
  const handleScroll = useCallback(() => {
    const el = chatRef.current
    if (!el) return
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }, [])
  useEffect(() => {
    const el = chatRef.current
    if (!el) return
    el.addEventListener("scroll", handleScroll, { passive: true })
    return () => el.removeEventListener("scroll", handleScroll)
  }, [handleScroll])

  // 流式输出时自动滚到底：内容长度变化时触发（不依赖 messages.length）
  useEffect(() => {
    const last = state.messages[state.messages.length - 1]
    if (last?.role === 'assistant' && last.content) {
      if (last.content.length !== lastContentLenRef.current) {
        lastContentLenRef.current = last.content.length
        scrollDown()
      }
    }
  }, [state.messages, scrollDown])

  // 消息时间分隔线：超过 30 分钟的间隔插入时间标签
  const MSG_GAP_MINUTES = 30
  function renderMessages() {
    const nodes: React.ReactNode[] = []
    for (let i = 0; i < state.messages.length; i++) {
      const m = state.messages[i]!
      const prev = i > 0 ? state.messages[i - 1]! : null
      const showTimeSep = prev && m.createdAt && prev.createdAt &&
        (new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime()) > MSG_GAP_MINUTES * 60_000

      if (showTimeSep) {
        const t = new Date(m.createdAt)
        nodes.push(
          <div key={`sep-${m.id}`} className="flex items-center gap-2 py-2">
            <hr className="flex-1 border-border" />
            <span className="shrink-0 text-caption text-muted-foreground">
              {t.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
            </span>
            <hr className="flex-1 border-border" />
          </div>
        )
      }
      nodes.push(
        <ChatMessage key={m.id} message={m} sending={state.sending} progress={state.progress} onRegenerate={() => {
          _flushThrottle()
          dispatch({ type: "REMOVE_LAST_MESSAGE" })
          dispatch({ type: "CLEAR_TOOL_CALLS" })
          const aid = `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
          dispatch({ type: "ADD_MESSAGE", message: { id: aid, role: "assistant", content: "", createdAt: new Date().toISOString(), pending: true } })
          dispatch({ type: "SET_SENDING", sending: true })
          const ac = new AbortController()
          abortRef.current = ac
          const sid = typeof window !== 'undefined' ? sessionStorage.getItem("ecopilot_browser_session") : null
          void (async () => {
            try {
              for await (const evt of streamChat(m.content, enterpriseRef.current, undefined, model, ac.signal, sid ?? undefined, [])) {
                if (ac.signal.aborted) break
                if (evt.type === "text_delta" && typeof evt.text === "string") {
                  if (!_throttleRef.current) _throttleRef.current = { buf: "", timer: null }
                  const t = _throttleRef.current
                  t.buf += evt.text
                  if (!t.timer) {
                    t.timer = setTimeout(() => {
                      if (t.buf) dispatch({ type: "UPDATE_LAST_MESSAGE", content: t.buf })
                      t.buf = ""; t.timer = null
                    }, 150)
                  }
                } else if (evt.type === "tool_call" && typeof evt.name === "string") {
                  dispatch({ type: "ADD_TOOL_CALL", toolCall: { name: evt.name as string, args: typeof evt.args === "string" ? evt.args as string : JSON.stringify(evt.args || "") } })
                } else if (evt.type === "tool_result" && typeof evt.name === "string") {
                  dispatch({ type: "UPDATE_TOOL_RESULT", name: evt.name as string, result: typeof evt.result === "string" ? evt.result : JSON.stringify(evt.result || "") })
                } else if (evt.type === "done") {
                  _flushThrottle()
                  dispatch({ type: "SET_SENDING", sending: false })
                } else if (evt.type === "error") {
                  _flushThrottle()
                  dispatch({ type: "SET_LAST_MESSAGE_ERROR", error: (evt.text as string) || "生成失败" })
                  dispatch({ type: "SET_SENDING", sending: false })
                }
              }
            } catch (err) {
              if (err instanceof Error && err.name !== 'AbortError') {
                _flushThrottle()
                dispatch({ type: "SET_LAST_MESSAGE_ERROR", error: "后端未连接" })
              }
              dispatch({ type: "SET_SENDING", sending: false })
            } finally {
              abortRef.current = null
            }
          })()
        }} />)
    }
    return nodes
  }

  // 拉取企业信息缓存，供对话时透传给后端
  useEffect(() => {
    apiGet<Record<string, unknown>>('/api/enterprise')
      .then(r => { if (r.data?.name) enterpriseRef.current = r.data })
      .catch(() => {})
  }, [])

  const handleSend = useCallback(async (text: string, attachments?: string[], attachmentMeta?: { name: string; dataUrl: string }[]) => {
    // P0-1: 竞态保护——发送中直接拒绝新请求
    if (abortRef.current) return

    // 监控：上报对话事件
    if (typeof window !== 'undefined') {
      import('@/lib/monitor-sdk').then(({ monitor }) => {
        monitor.chat(text.length, model)
      })
    }

    const hasImage = attachments && attachments.length > 0
    const displayText = hasImage ? (text || "[图片]") : text
    const uid = `u-${Date.now()}-${Math.random().toString(36).slice(2,6)}`
    const aid = `a-${Date.now()}-${Math.random().toString(36).slice(2,6)}`

    dispatch({ type: "SET_NAV", nav: "chat" })

    // 用户消息（含附件元数据，便于后续渲染缩略图）
    dispatch({ type: "ADD_MESSAGE", message: {
      id: uid, role: "user", content: displayText, createdAt: new Date().toISOString(),
      ...(attachmentMeta && attachmentMeta.length > 0 ? { attachments: attachmentMeta } : {}),
    }})
    // 助手占位
    dispatch({ type: "ADD_MESSAGE", message: { id: aid, role: "assistant", content: "", createdAt: new Date().toISOString(), pending: true } })
    dispatch({ type: "SET_SENDING", sending: true })

    // 创建 AbortController，支持停止
    const ac = new AbortController()
    abortRef.current = ac
    // P0-2: 会话记忆——用稳定的 browser session ID，确保同一次浏览器会话内 AI 能记住上下文
    const SESSION_KEY = "ecopilot_browser_session"
    let conversationId = typeof window !== 'undefined' ? sessionStorage.getItem(SESSION_KEY) : null
    if (!conversationId && typeof window !== 'undefined') {
      conversationId = `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      sessionStorage.setItem(SESSION_KEY, conversationId)
    }

    // 提取最近对话历史（用于后端重启后恢复上下文）
    const recentHistory = state.messages.slice(-10).map(m => ({ role: m.role, content: m.content }))

    try {
      for await (const evt of streamChat(text, enterpriseRef.current, attachments, model, ac.signal, conversationId ?? undefined, recentHistory)) {
        if (ac.signal.aborted) break

        if (evt.type === "text_delta" && typeof evt.text === "string") {
          if (!_throttleRef.current) _throttleRef.current = { buf: "", timer: null }
          const t = _throttleRef.current
          t.buf += evt.text
          if (!t.timer) {
            t.timer = setTimeout(() => {
              if (t.buf) dispatch({ type: "UPDATE_LAST_MESSAGE", content: t.buf })
              t.buf = ""; t.timer = null
            }, 150)
          }
        }
        else if (evt.type === "tool_start" && typeof evt.text === "string") {
          dispatch({ type: "SET_PROGRESS", progress: { text: evt.text } })
        }
        else if (evt.type === "tool_call" && typeof evt.name === "string") {
          dispatch({ type: "ADD_TOOL_CALL", toolCall: { name: evt.name as string, args: typeof evt.args === "string" ? evt.args as string : JSON.stringify(evt.args || "") } })
          const label = TOOL_LABELS[evt.name as string] || (evt.name as string)
          dispatch({ type: "SET_PROGRESS", progress: { name: evt.name as string, text: `正在调用 ${label}…` } })
        }
        else if (evt.type === "tool_result" && typeof evt.name === "string") {
          dispatch({ type: "UPDATE_TOOL_RESULT", name: evt.name as string, result: typeof evt.result === "string" ? evt.result : JSON.stringify(evt.result || "") })
          dispatch({ type: "SET_PROGRESS", progress: null })
        }
        else if (evt.type === "progress") {
          const text = (evt.text as string) || (evt.name as string) || "处理中…"
          dispatch({ type: "SET_PROGRESS", progress: { step: evt.step as number | undefined, name: evt.name as string | undefined, text } })
        }
        else if (evt.type === "structured" && evt.data) {
          const d = evt.data as Record<string, string[]>
          const ops = (d.operations || []).filter(Boolean)
          const findings = (d.findings || []).filter(Boolean)
          const recs = (d.recommendations || []).filter(Boolean)
          if (ops.length > 0 || findings.length > 0 || recs.length > 0) {
            dispatch({ type: "ADD_TASK_SUMMARY", summary: { time: new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}), title: text.slice(0,40), operations: ops.slice(0,8), findings: findings.slice(0,6), recommendations: recs.slice(0,4) } })
          }
          for (const m of (d.memories || []).filter(Boolean).slice(0,5)) {
            dispatch({ type: "ADD_MEMORY", memory: { category: "法规条款", content: m, createdAt: new Date().toISOString() } })
          }
          dispatch({ type: "ADD_DIARY_ENTRY", entry: { date: new Date().toISOString().slice(0, 10), title: text.slice(0,30), summary: `AI 回复完成，提取了 ${ops.length+findings.length} 项内容` } })
        }
        else if (evt.type === "done") {
          _flushThrottle()
          dispatch({ type: "SET_SENDING", sending: false })
          // 自动生成 taskSummary 和 outputFile，确保右栏显示纯文本+时间
          const lastMsg = state.messages[state.messages.length - 1]
          if (lastMsg?.role === 'assistant' && lastMsg.content?.length > 20) {
            const lines = lastMsg.content.split('\n').filter(Boolean)
            const title = (lines[0]?.replace(/^#+\s*/, '') || '合规分析').slice(0, 40)
            const now = new Date()
            const timeStr = now.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})
            const dateStr = now.toISOString()
            // 提取纯文本段落（去markdown标记）
            const ops = lines.filter(l => /^\d+\.\s/.test(l)).map(l => l.replace(/[*#`>\\[\\]|~-]/g, '').trim()).slice(0, 8)
            const findings = lines.filter(l => /[🔴🟠🟡]\s/.test(l)).map(l => l.replace(/[*#`>\\[\\]|~-]/g, '').trim()).slice(0, 6)
            const recs = lines.filter(l => /^\d+\.\s/.test(l) && l.length > 10).map(l => l.replace(/[*#`>\\[\\]|~-]/g, '').trim()).slice(0, 4)
            dispatch({ type: "ADD_TASK_SUMMARY", summary: { time: timeStr, title, operations: ops, findings, recommendations: recs }})
            const fileName = `${dateStr.slice(0,10)}_${title.slice(0,20).replace(/\s+/g,'-')}.md`
            dispatch({ type: "ADD_OUTPUT_FILE", file: { name: fileName, type: "md", createdAt: dateStr } })
          }
        }
        else if (evt.type === "error") {
          _flushThrottle()
          const errMsg = (evt.detail as string) || (evt.text as string) || "生成失败"
          dispatch({ type: "SET_LAST_MESSAGE_ERROR", error: errMsg })
          dispatch({ type: "SET_SENDING", sending: false })
        }
      }
    } catch (err) {
      // AbortError 是用户主动停止，不算错误
      if (err instanceof Error && err.name !== 'AbortError') {
        _flushThrottle()
        dispatch({ type: "SET_LAST_MESSAGE_ERROR", error: "后端未连接，请检查服务是否运行" })
        dispatch({ type: "SET_SENDING", sending: false })
      } else {
        // 用户停止：把 pending 状态清掉
        dispatch({ type: "SET_SENDING", sending: false })
      }
    } finally {
      abortRef.current = null
    }
  }, [dispatch, model, state.activeConversationId, state.sending])

  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    dispatch({ type: "SET_SENDING", sending: false })
  }, [dispatch])

  // 键盘快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      // Cmd/Ctrl + / : 新建对话
      if (mod && e.key === "/") {
        e.preventDefault()
        dispatch({ type: "NEW_CONVERSATION" })
      }
      // Esc : 停止生成
      if (e.key === "Escape" && state.sending) {
        e.preventDefault()
        handleStop()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [dispatch, state.sending, handleStop])

  // Route to view
  const nav = state.activeNav
  const ViewComponent = VIEWS[nav]
  const hasMessages = state.messages.length > 0

  // 最近会话（取前 4 条）
  const recentConvs = state.conversations.slice(0, 4)

  // 统一模块元信息 — 配合顶部 PageHeader 渲染
  const navMeta = NAV_META[nav]

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-canvas">
      <header className="flex items-center justify-between gap-2 px-4 py-3 md:px-6">
        <div className="flex items-center gap-2">
          <button onClick={onToggleLeft} className={cn("rounded-md p-2 text-muted-foreground hover:bg-accent transition-all duration-200 hover:text-foreground", leftOpen ? "md:hidden" : "")} aria-label={leftOpen ? "收起侧栏" : "展开侧栏"} title={leftOpen ? "收起侧栏" : "展开侧栏"}><PanelLeft className="size-5" /></button>
          {/* chat / dashboard 视图：显示切换器 */}
          {(!ViewComponent || nav === "dashboard") && (
            <div className="flex shrink-0 items-center rounded-full bg-secondary p-1 text-body">
              <button onClick={() => dispatch({ type: "SET_NAV", nav: "chat" })} className={cn("whitespace-nowrap rounded-full px-4 py-1.5", nav === "chat" ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground")}>对话</button>
              <button onClick={() => dispatch({ type: "SET_NAV", nav: "dashboard" })} className={cn("whitespace-nowrap rounded-full px-4 py-1.5", nav === "dashboard" ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground")}>仪表盘</button>
            </div>
          )}
          {/* 其他视图：显示统一模块标识（图标 + 名称，与侧栏 NAV 数组同源） */}
          {ViewComponent && nav !== "dashboard" && navMeta && (
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex size-7 items-center justify-center rounded-xl bg-eco-600 text-white shrink-0 shadow-sm">
                <navMeta.Icon className="size-4" />
              </div>
              <span className="text-section font-semibold text-foreground truncate">{navMeta.name}</span>
              <button
                onClick={() => dispatch({ type: "SET_NAV", nav: "chat" })}
                className="shrink-0 rounded-xl border border-border bg-card px-2.5 py-1 text-caption text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
                aria-label="返回对话"
              >
                ← 对话
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          {nav === "chat" && (
            <button onClick={() => dispatch({ type: "TOGGLE_RIGHT_PANEL" })} className="rounded-md p-2 hover:bg-accent" aria-label="右面板"><PanelRight className="size-5" /></button>
          )}
        </div>
      </header>

      {/* Content area */}
      {nav === "dashboard" ? (
        <DashboardView />
      ) : ViewComponent ? (
        <ViewComponent />
      ) : hasMessages ? (
        <div ref={chatRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 relative" role="log" aria-live="polite" aria-label="对话消息">
          <div className="mx-auto flex max-w-3xl flex-col gap-6 py-6">
            {renderMessages()}
          </div>
          {/* 滚动到底部按钮 */}
          {!isAtBottom && (
            <button
              onClick={scrollDown}
              className="sticky bottom-4 float-right z-10 flex size-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md hover:text-foreground hover:border-eco-300 transition-all duration-200"
              aria-label="滚动到底部"
            >
              <ArrowDown className="size-4" />
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center overflow-y-auto">
          {!hasMessages && (
            <div className="flex flex-col items-center justify-center gap-0 px-8 w-full min-h-full select-none">
              {/* 呼吸光晕 */}
              <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] pointer-events-none"
                style={{
                  background: "radial-gradient(ellipse, rgba(15,118,110,0.10) 0%, rgba(150,213,98,0.04) 40%, transparent 70%)",
                }}
              />
              {/* Logo + Pilot — 水平排列 */}
              <div className="relative z-10 flex items-center gap-4">
                <img src="/logo.svg" alt="EcoPilot" className="w-[200px] h-auto object-contain drop-shadow-[0_0_60px_rgba(15,118,110,0.12)]" />
                <span className="text-[40px] font-bold tracking-tight text-foreground" style={{ fontFamily: "-apple-system, 'PingFang SC', system-ui, sans-serif" }}>
                  Pilot
                </span>
              </div>
              {/* 副标题 */}
              <p className="relative z-10 mt-3 text-[15px] text-muted-foreground/60 tracking-wide" style={{ fontFamily: "-apple-system, 'PingFang SC', sans-serif" }}>
                企业生态环境全生命周期AI管家
              </p>

              {/* 合规态势卡片 */}
              <div className="relative z-10 mt-10 w-full max-w-3xl">
                <WelcomeCards onCardClick={(label: string) => handleSend(label)} />
              </div>

              {/* 快捷指令 */}
              <div className="relative z-10 mt-8 w-full max-w-3xl">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="size-3.5 text-muted-foreground" strokeWidth={1.5} />
                  <span className="text-body font-medium text-muted-foreground tracking-wide">快捷指令</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {QUICK_PROMPTS.map(p => (
                    <button key={p.label} onClick={() => handleSend(p.label)}
                      className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3 text-left text-body text-foreground hover:border-eco-300 hover:bg-eco-50/30 transition-all duration-200 active:scale-[0.985]">
                      <p.Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                      <span className="flex-1 truncate font-medium">{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 最近会话 */}
              {recentConvs.length > 0 && (
                <div className="relative z-10 mt-8 w-full max-w-3xl">
                  <div className="flex items-center gap-2 mb-3">
                    <Clock className="size-3.5 text-muted-foreground" strokeWidth={1.5} />
                    <span className="text-body font-medium text-muted-foreground tracking-wide">最近会话</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {recentConvs.map(c => (
                      <button key={c.id} onClick={() => { dispatch({ type:"SET_CONVERSATION_ACTIVE", id:c.id }) }}
                        className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3 text-left hover:border-eco-300 hover:bg-eco-50/30 transition-all duration-200 active:scale-[0.985]">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-eco-100 text-body font-semibold text-eco-600">{c.title.charAt(0)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-body font-medium text-foreground">{c.title}</div>
                          <div className="truncate text-caption text-muted-foreground mt-0.5">{c.lastMessage || "暂无消息"}</div>
                        </div>
                        <span className="text-caption text-muted-foreground shrink-0 tabular-nums">{c.time}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Input (only for chat view — 不在仪表盘/档案库等视图渲染) */}
      {nav === "chat" && (
        <ChatInput
          onSend={handleSend}
          sending={state.sending}
          onStop={handleStop}
          model={model}
          onModelChange={() => {}}
        />
      )}
    </main>
  )
}
