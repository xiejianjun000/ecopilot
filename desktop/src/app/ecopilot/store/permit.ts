/**
 * EcoPilot 许可证和合规状态
 */

import { atom, computed } from 'nanostores'
import type { PermitInfo } from '../lib/permit-parser'
import { daysUntilExpiry, getExpiryStatus } from '../lib/permit-parser'

export interface ComplianceStatus {
  /** 许可证信息 */
  permit: PermitInfo | null
  /** 上次巡检时间 */
  lastAuditTime: string | null
  /** 待处理事项数量 */
  pendingCount: number
  /** 紧急事项数量 */
  urgentCount: number
  /** 档案完整度（百分比） */
  docCompleteness: number
  /** 已学技能数量 */
  learnedSkillsCount: number
  /** 已沉淀记忆条数 */
  memoryCount: number
  /** 排放超标告警 */
  emissionAlerts: EmissionAlert[]
}

export interface EmissionAlert {
  id: string
  outlet: string
  factor: string
  currentValue: number
  limit: number
  unit: string
  duration: string
  severity: 'warning' | 'critical'
}

const initialState: ComplianceStatus = {
  permit: null,
  lastAuditTime: null,
  pendingCount: 0,
  urgentCount: 0,
  docCompleteness: 0,
  learnedSkillsCount: 0,
  memoryCount: 0,
  emissionAlerts: [],
}

export const $compliance = atom<ComplianceStatus>(initialState)

/** 许可证剩余天数 */
export const $permitDaysRemaining = computed($compliance, c => {
  if (!c.permit?.validTo) return 0
  return daysUntilExpiry(c.permit.validTo)
})

/** 许可证到期状态 */
export const $permitExpiryStatus = computed($permitDaysRemaining, days => getExpiryStatus(days))

/** 是否有紧急事项 */
export const $hasUrgentItems = computed($compliance, c => c.urgentCount > 0)

/** 设置许可证信息 */
export function setPermit(permit: PermitInfo): void {
  const state = $compliance.get()
  $compliance.set({ ...state, permit })
}

/** 更新合规状态 */
export function updateCompliance(updates: Partial<ComplianceStatus>): void {
  const state = $compliance.get()
  $compliance.set({ ...state, ...updates })
}

/** 添加排放告警 */
export function addEmissionAlert(alert: EmissionAlert): void {
  const state = $compliance.get()
  $compliance.set({
    ...state,
    emissionAlerts: [...state.emissionAlerts, alert],
    pendingCount: state.pendingCount + 1,
    urgentCount: alert.severity === 'critical' ? state.urgentCount + 1 : state.urgentCount,
  })
}

/** 清除排放告警 */
export function clearEmissionAlert(id: string): void {
  const state = $compliance.get()
  $compliance.set({
    ...state,
    emissionAlerts: state.emissionAlerts.filter(a => a.id !== id),
  })
}

/** 从冷钢真实数据加载默认合规状态（开发/演示用） */
export function loadDemoCompliance(): void {
  const demoPermit: PermitInfo = {
    enterpriseName: '冷水江钢铁有限责任公司',
    creditCode: '',
    permitNumber: '91431381748373560G001P',
    issuingAuthority: '娄底市生态环境局',
    issueDate: '2021-08-15',
    validFrom: '2021-08-15',
    validTo: '2026-08-15',
    industryCategory: '黑色金属冶炼和压延加工业',
    industryCode: '',
    managementLevel: '重点管理',
    address: '湖南省娄底市冷水江市',
    legalRepresentative: '',
    emissionOutlets: [
      {
        code: 'DA001',
        name: '烧结机头烟囱',
        type: '主要',
        limits: [
          { factor: 'SO₂', limit: 35, unit: 'mg/m³', standardSource: 'DB43/3082-2024' },
          { factor: 'NOx', limit: 50, unit: 'mg/m³', standardSource: 'DB43/3082-2024' },
          { factor: '颗粒物', limit: 10, unit: 'mg/m³', standardSource: 'DB43/3082-2024' },
        ],
      },
      {
        code: 'DA002',
        name: '炼铁出铁场',
        type: '主要',
        limits: [
          { factor: '颗粒物', limit: 10, unit: 'mg/m³', standardSource: 'GB 28663-2012' },
        ],
      },
      {
        code: 'DA003',
        name: '炼钢转炉',
        type: '主要',
        limits: [
          { factor: '颗粒物', limit: 10, unit: 'mg/m³', standardSource: 'GB 28664-2012' },
        ],
      },
    ],
    managementRequirements: [
      { category: '自行监测', content: '制定自行监测方案，报生态环境主管部门备案', frequency: '每年' },
      { category: '台账记录', content: '生产设施和污染防治设施运行台账', frequency: '每日' },
      { category: '执行报告', content: '年度执行报告', frequency: '次年1月31日前' },
      { category: '执行报告', content: '季度执行报告', frequency: '每季度结束后15日内' },
      { category: '信息公开', content: '在国家和地方平台公开执行报告', frequency: '及时' },
    ],
  }

  $compliance.set({
    permit: demoPermit,
    lastAuditTime: '2026-06-25T22:00:00',
    pendingCount: 3,
    urgentCount: 1,
    docCompleteness: 65,
    learnedSkillsCount: 8,
    memoryCount: 42,
    emissionAlerts: [
      {
        id: 'alert-1',
        outlet: '总排放口',
        factor: 'NH3-N',
        currentValue: 15,
        limit: 12,
        unit: 'mg/L',
        duration: '连续7天',
        severity: 'critical',
      },
    ],
  })
}
