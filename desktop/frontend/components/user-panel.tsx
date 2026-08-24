"use client"
import { useState, useEffect } from "react"
import { X, UserRound, MessageSquare, BookOpen, BarChart3, Wrench, Database, Upload, Info, Coins, Moon, Sun, Settings, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import { useApp } from "@/lib/store"
import { apiGet, apiPost } from "@/lib/api"

interface EnterpriseInfo {
  name?: string
  credit_code?: string
  permit_number?: string
  management_level?: string
  industry?: string
  address?: string
}

type PanelTab = "profile" | "comm" | "diary" | "general" | "usage" | "skills" | "remote" | "config" | "backup" | "about" | "points"

const NAV: { key: PanelTab; label: string; icon: typeof UserRound }[] = [
  { key: "profile", label: "个人档案", icon: UserRound },
  { key: "comm", label: "沟通偏好", icon: MessageSquare },
  { key: "diary", label: "日记", icon: BookOpen },
  { key: "general", label: "通用设置", icon: Settings },
  { key: "usage", label: "用量统计", icon: BarChart3 },
  { key: "skills", label: "技能管理", icon: Wrench },
  { key: "remote", label: "远控通道", icon: ExternalLink },
  { key: "config", label: "软件配置", icon: Database },
  { key: "backup", label: "备份与迁移", icon: Upload },
  { key: "about", label: "关于我们", icon: Info },
  { key: "points", label: "积分交换", icon: Coins },
]

interface Props { open: boolean; onClose: () => void }

export function UserPanel({ open, onClose }: Props) {
  const [tab, setTab] = useState<PanelTab>("profile")
  const [nickname, setNickname] = useState("")
  const [role, setRole] = useState("环保专员")
  const [phone, setPhone] = useState("")
  const [timezone, setTimezone] = useState("Asia/Shanghai")
  const [language, setLanguage] = useState("zh-CN")
  const [diaryExpanded, setDiaryExpanded] = useState<Record<number, boolean>>({ 0: true })
  const [theme, setTheme] = useState<"light" | "dark">("light")
  // mount 后从 localStorage 同步主题（避免 SSR/客户端初始值不一致导致 hydration 不匹配）
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ecopilot_theme")
      if (saved === "dark") setTheme("dark")
    } catch (e) { console.error("[user-panel] Failed to load user:", e) }
  }, [])
  const [enterprise, setEnterprise] = useState<EnterpriseInfo | null>(null)
  const { dispatch } = useApp()

  // 应用深色模式 class + 持久化
  useEffect(() => {
    const root = document.documentElement
    if (theme === "dark") root.classList.add("dark")
    else root.classList.remove("dark")
    try { localStorage.setItem("ecopilot_theme", theme) } catch { /* quota exceeded */ }
  }, [theme])

  useEffect(() => {
    apiGet<EnterpriseInfo>("/api/enterprise").then(r => { if (r.ok && r.data) setEnterprise(r.data) }).catch(() => {})
    apiGet<{ name?: string; role?: string; phone?: string }>("/api/user").then(r => {
      const u = r.data
      if (u?.name) setNickname(u.name)
      if (u?.role) setRole(u.role)
      if (u?.phone) setPhone(u.phone)
    }).catch(() => {})
  }, [])

  // 昵称修改时防抖保存回后端
  useEffect(() => {
    if (!nickname) return
    const t = setTimeout(() => {
      apiPost("/api/user", { name: nickname, role, phone }).catch(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [nickname, role, phone])

  // Auto-close on Escape — 必须在顶层调用，不能放在条件块内
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose, open])

  if (!open) return null

  const goSettings = () => { dispatch({ type: "SET_NAV", nav: "settings" }); onClose() }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{background:"rgba(0,0,0,0.1)"}} onClick={onClose}>
      <div className="flex w-[720px] h-[560px] rounded-2xl border border-border bg-card shadow-modal overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
        {/* Left nav - 140px */}
        <nav className="w-[140px] shrink-0 border-r border-border bg-secondary/40 p-2 flex flex-col gap-0.5">
          {NAV.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-body transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                tab === key ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-accent")}>
              <Icon className="size-4" strokeWidth={1.75} />
              {label}
            </button>
          ))}
          <div className="mt-auto pt-2 border-t border-border flex flex-col gap-0.5">
            <button onClick={() => setTheme(t => t === "light" ? "dark" : "light")} className="flex items-center gap-2 rounded-lg px-3 py-2 text-body text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
              {theme === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
              {theme === "light" ? "深色模式" : "浅色模式"}
            </button>
          </div>
        </nav>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h2 className="text-title font-semibold text-foreground">{NAV.find(n => n.key === tab)?.label}</h2>
            <button onClick={onClose} aria-label="关闭" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"><X className="size-5" /></button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {tab === "profile" && <ProfileContent nickname={nickname} setNickname={setNickname} role={role} setRole={setRole} timezone={timezone} setTimezone={setTimezone} language={language} setLanguage={setLanguage} goSettings={goSettings} enterprise={enterprise} />}
            {tab === "comm" && <CommContent />}
            {tab === "diary" && <DiaryContent diaryExpanded={diaryExpanded} setDiaryExpanded={setDiaryExpanded} />}
            {tab === "general" && <GeneralContent goSettings={goSettings} />}
            {tab === "usage" && <UsageContent />}
            {tab === "skills" && <SkillsContent />}
            {tab === "remote" && <RemoteContent />}
            {tab === "config" && <ConfigContent />}
            {tab === "backup" && <BackupContent />}
            {tab === "about" && <AboutContent />}
            {tab === "points" && <PointsContent />}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Tab contents ── */

function ProfileContent({ nickname, setNickname, role, setRole, timezone, setTimezone, language, setLanguage, goSettings, enterprise }: {
  nickname: string; setNickname: (v: string) => void
  role: string; setRole: (v: string) => void
  timezone: string; setTimezone: (v: string) => void
  language: string; setLanguage: (v: string) => void
  goSettings: () => void
  enterprise: EnterpriseInfo | null
}) {
  const initial = (nickname || "E").charAt(0).toUpperCase()
  return (
    <div className="space-y-5 max-w-sm">
      <div className="flex items-center gap-4 pb-4 border-b border-border">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-eco-600 text-display font-bold text-eco-50">{initial}</div>
        <div>
          <h3 className="font-semibold text-foreground">{nickname || "未设置"}</h3>
          <p className="text-body text-muted-foreground">{role || "环保专员"} · {enterprise?.name || "未绑定"}</p>
        </div>
        <button onClick={goSettings} className="ml-auto rounded-lg bg-secondary px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">编辑</button>
      </div>
      <Field label="昵称">
        <input value={nickname} onChange={e => setNickname(e.target.value)}
          className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
      </Field>
      <Field label="职务">
        <select value={role} onChange={e => setRole(e.target.value)}
          className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
          {["环保专员", "厂长", "安环部长", "第三方咨询"].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </Field>
      <Field label="时区">
        <select value={timezone} onChange={e => setTimezone(e.target.value)}
          className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
          {["Pacific/Midway","Pacific/Honolulu","America/Los_Angeles","America/Denver","America/Chicago","America/New_York","Europe/London","Europe/Paris","Europe/Moscow","Asia/Dubai","Asia/Kolkata","Asia/Bangkok","Asia/Shanghai","Asia/Tokyo","Australia/Sydney","Pacific/Auckland"].map(tz => <option key={tz} value={tz}>{tz}</option>)}
        </select>
      </Field>
      <Field label="语言">
        <select value={language} onChange={e => setLanguage(e.target.value)}
          className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
          {[{v:"zh-CN",l:"简体中文"},{v:"zh-TW",l:"繁體中文"},{v:"en",l:"English"},{v:"ja",l:"日本語"},{v:"ko",l:"한국어"}].map(l => <option key={l.v} value={l.v}>{l.l}</option>)}
        </select>
      </Field>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block mb-1.5 text-body font-medium text-foreground">{label}</label>{children}</div>
}

function CommContent() {
  return (
    <div className="space-y-5 max-w-sm">
      <Field label="沟通偏好"><textarea rows={3} placeholder="例如：直接、简洁，优先用数据说话" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none" /></Field>
      <Field label="当前关注"><textarea rows={3} placeholder="例如：1. 排污许可证延续\n2. 超标问题排查" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none" /></Field>
      <Field label="经验教训"><textarea rows={3} placeholder="记录实践中沉淀的经验" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none" /></Field>
    </div>
  )
}

function DiaryContent({ diaryExpanded, setDiaryExpanded }: { diaryExpanded: Record<number,boolean>; setDiaryExpanded: React.Dispatch<React.SetStateAction<Record<number, boolean>>> }) {
  const diary: { date: string; day: string; title: string; content: string }[] = []
  return (
    <div className="space-y-2">
      {diary.length === 0 && (
        <div className="rounded-xl bg-secondary p-6 text-center text-body text-muted-foreground">暂无日记记录，开始记录你的第一条工作日志吧</div>
      )}
      {diary.map((e,i) => (
        <div key={i} className="rounded-xl bg-secondary p-3.5">
          <button onClick={() => setDiaryExpanded((prev) => ({...prev, [i]: !prev[i]}))} className="flex w-full items-center justify-between text-left">
            <div className="flex items-center gap-3 min-w-0">
              <span className="size-2 shrink-0 rounded-full bg-eco-500" />
              <div className="min-w-0"><p className="text-body font-medium text-foreground truncate">{e.title}</p><p className="text-xs text-muted-foreground">{e.date} {e.day}</p></div>
            </div>
            <span className="text-xs text-muted-foreground">{diaryExpanded[i]?"收起":"展开"}</span>
          </button>
          {diaryExpanded[i] && <p className="mt-2 pl-7 text-body text-muted-foreground leading-relaxed">{e.content}</p>}
        </div>
      ))}
    </div>
  )
}

function GeneralContent({ goSettings }: { goSettings: () => void }) {
  return (
    <div className="space-y-3 max-w-sm">
      {[
        { label:"启动时打开", value:"上次会话" },
        { label:"自动保存", value:"每5分钟" },
        { label:"通知", value:"已开启" },
        { label:"数据目录", value:"~/.qclaw", action:"打开" },
      ].map(r => (
        <div key={r.label} className="flex items-center justify-between rounded-xl bg-secondary px-4 py-3">
          <span className="text-body text-foreground">{r.label}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{r.value}</span>
            {r.action && <button onClick={goSettings} className="rounded bg-background px-2 py-0.5 text-xs text-eco-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{r.action}</button>}
          </div>
        </div>
      ))}
    </div>
  )
}

function UsageContent() {
  return (
    <div className="space-y-4 max-w-sm">
      {[
        { label:"今日对话次数", value:"23", sub:"限额 100" },
        { label:"本月Token用量", value:"12.8万", sub:"限额 50万" },
        { label:"存储空间", value:"2.3 MB", sub:"限额 100 MB" },
        { label:"活跃会话", value:"5" },
      ].map(r => (
        <div key={r.label} className="rounded-xl bg-secondary px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-body text-foreground">{r.label}</span>
            <span className="text-body font-semibold text-foreground">{r.value}</span>
          </div>
          {r.sub && <div className="mt-1 h-1.5 rounded-full bg-border overflow-hidden">
            <div className="h-full rounded-full bg-eco-500" style={{width:"30%"}} />
          </div>}
          {r.sub && <p className="mt-0.5 text-caption text-muted-foreground">{r.sub}</p>}
        </div>
      ))}
    </div>
  )
}

function SkillsContent() {
  return <div className="text-body text-muted-foreground max-w-sm space-y-3">
    <p>当前已激活技能：6 项</p>
    <div className="flex flex-wrap gap-1.5">
      {["排污许可", "碳排放", "环境监测", "合规巡检", "应急管理", "清洁生产"].map(s => <span key={s} className="rounded-lg bg-eco-50 px-2.5 py-1 text-body text-eco-700">{s}</span>)}
    </div>
  </div>
}

function RemoteContent() {
  return <div className="text-body text-muted-foreground max-w-sm space-y-3">
    <p>远程控制通道用于跨设备访问 EcoPilot。当前状态：<span className="text-success font-medium">未开启</span></p>
    <p>开启后可通过手机端扫码连接。</p>
  </div>
}

function ConfigContent() {
  const [toggles, setToggles] = useState<Record<string, boolean>>({ "Auto Mode": true, "性能优化": true, "调试日志": false, "实验功能": false })
  return <div className="space-y-3 max-w-sm">
    {(Object.keys(toggles)).map(s => {
      const on = !!toggles[s]
      return (
        <button key={s} type="button" onClick={() => setToggles(p => ({ ...p, [s]: !p[s] }))}
          className="flex w-full items-center justify-between rounded-xl bg-secondary px-4 py-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <span className="text-body text-foreground">{s}</span>
          <div className={cn("w-9 h-5 rounded-full relative transition-colors", on ? "bg-eco-500" : "bg-border")}>
            <div className={cn("absolute top-0.5 size-4 rounded-full bg-background shadow-sm transition-all", on ? "left-[18px]" : "left-0.5")} />
          </div>
        </button>
      )
    })}
  </div>
}

function BackupContent() {
  const [msg, setMsg] = useState<string | null>(null)
  const handleExport = async () => {
    try {
      const [uRes, eRes] = await Promise.all([
        apiGet("/api/user"),
        apiGet("/api/enterprise"),
      ])
      const backup = {
        version: 1,
        exported_at: new Date().toISOString(),
        user: uRes.ok ? uRes.data : null,
        enterprise: eRes.ok ? eRes.data : null,
        localStorage: typeof window !== "undefined" ? Object.fromEntries(
          Object.entries(localStorage).filter(([k]) => k.startsWith("ecopilot"))
        ) : {},
      }
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `ecopilot-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setMsg("备份已导出")
      setTimeout(() => setMsg(null), 2000)
    } catch {
      setMsg("导出失败")
      setTimeout(() => setMsg(null), 2000)
    }
  }
  return <div className="text-body text-muted-foreground max-w-sm space-y-3">
    <p>备份当前所有对话、记忆和设置到本地文件。</p>
    <button type="button" onClick={handleExport} className="rounded-lg bg-eco-600 px-4 py-2 text-body text-eco-50 hover:bg-eco-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">导出备份</button>
    {msg && <p className="text-xs text-info">{msg}</p>}
    <div className="mt-3 pt-3 border-t border-border">
      <p className="mb-2">从备份文件恢复数据（功能开发中）：</p>
      <button type="button" disabled className="rounded-lg border border-border px-4 py-2 text-body text-foreground opacity-50 cursor-not-allowed">选择文件导入</button>
    </div>
  </div>
}

function AboutContent() {
  return (
    <div className="space-y-4 max-w-sm">
      <div>
        <p className="text-body font-medium text-foreground">EcoPilot v1.0.7</p>
        <p className="text-xs text-muted-foreground mt-1">企业生态环境合规AI管家</p>
      </div>
      <div className="rounded-xl bg-secondary p-4 space-y-2 text-body">
        <div className="flex justify-between"><span className="text-muted-foreground">当前版本</span><span className="text-foreground">1.0.0 已是最新</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">引擎</span><span className="text-foreground">Next.js 16 + DeepSeek</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">桌面框架</span><span className="text-foreground">Tauri (计划中)</span></div>
      </div>
      <div className="space-y-2">
        {[{l:"查看更新日志"},{l:"访问官网"},{l:"开源许可"}].map(i => (
          <div key={i.l} className="flex items-center justify-between rounded-xl bg-secondary px-4 py-3 text-body text-foreground cursor-pointer hover:bg-accent">
            {i.l} <ExternalLink className="size-4 text-muted-foreground" />
          </div>
        ))}
      </div>
    </div>
  )
}

function PointsContent() {
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div className="space-y-4 max-w-sm">
      <div className="rounded-xl bg-eco-50 border border-eco-100 p-5 text-center">
        <p className="text-3xl font-bold text-eco-600">0</p>
        <p className="text-body text-eco-700 mt-1">当前积分余额</p>
      </div>
      <p className="text-body text-muted-foreground">积分可用于兑换高级功能使用额度。</p>
      <button type="button" onClick={() => { setMsg("积分兑换功能即将上线，敬请期待"); setTimeout(() => setMsg(null), 2500) }} className="rounded-lg bg-eco-600 px-4 py-2 text-body text-eco-50 hover:bg-eco-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">获取积分</button>
      {msg && <p className="text-xs text-info">{msg}</p>}
    </div>
  )
}
