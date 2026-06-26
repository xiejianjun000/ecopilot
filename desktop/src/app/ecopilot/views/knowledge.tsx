/** 知识库 */
import { Icon } from '../../../components/ui/icon'
import FadeContent from '../../../components/react-bits/Animations/FadeContent/FadeContent'

export function KnowledgeView() {
  return (<FadeContent duration={500} blur><div className="page-view"><h2><Icon name="book" size={18} /> 知识库</h2>
    <div className="kb-search"><Icon name="search" size={14} /><input className="kb-search__input" placeholder="搜索法规、标准、案例..." /></div>
    <div className="kb-categories mt-4">
      {[{t:'法律法规',c:'1284',i:'book-2'},{t:'技术标准',c:'956',i:'ruler'},{t:'典型案例',c:'456',i:'clipboard-list'}].map(k => (
        <div key={k.t} className="kb-category">
          <Icon name={k.i} size={20} />
          <div className="kb-category__title">{k.t}</div>
          <div className="kb-category__count">{k.c} 条</div>
        </div>
      ))}
    </div></div></FadeContent>)
}
