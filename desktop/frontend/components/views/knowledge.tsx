"use client"
import { useState, useEffect, useCallback, useMemo } from "react"
import {
  BookOpen, Search, ExternalLink, X, ChevronDown, ChevronRight,
  FileText, Scale, AlertTriangle, Tag, ArrowLeft, Sparkles, Link2,
  Loader2, Hash, Maximize2, Network,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useApp } from "@/lib/store"
import { apiGet } from "@/lib/api"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { KnowledgeGraph, KnowledgeGraphFullscreen } from "./knowledge-graph"

/* ═══════════════════════════════════════════════════════
 * EcoPilot 知识库 — Obsidian vault 集成
 * 左栏：MOC 目录树 + 标签云
 * 中栏：文档列表 + 搜索
 * 右栏：原文渲染 + backlinks（默认隐藏，点击文档打开）
 * ═══════════════════════════════════════════════════════ */

interface AiRiskNote {
  clause?: string
  risk?: string
}

interface Frontmatter {
  title?: string
  doc_number?: string
  category?: string
  issue_date?: string
  industry?: string[] | string
  applicable_stage?: string[] | string
  tags?: string[]
  ai_risk_notes?: AiRiskNote[]
  [key: string]: unknown
}

interface KDoc {
  id: string; name: string; title: string
  doc_number: string; issue_date: string; category: string
  industry: string[]; applicable_stage: string[]
  tags: string[]; aliases: string[]; related: string[]
  ai_risk_notes: AiRiskNote[]
  links: string[]
  size: number; mtime: number; line_count: number
}

interface Backlink { id: string; name: string; title: string; category: string }
interface SearchResult {
  id: string; title: string; doc_number: string; category: string
  score: number; meta_match: boolean; body_matches: { line: number; snippet: string }[]
}

interface KnowledgeListResponse {
  ok: boolean
  items?: KDoc[]
  tags?: string[]
  categories?: string[]
}

interface KnowledgeSearchResponse {
  ok: boolean
  results?: SearchResult[]
}

interface KnowledgeFileResponse {
  ok: boolean
  body?: string
  frontmatter?: Frontmatter
  backlinks?: Backlink[]
  doc?: KDoc
}

/** 在 Obsidian 中打开（URL scheme） */
function openInObsidian(file?: string) {
  const vault = "knowledge"
  const url = file
    ? `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file)}`
    : `obsidian://open?vault=${encodeURIComponent(vault)}`
  window.location.href = url
}

/** 类别图标+配色 */
function categoryStyle(cat: string) {
  switch (cat) {
    case "法规": return { icon: Scale, color: "text-warning", bg: "bg-warning/10" }
    case "标准": return { icon: FileText, color: "text-info", bg: "bg-info/10" }
    case "模板": return { icon: FileText, color: "text-success", bg: "bg-success/10" }
    case "MOC": return { icon: BookOpen, color: "text-eco-600", bg: "bg-eco-50" }
    default: return { icon: FileText, color: "text-muted-foreground", bg: "bg-secondary" }
  }
}

/** 高亮搜索关键词 */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q || !text) return <>{text}</>
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-warning/20 px-0.5 text-foreground">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  )
}

