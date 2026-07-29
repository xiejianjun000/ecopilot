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
import { type VaultFile, type RequiredDoc, type MergedItem, VAULT_ALLOWED_EXT, fmtSize, fmtDate, extLabel, pathExt } from "./types"
const ALLOWED_EXT = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt", ".md", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".csv", ".ppt", ".pptx", ".zip", ".rar", ".7z"]
const QUICK_QUESTIONS: { q: string; icon: string }[] = [
  { q: "这份档案的核心内容是什么？", icon: "Search" },
  { q: "帮我总结关键数据和指标", icon: "BarChart3" },
  { q: "档案中有哪些合规问题或风险点？", icon: "AlertTriangle" },
]

export function AIAnalysisPanel({ fileId, fileExt, analyzedIds, onAnalyzed }: {
  fileId: string; fileExt: string;
  analyzedIds: Set<string>;
  onAnalyzed: (id: string) => void;
}) {
  const [messages, setMessages] = useState<{ role: "user" | "ai"; content: string }[]>([])
  const [input, setInput] = useState("")
  const [analyzing, setAnalyzing] = useState(false)
  const [progress, setProgress] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)

  const canAnalyze = [".txt", ".md", ".csv", ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".pdf"].includes(fileExt)
  // P1: 用父级 analyzedIds 替代本地 autoStartedRef，避免重开右栏重复调 AI

  // 切换文件时重置状态
  useEffect(() => {
    setMessages([])
    setInput("")
    setProgress("")
    setAnalyzing(false)
  }, [fileId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, progress])

  const analyze = async (question: string) => {
    if (!question.trim() || analyzing) return
    setAnalyzing(true)
    setProgress("")
    setInput("")
    setMessages(m => [...m, { role: "user", content: question }])
    let aiText = ""
    setMessages(m => [...m, { role: "ai", content: "" }])
    try {
      for await (const evt of streamSSE("/api/vault/analyze", { id: fileId, question })) {
        if (evt.type === "progress") {
          setProgress(String(evt.name || ""))
        } else if (evt.type === "text_delta" && typeof evt.text === "string") {
          aiText += evt.text
          setMessages(m => {
            const copy = [...m]
            copy[copy.length - 1] = { role: "ai", content: aiText }
            return copy
          })
        } else if (evt.type === "error") {
          setMessages(m => {
            const copy = [...m]
            copy[copy.length - 1] = { role: "ai", content: "⚠️ " + String(evt.detail || "分析失败") }
            return copy
          })
        }
      }
    } catch (e) {
      setMessages(m => {
        const copy = [...m]
        copy[copy.length - 1] = { role: "ai", content: "⚠️ 网络错误：" + String(e) }
        return copy
      })
    }
    setAnalyzing(false)
    setProgress("")
  }

  // 自动阅读：右栏打开时 AI 自动开始分析文档（同一 fileId 只跑一次）
  useEffect(() => {
    if (canAnalyze && !analyzedIds.has(fileId)) {
      onAnalyzed(fileId)
      analyze("请自动阅读此档案，给出合规要点分析、关键条款提取和风险提示")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAnalyze, fileId, analyzedIds])

  return (
    <div className="w-[340px] shrink-0 flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2 shrink-0">
        <Sparkles className="size-3.5 text-eco-600" />
        <span className="text-body font-semibold text-foreground">AI 档案分析</span>
      </div>

      {!canAnalyze ? (
        <div className="flex-1 flex flex-col items-center justify-center p-4 text-center gap-3">
          <AlertTriangle className="size-8 text-warning" />
          <div>
            <p className="text-body font-medium text-foreground">此文件类型暂不支持 AI 分析</p>
            <p className="text-caption text-muted-foreground mt-1">支持：PDF / 图片 / 文本 / Markdown</p>
          </div>
        </div>
      ) : (
        <>
          {/* 对话区 */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-full bg-eco-50">
                  <Loader2 className="size-5 text-eco-600 animate-spin" />
                </div>
                <div>
                  <p className="text-body font-medium text-foreground">AI 正在阅读档案...</p>
                  <p className="text-caption text-muted-foreground mt-1">自动分析合规要点与风险</p>
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[90%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words",
                    m.role === "user" ? "bg-eco-600 text-eco-50" : "bg-secondary text-foreground/90"
                  )}>
                    {m.content || (analyzing && progress ? <span className="text-muted-foreground">{progress}...</span> : <Loader2 className="size-3 animate-spin inline" />)}
                  </div>
                </div>
              ))
            )}
            {analyzing && progress && messages.length > 0 && messages[messages.length - 1].role === "ai" && !messages[messages.length - 1].content && (
              <div className="flex justify-start">
                <div className="bg-secondary rounded-xl px-3 py-2 text-xs text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="size-3 animate-spin" />{progress}
                </div>
              </div>
            )}
          </div>

          {/* 快捷问题 */}
          {messages.length === 0 && (
            <div className="px-3 pb-2 flex flex-wrap gap-1.5 shrink-0">
              {QUICK_QUESTIONS.map((q) => (
                <button key={q.q} onClick={() => analyze(q.q)} disabled={analyzing} className="rounded-full border border-border bg-card px-2.5 py-1 text-caption text-foreground/80 hover:border-eco-300 hover:text-eco-700 disabled:opacity-40">
                  {q.q}
                </button>
              ))}
            </div>
          )}

          {/* 输入框 */}
          <div className="p-2.5 border-t border-border shrink-0">
            <div className="flex items-end gap-1.5">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); analyze(input) } }}
                disabled={analyzing}
                rows={1}
                placeholder="针对此档案提问..."
                className="flex-1 resize-none rounded-lg border border-border bg-card px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60 max-h-24"
              />
              <button
                onClick={() => analyze(input)}
                disabled={!input.trim() || analyzing}
                className="rounded-lg bg-eco-600 p-2 text-eco-50 hover:bg-eco-700 disabled:opacity-40 shrink-0"
              >
                {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════
 * 上传弹窗（保持不变）
 * ═══════════════════════════════════════════════════════ */

interface UploadTarget { tpl_id: string; name: string; cat: string }

