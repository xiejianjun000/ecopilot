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

export function NodeProgress({ nodes, legalNodes, escalated }: {
  nodes: TaskNode[]
  legalNodes?: TaskNode[]
  escalated?: boolean
}) {
  const renderNodes = (list: TaskNode[], label?: string) => (
    <div>
      {label && (
        <p className="text-caption font-medium text-muted-foreground mb-2">{label}</p>
      )}
      <div className="flex items-center gap-1">
        {list.map((n, i) => (
          <div key={i} className="flex items-center">
            <div className={cn("size-2.5 rounded-full transition-colors",
              n.status === "done" ? "bg-eco-500"
                : n.status === "current" ? "bg-warning ring-2 ring-warning/30"
                : "bg-muted"
            )} />
            {i < list.length - 1 && (
              <div className={cn("h-0.5 w-6",
                n.status === "done" ? "bg-eco-500" : "bg-muted")} />
            )}
          </div>
        ))}
      </div>
      <div className="flex items-start gap-1 mt-1">
        {list.map((n, i) => (
          <div key={i} className="flex-1 min-w-0" style={{ width: `${100 / list.length}%` }}>
            <p className={cn("text-caption truncate",
              n.status === "current" ? "text-warning font-medium" : "text-muted-foreground")}>
              {n.name}
            </p>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="space-y-3">
      {renderNodes(nodes)}
      {escalated && legalNodes && renderNodes(legalNodes, "法律程序（立案查处）")}
    </div>
  )
}

// ═══════════════ AI 复盘分析区 ═══════════════