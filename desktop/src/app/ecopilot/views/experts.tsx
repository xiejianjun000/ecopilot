/** 专家面板 — 卡片 + 圆桌会议 */
import { useStore } from '@nanostores/react'
import { useState, useCallback } from 'react'
import { $experts, $onlineExperts, toggleExpertEnabled, MEETING_TOPICS, incrementExpertUse, type ExpertInfo } from '../store/experts'
import { Icon } from '../../../components/ui/icon'
import FadeContent from '../../../components/react-bits/Animations/FadeContent/FadeContent'
import Magnet from '../../../components/react-bits/Animations/Magnet/Magnet'

type MeetingPhase = 'idle' | 'summoning' | 'discussing' | 'done'
interface MeetingState { phase: MeetingPhase; topic: string; participants: string[]; summaries: { expertId: string; content: string }[]; conclusion: string }

export function ExpertsView({ onOpenMeeting }: { onOpenMeeting: () => void }) {
  const experts = useStore($experts); const onlineExperts = useStore($onlineExperts)
  const [tab, setTab] = useState<'my' | 'meeting'>('my')
  const [meeting, setMeeting] = useState<MeetingState | null>(null)
  const startMeeting = useCallback((topicId: string) => {
    const topic = MEETING_TOPICS.find(t => t.id === topicId); if (!topic) return
    setMeeting({ phase: 'summoning', topic: topic.title, participants: topic.experts, summaries: [], conclusion: '' })
    setTimeout(() => {
      setMeeting(prev => prev ? { ...prev, phase: 'discussing' } : null)
      topic.experts.forEach((eid, i) => setTimeout(() => {
        incrementExpertUse(eid)
        setMeeting(prev => prev ? { ...prev, summaries: [...prev.summaries, { expertId: eid, content: getReply(eid) }] } : null)
      }, 1500 + i * 1000))
      setTimeout(() => setMeeting(prev => prev ? { ...prev, phase: 'done', conclusion: getConclusion(topic.title) } : null), 1500 + topic.experts.length * 1000 + 800)
    }, 1500)
  }, [])

  return (
    <div className="page-view">
      <div className="page-view__header"><h2><Icon name="users" size={18} /> 专家面板</h2>
        <span className="text-sm text-muted-foreground">{onlineExperts.length}/{experts.length} 在线</span>
      </div>
      <div className="flex gap-1 bg-muted rounded-lg p-1 mb-4 w-fit">
        <button className={`px-3 py-1.5 text-sm rounded-md ${tab === 'my' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'}`} onClick={() => setTab('my')}><Icon name="users" size={14} /> 我的专家</button>
        <button className={`px-3 py-1.5 text-sm rounded-md ${tab === 'meeting' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'}`} onClick={() => setTab('meeting')}><Icon name="messages" size={14} /> 圆桌会议</button>
      </div>
      {tab === 'my' && (
        <div className="expert-grid">
          {experts.map(e => (
            <Magnet key={e.id} padding={8} magnetStrength={25} activeTransition="transform 0.3s">
              <FadeContent duration={400}><div className="expert-card">
                <div className="expert-card__avatar" style={{ background: e.color + '20' }}><Icon name={e.id === 'ecomind' ? 'robot' : e.id === 'permit' ? 'file-text' : e.id === 'carbon' ? 'plant' : e.id === 'env-monitoring' ? 'chart-bar' : e.id === 'compliance' ? 'search' : e.id === 'emergency' ? 'alert-triangle' : 'leaf'} size={18} /></div>
                <div className="expert-card__info">
                  <div className="expert-card__name">{e.name}</div>
                  <div className="expert-card__desc">{e.desc}</div>
                </div>
                <div className={`expert-card__status ${e.online ? 'online' : 'offline'}`} />
              </div></FadeContent>
            </Magnet>
          ))}
        </div>
      )}
      {tab === 'meeting' && !meeting && (
        <div className="space-y-4">
          {MEETING_TOPICS.map(topic => (
            <button key={topic.id} className="flex items-center gap-3 p-4 rounded-xl border bg-card hover:border-emerald-200 hover:bg-emerald-50/30 transition-all text-left w-full" onClick={() => startMeeting(topic.id)}>
              <Icon name="users" size={20} />
              <div><div className="text-sm font-medium">{topic.title}</div>
                <div className="text-xs text-muted-foreground">{topic.experts.map(id => experts.find(e => e.id === id)?.name).filter(Boolean).join('、')}</div></div>
            </button>
          ))}
        </div>
      )}
      {meeting && <MeetingRoom meeting={meeting} experts={experts} onClose={() => setMeeting(null)} />}
    </div>
  )
}

function MeetingRoom({ meeting, experts, onClose }: { meeting: MeetingState; experts: ExpertInfo[]; onClose: () => void }) {
  return (<div className="rounded-xl border bg-card p-6 space-y-4">
    <div className="flex items-center justify-between">
      <div><h2 className="text-lg font-semibold"><Icon name="users" size={16} /> {meeting.topic}</h2>
        <p className="text-sm text-muted-foreground">{meeting.phase === 'summoning' ? '正在召集专家...' : meeting.phase === 'discussing' ? '专家正在分析中...' : '会议结束'}</p></div>
      {meeting.phase === 'done' && <button className="px-3 py-1.5 text-sm rounded-lg border hover:bg-muted" onClick={onClose}>关闭</button>}
    </div>
    {meeting.summaries.map((s, i) => { const ex = experts.find(e => e.id === s.expertId); if (!ex) return null
      return (<FadeContent key={i} duration={400}>
        <div className="flex gap-3 p-3 rounded-lg bg-muted/50">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: ex.color + '20' }}><Icon name={ex.icon} size={16} /></div>
          <div><div className="text-xs font-medium">{ex.name}</div><p className="text-sm mt-0.5">{s.content}</p></div>
        </div></FadeContent>)
    })}
    {meeting.phase === 'done' && meeting.conclusion && (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
        <h3 className="text-sm font-semibold text-emerald-700 mb-2"><Icon name="clipboard-check" size={14} /> 助手总结</h3>
        <p className="text-sm text-emerald-800">{meeting.conclusion}</p></div>
    )}
  </div>)
}

function getReply(id: string): string { const r: Record<string,string> = { permit: '许可证编号9143...001P，有效期至2026-08-15，建议立即启动延续申请。', carbon: '碳配额剩余12,500吨，按当前排放速率可用至9月，不影响延续审批。', 'env-monitoring': 'NH3-N 6月均值15mg/L，超出标准12mg/L，建议先整改再申请延续。', compliance: '上季度有一次未批先建记录，建议处理完毕后再提交延续申请。', emergency: '应急预案在有效期内，建议结合本次情况更新演练记录。', ecomind: '综合评估：优先整改NH3-N超标，同步处理未批先建记录，60天内提交延续申请。' }; return r[id] || '分析中...' }
function getConclusion(t: string): string { return t.includes('许可证') ? '建议优先整改NH3-N超标，同步处理未批先建记录，在60天预警窗口内提交延续申请。' : t.includes('碳排放') ? '当前碳配额充足，建议保持正常排放节奏，关注下半年配额分配政策变化。' : t.includes('超标') ? '已确认NH3-N超标源为烧结脱硫废水处理系统，建议48小时内完成设备检修。' : '会议完成，综合建议已生成。' }
