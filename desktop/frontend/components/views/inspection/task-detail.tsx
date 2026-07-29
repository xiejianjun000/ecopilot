"use client"
import { useState, useEffect, useRef, useCallback } from "react"
import {
  Zap, Scale, HardHat, Upload, Sparkles, Plus, X, Clock,
  AlertTriangle, CheckCircle2, FileText, Loader2,
  ShieldCheck, AlertCircle, Lightbulb,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { apiPost } from "@/lib/api"
import { NodeProgress } from "./node-progress"
import { ReviewSection } from "./review-section"

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

// ═══════ 类型配置（引用自父组件, 子组件内联定义）═══════
const SOURCE_LABELS: Record<string, string> = {central:"中央督察",provincial:"省级督察",mee:"部委交办",special:"专项整改",self_check:"企业自查",ai_audit:"AI巡检"}
const SEVERITY_LABEL: Record<string, string> = {high:"高风险",medium:"中风险",low:"低风险"}
const TYPE_CONFIG: Record<string, {label:string;icon:any;color:string;borderColor:string;bgColor:string;textColor:string;trackBy:string}> = {
  immediate:{label:"立行立改",icon:null,color:"destructive",borderColor:"border-l-destructive",bgColor:"bg-destructive/10",textColor:"text-destructive",trackBy:"按天跟踪"},
  tracking:{label:"跟踪督办",icon:null,color:"purple",borderColor:"border-l-purple-500",bgColor:"bg-purple-50",textColor:"text-purple-700",trackBy:"按周跟踪"},
  engineering:{label:"工程建设",icon:null,color:"info",borderColor:"border-l-info",bgColor:"bg-info/10",textColor:"text-info",trackBy:"按月跟踪"},
}

function formatUrgency(deadline: string): { text: string; color: string } {
  const days = (() => { const d = new Date(deadline); return isNaN(d.getTime()) ? Infinity : Math.ceil((d.getTime() - Date.now()) / 86400000) })()
  if (days <= 0) return { text: "已逾期", color: "text-destructive" }
  if (days <= 3) return { text: "仅剩"+days+"天", color: "text-destructive" }
  if (days <= 7) return { text: "剩余"+days+"天", color: "text-orange-600" }
  return { text: "剩余"+days+"天", color: "text-muted-foreground" }
}

export function TaskDetail({ task, onClose, onUpdateProgress, onEscalate }: {
  task: RectificationTask
  onClose: () => void
  onUpdateProgress: (progress: number, nodeIdx: number, content: string) => void
  onEscalate: () => void
}) {
  const [showProgressInput, setShowProgressInput] = useState(false)
  const [newProgress, setNewProgress] = useState(task.progress)
  const [newContent, setNewContent] = useState("")

  const cfg = TYPE_CONFIG[task.type]
  const TypeIcon = cfg.icon
  const urgency = formatUrgency(task.deadline)

  return (
    <div className="flex h-full w-[360px] flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-body font-semibold text-foreground truncate">工单详情</h3>
        <button onClick={onClose} aria-label="关闭详情"
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 标题 + 类型 */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-caption font-medium", cfg.bgColor, cfg.textColor)}>
              <TypeIcon className="size-3" />{cfg.label}
            </span>
            {task.escalatedToLegal && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-destructive/10 px-2 py-0.5 text-caption font-medium text-destructive">
                <AlertTriangle className="size-3" />已立案
              </span>
            )}
            <span className={cn("text-caption font-medium",
              task.severity === "high" ? "text-destructive"
                : task.severity === "medium" ? "text-warning" : "text-info")}>
              {SEVERITY_LABEL[task.severity]}
            </span>
          </div>
          <h2 className="text-section font-semibold text-foreground leading-snug">{task.title}</h2>
        </div>

        {/* 基本信息 */}
        <div className="space-y-2 text-body">
          {task.sourceDetail && (
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground shrink-0 w-16">来源</span>
              <span className="text-foreground">{task.sourceDetail}</span>
            </div>
          )}
          {task.regulation && (
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground shrink-0 w-16">法规</span>
              <span className="text-foreground">{task.regulation}</span>
            </div>
          )}
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground shrink-0 w-16">截止</span>
            <span className={cn("font-medium", urgency.color)}>
              {task.deadline || "无截止"} {urgency.text !== "无截止" && `(${urgency.text})`}
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground shrink-0 w-16">责任</span>
            <span className="text-foreground">{task.responsibleUnit || "未指定"}</span>
          </div>
        </div>

        {/* 问题描述 */}
        {task.description && (
          <div>
            <p className="text-caption font-medium text-muted-foreground mb-1">问题描述</p>
            <p className="text-body text-foreground leading-relaxed">{task.description}</p>
          </div>
        )}

        {/* 整改要求 */}
        {task.requirement && (
          <div>
            <p className="text-caption font-medium text-muted-foreground mb-1">整改要求</p>
            <p className="text-body text-foreground leading-relaxed">{task.requirement}</p>
          </div>
        )}

        {/* 流程进度 */}
        <div className="rounded-xl border border-border p-3">
          <div className="flex items-center justify-between mb-3">
            <p className="text-caption font-medium text-muted-foreground">整改流程（{cfg.trackBy}）</p>
            <span className="text-caption font-semibold text-eco-600">{task.progress}%</span>
          </div>
          <NodeProgress nodes={task.nodes} legalNodes={task.legalNodes} escalated={task.escalatedToLegal} />

          {/* 法律时限（升级后显示） */}
          {task.escalatedToLegal && task.legalDeadlines && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-caption font-medium text-destructive mb-2">法定时限</p>
              <div className="space-y-1">
                {task.legalDeadlines.map((d, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-body text-foreground">{d.name}</span>
                    <span className={cn("text-caption",
                      d.status === "done" ? "text-success"
                        : d.status === "overdue" ? "text-destructive" : "text-muted-foreground")}>
                      {d.deadline}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* AI 复盘分析 */}
        <ReviewSection review={task.review} />

        {/* 整改记录 */}
        <div>
          <p className="text-caption font-medium text-muted-foreground mb-2">整改记录</p>
          <div className="space-y-2">
            {task.records.map((r, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="size-1.5 rounded-full bg-eco-500 shrink-0 mt-1.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-body text-foreground">{r.content}</p>
                  <p className="text-caption text-muted-foreground">
                    {new Date(r.time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    {r.progress !== undefined && ` · ${r.progress}%`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer 操作 */}
      <div className="border-t border-border p-3 space-y-2">
        {showProgressInput ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input type="range" min="0" max="100" value={newProgress}
                onChange={e => setNewProgress(Number(e.target.value))}
                className="flex-1 accent-eco-600" />
              <span className="text-caption font-semibold text-eco-600 w-8 text-right">{newProgress}%</span>
            </div>
            <input value={newContent} onChange={e => setNewContent(e.target.value)}
              placeholder="整改记录说明..."
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-body focus:outline-none focus:ring-1 focus:ring-eco-300" />
            <div className="flex gap-2">
              <button onClick={() => setShowProgressInput(false)}
                className="flex-1 rounded-lg border border-border py-1.5 text-caption text-foreground hover:bg-accent">
                取消
              </button>
              <button onClick={() => {
                onUpdateProgress(newProgress, Math.floor(newProgress / 100 * task.nodes.length), newContent)
                setShowProgressInput(false)
                setNewContent("")
              }}
                className="flex-1 rounded-lg bg-eco-600 py-1.5 text-caption text-white hover:bg-eco-700">
                保存
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => setShowProgressInput(true)}
              className="flex-1 rounded-lg border border-border py-2 text-body text-foreground hover:bg-accent transition-colors">
              更新进度
            </button>
            {task.type === "tracking" && !task.escalatedToLegal && (
              <button onClick={onEscalate}
                className="flex items-center gap-1 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-body text-destructive hover:bg-destructive/20 transition-colors">
                <AlertTriangle className="size-3.5" />升级立案
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════ 主组件 ═══════════════