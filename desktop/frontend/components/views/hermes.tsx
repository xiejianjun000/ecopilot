"use client"
import { useEffect, useState, useCallback } from "react"
import {
  Cpu, RefreshCw, Play, Pause, Trash2, Sparkles, BookOpen,
  BarChart3, Network, ChevronRight, ChevronDown, Search,
  Check, X, AlertTriangle, Wrench, Clock, Layers, Activity,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  getCuratorStatus, triggerCuratorRun, curatorPause, curatorResume, curatorPrune,
  getSkills, searchSkills, installSkill, uninstallSkill,
  getJourney, getJourneyStats,
  getInsights, getHermesHealth,
  type CuratorStatus, type HermesSkill, type JourneyStats,
} from "@/lib/hermes-client"

/* ═══════════════════════════════════════════════════════
 * Hermes 管理视图 — 全部 Agent 能力
 *
 * 功能区:
 *   1. Curator 面板（技能管家/进化）
 *   2. 技能管理（浏览/安装/卸载）
 *   3. 学习旅程（记忆图谱）
 *   4. 系统状态
 * ═══════════════════════════════════════════════════════ */

export function HermesView() {
  const [tab, setTab] = useState<"curator" | "skills" | "journey" | "status">("curator")

  const tabs = [
    { id: "curator" as const, label: "技能管家", icon: Cpu },
    { id: "skills" as const, label: "技能管理", icon: BookOpen },
    { id: "journey" as const, label: "学习旅程", icon: Network },
    { id: "status" as const, label: "系统状态", icon: Activity },
  ]

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">🤖 EcoPilot AI 引擎</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Hermes 驱动 · 自学习 · 技能进化 · 记忆管理
          </p>
        </div>
      </div>

      {/* Tab 导航 */}
      <div className="flex gap-1 border-b border-border px-6">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors",
              tab === t.id
                ? "border-eco-600 text-eco-600"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <t.icon className="size-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === "curator" && <CuratorPanel />}
        {tab === "skills" && <SkillsPanel />}
        {tab === "journey" && <JourneyPanel />}
        {tab === "status" && <StatusPanel />}
      </div>
    </div>
  )
}

/* ═══════════════ Curator 面板 ═══════════════ */

