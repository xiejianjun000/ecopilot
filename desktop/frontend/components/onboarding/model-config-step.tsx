"use client"
import { useEffect, useState } from "react"
import { ArrowRight, ArrowLeft, Loader2, Check, Sparkles, Eye, FileText, AlertCircle } from "lucide-react"
import { useOnboarding } from "@/lib/onboarding-store"
import { StepNav } from "./step-nav"
import { getAvailableModels, type ModelInfo } from "@/lib/api"

export function ModelConfigStep() {
  const { setStep, setModelReady } = useOnboarding()
  const [loading, setLoading] = useState(true)
  const [textModels, setTextModels] = useState<ModelInfo[]>([])
  const [visionModels, setVisionModels] = useState<ModelInfo[]>([])
  const [selectedText, setSelectedText] = useState("")
  const [selectedVision, setSelectedVision] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const data = await getAvailableModels()
        if (cancelled) return
        setTextModels(data.text_models)
        setVisionModels(data.vision_models)
        setSelectedText(data.default_text || data.text_models.find(m => m.available)?.id || "")
        setSelectedVision(data.default_vision || data.vision_models.find(m => m.available)?.id || "")
        setLoading(false)
      } catch (e) { console.error("[onboarding] Health check failed:", e)
        if (!cancelled) {
          setError("后端未连接，请确认 EcoPilot 后端已启动")
          setLoading(false)
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const canProceed = selectedText && selectedVision && !error

  const handleProceed = () => {
    if (!canProceed) return
    setModelReady(selectedText, selectedVision)
    setStep("platform-login")
  }

  const handleRetry = () => {
    setError("")
    setLoading(true)
    setTimeout(() => window.location.reload(), 100)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-2">
          <button onClick={() => setStep("brand")} aria-label="返回上一步" className="rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"><ArrowLeft className="size-4" /></button>
          <div className="flex size-6 items-center justify-center rounded-md bg-eco-600 text-xs font-bold text-white">E</div>
          <span className="text-body font-semibold">EcoPilot</span>
        </div>
        <StepNav current="model-config" />
      </header>

      <div className="flex flex-1 flex-col overflow-y-auto bg-gradient-to-b from-eco-50/30 to-background">
        <div className="mx-auto w-full max-w-3xl px-6 py-8 space-y-6">
          {/* 标题 */}
          <div className="text-center space-y-2">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-eco-600/10 mx-auto">
              <Sparkles className="size-6 text-eco-600" />
            </div>
            <h2 className="text-display font-bold text-foreground">选择 AI 大模型</h2>
            <p className="text-body text-muted-foreground max-w-md mx-auto">
              选定的大模型将用于下一步：识别排污许可平台验证码 + 智能读取许可证内容
            </p>
          </div>

          {loading ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <Loader2 className="size-8 text-eco-600 animate-spin" />
              <p className="text-body text-muted-foreground">正在加载可用模型列表...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-4 py-12">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10">
                <AlertCircle className="size-6 text-destructive" />
              </div>
              <p className="text-body text-destructive">{error}</p>
              <button onClick={handleRetry} className="rounded-xl bg-eco-600 px-6 py-2.5 text-body font-semibold text-white hover:bg-eco-700 transition-colors">
                重试连接
              </button>
            </div>
          ) : (
            <>
              {/* 文本模型选择 */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-eco-600" />
                  <h3 className="text-body font-semibold text-foreground">文本大模型</h3>
                  <span className="text-xs text-muted-foreground">用于解析许可证内容、合规咨询</span>
                </div>
                <div className="grid gap-2">
                  {textModels.map(m => (
                    <button
                      key={m.id}
                      onClick={() => m.available && setSelectedText(m.id)}
                      disabled={!m.available}
                      aria-label={`选择 ${m.name}`}
                      className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                        selectedText === m.id
                          ? "border-eco-500 bg-eco-50/50 ring-2 ring-eco-500/20"
                          : m.available
                            ? "border-border bg-card hover:border-eco-300 hover:bg-eco-50/30"
                            : "border-border bg-muted/30 opacity-50 cursor-not-allowed"
                      }`}
                    >
                      <div className={`flex size-5 shrink-0 items-center justify-center rounded-full mt-0.5 ${
                        selectedText === m.id ? "bg-eco-600 text-white" : "border border-border"
                      }`}>
                        {selectedText === m.id && <Check className="size-3" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-body font-medium text-foreground">{m.name}</span>
                          <span className="text-caption text-muted-foreground px-1.5 py-0.5 rounded bg-muted">{m.provider}</span>
                          {!m.available && <span className="text-caption text-destructive px-1.5 py-0.5 rounded bg-destructive/10">未配置 Key</span>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{m.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 视觉模型选择 */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Eye className="size-4 text-eco-600" />
                  <h3 className="text-body font-semibold text-foreground">视觉大模型</h3>
                  <span className="text-xs text-muted-foreground">用于识别验证码、解析页面截图</span>
                </div>
                <div className="grid gap-2">
                  {visionModels.map(m => (
                    <button
                      key={m.id}
                      onClick={() => m.available && setSelectedVision(m.id)}
                      disabled={!m.available}
                      aria-label={`选择 ${m.name}`}
                      className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                        selectedVision === m.id
                          ? "border-eco-500 bg-eco-50/50 ring-2 ring-eco-500/20"
                          : m.available
                            ? "border-border bg-card hover:border-eco-300 hover:bg-eco-50/30"
                            : "border-border bg-muted/30 opacity-50 cursor-not-allowed"
                      }`}
                    >
                      <div className={`flex size-5 shrink-0 items-center justify-center rounded-full mt-0.5 ${
                        selectedVision === m.id ? "bg-eco-600 text-white" : "border border-border"
                      }`}>
                        {selectedVision === m.id && <Check className="size-3" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-body font-medium text-foreground">{m.name}</span>
                          <span className="text-caption text-muted-foreground px-1.5 py-0.5 rounded bg-muted">{m.provider}</span>
                          {!m.available && <span className="text-caption text-destructive px-1.5 py-0.5 rounded bg-destructive/10">未配置 Key</span>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{m.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 下一步按钮 */}
              <div className="flex justify-end pt-2">
                <button
                  onClick={handleProceed}
                  disabled={!canProceed}
                  aria-label="下一步登录排污许可平台"
                  className="flex items-center gap-2 rounded-xl bg-eco-600 px-8 py-3 text-body font-semibold text-white shadow-modal hover:bg-eco-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  下一步 <ArrowRight className="size-4" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
