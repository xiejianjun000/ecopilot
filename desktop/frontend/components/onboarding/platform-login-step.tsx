"use client"
import { useState, useEffect } from "react"
import { ShieldCheck, Loader2, AlertTriangle, ArrowLeft, Eye, EyeOff, Lock, KeyRound, User } from "lucide-react"
import { useOnboarding } from "@/lib/onboarding-store"
import { StepNav } from "./step-nav"
import { devBypassLogin, loginPermitMcp, savePermitCredentials } from "@/lib/api"

export function PlatformLoginStep() {
  const { state, setStep, setLoginMethod, setSessionId } = useOnboarding()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [isDevMode, setIsDevMode] = useState(false)
  const [devSkipping, setDevSkipping] = useState(false)

  // 检测开发模式是否可用（用于「开发模式跳过」按钮显示）
  useEffect(() => {
    const checkDev = async () => {
      try {
        const devRes = await devBypassLogin()
        if (devRes.ok) setIsDevMode(true)
      } catch {}
    }
    checkDev()
  }, [])

  // 提交登录：通过 MCP（eco-permit-enterprise）auth_login，无需验证码/浏览器
  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) return
    setSubmitting(true)
    setError("")
    try {
      const result = await loginPermitMcp(username.trim(), password)
      if (result.ok) {
        setLoginMethod("quick")
        setSessionId(result.session_id || "__mcp__")
        setStep("permit-reading")
      } else {
        setError(result.detail || "登录失败")
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "登录失败")
    } finally {
      setSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && username.trim() && password.trim() && !submitting) {
      handleLogin()
    }
  }

  // 开发模式跳过登录
  const handleDevSkip = async () => {
    setDevSkipping(true)
    setError("")
    try {
      const result = await devBypassLogin()
      if (result.ok) {
        setLoginMethod("quick")
        setSessionId(result.session_id)
        // 若用户已输入账号密码，则保存凭据并重启 MCP（供后续数据读取自动重登）
        if (username.trim() && password.trim()) {
          try {
            await savePermitCredentials(username.trim(), password)
          } catch (e) {
            console.warn("[PlatformLogin] 开发模式 MCP 凭据保存失败:", e)
          }
        }
        setStep("permit-reading")
      } else {
        setError(result.detail || "开发模式跳过失败")
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "跳过失败")
    } finally {
      setDevSkipping(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-2">
          <button onClick={() => setStep("model-config")} aria-label="返回上一步" className="rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"><ArrowLeft className="size-4" /></button>
          <img src="/eco-logo.svg" alt="EcoPilot" className="h-6 w-auto object-contain" />
          <span className="text-body font-semibold">Pilot</span>
        </div>
        <StepNav current="platform-login" />
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 bg-gradient-to-b from-eco-50 to-background overflow-y-auto py-8">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-eco-600/10">
          <ShieldCheck className="size-8 text-eco-600" />
        </div>

        <div className="text-center">
          <h2 className="text-display font-bold text-foreground">登录排污许可平台</h2>
          <p className="mt-2 text-body text-muted-foreground max-w-sm">
            仅持证单位可使用 EcoPilot，请输入全国排污许可证管理信息平台账号
          </p>
          <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-eco-100 px-3 py-1 text-xs text-eco-700">
            <Lock className="size-3" />
            <span>强制验证 · 不可跳过</span>
          </div>
        </div>

        <div className="w-full max-w-sm space-y-4">
          {/* 登录错误 */}
          {error && (
            <div role="alert" aria-live="assertive" className="flex items-start gap-2 rounded-xl bg-destructive/10 px-4 py-3 text-body text-destructive">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" />
              <div className="flex-1">{error}</div>
            </div>
          )}

          {/* 账号 */}
          <div>
            <label htmlFor="permit-username" className="mb-1.5 flex items-center gap-1.5 text-body font-medium text-foreground">
              <User className="size-3.5 text-muted-foreground" /> 账号
            </label>
            <input
              id="permit-username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="请输入平台账号"
              disabled={submitting}
              autoComplete="username"
              className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-eco-500 disabled:opacity-50"
            />
          </div>

          {/* 密码 */}
          <div>
            <label htmlFor="permit-password" className="mb-1.5 flex items-center gap-1.5 text-body font-medium text-foreground">
              <KeyRound className="size-3.5 text-muted-foreground" /> 密码
            </label>
            <div className="relative">
              <input
                id="permit-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="请输入平台密码"
                disabled={submitting}
                autoComplete="current-password"
                className="w-full rounded-xl border border-border bg-card px-4 py-2.5 pr-11 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-eco-500 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {/* 登录按钮 */}
          <button
            onClick={handleLogin}
            disabled={submitting || !username.trim() || !password.trim()}
            aria-label="登录排污许可平台"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-eco-600 px-6 py-3 text-body font-semibold text-white shadow-modal hover:bg-eco-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <><Loader2 className="size-4 animate-spin" />正在登录（验证码自动识别）...</>
            ) : (
              <>登录</>
            )}
          </button>

          {/* 开发模式跳过按钮 — 仅开发模式（ECOPILOT_DEV=1）显示；生产环境与「强制验证·不可跳过」保持一致 */}
          {isDevMode && (
            <div className="text-center">
              <button
                onClick={handleDevSkip}
                disabled={devSkipping}
                aria-label="开发模式跳过平台登录"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-6 py-2.5 text-body font-medium text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50"
              >
                {devSkipping ? <><Loader2 className="size-4 animate-spin" />跳过中...</> : <>开发模式 · 跳过平台登录</>}
              </button>
            </div>
          )}

          <div className="space-y-1 text-center">
            <p className="text-xs text-muted-foreground">🔒 凭据仅通过本地后端传输，密码经 RSA 加密后提交至排污许可平台</p>
            <p className="text-xs text-muted-foreground">已选文本模型：<span className="text-eco-700 font-medium">{state.textModel || "默认"}</span> · 视觉模型：<span className="text-eco-700 font-medium">{state.visionModel || "默认"}</span></p>
          </div>
        </div>
      </div>
    </div>
  )
}
