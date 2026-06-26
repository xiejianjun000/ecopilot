/**
 * EcoPilot 专家状态管理
 *
 * 管理预置专家列表、在线状态、使用统计。
 * 助手是主代理，专家是技能插件（WorkBuddy 模式）。
 */

import { atom, computed } from 'nanostores'

export interface ExpertInfo {
  id: string
  name: string
  desc: string
  icon: string
  color: string
  online: boolean
  /** 使用次数 */
  useCount?: number
  /** 是否已绑定 / 激活 */
  enabled?: boolean
}

const DEFAULT_EXPERTS: ExpertInfo[] = [
  { id: 'ecomind', name: '综合管家', desc: '全链条统筹协调', icon: 'robot', color: '#52c41a', online: true, useCount: 0, enabled: true },
  { id: 'permit', name: '排污许可专家', desc: '许可证申领/变更/延续', icon: 'file-text', color: '#eb2f96', online: true, useCount: 0, enabled: true },
  { id: 'carbon', name: '碳排放专家', desc: '碳核算/配额/碳市场', icon: 'plant', color: '#595959', online: true, useCount: 0, enabled: true },
  { id: 'env-monitoring', name: '环境监测专家', desc: 'CEMS/自行监测/数据解读', icon: 'chart-bar', color: '#1890ff', online: true, useCount: 0, enabled: true },
  { id: 'compliance', name: '合规巡检专家', desc: '台账管理/自查自纠', icon: 'search', color: '#fa8c16', online: true, useCount: 0, enabled: true },
  { id: 'emergency', name: '应急专家', desc: '应急预案/隐患排查', icon: 'alert-triangle', color: '#f5222d', online: true, useCount: 0, enabled: true },
  { id: 'cleaner', name: '清洁生产专家', desc: '清洁生产/绿色工厂', icon: 'leaf', color: '#237804', online: false, useCount: 0, enabled: false },
]

export const $experts = atom<ExpertInfo[]>(DEFAULT_EXPERTS)

/** 当前在线的专家 */
export const $onlineExperts = computed($experts, list => list.filter(e => e.online))

/** 已启用的专家 */
export const $enabledExperts = computed($experts, list => list.filter(e => e.enabled))

/** 获得专家详情 */
export function getExpert(id: string): ExpertInfo | undefined {
  return $experts.get().find(e => e.id === id)
}

/** 切换专家在线状态 */
export function toggleExpertOnline(id: string): void {
  $experts.set($experts.get().map(e =>
    e.id === id ? { ...e, online: !e.online } : e
  ))
}

/** 切换专家启用状态 */
export function toggleExpertEnabled(id: string): void {
  $experts.set($experts.get().map(e =>
    e.id === id ? { ...e, enabled: !e.enabled } : e
  ))
}

/** 增加专家使用次数 */
export function incrementExpertUse(id: string): void {
  $experts.set($experts.get().map(e =>
    e.id === id ? { ...e, useCount: (e.useCount || 0) + 1 } : e
  ))
}

/** 圆桌会议预置议题 */
export const MEETING_TOPICS = [
  { id: 'permit-renewal', title: '许可证延续会诊', experts: ['permit', 'carbon', 'env-monitoring', 'compliance'] },
  { id: 'carbon-audit', title: '碳排放核查会议', experts: ['carbon', 'ecomind'] },
  { id: 'emergency', title: '超标事故紧急会议', experts: ['env-monitoring', 'emergency', 'compliance'] },
  { id: 'cleaner-production', title: '清洁生产评估', experts: ['cleaner', 'ecomind'] },
]
