/**
 * EcoPilot 引导流程状态机
 *
 * 4 步：品牌动画 → 平台账号（人工登录） → 自动读取排污许可证 → 手机验证码绑定注册
 */

import { atom, computed } from 'nanostores'

export type OnboardingStep =
  | 'brand'
  | 'platform-login'
  | 'permit-reading'
  | 'register'
  | 'complete'

export interface OnboardingState {
  step: OnboardingStep
  platformUsername: string
  platformPassword: string
  /** 浏览器自动化登录会话 ID */
  permitSessionId: string
  phoneNumber: string
  /** 手机验证码 */
  smsCode: string
  userName: string
  userRole: '环保专员' | '厂长' | '第三方咨询' | ''
  /** 是否跳过品牌动画 */
  skippedAnimation: boolean
  /** 是否已完成引导 */
  completed: boolean
}

const initialState: OnboardingState = {
  step: 'brand',
  platformUsername: '',
  platformPassword: '',
  permitSessionId: '',
  phoneNumber: '',
  smsCode: '',
  userName: '',
  userRole: '',
  skippedAnimation: false,
  completed: false,
}

// 当前有效的步骤值列表
const VALID_STEPS: string[] = ['brand', 'platform-login', 'permit-reading', 'register', 'complete']

// 从 localStorage 恢复引导状态，自动兼容旧版本遗留数据
try {
  const savedStep = localStorage.getItem('ecopilot-onboarding-step')
  const savedCompleted = localStorage.getItem('ecopilot-onboarding-completed')

  // 如果已标记完成，直接跳到主界面
  if (false && savedCompleted === 'true') {
    initialState.completed = true
  }

  // 只接受当前有效的步骤值，旧版步骤（permit-confirm/platform-audit 等）重置到第一步
  if (savedStep && VALID_STEPS.includes(savedStep) && savedStep !== 'brand' && !initialState.completed) {
    initialState.step = savedStep as OnboardingStep
  } else if (savedStep && !VALID_STEPS.includes(savedStep)) {
    // 旧版残留数据 → 清理
    localStorage.removeItem('ecopilot-onboarding-step')
  }
} catch { /* localStorage 不可用 */ }

/** 引导流程全局状态 */
export const $onboarding = atom<OnboardingState>(initialState)

/** 当前步骤 */
export const $currentStep = computed($onboarding, s => s.step)

/** 是否在引导流程中 */
export const $isOnboarding = computed($onboarding, s => !s.completed)

/** 设置步骤 */
export function setStep(step: OnboardingStep): void {
  $onboarding.set({ ...$onboarding.get(), step })
  try { localStorage.setItem('ecopilot-onboarding-step', step) } catch {}
}

/** 完成引导 */
export function completeOnboarding(): void {
  $onboarding.set({ ...$onboarding.get(), completed: true, step: 'complete' })
  try { localStorage.setItem('ecopilot-onboarding-completed', 'true') } catch {}
}

/** 重置引导流程 */
export function resetOnboarding(): void {
  $onboarding.set(initialState)
  try {
    localStorage.removeItem('ecopilot-onboarding-step')
    localStorage.removeItem('ecopilot-onboarding-completed')
  } catch {}
}

/** 设置平台登录凭据 */
export function setPlatformCredentials(username: string, password: string): void {
  $onboarding.set({ ...$onboarding.get(), platformUsername: username, platformPassword: password })
}

/** 设置许可平台浏览器会话 ID */
export function setPermitSessionId(sessionId: string): void {
  $onboarding.set({ ...$onboarding.get(), permitSessionId: sessionId })
}

/** 设置用户信息（含验证码） */
export function setUserInfo(phone: string, code: string, name: string, role: OnboardingState['userRole']): void {
  $onboarding.set({ ...$onboarding.get(), phoneNumber: phone, smsCode: code, userName: name, userRole: role })
}

/** 跳过品牌动画 */
export function skipAnimation(): void {
  const state = $onboarding.get()
  $onboarding.set({ ...state, skippedAnimation: true, step: 'platform-login' })
}
