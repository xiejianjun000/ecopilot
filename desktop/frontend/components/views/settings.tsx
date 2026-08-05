"use client"
import { useEffect, useState } from "react"
import { ShieldCheck, CheckCircle2, XCircle, Pencil, Save, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { checkHealth, apiGet, apiPost } from "@/lib/api"

interface UserForm { name: string; role: string; phone: string }
interface EnterpriseForm {
  name: string
  credit_code: string
  permit_number: string
  management_level: string
  industry: string
  address: string
}

const EMPTY_USER: UserForm = { name: "", role: "环保专员", phone: "" }
const EMPTY_ENT: EnterpriseForm = {
  name: "", credit_code: "", permit_number: "", management_level: "", industry: "", address: ""
}

export function SettingsView() {
  const [editing, setEditing] = useState(false)
  const [health, setHealth] = useState<{ text?: string; vision?: string; text_ready?: boolean; vision_ready?: boolean }>({})
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
      checkHealth().then(h => ({ ok: true, data: h, status: 200 })).catch(() => ({ ok: false, data: null, status: 0 })),
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
    setSaving(true)
    setSaveMsg(null)
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
      const err = !uRes.ok ? uRes.error : eRes.error
      setSaveMsg({ type: "err", text: err || "保存失败" })
    }
  }

  // P1: 先 trim 再 fallback，避免 name 全为空格时头像显示空白
  const initial = (user.name.trim() || "E").charAt(0).toUpperCase()

  const models = [
    { name: "DeepSeek V4", model: health.text || "检测中...", ok: !!health.text_ready },
    { name: "Kimi Vision", model: health.vision || "检测中...", ok: !!health.vision_ready },
  ]

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-2.5">
        <p className="text-caption text-muted-foreground">企业信息 · 模型配置 · 授权管理</p>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-4xl space-y-6">
        {saveMsg && (
          <div className={cn(
            "rounded-xl border px-4 py-2.5 text-body",
            saveMsg.type === "ok"
              ? "border-success/30 bg-success/10 text-success"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          )}>
            {saveMsg.text}
          </div>
        )}

        {/* Section 1: User info */}
        <Section title="个人档案">
          {loading ? (
            <div className="flex items-center justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              <div className="flex items-center gap-4 mb-4">
                <div className="flex size-14 items-center justify-center rounded-2xl bg-eco-600 text-display font-bold text-eco-50">{initial}</div>
                <div className="min-w-0">
                  <h3 className="text-section font-semibold text-foreground truncate">{user.name || "未设置"}</h3>
                  <p className="text-body text-muted-foreground truncate">{user.role}{user.phone ? ` · ${user.phone}` : ""}</p>
                </div>
                <button
                  type="button"
                  onClick={() => editing ? handleSave() : setEditing(!editing)}
                  disabled={saving}
                  className="ml-auto rounded-lg bg-secondary px-4 py-2 text-body text-foreground hover:bg-accent flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                >
                  {editing ? <>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}保存</> : <><Pencil className="size-4" />编辑</>}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-body">
                <Field label="称呼" editing={editing} value={user.name} onChange={v => setUser({ ...user, name: v })} autoComplete="name" />
                <Field label="角色" editing={editing} value={user.role} onChange={v => setUser({ ...user, role: v })} autoComplete="organization-title" />
                <Field label="手机号" editing={editing} value={user.phone} onChange={v => setUser({ ...user, phone: v })} type="tel" autoComplete="tel" />
              </div>
            </>
          )}
        </Section>

        {/* Section 2: Enterprise info */}
        <Section title="企业信息">
          {loading ? (
            <div className="flex items-center justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="grid grid-cols-2 gap-3 text-body">
              <Field label="企业名称" editing={editing} value={ent.name} onChange={v => setEnt({ ...ent, name: v })} autoComplete="organization" />
                <Field label="信用代码" editing={editing} value={ent.credit_code} onChange={v => setEnt({ ...ent, credit_code: v })} mono autoComplete="off" />
                <Field label="许可证编号" editing={editing} value={ent.permit_number} onChange={v => setEnt({ ...ent, permit_number: v })} mono autoComplete="off" />
                <Field label="管理类别" editing={editing} value={ent.management_level} onChange={v => setEnt({ ...ent, management_level: v })} autoComplete="off" />
                <Field label="行业类别" editing={editing} value={ent.industry} onChange={v => setEnt({ ...ent, industry: v })} autoComplete="off" />
                <Field label="注册地址" editing={editing} value={ent.address} onChange={v => setEnt({ ...ent, address: v })} autoComplete="street-address" />
            </div>
          )}
        </Section>

        {/* Section 3: Model status */}
        <Section title="模型配置">
          <div className="space-y-2">
            {models.map(m => (
              <div key={m.name} className="flex items-center gap-3 rounded-xl bg-secondary px-4 py-3">
                {m.ok ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-destructive" />}
                <span className="text-body text-foreground flex-1">{m.name}</span>
                <span className="text-xs text-muted-foreground">{m.model}</span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground text-center pt-1">API Key 配置存储在 ~/.ecopilot-home/.env</p>
          </div>
        </Section>
        </div>
      </div>
    </div>
  )
}

function Field({
  label, value, editing, onChange, mono, type = "text", autoComplete,
}: {
  label: string
  value: string
  editing: boolean
  onChange: (v: string) => void
  mono?: boolean
  type?: string
  autoComplete?: string
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-secondary px-4 py-2.5 gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      {editing ? (
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          autoComplete={autoComplete}
          className={cn(
            "rounded bg-background border border-border px-2 py-0.5 text-right focus:outline-none focus-visible:ring-1 focus-visible:ring-eco-500 min-w-0 flex-1 max-w-[60%]",
            mono && "font-mono text-caption"
          )}
        />
      ) : (
        <span className={cn("font-medium text-foreground truncate text-right", mono && "font-mono text-caption")}>{value || "—"}</span>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <h3 className="mb-4 text-body font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  )
}
