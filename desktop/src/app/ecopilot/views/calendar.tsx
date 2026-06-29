/**
 * 合规日历 v2 — 行业通用版
 * 事件类型: 许可证到期 / 执行报告 / 手工监测 / 台账周检 / 自定义日程 / 排放告警
 * 许可证到期前30天开始每日提醒 | 监测任务从排放口列表动态生成
 */
import { useStore } from '@nanostores/react'
import { useState, useMemo } from 'react'
import { $compliance, $permitDaysRemaining } from '../store/permit'
import { $monitoringTasks, getMonitorStats } from '../store/monitoring'
import { $ledgerRecords, LEDGER_META, getLedgerMissingCount, resetLedgerForNewWeek, type LedgerType } from '../store/ledger'
import { $schedules, addSchedule, removeSchedule, toggleSchedule, completeSchedule, type ScheduleRepeat } from '../store/schedules'
import { Icon } from '../../../components/ui/icon'
import type { MonitorFreq } from '../store/monitoring'

type EvtType = 'permit' | 'report' | 'monitor' | 'ledger' | 'custom' | 'alert'

interface CalendarEvent {
  id: string; date: string; title: string; type: EvtType
  urgent?: boolean; desc?: string; freq?: MonitorFreq; repeat?: ScheduleRepeat
  source?: string; // 'system' | 'user' | 'ai-suggest'
}

const EVT_META: Record<EvtType, { label: string; color: string; bg: string; dot: string }> = {
  permit:  { label:'许可证到期', color:'#dc2626', bg:'#fef2f2', dot:'bg-red-500' },
  report:  { label:'执行报告',   color:'#d97706', bg:'#fffbeb', dot:'bg-amber-500' },
  monitor: { label:'手工监测',   color:'#059669', bg:'#ecfdf5', dot:'bg-emerald-500' },
  ledger:  { label:'台账检查',   color:'#2563eb', bg:'#eff6ff', dot:'bg-blue-500' },
  custom:  { label:'自定义',     color:'#7c3aed', bg:'#f5f3ff', dot:'bg-purple-500' },
  alert:   { label:'排放告警',   color:'#b91c1c', bg:'#fef2f2', dot:'bg-red-600' },
}

const FREQ_LABEL: Record<MonitorFreq, string> = { daily:'每日自动', monthly:'每月手工', quarterly:'每季手工', annual:'每年手工', biennial:'每两年手工' }
const FREQ_COLOR: Record<MonitorFreq, string> = { daily:'#6B7280', monthly:'#059669', quarterly:'#0E9F6E', annual:'#F59E0B', biennial:'#DC2626' }
const REPEAT_LABEL: Record<ScheduleRepeat, string> = { once:'一次', daily:'每天', weekly:'每周', monthly:'每月', annual:'每年' }

const pad = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']

