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

// ── 默认演示数据（内联以避开导出函数 hoisting 问题） ──
const DEMO_PERMIT: PermitInfo = {
  enterpriseName: '冷水江钢铁有限责任公司',
  creditCode: '91431381748373560G',
  permitNumber: '91431381748373560G001P',
  issuingAuthority: '娄底市生态环境局',
  issueDate: '2021-08-15',
  validFrom: '2021-08-15',
  validTo: '2026-08-15',
  industryCategory: '黑色金属冶炼和压延加工业',
  industryCode: 'C31',
  managementLevel: '重点管理',
  address: '湖南省娄底市冷水江市轧钢路',
  legalRepresentative: '陈代富',
  phone: '18692488688',
  email: 'yuanbin0039@163.com',
  province: '湖南省',
  city: '娄底市',
  county: '冷水江市',
  secondaryIndustry: '火力发电,锅炉',
  executionReportStatus: '2025/12月+Q4待补，2022年报已提交',
  permitStatus: '2026-04-07 重新申请，补正中',
  permitApplyDate: '2026-04-07',
  monitoringStatus: 'SSO接口故障(405)',
  rectificationStatus: '功能未启用',
  emissionOutlets: [
    { code: 'DA001', name: '烧结机头烟囱', type: '主要',
      latitude: 27.6867, longitude: 111.4356,
      limits: [
        { factor: 'SO₂', limit: 35, unit: 'mg/m³', standardSource: 'DB43/3082-2024' },
        { factor: 'NOx', limit: 50, unit: 'mg/m³', standardSource: 'DB43/3082-2024' },
        { factor: '颗粒物', limit: 10, unit: 'mg/m³', standardSource: 'DB43/3082-2024' },
      ]},
    { code: 'DA002', name: '高炉出铁场除尘', type: '主要',
      latitude: 27.6875, longitude: 111.4348,
      limits: [{ factor: '颗粒物', limit: 10, unit: 'mg/m³', standardSource: 'GB 28663-2012' }]},
    { code: 'DA003', name: '转炉二次除尘', type: '主要',
      latitude: 27.6882, longitude: 111.4361,
      limits: [{ factor: '颗粒物', limit: 10, unit: 'mg/m³', standardSource: 'GB 28664-2012' }]},
    { code: 'DW001', name: '综合废水排放口', type: '主要',
      latitude: 27.6860, longitude: 111.4328,
      limits: [
        { factor: 'COD', limit: 60, unit: 'mg/L', standardSource: 'GB 13456-2012' },
        { factor: 'NH₃-N', limit: 8, unit: 'mg/L', standardSource: 'GB 13456-2012' },
      ]},
  ],
  managementRequirements: [
    { category: '自行监测', content: '烧结机头SO₂/NOx/颗粒物自动监测，氟化物季度，二噁英年。废水COD/NH₃-N自动监测', frequency: '按HJ 878-2017' },
    { category: '台账记录', content: '5类台账：生产设施运行(日)、治污设施运行(日)、监测(按频次)、燃料分析(批)、固废(日)', frequency: '按HJ 944-2018' },
    { category: '执行报告', content: '月报(次月10日)、季报(季度结束15日)、年报(次年1月31日)', frequency: '条例§22' },
    { category: '信息公开', content: '在国家和地方平台公开执行报告', frequency: '每年' },
  ],
  reapplicationHistory: [
    { index: '1', name: '冷水江钢铁', status: '补正', date: '', actions: '' },
    { index: '2', name: '冷水江钢铁', status: '审批通过', date: '2024-09-09', actions: '' },
    { index: '3', name: '冷水江钢铁', status: '审批通过', date: '2023-11-28', actions: '' },
    { index: '4', name: '冷水江钢铁', status: '审批通过', date: '2023-09-04', actions: '' },
  ],
  renewalHistory: [{ index: '1', name: '冷水江钢铁', status: '审批通过', date: '2021-01-22', actions: '' }],
  publicInfoHistory: [
    { index: '1', status: '取消发布', date: '2018-01-03' },
    { index: '2', status: '发布结束', date: '2025-11-27' },
  ],
}

