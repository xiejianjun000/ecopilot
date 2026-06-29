/**
 * 用户自定义定时任务 — 从对话中新建
 * 支持：一次任务 / 重复任务（日/周/月/年）
 * 存储于 localStorage，全局共享
 */
import { atom } from 'nanostores'

export type ScheduleRepeat = 'once' | 'daily' | 'weekly' | 'monthly' | 'annual'

export interface ScheduleTask {
  id: string
  title: string
  description?: string
  date: string            // 首次/下次触发日 YYYY-MM-DD
  time?: string           // HH:mm (可选)
  repeat: ScheduleRepeat
  color: string           // 色标 hex
  enabled: boolean
  createdAt: string       // ISO date
  completedAt?: string    // 完成标记
  source?: string         // 来源: 'user' | 'ai-suggest' | 'system'
}

const COLORS = ['#059669', '#d97706', '#dc2626', '#2563eb', '#7c3aed', '#db2777', '#0891b2']

let _colorIdx = 0
function nextColor(): string {
  return COLORS[_colorIdx++ % COLORS.length]
}

function loadSchedules(): ScheduleTask[] {
  if (typeof localStorage === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem('ecopilot-schedules') || '[]')
  } catch { return [] }
}

export const $schedules = atom<ScheduleTask[]>(loadSchedules())

$schedules.listen(tasks => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('ecopilot-schedules', JSON.stringify(tasks))
  }
})

/** 新建任务 */
export function addSchedule(task: Omit<ScheduleTask, 'id' | 'createdAt' | 'color'>): string {
  const id = `sch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const newTask: ScheduleTask = {
    ...task,
    id,
    color: nextColor(),
    createdAt: new Date().toISOString(),
  }
  $schedules.set([...$schedules.get(), newTask])
  return id
}

/** 删除任务 */
export function removeSchedule(id: string) {
  $schedules.set($schedules.get().filter(t => t.id !== id))
}

/** 切换启用/禁用 */
export function toggleSchedule(id: string) {
  $schedules.set($schedules.get().map(t =>
    t.id === id ? { ...t, enabled: !t.enabled } : t
  ))
}

/** 标记完成（一次性任务完成后自动禁用） */
export function completeSchedule(id: string) {
  const now = new Date().toISOString()
  $schedules.set($schedules.get().map(t =>
    t.id === id ? { ...t, completedAt: now, enabled: t.repeat !== 'once' } : t
  ))
}

/** 获取待完成的任务（已到期但未完成） */
export function getPendingSchedules(): ScheduleTask[] {
  const today = new Date().toISOString().split('T')[0]
  return $schedules.get().filter(t =>
    t.enabled && !t.completedAt && t.date <= today
  )
}

/** 解析重复任务的下次触发日期 */
export function computeNextDate(task: ScheduleTask): string | null {
  if (!task.enabled || task.repeat === 'once') return null
  const d = new Date(task.date)
  const now = new Date()
  while (d <= now) {
    if (task.repeat === 'daily') d.setDate(d.getDate() + 1)
    else if (task.repeat === 'weekly') d.setDate(d.getDate() + 7)
    else if (task.repeat === 'monthly') d.setMonth(d.getMonth() + 1)
    else if (task.repeat === 'annual') d.setFullYear(d.getFullYear() + 1)
  }
  return d.toISOString().split('T')[0]
}
