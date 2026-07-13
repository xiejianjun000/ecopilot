"use client"
import { useState, useEffect, useRef, useCallback } from "react"
import {
  Upload, Search, AlertTriangle, CheckCircle2,
  FolderArchive, Download, X, Trash2, Loader2,
  ChevronDown, ChevronRight, PanelRightClose, Send, Sparkles,
  Settings2, Plus, GripVertical, ArrowUp, ArrowDown, Pencil,
  BookOpen, CheckCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getApiBase, streamSSE, apiGet, apiPost, apiDelete, apiPut, ensureAuthToken, authHeaders, getAuthToken } from "@/lib/api"
import { FileIcon, fileTypeColor, HighlightText } from "./vault/shared"
import {
  type VaultFile, type RequiredDoc, type MergedItem,
  VAULT_ALLOWED_EXT, fmtSize, fmtDate, extLabel, pathExt,
} from "./vault/types"

/* ═══════════════════════════════════════════════════════
 * 企业环境档案库 — 两栏布局 + 隐藏式阅读栏
 * 左栏：分类树 + 总览进度
 * 中栏：档案列表（搜索 + 业务分组）
 * 右栏：文档预览 + AI 分析（默认隐藏，点击档案打开）
 * 字体规范：11px(辅助) / 12px(正文) / 13px(标题) / 16px(区块标题)
 * ═══════════════════════════════════════════════════════ */

const ALLOWED_EXT = VAULT_ALLOWED_EXT

/** 档案库列表响应 */
interface VaultListData {
  files: VaultFile[]
  required: RequiredDoc[]
  subcats?: { name: string; phase: string }[]
  phases?: { id: string; label: string }[]
}

/** 单个档案同步结果 */
interface SyncResult {
  ok: boolean
  vault_id?: string
  md_filename?: string
  detail?: string
}

/** 档案删除/同步等操作响应 */
interface VaultOpResult {
  ok: boolean
  detail?: string
  md_filename?: string
  results?: SyncResult[]
}

