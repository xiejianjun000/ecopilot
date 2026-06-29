/** 设置 — macOS 风格 · 极简留白 · 青绿 · 居中开关 */
import { useState } from 'react'
import { Icon } from '../../../components/ui/icon'

type Tab = 'account' | 'model' | 'platform' | 'general' | 'appearance' | 'about'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'account', label: '通用', icon: 'user' },
  { key: 'model', label: '模型', icon: 'cpu' },
  { key: 'platform', label: '平台', icon: 'globe' },
  { key: 'general', label: '软件', icon: 'settings' },
  { key: 'appearance', label: '外观', icon: 'palette' },
  { key: 'about', label: '关于', icon: 'info-circle' },
]

const Toggle = ({ on }: { on: boolean }) => (
  <div style={{
    width: 44, height: 24, borderRadius: 12, cursor: 'pointer',
    background: on ? '#059669' : '#d4d4d4', position: 'relative',
    transition: 'background 0.25s', flexShrink: 0,
  }}>
    <div style={{
      width: 20, height: 20, borderRadius: '50%', background: '#fff',
      position: 'absolute', top: 2, left: on ? 22 : 2,
      transition: 'left 0.25s cubic-bezier(0.23, 1, 0.32, 1)',
      boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
    }} />
  </div>
)

const Card = ({ children, title }: { children: React.ReactNode; title?: string }) => (
  <div style={{ marginBottom: 28 }}>
    {title && (
      <h2 style={{ fontSize: 18, fontWeight: 600, color: '#1d1d1f', marginBottom: 16, letterSpacing: '-0.02em' }}>
        {title}
      </h2>
    )}
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8ed', overflow: 'hidden' }}>
      {children}
    </div>
  </div>
)

const Row = ({ label, desc, children, border = true }: {
  label: string; desc?: string; children: React.ReactNode; border?: boolean
}) => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 20px', minHeight: 48,
    borderBottom: border ? '1px solid #f0f0f0' : 'none',
  }}>
    <div style={{ flex: 1, paddingRight: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 500, color: '#1d1d1f', letterSpacing: '-0.01em' }}>{label}</div>
      {desc && <div style={{ fontSize: 11.5, color: '#86868b', marginTop: 2 }}>{desc}</div>}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{children}</div>
  </div>
)

