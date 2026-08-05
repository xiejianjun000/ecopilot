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

export function CreateTaskModal({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: (task: Partial<RectificationTask>) => void
}) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [requirement, setRequirement] = useState("")
  const [type, setType] = useState<RectificationType>("immediate")
  const [source, setSource] = useState("self_check")
  const [sourceDetail, setSourceDetail] = useState("")
  const [category, setCategory] = useState("台账管理")
  const [regulation, setRegulation] = useState("")
  const [deadline, setDeadline] = useState("")
  const [severity, setSeverity] = useState<Severity>("medium")
  const [responsibleUnit, setResponsibleUnit] = useState("安环部")
  const [saving, setSaving] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    setTimeout(() => closeBtnRef.current?.focus(), 100)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [open, onClose])

  const handleSave = async () => {
    if (!title.trim()) return
    setSaving(true)
    const task: Partial<RectificationTask> = {
      title: title.trim(),
      description: description.trim(),
      requirement: requirement.trim(),
      type,
      source,
      sourceDetail: sourceDetail.trim() || SOURCE_LABELS[source] || "",
      category,
      regulation: regulation.trim(),
      deadline,
      severity,
      responsibleUnit: responsibleUnit.trim() || "安环部",
    }
    await onCreated(task)
    setSaving(false)
    // 重置
    setTitle(""); setDescription(""); setRequirement(""); setDeadline("")
    setSourceDetail(""); setRegulation("")
    onClose()
  }

  if (!open) return null

  const inputCls = "w-full rounded-lg border border-border bg-card px-3 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-eco-300"

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/40 backdrop-blur-sm" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="新建整改工单"
        className="relative flex max-h-[90vh] w-[520px] flex-col overflow-hidden rounded-2xl bg-background shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <button ref={closeBtnRef} onClick={onClose} aria-label="关闭"
          className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="size-4" />
        </button>

        <div className="px-6 pt-6 pb-3">
          <h2 className="text-section font-semibold text-foreground">新建整改工单</h2>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4">
          {/* 类型选择 */}
          <div>
            <label className="block text-caption font-medium text-foreground mb-2">整改类型</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(TYPE_CONFIG) as RectificationType[]).map(t => {
                const cfg = TYPE_CONFIG[t]
                const Icon = cfg.icon
                const selected = type === t
                return (
                  <button key={t} onClick={() => setType(t)}
                    className={cn("flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 transition-all",
                      selected ? "border-eco-500 bg-eco-50 text-eco-700" : "border-border bg-card text-muted-foreground hover:bg-accent")}>
                    <Icon className="size-5" />
                    <span className="text-caption font-medium">{cfg.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="block text-caption font-medium text-foreground mb-1.5">问题标题 <span className="text-destructive">*</span></label>
            <input value={title} onChange={e => setTitle(e.target.value)} autoFocus
              placeholder="如：台账缺失3天记录"
              className={inputCls} />
          </div>

          <div>
            <label className="block text-caption font-medium text-foreground mb-1.5">问题描述</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              rows={2} placeholder="详细描述问题情况..."
              className={cn(inputCls, "resize-none")} />
          </div>

          <div>
            <label className="block text-caption font-medium text-foreground mb-1.5">整改要求</label>
            <textarea value={requirement} onChange={e => setRequirement(e.target.value)}
              rows={2} placeholder="如：7天内补齐台账记录..."
              className={cn(inputCls, "resize-none")} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-caption font-medium text-foreground mb-1.5">问题类别</label>
              <select value={category} onChange={e => setCategory(e.target.value)} className={inputCls}>
                {["许可管理", "台账管理", "自行监测", "执行报告", "应急预案", "固废管理", "排放口", "其他"].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-caption font-medium text-foreground mb-1.5">交办来源</label>
              <select value={source} onChange={e => setSource(e.target.value)} className={inputCls}>
                {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-caption font-medium text-foreground mb-1.5">来源详情</label>
            <input value={sourceDetail} onChange={e => setSourceDetail(e.target.value)}
              placeholder="如：2025年中央环保督察第3批"
              className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-caption font-medium text-foreground mb-1.5">法规依据</label>
              <input value={regulation} onChange={e => setRegulation(e.target.value)}
                placeholder="如：条例§21"
                className={inputCls} />
            </div>
            <div>
              <label className="block text-caption font-medium text-foreground mb-1.5">截止日期</label>
              <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
                className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-caption font-medium text-foreground mb-1.5">严重度</label>
              <div className="flex gap-2">
                {(["high", "medium", "low"] as Severity[]).map(s => (
                  <button key={s} onClick={() => setSeverity(s)}
                    className={cn("flex-1 rounded-lg border px-3 py-2 text-caption font-medium transition-all",
                      severity === s
                        ? s === "high" ? "border-destructive bg-destructive/10 text-destructive"
                          : s === "medium" ? "border-warning bg-warning/10 text-warning"
                          : "border-info bg-info/10 text-info"
                        : "border-border bg-card text-muted-foreground hover:bg-accent")}>
                    {SEVERITY_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-caption font-medium text-foreground mb-1.5">责任部门</label>
              <input value={responsibleUnit} onChange={e => setResponsibleUnit(e.target.value)}
                placeholder="安环部"
                className={inputCls} />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-6 py-3">
          <button onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-body text-foreground hover:bg-accent transition-colors">
            取消
          </button>
          <button onClick={handleSave} disabled={!title.trim() || saving}
            className="flex items-center gap-1.5 rounded-lg bg-eco-600 px-4 py-2 text-body text-white hover:bg-eco-700 transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            创建工单
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════ 上传交办文件 Modal ═══════════════