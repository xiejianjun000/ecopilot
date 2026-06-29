/** 连接器管理 — 卡片式 */
import { Icon } from '../../../components/ui/icon'

const CONNECTORS = [
  { n:'飞书', i:'message', s:'online', d:'消息通知/审批提醒' },
  { n:'微信', i:'message', s:'offline', d:'消息推送/预警' },
  { n:'短信', i:'message', s:'offline', d:'紧急通知/验证码' },
  { n:'邮件', i:'message', s:'offline', d:'报告推送' },
]

export function ConnectorView() {
  return (
    <div style={{ padding: '20px 24px', overflowY: 'auto', height: '100%', background: '#f7f7f7' }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="plug-connected" size={18} /> 连接器
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {CONNECTORS.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px', borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', minHeight: 80 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: c.s === 'online' ? '#ecfdf5' : '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={c.i} size={20} color={c.s === 'online' ? '#059669' : '#999'} />
            </div>
            <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 500 }}>{c.n}</div><div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{c.d}</div></div>
            <div style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: c.s === 'online' ? '#ecfdf5' : '#f3f4f6', color: c.s === 'online' ? '#059669' : '#999' }}>
              {c.s === 'online' ? '已连接' : '未连接'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
