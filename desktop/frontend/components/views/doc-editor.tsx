"use client"
/**
 * EcoPilot 文档编辑器 — 合规日历模块配套组件
 *
 * 用途：用户点击日历事件后右侧打开编辑器，加载模板、支持人工编辑和 AI 协同编辑、
 *      下载(MD/Word)、打印、一键问 AI。
 *
 * 设计参考：
 *  - components/md-viewer.tsx        — 无障碍模式 + 打印 CSS
 *  - components/views/knowledge.tsx  — ReactMarkdown 配置
 */
import { useEffect, useRef, useState, useCallback } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  X, Save, FileDown, FileType, Printer, Sparkles, MessageSquare,
  Eye, Pencil, Loader2, Check, FileText, Calendar, Square,
} from "lucide-react"
import { exportMarkdown, exportDocx, exportPdfPrint, sanitizeFilename } from "@/lib/export"
import { apiGet, apiPost, streamSSE } from "@/lib/api"
import { useApp } from "@/lib/store"
import { cn } from "@/lib/utils"

export interface DocEditorProps {
  open: boolean
  templateId?: string      // 模板ID（从后端 GET /api/calendar/templates 获取内容）
  templateName?: string    // 模板名称（显示用）
  eventTitle?: string      // 关联的日历事件标题
  eventDate?: string       // 关联的日历事件日期
  onClose: () => void
  /** 嵌入模式：渲染为右侧 aside 而非全屏 modal（日历页面用） */
  embedded?: boolean
}

interface Template {
  id: string
  name: string
  category: string
  description: string
  icon: string
  content: string
}

interface TemplatesResponse {
  ok: boolean
  templates?: Template[]
}

interface SaveResponse {
  ok: boolean
  docId?: string
}

/** ReactMarkdown 组件映射（与 md-viewer / knowledge 保持一致） */
const MARKDOWN_COMPONENTS = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-display font-bold text-foreground mt-2 mb-4 pb-2 border-b border-border">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-section font-semibold text-foreground mt-6 mb-3">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-body font-semibold text-foreground mt-5 mb-2">{children}</h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-body text-foreground/80 leading-relaxed mb-3">{children}</p>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  code: ({ className, children, ...props }: { className?: string; children?: React.ReactNode } & React.HTMLAttributes<HTMLElement>) =>
    !className ? (
      <code className="rounded bg-secondary px-1 py-0.5 text-caption font-mono text-warning" {...props}>{children}</code>
    ) : (
      <code className={className} {...props}>{children}</code>
    ),
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="rounded-xl bg-secondary p-4 my-4 overflow-x-auto text-caption font-mono">{children}</pre>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="ml-4 mb-3 space-y-1 list-disc text-body text-foreground/80 leading-relaxed">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="ml-4 mb-3 space-y-1 list-decimal text-body text-foreground/80 leading-relaxed">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li className="leading-relaxed">{children}</li>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-eco-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40 rounded">{children}</a>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-4 border-eco-500 pl-3 my-3 text-body text-foreground/70 italic">{children}</blockquote>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-3"><table className="w-full text-caption border-collapse border border-border">{children}</table></div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-border bg-muted/50 px-2 py-1 text-left font-medium text-foreground">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-border px-2 py-1 text-foreground/80">{children}</td>
  ),
  hr: () => <hr className="my-4 border-border" />,
}

