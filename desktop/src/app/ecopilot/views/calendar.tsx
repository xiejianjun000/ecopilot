/**
 * 合规日历 — 按频次分类显示
 * 自动监测(每日) / 手工监测(每月/每季/每年/每两年)
 */
import { useStore } from '@nanostores/react'
import { useState, useMemo } from 'react'
import { $compliance, $permitDaysRemaining } from '../store/permit'
import { $patrolJobs } from '../store/patrol'
import { $monitoringTasks, getMonitorStats } from '../store/monitoring'
import type { MonitorFreq } from '../store/monitoring'
import { Icon } from '../../../components/ui/icon'

type EvtType = 'permit' | 'report' | 'monitor' | 'alert' | 'patrol'
interface CalendarEvent {
  id: string; date: string; title: string; type: EvtType
  urgent?: boolean; desc?: string
  freq?: MonitorFreq  // 仅监测类
}

const EVT_META: Record<EvtType, { label: string; color: string; bg: string; dot: string }> = {
  permit:  { label:'许可证到期', color:'#dc2626', bg:'#fef2f2', dot:'bg-red-500' },
  report:  { label:'执行报告',   color:'#d97706', bg:'#fffbeb', dot:'bg-amber-500' },
  monitor: { label:'手工监测',   color:'#059669', bg:'#ecfdf5', dot:'bg-emerald-500' },
  alert:   { label:'排放告警',   color:'#b91c1c', bg:'#fef2f2', dot:'bg-red-600' },
  patrol:  { label:'巡检',      color:'#2563eb', bg:'#eff6ff', dot:'bg-blue-500' },
}

const FREQ_LABEL: Record<MonitorFreq, string> = {
  daily: '每日自动', monthly: '每月手工', quarterly: '每季手工',
  annual: '每年手工', biennial: '每两年手工',
}
const FREQ_COLOR: Record<MonitorFreq, string> = {
  daily: '#6B7280', monthly: '#059669', quarterly: '#0E9F6E',
  annual: '#F59E0B', biennial: '#DC2626',
}

const pad = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']

