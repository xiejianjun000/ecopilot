"use client"
import { useEffect, useState, useRef } from "react"
import {
  CheckCircle2, Loader2, AlertTriangle, ArrowRight, ArrowLeft,
  FileText, RefreshCw, Compass, ChevronDown, Shield,
  AlertOctagon, AlertCircle, Target, Building2, Clock
} from "lucide-react"
import { useOnboarding } from "@/lib/onboarding-store"
import { StepNav } from "./step-nav"
import { streamPermitFullRead, streamSafariInspect, apiPost } from "@/lib/api"

// 把 parsed 许可证数据持久化到后端，让对话系统提示词读到真实数据
async function persistPermitData(p: Record<string, unknown>) {
  try {
    // 1. 更新 enterprise.json 核心字段（系统提示词会读这个文件）
    await apiPost("/api/enterprise", {
      name: (p.enterpriseName as string) || "",
      creditCode: (p.creditCode as string) || "",
      permitNumber: (p.permitNumber as string) || "",
      legalRepresentative: (p.legalRepresentative as string) || "",
      address: (p.address as string) || "",
      phone: (p.phone as string) || "",
      industryCategory: (p.industryCategory as string) || "",
      managementLevel: (p.managementLevel as string) || "",
      province: (p.province as string) || "",
      city: (p.city as string) || "",
      county: (p.county as string) || "",
      validFrom: (p.validFrom as string) || "",
      validTo: (p.validTo as string) || "",
      industryCode: (p.industryCode as string) || "",
    })
    // 2. 把完整 parsed 数据存到独立文件（仪表盘会用）
    await apiPost("/api/permit/data/save", { parsed: p })
  } catch (e) {
    console.warn("[PermitReading] 持久化许可证数据失败:", e)
  }
}

// 按企业行业类型触发 Hermes 子代理自动安装 ecoskill 行业技能包
async function autoInstallIndustrySkills(p: Record<string, unknown>): Promise<{ name: string }[]> {
  try {
    const res = await apiPost<{ ok: boolean; installed?: { id: string; name: string }[] }>("/api/ecoskill/auto-install", {
      industry_code: (p.industryCode as string) || "",
      industry_name: (p.industryCategory as string) || "",
    })
    if (res.ok && res.data?.installed) return res.data.installed
  } catch (e) {
    console.warn("[PermitReading] 行业技能自动安装失败:", e)
  }
  return []
}

// 持久化执行审计/模块扫描/AI 分析结果
async function persistAuditData(payload: {
  execution?: unknown; modules?: unknown; ai?: unknown
}) {
  try {
    await apiPost("/api/permit/data/save", payload as Record<string, unknown>)
  } catch (e) {
    console.warn("[PermitReading] 持久化审计数据失败:", e)
  }
}

type PhaseKey = "license" | "execution" | "modules" | "ai_analysis"

interface PhaseItem { name: string; state: "pending" | "active" | "done" | "error" }
interface PhaseState {
  status: "pending" | "active" | "done" | "error"
  total: number
  step: number
  name: string
  items: PhaseItem[]
}

interface AiFinding {
  level?: string
  category?: string
  issue?: string
  law?: string
  suggestion?: string
}
interface AiResult {
  compliance_score?: number
  enterprise_summary?: string
  key_findings?: AiFinding[]
  industry_specific_risks?: string[]
  priority_actions?: string[]
  error?: string
  raw?: string
  parse_error?: boolean
}

interface ParsedPermit {
  enterpriseName?: string
  industryCategory?: string
  managementLevel?: string
  permitNumber?: string
  validFrom?: string
  validTo?: string
  emissionOutlets?: unknown[]
}

const PHASE_META: Record<PhaseKey, { label: string; icon: typeof FileText }> = {
  license: { label: "许可证申请表", icon: FileText },
  execution: { label: "执行记录审计", icon: Shield },
  modules: { label: "平台顶级模块", icon: Building2 },
  ai_analysis: { label: "AI 综合分析", icon: Target },
}

