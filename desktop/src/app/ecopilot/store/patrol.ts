/**
 * EcoPilot 合规巡检定时任务
 *
 * Hermes Cron 驱动的自动化巡检：每日排放检查、每周平台审计、每月档案过期预警。
 */

import { atom, computed } from 'nanostores'

export interface PatrolJob {
  id: string
  name: string
  description: string
  icon: string
  /** Cron 表达式 */
  schedule: string
  /** 人类可读的调度描述 */
  scheduleLabel: string
  /** 是否启用 */
  enabled: boolean
  /** 上次执行时间 */
  lastRun?: string
  /** 上次执行结果摘要 */
  lastResult?: string
  /** 推送渠道 */
  notifyChannels: ('feishu' | 'desktop' | 'wechat')[]
  /** 任务类型 */
  type: 'emission' | 'audit' | 'archive' | 'custom'
}

export interface PatrolRun {
  id: string
  jobId: string
  timestamp: string
  status: 'success' | 'warning' | 'error'
  summary: string
  details: string[]
}

const DEFAULT_JOBS: PatrolJob[] = [
  {
    id: 'daily-emission',
    name: '每日排放监测检查',
    description: '自动对比监测数据与排放标准，超标时立即告警',
    icon: '📊',
    schedule: '0 9 * * *',  // 每天上午9点
    scheduleLabel: '每天 09:00',
    enabled: true,
    lastRun: '2026-06-25 09:00',
    lastResult: '✅ COD达标 · SO₂达标 · ⚠️ NH3-N超标(15/12mg/L)',
    notifyChannels: ['feishu', 'desktop'],
    type: 'emission',
  },
  {
    id: 'weekly-audit',
    name: '每周合规平台巡检',
    description: '登录排污许可平台，检查执行报告、监测数据、违规记录',
    icon: '🔍',
    schedule: '0 9 * * 1',  // 每周一上午9点
    scheduleLabel: '每周一 09:00',
    enabled: true,
    lastRun: '2026-06-23 09:00',
    lastResult: '⚠️ Q2执行报告未提交 · ✅ 许可证状态正常 · ⚠️ 监测数据缺失（6月上半月）',
    notifyChannels: ['feishu'],
    type: 'audit',
  },
  {
    id: 'monthly-archive',
    name: '每月档案过期检查',
    description: '检查企业档案有效期，提前30天预警到期文件',
    icon: '📁',
    schedule: '0 9 1 * *',  // 每月1日上午9点
    scheduleLabel: '每月1日 09:00',
    enabled: true,
    lastRun: '2026-06-01 09:00',
    lastResult: '⚠️ 应急预案将于2026-06-15到期 · ✅ 其他档案均在有效期内',
    notifyChannels: ['feishu', 'desktop'],
    type: 'archive',
  },
  {
    id: 'permit-expiry',
    name: '许可证到期预警',
    description: '每日检查许可证剩余有效期，进入预警窗口时推送提醒',
    icon: '📋',
    schedule: '0 8 * * *',  // 每天上午8点
    scheduleLabel: '每天 08:00',
    enabled: true,
    lastRun: '2026-06-25 08:00',
    lastResult: '⚠️ 距到期51天 · 已进入60天预警窗口 · 建议启动延续申请',
    notifyChannels: ['feishu', 'desktop', 'wechat'],
    type: 'custom',
  },
]

export const $patrolJobs = atom<PatrolJob[]>(DEFAULT_JOBS)
export const $patrolRuns = atom<PatrolRun[]>([])

export const $enabledJobsCount = computed($patrolJobs, jobs => jobs.filter(j => j.enabled).length)
export const $lastWarningJob = computed($patrolJobs, jobs =>
  jobs.find(j => j.lastResult?.includes('⚠️'))
)

/** 切换巡检任务启用/禁用 */
export function togglePatrolJob(id: string): void {
  $patrolJobs.set($patrolJobs.get().map(j =>
    j.id === id ? { ...j, enabled: !j.enabled } : j
  ))
}

/** 模拟执行一次巡检 */
export function runPatrolNow(jobId: string): void {
  const job = $patrolJobs.get().find(j => j.id === jobId)
  if (!job) return

  const now = new Date().toLocaleString('zh-CN')
  const run: PatrolRun = {
    id: `run-${Date.now()}`,
    jobId,
    timestamp: now,
    status: 'warning',
    summary: job.lastResult || '巡检完成',
    details: ['正在执行巡检...', '检查完成'],
  }

  $patrolJobs.set($patrolJobs.get().map(j =>
    j.id === jobId ? { ...j, lastRun: now } : j
  ))
  $patrolRuns.set([run, ...$patrolRuns.get()])
}
