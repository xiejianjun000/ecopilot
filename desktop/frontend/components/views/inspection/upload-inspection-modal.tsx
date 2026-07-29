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

export function UploadInspectionModal({ open, onClose, onParsed }: {
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
    } catch (e) { console.error("[inspection] Load failed:", e)
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