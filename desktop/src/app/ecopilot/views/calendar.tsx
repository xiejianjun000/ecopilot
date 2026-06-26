/** 合规日历 */
import { useStore } from '@nanostores/react'; import { useState, useMemo, useCallback } from 'react'
import { $compliance, $permitDaysRemaining } from '../store/permit'
import { $patrolJobs } from '../store/patrol'
import { Icon } from '../../../components/ui/icon'
import FadeContent from '../../../components/react-bits/Animations/FadeContent/FadeContent'

interface CalendarEvent { id: string; date: string; title: string; type: 'permit' | 'report' | 'patrol' | 'alert'; urgent?: boolean }

export function CalendarView() {
  const compliance = useStore($compliance); const patrolJobs = useStore($patrolJobs); const daysRemaining = useStore($permitDaysRemaining)
  const [cd, setCd] = useState(() => new Date()); const [sel, setSel] = useState<string | null>(null)
  const y = cd.getFullYear(), m = cd.getMonth()
  const events = useMemo(() => {
    const evts: CalendarEvent[] = []
    if (compliance.permit?.validTo) evts.push({ id: 'pe', date: compliance.permit.validTo, title: '排污许可证到期', type: 'permit', urgent: daysRemaining <= 30 })
    const r = compliance.permit?.managementRequirements.filter(r => r.category === '执行报告') || []
    r.forEach((_, i) => { ['2026-07-15','2026-10-15','2027-01-15'].forEach(d => evts.push({ id: `rq${i}-${d}`, date: d, title: '季度执行报告截止', type: 'report' })) })
    if (r.length) evts.push({ id: 'ra', date: '2027-01-31', title: '年度执行报告截止', type: 'report', urgent: true })
    patrolJobs.filter(j => j.enabled).forEach(j => { if (j.lastRun) evts.push({ id: `p-${j.id}`, date: j.lastRun.split(' ')[0], title: j.name, type: 'patrol' }) })
    compliance.emissionAlerts.forEach(a => evts.push({ id: `a-${a.id}`, date: new Date().toISOString().split('T')[0], title: `${a.factor}超标(${a.currentValue}/${a.limit})`, type: 'alert', urgent: a.severity === 'critical' }))
    return evts
  }, [compliance, patrolJobs, daysRemaining])
  const dim = new Date(y, m + 1, 0).getDate(), fdow = (new Date(y, m, 1).getDay() + 6) % 7
  const today = new Date().toISOString().split('T')[0]
  const selEvts = sel ? events.filter(e => e.date === sel) : []
  const mn = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'], wd = ['一','二','三','四','五','六','日']

  return (<FadeContent duration={500} blur><div className="page-view"><h2><Icon name="calendar" size={18} /> 合规日历</h2>
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
      <div className="lg:col-span-2 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between mb-4">
          <button className="w-8 h-8 rounded-lg hover:bg-muted" onClick={() => setCd(new Date(y,m-1,1))}><Icon name="chevron-left" size={16} /></button>
          <h2 className="text-base font-semibold">{y}年{mn[m]}</h2>
          <button className="w-8 h-8 rounded-lg hover:bg-muted" onClick={() => setCd(new Date(y,m+1,1))}><Icon name="chevron-right" size={16} /></button>
        </div>
        <div className="grid grid-cols-7 mb-2">{wd.map(d => <div key={d} className="text-center text-xs text-muted-foreground py-1">{d}</div>)}</div>
        <div className="grid grid-cols-7">
          {Array.from({length: fdow}).map((_,i) => <div key={`e${i}`} className="min-h-[56px]" />)}
          {Array.from({length: dim}, (_,i) => {
            const day = i + 1, ds = `${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
            const de = events.filter(e => e.date === ds), isToday = ds === today, isSel = ds === sel
            return (<div key={day} className={`min-h-[56px] p-1 border-t border-l border-border/40 cursor-pointer hover:bg-muted/50 ${isToday ? 'bg-emerald-50/50' : ''} ${isSel ? 'ring-1 ring-emerald-500 bg-emerald-50/30' : ''}`} onClick={() => setSel(ds)}>
              <div className={`text-xs mb-1 ${isToday ? 'font-bold text-emerald-600' : 'text-muted-foreground'}`}>{day}</div>
              {de.slice(0,2).map(evt => <div key={evt.id} className={`text-[10px] px-1 rounded truncate mb-0.5 ${evt.type === 'permit' ? 'bg-red-100 text-red-700' : evt.type === 'report' ? 'bg-amber-100 text-amber-700' : evt.type === 'alert' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'} ${evt.urgent ? 'font-bold' : ''}`}>{evt.title}</div>)}
              {de.length > 2 && <div className="text-[10px] text-muted-foreground">+{de.length-2}</div>}
            </div>)
          })}
        </div>
      </div>
      <div className="space-y-4">
        {sel && <FadeContent duration={400}><div className="rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3"><Icon name="calendar-event" size={14} /> {sel}</h3>
          {selEvts.length === 0 ? <p className="text-sm text-muted-foreground">当天无合规事项</p> : selEvts.map(evt => (
            <div key={evt.id} className="flex items-start gap-2 p-2 rounded-lg bg-muted/50 mb-1">
              <div className={`w-2 h-2 rounded-full mt-1.5 ${evt.type === 'permit' ? 'bg-red-500' : evt.type === 'report' ? 'bg-amber-500' : evt.type === 'alert' ? 'bg-red-500' : 'bg-blue-500'}`} />
              <div><div className="text-sm">{evt.title}</div><div className="text-[11px] text-muted-foreground">{evt.type === 'permit' ? '许可证' : evt.type === 'report' ? '执行报告' : evt.type === 'alert' ? '告警' : '巡检'}</div></div>
            </div>))}</div></FadeContent>}
        <FadeContent duration={400} delay={150}><div className="rounded-xl border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold"><Icon name="chart-bar" size={14} /> 合规摘要</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">许可证到期</span><span className={daysRemaining<=30?'text-red-600 font-medium':daysRemaining<=90?'text-amber-600':'text-emerald-600'}>{daysRemaining<=0?'已到期':`${daysRemaining}天`}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">待处理事项</span><span className="text-amber-600">{compliance.pendingCount}项</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">排放告警</span><span className={compliance.emissionAlerts.length>0?'text-red-600':'text-emerald-600'}>{compliance.emissionAlerts.length||0}项</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">巡检任务</span><span>{patrolJobs.filter(j=>j.enabled).length}个</span></div></div>
        </div></FadeContent>
      </div>
    </div></div></FadeContent>)
}
