/**
 * 聊天右侧面板 Store — QClaw 同级颗粒度
 * 4 主 Tab: 本轮总结 / 产出文件 / 记忆沉淀 / 日记
 * 2 折叠区: 内置浏览器 / 合规快照
 */
import { atom } from "nanostores"

// ── Tab 类型 ──
export type RightTab = 'summary' | 'files' | 'memory' | 'diary' | 'compliance' | 'reports' | 'browser'
export const $rightTab = atom<RightTab>('summary')

// 折叠区展开状态
export const $browserOpen = atom(false)
export const $snapshotOpen = atom(false)
export const $browserUrl = atom('https://permit.mee.gov.cn')

export function navigateToUrl(url: string) {
  $browserUrl.set(url)
  $browserOpen.set(true)
  $rightTab.set('files')  // need to switch away to trigger re-render
  setTimeout(() => $rightTab.set('summary'), 0)
}

// ═══════════════ 💬 本轮总结 ═══════════════

export interface TaskSummary {
  id: string
  time: string
  title: string
  operations: string[]
  findings: string[]
  recommendations: string[]
  expertRouted?: string
  scores?: { label: string; value: number; max: number }[]
}

export const $taskSummaries = atom<TaskSummary[]>([])

export function addTaskSummary(s: TaskSummary) {
  const current = $taskSummaries.get()
  $taskSummaries.set([s, ...current].slice(0, 20))
}

// ═══════════════ 📄 产出文件 ═══════════════

export interface OutputFile {
  id: string
  name: string
  path: string
  size?: number
  type: 'md' | 'pdf' | 'docx' | 'json' | 'report'
  createdAt: string
  sessionId?: string
  downloadUrl?: string
}

export const $outputFiles = atom<OutputFile[]>(loadOutputFiles())

function loadOutputFiles(): OutputFile[] {
  if (typeof localStorage === 'undefined') return []
  try { return JSON.parse(localStorage.getItem('ecopilot-output-files') || '[]') }
  catch { return [] }
}

$outputFiles.listen(files => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('ecopilot-output-files', JSON.stringify(files))
  }
})

export function addOutputFile(f: Omit<OutputFile, 'id'>) {
  const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  $outputFiles.set([{ ...f, id }, ...$outputFiles.get()].slice(0, 50))
}

// ═══════════════ 🧠 记忆沉淀 ═══════════════

export interface MemoryItem {
  id: string
  category: 'standard' | 'limit' | 'risk' | 'process' | 'regulation' | 'other'
  content: string
  source: string        // 来源对话摘要
  createdAt: string
  sessionId?: string
  expertName?: string
}

const MEMORY_CATEGORIES: Record<string, { label: string; icon: string }> = {
  standard:   { label: '适用标准', icon: 'scale' },
  limit:      { label: '排放限值', icon: 'chart-bar' },
  risk:       { label: '合规风险', icon: 'alert-triangle' },
  process:    { label: '工艺流程', icon: 'building-factory' },
  regulation: { label: '法规条款', icon: 'file-text' },
  other:      { label: '其他', icon: 'info-circle' },
}

export const MEMORY_META = MEMORY_CATEGORIES

export const $memories = atom<MemoryItem[]>(loadMemories())

function loadMemories(): MemoryItem[] {
  if (typeof localStorage === 'undefined') return []
  try { return JSON.parse(localStorage.getItem('ecopilot-memories') || '[]') }
  catch { return [] }
}

$memories.listen(items => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('ecopilot-memories', JSON.stringify(items))
  }
})

export function addMemory(m: Omit<MemoryItem, 'id' | 'createdAt'>) {
  const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  $memories.set([{ ...m, id, createdAt: new Date().toISOString() }, ...$memories.get()].slice(0, 100))
}

export function getRecentMemories(limit = 10): MemoryItem[] {
  return $memories.get().slice(0, limit)
}

// ═══════════════ 📔 日记 ═══════════════

export interface DiaryEntry {
  id: string
  date: string           // YYYY-MM-DD
  time: string           // HH:MM
  title: string
  summary: string        // 2-3 句话
  expertName: string     // 路由到的专家
  taskCount: number      // 完成了多少操作
  findings: string[]     // 关键发现
  expanded?: boolean
}

export const $diaryEntries = atom<DiaryEntry[]>(loadDiary())

function loadDiary(): DiaryEntry[] {
  if (typeof localStorage === 'undefined') return []
  try { return JSON.parse(localStorage.getItem('ecopilot-diary') || '[]') }
  catch { return [] }
}

$diaryEntries.listen(items => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('ecopilot-diary', JSON.stringify(items))
  }
})

export function addDiaryEntry(d: Omit<DiaryEntry, 'id'>) {
  const id = `diary-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  $diaryEntries.set([{ ...d, id }, ...$diaryEntries.get()].slice(0, 200))
}

export function getDiaryByDate(date: string): DiaryEntry[] {
  return $diaryEntries.get().filter(d => d.date === date)
}

// ═══════════════ 兼容旧接口 ═══════════════

export const $assetsByType = atom<Record<string, any[]>>({})

export interface ComplianceSnapshot {
  score: number
  fatal: number; high: number; medium: number
  risks: { level: string; module: string; issue: string; law: string }[]
  modules: Record<string, any>
  lastAudit: string
}

export const $complianceSnapshot = atom<ComplianceSnapshot | null>(null)
export function setComplianceSnapshot(s: ComplianceSnapshot) { $complianceSnapshot.set(s) }

export interface ReportEntry {
  name: string; path: string; size: number; type: 'pdf' | 'docx'
}
export const $reports = atom<ReportEntry[]>([])
export function setReports(r: ReportEntry[]) { $reports.set(r) }
