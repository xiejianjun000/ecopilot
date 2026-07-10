"use client"
import { useState, useEffect, useRef, useCallback } from "react"
import {
  Zap, Scale, HardHat, Upload, Sparkles, Plus, X, Clock,
  AlertTriangle, CheckCircle2, FileText, Loader2,
  ShieldCheck, AlertCircle, Lightbulb
} from "lucide-react"
import { cn } from "@/lib/utils"
import { apiPost } from "@/lib/api"

// ═══════════════ 类型 ═══════════════
type RectificationType = "immediate" | "tracking" | "engineering"
type TaskStatus = "pending" | "in_progress" | "review" | "completed"
type Severity = "high" | "medium" | "low"

interface TaskNode {
  name: string
  status: "done" | "current" | "pending"
  date?: string
}

interface LegalDeadline {
  name: string
  deadline: string
  status: "pending" | "done" | "overdue"
}

interface RectificationRecord {
  time: string
  content: string
  progress?: number
}

interface ComplianceGap {
  item: string
  status: "missing" | "partial" | "established"
}

interface TaskReview {
  detectionStatus: "detected_unfixed" | "detected_untracked" | "undetected"
  detectionNote: string
  rootCause: { primary: string; secondary: string[] }
  complianceGap: ComplianceGap[]
  preventionSuggestions: string[]
  generatedAt: string
  updatedAt?: string
}

