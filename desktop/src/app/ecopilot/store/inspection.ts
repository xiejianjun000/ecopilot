/**
 * 督察整改跟踪 Store — 行业通用版
 * 中央环保督察 / 省环保督察 / 生态环境部交办 / 专项整改 / 企业自查
 * localStorage 持久化，支持文档上传识别和对话更新
 */
import { atom } from 'nanostores'

export type InspectionSource = 'central' | 'provincial' | 'mee' | 'special' | 'self_check'
export type InspectionStatus = 'pending' | 'in_progress' | 'completed' | 'overdue'

export interface InspectionEvidence {
  type: 'pdf' | 'image' | 'word'
  url: string
  name: string
}

export interface InspectionTask {
  id: string
  source: InspectionSource
  sourceDetail: string
  title: string
  description: string
  requirement: string
  startDate: string
  deadline: string
  status: InspectionStatus
  progress: number   // 0-100
  responsibleUnit: string
  evidence: InspectionEvidence[]
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export const SOURCE_LABELS: Record<InspectionSource, { label: string; icon: string; color: string }> = {
  central:    { label: '中央督察', icon: '🔴', color: '#dc2626' },
  provincial: { label: '省级督察', icon: '🟠', color: '#d97706' },
  mee:        { label: '部委交办', icon: '🟡', color: '#2563eb' },
  special:    { label: '专项整改', icon: '🟣', color: '#7c3aed' },
  self_check: { label: '企业自查', icon: '🟢', color: '#059669' },
}

export const STATUS_LABELS: Record<InspectionStatus, { label: string; color: string }> = {
  pending:      { label: '待整改', color: '#6B7280' },
  in_progress:  { label: '整改中', color: '#d97706' },
  completed:    { label: '已完成', color: '#059669' },
  overdue:      { label: '已逾期', color: '#dc2626' },
}

function id(): string { return `ins-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
function now(): string { return new Date().toISOString() }

// ── 预设演示数据（行业通用，冷钢场景示例） ──
function buildDefaultTasks(): InspectionTask[] {
  const n = now()
  return [
    {
      id: id(), source: 'central', sourceDetail: '2025年中央环保督察第3批',
      title: '烧结机头脱硫效率不达标', description: 'DA001排放口SO₂在线监测数据多次超过许可限值35mg/m³',
      requirement: '2025年9月15日前完成脱硫系统升级改造，确保SO₂稳定达标排放',
      startDate: '2025-03-15', deadline: '2025-09-15',
      status: 'in_progress', progress: 70, responsibleUnit: '烧结厂',
      evidence: [], createdAt: n, updatedAt: n,
    },
    {
      id: id(), source: 'central', sourceDetail: '2025年中央环保督察第3批',
      title: '综合废水排放口在线监测数据缺失', description: 'DW001排放口2024年Q4有连续38天无CEMS数据上传',
      requirement: '2025年6月30日前完成在线监测设备检修并补传缺失数据',
      startDate: '2025-01-10', deadline: '2025-06-30',
      status: 'completed', progress: 100, responsibleUnit: '动力厂',
      evidence: [], createdAt: n, updatedAt: n, completedAt: n,
    },
    {
      id: id(), source: 'provincial', sourceDetail: '2025年湖南省环保督察',
      title: '危废暂存间防渗措施不规范', description: '废矿物油暂存间地面防渗层破损，未设置导流槽和收集池',
      requirement: '2025年12月31日前完成危废暂存间标准化改造',
      startDate: '2025-05-01', deadline: '2025-12-31',
      status: 'in_progress', progress: 30, responsibleUnit: '安环部',
      evidence: [], createdAt: n, updatedAt: n,
    },
    {
      id: id(), source: 'provincial', sourceDetail: '2025年湖南省环保督察',
      title: '厂界噪声夜间超标', description: '2025年3月夜间厂界噪声监测值62dB(A)，超出GB12348 3类标准55dB(A)',
      requirement: '2025年8月15日前完成噪声治理工程验收',
      startDate: '2025-03-20', deadline: '2025-08-15',
      status: 'overdue', progress: 45, responsibleUnit: '设备部',
      evidence: [], createdAt: n, updatedAt: n,
    },
    {
      id: id(), source: 'mee', sourceDetail: '2024年生态环境部大气监督帮扶',
      title: '高炉出铁场无组织排放管控不足', description: '高炉出铁场除尘罩收集效率不足，车间内可见明显烟尘',
      requirement: '2024年12月31日前完成除尘系统改造',
      startDate: '2024-06-01', deadline: '2024-12-31',
      status: 'completed', progress: 100, responsibleUnit: '炼铁厂',
      evidence: [], createdAt: n, updatedAt: n, completedAt: n,
    },
    {
      id: id(), source: 'mee', sourceDetail: '2024年生态环境部大气监督帮扶',
      title: 'CEMS运维管理不规范', description: '在线监测设备未按规定频次进行校准校验，运维记录不完整',
      requirement: '2024年10月31日前规范CEMS运维管理并建立电子台账',
      startDate: '2024-06-15', deadline: '2024-10-31',
      status: 'completed', progress: 100, responsibleUnit: '安环部',
      evidence: [], createdAt: n, updatedAt: n, completedAt: n,
    },
    {
      id: id(), source: 'special', sourceDetail: '2025年钢铁行业超低排放专项检查',
      title: '球团工序NOx排放未达超低标准', description: 'DA050球团脱硫排放口NOx折算值80mg/m³，超低排放要求≤50mg/m³',
      requirement: '2026年3月31日前完成球团脱硝改造',
      startDate: '2025-09-01', deadline: '2026-03-31',
      status: 'in_progress', progress: 60, responsibleUnit: '球团厂',
      evidence: [], createdAt: n, updatedAt: n,
    },
    {
      id: id(), source: 'special', sourceDetail: '2025年娄底市清废行动',
      title: '历史遗留钢渣堆场未采取防扬散措施', description: '厂区西北角历史遗留钢渣露天堆放约5000吨，未覆盖',
      requirement: '2025年11月30日前完成钢渣清运或规范化覆盖',
      startDate: '2025-07-01', deadline: '2025-11-30',
      status: 'pending', progress: 0, responsibleUnit: '安环部',
      evidence: [], createdAt: n, updatedAt: n,
    },
    {
      id: id(), source: 'self_check', sourceDetail: '2025年企业内部环保自查',
      title: '应急预案2025年未开展实战演练', description: '按要求每年至少1次实战演练，2025年尚未组织',
      requirement: '2025年10月31日前完成年度应急演练',
      startDate: '2025-01-01', deadline: '2025-10-31',
      status: 'in_progress', progress: 20, responsibleUnit: '安环部',
      evidence: [], createdAt: n, updatedAt: n,
    },
  ]
}

// ── Store ──
function loadTasks(): InspectionTask[] {
  if (typeof localStorage === 'undefined') return buildDefaultTasks()
  try {
    // auto-compute overdue status
    const raw = JSON.parse(localStorage.getItem('ecopilot-inspection') || 'null')
    if (!raw || !Array.isArray(raw)) return buildDefaultTasks()
    const today = new Date().toISOString().split('T')[0]
    return raw.map((t: InspectionTask) => {
      if (t.status !== 'completed' && t.status !== 'overdue' && t.deadline < today) {
        return { ...t, status: 'overdue' as const }
      }
      return t
    })
  } catch { return buildDefaultTasks() }
}

export const $inspectionTasks = atom<InspectionTask[]>(loadTasks())

$inspectionTasks.listen(tasks => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('ecopilot-inspection', JSON.stringify(tasks))
  }
})

// ── CRUD ──

export function addInspectionTask(task: Omit<InspectionTask, 'id' | 'createdAt' | 'updatedAt'>): string {
  const newId = id()
  const n = now()
  $inspectionTasks.set([...$inspectionTasks.get(), { ...task, id: newId, createdAt: n, updatedAt: n }])
  return newId
}

export function removeInspectionTask(id: string) {
  $inspectionTasks.set($inspectionTasks.get().filter(t => t.id !== id))
}

export function updateInspectionTask(id: string, updates: Partial<InspectionTask>) {
  $inspectionTasks.set($inspectionTasks.get().map(t =>
    t.id === id ? { ...t, ...updates, updatedAt: now() } : t
  ))
}

export function updateProgress(id: string, progress: number) {
  const tasks = $inspectionTasks.get().map(t => {
    if (t.id !== id) return t
    const status: InspectionStatus = progress >= 100 ? 'completed' : t.status === 'pending' ? 'in_progress' : t.status
    return {
      ...t, progress, status,
      updatedAt: now(),
      completedAt: progress >= 100 && !t.completedAt ? now() : t.completedAt,
    }
  })
  $inspectionTasks.set(tasks)
}

export function addBulkTasks(tasks: Omit<InspectionTask, 'id' | 'createdAt' | 'updatedAt'>[]) {
  const n = now()
  const newTasks = tasks.map(t => ({ ...t, id: id(), createdAt: n, updatedAt: n }))
  $inspectionTasks.set([...$inspectionTasks.get(), ...newTasks])
  return newTasks.length
}

// ── 计算 ──

export function getInspectionStats() {
  const tasks = $inspectionTasks.get()
  const bySource = {} as Record<InspectionSource, { total: number; completed: number; inProgress: number; overdue: number }>
  for (const src of ['central', 'provincial', 'mee', 'special', 'self_check'] as InspectionSource[]) {
    const srcTasks = tasks.filter(t => t.source === src)
    bySource[src] = {
      total: srcTasks.length,
      completed: srcTasks.filter(t => t.status === 'completed').length,
      inProgress: srcTasks.filter(t => t.status === 'in_progress').length,
      overdue: srcTasks.filter(t => t.status === 'overdue' || (t.status !== 'completed' && t.deadline < new Date().toISOString().split('T')[0])).length,
    }
  }
  return {
    total: tasks.length,
    completed: tasks.filter(t => t.status === 'completed').length,
    inProgress: tasks.filter(t => t.status === 'in_progress').length,
    pending: tasks.filter(t => t.status === 'pending').length,
    overdue: tasks.filter(t => t.status === 'overdue').length,
    completionRate: tasks.length > 0 ? Math.round(tasks.filter(t => t.status === 'completed').length / tasks.length * 100) : 0,
    bySource,
  }
}

export function getOverdueTasks(): InspectionTask[] {
  const today = new Date().toISOString().split('T')[0]
  return $inspectionTasks.get().filter(t =>
    t.status === 'overdue' || (t.status !== 'completed' && t.deadline < today)
  )
}

/** 上传文档并 OCR 解析 → 返回结构化督察任务 */
export async function uploadAndParseDocument(file: File): Promise<{ ok: boolean; tasks?: Omit<InspectionTask, 'id'|'createdAt'|'updatedAt'>[]; error?: string }> {
  try {
    const form = new FormData()
    form.append('image', file)
    form.append('prompt', '请识别这份环保督察交办文件中的所有问题。对于每个问题，提取：问题标题、问题描述、整改要求、整改截止日期、交办来源（中央/省级/部级/专项）。返回JSON格式，不要其他文字。')

    const res = await fetch('http://localhost:8002/api/inspection/parse', {
      method: 'POST',
      body: form,
    })
    const data = await res.json()
    if (!data.ok) return { ok: false, error: data.detail || '解析失败' }
    return { ok: true, tasks: data.tasks || [] }
  } catch (e: any) {
    return { ok: false, error: e.message || '上传失败' }
  }
}
