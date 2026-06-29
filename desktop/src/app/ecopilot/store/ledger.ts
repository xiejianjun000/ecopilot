/**
 * 环境管理台账 — 行业通用版
 * 数据来源: 许可证 card15(台账记录要求) + HJ 944-2018 §4.3
 * 5类台账: 生产设施运行 / 治污设施运行 / 原辅材料消耗 / 固废产生与处置 / 自行监测结果
 * 重点管理→按日/班次记录, 简化管理→按日记录
 * 每周提醒检查补录
 */
import { atom } from 'nanostores'

export type LedgerType =
  | 'production'       // 生产设施运行状况
  | 'treatment'        // 治污设施运行情况
  | 'materials'        // 原辅材料及燃料消耗
  | 'solid_waste'      // 固废产生与处置
  | 'monitoring'       // 自行监测结果

export interface LedgerRecord {
  id: string
  type: LedgerType
  period: string       // 记录周期 "2026-06-23 ~ 2026-06-29" 或 "2026-06"
  status: 'completed' | 'partial' | 'missing'
  lastUpdate: string   // ISO date
  note?: string
}

export const LEDGER_META: Record<LedgerType, { label: string; icon: string; freq: string; rule: string }> = {
  production:    { label: '生产设施运行',   icon: '🏭', freq: '按日/班次', rule: 'HJ 944 §4.3 — 生产负荷、产品产量、运行时间' },
  treatment:     { label: '治污设施运行',   icon: '⚙️',  freq: '按日/班次', rule: 'HJ 944 §4.3 — 药剂投加、运行参数、副产物' },
  materials:     { label: '原辅材料消耗',   icon: '📦', freq: '按批次',     rule: 'HJ 944 §4.3 — 原料/燃料用量、硫份/灰份' },
  solid_waste:   { label: '固废产生处置',   icon: '🗑️',  freq: '每次发生',   rule: 'HJ 944 §4.3 — 种类/数量/去向/处置方式' },
  monitoring:    { label: '自行监测结果',   icon: '📊', freq: '按监测频次', rule: 'HJ 944 §4.3 — 手工监测+在线监测日报' },
}

/** 生成本周台账检查周（YYYY-MM-DD ~ YYYY-MM-DD） */
export function getCurrentWeekRange(): string {
  const now = new Date()
  const dayOfWeek = now.getDay() || 7 // 周日=7
  const monday = new Date(now)
  monday.setDate(now.getDate() - dayOfWeek + 1)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  return `${fmt(monday)} ~ ${fmt(sunday)}`
}

/** 初始化空台账记录 */
function buildDefaultLedger(): LedgerRecord[] {
  const now = new Date().toISOString()
  return Object.keys(LEDGER_META).map(type => ({
    id: `ledger-${type}`,
    type: type as LedgerType,
    period: getCurrentWeekRange(),
    status: 'missing' as const,
    lastUpdate: now,
  }))
}

export const $ledgerRecords = atom<LedgerRecord[]>(
  typeof localStorage !== 'undefined'
    ? JSON.parse(localStorage.getItem('ecopilot-ledger') || 'null') || buildDefaultLedger()
    : buildDefaultLedger()
)

// Save on every change
$ledgerRecords.listen(records => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('ecopilot-ledger', JSON.stringify(records))
  }
})

/** 更新台账状态 */
export function updateLedgerStatus(type: LedgerType, status: LedgerRecord['status'], note?: string) {
  const records = $ledgerRecords.get().map(r =>
    r.type === type
      ? { ...r, status, lastUpdate: new Date().toISOString(), note: note || r.note, period: getCurrentWeekRange() }
      : r
  )
  $ledgerRecords.set(records)
}

/** 新周开始时重置台账 */
export function resetLedgerForNewWeek() {
  const currentRange = getCurrentWeekRange()
  const records = $ledgerRecords.get()
  const firstRecordWeek = records[0]?.period
  if (firstRecordWeek === currentRange) return // 同一周，不重置

  const now = new Date().toISOString()
  $ledgerRecords.set(Object.keys(LEDGER_META).map(type => ({
    id: `ledger-${type}`,
    type: type as LedgerType,
    period: currentRange,
    status: 'missing' as const,
    lastUpdate: now,
  })))
}

/** 获取未完成的台账数 */
export function getLedgerMissingCount(): number {
  return $ledgerRecords.get().filter(r => r.status !== 'completed').length
}

/** 台账完成率 */
export function getLedgerCompletionRate(): number {
  const records = $ledgerRecords.get()
  if (records.length === 0) return 0
  const done = records.filter(r => r.status === 'completed').length
  return Math.round((done / records.length) * 100)
}
