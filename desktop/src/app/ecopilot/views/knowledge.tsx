/** 知识库 — 卡片式 */
import { Icon } from '../../../components/ui/icon'

const CATS = [
  { t:'法律法规', c:'1284', i:'book-2', color:'#059669', items:['排污许可管理条例','大气污染防治法','水污染防治法','固体废物污染环境防治法','环境影响评价法'] },
  { t:'技术标准', c:'956', i:'ruler', color:'#2563eb', items:['HJ 878-2017 排污单位自行监测','GB 28663-2012 钢铁烧结','DB43/3082-2024 湖南地标','HJ 944-2018 台账管理','HJ 846-2017 执行报告'] },
  { t:'典型案例', c:'456', i:'clipboard', color:'#d97706', items:['钢铁企业超低排放改造','排污许可证延续申请案例','碳排放核查应对指南','自行监测数据公开'] },
]

export function KnowledgeView() {
  return (
    <div style={{ padding: '20px 24px', overflowY: 'auto', height: '100%', background: '#f7f7f7' }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="book-2" size={18} /> 知识库
      </h2>
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff' }}>
          <Icon name="search" size={16} color="#999" />
          <input placeholder="搜索法规、标准、案例..." style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, background: 'transparent' }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {CATS.map((cat, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 8, background: cat.color + '06' }}>
              <Icon name={cat.i} size={18} color={cat.color} />
              <div><span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{cat.t}</span><span style={{ fontSize: 11, color: '#999', marginLeft: 6 }}>{cat.c} 条</span></div>
            </div>
            <div style={{ padding: '8px 16px 12px' }}>
              {cat.items.map((item, j) => (
                <div key={j} style={{ padding: '8px 0', fontSize: 12, color: '#6B7280', borderBottom: j < cat.items.length - 1 ? '1px solid #f3f4f6' : 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                  onMouseEnter={e => e.currentTarget.style.color = cat.color}
                  onMouseLeave={e => e.currentTarget.style.color = '#6B7280'}>
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: cat.color + '60', flexShrink: 0 }} />
                  {item}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