export function CalendarView() {
  const compliance = useStore($compliance)
  const daysRemaining = useStore($permitDaysRemaining)
  const monitorTasks = useStore($monitoringTasks)
  const ledgerRecords = useStore($ledgerRecords)
  const customSchedules = useStore($schedules)
  const stats = getMonitorStats()
  const ledgerMissing = getLedgerMissingCount()

  const [viewDate, setViewDate] = useState(() => new Date())
  const y = viewDate.getFullYear(), m = viewDate.getMonth()
  const [selDate, setSelDate] = useState<string | null>(null)
  const [filters, setFilters] = useState<Record<EvtType, boolean>>({
    permit: true, report: true, monitor: true, ledger: true, custom: true, alert: true,
  })
  const [showAddForm, setShowAddForm] = useState(false)
  const [newTask, setNewTask] = useState({ title: '', date: '', repeat: 'once' as ScheduleRepeat })

  // 新周开始重置台账状态
  useMemo(() => { resetLedgerForNewWeek() }, [y, m])

  // ─── 构建全部事件 ───
  const allEvents = useMemo(() => {
    const evts: CalendarEvent[] = []

    // ① 许可证到期（前30天：每天一条提醒直到到期日）
    if (compliance.permit?.validTo) {
      const vt = compliance.permit.validTo
      // 到期前30天开始，每天生成一个事件
      const today = new Date()
      const validDate = new Date(vt)
      const diffDays = Math.ceil((validDate.getTime() - today.getTime()) / 86400000)
      if (diffDays > 0 && diffDays <= 30) {
        for (let i = 0; i < diffDays; i++) {
          const d = new Date(today)
          d.setDate(d.getDate() + i)
          const ds = d.toISOString().split('T')[0]
          evts.push({
            id: `pe-${ds}`, date: ds,
            title: `🔴 许可证到期倒计时`,
            type: 'permit', urgent: true,
            desc: `距到期 ${diffDays - i} 天 · ${compliance.permit.enterpriseName}`,
          })
        }
      } else if (diffDays > 30 && diffDays <= 90) {
        // 30-90天：只在到期日显示，非紧急
        evts.push({ id:'pe', date:vt, type:'permit', urgent:false,
          title:`许可证到期 · ${compliance.permit.enterpriseName}`, desc:`距到期 ${diffDays} 天` })
      } else {
        evts.push({ id:'pe', date:vt, type:'permit', urgent: diffDays <= 0,
          title:`许可证到期 · ${compliance.permit.enterpriseName}`,
          desc: diffDays <= 0 ? '已过期！请立即处理' : `距到期 ${diffDays} 天` })
      }
    }

    // ② 执行报告截止日
    const qDates = [
      { d:`${y}-03-31`, q:'Q1' }, { d:`${y}-06-30`, q:'Q2' },
      { d:`${y}-09-30`, q:'Q3' }, { d:`${y}-12-31`, q:'Q4' },
    ]
    for (const q of qDates) {
      const dd = Math.ceil((new Date(q.d).getTime() - new Date().getTime()) / 86400000)
      evts.push({ id:`rpt-${q.q}`, date:q.d, type:'report', urgent: dd <= 7,
        title:`${q.q}执行报告截止`, desc:`HJ 944 §5.4 — 季度结束15日内提交` })
    }
    const annualDue = `${y+1}-01-31`
    const ad = Math.ceil((new Date(annualDue).getTime() - new Date().getTime()) / 86400000)
    evts.push({ id:'rpt-annual', date:annualDue, type:'report', urgent: ad <= 14,
      title:'年度执行报告截止', desc:'HJ 944 §5.4 — 次年1月31日前提交' })

    // ③ 手工监测
    for (const t of monitorTasks) {
      if (t.frequency === 'daily') continue
      for (const d of t.dueDates) {
        if (d.startsWith(String(y))) {
          evts.push({ id:`mon-${t.id}-${d}`, date:d, title:t.outletName , type:'monitor', freq:t.frequency,
            desc:`${t.factor} · ${t.frequencyLabel}` })
        }
      }
    }

    // ④ 台账周检（每周五）
    for (const r of ledgerRecords) {
      if (r.status !== 'completed') {
        // 本周每一天都标记为待检查
        const today = new Date()
        const dayOfWeek = today.getDay() || 7
        const d = new Date(today)
        d.setDate(d.getDate() + (5 - dayOfWeek)) // 移到本周五
        const ds = d.toISOString().split('T')[0]
        evts.push({ id:`ledger-${r.type}`, date:ds, type:'ledger',
          title:LEDGER_META[r.type].label, desc:`状态: ${r.status === 'partial' ? '部分完成' : '未完成'}` })
      }
    }

    // ⑤ 自定义日程
    for (const s of customSchedules) {
      if (!s.enabled) continue
      evts.push({ id:`cust-${s.id}`, date:s.date, type:'custom', repeat:s.repeat,
        title:s.title, desc:s.description, source:s.source })
    }

    // ⑥ 排放告警
    for (const a of compliance.emissionAlerts) {
      evts.push({ id:`alt-${a.id}`, date:new Date().toISOString().split('T')[0], type:'alert',
        urgent: a.severity === 'critical', title:`${a.factor}超标 ${a.currentValue}/${a.limit}${a.unit}`,
        desc:`${a.outlet} · ${a.duration}` })
    }

    return evts
  }, [compliance, daysRemaining, monitorTasks, ledgerRecords, customSchedules, y])

  const todayStr = new Date().toISOString().split('T')[0]
  const filtered = useMemo(() => allEvents.filter(e => filters[e.type]), [allEvents, filters])
  const selEvents = selDate ? filtered.filter(e => e.date === selDate) : []
  const dim = new Date(y, m + 1, 0).getDate()
  const fdow = (new Date(y, m, 1).getDay() + 6) % 7

  const autoCount = monitorTasks.filter(t => t.frequency === 'daily').length
  const weekFocused = ledgerRecords.filter(r => r.status !== 'completed').length
  const customEnabled = customSchedules.filter(s => s.enabled).length

  const monthStats = useMemo(() => {
    const r: Record<string,number> = {}
    const mStr = pad(m + 1)
    for (const e of allEvents) {
      if (!e.date.startsWith(`${y}-${mStr}`)) continue
      if (e.type === 'monitor' && e.freq) r[e.freq] = (r[e.freq] || 0) + 1
    }
    return r
  }, [allEvents, y, m])

  const goMonth = (d: number) => setViewDate(new Date(y, m + d, 1))

  // ─── 新建自定义日程 ───
  const handleAddSchedule = () => {
    if (!newTask.title.trim() || !newTask.date) return
    addSchedule({
      title: newTask.title.trim(),
      date: newTask.date,
      repeat: newTask.repeat,
      description: newTask.repeat !== 'once' ? REPEAT_LABEL[newTask.repeat] + '提醒' : '',
      enabled: true,
      source: 'user',
    })
    setNewTask({ title: '', date: '', repeat: 'once' })
    setShowAddForm(false)
  }

  return (
    <div style={{ padding:'20px 24px', overflowY:'auto', height:'100%', background:'#f7f7f7', fontFamily:"-apple-system,'PingFang SC','Microsoft YaHei',sans-serif" }}>
      {/* ═══ 顶部 ═══ */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <h2 style={{ fontSize:18, fontWeight:700 }}>合规日历</h2>
          <span style={{ fontSize:12, color:'#999', background:'#eee', padding:'2px 10px', borderRadius:10 }}>{filtered.length} 项</span>
        </div>
        <button onClick={() => setShowAddForm(!showAddForm)} style={{
          padding:'6px 14px', borderRadius:8, border:'1px solid #d1d5db', background:'#fff',
          fontSize:12, color:'#374151', cursor:'pointer', display:'flex', alignItems:'center', gap:4,
        }}>
          <Icon name="plus" size={14} /> 新建日程
        </button>
      </div>

      {/* ═══ 新建日程表单 ═══ */}
      {showAddForm && (
        <div style={{ background:'#fff', borderRadius:12, border:'1px solid #e5e7eb', padding:14, marginBottom:16 }}>
          <div style={{ display:'flex', gap:10, alignItems:'flex-end', flexWrap:'wrap' }}>
            <div style={{ flex:1, minWidth:120 }}>
              <label style={{ fontSize:11, color:'#999', display:'block', marginBottom:4 }}>任务名称</label>
              <input value={newTask.title} onChange={e => setNewTask(p => ({...p, title:e.target.value}))}
                placeholder="如：提交Q2执行报告" style={{
                  width:'100%', padding:'6px 10px', borderRadius:6, border:'1px solid #e5e7eb', fontSize:13, outline:'none',
                }} />
            </div>
            <div style={{ width:140 }}>
              <label style={{ fontSize:11, color:'#999', display:'block', marginBottom:4 }}>日期</label>
              <input type="date" value={newTask.date} onChange={e => setNewTask(p => ({...p, date:e.target.value}))}
                style={{ width:'100%', padding:'6px 8px', borderRadius:6, border:'1px solid #e5e7eb', fontSize:13, outline:'none' }} />
            </div>
            <div style={{ width:100 }}>
              <label style={{ fontSize:11, color:'#999', display:'block', marginBottom:4 }}>重复</label>
              <select value={newTask.repeat} onChange={e => setNewTask(p => ({...p, repeat:e.target.value as ScheduleRepeat}))}
                style={{ width:'100%', padding:'6px 8px', borderRadius:6, border:'1px solid #e5e7eb', fontSize:13, outline:'none' }}>
                <option value="once">一次</option><option value="daily">每天</option>
                <option value="weekly">每周</option><option value="monthly">每月</option>
                <option value="annual">每年</option>
              </select>
            </div>
            <div style={{ display:'flex', gap:6 }}>
              <button onClick={handleAddSchedule} style={{
                padding:'6px 16px', borderRadius:6, border:'none', background:'linear-gradient(135deg,#059669,#10b981)',
                color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer',
              }}>添加</button>
              <button onClick={() => setShowAddForm(false)} style={{
                padding:'6px 12px', borderRadius:6, border:'1px solid #d1d5db', background:'#fff',
                color:'#999', fontSize:13, cursor:'pointer',
              }}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 状态条 ═══ */}
      <div style={{ display:'flex', gap:16, marginBottom:16, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'#374151', background:'#fff', padding:'6px 14px', borderRadius:8, border:'1px solid #e5e7eb' }}>
          <Icon name="monitor" size={16} />
          <span>自动监测</span>
          <span style={{ fontWeight:600, color:'#059669' }}>{autoCount}</span>
          <span style={{ color:'#999' }}>路在线</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'#374151', background:'#fff', padding:'6px 14px', borderRadius:8, border:'1px solid #e5e7eb' }}>
          <Icon name="activity" size={16} />
          <span>本月手工</span>
          {Object.entries(monthStats).map(([k,v]) => (
            <span key={k}><span style={{ fontWeight:600, color:FREQ_COLOR[k as MonitorFreq] }}>{v}</span><span style={{ color:'#999' }}>项{FREQ_LABEL[k as MonitorFreq]?.replace(/手工|自动/g,'')}</span></span>
          ))}
        </div>
        {ledgerMissing > 0 && (
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'#dc2626', background:'#fef2f2', padding:'6px 14px', borderRadius:8, border:'1px solid #fecaca' }}>
            <Icon name="alert-triangle" size={16} />
            <span>台账待补</span>
            <span style={{ fontWeight:600 }}>{ledgerMissing}</span>
            <span>类</span>
          </div>
        )}
        {customEnabled > 0 && (
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'#7c3aed', background:'#f5f3ff', padding:'6px 14px', borderRadius:8, border:'1px solid #ddd6fe' }}>
            <Icon name="clock" size={16} />
            <span>自定义</span>
            <span style={{ fontWeight:600 }}>{customEnabled}</span>
            <span>项</span>
          </div>
        )}
      </div>

      {/* ═══ 主体: 月历 + 右侧面板 ═══ */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 320px', gap:16, alignItems:'start' }}>
        {/* ─── 月历 ─── */}
        <div style={{ background:'#fff', borderRadius:12, border:'1px solid #e5e7eb', overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid #d1fae5' }}>
            <div style={{ display:'flex', gap:4 }}>
              <button onClick={() => goMonth(-1)} style={{ width:30,height:30,borderRadius:6,border:'1px solid #e5e7eb',background:'#fff',cursor:'pointer',color:'#999',fontSize:14 }}>‹</button>
              <button onClick={() => goMonth(1)} style={{ width:30,height:30,borderRadius:6,border:'1px solid #e5e7eb',background:'#fff',cursor:'pointer',color:'#999',fontSize:14 }}>›</button>
            </div>
            <span style={{ fontSize:15, fontWeight:600 }}>{y}年 {MONTHS[m]}</span>
            <button onClick={() => { const t = new Date(); setViewDate(new Date(t.getFullYear(), t.getMonth(), 1)) }}
              style={{ padding:'4px 12px',borderRadius:6,border:'1px solid #e5e7eb',background:'#fff',fontSize:12,color:'#666',cursor:'pointer' }}>今天</button>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', borderBottom:'1px solid #d1fae5', background:'#fafafa' }}>
            {['一','二','三','四','五','六','日'].map(d => (
              <div key={d} style={{ textAlign:'center',padding:'8px 0',fontSize:11,fontWeight:600,color:'#999' }}>{d}</div>
            ))}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)' }}>
            {Array.from({length:fdow}).map((_,i) => <div key={`e${i}`} style={{ minHeight:68, background:'#fafafa' }} />)}
            {Array.from({length:dim}, (_,i) => {
              const day = i+1
              const ds = `${y}-${pad(m+1)}-${pad(day)}`
              const dayEvents = filtered.filter(e => e.date === ds)
              const isToday = ds === todayStr
              const isSel = ds === selDate
              return (
                <div key={day} onClick={() => setSelDate(isSel ? null : ds)} style={{
                  minHeight:68, padding:'3px 5px',
                  borderRight:'1px solid #d1fae5', borderBottom:'1px solid #d1fae5',
                  background: isToday ? '#f0fdf4' : isSel ? '#eef2ff' : '#fff',
                  cursor:'pointer', position:'relative',
                }}>
                  <div style={{ fontSize:11, fontWeight:isToday?700:400, color:isToday?'#059669':'#6B7280', marginBottom:2 }}>{day}</div>
                  {dayEvents.length > 0 && (
                    <div>
                      {(() => {
                        const top = dayEvents.find(e=>e.urgent) || dayEvents[0]
                        const meta = EVT_META[top.type]
                        let label = top.type==='monitor' ? top.desc?.split('·')[0]?.trim() || top.title : top.title
                        const c = top.type==='monitor'&&top.freq ? FREQ_COLOR[top.freq] : meta.color
                        const bg = top.type==='monitor'&&top.freq ? c+'15' : meta.bg
                        if (label.length>6) label = label.slice(0,5)+'..'
                        return <div style={{ fontSize:9, lineHeight:'15px', padding:'0 3px', borderRadius:2, background:bg, color:c, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{label}</div>
                      })()}
                      {dayEvents.length>1 && <div style={{ fontSize:8, color:'#bbb', paddingLeft:2, lineHeight:'13px' }}>+{dayEvents.length-1}</div>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div style={{ display:'flex', gap:10, padding:'6px 12px', borderTop:'1px solid #d1fae5', background:'#fafafa', flexWrap:'wrap' }}>
            {(Object.keys(EVT_META) as EvtType[]).map(t => (
              <label key={t} style={{ display:'flex', alignItems:'center', gap:3, fontSize:10, color:'#999', cursor:'pointer', opacity:filters[t]?1:0.35 }}>
                <input type="checkbox" checked={filters[t]} onChange={() => setFilters(p=>({...p,[t]:!p[t]}))} style={{ accentColor:EVT_META[t].color, width:11, height:11, margin:0 }} />
                <span>{EVT_META[t].label}</span>
              </label>
            ))}
            <span style={{ fontSize:10, color:'#ccc', marginLeft:'auto' }}>
              频次: <span style={{ color:FREQ_COLOR.monthly }}>月</span> <span style={{ color:FREQ_COLOR.quarterly }}>季</span> <span style={{ color:FREQ_COLOR.annual }}>年</span>
            </span>
          </div>
        </div>

        {/* ─── 右侧面板 ─── */}
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {/* 选中日事件 */}
          {selDate ? (
            <div style={{ background:'#fff', borderRadius:12, border:'1px solid #e5e7eb', padding:16 }}>
              <h3 style={{ fontSize:14, fontWeight:600, marginBottom:12 }}>
                {selDate} {selDate===todayStr && <span style={{ marginLeft:6, fontSize:10, background:'#059669', color:'#fff', padding:'1px 6px', borderRadius:6 }}>今天</span>}
              </h3>
              {selEvents.length===0 ? (
                <div style={{ textAlign:'center', padding:'20px 0', color:'#bbb', fontSize:13 }}>当天无事项</div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {selEvents.map(evt => {
                    const meta = EVT_META[evt.type]
                    const fc = evt.type==='monitor'&&evt.freq ? FREQ_COLOR[evt.freq] : meta.color
                    return (
                      <div key={evt.id} style={{ padding:'10px 12px', borderRadius:8, background:meta.bg, borderLeft:`3px solid ${fc}` }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                          <div style={{ fontSize:13, fontWeight:500, color:'#1D2129' }}>{evt.title}</div>
                          {evt.urgent && <span style={{ fontSize:9, padding:'1px 5px', borderRadius:3, background:'#dc2626', color:'#fff', flexShrink:0 }}>紧急</span>}
                        </div>
                        {evt.desc && <div style={{ fontSize:11, color:'#6B7280', marginTop:3 }}>{evt.desc}</div>}
                        <div style={{ display:'flex', gap:6, marginTop:3 }}>
                          <span style={{ fontSize:10, color:meta.color }}>{meta.label}</span>
                          {evt.type==='monitor'&&evt.freq && <span style={{ fontSize:10, color:FREQ_COLOR[evt.freq] }}>| {FREQ_LABEL[evt.freq]}</span>}
                          {evt.repeat && evt.repeat!=='once' && <span style={{ fontSize:10, color:'#7c3aed' }}>| {REPEAT_LABEL[evt.repeat]}</span>}
                          {evt.source && <span style={{ fontSize:10, color:'#9CA3AF' }}>| {evt.source==='ai-suggest'?'AI建议':evt.source==='system'?'系统':'用户'}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <div style={{ background:'#fff', borderRadius:12, border:'1px solid #e5e7eb', padding:24, textAlign:'center', color:'#bbb' }}>
              <Icon name="calendar" size={28} />
              <p style={{ marginTop:8, fontSize:13 }}>点击日期查看详情</p>
            </div>
          )}

          {/* 台账状态卡片 */}
          <div style={{ background:'#fff', borderRadius:12, border:'1px solid #e5e7eb', padding:14 }}>
            <h3 style={{ fontSize:13, fontWeight:600, marginBottom:10, color:'#374151' }}>📋 本周台账</h3>
            {ledgerRecords.map(r => {
              const meta = LEDGER_META[r.type]
              const done = r.status === 'completed'
              const partial = r.status === 'partial'
              return (
                <div key={r.id} style={{
                  display:'flex', alignItems:'center', justifyContent:'space-between',
                  padding:'6px 0', borderBottom:'1px solid #f3f4f6', fontSize:12,
                }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <span>{meta.icon}</span>
                    <div>
                      <div style={{ color:'#374151' }}>{meta.label}</div>
                      <div style={{ fontSize:10, color:'#9CA3AF' }}>{meta.freq}</div>
                    </div>
                  </div>
                  <span style={{
                    fontSize:10, padding:'2px 8px', borderRadius:4,
                    background: done?'#d1fae5':partial?'#fffbeb':'#fef2f2',
                    color: done?'#059669':partial?'#d97706':'#dc2626',
                  }}>{done?'已完成':partial?'部分':'未完成'}</span>
                </div>
              )
            })}
          </div>

          {/* 月度统计 */}
          <div style={{ background:'#fff', borderRadius:12, border:'1px solid #e5e7eb', padding:14 }}>
            <h3 style={{ fontSize:13, fontWeight:600, marginBottom:8, color:'#374151' }}>{y}年{MONTHS[m]}监测</h3>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:4 }}>
              {[{ label:'自动在线', count:autoCount, color:'#6B7280' },
                { label:'月度手工', count:monthStats.monthly||0, color:'#059669' },
                { label:'季度手工', count:monthStats.quarterly||0, color:'#0E9F6E' },
                { label:'年度手工', count:monthStats.annual||0, color:'#F59E0B' },
              ].filter(s=>s.count>0).map(s=>(
                <div key={s.label} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'4px 8px', borderRadius:4, background:'#f9fafb' }}>
                  <span style={{ fontSize:11, color:'#999' }}>{s.label}</span>
                  <span style={{ fontSize:13, fontWeight:600, color:s.color }}>{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