export function KnowledgeView() {
  const { dispatch } = useApp()
  const [docs, setDocs] = useState<KDoc[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [activeCat, setActiveCat] = useState("全部")
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<{ body: string; frontmatter: Frontmatter; backlinks: Backlink[]; doc: KDoc } | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<"docs" | "graph">("docs")
  const [graphFullscreen, setGraphFullscreen] = useState(false)

  // ─── 栏宽拖拽（持久化到 localStorage）───
  const [leftWidth, setLeftWidth] = useState<number>(280)
  const [rightWidth, setRightWidth] = useState<number>(520)
  // mount 后从 localStorage 恢复栏宽（避免 SSR/客户端初始值不一致导致 hydration 不匹配）
  useEffect(() => {
    try {
      const lw = Number(localStorage.getItem("kb_left_width"))
      if (lw) setLeftWidth(lw)
      const rw = Number(localStorage.getItem("kb_right_width"))
      if (rw) setRightWidth(rw)
    } catch {}
  }, [])

  // 左栏拖拽（左拉变小，右拉变大）
  const handleLeftResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const sx = e.clientX; const sw = leftWidth
    const prevSelect = document.body.style.userSelect
    const prevCursor = document.body.style.cursor
    document.body.style.userSelect = "none"
    document.body.style.cursor = "col-resize"
    const move = (ev: MouseEvent) => {
      const w = Math.min(440, Math.max(200, sw + (ev.clientX - sx)))
      setLeftWidth(w)
    }
    const up = () => {
      setLeftWidth(w => { try { localStorage.setItem("kb_left_width", String(w)) } catch {}; return w })
      document.body.style.userSelect = prevSelect
      document.body.style.cursor = prevCursor
      document.removeEventListener("mousemove", move)
      document.removeEventListener("mouseup", up)
    }
    document.addEventListener("mousemove", move)
    document.addEventListener("mouseup", up)
  }, [leftWidth])

  // 右栏拖拽（右拉变小，左拉变大）
  const handleRightResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const sx = e.clientX; const sw = rightWidth
    const prevSelect = document.body.style.userSelect
    const prevCursor = document.body.style.cursor
    document.body.style.userSelect = "none"
    document.body.style.cursor = "col-resize"
    const move = (ev: MouseEvent) => {
      const w = Math.min(800, Math.max(360, sw + (sx - ev.clientX)))
      setRightWidth(w)
    }
    const up = () => {
      setRightWidth(w => { try { localStorage.setItem("kb_right_width", String(w)) } catch {}; return w })
      document.body.style.userSelect = prevSelect
      document.body.style.cursor = prevCursor
      document.removeEventListener("mousemove", move)
      document.removeEventListener("mouseup", up)
    }
    document.addEventListener("mousemove", move)
    document.addEventListener("mouseup", up)
  }, [rightWidth])

  // Esc 键关闭右栏预览
  useEffect(() => {
    if (!selectedId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSelectedId(null); setFileContent(null) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selectedId])

  // 加载文档列表
  const load = useCallback(() => {
    setLoading(true); setLoadError(null)
    apiGet<KnowledgeListResponse>('/api/knowledge/list')
      .then(res => {
        if (res.ok && res.data?.ok) {
          setDocs(res.data.items || [])
          setTags(res.data.tags || [])
          setCategories(res.data.categories || [])
        } else {
          setLoadError(res.error || "知识库加载失败，请检查后端服务")
        }
      })
      .catch(() => { setLoadError("网络错误，无法连接知识库服务") })
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  // 搜索（300ms 防抖）
  useEffect(() => {
    const q = search.trim()
    if (!q) { setSearchResults(null); return }
    setSearching(true)
    const t = setTimeout(() => {
      apiGet<KnowledgeSearchResponse>('/api/knowledge/search', { q })
        .then(res => { if (res.ok && res.data?.ok) setSearchResults(res.data.results || []) })
        .catch(() => {})
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  // 加载文件原文
  const loadFile = useCallback((id: string) => {
    setLoadingFile(true)
    setFileError(null)
    setSelectedId(id)
    apiGet<KnowledgeFileResponse>('/api/knowledge/file', { id })
      .then(res => {
        if (res.ok && res.data?.ok && res.data) {
          setFileContent({
            body: res.data.body || "",
            frontmatter: res.data.frontmatter || {},
            backlinks: res.data.backlinks || [],
            doc: res.data.doc as KDoc,
          })
        } else {
          setFileError(res.error || "文档加载失败")
        }
      })
      .catch(() => { setFileError("网络错误，无法加载文档") })
      .finally(() => setLoadingFile(false))
  }, [])

  // 按类别分组
  const grouped = useMemo(() => {
    const g: Record<string, KDoc[]> = {}
    docs.forEach(d => {
      const cat = d.category || "未分类"
      if (!g[cat]) g[cat] = []
      g[cat].push(d)
    })
    return g
  }, [docs])

  // 筛选
  const filtered = useMemo(() => {
    let list = docs
    if (activeCat !== "全部") list = list.filter(d => d.category === activeCat)
    if (activeTag) list = list.filter(d => d.tags.includes(activeTag))
    return list
  }, [docs, activeCat, activeTag])

  const toggleCat = (cat: string) => setCollapsedCats(p => ({ ...p, [cat]: !p[cat] }))

  const selectedDoc = docs.find(d => d.id === selectedId)

  // 询问 AI — 通过 store 预填输入，避免脆弱的 DOM 操作
  const askAI = (text: string) => {
    dispatch({ type: "SET_PREFILL_INPUT", text: `请基于知识库回答：${text}` })
    dispatch({ type: "SET_NAV", nav: "chat" })
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ═══ 左栏：MOC 目录树 + 标签云 ═══ */}
      <aside style={{ width: leftWidth }} className="hidden md:flex flex-col shrink-0 border-r border-border bg-sidebar/30 overflow-y-auto">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="flex size-9 items-center justify-center rounded-xl bg-eco-50">
              <BookOpen className="size-4.5 text-eco-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-section font-semibold text-foreground">知识库</h2>
              <p className="text-caption text-muted-foreground">Obsidian vault</p>
            </div>
            <button
              onClick={() => openInObsidian()}
              aria-label="在 Obsidian 中打开"
              title="Obsidian 打开"
              className="rounded-lg p-1.5 text-muted-foreground hover:text-eco-600 hover:bg-eco-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <ExternalLink className="size-4" />
            </button>
          </div>
          {/* 视图切换 Tab */}
          <div className="mt-3 flex items-center gap-1 rounded-lg bg-secondary/60 p-1">
            <button
              onClick={() => setViewMode("docs")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-caption transition-colors",
                viewMode === "docs" ? "bg-card text-foreground font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <BookOpen className="size-3" />
              文档
            </button>
            <button
              onClick={() => setViewMode("graph")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-caption transition-colors",
                viewMode === "graph" ? "bg-card text-foreground font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Network className="size-3" />
              图谱
            </button>
          </div>
        </div>

        {/* 全部 */}
        <div className="p-3">
          <button
            onClick={() => { setActiveCat("全部"); setActiveTag(null) }}
            className={cn(
              "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-body transition-colors",
              activeCat === "全部" && !activeTag ? "bg-eco-50 text-eco-700 font-medium" : "text-foreground/80 hover:bg-accent"
            )}
          >
            <span className="flex items-center gap-2">
              <BookOpen className="size-3.5" />
              全部文档
            </span>
            <span className="rounded bg-secondary/60 px-1.5 py-0.5 text-caption text-muted-foreground tabular-nums">{docs.length}</span>
          </button>
        </div>

        {/* 按类别分组 */}
        <div className="px-3 pb-2 space-y-0.5">
          {categories.filter(c => c !== "未分类" && c !== "MOC").map(cat => {
            const items = grouped[cat] || []
            const isCollapsed = collapsedCats[cat]
            const Icon = categoryStyle(cat).icon
            return (
              <div key={cat}>
                <button
                  onClick={() => toggleCat(cat)}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-body text-foreground/80 hover:bg-accent transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    {isCollapsed ? <ChevronRight className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
                    <Icon className={cn("size-3.5", categoryStyle(cat).color)} />
                    <span className="font-medium">{cat}</span>
                  </span>
                  <span className="rounded bg-secondary/60 px-1.5 py-0.5 text-caption text-muted-foreground tabular-nums">{items.length}</span>
                </button>
                {!isCollapsed && (
                  <div className="ml-4 border-l border-border/60 pl-1.5 space-y-0.5 mt-0.5">
                    {items.map(d => (
                      <button
                        key={d.id}
                        onClick={() => { setActiveCat(cat); setActiveTag(null); loadFile(d.id) }}
                        className={cn(
                          "flex w-full items-center rounded-md px-2 py-1 text-caption transition-colors text-left",
                          selectedId === d.id ? "bg-eco-50 text-eco-700 font-medium" : "text-foreground/70 hover:bg-accent"
                        )}
                      >
                        <span className="truncate flex-1">{d.title}</span>
                        {d.ai_risk_notes?.length > 0 && <AlertTriangle className="size-3 text-destructive shrink-0 ml-1" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* 标签云 */}
        {tags.length > 0 && (
          <div className="px-4 pt-3 pb-4 border-t border-border mt-2">
            <div className="flex items-center gap-1.5 mb-2 text-caption text-muted-foreground">
              <Hash className="size-3" />
              <span className="font-semibold uppercase tracking-wider">标签</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {tags.slice(0, 20).map(t => (
                <button
                  key={t}
                  onClick={() => setActiveTag(activeTag === t ? null : t)}
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-caption transition-colors",
                    activeTag === t ? "bg-eco-100 text-eco-700 font-medium" : "bg-secondary/60 text-muted-foreground hover:bg-accent"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* 左栏拖拽分隔条 */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整左栏宽度，双击重置"
        tabIndex={0}
        onMouseDown={handleLeftResize}
        onDoubleClick={() => { setLeftWidth(280); try { localStorage.setItem("kb_left_width", "280") } catch {} }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setLeftWidth(w => Math.max(200, w - 16))
          else if (e.key === "ArrowRight") setLeftWidth(w => Math.min(440, w + 16))
        }}
        className="hidden md:block w-1.5 -mx-0.5 shrink-0 cursor-col-resize bg-transparent hover:bg-eco-300/50 active:bg-eco-400 transition-colors z-20 focus-visible:outline-none focus-visible:bg-eco-300/70"
        title="拖拽调整宽度，双击重置"
      />

      {/* ═══ 中栏：列表 + 搜索（文档模式） / 图谱（图谱模式） ═══ */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {viewMode === "graph" ? (
          /* 图谱模式 */
          <div className="relative flex-1 overflow-hidden">
            <button
              onClick={() => setGraphFullscreen(true)}
              aria-label="全屏图谱"
              title="全屏"
              className="absolute top-3 right-3 z-20 flex items-center gap-1 rounded-lg border border-border bg-card/95 backdrop-blur px-2.5 py-1.5 text-caption text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <Maximize2 className="size-3.5" />
              全屏
            </button>
            <KnowledgeGraph onNodeClick={(id) => { loadFile(id); setViewMode("docs") }} className="h-full" />
          </div>
        ) : (
          /* 文档模式：列表 + 搜索 */
          <>
        {/* 顶部搜索 */}
        <div className="p-4 border-b border-border shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索法规条款、标准编号、关键词...（支持 §37 / GB 13456 / 第三十七条）"
              className="w-full rounded-lg border border-border bg-card pl-10 pr-10 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
            />
            {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground" />}
            {search && !searching && (
              <button onClick={() => setSearch("")} aria-label="清除搜索" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            )}
          </div>
          {activeTag && (
            <div className="mt-2 flex items-center gap-2 text-caption">
              <span className="text-muted-foreground">标签筛选：</span>
              <span className="inline-flex items-center gap-1 rounded-md bg-eco-50 px-1.5 py-0.5 text-eco-700">
                <Hash className="size-3" />
                {activeTag}
                <button onClick={() => setActiveTag(null)} aria-label="移除标签筛选" className="ml-0.5 hover:text-eco-900"><X className="size-3" /></button>
              </span>
            </div>
          )}
        </div>

        {/* 列表区 */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {/* 文档计数条 */}
          {!loading && !loadError && !searchResults && (
            <div className="flex items-center justify-between mb-2 text-caption text-muted-foreground">
              <span>
                共 <span className="font-semibold text-foreground tabular-nums">{filtered.length}</span> 个文档
                {activeCat !== "全部" && <span className="ml-1">· {activeCat}</span>}
              </span>
              {(activeCat !== "全部" || activeTag) && (
                <button
                  onClick={() => { setActiveCat("全部"); setActiveTag(null) }}
                  className="text-eco-700 hover:text-eco-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded"
                >
                  清除筛选
                </button>
              )}
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="size-5 animate-spin mr-2" /> 加载中...
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertTriangle className="size-8 text-destructive mb-3" />
              <p className="text-body font-medium text-foreground">{loadError}</p>
              <button onClick={load} className="mt-3 rounded-lg bg-eco-600 px-4 py-1.5 text-xs text-white hover:bg-eco-700">重试</button>
            </div>
          ) : searchResults ? (
            /* 搜索结果 */
            <div className="space-y-3">
              <div className="text-caption text-muted-foreground mb-3">
                找到 <span className="font-semibold text-foreground">{searchResults.length}</span> 条与「<span className="text-eco-700">{search}</span>」相关的结果
              </div>
              {searchResults.map(r => {
                const Icon = categoryStyle(r.category).icon
                return (
                  <button
                    key={r.id}
                    onClick={() => loadFile(r.id)}
                    className="w-full text-left rounded-xl border border-border bg-card p-4 hover:border-eco-200 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", categoryStyle(r.category).bg)}>
                        <Icon className={cn("size-3.5", categoryStyle(r.category).color)} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-body font-semibold text-foreground">
                          <Highlight text={r.title} q={search} />
                        </h3>
                        {r.doc_number && <p className="text-caption text-muted-foreground mt-0.5">{r.doc_number}</p>}
                        {r.body_matches.slice(0, 2).map((m, i) => (
                          <div key={i} className="mt-2 rounded-md bg-secondary/40 px-2 py-1.5 text-caption text-muted-foreground line-clamp-2">
                            <span className="text-muted-foreground/60">L{m.line}:</span>{" "}
                            <Highlight text={m.snippet.replace(/\n/g, ' ').slice(0, 120)} q={search} />
                          </div>
                        ))}
                      </div>
                      {r.meta_match && <span className="rounded bg-eco-50 px-1.5 py-0.5 text-caption text-eco-700 shrink-0">标题匹配</span>}
                    </div>
                  </button>
                )
              })}
              {searchResults.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <Search className="size-8 mx-auto mb-2 opacity-40" />
                  <p className="text-body">未找到与「{search}」相关的结果</p>
                </div>
              )}
            </div>
          ) : (
            /* 正常列表 */
            <div className="space-y-3">
              {filtered.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <BookOpen className="size-8 mx-auto mb-2 opacity-40" />
                  <p className="text-body">暂无文档</p>
                </div>
              )}
              {filtered.map(d => {
                const Icon = categoryStyle(d.category).icon
                const isSelected = selectedId === d.id
                return (
                  <button
                    key={d.id}
                    onClick={() => loadFile(d.id)}
                    aria-label={`打开 ${d.title} 阅读器`}
                    className={cn(
                      "group w-full text-left rounded-xl border bg-card p-4 transition-all cursor-pointer",
                      isSelected ? "border-eco-300 ring-1 ring-eco-200" : "border-border hover:border-eco-200 hover:shadow-sm"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", categoryStyle(d.category).bg)}>
                        <Icon className={cn("size-4", categoryStyle(d.category).color)} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-body font-semibold text-foreground truncate">{d.title}</h3>
                          {d.ai_risk_notes?.length > 0 && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-destructive/10 px-1 py-0.5 text-caption text-destructive shrink-0">
                              <AlertTriangle className="size-2.5" />
                              风险
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1 text-caption text-muted-foreground">
                          {d.doc_number && <span>{d.doc_number}</span>}
                          {d.issue_date && <><span>·</span><span>{d.issue_date}</span></>}
                          <span>·</span><span>{d.line_count} 行</span>
                          {d.applicable_stage?.length > 0 && (
                            <>
                              <span>·</span>
                              <span>{d.applicable_stage.join("/")}</span>
                            </>
                          )}
                        </div>
                        {d.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {d.tags.slice(0, 5).map(t => (
                              <span key={t} className="rounded bg-eco-50 px-1.5 py-0.5 text-caption text-eco-700">{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* 右上角"打开阅读"提示 — hover/选中时高亮 */}
                      <div className={cn(
                        "flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-caption transition-colors",
                        isSelected
                          ? "text-eco-700 bg-eco-50"
                          : "text-muted-foreground/60 group-hover:text-eco-600 group-hover:bg-eco-50/60"
                      )}>
                        <span className="hidden sm:inline">{isSelected ? "阅读中" : "阅读"}</span>
                        <ChevronRight className={cn("size-3.5 transition-transform", isSelected && "rotate-0")} />
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
          </>
        )}
      </main>

      {/* 右栏拖拽分隔条 — 仅在右栏打开时显示 */}
      {selectedId && viewMode === "docs" && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整右栏宽度，双击重置"
          tabIndex={0}
          onMouseDown={handleRightResize}
          onDoubleClick={() => { setRightWidth(520); try { localStorage.setItem("kb_right_width", "520") } catch {} }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setRightWidth(w => Math.min(800, w + 16))
            else if (e.key === "ArrowRight") setRightWidth(w => Math.max(360, w - 16))
          }}
          className="w-1.5 -mx-0.5 shrink-0 cursor-col-resize bg-transparent hover:bg-eco-300/50 active:bg-eco-400 transition-colors z-20 focus-visible:outline-none focus-visible:bg-eco-300/70"
          title="拖拽调整宽度，双击重置"
        />
      )}

      {/* ═══ 右栏：原文预览 + backlinks（默认隐藏） ═══ */}
      {selectedId && viewMode === "docs" && (
        <aside style={{ width: rightWidth }} className="flex flex-col shrink-0 border-l border-border bg-background overflow-hidden animate-in slide-in-from-right duration-200">
          {/* 头部 */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {selectedDoc && (
                <>
                  {(() => {
                    const Icon = categoryStyle(selectedDoc.category).icon
                    return (
                      <div className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", categoryStyle(selectedDoc.category).bg)}>
                        <Icon className={cn("size-3.5", categoryStyle(selectedDoc.category).color)} />
                      </div>
                    )
                  })()}
                  <div className="min-w-0">
                    <h3 className="text-body font-semibold text-foreground truncate">{selectedDoc.title}</h3>
                    <p className="text-caption text-muted-foreground truncate">{selectedDoc.doc_number} · {selectedDoc.issue_date}</p>
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => selectedDoc && openInObsidian(selectedDoc.name)}
                aria-label="在 Obsidian 中编辑"
                title="Obsidian 编辑"
                className="rounded-lg p-1.5 text-muted-foreground hover:text-eco-600 hover:bg-eco-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <ExternalLink className="size-4" />
              </button>
              <button
                onClick={() => { setSelectedId(null); setFileContent(null) }}
                aria-label="关闭预览"
                title="关闭"
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* 元信息卡片 */}
          {fileContent?.frontmatter && Object.keys(fileContent.frontmatter).length > 0 && (
            <div className="px-5 py-3 border-b border-border bg-muted/30 shrink-0">
              <div className="grid grid-cols-2 gap-2 text-caption">
                {fileContent.frontmatter.category && (
                  <div><span className="text-muted-foreground">类别：</span><span className="font-medium text-foreground">{fileContent.frontmatter.category}</span></div>
                )}
                {fileContent.frontmatter.issue_date && (
                  <div><span className="text-muted-foreground">施行：</span><span className="font-medium text-foreground">{fileContent.frontmatter.issue_date}</span></div>
                )}
                {!!fileContent.frontmatter.industry?.length && (
                  <div><span className="text-muted-foreground">行业：</span><span className="font-medium text-foreground">{Array.isArray(fileContent.frontmatter.industry) ? fileContent.frontmatter.industry.join("、") : fileContent.frontmatter.industry}</span></div>
                )}
                {!!fileContent.frontmatter.applicable_stage?.length && (
                  <div><span className="text-muted-foreground">环节：</span><span className="font-medium text-foreground">{Array.isArray(fileContent.frontmatter.applicable_stage) ? fileContent.frontmatter.applicable_stage.join("、") : fileContent.frontmatter.applicable_stage}</span></div>
                )}
              </div>
              {/* AI 风险标注 */}
              {!!fileContent.frontmatter.ai_risk_notes?.length && (
                <div className="mt-2 rounded-lg bg-destructive/10 border border-destructive/30 px-2.5 py-1.5">
                  <div className="flex items-center gap-1.5 text-caption font-medium text-destructive mb-1">
                    <AlertTriangle className="size-3" />
                    AI 风险标注
                  </div>
                  {fileContent.frontmatter.ai_risk_notes?.map((n, i) => (
                    <div key={i} className="text-caption text-destructive/90 pl-4">
                      {n.clause}：{n.risk}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 正文 */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {loadingFile ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="size-5 animate-spin mr-2" /> 加载文档...
              </div>
            ) : fileError ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <AlertTriangle className="size-8 text-destructive mb-3" />
                <p className="text-body font-medium text-foreground">{fileError}</p>
                {selectedId && (
                  <button
                    onClick={() => loadFile(selectedId)}
                    className="mt-3 rounded-lg bg-eco-600 px-4 py-1.5 text-xs text-white hover:bg-eco-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    重试
                  </button>
                )}
              </div>
            ) : fileContent ? (
              <article className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => <h1 className="text-display font-bold text-foreground mt-2 mb-4 pb-2 border-b border-border">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-section font-semibold text-foreground mt-6 mb-3">{children}</h2>,
                    h3: ({ children }) => <h3 className="text-body font-semibold text-foreground mt-5 mb-2">{children}</h3>,
                    p: ({ children }) => <p className="text-body text-foreground/80 leading-relaxed mb-3">{children}</p>,
                    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                    a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="text-eco-600 hover:underline">{children}</a>,
                    table: ({ children }) => <div className="overflow-x-auto my-3"><table className="w-full text-caption border-collapse">{children}</table></div>,
                    th: ({ children }) => <th className="border border-border bg-muted/50 px-2 py-1 text-left font-medium text-foreground">{children}</th>,
                    td: ({ children }) => <td className="border border-border px-2 py-1 text-foreground/80">{children}</td>,
                    blockquote: ({ children }) => <blockquote className="border-l-4 border-eco-500 pl-3 my-3 text-body text-foreground/70 italic">{children}</blockquote>,
                    code: ({ children }) => <code className="rounded bg-secondary px-1 py-0.5 text-caption font-mono text-warning">{children}</code>,
                    hr: () => <hr className="my-4 border-border" />,
                  }}
                >
                  {fileContent.body}
                </ReactMarkdown>
              </article>
            ) : null}
          </div>

          {/* 底部 backlinks */}
          {fileContent && fileContent.backlinks.length > 0 && (
            <div className="border-t border-border px-5 py-3 shrink-0 max-h-[200px] overflow-y-auto bg-muted/20">
              <div className="flex items-center gap-1.5 mb-2 text-caption font-semibold text-muted-foreground">
                <Link2 className="size-3" />
                反向链接 ({fileContent.backlinks.length})
              </div>
              <div className="space-y-1">
                {fileContent.backlinks.map(b => (
                  <button
                    key={b.id}
                    onClick={() => loadFile(b.id)}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-caption text-foreground/70 hover:bg-accent hover:text-foreground transition-colors text-left"
                  >
                    <ArrowLeft className="size-3 text-muted-foreground shrink-0" />
                    <span className="truncate">{b.title}</span>
                    <span className="ml-auto rounded bg-secondary/60 px-1 py-0.5 text-caption text-muted-foreground shrink-0">{b.category}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 底部操作栏 */}
          {fileContent && (
            <div className="border-t border-border px-5 py-2.5 shrink-0 flex items-center gap-2">
              <button
                onClick={() => askAI(selectedDoc?.title || "")}
                className="flex items-center gap-1.5 rounded-lg bg-eco-600 px-3 py-1.5 text-caption text-eco-50 hover:bg-eco-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <Sparkles className="size-3" />
                问 AI
              </button>
              <button
                onClick={() => selectedDoc && openInObsidian(selectedDoc.name)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-caption text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <ExternalLink className="size-3" />
                Obsidian 编辑
              </button>
            </div>
          )}
        </aside>
      )}

      {/* ═══ 全屏图谱 modal ═══ */}
      {graphFullscreen && (
        <KnowledgeGraphFullscreen
          onClose={() => setGraphFullscreen(false)}
          onNodeClick={(id) => { loadFile(id); setGraphFullscreen(false); setViewMode("docs") }}
        />
      )}
    </div>
  )
}
