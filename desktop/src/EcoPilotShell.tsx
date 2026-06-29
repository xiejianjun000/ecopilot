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
import { createHermesClient, SimpleHermesClient, checkBridgeHealth, DASHBOARD_URL, type HermesClient, type ChatMessage } from './hermes-client'
import { $memories, $diaryEntries, $assetsByType, $rightTab, $taskSummaries, type RightTab } from './store/right-panel'
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
  { id: 'ecomind', name: '综合管家', desc: '全链条统筹协调', icon: 'brain', color: '#52c41a', online: true },
  { id: 'permit', name: '排污许可专家', desc: '许可证申领/变更/延续', icon: 'shield-check', color: '#eb2f96', online: true },
  { id: 'carbon', name: '碳排放专家', desc: '碳核算/配额/碳市场', icon: 'building-factory', color: '#595959', online: true },
  { id: 'env-monitoring', name: '环境监测专家', desc: 'CEMS/自行监测/数据解读', icon: 'chart-bar', color: '#1890ff', online: true },
  { id: 'compliance', name: '合规巡检专家', desc: '台账管理/自查自纠', icon: 'search', color: '#fa8c16', online: true },
  { id: 'emergency', name: '应急专家', desc: '应急预案/隐患排查', icon: 'alert-triangle', color: '#f5222d', online: true },
  { id: 'cleaner', name: '清洁生产专家', desc: '清洁生产/绿色工厂', icon: 'refresh', color: '#237804', online: false },
]

// ═══════════════ 主壳 ═══════════════

