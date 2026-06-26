/**
 * EcoPilot 完整页面壳
 *
 * 导航(52px) → 会话列表(280px) → [仪表盘 | 对话 | 专家 | ...] → 右侧面板
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useStore } from '@nanostores/react'
import {
  $compliance,
  $permitDaysRemaining,
  $permitExpiryStatus,
  loadDemoCompliance,
} from './app/ecopilot/store/permit'
import {
  $patrolJobs,
  $enabledJobsCount,
  $lastWarningJob,
  togglePatrolJob,
  runPatrolNow,
} from './app/ecopilot/store/patrol'
import { createHermesClient, DASHBOARD_URL, type HermesClient, type ChatMessage } from './hermes-client'
import { $memories, $diaryEntries, $assetsByType } from './store/right-panel'
import { translateNow } from './i18n/runtime'
import { Icon } from './components/ui/icon'
import { DashboardPage } from './app/ecopilot/views/dashboard'
import { ExpertsView } from './app/ecopilot/views/experts'
import { CalendarView } from './app/ecopilot/views/calendar'
import { LinksView } from './app/ecopilot/views/links'
import { VaultView } from './app/ecopilot/views/vault'
import { KnowledgeView } from './app/ecopilot/views/knowledge'
import { ConnectorView } from './app/ecopilot/views/connector'
import { SettingsView } from './app/ecopilot/views/settings'
import BlurText from './components/react-bits/TextAnimations/BlurText/BlurText'
import DecryptedText from './components/react-bits/TextAnimations/DecryptedText/DecryptedText'
import CountUp from './components/react-bits/TextAnimations/CountUp/CountUp'
import Magnet from './components/react-bits/Animations/Magnet/Magnet'

const MIN_PANEL = 320
const MAX_PANEL = 800
const DEFAULT_PANEL = 380

const NAV_ITEMS = [
  { id: 'dashboard' as const, icon: 'chart-bar', label: '仪表盘' },
  { id: 'chat' as const, icon: 'message', label: '对话' },
  { id: 'expert' as const, icon: 'brain', label: '专家' },
  { id: 'calendar' as const, icon: 'calendar', label: '日历' },
  { id: 'links' as const, icon: 'external-link', label: '政务' },
  { id: 'vault' as const, icon: 'folder', label: '档案库' },
  { id: 'kb' as const, icon: 'book-2', label: '知识库' },
  { id: 'connector' as const, icon: 'plug-connected', label: '连接器' },
  { id: 'settings' as const, icon: 'settings', label: '设置' },
]
type NavId = (typeof NAV_ITEMS)[number]['id']

const EXPERTS = [
  { id: 'ecomind', name: '综合管家', desc: '全链条统筹协调', icon: '🤖', color: '#52c41a', online: true },
  { id: 'permit', name: '排污许可专家', desc: '许可证申领/变更/延续', icon: '📋', color: '#eb2f96', online: true },
  { id: 'carbon', name: '碳排放专家', desc: '碳核算/配额/碳市场', icon: '🏭', color: '#595959', online: true },
  { id: 'env-monitoring', name: '环境监测专家', desc: 'CEMS/自行监测/数据解读', icon: '📊', color: '#1890ff', online: true },
  { id: 'compliance', name: '合规巡检专家', desc: '台账管理/自查自纠', icon: '🔍', color: '#fa8c16', online: true },
  { id: 'emergency', name: '应急专家', desc: '应急预案/隐患排查', icon: '🚨', color: '#f5222d', online: true },
  { id: 'cleaner', name: '清洁生产专家', desc: '清洁生产/绿色工厂', icon: '♻️', color: '#237804', online: false },
]

// ═══════════════ 主壳 ═══════════════

export function EcoPilotShell() {

  const [activeNav, setActiveNav] = useState<NavId>('dashboard')
  const [sidebarCollapsed] = useState(false)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL)
  const [rightTab, setRightTab] = useState<'memory' | 'diary' | 'assets'>('memory')
  const [meetingOpen, setMeetingOpen] = useState(false)

  useEffect(() => {
    if (!$compliance.get().permit) loadDemoCompliance()
  }, [])

  // 全屏页面（不显示会话列表和右侧面板）
  const showSidebar = activeNav === 'chat'

  const handleResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const sX = e.clientX; const sW = panelWidth
    const onMove = (ev: MouseEvent) => setPanelWidth(Math.min(MAX_PANEL, Math.max(MIN_PANEL, sW + (sX - ev.clientX))))
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [panelWidth])

  return (
    <div className="main-layout">
      {/* ── 左导航 ── */}
      <nav className="toolbar-nav">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            className={`toolbar-nav__item ${activeNav === item.id ? 'toolbar-nav__item--active' : ''}`}
            onClick={() => setActiveNav(item.id)}
            title={translateNow('ecopilot.nav.' + item.id)}
          >
            <span className="toolbar-nav__icon"><Icon name={item.icon} size={18} /></span>
            <span className="toolbar-nav__label">{translateNow('ecopilot.nav.' + item.id)}</span>
          </button>
        ))}
      </nav>

      {/* ── 会话列表（仪表盘/档案库页隐藏）── */}
      {showSidebar && (
        <aside className={`session-sidebar ${sidebarCollapsed ? 'session-sidebar--collapsed' : ''}`}>
          <div className="session-sidebar__header">
            <button className="new-task-btn"><span>＋</span> 新建任务</button>
            <div className="search-pill">
              <span className="search-pill__icon"><Icon name="search" size={14} /></span>
              <input className="search-pill__input" placeholder="搜索会话..." />
            </div>
          </div>
          <div className="session-list">
            <SessionGroup title="今日">
              <SessionCard title="排污许可证延续申请" time="14:30" active />
              <SessionCard title="碳排放数据核查" time="11:20" />
            </SessionGroup>
            <SessionGroup title="昨日">
              <SessionCard title="合规巡检报告" time="昨天" />
            </SessionGroup>
            <SessionGroup title="更早">
              <SessionCard title="环评预评价" time="6/20" />
            </SessionGroup>
          </div>
          <div className="session-sidebar__footer">
            <button className="user-menu-trigger">
              <div className="user-menu-trigger__avatar">谢</div>
              <span className="user-menu-trigger__name">军哥</span>
            </button>
          </div>
        </aside>
      )}

      {/* ── 主内容 ── */}
      <main className="main-content">
        {activeNav === 'dashboard' && <DashboardPage onOpenMeeting={() => setMeetingOpen(true)} />}
        {activeNav === 'chat' && <ChatView onOpenMeeting={() => setMeetingOpen(true)} />}
        {activeNav === 'expert' && <ExpertsView onOpenMeeting={() => setMeetingOpen(true)} />}
        {activeNav === 'calendar' && <CalendarView />}
        {activeNav === 'links' && <LinksView />}
        {activeNav === 'vault' && <VaultView />}
        {activeNav === 'kb' && <KnowledgeView />}
        {activeNav === 'connector' && <ConnectorView />}
        {activeNav === 'settings' && <SettingsView />}
      </main>

      {/* ── 右面板（仪表盘/档案库页隐藏）── */}
      {showSidebar && rightPanelOpen && <div className="resize-handle" onMouseDown={handleResize} />}
      {showSidebar && !rightPanelOpen && <button className="panel-toggle" onClick={() => setRightPanelOpen(true)}><Icon name="chevron-left" size={12} /></button>}
      {showSidebar && rightPanelOpen && (
        <aside className="right-panel" style={{ width: panelWidth }}>
          <div className="right-panel__header">
            <div className="right-panel__tabs">
              {(['memory','diary','assets'] as const).map(t => (
                <button key={t} className={`right-panel__tab ${rightTab === t ? 'right-panel__tab--active' : ''}`} onClick={() => setRightTab(t)}>
                  {t === 'memory' ? '记忆' : t === 'diary' ? '日记' : '资产'}
                </button>
              ))}
            </div>
            <button className="right-panel__collapse" onClick={() => setRightPanelOpen(false)}><Icon name="x" size={14} /></button>
          </div>
          <div className="right-panel__content">
            {rightTab === 'memory' && <MemoryPanel />}
            {rightTab === 'diary' && <DiaryPanel />}
            {rightTab === 'assets' && <AssetsPanel />}
          </div>
        </aside>
      )}

      {/* ── 圆桌会议弹窗 ── */}
      {meetingOpen && <RoundTableModal onClose={() => setMeetingOpen(false)} />}
    </div>
  )
}

