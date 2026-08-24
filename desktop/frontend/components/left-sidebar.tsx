"use client"
import { useState, useEffect, useMemo, useRef } from "react"
import { PlusCircle, ShieldCheck, Calendar, ExternalLink, FolderClosed, BookOpen, Plug, Settings, ChevronDown, ChevronRight, MoreHorizontal, Pencil, Trash2, Search, PanelLeft, MessageSquare, Bell, Compass, ClipboardCheck, X, Check, Zap, Crown, ChevronUp, Send, Sun, Moon, Monitor, RefreshCw, LogOut, Palette, Building2, FolderOpen, FileText, FolderPlus } from "lucide-react"
import { cn } from "@/lib/utils"
import { useApp } from "@/lib/store"
import { apiGet, fetchApprovals } from "@/lib/api"
import type { Conversation, ActiveNav, ActiveView } from "@/lib/types"

const NAV: { icon: typeof PlusCircle; label: string; nav: ActiveNav | ActiveView; newConv?: boolean }[] = [
  { icon: PlusCircle, label: "新建对话", nav: "chat", newConv: true },
  { icon: BookOpen, label: "知识库", nav: "knowledge" },
  { icon: Building2, label: "行业合规", nav: "industry_compliance" },
  { icon: Calendar, label: "合规日历", nav: "calendar" },
  { icon: ClipboardCheck, label: "交办整改", nav: "inspection" },
  { icon: Zap, label: "自动任务", nav: "tasks" },
  { icon: FolderClosed, label: "档案库", nav: "vault" },
  // 「设置」「通讯中心」「连接器」已迁移至底部头像菜单 — 均为配置/运维类低频模块，避免与左侧核心合规模块混杂
]

/** 按真实时间戳分组会话（now 由调用方传入，避免 SSR/客户端时间不一致导致 hydration 不匹配） */
function getTimeGroup(conv: Conversation, now: Date): "today" | "yesterday" | "older" {
  const ts = new Date(conv.timestamp || conv.time)
  if (isNaN(ts.getTime())) return "older"
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  if (ts >= today) return "today"
  if (ts >= yesterday) return "yesterday"
  return "older"
}

const GROUP_LABELS: { key: "today" | "yesterday" | "older"; label: string }[] = [
  { key: "today", label: "今日" },
  { key: "yesterday", label: "昨日" },
  { key: "older", label: "更早" },
]

