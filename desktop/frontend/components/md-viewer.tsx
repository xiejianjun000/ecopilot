"use client"
import { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { X, FileText, FileDown, FileType, Printer, Loader2, Check } from "lucide-react"
import { exportMarkdown, exportDocx, exportPdfPrint, exportPdfImage, sanitizeFilename } from "@/lib/export"
import { cn } from "@/lib/utils"

interface Props {
  open: boolean
  file: { name: string; content?: string } | null
  onClose: () => void
}

export function MdViewer({ open, file, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState<"" | "docx" | "pdf">("")
  const [toast, setToast] = useState<string | null>(null)

  // ESC 关闭 + Tab 焦点陷阱
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus()
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  // 打开时：聚焦关闭按钮 + 锁定 body 滚动
  useEffect(() => {
    if (!open) return
    const t = requestAnimationFrame(() => closeBtnRef.current?.focus())
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      cancelAnimationFrame(t)
      document.body.style.overflow = prev
    }
  }, [open])

  // 关闭时：焦点归位到触发器（由调用方接管，这里仅清空）
  useEffect(() => {
    if (open) return
    setExporting("")
    setToast(null)
  }, [open])

  // 打印前注入打印 CSS（仅注入一次）
  useEffect(() => {
    if (document.getElementById("ecopilot-md-print-style")) return
    const style = document.createElement("style")
    style.id = "ecopilot-md-print-style"
    style.textContent = `
      @media print {
        body * { visibility: hidden !important; }
        .ecopilot-print-area, .ecopilot-print-area * { visibility: visible !important; }
        .ecopilot-print-area {
          position: absolute !important;
          left: 0 !important; top: 0 !important;
          width: 100% !important;
          padding: 20mm !important;
          background: white !important;
        }
        .ecopilot-md-viewer-panel { width: 100% !important; max-width: 100% !important; box-shadow: none !important; border: none !important; }
        .ecopilot-md-viewer-header { display: none !important; }
        h1, h2, h3 { page-break-after: avoid; }
        pre, table, blockquote, figure { page-break-inside: avoid; }
        @page { margin: 15mm; }
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById("ecopilot-md-print-style")?.remove() }
  }, [])

  if (!open || !file) return null

  const content = file.content || `# ${file.name}\n\n文件内容正在生成中...`
  const baseName = sanitizeFilename(file.name)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }

  const handleMarkdown = () => {
    exportMarkdown(content, baseName)
    showToast(`已下载 ${baseName}.md`)
  }

  const handleDocx = () => {
    if (!contentRef.current) return
    setExporting("docx")
    try {
      // 使用已渲染的 DOM innerHTML，保留样式
      const html = contentRef.current.innerHTML
      exportDocx(html, baseName)
      showToast(`已下载 ${baseName}.doc`)
    } catch (err) {
      console.error("[MdViewer] docx export failed:", err)
      showToast("Word 导出失败，请重试")
    } finally {
      setExporting("")
    }
  }

  const handlePdfPrint = () => {
    exportPdfPrint()
  }

  const handlePdfImage = async () => {
    if (!contentRef.current) return
    setExporting("pdf")
    try {
      await exportPdfImage(contentRef.current, baseName)
      showToast(`已下载 ${baseName}.pdf`)
    } catch (err) {
      console.error("[MdViewer] pdf export failed:", err)
      showToast("PDF 导出失败，请使用打印模式")
    } finally {
      setExporting("")
    }
  }

  return (
    <div className="fixed inset-0 z-[150] pointer-events-none">
      <div
        className="absolute inset-0 pointer-events-auto bg-foreground/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`预览文档：${file.name}`}
        tabIndex={-1}
        className="ecopilot-md-viewer-panel absolute right-0 top-0 bottom-0 w-[760px] max-w-[92vw] pointer-events-auto border-l border-border bg-background shadow-modal animate-in slide-in-from-right duration-300 flex flex-col outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
      >
        {/* ═══════ Header：文件信息 + 导出按钮组 ═══════ */}
        <div className="ecopilot-md-viewer-header flex items-center justify-between px-5 py-3 border-b border-border shrink-0 bg-background">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-8 items-center justify-center rounded-lg bg-eco-50 shrink-0">
              <FileText className="size-4 text-eco-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-body font-semibold text-foreground truncate leading-tight">{file.name}</h2>
              <p className="text-caption text-muted-foreground leading-tight mt-0.5">
                Markdown · {content.length > 1024 ? `${(content.length / 1024).toFixed(1)} KB` : `${content.length} 字符`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {/* 下载 .md */}
            <ExportBtn
              onClick={handleMarkdown}
              icon={FileDown}
              label="下载 Markdown"
              title="下载 .md 源文件"
            />
            {/* 转 Word */}
            <ExportBtn
              onClick={handleDocx}
              disabled={exporting !== ""}
              loading={exporting === "docx"}
              icon={FileType}
              label="转 Word"
              title="转换为 .doc 文件（Word 可编辑）"
            />
            {/* 打印为 PDF（矢量，原生中文） */}
            <ExportBtn
              onClick={handlePdfPrint}
              icon={Printer}
              label="打印 / PDF"
              title="浏览器原生打印（矢量 + 中文，推荐）"
            />
            {/* 高保真截图 PDF（一键下载） */}
            <ExportBtn
              onClick={handlePdfImage}
              disabled={exporting !== ""}
              loading={exporting === "pdf"}
              icon={FileDown}
              label="截图 PDF"
              title="高保真截图导出 PDF（自动下载）"
              variant="primary"
            />
            <div className="w-px h-5 bg-border mx-1" />
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              aria-label="关闭"
              title="关闭 (Esc)"
              className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <X className="size-[18px]" />
            </button>
          </div>
        </div>

        {/* ═══════ 正文预览 ═══════ */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div ref={contentRef} className="ecopilot-print-area max-w-3xl mx-auto eco-card-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => <h1 className="text-display font-bold text-foreground mt-2 mb-4 pb-2 border-b border-border">{children}</h1>,
                h2: ({ children }) => <h2 className="text-section font-semibold text-foreground mt-6 mb-3">{children}</h2>,
                h3: ({ children }) => <h3 className="text-body font-semibold text-foreground mt-5 mb-2">{children}</h3>,
                p: ({ children }) => <p className="text-body text-foreground/80 leading-relaxed mb-3">{children}</p>,
                strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                code: ({ className, children, ...props }) =>
                  !className
                    ? <code className="rounded bg-secondary px-1 py-0.5 text-caption font-mono text-warning" {...props}>{children}</code>
                    : <code className={className} {...props}>{children}</code>,
                pre: ({ children }) => <pre className="rounded-xl bg-secondary p-4 my-4 overflow-x-auto text-caption font-mono">{children}</pre>,
                ul: ({ children }) => <ul className="ml-4 mb-3 space-y-1 list-disc text-body text-foreground/80 leading-relaxed">{children}</ul>,
                ol: ({ children }) => <ol className="ml-4 mb-3 space-y-1 list-decimal text-body text-foreground/80 leading-relaxed">{children}</ol>,
                li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-eco-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40 rounded">{children}</a>,
                blockquote: ({ children }) => <blockquote className="border-l-4 border-eco-500 pl-3 my-3 text-body text-foreground/70 italic">{children}</blockquote>,
                table: ({ children }) => <div className="overflow-x-auto my-3"><table className="w-full text-caption border-collapse border border-border">{children}</table></div>,
                th: ({ children }) => <th className="border border-border bg-muted/50 px-2 py-1 text-left font-medium text-foreground">{children}</th>,
                td: ({ children }) => <td className="border border-border px-2 py-1 text-foreground/80">{children}</td>,
                hr: () => <hr className="my-4 border-border" />,
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        </div>

        {/* ═══════ Toast 提示 ═══════ */}
        {toast && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-center gap-1.5 rounded-lg bg-foreground/95 text-background px-3 py-2 shadow-lg">
              <Check className="size-3.5 text-success" />
              <span className="text-caption font-medium">{toast}</span>
            </div>
          </div>
        )}

        {/* ═══════ 导出中遮罩 ═══════ */}
        {exporting && (
          <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px] flex items-center justify-center z-10">
            <div className="flex flex-col items-center gap-2.5 rounded-xl bg-card border border-border shadow-lg px-6 py-5">
              <Loader2 className="size-6 text-eco-600 animate-spin" />
              <p className="text-caption font-medium text-foreground">
                {exporting === "docx" ? "正在生成 Word 文档…" : "正在生成 PDF（高保真截图）…"}
              </p>
              <p className="text-caption text-muted-foreground">请稍候，长文档可能需要数秒</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** 导出按钮（带 loading 和 variant） */
function ExportBtn({ onClick, icon: Icon, label, title, disabled, loading, variant }: {
  onClick: () => void
  icon: typeof FileDown
  label: string
  title: string
  disabled?: boolean
  loading?: boolean
  variant?: "default" | "primary"
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      className={cn(
        "rounded-lg p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        variant === "primary"
          ? "text-eco-600 hover:bg-eco-50"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {loading ? <Loader2 className="size-[18px] animate-spin" /> : <Icon className="size-[18px]" />}
    </button>
  )
}
