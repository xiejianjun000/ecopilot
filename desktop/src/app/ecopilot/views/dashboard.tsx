/** Dashboard — 合规态势仪表盘（真实数据驱动） */
import { useStore } from '@nanostores/react'
import { useEffect, useState, memo } from 'react'
import { $compliance, $permitDaysRemaining, $permitExpiryStatus, $hasUrgentItems } from '../store/permit'
import { $patrolJobs, $enabledJobsCount, $lastWarningJob, togglePatrolJob, runPatrolNow } from '../store/patrol'
import { Icon } from '../../../components/ui/icon'
import CountUp from '../../../components/react-bits/TextAnimations/CountUp/CountUp'
import FadeContent from '../../../components/react-bits/Animations/FadeContent/FadeContent'

/** 从排放口列表生成排放管控表格行 */
function buildEmissionRows(outlets: PermitInfo['emissionOutlets']) {
  const rows: { outlet: string; factor: string; limit: number; unit: string }[] = []
  for (const o of outlets) {
    for (const l of o.limits) {
      rows.push({
        outlet: `${o.code}·${o.name}`,
        factor: l.factor,
        limit: l.limit,
        unit: l.unit,
      })
    }
  }
  return rows
}

/** 计算合规日历事件 */
interface CalendarEvent {
  title: string
  date: string
  daysUntil: number
  level: 'urgent' | 'warn' | 'normal'
  detail: string
}

function buildCalendarEvents(permit: PermitInfo, daysRemaining: number): CalendarEvent[] {
  const events: CalendarEvent[] = []
  const today = new Date()
  const computeDays = (d: string) => Math.ceil((new Date(d).getTime() - today.getTime()) / 86400000)

  // 1. 许可证到期日
  if (permit.validTo) {
    events.push({
      title: '排污许可证到期',
      date: permit.validTo,
      daysUntil: daysRemaining,
      level: daysRemaining <= 30 ? 'urgent' as const : daysRemaining <= 90 ? 'warn' as const : 'normal' as const,
      detail: `最新审批通过 ${permit.reapplicationHistory?.find(r => r.status === '审批通过')?.date || permit.validFrom}`,
    })
  }

  // 2. 执行报告
  if (permit.executionReportStatus?.includes('尽快提交')) {
    events.push({
      title: 'Q2执行报告逾期',
      date: '2023-07-28',
      daysUntil: -1,
      level: 'urgent' as const,
      detail: permit.executionReportStatus,
    })
  } else {
    // 推算下季度截止日
    const quarter = Math.floor(today.getMonth() / 3) + 1
    const qEnd = new Date(today.getFullYear(), quarter * 3, 15)
    events.push({
      title: `Q${quarter}执行报告`,
      date: qEnd.toISOString().slice(0, 10),
      daysUntil: computeDays(qEnd.toISOString().slice(0, 10)),
      level: qEnd < new Date() ? 'urgent' as const : qEnd.getTime() - today.getTime() < 30 * 86400000 ? 'warn' as const : 'normal' as const,
      detail: '季度执行报告提交截止',
    })
  }

  // 3. 重新申请补正提醒
  const pendingReapply = permit.reapplicationHistory?.find(r => r.status === '补正')
  if (pendingReapply) {
    events.push({
      title: '补正申请材料',
      date: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
      daysUntil: 15,
      level: 'warn' as const,
      detail: '重新申请被退回补正，请尽快补充材料',
    })
  }

  // 4. 碳配额履约（钢铁企业已纳入全国碳市场）
  const carbonDeadline = new Date(today.getFullYear(), 8, 30) // 每年9月30日
  if (carbonDeadline < today) carbonDeadline.setFullYear(carbonDeadline.getFullYear() + 1)
  events.push({
    title: '碳配额履约',
    date: carbonDeadline.toISOString().slice(0, 10),
    daysUntil: computeDays(carbonDeadline.toISOString().slice(0, 10)),
    level: 'normal' as const,
    detail: '钢铁行业已纳入全国碳市场，请关注配额分配通知',
  })

  return events.sort((a, b) => a.daysUntil - b.daysUntil)
}

import type { PermitInfo } from '../lib/permit-parser'

