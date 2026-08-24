"use client"
import { useState, useEffect } from "react"
import {
  ExternalLink, Search, WifiOff, ShieldCheck, Clock, Plus, X, Globe,
  KeyRound, RefreshCw, Pencil, Eye, EyeOff,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getPlatformCredentials, savePlatformCredentials, initPermitLogin, submitPermitLogin, openPlatformBrowser } from "@/lib/api"

const BUILTIN_CATS = ["全部", "核心"]

interface LinkItem {
  name: string
  url: string
  cat: string
  desc: string
  connected: boolean
  soon?: boolean
  /** 用户自定义平台标记 */
  custom?: boolean
  /** 后端凭证平台标识（credentials_manager.PLATFORM_NAMES 的 key） */
  platformId?: string
}

const BUILTIN_LINKS: LinkItem[] = [
  { name: "全国排污许可证管理信息平台", url: "https://permit.mee.gov.cn", cat: "核心", desc: "企业端。读许可证、执行报告、台账记录", connected: true, platformId: "permit" },
  { name: "国家固体废物污染环境防治信息平台", url: "https://swmd.mee.gov.cn", cat: "核心", desc: "危险废物全过程管理+一般固废台账", connected: false, platformId: "solid-waste" },
  { name: "在线监测管理平台", url: "https://wryjc.cnemc.cn", cat: "核心", desc: "重点排污单位自动监控（CEMS）在线监测", connected: false, platformId: "online-monitoring" },
]

const STORAGE_KEY = "ecopilot-custom-links"

function loadCustomLinks(): LinkItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map((l: LinkItem) => ({ ...l, custom: true, connected: false })) : []
  } catch {
    return []
  }
}

function saveCustomLinks(links: LinkItem[]) {
  try {
    const plain = links.map(({ name, url, cat, desc }) => ({ name, url, cat, desc }))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plain))
  } catch { /* quota exceeded */ }
}