interface RectificationTask {
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

// ═══════════════ 类型配置 ═══════════════
const TYPE_CONFIG: Record<RectificationType, {
  label: string
  icon: typeof Zap
  color: string
  borderColor: string
  bgColor: string
  textColor: string
  trackBy: string
}> = {
  immediate: {
    label: "立行立改",
    icon: Zap,
    color: "destructive",
    borderColor: "border-l-destructive",
    bgColor: "bg-destructive/10",
    textColor: "text-destructive",
    trackBy: "按天跟踪",
  },
  tracking: {
    label: "跟踪督办",
    icon: Scale,
    color: "purple",
    borderColor: "border-l-purple-500",
    bgColor: "bg-purple-50",
    textColor: "text-purple-700",
    trackBy: "按周跟踪",
  },
  engineering: {
    label: "工程建设",
    icon: HardHat,
    color: "info",
    borderColor: "border-l-info",
    bgColor: "bg-info/10",
    textColor: "text-info",
    trackBy: "按月跟踪",
  },
}

const SOURCE_LABELS: Record<string, string> = {
  central: "中央督察",
  provincial: "省级督察",
  mee: "部委交办",
  special: "专项整改",
  self_check: "企业自查",
  ai_audit: "AI巡检",
}

const SEVERITY_LABEL: Record<Severity, string> = {
  high: "高风险",
  medium: "中风险",
  low: "低风险",
}

// ═══════════════ 辅助函数 ═══════════════
function daysRemaining(deadline: string): number {
  if (!deadline) return Infinity
  const d = new Date(deadline)
  if (isNaN(d.getTime())) return Infinity
  return Math.ceil((d.getTime() - Date.now()) / 86400000)
}

function formatUrgency(deadline: string): { text: string; color: string } {
  const days = daysRemaining(deadline)
  if (days === Infinity) return { text: "无截止", color: "text-muted-foreground" }
  if (days < 0) return { text: `已逾期${Math.abs(days)}天`, color: "text-destructive" }
  if (days === 0) return { text: "今日截止", color: "text-destructive" }
  if (days <= 3) return { text: `${days}天剩余`, color: "text-destructive" }
  if (days <= 7) return { text: `${days}天剩余`, color: "text-warning" }
  return { text: `${days}天剩余`, color: "text-muted-foreground" }
}

// ═══════════════ 新建工单 Modal ═══════════════
function CreateTaskModal({ open, onClose, onCreated }: {
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
function UploadInspectionModal({ open, onClose, onParsed }: {
  open: boolean
  onClose: () => void
  onParsed: (tasks: Partial<RectificationTask>[]) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose() }
    }
    document.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    setTimeout(() => closeBtnRef.current?.focus(), 100)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [open, onClose])

  const handleParse = async () => {
    if (!file) return
    setParsing(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append("image", file)
      formData.append("prompt", "请识别这份环保督察交办文件中的所有问题")
      // 文件上传需用 fetch + FormData（apiPost 仅支持 JSON），但必须通过 authHeaders 加认证头
      const { authHeaders, getApiBase } = await import("@/lib/api")
      const resp = await fetch(`${getApiBase()}/api/inspection/parse`, {
        method: "POST",
        body: formData,
        headers: authHeaders(),
      })
      const data = await resp.json()
      if (data.ok && data.tasks?.length > 0) {
        onParsed(data.tasks)
        setFile(null)
        onClose()
      } else {
        setError(data.detail || "解析失败，请重试")
      }
    } catch {
      setError("网络错误，请检查后端服务")
    } finally {
      setParsing(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/40 backdrop-blur-sm" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="上传交办文件"
        className="relative flex w-[480px] flex-col overflow-hidden rounded-2xl bg-background shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <button ref={closeBtnRef} onClick={onClose} aria-label="关闭"
          className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="size-4" />
        </button>

        <div className="px-6 pt-6 pb-3">
          <h2 className="text-section font-semibold text-foreground">上传交办文件</h2>
          <p className="text-caption text-muted-foreground mt-1">AI 自动识别问题并分类创建工单</p>
        </div>

        <div className="px-6 pb-6 space-y-4">
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-card py-10 cursor-pointer hover:border-eco-400 hover:bg-eco-50/30 transition-colors"
          >
            {file ? (
              <div className="flex flex-col items-center gap-2">
                <FileText className="size-8 text-eco-600" />
                <span className="text-body text-foreground">{file.name}</span>
                <span className="text-caption text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="size-8 text-muted-foreground" />
                <span className="text-body text-muted-foreground">点击上传交办文件</span>
                <span className="text-caption text-muted-foreground">支持图片/PDF，AI 自动 OCR 识别</span>
              </div>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*,.pdf"
            onChange={e => setFile(e.target.files?.[0] || null)}
            className="hidden" />

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
              <AlertCircle className="size-4 text-destructive shrink-0" />
              <span className="text-caption text-destructive">{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-body text-foreground hover:bg-accent transition-colors">
              取消
            </button>
            <button onClick={handleParse} disabled={!file || parsing}
              className="flex items-center gap-1.5 rounded-lg bg-eco-600 px-4 py-2 text-body text-white hover:bg-eco-700 transition-colors disabled:opacity-50">
              {parsing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {parsing ? "AI 解析中..." : "开始解析"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════ 节点进度条 ═══════════════
function NodeProgress({ nodes, legalNodes, escalated }: {
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
function ReviewSection({ review }: { review?: TaskReview }) {
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
function TaskDetail({ task, onClose, onUpdateProgress, onEscalate }: {
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
export function InspectionView() {
  const [tasks, setTasks] = useState<RectificationTask[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<RectificationType | "all">("all")
  const [createOpen, setCreateOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [aiAuditing, setAiAuditing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }, [])

  // 加载工单
  const loadTasks = useCallback(() => {
    setLoading(true)
    apiPost<{ ok: boolean; tasks: RectificationTask[] }>('/api/rectification/tasks', { action: "list" })
      .then(r => {
        if (r.ok && r.data?.ok) {
          setTasks(r.data.tasks || [])
        } else {
          setTasks([])
        }
      })
      .catch(() => setTasks([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadTasks() }, [loadTasks])

  // 新建工单
  const handleCreate = async (taskData: Partial<RectificationTask>) => {
    const r = await apiPost<{ ok: boolean; task: RectificationTask }>('/api/rectification/tasks', {
      action: "add",
      task: taskData,
    })
    if (r.ok && r.data?.ok && r.data.task) {
      const newTask = r.data.task
      setTasks(prev => [...prev, newTask])
      showToast("工单已创建")
    } else {
      showToast("创建失败")
    }
  }

  // 上传文件解析后批量创建
  const handleParsed = async (parsedTasks: Partial<RectificationTask>[]) => {
    for (const pt of parsedTasks) {
      await apiPost('/api/rectification/tasks', { action: "add", task: pt })
    }
    loadTasks()
    showToast(`已从交办文件创建 ${parsedTasks.length} 个工单`)
  }

  // AI 巡检
  const handleAiAudit = async () => {
    setAiAuditing(true)
    showToast("AI 巡检启动中...")
    try {
      const r = await apiPost<{ ok: boolean; key_findings?: string[] }>('/api/permit/execution/audit', {})
      if (r.ok && r.data?.ok && r.data.key_findings?.length) {
        // 将 findings 转为工单
        for (const finding of r.data.key_findings) {
          await apiPost('/api/rectification/tasks', {
            action: "add",
            task: {
              title: finding.slice(0, 40),
              description: finding,
              type: "tracking",
              source: "ai_audit",
              sourceDetail: "AI 执行报告审计",
              category: "执行报告",
              regulation: "条例§22",
              severity: "medium",
            },
          })
        }
        loadTasks()
        showToast(`AI 巡检发现 ${r.data.key_findings.length} 个问题，已创建工单`)
      } else {
        showToast("AI 巡检完成，未发现问题")
      }
    } catch {
      showToast("AI 巡检失败，请检查后端服务")
    } finally {
      setAiAuditing(false)
    }
  }

  // 更新进度
  const handleUpdateProgress = async (progress: number, nodeIdx: number, content: string) => {
    if (!selectedId) return
    const r = await apiPost<{ ok: boolean; task: RectificationTask }>('/api/rectification/tasks', {
      action: "update_progress",
      taskId: selectedId,
      progress,
      currentNode: nodeIdx,
      content,
    })
    if (r.ok && r.data?.ok && r.data.task) {
      const updated = r.data.task
      setTasks(prev => prev.map(t => t.id === selectedId ? updated : t))
      showToast("进度已更新")
    }
  }

  // 升级立案
  const handleEscalate = async () => {
    if (!selectedId) return
    const r = await apiPost<{ ok: boolean; task: RectificationTask }>('/api/rectification/tasks', {
      action: "escalate_legal",
      taskId: selectedId,
    })
    if (r.ok && r.data?.ok && r.data.task) {
      const escalated = r.data.task
      setTasks(prev => prev.map(t => t.id === selectedId ? escalated : t))
      showToast("已升级为立案查处程序")
    }
  }

  // 统计
  const counts = {
    immediate: tasks.filter(t => t.type === "immediate" && t.status !== "completed").length,
    tracking: tasks.filter(t => t.type === "tracking" && t.status !== "completed").length,
    engineering: tasks.filter(t => t.type === "engineering" && t.status !== "completed").length,
  }
  const urgentCount = tasks.filter(t => {
    if (t.status === "completed") return false
    const d = daysRemaining(t.deadline)
    return d <= 7
  }).length

  const filtered = filter === "all" ? tasks : tasks.filter(t => t.type === filter)
  const sorted = [...filtered].sort((a, b) => {
    // 未完成在前
    if (a.status === "completed" && b.status !== "completed") return 1
    if (a.status !== "completed" && b.status === "completed") return -1
    // 按截止日期升序
    return daysRemaining(a.deadline) - daysRemaining(b.deadline)
  })

  const selectedTask = tasks.find(t => t.id === selectedId)

  return (
    <div className="flex h-full">
      {/* 主区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-section font-semibold text-foreground">交办整改</h2>
            <p className="text-caption text-muted-foreground">立行立改 · 跟踪督办 · 工程建设</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setUploadOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-body text-foreground hover:bg-accent transition-colors">
              <Upload className="size-3.5" />上传交办文件
            </button>
            <button onClick={handleAiAudit} disabled={aiAuditing}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-body text-foreground hover:bg-accent transition-colors disabled:opacity-50">
              {aiAuditing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {aiAuditing ? "巡检中..." : "AI 巡检"}
            </button>
            <button onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-eco-600 px-3 py-1.5 text-body text-white hover:bg-eco-700 transition-colors">
              <Plus className="size-3.5" />手动录入
            </button>
          </div>
        </header>

        {/* Zone 1：概览条 */}
        <div className="px-6 pb-3">
          <div className="grid grid-cols-4 gap-3">
            <div className={cn("rounded-xl border border-l-4 p-3", TYPE_CONFIG.immediate.borderColor, "border-border bg-card")}>
              <div className="flex items-center gap-2">
                <Zap className="size-4 text-destructive" />
                <span className="text-caption text-muted-foreground">立行立改</span>
              </div>
              <p className="text-section font-semibold text-foreground mt-1">{counts.immediate}</p>
            </div>
            <div className={cn("rounded-xl border border-l-4 p-3", TYPE_CONFIG.tracking.borderColor, "border-border bg-card")}>
              <div className="flex items-center gap-2">
                <Scale className="size-4 text-purple-600" />
                <span className="text-caption text-muted-foreground">跟踪督办</span>
              </div>
              <p className="text-section font-semibold text-foreground mt-1">{counts.tracking}</p>
            </div>
            <div className={cn("rounded-xl border border-l-4 p-3", TYPE_CONFIG.engineering.borderColor, "border-border bg-card")}>
              <div className="flex items-center gap-2">
                <HardHat className="size-4 text-info" />
                <span className="text-caption text-muted-foreground">工程建设</span>
              </div>
              <p className="text-section font-semibold text-foreground mt-1">{counts.engineering}</p>
            </div>
            <div className="rounded-xl border border-l-4 border-l-warning border-border bg-warning/5 p-3">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-warning" />
                <span className="text-caption text-muted-foreground">7天内紧急</span>
              </div>
              <p className="text-section font-semibold text-warning mt-1">{urgentCount}</p>
            </div>
          </div>
        </div>

        {/* 筛选 */}
        <div className="flex items-center gap-2 px-6 pb-2">
          {(["all", "immediate", "tracking", "engineering"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn("rounded-lg px-3 py-1 text-caption font-medium transition-colors",
                filter === f ? "bg-eco-50 text-eco-700" : "text-muted-foreground hover:bg-accent")}>
              {f === "all" ? "全部" : TYPE_CONFIG[f].label}
              <span className="ml-1 text-muted-foreground/60">
                ({f === "all" ? tasks.length : counts[f as Exclude<typeof f, "all">]})
              </span>
            </button>
          ))}
        </div>

        {/* Zone 2：工单列表 */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="size-6 animate-spin text-eco-600" />
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <ShieldCheck className="size-10 text-success mb-3" />
              <p className="text-body text-muted-foreground">暂无整改工单</p>
              <p className="text-caption text-muted-foreground mt-1">上传交办文件或手动录入创建工单</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sorted.map(task => {
                const cfg = TYPE_CONFIG[task.type]
                const TypeIcon = cfg.icon
                const urgency = formatUrgency(task.deadline)
                const isSelected = task.id === selectedId
                return (
                  <button key={task.id} onClick={() => setSelectedId(task.id)}
                    className={cn("w-full text-left rounded-xl border border-l-4 bg-card p-3 transition-all",
                      cfg.borderColor,
                      isSelected ? "border-eco-300 ring-1 ring-eco-200" : "border-border hover:shadow-sm")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <TypeIcon className={cn("size-3.5 shrink-0", cfg.textColor)} />
                          <span className="text-caption text-muted-foreground">
                            {SOURCE_LABELS[task.source] || task.source || "未知"}
                          </span>
                          {task.escalatedToLegal && (
                            <span className="text-caption font-medium text-destructive">· 已立案</span>
                          )}
                          <span className={cn("text-caption font-medium", urgency.color)}>· {urgency.text}</span>
                        </div>
                        <h4 className={cn("text-body font-medium truncate",
                          task.status === "completed" ? "text-muted-foreground line-through" : "text-foreground")}>
                          {task.title}
                        </h4>
                        {task.regulation && (
                          <p className="text-caption text-muted-foreground mt-0.5">{task.regulation}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-caption font-semibold text-eco-600">{task.progress}%</span>
                        {task.status === "completed" && (
                          <CheckCircle2 className="size-3.5 text-success" />
                        )}
                      </div>
                    </div>
                    {/* 节点进度条 */}
                    <div className="mt-2 flex items-center gap-1">
                      {task.nodes.map((n, i) => (
                        <div key={i} className={cn("size-1.5 rounded-full",
                          n.status === "done" ? "bg-eco-500"
                            : n.status === "current" ? "bg-warning"
                            : "bg-muted"
                        )} />
                      ))}
                      {task.escalatedToLegal && task.legalNodes?.map((n, i) => (
                        <div key={`l${i}`} className={cn("size-1.5 rounded-full",
                          n.status === "done" ? "bg-destructive"
                            : n.status === "current" ? "bg-destructive ring-1 ring-destructive/30"
                            : "bg-muted"
                        )} />
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Zone 3：详情区 */}
      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          onClose={() => setSelectedId(null)}
          onUpdateProgress={handleUpdateProgress}
          onEscalate={handleEscalate}
        />
      )}

      {/* Modals */}
      <CreateTaskModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={handleCreate} />
      <UploadInspectionModal open={uploadOpen} onClose={() => setUploadOpen(false)} onParsed={handleParsed} />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-foreground px-4 py-2 text-body text-background shadow-modal">
          {toast}
        </div>
      )}
    </div>
  )
}
