/**
 * Dashboard v2 — 合规态势仪表盘（行业通用）
 * 参考 Tremor + Ant Design Pro 设计模式
 * 数据来源: $compliance + $monitoringTasks + $ledgerRecords + $schedules
 */
import { useStore } from '@nanostores/react'
import { useMemo } from 'react'
import { $compliance, $permitDaysRemaining, $permitExpiryStatus, $hasUrgentItems } from '../store/permit'
import { $monitoringTasks, getMonitorStats } from '../store/monitoring'
import { $ledgerRecords, LEDGER_META, getLedgerMissingCount, getLedgerCompletionRate, type LedgerType } from '../store/ledger'
import { $schedules } from '../store/schedules'
import { $inspectionTasks, getInspectionStats, getOverdueTasks, SOURCE_LABELS } from '../store/inspection'
import { Icon } from '../../../components/ui/icon'
import CountUp from '../../../components/react-bits/TextAnimations/CountUp/CountUp'
import FadeContent from '../../../components/react-bits/Animations/FadeContent/FadeContent'
import type { PermitInfo } from '../lib/permit-parser'

const A = '#059669' // accent green

export function DashboardPage() {
  const compliance = useStore($compliance)
  const daysRemaining = useStore($permitDaysRemaining)
  const expiryStatus = useStore($permitExpiryStatus)
  const hasUrgent = useStore($hasUrgentItems)
  const monitorTasks = useStore($monitoringTasks)
  const ledgerRecords = useStore($ledgerRecords)
  const schedules = useStore($schedules)
  const inspectionTasks = useStore($inspectionTasks)
  const monitorStats = getMonitorStats()
  const inspectionStats = getInspectionStats()
  const ledgerMissing = getLedgerMissingCount()
  const ledgerRate = getLedgerCompletionRate()
  const permit = compliance.permit

  if (!permit) {
    return (
      <div className="dash-page" style={{ display:'flex',alignItems:'center',justifyContent:'center' }}>
        <div style={{ textAlign:'center' }}>
          <div style={{ width:48,height:48,borderRadius:'50%',border:'3px solid #e5e7eb',borderTopColor:A,animation:'pr-spin 0.7s linear infinite',margin:'0 auto 16px' }} />
          <p style={{ fontSize:14, color:'#6B7280' }}>正在加载许可证数据...</p>
        </div>
        <style>{`@keyframes pr-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  const today = new Date().toLocaleDateString('zh-CN', { year:'numeric', month:'long', day:'numeric', weekday:'long' })
  const todayStr = new Date().toISOString().split('T')[0]
  const outlets = permit.emissionOutlets || []
  const airOutlets = outlets.filter(o => o.code?.startsWith('DA'))
  const waterOutlets = outlets.filter(o => o.code?.startsWith('DW'))

  // ─── 合规五维评分（从现有数据推算） ───
  const complianceScores = useMemo(() => {
    const permitOk = daysRemaining > 90 ? 100 : daysRemaining > 30 ? 65 : daysRemaining > 0 ? 30 : 0
    const reapplyPending = permit.reapplicationHistory?.find(r => r.status === '补正')
    const permitScore = reapplyPending ? Math.min(permitOk, 50) : permitOk

    const hasAlerts = compliance.emissionAlerts?.length > 0
    const monitorScore = hasAlerts ? 60 : monitorStats.daily > 0 ? 90 : 70

    const ledgerScore = ledgerMissing === 0 ? 100 : ledgerMissing <= 2 ? 60 : 20

    const reportOk = !permit.executionReportStatus?.includes('待补') && !permit.executionReportStatus?.includes('逾期')
    const reportScore = reportOk ? 80 : 50

    const emergencyScore = 80 // 无实时数据，默认正常

    return [
      { label:'许可', key:'permit', score:permitScore, color:'#059669' },
      { label:'监测', key:'monitor', score:monitorScore, color:'#2563eb' },
      { label:'台账', key:'ledger', score:ledgerScore, color:'#d97706' },
      { label:'报告', key:'report', score:reportScore, color:'#7c3aed' },
      { label:'应急', key:'emergency', score:emergencyScore, color:'#0891b2' },
    ]
  }, [daysRemaining, compliance.emissionAlerts, monitorStats.daily, ledgerMissing, permit.executionReportStatus, permit.reapplicationHistory])

  // ─── 今日提醒 ───
  const todayAlerts = useMemo(() => {
    const alerts: { level:'urgent'|'warn'; icon:string; title:string; desc:string }[] = []

    // 许可证即将到期
    if (daysRemaining <= 30 && daysRemaining > 0) {
      alerts.push({ level:'urgent', icon:'🔴', title:`排污许可证 ${daysRemaining} 天后到期`,
        desc:`有效期至 ${permit.validTo}，请立即启动延续程序` })
    }

    // 补正申请
    const reapplyPending = permit.reapplicationHistory?.find(r => r.status === '补正')
    if (reapplyPending) {
      alerts.push({ level:'warn', icon:'⚠️', title:'重新申请材料需补正',
        desc:`提交于 ${reapplyPending.date}，请尽快补充材料` })
    }

    // 台账待补
    if (ledgerMissing > 0) {
      const missingTypes = ledgerRecords.filter(r => r.status !== 'completed').map(r => LEDGER_META[r.type].label).join('、')
      alerts.push({ level:'warn', icon:'📋', title:`${ledgerMissing} 类台账待补录`,
        desc:`${missingTypes}` })
    }

    // 今日日程
    const todaySchedules = schedules.filter(s => s.enabled && s.date === todayStr && !s.completedAt)
    for (const s of todaySchedules) {
      alerts.push({ level:'warn', icon:'📅', title:s.title, desc:s.description || s.date })
    }

    return alerts
  }, [daysRemaining, permit.validTo, permit.reapplicationHistory, ledgerMissing, ledgerRecords, schedules, todayStr])

  // ─── 合规日历事件（本周 + 临近） ───
  const calendarEvents = useMemo(() => {
    const events: { date:string; title:string; level:'urgent'|'warn'|'normal'; desc:string }[] = []
    const now = new Date()
    const nextWeek = new Date(now)
    nextWeek.setDate(now.getDate() + 7)

    // 许可证到期
    if (permit.validTo) {
      const dd = Math.ceil((new Date(permit.validTo).getTime() - now.getTime()) / 86400000)
      events.push({ date:permit.validTo, title:'许可证到期', level:dd <= 30 ? 'urgent' : dd <= 90 ? 'warn' : 'normal',
        desc: dd <= 0 ? '已过期！' : `剩余 ${dd} 天` })
    }

    // 执行报告
    const y = now.getFullYear()
    const qDates = [{ d:`${y}-03-31`, q:'Q1' },{ d:`${y}-06-30`, q:'Q2' },{ d:`${y}-09-30`, q:'Q3' },{ d:`${y}-12-31`, q:'Q4' }]
    for (const q of qDates) {
      const dd = Math.ceil((new Date(q.d).getTime() - now.getTime()) / 86400000)
      if (dd >= 0 && dd <= 60) events.push({ date:q.d, title:`${q.q}执行报告截止`, level:dd <= 7 ? 'urgent' : 'warn', desc:'HJ 944 §5.4' })
    }

    // 台账周检
    const dayOfWeek = now.getDay() || 7
    const fri = new Date(now)
    fri.setDate(now.getDate() + (5 - dayOfWeek))
    if (fri >= now && fri <= nextWeek) {
      events.push({ date: fri.toISOString().split('T')[0], title:'台账周检提醒',
        level: ledgerMissing > 0 ? 'warn' : 'normal', desc:`${ledgerMissing > 0 ? ledgerMissing + ' 类待补' : '全部完成'}` })
    }

    // 自定义日程（本周）
    for (const s of schedules) {
      if (s.enabled && s.date >= todayStr && s.date <= nextWeek.toISOString().split('T')[0]) {
        events.push({ date:s.date, title:s.title, level:'normal', desc:s.description || '' })
      }
    }

    return events.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8)
  }, [permit.validTo, schedules, todayStr, ledgerMissing])

  // ─── 排放口状态推算 ───
  const outletOnline = useMemo(() => {
    const hasCEMS = monitorTasks.filter(t => t.frequency === 'daily' && t.facility === '自动').length
    return { total: outlets.length, cems: hasCEMS }
  }, [outlets, monitorTasks])

  return (
    <div className="dash-page">
      {/* ═══ 顶部企业信息条 ═══ */}
      <div className="dash-topbar">
        <div>
          <div className="dash-topbar__title">
            <Icon name="building-factory" size={18} /> {permit.enterpriseName}
          </div>
          <div className="dash-topbar__meta">
            {today} · 信用代码 {permit.creditCode} · {permit.managementLevel}
            {permit.industryCategory && <span style={{ marginLeft:6 }}>· {permit.industryCategory}</span>}
            {hasUrgent && <span className="tag tag--danger" style={{ marginLeft:8 }}><Icon name="alert-triangle" size={12} /> 需关注</span>}
          </div>
        </div>
      </div>

      {/* ═══ KPI 五卡片 ═══ */}
      <FadeContent duration={400} blur>
        <div className="dash-kpi-row dash-kpi-row--5col">
          {/* ① 许可证 */}
          <div className={`dash-kpi ${daysRemaining <= 30 ? 'dash-kpi--danger' : daysRemaining <= 90 ? 'dash-kpi--warn' : 'dash-kpi--ok'}`}>
            <div className="dash-kpi__icon"><Icon name="calendar-due" size={20} /></div>
            <div className="dash-kpi__body">
              <div className="dash-kpi__value">
                {daysRemaining <= 0 ? '已到期' : <><CountUp to={daysRemaining} duration={2} separator="" /> 天</>}
              </div>
              <div className="dash-kpi__label">许可证剩余有效期</div>
              <div className="dash-kpi__trend">
                {expiryStatus === 'expired' ? <span className="dash-kpi__trend--down">🔴 已到期</span>
                 : expiryStatus === 'urgent' ? <span className="dash-kpi__trend--down">⚠️ 即将到期</span>
                 : <span className="dash-kpi__trend--flat">✅ 正常</span>}
              </div>
            </div>
            <div className="dash-kpi__bar-track">
              <div className="dash-kpi__bar-fill" style={{ width:`${Math.max(0, Math.min(100, daysRemaining / 1825 * 100))}%` }} />
            </div>
          </div>

          {/* ② 待处理 */}
          <div className={`dash-kpi ${compliance.pendingCount > 0 ? 'dash-kpi--danger' : 'dash-kpi--ok'}`}>
            <div className="dash-kpi__icon"><Icon name="alert-circle" size={20} /></div>
            <div className="dash-kpi__body">
              <div className="dash-kpi__value"><CountUp to={compliance.pendingCount} duration={1.5} separator="" /></div>
              <div className="dash-kpi__label">
                待处理事项
                {compliance.urgentCount > 0 && <span className="dash-kpi__alert-badge dash-kpi__alert-badge--danger" style={{ marginLeft:6 }}>
                  {compliance.urgentCount} 紧急</span>}
              </div>
            </div>
          </div>

          {/* ③ 监测 */}
          <div className={`dash-kpi ${compliance.emissionAlerts?.length > 0 ? 'dash-kpi--danger' : 'dash-kpi--ok'}`}>
            <div className="dash-kpi__icon"><Icon name="chart-bar" size={20} /></div>
            <div className="dash-kpi__body">
              <div className="dash-kpi__value">
                {monitorStats.daily > 0 ? <><CountUp to={monitorStats.daily} duration={1.5} separator="" /> 路</> : '—'}
              </div>
              <div className="dash-kpi__label">
                在线监测
                {compliance.emissionAlerts?.length > 0
                  ? <span className="dash-kpi__alert-badge dash-kpi__alert-badge--danger" style={{ marginLeft:6 }}>{compliance.emissionAlerts.length} 告警</span>
                  : <span className="dash-kpi__trend--flat" style={{ marginLeft:6, fontSize:11 }}>🟢 正常</span>}
              </div>
            </div>
          </div>

          {/* ④ 台账 */}
          <div className={`dash-kpi ${ledgerMissing >= 3 ? 'dash-kpi--danger' : ledgerMissing > 0 ? 'dash-kpi--warn' : 'dash-kpi--ok'}`}>
            <div className="dash-kpi__icon"><Icon name="notes" size={20} /></div>
            <div className="dash-kpi__body">
              <div className="dash-kpi__value">{ledgerRate}%</div>
              <div className="dash-kpi__label">本周台账完成率</div>
              <div className="dash-kpi__trend">
                {ledgerMissing === 0 ? <span className="dash-kpi__trend--flat">✅ 全部完成</span>
                 : <span className="dash-kpi__trend--down">⚠️ {ledgerMissing}/5 类待补</span>}
              </div>
            </div>
            <div className="dash-kpi__bar-track">
              <div className="dash-kpi__bar-fill" style={{ width:`${ledgerRate}%`, background: ledgerRate >= 80 ? 'var(--success)' : ledgerRate >= 40 ? 'var(--warning)' : 'var(--danger)' }} />
            </div>
          </div>

          {/* ⑤ 合规快照 */}
          <div className="dash-kpi dash-kpi--ok">
            <div className="dash-kpi__icon"><Icon name="shield-check" size={20} /></div>
            <div className="dash-kpi__body">
              <div className="dash-kpi__value">
                {Math.round(complianceScores.reduce((s, d) => s + d.score, 0) / complianceScores.length)}<span style={{fontSize:14,fontWeight:400}}>/100</span>
              </div>
              <div className="dash-kpi__label">合规综合评分</div>
              <div className="dash-compliance-bar">
                {complianceScores.map(s => (
                  <div key={s.key} className="dash-compliance-bar__seg"
                    style={{ flex: s.score, background: s.score >= 80 ? s.color : s.score >= 50 ? 'var(--warning)' : 'var(--danger)' }}
                    title={`${s.label}: ${s.score}分`} />
                ))}
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', marginTop:4, fontSize:9, color:'var(--text-tertiary)' }}>
                {complianceScores.map(s => <span key={s.key}>{s.label}</span>)}
              </div>
            </div>
          </div>
        </div>
      </FadeContent>

      {/* ═══ 主体: 左 3/5 + 右 2/5 ═══ */}
      <div className="dash-main">
        {/* ─── 左列 ─── */}
        <div className="dash-main__left">
          {/* 📅 合规日历 */}
          <FadeContent duration={500} delay={100} blur>
            <div className="dash-card">
              <div className="dash-card__hd">
                <h3><Icon name="calendar-event" size={15} /> 合规日历</h3>
                <span className="dash-card__badge" style={{ color:'var(--text-tertiary)' }}>本周+临近 {calendarEvents.length} 项</span>
              </div>
              {calendarEvents.length === 0 ? (
                <div className="dash-empty-hint">✅ 近期无合规事项到期</div>
              ) : (
                <div className="dash-timeline">
                  {calendarEvents.map((ev, i) => {
                    const isToday = ev.date === todayStr
                    return (
                      <div key={i} className={`dash-timeline__item ${ev.level === 'urgent' ? 'dash-timeline__item--urgent' : ev.level === 'warn' ? 'dash-timeline__item--warn' : ''}`}>
                        <div className="dash-timeline__dot" />
                        <div>
                          <strong>{ev.title}</strong>
                          <span className="text-muted" style={{ marginLeft:8, fontSize:11 }}>{ev.date}{isToday ? ' · 今天' : ''}</span>
                          {ev.desc && <div style={{ fontSize:11, color:'var(--text-tertiary)' }}>{ev.desc}</div>}
                        </div>
                        <span className={`tag ${ev.level === 'urgent' ? 'tag--danger' : ev.level === 'warn' ? 'tag--warn' : 'tag--ok'}`}>
                          {ev.level === 'urgent' ? '紧急' : ev.level === 'warn' ? '关注' : '正常'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </FadeContent>

          {/* 🟢🟡🔴 合规五维快照 */}
          <FadeContent duration={500} delay={200} blur>
            <div className="dash-card">
              <div className="dash-card__hd">
                <h3><Icon name="shield-check" size={15} /> 合规五维快照</h3>
                <span className="dash-card__badge" style={{ color:'var(--text-tertiary)' }}>
                  综合 {Math.round(complianceScores.reduce((s, d) => s + d.score, 0) / complianceScores.length)} 分
                </span>
              </div>
              {complianceScores.map(s => (
                <div key={s.key} style={{ marginBottom:10 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:4 }}>
                    <span style={{ fontWeight:500 }}>{s.label}</span>
                    <span style={{ color: s.score >= 80 ? s.color : s.score >= 50 ? 'var(--warning)' : 'var(--danger)', fontWeight:600 }}>
                      {s.score} 分 · {s.score >= 80 ? '🟢 正常' : s.score >= 50 ? '🟡 关注' : '🔴 异常'}
                    </span>
                  </div>
                  <div className="dash-progress-bar" style={{ height:6, marginBottom:0 }}>
                    <div className="dash-progress-bar__fill" style={{ width:`${s.score}%`, background: s.score >= 80 ? s.color : s.score >= 50 ? 'var(--warning)' : 'var(--danger)' }} />
                  </div>
                </div>
              ))}
            </div>
          </FadeContent>
        </div>

        {/* ─── 右列 ─── */}
        <div className="dash-main__right">
          {/* 📋 许可证摘要 */}
          <FadeContent duration={500} delay={150} blur>
            <div className="dash-card">
              <div className="dash-card__hd"><h3><Icon name="shield-check" size={15} /> 许可证</h3></div>
              <div style={{ display:'flex', flexDirection:'column', gap:6, fontSize:12 }}>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <span style={{ color:'var(--text-tertiary)' }}>编号</span>
                  <span style={{ fontWeight:500, fontFamily:'var(--font-mono)', fontSize:11 }}>{permit.permitNumber || '—'}</span>
                </div>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <span style={{ color:'var(--text-tertiary)' }}>有效期</span>
                  <span style={{ fontWeight:500 }}>{permit.validFrom || '—'} → <strong>{permit.validTo || '—'}</strong></span>
                </div>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <span style={{ color:'var(--text-tertiary)' }}>行业</span>
                  <span style={{ fontWeight:500 }}>{permit.industryCategory || '—'}</span>
                </div>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <span style={{ color:'var(--text-tertiary)' }}>管理类别</span>
                  <span className="tag tag--warn">{permit.managementLevel}</span>
                </div>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <span style={{ color:'var(--text-tertiary)' }}>排放口</span>
                  <span style={{ fontWeight:500 }}>废气 {airOutlets.length} · 废水 {waterOutlets.length}</span>
                </div>
                {permit.city && (
                  <div style={{ display:'flex', justifyContent:'space-between' }}>
                    <span style={{ color:'var(--text-tertiary)' }}>所在地</span>
                    <span style={{ fontWeight:500, fontSize:11 }}>{permit.province} {permit.city} {permit.county}</span>
                  </div>
                )}
              </div>
            </div>
          </FadeContent>

          {/* 🔔 今日提醒 */}
          <FadeContent duration={500} delay={250} blur>
            <div className="dash-card">
              <div className="dash-card__hd">
                <h3><Icon name="bell" size={15} /> 今日提醒</h3>
                <span className="dash-card__badge" style={{ color:'var(--text-tertiary)' }}>{todayAlerts.length} 项</span>
              </div>
              {todayAlerts.length === 0 ? (
                <div className="dash-empty-hint">✅ 今日无紧急提醒</div>
              ) : (
                todayAlerts.map((a, i) => (
                  <div key={i} className={`dash-alert-item ${a.level === 'urgent' ? 'dash-alert-item--urgent' : 'dash-alert-item--warn'}`}>
                    <div className="dash-alert-item__icon">{a.icon}</div>
                    <div className="dash-alert-item__body">
                      <div className="dash-alert-item__title">{a.title}</div>
                      <div className="dash-alert-item__desc">{a.desc}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </FadeContent>

          {/* 📊 排放口状态 */}
          <FadeContent duration={500} delay={350} blur>
            <div className="dash-card">
              <div className="dash-card__hd">
                <h3><Icon name="chart-bar" size={15} /> 排放口状态</h3>
                <span className="dash-card__badge" style={{ color:'var(--text-tertiary)' }}>
                  {outlets.length} 个排放口
                </span>
              </div>
              <div className="dash-outlet-ring">
                <div className="dash-outlet-ring__circle">
                  {outlets.length}
                  <span className="dash-outlet-ring__label">总计</span>
                </div>
                <div className="dash-outlet-ring__detail">
                  <div>🟢 废气排放口: {airOutlets.length} 个</div>
                  <div>🟢 废水排放口: {waterOutlets.length} 个</div>
                  {outletOnline.cems > 0 && <div style={{ marginTop:2 }}>📡 CEMS在线: {outletOnline.cems} 路</div>}
                </div>
              </div>
              {/* 排放口限值简要列表 */}
              <div style={{ marginTop:8, borderTop:'1px solid var(--border-secondary)', paddingTop:8 }}>
                {outlets.slice(0, 5).map(o => (
                  <div key={o.code} style={{ display:'flex', justifyContent:'space-between', fontSize:11, padding:'3px 0' }}>
                    <span style={{ color:'var(--text-primary)' }}>{o.code} {o.name?.slice(0, 12)}</span>
                    <span style={{ color:'var(--text-tertiary)' }}>
                      {(o.limits || []).slice(0, 2).map(l => l.factor).join('、')}
                    </span>
                  </div>
                ))}
                {outlets.length > 5 && <div style={{ fontSize:10, color:'var(--text-tertiary)', textAlign:'center', paddingTop:4 }}>...还有 {outlets.length - 5} 个排放口</div>}
              </div>
            </div>
          </FadeContent>

          {/* 📋 督察整改概览 */}
          {inspectionStats.total > 0 && (
            <FadeContent duration={500} delay={450} blur>
              <div className="dash-card">
                <div className="dash-card__hd">
                  <h3><Icon name="clipboard" size={15} /> 督察整改概览</h3>
                  <span className="dash-card__badge" style={{color:'var(--text-tertiary)'}}>
                    {inspectionStats.completed}/{inspectionStats.total} 完成
                  </span>
                </div>
                {/* 按来源进度条 */}
                {(['central','provincial','mee','special','self_check'] as const).map(src => {
                  const d = inspectionStats.bySource[src]
                  if (!d || d.total === 0) return null
                  const meta = SOURCE_LABELS[src]
                  const pct = d.total > 0 ? Math.round(d.completed / d.total * 100) : 0
                  return (
                    <div key={src} style={{ marginBottom: 8 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, marginBottom:3 }}>
                        <span style={{ color: meta.color }}>{meta.icon} {meta.label}</span>
                        <span style={{ color:'var(--text-tertiary)' }}>{d.completed}/{d.total} · {pct}%</span>
                      </div>
                      <div className="dash-progress-bar" style={{ height:5, marginBottom:0 }}>
                        <div className="dash-progress-bar__fill" style={{ width:`${pct}%`, background: meta.color }} />
                      </div>
                    </div>
                  )
                })}
                {inspectionStats.overdue > 0 && (
                  <div style={{ marginTop:10, paddingTop:8, borderTop:'1px solid var(--border-secondary)' }}>
                    <div style={{ fontSize:11, color:'var(--danger)', fontWeight:500, marginBottom:4 }}>
                      🔴 {inspectionStats.overdue} 项任务已逾期
                    </div>
                    {getOverdueTasks().slice(0,2).map(t => (
                      <div key={t.id} style={{ fontSize:10, color:'var(--text-tertiary)', padding:'2px 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        · {t.title}（{t.deadline.slice(5)}）
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </FadeContent>
          )}
        </div>
      </div>
    </div>
  )
}
