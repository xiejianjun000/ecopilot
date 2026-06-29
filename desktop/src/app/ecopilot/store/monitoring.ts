/**
 * 自行监测计划 — 行业通用版
 * 数据来源: 许可证 card6(大气排放口) + card10(水排放口) + card14(自行监测要求)
 * 自动任务: card6/card10 中有对应排放口的CEMS在线监测因子
 * 手工任务: 从排放口列表+行业通用规范推断监测因子和频次
 * 许可证读取完成后调用 loadFromPermitData() 自动刷新
 */
import { atom } from 'nanostores'

export type MonitorFreq = 'daily' | 'monthly' | 'quarterly' | 'annual' | 'biennial'

export interface MonitoringTask {
  id: string
  outletCode: string
  outletName: string
  factor: string
  frequency: MonitorFreq
  frequencyLabel: string
  facility: '自动' | '手工'
  dueDates: string[]
}

// ─── 行业通用 — 废气常见手工监测因子 ───
const AIR_MANUAL_FACTORS: Record<MonitorFreq, string[]> = {
  daily: [],
  monthly: ['颗粒物', '二氧化硫', '氮氧化物'],
  quarterly: ['氟化物', '氨', '林格曼黑度', '铅及其化合物', '汞及其化合物', '镉及其化合物'],
  annual: ['二噁英类'],
  biennial: [],
}

// ─── 行业通用 — 废水常见手工监测因子 ───
const WATER_MANUAL_FACTORS: Record<MonitorFreq, string[]> = {
  daily: [],
  monthly: ['化学需氧量', '氨氮', '悬浮物', 'pH', '总磷', '总氮'],
  quarterly: ['石油类', '挥发酚', '氰化物', '总铊', '总铜', '总锌', '总镍', '六价铬', '总铬', '总砷'],
  annual: ['烷基汞'],
  biennial: [],
}

// ─── 行业通用 — 无组织废气监测因子 ───
const FUGITIVE_FACTORS: { factor: string; frequency: MonitorFreq; label: string }[] = [
  { factor: '颗粒物', frequency: 'quarterly', label: '1次/季' },
  { factor: '非甲烷总烃', frequency: 'quarterly', label: '1次/季' },
  { factor: '臭气浓度', frequency: 'annual', label: '1次/年' },
]

// ─── 季度任务分散到各月，避免全部挤在同一天 ───
const QUARTER_MONTHS = [
  { q: 1, months: [1, 2, 3] },
  { q: 2, months: [4, 5, 6] },
  { q: 3, months: [7, 8, 9] },
  { q: 4, months: [10, 11, 12] },
]

/** 根据排放口名称哈希分散季度任务到不同月份，保证分散均匀 */
function outletHash(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return Math.abs(h)
}

