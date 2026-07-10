// ═══════════════ EcoPilot 引导流程状态 ═══════════════
// 6 steps: brand → model-config → platform-login → permit-reading → register → complete

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

export type OnboardingStep = 'brand' | 'model-config' | 'platform-login' | 'permit-reading' | 'register' | 'complete'

export interface OnboardingState {
  step: OnboardingStep
  // model config
  modelReady: boolean
  textModel: string
  visionModel: string
  // platform login
  sessionId: string
  loginMethod: 'safari' | 'quick' | ''
  // permit data
  permitData: Record<string, unknown> | null
  permitOutlets: unknown[]
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
    sessionId: '',
    loginMethod: '',
    permitData: null,
    permitOutlets: [],
    phone: '',
    name: '',
    role: '环保专员',
  }
}

const OnboardingCtx = createContext<{
  state: OnboardingState
  setStep: (s: OnboardingStep) => void
  setModelReady: (text: string, vision: string) => void
  setLoginMethod: (m: 'safari' | 'quick') => void
  setSessionId: (sid: string) => void
  setPermitData: (data: Record<string, unknown>, outlets: unknown[]) => void
  setUser: (phone: string, name: string, role: string) => void
  reset: () => void
} | null>(null)

export function OnboardingProvider({ children }: { children: ReactNode }) {
  // 初始用 defaultState 保证 SSR/CSR 一致，useEffect 中再从 localStorage 读取
  const [state, setState] = useState<OnboardingState>(defaultState)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) setState({ ...defaultState(), ...JSON.parse(saved) })
      } catch {}
    }
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, permitData: null }))
    }
  }, [state.step, state.modelReady, state.textModel, state.visionModel, state.sessionId, state.loginMethod, state.phone, state.name, state.role])

  const setStep = useCallback((s: OnboardingStep) => setState(p => ({ ...p, step: s })), [])
  const setModelReady = useCallback((text: string, vision: string) => setState(p => ({ ...p, modelReady: true, textModel: text, visionModel: vision })), [])
  const setLoginMethod = useCallback((m: 'safari' | 'quick') => setState(p => ({ ...p, loginMethod: m })), [])
  const setSessionId = useCallback((sid: string) => setState(p => ({ ...p, sessionId: sid })), [])
  const setPermitData = useCallback((data: Record<string, unknown>, outlets: unknown[]) => setState(p => ({ ...p, permitData: data, permitOutlets: outlets })), [])
  const setUser = useCallback((phone: string, name: string, role: string) => setState(p => ({ ...p, phone, name, role })), [])
  const reset = useCallback(() => {
    setState(defaultState())
    if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  }, [])

  return (
    <OnboardingCtx.Provider value={{ state, setStep, setModelReady, setLoginMethod, setSessionId, setPermitData, setUser, reset }}>
      {children}
    </OnboardingCtx.Provider>
  )
}

export function useOnboarding() {
  const ctx = useContext(OnboardingCtx)
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider')
  return ctx
}
