"use client"
import { useEffect, useState, useRef } from "react"
import {
  CheckCircle2, Loader2, AlertTriangle, ArrowRight, ArrowLeft,
  FileText, RefreshCw, ChevronDown, Shield,
  AlertOctagon, AlertCircle, Target, Building2, Clock,
  BrainCircuit, PackageCheck, Boxes
} from "lucide-react"
import { useOnboarding } from "@/lib/onboarding-store"
import { StepNav } from "./step-nav"
import {
  streamPermitReadMcp, apiPost,
  installIndustrySkills, saveToHermesMemory,
} from "@/lib/api"
import { onboardingLog, startTimer } from "@/lib/onboarding-log"

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
  license: { label: "企业画像", icon: FileText },
  execution: { label: "执行记录", icon: Shield },
  modules: { label: "平台模块", icon: Building2 },
  ai_analysis: { label: "AI 综合分析", icon: Target },
}

const PHASE_ORDER: PhaseKey[] = ["license", "execution", "modules", "ai_analysis"]

const initialPhases = (): Record<PhaseKey, PhaseState> => ({
  license: { status: "pending", total: 5, step: 0, name: "企业画像读取（5项）", items: [] },
  execution: { status: "pending", total: 3, step: 0, name: "执行记录读取（3项）", items: [] },
  modules: { status: "pending", total: 18, step: 0, name: "平台模块扫描（18项）", items: [] },
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
  const { state, setStep, setPermitData, setIndustry, setInstalledSkills } = useOnboarding()
  const [phases, setPhases] = useState<Record<PhaseKey, PhaseState>>(initialPhases())
  const [error, setError] = useState("")
  const [elapsed, setElapsed] = useState(0)
  const [parsed, setParsed] = useState<ParsedPermit | null>(null)
  const [aiResult, setAiResult] = useState<AiResult | null>(null)
  const [expandedPhase, setExpandedPhase] = useState<PhaseKey | null>(null)
  const [allDone, setAllDone] = useState(false)
  const startTimeRef = useRef<number>(Date.now())
  // 行业技能自动下载状态
  const [skillsStatus, setSkillsStatus] = useState<"idle" | "installing" | "done" | "failed">("idle")
  const [skillsResult, setSkillsResult] = useState<{
    industry_name?: string
    installed?: string[]
    skipped?: string[]
    total?: number
  } | null>(null)
  const [skillsError, setSkillsError] = useState("")
  // Hermes 企业记忆写入状态
  const [memoryStatus, setMemoryStatus] = useState<"idle" | "writing" | "done" | "failed">("idle")

  const textModel = state.textModel || "deepseek-v4-flash"

  // 用 ref 保存最新 parsed 数据，避免 done 事件中 state 异步更新问题
  const parsedRef = useRef<ParsedPermit | null>(null)
  // 防止 React StrictMode 下 useEffect 二次挂载导致重复发起 FullStream 请求
  const startedRef = useRef(false)

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

  const startReading = async () => {
    let cancelled = false
    setError("")
    setAllDone(false)
    setParsed(null)
    setAiResult(null)
    setPhases(initialPhases())
    setExpandedPhase(null)
    startTimeRef.current = Date.now()

    // 通过 MCP（eco-permit-enterprise）读取排污许可平台数据
    const stream = streamPermitReadMcp(textModel)

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
            parsedRef.current = p
            setPermitData(p as Record<string, unknown>, p.emissionOutlets || [])
            onboardingLog.onboarding.info("license_parsed", {
              enterprise: p.enterpriseName,
              industry: p.industryCategory,
              industry_code: (p as { industryCode?: string }).industryCode || "",
              management_level: p.managementLevel,
              permit_no: p.permitNumber,
              outlets_count: p.emissionOutlets?.length || 0,
            })
            // 持久化到后端 enterprise.json（让对话系统提示词读到真实数据）
            void persistPermitData(p as Record<string, unknown>)
            // 识别行业并写入 onboarding store（供后续技能下载使用）
            const industryCode = (p as { industryCode?: string }).industryCode || ""
            const industryName = (p as { industryCategory?: string }).industryCategory || ""
            if (industryCode || industryName) {
              onboardingLog.onboarding.info("industry_recognized", {
                industry_code: industryCode,
                industry_name: industryName,
              })
              setIndustry(industryCode, industryName)
            } else {
              onboardingLog.onboarding.warn("industry_not_found", {
                enterprise: p.enterpriseName,
                hint: "许可证数据中未识别到行业，将跳过行业技能下载",
              })
            }
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
          // MCP 读取完成：parsed / ai 在 done 事件里兜底
          if (evt.parsed) {
            const p = evt.parsed as ParsedPermit
            setParsed(p)
            parsedRef.current = p
            setPermitData(p as Record<string, unknown>, p.emissionOutlets || [])
            // 持久化到后端
            void persistPermitData(p as Record<string, unknown>)
            // 识别行业（license 阶段可能因企业画像为空而未触发）
            const ic = (p as { industryCode?: string }).industryCode || ""
            const iname = (p as { industryCategory?: string }).industryCategory || ""
            if (ic || iname) setIndustry(ic, iname)
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
          if (!cancelled) {
            setAllDone(true)
            onboardingLog.onboarding.info("all_phases_done", {
              elapsed_ms: Date.now() - startTimeRef.current,
              has_parsed: !!parsedRef.current,
            })
            // 触发行业技能自动下载 + 企业画像写入 Hermes 记忆（异步，不阻塞 UI）
            const permitForSkills = parsedRef.current
            if (permitForSkills) {
              onboardingLog.onboarding.info("trigger_skills_and_memory", {
                enterprise: permitForSkills.enterpriseName,
                industry_code: (permitForSkills as { industryCode?: string }).industryCode || "",
              })
              void triggerIndustrySkillsAndMemory(permitForSkills)
            } else {
              onboardingLog.onboarding.warn("skip_skills_no_parsed", {
                hint: "无许可证数据，跳过行业技能下载",
              })
            }
          }
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

  // ─── 行业技能自动下载 + 企业画像写入 Hermes 记忆 ───
  // 在所有阶段完成后触发：根据排污许可证行业，从 ecoskill.cn (111.230.89.107) 下载对应技能
  const triggerIndustrySkillsAndMemory = async (permit: ParsedPermit) => {
    const industryCode = (permit as { industryCode?: string }).industryCode || ""
    const industryName = permit.industryCategory || ""
    const enterpriseName = permit.enterpriseName || ""
    const managementLevel = permit.managementLevel || ""

    onboardingLog.onboarding.info("skills_and_memory_start", {
      enterprise: enterpriseName,
      industry_code: industryCode,
      industry_name: industryName,
      management_level: managementLevel,
    })

    // 1. 并发触发：行业技能下载 + 企业画像写入 Hermes 记忆
    //    技能下载来自 http://111.230.89.107 (ecoskill.cn 备案中)
    if (industryCode) {
      setSkillsStatus("installing")
      onboardingLog.ecoskill.info("install_industry_start", {
        industry_code: industryCode,
        endpoint: "/api/hermes/ecoskill/install-industry",
      })
      const installTimer = startTimer()
      try {
        const result = await installIndustrySkills(industryCode)
        onboardingLog.ecoskill.info("install_industry_response", {
          ms: installTimer(),
          ok: result.ok,
          industry_code: result.industry_code,
          industry_name: result.industry_name,
          total: result.total,
          installed_count: result.installed?.length || 0,
          skipped_count: result.skipped?.length || 0,
          failed_count: result.failed?.length || 0,
        })
        if (result.ok) {
          setSkillsStatus("done")
          setSkillsResult({
            industry_name: result.industry_name || industryName,
            installed: result.installed || [],
            skipped: result.skipped || [],
            total: result.total || 0,
          })
          const allInstalled = [
            ...(result.installed || []),
            ...(result.skipped || []),
          ]
          setInstalledSkills(allInstalled)
          onboardingLog.ecoskill.info("install_industry_done", {
            industry: result.industry_name || industryName,
            total: result.total,
            installed: result.installed,
            skipped: result.skipped,
            failed: result.failed,
          })
        } else {
          setSkillsStatus("failed")
          setSkillsError(result.detail || "技能下载失败")
          onboardingLog.ecoskill.error("install_industry_failed", {
            ms: installTimer(),
            detail: result.detail,
            failed: result.failed,
          })
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "技能下载失败"
        onboardingLog.ecoskill.error("install_industry_exception", {
          ms: installTimer(),
          error: errMsg,
          industry_code: industryCode,
        })
        setSkillsStatus("failed")
        setSkillsError(errMsg)
      }
    } else {
      // 让失败显性化：未识别到行业代码时明确提示，而非静默跳过
      setSkillsStatus("failed")
      setSkillsError("未识别到行业代码（企业画像为空），无法装配行业技能")
      onboardingLog.ecoskill.warn("install_industry_skipped", {
        reason: "no_industry_code",
        hint: "许可证未识别到行业代码，跳过技能下载",
      })
    }

    // 2. 写入企业画像到 Hermes 记忆（让后续对话能基于企业上下文）
    if (enterpriseName) {
      setMemoryStatus("writing")
      onboardingLog.hermes.info("memory_write_start", {
        target: "enterprise",
        id: enterpriseName,
        enterprise: enterpriseName,
        industry_code: industryCode,
      })
      const memTimer = startTimer()
      try {
        await saveToHermesMemory("enterprise", enterpriseName, {
          enterprise_name: enterpriseName,
          industry_code: industryCode,
          industry_name: industryName,
          management_level: managementLevel,
          permit_number: permit.permitNumber || "",
          valid_from: permit.validFrom || "",
          valid_to: permit.validTo || "",
          source: "onboarding_permit_reading",
        })
        setMemoryStatus("done")
        onboardingLog.hermes.info("memory_write_done", {
          ms: memTimer(),
          target: "enterprise",
          enterprise: enterpriseName,
        })
      } catch (e) {
        setMemoryStatus("failed")
        onboardingLog.hermes.error("memory_write_failed", {
          ms: memTimer(),
          target: "enterprise",
          error: e instanceof Error ? e.message : String(e),
        })
        // 记忆写入失败不阻塞流程
      }
    } else {
      // 未获取到企业名称时不写 default 占位，显性提示
      setMemoryStatus("failed")
      onboardingLog.hermes.warn("memory_write_skipped", {
        reason: "no_enterprise_name",
        hint: "未获取到企业名称，跳过企业画像写入",
      })
    }

    onboardingLog.onboarding.info("skills_and_memory_complete", {
      skills_status: skillsStatus,
      memory_status: memoryStatus,
    })
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
    if (startedRef.current) return
    startedRef.current = true
    void startReading()
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
               allDone && !parsed?.enterpriseName ? "平台数据读取不完整" :
               allDone ? "平台数据读取完成" :
               currentPhase ? `正在${currentPhase === "ai_analysis" ? "进行 AI 综合分析" : "读取平台数据"}` : "正在初始化..."}
            </div>
            <div className="text-xs text-muted-foreground">
              {allDone && !parsed?.enterpriseName ? "未获取到企业画像，请配置真实平台凭据或连接 eco-permit-enterprise MCP 后重试" :
               allDone ? "已完成 4 个阶段：企业画像 / 执行记录 / 平台模块 / AI 分析" :
               error ? "可通过 MCP 重试读取" :
               "通过 MCP（eco-permit-enterprise）读取全部平台数据"}
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
                MCP 读取失败，请确认排污许可平台已登录且 MCP 服务正常，可重试。
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
          </div>
        )}

        {/* 完成按钮 */}
        {allDone && (
          <div className="space-y-3 mt-2">
            {/* 行业技能自动下载状态卡片 */}
            {(skillsStatus !== "idle" || memoryStatus !== "idle") && (
              <div className="rounded-2xl border border-eco-200 bg-eco-50/40 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-eco-700 uppercase tracking-wider">
                  <Boxes className="size-3.5" />
                  Hermes 行业技能装配
                </div>

                {/* 行业识别结果 */}
                {parsed?.industryCategory && (
                  <div className="flex items-center gap-2 text-sm">
                    <Building2 className="size-3.5 text-eco-500" />
                    <span className="text-muted-foreground">识别行业：</span>
                    <code className="text-xs bg-eco-100 text-eco-800 px-2 py-0.5 rounded font-medium">
                      {parsed.industryCategory}
                    </code>
                    {(parsed as { industryCode?: string }).industryCode && (
                      <code className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                        {(parsed as { industryCode?: string }).industryCode}
                      </code>
                    )}
                  </div>
                )}

                {/* 技能下载状态 */}
                {skillsStatus === "installing" && (
                  <div className="flex items-center gap-2 text-xs text-eco-700">
                    <Loader2 className="size-3.5 animate-spin" />
                    正在从 EcoSkill 市场下载行业技能...
                  </div>
                )}
                {skillsStatus === "done" && skillsResult && (
                  <div className="flex items-center gap-2 text-xs text-emerald-700">
                    <PackageCheck className="size-3.5 text-emerald-500" />
                    已装配 {skillsResult.total} 项技能
                    {skillsResult.industry_name && (
                      <span className="text-muted-foreground">（{skillsResult.industry_name}行业 + 通用）</span>
                    )}
                  </div>
                )}
                {skillsStatus === "failed" && (
                  <div className="flex items-center gap-2 text-xs text-amber-700">
                    <AlertCircle className="size-3.5 text-amber-500" />
                    技能下载失败：{skillsError}（不阻塞流程，可稍后重试）
                  </div>
                )}

                {/* Hermes 记忆写入状态 */}
                {memoryStatus === "writing" && (
                  <div className="flex items-center gap-2 text-xs text-eco-700">
                    <BrainCircuit className="size-3.5 animate-pulse text-eco-500" />
                    正在将企业画像写入 Hermes 记忆...
                  </div>
                )}
                {memoryStatus === "done" && (
                  <div className="flex items-center gap-2 text-xs text-emerald-700">
                    <BrainCircuit className="size-3.5 text-emerald-500" />
                    企业画像已写入 Hermes 记忆，后续对话将基于此上下文
                  </div>
                )}
                {memoryStatus === "failed" && (
                  <div className="flex items-center gap-2 text-xs text-amber-700">
                    <AlertCircle className="size-3.5 text-amber-500" />
                    记忆写入失败（不阻塞流程）
                  </div>
                )}
              </div>
            )}

            <div className="text-center">
              <button
                onClick={() => setStep("register")}
                aria-label="继续下一步注册"
                className="inline-flex items-center gap-2 rounded-xl bg-eco-600 px-8 py-3 text-body font-semibold text-white shadow-modal hover:bg-eco-700 transition-colors"
              >
                继续 <ArrowRight className="size-4" />
              </button>
            </div>
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