function computeDueDates(frequency: MonitorFreq, outletCode: string, factor: string): string[] {
  const year = new Date().getFullYear()
  const dates: string[] = []
  if (frequency === 'daily') return []
  if (frequency === 'monthly') {
    // 分散到每月15日前后
    const day = 14 + (outletHash(outletCode + factor) % 3)
    for (let m = 1; m <= 12; m++) dates.push(`${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
    return dates
  }
  if (frequency === 'quarterly') {
    const offset = outletHash(outletCode + factor) % 3
    const day = 14 + (outletHash(factor + outletCode) % 3)
    for (const qm of QUARTER_MONTHS) {
      const month = qm.months[offset]
      dates.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
    }
    return dates
  }
  if (frequency === 'annual') {
    const month = 3 + (outletHash(outletCode + factor) % 10)
    dates.push(`${year}-${String(month).padStart(2, '0')}-01`)
    return dates
  }
  if (frequency === 'biennial') {
    if (year % 2 === 1) dates.push(`${year}-06-15`)
    return dates
  }
  return dates
}

// ─── 区分的排放口径向类型 ───
function classifyOutlet(name: string, code: string): 'air' | 'water' | 'fugitive' | 'noise' {
  if (code.startsWith('DW')) return 'water'
  if (code.startsWith('DN')) return 'noise'
  if (/厂界|无组织|车间/.test(name)) return 'fugitive'
  if (code.startsWith('DA')) return 'air'
  return 'air'
}

// ─── 从许可证数据生成监测任务（行业通用） ───

export interface PermitOutlet {
  code: string
  name: string
  type?: string
  limits?: { factor: string; limit: number; unit: string }[]
}

export function generateTasksFromOutlets(outlets: PermitOutlet[]): MonitoringTask[] {
  const tasks: MonitoringTask[] = []
  if (!outlets || outlets.length === 0) return tasks

  for (const o of outlets) {
    const kind = classifyOutlet(o.name, o.code)

    if (kind === 'air' || kind === 'fugitive') {
      // ── 废气排放口 ──
      const hasCEMS = o.limits && o.limits.length > 0
      const cemsFactors = new Set(
        (o.limits || []).filter(l => ['颗粒物', '二氧化硫', '氮氧化物'].includes(l.factor)).map(l => l.factor)
      )

      // 自动监测（CEMS在线）— 有对应许可限值的就是在线监测因子
      for (const f of cemsFactors) {
        tasks.push({
          id: `auto-${o.code}-${f}`,
          outletCode: o.code,
          outletName: o.name,
          factor: f,
          frequency: 'daily',
          frequencyLabel: 'CEMS连续自动',
          facility: '自动',
          dueDates: [],
        })
      }

      // 手工监测 — 废气通用因子
      for (const freq of ['monthly', 'quarterly', 'annual', 'biennial'] as MonitorFreq[]) {
        const factors = kind === 'fugitive'
          ? FUGITIVE_FACTORS.filter(f => f.frequency === freq).map(f => f.factor)
          : AIR_MANUAL_FACTORS[freq].filter(f => f !== '林格曼黑度' || o.name.includes('发电'))

        for (const f of factors) {
          // 避免和自动监测重复
          if (cemsFactors.has(f) && freq !== 'annual') continue
          const label = FREQ_LABEL_MAP[freq] || freq
          tasks.push({
            id: `manual-${o.code}-${f}`,
            outletCode: o.code,
            outletName: o.name,
            factor: f,
            frequency: freq,
            frequencyLabel: label,
            facility: '手工',
            dueDates: computeDueDates(freq, o.code, f),
          })
        }
      }
    } else if (kind === 'water') {
      // ── 废水排放口 ──
      const hasOnlineCOD = (o.limits || []).some(l => l.factor === '化学需氧量')
      const hasOnlineNH3 = (o.limits || []).some(l => l.factor === '氨氮')

      if (hasOnlineCOD) {
        tasks.push({
          id: `auto-${o.code}-COD`, outletCode: o.code, outletName: o.name,
          factor: '化学需氧量', frequency: 'daily', frequencyLabel: 'CEMS连续自动',
          facility: '自动', dueDates: [],
        })
      }
      if (hasOnlineNH3) {
        tasks.push({
          id: `auto-${o.code}-氨氮`, outletCode: o.code, outletName: o.name,
          factor: '氨氮', frequency: 'daily', frequencyLabel: 'CEMS连续自动',
          facility: '自动', dueDates: [],
        })
      }

      for (const freq of ['monthly', 'quarterly', 'annual', 'biennial'] as MonitorFreq[]) {
        for (const f of WATER_MANUAL_FACTORS[freq]) {
          if ((f === '化学需氧量' && hasOnlineCOD) || (f === '氨氮' && hasOnlineNH3)) continue
          const label = FREQ_LABEL_MAP[freq] || freq
          tasks.push({
            id: `manual-${o.code}-${f}`,
            outletCode: o.code,
            outletName: o.name,
            factor: f,
            frequency: freq,
            frequencyLabel: label,
            facility: '手工',
            dueDates: computeDueDates(freq, o.code, f),
          })
        }
      }
    }
  }

  return tasks
}

const FREQ_LABEL_MAP: Record<MonitorFreq, string> = {
  daily: 'CEMS连续自动',
  monthly: '1次/月',
  quarterly: '1次/季',
  annual: '1次/年',
  biennial: '1次/两年',
}

// ─── Store ───

export const $monitoringTasks = atom<MonitoringTask[]>([])

/** 从许可证数据加载监测任务 */
export function loadMonitoringFromPermit(outlets: PermitOutlet[]) {
  const tasks = generateTasksFromOutlets(outlets)
  $monitoringTasks.set(tasks)
}

/** 清空（许可证切换时） */
export function clearMonitoringTasks() {
  $monitoringTasks.set([])
}

/** 按频次分组统计 */
export function getMonitorStats() {
  const tasks = $monitoringTasks.get()
  return {
    daily: tasks.filter(t => t.frequency === 'daily').length,
    monthly: tasks.filter(t => t.frequency === 'monthly').length,
    quarterly: tasks.filter(t => t.frequency === 'quarterly').length,
    annual: tasks.filter(t => t.frequency === 'annual').length,
    biennial: tasks.filter(t => t.frequency === 'biennial').length,
  }
}

/** 获取指定月份的手工监测任务 */
export function getMonthTasks(month: number): MonitoringTask[] {
  const mStr = String(month).padStart(2, '0')
  return $monitoringTasks.get().filter(t =>
    t.dueDates.some(d => d.includes(`-${mStr}-`))
  )
}