export function EcoPilotShell() {

  const [activeNav, setActiveNav] = useState<NavId>('dashboard')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL)
  const rightTab = useStore($rightTab)
  const setRightTab = (t: RightTab) => $rightTab.set(t)
  const [meetingOpen, setMeetingOpen] = useState(false)

  useEffect(() => {
    if (!$compliance.get().permit) {
      try { loadDemoCompliance() } catch { /* noop */ }
    }
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

  /* ── 左侧会话栏伸缩 ── */
  const MIN_SIDEBAR = 180
  const MAX_SIDEBAR = 420
  const handleSidebarResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const sX = e.clientX; const sW = sidebarWidth
    const onMove = (ev: MouseEvent) => setSidebarWidth(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, sW + (ev.clientX - sX))))
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [sidebarWidth])

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
      {showSidebar && !sidebarCollapsed && (
        <aside className="session-sidebar" style={{ width: sidebarWidth }}>
          <div className="session-sidebar__header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button className="new-task-btn" style={{ flex: 1 }}><span>＋</span> 新建任务</button>
              <button onClick={() => setSidebarCollapsed(true)}
                style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', flexShrink: 0 }}
                onMouseEnter={e => e.currentTarget.style.background = '#eee'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                title="收起侧栏">{String.fromCharCode(9664)}</button>
            </div>
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
      {showSidebar && sidebarCollapsed && (
        <div style={{ width: 36, flexShrink: 0, background: '#f2f2f2', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0' }}>
          <button onClick={() => setSidebarCollapsed(false)}
            style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}
            onMouseEnter={e => e.currentTarget.style.background = '#e5e7eb'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            title="展开侧栏">{String.fromCharCode(9654)}</button>
          <div style={{ flex: 1 }} />
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#059669', color: '#fff', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>谢</div>
        </div>
      )}

      {/* ── 主内容 ── */}
      <main className="main-content">
        <div style={{ display: activeNav === 'dashboard' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}><DashboardPage onOpenMeeting={() => setMeetingOpen(true)} /></div>
        <div style={{ display: activeNav === 'chat' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}><ChatView onOpenMeeting={() => setMeetingOpen(true)} /></div>
        <div style={{ display: activeNav === 'expert' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}><ExpertsView onOpenMeeting={() => setMeetingOpen(true)} /></div>
        <div style={{ display: activeNav === 'calendar' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}><CalendarView /></div>
        <div style={{ display: activeNav === 'links' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}><LinksView /></div>
        <div style={{ display: activeNav === 'vault' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}><VaultView /></div>
        <div style={{ display: activeNav === 'kb' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}><KnowledgeView /></div>
        <div style={{ display: activeNav === 'connector' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}><ConnectorView /></div>
        <div style={{ display: activeNav === 'settings' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}><SettingsView /></div>
      </main>

      {/* ── 右面板（仪表盘/档案库页隐藏）── */}
      {showSidebar && !sidebarCollapsed && <div className="resize-handle" onMouseDown={handleSidebarResize} style={{ cursor: 'col-resize', width: 4, background: 'transparent', flexShrink: 0 }} />}
      {showSidebar && !sidebarCollapsed && rightPanelOpen && <div className="resize-handle" onMouseDown={handleResize} />}
      {showSidebar && !rightPanelOpen && <button className="panel-toggle" onClick={() => setRightPanelOpen(true)}><Icon name="chevron-left" size={12} /></button>}
      {showSidebar && rightPanelOpen && (
        <aside style={{ width: panelWidth, background: '#f8f9fa', borderLeft: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', height: '100%', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px 0', borderBottom: '1px solid #eee' }}>
            <div style={{ display: 'flex', gap: 0 }}>
              {([
                { key: 'compliance', label: '合规', icon: 'shield-check' },
                { key: 'reports', label: '报告', icon: 'notes' },
                { key: 'summary', label: '总结', icon: 'clipboard' },
                { key: 'browser', label: '浏览器', icon: 'globe' },
              ]).map(t => (
                <button key={t.key} onClick={() => setRightTab(t.key)}
                  style={{
                    padding: '8px 14px', fontSize: 12, fontWeight: rightTab === t.key ? 600 : 400, cursor: 'pointer',
                    border: 'none', background: 'transparent', color: rightTab === t.key ? '#059669' : '#999',
                    borderBottom: rightTab === t.key ? '2px solid #059669' : '2px solid transparent',
                    display: 'flex', alignItems: 'center', gap: 5, marginBottom: -1,
                  }}>
                  <Icon name={t.icon} size={13} color={rightTab === t.key ? '#059669' : '#999'} />
                  {t.label}
                </button>
              ))}
            </div>
            <button onClick={() => setRightPanelOpen(false)}
              style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
              X
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
            {rightTab === 'compliance' && <CompliancePanel />}
            {rightTab === 'reports' && <ReportsPanel />}
            {rightTab === 'summary' && <SummaryPanel />}
            {rightTab === 'browser' && <BrowserPanel />}
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

let _hermesClientPromise: Promise<HermesClient | SimpleHermesClient> | null = null
function ensureClient(): Promise<HermesClient | SimpleHermesClient> {
  if (!_hermesClientPromise) {
    _hermesClientPromise = createHermesClient().then(c => c as HermesClient | SimpleHermesClient).catch(async () => {
      // Dashboard 不可用 → 尝试 HTTP SSE 桥接
      const healthy = await checkBridgeHealth()
      if (healthy) return new SimpleHermesClient()
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
const IconPaperclip = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
const IconMic = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
const IconSend = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
const IconStop = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
const IconEcoLeaf = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.9C15.5 4.9 17 3.5 19 2c1 2 2 4.5 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>

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

  const isUser = message.role === 'user'
  const renderContent = (content: string) =>
    content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code class="chat-msg__code">$1</code>')
      .replace(/\n/g, '<br/>')

  return (
    <div className={`chat-msg ${isUser ? 'chat-msg--user' : 'chat-msg--assistant'}`}>
      <div className={`chat-msg__avatar ${isUser ? 'chat-msg__avatar--user' : 'chat-msg__avatar--ai'}`}>
        {isUser ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        ) : (
          <IconEcoLeaf />
        )}
      </div>
      <div className="chat-msg__body">
        <div className="chat-msg__header">
          <span className="chat-msg__sender">{isUser ? '你' : 'EcoPilot'}</span>
          <span className="chat-msg__time">{timeStr}</span>
          {message.pending && <span className="chat-msg__typing"> 输入中...</span>}
        </div>
        <div className="chat-msg__content">
          {message.imageDataUrl && (
            <img src={message.imageDataUrl} alt="用户图片" className="chat-msg__image" />
          )}
          {message.content ? (
            <div className="chat-msg__text" dangerouslySetInnerHTML={{ __html: renderContent(message.content) }} />
          ) : message.pending ? (
            <span className="chat-msg__cursor">▊</span>
          ) : null}
          {message.error && <div className="chat-msg__error">⚠️ {message.error}</div>}
        </div>
        {!message.pending && !isUser && (
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
          </div>
        )}
      </div>
    </div>
  )
}

function ChatView({ onOpenMeeting }: { onOpenMeeting: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [client, setClient] = useState<HermesClient | SimpleHermesClient | null>(null)
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
          const ECOPROMPT = '你是 EcoPilot，企业生态环境合规AI管家。回答要求：纯中文，不要用 *、#、- 等 markdown 符号，可以用 emoji（✅🔴🟠🟢📋）增强可读性，重点用【】括起。每次对话主动引导企业补充档案资料：环评批复、环保验收、应急预案、危废管理计划、自行监测报告等。'
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
  const sendMessage = useCallback(async (text: string, attachments?: string[]) => {
    if (!client || !sessionId || sendingRef.current) return
    const imageB64 = attachments?.[0]
    const displayText = imageB64 ? (text || '[图片]') : text
    const userMsg: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: displayText, imageDataUrl: imageB64, createdAt: new Date().toISOString() }
    const aid = `assistant-${Date.now()}`
    streamAssistantId.current = aid
    setMessages(prev => [...prev, userMsg, { id: aid, role: 'assistant', content: '', pending: true, createdAt: new Date().toISOString() }])
    setSending(true); sendingRef.current = true
    if (client instanceof SimpleHermesClient) {
      client.sendMessage(text, attachments,
        (delta: string) => setMessages(prev => prev.map(m => m.id === aid ? { ...m, content: m.content + delta } : m)),
        () => { setMessages(prev => prev.map(m => m.id === aid ? { ...m, pending: false } : m)); setSending(false); sendingRef.current = false; streamAssistantId.current = null },
        (err: string) => { setMessages(prev => prev.map(m => m.id === aid ? { ...m, content: '⚠️ ' + err, pending: false } : m)); setSending(false); sendingRef.current = false; streamAssistantId.current = null },
      )
      return
    }
    try {
      await (client as HermesClient).submitPrompt(sessionId, text)
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
          {connected ? (
            <>
              {/* ── EcoPilot 品牌字母动画 + 行业新闻 ── */}
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                padding: '16px 24px 8px', flex: 1, width: '100%', overflow: 'auto',
              }}>
                <BrandLetters />
                <div className="welcome__quick-actions">
                  <button className="quick-action-card" onClick={() => quickAsk('排污许可证快到期了怎么办？')}>
                    <Icon name="shield-check" size={24} />
                    <span className="quick-action-card__text">许可证快到期了怎么办？</span>
                  </button>
                  <button className="quick-action-card" onClick={() => quickAsk('帮我检查今天的排放监测数据有没有超标')}>
                    <Icon name="chart-bar" size={24} />
                    <span className="quick-action-card__text">监测数据超标了没？</span>
                  </button>
                  <button className="quick-action-card" onClick={() => quickAsk('碳配额履约需要准备哪些材料？')}>
                    <Icon name="building-factory" size={24} />
                    <span className="quick-action-card__text">碳配额履约准备什么？</span>
                  </button>
                  <button className="quick-action-card quick-action-card--meeting" onClick={onOpenMeeting}>
                    <Icon name="users" size={24} />
                    <span className="quick-action-card__text">召集专家开会</span>
                    <span className="quick-action-card__badge">NEW</span>
                  </button>
                </div>
                <NewsTicker />
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">连接中...</p>
          )}
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
  const [attachments, setAttachments] = useState<{name: string; dataUrl: string}[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || sending || disabled) return
    setText('')
    const attDataUrls = attachments.map(a => a.dataUrl)
    setAttachments([])
    onSend(trimmed, attDataUrls)
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
    Array.from(files).forEach(f => {
      const reader = new FileReader()
      reader.onload = () => {
        setAttachments(prev => [...prev, { name: f.name, dataUrl: reader.result as string }])
      }
      reader.readAsDataURL(f)
    })
    e.target.value = ''
  }, [])
  const removeAttachment = useCallback((name: string) => setAttachments(prev => prev.filter(a => a.name !== name)), [])

  const models = ['deepseek-chat', 'deepseek-v4-pro', 'gpt-4o', 'claude-sonnet-4-6']

  return (
    <div className="input-bar">
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} style={{ display: 'none' }} />
      {attachments.length > 0 && (
        <div className="input-attachments">
          {attachments.map(a => (
            <span key={a.name} className="attachment-capsule">
              {a.dataUrl.startsWith('data:image/') ? (
                <img src={a.dataUrl} alt={a.name} className="attachment-capsule__thumb" />
              ) : (
                <span>📎</span>
              )}
              <span className="attachment-capsule__name">{a.name}</span>
              <span className="attachment-capsule__remove" onClick={() => removeAttachment(a.name)}>✕</span>
            </span>
          ))}
        </div>
      )}
      <div className="input-row">
        {/* 模型选择 — 左侧 */}
        <select className="input-model-selector" value={model} onChange={e => setModel(e.target.value)} title="切换模型">
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        {/* 输入框 */}
        <textarea ref={textareaRef} className="input-textarea" placeholder={disabled ? '等待连接...' : sending ? '等待回复...' : '输入消息...'} rows={1} value={text} onChange={handleInput} onKeyDown={handleKeyDown} disabled={disabled || sending} />

        {/* 附件 + 语音 - send键左侧并排 */}
        <button className="input-toolbar__btn" onClick={handleFilePick} title="附件"><IconPaperclip /></button>
        <button className="input-toolbar__btn" title="语音"><IconMic /></button>

        {/* 发送/停止 */}
        {sending ? (
          <button className="input-stop-btn" onClick={onStop} title="停止生成"><IconStop /></button>
        ) : (
          <button className="input-send-btn" onClick={handleSend} disabled={disabled || !text.trim()} title="发送"><IconSend /></button>
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

// ═══════════════ 右侧面板组件 ═══════════════

function MemoryPanel() {
  const memories = useStore($memories)
  if (memories.length === 0) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>暂无记忆，开始对话后自动记录</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
      {memories.map((m, i) => (
        <div key={i} style={{ padding: '10px 12px', borderRadius: 8, background: '#f9fafb', fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
          {typeof m === 'string' ? m : m.content || m.text || JSON.stringify(m)}
        </div>
      ))}
    </div>
  )
}

function DiaryPanel() {
  const entries = useStore($diaryEntries)
  if (entries.length === 0) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>暂无日记条目</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
      {entries.map((d, i) => (
        <div key={i} style={{ padding: '10px 12px', borderRadius: 8, background: '#f9fafb', fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
          {typeof d === 'string' ? d : d.content || d.title || JSON.stringify(d)}
        </div>
      ))}
    </div>
  )
}

function AssetsPanel() {
  const assets = useStore($assetsByType)
  const types = Object.keys(assets)
  if (types.length === 0) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>暂无资产文件</div>
  }
  return (
    <div style={{ padding: 12 }}>
      {types.map(t => (
        <div key={t} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 8, textTransform: 'uppercase' }}>{t}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(assets[t] || []).map((a: any, i: number) => (
              <div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: '#f9fafb', fontSize: 12, color: '#374151' }}>
                {typeof a === 'string' ? a : a.name || a.title || JSON.stringify(a)}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ═══════════ 合规 & 报告面板 ═══════════
function CompliancePanel() {
  const [risks, setRisks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetch('http://localhost:8002/api/permit/quick-check', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({session_id:''})
    }).then(r=>r.json()).then(d=>{
      setLoading(false)
      if(d.ok){
        const items:any[]=[]
        if(d.report_status) items.push({level:'FATAL',module:'执行报告',issue:d.report_status,law:'条例§37(三)',time:'逾期'})
        if(d.permit_status) items.push({level:'HIGH',module:'许可申请',issue:d.permit_status,law:'条例§37',time:'补正中'})
        setRisks(items)
      }
    }).catch(()=>{setLoading(false)})
  },[])
  return (
    <div>
      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:12}}>
        <Icon name="shield-check" size={16} color="#059669" />
        <span style={{fontSize:14,fontWeight:600,color:'#333'}}>合规状态</span>
        {risks.length>0&&<span style={{fontSize:10,padding:'1px 6px',borderRadius:3,background:'#dc2626',color:'#fff',marginLeft:'auto'}}>{risks.filter(r=>r.level==='FATAL').length}项紧急</span>}
      </div>
      {loading? (
        <div style={{padding:20,textAlign:'center',color:'#bbb',fontSize:12}}>加载中...</div>
      ) : risks.length===0 ? (
        <div style={{padding:20,textAlign:'center',border:'1px dashed #e5e7eb',borderRadius:8,color:'#bbb'}}>
          <Icon name="shield-check" size={24} />
          <p style={{marginTop:6,fontSize:12}}>暂无合规风险</p>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {risks.map((r,i)=>{
            const isFatal=r.level==='FATAL'
            return (
              <div key={i} style={{padding:'10px 12px',borderRadius:8,background:isFatal?'#fef2f2':'#fffbeb',border:'1px solid '+(isFatal?'#fecaca':'#fde68a'),fontSize:12,lineHeight:1.5}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:3}}>
                  <span style={{fontWeight:600,fontSize:12,color:isFatal?'#dc2626':'#d97706'}}>{isFatal?'Red ':'Amber '}{r.module}</span>
                  <span style={{fontSize:10,padding:'1px 5px',borderRadius:3,background:isFatal?'#fecaca':'#fde68a',color:isFatal?'#dc2626':'#d97706'}}>{r.time}</span>
                </div>
                <div style={{color:'#374151',fontSize:11}}>{r.issue}</div>
                <div style={{color:'#999',fontSize:10,marginTop:2}}>{r.law}</div>
              </div>
            )
          })}
          <div style={{marginTop:8,display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            {[{label:'许可证剩余',value:'47天',color:'#d97706'},{label:'执行报告',value:'2项逾期',color:'#dc2626'},{label:'排放监测',value:'已达标',color:'#059669'},{label:'巡检任务',value:'3个',color:'#2563eb'}].map(s=>(
              <div key={s.label} style={{textAlign:'center',padding:'8px 4px',borderRadius:6,background:'#f9fafb'}}>
                <div style={{fontSize:15,fontWeight:700,color:s.color}}>{s.value}</div>
                <div style={{fontSize:10,color:'#999',marginTop:2}}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ReportsPanel() {
  const [showAll, setShowAll] = useState(false)
  const reports = [
    {name:"2025年12月月报",status:"missing",due:"逾期",date:"2026-01-10"},
    {name:"2025年Q4季报",status:"missing",due:"逾期",date:"2026-01-15"},
    {name:"2025年年报",status:"submitted",due:"已提交",date:"2026-02-28"},
    {name:"2025年Q3季报",status:"submitted",due:"已提交",date:"2025-10-15"},
    {name:"2025年11月月报",status:"submitted",due:"已提交",date:"2025-12-10"},
  ]
  const visible = showAll ? reports : reports.slice(0,3)
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:12}}>
        <Icon name="notes" size={16} color="#059669" />
        <span style={{fontSize:14,fontWeight:600,color:"#333"}}>执行报告</span>
        <span style={{fontSize:10,padding:"1px 6px",borderRadius:3,background:"#fef2f2",color:"#dc2626",marginLeft:"auto"}}>{reports.filter(r=>r.status==="missing").length}项逾期</span>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:4}}>
        {visible.map((r,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:6,background:r.status==="missing"?"#fef2f2":"#f9fafb",border:"1px solid "+(r.status==="missing"?"#fecaca":"#eee")}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:r.status==="missing"?"#dc2626":"#059669",flexShrink:0}} />
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:500,color:"#333"}}>{r.name}</div>
              <div style={{fontSize:10,color:"#999"}}>{r.date}</div>
            </div>
            <span style={{fontSize:10,padding:"2px 6px",borderRadius:3,background:r.status==="missing"?"#fecaca":"#d1fae5",color:r.status==="missing"?"#dc2626":"#059669",whiteSpace:"nowrap"}}>{r.due}</span>
          </div>
        ))}
      </div>
      {reports.length>3&&(
        <button onClick={()=>setShowAll(!showAll)} style={{width:"100%",padding:"6px 0",marginTop:6,border:"1px solid #eee",borderRadius:6,background:"#fff",fontSize:11,color:"#999",cursor:"pointer"}}>
          {showAll?"收起":"查看全部 "+reports.length+" 项"}
        </button>
      )}
      <div style={{marginTop:10,padding:"8px 10px",borderRadius:6,background:"#f0fdf4",border:"1px solid #d1fae5",fontSize:11,color:"#059669",lineHeight:1.5}}>
        登录平台后自动同步最新执行报告状态
      </div>
    </div>
  )
}

function SummaryPanel() {
  const summaries = useStore($taskSummaries)
  const items = summaries.length>0?summaries:[
    {id:"demo1",time:"2026-06-28 14:30",title:"排污许可平台巡检",operations:["检查执行报告状态","检查许可申请状态"],findings:["Q4季报&12月月报逾期","台账记录为0条"],recommendations:["立即补交Q4季报和12月月报"]},
    {id:"demo2",time:"2026-06-28 10:15",title:"自行监测方案审计",operations:["读取卡14监测要求","生成监测日历"],findings:["手工监测频次已标注到日历"],recommendations:["按季度完成手工监测"]},
  ]
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:12}}>
        <Icon name="clipboard" size={16} color="#059669" />
        <span style={{fontSize:14,fontWeight:600,color:"#333"}}>任务总结</span>
        <span style={{fontSize:10,padding:"1px 6px",borderRadius:3,background:"#ecfdf5",color:"#059669",marginLeft:"auto"}}>{items.length}项</span>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {items.map((s,i)=>(
          <div key={s.id||i} style={{padding:12,borderRadius:8,background:"#fff",border:"1px solid #eee",boxShadow:"0 1px 2px rgba(0,0,0,0.03)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <span style={{fontSize:12,fontWeight:600,color:"#333"}}>{s.title}</span>
              <span style={{fontSize:10,color:"#bbb"}}>{s.time}</span>
            </div>
            {s.operations&&s.operations.map((op,j)=><div key={j} style={{fontSize:11,color:"#059669",lineHeight:1.7,paddingLeft:4}}>+ {op}</div>)}
            {s.findings&&s.findings.map((f,j)=><div key={j} style={{fontSize:11,color:"#92400e",lineHeight:1.7,paddingLeft:4}}>! {f}</div>)}
            {s.recommendations&&s.recommendations.map((r,j)=><div key={j} style={{fontSize:11,color:"#374151",lineHeight:1.7,paddingLeft:4}}>{"→"} {r}</div>)}
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════ 行业新闻滚动 ═══════════
const ECO_NEWS = [
  { date:'2026-06-29', title:'生态环境部发布《钢铁行业超低排放改造实施方案（2026-2028）》' },
  { date:'2026-06-28', title:'全国碳市场扩容：水泥、电解铝行业正式纳入碳排放权交易' },
  { date:'2026-06-27', title:'湖南省生态环境厅公布2026年重点排污单位名录，冷钢续列' },
  { date:'2026-06-26', title:'国务院印发《排污许可管理条例》修订草案征求意见稿' },
  { date:'2026-06-25', title:'中钢协：2026年上半年钢铁行业环保投资同比增长23%' },
  { date:'2026-06-24', title:'生态环境部通报2025年全国排污许可执行报告提交情况' },
  { date:'2026-06-23', title:'长江流域重金属污染治理专项督察启动，娄底列入重点' },
  { date:'2026-06-22', title:'工信部发布《工业领域碳达峰实施方案》2026年修订版' },
  { date:'2026-06-21', title:'全国危废管理平台升级，2026年7月起全面启用电子联单' },
  { date:'2026-06-20', title:'钢铁行业EPD（环境产品声明）平台正式上线运行' },
]

function NewsTicker() {
  const [idx, setIdx] = useState(0)
  const [fade, setFade] = useState(true)
  useEffect(() => {
    const t = setInterval(() => {
      setFade(false)
      setTimeout(() => {
        setIdx(p => (p + 1) % ECO_NEWS.length)
        setFade(true)
      }, 400)
    }, 6000)
    return () => clearInterval(t)
  }, [])
  const n = ECO_NEWS[idx]
  return (
    <div style={{
      marginTop: 18, padding: '14px 20px', borderRadius: 12,
      background: '#f0fdf4', border: '1px solid #d1fae5',
      maxWidth: 500, width: '100%', cursor: 'default',
      transition: 'opacity 0.4s', opacity: fade ? 1 : 0.2,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: '#059669', color: '#fff', fontWeight: 500 }}>滚动</span>
        <span style={{ fontSize: 10, color: '#059669' }}>{n.date}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color: '#9CA3AF' }}>{idx + 1}/{ECO_NEWS.length}</span>
      </div>
      <div style={{ fontSize: 13, color: '#065f46', lineHeight: 1.5, fontWeight: 500 }}>{n.title}</div>
    </div>
  )
}

// ═══════════ EcoPilot 品牌字母动画 ═══════════
const LETTERS = 'EcoPilot'
const LETTER_COLORS = ['#059669', '#10b981', '#34d399', '#047857', '#059669', '#10b981', '#34d399', '#047857']

function BrowserPanel() {
  const [url, setUrl] = useState('https://permit.mee.gov.cn')
  const [inputUrl, setInputUrl] = useState('https://permit.mee.gov.cn')
  const [key, setKey] = useState(0)
  const navigate = () => {
    let u = inputUrl.trim()
    if (u && !u.startsWith('http')) u = 'https://' + u
    if (u) { setUrl(u); setKey(p => p + 1) }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 4, padding: '6px 0 8px' }}>
        <input value={inputUrl} onChange={e => setInputUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && navigate()}
          placeholder="输入网址..."
          style={{ flex: 1, padding: '5px 8px', borderRadius: 4, border: '1px solid #e5e7eb', fontSize: 11, outline: 'none' }} />
        <button onClick={navigate}
          style={{ padding: '5px 8px', borderRadius: 4, border: 'none', background: '#059669', color: '#fff', fontSize: 11, cursor: 'pointer' }}>GO</button>
      </div>
      <div style={{ flex: 1, borderRadius: 4, overflow: 'hidden', border: '1px solid #e5e7eb', background: '#fff' }}>
        <iframe key={key} src={url} style={{ width: '100%', height: '100%', border: 'none' }} sandbox="allow-scripts allow-forms allow-same-origin" />
      </div>
    </div>
  )
}

function BrandLetters() {
  const [phase, setPhase] = useState(0)
  const [activeIdx, setActiveIdx] = useState(-1)

  useEffect(() => {
    const t1 = setInterval(() => {
      setActiveIdx(prev => {
        const next = prev + 1
        return next >= LETTERS.length ? LETTERS.length - 1 : next
      })
    }, 400)
    const t2 = setInterval(() => {
      setPhase(p => (p + 1) % 3)
    }, 4000)
    return () => { clearInterval(t1); clearInterval(t2) }
  }, [])

  const taglines = [
    { sub: '生态环境AI合规管家', desc: '企业的全生命周期生态环境合规专家' },
    { sub: '全国排污许可平台深度对接', desc: '自动巡检 · 实时预警 · 智能诊断' },
    { sub: '越用越聪明的专属AI专家', desc: '每次对话自动沉淀 · 持续学习企业合规知识' },
  ]
  const t = taglines[phase]

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
      marginBottom: 32,
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: 20, marginBottom: 6,
        background: 'linear-gradient(135deg, #059669, #10b981)',
        boxShadow: '0 12px 40px rgba(5,150,105,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 34, color: '#fff',
      }}>
          <IconEcoLeaf />
        </div>

      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        {Array.from(LETTERS).map((ch, i) => (
          <span key={i} style={{
            fontSize: i <= activeIdx ? 48 : 32,
            fontWeight: i <= activeIdx ? 700 : 300,
            color: i <= activeIdx ? LETTER_COLORS[i] : '#d1d5db',
            transition: 'all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
            fontFamily: "'Inter','SF Pro Display',-apple-system,BlinkMacSystemFont,sans-serif",
            letterSpacing: i <= activeIdx ? '0.02em' : '0.01em',
            opacity: i <= activeIdx ? 1 : 0.3,
            transform: i <= activeIdx ? 'translateY(0)' : 'translateY(4px)',
          }}>
            {ch}
          </span>
        ))}
      </div>

      <div style={{ textAlign: 'center' }}>
        <div key={`s-${phase}`} style={{
          fontSize: 18, fontWeight: 600, color: '#059669', marginBottom: 6,
          animation: 'bfs 0.5s ease-out',
        }}>{t.sub}</div>
        <div key={`d-${phase}`} style={{
          fontSize: 13, color: '#9CA3AF', lineHeight: 1.5,
          animation: 'bfs 0.5s ease-out 0.15s both',
        }}>{t.desc}</div>
      </div>

      <style>{`
        @keyframes bfs { 0%{opacity:0;transform:translateY(8px)} 100%{opacity:1;transform:translateY(0)} }
      `}</style>
    </div>
  )
}