export function DashboardPage({ onOpenMeeting }: { onOpenMeeting: () => void }) {
  const compliance = useStore($compliance)
  const daysRemaining = useStore($permitDaysRemaining)
  const expiryStatus = useStore($permitExpiryStatus)
  const hasUrgent = useStore($hasUrgentItems)
  const permit = compliance.permit
  if (!permit) {
    // store 尚未初始化，显示加载中
    return (
      <div className="dash-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', border: '3px solid #e5e7eb', borderTopColor: '#059669', animation: 'pr-spin 0.7s linear infinite', margin: '0 auto 16px' }} />
          <p style={{ fontSize: 14, color: '#6B7280' }}>正在加载许可证数据...</p>
        </div>
        <style>{`@keyframes pr-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
  const docPct = compliance.docCompleteness
  const emissionRows = buildEmissionRows(permit.emissionOutlets)
  const calendarEvents = buildCalendarEvents(permit, daysRemaining)

  return (
    <FadeContent duration={600} blur>
      <div className="dash-page">
        {/* ═══ 顶部企业信息条 ═══ */}
        <div className="dash-topbar">
          <div>
            <div className="dash-topbar__title"><Icon name="building-factory" size={18} /> {permit.enterpriseName}</div>
            <div className="dash-topbar__meta">
              {today} · 信用代码 {permit.creditCode} · {permit.managementLevel}
              {permit.secondaryIndustry && <span className="text-muted ml-2">· {permit.secondaryIndustry}</span>}
              {hasUrgent && <span className="tag tag--danger ml-2"><Icon name="alert-triangle" size={12} /> 需关注</span>}
            </div>
          </div>
          <div className="dash-topbar__actions">
            <button className="dash-topbar__btn" onClick={onOpenMeeting}><Icon name="users" size={14} /> 召集会议</button>
            <button className="dash-topbar__btn"><Icon name="search" size={14} /> 合规检查</button>
            <button className="dash-topbar__btn dash-topbar__btn--primary"><Icon name="refresh" size={14} /> 刷新数据</button>
          </div>
        </div>

        {/* ═══ KPI 四卡片 ═══ */}
        <div className="dash-kpi-row">
          <div className={`dash-kpi ${daysRemaining <= 30 ? 'dash-kpi--danger' : daysRemaining <= 90 ? 'dash-kpi--warn' : 'dash-kpi--ok'}`}>
            <div className="dash-kpi__icon"><Icon name="calendar-due" size={20} /></div>
            <div className="dash-kpi__body">
              <div className="dash-kpi__value">{daysRemaining <= 0 ? '已到期' : <><CountUp to={daysRemaining} duration={2} separator="" /> 天</>}</div>
              <div className="dash-kpi__label">许可证剩余有效期</div>
            </div>
            <div className="dash-kpi__bar-track">
              <div className="dash-kpi__bar-fill" style={{ width: `${Math.max(0, Math.min(100, daysRemaining / 1825 * 100))}%` }} />
            </div>
          </div>
          <div className={`dash-kpi ${compliance.pendingCount > 0 ? 'dash-kpi--danger' : 'dash-kpi--ok'}`}>
            <div className="dash-kpi__icon"><Icon name="alert-circle" size={20} /></div>
            <div className="dash-kpi__body">
              <div className="dash-kpi__value"><CountUp to={compliance.pendingCount} duration={1.5} separator="" /></div>
              <div className="dash-kpi__label">待处理事项{compliance.urgentCount > 0 ? `（${compliance.urgentCount} 紧急）` : ''}</div>
            </div>
          </div>
          <div className={`dash-kpi ${compliance.emissionAlerts.length > 0 ? 'dash-kpi--danger' : 'dash-kpi--ok'}`}>
            <div className="dash-kpi__icon"><Icon name="chart-bar" size={20} /></div>
            <div className="dash-kpi__body">
              <div className="dash-kpi__value">{compliance.emissionAlerts.length === 0 ? '全部达标' : <><CountUp to={compliance.emissionAlerts.length} duration={1.5} separator="" /> 项超标</>}</div>
              <div className="dash-kpi__label">排放监测{permit.monitoringStatus ? ` · ${permit.monitoringStatus}` : ''}</div>
            </div>
          </div>
          <div className="dash-kpi dash-kpi--ok">
            <div className="dash-kpi__icon"><Icon name="brain" size={20} /></div>
            <div className="dash-kpi__body">
              <div className="dash-kpi__value"><CountUp to={compliance.learnedSkillsCount} duration={1.5} separator="" /> 技能</div>
              <div className="dash-kpi__label">自主学成 · {compliance.memoryCount} 条记忆</div>
            </div>
          </div>
        </div>

        <div className="dash-main">
          {/* ═══ 左列 ═══ */}
          <div className="dash-main__left">
            {/* ── 排放管控概览（从真实排放口生成） ── */}
            <FadeContent duration={500} delay={150} blur>
              <div className="dash-card">
                <div className="dash-card__hd">
                  <h3><Icon name="chart-bar" size={15} /> 排放管控概览</h3>
                  <span className="dash-card__badge">
                    {compliance.emissionAlerts.length > 0
                      ? <span className="text-red"><Icon name="alert-triangle" size={12} /> 存在超标</span>
                      : <span className="text-green"><Icon name="check-circle" size={12} /> {permit.emissionOutlets.length} 排放口 · 正常</span>}
                  </span>
                </div>
                <div className="dash-emission-table">
                  <div className="dash-emission-table__row dash-emission-table__row--hd">
                    <span>排放口</span><span>因子</span><span>限值</span><span>状态</span>
                  </div>
                  {emissionRows.length === 0 && (
                    <div className="dash-emission-table__row">
                      <span className="text-muted" style={{ gridColumn: '1/-1', textAlign: 'center', padding: '16px 0' }}>
                        暂无监测数据 · 排放口信息来自平台提取
                      </span>
                    </div>
                  )}
                  {emissionRows.map((r, i) => (
                    <div key={i} className="dash-emission-table__row">
                      <span title={`${r.outlet}`}>{r.outlet.slice(0, 18)}{r.outlet.length > 18 ? '...' : ''}</span>
                      <span>{r.factor}</span>
                      <span className="font-mono">≤{r.limit}{r.unit}</span>
                      <span><span className="tag tag--muted"><Icon name="database" size={10} /> 待监测</span></span>
                    </div>
                  ))}
                </div>
                {permit.monitoringStatus && (
                  <div className="dash-card__ft text-muted" style={{ fontSize: 12, padding: '8px 0 0' }}>
                    📡 平台监测状态：{permit.monitoringStatus}
                  </div>
                )}
              </div>
            </FadeContent>

            {/* ── 合规日历（从真实数据计算） ── */}
            <FadeContent duration={500} delay={300} blur>
              <div className="dash-card">
                <div className="dash-card__hd"><h3><Icon name="calendar-event" size={15} /> 合规日历</h3></div>
                <div className="dash-timeline">
                  {calendarEvents.map((ev, i) => (
                    <div key={i} className={`dash-timeline__item ${ev.level === 'urgent' ? 'dash-timeline__item--urgent' : ev.level === 'warn' ? 'dash-timeline__item--warn' : ''}`}>
                      <div className="dash-timeline__dot" />
                      <div>
                        <strong>{ev.title}</strong>
                        <span className="text-muted ml-2">{ev.date}（{ev.daysUntil < 0 ? `已逾期${Math.abs(ev.daysUntil)}天` : `${ev.daysUntil}天后`}）</span>
                        {ev.detail && <div className="text-muted" style={{ fontSize: 11 }}>{ev.detail}</div>}
                      </div>
                      <span className={`tag ${ev.level === 'urgent' ? 'tag--danger' : ev.level === 'warn' ? 'tag--warn' : 'tag--muted'}`}>
                        {ev.level === 'urgent' ? <><Icon name="alert-triangle" size={10} /> 紧急</>
                         : ev.level === 'warn' ? <><Icon name="clock" size={10} /> 需关注</>
                         : <><Icon name="calendar" size={10} /> 正常</>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </FadeContent>

            {/* ── 碳排放合规（新增） ── */}
            <FadeContent duration={500} delay={400} blur>
              <div className="dash-card dash-card--carbon">
                <div className="dash-card__hd">
                  <h3><Icon name="cloud" size={15} /> 碳排放合规</h3>
                  <span className="tag tag--warn"><Icon name="info-circle" size={10} /> 政策更新</span>
                </div>
                <div style={{ padding: '8px 0', fontSize: 13 }}>
                  <div className="dash-permit-info__row">
                    <span className="text-muted">碳市场纳入</span>
                    <span className="tag tag--ok">✅ 已纳入全国碳市场</span>
                  </div>
                  <div className="dash-permit-info__row">
                    <span className="text-muted">配额履约日</span>
                    <span>每年 9月30日</span>
                  </div>
                  <div className="dash-permit-info__row">
                    <span className="text-muted">报送系统状态</span>
                    <span className="text-warn">⚠️ 旧系统未更新（2022年名单）</span>
                  </div>
                  <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a', fontSize: 12, color: '#92400e', lineHeight: 1.6 }}>
                    <strong>📌 说明：</strong>钢铁行业已被纳入全国碳排放权交易市场。
                    当前碳排放报送系统（114.251.10.30）显示"不属于填报范围"是因为该系统基于2022年纳入名单运行。
                    请以生态环境部最新公告为准，关注配额分配通知和新系统切换时间。
                  </div>
                </div>
              </div>
            </FadeContent>
          </div>

          {/* ═══ 右列 ═══ */}
          <div className="dash-main__right">
            {/* ── 许可证信息 ── */}
            <FadeContent duration={500} delay={200} blur>
              <div className="dash-card">
                <div className="dash-card__hd"><h3><Icon name="shield-check" size={15} /> 许可证</h3></div>
                <div className="dash-permit-info">
                  <div className="dash-permit-info__row">
                    <span className="text-muted">信用代码</span>
                    <span className="font-mono">{permit.creditCode || '—'}</span>
                  </div>
                  <div className="dash-permit-info__row">
                    <span className="text-muted">许可证号</span>
                    <span className="font-mono">{permit.permitNumber || '审批中'}</span>
                  </div>
                  <div className="dash-permit-info__row">
                    <span className="text-muted">有效期</span>
                    <span>{permit.validFrom || '—'} → <strong>{permit.validTo || '—'}</strong></span>
                  </div>
                  <div className="dash-permit-info__row">
                    <span className="text-muted">行业</span>
                    <span>{permit.industryCategory || '—'}</span>
                  </div>
                  <div className="dash-permit-info__row">
                    <span className="text-muted">管理类别</span>
                    <span className="tag tag--warn">{permit.managementLevel}</span>
                  </div>
                  <div className="dash-permit-info__row">
                    <span className="text-muted">排放口</span>
                    <span>{permit.emissionOutlets?.length || 0} 个</span>
                  </div>
                  {permit.city && (
                    <div className="dash-permit-info__row">
                      <span className="text-muted">所在地</span>
                      <span>{permit.province} {permit.city} {permit.county}</span>
                    </div>
                  )}
                </div>
              </div>
            </FadeContent>

            {/* ── 重新申请 / 延续历史 ── */}
            <FadeContent duration={500} delay={300} blur>
              <div className="dash-card">
                <div className="dash-card__hd"><h3><Icon name="history" size={15} /> 审批历史</h3></div>
                <div className="dash-timeline">
                  {permit.reapplicationHistory?.slice(0, 4).map((r, i) => (
                    <div key={i} className={`dash-timeline__item ${r.status === '补正' ? 'dash-timeline__item--warn' : ''}`}>
                      <div className="dash-timeline__dot" />
                      <div>
                        <strong>{r.status === '审批通过' ? '✅' : r.status === '补正' ? '⚠️' : '📋'} 重新申请</strong>
                        <span className="text-muted ml-2">{r.date || '进行中'}</span>
                      </div>
                      <span className={`tag ${r.status === '审批通过' ? 'tag--ok' : r.status === '补正' ? 'tag--warn' : 'tag--muted'}`}>
                        {r.status}
                      </span>
                    </div>
                  ))}
                  {permit.renewalHistory?.slice(0, 2).map((r, i) => (
                    <div key={`renew-${i}`} className="dash-timeline__item">
                      <div className="dash-timeline__dot" />
                      <div>
                        <strong>🔄 许可证延续</strong>
                        <span className="text-muted ml-2">{r.date}</span>
                      </div>
                      <span className={`tag ${r.status === '审批通过' ? 'tag--ok' : 'tag--muted'}`}>{r.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </FadeContent>

            {/* ── 知识积累 ── */}
            <FadeContent duration={500} delay={400} blur>
              <div className="dash-card">
                <div className="dash-card__hd"><h3><Icon name="brain" size={15} /> 知识积累</h3></div>
                <div className="dash-knowledge-stats">
                  <div className="dash-stat-row"><Icon name="star" size={14} /> <span>已学技能</span><strong>{compliance.learnedSkillsCount} 个</strong></div>
                  <div className="dash-stat-row"><Icon name="notes" size={14} /> <span>已记记忆</span><strong>{compliance.memoryCount} 条</strong></div>
                  <div className="dash-stat-row"><Icon name="folder" size={14} /> <span>档案完整度</span>
                    <div className="dash-mini-bar"><div className="dash-mini-bar__fill" style={{ width: `${docPct}%` }} /></div>
                    <strong>{docPct}%</strong>
                  </div>
                </div>
              </div>
            </FadeContent>
          </div>
        </div>
      </div>
    </FadeContent>
  )
}
