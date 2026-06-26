/** 企业环境档案库 */
import { useStore } from '@nanostores/react'; import { useMemo } from 'react'
import { $compliance } from '../store/permit'
import { Icon } from '../../../components/ui/icon'
import FadeContent from '../../../components/react-bits/Animations/FadeContent/FadeContent'

interface VaultDoc { id: string; name: string; category: string; status: string; summary?: string; regulatoryBasis?: string }
const DOCS: VaultDoc[] = [
  { id:'eia-report', name:'环境影响评价报告书', category:'环评', status:'uploaded', summary:'湘环评[2019]138号，废水零排放要求' },
  { id:'eia-approval', name:'环评批复文件', category:'环评', status:'uploaded', summary:'批复排放总量：COD 50t/a、NH3-N 5t/a、SO2 200t/a' },
  { id:'permit-license', name:'排污许可证（正本+副本）', category:'许可证', status:'uploaded', summary:'编号9143...001P，有效期至2026-08-15' },
  { id:'acceptance-report', name:'竣工环境保护验收报告', category:'验收', status:'missing' },
  { id:'monitoring-plan', name:'自行监测方案', category:'监测', status:'missing' },
  { id:'emergency-plan', name:'突发环境事件应急预案', category:'应急', status:'uploaded', summary:'备案号：娄应急备[2023]012号' },
  { id:'cleaner-prod', name:'清洁生产审核报告', category:'清洁生产', status:'uploaded', summary:'通过审核，无中/高费方案' },
  { id:'q2-report-2026', name:'2026年Q2季度执行报告', category:'执行报告', status:'missing' },
  { id:'annual-report-2025', name:'2025年度执行报告', category:'执行报告', status:'uploaded', summary:'全年排放未超许可总量' },
  { id:'auto-monitor', name:'自动监测设备验收材料', category:'监测', status:'uploaded', summary:'CEMS通过验收' },
  { id:'haz-waste', name:'危险废物管理计划', category:'其他', status:'missing' },
  { id:'env-disclosure', name:'环境信息公开记录', category:'其他', status:'uploaded', summary:'Q1执行报告已在平台公开' },
]

const CAT_ICONS: Record<string,string> = { '环评':'file-description', '验收':'check', '许可证':'file-text', '监测':'chart-bar', '应急':'alert-triangle', '清洁生产':'leaf', '执行报告':'file-check', '其他':'file' }

export function VaultView() {
  const compliance = useStore($compliance); const docPct = compliance.docCompleteness
  const cats = useMemo(() => {
    const map = new Map<string, VaultDoc[]>(); DOCS.forEach(d => { const a = map.get(d.category) || []; a.push(d); map.set(d.category, a) }); return map
  }, [])
  const stats = useMemo(() => ({ total: DOCS.length, uploaded: DOCS.filter(d => d.status === 'uploaded').length, missing: DOCS.filter(d => d.status === 'missing').length }), [])

  return (<FadeContent duration={500} blur><div className="page-view"><h2><Icon name="folder" size={18} /> 企业环境档案库</h2>
    <div className="flex items-center gap-4 mb-4 p-4 rounded-xl border bg-card">
      <div className="flex-1"><div className="flex justify-between text-sm mb-1"><span className="font-medium">档案完整度</span><span className="font-bold">{docPct}%</span></div>
        <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${docPct}%` }} /></div>
        <div className="flex justify-between mt-1 text-xs text-muted-foreground"><span>已归档 {stats.uploaded}/{stats.total}</span><span>缺失 {stats.missing}</span></div></div>
      <button className="dash-topbar__btn"><Icon name="upload" size={14} /> 批量上传</button>
    </div>
    <div className="space-y-4">
      {Array.from(cats.entries()).map(([cat, items]) => {
        const ok = items.filter(d => d.status === 'uploaded').length, allOk = ok === items.length, noneOk = ok === 0
        return (<FadeContent key={cat} duration={400}>
          <div className="rounded-xl border bg-card">
            <div className="p-4 border-b flex items-center gap-3">
              <Icon name={CAT_ICONS[cat] || 'file'} size={16} className={allOk ? 'text-emerald-500' : noneOk ? 'text-muted-foreground/40' : 'text-amber-500'} />
              <div><h3 className="text-sm font-semibold">{cat}</h3><span className="text-xs text-muted-foreground">{ok}/{items.length} 完成</span></div>
            </div>
            <div className="divide-y">{
              items.filter(d => !['acceptance-report','monitoring-plan','q2-report-2026','haz-waste'].includes(d.id)).map(d => (
                <div key={d.id} className={`flex items-center gap-3 p-3 ${d.status === 'missing' ? '' : 'hover:bg-muted/30'}`}>
                  <Icon name={d.status === 'uploaded' ? 'check-circle' : 'x-circle'} size={14} className={d.status === 'uploaded' ? 'text-emerald-500' : 'text-muted-foreground/40'} />
                  <div className="flex-1 min-w-0"><div className="text-sm truncate">{d.name}</div>{d.summary && <div className="text-xs text-muted-foreground truncate">{d.summary}</div>}</div>
                  <button className="text-xs px-2.5 py-1 rounded-lg border hover:bg-muted">{d.status === 'uploaded' ? '查看' : '上传'}</button>
                </div>
              ))
            }{items.filter(d => ['acceptance-report','monitoring-plan','q2-report-2026','haz-waste'].includes(d.id)).map(d => (
              <div key={d.id} className="flex items-center gap-3 p-3 opacity-60">
                <Icon name={d.status === 'uploaded' ? 'check-circle' : 'x-circle'} size={14} className="text-muted-foreground/40" />
                <div className="flex-1"><div className="text-sm truncate">{d.name}</div></div>
                <button className="text-xs px-2.5 py-1 rounded-lg border hover:bg-muted">上传</button></div>
            ))}</div></div></FadeContent>)
      })}
    </div></div></FadeContent>)
}
