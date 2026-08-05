"use client"
import { useState, useEffect, useRef, useCallback } from "react"
import {
  Upload, Search, AlertTriangle, CheckCircle2,
  FolderArchive, Download, X, Trash2, Loader2,
  ChevronDown, ChevronRight, PanelRightClose, Send, Sparkles,
  Settings2, Plus, GripVertical, ArrowUp, ArrowDown, Pencil,
  BookOpen, CheckCircle, Save,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getApiBase, streamSSE, apiGet, apiPost, apiDelete, apiPut, ensureAuthToken, authHeaders, getAuthToken } from "@/lib/api"
import { FileIcon, fileTypeColor, HighlightText } from "./shared"
import { type VaultFile, type RequiredDoc, type MergedItem, type VaultOpResult, VAULT_ALLOWED_EXT, fmtSize, fmtDate, extLabel, pathExt } from "./types"
import { AIAnalysisPanel } from "./aianalysis-panel"

export function DocPreviewPanel({ file, onClose, onDelete, onEdit, analyzedIds, onAnalyzed }: {
  file: VaultFile; onClose: () => void; onDelete: () => void; onEdit: () => void
  analyzedIds: Set<string>
  onAnalyzed: (id: string) => void
}) {
  const ext = file.ext.toLowerCase()
  const _tok = getAuthToken() ? `&token=${encodeURIComponent(getAuthToken()!)}` : ''
  const fileUrl = `${getApiBase()}/api/vault/file?id=${encodeURIComponent(file.id)}&inline=1${_tok}`
  const downloadUrl = `${getApiBase()}/api/vault/file?id=${encodeURIComponent(file.id)}&inline=0${_tok}`
  const [textContent, setTextContent] = useState<string | null>(null)
  const [textError, setTextError] = useState("")
  const [showAI, setShowAI] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [synced, setSynced] = useState(false)
  const [syncMsg, setSyncMsg] = useState("")

  const isPdf = ext === ".pdf"
  const isImage = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"].includes(ext)
  const isText = [".txt", ".md", ".csv", ".log"].includes(ext)
  const isOffice = [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"].includes(ext)
  const isArchive = [".zip", ".rar", ".7z"].includes(ext)

  useEffect(() => {
    if (!isText) return
    setTextContent(null); setTextError("")
    apiGet<string>('/api/vault/file', { id: file.id, inline: '1' })
      .then(r => {
        if (r.ok && r.data != null) {
          setTextContent(typeof r.data === 'string' ? r.data : String(r.data))
        } else {
          setTextError(r.error || "文本内容加载失败")
        }
      })
      .catch(() => setTextError("文本内容加载失败"))
  }, [file.id, isText])

  const handleSync = async () => {
    setSyncing(true); setSyncMsg("")
    try {
      const r = await apiPost<VaultOpResult>(
        `/api/vault/sync-to-knowledge?id=${encodeURIComponent(file.id)}`
      )
      if (r.ok && r.data?.ok) {
        setSynced(true)
        setSyncMsg(`✓ 已生成「${r.data.md_filename || file.original_name}.md」`)
      } else {
        setSyncMsg(`✗ ${r.data?.detail || r.error || "同步失败"}`)
      }
    } catch (e) {
      console.error('同步档案失败:', e)
      setSyncMsg("✗ 网络错误，同步失败")
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncMsg(""), 4000)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-eco-50">
            <FileIcon ext={ext} className="size-4 text-eco-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-body font-semibold text-foreground truncate">{file.original_name}</h2>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="rounded bg-secondary px-1.5 py-0.5 text-caption text-muted-foreground">{file.category}</span>
              {file.code && <span className="text-caption text-muted-foreground font-mono truncate max-w-[120px]">{file.code}</span>}
              <span className="text-caption text-muted-foreground">{fmtSize(file.size)}</span>
              <span className="rounded bg-eco-50 px-1.5 py-0.5 text-caption text-eco-700 font-mono uppercase">{ext}</span>
              {syncMsg && (
                <span className={cn("rounded px-1.5 py-0.5 text-caption font-medium", syncMsg.startsWith("✓") ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
                  {syncMsg}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleSync}
            disabled={syncing}
            title="AI 读取文件内容生成 MD 摘要，存入知识库"
            className={cn(
              "rounded-lg p-2 transition-colors",
              synced ? "bg-success/10 text-success hover:bg-success/20" : "bg-secondary text-muted-foreground hover:bg-eco-100 hover:text-eco-700",
              syncing && "opacity-60 cursor-wait"
            )}
          >
            {syncing ? <Loader2 className="size-4 animate-spin" /> : synced ? <CheckCircle className="size-4" /> : <BookOpen className="size-4" />}
          </button>
          <button onClick={() => window.open(downloadUrl, "_blank")} aria-label="下载文件" className="rounded-lg bg-secondary p-2 text-muted-foreground hover:text-foreground" title="下载"><Download className="size-4" /></button>
          <button onClick={onEdit} aria-label="编辑档案信息" className="rounded-lg bg-secondary p-2 text-muted-foreground hover:text-eco-600 hover:bg-eco-50" title="编辑"><Pencil className="size-4" /></button>
          <button onClick={onDelete} aria-label="删除文件" className="rounded-lg bg-secondary p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10" title="删除"><Trash2 className="size-4" /></button>
          <button onClick={() => setShowAI(!showAI)} aria-label="AI分析" className={cn("rounded-lg p-2", showAI ? "bg-eco-50 text-eco-600" : "bg-secondary text-muted-foreground hover:text-foreground")} title="AI 分析"><Sparkles className="size-4" /></button>
          <button onClick={onClose} aria-label="关闭详情" className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground" title="关闭"><PanelRightClose className="size-4" /></button>
        </div>
      </div>

      {/* 描述栏 */}
      {file.desc && (
        <div className="px-4 py-1.5 border-b border-border bg-secondary/20 shrink-0">
          <span className="text-caption text-muted-foreground">备注：</span>
          <span className="text-caption text-foreground/80">{file.desc}</span>
        </div>
      )}

      {/* 内容区：预览 + AI（可折叠） */}
      <div className="flex-1 flex overflow-hidden">
        {/* 预览区 */}
        <div className={cn("flex-1 overflow-hidden bg-canvas", showAI && "border-r border-border")}>
          {isPdf && <iframe src={fileUrl} title={file.original_name} className="w-full h-full border-0" />}
          {isImage && (
            <div className="w-full h-full overflow-auto flex items-center justify-center p-4">
              <img src={fileUrl} alt={file.original_name} className="max-w-full max-h-full object-contain rounded-lg shadow-sm" />
            </div>
          )}
          {isText && (
            <div className="w-full h-full overflow-auto">
              {textError ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                  <AlertTriangle className="size-6 text-warning" />
                  <p className="text-caption">{textError}</p>
                </div>
              ) : textContent === null ? (
                <div className="flex items-center justify-center h-full text-muted-foreground"><Loader2 className="size-5 animate-spin mr-2" />加载中...</div>
              ) : (
                <pre className="p-5 text-body text-foreground/90 font-mono whitespace-pre-wrap break-words leading-relaxed">{textContent}</pre>
              )}
            </div>
          )}
          {(isOffice || isArchive || (!isPdf && !isImage && !isText)) && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-secondary">
                <FileIcon ext={ext} className="size-7" />
              </div>
              <div className="text-center">
                <p className="text-body font-medium text-foreground">此文件类型不支持在线预览</p>
                <p className="text-caption mt-1">{ext.toUpperCase()} 文件 · 请下载后用对应软件打开</p>
              </div>
              <button onClick={() => window.open(downloadUrl, "_blank")} className="flex items-center gap-1.5 rounded-lg bg-eco-600 px-4 py-2 text-body text-eco-50 hover:bg-eco-700">
                <Download className="size-4" />下载文件
              </button>
            </div>
          )}
        </div>

        {/* AI 分析面板 */}
        {showAI && (
          <AIAnalysisPanel fileId={file.id} fileExt={ext} analyzedIds={analyzedIds} onAnalyzed={onAnalyzed} />
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════
 * AI 分析面板（右栏右侧）
 * ═══════════════════════════════════════════════════════ */

const QUICK_QUESTIONS = [
  "合规要点分析",
  "关键条款提取",
  "风险提示",
  "有效期与续期",
]

