"use client"
import { useState, useRef } from "react"
import { ShieldCheck, ArrowRight, Loader2, CheckCircle2, ArrowLeft, BrainCircuit } from "lucide-react"
import { useOnboarding } from "@/lib/onboarding-store"
import { apiPost, saveToHermesMemory } from "@/lib/api"
import { onboardingLog, startTimer } from "@/lib/onboarding-log"
import { StepNav } from "./step-nav"

const SMS_DEV_HINT_PREFIX = "验证码已发送"
const SMS_LENGTH = 4

export function RegisterStep() {
  const { state, setStep, setUser } = useOnboarding()
  const [phone, setPhone] = useState(state.phone || "")
  const [name, setName] = useState(state.name || "")
  const [role, setRole] = useState(state.role || "环保专员")
  const [code, setCode] = useState("")
  const [sent, setSent] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [sending, setSending] = useState(false)
  const [smsError, setSmsError] = useState<string | null>(null)
  const [smsHint, setSmsHint] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startCountdown = () => {
    setCountdown(60)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setCountdown(p => {
        if (p <= 1) {
          if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
          return 0
        }
        return p - 1
      })
    }, 1000)
  }

  const handleSend = async () => {
    const clean = phone.replace(/\s/g, "")
    if (!clean.match(/^\d{11}$/)) {
      setSmsError("手机号格式不正确")
      return
    }
    setSmsError(null)
    setSmsHint(null)
    setSending(true)
    const { ok, data, error } = await apiPost<{ ok: boolean; detail?: string; code?: string }>(
      "/api/chat/send-sms",
      { phone: clean }
    )
    setSending(false)
    if (!ok) {
      setSmsError(error || "验证码发送失败")
      return
    }
    setSent(true)
    startCountdown()
    // 后端在开发模式返回 code 字段，显示给用户方便测试
    const detail = data?.detail || ""
    if (detail.startsWith(SMS_DEV_HINT_PREFIX) && data?.code) {
      setSmsHint(`开发模式验证码：${data.code}（生产环境将以短信发送）`)
    } else {
      setSmsHint("验证码已发送，5 分钟内有效")
    }
  }

  const handleSubmit = async () => {
    setSubmitError(null)
    const cleanPhone = phone.replace(/\s/g, "")
    if (!cleanPhone.match(/^\d{11}$/)) {
      setSubmitError("手机号格式不正确")
      return
    }
    if (name.trim().length === 0) {
      setSubmitError("请填写称呼")
      return
    }
    if (code.trim().length !== SMS_LENGTH) {
      setSubmitError(`请输入 ${SMS_LENGTH} 位验证码`)
      return
    }

    setSubmitting(true)
    // 校验验证码
    const verify = await apiPost<{ ok: boolean; detail?: string }>(
      "/api/chat/verify-sms",
      { phone: cleanPhone, code: code.trim() }
    )
    if (!verify.ok) {
      setSubmitting(false)
      setSubmitError(verify.error || verify.data?.detail || "验证码校验失败")
      return
    }

    setUser(cleanPhone, name.trim(), role)

    // 持久化用户信息到后端，主应用侧栏/个人档案会读取
    onboardingLog.onboarding.info("user_save_start", {
      phone: cleanPhone,
      name: name.trim(),
      role,
    })
    const saveTimer = startTimer()
    const saveRes = await apiPost("/api/user", { name: name.trim(), role, phone: cleanPhone })
    if (!saveRes.ok) {
      onboardingLog.onboarding.warn("user_save_failed", {
        ms: saveTimer(),
        error: saveRes.error,
      })
    } else {
      onboardingLog.onboarding.info("user_save_done", { ms: saveTimer() })
    }

    // 写入用户画像到 Hermes 记忆 — 实现"越用越懂"
    // 后续对话中 Hermes 会基于此用户上下文动态调整 SOUL（称呼/角色/偏好）
    onboardingLog.hermes.info("user_memory_write_start", {
      target: "user",
      id: cleanPhone,
      name: name.trim(),
      role,
    })
    const memTimer = startTimer()
    try {
      await saveToHermesMemory("user", cleanPhone, {
        name: name.trim(),
        role,
        phone: cleanPhone,
        registered_at: new Date().toISOString(),
        source: "onboarding_register",
      })
      onboardingLog.hermes.info("user_memory_write_done", {
        ms: memTimer(),
        target: "user",
        name: name.trim(),
      })
    } catch (e) {
      // Hermes 记忆写入失败不阻塞注册流程
      onboardingLog.hermes.error("user_memory_write_failed", {
        ms: memTimer(),
        target: "user",
        error: e instanceof Error ? e.message : String(e),
      })
    }

    setSubmitting(false)
    onboardingLog.onboarding.info("onboarding_complete", {
      phone: cleanPhone,
      name: name.trim(),
      role,
    })
    // Navigate to main app
    if (typeof window !== "undefined") {
      localStorage.setItem("ecopilot-onboarding-done", "true")
      // 标记首次进入：对话框自动展示许可证信息卡片 + 看板入口
      localStorage.setItem("ecopilot-first-entry", "1")
      // 清空旧的会话记录，让新注册用户从干净状态开始（避免残留历史测试/旧企业会话）
      try {
        const raw = localStorage.getItem("ecopilot_state")
        if (raw) {
          const st = JSON.parse(raw)
          if (Array.isArray(st.conversations) && st.conversations.length > 0) {
            st.conversations = []
            st.activeConversationId = null
            localStorage.setItem("ecopilot_state", JSON.stringify(st))
          }
        }
      } catch { /* 清空失败不阻塞跳转 */ }
      window.location.href = "/"
    }
  }

  const canSubmit =
    phone.replace(/\s/g, "").length === 11 &&
    name.trim().length > 0 &&
    code.trim().length === SMS_LENGTH &&
    !submitting

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-2">
          <button onClick={() => setStep("permit-reading")} aria-label="返回上一步" className="rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"><ArrowLeft className="size-4" /></button>
          <img src="/eco-logo.svg" alt="EcoPilot" className="h-6 w-auto object-contain" />
          <span className="text-body font-semibold">Pilot</span>
        </div>
        <StepNav current="register" />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 bg-gradient-to-b from-eco-50 to-background">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-eco-600/10">
          <CheckCircle2 className="size-8 text-eco-600" />
        </div>
        <div className="text-center">
          <h2 className="text-display font-bold text-foreground">最后一步</h2>
          <p className="mt-2 text-body text-muted-foreground max-w-sm">绑定手机号，完成注册。您的合规管家已准备好为企业服务。</p>
        </div>

        <div className="w-full max-w-sm space-y-4">
          <div>
            <label className="mb-1.5 block text-body font-medium text-foreground">手机号</label>
            <div className="flex gap-2">
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
                placeholder="请输入手机号" className="flex-1 rounded-xl border border-border bg-card px-4 py-2.5 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-eco-500" />
              <button onClick={handleSend} disabled={countdown > 0 || sending || phone.length < 11}
                className="shrink-0 rounded-xl border border-eco-500 bg-eco-50 px-4 py-2.5 text-body font-medium text-eco-700 hover:bg-eco-100 disabled:opacity-40 transition-colors">
                {sending ? <Loader2 className="size-4 animate-spin" /> : sent ? (countdown > 0 ? `${countdown}s` : "重新发送") : "发送验证码"}
              </button>
            </div>
            {smsError && <p className="mt-1.5 text-xs text-destructive">{smsError}</p>}
            {smsHint && <p className="mt-1.5 text-xs text-info">{smsHint}</p>}
          </div>
          {sent && (
            <div>
              <label className="mb-1.5 block text-body font-medium text-foreground">验证码</label>
              <input type="text" inputMode="numeric" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, SMS_LENGTH))}
                placeholder={`请输入 ${SMS_LENGTH} 位验证码`} maxLength={SMS_LENGTH}
                className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-body text-foreground tracking-widest placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-eco-500" />
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-body font-medium text-foreground">称呼</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="怎么称呼您"
              className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-eco-500" />
          </div>
          <div>
            <label className="mb-1.5 block text-body font-medium text-foreground">角色</label>
            <select value={role} onChange={e => setRole(e.target.value)}
              className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-eco-500">
              {["环保专员", "厂长", "安环部长", "第三方咨询"].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {submitError && <p className="text-xs text-destructive text-center">{submitError}</p>}

          <button onClick={handleSubmit} disabled={!canSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-eco-600 px-6 py-3 text-body font-semibold text-white shadow-modal shadow-eco-600/25 hover:bg-eco-700 transition-colors disabled:opacity-50">
            {submitting ? <><Loader2 className="size-4 animate-spin" /> 正在进入</> : <>进入 EcoPilot <ArrowRight className="size-4" /></>}
          </button>
          <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <BrainCircuit className="size-3 text-eco-500" />
            <span>注册后将记住您的称呼与角色，对话中自动个性化</span>
          </div>
          <p className="text-center text-xs text-muted-foreground">注册即代表同意 EcoPilot 服务协议与隐私政策</p>
        </div>
      </div>
    </div>
  )
}