/** 会话列表项 — 共享渲染逻辑（会话 tab 和空间 tab 共用） */
function ConvItem({ conv, editingId, editTitle, setEditingId, setEditTitle, commitEdit, setMenuOpen, startEdit, menuOpen, confirmDelete, setConfirmDelete, dispatch, handleDelete }: {
  conv: Conversation
  editingId: string | null
  editTitle: string
  setEditingId: (id: string | null) => void
  setEditTitle: (t: string) => void
  commitEdit: () => void
  setMenuOpen: (id: string | null) => void
  startEdit: (c: Conversation) => void
  menuOpen: string | null
  confirmDelete: string | null
  setConfirmDelete: (id: string | null) => void
  dispatch: any
  handleDelete: (id: string) => void
}) {
  return (
    <li className="group relative">
      {editingId === conv.id ? (
        <div className="flex items-center gap-1.5 rounded-xl bg-eco-50 px-2.5 py-2">
          <input
            autoFocus
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") commitEdit()
              if (e.key === "Escape") { setEditingId(null); setEditTitle("") }
            }}
            className="min-w-0 flex-1 rounded border border-eco-300 bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-eco-400"
          />
          <button onClick={commitEdit} className="rounded p-1 text-eco-600 hover:bg-eco-100" aria-label="确认"><Check className="size-3.5" /></button>
          <button onClick={() => { setEditingId(null); setEditTitle("") }} className="rounded p-1 text-muted-foreground hover:bg-accent" aria-label="取消"><X className="size-3.5" /></button>
        </div>
      ) : (
        <>
          <button onClick={() => { dispatch({ type:"SET_CONVERSATION_ACTIVE", id:conv.id }); dispatch({ type:"SET_NAV", nav:"chat" }) }}
            className={cn("flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left",
              conv.active ? "bg-eco-50" : "hover:bg-accent/60")}>
            <span className="relative shrink-0">
              <div className="flex size-7 items-center justify-center rounded-full bg-eco-100 text-xs font-semibold text-eco-700">{conv.title.charAt(0)}</div>
              {conv.unread && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-destructive ring-2 ring-sidebar" />}
            </span>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-title text-foreground/90">{conv.title}</span>
              <span className="text-caption text-muted-foreground">{conv.time}</span>
            </div>
          </button>
          <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen===conv.id ? null : conv.id) }}
              className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="更多操作"><MoreHorizontal className="size-4" /></button>
            {menuOpen===conv.id && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(null)} />
                <div className="absolute right-0 top-full z-50 mt-1 min-w-[120px] rounded-xl border border-border bg-popover p-1 shadow-popover">
                  <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-body hover:bg-accent"
                    onClick={e => { e.stopPropagation(); startEdit(conv) }}>
                    <Pencil className="size-3.5" />编辑名称
                  </button>
                  <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-body text-destructive hover:bg-destructive/10"
                    onClick={e => { e.stopPropagation(); setConfirmDelete(conv.id) }}>
                    <Trash2 className="size-3.5" />删除
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* 删除确认弹窗 */}
      {confirmDelete === conv.id && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/40" onClick={() => setConfirmDelete(null)}>
          <div className="rounded-2xl bg-card p-5 shadow-modal max-w-xs mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                <Trash2 className="size-4.5 text-destructive" />
              </div>
              <div className="min-w-0">
                <h3 className="text-body font-semibold text-foreground">删除会话？</h3>
                <p className="mt-1 text-xs text-muted-foreground">「{conv.title}」将被永久删除，无法恢复。</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-accent">取消</button>
              <button onClick={() => handleDelete(conv.id)} className="rounded-lg bg-destructive px-3 py-1.5 text-xs text-white hover:bg-destructive/90">确认删除</button>
            </div>
          </div>
        </div>
      )}
    </li>
  )
}

