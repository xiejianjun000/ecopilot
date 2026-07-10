"use client"
import { useEffect, useState, useCallback, useRef } from "react"
import {
  Send, Plus, Trash2, Loader2, Check, X, AlertTriangle,
  CheckCircle2, XCircle, MessageSquare, ExternalLink, ChevronRight,
  TestTube, Zap, ShieldCheck, Bell, QrCode, KeyRound, RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { apiGet, apiPost, apiDelete } from "@/lib/api"

/* ════════════════════════════════════════════════════════════════════
 * EcoPilot 通讯中心 — 飞书 / 企业微信 / 微信集成
 *
 * 架构：前端 → /api/notify/* → Hermes CLI subprocess → 各平台 SDK
 *
 * 三大区域：
 *  1. 平台凭证状态 — 显示飞书/企微/微信的 env 是否已配置
 *  2. 我的通讯渠道 — 已保存的发送目标列表（增删启停）
 *  3. 发送测试 — 选定渠道后一键发送测试消息
 * ════════════════════════════════════════════════════════════════════ */

interface Platform {
  id: string
  name: string
  icon: string
  doc_url: string
  env_keys: string[]
  target_hint: string
  target_prefix: string
  maturity: number
  description: string
  configured: boolean
  missing_env: string[]
}

interface Channel {
  id: string
  name: string
  platform: string
  target: string
  enabled: boolean
  note: string
  created_at: number
  updated_at: number
}

const PLATFORM_ICON: Record<string, typeof Send> = {
  feishu: MessageSquare,
  wecom: Send,
  weixin: Bell,
}

const PLATFORM_COLOR: Record<string, { bg: string; text: string; ring: string }> = {
  feishu: { bg: "bg-blue-50", text: "text-blue-600", ring: "ring-blue-200" },
  wecom: { bg: "bg-emerald-50", text: "text-emerald-600", ring: "ring-emerald-200" },
  weixin: { bg: "bg-green-50", text: "text-green-600", ring: "ring-green-200" },
}

export function NotifyView() {
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  // 扫码绑定 + 凭证配置状态
  const [showWeixinQr, setShowWeixinQr] = useState(false)
  const [credentialsPlatform, setCredentialsPlatform] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [p, c] = await Promise.all([
      apiGet<{ platforms: Platform[] }>("/api/notify/platforms"),
      apiGet<{ channels: Channel[] }>("/api/notify/channels"),
    ])
    if (p.ok && p.data) setPlatforms(p.data.platforms)
    if (c.ok && c.data) setChannels(c.data.channels)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const showToast = (type: "success" | "error" | "info", msg: string) => {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3000)
  }

  const handleSave = async (data: Partial<Channel>) => {
    const res = await apiPost<{ ok: boolean; detail?: string }>("/api/notify/channels", {
      id: data.id,
      name: data.name,
      platform: data.platform,
      target: data.target,
      enabled: data.enabled ?? true,
      note: data.note || "",
    })
    if (res.ok) {
      showToast("success", data.id ? "渠道已更新" : "渠道已创建")
      setShowEditor(false)
      setEditingChannel(null)
      load()
    } else {
      showToast("error", res.data?.detail || "保存失败")
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("确认删除该通讯渠道？")) return
    const res = await apiDelete<{ ok: boolean }>("/api/notify/channels", { id })
    if (res.ok) {
      showToast("success", "渠道已删除")
      load()
    } else {
      showToast("error", "删除失败")
    }
  }

  const handleTest = async (id: string) => {
    setTestingId(id)
    const res = await apiPost<{ ok: boolean; error?: string; stdout?: string }>("/api/notify/test", { channel_id: id })
    if (res.ok) {
      showToast("success", "测试消息已发送，请到对应群聊查收")
    } else {
      showToast("error", res.data?.error || res.data?.stdout || "发送失败，请检查凭证配置")
    }
    setTestingId(null)
  }

  const platformById = useCallback((id: string) => platforms.find(p => p.id === id), [platforms])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-eco-600" />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-6 space-y-6">
        {/* ═══ Hero 说明卡 ═══ */}
        <div className="rounded-2xl border border-border bg-gradient-to-br from-eco-50/60 to-transparent p-5">
          <div className="flex items-start gap-4">
            <div className="flex size-11 items-center justify-center rounded-xl bg-eco-600 text-white shadow-sm shrink-0">
              <Send className="size-5" strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-section font-semibold text-foreground">通讯中心</h2>
              <p className="text-body text-muted-foreground mt-1 leading-relaxed">
                将合规报告、整改提醒、许可证预警推送到企业飞书、企业微信、微信。
                底层基于 Hermes Agent 通讯能力，凭证隔离在 <code className="rounded bg-secondary px-1 py-0.5 text-caption font-mono">~/.hermes/.env</code>，不污染 EcoPilot 配置。
              </p>
            </div>
          </div>
        </div>

        {/* ═══ 1. 平台凭证状态 ═══ */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-muted-foreground" />
              <h3 className="text-body font-semibold text-foreground">平台凭证状态</h3>
            </div>
            <span className="text-caption text-muted-foreground">
              {platforms.filter(p => p.configured).length}/{platforms.length} 已配置
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {platforms.map(p => {
              const Icon = PLATFORM_ICON[p.id] || Send
              const color = PLATFORM_COLOR[p.id] || PLATFORM_COLOR.feishu
              return (
                <div
                  key={p.id}
                  className={cn(
                    "rounded-xl border bg-card p-4 shadow-sm transition-all",
                    p.configured
                      ? "border-success/30"
                      : "border-warning/30 bg-warning/5"
                  )}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className={cn("flex size-9 items-center justify-center rounded-lg", color.bg)}>
                      <Icon className={cn("size-4", color.text)} strokeWidth={1.75} />
                    </div>
                    {p.configured ? (
                      <span className="inline-flex items-center gap-1 text-caption text-success">
                        <CheckCircle2 className="size-3.5" /> 已配置
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-caption text-warning">
                        <AlertTriangle className="size-3.5" /> 待配置
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-body font-semibold text-foreground">{p.name}</span>
                    <span className="flex shrink-0">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <span
                          key={i}
                          className={cn(
                            "size-1 rounded-full",
                            i < p.maturity ? "bg-amber-400" : "bg-secondary"
                          )}
                        />
                      ))}
                    </span>
                  </div>
                  <p className="text-caption text-muted-foreground leading-relaxed mb-3">
                    {p.description}
                  </p>
                  {!p.configured && p.missing_env.length > 0 && (
                    <div className="mb-2">
                      <div className="text-caption text-muted-foreground mb-1">缺失凭证：</div>
                      <div className="flex flex-wrap gap-1">
                        {p.missing_env.map(k => (
                          <code key={k} className="rounded bg-warning/10 px-1.5 py-0.5 text-caption font-mono text-warning">
                            {k}
                          </code>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* 平台绑定按钮 — 微信扫码 / 飞书企微凭证填入 */}
                  <div className="flex items-center gap-2 mt-2">
                    {p.id === "weixin" ? (
                      <button
                        onClick={() => setShowWeixinQr(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-eco-600 px-3 py-1.5 text-caption font-medium text-white hover:bg-eco-700 active:scale-[0.96] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
                      >
                        <QrCode className="size-3.5" strokeWidth={2} />
                        {p.configured ? "重新扫码绑定" : "扫码绑定"}
                      </button>
                    ) : (
                      <button
                        onClick={() => setCredentialsPlatform(p.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-eco-600 px-3 py-1.5 text-caption font-medium text-white hover:bg-eco-700 active:scale-[0.96] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
                      >
                        <KeyRound className="size-3.5" strokeWidth={2} />
                        {p.configured ? "修改凭证" : "配置凭证"}
                      </button>
                    )}
                    <a
                      href={p.doc_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-eco-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40 rounded"
                    >
                      帮助 <ExternalLink className="size-3" />
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* ═══ 2. 我的通讯渠道 ═══ */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4 text-muted-foreground" />
              <h3 className="text-body font-semibold text-foreground">我的通讯渠道</h3>
              <span className="text-caption text-muted-foreground">
                {channels.length} 个
              </span>
            </div>
            <button
              onClick={() => { setEditingChannel(null); setShowEditor(true) }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-eco-600 px-3 py-1.5 text-caption font-medium text-white hover:bg-eco-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
            >
              <Plus className="size-3.5" /> 新增渠道
            </button>
          </div>

          {channels.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
              <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-eco-50">
                <Send className="size-5 text-eco-600" strokeWidth={1.5} />
              </div>
              <p className="text-body font-medium text-foreground mb-1">还没有通讯渠道</p>
              <p className="text-caption text-muted-foreground mb-4">
                添加一个飞书群或企业微信群，即可将合规提醒一键推送到群聊
              </p>
              <button
                onClick={() => { setEditingChannel(null); setShowEditor(true) }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-eco-300 bg-eco-50/50 px-3 py-1.5 text-caption font-medium text-eco-700 hover:bg-eco-50 transition-colors"
              >
                <Plus className="size-3.5" /> 添加第一个渠道
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {channels.map(ch => {
                const p = platformById(ch.platform)
                const Icon = PLATFORM_ICON[ch.platform] || Send
                const color = PLATFORM_COLOR[ch.platform] || PLATFORM_COLOR.feishu
                return (
                  <div
                    key={ch.id}
                    className={cn(
                      "rounded-xl border bg-card p-4 shadow-sm transition-all",
                      ch.enabled ? "border-border" : "border-border/60 opacity-60"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn("flex size-9 items-center justify-center rounded-lg shrink-0", color.bg)}>
                        <Icon className={cn("size-4", color.text)} strokeWidth={1.75} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-body font-semibold text-foreground truncate">{ch.name}</span>
                          {!ch.enabled && (
                            <span className="rounded-full bg-secondary px-1.5 py-0.5 text-caption text-muted-foreground">已禁用</span>
                          )}
                          {p && !p.configured && (
                            <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-caption text-warning">凭证缺失</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-caption text-muted-foreground">
                          <span>{p?.name || ch.platform}</span>
                          <span className="text-muted-foreground/40">·</span>
                          <code className="font-mono text-foreground/70">{ch.target}</code>
                        </div>
                        {ch.note && (
                          <p className="text-caption text-muted-foreground mt-1 italic">{ch.note}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={() => handleTest(ch.id)}
                          disabled={testingId === ch.id}
                          aria-label="发送测试消息"
                          title="发送测试消息"
                          className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-eco-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40 disabled:opacity-50"
                        >
                          {testingId === ch.id
                            ? <Loader2 className="size-[18px] animate-spin" />
                            : <TestTube className="size-[18px]" />}
                        </button>
                        <button
                          onClick={() => { setEditingChannel(ch); setShowEditor(true) }}
                          aria-label="编辑渠道"
                          title="编辑"
                          className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
                        >
                          <Zap className="size-[18px]" />
                        </button>
                        <button
                          onClick={() => handleDelete(ch.id)}
                          aria-label="删除渠道"
                          title="删除"
                          className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                        >
                          <Trash2 className="size-[18px]" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ═══ 说明：配置引导 ═══ */}
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <ChevronRight className="size-4 text-muted-foreground" />
            <h3 className="text-body font-semibold text-foreground">配置引导</h3>
          </div>
          <div className="space-y-2 text-body text-muted-foreground leading-relaxed">
            <p>
              <strong className="text-foreground">微信（个人号）</strong> — 点击上方「扫码绑定」按钮，用手机微信扫码即可完成授权，无需手动填凭证。
            </p>
            <p>
              <strong className="text-foreground">飞书 / 企业微信</strong> — 点击上方「配置凭证」按钮，按提示填入 App ID / Secret 等凭证。凭证保存在
              <code className="rounded bg-secondary px-1 py-0.5 text-caption font-mono mx-1">~/.hermes/.env</code>
              ，不污染 EcoPilot 配置。
            </p>
            <p className="text-caption text-muted-foreground/80">
              底层基于 Hermes Agent 通讯能力，支持 Markdown / 富文本 / 文件 / 卡片消息推送。
            </p>
          </div>
        </section>
      </div>

      {/* ═══ 编辑器弹窗 ═══ */}
      {showEditor && (
        <ChannelEditor
          channel={editingChannel}
          platforms={platforms}
          onClose={() => { setShowEditor(false); setEditingChannel(null) }}
          onSave={handleSave}
        />
      )}

      {/* ═══ 微信扫码绑定弹窗 ═══ */}
      {showWeixinQr && (
        <WeixinQrModal
          onClose={() => setShowWeixinQr(false)}
          onBound={() => { setShowWeixinQr(false); load(); showToast("success", "微信绑定成功，凭证已写入 ~/.hermes/.env") }}
        />
      )}

      {/* ═══ 凭证填入弹窗（飞书/企微） ═══ */}
      {credentialsPlatform && (
        <CredentialsModal
          platform={credentialsPlatform}
          onClose={() => setCredentialsPlatform(null)}
          onSaved={() => { setCredentialsPlatform(null); load(); showToast("success", "凭证已保存") }}
        />
      )}

      {/* ═══ Toast ═══ */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2.5 shadow-lg pointer-events-auto",
            toast.type === "success" && "bg-success text-white",
            toast.type === "error" && "bg-destructive text-white",
            toast.type === "info" && "bg-foreground text-background"
          )}>
            {toast.type === "success" ? <Check className="size-4" /> :
             toast.type === "error" ? <XCircle className="size-4" /> :
             <Bell className="size-4" />}
            <span className="text-caption font-medium">{toast.msg}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════ 渠道编辑器 ═══════════════ */
function ChannelEditor({
  channel,
  platforms,
  onClose,
  onSave,
}: {
  channel: Channel | null
  platforms: Platform[]
  onClose: () => void
  onSave: (data: Partial<Channel>) => void
}) {
  const [name, setName] = useState(channel?.name || "")
  const [platformId, setPlatformId] = useState(channel?.platform || (platforms[0]?.id ?? ""))
  const [target, setTarget] = useState(channel?.target || "")
  const [enabled, setEnabled] = useState(channel?.enabled ?? true)
  const [note, setNote] = useState(channel?.note || "")

  const selectedPlatform = platforms.find(p => p.id === platformId)
  const canSubmit = name.trim() && platformId && target.trim()

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[150] pointer-events-none">
      <div
        className="absolute inset-0 pointer-events-auto bg-foreground/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={channel ? "编辑通讯渠道" : "新增通讯渠道"}
        tabIndex={-1}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] max-w-[92vw] pointer-events-auto rounded-2xl border border-border bg-background shadow-modal outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40 animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <h2 className="text-section font-semibold text-foreground">
            {channel ? "编辑渠道" : "新增通讯渠道"}
          </h2>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* 名称 */}
          <div>
            <label className="block text-caption font-medium text-foreground mb-1.5">渠道名称</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如：合规预警群"
              autoFocus
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-eco-300 focus:border-eco-300"
            />
          </div>

          {/* 平台 */}
          <div>
            <label className="block text-caption font-medium text-foreground mb-1.5">平台</label>
            <div className="grid grid-cols-3 gap-2">
              {platforms.map(p => {
                const Icon = PLATFORM_ICON[p.id] || Send
                const color = PLATFORM_COLOR[p.id] || PLATFORM_COLOR.feishu
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlatformId(p.id)}
                    aria-pressed={platformId === p.id}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border px-3 py-2.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40",
                      platformId === p.id
                        ? "border-eco-300 bg-eco-50/60 ring-1 ring-eco-300"
                        : "border-border hover:border-eco-200 hover:bg-accent/40"
                    )}
                  >
                    <div className={cn("flex size-7 items-center justify-center rounded-md", color.bg)}>
                      <Icon className={cn("size-3.5", color.text)} strokeWidth={1.75} />
                    </div>
                    <span className="text-caption font-medium text-foreground">{p.name}</span>
                    {p.configured && <CheckCircle2 className="size-3 text-success" />}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 目标 ID */}
          <div>
            <label className="block text-caption font-medium text-foreground mb-1.5">
              目标 ID（群聊 ID）
            </label>
            <input
              value={target}
              onChange={e => setTarget(e.target.value)}
              placeholder={selectedPlatform?.target_hint || "目标群聊 ID"}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-body text-foreground placeholder:text-muted-foreground font-mono focus:outline-none focus:ring-2 focus:ring-eco-300 focus:border-eco-300"
            />
            {selectedPlatform && (
              <p className="mt-1 text-caption text-muted-foreground">
                格式提示：<code className="font-mono">{selectedPlatform.target_hint}</code>
              </p>
            )}
          </div>

          {/* 备注 */}
          <div>
            <label className="block text-caption font-medium text-foreground mb-1.5">
              备注 <span className="text-muted-foreground/60">（可选）</span>
            </label>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="例如：钢铁事业部合规预警专用群"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-eco-300 focus:border-eco-300"
            />
          </div>

          {/* 启用开关 */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              className="size-4 rounded border-border text-eco-600 focus:ring-eco-300"
            />
            <span className="text-body text-foreground">启用此渠道</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-secondary/20">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-1.5 text-body text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
          >
            取消
          </button>
          <button
            onClick={() => canSubmit && onSave({ id: channel?.id, name, platform: platformId, target, enabled, note })}
            disabled={!canSubmit}
            className="rounded-lg bg-eco-600 px-4 py-1.5 text-body font-medium text-white hover:bg-eco-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {channel ? "保存" : "创建"}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════ 微信扫码绑定弹窗 ═══════════════ */
function WeixinQrModal({ onClose, onBound }: {
  onClose: () => void
  onBound: () => void
}) {
  const [qrImg, setQrImg] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [status, setStatus] = useState<"loading" | "wait" | "scaned" | "confirmed" | "expired" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 启动扫码流程
  const startQr = useCallback(async () => {
    setStatus("loading")
    setError(null)
    setQrImg(null)
    const res = await apiPost<{ ok: boolean; session_id?: string; qrcode_img_base64?: string; detail?: string }>(
      "/api/notify/weixin/qr/start"
    )
    if (res.ok && res.data?.ok && res.data.session_id && res.data.qrcode_img_base64) {
      setQrImg(res.data.qrcode_img_base64)
      setSessionId(res.data.session_id)
      setStatus("wait")
    } else {
      setStatus("error")
      setError(res.data?.detail || res.error || "获取二维码失败")
    }
  }, [])

  // 轮询状态
  useEffect(() => {
    if (!sessionId || status === "confirmed" || status === "expired" || status === "error") return

    const poll = async () => {
      const res = await apiGet<{ ok: boolean; status?: string; detail?: string }>(
        "/api/notify/weixin/qr/status",
        { session_id: sessionId }
      )
      if (res.ok && res.data?.ok) {
        const s = res.data.status
        if (s === "confirmed") {
          setStatus("confirmed")
          setTimeout(() => onBound(), 800)
        } else if (s === "expired") {
          setStatus("expired")
        } else if (s === "scaned") {
          setStatus("scaned")
          pollRef.current = setTimeout(poll, 1500)
        } else {
          setStatus("wait")
          pollRef.current = setTimeout(poll, 2000)
        }
      } else {
        setStatus("error")
        setError(res.data?.detail || res.error || "查询状态失败")
      }
    }
    pollRef.current = setTimeout(poll, 2000)

    return () => {
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [sessionId, status, onBound])

  // 初始加载
  useEffect(() => { startQr() }, [startQr])

  // ESC 关闭 + 焦点管理（与 md-viewer.tsx 对齐）
  useEffect(() => {
    if (!closeBtnRef.current) return
    requestAnimationFrame(() => closeBtnRef.current?.focus())
    document.body.style.overflow = "hidden"
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus()
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[150] pointer-events-none">
      <div
        className="absolute inset-0 pointer-events-auto bg-foreground/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="微信扫码绑定"
        tabIndex={-1}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] max-w-[92vw] pointer-events-auto rounded-2xl border border-border bg-background shadow-modal outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40 animate-in fade-in zoom-in-95 duration-200"
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <QrCode className="size-5 text-eco-600" strokeWidth={1.75} />
            <h2 className="text-section font-semibold text-foreground">微信扫码绑定</h2>
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="关闭"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-5 py-6 flex flex-col items-center gap-4">
          {status === "loading" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="size-8 animate-spin text-eco-600" />
              <p className="text-body text-muted-foreground">正在生成二维码...</p>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <AlertTriangle className="size-8 text-destructive" />
              <p className="text-body text-destructive max-w-[280px]">{error || "获取二维码失败"}</p>
              <button
                onClick={startQr}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-caption font-medium text-foreground hover:bg-accent active:scale-[0.96] transition-all duration-150"
              >
                <RefreshCw className="size-3.5" /> 重试
              </button>
            </div>
          )}

          {(status === "wait" || status === "scaned" || status === "confirmed") && qrImg && (
            <>
              <div className={cn(
                "rounded-xl border-2 p-3 bg-white transition-all",
                status === "confirmed" ? "border-success" : status === "scaned" ? "border-eco-400" : "border-border"
              )}>
                <img
                  src={`data:image/png;base64,${qrImg}`}
                  alt="微信扫码绑定二维码"
                  className="size-[220px] object-contain"
                />
              </div>

              <div className="text-center min-h-[28px]">
                {status === "wait" && (
                  <p className="text-body text-muted-foreground">
                    请用<span className="font-medium text-foreground">手机微信</span>扫码 → 确认授权
                  </p>
                )}
                {status === "scaned" && (
                  <p className="text-body text-eco-600 flex items-center justify-center gap-1.5">
                    <Loader2 className="size-4 animate-spin" />
                    已扫码，请在手机上确认...
                  </p>
                )}
                {status === "confirmed" && (
                  <p className="text-body text-success flex items-center justify-center gap-1.5">
                    <CheckCircle2 className="size-5" />
                    绑定成功！凭证已保存
                  </p>
                )}
              </div>

              {status === "wait" && (
                <button
                  onClick={startQr}
                  className="inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-eco-600 hover:underline"
                >
                  <RefreshCw className="size-3" /> 刷新二维码
                </button>
              )}
            </>
          )}

          {status === "expired" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <AlertTriangle className="size-8 text-warning" />
              <p className="text-body text-warning">二维码已过期</p>
              <button
                onClick={startQr}
                className="inline-flex items-center gap-1.5 rounded-lg bg-eco-600 px-3 py-1.5 text-caption font-medium text-white hover:bg-eco-700 active:scale-[0.96] transition-all duration-150"
              >
                <RefreshCw className="size-3.5" /> 重新生成
              </button>
            </div>
          )}

          <p className="text-caption text-muted-foreground/80 text-center max-w-[320px] leading-relaxed">
            扫码后微信会弹出授权确认，确认后自动绑定。凭证仅写入本地 <code className="rounded bg-secondary px-1 py-0.5 font-mono">~/.hermes/.env</code>，不会上传任何服务器。
          </p>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════ 凭证填入弹窗（飞书/企微通用） ═══════════════ */
interface CredentialField {
  key: string
  label: string
  required: boolean
  placeholder: string
  hint: string
  password?: boolean
}

interface CredentialsSchema {
  fields: CredentialField[]
  create_app_url: string
  create_app_guide: string
  configured: boolean
  configured_keys: string[]
}

function CredentialsModal({ platform, onClose, onSaved }: {
  platform: string
  onClose: () => void
  onSaved: () => void
}) {
  const [schema, setSchema] = useState<CredentialsSchema | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  // 加载 schema
  useEffect(() => {
    apiGet<CredentialsSchema>("/api/notify/credentials", { platform })
      .then(r => {
        if (r.ok && r.data) {
          setSchema(r.data)
          // 已配置的字段显示占位符（不返回真实值，符合安全要求）
          const initial: Record<string, string> = {}
          r.data.fields.forEach(f => { initial[f.key] = "" })
          setValues(initial)
        } else {
          setError(r.error || "加载失败")
        }
      })
      .catch(() => setError("网络错误"))
      .finally(() => setLoading(false))
  }, [platform])

  // ESC + 焦点陷阱
  useEffect(() => {
    if (!closeBtnRef.current) return
    requestAnimationFrame(() => closeBtnRef.current?.focus())
    document.body.style.overflow = "hidden"
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus()
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [onClose])

  const handleSave = async () => {
    if (!schema) return
    setSaving(true)
    setError(null)
    // 过滤空值，但必填项校验
    const filled: Record<string, string> = {}
    for (const f of schema.fields) {
      const v = values[f.key]?.trim()
      if (v) filled[f.key] = v
      else if (f.required && !schema.configured_keys.includes(f.key)) {
        setError(`缺失必填项：${f.label}`)
        setSaving(false)
        return
      }
    }
    if (Object.keys(filled).length === 0) {
      setError("请至少填写一个字段")
      setSaving(false)
      return
    }
    const res = await apiPost<{ ok: boolean; detail?: string }>("/api/notify/credentials", {
      platform,
      credentials: filled,
    })
    setSaving(false)
    if (res.ok && res.data?.ok) {
      onSaved()
    } else {
      setError(res.data?.detail || res.error || "保存失败")
    }
  }

  const handleDelete = async () => {
    setSaving(true)
    const res = await apiDelete<{ ok: boolean }>("/api/notify/credentials", { platform })
    setSaving(false)
    if (res.ok) {
      onSaved()
    } else {
      setError(res.error || "删除失败")
      setShowDeleteConfirm(false)
    }
  }

  const platformName = platform === "feishu" ? "飞书" : platform === "wecom" ? "企业微信" : platform

  return (
    <div className="fixed inset-0 z-[150] pointer-events-none">
      <div
        className="absolute inset-0 pointer-events-auto bg-foreground/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`配置${platformName}凭证`}
        tabIndex={-1}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] max-w-[92vw] pointer-events-auto rounded-2xl border border-border bg-background shadow-modal outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40 animate-in fade-in zoom-in-95 duration-200 max-h-[88vh] flex flex-col"
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <KeyRound className="size-5 text-eco-600" strokeWidth={1.75} />
            <h2 className="text-section font-semibold text-foreground">
              配置{platformName}凭证
            </h2>
            {schema?.configured && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-caption text-success">
                <CheckCircle2 className="size-3" /> 已配置
              </span>
            )}
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="关闭"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-6 animate-spin text-eco-600" />
            </div>
          ) : schema ? (
            <>
              {/* 创建应用引导 */}
              <div className="rounded-lg border border-eco-200 bg-eco-50/50 p-3">
                <p className="text-caption text-foreground leading-relaxed mb-2">
                  <strong>如何获取凭证：</strong>{schema.create_app_guide}
                </p>
                <a
                  href={schema.create_app_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-caption text-eco-600 hover:text-eco-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40 rounded"
                >
                  打开{platformName}开放平台 <ExternalLink className="size-3" />
                </a>
              </div>

              {/* 凭证字段 */}
              <div className="space-y-3">
                {schema.fields.map(f => {
                  const isConfigured = schema.configured_keys.includes(f.key)
                  return (
                    <div key={f.key}>
                      <label className="flex items-center gap-2 mb-1">
                        <span className="text-caption font-medium text-foreground">{f.label}</span>
                        {f.required && <span className="text-destructive text-caption">*</span>}
                        <code className="text-caption text-muted-foreground font-mono">{f.key}</code>
                        {isConfigured && (
                          <span className="inline-flex items-center gap-0.5 text-caption text-success">
                            <Check className="size-3" />已配置
                          </span>
                        )}
                      </label>
                      <input
                        type={f.password ? "password" : "text"}
                        value={values[f.key] || ""}
                        onChange={e => setValues(p => ({ ...p, [f.key]: e.target.value }))}
                        placeholder={isConfigured ? "已配置（输入新值可覆盖）" : f.placeholder}
                        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-eco-300 focus:border-eco-300"
                      />
                      <p className="mt-1 text-caption text-muted-foreground">{f.hint}</p>
                    </div>
                  )
                })}
              </div>

              {/* 已配置时显示删除按钮 */}
              {schema.configured && (
                <div className="pt-2 border-t border-border">
                  {!showDeleteConfirm ? (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="inline-flex items-center gap-1 text-caption text-destructive hover:underline"
                    >
                      <Trash2 className="size-3" /> 删除已保存的凭证
                    </button>
                  ) : (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                      <p className="text-caption text-destructive mb-2">确认删除？删除后该平台无法发送消息。</p>
                      <div className="flex gap-2">
                        <button
                          onClick={handleDelete}
                          disabled={saving}
                          className="rounded-lg bg-destructive px-3 py-1.5 text-caption font-medium text-white hover:bg-destructive/90 disabled:opacity-50"
                        >
                          {saving ? "删除中..." : "确认删除"}
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(false)}
                          className="rounded-lg border border-border px-3 py-1.5 text-caption text-foreground hover:bg-accent"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-destructive">{error || "加载失败"}</div>
          )}
        </div>

        {/* 底部操作栏 */}
        {!loading && schema && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-border shrink-0">
            <p className="text-caption text-muted-foreground">
              凭证保存到 <code className="font-mono">~/.hermes/.env</code>
            </p>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-border px-3 py-1.5 text-body text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-eco-600 px-4 py-1.5 text-body font-medium text-white hover:bg-eco-700 active:scale-[0.96] transition-all duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500/40"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                保存凭证
              </button>
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {error && !loading && (
          <div className="px-5 pb-3 -mt-2">
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-caption text-destructive flex items-center gap-1.5">
              <AlertTriangle className="size-3.5 shrink-0" />
              {error}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