export function SettingsView() {
  const [tab, setTab] = useState<Tab>('account')

  return (
    <div style={{ display: 'flex', height: '100%', background: '#f5f5f7', fontFamily: "-apple-system,'SF Pro Display','PingFang SC','Helvetica Neue',sans-serif" }}>
      {/* ─── 侧栏 ─── */}
      <div style={{ width: 200, flexShrink: 0, padding: '28px 0 0 20px' }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#1d1d1f', letterSpacing: '-0.03em', marginBottom: 24, paddingLeft: 8 }}>
          设置
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {TABS.map(s => {
            const active = tab === s.key
            return (
              <button key={s.key} onClick={() => setTab(s.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', borderRadius: 8,
                  fontSize: 13.5, fontWeight: active ? 600 : 400, border: 'none', cursor: 'pointer',
                  background: active ? 'rgba(5,150,105,0.08)' : 'transparent',
                  color: active ? '#059669' : '#515154',
                  textAlign: 'left', width: '100%', transition: 'all 0.12s',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#efeff1' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
              >
                <Icon name={s.icon} size={17} color={active ? '#059669' : '#86868b'} />
                {s.label}
              </button>
            )
          })}
        </nav>
      </div>

      {/* ─── 内容 ─── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '36px 40px 60px', maxWidth: 720 }}>
        {tab === 'account' && <AccountSettings />}
        {tab === 'model' && <ModelSettings />}
        {tab === 'platform' && <PlatformSettings />}
        {tab === 'general' && <GeneralSettings />}
        {tab === 'appearance' && <AppearanceSettings />}
        {tab === 'about' && <AboutSettings />}
      </div>
    </div>
  )
}

function AccountSettings() {
  const [name, setName] = useState('军哥')

  return (
    <Card title="通用">
      {/* 头像行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '20px 20px 16px', borderBottom: '1px solid #f0f0f0' }}>
        <div style={{
          width: 52, height: 52, borderRadius: '50%',
          background: 'linear-gradient(135deg, #059669, #34d399)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 20, fontWeight: 600, flexShrink: 0,
        }}>谢</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1d1d1f' }}>军哥</div>
          <div style={{ fontSize: 12, color: '#86868b', marginTop: 1 }}>环保专员 · 冷水江钢铁</div>
        </div>
        <button style={{
          padding: '6px 16px', borderRadius: 20, border: '1px solid #d4d4d4',
          background: '#fff', fontSize: 12, color: '#515154', cursor: 'pointer',
        }}>编辑</button>
      </div>

      <Row label="企业名称" desc="统一社会信用代码 91431381748373560G">
        <span style={{ fontSize: 13, color: '#515154' }}>冷水江钢铁有限责任公司</span>
      </Row>
      <Row label="排污许可证编号">
        <span style={{ fontSize: 13, color: '#515154' }}>9143…001P</span>
      </Row>
      <Row label="法定代表人">
        <span style={{ fontSize: 13, color: '#515154' }}>陈代富</span>
      </Row>
      <Row label="联系电话" desc="用于接收平台告警通知">
        <span style={{ fontSize: 13, color: '#515154' }}>18692488688</span>
      </Row>
      <Row label="联系人" border={false}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input value={name} onChange={e => setName(e.target.value)}
            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #d4d4d4', fontSize: 13, outline: 'none', width: 100 }} />
          <button style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: '#059669', color: '#fff', fontSize: 12, cursor: 'pointer' }}>保存</button>
        </div>
      </Row>
    </Card>
  )
}

function ModelSettings() {
  const [model, setModel] = useState('deepseek-v4-flash')
  return (
    <Card title="模型">
      <Row label="对话模型" desc="AI 推理使用的模型">
        <select value={model} onChange={e => setModel(e.target.value)}
          style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #d4d4d4', fontSize: 13, background: '#fff', minWidth: 160 }}>
          <option value="deepseek-v4-flash">DeepSeek V4 Flash</option>
          <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
          <option value="moonshot-v1-32k-vision">Kimi 32K Vision</option>
        </select>
      </Row>
      <Row label="视觉模型" desc="识别图片、验证码等">
        <span style={{ fontSize: 13, color: '#515154' }}>Moonshot 32K Vision</span>
      </Row>
      <Row label="API Key" desc="DeepSeek API 密钥">
        <div style={{ display: 'flex', gap: 6 }}>
          <input type="password" defaultValue="sk-30b6…" style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #d4d4d4', fontSize: 13, width: 160, outline: 'none' }} />
          <button style={{ padding: '5px 14px', borderRadius: 6, border: '1px solid #d4d4d4', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#515154' }}>更新</button>
        </div>
      </Row>
      <Row label="API 地址" border={false}>
        <span style={{ fontSize: 12, color: '#86868b' }}>https://api.deepseek.com</span>
      </Row>
    </Card>
  )
}

function PlatformSettings() {
  const [enabled, setEnabled] = useState({ permit: true, monitor: false, carbon: false, waste: false })
  const toggle = (k: keyof typeof enabled) => setEnabled(p => ({ ...p, [k]: !p[k] }))
  return (
    <Card title="平台">
      {[
        { key: 'permit' as const, label: '排污许可证管理信息平台', desc: '已接入 Playwright 自动登录', on: enabled.permit },
        { key: 'monitor' as const, label: '重点排污单位自动监控平台', desc: 'SSO 接口故障，暂不可用', on: enabled.monitor },
        { key: 'carbon' as const, label: '全国碳排放权交易市场', desc: '需注册碳市场账户', on: enabled.carbon },
        { key: 'waste' as const, label: '固体废物管理信息系统', desc: '未接入自动登录', on: enabled.waste, border: false },
      ].map(p => (
        <div key={p.key} onClick={() => toggle(p.key)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 20px', minHeight: 48, cursor: 'pointer',
            borderBottom: p.border !== false ? '1px solid #f0f0f0' : 'none',
          }}>
          <div style={{ flex: 1, paddingRight: 16 }}>
            <div style={{ fontSize: 13.5, fontWeight: 500, color: '#1d1d1f' }}>{p.label}</div>
            <div style={{ fontSize: 11.5, color: '#86868b', marginTop: 2 }}>{p.desc}</div>
          </div>
          <Toggle on={p.on} />
        </div>
      ))}
    </Card>
  )
}

function GeneralSettings() {
  const [switches, setSwitches] = useState({ boot: true, sync: true, patrol: true, notify: true, advanced: false })
  const toggle = (k: keyof typeof switches) => setSwitches(p => ({ ...p, [k]: !p[k] }))
  return (
    <Card title="软件">
      {[
        { key: 'boot' as const, label: '开机启动', desc: '系统启动时自动运行 EcoPilot', on: switches.boot },
        { key: 'sync' as const, label: '云端同步', desc: '合规数据自动同步', on: switches.sync },
        { key: 'patrol' as const, label: '自动巡检', desc: '每日自动检查平台合规状态', on: switches.patrol },
        { key: 'notify' as const, label: '消息通知', desc: '合规告警和任务完成推送', on: switches.notify },
        { key: 'advanced' as const, label: '高级功能', desc: '启用实验性功能', on: switches.advanced, border: false },
      ].map(s => (
        <div key={s.key} onClick={() => toggle(s.key)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 20px', minHeight: 48, cursor: 'pointer',
            borderBottom: s.border !== false ? '1px solid #f0f0f0' : 'none',
          }}>
          <div style={{ flex: 1, paddingRight: 16 }}>
            <div style={{ fontSize: 13.5, fontWeight: 500, color: '#1d1d1f' }}>{s.label}</div>
            {s.desc && <div style={{ fontSize: 11.5, color: '#86868b', marginTop: 2 }}>{s.desc}</div>}
          </div>
          <Toggle on={s.on} />
        </div>
      ))}
    </Card>
  )
}

function AppearanceSettings() {
  const [theme, setTheme] = useState('light')
  const [fontSize, setFontSize] = useState(14)

  return (
    <Card title="外观">
      <Row label="主题">
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { key: 'light', label: '浅色' },
            { key: 'dark', label: '深色' },
            { key: 'auto', label: '自动' },
          ].map(t => (
            <button key={t.key} onClick={() => setTheme(t.key)}
              style={{
                padding: '5px 16px', borderRadius: 20, border: '1px solid',
                borderColor: theme === t.key ? '#059669' : '#d4d4d4',
                background: theme === t.key ? 'rgba(5,150,105,0.08)' : '#fff',
                color: theme === t.key ? '#059669' : '#515154',
                fontSize: 12.5, fontWeight: theme === t.key ? 600 : 400,
                cursor: 'pointer', transition: 'all 0.12s',
              }}>{t.label}</button>
          ))}
        </div>
      </Row>
      <Row label="字体大小" border={false}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: 200 }}>
          <span style={{ fontSize: 12, color: '#86868b' }}>A</span>
          <input type="range" min={12} max={20} value={fontSize} onChange={e => setFontSize(+e.target.value)}
            style={{ flex: 1, accentColor: '#059669', height: 3 }} />
          <span style={{ fontSize: 18, color: '#86868b' }}>A</span>
        </div>
      </Row>
    </Card>
  )
}

function AboutSettings() {
  return (
    <Card title="关于">
      <div style={{ textAlign: 'center', padding: '28px 20px 24px', borderBottom: '1px solid #f0f0f0' }}>
        <div style={{
          width: 64, height: 64, borderRadius: 18,
          background: 'linear-gradient(135deg, #059669, #34d399)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 14px', fontSize: 28, color: '#fff',
        }}>
          <Icon name="leaf" size={32} />
        </div>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1d1d1f', letterSpacing: '-0.02em' }}>EcoPilot</h3>
        <p style={{ fontSize: 13, color: '#86868b', marginTop: 2 }}>企业生态环境合规 AI 管家 · 1.0.0</p>
        <button style={{
          marginTop: 12, padding: '6px 24px', borderRadius: 20,
          border: '1px solid #d4d4d4', background: '#fff',
          fontSize: 12, color: '#515154', cursor: 'pointer',
        }}>已是最新版本</button>
      </div>

      <div style={{ padding: 0 }}>
        {[
          { label: '版本日志', color: true },
          { label: '意见反馈', color: true },
          { label: '服务协议', color: false },
          { label: '隐私保护', color: false },
          { label: '开源许可', color: false },
        ].map((item, i) => (
          <div key={i}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 20px', cursor: 'pointer',
              borderBottom: i < 4 ? '1px solid #f0f0f0' : 'none',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#f5f5f7'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <span style={{ fontSize: 13.5, color: item.color ? '#059669' : '#1d1d1f' }}>{item.label}</span>
            <span style={{ color: '#c7c7cc', fontSize: 14 }}>›</span>
          </div>
        ))}
      </div>
    </Card>
  )
}