export function CalendarView() {
  const compliance = useStore($compliance)
  const patrolJobs = useStore($patrolJobs)
  const daysRemaining = useStore($permitDaysRemaining)
  const monitorTasks = useStore($monitoringTasks)
  const stats = getMonitorStats()

  const [viewDate, setViewDate] = useState(() => new Date())
  const y = viewDate.getFullYear(), m = viewDate.getMonth()
  const [selDate, setSelDate] = useState<string | null>(null)
  const [filters, setFilters] = useState<Record<EvtType, boolean>>({
    permit: true, report: true, monitor: true, alert: true, patrol: true,
  })

  // 构建事件
  const allEvents = useMemo(() => {
    const evts: CalendarEvent[] = []

    // 许可证
    if (compliance.permit?.validTo) evts.push({
      id: 'pe', date: compliance.permit.validTo,
      title: `许可证到期 · ${compliance.permit.enterpriseName}`,
      type: 'permit', urgent: daysRemaining <= 30,
      desc: `距到期 ${daysRemaining} 天`,
    })

    // 执行报告
    const qDates = [
      { d: `${y}-03-31`, q: 'Q1' }, { d: `${y}-06-30`, q: 'Q2' },
      { d: `${y}-09-30`, q: 'Q3' }, { d: `${y}-12-31`, q: 'Q4' },
    ]
    for (const q of qDates) evts.push({ id: `rpt-${q.q}`, date: q.d, title: `${q.q}执行报告截止`, type: 'report', urgent: true })
    evts.push({ id: 'rpt-annual', date: `${y+1}-01-31`, title: '年度执行报告截止', type: 'report', urgent: true })

    // 巡检
    for (const j of patrolJobs.filter(j => j.enabled)) {
      if (j.lastRun) evts.push({ id: `pat-${j.id}`, date: j.lastRun.split(' ')[0], title: `巡检·${j.name}`, type: 'patrol' })
    }

    // 排放告警
    for (const a of compliance.emissionAlerts) {
      evts.push({
        id: `alt-${a.id}`, date: new Date().toISOString().split('T')[0],
        title: `${a.factor}超标 ${a.currentValue}/${a.limit}${a.unit}`,
        type: 'alert', urgent: a.severity === 'critical',
        desc: `${a.outlet} · ${a.duration}`,
      })
    }

    // 手工监测（仅 monthly/quarterly/annual/biennial，daily自动不计入日历）
    for (const t of monitorTasks) {
      if (t.frequency === 'daily') continue
      for (const d of t.dueDates) {
        if (d.startsWith(String(y))) {
          evts.push({
            id: `mon-${t.id}-${d}`, date: d,
            title: t.outletName,
            type: 'monitor',
            freq: t.frequency,
            desc: `${t.factor} · ${t.frequencyLabel}`,
          })
        }
      }
    }
    return evts
  }, [compliance, patrolJobs, daysRemaining, monitorTasks, y, m])

  const todayStr = new Date().toISOString().split('T')[0]
  const filtered = useMemo(() => allEvents.filter(e => filters[e.type]), [allEvents, filters])
  const selEvents = selDate ? filtered.filter(e => e.date === selDate) : []
  const dim = new Date(y, m + 1, 0).getDate()
  const fdow = (new Date(y, m, 1).getDay() + 6) % 7

  // 自动监测统计
  const autoCount = monitorTasks.filter(t => t.frequency === 'daily').length
  const autoOnline = monitorTasks.filter(t => t.frequency === 'daily' && !t.outletName.includes('长期停产')).length
  const autoOffline = monitorTasks.filter(t => t.outletName.includes('长期停产')).length

  // 月度各频次统计
  const monthStats = useMemo(() => {
    const r = { daily: 0, monthly: 0, quarterly: 0, annual: 0, biennial: 0 }
    const mStr = pad(m + 1)
    for (const e of allEvents) {
      if (!e.date.startsWith(`${y}-${mStr}`)) continue
      if (e.type === 'monitor' && e.freq) r[e.freq] = (r[e.freq] || 0) + 1
    }
    return r
  }, [allEvents, y, m])

  const goMonth = (d: number) => setViewDate(new Date(y, m + d, 1))

  return (
    <div style={{ padding: '20px 24px', overflowY: 'auto', height: '100%', background: '#f7f7f7', fontFamily: "-apple-system,'PingFang SC','Microsoft YaHei',sans-serif" }}>
      {/* ═══ 顶部 ═══ */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>合规日历</h2>
          <span style={{ fontSize: 12, color: '#999', background: '#eee', padding: '2px 10px', borderRadius: 10 }}>{allEvents.length} 项</span>
        </div>
      </div>

      {/* ═══ 自动监测状态条 ═══ */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151', background: '#fff', padding: '6px 14px', borderRadius: 8, border: '1px solid #e5e7eb' }}>
          <Icon name="monitor" size={16} />
          <span>自动监测</span>
          <span style={{ fontWeight: 600, color: '#059669' }}>{autoOnline}</span>
          <span style={{ color: '#999' }}>/ {autoCount} 路在线</span>
          {autoOffline > 0 && <span style={{ color: '#dc2626', marginLeft: 4 }}>{autoOffline}路停产</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151', background: '#fff', padding: '6px 14px', borderRadius: 8, border: '1px solid #e5e7eb' }}>
          <Icon name="activity" size={16} />
          <span>本月手工</span>
          <span style={{ fontWeight: 600, color: '#059669' }}>{monthStats.monthly}</span>
          <span style={{ color: '#999' }}>项月度</span>
          <span style={{ fontWeight: 600, color: '#0E9F6E' }}>{monthStats.quarterly}</span>
          <span style={{ color: '#999' }}>项季度</span>
          {monthStats.annual > 0 && <><span style={{ fontWeight: 600, color: '#F59E0B' }}>{monthStats.annual}</span><span style={{ color: '#999' }}>项年度</span></>}
        </div>
      </div>

      {/* ═══ 主体 ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
        {/* ─── 月历 ─── */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          {/* 导航 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #d1fae5' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => goMonth(-1)} style={{ width: 30, height: 30, borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 14 }}>‹</button>
              <button onClick={() => goMonth(1)} style={{ width: 30, height: 30, borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 14 }}>›</button>
            </div>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{y}年 {MONTHS[m]}</span>
            <button onClick={() => { const t = new Date(); setViewDate(new Date(t.getFullYear(), t.getMonth(), 1)) }}
              style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', fontSize: 12, color: '#666', cursor: 'pointer' }}>
              今天
            </button>
          </div>

          {/* 星期 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', borderBottom: '1px solid #d1fae5', background: '#fafafa' }}>
            {['一','二','三','四','五','六','日'].map(d => (
              <div key={d} style={{ textAlign: 'center', padding: '8px 0', fontSize: 11, fontWeight: 600, color: '#999' }}>{d}</div>
            ))}
          </div>

          {/* 日期格 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
            {Array.from({length: fdow}).map((_, i) => <div key={`e${i}`} style={{ minHeight: 72, background: '#fafafa' }} />)}
            {Array.from({length: dim}, (_, i) => {
              const day = i + 1
              const ds = `${y}-${pad(m+1)}-${pad(day)}`
              const dayEvents = allEvents.filter(e => e.date === ds)
              const isToday = ds === todayStr
              const isSel = ds === selDate

              return (
                <div key={day} onClick={() => setSelDate(ds)}
                  style={{
                    minHeight: 72, padding: '3px 5px',
                    borderRight: '1px solid #d1fae5', borderBottom: '1px solid #d1fae5',
                    background: isToday ? '#f0fdf4' : isSel ? '#eef2ff' : '#fff',
                    cursor: 'pointer', position: 'relative',
                  }}
                  onMouseEnter={e => { if (!isToday && !isSel) e.currentTarget.style.background = '#f9fafb' }}
                  onMouseLeave={e => { if (!isToday && !isSel) e.currentTarget.style.background = '#fff' }}
                >
                  <div style={{ fontSize: 11, fontWeight: isToday ? 700 : 400, color: isToday ? '#059669' : '#6B7280', marginBottom: 2 }}>
                    {day}
                  </div>
                  {/* 最多显示1条，其余用+计数 */}
                  {dayEvents.length > 0 && (
                    <div>
                      {(() => {
                        const top = dayEvents.find(e => e.urgent) || dayEvents[0]
                        const meta = EVT_META[top.type]
                        let label = top.title
                        if (top.type === 'monitor') {
                          // 监测任务显示：因子名
                          label = top.desc?.split('·')[0]?.trim() || label
                          const fColor = top.freq ? FREQ_COLOR[top.freq] : meta.color
                          if (label.length > 6) label = label.slice(0, 5) + '..'
                          return <div style={{ fontSize: 9, lineHeight: '16px', padding: '0 3px', borderRadius: 2, background: fColor + '15', color: fColor, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{label}</div>
                        }
                        if (label.length > 6) label = label.slice(0, 5) + '..'
                        return <div style={{ fontSize: 9, lineHeight: '16px', padding: '0 3px', borderRadius: 2, background: meta.bg, color: meta.color, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{label}</div>
                      })()}
                      {dayEvents.length > 1 && <div style={{ fontSize: 8, color: '#bbb', paddingLeft: 2, lineHeight: '14px' }}>+{dayEvents.length - 1}</div>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* 图例 */}
          <div style={{ display: 'flex', gap: 10, padding: '6px 12px', borderTop: '1px solid #d1fae5', background: '#fafafa', flexWrap: 'wrap' }}>
            {(['permit','report','monitor','alert','patrol'] as EvtType[]).map(t => (
              <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#999', cursor: 'pointer', opacity: filters[t] ? 1 : 0.35 }}>
                <input type="checkbox" checked={filters[t]} onChange={() => setFilters(p => ({...p, [t]: !p[t]}))} style={{ accentColor: EVT_META[t].color, width: 11, height: 11, margin: 0 }} />
                <span>{EVT_META[t].label}</span>
              </label>
            ))}
            <span style={{ fontSize: 10, color: '#ccc', marginLeft: 'auto' }}>频次色：</span>
            <span style={{ fontSize: 10, color: FREQ_COLOR.quarterly }}>■ 季度</span>
            <span style={{ fontSize: 10, color: FREQ_COLOR.annual }}>■ 年度</span>
            <span style={{ fontSize: 10, color: FREQ_COLOR.biennial }}>■ 两年</span>
          </div>
        </div>

        {/* ─── 右侧详情面板 ─── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {selDate ? (
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 16, minHeight: 200 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600 }}>
                  {selDate}
                  {selDate === todayStr && <span style={{ marginLeft: 6, fontSize: 10, background: '#059669', color: '#fff', padding: '1px 6px', borderRadius: 6 }}>今天</span>}
                </h3>
              </div>
              {selEvents.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#bbb', fontSize: 13 }}>当天无合规事项</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {selEvents.map(evt => {
                    const meta = EVT_META[evt.type]
                    let freqColor = ''
                    let freqLabel = ''
                    if (evt.type === 'monitor' && evt.freq) {
                      freqColor = FREQ_COLOR[evt.freq]
                      freqLabel = FREQ_LABEL[evt.freq]
                    }
                    return (
                      <div key={evt.id} style={{ padding: '10px 12px', borderRadius: 8, background: meta.bg, borderLeft: `3px solid ${freqColor || meta.color}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: '#1D2129' }}>{evt.title}</div>
                          {evt.urgent && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#dc2626', color: '#fff', flexShrink: 0 }}>紧急</span>}
                        </div>
                        {evt.desc && <div style={{ fontSize: 11, color: '#6B7280', marginTop: 3 }}>{evt.desc}</div>}
                        <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                          <span style={{ fontSize: 10, color: meta.color }}>{meta.label}</span>
                          {freqLabel && <span style={{ fontSize: 10, color: freqColor }}>| {freqLabel}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 24, textAlign: 'center', color: '#bbb' }}>
              <Icon name="calendar" size={28} />
              <p style={{ marginTop: 8, fontSize: 13 }}>点击日期查看详情</p>
            </div>
          )}

          {/* 月度统计 */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 14 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#374151' }}>{y}年{MONTHS[m]}监测任务</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {[
                { label: '自动在线', count: stats.daily, color: '#6B7280' },
                { label: '月度手工', count: monthStats.monthly, color: '#059669' },
                { label: '季度手工', count: monthStats.quarterly, color: '#0E9F6E' },
                { label: '年度手工', count: monthStats.annual, color: '#F59E0B' },
                { label: '两年手工', count: monthStats.biennial, color: '#DC2626' },
              ].filter(s => s.count > 0).map(s => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', borderRadius: 4, background: '#f9fafb' }}>
                  <span style={{ fontSize: 11, color: '#999' }}>{s.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: s.color }}>{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
