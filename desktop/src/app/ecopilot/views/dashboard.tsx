/** Dashboard — 合规态势仪表盘 */
import { useStore } from '@nanostores/react'
import { useEffect, useState, memo, useCallback } from 'react'
import { $compliance, $permitDaysRemaining, $permitExpiryStatus, $hasUrgentItems } from '../store/permit'
import { $patrolJobs, $enabledJobsCount, $lastWarningJob, togglePatrolJob, runPatrolNow } from '../store/patrol'
import { Icon } from '../../../components/ui/icon'
import CountUp from '../../../components/react-bits/TextAnimations/CountUp/CountUp'
import FadeContent from '../../../components/react-bits/Animations/FadeContent/FadeContent'

export function DashboardPage({ onOpenMeeting }: { onOpenMeeting: () => void }) {
  const compliance = useStore($compliance)
  const daysRemaining = useStore($permitDaysRemaining)
  const expiryStatus = useStore($permitExpiryStatus)
  const hasUrgent = useStore($hasUrgentItems)
  const permit = compliance.permit
  if (!permit) return null

  const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
  const docPct = compliance.docCompleteness

  return (
    <FadeContent duration={600} blur>
      <div className="dash-page">
        <div className="dash-topbar">
          <div>
            <div className="dash-topbar__title"><Icon name="building-factory" size={18} /> {permit.enterpriseName}</div>
            <div className="dash-topbar__meta">
              {today} · 许可证 {permit.permitNumber} · {permit.managementLevel}
              {hasUrgent && <span className="tag tag--danger ml-2"><Icon name="alert-triangle" size={12} /> 需关注</span>}
            </div>
          </div>
          <div className="dash-topbar__actions">
            <button className="dash-topbar__btn" onClick={onOpenMeeting}><Icon name="users" size={14} /> 召集会议</button>
            <button className="dash-topbar__btn"><Icon name="file-export" size={14} /> 生成报告</button>
            <button className="dash-topbar__btn"><Icon name="search" size={14} /> 合规检查</button>
            <button className="dash-topbar__btn dash-topbar__btn--primary"><Icon name="plus" size={14} /> 新建任务</button>
          </div>
        </div>

        <div className="dash-kpi-row">
          <div className={`dash-kpi ${daysRemaining <= 30 ? 'dash-kpi--danger' : daysRemaining <= 90 ? 'dash-kpi--warn' : 'dash-kpi--ok'}`}>
            <div className="dash-kpi__icon"><Icon name="calendar-due" size={20} /></div>
            <div className="dash-kpi__body">
              <div className="dash-kpi__value">{daysRemaining <= 0 ? '已到期' : <CountUp to={daysRemaining} duration={2} separator="" />}{daysRemaining > 0 && ' 天'}</div>
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
              <div className="dash-kpi__label">排放监测</div>
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
          <div className="dash-main__left">
            <FadeContent duration={500} delay={150} blur>
              <div className="dash-card">
                <div className="dash-card__hd">
                  <h3><Icon name="chart-bar" size={15} /> 排放管控概览</h3>
                  <span className="dash-card__badge">
                    {compliance.emissionAlerts.length > 0 ? <span className="text-red"><Icon name="alert-triangle" size={12} /> 存在超标</span> : <span className="text-green"><Icon name="check-circle" size={12} /> 正常</span>}
                  </span>
                </div>
                <div className="dash-emission-table">
                  <div className="dash-emission-table__row dash-emission-table__row--hd">
                    <span>排放口</span><span>因子</span><span>限值</span><span>当前值</span><span>状态</span><span>达标率</span>
                  </div>
                  {[
                    { o: 'DA001·烧结机头', f: 'SO2', l: 35, v: 12.3, u: 'mg/m3' },
                    { o: 'DA001·烧结机头', f: 'NOx', l: 50, v: 38.7, u: 'mg/m3' },
                    { o: '总排放口', f: 'COD', l: 30, v: 18.5, u: 'mg/L' },
                    { o: '总排放口', f: 'NH3-N', l: 12, v: 15.0, u: 'mg/L' },
                  ].map((r, i) => {
                    const pct = Math.round(r.v / r.l * 100)
                    const over = r.v > r.l
                    return (
                      <div key={i} className={`dash-emission-table__row ${over ? 'dash-emission-table__row--over' : ''}`}>
                        <span>{r.o}</span><span>{r.f}</span>
                        <span className="font-mono">≤{r.l}{r.u}</span>
                        <span className={`font-mono font-bold ${over ? 'text-red' : ''}`}>{r.v}{r.u}</span>
                        <span>{over ? <span className="tag tag--danger"><Icon name="x-circle" size={10} /> 超标</span> : <span className="tag tag--ok"><Icon name="check" size={10} /> 达标</span>}</span>
                        <span>
                          <span className="dash-mini-bar"><span className="dash-mini-bar__fill" style={{ width: `${Math.min(100, pct)}%`, background: over ? 'var(--danger)' : pct > 80 ? 'var(--warning)' : 'var(--success)' }} /></span>
                          {pct}%
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </FadeContent>

            <FadeContent duration={500} delay={300} blur>
              <div className="dash-card">
                <div className="dash-card__hd"><h3><Icon name="calendar-event" size={15} /> 合规日历</h3></div>
                <div className="dash-timeline">
                  <div className="dash-timeline__item dash-timeline__item--urgent">
                    <div className="dash-timeline__dot" />
                    <div><strong>排污许可证到期</strong><span className="text-muted ml-2">2026-08-15（{daysRemaining}天后）</span></div>
                    <span className="tag tag--danger"><Icon name="alert-triangle" size={10} /> 紧急</span>
                  </div>
                  <div className="dash-timeline__item dash-timeline__item--warn">
                    <div className="dash-timeline__dot" />
                    <div><strong>Q2执行报告</strong><span className="text-muted ml-2">截止 2026-07-15</span></div>
                    <span className="tag tag--warn"><Icon name="clock" size={10} /> 逾期</span>
                  </div>
                  <div className="dash-timeline__item">
                    <div className="dash-timeline__dot" />
                    <div><strong>碳配额履约</strong><span className="text-muted ml-2">2026-09-30</span></div>
                    <span className="text-muted">79 天后</span>
                  </div>
                </div>
              </div>
            </FadeContent>
          </div>

          <div className="dash-main__right">
            <FadeContent duration={500} delay={200} blur>
              <div className="dash-card">
                <div className="dash-card__hd"><h3><Icon name="shield-check" size={15} /> 许可证</h3></div>
                <div className="dash-permit-info">
                  <div className="dash-permit-info__row"><span className="text-muted">编号</span><span className="font-mono">{permit.permitNumber}</span></div>
                  <div className="dash-permit-info__row"><span className="text-muted">有效期</span><span>{permit.validFrom} → <strong>{permit.validTo}</strong></span></div>
                  <div className="dash-permit-info__row"><span className="text-muted">行业</span><span>{permit.industryCategory}</span></div>
                  <div className="dash-permit-info__row"><span className="text-muted">管理类别</span><span>{permit.managementLevel}</span></div>
                  <div className="dash-permit-info__row"><span className="text-muted">排放口</span><span>{permit.emissionOutlets.length} 个</span></div>
                </div>
              </div>
            </FadeContent>

            <FadeContent duration={500} delay={350} blur>
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
