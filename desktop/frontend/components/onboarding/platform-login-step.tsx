"use client"
import { useState, useEffect } from "react"
import { ShieldCheck, Loader2, AlertTriangle, ArrowLeft, Eye, EyeOff, Lock, KeyRound, RefreshCw, User, ScanLine } from "lucide-react"
import { useOnboarding } from "@/lib/onboarding-store"
import { StepNav } from "./step-nav"
import { initPermitLogin, submitPermitLogin } from "@/lib/api"

export function PlatformLoginStep() {
  const { state, setStep, setLoginMethod, setSessionId } = useOnboarding()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [captcha, setCaptcha] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [sessionId, setLocalSessionId] = useState("")
  const [captchaImage, setCaptchaImage] = useState("")
  const [initLoading, setInitLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [attempts, setAttempts] = useState(0)
  const [initError, setInitError] = useState("")

  // 页面加载时自动初始化会话，获取验证码图片
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      setInitLoading(true)
      setInitError("")
      try {
        const res = await initPermitLogin()
        if (cancelled) return
        if (res.ok && res.captcha_image) {
          setLocalSessionId(res.session_id)
          setCaptchaImage(res.captcha_image)
        } else {
          setInitError(res.detail || "无法连接排污许可平台，请检查网络后重试")
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setInitError(e instanceof Error ? e.message : "连接失败，请确认后端服务已启动")
        }
      } finally {
        if (!cancelled) setInitLoading(false)
      }
    }
    init()
    return () => { cancelled = true }
  }, [])

  // 刷新验证码（重新启动会话）
  const handleRefreshCaptcha = async () => {
    setInitLoading(true)
    setInitError("")
    setCaptcha("")
    setError("")
    try {
      const res = await initPermitLogin()
      if (res.ok && res.captcha_image) {
        setLocalSessionId(res.session_id)
        setCaptchaImage(res.captcha_image)
      } else {
        setInitError(res.detail || "验证码刷新失败")
      }
    } catch (e: unknown) {
      setInitError(e instanceof Error ? e.message : "刷新失败")
    } finally {
      setInitLoading(false)
    }
  }

  // 提交登录
  const handleLogin = async () => {
    if (!username.trim() || !password.trim() || !captcha.trim() || !sessionId) return
    setSubmitting(true)
    setError("")
    try {
      const result = await submitPermitLogin(sessionId, username, password, captcha)
      if (result.ok) {
        setLoginMethod("quick")
        setSessionId(result.session_id || sessionId)
        setStep("permit-reading")
      } else {
        setAttempts(a => a + 1)
        setError(result.detail || "登录失败")
        // 验证码错误时自动刷新验证码
        if (result.detail && result.detail.includes("验证码")) {
          setCaptcha("")
          handleRefreshCaptcha()
        }
      }
    } catch (e: unknown) {
      setAttempts(a => a + 1)
      const msg = e instanceof Error ? e.message : "登录失败"
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && username.trim() && password.trim() && captcha.trim() && !submitting) {
      handleLogin()
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-2">
          <button onClick={() => setStep("model-config")} aria-label="返回上一步" className="rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"><ArrowLeft className="size-4" /></button>
          <div className="flex size-6 items-center justify-center rounded-md bg-eco-600 text-xs font-bold text-white">E</div>
          <span className="text-body font-semibold">EcoPilot</span>
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
          {/* 初始化错误 */}
          {initError && (
            <div role="alert" aria-live="assertive" className="flex items-start gap-2 rounded-xl bg-destructive/10 px-4 py-3 text-body text-destructive">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div>{initError}</div>
                <button onClick={handleRefreshCaptcha} className="mt-1 text-xs underline text-eco-700">重试连接</button>
              </div>
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
              disabled={submitting || initLoading}
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
                disabled={submitting || initLoading}
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

          {/* 验证码：平台图片 + 输入框 */}
          <div>
            <label htmlFor="permit-captcha" className="mb-1.5 flex items-center gap-1.5 text-body font-medium text-foreground">
              <ScanLine className="size-3.5 text-muted-foreground" /> 验证码
              <span className="text-xs text-muted-foreground font-normal">（来自排污许可平台）</span>
            </label>
            <div className="flex gap-2">
              <input
                id="permit-captcha"
                type="text"
                value={captcha}
                onChange={e => setCaptcha(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入图中验证码"
                disabled={submitting || initLoading || !captchaImage}
                maxLength={6}
                autoComplete="off"
                className="flex-1 rounded-xl border border-border bg-card px-4 py-2.5 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-eco-500 disabled:opacity-50"
              />
              {/* 平台验证码图片 */}
              <button
                type="button"
                onClick={handleRefreshCaptcha}
                disabled={initLoading || submitting}
                aria-label="点击刷新验证码"
                title="点击刷新验证码"
                className="relative h-[42px] w-[110px] shrink-0 overflow-hidden rounded-xl border border-border bg-muted hover:border-eco-400 transition-colors disabled:opacity-50"
              >
                {initLoading ? (
                  <div className="flex h-full w-full items-center justify-center">
                    <Loader2 className="size-4 text-eco-600 animate-spin" />
                  </div>
                ) : captchaImage ? (
                  <>
                    <img src={captchaImage} alt="平台验证码" className="h-full w-full object-cover" />
                    <div className="absolute bottom-0 right-0 rounded-tl bg-background/80 p-0.5">
                      <RefreshCw className="size-3 text-muted-foreground" />
                    </div>
                  </>
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    点击获取
                  </div>
                )}
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">看不清？点击图片刷新验证码</p>
          </div>

          {/* 登录错误 */}
          {error && (
            <div role="alert" aria-live="assertive" className="flex items-start gap-2 rounded-xl bg-destructive/10 px-4 py-3 text-body text-destructive dark:bg-destructive/20 dark:text-destructive">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div>{error}</div>
                {attempts >= 2 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    提示：请确认账号密码是否正确。验证码错误时会自动刷新。
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 登录按钮 */}
          <button
            onClick={handleLogin}
            disabled={submitting || initLoading || !username.trim() || !password.trim() || !captcha.trim() || !sessionId}
            aria-label="登录排污许可平台"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-eco-600 px-6 py-3 text-body font-semibold text-white shadow-modal hover:bg-eco-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <><Loader2 className="size-4 animate-spin" />提交登录中...</>
            ) : (
              <>登录</>
            )}
          </button>

          <div className="space-y-1 text-center">
            <p className="text-xs text-muted-foreground">🔒 凭据仅通过本地后端传输，密码经 RSA 加密后提交至排污许可平台</p>
            <p className="text-xs text-muted-foreground">已选文本模型：<span className="text-eco-700 font-medium">{state.textModel || "默认"}</span> · 视觉模型：<span className="text-eco-700 font-medium">{state.visionModel || "默认"}</span></p>
          </div>
        </div>
      </div>
    </div>
  )
}
