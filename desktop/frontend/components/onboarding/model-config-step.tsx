"use client"
import { useEffect, useRef, useState } from "react"
import {
  ArrowRight, Loader2, AlertCircle, Eye, EyeOff, ChevronDown, KeyRound,
  PlugZap, ShieldCheck, Check, BrainCircuit,
} from "lucide-react"
import { useOnboarding } from "@/lib/onboarding-store"
import { StepNav } from "./step-nav"
import { wakeHermes, apiPost } from "@/lib/api"
import { onboardingLog, startTimer } from "@/lib/onboarding-log"
import { cn } from "@/lib/utils"

type WakeStatus = "idle" | "waking" | "ready" | "failed"
type TestState = { ok: boolean; detail: string } | null

/** 国内主流大模型列表（token 聚合包预留，后续可扩展为动态拉取） */
const MODELS = [
  { id: "deepseek-v4-flash", name: "DeepSeek V4-Flash", brand: "深度求索", desc: "速度优先 · 高并发", tag: "推荐", provider: "deepseek" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4-Pro", brand: "深度求索", desc: "性能优先 · 复杂推理", tag: "旗舰", provider: "deepseek" },
  { id: "kimi-k2.5", name: "Kimi K2", brand: "月之暗面", desc: "长文本 · 联网搜索", provider: "kimi" },
  { id: "qwen-max", name: "通义千问 Qwen-Max", brand: "阿里", desc: "通用能力 · 多场景", provider: "qwen" },
  { id: "glm-4-plus", name: "智谱 GLM-4-Plus", brand: "智谱", desc: "综合对话 · 智能体", provider: "glm" },
  { id: "doubao-pro", name: "豆包 Doubao-Pro", brand: "字节跳动", desc: "通用对话 · 多模态", provider: "doubao" },
  { id: "abab6.5s", name: "MiniMax", brand: "MiniMax", desc: "通用对话 · 创作", provider: "minimax" },
  { id: "spark-max", name: "讯飞星火 Spark-Max", brand: "科大讯飞", desc: "通用对话 · 教育", provider: "spark" },
]

function currentModel(id: string) {
  return MODELS.find(m => m.id === id) || MODELS[0]
}

/** API 密钥占位符随模型切换 */
function keyPlaceholder(id: string): string {
  const brand = currentModel(id).brand
  return `sk-...（${brand} API 密钥）`
}

export function ModelConfigStep() {
  const { setStep, setModelReady, setHermesReady } = useOnboarding()

  const [textModel, setTextModel] = useState("deepseek-v4-flash")
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestState>(null)
  const [wakeStatus, setWakeStatus] = useState<WakeStatus>("idle")
  const [wakeError, setWakeError] = useState("")

  const dropdownRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const selected = currentModel(textModel)
  const canTest = selected.provider === "deepseek" || selected.provider === "kimi"

  const testConnection = async () => {
    if (!canTest) {
      setTestResult({ ok: false, detail: `${selected.name} 暂不支持连接测试，可直接填写密钥使用` })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const r = await apiPost<{ ok: boolean; detail: string }>("/api/models/test", {
        provider: selected.provider,
        api_key: apiKey,
      })
      if (r.ok && r.data?.ok) {
        setTestResult({ ok: true, detail: r.data.detail || "连接成功" })
      } else {
        setTestResult({ ok: false, detail: r.error || r.data?.detail || "连接失败" })
      }
    } catch (e) {
      setTestResult({ ok: false, detail: e instanceof Error ? e.message : "连接失败" })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 items-center justify-between border-b border-border px-5">
        <button onClick={() => setStep("brand")} aria-label="返回上一步" className="flex items-center gap-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors -ml-1 px-1 py-1">
          <img src="/eco-logo.svg" alt="EcoPilot" className="h-7 w-auto object-contain" />
          <span className="text-body font-bold tracking-tight text-foreground">Pilot</span>
        </button>
        <StepNav current="model-config" />
      </header>

      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-lg px-8 py-8 space-y-6">
          <div className="text-center space-y-2">
            <img src="/eco-logo.svg" alt="EcoPilot" className="size-14 mx-auto rounded-2xl object-contain" />
            <h2 className="text-display font-bold text-foreground">配置模型</h2>
            <p className="text-sm text-muted-foreground">选择国内大模型并填写 API 密钥</p>
          </div>

          {/* 大模型选择框 */}
          <section className="space-y-3">
            <label className="text-sm font-semibold text-foreground">大模型</label>
            <div ref={dropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setDropdownOpen(v => !v)}
                aria-expanded={dropdownOpen}
                className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-all hover:border-eco-300"
              >
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-eco-500 text-white">
                  <BrainCircuit className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{selected.name}</span>
                    {selected.tag && (
                      <span className={cn(
                        "rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                        selected.tag === "推荐" ? "bg-eco-100 text-eco-700" : "bg-violet-100 text-violet-700",
                      )}>
                        {selected.tag}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{selected.brand} · {selected.desc}</p>
                </div>
                <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", dropdownOpen && "rotate-180")} />
              </button>

              {dropdownOpen && (
                <div className="absolute left-0 right-0 top-full z-20 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-border bg-card p-1.5 shadow-xl shadow-black/5">
                  {MODELS.map(m => {
                    const active = textModel === m.id
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => { setTextModel(m.id); setDropdownOpen(false); setTestResult(null) }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors",
                          active ? "bg-eco-50/70" : "hover:bg-accent/60",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground">{m.name}</span>
                            {m.tag && (
                              <span className={cn(
                                "rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                                m.tag === "推荐" ? "bg-eco-100 text-eco-700" : "bg-violet-100 text-violet-700",
                              )}>
                                {m.tag}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{m.brand} · {m.desc}</p>
                        </div>
                        {active && <Check className="size-4 shrink-0 text-eco-500" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </section>

          {/* API 密钥 */}
          <section className="space-y-3">
            <label className="text-sm font-semibold text-foreground">API 密钥</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={e => { setApiKey(e.target.value); setTestResult(null) }}
                  placeholder={keyPlaceholder(textModel)}
                  className="w-full rounded-xl border border-border bg-card py-3 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-eco-500/30"
                />
                <button type="button" onClick={() => setShowKey(v => !v)} aria-label="显示密钥"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                  {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <button type="button" onClick={testConnection} disabled={testing}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-4 text-sm font-medium text-foreground hover:border-eco-300 hover:text-eco-600 transition-colors disabled:opacity-50">
                {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                测试
              </button>
            </div>
            {testResult && (
              <div className={cn(
                "flex items-start gap-2 rounded-xl border p-3 text-xs",
                testResult.ok ? "border-emerald-200 bg-emerald-50/50 text-emerald-700" : "border-destructive/20 bg-destructive/5 text-destructive",
              )}>
                {testResult.ok
                  ? <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  : <AlertCircle className="mt-0.5 size-4 shrink-0" />}
                <span>{testResult.detail}</span>
              </div>
            )}
          </section>

          <div className="flex justify-center pt-1">
            <button onClick={async () => {
              onboardingLog.onboarding.info("model_config_save_start", {
                text_model: textModel,
                has_key: !!apiKey,
              })
              const saveTimer = startTimer()
              try {
                await apiPost("/api/models/save", {
                  text_api_key: apiKey,
                  text_model: textModel,
                })
                onboardingLog.onboarding.info("model_config_save_done", { ms: saveTimer() })
              } catch (e) {
                onboardingLog.onboarding.warn("model_config_save_failed", {
                  ms: saveTimer(),
                  error: e instanceof Error ? e.message : String(e),
                })
              }
              setModelReady(textModel, "")

              onboardingLog.hermes.info("wake_start", { text_model: textModel })
              setWakeStatus("waking")
              setWakeError("")
              const wakeTimer = startTimer()
              try {
                const result = await wakeHermes()
                if (result.ok && result.hermes_session_id) {
                  setHermesReady(result.hermes_session_id)
                  setWakeStatus("ready")
                  setTimeout(() => setStep("platform-login"), 800)
                  return
                }
                setWakeStatus("ready")
                setTimeout(() => setStep("platform-login"), 600)
              } catch (e) {
                const errMsg = e instanceof Error ? e.message : "Hermes 唤醒失败"
                onboardingLog.hermes.error("wake_failed", { ms: wakeTimer(), error: errMsg })
                setWakeStatus("failed")
                setWakeError(errMsg)
                setTimeout(() => setStep("platform-login"), 1200)
              }
            }} disabled={wakeStatus === "waking"}
              className="flex items-center gap-2 rounded-2xl bg-eco-500 px-12 py-3.5 text-base font-semibold text-white shadow-lg shadow-eco-500/25 hover:bg-eco-500 hover:shadow-xl hover:shadow-eco-500/35 active:scale-[0.98] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none">
              {wakeStatus === "waking" ? (
                <><Loader2 className="size-5 animate-spin" /> 唤醒 Hermes 中...</>
              ) : wakeStatus === "ready" ? (
                <><BrainCircuit className="size-5" /> Hermes 已就绪</>
              ) : wakeStatus === "failed" ? (
                <>跳过唤醒，继续 <ArrowRight className="size-5" /></>
              ) : (
                <>下一步 <ArrowRight className="size-5" /></>
              )}
            </button>
          </div>

          {wakeStatus === "waking" && (
            <div className="rounded-xl border border-eco-200 bg-eco-50/50 p-3 text-xs text-eco-700 flex items-center gap-2">
              <BrainCircuit className="size-4 animate-pulse text-eco-500" />
              正在唤醒 Hermes Agent：初始化引擎、加载记忆系统...
            </div>
          )}
          {wakeStatus === "failed" && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-xs text-amber-700 flex items-center gap-2">
              <AlertCircle className="size-4 text-amber-500" />
              Hermes 唤醒失败：{wakeError || "未知错误"}。可稍后在设置中重试，不阻塞当前流程。
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