const PHASE_ORDER: PhaseKey[] = ["license", "execution", "modules", "ai_analysis"]

const initialPhases = (): Record<PhaseKey, PhaseState> => ({
  license: { status: "pending", total: 20, step: 0, name: "许可证申请表（20项）", items: [] },
  execution: { status: "pending", total: 6, step: 0, name: "执行记录审计（6模块）", items: [] },
  modules: { status: "pending", total: 16, step: 0, name: "平台顶级模块扫描（16项）", items: [] },
  ai_analysis: { status: "pending", total: 1, step: 0, name: "AI 综合分析", items: [] },
})

function levelColor(level?: string) {
  const l = (level || "").trim()
  if (l === "致命" || l === "FATAL") return { bg: "bg-destructive/10", border: "border-destructive/30", text: "text-destructive", dot: "bg-destructive", icon: AlertOctagon }
  if (l === "高" || l === "HIGH") return { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", dot: "bg-orange-500", icon: AlertCircle }
  if (l === "中" || l === "MEDIUM") return { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", dot: "bg-amber-500", icon: AlertCircle }
  return { bg: "bg-muted/40", border: "border-border", text: "text-muted-foreground", dot: "bg-muted-foreground", icon: AlertCircle }
}

export function PermitReadingStep() {
  const { state, setStep, setPermitData } = useOnboarding()
  const [phases, setPhases] = useState<Record<PhaseKey, PhaseState>>(initialPhases())
  const [error, setError] = useState("")
  const [elapsed, setElapsed] = useState(0)
  const [parsed, setParsed] = useState<ParsedPermit | null>(null)
  const [aiResult, setAiResult] = useState<AiResult | null>(null)
  const [expandedPhase, setExpandedPhase] = useState<PhaseKey | null>(null)
  const [readingMethod, setReadingMethod] = useState<"playwright" | "safari">("playwright")
  const [allDone, setAllDone] = useState(false)
  const [skillsInstalling, setSkillsInstalling] = useState(false)
  const [installedSkills, setInstalledSkills] = useState<{ name: string }[]>([])
  const startTimeRef = useRef<number>(Date.now())

  const sessionId = state.sessionId
  const textModel = state.textModel || "deepseek-v4-flash"

  // 更新某个阶段进度
  const updatePhaseProgress = (phase: PhaseKey, step: number, total: number, name: string) => {
    setPhases(prev => {
      const p = prev[phase]
      const items = [...p.items]
      // 标记之前为 done
      for (let i = 0; i < items.length; i++) {
        if (items[i].state === "active") items[i] = { ...items[i], state: "done" }
      }
      // 找到当前 step 对应的项
      const existIdx = items.findIndex(it => it.name === name)
      if (existIdx >= 0) {
        items[existIdx] = { name, state: "active" }
      } else {
        // 移除该 phase 占位项中状态为 pending 且名字为 "模块 X" 的项
        const cleanItems = items.filter(it => !(it.state === "pending" && /^模块\s+\d+$/.test(it.name)))
        cleanItems.push({ name, state: "active" })
        // 预填占位项
        for (let i = step + 1; i <= total; i++) {
          if (!cleanItems.find(it => it.name === `模块 ${i}`)) {
            cleanItems.push({ name: `模块 ${i}`, state: "pending" })
          }
        }
        items.splice(0, items.length, ...cleanItems)
      }
      return { ...prev, [phase]: { ...p, status: "active", step, total, items } }
    })
  }

  const markPhaseDone = (phase: PhaseKey) => {
    setPhases(prev => ({
      ...prev,
      [phase]: {
        ...prev[phase],
        status: "done",
        items: prev[phase].items.map(it => it.state === "active" || it.state === "pending" ? { ...it, state: "done" as const } : it),
      }
    }))
  }

  const markPhaseError = (phase: PhaseKey) => {
    setPhases(prev => ({
      ...prev,
      [phase]: { ...prev[phase], status: "error" }
    }))
  }

  const startReading = async (method?: "playwright" | "safari") => {
    let cancelled = false
    setError("")
    setAllDone(false)
    setParsed(null)
    setAiResult(null)
    setPhases(initialPhases())
    setExpandedPhase(null)
    startTimeRef.current = Date.now()
    const useMethod = method || readingMethod
    setReadingMethod(useMethod)

    // 主方式：一站式 Playwright 读取；备选：Safari（仅许可证基础数据）
    const sid = sessionId
    const stream = useMethod === 'playwright' && sid
      ? streamPermitFullRead(sid, textModel)
      : streamSafariInspect()

    try {
      for await (const evt of stream) {
        if (cancelled) break
        const t = (evt.type as string) || ""
        const phase = (evt.phase as PhaseKey) || "license"

        if (t === "phase_start") {
          const name = (evt.name as string) || ""
          const total = (evt.total as number) || 0
          setPhases(prev => ({
            ...prev,
            [phase]: { ...prev[phase], status: "active", total, name, step: 0, items: [] }
          }))
          setExpandedPhase(phase)
        } else if (t === "progress") {
          const step = (evt.step as number) || 0
          const total = (evt.total as number) || 0
          const name = (evt.name as string) || `步骤 ${step}`
          updatePhaseProgress(phase, step, total, name)
        } else if (t === "phase_done") {
          markPhaseDone(phase)
          // 保存许可证数据
          if (phase === "license" && evt.data) {
            const p = evt.data as ParsedPermit
            setParsed(p)
            setPermitData(p as Record<string, unknown>, p.emissionOutlets || [])
            // 持久化到后端 enterprise.json（让对话系统提示词读到真实数据）
            void persistPermitData(p as Record<string, unknown>)
            // Hermes 子代理：按行业类型自动安装 ecoskill 行业技能包
            setSkillsInstalling(true)
            void autoInstallIndustrySkills(p as Record<string, unknown>).then(list => {
              setInstalledSkills(list)
              setSkillsInstalling(false)
            })
          }
          // 保存执行审计结果
          if (phase === "execution" && evt.data) {
            void persistAuditData({ execution: evt.data })
          }
          // 保存模块扫描结果
          if (phase === "modules" && evt.data) {
            void persistAuditData({ modules: evt.data })
          }
          // 保存 AI 结果
          if (phase === "ai_analysis" && evt.data) {
            setAiResult(evt.data as AiResult)
            void persistAuditData({ ai: evt.data })
          }
        } else if (t === "done") {
          // 兼容旧版 streamSafariInspect：parsed 在 done 事件里
          if (!parsed && evt.parsed) {
            const p = evt.parsed as ParsedPermit
            setParsed(p)
            setPermitData(p as Record<string, unknown>, p.emissionOutlets || [])
            // 持久化到后端
            void persistPermitData(p as Record<string, unknown>)
            // Hermes 子代理：按行业类型自动安装 ecoskill 行业技能包
            setSkillsInstalling(true)
            void autoInstallIndustrySkills(p as Record<string, unknown>).then(list => {
              setInstalledSkills(list)
              setSkillsInstalling(false)
            })
          }
          if (!aiResult && evt.ai) {
            setAiResult(evt.ai as AiResult)
          }
          // 标记所有未完成的为 done
          setPhases(prev => {
            const next = { ...prev }
            for (const k of PHASE_ORDER) {
              if (next[k].status !== "done") next[k] = { ...next[k], status: "done" }
            }
            return next
          })
          if (!cancelled) setAllDone(true)
        } else if (t === "error") {
          setError((evt.detail as string) || "读取失败")
          markPhaseError(phase)
        }
      }
    } catch (e: unknown) {
      if (!cancelled) {
        setError(e instanceof Error ? e.message : "连接失败，请确认已登录排污许可平台")
        setPhases(prev => {
          const next = { ...prev }
          for (const k of PHASE_ORDER) {
            if (next[k].status === "active") next[k] = { ...next[k], status: "error" }
          }
          return next
        })
      }
    }
    return () => { cancelled = true }
  }

  // 计时器
  useEffect(() => {
    if (allDone) return
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [allDone])

  // 自动启动
  useEffect(() => {
    const cleanup = startReading()
    return () => { cleanup.then(c => c()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 计算总体进度
  const totalProgress = PHASE_ORDER.reduce((acc, k) => {
    const p = phases[k]
    if (p.status === "done") return acc + 100
    if (p.status === "active" && p.total > 0) return acc + Math.round((p.step / p.total) * 100)
    return acc
  }, 0)
  const overallPercent = Math.round(totalProgress / PHASE_ORDER.length)

  const currentPhase = PHASE_ORDER.find(k => phases[k].status === "active") || null

  const handleRetry = () => startReading()
  const handleSafariFallback = () => startReading("safari")

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setStep("platform-login")}
            aria-label="返回上一步"
            className="rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <ArrowLeft className="size-4" />
          </button>
          <img src="/eco-logo.svg" alt="EcoPilot" className="h-6 w-auto object-contain" />
          <span className="text-body font-semibold">Pilot</span>
        </div>
        <div className="flex items-center gap-3">
          <StepNav current="permit-reading" />
          <div className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums" aria-live="polite">
            <Clock className="size-3" />
            <span>{fmtTime(elapsed)}</span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-6 bg-sidebar overflow-y-auto">
        {/* 顶部标题 */}
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-eco-600">
            <FileText className="size-5 text-white" />
          </div>
          <div className="flex-1">
            <div className="text-body font-semibold text-foreground">
              {error && !allDone ? "读取遇到问题" :
               allDone ? "平台数据读取完成" :
               currentPhase ? `正在${currentPhase === "ai_analysis" ? "进行 AI 综合分析" : "读取平台数据"}` : "正在初始化..."}
            </div>
            <div className="text-xs text-muted-foreground">
              {allDone ? "已完成 4 个阶段：许可证 / 执行审计 / 平台模块 / AI 分析" :
               error ? "可重试或切换到 Safari 会话" :
               readingMethod === "playwright" ? "Playwright 会话读取全部模块（备选：Safari 会话）" : "Safari 会话读取"}
            </div>
          </div>
          {parsed?.enterpriseName && (
            <div className="rounded-lg bg-eco-50 border border-eco-200 px-3 py-1.5 text-xs">
              <div className="font-medium text-eco-700">{parsed.enterpriseName}</div>
              <div className="text-eco-600 text-caption">{parsed.industryCategory || ""} · {parsed.managementLevel || ""}</div>
            </div>
          )}
        </div>

        {/* 4阶段 Stepper */}
        <div className="grid grid-cols-4 gap-2">
          {PHASE_ORDER.map(key => {
            const p = phases[key]
            const meta = PHASE_META[key]
            const Icon = meta.icon
            const isActive = p.status === "active"
            const isDone = p.status === "done"
            const isError = p.status === "error"
            const phaseProgress = p.total > 0 ? Math.round((p.step / p.total) * 100) : (isDone ? 100 : 0)
            return (
              <button
                key={key}
                onClick={() => setExpandedPhase(expandedPhase === key ? null : key)}
                className={`relative rounded-xl border p-3 text-left transition-all ${
                  isActive ? "border-eco-400 bg-eco-50 shadow-sm" :
                  isDone ? "border-success/30 bg-success/5" :
                  isError ? "border-destructive/30 bg-destructive/5" :
                  "border-border bg-background"
                } ${expandedPhase === key ? "ring-2 ring-eco-300" : ""}`}
                aria-label={`${meta.label} 阶段${p.status === 'done' ? '已完成' : p.status === 'active' ? '进行中' : '待开始'}`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className={`flex size-7 items-center justify-center rounded-lg ${
                    isDone ? "bg-success/15" : isActive ? "bg-eco-600" : isError ? "bg-destructive/15" : "bg-muted"
                  }`}>
                    {isDone ? <CheckCircle2 className="size-4 text-success" /> :
                     isActive ? <Loader2 className="size-4 text-white animate-spin" /> :
                     isError ? <AlertTriangle className="size-4 text-destructive" /> :
                     <Icon className={`size-4 ${isActive ? "text-white" : "text-muted-foreground"}`} />}
                  </div>
                  <span className="text-caption text-muted-foreground tabular-nums">
                    {isDone ? `${p.total}/${p.total}` : isActive ? `${p.step}/${p.total}` : `${p.total}项`}
                  </span>
                </div>
                <div className={`text-xs font-medium ${isActive ? "text-eco-700" : isDone ? "text-foreground" : "text-muted-foreground"}`}>
                  {meta.label}
                </div>
                {/* 进度条 */}
                <div className="mt-1.5 h-0.5 rounded-full bg-border overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isDone ? "bg-success" : isActive ? "bg-eco-500" : isError ? "bg-destructive" : "bg-transparent"
                    }`}
                    style={{ width: `${phaseProgress}%` }}
                  />
                </div>
              </button>
            )
          })}
        </div>

        {/* 总进度条 */}
        <div className="h-1 rounded-full bg-border overflow-hidden" role="progressbar" aria-valuenow={overallPercent} aria-valuemax={100}>
          <div className={`h-full rounded-full transition-all duration-500 ${error ? "bg-destructive" : "bg-eco-500"}`} style={{ width: `${overallPercent}%` }} />
        </div>

        {/* 错误提示 */}
        {error && !allDone && (
          <div role="alert" aria-live="assertive" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
            <AlertTriangle className="size-4 shrink-0 text-destructive mt-0.5" />
            <div className="flex-1">
              <div className="text-body font-medium text-destructive">{error}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {readingMethod === "playwright"
                  ? "Playwright 会话读取失败，可重试或切换到 Safari 会话方式（需先在 Safari 手动登录 permit.mee.gov.cn）"
                  : "Safari 会话读取失败，请确认 Safari 已打开 permit.mee.gov.cn 并完成登录"}
              </div>
            </div>
          </div>
        )}

        {/* 展开阶段详情 */}
        {expandedPhase && phases[expandedPhase].items.length > 0 && (
          <div className="rounded-xl border border-border bg-background overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2">
                {(() => {
                  const Icon = PHASE_META[expandedPhase].icon
                  return <Icon className="size-4 text-eco-600" />
                })()}
                <span className="text-body font-medium">{phases[expandedPhase].name}</span>
              </div>
              <button
                onClick={() => setExpandedPhase(null)}
                aria-label="收起详情"
                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                <ChevronDown className="size-4" />
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto p-2 space-y-0.5">
              {phases[expandedPhase].items.map((item, idx) => {
                const icon = item.state === "active" ? <Loader2 className="size-3.5 text-eco-600 animate-spin" aria-label="加载中" /> :
                             item.state === "done" ? <CheckCircle2 className="size-3.5 text-success" aria-label="完成" /> :
                             item.state === "error" ? <AlertTriangle className="size-3.5 text-destructive" aria-label="错误" /> :
                             <div className="size-3.5 rounded-full border border-border" />
                return (
                  <div key={idx} className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
                    item.state === "active" ? "bg-eco-50" :
                    item.state === "error" ? "bg-destructive/5" : ""
                  }`}>
                    {icon}
                    <span className={`flex-1 ${
                      item.state === "active" ? "font-medium text-foreground" :
                      item.state === "done" ? "text-muted-foreground" :
                      item.state === "error" ? "text-destructive font-medium" :
                      "text-muted-foreground/50"
                    }`}>{item.name}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 行业技能包安装状态（Hermes 子代理） */}
        {(skillsInstalling || installedSkills.length > 0) && (
          <div role="status" aria-live="polite" className="rounded-xl border border-eco-200 bg-eco-50/50 p-3 text-xs text-eco-800">
            {skillsInstalling ? (
              <span className="flex items-center gap-2"><Loader2 className="size-3.5 animate-spin" /> Hermes 子代理正在按行业类型安装 ecoskill 技能包...</span>
            ) : (
              <span className="flex items-center gap-2 flex-wrap">
                <CheckCircle2 className="size-3.5 shrink-0" />
                已按行业安装 {installedSkills.length} 个技能包：{installedSkills.map(s => s.name).join("、")}
              </span>
            )}
          </div>
        )}

        {/* AI 综合分析结果 */}
        {aiResult && !aiResult.error && !aiResult.parse_error && (
          <AiAnalysisCard ai={aiResult} />
        )}
        {aiResult?.error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
            AI 分析失败：{aiResult.error}（不影响数据读取，可继续）
          </div>
        )}
        {aiResult?.parse_error && aiResult.raw && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
            <div className="font-medium mb-1">AI 分析结果解析失败，原始内容：</div>
            <div className="whitespace-pre-wrap font-mono text-caption max-h-40 overflow-y-auto">{aiResult.raw.slice(0, 800)}</div>
          </div>
        )}

        {/* 错误时显示重试/Safari 按钮（排污许可证为产品准入门槛，不可跳过） */}
        {error && !allDone && (
          <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
            <button
              onClick={handleRetry}
              aria-label="重新读取"
              className="flex items-center gap-2 rounded-xl border border-border bg-background px-5 py-2.5 text-body font-medium text-foreground hover:bg-accent transition-colors"
            >
              <RefreshCw className="size-4" /> 重试
            </button>
            {readingMethod === "playwright" && (
              <button
                onClick={handleSafariFallback}
                aria-label="切换到 Safari 会话读取"
                className="flex items-center gap-2 rounded-xl border border-eco-300 bg-eco-50/50 px-5 py-2.5 text-body font-medium text-eco-700 hover:bg-eco-100 transition-colors"
              >
                <Compass className="size-4" /> 切换 Safari 会话
              </button>
            )}
          </div>
        )}

        {/* 完成按钮 */}
        {allDone && (
          <div className="text-center mt-2">
            <button
              onClick={() => setStep("register")}
              aria-label="继续下一步注册"
              className="inline-flex items-center gap-2 rounded-xl bg-eco-600 px-8 py-3 text-body font-semibold text-white shadow-modal hover:bg-eco-700 transition-colors"
            >
              继续 <ArrowRight className="size-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── AI 分析结果展示卡片 ───
function AiAnalysisCard({ ai }: { ai: AiResult }) {
  const [tab, setTab] = useState<"findings" | "risks" | "actions">("findings")
  const score = ai.compliance_score ?? 0
  const scoreColor = score >= 80 ? "text-success" : score >= 60 ? "text-amber-600" : score >= 40 ? "text-orange-600" : "text-destructive"
  const scoreBg = score >= 80 ? "bg-success/10 border-success/30" : score >= 60 ? "bg-amber-50 border-amber-200" : score >= 40 ? "bg-orange-50 border-orange-200" : "bg-destructive/10 border-destructive/30"

  const findings = ai.key_findings || []
  const risks = ai.industry_specific_risks || []
  const actions = ai.priority_actions || []

  const counts = {
    fatal: findings.filter(f => (f.level || "").match(/致命|FATAL/i)).length,
    high: findings.filter(f => (f.level || "").match(/^高$|^HIGH$/i)).length,
    medium: findings.filter(f => (f.level || "").match(/^中$|^MEDIUM$/i)).length,
    low: findings.filter(f => (f.level || "").match(/^低$|^LOW$/i)).length,
  }

  return (
    <div className={`rounded-2xl border ${scoreBg} overflow-hidden`}>
      {/* 评分头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-3">
          <Target className="size-5 text-eco-600" />
          <div>
            <div className="text-body font-semibold text-foreground">AI 综合分析报告</div>
            <div className="text-caption text-muted-foreground">对照 HJ 846 / HJ 944 / HJ 819 / 排污许可管理条例</div>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-display font-bold tabular-nums ${scoreColor}`}>{score}<span className="text-xs text-muted-foreground font-normal">/100</span></div>
          <div className="text-caption text-muted-foreground">合规评分</div>
        </div>
      </div>

      {/* 概要 */}
      {ai.enterprise_summary && (
        <div className="px-4 py-2.5 text-xs text-foreground/80 border-b border-border/50 bg-background/40">
          {ai.enterprise_summary}
        </div>
      )}

      {/* 计数标签 */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50 bg-background/40">
        {counts.fatal > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-caption font-medium text-destructive"><AlertOctagon className="size-3" /> 致命 {counts.fatal}</span>}
        {counts.high > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-caption font-medium text-orange-700"><AlertCircle className="size-3" /> 高 {counts.high}</span>}
        {counts.medium > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-caption font-medium text-amber-700"><AlertCircle className="size-3" /> 中 {counts.medium}</span>}
        {counts.low > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-caption font-medium text-muted-foreground">低 {counts.low}</span>}
      </div>

      {/* Tab 切换 */}
      <div className="flex border-b border-border/50">
        {([
          { k: "findings", label: `关键发现 (${findings.length})` },
          { k: "risks", label: `行业风险 (${risks.length})` },
          { k: "actions", label: `优先动作 (${actions.length})` },
        ] as const).map(t => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            aria-pressed={tab === t.k}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
              tab === t.k ? "bg-background text-eco-700 border-b-2 border-eco-500" : "text-muted-foreground hover:text-foreground hover:bg-background/60"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="bg-background/60 max-h-72 overflow-y-auto">
        {tab === "findings" && (
          <div className="p-3 space-y-2">
            {findings.length === 0 && <div className="text-center text-xs text-muted-foreground py-6">暂无关键发现</div>}
            {findings.map((f, idx) => {
              const c = levelColor(f.level)
              const Icon = c.icon
              return (
                <div key={idx} className={`rounded-lg border ${c.border} ${c.bg} p-2.5`}>
                  <div className="flex items-start gap-2">
                    <Icon className={`size-3.5 ${c.text} mt-0.5 shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-caption font-semibold ${c.text} px-1.5 py-0.5 rounded ${c.bg} border ${c.border}`}>{f.level || "未分级"}</span>
                        {f.category && <span className="text-caption text-muted-foreground">· {f.category}</span>}
                      </div>
                      <div className="text-xs font-medium text-foreground mb-1">{f.issue}</div>
                      {f.law && <div className="text-caption text-muted-foreground mb-1">📜 {f.law}</div>}
                      {f.suggestion && <div className="text-caption text-eco-700">💡 {f.suggestion}</div>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {tab === "risks" && (
          <div className="p-3 space-y-2">
            {risks.length === 0 && <div className="text-center text-xs text-muted-foreground py-6">暂无行业风险</div>}
            {risks.map((r, idx) => (
              <div key={idx} className="flex items-start gap-2 rounded-lg border border-border bg-background p-2.5">
                <AlertCircle className="size-3.5 text-orange-500 mt-0.5 shrink-0" />
                <div className="text-xs text-foreground/80 leading-relaxed">{r}</div>
              </div>
            ))}
          </div>
        )}

        {tab === "actions" && (
          <div className="p-3 space-y-2">
            {actions.length === 0 && <div className="text-center text-xs text-muted-foreground py-6">暂无优先动作</div>}
            {actions.map((a, idx) => (
              <div key={idx} className="flex items-start gap-2.5 rounded-lg border border-eco-200 bg-eco-50/40 p-2.5">
                <div className="flex size-5 items-center justify-center rounded-full bg-eco-600 text-caption font-bold text-white shrink-0">{idx + 1}</div>
                <div className="text-xs text-foreground/80 leading-relaxed">{a}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
