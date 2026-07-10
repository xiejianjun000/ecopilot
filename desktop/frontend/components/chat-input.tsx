"use client"
import { useState, useRef, useCallback, useEffect, type DragEvent, type ClipboardEvent } from "react"
import { ArrowUp, Square, Paperclip, X, FileText, Loader2, ChevronDown, Mic, MessageSquare, Eye, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { useApp } from "@/lib/store"
import { checkHealth } from "@/lib/api"

const ALLOWED_EXT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.xml,.html,.htm,.log,image/*"
const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB

interface PendingAttachment {
  name: string
  dataUrl: string
  isImage: boolean
  size: number
}

/** 可选模式：自动（根据内容路由）/ 文本 / 视觉 */
type ChatMode = "auto" | "text" | "vision"

interface ModelOption {
  mode: ChatMode
  label: string
  desc: string
  icon: typeof MessageSquare
  available: boolean
}

export function ChatInput({ onSend, sending, onStop, model: _model, onModelChange: _onModelChange }: {
  onSend: (text: string, attachments?: string[], attachmentMeta?: { name: string; dataUrl: string }[]) => void
  sending: boolean
  onStop: () => void
  model: string
  onModelChange: (m: string) => void
}) {
  const [text, setText] = useState("")
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { state, dispatch } = useApp()

  // ── 模型选择 ──
  const [mode, setMode] = useState<ChatMode>("auto")
  const [modelOpen, setModelOpen] = useState(false)
  const [health, setHealth] = useState<{ text_model?: string; vision_model?: string; text_ready?: boolean; vision_ready?: boolean }>({})
  const modelBtnRef = useRef<HTMLButtonElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)

  // mount 后获取模型健康状态
  useEffect(() => {
    checkHealth().then(h => setHealth(h)).catch(() => {})
  }, [])

  // 当前生效的模型（用于展示）
  const hasImages = attachments.some(a => a.isImage)
  const activeModel = mode === "auto"
    ? (hasImages ? "vision" : "text")
    : mode

  const modelOptions: ModelOption[] = [
    { mode: "auto", label: "自动", desc: "根据内容智能路由", icon: Check, available: true },
    { mode: "text", label: health.text_model || "DeepSeek V4", desc: "文本对话 · 快速响应", icon: MessageSquare, available: !!health.text_ready },
    { mode: "vision", label: health.vision_model || "Kimi Vision", desc: "视觉理解 · 图片/截图识别", icon: Eye, available: !!health.vision_ready },
  ]
  const activeOption = modelOptions.find(o => o.mode === activeModel) || modelOptions[0]
  const activeLabel = mode === "auto"
    ? (hasImages ? (health.vision_model || "Kimi Vision") : (health.text_model || "DeepSeek V4"))
    : activeOption.label

  // 点击外部关闭模型菜单
  useEffect(() => {
    if (!modelOpen) return
    const onDown = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node) &&
          modelBtnRef.current && !modelBtnRef.current.contains(e.target as Node)) {
        setModelOpen(false)
      }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [modelOpen])

  // ── 语音输入（Web Speech API） ──
  const [recording, setRecording] = useState(false)
  const recognitionRef = useRef<any>(null)
  const speechSupported = typeof window !== "undefined" && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window)

  const toggleVoice = useCallback(() => {
    if (!speechSupported) return
    if (recording) {
      recognitionRef.current?.stop()
      setRecording(false)
      return
    }
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
    const rec = new SR()
    rec.lang = "zh-CN"
    rec.continuous = true
    rec.interimResults = true
    let finalText = text
    rec.onresult = (e: any) => {
      let interim = ""
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) finalText += t
        else interim += t
      }
      setText(finalText + interim)
    }
    rec.onerror = () => setRecording(false)
    rec.onend = () => setRecording(false)
    recognitionRef.current = rec
    rec.start()
    setRecording(true)
  }, [recording, text, speechSupported])

  // ── 自适应高度 ──
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = "auto"
    ta.style.height = Math.min(ta.scrollHeight, 180) + "px"
  }, [text])

  // ── 消费跨模块预填输入 ──
  useEffect(() => {
    if (state.prefillInput != null) {
      setText(state.prefillInput)
      dispatch({ type: "SET_PREFILL_INPUT", text: null })
      requestAnimationFrame(() => {
        const ta = taRef.current
        if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length) }
      })
    }
  }, [state.prefillInput, dispatch])

  const readFileAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const valid = Array.from(files).filter(f => {
      if (f.size > MAX_FILE_SIZE) {
        alert(`文件「${f.name}」超过 25MB 限制`)
        return false
      }
      return true
    })
    if (valid.length === 0) return

    setUploading(true)
    try {
      const newAtts: PendingAttachment[] = []
      for (const f of valid) {
        const dataUrl = await readFileAsDataUrl(f)
        newAtts.push({
          name: f.name,
          dataUrl,
          isImage: f.type.startsWith("image/"),
          size: f.size,
        })
      }
      setAttachments(prev => [...prev, ...newAtts].slice(0, 8))
    } catch (e) {
      alert("文件读取失败，请重试")
    } finally {
      setUploading(false)
    }
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files)
    e.target.value = ""
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    const files: File[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind === "file") {
        const f = item.getAsFile()
        if (f) files.push(f)
      }
    }
    if (files.length > 0) {
      e.preventDefault()
      addFiles(files)
    }
  }

  const removeAttachment = (idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx))
  }

  const handleSubmit = () => {
    const t = text.trim()
    if (!t && attachments.length === 0) return
    if (sending) return

    const imageAttachments = attachments.filter(a => a.isImage).map(a => a.dataUrl)
    const allMeta = attachments.map(a => ({ name: a.name, dataUrl: a.dataUrl }))

    onSend(t, imageAttachments.length > 0 ? imageAttachments : undefined, allMeta.length > 0 ? allMeta : undefined)
    setText("")
    setAttachments([])
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="border-t border-border bg-background px-4 py-3 md:px-6">
      <div className="mx-auto max-w-3xl">
        {/* 附件预览栏 */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((att, idx) => (
              <div key={idx} className="group relative flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 pr-7">
                {att.isImage ? (
                  <img src={att.dataUrl} alt={att.name} className="size-8 rounded object-cover" />
                ) : (
                  <div className="flex size-8 items-center justify-center rounded bg-secondary">
                    <FileText className="size-4 text-muted-foreground" />
                  </div>
                )}
                <div className="flex flex-col min-w-0 max-w-[140px]">
                  <span className="truncate text-xs font-medium text-foreground">{att.name}</span>
                  <span className="text-caption text-muted-foreground">{att.isImage ? "图片" : "文件"}</span>
                </div>
                <button
                  onClick={() => removeAttachment(idx)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={`移除 ${att.name}`}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 输入框容器 — 上下两区布局 */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={cn(
            "relative flex flex-col gap-2 rounded-2xl border bg-card px-3 py-2.5 transition-colors",
            isDragging ? "border-eco-400 bg-eco-50/50 ring-2 ring-eco-200" : "border-border"
          )}
        >
          {/* 上区：文本输入 */}
          <textarea
            ref={taRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={recording ? "正在聆听…" : isDragging ? "松开鼠标上传文件…" : "输入消息，Enter 发送，Shift+Enter 换行"}
            rows={1}
            className="flex-1 resize-none bg-transparent px-1 py-1 text-body text-foreground placeholder:text-muted-foreground focus:outline-none"
            aria-label="消息输入框"
          />

          {/* 下区：工具栏 — 左侧模型选择 / 右侧按钮组 */}
          <div className="flex items-center justify-between">
            {/* 模型选择器 */}
            <div className="relative">
              <button
                ref={modelBtnRef}
                onClick={() => setModelOpen(v => !v)}
                aria-label={`模型选择，当前 ${activeLabel}`}
                aria-expanded={modelOpen}
                className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-caption font-medium text-foreground hover:bg-accent/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
              >
                {hasImages && mode === "auto" ? (
                  <Eye className="size-3 shrink-0 text-eco-600" />
                ) : (
                  <MessageSquare className="size-3 shrink-0 text-eco-600" />
                )}
                <span className="max-w-[140px] truncate">{activeLabel}</span>
                <ChevronDown className={cn("size-3 shrink-0 text-muted-foreground transition-transform", modelOpen && "rotate-180")} />
              </button>

              {/* 下拉菜单 */}
              {modelOpen && (
                <div
                  ref={modelMenuRef}
                  role="listbox"
                  className="absolute bottom-full left-0 z-30 mb-2 w-[220px] rounded-xl border border-border bg-popover p-1 shadow-popover"
                >
                  {modelOptions.map(opt => {
                    const Icon = opt.icon
                    const isSelected = mode === opt.mode
                    return (
                      <button
                        key={opt.mode}
                        role="option"
                        aria-selected={isSelected}
                        disabled={!opt.available}
                        onClick={() => {
                          if (!opt.available) return
                          setMode(opt.mode)
                          setModelOpen(false)
                        }}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                          isSelected ? "bg-eco-50 text-eco-700" : "text-foreground hover:bg-accent",
                          !opt.available && "opacity-40 cursor-not-allowed"
                        )}
                      >
                        <Icon className={cn("size-4 shrink-0", isSelected ? "text-eco-600" : "text-muted-foreground")} />
                        <div className="min-w-0 flex-1">
                          <div className="text-caption font-medium text-foreground truncate">
                            {opt.label}
                            {opt.mode === "auto" && "（推荐）"}
                          </div>
                          <div className="text-caption text-muted-foreground truncate">{opt.desc}</div>
                        </div>
                        {isSelected && <Check className="size-3.5 shrink-0 text-eco-600" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 右侧按钮组：附件 + 语音 + 发送 */}
            <div className="flex items-center gap-0.5">
              {/* 附件按钮 */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || attachments.length >= 8}
                className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
                aria-label="添加附件"
                title="添加图片/PDF/Word/Excel 等文件（支持拖拽和粘贴）"
              >
                {uploading ? <Loader2 className="size-5 animate-spin" /> : <Paperclip className="size-5" />}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_EXT}
                multiple
                onChange={handleFileChange}
                className="hidden"
              />

              {/* 语音输入按钮 */}
              {speechSupported && (
                <button
                  onClick={toggleVoice}
                  className={cn(
                    "shrink-0 rounded-lg p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40",
                    recording
                      ? "relative text-white"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                  style={recording ? { backgroundColor: "rgb(239 68 68)" } : undefined}
                  aria-label={recording ? "停止语音输入" : "语音输入"}
                  title={recording ? "停止录音" : "语音输入"}
                >
                  {recording && (
                    <span className="absolute inset-0 rounded-lg bg-destructive/40 animate-ping" />
                  )}
                  <Mic className="size-5 relative" />
                </button>
              )}

              {/* 发送 / 停止按钮 */}
              {sending ? (
                <button
                  onClick={onStop}
                  className="shrink-0 rounded-xl bg-destructive p-2.5 text-white hover:bg-destructive/90 active:scale-[0.96] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                  aria-label="停止生成"
                  title="停止生成"
                >
                  <Square className="size-4" fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={!text.trim() && attachments.length === 0}
                  className="shrink-0 rounded-xl bg-eco-600 p-2.5 text-white hover:bg-eco-700 active:scale-[0.96] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
                  aria-label="发送消息"
                  title="发送（Enter）"
                >
                  <ArrowUp className="size-4" strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>

          {/* 拖拽遮罩提示 */}
          {isDragging && (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-eco-50/80 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-2 text-eco-700">
                <FileText className="size-8" />
                <span className="text-body font-medium">松开鼠标上传文件</span>
              </div>
            </div>
          )}
        </div>

        {/* 字数统计（仅在有输入时显示） */}
        {text.length > 0 && (
          <div className="mt-1.5 flex justify-end px-1 text-caption text-muted-foreground">
            <span className="tabular-nums">{text.length} 字</span>
          </div>
        )}
      </div>
    </div>
  )
}
