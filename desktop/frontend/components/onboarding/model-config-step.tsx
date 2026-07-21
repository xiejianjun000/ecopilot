"use client"
import { useEffect, useState } from "react"
import { ArrowRight, Loader2, AlertCircle, FileText, Eye, ChevronDown, Sparkles } from "lucide-react"
import { useOnboarding } from "@/lib/onboarding-store"
import { StepNav } from "./step-nav"
import { getAvailableModels, type ModelInfo } from "@/lib/api"

type ProviderGroup = { name: string; models: ModelInfo[] }

export function ModelConfigStep() {
  const { setStep, setModelReady } = useOnboarding()
  const [loading, setLoading] = useState(true)
  const [textModels, setTextModels] = useState<ModelInfo[]>([])
  const [visionModels, setVisionModels] = useState<ModelInfo[]>([])
  const [error, setError] = useState("")
  const [textProvider, setTextProvider] = useState("")
  const [textModel, setTextModel] = useState("")
  const [visionProvider, setVisionProvider] = useState("")
  const [visionModel, setVisionModel] = useState("")
  const [textApiKey, setTextApiKey] = useState("")
  const [visionApiKey, setVisionApiKey] = useState("")

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const data = await getAvailableModels()
        if (cancelled) return
        setTextModels(data.text_models); setVisionModels(data.vision_models)
        const dt = data.default_text || data.text_models.find(m => m.available)?.id || ""
        const dv = data.default_vision || data.vision_models.find(m => m.available)?.id || ""
        setTextModel(dt); setVisionModel(dv)
        setTextProvider(data.text_models.find(m => m.id === dt)?.provider || "")
        setVisionProvider(data.vision_models.find(m => m.id === dv)?.provider || "")
        setLoading(false)
      } catch (e) { if (!cancelled) { setError("后端未连接"); setLoading(false) } }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const groupBy = (models: ModelInfo[]): ProviderGroup[] => {
    const map: Record<string, ModelInfo[]> = {}
    for (const m of models) (map[m.provider] ??= []).push(m)
    return Object.entries(map).map(([name, models]) => ({ name, models }))
  }

  const textGroups = groupBy(textModels)
  const visionGroups = groupBy(visionModels)
  const textFiltered = textGroups.find(g => g.name === textProvider)?.models || []
  const visionFiltered = visionGroups.find(g => g.name === visionProvider)?.models || []
  const canProceed = textModel && visionModel && !error

  const Dropdown = ({ label, value, onChange, options, placeholder }: {
    label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder: string
  }) => (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <div className="relative">
        <select value={value} onChange={e => onChange(e.target.value)}
          className="w-full appearance-none rounded-xl border border-border bg-card px-3 py-3 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-eco-500/30 cursor-pointer">
          <option value="" disabled>{placeholder}</option>
          {options.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
      </div>
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 items-center justify-between border-b border-border px-5">
        <button onClick={() => setStep("brand")} aria-label="返回上一步" className="flex items-center gap-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors -ml-1 px-1 py-1">
          <img src="/logo.png" alt="EcoPilot" className="size-7 rounded-md object-contain" />
          <span className="text-body font-bold tracking-tight text-foreground">Pilot</span>
        </button>
        <StepNav current="model-config" />
      </header>

      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-lg px-8 py-10 space-y-6">
          <div className="text-center space-y-3">
            <img src="/logo.png" alt="EcoPilot" className="size-14 mx-auto rounded-2xl object-contain" />
            <h2 className="text-display font-bold text-foreground">配置大模型</h2>
            <p className="text-sm text-muted-foreground">从已配置的服务商中选择，系统自动判断文本/视觉场景切换</p>
          </div>

          {loading ? (
            <div className="flex flex-col items-center gap-3 py-16"><Loader2 className="size-8 text-eco-500 animate-spin" /><p className="text-sm text-muted-foreground">加载中...</p></div>
          ) : error ? (
            <div className="flex flex-col items-center gap-4 py-16"><AlertCircle className="size-7 text-destructive" /><p className="text-sm text-destructive">{error}</p>
              <button onClick={() => { setError(""); setLoading(true); setTimeout(() => window.location.reload(), 100) }} className="rounded-xl bg-eco-500 px-8 py-2.5 text-sm font-semibold text-white hover:bg-eco-500 transition-colors">重试</button></div>
          ) : (
            <>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Dropdown label="服务商" value={textProvider}
                    onChange={v => { setTextProvider(v); setTextModel("") }}
                    options={textGroups.map(g => ({ value: g.name, label: g.name }))} placeholder="选择" />
                  <Dropdown label="文本模型" value={textModel} onChange={setTextModel}
                    options={textFiltered.map(m => ({ value: m.id, label: m.name + (m.desc?.includes('推理') ? ' (推理)' : '') }))}
                    placeholder={textProvider ? "选择" : "先选服务商"} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Dropdown label="服务商" value={visionProvider}
                    onChange={v => { setVisionProvider(v); setVisionModel("") }}
                    options={visionGroups.map(g => ({ value: g.name, label: g.name }))} placeholder="选择" />
                  <Dropdown label="视觉模型" value={visionModel} onChange={setVisionModel}
                    options={visionFiltered.map(m => ({ value: m.id, label: m.name }))}
                    placeholder={visionProvider ? "选择" : "先选服务商"} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">API 密钥</label>
                    <input type="password" value={textApiKey} onChange={e => setTextApiKey(e.target.value)}
                      placeholder="sk-...（文本模型密钥）"
                      className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-eco-500/30" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">API 密钥</label>
                    <input type="password" value={visionApiKey} onChange={e => setVisionApiKey(e.target.value)}
                      placeholder="sk-...（视觉模型密钥）"
                      className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-eco-500/30" />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-eco-200 bg-eco-50/50 p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-eco-500 uppercase tracking-wider"><Sparkles className="size-3" /> 我的大模型</div>
                <div className="flex items-center gap-2 text-sm"><FileText className="size-3.5 text-eco-500" /><span className="text-muted-foreground">文本：</span><code className="text-xs bg-eco-100 text-eco-800 px-2 py-0.5 rounded font-medium">{textModel || "—"}</code></div>
                <div className="flex items-center gap-2 text-sm"><Eye className="size-3.5 text-eco-500" /><span className="text-muted-foreground">视觉：</span><code className="text-xs bg-eco-100 text-eco-800 px-2 py-0.5 rounded font-medium">{visionModel || "—"}</code></div>
              </div>

              <div className="text-center text-xs text-muted-foreground leading-relaxed">系统根据任务自动切换：文本任务→文本模型 · 视觉任务→视觉模型</div>

              <div className="flex justify-center pt-2">
                <button onClick={async () => {
                  try {
                    const { apiPost } = await import("@/lib/api")
                    await apiPost("/api/models/save", {
                      text_api_key: textApiKey, vision_api_key: visionApiKey,
                      text_model: textModel, vision_model: visionModel,
                    })
                  } catch (e) { /* 保存失败不阻塞流程 */ }
                  setModelReady(textModel, visionModel)
                  setStep("platform-login")
                }} disabled={!canProceed}
                  className="flex items-center gap-2 rounded-2xl bg-eco-500 px-12 py-3.5 text-base font-semibold text-white shadow-lg shadow-eco-500/25 hover:bg-eco-500 hover:shadow-xl hover:shadow-eco-500/35 active:scale-[0.98] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none">下一步 <ArrowRight className="size-5" /></button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
