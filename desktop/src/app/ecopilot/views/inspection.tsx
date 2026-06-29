/**
 * 督察整改跟踪 — 甘特图 + 燃尽图 + 堆叠柱状图 + 任务列表
 * 纯 CSS/React，零外部图表库
 */
import { useStore } from '@nanostores/react'
import { useState, useMemo, useRef } from 'react'
import {
  $inspectionTasks, getInspectionStats, getOverdueTasks,
  addInspectionTask, removeInspectionTask, updateInspectionTask, updateProgress,
  addBulkTasks, SOURCE_LABELS, STATUS_LABELS, uploadAndParseDocument,
  type InspectionTask, type InspectionSource, type InspectionStatus,
} from '../store/inspection'
import type { InspectionEvidence } from '../store/inspection'
import { Icon } from '../../../components/ui/icon'
import FadeContent from '../../../components/react-bits/Animations/FadeContent/FadeContent'

const A = '#059669'

export function InspectionView() {
  const tasks = useStore($inspectionTasks)
  const stats = getInspectionStats()
  const overdue = getOverdueTasks()
  const today = new Date().toISOString().split('T')[0]

  // ── 甘特图数据 ──
  const ganttData = useMemo(() => {
    const allDates = tasks.flatMap(t => [t.startDate, t.deadline]).filter(Boolean).sort()
    const minDate = allDates[0] || today
    const maxDate = allDates[allDates.length - 1] || today
    const totalDays = Math.max(1, Math.ceil((new Date(maxDate).getTime() - new Date(minDate).getTime()) / 86400000))
    const todayPct = Math.max(0, Math.min(100, Math.ceil((new Date(today).getTime() - new Date(minDate).getTime()) / 86400000) / totalDays * 100))

    const grouped: Record<string, InspectionTask[]> = {}
    for (const src of ['central', 'provincial', 'mee', 'special', 'self_check'] as InspectionSource[]) {
      const srcTasks = tasks.filter(t => t.source === src).sort((a,b) => a.deadline.localeCompare(b.deadline))
      if (srcTasks.length) grouped[src] = srcTasks
    }
    return { grouped, minDate, maxDate, totalDays, todayPct }
  }, [tasks, today])

  // ── 燃尽图数据 ──
  const burndownData = useMemo(() => {
    if (tasks.length === 0) return { points: [], months: [], startMonth: '', endMonth: '' }
    const dates = tasks.map(t => t.startDate).sort()
    const endDates = tasks.map(t => t.deadline).sort()
    const start = new Date(dates[0])
    const end = new Date(endDates[endDates.length - 1])
    const months: string[] = []
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
    while (cursor <= end) {
      months.push(`${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}`)
      cursor.setMonth(cursor.getMonth() + 1)
    }
    if (months.length < 3) {
      // pad to at least 3 months
      const last = new Date(end)
      for (let i = months.length; i < 3; i++) {
        last.setMonth(last.getMonth() + 1)
        months.push(`${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,'0')}`)
      }
    }
    const totalMonths = months.length
    const points: { ideal: number; actual: number }[] = []
    for (let i = 0; i < totalMonths; i++) {
      const m = months[i]
      const remaining = tasks.filter(t => t.status !== 'completed' || t.completedAt! > m + '-31').length
      const ideal = Math.round(tasks.length * (1 - i / (totalMonths - 1 || 1)))
      points.push({ ideal, actual: remaining })
    }
    points[points.length - 1].actual = tasks.filter(t => t.status !== 'completed').length // current actual
    return { points, months, totalMonths }
  }, [tasks])

  // ── 堆叠柱状图数据 ──
  const stackedData = useMemo(() => {
    const sources: InspectionSource[] = ['central', 'provincial', 'mee', 'special', 'self_check']
    return sources.map(src => {
      const srcTasks = tasks.filter(t => t.source === src)
      return {
        source: src,
        label: SOURCE_LABELS[src].label,
        completed: srcTasks.filter(t => t.status === 'completed').length,
        inProgress: srcTasks.filter(t => t.status === 'in_progress').length,
        pending: srcTasks.filter(t => t.status === 'pending').length,
        overdue: srcTasks.filter(t => t.status === 'overdue').length,
        total: srcTasks.length,
      }
    }).filter(d => d.total > 0)
  }, [tasks])

  const maxStackTotal = Math.max(1, ...stackedData.map(d => d.total))

  // ── 新建/编辑模态 ──
  const [showModal, setShowModal] = useState(false)
  const [editTask, setEditTask] = useState<InspectionTask | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<'idle'|'loading'|'success'|'error'>('idle')
  const [uploadMsg, setUploadMsg] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const openNew = () => { setEditTask(null); setShowModal(true) }
  const openEdit = (t: InspectionTask) => { setEditTask(t); setShowModal(true) }
  const closeModal = () => { setShowModal(false); setEditTask(null) }

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0]
    if (!file) return
    setUploading(true); setUploadStatus('loading'); setUploadMsg('正在识别文档...')
    const result = await uploadAndParseDocument(file)
    setUploading(false)
    if (result.ok && result.tasks) {
      const count = result.tasks.length
      addBulkTasks(result.tasks)
      setUploadStatus('success')
      setUploadMsg(`成功解析 ${count} 条任务并已入库`)
    } else {
      setUploadStatus('error')
      setUploadMsg(result.error || '识别失败')
    }
  }

  return (
    <div className="dash-page">
      {/* ═══ 顶部操作栏 ═══ */}
      <div className="dash-topbar">
        <div>
          <div className="dash-topbar__title"><Icon name="clipboard" size={18} /> 督察整改跟踪</div>
          <div className="dash-topbar__meta">中央环保督察 · 省级督察 · 部委交办 · 专项整改 · 企业自查</div>
        </div>
        <div className="dash-topbar__actions">
          <input ref={fileInputRef} type="file" accept="image/*,.pdf" onChange={handleUpload} style={{display:'none'}} />
          <button className="dash-topbar__btn" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            <Icon name="file-text" size={14} /> 上传文档
          </button>
          <button className="dash-topbar__btn dash-topbar__btn--primary" onClick={openNew}>
            <Icon name="plus" size={14} /> 新建任务
          </button>
        </div>
      </div>

      {/* 上传状态 */}
      {uploadStatus !== 'idle' && (
        <div className={`inspect-upload-status inspect-upload-status--${uploadStatus}`} style={{marginBottom:12}}>
          {uploadStatus === 'loading' && <><div style={{width:16,height:16,borderRadius:'50%',border:'2px solid #bfdbfe',borderTopColor:'#2563eb',animation:'pr-spin 0.6s linear infinite'}} /></>}
          <span>{uploadMsg}</span>
          <button onClick={() => setUploadStatus('idle')} style={{marginLeft:'auto',border:'none',background:'transparent',cursor:'pointer',fontSize:16}}>×</button>
        </div>
      )}

      {/* ═══ 4 数概览 ═══ */}
      <FadeContent duration={400} blur>
        <div className="inspect-stat-row">
          <div className="inspect-stat">
            <div className="inspect-stat__value" style={{color:'#111827'}}>{stats.total}</div>
            <div className="inspect-stat__label">总任务</div>
          </div>
          <div className="inspect-stat">
            <div className="inspect-stat__value" style={{color:'var(--success)'}}>{stats.completed}</div>
            <div className="inspect-stat__label">已完成</div>
          </div>
          <div className="inspect-stat">
            <div className="inspect-stat__value" style={{color:'var(--warning)'}}>{stats.inProgress}</div>
            <div className="inspect-stat__label">整改中</div>
          </div>
          <div className="inspect-stat" style={{borderColor: stats.overdue > 0 ? 'rgba(239,68,68,0.3)' : undefined, background: stats.overdue > 0 ? 'rgba(239,68,68,0.03)' : undefined}}>
            <div className="inspect-stat__value" style={{color:'var(--danger)'}}>{stats.overdue}</div>
            <div className="inspect-stat__label">{stats.overdue > 0 ? '🔴 已逾期' : '逾期'}</div>
          </div>
        </div>
      </FadeContent>

      {/* ═══ 主体: 甘特图(全宽) + 双栏(燃尽图 / 堆叠柱状图) ═══ */}
      <div style={{display:'flex', flexDirection:'column', gap:16}}>

        {/* ── 甘特图（主视图） ── */}
        <FadeContent duration={500} delay={100} blur>
          <div className="dash-card">
            <div className="dash-card__hd">
              <h3><Icon name="chart-bar" size={15} /> 整改进度甘特图</h3>
              <span className="dash-card__badge" style={{color:'var(--text-tertiary)'}}>{tasks.length} 项任务</span>
            </div>

            {/* 图例 */}
            <div style={{display:'flex', gap:14, marginBottom:10, fontSize:10, color:'var(--text-tertiary)'}}>
              <span><span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:'var(--success)',marginRight:3,verticalAlign:'middle'}} />已完成</span>
              <span><span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:'var(--warning)',marginRight:3,verticalAlign:'middle'}} />整改中</span>
              <span><span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:'#d1d5db',marginRight:3,verticalAlign:'middle'}} />待整改</span>
              <span><span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:'var(--danger)',marginRight:3,verticalAlign:'middle'}} />逾期</span>
            </div>

            {Object.entries(ganttData.grouped).map(([src, srcTasks]) => (
              <div key={src} className="gantt-section">
                <div className="gantt-section__hd">
                  <span>{SOURCE_LABELS[src as InspectionSource]?.icon}</span>
                  <span>{SOURCE_LABELS[src as InspectionSource]?.label}</span>
                  <span style={{fontWeight:400,color:'var(--text-tertiary)',fontSize:10}}>
                    ({srcTasks.filter(t=>t.status==='completed').length}/{srcTasks.length})
                  </span>
                </div>
                {srcTasks.map(t => {
                  const startMs = new Date(t.startDate).getTime()
                  const endMs = new Date(t.deadline).getTime()
                  const totalSpan = endMs - startMs
                  const elapsed = new Date(today).getTime() - startMs
                  const timePct = totalSpan > 0 ? Math.max(0, Math.min(100, elapsed / totalSpan * 100)) : 0
                  const displayWidth = t.status === 'completed' ? 100 : Math.max(t.progress, timePct)
                  const barClass = t.status === 'completed' ? 'gantt-bar--completed'
                    : t.status === 'overdue' ? 'gantt-bar--overdue'
                    : t.status === 'in_progress' ? 'gantt-bar--progress' : 'gantt-bar--pending'
                  const isOverdue = t.status !== 'completed' && t.deadline < today

                  return (
                    <div key={t.id} className="gantt-row" onClick={() => openEdit(t)}>
                      <div className="gantt-label" title={t.title}>{t.title}</div>
                      <div className="gantt-track">
                        <div className={`gantt-bar ${barClass}`} style={{width:`${displayWidth}%`}}>
                          {displayWidth > 20 && <span className="gantt-bar__text">{t.progress}%</span>}
                        </div>
                        {ganttData.todayPct > 0 && ganttData.todayPct < 100 && (
                          <div className="gantt-today" style={{left:`${ganttData.todayPct}%`}} />
                        )}
                      </div>
                      <div className={`gantt-deadline ${isOverdue ? 'gantt-deadline--overdue' : ''}`}>
                        {t.deadline.slice(5)}
                      </div>
                      <span className={`tag ${t.status === 'completed' ? 'tag--ok' : t.status === 'overdue' ? 'tag--danger' : t.status === 'in_progress' ? 'tag--warn' : ''}`}
                        style={t.status === 'pending' ? {background:'#f3f4f6',color:'#6B7280'} : undefined}>
                        {STATUS_LABELS[t.status].label}
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </FadeContent>

        {/* ── 双栏：燃尽图 + 堆叠柱状图 ── */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
          {/* 燃尽图 */}
          <FadeContent duration={500} delay={200} blur>
            <div className="dash-card">
              <div className="dash-card__hd">
                <h3><Icon name="trending-up" size={15} /> 整改燃尽图</h3>
              </div>
              {burndownData.points.length > 0 ? (
                <>
                  <div style={{position:'relative',height:150,borderLeft:'1px solid var(--border-secondary)',borderBottom:'1px solid var(--border-secondary)',margin:'4px 0 0 32px',padding:'0 8px 0 0'}}>
                    {/* Y轴刻度 */}
                    {[tasks.length, Math.round(tasks.length/2), 0].map(v => (
                      <div key={v} style={{position:'absolute',left:-32,top:`${(1-v/tasks.length)*100}%`,fontSize:9,color:'var(--text-tertiary)',transform:'translateY(-50%)'}}>{v}</div>
                    ))}
                    {/* 理想线（灰色虚线） */}
                    <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',overflow:'visible'}}>
                      <polyline
                        points={burndownData.points.map((p,i) =>
                          `${(i/(burndownData.points.length-1))*100}%,${(1-p.ideal/tasks.length)*100}%`
                        ).join(' ')}
                        fill="none" stroke="#d1d5db" strokeWidth="1.5" strokeDasharray="4,3"
                      />
                      <polyline
                        points={burndownData.points.map((p,i) =>
                          `${(i/(burndownData.points.length-1))*100}%,${(1-p.actual/tasks.length)*100}%`
                        ).join(' ')}
                        fill="none" stroke={A} strokeWidth="2"
                      />
                      {burndownData.points.map((p,i) => (
                        <circle key={i} cx={`${(i/(burndownData.points.length-1))*100}%`} cy={`${(1-p.actual/tasks.length)*100}%`} r="3" fill={A} />
                      ))}
                    </svg>
                  </div>
                  <div className="burndown-x-labels">
                    {burndownData.months.map((m,i) => (
                      <span key={i}>{m.slice(5)}</span>
                    ))}
                  </div>
                  <div className="burndown-legend">
                    <span><span className="burndown-legend__line" style={{borderTop:'1.5px dashed #d1d5db'}} />理想线</span>
                    <span><span className="burndown-legend__line" style={{borderTop:'2px solid',borderColor:A}} />实际线</span>
                  </div>
                </>
              ) : (
                <div className="dash-empty-hint">暂无数据</div>
              )}
            </div>
          </FadeContent>

          {/* 堆叠柱状图 */}
          <FadeContent duration={500} delay={300} blur>
            <div className="dash-card">
              <div className="dash-card__hd">
                <h3><Icon name="chart-bar" size={15} /> 来源分布</h3>
              </div>
              {stackedData.length > 0 ? (
                <>
                  <div className="stacked-chart">
                    {stackedData.map(d => {
                      const completedH = (d.completed / maxStackTotal) * 100
                      const inProgressH = (d.inProgress / maxStackTotal) * 100
                      const pendingH = (d.pending / maxStackTotal) * 100
                      const overdueH = (d.overdue / maxStackTotal) * 100
                      return (
                        <div key={d.source} className="stacked-col" style={{height:'100%'}}>
                          {/* from bottom to top: completed → inProgress → pending → overdue */}
                          <div className="stacked-col__seg" style={{height:`${completedH}%`,background:'var(--success)'}} />
                          <div className="stacked-col__seg" style={{height:`${inProgressH}%`,background:'var(--warning)'}} />
                          <div className="stacked-col__seg" style={{height:`${pendingH}%`,background:'#d1d5db'}} />
                          <div className="stacked-col__seg" style={{height:`${overdueH}%`,background:'var(--danger)'}} />
                          <div className="stacked-col__label">{d.label}</div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="stacked-legend">
                    <span><span className="stacked-legend__dot" style={{background:'var(--success)'}} />已完成</span>
                    <span><span className="stacked-legend__dot" style={{background:'var(--warning)'}} />整改中</span>
                    <span><span className="stacked-legend__dot" style={{background:'#d1d5db'}} />待整改</span>
                    <span><span className="stacked-legend__dot" style={{background:'var(--danger)'}} />逾期</span>
                  </div>
                </>
              ) : (
                <div className="dash-empty-hint">暂无数据</div>
              )}
            </div>
          </FadeContent>
        </div>

        {/* ── 逾期任务告警 ── */}
        {overdue.length > 0 && (
          <FadeContent duration={500} delay={350} blur>
            <div className="dash-card" style={{borderColor:'rgba(239,68,68,0.2)',background:'rgba(239,68,68,0.02)'}}>
              <div className="dash-card__hd">
                <h3 style={{color:'var(--danger)'}}><Icon name="alert-triangle" size={15} /> 逾期任务（{overdue.length} 项）</h3>
              </div>
              {overdue.map(t => (
                <div key={t.id} className="dash-alert-item dash-alert-item--urgent" onClick={() => openEdit(t)} style={{cursor:'pointer'}}>
                  <div className="dash-alert-item__icon">{SOURCE_LABELS[t.source].icon}</div>
                  <div className="dash-alert-item__body">
                    <div className="dash-alert-item__title">{t.title}</div>
                    <div className="dash-alert-item__desc">
                      截止 {t.deadline} · 当前进度 {t.progress}% · 责任部门 {t.responsibleUnit}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </FadeContent>
        )}

        {/* ── 任务列表表格 ── */}
        <FadeContent duration={500} delay={400} blur>
          <div className="dash-card">
            <div className="dash-card__hd">
              <h3><Icon name="notes" size={15} /> 全部任务</h3>
              <span className="dash-card__badge" style={{color:'var(--text-tertiary)'}}>点击行编辑</span>
            </div>
            <div className="inspect-table">
              <div className="inspect-table__row inspect-table__row--hd">
                <span>#</span><span>来源</span><span>标题</span><span>进度</span><span>截止日</span><span>状态</span><span>操作</span>
              </div>
              {tasks.sort((a,b) => a.deadline.localeCompare(b.deadline)).map((t, i) => (
                <div key={t.id} className="inspect-table__row" onClick={() => openEdit(t)}>
                  <span style={{color:'var(--text-tertiary)'}}>{i+1}</span>
                  <span style={{fontSize:10}}>{SOURCE_LABELS[t.source].label}</span>
                  <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.title}</span>
                  <span>
                    <div style={{display:'flex',alignItems:'center',gap:4}}>
                      <div style={{flex:1,height:4,borderRadius:2,background:'#f3f4f6'}}>
                        <div style={{width:`${t.progress}%`,height:'100%',borderRadius:2,background:t.progress>=100?'var(--success)':t.progress>=50?'var(--warning)':t.status==='overdue'?'var(--danger)':'#d1d5db'}} />
                      </div>
                      <span style={{fontSize:10,color:'var(--text-tertiary)',width:28,textAlign:'right'}}>{t.progress}%</span>
                    </div>
                  </span>
                  <span style={{fontFamily:'var(--font-mono)',fontSize:11,color:t.status!=='completed'&&t.deadline<today?'var(--danger)':'var(--text-secondary)'}}>{t.deadline.slice(5)}</span>
                  <span className={`tag ${t.status==='completed'?'tag--ok':t.status==='overdue'?'tag--danger':t.status==='in_progress'?'tag--warn':''}`}
                    style={t.status==='pending'?{background:'#f3f4f6',color:'#6B7280'}:undefined}>
                    {STATUS_LABELS[t.status].label}
                  </span>
                  <button onClick={e=>{e.stopPropagation();removeInspectionTask(t.id)}} style={{border:'none',background:'transparent',cursor:'pointer',fontSize:14,color:'var(--text-tertiary)',padding:'2px 4px'}} title="删除">×</button>
                </div>
              ))}
            </div>
          </div>
        </FadeContent>
      </div>

      {/* ═══ 新建/编辑模态 ═══ */}
      {showModal && <TaskModal task={editTask} onClose={closeModal} />}

      <style>{`@keyframes pr-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

/** 新建/编辑任务的模态框 */
function TaskModal({ task, onClose }: { task: InspectionTask | null; onClose: () => void }) {
  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    requirement: task?.requirement || '',
    source: task?.source || 'special' as InspectionSource,
    sourceDetail: task?.sourceDetail || '',
    startDate: task?.startDate || new Date().toISOString().split('T')[0],
    deadline: task?.deadline || '',
    progress: task?.progress || 0,
    status: task?.status || 'pending' as InspectionStatus,
    responsibleUnit: task?.responsibleUnit || '',
  })

  const handleSave = () => {
    if (!form.title.trim() || !form.deadline) return
    if (task) {
      updateInspectionTask(task.id, { ...form, status: form.progress >= 100 ? 'completed' : form.status })
    } else {
      addInspectionTask({ ...form, status: form.progress >= 100 ? 'completed' : form.status, evidence: [] })
    }
    onClose()
  }

  const update = (k: string, v: any) => setForm(f => ({...f, [k]: v}))

  return (
    <div className="inspect-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="inspect-modal">
        <div className="inspect-modal__hd">
          <span>{task ? '编辑任务' : '新建任务'}</span>
          <button onClick={onClose} style={{border:'none',background:'transparent',cursor:'pointer',fontSize:18,color:'var(--text-tertiary)'}}>×</button>
        </div>
        <div className="inspect-modal__row">
          <label className="inspect-modal__label">任务标题 *</label>
          <input className="inspect-modal__input" value={form.title} onChange={e=>update('title',e.target.value)} placeholder="如：烧结机头脱硫效率不达标" />
        </div>
        <div className="inspect-modal__row">
          <label className="inspect-modal__label">问题描述</label>
          <textarea className="inspect-modal__textarea" value={form.description} onChange={e=>update('description',e.target.value)} placeholder="详细描述问题内容" />
        </div>
        <div className="inspect-modal__row">
          <label className="inspect-modal__label">整改要求</label>
          <textarea className="inspect-modal__textarea" value={form.requirement} onChange={e=>update('requirement',e.target.value)} placeholder="整改要求及验收标准" />
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div className="inspect-modal__row">
            <label className="inspect-modal__label">交办来源</label>
            <select className="inspect-modal__select" value={form.source} onChange={e=>update('source',e.target.value)}>
              {Object.entries(SOURCE_LABELS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="inspect-modal__row">
            <label className="inspect-modal__label">来源详情</label>
            <input className="inspect-modal__input" value={form.sourceDetail} onChange={e=>update('sourceDetail',e.target.value)} placeholder="如：2025年中央督察第3批" />
          </div>
          <div className="inspect-modal__row">
            <label className="inspect-modal__label">开始日期</label>
            <input className="inspect-modal__input" type="date" value={form.startDate} onChange={e=>update('startDate',e.target.value)} />
          </div>
          <div className="inspect-modal__row">
            <label className="inspect-modal__label">截止日期 *</label>
            <input className="inspect-modal__input" type="date" value={form.deadline} onChange={e=>update('deadline',e.target.value)} />
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div className="inspect-modal__row">
            <label className="inspect-modal__label">整改进度 ({form.progress}%)</label>
            <input className="inspect-modal__input" type="range" min="0" max="100" value={form.progress} onChange={e=>update('progress',parseInt(e.target.value))} style={{padding:'4px 0'}} />
          </div>
          <div className="inspect-modal__row">
            <label className="inspect-modal__label">责任部门</label>
            <input className="inspect-modal__input" value={form.responsibleUnit} onChange={e=>update('responsibleUnit',e.target.value)} placeholder="如：安环部" />
          </div>
        </div>
        <div className="inspect-modal__actions">
          <button className="inspect-modal__btn inspect-modal__btn--cancel" onClick={onClose}>取消</button>
          <button className="inspect-modal__btn inspect-modal__btn--primary" onClick={handleSave}>
            {task ? '保存修改' : '创建任务'}
          </button>
        </div>
      </div>
    </div>
  )
}
