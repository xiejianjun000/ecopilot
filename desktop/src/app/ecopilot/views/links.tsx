/** 政务平台快捷入口 */
import { Icon } from '../../../components/ui/icon'
import FadeContent from '../../../components/react-bits/Animations/FadeContent/FadeContent'

const PLATFORMS = [
  { n:'全国排污许可证管理信息平台', i:'file-text' as const, s:'ready' as const },
  { n:'全国污染源监测信息管理平台', i:'chart-bar' as const, s:'ready' as const },
  { n:'全国碳排放权交易市场', i:'leaf' as const, s:'offline' as const },
  { n:'全国固体废物管理信息系统', i:'recycle' as const, s:'unknown' as const },
  { n:'环境影响评价信用平台', i:'file-description' as const, s:'offline' as const },
]

export function LinksView() {
  return (<FadeContent duration={500} blur><div className="page-view"><h2><Icon name="link" size={18} /> 政务平台</h2>
    <div className="platform-grid mt-4">
      {PLATFORMS.map((x, i) => (
        <div key={i} className="platform-card">
          <Icon name={x.i} size={24} />
          <span className="platform-card__name">{x.n}</span>
          <span className={`platform-card__status platform-card__status--${x.s}`}>
            {x.s === 'ready' ? <><Icon name="check-circle" size={12} /> 可填报</> : x.s === 'offline' ? <><Icon name="x-circle" size={12} /> 不可达</> : <><Icon name="help-circle" size={12} /> 待确认</>}
          </span>
        </div>
      ))}
    </div></div></FadeContent>)
}
