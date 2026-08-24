/**
 * Onboarding 流程统一日志工具
 * ============================================
 * 用途：在 Hermes 唤醒 / 行业识别 / 技能下载 / 记忆写入等关键节点
 *      打印结构化日志，方便排查异常。
 *
 * 日志前缀统一：
 *   [Onboarding]   onboarding 流程主日志
 *   [Hermes]       Hermes Agent 唤醒/记忆
 *   [EcoSkill]     行业技能下载
 *
 * 日志级别：
 *   info   正常流程节点
 *   warn   非阻塞异常
 *   error  阻塞异常
 *   debug  详细数据（生产环境可关闭）
 *
 * 用法：
 *   import { onboardingLog } from "@/lib/onboarding-log"
 *   onboardingLog.hermes("wake_start", { model: "deepseek-v4-flash" })
 *   onboardingLog.ecoskill("install_done", { total: 13, installed: 2 })
 */

const ENV_DEBUG = typeof process !== 'undefined' && process.env.NODE_ENV !== 'production'

function ts(): string {
  // ISO 时间戳 + 毫秒，方便对齐后端日志
  const d = new Date()
  return d.toISOString().replace('T', ' ').replace('Z', '')
}

function fmt(data: Record<string, unknown>): string {
  try {
    return JSON.stringify(data)
  } catch {
    return String(data)
  }
}

type LogFn = (event: string, data?: Record<string, unknown>) => void

interface LeveledLogFn extends LogFn {
  info: LogFn
  warn: LogFn
  error: LogFn
  debug: LogFn
}

function makeLogger(prefix: string): LeveledLogFn {
  const base = (level: string, event: string, data?: Record<string, unknown>) => {
    const line = `${ts()} ${prefix} [${level}] ${event}${data ? ' ' + fmt(data) : ''}`
    // 统一用 console 输出，浏览器和 Node 都能看
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else if (level === 'debug') { if (ENV_DEBUG) console.debug(line) }
    else console.log(line)
  }

  const fn = ((event: string, data?: Record<string, unknown>) => base('info', event, data)) as LeveledLogFn
  fn.info = (event, data) => base('info', event, data)
  fn.warn = (event, data) => base('warn', event, data)
  fn.error = (event, data) => base('error', event, data)
  fn.debug = (event, data) => base('debug', event, data)
  return fn
}

export const onboardingLog = {
  /** onboarding 主流程日志 */
  onboarding: makeLogger('[Onboarding]'),
  /** Hermes Agent 唤醒/记忆日志 */
  hermes: makeLogger('[Hermes]'),
  /** EcoSkill 行业技能下载日志 */
  ecoskill: makeLogger('[EcoSkill]'),
}

/**
 * 计时器 — 测量关键节点耗时
 * 用法：
 *   const t = startTimer()
 *   ... do work ...
 *   onboardingLog.hermes.info('wake_done', { ms: t() })
 */
export function startTimer(): () => number {
  const t0 = performance.now()
  return () => Math.round(performance.now() - t0)
}
