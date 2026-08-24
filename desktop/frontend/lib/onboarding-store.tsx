// ═══════════════ EcoPilot 引导流程状态 ═══════════════
// 6 steps: brand → model-config → platform-login → permit-reading → register → complete

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'

export type OnboardingStep = 'brand' | 'model-config' | 'platform-login' | 'permit-reading' | 'register' | 'complete'

export interface OnboardingState {
  step: OnboardingStep
  // model config
  modelReady: boolean
  textModel: string
  visionModel: string
  // hermes session（模型配置后唤醒 Hermes 获得）
  hermesSessionId: string
  hermesReady: boolean
  // platform login
  sessionId: string
  loginMethod: 'safari' | 'quick' | 'skip' | ''
  // permit data
  permitData: Record<string, unknown> | null
  permitOutlets: unknown[]
  // 行业识别 + 行业技能自动下载
  industryCode: string
  industryName: string
  installedSkills: string[]
  // user
  phone: string
  name: string
  role: string
}

const STORAGE_KEY = 'ecopilot-onboarding'

function defaultState(): OnboardingState {
  return {
    step: 'brand',
    modelReady: false,
    textModel: '',
    visionModel: '',
    hermesSessionId: '',
    hermesReady: false,
    sessionId: '',
    loginMethod: '',
    permitData: null,
    permitOutlets: [],
    industryCode: '',
    industryName: '',
    installedSkills: [],
    phone: '',
    name: '',
    role: '环保专员',
  }
}

const OnboardingCtx = createContext<{
  state: OnboardingState
  setStep: (s: OnboardingStep) => void
  setModelReady: (text: string, vision: string) => void
  setHermesReady: (sessionId: string) => void
  setLoginMethod: (m: 'safari' | 'quick' | 'skip') => void
  setSessionId: (sid: string) => void
  setPermitData: (data: Record<string, unknown>, outlets: unknown[]) => void
  setIndustry: (code: string, name: string) => void
  setInstalledSkills: (skills: string[]) => void
  setUser: (phone: string, name: string, role: string) => void
  reset: () => void
} | null>(null)

export function OnboardingProvider({ children }: { children: ReactNode }) {
  // 初始用 defaultState 保证 SSR/CSR 一致，useEffect 中再从 localStorage 读取
  const [state, setState] = useState<OnboardingState>(defaultState)
  const loadedRef = useRef(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) setState({ ...defaultState(), ...JSON.parse(saved) })
      } catch {}
      // 标记加载完成，后续 save effect 才能写入
      loadedRef.current = true
    }
  }, [])

  useEffect(() => {
    // 跳过首次渲染：防止用 defaultState 覆盖刚从 localStorage 读取的正确状态
    if (!loadedRef.current) return
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, permitData: null }))
    }
  }, [state.step, state.modelReady, state.textModel, state.visionModel, state.hermesSessionId, state.hermesReady, state.sessionId, state.loginMethod, state.industryCode, state.industryName, state.installedSkills, state.phone, state.name, state.role])

  const setStep = useCallback((s: OnboardingStep) => setState(p => ({ ...p, step: s })), [])
  const setModelReady = useCallback((text: string, vision: string) => setState(p => ({ ...p, modelReady: true, textModel: text, visionModel: vision })), [])
  const setHermesReady = useCallback((sessionId: string) => setState(p => ({ ...p, hermesReady: true, hermesSessionId: sessionId })), [])
  const setLoginMethod = useCallback((m: 'safari' | 'quick' | 'skip') => setState(p => ({ ...p, loginMethod: m })), [])
  const setSessionId = useCallback((sid: string) => setState(p => ({ ...p, sessionId: sid })), [])
  const setPermitData = useCallback((data: Record<string, unknown>, outlets: unknown[]) => setState(p => ({ ...p, permitData: data, permitOutlets: outlets })), [])
  const setIndustry = useCallback((code: string, name: string) => setState(p => ({ ...p, industryCode: code, industryName: name })), [])
  const setInstalledSkills = useCallback((skills: string[]) => setState(p => ({ ...p, installedSkills: skills })), [])
  const setUser = useCallback((phone: string, name: string, role: string) => setState(p => ({ ...p, phone, name, role })), [])
  const reset = useCallback(() => {
    setState(defaultState())
    if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  }, [])

  return (
    <OnboardingCtx.Provider value={{ state, setStep, setModelReady, setHermesReady, setLoginMethod, setSessionId, setPermitData, setIndustry, setInstalledSkills, setUser, reset }}>
      {children}
    </OnboardingCtx.Provider>
  )
}

export function useOnboarding() {
  const ctx = useContext(OnboardingCtx)
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider')
  return ctx
}
