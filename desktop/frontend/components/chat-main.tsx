"use client"
import { useRef, useCallback, useEffect, useState } from "react"
import { PanelRight, PanelLeft, ShieldCheck, Sparkles, Clock, ChevronRight, Calendar as CalIcon, ClipboardCheck, Zap, ExternalLink, FolderClosed, BookOpen, Plug, Send, FileKey, Building2, Scale, FileText, ClipboardList, AlertTriangle, BarChart3 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useApp } from "@/lib/store"
import { streamChat, apiGet } from "@/lib/api"
import { ChatMessage } from "@/components/chat-message"
import { ChatInput } from "@/components/chat-input"
import { BrandAnimation } from "@/components/brand-animation"
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
  { label: "生成本月执行报告草稿", emoji: "📝" },
  { label: "查我的许可证还有多久到期", emoji: "📋" },
  { label: "台账缺失项排查", emoji: "🔍" },
  { label: "近期环保处罚案例", emoji: "⚠️" },
]

function WelcomeCards({ onCardClick }: { onCardClick: (label: string) => void }) {
  // taste-skill 4.E: "Emoji Policy: Discouraged by default. Replace with icon-library glyphs."
  // 用 Lucide 图标替代 emoji，符合 B2B trust-first 气质
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
            className={cn("flex flex-col items-center gap-3 rounded-2xl border bg-card px-6 py-5 text-center min-w-[180px] max-w-[220px] transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98]", urgencyBorder(card.urgency))}>
            <Icon className={cn("size-7", urgencyIconColor(card.urgency))} strokeWidth={1.75} />
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
  const [showBrand, setShowBrand] = useState(true)
  const [model] = useState<string>("deepseek-chat")
  const abortRef = useRef<AbortController | null>(null)
  const enterpriseRef = useRef<Record<string, unknown> | null>(null)

  const scrollDown = useCallback(() => {
    requestAnimationFrame(() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" }))
  }, [])

  useEffect(() => { if (state.messages.length > 0) scrollDown() }, [state.messages, scrollDown])

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
    // P0-2: 捕获当前会话 ID，流式更新只写入该会话
    const conversationId = state.activeConversationId

    try {
      for await (const evt of streamChat(text, enterpriseRef.current, attachments, model, ac.signal)) {
        if (ac.signal.aborted) break
        // P0-2: 会话切换后立即停止写入
        if (state.activeConversationId !== conversationId) {
          ac.abort()
          break
        }

        if (evt.type === "text_delta" && typeof evt.text === "string") {
          // 整段刷新，不做打字机（性能 + 简单）
          dispatch({ type: "UPDATE_LAST_MESSAGE", content: evt.text })
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
          dispatch({ type: "ADD_DIARY_ENTRY", entry: { date: new Date().toISOString().split('T')[0], title: text.slice(0,30), summary: `AI 回复完成，提取了 ${ops.length+findings.length} 项内容` } })
        }
        else if (evt.type === "done") {
          dispatch({ type: "SET_SENDING", sending: false })
          const fileName = `task_${new Date().toISOString().slice(0,10)}_${text.slice(0,20).replace(/\s+/g,'-')}.md`
          dispatch({ type: "ADD_OUTPUT_FILE", file: { name: fileName, type: "md", createdAt: new Date().toISOString() } })
        }
        else if (evt.type === "error") {
          const errMsg = (evt.detail as string) || (evt.text as string) || "生成失败"
          dispatch({ type: "SET_LAST_MESSAGE_ERROR", error: errMsg })
          dispatch({ type: "SET_SENDING", sending: false })
        }
      }
    } catch (err) {
      // AbortError 是用户主动停止，不算错误
      if (err instanceof Error && err.name !== 'AbortError') {
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
          <button onClick={onToggleLeft} className={cn("rounded-md p-2 text-muted-foreground hover:bg-accent transition-colors hover:text-foreground", leftOpen ? "md:hidden" : "")} aria-label={leftOpen ? "收起侧栏" : "展开侧栏"} title={leftOpen ? "收起侧栏" : "展开侧栏"}><PanelLeft className="size-5" /></button>
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
              <div className="flex size-7 items-center justify-center rounded-lg bg-eco-600 text-white shrink-0 shadow-sm">
                <navMeta.Icon className="size-4" />
              </div>
              <span className="text-section font-semibold text-foreground truncate">{navMeta.name}</span>
              <button
                onClick={() => dispatch({ type: "SET_NAV", nav: "chat" })}
                className="shrink-0 rounded-lg border border-border bg-card px-2.5 py-1 text-caption text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
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
        <div ref={chatRef} className="flex-1 overflow-y-auto px-6" role="log" aria-live="polite" aria-label="对话消息">
          <div className="mx-auto flex max-w-3xl flex-col gap-6 py-6">
            {state.messages.map(m => <ChatMessage key={m.id} message={m} sending={state.sending} progress={state.progress} onRegenerate={() => {
              // P0-3: 重试时只替换最后一条助手消息，不追加新用户消息
              dispatch({ type: "REMOVE_LAST_MESSAGE" })  // 移除失败的助手消息
              // 重新生成，但不添加新用户消息（用原内容）
              const aid = `a-${Date.now()}-${Math.random().toString(36).slice(2,6)}`
              dispatch({ type: "ADD_MESSAGE", message: { id: aid, role: "assistant", content: "", createdAt: new Date().toISOString(), pending: true } })
              dispatch({ type: "SET_SENDING", sending: true })
              const ac = new AbortController()
              abortRef.current = ac
              const conversationId = state.activeConversationId
              void (async () => {
                try {
                  for await (const evt of streamChat(m.content, enterpriseRef.current, undefined, model, ac.signal)) {
                    if (ac.signal.aborted || state.activeConversationId !== conversationId) break
                    if (evt.type === "text_delta" && typeof evt.text === "string") {
                      dispatch({ type: "UPDATE_LAST_MESSAGE", content: evt.text })
                    } else if (evt.type === "tool_call" && typeof evt.name === "string") {
                      dispatch({ type: "ADD_TOOL_CALL", toolCall: { name: evt.name as string, args: typeof evt.args === "string" ? evt.args as string : JSON.stringify(evt.args || "") } })
                    } else if (evt.type === "tool_result" && typeof evt.name === "string") {
                      dispatch({ type: "UPDATE_TOOL_RESULT", name: evt.name as string, result: typeof evt.result === "string" ? evt.result : JSON.stringify(evt.result || "") })
                    } else if (evt.type === "done") {
                      dispatch({ type: "SET_SENDING", sending: false })
                    } else if (evt.type === "error") {
                      dispatch({ type: "SET_LAST_MESSAGE_ERROR", error: (evt.text as string) || "生成失败" })
                      dispatch({ type: "SET_SENDING", sending: false })
                    }
                  }
                } catch (err) {
                  if (err instanceof Error && err.name !== 'AbortError') {
                    dispatch({ type: "SET_LAST_MESSAGE_ERROR", error: "后端未连接" })
                  }
                  dispatch({ type: "SET_SENDING", sending: false })
                } finally {
                  abortRef.current = null
                }
              })()
            }} />)}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center overflow-y-auto">
          {showBrand && !hasMessages ? (
            <BrandAnimation onDone={() => setShowBrand(false)} />
          ) : (
            <div className="flex flex-col items-center gap-8 px-6 py-16 w-full max-w-3xl">
              {/* Logo + 标题 */}
              <div className="flex items-center gap-4">
                <div className="flex size-16 items-center justify-center rounded-2xl bg-eco-600 shadow-modal shadow-eco-600/25">
                  <ShieldCheck className="size-8 text-white" strokeWidth={1.5} />
                </div>
                <div>
                  <h1 className="text-display font-bold text-foreground">EcoPilot</h1>
                  <p className="text-body text-muted-foreground">企业生态环境合规AI管家</p>
                </div>
              </div>

              {/* 合规态势卡片 */}
              <WelcomeCards onCardClick={(label: string) => handleSend(label)} />

              {/* 快捷指令 */}
              <div className="w-full">
                <div className="flex items-center gap-2 mb-3 text-xs font-medium text-muted-foreground">
                  <Sparkles className="size-3.5" />
                  快捷指令
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {QUICK_PROMPTS.map(p => (
                    <button key={p.label} onClick={() => handleSend(p.label)}
                      className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left text-body text-foreground hover:border-eco-300 hover:bg-eco-50/30 transition-colors">
                      <span className="text-title">{p.emoji}</span>
                      <span className="flex-1 truncate">{p.label}</span>
                      <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
                    </button>
                  ))}
                </div>
              </div>

              {/* 最近会话 */}
              {recentConvs.length > 0 && (
                <div className="w-full">
                  <div className="flex items-center gap-2 mb-3 text-xs font-medium text-muted-foreground">
                    <Clock className="size-3.5" />
                    最近会话
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {recentConvs.map(c => (
                      <button key={c.id} onClick={() => { dispatch({ type:"SET_CONVERSATION_ACTIVE", id:c.id }) }}
                        className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left hover:border-eco-300 hover:bg-eco-50/30 transition-colors">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-eco-100 text-xs font-semibold text-eco-700">{c.title.charAt(0)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-body font-medium text-foreground">{c.title}</div>
                          <div className="truncate text-xs text-muted-foreground">{c.lastMessage || "暂无消息"}</div>
                        </div>
                        <span className="text-caption text-muted-foreground shrink-0">{c.time}</span>
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

      {/* 进度提示浮层 */}
      {state.sending && state.progress?.text && (
        <div className="pointer-events-none absolute bottom-32 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-full bg-foreground/90 px-4 py-2 text-xs text-background shadow-popover">
          <span className="size-2 animate-pulse rounded-full bg-eco-400" />
          <span className="max-w-[280px] truncate">{state.progress.text}</span>
        </div>
      )}
    </main>
  )
}