export function VaultView() {
  const [files, setFiles] = useState<VaultFile[]>([])
  const [required, setRequired] = useState<RequiredDoc[]>([])
  const [subcats, setSubcats] = useState<{ name: string; phase: string }[]>([])
  const [phases, setPhases] = useState<{ id: string; label: string }[]>([
    { id: "construction", label: "建设期间" },
    { id: "operation",    label: "运营期间" },
    { id: "decommission", label: "退役期间" },
  ])
  const [loading, setLoading] = useState(true)
  const [cat, setCat] = useState("全部")
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // P1: 记录已自动分析过的 fileId，避免右栏关闭重开重复调用 AI
  const [analyzedIds, setAnalyzedIds] = useState<Set<string>>(new Set())
  const [uploadTarget, setUploadTarget] = useState<{ tpl_id: string; name: string; cat: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<VaultFile | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [collapsedPhases, setCollapsedPhases] = useState<Record<string, boolean>>({})
  // mount 后从 localStorage 恢复阶段折叠状态（避免 SSR/客户端初始值不一致导致 hydration 不匹配）
  useEffect(() => {
    try {
      const saved = localStorage.getItem("vault_collapsed_phases")
      if (saved) setCollapsedPhases(JSON.parse(saved))
    } catch (e) { console.error("[vault] localStorage load failed:", e) }
  }, [])
  const [autoClassifyOpen, setAutoClassifyOpen] = useState(false)
  const [categoryMgrOpen, setCategoryMgrOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<VaultFile | null>(null)
  const [errorMsg, setErrorMsg] = useState("")

  // 滚动到第一个缺失项
  const scrollToFirstMissing = () => {
    const el = document.querySelector('[data-missing="true"]') as HTMLElement | null
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      el.classList.add("ring-2", "ring-warning")
      setTimeout(() => el.classList.remove("ring-2", "ring-warning"), 2000)
    }
  }

  // 阶段折叠状态持久化
  const togglePhase = (id: string) => setCollapsedPhases(p => {
    const next = { ...p, [id]: !p[id] }
    try { localStorage.setItem("vault_collapsed_phases", JSON.stringify(next)) } catch { /* quota exceeded */ }
    return next
  })

  const [loadError, setLoadError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoading(true); setLoadError(null)
    try {
      const r = await apiGet<VaultListData>('/api/vault/list')
      if (r.ok && r.data) {
        setFiles(r.data.files || [])
        setRequired(r.data.required || [])
        if (r.data.subcats) setSubcats(r.data.subcats)
        if (r.data.phases) setPhases(r.data.phases)
      } else {
        // P1: 加载失败不误判为空库
        setLoadError(r.error || "档案加载失败，请检查后端服务")
      }
    } catch (e) {
      setLoadError("网络错误，请检查网络连接")
    }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const merged: MergedItem[] = [
    ...files.map(f => ({ ...f, kind: "uploaded" as const })),
    ...required.filter(r => !r.uploaded).map(r => ({ ...r, kind: "missing" as const })),
  ]
  const filtered = merged.filter(d => {
    const itemCat = d.kind === "uploaded" ? d.category : d.cat
    const inCat = cat === "全部" || itemCat === cat
    const q = search.trim()
    const inSearch = !q
      || (d.kind === "uploaded" && (d.original_name.includes(q) || d.code.includes(q) || d.desc.includes(q)))
      || (d.kind === "missing" && (d.name.includes(q) || d.desc.includes(q)))
    return inCat && inSearch
  })

  const requiredTotal = required.length
  const requiredUploaded = required.filter(r => r.uploaded).length
  const missingCount = requiredTotal - requiredUploaded
  const rate = requiredTotal > 0 ? Math.round(requiredUploaded / requiredTotal * 100) : 0

  // 选中文件对象
  const selectedFile = files.find(f => f.id === selectedId) || null

  // 按三大阶段分组（子分类动态从 subcats 读取 phase 归属）
  const grouped = phases.map(p => ({
    ...p,
    items: filtered.filter(d => {
      const itemCat = d.kind === "uploaded" ? d.category : d.cat
      const sc = subcats.find(s => s.name === itemCat)
      return (sc?.phase || "operation") === p.id
    }),
  }))

  const handleDelete = async (f: VaultFile) => {
    try {
      const r = await apiDelete<VaultOpResult>('/api/vault/file', { id: f.id })
      if (r.ok && r.data?.ok) {
        setConfirmDelete(null)
        if (selectedId === f.id) setSelectedId(null)
        load()
      } else {
        console.error('删除档案失败:', r.data?.detail || r.error)
        setErrorMsg(r.data?.detail || r.error || "删除失败")
        setTimeout(() => setErrorMsg(""), 4000)
      }
    } catch (e) {
      console.error('删除档案网络错误:', e)
      setErrorMsg("网络错误，删除失败")
      setTimeout(() => setErrorMsg(""), 4000)
    }
  }

  // ── 同步档案到知识库（AI 生成 MD 摘要） ──
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [syncingAll, setSyncingAll] = useState(false)
  const [syncedIds, setSyncedIds] = useState<Set<string>>(new Set())
  const [syncMsg, setSyncMsg] = useState<string>("")

  const handleSyncOne = async (f: VaultFile) => {
    setSyncingId(f.id)
    setSyncMsg("")
    try {
      const r = await apiPost<VaultOpResult>(
        `/api/vault/sync-to-knowledge?id=${encodeURIComponent(f.id)}`
      )
      if (r.ok && r.data?.ok) {
        setSyncedIds(prev => new Set(prev).add(f.id))
        setSyncMsg(`✓ 已生成「${r.data.md_filename || f.original_name}.md」并存入知识库`)
        setTimeout(() => setSyncMsg(""), 4000)
      } else {
        setSyncMsg(`✗ ${r.data?.detail || r.error || "同步失败"}`)
        setTimeout(() => setSyncMsg(""), 4000)
      }
    } catch (e) {
      console.error('同步档案失败:', e)
      setSyncMsg("✗ 网络错误，同步失败")
      setTimeout(() => setSyncMsg(""), 4000)
    } finally {
      setSyncingId(null)
    }
  }

  const handleSyncAll = async () => {
    if (files.length === 0) {
      setSyncMsg("档案库为空，无可同步的文件")
      setTimeout(() => setSyncMsg(""), 3000)
      return
    }
    setSyncingAll(true)
    setSyncMsg("")
    try {
      const r = await apiPost<VaultOpResult>('/api/vault/sync-all-to-knowledge')
      if (r.ok && r.data?.ok) {
        const results = r.data.results || []
        const success = results.filter(item => item.ok).length
        const fail = results.length - success
        setSyncMsg(`✓ 批量同步完成：成功 ${success} 项${fail > 0 ? `，失败 ${fail} 项` : ""}，已写入知识库 vault-extracts/`)
        if (results.length > 0) {
          const okIds = new Set<string>()
          results.forEach(item => { if (item.ok && item.vault_id) okIds.add(item.vault_id) })
          setSyncedIds(prev => new Set([...prev, ...okIds]))
        }
        setTimeout(() => setSyncMsg(""), 6000)
      } else {
        setSyncMsg(`✗ ${r.data?.detail || r.error || "批量同步失败"}`)
        setTimeout(() => setSyncMsg(""), 4000)
      }
    } catch (e) {
      console.error('批量同步失败:', e)
      setSyncMsg("✗ 网络错误，批量同步失败")
      setTimeout(() => setSyncMsg(""), 4000)
    } finally {
      setSyncingAll(false)
    }
  }

  const toggleGroup = (id: string) => setCollapsedGroups(p => ({ ...p, [id]: !p[id] }))

  // 子分类名称列表（不含"全部"）
  const userCats = subcats.map(s => s.name)

  return (
    <div className="flex h-full overflow-hidden">
      {/* ═══ 左栏：两级分类树 + 总览 ═══ */}
      <aside className="hidden md:flex flex-1 min-w-[280px] max-w-[420px] shrink-0 flex-col border-r border-border bg-sidebar/30 overflow-y-auto">
        {/* 总览头部 */}
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="flex size-9 items-center justify-center rounded-xl bg-eco-50">
              <FolderArchive className="size-4.5 text-eco-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-section font-semibold text-foreground">企业档案库</h2>
              <p className="text-caption text-muted-foreground">按企业生命周期分类管理</p>
            </div>
            <button onClick={() => setCategoryMgrOpen(true)} className="rounded-lg p-1.5 text-muted-foreground hover:text-eco-600 hover:bg-eco-50 transition-colors" title="管理分类">
              <Settings2 className="size-4" />
            </button>
          </div>
          <div className="rounded-xl bg-card border border-border p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-caption text-muted-foreground">法定完整度</span>
              <span className={cn("text-title font-bold tabular-nums", rate === 0 ? "text-muted-foreground" : rate >= 80 ? "text-success" : rate >= 50 ? "text-warning" : "text-destructive")}>
                {requiredUploaded}<span className="text-muted-foreground/50 mx-0.5">/</span>{requiredTotal}
              </span>
            </div>
            <div className="h-2 rounded-full bg-secondary overflow-hidden mb-2">
              <div className={cn("h-full rounded-full transition-all", rate === 0 ? "bg-muted-foreground/30" : rate >= 80 ? "bg-success" : rate >= 50 ? "bg-warning" : "bg-destructive")} style={{ width: Math.max(rate, 2) + "%" }} />
            </div>
            <div className="flex items-center justify-between text-caption">
              <span className="text-muted-foreground">完成率 <span className={cn("font-semibold", rate === 0 ? "text-muted-foreground" : rate >= 80 ? "text-success" : rate >= 50 ? "text-warning" : "text-destructive")}>{rate}%</span></span>
              {missingCount > 0 && <span className="text-destructive font-medium">缺 {missingCount} 项</span>}
            </div>
          </div>
        </div>

        {/* 两级分类树 */}
        <div className="px-3 pt-3 pb-2 flex-1">
          <div className="px-2 py-1.5 text-caption font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
            <span>阶段分类</span>
            <button onClick={() => setCategoryMgrOpen(true)} className="text-muted-foreground/60 hover:text-eco-600 normal-case tracking-normal" title="编辑分类">
              <Pencil className="size-3" />
            </button>
          </div>
          <div className="space-y-0.5 mt-0.5">
            {/* 全部 */}
            <button onClick={() => setCat("全部")} className={cn(
              "relative flex w-full items-center justify-between rounded-lg pl-3 pr-2 py-1.5 text-body transition-all",
              cat === "全部" ? "bg-eco-50 text-eco-700 font-medium" : "text-foreground/80 hover:bg-accent"
            )}>
              {cat === "全部" && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-eco-600" />}
              <span className="flex items-center gap-2">
                <FolderArchive className="size-3.5" />
                全部档案
              </span>
              <span className={cn("rounded-md px-1.5 py-0.5 text-caption tabular-nums", cat === "全部" ? "bg-eco-100 text-eco-700" : "bg-secondary text-muted-foreground")}>{merged.length}</span>
            </button>
            {/* 三大阶段 + 子分类 */}
            {phases.map(phase => {
              const phaseCats = subcats.filter(s => s.phase === phase.id)
              const phaseCount = phaseCats.reduce((sum, sc) => sum + merged.filter(d => (d.kind === "uploaded" ? d.category : d.cat) === sc.name).length, 0)
              const isCollapsed = collapsedPhases[phase.id]
              return (
                <div key={phase.id}>
                  <button onClick={() => togglePhase(phase.id)} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-body text-foreground/80 hover:bg-accent transition-colors">
                    <span className="flex items-center gap-1.5">
                      {isCollapsed ? <ChevronRight className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
                      <span className="font-medium">{phase.label}</span>
                    </span>
                    <span className="rounded-md bg-secondary px-1.5 py-0.5 text-caption text-muted-foreground tabular-nums">{phaseCount}</span>
                  </button>
                  {!isCollapsed && (
                    <div className="ml-3 border-l border-border/60 pl-1.5 space-y-0.5 mt-0.5">
                      {phaseCats.map(sc => {
                        const count = merged.filter(d => (d.kind === "uploaded" ? d.category : d.cat) === sc.name).length
                        return (
                          <button key={sc.name} onClick={() => setCat(sc.name)} className={cn(
                            "relative flex w-full items-center justify-between rounded-md pl-2.5 pr-2 py-1 text-xs transition-all",
                            cat === sc.name ? "bg-eco-50 text-eco-700 font-medium" : "text-foreground/70 hover:bg-accent"
                          )}>
                            {cat === sc.name && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-full bg-eco-600" />}
                            <span>{sc.name}</span>
                            <span className={cn("rounded px-1.5 py-0.5 text-caption tabular-nums", cat === sc.name ? "bg-eco-100 text-eco-700" : "bg-secondary/60 text-muted-foreground")}>{count}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* 快捷入口 */}
        <div className="p-3 border-t border-border">
          {missingCount > 0 && (
            <button onClick={() => { setCat("全部"); setTimeout(() => scrollToFirstMissing(), 100) }} className="flex w-full items-center justify-between rounded-lg bg-destructive/10 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition-colors">
              <span className="flex items-center gap-2">
                <AlertTriangle className="size-3.5" />
                缺失档案
              </span>
              <span className="font-semibold tabular-nums">{missingCount} 项</span>
            </button>
          )}
        </div>
      </aside>

      {/* ═══ 中栏：档案列表（按三大阶段分组） ═══ */}
      <div className="relative flex flex-1 min-w-[320px] flex-col border-r border-border bg-background">
        {/* 搜索 + 标题 + 主操作按钮 */}
        <div className="p-5 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-section font-semibold text-foreground">
                {cat === "全部" ? "全部档案" : cat}
              </h3>
              <p className="text-caption text-muted-foreground mt-0.5">
                共 {filtered.length} 项 · 按企业生命周期分组
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setAutoClassifyOpen(true)} className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-eco-600 to-eco-700 px-3 py-2 text-xs text-eco-50 hover:from-eco-700 hover:to-eco-800 transition-all shadow-sm">
                <Sparkles className="size-3.5" />
                AI 识别
              </button>
              <button
                onClick={handleSyncAll}
                disabled={syncingAll || files.length === 0}
                title="AI 读取档案文件内容，生成结构化 MD 摘要并存入知识库 vault-extracts/ 目录"
                className="flex items-center gap-1.5 rounded-lg border border-eco-200 bg-eco-50 px-3 py-2 text-xs text-eco-700 hover:bg-eco-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {syncingAll ? <Loader2 className="size-3.5 animate-spin" /> : <BookOpen className="size-3.5" />}
                {syncingAll ? "AI 摘要中…" : "全部同步到知识库"}
              </button>
              <button onClick={() => setUploadTarget({ tpl_id: "", name: "", cat: cat === "全部" ? "其他" : cat })} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground hover:bg-accent transition-colors">
                <Upload className="size-3.5" />
                上传
              </button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索档案名称、文号或描述..." className="w-full rounded-lg border border-border bg-card pl-9 pr-9 py-2.5 text-body focus:outline-none focus:ring-2 focus:ring-eco-200 focus:border-eco-300" />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent" aria-label="清除搜索">
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="size-5 animate-spin mr-2" />加载中...</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-4">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-secondary/50">
                <FolderArchive className="size-8 opacity-40" />
              </div>
              <div className="text-center">
                <p className="text-body font-medium text-foreground">暂无档案</p>
                <p className="text-xs mt-1">上传第一份档案或用 AI 智能识别</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setUploadTarget({ tpl_id: "", name: "", cat: cat === "全部" ? "其他" : cat })} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground hover:bg-accent">
                  <Upload className="size-3.5" /> 上传档案
                </button>
                <button onClick={() => setAutoClassifyOpen(true)} className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-eco-600 to-eco-700 px-3 py-2 text-xs text-eco-50 hover:from-eco-700 hover:to-eco-800 shadow-sm">
                  <Sparkles className="size-3.5" /> AI 智能识别
                </button>
              </div>
            </div>
          ) : (
            <div className="px-3 pt-0 pb-3 space-y-4">
              {grouped.filter(g => g.items.length > 0).map(g => {
                const gUploaded = g.items.filter(d => d.kind === "uploaded").length
                const gTotal = g.items.length
                const gRate = gTotal > 0 ? Math.round(gUploaded / gTotal * 100) : 0
                return (
                <div key={g.id}>
                  {/* 阶段分组标题 - sticky 吸顶，含进度 */}
                  <div className="sticky top-0 z-10 -mx-3 px-3 py-2 bg-background/95 backdrop-blur-sm flex items-center gap-2 text-xs font-semibold text-foreground/70 border-b border-border/50">
                    <button onClick={() => toggleGroup(g.id)} className="flex items-center gap-2 flex-1 hover:text-foreground transition-colors">
                      {collapsedGroups[g.id] ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                      <span>{g.label}</span>
                      <span className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-caption text-muted-foreground font-normal tabular-nums">
                        <span className={cn(gRate === 100 ? "text-success" : gRate > 0 ? "text-warning" : "text-muted-foreground")}>{gUploaded}</span>
                        <span className="text-muted-foreground/50">/</span>
                        <span>{gTotal}</span>
                      </span>
                    </button>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  {!collapsedGroups[g.id] && (
                    <div className="space-y-1.5 mt-1.5">
                      {g.items.map(d => {
                        const isUploaded = d.kind === "uploaded"
                        const isSelected = isUploaded && selectedId === d.id
                        const colors = isUploaded ? fileTypeColor(d.ext) : { bg: "bg-destructive/10", fg: "text-destructive" }
                        const displayName = isUploaded ? d.original_name : d.name
                        return (
                          <button
                            key={isUploaded ? d.id : d.tpl_id}
                            data-missing={!isUploaded ? "true" : undefined}
                            onClick={() => isUploaded && setSelectedId(d.id)}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-xl p-3 text-left transition-all",
                              isSelected
                                ? "bg-eco-50 ring-1 ring-eco-200"
                                : isUploaded
                                  ? "hover:bg-accent border border-transparent hover:border-border"
                                  : "border border-dashed border-destructive/30 bg-destructive/10 hover:bg-destructive/10 cursor-default",
                              !isUploaded && "cursor-default"
                            )}
                          >
                            <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", colors.bg)}>
                              {isUploaded
                                ? <FileIcon ext={d.ext} className={cn("size-5", colors.fg)} />
                                : <AlertTriangle className="size-5 text-destructive" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className={cn("text-body font-medium truncate", isUploaded ? "text-foreground" : "text-foreground/80")}>
                                <HighlightText text={displayName} query={search} />
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                {isUploaded ? (
                                  <>
                                    <span className="text-caption text-muted-foreground tabular-nums">{fmtDate(d.upload_date)}</span>
                                    <span className="text-caption text-muted-foreground/40">·</span>
                                    <span className="text-caption text-muted-foreground tabular-nums">{fmtSize(d.size)}</span>
                                    {d.ext && (
                                      <span className={cn("text-caption font-semibold", colors.fg)}>{extLabel(d.ext)}</span>
                                    )}
                                    {d.code && (
                                      <>
                                        <span className="text-caption text-muted-foreground/40">·</span>
                                        <span className="text-caption text-muted-foreground/70 font-mono truncate max-w-[120px]">{d.code}</span>
                                      </>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-caption text-destructive font-medium">未上传 · 待补充</span>
                                )}
                              </div>
                            </div>
                            {!isUploaded && (
                              <span onClick={(e) => { e.stopPropagation(); setUploadTarget({ tpl_id: d.tpl_id, name: d.name, cat: d.cat }) }} className="flex items-center gap-1 rounded-lg bg-eco-600 px-2.5 py-1.5 text-caption text-eco-50 hover:bg-eco-700 shrink-0 shadow-sm">
                                <Upload className="size-3" />
                                上传
                              </span>
                            )}
                            {isUploaded && (
                              <span
                                onClick={(e) => { e.stopPropagation(); handleSyncOne(d as VaultFile) }}
                                title={syncedIds.has(d.id) ? "已生成 MD 摘要到知识库" : "AI 生成 MD 摘要存入知识库"}
                                className={cn(
                                  "flex items-center gap-1 rounded-lg px-2 py-1.5 text-caption shrink-0 transition-colors",
                                  syncedIds.has(d.id)
                                    ? "bg-success/10 text-success hover:bg-success/20"
                                    : "bg-secondary text-muted-foreground hover:bg-eco-100 hover:text-eco-700"
                                )}
                              >
                                {syncingId === d.id ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : syncedIds.has(d.id) ? (
                                  <CheckCircle className="size-3" />
                                ) : (
                                  <BookOpen className="size-3" />
                                )}
                                {syncingId === d.id ? "生成中" : syncedIds.has(d.id) ? "已摘要" : "摘要"}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 同步状态浮层 */}
        {syncMsg && (
          <div className={cn(
            "absolute bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs shadow-popover animate-in fade-in slide-in-from-bottom-2 duration-200 max-w-[90%]",
            syncMsg.startsWith("✓") ? "bg-success/95 text-eco-50" : syncMsg.startsWith("✗") ? "bg-destructive/95 text-eco-50" : "bg-foreground/95 text-background"
          )}>
            {syncMsg.startsWith("✓") ? <CheckCircle2 className="size-3.5 shrink-0" /> : syncMsg.startsWith("✗") ? <AlertTriangle className="size-3.5 shrink-0" /> : <Loader2 className="size-3.5 animate-spin shrink-0" />}
            <span className="truncate">{syncMsg.replace(/^[✓✗]\s*/, "")}</span>
          </div>
        )}

        {/* 错误提示浮层 */}
        {errorMsg && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl bg-destructive/95 text-eco-50 px-4 py-2.5 text-xs shadow-popover animate-in fade-in slide-in-from-top-2 duration-200 max-w-[90%]">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="truncate">{errorMsg}</span>
            <button onClick={() => setErrorMsg("")} className="ml-1 shrink-0 hover:text-eco-50/80" aria-label="关闭">
              <X className="size-3" />
            </button>
          </div>
        )}
      </div>

      {/* ═══ 右栏：文档预览 + AI 分析（默认隐藏，点击档案自动打开） ═══ */}
      {selectedFile && (
        <div className="hidden md:flex flex-1 min-w-0 flex-col bg-canvas overflow-hidden animate-in fade-in slide-in-from-right-2 duration-200">
          <DocPreviewPanel
            file={selectedFile}
            onClose={() => setSelectedId(null)}
            onDelete={() => setConfirmDelete(selectedFile)}
            onEdit={() => setEditTarget(selectedFile)}
            analyzedIds={analyzedIds}
            onAnalyzed={(id) => setAnalyzedIds(prev => new Set(prev).add(id))}
          />
        </div>
      )}

      {/* 上传弹窗 */}
      {uploadTarget && (
        <UploadModal target={uploadTarget} categories={userCats} onClose={() => setUploadTarget(null)} onDone={() => { setUploadTarget(null); load() }} />
      )}

      {/* AI 智能识别弹窗 */}
      {autoClassifyOpen && (
        <AutoClassifyModal onClose={() => setAutoClassifyOpen(false)} onDone={() => { setAutoClassifyOpen(false); load() }} />
      )}

      {/* 分类管理弹窗 */}
      {categoryMgrOpen && (
        <CategoryManager
          subcats={subcats}
          phases={phases}
          onClose={() => setCategoryMgrOpen(false)}
          onSaved={() => { setCategoryMgrOpen(false); load() }}
        />
      )}

      {/* 编辑档案元数据弹窗 */}
      {editTarget && (
        <EditMetaModal
          file={editTarget}
          categories={userCats}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); load() }}
        />
      )}

      {/* 删除确认 */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setConfirmDelete(null)} />
          <div className="relative z-10 w-[400px] max-w-[90vw] rounded-2xl border border-border bg-background p-6 shadow-modal">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10"><AlertTriangle className="size-5 text-destructive" /></div>
              <div className="flex-1 min-w-0">
                <h3 className="text-title font-semibold text-foreground">删除档案</h3>
                <p className="mt-1 text-xs text-muted-foreground">确定删除 <span className="font-medium text-foreground">{confirmDelete.original_name}</span> 吗？此操作不可恢复。</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="rounded-lg bg-secondary px-4 py-2 text-xs text-foreground hover:bg-accent">取消</button>
              <button onClick={() => handleDelete(confirmDelete)} className="rounded-lg bg-destructive px-4 py-2 text-xs text-eco-50 hover:bg-destructive">确认删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════
 * 分类管理弹窗 — 按阶段管理子分类（重命名/新增/删除/排序/调整阶段）
 * ═══════════════════════════════════════════════════════ */
function CategoryManager({ subcats, phases, onClose, onSaved }: {
  subcats: { name: string; phase: string }[]
  phases: { id: string; label: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const [list, setList] = useState<{ name: string; phase: string }[]>(subcats.map(s => ({ ...s })))
  const [renames, setRenames] = useState<Record<string, string>>({})
  const [newCat, setNewCat] = useState("")
  const [newCatPhase, setNewCatPhase] = useState(phases[1]?.id || "operation")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const updateName = (i: number, val: string) => {
    const old = list[i].name
    const next = [...list]
    next[i] = { ...next[i], name: val }
    setList(next)
    if (val !== old) {
      setRenames(r => ({ ...r, [old]: val }))
    } else {
      setRenames(r => {
        const c = { ...r }; delete c[old]; return c
      })
    }
  }

  const updatePhase = (i: number, phase: string) => {
    const next = [...list]
    next[i] = { ...next[i], phase }
    setList(next)
  }

  const remove = (i: number) => {
    const name = list[i].name
    if (name === "其他") { setError("“其他”是系统兜底分类，不可删除"); return }
    const next = [...list]; next.splice(i, 1)
    setList(next)
    setRenames(r => {
      const c = { ...r }; delete c[name]; return c
    })
  }

  const add = () => {
    const v = newCat.trim()
    if (!v) return
    if (list.some(s => s.name === v)) { setError("分类已存在"); return }
    setList([...list, { name: v, phase: newCatPhase }])
    setNewCat("")
    setError("")
  }

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= list.length) return
    const next = [...list]
    ;[next[i], next[j]] = [next[j], next[i]]
    setList(next)
  }

  const save = async () => {
    const seen = new Set<string>()
    for (const sc of list) {
      if (!sc.name.trim()) { setError("分类名不能为空"); return }
      if (seen.has(sc.name)) { setError(`分类名重复：${sc.name}`); return }
      seen.add(sc.name)
    }
    if (!list.some(s => s.name === "其他")) {
      list.push({ name: "其他", phase: "operation" })
    }
    setSaving(true); setError("")
    try {
      const r = await apiPost<VaultOpResult>('/api/vault/categories', { subcats: list, renames })
      if (r.ok && r.data?.ok) onSaved()
      else setError(r.data?.detail || r.error || "保存失败")
    } catch (e) {
      console.error('保存分类失败:', e)
      setError("网络错误")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/40" onClick={saving ? undefined : onClose} />
      <div className="relative z-10 w-[580px] max-w-[94vw] max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-background shadow-modal">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-eco-50">
              <Settings2 className="size-4.5 text-eco-600" />
            </div>
            <div>
              <h3 className="text-title font-semibold text-foreground">分类管理</h3>
              <p className="text-caption text-muted-foreground">按阶段管理子分类：重命名、新增、删除、调整归属</p>
            </div>
          </div>
          <button onClick={onClose} disabled={saving} aria-label="关闭" className="rounded-lg p-2 text-muted-foreground hover:bg-accent disabled:opacity-40">
            <X className="size-4" />
          </button>
        </div>

        {/* Body — 按阶段分组编辑 */}
        <div className="p-5 space-y-5">
          {phases.map(phase => {
            const phaseItems = list.map((s, i) => ({ ...s, _i: i })).filter(s => s.phase === phase.id)
            return (
              <div key={phase.id}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="rounded-md bg-eco-50 px-2 py-0.5 text-xs font-semibold text-eco-700">{phase.label}</span>
                  <span className="text-caption text-muted-foreground tabular-nums">{phaseItems.length} 项</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="space-y-1.5">
                  {phaseItems.map(item => (
                    <div key={item._i} className="flex items-center gap-2">
                      <div className="flex flex-col gap-0.5">
                        <button onClick={() => move(item._i, -1)} disabled={item._i === 0} aria-label="上移" className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                          <ArrowUp className="size-3" />
                        </button>
                        <button onClick={() => move(item._i, 1)} disabled={item._i === list.length - 1} aria-label="下移" className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                          <ArrowDown className="size-3" />
                        </button>
                      </div>
                      <GripVertical className="size-3.5 text-muted-foreground/40" />
                      <input
                        value={item.name}
                        onChange={e => updateName(item._i, e.target.value)}
                        disabled={saving}
                        className={cn(
                          "flex-1 rounded-lg border border-border bg-card px-3 py-2 text-body focus:outline-none focus:ring-2 focus:ring-eco-200 disabled:opacity-60",
                          renames[item.name] && renames[item.name] !== item.name && "border-warning/40 bg-warning/10"
                        )}
                      />
                      {/* 阶段切换下拉 */}
                      <select
                        value={item.phase}
                        onChange={e => updatePhase(item._i, e.target.value)}
                        disabled={saving || item.name === "其他"}
                        className="rounded-lg border border-border bg-card px-2 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-eco-200 disabled:opacity-60"
                      >
                        {phases.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                      <button
                        onClick={() => remove(item._i)}
                        disabled={saving || item.name === "其他"}
                        className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:cursor-not-allowed"
                        title={item.name === "其他" ? "“其他”不可删除" : "删除分类"}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  {phaseItems.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground/60 text-center">
                      此阶段暂无子分类
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* 新增分类 */}
          <div className="flex items-center gap-2 pt-3 border-t border-border">
            <input
              value={newCat}
              onChange={e => setNewCat(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") add() }}
              disabled={saving}
              placeholder="输入新分类名称，如：碳排放、土壤调查..."
              className="flex-1 rounded-lg border border-dashed border-eco-300 bg-eco-50/30 px-3 py-2 text-body focus:outline-none focus:ring-2 focus:ring-eco-200 disabled:opacity-60"
            />
            <select
              value={newCatPhase}
              onChange={e => setNewCatPhase(e.target.value)}
              disabled={saving}
              className="rounded-lg border border-border bg-card px-2 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-eco-200 disabled:opacity-60"
            >
              {phases.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <button onClick={add} disabled={saving || !newCat.trim()} className="flex items-center gap-1 rounded-lg bg-eco-600 px-3 py-2 text-xs text-eco-50 hover:bg-eco-700 disabled:opacity-40">
              <Plus className="size-3.5" /> 添加
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="size-3.5 shrink-0" />{error}
            </div>
          )}

          {/* 说明 */}
          <div className="rounded-lg bg-secondary/40 p-3 text-caption text-muted-foreground space-y-1">
            <p>• 重命名后，已上传档案的分类会自动同步</p>
            <p>• 删除分类后，该分类下的档案会归入"其他"</p>
            <p>• "其他"是系统兜底分类，不可删除、不可更改阶段</p>
            <p>• 可通过下拉框调整子分类所属阶段</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-border bg-secondary/20">
          <button onClick={onClose} disabled={saving} className="rounded-lg bg-secondary px-4 py-2 text-xs text-foreground hover:bg-accent disabled:opacity-40">取消</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-lg bg-eco-600 px-4 py-2 text-xs text-eco-50 hover:bg-eco-700 disabled:opacity-40">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
            {saving ? "保存中" : "保存分类"}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════
 * 编辑档案元数据弹窗（名称/分类/文号/描述）
 * ═══════════════════════════════════════════════════════ */

function EditMetaModal({ file, categories, onClose, onSaved }: {
  file: VaultFile
  categories: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const [originalName, setOriginalName] = useState(file.original_name)
  const [category, setCategory] = useState(file.category)
  const [code, setCode] = useState(file.code || "")
  const [desc, setDesc] = useState(file.desc || "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const save = async () => {
    if (!originalName.trim()) { setError("文件名不能为空"); return }
    setSaving(true); setError("")
    try {
      const r = await apiPut<VaultOpResult>('/api/vault/file', {
        id: file.id,
        original_name: originalName.trim(),
        category,
        code: code.trim(),
        desc: desc.trim(),
      })
      if (r.ok && r.data?.ok) {
        onSaved()
      } else {
        setError(r.data?.detail || r.error || "保存失败")
      }
    } catch (e) {
      console.error('编辑档案失败:', e)
      setError("网络错误，保存失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/40" onClick={saving ? undefined : onClose} />
      <div className="relative z-10 w-[520px] max-w-[92vw] rounded-2xl border border-border bg-background shadow-modal">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-eco-50">
              <Pencil className="size-4.5 text-eco-600" />
            </div>
            <div>
              <h3 className="text-title font-semibold text-foreground">编辑档案信息</h3>
              <p className="text-caption text-muted-foreground">修改档案的显示名称、分类、文号和描述</p>
            </div>
          </div>
          <button onClick={onClose} disabled={saving} aria-label="关闭" className="rounded-lg p-2 text-muted-foreground hover:bg-accent disabled:opacity-40">
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-caption font-medium text-muted-foreground mb-1.5">档案名称</label>
            <input
              value={originalName}
              onChange={e => setOriginalName(e.target.value)}
              disabled={saving}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-body focus:outline-none focus:ring-2 focus:ring-eco-200 disabled:opacity-60"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-caption font-medium text-muted-foreground mb-1.5">档案分类</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                disabled={saving}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-body focus:outline-none focus:ring-2 focus:ring-eco-200 disabled:opacity-60"
              >
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-caption font-medium text-muted-foreground mb-1.5">文号 / 编号</label>
              <input
                value={code}
                onChange={e => setCode(e.target.value)}
                disabled={saving}
                placeholder="如：湘环评[2019]138号"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-body focus:outline-none focus:ring-2 focus:ring-eco-200 disabled:opacity-60"
              />
            </div>
          </div>
          <div>
            <label className="block text-caption font-medium text-muted-foreground mb-1.5">描述（可选）</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              disabled={saving}
              rows={3}
              placeholder="如：2025年度执行报告、废水零排放要求..."
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-body focus:outline-none focus:ring-2 focus:ring-eco-200 disabled:opacity-60 resize-none"
            />
          </div>
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="size-3.5 shrink-0" />{error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-border bg-secondary/20">
          <button onClick={onClose} disabled={saving} className="rounded-lg bg-secondary px-4 py-2 text-xs text-foreground hover:bg-accent disabled:opacity-40">取消</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-lg bg-eco-600 px-4 py-2 text-xs text-eco-50 hover:bg-eco-700 disabled:opacity-40">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
            {saving ? "保存中" : "保存"}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════
 * 右栏：文档预览 + AI 分析面板
 * ═══════════════════════════════════════════════════════ */

function DocPreviewPanel({ file, onClose, onDelete, onEdit, analyzedIds, onAnalyzed }: {
  file: VaultFile; onClose: () => void; onDelete: () => void; onEdit: () => void
  analyzedIds: Set<string>
  onAnalyzed: (id: string) => void
}) {
  const ext = file.ext.toLowerCase()
  const _tok = getAuthToken() ? `&token=${encodeURIComponent(getAuthToken()!)}` : ''
  const fileUrl = `${getApiBase()}/api/vault/file?id=${encodeURIComponent(file.id)}&inline=1${_tok}`
  const downloadUrl = `${getApiBase()}/api/vault/file?id=${encodeURIComponent(file.id)}&inline=0${_tok}`
  const [textContent, setTextContent] = useState<string | null>(null)
  const [textError, setTextError] = useState("")
  const [showAI, setShowAI] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [synced, setSynced] = useState(false)
  const [syncMsg, setSyncMsg] = useState("")

  const isPdf = ext === ".pdf"
  const isImage = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"].includes(ext)
  const isText = [".txt", ".md", ".csv", ".log"].includes(ext)
  const isOffice = [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"].includes(ext)
  const isArchive = [".zip", ".rar", ".7z"].includes(ext)

  useEffect(() => {
    if (!isText) return
    setTextContent(null); setTextError("")
    apiGet<string>('/api/vault/file', { id: file.id, inline: '1' })
      .then(r => {
        if (r.ok && r.data != null) {
          setTextContent(typeof r.data === 'string' ? r.data : String(r.data))
        } else {
          setTextError(r.error || "文本内容加载失败")
        }
      })
      .catch(() => setTextError("文本内容加载失败"))
  }, [file.id, isText])

  const handleSync = async () => {
    setSyncing(true); setSyncMsg("")
    try {
      const r = await apiPost<VaultOpResult>(
        `/api/vault/sync-to-knowledge?id=${encodeURIComponent(file.id)}`
      )
      if (r.ok && r.data?.ok) {
        setSynced(true)
        setSyncMsg(`✓ 已生成「${r.data.md_filename || file.original_name}.md」`)
      } else {
        setSyncMsg(`✗ ${r.data?.detail || r.error || "同步失败"}`)
      }
    } catch (e) {
      console.error('同步档案失败:', e)
      setSyncMsg("✗ 网络错误，同步失败")
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncMsg(""), 4000)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-eco-50">
            <FileIcon ext={ext} className="size-4 text-eco-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-body font-semibold text-foreground truncate">{file.original_name}</h2>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="rounded bg-secondary px-1.5 py-0.5 text-caption text-muted-foreground">{file.category}</span>
              {file.code && <span className="text-caption text-muted-foreground font-mono truncate max-w-[120px]">{file.code}</span>}
              <span className="text-caption text-muted-foreground">{fmtSize(file.size)}</span>
              <span className="rounded bg-eco-50 px-1.5 py-0.5 text-caption text-eco-700 font-mono uppercase">{ext}</span>
              {syncMsg && (
                <span className={cn("rounded px-1.5 py-0.5 text-caption font-medium", syncMsg.startsWith("✓") ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
                  {syncMsg}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleSync}
            disabled={syncing}
            title="AI 读取文件内容生成 MD 摘要，存入知识库"
            className={cn(
              "rounded-lg p-2 transition-colors",
              synced ? "bg-success/10 text-success hover:bg-success/20" : "bg-secondary text-muted-foreground hover:bg-eco-100 hover:text-eco-700",
              syncing && "opacity-60 cursor-wait"
            )}
          >
            {syncing ? <Loader2 className="size-4 animate-spin" /> : synced ? <CheckCircle className="size-4" /> : <BookOpen className="size-4" />}
          </button>
          <button onClick={() => window.open(downloadUrl, "_blank")} aria-label="下载文件" className="rounded-lg bg-secondary p-2 text-muted-foreground hover:text-foreground" title="下载"><Download className="size-4" /></button>
          <button onClick={onEdit} aria-label="编辑档案信息" className="rounded-lg bg-secondary p-2 text-muted-foreground hover:text-eco-600 hover:bg-eco-50" title="编辑"><Pencil className="size-4" /></button>
          <button onClick={onDelete} aria-label="删除文件" className="rounded-lg bg-secondary p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10" title="删除"><Trash2 className="size-4" /></button>
          <button onClick={() => setShowAI(!showAI)} aria-label="AI分析" className={cn("rounded-lg p-2", showAI ? "bg-eco-50 text-eco-600" : "bg-secondary text-muted-foreground hover:text-foreground")} title="AI 分析"><Sparkles className="size-4" /></button>
          <button onClick={onClose} aria-label="关闭详情" className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground" title="关闭"><PanelRightClose className="size-4" /></button>
        </div>
      </div>

      {/* 描述栏 */}
      {file.desc && (
        <div className="px-4 py-1.5 border-b border-border bg-secondary/20 shrink-0">
          <span className="text-caption text-muted-foreground">备注：</span>
          <span className="text-caption text-foreground/80">{file.desc}</span>
        </div>
      )}

      {/* 内容区：预览 + AI（可折叠） */}
      <div className="flex-1 flex overflow-hidden">
        {/* 预览区 */}
        <div className={cn("flex-1 overflow-hidden bg-canvas", showAI && "border-r border-border")}>
          {isPdf && <iframe src={fileUrl} title={file.original_name} className="w-full h-full border-0" />}
          {isImage && (
            <div className="w-full h-full overflow-auto flex items-center justify-center p-4">
              <img src={fileUrl} alt={file.original_name} className="max-w-full max-h-full object-contain rounded-lg shadow-sm" />
            </div>
          )}
          {isText && (
            <div className="w-full h-full overflow-auto">
              {textError ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                  <AlertTriangle className="size-6 text-warning" />
                  <p className="text-caption">{textError}</p>
                </div>
              ) : textContent === null ? (
                <div className="flex items-center justify-center h-full text-muted-foreground"><Loader2 className="size-5 animate-spin mr-2" />加载中...</div>
              ) : (
                <pre className="p-5 text-body text-foreground/90 font-mono whitespace-pre-wrap break-words leading-relaxed">{textContent}</pre>
              )}
            </div>
          )}
          {(isOffice || isArchive || (!isPdf && !isImage && !isText)) && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-secondary">
                <FileIcon ext={ext} className="size-7" />
              </div>
              <div className="text-center">
                <p className="text-body font-medium text-foreground">此文件类型不支持在线预览</p>
                <p className="text-caption mt-1">{ext.toUpperCase()} 文件 · 请下载后用对应软件打开</p>
              </div>
              <button onClick={() => window.open(downloadUrl, "_blank")} className="flex items-center gap-1.5 rounded-lg bg-eco-600 px-4 py-2 text-body text-eco-50 hover:bg-eco-700">
                <Download className="size-4" />下载文件
              </button>
            </div>
          )}
        </div>

        {/* AI 分析面板 */}
        {showAI && (
          <AIAnalysisPanel fileId={file.id} fileExt={ext} analyzedIds={analyzedIds} onAnalyzed={onAnalyzed} />
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════
 * AI 分析面板（右栏右侧）
 * ═══════════════════════════════════════════════════════ */

const QUICK_QUESTIONS = [
  "合规要点分析",
  "关键条款提取",
  "风险提示",
  "有效期与续期",
]

function AIAnalysisPanel({ fileId, fileExt, analyzedIds, onAnalyzed }: {
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
              {QUICK_QUESTIONS.map(q => (
                <button key={q} onClick={() => analyze(q)} disabled={analyzing} className="rounded-full border border-border bg-card px-2.5 py-1 text-caption text-foreground/80 hover:border-eco-300 hover:text-eco-700 disabled:opacity-40">
                  {q}
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

function UploadModal({ target, categories, onClose, onDone }: {
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
    fd.append("file", selectedFile); fd.append("category", category); fd.append("code", code); fd.append("desc", desc); fd.append("tpl_id", target.tpl_id)
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
function AutoClassifyModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
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
