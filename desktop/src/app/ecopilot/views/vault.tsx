/** 企业环境档案库 — 卡片式 */
import { useStore } from '@nanostores/react'; import { useMemo } from 'react'
import { $compliance } from '../store/permit'
import { Icon } from '../../../components/ui/icon'

interface VaultDoc { id: string; name: string; category: string; status: string; summary?: string }
const DOCS: VaultDoc[] = [
  { id:'eia-report', name:'环境影响评价报告书', category:'环评', status:'uploaded', summary:'湘环评[2019]138号，废水零排放要求' },
  { id:'eia-approval', name:'环评批复文件', category:'环评', status:'uploaded', summary:'批复排放总量: COD 50t/a、NH3-N 5t/a、SO2 200t/a' },
  { id:'permit-license', name:'排污许可证(正本+副本)', category:'许可证', status:'uploaded', summary:'编号9143...001P，有效期至2026-08-15' },
  { id:'acceptance-report', name:'竣工环保验收报告', category:'验收', status:'missing' },
  { id:'monitoring-plan', name:'自行监测方案', category:'监测', status:'missing' },
  { id:'emergency-plan', name:'突发环境事件应急预案', category:'应急', status:'uploaded', summary:'备案号: 娄应急备[2023]012号' },
  { id:'cleaner-prod', name:'清洁生产审核报告', category:'清洁生产', status:'uploaded', summary:'无中/高费方案，审核通过' },
  { id:'haz-waste', name:'危险废物管理计划', category:'固废', status:'missing' },
  { id:'auto-monitor', name:'自动监测设备验收材料', category:'监测', status:'uploaded', summary:'CEMS通过验收' },
  { id:'annual-report-2025', name:'2025年度执行报告', category:'执行报告', status:'uploaded', summary:'全年排放未超许可总量' },
  { id:'q2-report-2026', name:'2026年Q2执行报告', category:'执行报告', status:'missing' },
  { id:'env-disclosure', name:'环境信息公开记录', category:'其他', status:'uploaded' },
]

const CAT_ICONS: Record<string,string> = { '环评':'file-description', '验收':'clipboard', '许可证':'shield-check', '监测':'chart-bar', '应急':'alert-triangle', '清洁生产':'leaf', '执行报告':'file-text', '固废':'recycle', '其他':'file' }

export function VaultView() {
  const compliance = useStore($compliance)
  const docPct = compliance.docCompleteness
  const cats = useMemo(() => {
    const map = new Map<string, VaultDoc[]>(); DOCS.forEach(d => { const a = map.get(d.category) || []; a.push(d); map.set(d.category, a) }); return map
  }, [])
  const stats = useMemo(() => ({ total: DOCS.length, uploaded: DOCS.filter(d => d.status === 'uploaded').length, missing: DOCS.filter(d => d.status === 'missing').length }), [])

  return (
    <div style={{ padding: '20px 24px', overflowY: 'auto', height: '100%', background: '#f7f7f7', fontFamily: "-apple-system,'PingFang SC','Microsoft YaHei',sans-serif" }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="folder" size={18} /> 企业环境档案库
      </h2>

      {/* 进度卡片 */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>档案完整度</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: docPct >= 80 ? '#059669' : docPct >= 50 ? '#d97706' : '#dc2626' }}>{docPct}%</span>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: '#f3f4f6', overflow: 'hidden', marginBottom: 6 }}>
          <div style={{ height: '100%', borderRadius: 4, background: 'linear-gradient(90deg, #059669, #10b981)', width: docPct + '%', transition: 'width 0.5s ease' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#999' }}>
          <span>已归档 <strong style={{ color: '#059669' }}>{stats.uploaded}</strong>/{stats.total}</span>
          <span>缺失 <strong style={{ color: '#dc2626' }}>{stats.missing}</strong></span>
        </div>
      </div>

      {/* 分类卡片网格 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {Array.from(cats.entries()).map(([cat, items]) => {
          const ok = items.filter(d => d.status === 'uploaded').length
          const allOk = ok === items.length
          return (
            <div key={cat} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
              <div style={{ padding: '12px 14px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 8, background: allOk ? '#f0fdf4' : '#fefce8' }}>
                <Icon name={CAT_ICONS[cat] || 'file'} size={16} color={allOk ? '#059669' : '#d97706'} />
                <div style={{ flex: 1 }}><span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{cat}</span><span style={{ fontSize: 11, color: '#999', marginLeft: 6 }}>{ok}/{items.length}</span></div>
              </div>
              <div style={{ padding: '4px 0' }}>
                {items.map(d => (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid #f9fafb', opacity: d.status === 'missing' ? 0.6 : 1 }}>
                    <Icon name={d.status === 'uploaded' ? 'check-circle' : 'x-circle'} size={14} color={d.status === 'uploaded' ? '#059669' : '#d1d5db'} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: d.status === 'missing' ? 400 : 500, color: '#374151' }}>{d.name}</div>
                      {d.summary && <div style={{ fontSize: 10, color: '#999', marginTop: 1 }}>{d.summary}</div>}
                    </div>
                    <button style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '1px solid #e5e7eb', background: d.status === 'uploaded' ? '#f9fafb' : '#ecfdf5', color: d.status === 'uploaded' ? '#6B7280' : '#059669', cursor: 'pointer', flexShrink: 0 }}>
                      {d.status === 'uploaded' ? '查看' : '上传'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
