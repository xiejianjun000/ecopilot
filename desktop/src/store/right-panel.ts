import { atom, computed } from "nanostores"
import type { PermitInfo } from "../app/ecopilot/lib/permit-parser"

// ── 右面板记忆 ──
export const $memories = atom<any[]>([])
export const $diaryEntries = atom<any[]>([])
export const $assetsByType = atom<Record<string, any[]>>({})

// ── 合规状态（从 permit store 同步）──
export interface ComplianceSnapshot {
  score: number
  fatal: number
  high: number
  medium: number
  risks: { level: string; module: string; issue: string; law: string }[]
  modules: Record<string, any>
  lastAudit: string
}

export const $complianceSnapshot = atom<ComplianceSnapshot | null>(null)

export function setComplianceSnapshot(snapshot: ComplianceSnapshot) {
  $complianceSnapshot.set(snapshot)
}

// ── 执行报告列表（已导出文件）──
export interface ReportEntry {
  name: string
  path: string
  size: number
  type: 'pdf' | 'docx'
}

export const $reports = atom<ReportEntry[]>([])
export function setReports(reports: ReportEntry[]) { $reports.set(reports) }

// ── 右面板当前 Tab ──
export type RightTab = 'compliance' | 'reports' | 'summary' | 'memory'
export const $rightTab = atom<RightTab>('compliance')

// ── 任务对话总结 ──
export interface TaskSummary {
  id: string
  time: string
  title: string
  operations: string[]     // 执行的操作列表
  findings: string[]       // 关键发现
  recommendations: string[] // 建议
  scores?: { label: string; value: number; max: number }[] // 评分
}

export const $taskSummaries = atom<TaskSummary[]>([])

export function addTaskSummary(s: TaskSummary) {
  const current = $taskSummaries.get()
  $taskSummaries.set([s, ...current].slice(0, 20))
}