// ═══════════════ 仪表盘页（全页专业设计）═══════════════

// ═══════════════ 对话页（接 Hermes Dashboard）═══════════════

interface ChatStore {
  messages: ChatMessage[]
  sessionId: string | null
  client: HermesClient | null
  connected: boolean
  sending: boolean
}

let _hermesClientPromise: Promise<HermesClient> | null = null
function ensureClient(): Promise<HermesClient> {
  if (!_hermesClientPromise) {
    _hermesClientPromise = createHermesClient().catch(e => {
      _hermesClientPromise = null
      throw e
    })
  }
  return _hermesClientPromise
}

// ═══════════════ 扁平 SVG 图标 ═══════════════

const IconCopy = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
const IconCheck = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
const IconThumbUp = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
const IconThumbDown = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10zM17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>

// ═══════════════ 消息气泡组件 ═══════════════

function MessageBubble({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false)
  const [liked, setLiked] = useState<'up' | 'down' | null>(null)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* fallback */ }
  }, [message.content])

  const timeStr = message.createdAt
    ? new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <div className={`chat-msg chat-msg--${message.role}`}>
      <div className="chat-msg__avatar">
        {message.role === 'user' ? '👤' : message.role === 'assistant' ? '🤖' : '⚙️'}
      </div>
      <div className="chat-msg__body">
        <div className="chat-msg__header">
          {message.role === 'user' ? '我' : message.role === 'assistant' ? 'EcoPilot' : '系统'}
          {message.pending && <span className="chat-msg__typing"> 输入中...</span>}
        </div>
        <div className="chat-msg__content">
          {message.content ? (
            <pre className="chat-msg__text">{message.content}</pre>
          ) : message.pending ? (
            <span className="chat-msg__cursor">▊</span>
          ) : null}
          {message.error && <div className="chat-msg__error">⚠️ {message.error}</div>}
        </div>
        {!message.pending && (
          <div className="chat-msg__actions chat-msg__actions--always">
            <button className="chat-msg__action-btn" onClick={handleCopy} title="复制">
              {copied ? <IconCheck /> : <IconCopy />}
            </button>
            <button
              className={`chat-msg__action-btn ${liked === 'up' ? 'chat-msg__action-btn--active' : ''}`}
              onClick={() => setLiked(liked === 'up' ? null : 'up')}
              title="赞"
            >
              <IconThumbUp />
            </button>
            <button
              className={`chat-msg__action-btn ${liked === 'down' ? 'chat-msg__action-btn--active' : ''}`}
              onClick={() => setLiked(liked === 'down' ? null : 'down')}
              title="踩"
            >
              <IconThumbDown />
            </button>
            <span className="chat-msg__time">{timeStr}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function ChatView({ onOpenMeeting }: { onOpenMeeting: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [client, setClient] = useState<HermesClient | null>(null)
  const [connected, setConnected] = useState(false)
  const [sending, setSending] = useState(false)
  const [connecting, setConnecting] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const streamAssistantId = useRef<string | null>(null)
  const sendingRef = useRef(false)

  /** 判断用户是否靠近底部（50px 阈值内） */
  const isNearBottom = useCallback(() => {
    const el = chatContainerRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 50
  }, [])

  // 连接 Hermes Dashboard 并创建会话
  useEffect(() => {
    let cancelled = false
    setConnecting(true)
    ensureClient()
      .then(async c => {
        if (cancelled) return
        setClient(c)
        setConnected(c.connected)
        c.onConnectionChange(conn => { if (!cancelled) setConnected(conn) })
        setConnecting(false)
        setError(null)
        try {
          const ECOPROMPT = '你是 EcoPilot，企业生态环境合规AI管家。简洁直接回答用户问题，不列能力清单，不主动自我介绍，不用任何格式符号和emoji，纯文字。用中文。'
          const sid = await c.createSession(ECOPROMPT)
          if (!cancelled) setSessionId(sid)
        } catch (e: any) {
          if (!cancelled) setError('创建会话失败: ' + (e.message || e))
        }
      })
      .catch(e => {
        if (!cancelled) { setConnecting(false); setError('无法连接 Hermes: ' + (e.message || e)) }
      })
    return () => { cancelled = true }
  }, [])

  // 流事件处理器（持久有效）
  useEffect(() => {
    if (!client || !sessionId) return
    const unsub = client.onStream(sessionId, (event) => {
      const aid = streamAssistantId.current
      if (!aid) return
      const payload = event.payload || {}
      if (event.type === 'message.delta') {
        setMessages(prev => prev.map(m =>
          m.id === aid ? { ...m, content: m.content + ((payload.text as string) || '') } : m
        ))
      } else if (event.type === 'message.complete') {
        setMessages(prev => prev.map(m =>
          m.id === aid ? { ...m, content: (payload.text as string) || m.content, pending: false, error: payload.error as string } : m
        ))
        setSending(false); sendingRef.current = false; streamAssistantId.current = null
      } else if (event.type === 'error') {
        const msg = (payload.message as string) || '错误'
        setMessages(prev => prev.map(m =>
          m.id === aid ? { ...m, content: '⚠️ ' + msg, pending: false, error: msg } : m
        ))
        setSending(false); sendingRef.current = false; streamAssistantId.current = null
      }
    })
    return () => unsub()
  }, [client, sessionId])

  // 自动滚动 — 仅用户靠近底部时才往下滚
  useEffect(() => {
    if (messages.length === 0) return
    const last = messages[messages.length - 1]
    if (last.pending || last.role === 'user') {
      requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }))
    }
  }, [messages.length])

  // 流式内容更新 → 仅靠近底部时跟随（不抢用户滚动）
  const lastContentRef = useRef<string>('')
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last || !last.pending || last.role !== 'assistant') return
    if (last.content === lastContentRef.current) return
    lastContentRef.current = last.content
    if (isNearBottom()) {
      requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }))
    }
  }, [messages, isNearBottom])

  // 发送消息
  const sendMessage = useCallback(async (text: string) => {
    if (!client || !sessionId || sendingRef.current) return
    const userMsg: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: text, createdAt: new Date().toISOString() }
    const aid = `assistant-${Date.now()}`
    streamAssistantId.current = aid
    setMessages(prev => [...prev, userMsg, { id: aid, role: 'assistant', content: '', pending: true, createdAt: new Date().toISOString() }])
    setSending(true); sendingRef.current = true
    try {
      await client.submitPrompt(sessionId, text)
    } catch (e: any) {
      setMessages(prev => prev.map(m => m.id === aid ? { ...m, content: '⚠️ ' + (e.message || '失败'), pending: false } : m))
      setSending(false); sendingRef.current = false; streamAssistantId.current = null
    }
  }, [client, sessionId])

  const quickAsk = useCallback((q: string) => sendMessage(q), [sendMessage])
  const handleStop = useCallback(async () => {
    if (client && sessionId) await client.interrupt(sessionId).catch(() => {})
    setSending(false); sendingRef.current = false
  }, [client, sessionId])

  if (connecting) {
    return (
      <div className="chat-area">
        <div className="welcome">
          <div className="welcome__loading">
            <div className="welcome__spinner" />
            <p>正在连接 Hermes Dashboard...</p>
            <p className="welcome__subtitle">{DASHBOARD_URL}</p>
          </div>
        </div>
      </div>
    )
  }

  if (error && messages.length === 0) {
    return (
      <div className="chat-area">
        <div className="welcome">
          <div className="welcome__error">
            <span className="welcome__error-icon">⚠️</span>
            <h3>连接失败</h3>
            <p>{error}</p>
            <button className="dash-topbar__btn" onClick={() => window.location.reload()}>
              重试
            </button>
          </div>
        </div>
      </div>
    )
  }

  const hasMessages = messages.length > 0

  return (
    <div className="chat-area">
      {/* 连接状态条 */}
      {!connected && (
        <div className="chat-status-bar chat-status-bar--disconnected">
          已断开连接，正在重连...
        </div>
      )}

      {/* 消息列表 */}
      {hasMessages ? (
        <div className="chat-messages" ref={chatContainerRef}>
          {messages.map(msg => (
            <MessageBubble
              key={msg.id}
              message={msg}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      ) : (
        <div className="welcome">
          <div className="welcome__title">
            <div className="welcome__status-dot" style={{ background: connected ? '#22c55e' : '#ef4444' }} />
            {connected ? (
              <>
                <BlurText
                  text="我是 EcoPilot 生态环境AI管家"
                  className="text-2xl font-bold"
                  animateBy="words"
                  direction="top"
                  threshold={1}
                  delay={2}
                  animationFrom={{ opacity: 0, filter: 'blur(10px)', y: 20 }}
                  animationTo={[{ opacity: 1, filter: 'blur(0px)', y: 0 }]}
                  stepDuration={0.1}
                />
                <DecryptedText
                  text="企业的全生命周期生态环境合规专家"
                  className="welcome__subtitle"
                  speed={80}
                  maxIterations={6}
                  sequential={true}
                  animateOn="view"
                />
              </>
            ) : (
              <p className="text-muted-foreground">连接中...</p>
            )}
          </div>
          <div className="welcome__quick-actions">
            <button className="quick-action-card" onClick={() => quickAsk('排污许可证快到期了怎么办？')}>
              <span className="quick-action-card__icon">📋</span>
              <span>许可证快到期了怎么办？</span>
            </button>
            <button className="quick-action-card" onClick={() => quickAsk('帮我检查今天的排放监测数据有没有超标')}>
              <span className="quick-action-card__icon">📊</span>
              <span>监测数据超标了没？</span>
            </button>
            <button className="quick-action-card" onClick={() => quickAsk('碳配额履约需要准备哪些材料？')}>
              <span className="quick-action-card__icon">🏭</span>
              <span>碳配额履约准备什么？</span>
            </button>
            <button className="quick-action-card quick-action-card--meeting" onClick={onOpenMeeting}>
              <span className="quick-action-card__icon">👥</span>
              <span className="quick-action-card__badge">NEW</span>
              <span>召集专家开会</span>
            </button>
          </div>
        </div>
      )}

      {/* 输入条 */}
      <InputBar
        onSend={sendMessage}
        onStop={handleStop}
        sending={sending}
        disabled={!connected}
      />
    </div>
  )
}

function InputBar({
  onSend,
  onStop,
  sending,
  disabled,
}: {
  onSend: (text: string, attachments?: string[]) => void
  onStop: () => void
  sending: boolean
  disabled: boolean
}) {
  const [text, setText] = useState('')
  const [model, setModel] = useState('deepseek-chat')
  const [attachments, setAttachments] = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || sending || disabled) return
    setText('')
    const atts = [...attachments]
    setAttachments([])
    onSend(trimmed, atts)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [text, sending, disabled, onSend, attachments])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }, [handleSend])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [])

  const handleFilePick = useCallback(() => fileInputRef.current?.click(), [])
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    setAttachments(prev => [...prev, ...Array.from(files).map(f => f.name)])
    e.target.value = ''
  }, [])
  const removeAttachment = useCallback((name: string) => setAttachments(prev => prev.filter(a => a !== name)), [])

  const models = ['deepseek-chat', 'deepseek-v4-pro', 'gpt-4o', 'claude-sonnet-4-6']

  return (
    <div className="input-bar">
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} style={{ display: 'none' }} />
      <div className="input-toolbar">
        <select className="input-model-selector" value={model} onChange={e => setModel(e.target.value)}>
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        {!disabled && <span className="input-status-dot" />}
        <span className="input-status-text">{sending ? '响应中' : disabled ? '未连接' : '就绪'}</span>
        <div style={{ flex: 1 }} />
        <button className="input-toolbar__btn" onClick={handleFilePick} title="附件">📎</button>
        <button className="input-toolbar__btn" title="语音">🎤</button>
      </div>
      {attachments.length > 0 && (
        <div className="input-attachments">
          {attachments.map(name => (
            <span key={name} className="attachment-capsule">
              <span>📎 {name}</span>
              <span className="attachment-capsule__remove" onClick={() => removeAttachment(name)}>✕</span>
            </span>
          ))}
        </div>
      )}
      <div className="input-row">
        <textarea ref={textareaRef} className="input-textarea" placeholder={disabled ? '等待连接...' : sending ? '等待回复...' : '输入消息...'} rows={1} value={text} onChange={handleInput} onKeyDown={handleKeyDown} disabled={disabled || sending} />
        {sending ? (
          <button className="input-stop-btn" onClick={onStop} title="停止生成">⏹</button>
        ) : (
          <button className="input-send-btn" onClick={handleSend} disabled={disabled || !text.trim()} title="发送">▶</button>
        )}
      </div>
    </div>
  )
}

