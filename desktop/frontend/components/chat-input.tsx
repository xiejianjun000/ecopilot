"use client"
import { useState, useRef, useCallback, useEffect, useMemo, type DragEvent, type ClipboardEvent } from "react"
import { ArrowUp, Square, Paperclip, X, FileText, Loader2, ChevronDown, Mic, MessageSquare, Eye, Check, FolderOpen, FolderPlus } from "lucide-react"
import { cn } from "@/lib/utils"
import { useApp } from "@/lib/store"
import { checkHealth, fetchWorkspaceList } from "@/lib/api"
import type { WorkspaceFolder } from "@/lib/types"

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

  // ── 工作空间文件夹选择器 ──
  const [wsPickerOpen, setWsPickerOpen] = useState(false)
  const [wsPathInput, setWsPathInput] = useState("")
  const [wsAdding, setWsAdding] = useState(false)
  const [wsError, setWsError] = useState("")
  const [wsSuggestions, setWsSuggestions] = useState<string[]>([])
  const wsPickerRef = useRef<HTMLDivElement>(null)
  const wsDirInputRef = useRef<HTMLInputElement>(null)

  // 点击外部关闭工作空间选择器
  useEffect(() => {
    if (!wsPickerOpen) return
    const onDown = (e: MouseEvent) => {
      if (wsPickerRef.current && !wsPickerRef.current.contains(e.target as Node)) {
        setWsPickerOpen(false)
        setWsError("")
        setWsPathInput("")
      }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [wsPickerOpen])

  // 「空间」标签触发工作空间选择（侧边栏发自定义事件）
  useEffect(() => {
    const handler = () => { setWsPickerOpen(true); pickDirectory() }
    window.addEventListener("ecopilot:ws-pick", handler)
    return () => window.removeEventListener("ecopilot:ws-pick", handler)
  })

  const addWorkspace = useCallback(async (path?: string) => {
    const p = (path || wsPathInput).trim()
    if (!p) return
    setWsAdding(true)
    setWsError("")
    setWsSuggestions([])
    try {
      const entries = await fetchWorkspaceList(p)
      if (entries.length === 0) {
        setWsError("文件夹为空或无法访问")
        setWsAdding(false)
        return
      }
      const folder: WorkspaceFolder = {
        id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        path: p,
        name: p.split("/").filter(Boolean).pop() || p,
        entries,
        loaded: true,
      }
      dispatch({ type: 'ADD_WORKSPACE', folder })
      setWsPickerOpen(false)
      setWsPathInput("")
    } catch {
      setWsError("添加失败，请检查路径是否正确")
    } finally {
      setWsAdding(false)
    }
  }, [wsPathInput, dispatch])

  // 唤起系统文件夹选择器 → 提取文件夹名 → 生成常见路径建议
  const pickDirectory = useCallback(() => {
    // 优先 File System Access API（Chrome/Edge 86+）
    const pickWithApi = async () => {
      if (!("showDirectoryPicker" in window)) return false
      try {
        const handle = await (window as any).showDirectoryPicker()
        const dirName = handle.name || ""
        if (!dirName) return false
        const home = "/Users/mac"
        setWsSuggestions([
          `${home}/Documents/${dirName}`,
          `${home}/Desktop/${dirName}`,
          `${home}/Downloads/${dirName}`,
          `${home}/${dirName}`,
        ])
        setWsPathInput(`${home}/Documents/${dirName}`)
        setWsError("")
      } catch {
        // 用户取消选择
      }
      return true
    }
    // 降级：input[webkitdirectory] — 同样只拿到文件夹名
    const pickWithInput = () => {
      const inp = wsDirInputRef.current
      if (!inp) return
      inp.value = ""
      inp.click()
    }
    Promise.resolve().then(async () => {
      if (!(await pickWithApi())) pickWithInput()
    })
  }, [])

  // webkitdirectory input 选择回调
  const onDirInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    // 从第一个文件的 webkitRelativePath 提取文件夹名
    const firstPath = files[0].webkitRelativePath || files[0].name
    const dirName = firstPath.split("/")[0] || ""
    if (!dirName) return
    const home = "/Users/mac"
    setWsSuggestions([
      `${home}/Documents/${dirName}`,
      `${home}/Desktop/${dirName}`,
      `${home}/Downloads/${dirName}`,
      `${home}/${dirName}`,
    ])
    setWsPathInput(`${home}/Documents/${dirName}`)
    setWsError("")
  }, [])

  // 当前活跃工作空间
  const activeWorkspace = useMemo(() => {
    if (!state.activeWorkspaceId) return null
    return state.workspaceFolders.find(f => f.id === state.activeWorkspaceId) || null
  }, [state.activeWorkspaceId, state.workspaceFolders])

  // ── 语音输入（Web Speech API） ──
  const [recording, setRecording] = useState(false)
  const recognitionRef = useRef<any>(null)
  // mount 后检测支持性，避免 SSR/客户端不一致导致 hydration 不匹配
  const [speechSupported, setSpeechSupported] = useState(false)
  useEffect(() => {
    setSpeechSupported("webkitSpeechRecognition" in window || "SpeechRecognition" in window)
  }, [])

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

            {/* 工作空间文件夹选择器 */}
            <div className="flex items-center gap-1.5">
              {/* 活跃工作空间指示 */}
              {activeWorkspace && (
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-eco-50 px-2 py-0.5 text-caption text-eco-700 max-w-[120px] truncate" title={activeWorkspace.path}>
                  <FolderOpen className="size-3 shrink-0" />
                  {activeWorkspace.name}
                </span>
              )}
              <div className="relative" ref={wsPickerRef}>
              <button
                onClick={() => { setWsPickerOpen(v => !v); setWsSuggestions([]); setWsError("") }}
                aria-label="添加工作空间文件夹"
                title="添加工作空间文件夹"
                className="flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-caption font-medium text-foreground hover:bg-accent/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
              >
                <FolderPlus className="size-3 shrink-0 text-muted-foreground" />
                <span className="hidden sm:inline">工作空间</span>
              </button>

              {/* hidden: webkitdirectory fallback 输入 */}
              <input
                ref={wsDirInputRef}
                type="file"
                // @ts-ignore webkitdirectory is a non-standard attribute
                webkitdirectory=""
                directory=""
                className="hidden"
                onChange={onDirInputChange}
              />

              {wsPickerOpen && (
                <div className="absolute bottom-full left-0 z-30 mb-2 w-[300px] rounded-xl border border-border bg-popover p-3 shadow-popover">
                  <p className="text-caption text-muted-foreground mb-2">选择本地文件夹添加为工作空间</p>

                  {/* 系统文件夹选择器按钮 */}
                  <button
                    onClick={pickDirectory}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-accent/40 px-3 py-2.5 text-caption font-medium text-foreground hover:border-eco-400 hover:bg-eco-50/50 transition-colors mb-2"
                  >
                    <FolderOpen className="size-4 text-eco-600" />
                    选择文件夹...
                  </button>

                  {/* 路径建议 — 从系统选择器提取文件夹名后展示 */}
                  {wsSuggestions.length > 0 && (
                    <div className="mb-2 space-y-0.5">
                      <p className="text-caption text-muted-foreground/70">可能的完整路径：</p>
                      {wsSuggestions.map(s => (
                        <button
                          key={s}
                          onClick={() => addWorkspace(s)}
                          className="block w-full rounded-lg px-2 py-1 text-left text-caption text-foreground hover:bg-eco-50/60 transition-colors"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* 手动输入路径（兜底） */}
                  <div className="flex gap-1.5">
                    <input
                      value={wsPathInput}
                      onChange={e => { setWsPathInput(e.target.value); setWsError(""); setWsSuggestions([]) }}
                      onKeyDown={e => { if (e.key === "Enter") addWorkspace() }}
                      placeholder="或手动输入路径..."
                      className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-caption text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-eco-500/40"
                    />
                    <button
                      onClick={() => addWorkspace()}
                      disabled={!wsPathInput.trim() || wsAdding}
                      className="shrink-0 rounded-lg bg-eco-600 px-3 py-1.5 text-caption font-medium text-white hover:bg-eco-700 disabled:opacity-50 transition-colors"
                    >
                      {wsAdding ? "…" : "确认"}
                    </button>
                  </div>
                  {wsError && <p className="text-caption text-destructive mt-1.5">{wsError}</p>}
                </div>
              )}
            </div>
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