function CuratorPanel() {
  const [status, setStatus] = useState<CuratorStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionMsg, setActionMsg] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    const data = await getCuratorStatus()
    setStatus(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const doAction = async (action: () => Promise<any>, msg: string) => {
    setActionMsg(msg)
    await action()
    await load()
    setTimeout(() => setActionMsg(""), 3000)
  }

  if (loading) return <div className="text-sm text-muted-foreground p-4">加载中...</div>
  if (!status) return <div className="text-sm text-muted-foreground p-4">Hermes 未连接</div>
  if (!status.enabled) return <div className="text-sm text-warning p-4">Curator 已禁用</div>

  return (
    <div className="space-y-6 max-w-2xl">
      {/* 状态概览卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="总技能数" value={status.agent_skills_total ?? "-"} icon={Layers} />
        <StatCard label="活跃" value={status.agent_skills_active ?? "-"} icon={Activity} color="text-success" />
        <StatCard label="待清理" value={status.agent_skills_stale ?? "-"} icon={AlertTriangle} color="text-warning" />
        <StatCard label="已归档" value={status.agent_skills_archived ?? "-"} icon={Trash2} color="text-muted-foreground" />
      </div>

      {/* Curator 配置 */}
      <Card>
        <h3 className="text-sm font-semibold text-foreground mb-3">Curator 配置</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div><span className="text-muted-foreground">运行次数：</span>{status.runs}</div>
          <div><span className="text-muted-foreground">上次运行：</span>{status.last_run}</div>
          <div><span className="text-muted-foreground">检查间隔：</span>{status.interval}</div>
          <div><span className="text-muted-foreground">闲置清理：</span>{status.stale_after}</div>
        </div>
      </Card>

      {/* 操作按钮 */}
      <Card>
        <h3 className="text-sm font-semibold text-foreground mb-3">操作</h3>
        <div className="flex flex-wrap gap-2">
          <ActionBtn icon={Play} label="运行 Curator" onClick={() => doAction(triggerCuratorRun, "Curator 已触发")} color="bg-eco-600 hover:bg-eco-700" />
          <ActionBtn icon={Pause} label="暂停" onClick={() => doAction(curatorPause, "Curator 已暂停")} color="bg-warning hover:bg-warning/80" />
          <ActionBtn icon={RefreshCw} label="恢复" onClick={() => doAction(curatorResume, "Curator 已恢复")} color="bg-info hover:bg-info/80" />
          <ActionBtn icon={Trash2} label="清理 90d" onClick={() => doAction(() => curatorPrune(90), "清理完成")} color="bg-destructive hover:bg-destructive/80" />
        </div>
        {actionMsg && <p className="mt-2 text-sm text-eco-600">{actionMsg}</p>}
      </Card>

      {/* 最活跃技能 */}
      {status.most_active && status.most_active.length > 0 && (
        <Card>
          <h3 className="text-sm font-semibold text-foreground mb-3">🔥 最活跃技能</h3>
          <div className="space-y-1.5">
            {status.most_active.slice(0, 5).map(s => (
              <div key={s.name} className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{s.name}</span>
                <span className="text-muted-foreground">
                  {s.activity ? `${s.activity} 次` : ""}
                  {s.last_activity ? ` · ${s.last_activity}` : ""}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

/* ═══════════════ 技能管理面板 ═══════════════ */

function SkillsPanel() {
  const [skills, setSkills] = useState<HermesSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQ, setSearchQ] = useState("")
  const [filter, setFilter] = useState("all")
  const [message, setMessage] = useState("")

  const loadSkills = useCallback(async () => {
    setLoading(true)
    const data = await getSkills("all")
    setSkills(data?.skills ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { loadSkills() }, [loadSkills])

  // 分类统计
  const categories = skills.reduce((acc, s) => {
    const cat = s.category || "uncategorized"
    if (!acc[cat]) acc[cat] = 0
    acc[cat]++
    return acc
  }, {} as Record<string, number>)

  // 过滤
  const filtered = searchQ.trim()
    ? skills.filter(s => s.name.toLowerCase().includes(searchQ.toLowerCase()))
    : filter === "all" ? skills
    : skills.filter(s => s.category === filter)

  const doInstall = async (name: string) => {
    setMessage(`安装 ${name}...`)
    const result = await installSkill(name)
    setMessage(result?.installed ? `✅ ${name} 已安装` : `❌ ${name} 安装失败`)
    setTimeout(() => setMessage(""), 3000)
  }

  const doUninstall = async (name: string) => {
    setMessage(`卸载 ${name}...`)
    const result = await uninstallSkill(name)
    setMessage(result?.uninstalled ? `✅ ${name} 已卸载` : `❌ ${name} 卸载失败`)
    setTimeout(() => setMessage(""), 3000)
    await loadSkills()
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {/* 搜索 + 统计 */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            placeholder="搜索技能..."
            className="w-full rounded-lg border border-border bg-card pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-eco-400"
          />
        </div>
        <span className="text-sm text-muted-foreground">{skills.length} 技能已安装</span>
      </div>

      {/* 分类过滤 */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setFilter("all")}
          className={cn("px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
            filter === "all" ? "bg-eco-100 text-eco-700" : "bg-secondary text-muted-foreground hover:text-foreground")}
        >
          全部 ({skills.length})
        </button>
        {Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([cat, count]) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={cn("px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
              filter === cat ? "bg-eco-100 text-eco-700" : "bg-secondary text-muted-foreground hover:text-foreground")}
          >
            {cat} ({count})
          </button>
        ))}
      </div>

      {/* 消息提示 */}
      {message && <p className="text-sm text-eco-600">{message}</p>}

      {/* 技能列表 */}
      {loading ? (
        <div className="text-sm text-muted-foreground">加载中...</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">无匹配技能</div>
      ) : (
        <div className="space-y-1">
          {filtered.map(s => (
            <div key={s.name} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 hover:border-eco-300 transition-colors">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{s.name}</span>
                  <span className={cn(
                    "px-1.5 py-0.5 rounded text-xs font-mono",
                    s.status === "enabled" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                  )}>{s.status}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {s.category} · {s.source} · {s.trust}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {s.source !== "builtin" && (
                  <button
                    onClick={() => doUninstall(s.name)}
                    className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="卸载"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ═══════════════ 学习旅程面板 ═══════════════ */

function JourneyPanel() {
  const [stats, setStats] = useState<JourneyStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getJourneyStats().then(d => { setStats(d); setLoading(false) })
  }, [])

  if (loading) return <div className="text-sm text-muted-foreground p-4">加载中...</div>
  if (!stats) return <div className="text-sm text-muted-foreground p-4">暂无学习数据</div>

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="学习节点" value={stats.total_nodes} icon={Network} />
        <StatCard label="关联边" value={stats.total_edges} icon={Layers} />
        <StatCard label="技能分类" value={Object.keys(stats.categories).length} icon={BookOpen} />
      </div>

      {/* 技能状态分布 */}
      <Card>
        <h3 className="text-sm font-semibold text-foreground mb-3">节点状态</h3>
        <div className="space-y-2">
          {Object.entries(stats.states).map(([state, count]) => (
            <div key={state} className="flex items-center gap-3">
              <span className={cn(
                "text-sm w-16",
                state === "active" ? "text-success" : state === "stale" ? "text-warning" : "text-muted-foreground"
              )}>{state}</span>
              <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    state === "active" ? "bg-success" : state === "stale" ? "bg-warning" : "bg-muted-foreground"
                  )}
                  style={{ width: `${(count / stats.total_nodes) * 100}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground w-8 text-right">{count}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* 分类分布 */}
      <Card>
        <h3 className="text-sm font-semibold text-foreground mb-3">知识点分类</h3>
        <div className="space-y-1.5 max-h-60 overflow-y-auto">
          {Object.entries(stats.categories)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, count]) => (
              <div key={cat} className="flex items-center justify-between text-sm">
                <span className="text-foreground">{cat}</span>
                <span className="text-muted-foreground">{count} 节点</span>
              </div>
            ))}
        </div>
      </Card>
    </div>
  )
}

/* ═══════════════ 系统状态面板 ═══════════════ */

function StatusPanel() {
  const [health, setHealth] = useState<any>(null)
  const [insights, setInsights] = useState<any>(null)

  useEffect(() => {
    getHermesHealth().then(setHealth)
    getInsights().then(setInsights)
  }, [])

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <h3 className="text-sm font-semibold text-foreground mb-3">Hermes 连接状态</h3>
        {health ? (
          <div className="space-y-1 text-sm">
            <div className="flex items-center gap-2">
              <span className={cn("size-2 rounded-full", health.connected ? "bg-success" : "bg-destructive")} />
              <span>{health.connected ? "已连接" : "未连接"}</span>
            </div>
            {health.version && <p className="text-muted-foreground mt-2">{health.version}</p>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">获取中...</p>
        )}
      </Card>

      {insights && Object.keys(insights).length > 0 && (
        <Card>
          <h3 className="text-sm font-semibold text-foreground mb-3">用量概览</h3>
          <div className="space-y-2 text-sm">
            {Object.entries(insights).map(([key, val]) => (
              <div key={key} className="flex items-start gap-2">
                <span className="text-muted-foreground min-w-[100px]">{key}:</span>
                <span className="text-foreground">{typeof val === 'object' ? JSON.stringify(val).slice(0, 100) : String(val)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

/* ═══════════════ 通用组件 ═══════════════ */

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: any; color?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <Icon className="size-4" />
        <span className="text-xs">{label}</span>
      </div>
      <p className={cn("text-xl font-semibold", color || "text-foreground")}>{value}</p>
    </div>
  )
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-4", className)}>
      {children}
    </div>
  )
}

function ActionBtn({ icon: Icon, label, onClick, color }: { icon: any; label: string; onClick: () => void; color: string }) {
  return (
    <button
      onClick={onClick}
      className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-all", color)}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )
}
