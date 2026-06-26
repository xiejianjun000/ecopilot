/** 连接器管理 */
import { Icon } from '../../../components/ui/icon'
import FadeContent from '../../../components/react-bits/Animations/FadeContent/FadeContent'

export function ConnectorView() {
  const conns = [{n:'飞书',i:'message',s:'online'},{n:'GitHub',i:'code',s:'online'},{n:'Obsidian',i:'notes',s:'offline'}]
  return (<FadeContent duration={500} blur><div className="page-view"><h2><Icon name="plug-connected" size={18} /> 连接器</h2>
    <div className="connector-list mt-4">
      {conns.map(c => (
        <div key={c.n} className={`connector-item ${c.s === 'online' ? 'connector-item--active' : ''}`}>
          <Icon name={c.i} size={18} />
          <span>{c.n}</span>
          <span className={`status-badge status-badge--${c.s}`}>{c.s === 'online' ? '已连接' : '未连接'}</span>
        </div>
      ))}
    </div></div></FadeContent>)
}
