"use client"
import { useState, useEffect, useRef, useCallback } from "react"
import {
  Zap, Scale, HardHat, Upload, Sparkles, Plus, X, Clock,
  AlertTriangle, CheckCircle2, FileText, Loader2,
  ShieldCheck, AlertCircle, Lightbulb,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { apiPost } from "@/lib/api"

type RectificationType = "immediate" | "tracking" | "engineering"
type TaskStatus = "pending" | "in_progress" | "review" | "completed"
type Severity = "high" | "medium" | "low"
interface TaskNode { name: string; status: "done" | "current" | "pending"; date?: string }
interface LegalDeadline { name: string; deadline: string; status: "pending" | "done" | "overdue" }
interface TaskReview {
  detectionStatus: "detected_unfixed" | "detected_untracked" | "undetected"
  detectionNote: string
  rootCause: { primary: string; secondary: string[] }
  complianceGap: { item: string; status: "missing" | "partial" | "established" }[]
  preventionSuggestions: string[]
  generatedAt: string; updatedAt?: string
}
interface RectificationTask {
  id: string; title: string; description: string; requirement: string
  type: RectificationType; typeLabel: string; source: string; sourceDetail: string
  category: string; regulation: string; deadline: string; severity: Severity
  status: TaskStatus; progress: number; currentNode: number
  nodes: TaskNode[]; escalatedToLegal?: boolean; legalNodes?: TaskNode[]
  legalCurrentNode?: number; legalDeadlines?: LegalDeadline[]
  responsibleUnit: string; createdAt: string; updatedAt: string
  records: { time: string; content: string; progress?: number }[]
  review?: TaskReview
}

export function ReviewSection({ review }: { review?: TaskReview }) {
  if (!review) return null

  const detectionLabel: Record<string, { text: string; color: string }> = {
    detected_unfixed: { text: "已发现但未整改", color: "text-warning" },
    detected_untracked: { text: "已发现但未跟踪", color: "text-warning" },
    undetected: { text: "未发现 — 巡查清单缺漏项", color: "text-destructive" },
  }
  const gapLabel: Record<string, { text: string; color: string }> = {
    missing: { text: "缺失", color: "text-destructive" },
    partial: { text: "部分建立", color: "text-warning" },
    established: { text: "已建立", color: "text-success" },
  }

  const det = detectionLabel[review.detectionStatus] || detectionLabel.undetected

  return (
    <div className="rounded-xl border border-eco-200 bg-eco-50/40 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Lightbulb className="size-4 text-eco-600" />
        <h4 className="text-body font-semibold text-eco-800">AI 复盘分析</h4>
      </div>

      {/* ① 巡查遗漏诊断 */}
      <div>
        <p className="text-caption font-medium text-muted-foreground mb-1.5">① 巡查遗漏诊断</p>
        <div className="flex items-center gap-2">
          <div className={cn("size-2 rounded-full", det.color === "text-destructive" ? "bg-destructive" : "bg-warning")} />
          <span className={cn("text-body", det.color)}>{det.text}</span>
        </div>
        {review.detectionNote && (
          <p className="text-caption text-muted-foreground mt-1 ml-4">{review.detectionNote}</p>
        )}
      </div>

      {/* ② 根因分析 */}
      <div>
        <p className="text-caption font-medium text-muted-foreground mb-1.5">② 根因分析</p>
        <p className="text-body text-foreground">主因：{review.rootCause.primary}</p>
        {review.rootCause.secondary.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {review.rootCause.secondary.map((s, i) => (
              <li key={i} className="text-caption text-muted-foreground flex items-start gap-1.5">
                <span className="text-muted-foreground/60">·</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ③ 合规差距诊断 */}
      <div>
        <p className="text-caption font-medium text-muted-foreground mb-1.5">③ 合规差距诊断</p>
        <div className="space-y-1">
          {review.complianceGap.map((g, i) => {
            const lbl = gapLabel[g.status] || gapLabel.missing
            return (
              <div key={i} className="flex items-center justify-between">
                <span className="text-body text-foreground">{g.item}</span>
                <span className={cn("text-caption font-medium", lbl.color)}>{lbl.text}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* ④ 预防建议 */}
      <div>
        <p className="text-caption font-medium text-muted-foreground mb-1.5">④ 预防建议</p>
        <ul className="space-y-1">
          {review.preventionSuggestions.map((s, i) => (
            <li key={i} className="text-caption text-foreground flex items-start gap-1.5">
              <CheckCircle2 className="size-3 text-eco-500 shrink-0 mt-0.5" />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ═══════════════ 工单详情区 ═══════════════