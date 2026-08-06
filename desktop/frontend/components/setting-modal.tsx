"use client"
import { useState, useEffect, useRef, useCallback } from "react"
import {
  X, Settings as SettingsIcon, Building2, Cpu, Palette, Bell, Shield, Info,
  Save, Loader2, CheckCircle2, XCircle, Pencil, ShieldCheck, Sun, Moon, Monitor,
  RefreshCw, LogOut, Check, ChevronRight, Key,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { apiGet, apiPost, checkHealth } from "@/lib/api"

// ═══════════════ 类型 ═══════════════
interface UserForm { name: string; role: string; phone: string }
interface EnterpriseForm {
  name: string; credit_code: string; permit_number: string
  management_level: string; industry: string; address: string
}
type Tab = "enterprise" | "model" | "appearance" | "notifications" | "security" | "about"

// ═══════════════ Tab 配置 ═══════════════
const TABS: { key: Tab; label: string; icon: typeof SettingsIcon }[] = [
  { key: "enterprise", label: "企业信息", icon: Building2 },
  { key: "model",      label: "模型配置", icon: Cpu },
  { key: "appearance", label: "外观设置", icon: Palette },
  { key: "notifications", label: "通知偏好", icon: Bell },
  { key: "security",   label: "安全配置", icon: Shield },
  { key: "about",      label: "关于我们", icon: Info },
]

const EMPTY_USER: UserForm = { name: "", role: "环保专员", phone: "" }
const EMPTY_ENT: EnterpriseForm = {
  name: "", credit_code: "", permit_number: "", management_level: "", industry: "", address: ""
}

// ═══════════════ 主组件 ═══════════════
export function SettingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("enterprise")
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
        className="relative flex w-[880px] h-[640px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-32px)] overflow-hidden rounded-2xl border border-border/60 bg-popover shadow-[0_20px_60px_-12px_rgba(0,0,0,0.25),0_8px_24px_-8px_rgba(0,0,0,0.12)] focus:outline-none"
        onClick={e => e.stopPropagation()}
      >
        {/* 关闭按钮 */}
        <button
          ref={closeBtnRef}
          onClick={onClose}
          aria-label="关闭设置"
          className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground transition-colors"
        >
          <X className="size-4" />
        </button>

        {/* ═══ 左侧 Sidebar ═══ */}
        <aside className="flex w-[200px] shrink-0 flex-col border-r border-border/60 bg-sidebar/80 p-3">
          <div className="mb-4 px-2 pt-1">
            <h2 className="text-body font-semibold text-foreground">设置</h2>
          </div>
          <nav className="flex flex-1 flex-col gap-0.5">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-all",
                  tab === t.key
                    ? "bg-eco-50 text-eco-700 font-medium dark:bg-eco-500/15 dark:text-eco-300"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                )}
              >
                {tab === t.key && (
                  <>
                    <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-eco-500" aria-hidden />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-eco-500">
                      <ChevronRight className="size-3.5" strokeWidth={2.5} />
                    </span>
                  </>
                )}
                <t.icon className="size-4 shrink-0" strokeWidth={1.75} />
                <span className="text-xs">{t.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* ═══ 右侧 Content ═══ */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header bar */}
          <div className="flex items-center justify-between border-b border-border/60 px-6 py-2.5 shrink-0">
            <h3 className="text-xs font-medium text-muted-foreground">
              {TABS.find(t => t.key === tab)?.label} · 配置管理
            </h3>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="mx-auto max-w-[600px]">
              {tab === "enterprise" && <EnterpriseTab />}
              {tab === "model" && <ModelTab />}
              {tab === "appearance" && <AppearanceTab />}
              {tab === "notifications" && <NotificationsTab />}
              {tab === "security" && <SecurityTab />}
              {tab === "about" && <AboutTab onClose={onClose} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════ Tab 1: 企业信息 ═══════════════
function EnterpriseTab() {
  const [editing, setEditing] = useState(false)
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
    ]).then(([uRes, eRes]) => {
      if (cancelled) return
      if (uRes.ok && uRes.data) setUser({ ...EMPTY_USER, ...uRes.data })
      if (eRes.ok && eRes.data) setEnt({ ...EMPTY_ENT, ...eRes.data })
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

  return (
    <div className="space-y-5">
      {saveMsg && (
        <div className={cn(
          "rounded-xl border px-3.5 py-2 text-xs",
          saveMsg.type === "ok" ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive"
        )}>
          {saveMsg.text}
        </div>
      )}

      <GlassCard title="个人档案" desc="当前登录用户的基本信息">
        {loading ? (
          <div className="flex items-center justify-center py-4"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-xl bg-eco-600 text-section font-bold text-eco-50">{initial}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-semibold text-foreground">{user.name || "未设置"}</div>
                <div className="truncate text-xs text-muted-foreground">{user.role}{user.phone ? ` · ${user.phone}` : ""}</div>
              </div>
              <button
                onClick={() => editing ? handleSave() : setEditing(!editing)}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
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
      </GlassCard>

      <GlassCard title="企业信息" desc="排污许可绑定的企业档案">
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
      </GlassCard>
    </div>
  )
}

// ═══════════════ Tab 2: 模型配置 ═══════════════
function ModelTab() {
  const [health, setHealth] = useState<{ text_model?: string; vision_model?: string; text_ready?: boolean; vision_ready?: boolean }>({})

  useEffect(() => {
    checkHealth()
      .then(h => setHealth(h))
      .catch(() => {})
  }, [])

  const models = [
    {
      name: "DeepSeek V4", provider: "深度求索",
      model: health.text_model || "检测中...", ready: !!health.text_ready,
      capabilities: ["推理", "代码", "分析"], cost: "约 ¥1-2 / 百万 tokens（以官方为准）",
    },
    {
      name: "Kimi Vision", provider: "Moonshot",
      model: health.vision_model || "检测中...", ready: !!health.vision_ready,
      capabilities: ["视觉", "多模态", "文档"], cost: "按 Moonshot 官方计费",
    },
  ]

  return (
    <div className="space-y-5">
      <GlassCard title="AI 模型" desc="当前可用的 AI 模型及连接状态">
        <div className="space-y-3">
          {models.map(m => (
            <div
              key={m.name}
              className={cn(
                "rounded-xl border p-4 transition-all",
                m.ready
                  ? "bg-eco-50/40 border-eco-200 dark:bg-eco-500/8 dark:border-eco-500/20"
                  : "bg-secondary/30 border-border/60"
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <div className={cn(
                    "flex size-9 items-center justify-center rounded-lg",
                    m.ready ? "bg-eco-100 text-eco-600 dark:bg-eco-500/20 dark:text-eco-300" : "bg-secondary text-muted-foreground"
                  )}>
                    <Cpu className="size-4" strokeWidth={1.75} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{m.name}</span>
                      {m.ready ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] text-success">
                          <CheckCircle2 className="size-2.5" /> 正常
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive">
                          <XCircle className="size-2.5" /> 离线
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{m.provider} · {m.model}</div>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {m.capabilities.map(c => (
                  <span key={c} className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">{c}</span>
                ))}
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">{m.cost}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-center text-[10px] text-muted-foreground">API Key 配置存储在 ~/.ecopilot-home/.env</p>
      </GlassCard>
    </div>
  )
}

// ═══════════════ Tab 3: 外观设置 ═══════════════
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
    { value: "light" as const, label: "浅色", desc: "明亮简洁", icon: Sun, colors: ["#F9FAFB", "#059669", "#3B82F6"] },
    { value: "dark" as const, label: "深色", desc: "护眼暗色", icon: Moon, colors: ["#0a0c14", "#10B981", "#3B82F6"] },
    { value: "system" as const, label: "跟随系统", desc: "自动切换", icon: Monitor, colors: ["#1a1a2e", "#10B981", "#8B5CF6"] },
  ]

  return (
    <div className="space-y-5">
      <GlassCard title="主题模式" desc="选择界面的颜色风格">
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
              <div className="flex gap-1 mb-1 w-full">
                {opt.colors.map(c => (
                  <div key={c} className="flex-1 h-6 rounded" style={{ background: c }} />
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <opt.icon className="size-4" strokeWidth={1.75} />
                <span className="text-xs font-medium">{opt.label}</span>
              </div>
              <span className="text-[10px] text-muted-foreground">{opt.desc}</span>
              {theme === opt.value && (
                <span className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-eco-500 text-white">
                  <Check className="size-2.5" strokeWidth={3} />
                </span>
              )}
            </button>
          ))}
        </div>
      </GlassCard>

      <GlassCard title="字体大小" desc="调整界面文字尺寸">
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
            <span style={{ fontSize: `${fontSize}px` }} className="font-medium text-foreground">字体预览 · 合规态势分析 ABCabc123</span>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}

// ═══════════════ Tab 4: 通知偏好 ═══════════════
function NotificationsTab() {
  const [settings, setSettings] = useState({
    realtimeAlert: true,
    emailNotify: false,
    autoBackup: true,
  })
  const [notifyTypes, setNotifyTypes] = useState<Record<string, boolean>>({
    "审批通知": true, "预警通知": true, "会议通知": true,
    "系统通知": true, "任务通知": false,
  })
  const notifyTypeList = ["审批通知", "预警通知", "会议通知", "系统通知", "任务通知"]

  return (
    <div className="space-y-5">
      <GlassCard title="推送开关" desc="控制各类通知的接收方式">
        <div className="space-y-1">
          <ToggleRow
            label="实时预警推送"
            desc="智能体异常时立即弹出通知"
            enabled={settings.realtimeAlert}
            onToggle={() => setSettings(s => ({ ...s, realtimeAlert: !s.realtimeAlert }))}
          />
          <ToggleRow
            label="邮件通知"
            desc="重要事件同步发送邮件"
            enabled={settings.emailNotify}
            onToggle={() => setSettings(s => ({ ...s, emailNotify: !s.emailNotify }))}
          />
          <ToggleRow
            label="自动备份提醒"
            desc="每日数据备份完成后通知"
            enabled={settings.autoBackup}
            onToggle={() => setSettings(s => ({ ...s, autoBackup: !s.autoBackup }))}
          />
        </div>
      </GlassCard>

      <GlassCard title="通知类型" desc="筛选接收哪些类型的通知">
        <div className="space-y-1">
          {notifyTypeList.map(type => (
            <ToggleRow
              key={type}
              label={type}
              desc=""
              enabled={!!notifyTypes[type]}
              onToggle={() => setNotifyTypes(prev => ({ ...prev, [type]: !prev[type] }))}
            />
          ))}
        </div>
      </GlassCard>
    </div>
  )
}

// ═══════════════ Tab 5: 安全配置 ═══════════════
function SecurityTab() {
  const [settings, setSettings] = useState({ dataEncryption: true, twoFactor: false })
  const apiKeys = [
    { name: "DeepSeek API", status: "active" as const, key: "sk-***...3a7f" },
    { name: "OpenAI API",   status: "active" as const, key: "sk-***...8b2c" },
    { name: "Anthropic API", status: "expired" as const, key: "sk-***...f1d0" },
  ]

  return (
    <div className="space-y-5">
      <GlassCard title="安全选项" desc="数据加密与访问控制">
        <div className="space-y-1">
          <ToggleRow
            label="数据加密传输"
            desc="所有 API 通信使用 TLS 加密"
            enabled={settings.dataEncryption}
            onToggle={() => setSettings(s => ({ ...s, dataEncryption: !s.dataEncryption }))}
          />
          <ToggleRow
            label="两步验证"
            desc="登录时需要额外验证码"
            enabled={settings.twoFactor}
            onToggle={() => setSettings(s => ({ ...s, twoFactor: !s.twoFactor }))}
          />
        </div>
      </GlassCard>

      <GlassCard title="API 密钥" desc="第三方服务的密钥管理">
        <div className="space-y-2">
          {apiKeys.map(k => (
            <div key={k.name} className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Key className="size-3.5 text-muted-foreground" />
                <div>
                  <div className="text-xs text-foreground">{k.name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{k.key}</div>
                </div>
              </div>
              <span className={cn(
                "text-[10px] px-2 py-0.5 rounded-full",
                k.status === "active"
                  ? "bg-success/10 text-success"
                  : "bg-destructive/10 text-destructive"
              )}>
                {k.status === "active" ? "有效" : "已过期"}
              </span>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  )
}

// ═══════════════ Tab 6: 关于我们 ═══════════════
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
    <div className="space-y-5">
      <GlassCard title="关于 EcoPilot" desc="企业生态环境合规 AI 管家">
        <div className="flex flex-col items-center gap-4 py-4">
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
      </GlassCard>

      <GlassCard title="授权状态" desc="当前许可证信息">
        <div className="space-y-2">
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
      </GlassCard>

      <GlassCard title="" desc="">
        <button
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-body text-foreground transition-all hover:border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
        >
          <LogOut className="size-4" />
          退出登录
        </button>
        <p className="mt-3 text-center text-caption text-muted-foreground">© 2026 EcoPilot · 湖南生态环境智慧执法</p>
      </GlassCard>
    </div>
  )
}

// ═══════════════ 通用子组件 ═══════════════

function SectionTitle({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="flex size-7 items-center justify-center rounded-lg bg-eco-100 text-eco-600 dark:bg-eco-500/15 dark:text-eco-300">
        {icon}
      </div>
      <div>
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="text-[10px] text-muted-foreground">{desc}</div>
      </div>
    </div>
  )
}

function GlassCard({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm">
      {title && (
        <div className="border-b border-border/30 px-4 py-3">
          <h4 className="text-xs font-semibold text-foreground">{title}</h4>
          {desc && <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>}
        </div>
      )}
      <div className="p-4">
        {children}
      </div>
    </div>
  )
}

function ToggleSwitch({ enabled, onToggle, id }: { enabled: boolean; onToggle: () => void; id?: string }) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      id={id}
      onClick={onToggle}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500 focus-visible:ring-offset-1",
        enabled ? "bg-eco-500" : "bg-input"
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block size-4 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out",
          enabled ? "translate-x-4" : "translate-x-0"
        )}
      />
    </button>
  )
}

function ToggleRow({ label, desc, enabled, onToggle }: { label: string; desc: string; enabled: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-accent/30 transition-colors">
      <div className="min-w-0 flex-1 pr-3">
        <div className="text-xs text-foreground">{label}</div>
        {desc && <div className="text-[10px] text-muted-foreground mt-0.5">{desc}</div>}
      </div>
      <ToggleSwitch enabled={enabled} onToggle={onToggle} />
    </div>
  )
}

function Field({
  label, value, editing, onChange, mono, type = "text",
}: {
  label: string; value: string; editing: boolean; onChange: (v: string) => void
  mono?: boolean; type?: string
}) {
  const fieldId = `field-${label}`
  return (
    <div className="flex items-center justify-between rounded-lg bg-secondary/50 px-3 py-2 gap-2">
      <label htmlFor={fieldId} className="shrink-0 text-caption text-muted-foreground">{label}</label>
      {editing ? (
        <input
          id={fieldId}
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