const initialState: ComplianceStatus = {
  permit: DEMO_PERMIT,
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

/** 从真实抓取数据加载合规状态 */
export function loadRealPermit(permit: PermitInfo): void {
  setPermit(permit)

  // 从真实平台数据计算待处理/紧急事项
  let pending = 0
  let urgent = 0

  // 执行报告逾期 → 紧急
  if (permit.executionReportStatus && permit.executionReportStatus.includes('尽快提交')) {
    pending++
    urgent++
  }
  // 重新申请有补正 → 需关注
  const reapply = permit.reapplicationHistory || []
  if (reapply.some(r => r.status === '补正')) {
    pending++
  }
  // 延续过期 → 紧急
  const daysLeft = permit.validTo ? daysUntilExpiry(permit.validTo) : 9999
  if (daysLeft <= 30) {
    pending++
    urgent++
  } else if (daysLeft <= 90) {
    pending++
  }
  // 信息公开是否有未处理的
  const pubInfo = permit.publicInfoHistory || []
  if (pubInfo.some(r => r.status === '取消发布')) {
    // 取消发布非紧急，仅提醒
  }

  // 档案完整度：有企业名=基础，有许可证号=完整，有电话/邮箱=更完整
  let docPct = 40
  if (permit.enterpriseName) docPct = 55
  if (permit.permitNumber) docPct = 70
  if (permit.phone && permit.email) docPct = 85
  if (permit.emissionOutlets?.length > 0 && permit.managementRequirements?.length > 0) docPct = 95

  updateCompliance({
    lastAuditTime: new Date().toISOString(),
    pendingCount: pending,
    urgentCount: urgent,
    docCompleteness: docPct,
  })
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
    creditCode: '91431381748373560G',
    permitNumber: '91431381748373560G001P',
    issuingAuthority: '娄底市生态环境局',
    issueDate: '2021-08-15',
    validFrom: '2021-08-15',
    validTo: '2026-08-15',
    industryCategory: '黑色金属冶炼和压延加工业',
    industryCode: 'C31',
    managementLevel: '重点管理',
    address: '湖南省娄底市冷水江市轧钢路',
    legalRepresentative: '陈代富',

    // ── 平台真实提取的扩展字段 ──
    phone: '18692488688',
    email: 'yuanbin0039@163.com',
    postalCode: '417500',
    province: '湖南省',
    city: '娄底市',
    county: '冷水江市',
    secondaryIndustry: '火力发电,锅炉',
    enterpriseId: '2d3ee2db-0e80-4ec4-a3d7-322aeafc580e',

    // ── 合规状态 ──
    executionReportStatus: '2022年报已提交(2023-08-03)，2025/12月+Q4待补',
    permitStatus: '2026-04-07 提交重新申请，当前补正',
    permitApplyDate: '2026-04-07',
    monitoringStatus: 'SSO接口故障(405)',
    rectificationStatus: '功能未启用',

    // ── 许可证载明数据 ──
    // 中心坐标: 111°26′18.85″E, 27°41′26.34″N
    // 总量: SO₂=7220t/a, NOx=3090t/a, COD=21.5t/a
    // 重金属特别限值区域
    // 环评文件: 6项审批文件

    emissionOutlets: [
      {
        code: 'DA001',
        name: '烧结机头烟囱',
        type: '主要',
        latitude: 27.6867,
        longitude: 111.4356,
        limits: [
          { factor: 'SO₂', limit: 35, unit: 'mg/m³', standardSource: 'DB43/3082-2024 超低排放' },
          { factor: 'NOx', limit: 50, unit: 'mg/m³', standardSource: 'DB43/3082-2024 超低排放' },
          { factor: '颗粒物', limit: 10, unit: 'mg/m³', standardSource: 'DB43/3082-2024 超低排放' },
        ],
      },
      {
        code: 'DA002',
        name: '高炉出铁场除尘',
        type: '主要',
        latitude: 27.6875,
        longitude: 111.4348,
        limits: [
          { factor: '颗粒物', limit: 10, unit: 'mg/m³', standardSource: 'GB 28663-2012 超低排放' },
        ],
      },
      {
        code: 'DA003',
        name: '转炉二次除尘',
        type: '主要',
        latitude: 27.6882,
        longitude: 111.4361,
        limits: [
          { factor: '颗粒物', limit: 10, unit: 'mg/m³', standardSource: 'GB 28664-2012 超低排放' },
        ],
      },
      {
        code: 'DW001',
        name: '综合废水排放口',
        type: '主要',
        latitude: 27.6860,
        longitude: 111.4328,
        limits: [
          { factor: 'COD', limit: 60, unit: 'mg/L', standardSource: 'GB 13456-2012' },
          { factor: 'NH₃-N', limit: 8, unit: 'mg/L', standardSource: 'GB 13456-2012' },
          { factor: '总氮', limit: 15, unit: 'mg/L', standardSource: 'GB 13456-2012' },
        ],
      },
    ],

    reapplicationHistory: [
      { index: '1', name: '冷水江钢铁', status: '补正', date: '', actions: '继续重新申请' },
      { index: '2', name: '冷水江钢铁', status: '审批通过', date: '2024-09-09', actions: '排放标准变更→DB43/3082-2024' },
      { index: '3', name: '冷水江钢铁', status: '审批通过', date: '2023-11-28', actions: '' },
      { index: '4', name: '冷水江钢铁', status: '审批通过', date: '2023-09-04', actions: '' },
    ],

    renewalHistory: [
      { index: '1', name: '冷水江钢铁', status: '审批通过', date: '2021-01-22', actions: '' },
    ],

    publicInfoHistory: [
      { index: '1', status: '取消发布', date: '2018-01-03' },
      { index: '2', status: '发布结束', date: '2025-11-27' },
      { index: '3', status: '发布结束', date: '2024-08-05' },
      { index: '4', status: '发布结束', date: '2023-11-20' },
      { index: '5', status: '发布结束', date: '2017-12-26' },
    ],

    managementRequirements: [
      { category: '自行监测', content: '烧结机头SO₂/NOx/颗粒物自动监测，氟化物季度，二噁英年。废水COD/NH₃-N自动监测。厂界噪声季度。土壤重金属年度。', frequency: '按HJ 878-2017' },
      { category: '台账记录', content: '生产设施运行(日)、废物处理设施运行(日)、监测信息(按监测频次)、燃料分析(批)、固废管理(日)', frequency: '按HJ 944-2018 附录A' },
      { category: '执行报告', content: '月报(次月10日前)、季报(季度结束15日内)、年报(次年1月31日前)', frequency: '《排污许可管理条例》第22条' },
      { category: '信息公开', content: '在国家和地方平台公开执行报告', frequency: '每年' },
      { category: '其他', content: '重金属特别限值区域，执行DB43/3082-2024，总量SO₂=7220t/a,NOx=3090t/a,COD=21.5t/a', frequency: '持续' },
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

// 数据已内联在 initialState 中，无需额外初始化
