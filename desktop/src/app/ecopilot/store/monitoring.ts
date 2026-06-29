/**
 * 自行监测计划 — 从排污许可平台卡14读取的手工监测要求
 * 按频次分类：自动监测(每日) / 手工监测(每月/每季/每年/每两年)
 * 季度任务分散到各月，避免全部挤在同一天
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

// 季度月份分组：将上百条季度任务分散到各月
const QUARTER_MONTHS = [
  { q: 1, months: [1, 2, 3] },
  { q: 2, months: [4, 5, 6] },
  { q: 3, months: [7, 8, 9] },
  { q: 4, months: [10, 11, 12] },
]

// 按排放区域分配月份偏移
const AREA_MONTH_OFFSET: Record<string, number> = {
  '高炉热风炉': 0,  // Q1→1月, Q2→4月, Q3→7月, Q4→10月
  '轧钢': 1,         // Q1→2月, Q2→5月, Q3→8月, Q4→11月
  '烧结': 2,         // Q1→3月, Q2→6月, Q3→9月, Q4→12月
  '发电': 0,         // Q1→1月
  '废水': 1,         // Q1→2月
  '无组织': 2,       // Q1→3月
  '转炉': 0,         // Q1→1月
  '喷煤': 1,         // 年度
}

function detectArea(name: string): string {
  if (name.includes('高炉')) return '高炉热风炉'
  if (name.includes('轧') || name.includes('高线') || name.includes('950')) return '轧钢'
  if (name.includes('烧结') || name.includes('球团')) return '烧结'
  if (name.includes('发电') || name.includes('发电')) return '发电'
  if (name.includes('废水') || name.includes('雨水')) return '废水'
  if (name.includes('无组织') || name.includes('厂界') || name.includes('车间')) return '无组织'
  if (name.includes('转炉') || name.includes('炼钢')) return '转炉'
  if (name.includes('喷煤')) return '喷煤'
  return '其他'
}

function computeDueDates(frequency: MonitorFreq, outletName: string): string[] {
  const year = new Date().getFullYear()
  const dates: string[] = []

  if (frequency === 'daily') {
    // 自动监测：不加入日历事件，返回空（用状态条显示）
    return []
  }

  if (frequency === 'monthly') {
    for (let m = 1; m <= 12; m++) {
      dates.push(`${year}-${String(m).padStart(2, '0')}-15`)
    }
    return dates
  }

  if (frequency === 'quarterly') {
    const area = detectArea(outletName)
    const offset = AREA_MONTH_OFFSET[area] ?? 0
    const day = 15
    for (const qm of QUARTER_MONTHS) {
      const month = qm.months[offset % 3]
      dates.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
    }
    return dates
  }

  if (frequency === 'annual') {
    const area = detectArea(outletName)
    // 年度任务分散到不同月份
    const monthMap: Record<string, number> = {
      '烧结': 4, '球团': 4, '喷煤': 5, '高炉热风炉': 6,
      '轧钢': 7, '发电': 8, '废水': 9, '无组织': 10, '转炉': 11,
    }
    const m = monthMap[area] ?? 6
    dates.push(`${year}-${String(m).padStart(2, '0')}-01`)
    return dates
  }

  if (frequency === 'biennial') {
    if (year % 2 === 1) dates.push(`${year}-06-01`)
    return dates
  }

  return dates
}

function buildDefaultTasks(): MonitoringTask[] {
  const tasks: MonitoringTask[] = []

  // ═══ 自动监测（每日）═══
  // CEMS在线监测自动运行，日历不显示具体事件，但需要归类
  const autoTasks = [
    { code: 'DA027', name: '1、3号高炉出铁场排放口', factors: ['颗粒物'] },
    { code: 'DA033', name: '5号高炉槽下排放口', factors: ['颗粒物'] },
    { code: 'DA035', name: '1号发电排放口', factors: ['氮氧化物', '二氧化硫', '颗粒物'] },
    { code: 'DA048', name: '烧结脱硫排放口', factors: ['氮氧化物', '二氧化硫', '颗粒物'] },
    { code: 'DA049', name: '烧结机机尾排放口', factors: ['颗粒物'] },
    { code: 'DA050', name: '球团脱硫排放口', factors: ['氮氧化物', '二氧化硫', '颗粒物'] },
    { code: 'DA052', name: '3号转炉二次除尘排放口', factors: ['颗粒物'] },
  ]
  for (const a of autoTasks) {
    for (const f of a.factors) {
      tasks.push({
        id: `auto-${a.code}-${f}`, outletCode: a.code, outletName: a.name,
        factor: f, frequency: 'daily', frequencyLabel: '4次/日（自动）',
        facility: '自动', dueDates: [],
      })
    }
  }

  // DA036-040 长期停产自动监测暂缓
  const shutdownAuto = [
    { code: 'DA036', name: '2号发电排放口', factors: ['氮氧化物', '二氧化硫', '颗粒物'] },
    { code: 'DA037', name: '3号发电排放口', factors: ['氮氧化物', '二氧化硫', '颗粒物'] },
    { code: 'DA039', name: '5号发电排放口', factors: ['氮氧化物', '二氧化硫', '颗粒物'] },
    { code: 'DA040', name: '4号高炉出铁场排放口', factors: ['颗粒物'] },
  ]
  for (const a of shutdownAuto) {
    for (const f of a.factors) {
      tasks.push({
        id: `auto-${a.code}-${f}`, outletCode: a.code, outletName: a.name + '(长期停产)',
        factor: f, frequency: 'daily', frequencyLabel: '暂缓（长期停产）',
        facility: '自动', dueDates: [],
      })
    }
  }

  // ═══ 手工监测（季度）═══ — 按区域分散到各月 ═══

  // 高炉热风炉 5座 × 3因子 = 15条 → 分配到每个季度第1个月
  for (const s of [
    { code: 'DA028', name: '1号高炉热风炉排放口' },
    { code: 'DA031', name: '2号高炉热风炉排放口' },
    { code: 'DA032', name: '3号高炉热风炉排放口' },
    { code: 'DA034', name: '5号高炉热风炉排放口' },
    { code: 'DA053', name: '4号高炉热风炉排放口' },
  ]) {
    for (const f of ['氮氧化物', '二氧化硫', '颗粒物']) {
      tasks.push({
        id: `manual-${s.code}-${f}`, outletCode: s.code, outletName: s.name,
        factor: f, frequency: 'quarterly', frequencyLabel: '1次/季', facility: '手工',
        dueDates: computeDueDates('quarterly', s.name),
      })
    }
  }

  // 轧钢 5条线 × 3因子 = 15条 → 分配到每个季度第2个月
  for (const r of [
    { code: 'DA043', name: '一轧1号排放口' },
    { code: 'DA044', name: '二轧1号排放口' },
    { code: 'DA045', name: '高线1号排放口' },
    { code: 'DA046', name: '三轧1号排放口' },
    { code: 'DA047', name: '9501号排放口' },
  ]) {
    for (const f of ['氮氧化物', '二氧化硫', '颗粒物']) {
      tasks.push({
        id: `manual-${r.code}-${f}`, outletCode: r.code, outletName: r.name,
        factor: f, frequency: 'quarterly', frequencyLabel: '1次/季', facility: '手工',
        dueDates: computeDueDates('quarterly', r.name),
      })
    }
  }

  // 烧结/球团季度手工
  for (const { code, name, factors } of [
    { code: 'DA041', name: '烧结机配料排放口', factors: ['颗粒物'] },
    { code: 'DA048', name: '烧结脱硫排放口', factors: ['氟化物'] },
    { code: 'DA050', name: '球团脱硫排放口', factors: ['氟化物'] },
    { code: 'DA049', name: '烧结机机尾排放口', factors: ['颗粒物'] }, // 自动，但故障时手工
    { code: 'DA051', name: '炼钢三次除尘', factors: ['颗粒物'] },
  ]) {
    for (const f of factors) {
      tasks.push({
        id: `manual-${code}-${f}`, outletCode: code, outletName: name,
        factor: f, frequency: 'quarterly', frequencyLabel: '1次/季', facility: '手工',
        dueDates: computeDueDates('quarterly', name),
      })
    }
  }

  // 发电林格曼黑度 4台 × 1因子 = 4条
  for (const g of [
    { code: 'DA035', name: '1号发电排放口' },
    { code: 'DA036', name: '2号发电排放口' },
    { code: 'DA037', name: '3号发电排放口' },
    { code: 'DA039', name: '5号发电排放口' },
  ]) {
    tasks.push({
      id: `manual-${g.code}-林格曼`, outletCode: g.code, outletName: g.name,
      factor: '林格曼黑度', frequency: 'quarterly', frequencyLabel: '1次/季', facility: '手工',
      dueDates: computeDueDates('quarterly', g.name),
    })
  }

  // 废水DW003 5因子 → 分配到季度第2个月
  for (const f of ['悬浮物', '化学需氧量', '氨氮', '石油类', '总铊']) {
    tasks.push({
      id: `manual-DW003-${f}`, outletCode: 'DW003', outletName: '应急雨水排放口',
      factor: f, frequency: 'quarterly', frequencyLabel: '1次/季', facility: '手工',
      dueDates: computeDueDates('quarterly', '废水'),
    })
  }

  // 无组织排放 6区域 → 分配到季度第3个月
  for (const area of ['厂界', '炼钢车间', '炼铁车间', '球团车间', '烧结车间', '轧钢车间']) {
    tasks.push({
      id: `manual-wz-${area}`, outletCode: '无组织', outletName: `${area}无组织废气`,
      factor: '颗粒物', frequency: 'quarterly', frequencyLabel: '1次/季', facility: '手工',
      dueDates: computeDueDates('quarterly', `${area}无组织废气`),
    })
  }

  // ═══ 手工监测（年度）═══
  tasks.push(
    { id: 'manual-DA048-二噁英', outletCode: 'DA048', outletName: '烧结脱硫排放口', factor: '二噁英类', frequency: 'annual', frequencyLabel: '1次/年', facility: '手工', dueDates: computeDueDates('annual', '烧结') },
    { id: 'manual-DA029-颗粒物', outletCode: 'DA029', outletName: '喷煤排放口', factor: '颗粒物', frequency: 'annual', frequencyLabel: '1次/年', facility: '手工', dueDates: computeDueDates('annual', '喷煤') },
    { id: 'manual-DA038-颗粒物', outletCode: 'DA038', outletName: '4号发电排放口', factor: '颗粒物', frequency: 'annual', frequencyLabel: '1次/年', facility: '手工', dueDates: computeDueDates('annual', '发电') },
  )

  // ═══ 手工监测（两年）═══
  tasks.push({
    id: 'manual-DA042-颗粒物', outletCode: 'DA042', outletName: '2号转炉一次除尘排放口',
    factor: '颗粒物', frequency: 'biennial', frequencyLabel: '1次/两年', facility: '手工',
    dueDates: computeDueDates('biennial', '转炉'),
  })

  return tasks
}

export const $monitoringTasks = atom<MonitoringTask[]>(buildDefaultTasks())

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

/** 获取指定月份的手工监测任务（含到期日在该月的） */
export function getMonthTasks(month: number): MonitoringTask[] {
  const mStr = String(month).padStart(2, '0')
  return $monitoringTasks.get().filter(t =>
    t.dueDates.some(d => d.includes(`-${mStr}-`))
  )
}