/** 平台登录增强卡片：账户/密码 + （排污许可）验证码自动登录 / （其他平台）无头浏览器手动登录 */
function PlatformLoginCard({ link }: { link: LinkItem }) {
  const platformId = link.platformId || "permit"
  const isPermit = platformId === "permit"
  const [cred, setCred] = useState<{ username: string; password: string }>({ username: "", password: "" })
  const [showPassword, setShowPassword] = useState(true)
  const [captcha, setCaptcha] = useState("")
  const [captchaLoading, setCaptchaLoading] = useState(false)
  const [captchaError, setCaptchaError] = useState("")
  const [captchaSessionId, setCaptchaSessionId] = useState("")
  const [captchaInput, setCaptchaInput] = useState("")
  const [loggingIn, setLoggingIn] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editUsername, setEditUsername] = useState("")
  const [editPassword, setEditPassword] = useState("")
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState("")

  const loadCred = async (attempt = 1) => {
    try {
      const c = await getPlatformCredentials(platformId)
      if (c) setCred({ username: c.username, password: c.password })
    } catch {
      // 网络错误（后端重启/不可达）时自动重试，最多 3 次
      if (attempt < 3) setTimeout(() => loadCred(attempt + 1), 1500)
    }
  }

  const refreshCaptcha = async () => {
    setCaptchaLoading(true)
    setCaptchaError("")
    try {
      const r = await initPermitLogin()
      if (r.ok && r.captcha_image) {
        setCaptcha(r.captcha_image)
        setCaptchaSessionId(r.session_id || "")
        setCaptchaInput("")
      } else {
        setCaptchaError(r.detail || "验证码获取失败")
      }
    } catch (e) {
      setCaptchaError(e instanceof Error ? e.message : "验证码获取失败")
    } finally {
      setCaptchaLoading(false)
    }
  }

  useEffect(() => {
    loadCred()
    if (isPermit) refreshCaptcha()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const login = async () => {
    if (!cred.username || !cred.password) {
      setNotice("请先编辑录入账户密码")
      return
    }
    if (!captchaInput.trim()) {
      setNotice("请输入验证码")
      return
    }
    if (!captchaSessionId) {
      setNotice("验证码已失效，请刷新")
      return
    }
    setLoggingIn(true)
    setNotice("")
    try {
      const r = await submitPermitLogin(captchaSessionId, cred.username, cred.password, captchaInput.trim())
      if (r.ok) {
        setNotice("登录成功")
        setCaptchaInput("")
        // 登录成功后，在右侧打开无头浏览器预览
        ;(window as Window & { __ecopilotBrowserSession?: string; __ecopilotBrowserTitle?: string }).__ecopilotBrowserSession = captchaSessionId
        ;(window as Window & { __ecopilotBrowserSession?: string; __ecopilotBrowserTitle?: string }).__ecopilotBrowserTitle = link.name
        window.dispatchEvent(new CustomEvent("ecopilot:open-browser"))
      } else {
        setNotice(r.detail || "登录失败")
        refreshCaptcha()
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "登录失败")
      refreshCaptcha()
    } finally {
      setLoggingIn(false)
    }
  }

  const openBrowserLogin = async () => {
    setLoggingIn(true)
    setNotice("")
    try {
      const r = await openPlatformBrowser(platformId)
      if (r.ok && r.session_id) {
        setNotice("已打开平台登录页，请在右侧画面手动登录")
        ;(window as Window & { __ecopilotBrowserSession?: string; __ecopilotBrowserTitle?: string }).__ecopilotBrowserSession = r.session_id
        ;(window as Window & { __ecopilotBrowserSession?: string; __ecopilotBrowserTitle?: string }).__ecopilotBrowserTitle = link.name
        window.dispatchEvent(new CustomEvent("ecopilot:open-browser"))
      } else {
        setNotice(r.detail || "打开失败")
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "打开失败")
    } finally {
      setLoggingIn(false)
    }
  }

  const openEdit = () => {
    setEditUsername(cred.username)
    setEditPassword(cred.password)
    setEditOpen(true)
  }

  const save = async () => {
    setSaving(true)
    setNotice("")
    try {
      const ok = await savePlatformCredentials(platformId, editUsername.trim(), editPassword)
      if (ok) {
        setCred({ username: editUsername.trim(), password: editPassword })
        setNotice("凭证已保存")
        setEditOpen(false)
      } else {
        setNotice("保存失败，请重试")
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sm:col-span-2 rounded-xl border border-eco-200 bg-card p-4">
      {/* 头部 */}
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-eco-50">
          <ShieldCheck className="size-5 text-success" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-body font-medium text-foreground">{link.name}</span>
            <span className="text-caption rounded bg-secondary px-1 py-0.5 text-muted-foreground">{link.cat}</span>
            <span className="flex items-center gap-1.5">
              <span className={cn("size-1.5 rounded-full", link.connected ? "bg-success" : "bg-warning")} />
              <span className={cn("text-caption", link.connected ? "text-success" : "text-warning")}>
                {link.connected ? "已连接" : "待测试"}
              </span>
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{link.desc}</p>
        </div>
        <a
          href={link.url} target="_blank" rel="noopener noreferrer"
          title={link.name}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-caption text-muted-foreground hover:border-eco-200 hover:text-eco-700 transition-colors"
        >
          <ExternalLink className="size-3.5" /> 打开平台
        </a>
      </div>

      {/* 账户 / 密码 */}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-secondary/40 px-3 py-2">
          <div className="flex items-center gap-1 text-caption text-muted-foreground">
            <KeyRound className="size-3" /> 账户
          </div>
          <div className="mt-0.5 font-mono text-body font-medium text-foreground">{cred.username || "未录入"}</div>
        </div>
        <div className="rounded-lg bg-secondary/40 px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-caption text-muted-foreground">
              <KeyRound className="size-3" /> 密码
            </div>
            <button
              onClick={() => setShowPassword(v => !v)}
              title={showPassword ? "隐藏密码" : "显示密码"}
              className="text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
          <div className="mt-0.5 font-mono text-body font-medium text-foreground">
            {cred.password ? (showPassword ? cred.password : "••••••••") : "未录入"}
          </div>
        </div>
      </div>

      {/* 登录区：排污许可平台=验证码自动登录；其他平台=无头浏览器手动登录 */}
      {isPermit ? (
        <div className="mt-3 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-caption font-medium text-foreground">平台登录验证码</span>
            <button
              onClick={refreshCaptcha} disabled={captchaLoading}
              className="flex items-center gap-1 text-caption text-eco-700 hover:text-eco-800 disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3.5", captchaLoading && "animate-spin")} /> 刷新
            </button>
          </div>
          {captchaLoading ? (
            <div className="flex h-12 items-center justify-center text-caption text-muted-foreground">正在获取验证码...</div>
          ) : captcha ? (
            <img src={captcha} alt="平台登录验证码" className="h-12 rounded border border-border" />
          ) : (
            <div className="flex h-12 items-center justify-center text-caption text-destructive">{captchaError || "暂无验证码"}</div>
          )}

          {/* 验证码输入 + 登录 */}
          <div className="mt-2.5 flex items-center gap-2">
            <input
              value={captchaInput} onChange={e => setCaptchaInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") login() }}
              placeholder="输入验证码"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-body text-foreground placeholder:text-muted-foreground font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-eco-500"
            />
            <button
              onClick={login}
              disabled={loggingIn || captchaLoading || !cred.username || !cred.password}
              title={(!cred.username || !cred.password) ? "请先编辑录入账户密码" : "登录"}
              className="flex shrink-0 items-center gap-1 rounded-lg bg-eco-600 px-4 py-2 text-body font-medium text-white hover:bg-eco-700 disabled:opacity-50 transition-colors"
            >
              {loggingIn ? "登录中..." : "登录"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border p-3">
          <span className="text-caption text-muted-foreground">登录需在平台页面完成，点击后打开无头浏览器手动登录</span>
          <button
            onClick={openBrowserLogin}
            disabled={loggingIn || !cred.username || !cred.password}
            title={(!cred.username || !cred.password) ? "请先编辑录入账户密码" : "登录"}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-eco-600 px-4 py-2 text-body font-medium text-white hover:bg-eco-700 disabled:opacity-50 transition-colors"
          >
            {loggingIn ? "打开中..." : "登录"}
          </button>
        </div>
      )}

      {/* 编辑 */}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-caption text-muted-foreground">{notice}</span>
        <button
          onClick={openEdit}
          className="flex items-center gap-1 rounded-lg border border-eco-200 px-2.5 py-1.5 text-caption font-medium text-eco-700 hover:bg-eco-50 transition-colors"
        >
          <Pencil className="size-3.5" /> 编辑账户密码
        </button>
      </div>

      {/* 编辑弹窗 */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30" onClick={() => setEditOpen(false)}>
          <div className="relative mx-4 w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-popover" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-body font-semibold text-foreground">编辑登录凭证</h3>
              <button onClick={() => setEditOpen(false)} className="rounded-md p-1 hover:bg-accent transition-colors">
                <X className="size-4 text-muted-foreground" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-caption font-medium text-foreground block mb-1">账户</label>
                <input
                  value={editUsername} onChange={e => setEditUsername(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-body text-foreground font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-eco-500"
                />
              </div>
              <div>
                <label className="text-caption font-medium text-foreground block mb-1">密码</label>
                <input
                  type="password" value={editPassword} onChange={e => setEditPassword(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-body text-foreground font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-eco-500"
                />
              </div>
              <button
                onClick={save} disabled={saving}
                className="w-full rounded-lg bg-eco-600 px-4 py-2 text-body font-medium text-white hover:bg-eco-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function LinksView() {
  const [cat, setCat] = useState("全部")
  const [search, setSearch] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [customLinks, setCustomLinks] = useState<LinkItem[]>([])

  // Form state
  const [formName, setFormName] = useState("")
  const [formUrl, setFormUrl] = useState("")
  const [formDesc, setFormDesc] = useState("")
  const [formCat, setFormCat] = useState("核心")
  const [formError, setFormError] = useState("")

  useEffect(() => {
    setCustomLinks(loadCustomLinks())
  }, [])

  const allLinks = [...BUILTIN_LINKS, ...customLinks]
  const hasCustom = customLinks.length > 0

  const displayCats = [...BUILTIN_CATS]
  if (hasCustom) displayCats.push("自定义")

  const q = search.trim().toLowerCase()
  const filtered = allLinks.filter(l =>
    (cat === "全部" || l.cat === cat || (cat === "自定义" && l.custom)) &&
    (!q || l.name.toLowerCase().includes(q) || l.desc.toLowerCase().includes(q)),
  )
  const connected = allLinks.filter(l => l.connected).length

  const handleAdd = () => {
    setFormError("")
    if (!formName.trim()) { setFormError("请输入平台名称"); return }
    if (!formUrl.trim()) { setFormError("请输入平台网址"); return }
    try { new URL(formUrl.trim()) } catch { setFormError("网址格式不正确（需以 http:// 或 https:// 开头）"); return }

    const newLink: LinkItem = {
      name: formName.trim(),
      url: formUrl.trim(),
      cat: formCat,
      desc: formDesc.trim() || "自定义平台",
      connected: false,
      custom: true,
    }
    const updated = [...customLinks, newLink]
    setCustomLinks(updated)
    saveCustomLinks(updated)
    setFormName("")
    setFormUrl("")
    setFormDesc("")
    setFormCat("核心")
    setShowForm(false)
  }

  const handleDelete = (name: string) => {
    const updated = customLinks.filter(l => l.name !== name)
    setCustomLinks(updated)
    saveCustomLinks(updated)
  }

  return (
    <div className="flex h-full flex-col">
      {/* 新建平台 Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30" onClick={() => setShowForm(false)}>
          <div
            className="relative mx-4 w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-popover"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-body font-semibold text-foreground">新建政务平台</h3>
              <button onClick={() => setShowForm(false)} className="rounded-md p-1 hover:bg-accent transition-colors">
                <X className="size-4 text-muted-foreground" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-caption font-medium text-foreground block mb-1">平台名称 *</label>
                <input
                  value={formName} onChange={e => setFormName(e.target.value)}
                  placeholder="如：省级排污权交易平台"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-eco-500"
                />
              </div>
              <div>
                <label className="text-caption font-medium text-foreground block mb-1">网址 *</label>
                <input
                  value={formUrl} onChange={e => setFormUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-eco-500 font-mono"
                />
              </div>
              <div>
                <label className="text-caption font-medium text-foreground block mb-1">描述</label>
                <input
                  value={formDesc} onChange={e => setFormDesc(e.target.value)}
                  placeholder="简要说明平台用途"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-eco-500"
                />
              </div>
              <div>
                <label className="text-caption font-medium text-foreground block mb-1">分类</label>
                <select
                  value={formCat} onChange={e => setFormCat(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-body text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-eco-500"
                >
                  {BUILTIN_CATS.filter(c => c !== "全部").map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {formError && (
                <p className="text-caption text-destructive bg-destructive/5 rounded-lg px-3 py-1.5">{formError}</p>
              )}

              <button
                onClick={handleAdd}
                className="w-full rounded-lg bg-eco-600 px-4 py-2 text-body font-medium text-white hover:bg-eco-700 transition-colors"
              >
                确认添加
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-header */}
      <header className="flex shrink-0 items-center justify-between border-b border-border px-6 py-2.5">
        <p className="text-caption text-muted-foreground">
          {BUILTIN_LINKS.length} 个官方入口{hasCustom ? ` + ${customLinks.length} 个自定义` : ""} · 新窗口打开
        </p>
        <div className="flex items-center gap-3">
          <span className="text-caption text-muted-foreground">已连接 {connected}/{allLinks.length}</span>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1 rounded-lg bg-eco-600 px-3 py-1.5 text-caption font-medium text-white hover:bg-eco-700 transition-colors"
          >
            <Plus className="size-3.5" />
            新建平台
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-4xl space-y-5">
          {/* Category tabs */}
          <div className="flex flex-wrap gap-1.5">
            {displayCats.map(c => {
              const isCustomCat = c === "自定义"
              return (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs transition-colors",
                    c === cat
                      ? "bg-eco-50 text-eco-700 font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent",
                    isCustomCat && "border border-dashed border-eco-300",
                  )}
                >
                  {c}
                  {isCustomCat && ` (${customLinks.length})`}
                </button>
              )
            })}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              aria-label="搜索政务平台" placeholder="搜索平台名称或描述..."
              className="w-full rounded-xl border border-border bg-card pl-10 pr-4 py-2.5 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-eco-500"
            />
          </div>

          {/* Link cards */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {filtered.length === 0 ? (
              <div className="col-span-full rounded-xl border border-dashed border-border bg-card p-8 text-center">
                <p className="text-body text-muted-foreground">未找到匹配的政务平台</p>
                <p className="text-caption text-muted-foreground mt-1">尝试更换关键词或切换分类</p>
              </div>
            ) : (
              filtered.map(l => {
                if (l.platformId) {
                  return <PlatformLoginCard key={l.name} link={l} />
                }
                return (
                <div key={l.name + (l.custom ? "-custom" : "")} className="group relative">
                  <a
                    href={l.url} target="_blank" rel="noopener noreferrer" title={l.name}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border bg-card p-4 hover:border-eco-200 transition-colors",
                      l.custom
                        ? "border-dashed border-eco-300"
                        : l.connected
                          ? "border-border"
                          : "border-warning/30 bg-warning/10",
                    )}
                  >
                    <div className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-lg",
                      l.custom ? "bg-eco-50" : l.connected ? "bg-eco-50" : "bg-warning/10",
                    )}>
                      {l.custom ? <Globe className="size-5 text-eco-600" />
                        : l.connected ? <ShieldCheck className="size-5 text-success" />
                        : l.soon ? <Clock className="size-5 text-muted-foreground" />
                        : <WifiOff className="size-5 text-warning" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-body font-medium text-foreground group-hover:text-eco-700">{l.name}</span>
                        <span className={cn("text-caption rounded px-1 py-0.5", l.custom ? "bg-eco-50 text-eco-700" : "bg-secondary text-muted-foreground")}>
                          {l.custom ? "自定义" : l.cat}
                        </span>
                        {l.soon && (
                          <span className="text-caption rounded bg-info/10 px-1.5 py-0.5 font-medium text-info">即将上线</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{l.desc}</p>
                      <div className="flex items-center gap-1.5 mt-2">
                        <span className={cn("size-1.5 rounded-full", l.connected ? "bg-success" : "bg-warning")} />
                        <span className={cn("text-caption", l.connected ? "text-success" : "text-warning")}>
                          {l.connected ? "已连接" : l.custom ? "自定义" : "待测试"}
                        </span>
                      </div>
                    </div>
                    <ExternalLink className="size-4 text-muted-foreground group-hover:text-eco-600 shrink-0 mt-1" />
                  </a>

                  {/* Delete button for custom links */}
                  {l.custom && (
                    <button
                      onClick={e => {
                        e.preventDefault()
                        handleDelete(l.name)
                      }}
                      title="删除自定义平台"
                      className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-destructive text-white shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/90"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
