"use client"
import { useState, useEffect, useRef, useCallback } from "react"
import {
  X, Settings as SettingsIcon, Palette, Info, Save, Loader2,
  CheckCircle2, XCircle, Pencil, ShieldCheck, Sun, Moon, Monitor,
  RefreshCw, LogOut, Check
} from "lucide-react"
import { cn } from "@/lib/utils"
import { apiGet, apiPost, checkHealth } from "@/lib/api"

// ═══════════════ 类型 ═══════════════
interface UserForm { name: string; role: string; phone: string }
interface EnterpriseForm {
  name: string; credit_code: string; permit_number: string
  management_level: string; industry: string; address: string
}
type Tab = "general" | "appearance" | "about"

// ═══════════════ Tab 配置 ═══════════════
const TABS: { key: Tab; label: string; icon: typeof SettingsIcon }[] = [
  { key: "general", label: "通用设置", icon: SettingsIcon },
  { key: "appearance", label: "外观", icon: Palette },
  { key: "about", label: "关于我们", icon: Info },
]

const EMPTY_USER: UserForm = { name: "", role: "环保专员", phone: "" }
const EMPTY_ENT: EnterpriseForm = {
  name: "", credit_code: "", permit_number: "", management_level: "", industry: "", address: ""
}

// ═══════════════ 主组件 ═══════════════
export function SettingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("general")
  const panelRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  // ESC 关闭 + 焦点陷阱
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        if (!focusables.length) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    window.addEventListener("keydown", onKey)
    const t = requestAnimationFrame(() => closeBtnRef.current?.focus())
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { window.removeEventListener("keydown", onKey); cancelAnimationFrame(t); document.body.style.overflow = prev }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        tabIndex={-1}
        className="relative flex w-[840px] h-[600px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-32px)] overflow-hidden rounded-2xl border border-border/60 bg-popover shadow-[0_20px_60px_-12px_rgba(0,0,0,0.25),0_8px_24px_-8px_rgba(0,0,0,0.12)] focus:outline-none"
        onClick={e => e.stopPropagation()}
      >
        {/* 浮动关闭按钮 — 不占用 header bar，让卡片更纯粹 */}
        <button
          ref={closeBtnRef}
          onClick={onClose}
          aria-label="关闭设置"
          className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground transition-colors"
        >
          <X className="size-4" />
        </button>

        {/* ═══ 左侧 Sidebar ═══ */}
        <aside className="flex w-[140px] shrink-0 flex-col border-r border-border/60 bg-sidebar/80 p-3">
          {/* 标题 */}
          <div className="mb-3 px-2">
            <h2 className="text-body font-semibold text-foreground">设置</h2>
          </div>
          {/* Tab 列表 */}
          <nav className="flex flex-1 flex-col gap-1">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-all",
                  tab === t.key
                    ? "bg-eco-50 text-eco-700 font-medium dark:bg-eco-500/15 dark:text-eco-300"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                )}
              >
                {tab === t.key && (
                  <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-eco-500" aria-hidden />
                )}
                <t.icon className="size-4 shrink-0" strokeWidth={1.75} />
                <span className="text-xs">{t.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* ═══ 右侧 Content — 无 header bar，直接展示内容 ═══ */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {tab === "general" && <GeneralTab />}
            {tab === "appearance" && <AppearanceTab />}
            {tab === "about" && <AboutTab onClose={onClose} />}
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════ Tab 1: 通用设置 ═══════════════
function GeneralTab() {
  const [editing, setEditing] = useState(false)
  const [health, setHealth] = useState<{ text_model?: string; vision_model?: string; text_ready?: boolean; vision_ready?: boolean }>({})
  const [user, setUser] = useState<UserForm>(EMPTY_USER)
  const [ent, setEnt] = useState<EnterpriseForm>(EMPTY_ENT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiGet<UserForm>("/api/user"),
      apiGet<EnterpriseForm>("/api/enterprise"),
      checkHealth().then(h => ({ ok: true, data: h })).catch(() => ({ ok: false, data: null })),
    ]).then(([uRes, eRes, hRes]) => {
      if (cancelled) return
      if (uRes.ok && uRes.data) setUser({ ...EMPTY_USER, ...uRes.data })
      if (eRes.ok && eRes.data) setEnt({ ...EMPTY_ENT, ...eRes.data })
      if (hRes.ok && hRes.data) setHealth(hRes.data)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const handleSave = async () => {
    setSaving(true); setSaveMsg(null)
    const [uRes, eRes] = await Promise.all([
      apiPost("/api/user", { name: user.name.trim(), role: user.role, phone: user.phone.trim() }),
      apiPost("/api/enterprise", { ...ent }),
    ])
    setSaving(false)
    if (uRes.ok && eRes.ok) {
      setSaveMsg({ type: "ok", text: "保存成功" })
      setEditing(false)
      setTimeout(() => setSaveMsg(null), 2000)
    } else {
      setSaveMsg({ type: "err", text: (!uRes.ok ? uRes.error : eRes.error) || "保存失败" })
    }
  }

  const initial = (user.name.trim() || "E").charAt(0).toUpperCase()
  const models = [
    { name: "DeepSeek V4", model: health.text_model || "检测中...", ok: !!health.text_ready },
    { name: "Kimi Vision", model: health.vision_model || "检测中...", ok: !!health.vision_ready },
  ]

  return (
    <div className="mx-auto max-w-[560px] space-y-5">
      {/* Toast */}
      {saveMsg && (
        <div className={cn(
          "rounded-xl border px-3.5 py-2 text-xs",
          saveMsg.type === "ok" ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive"
        )}>
          {saveMsg.text}
        </div>
      )}

      {/* Section 1: 个人档案 */}
      <Card title="个人档案">
        {loading ? (
          <div className="flex items-center justify-center py-4"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-xl bg-eco-600 text-section font-bold text-eco-50">{initial}</div>
              <div className="min-w-0">
                <div className="truncate text-body font-semibold text-foreground">{user.name || "未设置"}</div>
                <div className="truncate text-xs text-muted-foreground">{user.role}{user.phone ? ` · ${user.phone}` : ""}</div>
              </div>
              <button
                onClick={() => editing ? handleSave() : setEditing(!editing)}
                disabled={saving}
                className="ml-auto flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
              >
                {editing ? <>{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}保存</> : <><Pencil className="size-3.5" />编辑</>}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="称呼" editing={editing} value={user.name} onChange={v => setUser({ ...user, name: v })} />
              <Field label="角色" editing={editing} value={user.role} onChange={v => setUser({ ...user, role: v })} />
              <Field label="手机号" editing={editing} value={user.phone} onChange={v => setUser({ ...user, phone: v })} type="tel" />
            </div>
          </>
        )}
      </Card>

      {/* Section 2: 企业信息 */}
      <Card title="企业信息">
        {loading ? (
          <div className="flex items-center justify-center py-4"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="企业名称" editing={editing} value={ent.name} onChange={v => setEnt({ ...ent, name: v })} />
            <Field label="信用代码" editing={editing} value={ent.credit_code} onChange={v => setEnt({ ...ent, credit_code: v })} mono />
            <Field label="许可证编号" editing={editing} value={ent.permit_number} onChange={v => setEnt({ ...ent, permit_number: v })} mono />
            <Field label="管理类别" editing={editing} value={ent.management_level} onChange={v => setEnt({ ...ent, management_level: v })} />
            <Field label="行业类别" editing={editing} value={ent.industry} onChange={v => setEnt({ ...ent, industry: v })} />
            <Field label="注册地址" editing={editing} value={ent.address} onChange={v => setEnt({ ...ent, address: v })} />
          </div>
        )}
      </Card>

      {/* Section 3: 模型配置 */}
      <Card title="模型配置">
        <div className="space-y-2">
          {models.map(m => (
            <div key={m.name} className="flex items-center gap-2.5 rounded-lg bg-secondary/60 px-3.5 py-2.5">
              {m.ok ? <CheckCircle2 className="size-3.5 text-success" /> : <XCircle className="size-3.5 text-destructive" />}
              <span className="flex-1 text-xs text-foreground">{m.name}</span>
              <span className="text-caption text-muted-foreground">{m.model}</span>
            </div>
          ))}
          <p className="pt-1 text-center text-caption text-muted-foreground">API Key 配置存储在 ~/.ecopilot-home/.env</p>
        </div>
      </Card>
    </div>
  )
}

// ═══════════════ Tab 2: 外观 ═══════════════
function AppearanceTab() {
  const [theme, setTheme] = useState<"light" | "dark" | "system">("light")
  const [fontSize, setFontSize] = useState(14)

  useEffect(() => {
    if (typeof window === "undefined") return
    const saved = localStorage.getItem("ecopilot-theme") as "light" | "dark" | "system" | null
    if (saved) setTheme(saved)
    const savedFont = localStorage.getItem("ecopilot-font-size")
    if (savedFont) setFontSize(parseInt(savedFont))
  }, [])

  const applyTheme = useCallback((t: "light" | "dark" | "system") => {
    setTheme(t)
    if (typeof window !== "undefined") {
      localStorage.setItem("ecopilot-theme", t)
      const isDark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
      document.documentElement.classList.toggle("dark", isDark)
    }
  }, [])

  const applyFontSize = useCallback((size: number) => {
    setFontSize(size)
    if (typeof window !== "undefined") {
      localStorage.setItem("ecopilot-font-size", String(size))
      document.documentElement.style.fontSize = `${size}px`
    }
  }, [])

  const themeOptions = [
    { value: "light" as const, label: "浅色", icon: Sun },
    { value: "dark" as const, label: "深色", icon: Moon },
    { value: "system" as const, label: "跟随系统", icon: Monitor },
  ]

  return (
    <div className="mx-auto max-w-[560px] space-y-5">
      {/* 主题切换 */}
      <Card title="外观">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">主题模式</span>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {themeOptions.map(opt => (
              <button
                key={opt.value}
                onClick={() => applyTheme(opt.value)}
                className={cn(
                  "relative flex flex-col items-center gap-2 rounded-xl border px-3 py-4 transition-all",
                  theme === opt.value
                    ? "border-eco-500 bg-eco-50 text-eco-700 shadow-sm dark:bg-eco-500/15 dark:text-eco-300 dark:border-eco-500/50"
                    : "border-border bg-card text-muted-foreground hover:bg-accent/60 hover:text-foreground hover:border-border"
                )}
              >
                <opt.icon className="size-5" strokeWidth={1.75} />
                <span className="text-xs font-medium">{opt.label}</span>
                {theme === opt.value && (
                  <span className="absolute right-2 top-2 flex size-4 items-center justify-center rounded-full bg-eco-500 text-white">
                    <Check className="size-2.5" strokeWidth={3} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* 字体大小 */}
      <Card title="字体大小">
        <div className="space-y-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">字号</span>
            <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-caption text-foreground">{fontSize}px</span>
          </div>
          <input
            type="range"
            min={12}
            max={18}
            step={1}
            value={fontSize}
            onChange={e => applyFontSize(parseInt(e.target.value))}
            className="w-full accent-eco-600"
          />
          <div className="flex justify-between text-caption text-muted-foreground">
            <span>小</span>
            <span>默认</span>
            <span>大</span>
          </div>
          <div className="rounded-lg border border-border/50 bg-secondary/40 px-3.5 py-3">
            <span style={{ fontSize: `${fontSize}px` }} className="font-medium text-foreground">冷水江钢铁 · 合规态势分析</span>
          </div>
        </div>
      </Card>
    </div>
  )
}

// ═══════════════ Tab 3: 关于 ═══════════════
function AboutTab({ onClose }: { onClose: () => void }) {
  const [license, setLicense] = useState<{ valid?: boolean; days_left?: number; fingerprint?: string } | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    apiGet<{ valid: boolean; days_left: number; fingerprint: string }>("/api/license/status").then(r => {
      if (r.ok && r.data) setLicense(r.data)
    })
  }, [])

  const handleLogout = () => {
    onClose()
    if (typeof window !== "undefined") {
      localStorage.removeItem("ecopilot-onboarding-done")
      localStorage.removeItem("ecopilot-onboarding")
      window.location.href = "/onboarding"
    }
  }

  return (
    <div className="mx-auto max-w-[560px] space-y-5">
      {/* Logo + 版本 */}
      <Card title="关于 EcoPilot">
        <div className="flex flex-col items-center gap-4 py-6">
          {/* Logo */}
          <div className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-eco-600 to-eco-500 shadow-lg shadow-eco-600/20">
            <ShieldCheck className="size-8 text-white" strokeWidth={1.5} />
          </div>
          <div className="text-center">
            <h3 className="text-title font-semibold text-foreground">EcoPilot</h3>
            <p className="mt-1 text-xs text-muted-foreground">企业生态环境合规AI管家</p>
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5">
              <span className="text-caption font-mono text-muted-foreground">v1.0.0</span>
            </div>
          </div>
          <button
            onClick={() => { setChecking(true); setTimeout(() => setChecking(false), 2000) }}
            disabled={checking}
            className="flex items-center gap-1.5 rounded-lg bg-secondary px-3.5 py-2 text-xs text-foreground hover:bg-accent disabled:opacity-50"
          >
            {checking ? <><Loader2 className="size-3.5 animate-spin" />检查中...</> : <><RefreshCw className="size-3.5" />检查更新</>}
          </button>
        </div>
      </Card>

      {/* 授权状态 */}
      <Card title="授权状态">
        <div className="space-y-2.5">
          <Row label="授权状态">
            {license ? (
              <span className={cn("flex items-center gap-1.5 text-xs", license.valid ? "text-success" : "text-destructive")}>
                {license.valid ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
                {license.valid ? "已授权" : "未授权"}
              </span>
            ) : <span className="text-xs text-muted-foreground">加载中...</span>}
          </Row>
          <Row label="剩余天数">
            {license ? (
              <span className="text-xs font-medium text-foreground">{license.days_left ?? "—"} 天</span>
            ) : <span className="text-xs text-muted-foreground">—</span>}
          </Row>
          <Row label="机器指纹">
            {license?.fingerprint ? (
              <span className="font-mono text-caption text-muted-foreground">{license.fingerprint.slice(0, 16)}...</span>
            ) : <span className="text-xs text-muted-foreground">—</span>}
          </Row>
        </div>
      </Card>

      {/* 退出登录 */}
      <div className="pt-2">
        <button
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-body text-foreground transition-all hover:border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
        >
          <LogOut className="size-4" />
          退出登录
        </button>
      </div>

      <p className="pt-1 text-center text-caption text-muted-foreground">© 2026 EcoPilot · 湖南生态环境智慧执法</p>
    </div>
  )
}

// ═══════════════ 通用子组件 ═══════════════
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4">
      <h4 className="mb-3 text-xs font-semibold text-foreground">{title}</h4>
      {children}
    </div>
  )
}

function Field({
  label, value, editing, onChange, mono, type = "text",
}: {
  label: string; value: string; editing: boolean; onChange: (v: string) => void
  mono?: boolean; type?: string
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-secondary/50 px-3 py-2 gap-2">
      <span className="shrink-0 text-caption text-muted-foreground">{label}</span>
      {editing ? (
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          className={cn(
            "rounded bg-background border border-border px-2 py-0.5 text-right text-xs focus:outline-none focus-visible:ring-1 focus-visible:ring-eco-500 min-w-0 flex-1 max-w-[60%]",
            mono && "font-mono text-caption"
          )}
        />
      ) : (
        <span className={cn("truncate text-right text-xs font-medium text-foreground", mono && "font-mono text-caption")}>{value || "—"}</span>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-secondary/50 px-3 py-2">
      <span className="text-caption text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}
