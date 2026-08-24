"use client"
import { useState, useCallback, useRef, useEffect } from "react"
import {
  Copy, Check, ThumbsUp, ThumbsDown, RotateCcw, AlertTriangle,
  Loader2, Wrench, ChevronDown, ChevronRight, Volume2, Share2, FileText,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"
import { getApiBase, ensureAuthToken, authHeaders } from "@/lib/api"
import type { Message } from "@/lib/types"
import { TOOL_LABELS } from "@/lib/types"

/** 复制按钮 */
function CopyButton({ text, label = "复制" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    const doCopy = () => {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
    }
    // Clipboard API 需要 secure context（localhost 或 HTTPS）
    if (typeof navigator.clipboard !== "undefined" && window.isSecureContext) {
      doCopy()
    } else {
      // 非 secure context fallback（192.168.x.x 局域网访问）
      try {
        const ta = document.createElement("textarea")
        ta.value = text
        ta.style.position = "fixed"
        ta.style.left = "-9999px"
        ta.style.top = "-9999px"
        document.body.appendChild(ta)
        ta.select()
        document.execCommand("copy")
        document.body.removeChild(ta)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      } catch { /* fail silently */ }
    }
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
    try {
      if (typeof navigator.clipboard !== "undefined" && window.isSecureContext) {
        navigator.clipboard.writeText(md)
      } else {
        const ta = document.createElement("textarea")
        ta.value = md
        ta.style.position = "fixed"
        ta.style.left = "-9999px"
        document.body.appendChild(ta)
        ta.select()
        document.execCommand("copy")
        document.body.removeChild(ta)
      }
    } catch { /* fail silently */ }
  }, [content, isUser])

  return (
    <div className={cn("flex gap-1", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* 头像 */}
      <div className={cn(
        "flex size-5 shrink-0 items-center justify-center",
        isUser ? "rounded-full bg-eco-100 text-eco-600 text-[10px] font-bold" : ""
      )} aria-hidden>
        {isUser ? "我" : (
          <img src="/eco-logo.svg" alt="EcoPilot" className="size-4 object-contain" />
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
            "rounded-2xl px-3 py-1",
            isUser
              ? "bg-eco-600 text-white rounded-tr-md"
              : "bg-card border border-border text-foreground rounded-tl-md"
          )}>
            {isUser ? (
              <div className="whitespace-pre-wrap break-words text-body">{content}</div>
            ) : (
              <div className="prose prose-sm max-w-none dark:prose-invert text-body [&_pre]:bg-secondary/60 [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:text-xs [&_code]:text-xs [&_code]:bg-secondary/40 [&_code]:rounded [&_code]:px-1 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:bg-secondary/40 [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-eco-400 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_a]:text-eco-600 [&_a]:underline">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
