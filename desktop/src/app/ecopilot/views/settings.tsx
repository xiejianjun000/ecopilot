/** 设置页面 */
import { Icon } from '../../../components/ui/icon'
import FadeContent from '../../../components/react-bits/Animations/FadeContent/FadeContent'

export function SettingsView() {
  return (<FadeContent duration={500} blur><div className="page-view"><h2><Icon name="settings" size={18} /> 设置</h2>
    <div className="settings-sections mt-4">
      <div className="rounded-xl border bg-card p-4 mb-4">
        <h3 className="text-sm font-semibold mb-3"><Icon name="user" size={14} /> 账号</h3>
        <div className="settings-row"><span className="text-sm text-muted-foreground">企业</span><span className="text-sm font-medium">冷水江钢铁</span></div>
        <div className="settings-row"><span className="text-sm text-muted-foreground">许可证</span><span className="text-sm font-medium">9143...001P</span></div>
        <div className="settings-row"><span className="text-sm text-muted-foreground">用户</span><span className="text-sm font-medium">军哥</span></div>
      </div>
      <div className="rounded-xl border bg-card p-4 mb-4">
        <h3 className="text-sm font-semibold mb-3"><Icon name="cpu" size={14} /> 模型</h3>
        <div className="settings-row"><span className="text-sm text-muted-foreground">默认模型</span><span className="text-sm font-medium">DeepSeek-Chat</span></div>
        <div className="settings-row"><span className="text-sm text-muted-foreground">提供商</span><span className="text-sm font-medium">DeepSeek</span></div>
      </div>
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3"><Icon name="palette" size={14} /> 外观</h3>
        <div className="settings-row"><span className="text-sm text-muted-foreground">主题</span>
          <select className="text-sm border rounded-md px-2 py-1"><option>浅色</option><option>深色</option></select>
        </div>
      </div>
    </div></div></FadeContent>)
}
