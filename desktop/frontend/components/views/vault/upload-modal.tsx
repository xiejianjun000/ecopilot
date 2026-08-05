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
import { type VaultFile, type RequiredDoc, type MergedItem, type UploadTarget, ALLOWED_EXT, VAULT_ALLOWED_EXT, fmtSize, fmtDate, extLabel, pathExt } from "./types"

export function UploadModal({ target, categories, onClose, onDone }: {
  target: UploadTarget; categories: string[]; onClose: () => void; onDone: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [category, setCategory] = useState(target.cat || "其他")
  const [code, setCode] = useState("")
  const [desc, setDesc] = useState("")
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (f: File | null) => {
    if (!f) return
    const ext = "." + (f.name.split(".").pop() || "").toLowerCase()
    if (!ALLOWED_EXT.includes(ext)) { setError(`不支持的文件类型：${ext}`); return }
    if (f.size > 50 * 1024 * 1024) { setError(`文件过大：${(f.size / 1024 / 1024).toFixed(1)}MB（上限 50MB）`); return }
    setError(""); setSelectedFile(f)
  }
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]) }

  const submit = async () => {
    if (!selectedFile) { setError("请先选择文件"); return }
    setUploading(true); setProgress(0); setError("")
    const fd = new FormData()
    fd.append("file", selectedFile); fd.append("category", category); fd.append("code", code); fd.append("desc", desc)
    if (target.tpl_id) fd.append("tpl_id", target.tpl_id)
    try {
      await ensureAuthToken()
      const xhr = new XMLHttpRequest()
      xhr.open("POST", `${getApiBase()}/api/vault/upload`)
      const _h = authHeaders()
      if (_h['Authorization']) xhr.setRequestHeader("Authorization", _h['Authorization'])
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round(e.loaded / e.total * 100)) }
      xhr.onload = () => {
        try {
          const d = JSON.parse(xhr.responseText)
          if (d.ok) { setUploading(false); onDone() }
          else { setUploading(false); setError(d.detail || "上传失败") }
        } catch { setUploading(false); setError("解析响应失败") }
      }
      xhr.onerror = () => { setUploading(false); setError("网络错误，上传失败") }
      xhr.send(fd)
    } catch (e) { setUploading(false); setError("上传异常：" + String(e)) }
  }

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/40" onClick={uploading ? undefined : onClose} />
      <div className="relative z-10 w-[560px] max-w-[90vw] max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-background p-6 shadow-modal">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex size-9 items-center justify-center rounded-lg bg-eco-50"><Upload className="size-4 text-eco-600" /></div>
            <div className="min-w-0">
              <h3 className="text-title font-semibold text-foreground">上传档案</h3>
              {target.tpl_id && <p className="text-caption text-muted-foreground">补传：{target.name}</p>}
            </div>
          </div>
          <button onClick={onClose} disabled={uploading} aria-label="关闭上传对话框" className="rounded-lg p-2 text-muted-foreground hover:bg-accent disabled:opacity-40"><X className="size-5" /></button>
        </div>
        <div onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => !selectedFile && inputRef.current?.click()} className={cn("flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors", dragging ? "border-eco-500 bg-eco-50" : "border-border hover:border-eco-300 hover:bg-accent/30", selectedFile && "cursor-default border-success/30 bg-success/10")}>
          <input ref={inputRef} type="file" className="hidden" onChange={(e) => handleFile(e.target.files?.[0] || null)} accept={ALLOWED_EXT.join(",")} />
          {selectedFile ? (
            <>
              <CheckCircle2 className="size-8 text-success" />
              <div className="text-body font-medium text-foreground">{selectedFile.name}</div>
              <div className="text-caption text-muted-foreground">{fmtSize(selectedFile.size)} · 点击重新选择</div>
            </>
          ) : (
            <>
              <Upload className="size-8 text-muted-foreground" />
              <div className="text-body font-medium text-foreground">点击或拖拽文件到此处</div>
              <div className="text-caption text-muted-foreground">支持 PDF / Word / Excel / 图片 / 文本 / 压缩包，最大 50MB</div>
            </>
          )}
        </div>
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-caption font-medium text-muted-foreground mb-1.5">档案类别</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={uploading} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-body focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60">
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-caption font-medium text-muted-foreground mb-1.5">文号 / 编号</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} disabled={uploading} placeholder="如：湘环评[2019]138号" className="w-full rounded-lg border border-border bg-card px-3 py-2 text-body focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60" />
            </div>
          </div>
          <div>
            <label className="block text-caption font-medium text-muted-foreground mb-1.5">描述（可选）</label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} disabled={uploading} rows={2} placeholder="如：废水零排放要求、批复排放总量..." className="w-full rounded-lg border border-border bg-card px-3 py-2 text-body focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60 resize-none" />
          </div>
        </div>
        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
            <AlertTriangle className="size-4 text-destructive shrink-0" />
            <span className="text-body text-destructive">{error}</span>
          </div>
        )}
        {uploading && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-caption text-muted-foreground mb-1.5">
              <span>上传中...</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 rounded-full bg-secondary overflow-hidden">
              <div className="h-full rounded-full bg-eco-500 transition-all" style={{ width: progress + "%" }} />
            </div>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} disabled={uploading} className="rounded-lg bg-secondary px-4 py-2 text-body text-foreground hover:bg-accent disabled:opacity-40">取消</button>
          <button onClick={submit} disabled={!selectedFile || uploading} className="flex items-center gap-1.5 rounded-lg bg-eco-600 px-4 py-2 text-body text-eco-50 hover:bg-eco-700 disabled:opacity-40">
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {uploading ? "上传中" : "确认上传"}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ═══ AI 智能识别归档弹窗 ═══ */
