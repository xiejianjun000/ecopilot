import { useState, useCallback } from 'react'

const MIN_PANEL = 320
const MAX_PANEL = 800
const DEFAULT_PANEL = 380

export function MainLayout() {
  const [activeNav, setActiveNav] = useState('chat')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL)
  const [rightTab, setRightTab] = useState<'memory' | 'diary' | 'assets'>('memory')
  const [meetingOpen, setMeetingOpen] = useState(false)
  const [meetingPhase, setMeetingPhase] = useState<'idle' | 'summoning' | 'discussing' | 'done'>('idle')
  const [createExpertOpen, setCreateExpertOpen] = useState(false)

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = panelWidth
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX
      setPanelWidth(Math.min(MAX_PANEL, Math.max(MIN_PANEL, startW + delta)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [panelWidth])

  const mainContent = () => {
    switch(activeNav) {
      case 'expert':
        return <ExpertPanelView />
      case 'calendar':
        return <CalendarView />
      case 'mail':
        return <MailView />
      case 'links':
        return <LinksView />
      case 'kb':
        return <KnowledgeView />
      case 'connector':
        return <ConnectorView />
      case 'settings':
        return <SettingsView />
      default:
        return <ChatView />
    }
  }

  return (
    <div className="main-layout">
      {/* ── Left Nav ── */}
      <nav className="toolbar-nav">
        {navItems.map(item => (
          <button
            key={item.id}
            className={`toolbar-nav__item ${activeNav === item.id ? 'toolbar-nav__item--active' : ''}`}
            onClick={() => setActiveNav(item.id)}
            title={item.label}
          >
            <span className="toolbar-nav__icon">{item.icon}</span>
            <span className="toolbar-nav__label">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* ── Session Sidebar ── */}
      <aside className={`session-sidebar ${sidebarCollapsed ? 'session-sidebar--collapsed' : ''}`}>
        <div className="session-sidebar__header">
          <button className="new-task-btn" onClick={() => {}}>
            <span>＋</span>
            {!sidebarCollapsed && <span>新建任务</span>}
          </button>
          {!sidebarCollapsed && (
            <div className="search-pill">
              <span className="search-pill__icon">🔍</span>
              <input className="search-pill__input" placeholder="搜索会话..." />
            </div>
          )}
        </div>

        {!sidebarCollapsed && (
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
        )}

        <div className="session-sidebar__footer">
          <button className="user-menu-trigger">
            <div className="user-menu-trigger__avatar">谢</div>
            {!sidebarCollapsed && <span className="user-menu-trigger__name">军哥</span>}
          </button>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="main-content">
        {mainContent()}

        {/* Input Bar (只在对话页显示) */}
        {activeNav === 'chat' && (
          <div className="input-bar">
            <div className="input-toolbar">
              <select className="input-model-selector">
                <option>DeepSeek-Chat</option>
              </select>
              <button className="input-toolbar__btn" title="附件">📎</button>
              <button className="input-toolbar__btn" title="语音">🎤</button>
            </div>
            <div className="input-row">
              <textarea className="input-textarea" placeholder="可以描述任务或提问任何问题..." rows={1} />
              <button className="input-send-btn">▶</button>
            </div>
          </div>
        )}
      </main>

      {/* ── Right Panel ── */}
      {rightPanelOpen && (
        <div className="resize-handle" onMouseDown={handleResizeStart} />
      )}
      {!rightPanelOpen && (
        <button className="panel-toggle" onClick={() => setRightPanelOpen(true)} title="展开面板">◀</button>
      )}
      {rightPanelOpen && (
        <aside className="right-panel" style={{ width: panelWidth }}>
          <div className="right-panel__header">
            <div className="right-panel__tabs">
              {(['memory', 'diary', 'assets'] as const).map(tab => (
                <button
                  key={tab}
                  className={`right-panel__tab ${rightTab === tab ? 'right-panel__tab--active' : ''}`}
                  onClick={() => setRightTab(tab)}
                >
                  {tab === 'memory' ? '记忆' : tab === 'diary' ? '日记' : '资产'}
                </button>
              ))}
            </div>
            <button className="right-panel__collapse" onClick={() => setRightPanelOpen(false)}>✕</button>
          </div>
          <div className="right-panel__content">
            {rightTab === 'memory' && <MemoryPanel />}
            {rightTab === 'diary' && <DiaryPanel />}
            {rightTab === 'assets' && <AssetsPanel />}
          </div>
        </aside>
      )}

      {/* ── Roundtable Meeting Modal ── */}
      {meetingOpen && (
        <div className="modal-overlay" onClick={() => { setMeetingOpen(false); setMeetingPhase('idle') }}>
          <div className="modal-content modal-content--meeting" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2>👥 专家圆桌会议</h2>
              <button className="modal__close" onClick={() => { setMeetingOpen(false); setMeetingPhase('idle') }}>✕</button>
            </div>

            {meetingPhase === 'idle' && (
              <div className="meeting-setup">
                <p className="text-sm text-tertiary mb-3">选择要召集的专家，一键启动多视角并行分析</p>
                <div className="meeting-expert-picker">
                  {experts.filter(e => e.online).map(e => (
                    <label key={e.id} className="meeting-expert-option">
                      <input type="checkbox" defaultChecked />
                      <span className="meeting-expert-option__avatar" style={{ background: e.color }}>{e.icon}</span>
                      <span className="meeting-expert-option__name">{e.name}</span>
                    </label>
                  ))}
                </div>
                <div className="meeting-presets">
                  <button className="meeting-preset" onClick={() => setMeetingPhase('summoning')}>📋 许可证延续会诊</button>
                  <button className="meeting-preset" onClick={() => setMeetingPhase('summoning')}>🏭 碳排放核查</button>
                  <button className="meeting-preset" onClick={() => setMeetingPhase('summoning')}>⚠️ 超标事故紧急会议</button>
                </div>
                <button className="btn-primary meeting-start-btn" onClick={() => setMeetingPhase('summoning')}>
                  🚀 启动会议（6位专家）
                </button>
              </div>
            )}

            {meetingPhase === 'summoning' && (
              <div className="meeting-summoning">
                <div className="meeting-summoning__spinner" />
                <p>正在召集专家...</p>
                <div className="meeting-summoning__experts">
                  {experts.filter(e => e.online).map((e, i) => (
                    <div key={e.id} className="meeting-summoning__expert" style={{ animationDelay: `${i * 0.3}s` }}>
                      <span className="meeting-expert-option__avatar" style={{ background: e.color }}>{e.icon}</span>
                      <span>{e.name}</span>
                      <span className="meeting-summoning__check">✓</span>
                    </div>
                  ))}
                </div>
                <button className="btn-primary mt-3" onClick={() => setMeetingPhase('discussing')}>查看讨论结果</button>
              </div>
            )}

            {meetingPhase === 'discussing' && (
              <div className="meeting-discussion">
                <div className="meeting-message">
                  <div className="meeting-message__role">用户</div>
                  <div className="meeting-message__content">排污许可证快到期了，我们厂该怎么办？</div>
                </div>
                <div className="meeting-expert-response" style={{ borderLeftColor: '#eb2f96' }}>
                  <div className="meeting-expert-response__header"><span className="meeting-expert-option__avatar" style={{ background: '#eb2f96', width: 20, height: 20, fontSize: 12 }}>📋</span> 排污许可专家</div>
                  <div className="meeting-expert-response__body">许可证编号 9143***001P，到期日 2026-08-15（剩余52天）。建议立即启动延续申请流程，到期前60天为最佳申请窗口。</div>
                </div>
                <div className="meeting-expert-response" style={{ borderLeftColor: '#595959' }}>
                  <div className="meeting-expert-response__header"><span className="meeting-expert-option__avatar" style={{ background: '#595959', width: 20, height: 20, fontSize: 12 }}>🏭</span> 碳排放专家</div>
                  <div className="meeting-expert-response__body">当前碳配额剩余12,500吨，按当前排放速率可用至9月，不影响延续申请。</div>
                </div>
                <div className="meeting-expert-response" style={{ borderLeftColor: '#1890ff' }}>
                  <div className="meeting-expert-response__header"><span className="meeting-expert-option__avatar" style={{ background: '#1890ff', width: 20, height: 20, fontSize: 12 }}>📊</span> 环境监测专家</div>
                  <div className="meeting-expert-response__body">⚠️ NH3-N 6月均值 15mg/L（标准12mg/L），已超标。建议先整改NH3-N再申请延续，否则会被重点审核。</div>
                </div>
                <div className="meeting-expert-response" style={{ borderLeftColor: '#fa8c16' }}>
                  <div className="meeting-expert-response__header"><span className="meeting-expert-option__avatar" style={{ background: '#fa8c16', width: 20, height: 20, fontSize: 12 }}>🔍</span> 合规巡检专家</div>
                  <div className="meeting-expert-response__body">⚠️ 上季度有一次未批先建记录，需先处理该记录再提交延续申请。</div>
                </div>
                <div className="meeting-summary">
                  <div className="meeting-summary__header">📋 助手总结</div>
                  <div className="meeting-summary__items">
                    <div className="meeting-summary__item meeting-summary__item--pass">✅ 立即整改 NH3-N 超标</div>
                    <div className="meeting-summary__item meeting-summary__item--pass">✅ 处理未批先建记录</div>
                    <div className="meeting-summary__item meeting-summary__item--pass">✅ 60天内提交延续申请</div>
                    <div className="meeting-summary__item meeting-summary__item--info">📅 已添加日历提醒：许可证到期前45天</div>
                  </div>
                </div>
                <button className="btn-primary mt-3" onClick={() => { setMeetingOpen(false); setMeetingPhase('idle') }}>完成</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Create Expert Modal ── */}
      {createExpertOpen && (
        <div className="modal-overlay" onClick={() => setCreateExpertOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2>🧠 创建专家</h2>
              <button className="modal__close" onClick={() => setCreateExpertOpen(false)}>✕</button>
            </div>
            <div className="create-expert-form">
              <div className="form-step">
                <div className="form-step__indicator">第 1 步 / 共 3 步</div>
                <div className="form-group">
                  <label>助理职称 *</label>
                  <input className="form-input" placeholder="如：碳排放分析师" />
                </div>
                <div className="form-group">
                  <label>角色预设</label>
                  <div className="role-presets">
                    {['前端','资深','小程序','移动','AI','项目经理','UI','测试','文档'].map(r => (
                      <button key={r} className="role-preset-btn">{r}</button>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <label>助理介绍 *</label>
                  <textarea className="form-input form-textarea" placeholder="负责企业碳排放核算与碳资产管理" rows={3} />
                </div>
                <div className="form-group">
                  <label>姓名 *</label>
                  <input className="form-input" placeholder="碳排放分析师" />
                </div>
              </div>
              <div className="form-actions">
                <button className="btn-secondary" onClick={() => setCreateExpertOpen(false)}>取消</button>
                <button className="btn-primary">下一步</button>
              </div>
            </div>
          </div>
        </div>
      )}

  )
}

// ═══════════════════════════════════════
// 视图组件
// ═══════════════════════════════════════

function ChatView() {
  return (
    <div className="chat-area">
      <div className="welcome">
        <div className="welcome__title">
          <h1>我是 <span className="welcome__highlight">EcoPilot 生态环境AI管家</span></h1>
          <p className="welcome__subtitle">企业的全生命周期生态环境合规专家</p>
        </div>
        <div className="welcome__quick-actions">
          <div className="quick-action-card" onClick={() => {}}>
            <span className="quick-action-card__icon">📋</span>
            <span>许可证快到期了怎么办？</span>
          </div>
          <div className="quick-action-card" onClick={() => {}}>
            <span className="quick-action-card__icon">📊</span>
            <span>监测数据超标了没？</span>
          </div>
          <div className="quick-action-card quick-action-card--meeting" onClick={() => setMeetingOpen(true)}>
            <span className="quick-action-card__icon">👥</span>
            <span className="quick-action-card__badge">NEW</span>
            <span>召集专家开会</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ExpertPanelView() {
  return (
    <div className="page-view">
      <div className="page-view__header">
        <h2>🧠 专家面板</h2>
        <button className="btn-primary" onClick={() => setCreateExpertOpen(true)}>＋ 创建专家</button>
      </div>
      <div className="expert-grid">
        {experts.map(e => (
          <div key={e.id} className="expert-card">
            <div className="expert-card__avatar" style={{ background: e.color }}>{e.icon}</div>
            <div className="expert-card__info">
              <div className="expert-card__name">{e.name}</div>
              <div className="expert-card__desc">{e.desc}</div>
            </div>
            <div className={`expert-card__status ${e.online ? 'online' : 'offline'}`} />
          </div>
        ))}
      </div>
      <div className="expert-meeting-section">
        <h3>👥 专家圆桌会议</h3>
        <p className="text-sm text-tertiary mb-3">一键召集相关专家，多视角并行分析</p>
        <div className="meeting-triggers">
          <button className="meeting-trigger">📋 许可证延续会诊</button>
          <button className="meeting-trigger">🏭 碳排放核查会议</button>
          <button className="meeting-trigger">⚠️ 超标事故紧急会议</button>
        </div>
      </div>
    </div>
  )
}

function CalendarView() {
  return (
    <div className="page-view">
      <h2>🗓️ 日历/日程</h2>
      <div className="calendar-placeholder">
        <div className="calendar-header">2026年6月</div>
        <div className="calendar-grid">
          {['一','二','三','四','五','六','日'].map(d => <div key={d} className="calendar-grid__header">{d}</div>)}
          {Array.from({length: 30}, (_, i) => (
            <div key={i} className={`calendar-grid__day ${i === 23 ? 'calendar-grid__day--today' : ''} ${[8,15,22,29].includes(i+1) ? 'calendar-grid__day--event' : ''}`}>
              {i + 1}
              {[8,15,22,29].includes(i+1) && <div className="calendar-grid__dot" />}
            </div>
          ))}
        </div>
        <div className="calendar-events">
          <div className="calendar-event calendar-event--warning">⚠️ 排污许可证到期前60天</div>
          <div className="calendar-event calendar-event--info">📋 季度执行报告截止</div>
        </div>
      </div>
    </div>
  )
}

function MailView() {
  return (
    <div className="page-view">
      <h2>📧 邮箱</h2>
      <div className="mail-list">
        <div className="mail-item mail-item--unread">
          <div className="mail-item__sender">省生态环境厅</div>
          <div className="mail-item__subject">关于2026年第二季度排污许可证执行报告的通知</div>
          <div className="mail-item__time">10:30</div>
        </div>
        <div className="mail-item">
          <div className="mail-item__sender">排污许可管理平台</div>
          <div className="mail-item__subject">许可证延续申请已受理</div>
          <div className="mail-item__time">昨天</div>
        </div>
      </div>
      <button className="btn-primary mt-3" onClick={() => {}}>📝 写信</button>
    </div>
  )
}

function LinksView() {
  const platforms = [
    { name: '全国排污许可证管理信息平台', url: 'https://permit.mee.gov.cn', status: 'ready', icon: '📋' },
    { name: '全国污染源监测信息管理平台', url: 'https://wryjc.cnemc.cn', status: 'ready', icon: '📊' },
    { name: '全国碳排放权交易市场', url: 'https://www.cneex.com', status: 'offline', icon: '🏭' },
    { name: '全国固体废物管理信息系统', url: 'https://gufei.mee.gov.cn', status: 'unknown', icon: '🗑️' },
    { name: '环境影响评价信用平台', url: 'https://xz.china-eia.com', status: 'offline', icon: '📝' },
  ]
  return (
    <div className="page-view">
      <h2>🔗 政务平台</h2>
      <div className="platform-grid">
        {platforms.map((p, i) => (
          <div key={i} className="platform-card">
            <span className="platform-card__icon">{p.icon}</span>
            <span className="platform-card__name">{p.name}</span>
            <span className={`platform-card__status platform-card__status--${p.status}`}>
              {p.status === 'ready' ? '🤖 可填报' : p.status === 'offline' ? '❌ 不可达' : '⚠️ 待确认'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function KnowledgeView() {
  return (
    <div className="page-view">
      <h2>📚 知识库</h2>
      <div className="kb-search">
        <input className="kb-search__input" placeholder="搜索法规、标准、案例..." />
      </div>
      <div className="kb-categories">
        <div className="kb-category">
          <div className="kb-category__title">📜 法律法规</div>
          <div className="kb-category__count">1,284 条</div>
        </div>
        <div className="kb-category">
          <div className="kb-category__title">📏 技术标准</div>
          <div className="kb-category__count">956 条</div>
        </div>
        <div className="kb-category">
          <div className="kb-category__title">📋 典型案例</div>
          <div className="kb-category__count">456 条</div>
        </div>
      </div>
    </div>
  )
}

function ConnectorView() {
  return (
    <div className="page-view">
      <h2>🔌 连接器</h2>
      <div className="connector-list">
        <div className="connector-item connector-item--active">
          <span>🔗 飞书</span>
          <span className="status-badge status-badge--online">已连接</span>
        </div>
        <div className="connector-item connector-item--active">
          <span>🐙 GitHub</span>
          <span className="status-badge status-badge--online">已连接</span>
        </div>
        <div className="connector-item">
          <span>📝 Obsidian</span>
          <span className="status-badge status-badge--offline">未连接</span>
        </div>
      </div>
    </div>
  )
}

function SettingsView() {
  return (
    <div className="page-view">
      <h2>⚙️ 设置</h2>
      <div className="settings-sections">
        <div className="settings-section">
          <h3>账号</h3>
          <div className="settings-row"><span>头像</span><span>谢</span></div>
          <div className="settings-row"><span>企业名称</span><span>冷水江钢铁</span></div>
        </div>
        <div className="settings-section">
          <h3>模型</h3>
          <div className="settings-row"><span>默认模型</span><span>DeepSeek-Chat</span></div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════
// 右侧面板组件
// ═══════════════════════════════════════

function MemoryPanel() {
  return (
    <div className="panel-content">
      <div className="panel-section">
        <h4 className="panel-section__title">📝 当前会话记忆</h4>
        <div className="memory-item">
          <div className="memory-item__key">企业信息</div>
          <div className="memory-item__val">冷水江钢铁 · 黑色金属冶炼</div>
        </div>
        <div className="memory-item">
          <div className="memory-item__key">许可证</div>
          <div className="memory-item__val">91431381***0001P · 2026-08-15到期</div>
        </div>
        <div className="memory-item">
          <div className="memory-item__key">偏好</div>
          <div className="memory-item__val">报告格式偏好：按工序分章节</div>
        </div>
      </div>
      <div className="panel-section">
        <h4 className="panel-section__title">🎯 关键决策记录</h4>
        <div className="memory-item"><div className="memory-item__key">6/24</div><div className="memory-item__val">确定许可证延续需先整改NH3-N</div></div>
      </div>
    </div>
  )
}

function DiaryPanel() {
  return (
    <div className="panel-content">
      <div className="panel-section">
        <div className="diary-calendar-nav">
          <button>◀</button>
          <span>2026年6月</span>
          <button>▶</button>
        </div>
      </div>
      <div className="panel-section">
        <div className="diary-entry">
          <div className="diary-entry__time">14:30</div>
          <div className="diary-entry__content">处理排污许可证延续申请 — 发现NH3-N超标，建议先整改</div>
        </div>
        <div className="diary-entry">
          <div className="diary-entry__time">11:20</div>
          <div className="diary-entry__content">碳排放数据核查 — 碳配额剩余12,500吨，充足</div>
        </div>
      </div>
    </div>
  )
}

function AssetsPanel() {
  return (
    <div className="panel-content">
      <div className="panel-section">
        <h4 className="panel-section__title">📄 报告文档</h4>
        <div className="asset-item">2026Q2排放报告</div>
        <div className="asset-item">许可证延续申请材料</div>
      </div>
      <div className="panel-section">
        <h4 className="panel-section__title">📊 监测数据</h4>
        <div className="asset-item">6月 COD 趋势图</div>
        <div className="asset-item">6月 NH3-N 趋势图</div>
      </div>
      <div className="panel-section">
        <h4 className="panel-section__title">📋 法规资料</h4>
        <div className="asset-item">排污许可管理条例</div>
        <div className="asset-item">大气污染防治法</div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════
// 数据
// ═══════════════════════════════════════

const navItems = [
  { id: 'chat', icon: '💬', label: '对话' },
  { id: 'expert', icon: '🧠', label: '专家' },
  { id: 'calendar', icon: '🗓️', label: '日历' },
  { id: 'mail', icon: '📧', label: '邮箱' },
  { id: 'links', icon: '🔗', label: '政务' },
  { id: 'kb', icon: '📚', label: '知识库' },
  { id: 'connector', icon: '🔌', label: '连接器' },
  { id: 'settings', icon: '⚙️', label: '设置' },
]

const experts = [
  { id: 'ecomind', name: '综合管家', desc: '全链条统筹协调', icon: '🤖', color: '#52c41a', online: true },
  { id: 'permit', name: '排污许可专家', desc: '许可证申领/变更/延续', icon: '📋', color: '#eb2f96', online: true },
  { id: 'carbon', name: '碳排放专家', desc: '碳核算/配额/碳市场', icon: '🏭', color: '#595959', online: true },
  { id: 'env-monitoring', name: '环境监测专家', desc: 'CEMS/自行监测/数据解读', icon: '📊', color: '#1890ff', online: true },
  { id: 'compliance', name: '合规巡检专家', desc: '台账管理/自查自纠', icon: '🔍', color: '#fa8c16', online: true },
  { id: 'emergency', name: '应急专家', desc: '应急预案/隐患排查', icon: '🚨', color: '#f5222d', online: true },
  { id: 'cleaner', name: '清洁生产专家', desc: '清洁生产/绿色工厂', icon: '♻️', color: '#237804', online: false },
]

function SessionGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="session-group">
      <div className="session-group__header"><span className="session-group__label">{title}</span></div>
      {children}
    </div>
  )
}

function SessionCard({ title, time, active }: { title: string; time: string; active?: boolean }) {
  return (
    <div className={`session-card ${active ? 'session-card--active' : ''}`}>
      <span className="session-card__icon">○</span>
      <span className="session-card__title">{title}</span>
      <span className="session-card__time">{time}</span>
    </div>
  )
}