export function DocEditor({
  open,
  templateId,
  templateName,
  eventTitle,
  eventDate,
  onClose,
  embedded = false,
}: DocEditorProps) {
  const { dispatch } = useApp()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  // AI 填充中断控制器（用于停止真实流式调用）
  const aiAbortRef = useRef<AbortController | null>(null)

  const [content, setContent] = useState("")
  const [mode, setMode] = useState<"edit" | "preview">("edit")
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [aiEditing, setAiEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // ─── 是否为执行报告类模板（月度/季度/年度）───
  const isReport = templateId?.includes("report") ?? false

  // ─── 当前日期（用于默认保存日期）───
  const today = new Date().toISOString().split("T")[0]

  // ─── Toast 工具 ───
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }, [])

  // ─── 加载模板：open=true 且 templateId 存在时 ───
  useEffect(() => {
    if (!open) return
    if (!templateId) {
      setContent("")
      setLoadError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setContent("")
    apiGet<TemplatesResponse>("/api/calendar/templates")
      .then(res => {
        if (cancelled) return
        if (res.ok && res.data?.ok && Array.isArray(res.data.templates)) {
          const tpl = res.data.templates.find(t => t.id === templateId)
          if (tpl) {
            setContent(tpl.content || "")
          } else {
            setLoadError(`未找到模板：${templateId}`)
          }
        } else {
          setLoadError(res.error || "模板加载失败，请检查后端服务")
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError("网络错误，无法加载模板")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, templateId])

  // ─── ESC 关闭 + Tab/Shift+Tab 焦点陷阱（全屏 modal 模式才需要 focus trap）───
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
        return
      }
      // 嵌入模式不需要 focus trap — 它是页面的一部分，Tab 应自然流转
      if (embedded) return
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose, embedded])

  // ─── 打开时：聚焦关闭按钮 + 锁定 body 滚动（仅全屏 modal 模式）───
  useEffect(() => {
    if (!open) return
    if (embedded) return  // 嵌入模式不锁 body scroll
    const t = requestAnimationFrame(() => closeBtnRef.current?.focus())
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      cancelAnimationFrame(t)
      document.body.style.overflow = prev
    }
  }, [open, embedded])

  // ─── 关闭时：中断 AI 流式调用 + 清理临时状态 ───
  useEffect(() => {
    if (open) return
    if (aiAbortRef.current) {
      aiAbortRef.current.abort()
      aiAbortRef.current = null
    }
    setAiEditing(false)
    setToast(null)
    setLoadError(null)
  }, [open])

  // ─── 卸载时：中断 AI 流式调用 ───
  useEffect(() => {
    return () => {
      if (aiAbortRef.current) {
        aiAbortRef.current.abort()
        aiAbortRef.current = null
      }
    }
  }, [])

  // ─── 注入打印 CSS（仅一次）───
  useEffect(() => {
    if (document.getElementById("ecopilot-doc-editor-print-style")) return
    const style = document.createElement("style")
    style.id = "ecopilot-doc-editor-print-style"
    style.textContent = `
      @media print {
        body * { visibility: hidden !important; }
        .ecopilot-doc-print-area, .ecopilot-doc-print-area * { visibility: visible !important; }
        .ecopilot-doc-print-area {
          position: absolute !important;
          left: 0 !important; top: 0 !important;
          width: 100% !important;
          padding: 20mm !important;
          background: white !important;
        }
        .ecopilot-doc-no-print { display: none !important; }
        h1, h2, h3 { page-break-after: avoid; }
        pre, table, blockquote, figure { page-break-inside: avoid; }
        @page { margin: 15mm; }
      }
    `
    document.head.appendChild(style)
    return () => {
      document.getElementById("ecopilot-doc-editor-print-style")?.remove()
    }
  }, [])

  // ─── AI 填充：停止（中断后端流式调用）───
  const stopAIFill = useCallback(() => {
    if (aiAbortRef.current) {
      aiAbortRef.current.abort()
      aiAbortRef.current = null
    }
    setAiEditing(false)
  }, [])

  // ─── AI 填充：启动（调用后端 DeepSeek 真实流式填充）───
  const startAIFill = useCallback(async () => {
    if (aiEditing) return
    if (!content) {
      showToast("文档内容为空，无法填充")
      return
    }
    setAiEditing(true)

    // 中断控制器 — 用户点"停止"时 abort
    const abortCtrl = new AbortController()
    aiAbortRef.current = abortCtrl

    // 保存原始内容，失败时回滚
    const originalContent = content

    try {
      // 调用后端 /api/calendar/doc/ai-fill，SSE 流式接收
      const generator = streamSSE('/api/calendar/doc/ai-fill', {
        templateId: templateId || "",
        content: originalContent,
        title: templateName || eventTitle || "",
      }, abortCtrl.signal)

      let accumulated = ""
      let hasError = false

      for await (const data of generator) {
        const type = data.type as string
        const text = data.text as string
        const step = data.step as number
        const detail = data.detail as string

        if (type === "progress") {
          if (step === 1) showToast("读取企业信息...")
          else if (step === 2) showToast("AI 智能填充中...")
          continue
        }
        if (type === "text_delta") {
          // 累加 AI 返回的文字，实时更新编辑区
          accumulated += text
          setContent(accumulated)
          continue
        }
        if (type === "done") {
          showToast(isReport ? "报告生成完成" : "AI 填充完成")
          break
        }
        if (type === "error") {
          hasError = true
          showToast(detail || "AI 填充失败")
          // 回滚到原始内容
          setContent(originalContent)
          break
        }
      }

      if (!hasError && !accumulated) {
        showToast("AI 未返回内容，请重试")
        setContent(originalContent)
      }
    } catch (err) {
      // 用户主动中断 / 网络错误
      const msg = err instanceof Error && err.name === "AbortError"
        ? "已停止 AI 填充"
        : "AI 填充网络错误"
      showToast(msg)
      // 保留已接收的部分内容（不回滚）
    } finally {
      aiAbortRef.current = null
      setAiEditing(false)
    }
  }, [aiEditing, content, templateId, templateName, eventTitle, showToast])

  if (!open) return null

  const baseName = sanitizeFilename(
    (templateName || eventTitle || "未命名文档") + (eventDate ? `-${eventDate}` : "")
  )

  // ─── 保存 ───
  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await apiPost<SaveResponse>("/api/calendar/doc/save", {
        templateId: templateId || "",
        content,
        title: templateName || eventTitle || "未命名文档",
        date: eventDate || today,
      })
      if (res.ok && res.data?.ok) {
        showToast("文档已保存")
      } else {
        showToast(res.error || "保存失败，请重试")
      }
    } catch (e) { console.error("[doc-editor] Load failed:", e)
      showToast("网络错误，保存失败")
    } finally {
      setSaving(false)
    }
  }

  // ─── 下载 Markdown ───
  const handleDownloadMD = () => {
    exportMarkdown(content, baseName)
    showToast(`已下载 ${baseName}.md`)
  }

  // ─── 确保预览已渲染（用于导出 Word / 打印）───
  const ensurePreviewRendered = async () => {
    if (mode !== "preview") {
      setMode("preview")
      // 等待两帧确保 ReactMarkdown 渲染到 DOM
      await new Promise<void>(resolve => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve())
        })
      })
    }
  }

  // ─── 下载 Word：先 ReactMarkdown 渲染为 HTML，再 exportDocx ───
  const handleDownloadWord = async () => {
    await ensurePreviewRendered()
    if (!previewRef.current) {
      showToast("渲染未就绪，请重试")
      return
    }
    try {
      const html = previewRef.current.innerHTML
      exportDocx(html, baseName)
      showToast(`已下载 ${baseName}.doc`)
    } catch {
      showToast("Word 导出失败，请重试")
    }
  }

  // ─── 打印：确保预览已渲染后调用浏览器原生打印 ───
  const handlePrint = async () => {
    await ensurePreviewRendered()
    exportPdfPrint()
  }

  // ─── 一键问 AI：预填对话输入并跳转到对话 ───
  const handleAskAI = () => {
    dispatch({ type: "SET_PREFILL_INPUT", text: `请基于以下文档内容回答：${content.slice(0, 500)}` })
    dispatch({ type: "SET_NAV", nav: "chat" })
    onClose()
  }

  const toolbarDisabled = loading || !!loadError
  const exportDisabled = toolbarDisabled || !content

  // ═══════ 嵌入模式：右侧 aside 面板（日历页面用） ═══════
  if (embedded) {
    if (!open) return null
    return (
      <aside
        ref={panelRef}
        role="complementary"
        aria-label="文档编辑器"
        className="flex flex-col h-full border-l border-border bg-background overflow-hidden animate-in slide-in-from-right duration-200"
      >
        {/* Header：标题 + 关闭 */}
        <div className="ecopilot-doc-no-print flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex size-8 items-center justify-center rounded-lg bg-eco-50 shrink-0">
              <FileText className="size-4 text-eco-600" />
            </div>
            <div className="min-w-0">
              <h3 className="text-body font-semibold text-foreground truncate leading-tight">
                {templateName || eventTitle || "文档编辑器"}
              </h3>
              <div className="flex items-center gap-1.5 text-caption text-muted-foreground mt-0.5">
                {eventDate && <span className="shrink-0 tabular-nums">{eventDate}</span>}
                <span className="shrink-0">· {content.length} 字符</span>
              </div>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="关闭文档编辑器"
            title="关闭 (Esc)"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 shrink-0"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* 编辑/预览 Tab + AI 填充 */}
        <div className="ecopilot-doc-no-print flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0 bg-card/50 gap-2">
          <div className="flex items-center gap-0.5 rounded-lg bg-secondary/60 p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setMode("edit")}
              aria-pressed={mode === "edit"}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-caption transition-colors",
                mode === "edit" ? "bg-card text-foreground font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Pencil className="size-3" /> 编辑
            </button>
            <button
              type="button"
              onClick={() => setMode("preview")}
              aria-pressed={mode === "preview"}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-caption transition-colors",
                mode === "preview" ? "bg-card text-foreground font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Eye className="size-3" /> 预览
            </button>
          </div>
          <button
            type="button"
            onClick={aiEditing ? stopAIFill : startAIFill}
            disabled={loading || !!loadError}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 py-1 text-caption font-medium transition-colors disabled:opacity-50",
              aiEditing
                ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                : "bg-gradient-eco-strong text-white hover:shadow-card-hover"
            )}
          >
            {aiEditing ? <><Square className="size-3" /> 停止</> : <><Sparkles className="size-3" /> {isReport ? "从台账生成" : "AI 填充"}</>}
          </button>
        </div>

        {/* AI 编辑状态条 */}
        {aiEditing && (
          <div className="ecopilot-doc-no-print flex items-center gap-1.5 px-3 py-1.5 bg-eco-50 border-b border-eco-200 text-caption text-eco-700">
            <Loader2 className="size-3 animate-spin" />
            <span>{isReport ? "AI 正在从台账数据生成报告" : "AI 正在智能填充文档"}</span>
          </div>
        )}

        {/* 内容区 */}
        <div className="flex-1 overflow-hidden min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="size-5 animate-spin mr-2" /> 正在加载模板...
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <FileText className="size-8 text-muted-foreground mb-3 opacity-50" />
              <p className="text-body font-medium text-foreground">{loadError}</p>
            </div>
          ) : mode === "edit" ? (
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="在此编辑文档内容（支持 Markdown 语法）..."
              spellCheck={false}
              aria-label="文档内容编辑区"
              className="w-full h-full resize-none border-0 bg-background px-4 py-3 text-body text-foreground leading-relaxed font-mono focus:outline-none focus:ring-0"
            />
          ) : (
            <div className="h-full overflow-y-auto px-5 py-4">
              <div ref={previewRef} className="ecopilot-doc-print-area max-w-2xl mx-auto">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                  {content || "*（文档为空，请在编辑模式中输入内容）*"}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>

        {/* 底部工具栏 */}
        <div className="ecopilot-doc-no-print flex items-center gap-1.5 px-3 py-2 border-t border-border shrink-0 bg-background flex-wrap">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || toolbarDisabled}
            className="inline-flex items-center gap-1 rounded-lg bg-eco-600 px-2.5 py-1.5 text-caption font-medium text-white hover:bg-eco-700 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
            保存
          </button>
          <button
            type="button"
            onClick={handleDownloadMD}
            disabled={exportDisabled}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-caption font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            <FileDown className="size-3" /> MD
          </button>
          <button
            type="button"
            onClick={handleDownloadWord}
            disabled={exportDisabled}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-caption font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            <FileType className="size-3" /> Word
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={exportDisabled}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-caption font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            <Printer className="size-3" /> 打印
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleAskAI}
            disabled={loading || !content}
            className="inline-flex items-center gap-1 rounded-lg border border-eco-200 bg-eco-50 px-2.5 py-1.5 text-caption font-medium text-eco-700 hover:bg-eco-100 transition-colors disabled:opacity-50"
          >
            <MessageSquare className="size-3" /> 问 AI
          </button>
        </div>

        {/* Toast */}
        {toast && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-200 z-10">
            <div className="flex items-center gap-1.5 rounded-lg bg-foreground/95 text-background px-3 py-1.5 shadow-lg">
              <Check className="size-3 text-success" />
              <span className="text-caption font-medium">{toast}</span>
            </div>
          </div>
        )}
      </aside>
    )
  }

  // ═══════ 全屏 modal 模式（默认，向后兼容） ═══════
  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      {/* 遮罩 */}
      <div
        className="absolute inset-0 pointer-events-auto bg-foreground/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* 弹窗主体 */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="文档编辑器"
        tabIndex={-1}
        className="pointer-events-auto absolute inset-0 flex flex-col bg-background shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40 animate-in fade-in duration-200"
      >
        {/* ═══════ Header：标题 + 关闭 ═══════ */}
        <div className="ecopilot-doc-no-print flex items-center justify-between px-5 py-3 border-b border-border shrink-0 bg-background">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-9 items-center justify-center rounded-xl bg-eco-50 shrink-0">
              <FileText className="size-4.5 text-eco-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-section font-semibold text-foreground truncate leading-tight">
                {templateName || eventTitle || "文档编辑器"}
              </h2>
              <div className="flex items-center gap-2 text-caption text-muted-foreground mt-0.5">
                {eventTitle && (
                  <span className="inline-flex items-center gap-1 min-w-0">
                    <Calendar className="size-3 shrink-0" />
                    <span className="truncate">{eventTitle}</span>
                  </span>
                )}
                {eventDate && <span className="shrink-0">· {eventDate}</span>}
                <span className="shrink-0">· {content.length} 字符</span>
              </div>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
            title="关闭 (Esc)"
            className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 shrink-0"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* ═══════ 主体：左编辑区 + 右 AI 协同面板 ═══════ */}
        <div className="flex-1 flex min-h-0">
          {/* 左侧：编辑 / 预览 */}
          <div className="flex-1 flex flex-col min-w-0 border-r border-border">
            {/* 编辑/预览 Tab + AI 状态 */}
            <div className="ecopilot-doc-no-print flex items-center justify-between px-4 py-2 border-b border-border shrink-0 bg-card/50">
              <div className="flex items-center gap-1 rounded-lg bg-secondary/60 p-1">
                <button
                  type="button"
                  onClick={() => setMode("edit")}
                  aria-pressed={mode === "edit"}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1 text-caption transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    mode === "edit" ? "bg-card text-foreground font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Pencil className="size-3" />
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => setMode("preview")}
                  aria-pressed={mode === "preview"}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1 text-caption transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    mode === "preview" ? "bg-card text-foreground font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Eye className="size-3" />
                  预览
                </button>
              </div>
              {aiEditing && (
                <div className="flex items-center gap-1.5 text-caption text-eco-600">
                  <Loader2 className="size-3 animate-spin" />
                  <span>AI 正在编辑</span>
                  <span className="inline-flex font-bold">
                    <span className="animate-bounce [animation-delay:-0.3s]">.</span>
                    <span className="animate-bounce [animation-delay:-0.15s]">.</span>
                    <span className="animate-bounce">.</span>
                  </span>
                </div>
              )}
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-hidden min-h-0">
              {loading ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <Loader2 className="size-5 animate-spin mr-2" /> 正在加载模板...
                </div>
              ) : loadError ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <FileText className="size-8 text-muted-foreground mb-3 opacity-50" />
                  <p className="text-body font-medium text-foreground">{loadError}</p>
                </div>
              ) : mode === "edit" ? (
                <textarea
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  placeholder="在此编辑文档内容（支持 Markdown 语法）..."
                  spellCheck={false}
                  aria-label="文档内容编辑区"
                  className="w-full h-full resize-none border-0 bg-background px-6 py-4 text-body text-foreground leading-relaxed font-mono focus:outline-none focus:ring-0"
                />
              ) : (
                <div className="h-full overflow-y-auto px-8 py-6">
                  <div ref={previewRef} className="ecopilot-doc-print-area max-w-3xl mx-auto">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                      {content || "*（文档为空，请在编辑模式中输入内容）*"}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 右侧：AI 协同面板 */}
          <aside className="ecopilot-doc-no-print w-[280px] shrink-0 flex flex-col bg-card/30 overflow-y-auto">
            <div className="p-4 space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="size-4 text-eco-600" />
                  <h3 className="text-body font-semibold text-foreground">AI 协同</h3>
                </div>
                <p className="text-caption text-muted-foreground leading-relaxed">
                  读取企业真实信息，由 DeepSeek 智能填充模板所有字段。
                </p>
              </div>

              <button
                type="button"
                onClick={aiEditing ? stopAIFill : startAIFill}
                disabled={loading || !!loadError}
                className={cn(
                  "w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 disabled:cursor-not-allowed",
                  aiEditing
                    ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                    : "bg-eco-600 text-white hover:bg-eco-700"
                )}
              >
                {aiEditing ? (
                  <>
                    <Square className="size-4" />
                    停止
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" />
                    AI 填充
                  </>
                )}
              </button>

              {/* 占位符说明 */}
              <div className="rounded-lg border border-border bg-background p-3 space-y-2">
                <p className="text-caption font-semibold text-muted-foreground uppercase tracking-wider">
                  支持的占位符
                </p>
                <ul className="space-y-1.5 text-caption text-foreground/70">
                  <li><code className="rounded bg-secondary px-1 py-0.5 text-warning font-mono">{"{{enterprise_name}}"}</code> → 企业名称</li>
                  <li><code className="rounded bg-secondary px-1 py-0.5 text-warning font-mono">{"{{permit_number}}"}</code> → 许可证编号</li>
                  <li><code className="rounded bg-secondary px-1 py-0.5 text-warning font-mono">{"{{date}}"}</code> → 当前日期</li>
                  <li><code className="rounded bg-secondary px-1 py-0.5 text-warning font-mono">{"{{year}}"}</code> → 当前年份</li>
                  <li><code className="rounded bg-secondary px-1 py-0.5 text-warning font-mono">{"{{quarter}}"}</code> → 当前季度</li>
                  <li className="text-muted-foreground">其他 → [待填写]</li>
                </ul>
              </div>

              {/* 编辑状态卡片 */}
              {aiEditing && (
                <div className="rounded-lg bg-eco-50 border border-eco-200 p-3">
                  <div className="flex items-center gap-2 text-caption font-medium text-eco-700">
                    <Loader2 className="size-3.5 animate-spin" />
                    AI 正在编辑文档...
                  </div>
                  <p className="text-caption text-eco-700/80 mt-1">正在调用 DeepSeek 智能填充，可随时停止。</p>
                </div>
              )}
            </div>
          </aside>
        </div>

        {/* ═══════ 底部工具栏：保存 / 下载MD / 下载Word / 打印 / 一键问AI ═══════ */}
        <div className="ecopilot-doc-no-print flex items-center gap-2 px-5 py-3 border-t border-border shrink-0 bg-background">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || toolbarDisabled}
            className="inline-flex items-center gap-1.5 rounded-lg bg-eco-600 px-3.5 py-2 text-caption font-medium text-white hover:bg-eco-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            保存
          </button>
          <button
            type="button"
            onClick={handleDownloadMD}
            disabled={exportDisabled}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-caption font-medium text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileDown className="size-3.5" />
            下载 MD
          </button>
          <button
            type="button"
            onClick={handleDownloadWord}
            disabled={exportDisabled}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-caption font-medium text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileType className="size-3.5" />
            下载 Word
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={exportDisabled}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-caption font-medium text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Printer className="size-3.5" />
            打印
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleAskAI}
            disabled={loading || !content}
            className="inline-flex items-center gap-1.5 rounded-lg border border-eco-200 bg-eco-50 px-3.5 py-2 text-caption font-medium text-eco-700 hover:bg-eco-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <MessageSquare className="size-3.5" />
            一键问 AI
          </button>
        </div>

        {/* ═══════ Toast 提示 ═══════ */}
        {toast && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-200 z-10">
            <div className="flex items-center gap-1.5 rounded-lg bg-foreground/95 text-background px-3.5 py-2 shadow-lg">
              <Check className="size-3.5 text-success" />
              <span className="text-caption font-medium">{toast}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
