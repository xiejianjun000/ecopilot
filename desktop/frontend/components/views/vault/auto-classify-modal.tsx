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
import { type VaultFile, ALLOWED_EXT, fmtSize, pathExt } from "./types"

export function AutoClassifyModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle")
  const [progress, setProgress] = useState<string[]>([])
  const [result, setResult] = useState<{ category: string; filename: string; code?: string; desc?: string } | null>(null)
  const [error, setError] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) setSelectedFile(f)
  }

  const submit = async () => {
    if (!selectedFile) return
    setStatus("uploading")
    setProgress([])
    setError("")
    setResult(null)

    const fd = new FormData()
    fd.append("file", selectedFile)

    try {
      await ensureAuthToken()
      const res = await fetch(`${getApiBase()}/api/vault/auto-classify`, {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      })
      if (!res.ok || !res.body) throw new Error(`上传失败: ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() || ""
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const ev = JSON.parse(line.slice(6))
              if (ev.type === "progress") {
                setProgress(prev => [...prev, ev.text])
              } else if (ev.type === "classified") {
                setResult({ category: ev.category, filename: ev.filename, code: ev.code, desc: ev.desc })
              } else if (ev.type === "error") {
                setError(ev.detail || "识别失败")
                setStatus("error")
              } else if (ev.type === "done") {
                if (ev.file) {
                  setResult({
                    category: ev.file.category,
                    filename: ev.file.original_name,
                    code: ev.file.code,
                    desc: ev.file.desc,
                  })
                }
                setStatus("done")
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch (e: unknown) {
      console.error('AI 智能识别失败:', e)
      setError(e instanceof Error ? e.message : "网络错误")
      setStatus("error")
    }
  }

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/40" onClick={status === "uploading" ? undefined : onClose} />
      <div className="relative z-10 w-[560px] max-w-[92vw] rounded-2xl border border-border bg-background shadow-modal">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-eco-500 to-eco-700">
              <Sparkles className="size-5 text-eco-50" />
            </div>
            <div>
              <h3 className="text-title font-semibold text-foreground">AI 智能识别归档</h3>
              <p className="text-caption text-muted-foreground">选择本地文件，AI 自动识别分类并归档</p>
            </div>
          </div>
          <button onClick={onClose} disabled={status === "uploading"} aria-label="关闭" className="rounded-lg p-1.5 hover:bg-accent disabled:opacity-40">
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {status === "idle" && (
            <>
              {/* 文件选择区 */}
              <div
                onClick={() => fileRef.current?.click()}
                className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border p-10 cursor-pointer hover:border-eco-400 hover:bg-eco-50/30 transition-all"
              >
                <div className="flex size-12 items-center justify-center rounded-full bg-eco-50">
                  <Upload className="size-6 text-eco-600" />
                </div>
                <div className="text-center">
                  <p className="text-body font-medium text-foreground">点击选择本地文件</p>
                  <p className="text-caption text-muted-foreground mt-1">支持 PDF / Word / Excel / 图片 / 文本 等</p>
                </div>
                <input ref={fileRef} type="file" className="hidden" onChange={handleFileChange} accept={ALLOWED_EXT.join(",")} />
              </div>
              {selectedFile && (
                <div className="flex items-center gap-3 rounded-lg bg-eco-50/50 border border-eco-100 p-3">
                  <FileIcon ext={pathExt(selectedFile.name)} className="size-5 text-eco-600" />
                  <div className="flex-1 min-w-0">
                    <div className="text-body font-medium text-foreground truncate">{selectedFile.name}</div>
                    <div className="text-caption text-muted-foreground">{fmtSize(selectedFile.size)}</div>
                  </div>
                  <button onClick={() => setSelectedFile(null)} aria-label="移除选中文件" className="rounded p-1 hover:bg-accent">
                    <X className="size-4 text-muted-foreground" />
                  </button>
                </div>
              )}
              {/* 说明 */}
              <div className="rounded-lg bg-secondary/50 p-3 text-xs text-muted-foreground space-y-1.5">
                <div className="flex items-center gap-1.5 font-medium text-foreground"><Sparkles className="size-3.5 text-eco-600" />AI 智能识别流程</div>
                <p>1. 选择本地文件（环评报告、许可证、监测报告等）</p>
                <p>2. AI 自动读取文件内容并识别档案类型</p>
                <p>3. 自动匹配 9 大法定档案分类之一</p>
                <p>4. 归档到档案库并记录上传时间</p>
              </div>
            </>
          )}

          {status === "uploading" && (
            <div className="py-6 space-y-3">
              <div className="flex items-center gap-2 text-body text-foreground">
                <Loader2 className="size-4 animate-spin text-eco-600" />
                <span>AI 正在识别文件...</span>
              </div>
              <div className="rounded-lg bg-secondary/50 p-3 max-h-[280px] overflow-y-auto space-y-1.5">
                {progress.map((p, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="size-3 text-eco-500 mt-0.5 shrink-0" />
                    <span>{p}</span>
                  </div>
                ))}
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin mt-0.5 shrink-0" />
                  <span>正在处理...</span>
                </div>
              </div>
            </div>
          )}

          {status === "done" && result && (
            <div className="py-4 space-y-4">
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="flex size-14 items-center justify-center rounded-full bg-success/10">
                  <CheckCircle2 className="size-8 text-success" />
                </div>
                <div className="text-center">
                  <p className="text-body font-semibold text-foreground">归档成功</p>
                  <p className="text-caption text-muted-foreground mt-0.5">文件已自动识别分类并保存到档案库</p>
                </div>
              </div>
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">文件名</span>
                  <span className="font-medium text-foreground truncate max-w-[300px]">{result.filename}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">AI 识别分类</span>
                  <span className="rounded-md bg-eco-50 px-2 py-0.5 font-semibold text-eco-700">{result.category}</span>
                </div>
                {result.code && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">文号</span>
                    <span className="font-mono text-foreground">{result.code}</span>
                  </div>
                )}
                {result.desc && (
                  <div className="text-xs text-muted-foreground pt-2 border-t border-border">
                    <span className="font-medium text-foreground">AI 描述：</span>{result.desc}
                  </div>
                )}
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="py-6 space-y-3">
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10">
                  <AlertTriangle className="size-8 text-destructive" />
                </div>
                <div className="text-center">
                  <p className="text-body font-semibold text-foreground">识别失败</p>
                  <p className="text-caption text-destructive mt-0.5">{error}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-border bg-secondary/20">
          {status === "done" || status === "error" ? (
            <>
              <button onClick={onClose} className="rounded-lg bg-secondary px-4 py-2 text-body text-foreground hover:bg-accent">关闭</button>
              {status === "done" && (
                <button onClick={onDone} className="rounded-lg bg-eco-600 px-4 py-2 text-body text-eco-50 hover:bg-eco-700">前往档案库查看</button>
              )}
            </>
          ) : (
            <>
              <button onClick={onClose} disabled={status === "uploading"} className="rounded-lg bg-secondary px-4 py-2 text-body text-foreground hover:bg-accent disabled:opacity-40">取消</button>
              <button onClick={submit} disabled={!selectedFile || status === "uploading"} className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-eco-600 to-eco-700 px-4 py-2 text-body text-eco-50 hover:from-eco-700 hover:to-eco-800 disabled:opacity-40">
                {status === "uploading" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {status === "uploading" ? "识别中..." : "开始 AI 识别"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Path_ext 已迁移至 ./vault/types.ts 中的 pathExt
