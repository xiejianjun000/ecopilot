// Inspection shared types — extracted from inspection.tsx (v1.1)

import { type LucideIcon } from "lucide-react"

export type RectificationType = "immediate" | "tracking" | "engineering"
export type TaskStatus = "pending" | "in_progress" | "review" | "completed"
export type Severity = "high" | "medium" | "low"

export interface TaskNode {
  name: string
  status: "done" | "current" | "pending"
  date?: string
}

export interface LegalDeadline {
  name: string
  deadline: string
  status: "pending" | "done" | "overdue"
}

export interface RectificationRecord {
  time: string
  content: string
  progress?: number
}

export interface ComplianceGap {
  item: string
  status: "missing" | "partial" | "established"
}

export interface TaskReview {
  detectionStatus: "detected_unfixed" | "detected_untracked" | "undetected"
  detectionNote: string
  rootCause: { primary: string; secondary: string[] }
  complianceGap: ComplianceGap[]
  preventionSuggestions: string[]
  generatedAt: string
  updatedAt?: string
}

export interface RectificationTask {
  id: string
  title: string
  description: string
  requirement: string
  type: RectificationType
  typeLabel: string
  source: string
  sourceDetail: string
  category: string
  regulation: string
  deadline: string
  severity: Severity
  status: TaskStatus
  progress: number
  currentNode: number
  nodes: TaskNode[]
  escalatedToLegal?: boolean
  legalNodes?: TaskNode[]
  legalCurrentNode?: number
  legalDeadlines?: LegalDeadline[]
  responsibleUnit: string
  createdAt: string
  updatedAt: string
  records: RectificationRecord[]
  review?: TaskReview
}

export const TYPE_CONFIG: Record<RectificationType, {
  label: string
  icon: LucideIcon
  color: string
  borderColor: string
  bgColor: string
  textColor: string
  trackBy: string
}> = {} as any // populated in parent

export const SOURCE_LABELS: Record<string, string> = {
  central: "中央督察",
  provincial: "省级督察",
  mee: "部委交办",
  special: "专项整改",
  self_check: "企业自查",
  ai_audit: "AI巡检",
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  high: "高风险",
  medium: "中风险",
  low: "低风险",
}

export function daysRemaining(deadline: string): number {
  if (!deadline) return Infinity
  const d = new Date(deadline)
  if (isNaN(d.getTime())) return Infinity
  return Math.ceil((d.getTime() - Date.now()) / 86400000)
}

export function formatUrgency(deadline: string): { text: string; color: string } {
  const days = daysRemaining(deadline)
  if (days <= 0) return { text: "已逾期", color: "text-destructive" }
  if (days <= 3) return { text: `仅剩${days}天`, color: "text-destructive" }
  if (days <= 7) return { text: `剩余${days}天`, color: "text-orange-600" }
  return { text: `剩余${days}天`, color: "text-muted-foreground" }
}