export function LeftSidebar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { state, dispatch } = useApp()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ yesterday: true, older: true })
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [userName, setUserName] = useState("")
  const [userRole, setUserRole] = useState("环保专员")
  const [enterpriseName, setEnterpriseName] = useState("")
  const [licensePlan, setLicensePlan] = useState("")
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [approvalCount, setApprovalCount] = useState(0)
  const userMenuRef = useRef<HTMLDivElement>(null)
  // now 在 mount 后设置，避免 SSR/客户端时间不一致导致 hydration 不匹配
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => { setNow(new Date()) }, [])

  // 侧边栏 tab：会话 / 空间
  const [sidebarTab, setSidebarTab] = useState<"conversations" | "workspaces">("conversations")

  useEffect(() => {
    apiGet<{ name?: string; role?: string }>('/api/user').then(r => {
      if (r.ok && r.data) {
        if (r.data.name) setUserName(r.data.name)
        if (r.data.role) setUserRole(r.data.role)
      }
    }).catch(() => {})
    // 企业名（用户菜单展示）与订阅档位徽章，全部来自后端真实数据
    apiGet<{ name?: string }>('/api/enterprise').then(r => {
      if (r.ok && r.data?.name) setEnterpriseName(r.data.name)
    }).catch(() => {})
    apiGet<{ valid?: boolean; customer?: string; days_left?: number }>('/api/license/status').then(r => {
      if (r.ok && r.data) setLicensePlan(r.data.valid ? (r.data.customer || "已授权") : "未授权")
    }).catch(() => {})
  }, [])

  // 轮询待审批写操作数量（审批闸门入口 badge）
  useEffect(() => {
    let alive = true
    const poll = () => {
      fetchApprovals(true)
        .then(list => { if (alive) setApprovalCount(list.length) })
        .catch(() => {})
    }
    poll()
    const timer = setInterval(poll, 15000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  // 点击外部关闭用户菜单
  useEffect(() => {
    if (!userMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [userMenuOpen])

  // 搜索过滤
  const filteredConvs = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return state.conversations
    return state.conversations.filter(c =>
      c.title.toLowerCase().includes(q) ||
      c.lastMessage.toLowerCase().includes(q) ||
      c.messages.some(m => m.content.toLowerCase().includes(q))
    )
  }, [state.conversations, search])

  // 分组（now 为 null 时全部归入 older，确保 SSR/客户端一致）
  const grouped = useMemo(() => {
    const g: Record<string, Conversation[]> = { today: [], yesterday: [], older: [] }
    if (!now) {
      g.older = [...filteredConvs]
    } else {
      filteredConvs.forEach(c => {
        const group = getTimeGroup(c, now)
        g[group].push(c)
      })
    }
    return g
  }, [filteredConvs, now])

  // 工作空间分组：按 workspace folder 分组会话
  const workspaceConvs = useMemo(() => {
    const folders = state.workspaceFolders
    return folders.map(f => ({
      folder: f,
      conversations: state.conversations.filter(c => c.workspaceId === f.id),
    }))
  }, [state.workspaceFolders, state.conversations])

  // 未绑定空间的会话
  const unboundConvs = useMemo(() =>
    state.conversations.filter(c => !c.workspaceId),
  [state.conversations])

  const startEdit = (c: Conversation) => {
    setEditingId(c.id)
    setEditTitle(c.title)
    setMenuOpen(null)
  }

  const commitEdit = () => {
    if (editingId && editTitle.trim()) {
      dispatch({ type: "SET_CONVERSATION_TITLE", id: editingId, title: editTitle.trim() })
    }
    setEditingId(null)
    setEditTitle("")
  }

  const handleDelete = (id: string) => {
    dispatch({ type: "DELETE_CONVERSATION", id })
    setConfirmDelete(null)
    setMenuOpen(null)
  }

  return (
    <aside className={cn(
      "z-50 flex h-full shrink-0 flex-col bg-sidebar",
      "fixed inset-y-0 left-0 w-full transition-transform duration-300 ease-in-out",
      open ? "translate-x-0" : "-translate-x-full",
      "md:static md:translate-x-0 md:overflow-hidden md:transition-[width] md:duration-300",
      open ? "md:w-full" : "md:w-0"
    )}>
      {/* Logo + controls */}
      <div className="flex items-center justify-between px-5 pt-5 pb-2">
        <div className="flex items-center gap-2.5">
          <img src="/eco-logo.svg" alt="EcoPilot" className="h-8 w-auto object-contain" />
        </div>
        <div className="flex items-center gap-0.5 text-muted-foreground">
          <button onClick={onToggle} className="rounded-lg p-1.5 hover:bg-accent" aria-label="收起侧栏"><PanelLeft className="size-[18px]" /></button>
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex flex-col gap-0.5 px-3 py-3">
        {NAV.map(({ icon: Icon, label, nav, newConv }) => (
          <button key={label} onClick={() => { if (newConv) dispatch({ type:"NEW_CONVERSATION" }); dispatch({ type:"SET_NAV", nav: nav }) }}
            className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-body hover:bg-accent active:scale-[0.98] transition-all duration-150",
              state.activeNav===nav && "bg-eco-50 text-eco-700 font-medium")}>
            <Icon className="size-[18px] text-muted-foreground" strokeWidth={1.75} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {/* 会话搜索 */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索会话..."
            className="w-full rounded-lg border border-border bg-card pl-8 pr-7 py-1.5 text-caption text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-eco-300"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="清除搜索">
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      {/* Tab 切换：会话 / 空间 */}
      <div className="px-3 pt-1 pb-2">
        <div className="flex rounded-lg bg-muted/50 p-0.5">
          <button
            onClick={() => setSidebarTab("conversations")}
            className={cn(
              "flex-1 rounded-md py-1.5 text-caption font-medium transition-colors",
              sidebarTab === "conversations" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            会话
          </button>
          <button
            onClick={() => setSidebarTab("workspaces")}
            className={cn(
              "flex-1 rounded-md py-1.5 text-caption font-medium transition-colors",
              sidebarTab === "workspaces" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            空间
          </button>
        </div>
      </div>

      {/* Content: 会话 or 空间 */}
      <div className="flex-1 overflow-y-auto">
        {sidebarTab === "conversations" ? (
          /* ─── 会话 tab：时间分组 ─── */
          filteredConvs.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-muted-foreground">
              {search ? "未找到匹配的会话" : "暂无会话，点击「新建对话」开始"}
            </div>
          ) : (
            GROUP_LABELS.map(g => {
              const items = grouped[g.key]
              if (items.length === 0) return null
              const isCollapsed = collapsed[g.key]
              return (
                <div key={g.key}>
                  <button onClick={() => setCollapsed(p => ({ ...p, [g.key]: !p[g.key] }))}
                    className="flex w-full items-center gap-1.5 px-5 pt-4 pb-2 text-xs font-medium text-muted-foreground hover:text-foreground">
                    {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                    {g.label}
                    <span className="text-muted-foreground/60 tabular-nums">({items.length})</span>
                  </button>
                  {!isCollapsed && (
                    <ul className="flex flex-col gap-0.5 px-3 pb-1">
                      {items.map(c => (
                        <ConvItem key={c.id} conv={c} editingId={editingId} editTitle={editTitle}
                          setEditingId={setEditingId} setEditTitle={setEditTitle} commitEdit={commitEdit}
                          setMenuOpen={setMenuOpen} startEdit={startEdit}
                          menuOpen={menuOpen} confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete}
                          dispatch={dispatch} handleDelete={handleDelete}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              )
            })
          )
        ) : (
          /* ─── 空间 tab：workspace 分组 ─── */
          state.workspaceFolders.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-xl bg-muted/60">
                <FolderOpen className="size-5 text-muted-foreground" />
              </div>
              <p className="text-caption text-muted-foreground mb-3">选择本地文件夹，EcoPilot 将在该目录下读写合规档案</p>
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("ecopilot:ws-pick"))}
                className="inline-flex items-center gap-1.5 rounded-lg bg-eco-600 px-4 py-2 text-caption font-medium text-white hover:bg-eco-700 transition-colors"
              >
                <FolderPlus className="size-3.5" />
                选择文件夹...
              </button>
              <p className="mt-2 text-caption text-muted-foreground/60">或 Ctrl+K 搜索"工作空间"快捷添加</p>
            </div>
          ) : (
            <div className="space-y-1 px-2 py-1">
              {/* 顶部添加按钮 */}
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("ecopilot:ws-pick"))}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-caption text-eco-600 hover:bg-eco-50/60 transition-colors mb-1"
              >
                <FolderPlus className="size-3.5" />
                添加文件夹...
              </button>

              {workspaceConvs.map(({ folder, conversations: fconvs }) => (
                <div key={folder.id}>
                  <button
                    onClick={() => dispatch({ type: "SET_ACTIVE_WORKSPACE", id: folder.id })}
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent/60 transition-colors",
                      state.activeWorkspaceId === folder.id && "bg-eco-50 ring-1 ring-eco-200"
                    )}
                  >
                    <div className="flex items-center gap-2 w-full">
                      <FolderOpen className={cn("size-3.5 shrink-0", state.activeWorkspaceId === folder.id ? "text-eco-600" : "text-muted-foreground")} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-caption font-medium text-foreground">{folder.name}</p>
                          {state.activeWorkspaceId === folder.id && (
                            <span className="shrink-0 rounded-full bg-eco-600 px-1.5 py-px text-caption font-medium text-white">当前</span>
                          )}
                        </div>
                        <p className="truncate text-caption text-muted-foreground/60" title={folder.path}>{folder.path}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-caption text-muted-foreground tabular-nums">{folder.entries.length}</span>
                        {fconvs.length > 0 && (
                          <span className="rounded-full bg-eco-100 px-1.5 py-px text-caption font-medium text-eco-700 tabular-nums">{fconvs.length}</span>
                        )}
                      </div>
                    </div>
                    {/* 权限说明 */}
                    <div className="flex items-center gap-1 pl-5.5">
                      <ShieldCheck className="size-2.5 text-success" />
                      <span className="text-caption text-success">可读写此目录下的文件</span>
                    </div>
                  </button>
                  {fconvs.length > 0 && (
                    <ul className="ml-2 mt-0.5 border-l border-border/60 pl-3 space-y-0.5">
                      {fconvs.map(c => (
                        <ConvItem key={c.id} conv={c} editingId={editingId} editTitle={editTitle}
                          setEditingId={setEditingId} setEditTitle={setEditTitle} commitEdit={commitEdit}
                          setMenuOpen={setMenuOpen} startEdit={startEdit}
                          menuOpen={menuOpen} confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete}
                          dispatch={dispatch} handleDelete={handleDelete}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              {/* 未绑定空间的会话 */}
              {unboundConvs.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-caption font-medium text-muted-foreground">未绑定空间</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">{unboundConvs.length}</span>
                  </div>
                  <ul className="ml-4 mt-0.5 border-l border-border/60 pl-3 space-y-0.5">
                    {unboundConvs.map(c => (
                      <ConvItem key={c.id} conv={c} editingId={editingId} editTitle={editTitle}
                        setEditingId={setEditingId} setEditTitle={setEditTitle} commitEdit={commitEdit}
                        setMenuOpen={setMenuOpen} startEdit={startEdit}
                        menuOpen={menuOpen} confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete}
                        dispatch={dispatch} handleDelete={handleDelete}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )
        )}
      </div>

      {/* ═══ Footer — 对标 QClaw：左 user-trigger + 右 消息中心图标 ═══ */}
      <div className="shrink-0 border-t border-border/80 px-2.5 py-2 pb-2.5 mt-auto">
        <div ref={userMenuRef} className="relative flex items-center justify-between gap-2">
          {/* 左侧：用户触发器 */}
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            aria-label={`用户菜单：${userName || "未设置"}${userName ? ` · ${userRole}` : ""}`}
            aria-expanded={userMenuOpen}
            className={cn(
              "group flex items-center gap-2 rounded-lg px-1.5 py-1 min-h-[36px] transition-all duration-150 outline-none",
              "hover:bg-accent/60 active:scale-[0.99]",
              "focus-visible:ring-2 focus-visible:ring-eco-500/40",
              userMenuOpen && "bg-accent/60"
            )}
          >
            {/* 头像 */}
            <div className="relative shrink-0">
              <div className="flex size-6 items-center justify-center rounded-full bg-muted text-caption font-semibold text-foreground ring-1 ring-inset ring-border group-hover:ring-border/80 transition-all">
                {userName ? userName.charAt(0).toUpperCase() : "E"}
              </div>
            </div>
            {/* 用户名 */}
            <span className="truncate text-xs font-medium text-foreground max-w-[100px]">
              {userName || "未设置"}
            </span>
            {/* 订阅徽章 */}
            <span className="shrink-0 inline-flex items-center rounded-full border border-amber-200/60 bg-amber-50/50 px-1.5 py-px text-caption font-medium text-amber-700 leading-none">
              <Crown className="size-2 mr-0.5" strokeWidth={2.5} />
              {licensePlan || "…"}
            </span>
          </button>

          {/* 右侧：消息中心图标按钮 */}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("ecopilot:notifications"))}
            aria-label="消息中心"
            className="relative rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Bell className="size-4" strokeWidth={1.75} />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[14px] h-[14px] items-center justify-center rounded-full bg-destructive px-0.5 text-caption font-bold text-white">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {/* 审批中心入口（写操作 human-in-the-loop 闸门） */}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("ecopilot:approvals"))}
            aria-label="审批中心"
            title="审批中心"
            className="relative rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <ShieldCheck className="size-4" strokeWidth={1.75} />
            {approvalCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[14px] h-[14px] items-center justify-center rounded-full bg-warning px-0.5 text-caption font-bold text-white">
                {approvalCount > 9 ? "9+" : approvalCount}
              </span>
            )}
          </button>

          {/* ─── Popover — 向上弹出 ─── */}
          {userMenuOpen && (
            <div className="absolute bottom-[calc(100%+6px)] left-0 right-0 z-50 w-[240px] origin-bottom-left">
              {/* 卡片主体 */}
              <div className="overflow-hidden rounded-2xl border border-border/60 bg-popover/95 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.18),0_2px_8px_-4px_rgba(0,0,0,0.08)] backdrop-blur-xl animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-3 duration-200">

                {/* 头部 — 用户名 */}
                <div className="px-3.5 py-3 border-b border-border/40">
                  <div className="truncate text-body font-semibold text-foreground leading-tight">
                    {userName || "未设置"}
                  </div>
                  <div className="truncate text-caption text-muted-foreground mt-0.5 leading-tight">
                    {userRole}{enterpriseName ? ` · ${enterpriseName}` : ""}
                  </div>
                </div>

                {/* 订阅 CTA */}
                <div className="px-2 py-2">
                  <button
                    onClick={() => { setUserMenuOpen(false); window.dispatchEvent(new CustomEvent("ecopilot:open-settings")) }}
                    className="group flex w-full items-center gap-2.5 rounded-lg border border-amber-200/50 bg-amber-50/40 px-2.5 py-2 text-left transition-all hover:bg-amber-50/70 hover:border-amber-200 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
                  >
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700">
                      <Crown className="size-3.5" strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-amber-900 leading-tight">订阅方案</div>
                      <div className="text-caption text-amber-700/70 mt-0.5 leading-tight">授权 · 订阅 · 算力包</div>
                    </div>
                    <ChevronRight className="size-3 text-amber-600/60 group-hover:translate-x-0.5 transition-transform" strokeWidth={2} />
                  </button>
                </div>

                {/* 分组 1：设置 + 外观 */}
                <div className="px-2 pb-1 space-y-0.5">
                  <MenuButton
                    icon={Settings}
                    label="设置"
                    hint="企业信息 / 模型"
                    onClick={() => { setUserMenuOpen(false); window.dispatchEvent(new CustomEvent("ecopilot:open-settings")) }}
                  />
                  <ThemeSwitcher />
                </div>

                {/* 分组 2：连接器 + 通讯中心（低频配置/运维模块） */}
                <div className="px-2 pb-1 space-y-0.5 border-t border-border/30 pt-1">
                  <MenuButton
                    icon={Plug}
                    label="连接器"
                    hint="MCP / 模型 / 工具"
                    onClick={() => { setUserMenuOpen(false); dispatch({ type: "SET_NAV", nav: "connector" }) }}
                  />
                  <MenuButton
                    icon={Send}
                    label="通讯中心"
                    onClick={() => { setUserMenuOpen(false); dispatch({ type: "SET_NAV", nav: "notify" }) }}
                  />
                </div>

                {/* 分组 3：反馈 + 检查更新 */}
                <div className="px-2 pb-1 space-y-0.5 border-t border-border/30 pt-1">
                  <MenuButton
                    icon={MessageSquare}
                    label="意见反馈"
                    onClick={() => { setUserMenuOpen(false); window.dispatchEvent(new CustomEvent("ecopilot:feedback")) }}
                  />
                  <MenuButton
                    icon={RefreshCw}
                    label="检查更新"
                    onClick={() => { setUserMenuOpen(false); window.dispatchEvent(new CustomEvent("ecopilot:check-update")) }}
                  />
                </div>

                {/* 底部 — 退出登录 */}
                <div className="px-2 pb-1.5 border-t border-border/30 pt-1">
                  <button
                    onClick={() => {
                      setUserMenuOpen(false)
                      if (typeof window !== "undefined") {
                        localStorage.removeItem("ecopilot-onboarding-done")
                        localStorage.removeItem("ecopilot-onboarding")
                        window.location.href = "/onboarding"
                      }
                    }}
                    className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 min-h-[32px] text-left transition-all hover:bg-accent active:scale-[0.99]"
                  >
                    <LogOut className="size-3.5 shrink-0 text-muted-foreground/70 group-hover:text-destructive transition-colors" strokeWidth={1.75} />
                    <span className="text-xs text-foreground/90 group-hover:text-destructive transition-colors leading-none">退出登录</span>
                  </button>
                </div>

                {/* 版本号 */}
                <div className="flex items-center justify-between border-t border-border/40 px-3.5 py-2">
                  <span className="text-caption font-mono text-muted-foreground/50">v1.0.0</span>
                  <span className="flex items-center gap-1 text-caption text-muted-foreground/60">
                    <span className="size-1.5 rounded-full bg-success animate-pulse" />
                    服务正常
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

// ─── 外观切换子组件 — 对标 QClaw 三态主题 ───
function ThemeSwitcher() {
  const [theme, setTheme] = useState<"light" | "dark" | "system">("light")
  const [submenuOpen, setSubmenuOpen] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    const saved = localStorage.getItem("ecopilot-theme") as "light" | "dark" | "system" | null
    if (saved) setTheme(saved)
  }, [])

  const apply = (t: "light" | "dark" | "system") => {
    setTheme(t)
    if (typeof window !== "undefined") {
      localStorage.setItem("ecopilot-theme", t)
      const isDark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
      document.documentElement.classList.toggle("dark", isDark)
    }
  }

  const options: { value: "light" | "dark" | "system"; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "浅色", icon: Sun },
    { value: "dark", label: "深色", icon: Moon },
    { value: "system", label: "跟随系统", icon: Monitor },
  ]

  return (
    <div className="relative">
      <button
        onClick={() => setSubmenuOpen(!submenuOpen)}
        className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 min-h-[32px] text-left transition-all hover:bg-accent active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
      >
        <Palette className="size-3.5 shrink-0 text-muted-foreground/70 group-hover:text-foreground transition-colors" strokeWidth={1.75} />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-foreground/90 group-hover:text-foreground leading-none">外观</div>
        </div>
        <span className="text-caption text-muted-foreground/60">
          {options.find(o => o.value === theme)?.label}
        </span>
        <ChevronRight className={cn("size-3 text-muted-foreground/40 transition-all", submenuOpen && "rotate-90")} strokeWidth={2} />
      </button>
      {submenuOpen && (
        <div className="ml-6 mt-0.5 space-y-0.5">
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => { apply(opt.value); setSubmenuOpen(false) }}
              className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-all hover:bg-accent"
            >
              <opt.icon className="size-3.5 shrink-0 text-muted-foreground/70 group-hover:text-foreground transition-colors" strokeWidth={1.75} />
              <span className="text-xs text-foreground/90 group-hover:text-foreground leading-none">{opt.label}</span>
              {theme === opt.value && <Check className="size-3 text-eco-600 ml-auto" strokeWidth={2.5} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── 菜单项子组件 — 统一交互态，专业层级 ───
function MenuButton({ icon: Icon, label, hint, badge, onClick }: {
  icon: typeof Bell
  label: string
  hint?: string
  badge?: number
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 min-h-[32px] text-left transition-all hover:bg-accent active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground/70 group-hover:text-foreground transition-colors" strokeWidth={1.75} />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-foreground/90 group-hover:text-foreground leading-none">{label}</div>
        {hint && <div className="text-caption text-muted-foreground/60 mt-0.5 leading-none truncate">{hint}</div>}
      </div>
      {badge !== undefined && badge > 0 && (
        <span className="inline-flex min-w-[16px] h-[16px] items-center justify-center rounded-full bg-destructive px-1 text-caption font-bold text-white">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
      <ChevronRight className="size-3 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-all -ml-1 group-hover:ml-0" strokeWidth={2} />
    </button>
  )
}