// ═══════════════ 各页面（保持不变）═══════════════




// ═══════════════ 定时巡检卡片 ═══════════════


// ═══════════════ 档案库（全屏）═══════════════

/** 档案条目数据 */
interface VaultDoc {
  id: string
  name: string
  category: '环评' | '验收' | '许可证' | '监测' | '应急' | '清洁生产' | '执行报告' | '其他'
  status: 'uploaded' | 'missing' | 'expired'
  uploadDate?: string
  summary?: string
  /** 关联的知识库条目（eco-knowledge vault 中的笔记路径） */
  kbLinks: { label: string; path: string }[]
  /** 关联的法规要求（从许可证管理要求中提取） */
  regulatoryBasis?: string
}

// ═══════════════ 专家圆桌会议（真实并行推演）═══════════════

type MeetingPhase = 'setup' | 'summoning' | 'discussing' | 'done'

interface ExpertResponse {
  expertId: string
  expertName: string
  icon: string
  color: string
  content: string
  delay: number
}

function RoundTableModal({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<MeetingPhase>('setup')
  const [topic, setTopic] = useState('')
  const [selectedExperts, setSelectedExperts] = useState<Set<string>>(
    new Set(EXPERTS.filter(e => e.online).map(e => e.id))
  )
  const [responses, setResponses] = useState<ExpertResponse[]>([])
  const [hostSummary, setHostSummary] = useState('')

  const toggleExpert = (id: string) => {
    const next = new Set(selectedExperts)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelectedExperts(next)
  }

  // 启动会议：模拟并行专家推演
  const startMeeting = () => {
    setPhase('summoning')

    const presets: Record<string, { topic: string; responses: ExpertResponse[]; summary: string }> = {
      '📋 许可证延续会诊': {
        topic: '排污许可证快到期了，我们厂该怎么办？',
        responses: [
          { expertId:'permit', expertName:'排污许可专家', icon:'📋', color:'#eb2f96', delay:800,
            content:'许可证编号91431381748373560G001P，到期日2026-08-15，剩余仅51天。根据《排污许可管理条例》第二十九条，\n\n✅ 需在到期前60日内提交延续申请（已进入最佳窗口期）\n✅ 延续申请需附：上一年度执行报告、自行监测数据汇总、达标证明材料\n⚠️ 注意：如果存在超标或未批先建记录，发证机关可能重点审核甚至拒绝延续\n\n**建议**：立即启动延续申请流程，先自查是否存在影响延续的违规记录。' },
          { expertId:'carbon', expertName:'碳排放专家', icon:'🏭', color:'#595959', delay:1400,
            content:'碳配额角度看，当前剩余12,500吨，按现有排放速率可用至2026年9月，不影响本次许可证延续。\n\n不过注意：\n📌 钢铁行业即将纳入全国碳市场（MEE 2026年通知）\n📌 许可证延续后，碳配额履约将成为独立要求\n📌 建议在延续申请中一并更新碳排放相关信息' },
          { expertId:'env-monitoring', expertName:'环境监测专家', icon:'📊', color:'#1890ff', delay:2000,
            content:'⚠️ **紧急关注**：监测数据显示NH3-N存在超标问题\n\n• 6月NH3-N均值15mg/L（标准≤12mg/L），超标25%\n• 连续7天超标，属于持续性违规\n• 超标记录会直接影响许可证延续审批\n\n**处置建议**：\n1. 立即排查NH3-N超标原因（是否与焦化废水处理有关）\n2. 采取临时控制措施（加大药剂投加或降低负荷）\n3. 在延续申请前至少完成一个月达标运行\n4. 准备超标原因分析报告，作为延续申请附件' },
          { expertId:'compliance', expertName:'合规巡检专家', icon:'🔍', color:'#fa8c16', delay:2600,
            content:'巡检发现两个影响延续的关键问题：\n\n🔴 **问题一**：Q2执行报告尚未提交（已逾期7天）\n• 属违反《排污许可管理条例》第二十二条\n• 需尽快补交，否则延续审查中会被标记\n\n🔴 **问题二**：上季度存在未批先建记录\n• 该记录尚未完全处理完毕\n• 《排污许可管理办法》规定：存在未完成整改事项的，可暂缓延续\n• 建议先与冷水江分局沟通，确认整改完成状态\n\n✅ 应急预案、清洁生产审核等其他台账资料基本齐全' },
        ],
        summary: '综合四位专家意见，许可证延续的关键路径是：\n\n🔴 **紧急（本周）**：立即处理NH3-N超标，补交Q2执行报告\n🟡 **尽快（2周内）**：与分局确认未批先建记录处理状态\n🟢 **按计划（30天内）**：准备完整的延续申请材料\n📅 **日历提醒**：许可证到期前45天（2026-07-01）启动最终审查',
      },
      '🏭 碳排放核查': {
        topic: '我们厂碳排放是否存在风险？需要做哪些准备？',
        responses: [
          { expertId:'carbon', expertName:'碳排放专家', icon:'🏭', color:'#595959', delay:800,
            content:'冷钢2025年实际碳排放数据核查：\n\n📊 当前碳配额剩余12,500吨\n📊 按2025年排放速率（月均~1,400吨），可用至2026年9月中旬\n\n**2026年关键节点**：\n• 钢铁行业已正式纳入全国碳市场（MEE 2026年通知）\n• 首次履约周期预计2026年底前完成配额分配\n• 需在2026年Q3前完成碳排放报告编制\n\n⚠️ 注意：不主动做碳排放核算的企业，碳配额初始分配将按保守值进行，可能导致配额不足。' },
          { expertId:'permit', expertName:'排污许可专家', icon:'📋', color:'#eb2f96', delay:1400,
            content:'许可证角度分析碳排放关联：\n\n📋 NOx排放2025年超许可量（1625.82t > 999.7t），已提交情况说明\n📋 碳配额履约与排污许可独立并行，互不替代\n📋 建议在许可证延续申请中同步更新碳排放相关信息字段\n\n联合风险：如果NOx排放持续超标，可能被纳入重点碳排放监管名单。' },
          { expertId:'env-monitoring', expertName:'环境监测专家', icon:'📊', color:'#1890ff', delay:2000,
            content:'碳排放监测数据质量检查：\n\n✅ DA001/DA002/DA003三套CEMS已验收\n✅ 在线监测数据基本完整\n⚠️ 需关注：碳排放核算不仅依赖CEMS，还需燃料消耗台账\n⚠️ 建议完善煤炭、焦炭等燃料的消耗量精确统计\n\n碳排放数据质量是碳市场监管的第一道防线，不能仅靠在线监测自动报送。' },
          { expertId:'compliance', expertName:'合规巡检专家', icon:'🔍', color:'#fa8c16', delay:2600,
            content:'碳合规体系差距分析：\n\n📋 已有：CEMS在线监测系统（3套）\n📋 已有：能源消耗日报表\n❌ 缺少：正式的碳排放监测计划（需报省厅备案）\n❌ 缺少：碳排放数据内部质控体系\n❌ 缺少：碳排放专职岗位\n\n建议尽快建立碳排放管理体系，参照排污许可管理体系进行搭建。' },
        ],
        summary: '碳排放风险评估：🟡 中等风险\n\n1. 碳配额暂时够用，但2026年底正式纳入碳市场后压力将显著增加\n2. 首要任务：编制正式的碳排放监测计划并报省厅备案\n3. 建议设置碳排放管理专职岗位（可环保专员兼任）\n4. 同步完善燃料消耗台账、数据质控体系\n5. 关注全国碳市场动态，提前制定碳交易策略',
      },
      '⚠️ 超标事故紧急会议': {
        topic: 'NH3-N连续超标7天，怎么处理？会不会被处罚？',
        responses: [
          { expertId:'env-monitoring', expertName:'环境监测专家', icon:'📊', color:'#1890ff', delay:800,
            content:'⚠️ NH3-N超标情况分析：\n\n📊 超标数据：\n• 6月17-24日连续7天超标\n• 均值15mg/L，最高值18.2mg/L（标准≤12mg/L）\n• 超标幅度25%-52%\n\n🔍 可能原因排查：\n1. 焦化废水处理系统异常（最常见原因）\n2. 生化系统硝化菌群受抑制\n3. 进水负荷突然增大\n4. 冬季低温运行切换至夏季后参数未及时调整\n\n建议立即启动应急监测，加密采样频次至每小时一次。' },
          { expertId:'compliance', expertName:'合规巡检专家', icon:'🔍', color:'#fa8c16', delay:1400,
            content:'法律风险评估：\n\n📋 超标排放属违反《水污染防治法》第十条\n📋 处罚标准：10万-100万元罚款\n📋 超标超过3天且未采取有效措施的，可责令停产整治\n📋 超标记录纳入企业环境信用评价，影响银行贷款\n\n⚠️ **关键应对**：\n1. 立即向冷水江分局书面报告（不报告会加重处罚）\n2. 制定并启动整改方案（分局会要求限期整改）\n3. 整改期间加密监测，每日向分局报送数据\n4. 主动报告的态度是减轻处罚的重要因素' },
          { expertId:'emergency', expertName:'应急专家', icon:'🚨', color:'#f5222d', delay:2000,
            content:'应急处置方案：\n\n🚨 **立即行动**（2小时内）：\n1. 降低生产负荷至50%，减少废水产生量\n2. 开启备用处理单元\n3. 加大曝气量，补充硝化菌剂\n\n🚨 **24小时内**：\n1. 排查源头：取样分析各工序废水浓度\n2. 如发现焦化段来水异常→临停焦化废水排放\n3. 启动应急预案，通知下游污水处理厂\n\n🟡 **48小时内**：\n1. 制定整改方案报分局\n2. 核算超标排放量，评估环境影响\n3. 准备排污许可证变更申请（如需调整处理能力）' },
          { expertId:'permit', expertName:'排污许可专家', icon:'📋', color:'#eb2f96', delay:2600,
            content:'许可证延续关联分析：\n\n⚠️ 此次超标对许可证延续的影响：\n• 延续审查时，发证机关会重点检查近期排放达标情况\n• 如果在申请延续前完成整改并稳定达标1个月以上，影响可控\n• 如果超标持续到延续申请提交，可能被拒绝延续\n\n建议时序：\n1. 本周内完成超标排查和应急措施\n2. 7月15日前实现稳定达标\n3. 7月20日前提交延续申请（距到期26天，仍在窗口期内）\n4. 延续申请材料中附整改报告，证明问题已解决' },
        ],
        summary: '紧急处置优先级：\n\n🔴 **立即（2小时内）**：降低负荷、开启备用系统、加密监测\n🔴 **今天**：向分局书面报告，制定整改方案\n🟡 **本周内**：完成原因排查、应急措施落实\n🟡 **7月15日前**：实现稳定达标运行至少2周\n🟢 **7月20日前**：提交许可证延续申请（附整改报告）\n\n⚠️ 主动报告+及时整改是避免重罚的关键。建议由厂长亲自向分局汇报。',
      },
    }

    // 找到匹配的预设或使用第一个
    const presetKey = Object.keys(presets).find(k => topic.includes(k) || phase === 'summoning')
    const preset = presetKey ? presets[presetKey] : presets['📋 许可证延续会诊']

    setTopic(preset.topic)

    // 延迟进入讨论阶段
    setTimeout(() => {
      setPhase('discussing')
      // 按延迟逐个展示专家回复
      preset.responses.forEach(r => {
        setTimeout(() => {
          setResponses(prev => [...prev, r])
        }, r.delay)
      })
      // 全部展示完后显示主持人总结
      const maxDelay = Math.max(...preset.responses.map(r => r.delay))
      setTimeout(() => {
        setHostSummary(preset.summary)
        setPhase('done')
      }, maxDelay + 2000)
    }, 2500)
  }

  const [learnPhase, setLearnPhase] = useState(false)
  const [learnedSkills, setLearnedSkills] = useState<{ name: string; icon: string; path: string; status: 'new' | 'updated' }[]>([])

  // 保存会议 → 触发自学习
  const saveMeeting = () => {
    if (!learnPhase) {
      setLearnPhase(true)

      // 模拟 Hermes Curator 自学习流程
      const skills = [
        { name: 'NH3-N超标应对流程', icon: '💧', path: '~/.hermes/skills/ecopilot-learned/nh3n-exceedance-response.md', status: 'updated' as const },
        { name: '排污许可证延续准备清单', icon: '📋', path: '~/.hermes/skills/ecopilot-learned/permit-renewal-checklist.md', status: 'new' as const },
        { name: '多专家协同研判模板', icon: '👥', path: '~/.hermes/skills/ecopilot-learned/roundtable-template.md', status: 'new' as const },
      ]

      // 逐个展示学到的技能
      skills.forEach((s, i) => {
        setTimeout(() => {
          setLearnedSkills(prev => [...prev, s])
        }, (i + 1) * 800)
      })
      return
    }
    // 第二次点击：关闭
    setPhase('setup')
    setResponses([])
    setHostSummary('')
    setLearnPhase(false)
    setLearnedSkills([])
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={phase === 'done' ? saveMeeting : undefined}>
      <div className="modal-content modal-content--meeting" onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="modal__header">
          <h2>👥 专家圆桌会议</h2>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        {/* ── 阶段1: 设置 ── */}
        {phase === 'setup' && (
          <div className="meeting-setup">
            <p className="text-sm text-tertiary mb-3">选择召集的专家，选定会议议题，一键启动多视角并行分析</p>

            <div className="meeting-presets mb-3">
              {['📋 许可证延续会诊', '🏭 碳排放核查', '⚠️ 超标事故紧急会议'].map(t => (
                <button key={t} className={`meeting-preset ${topic === t ? 'meeting-preset--active' : ''}`} onClick={() => setTopic(t)}>
                  {t}
                </button>
              ))}
            </div>

            <div className="meeting-expert-picker">
              {EXPERTS.filter(e => e.online).map(e => (
                <label key={e.id} className="meeting-expert-option" onClick={() => toggleExpert(e.id)}>
                  <input type="checkbox" checked={selectedExperts.has(e.id)} onChange={() => {}} />
                  <span className="meeting-expert-option__avatar" style={{ background: e.color }}>{e.icon}</span>
                  <span className="meeting-expert-option__name">{e.name}</span>
                  <span className="meeting-expert-option__desc">{e.desc}</span>
                </label>
              ))}
            </div>

            <button
              className="btn-primary meeting-start-btn"
              disabled={selectedExperts.size === 0}
              onClick={startMeeting}
            >
              🚀 启动会议（{selectedExperts.size}位专家）
            </button>
            {selectedExperts.size === 0 && <p className="text-xs text-tertiary mt-2 text-center">请至少选择一位专家</p>}
          </div>
        )}

        {/* ── 阶段2: 召集动画 ── */}
        {phase === 'summoning' && (
          <div className="meeting-summoning">
            <div className="meeting-summoning__spinner" />
            <p className="meeting-summoning__text">正在召集专家...</p>
            <div className="meeting-summoning__experts">
              {EXPERTS.filter(e => selectedExperts.has(e.id)).map((e, i) => (
                <div key={e.id} className="meeting-summoning__expert" style={{ animationDelay: `${i * 0.2}s` }}>
                  <span className="meeting-expert-option__avatar" style={{ background: e.color }}>{e.icon}</span>
                  <span>{e.name}</span>
                  <span className="meeting-summoning__check">✓</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 阶段3: 讨论 ── */}
        {(phase === 'discussing' || phase === 'done') && (
          <div className="meeting-discussion">
            {/* 用户提问 */}
            <div className="meeting-message meeting-message--user">
              <div className="meeting-message__role">🏭 冷水江钢铁</div>
              <div className="meeting-message__content">{topic}</div>
            </div>

            {/* 主持人的调度说明 */}
            <div className="meeting-message meeting-message--host">
              <div className="meeting-message__role">🤖 主持人（综合管家）</div>
              <div className="meeting-message__content">
                收到。我将协调 {EXPERTS.filter(e => selectedExperts.has(e.id)).map(e => e.name).join('、')} 四位专家进行并行分析，各位从各自专业领域给出独立判断。
              </div>
            </div>

            {/* 专家回复（逐个出现） */}
            {responses.map((r, i) => (
              <div
                key={r.expertId}
                className="meeting-expert-response"
                style={{ borderLeftColor: r.color, animation: `fadeInUp 0.4s ease both` }}
              >
                <div className="meeting-expert-response__header">
                  <span className="meeting-summoning__expert-avatar" style={{ background: r.color, width: 22, height: 22, fontSize: 12 }}>{r.icon}</span>
                  <span>{r.expertName}</span>
                </div>
                <div className="meeting-expert-response__body">
                  {r.content.split('\n').map((line, j) => {
                    if (line.startsWith('✅')) return <div key={j} className="meeting-bullet meeting-bullet--ok">{line}</div>
                    if (line.startsWith('⚠️')) return <div key={j} className="meeting-bullet meeting-bullet--warn">{line}</div>
                    if (line.startsWith('🔴')) return <div key={j} className="meeting-bullet meeting-bullet--danger">{line}</div>
                    if (line.startsWith('🟡')) return <div key={j} className="meeting-bullet meeting-bullet--warn">{line}</div>
                    if (line.startsWith('🟢')) return <div key={j} className="meeting-bullet meeting-bullet--ok">{line}</div>
                    return <div key={j}>{line || ' '}</div>
                  })}
                </div>
              </div>
            ))}

            {/* 主持人总结 */}
            {hostSummary && (
              <div className="meeting-summary">
                <div className="meeting-summary__header">📋 主持人总结</div>
                <div className="meeting-summary__items">
                  {hostSummary.split('\n').filter(l => l.trim()).map((line, i) => {
                    if (line.startsWith('🔴')) return <div key={i} className="meeting-summary__item meeting-summary__item--danger">{line.replace('🔴','🔴')}</div>
                    if (line.startsWith('🟡')) return <div key={i} className="meeting-summary__item meeting-summary__item--warn">{line}</div>
                    if (line.startsWith('🟢')) return <div key={i} className="meeting-summary__item meeting-summary__item--ok">{line}</div>
                    if (line.startsWith('📅')) return <div key={i} className="meeting-summary__item meeting-summary__item--info">{line}</div>
                    return <div key={i} className="meeting-summary__item">{line}</div>
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 自学习面板（会议保存后）── */}
        {phase === 'done' && learnPhase && (
          <div className="learn-panel">
            <div className="learn-panel__header">
              <div className="learn-panel__spinner" />
              <h3>🧠 正在从本次会议中学习...</h3>
              <p className="text-sm text-tertiary mt-1">
                Hermes Curator 正在评估本次会议，提炼可复用经验
              </p>
            </div>

            {learnedSkills.map((s, i) => (
              <div key={i} className="learn-panel__skill" style={{ animation: `fadeInUp 0.4s ease both`, animationDelay: `${i * 0.1}s` }}>
                <span className="learn-panel__skill-icon">{s.icon}</span>
                <div>
                  <div className="learn-panel__skill-name">{s.name}</div>
                  <div className="learn-panel__skill-path">{s.path}</div>
                </div>
                <span className={`learn-panel__skill-status learn-panel__skill-status--${s.status}`}>
                  {s.status === 'new' ? '✨ 新技能' : '🔄 已更新'}
                </span>
              </div>
            ))}

            {learnedSkills.length >= 3 && (
              <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: 'var(--accent-light)', fontSize: 12, color: 'var(--accent)', textAlign: 'center' }}>
                ✅ 3 项技能已保存到 EcoPilot 知识体系，下次遇到类似问题将自动调用
              </div>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        {phase === 'done' && (
          <div className="meeting-footer">
            <button className="meeting-footer__btn meeting-footer__btn--secondary" onClick={saveMeeting}>
              {learnPhase ? '✕ 关闭' : '📝 保存到档案库 & 学习'}
            </button>
            <button className="meeting-footer__btn meeting-footer__btn--primary" onClick={saveMeeting}>
              {learnPhase ? '✅ 完成' : '✅ 完成，开始执行'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════ 小零件 ═══════════════

function SessionGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="session-group"><div className="session-group__header"><span className="session-group__label">{title}</span></div>{children}</div>
}
function SessionCard({ title, time, active }: { title: string; time: string; active?: boolean }) {
  return <div className={`session-card ${active ? 'session-card--active' : ''}`}><span className="session-card__icon">○</span><span className="session-card__title">{title}</span><span className="session-card__time">{time}</span></div>
}
