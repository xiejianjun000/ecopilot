"use client"
import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  Copy, Check, ThumbsUp, ThumbsDown, RotateCcw, AlertTriangle,
  Loader2, Wrench, ChevronDown, ChevronRight, Volume2, Share2, FileText,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getApiBase, ensureAuthToken, authHeaders } from "@/lib/api"
import type { Message } from "@/lib/types"
import { CodeBlock } from "@/components/ui/code-block"

/** 工具名 → 友好显示（与后端 tools.py 名称对齐） */
const TOOL_LABELS: Record<string, string> = {
  permit_quick_check: "许可证合规巡检",
  permit_report_status: "执行报告状态",
  monitoring_check: "监测数据检查",
  carbon_check: "碳排放检查",
  knowledge_search: "检索知识库",
  permit_login_guide: "登录引导",
  platform_login: "平台登录",
  platform_list: "平台清单",
  vault_guide: "档案引导",
}

/** 复制按钮 */
function CopyButton({ text, label = "复制" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [text])
  return (
    <button onClick={handleCopy} className="flex items-center gap-1 rounded-md px-2 py-1 text-caption text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-200" aria-label={label}>
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      {copied ? "已复制" : label}
    </button>
  )
}

/** 工具调用折叠面板 */
function ToolCallList({ toolCalls }: { toolCalls: NonNullable<Message["toolCalls"]> }) {
  const [expanded, setExpanded] = useState(false)
  if (toolCalls.length === 0) return null
  const completed = toolCalls.filter(t => t.result).length
  return (
    <div className="my-2 rounded-xl border border-border bg-secondary/40 overflow-hidden">
      <button onClick={() => setExpanded(p => !p)} className="flex w-full items-center gap-2 px-3 py-2 text-caption text-muted-foreground hover:bg-accent/50">
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <Wrench className="size-3.5" />
        <span>工具调用 · {completed}/{toolCalls.length} 完成</span>
      </button>
      {expanded && (
        <div className="border-t border-border p-2 space-y-1.5">
          {toolCalls.map((tc, i) => (
            <div key={i} className="rounded-xl bg-card border border-border p-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="rounded bg-eco-50 px-1.5 py-0.5 text-caption font-mono text-eco-600">{tc.name}</span>
                <span className="text-caption text-muted-foreground">{TOOL_LABELS[tc.name] || tc.name}</span>
                {tc.result ? <Check className="size-3 text-success ml-auto" /> : <Loader2 className="size-3 animate-spin ml-auto" />}
              </div>
              {tc.args && <div className="text-caption font-mono text-muted-foreground truncate mb-1">参数: {tc.args}</div>}
              {tc.result && (
                <pre className="text-caption font-mono text-muted-foreground bg-secondary/50 rounded p-1.5 overflow-x-auto max-h-32"><code>{tc.result}</code></pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ChatMessage({ message, sending, progress, onRegenerate }: {
  message: Message
  sending: boolean
  progress?: { step?: number; name?: string; text?: string } | null
  onRegenerate?: () => void
}) {
  const isUser = message.role === "user"
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null)

  const content = message.content || ""
  const hasContent = content.length > 0
  const isPending = message.pending && sending && !message.error
  const hasAttachments = message.attachments && message.attachments.length > 0

  // 朗读 — Edge TTS Neural 晓晓播报员，消息渲染时预取音频，点击即播放
  const [speaking, setSpeaking] = useState(false)
  const [ttsReady, setTtsReady] = useState(false)
  const ttsUrlRef = useRef<string | null>(null)
  const ttsLoadingRef = useRef(false)

  // 消息内容就绪后自动预取 TTS 音频
  useEffect(() => {
    if (!hasContent || message.pending || ttsUrlRef.current || ttsLoadingRef.current) return
    ttsLoadingRef.current = true
    const cleanText = content.replace(/[_#*`>\\()\\[\\]|~-]/g, "").replace(/\\n+/g, "。").slice(0, 500)
    const API = getApiBase()
    ;(async () => {
      try {
        await ensureAuthToken()
        const res = await fetch(`${API}/api/chat/tts`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ text: cleanText }),
        })
        if (res.ok) {
          const blob = await res.blob()
          ttsUrlRef.current = URL.createObjectURL(blob)
          setTtsReady(true)
        }
      } catch {}
      ttsLoadingRef.current = false
    })()
  }, [content, hasContent, message.pending])

  const handleSpeak = useCallback(() => {
    if (!hasContent) return
    const g = window as any
    if (g._ttsAudio) { g._ttsAudio.pause(); g._ttsAudio = null }
    g._ttsSpeakerIds = g._ttsSpeakerIds || new Set()
    const msgId = message.id
    if (g._ttsSpeakerIds.has(msgId)) { g._ttsSpeakerIds.delete(msgId); setSpeaking(false); return }

    g._ttsSpeakerIds.add(msgId)
    setSpeaking(true)
    const url = ttsUrlRef.current
    if (!url) { setSpeaking(false); g._ttsSpeakerIds.delete(msgId); return }
    const audio = new Audio(url)
    g._ttsAudio = audio
    audio.onended = () => { g._ttsSpeakerIds.delete(msgId); g._ttsAudio = null; setSpeaking(false) }
    audio.onerror = () => { g._ttsSpeakerIds.delete(msgId); g._ttsAudio = null; setSpeaking(false) }
    audio.play()
  }, [hasContent, message.id])

  // 分享：复制为 Markdown
  const handleShare = useCallback(() => {
    const md = `**${isUser ? "用户" : "EcoPilot"}**: ${content}`
    navigator.clipboard.writeText(md).then(() => {
      // 临时提示
    })
  }, [content, isUser])

  // ReactMarkdown components
  const mdComponents = useMemo(() => ({
    code({ inline, className, children, ...props }: React.ComponentProps<'code'> & { inline?: boolean }) {
      const match = /language-(\w+)/.exec(className || "")
      const code = String(children).replace(/\n$/, "")
      if (inline) {
        return <code className="rounded bg-secondary px-1.5 py-0.5 text-[0.85em] font-mono text-foreground" {...props}>{children}</code>
      }
      return <CodeBlock code={code} language={match?.[1]} />
    },
    table(props: React.ComponentProps<'table'>) {
      return (
        <div className="my-0 overflow-x-auto rounded-xl border border-border">
          <table className="w-full border-collapse text-body" {...props} />
        </div>
      )
    },
    thead(props: React.ComponentProps<'thead'>) {
      return <thead className="bg-secondary/60" {...props} />
    },
    th(props: React.ComponentProps<'th'>) {
      return <th className="border-b border-border px-3 py-2 text-left font-semibold text-foreground" {...props} />
    },
    td(props: React.ComponentProps<'td'>) {
      return <td className="border-b border-border px-3 py-2 text-foreground" {...props} />
    },
    a(props: React.ComponentProps<'a'>) {
      return <a target="_blank" rel="noopener noreferrer" className="text-eco-600 underline hover:text-eco-600" {...props} />
    },
    blockquote(props: React.ComponentProps<'blockquote'>) {
      return <blockquote className="my-0 border-l-4 border-eco-300 bg-eco-50/40 py-1 pl-3 pr-2 text-foreground/80 italic rounded-r" {...props} />
    },
    ul(props: React.ComponentProps<'ul'>) {
      return <ul className="my-0 ml-5 list-disc space-y-0" {...props} />
    },
    ol(props: React.ComponentProps<'ol'>) {
      return <ol className="my-0 ml-5 list-decimal space-y-0" {...props} />
    },
    h1(props: React.ComponentProps<'h1'>) { return <h1 className="my-0 text-display font-bold text-foreground" {...props} /> },
    h2(props: React.ComponentProps<'h2'>) { return <h2 className="my-0 text-section font-bold text-foreground border-b border-border pb-0.5" {...props} /> },
    h3(props: React.ComponentProps<'h3'>) { return <h3 className="my-0 text-title font-semibold text-foreground" {...props} /> },
    h4(props: React.ComponentProps<'h4'>) { return <h4 className="my-0 text-body font-semibold text-foreground" {...props} /> },
    p(props: React.ComponentProps<'p'>) { return <p className="my-0 leading-snug" {...props} /> },
    hr() { return <hr className="my-0 border-border" /> },
  }), [])

  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* 头像 */}
      <div className={cn(
        "flex size-8 shrink-0 items-center justify-center",
        isUser ? "rounded-full bg-eco-100 text-eco-600 text-xs font-bold" : ""
      )} aria-hidden>
        {isUser ? "我" : (
          <img src="/logo.svg" alt="EcoPilot" className="size-7 object-contain" />
        )}
      </div>

      {/* 消息体 */}
      <div className={cn("flex min-w-0 max-w-[85%] flex-col", isUser ? "items-end" : "items-start")}>
        {/* 附件（用户消息） */}
        {isUser && hasAttachments && (
          <div className="mb-2 flex flex-wrap gap-2 justify-end">
            {message.attachments!.map((att, i) => {
              const isImg = att.dataUrl.startsWith("data:image")
              return isImg ? (
                <img key={i} src={att.dataUrl} alt={att.name} className="max-h-32 max-w-[200px] rounded-xl border border-border object-cover" />
              ) : (
                <div key={i} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
                  <FileText className="size-4 text-muted-foreground" />
                  <span className="text-xs text-foreground truncate max-w-[140px]">{att.name}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* 文本气泡 */}
        {hasContent && (
          <div className={cn(
            "rounded-2xl px-4 py-3",
            isUser
              ? "bg-eco-600 text-white rounded-tr-md"
              : "bg-card border border-border text-foreground rounded-tl-md"
          )}>
            {isUser ? (
              <div className="whitespace-pre-wrap break-words text-body">{content}</div>
            ) : (
              <div className="chat-message-prose prose prose-sm max-w-none break-words whitespace-pre-line">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {/* 工具调用面板（助手） */}
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="w-full mt-1">
            <ToolCallList toolCalls={message.toolCalls} />
          </div>
        )}

        {/* 错误态 */}
        {message.error && (
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-body text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            <span className="flex-1">{message.error}</span>
            {onRegenerate && (
              <button onClick={onRegenerate} className="flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-1 text-caption text-destructive hover:bg-destructive/20" aria-label="重试">
                <RotateCcw className="size-3.5" />
                重试
              </button>
            )}
          </div>
        )}

        {/* 加载态（无内容时显示） */}
        {isPending && !hasContent && (
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
            <Loader2 className="size-5 animate-spin text-eco-600 shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="text-body font-medium text-foreground">
                {progress?.name ? `正在${progress.name}` : (progress?.text || "EcoPilot 正在分析…")}
              </span>
              {progress?.step != null && (
                <span className="text-caption text-muted-foreground mt-0.5">第 {progress.step} 步</span>
              )}
            </div>
          </div>
        )}

        {/* 加载态（有内容时显示底部进度条） */}
        {isPending && hasContent && progress?.text && (
          <div className="mt-2 flex items-center gap-2 text-caption text-muted-foreground animate-pulse">
            <Loader2 className="size-3.5 animate-spin text-eco-600 shrink-0" />
            <span className="truncate max-w-[320px]">{progress.text}</span>
          </div>
        )}

        {/* 操作栏（助手消息完成后） */}
        {!isUser && !isPending && hasContent && !message.error && (
          <div className="mt-1 flex items-center gap-0.5 opacity-60 hover:opacity-100 transition-opacity">
            <CopyButton text={content} />
            <button
              onClick={() => setFeedback(feedback === "up" ? null : "up")}
              className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-caption hover:bg-accent", feedback === "up" ? "text-success" : "text-muted-foreground hover:text-foreground")}
              aria-label="赞"
            >
              <ThumbsUp className="size-3.5" />
            </button>
            <button
              onClick={() => setFeedback(feedback === "down" ? null : "down")}
              className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-caption hover:bg-accent", feedback === "down" ? "text-destructive" : "text-muted-foreground hover:text-foreground")}
              aria-label="踩"
            >
              <ThumbsDown className="size-3.5" />
            </button>
            <button
              onClick={handleSpeak}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-caption text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={speaking ? "停止朗读" : "朗读"}
              title={speaking ? "停止朗读" : "朗读"}
            >
              <Volume2 className={cn("size-3.5", speaking && "text-eco-600")} />
            </button>
            <button
              onClick={handleShare}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-caption text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="复制为 Markdown"
              title="复制为 Markdown"
            >
              <Share2 className="size-3.5" />
            </button>
            {onRegenerate && (
              <button
                onClick={onRegenerate}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-caption text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="重新生成"
                title="重新生成"
              >
                <RotateCcw className="size-3.5" />
              </button>
            )}
          </div>
        )}

        {/* 用户消息操作栏 */}
        {isUser && hasContent && (
          <div className="mt-1 flex items-center gap-0.5 opacity-0 hover:opacity-100 transition-opacity">
            <CopyButton text={content} />
          </div>
        )}
      </div>
    </div>
  )
}
