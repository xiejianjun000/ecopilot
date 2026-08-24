"use client"
import { useEffect, useRef } from "react"
import { OnboardingProvider, useOnboarding, type OnboardingStep } from "@/lib/onboarding-store"
import { BrandStep } from "@/components/onboarding/brand-step"
import { ModelConfigStep } from "@/components/onboarding/model-config-step"
import { PlatformLoginStep } from "@/components/onboarding/platform-login-step"
import { PermitReadingStep } from "@/components/onboarding/permit-reading-step"
import { RegisterStep } from "@/components/onboarding/register-step"

function getInitialStep(): OnboardingStep {
  if (typeof window !== "undefined") {
    const sp = new URLSearchParams(window.location.search)
    if (sp.get("skip-brand") === "1") return "model-config"
  }
  return "brand"
}

function OnboardingFlow() {
  const { state, setStep } = useOnboarding()
  const initialStep = getInitialStep()
  const initialSyncDone = useRef(false)

  // 只在挂载时同步一次：skip-brand 强制进入指定步骤，覆盖 localStorage 恢复的残留状态。
  // 用 ref 保证只执行一次，否则 state.step 变化（用户推进流程）会被反复拉回初始步骤。
  useEffect(() => {
    if (initialSyncDone.current) return
    initialSyncDone.current = true
    if (initialStep !== "brand" && state.step !== initialStep) {
      setStep(initialStep)
    }
  }, [initialStep, state.step, setStep])

  // complete 状态：onboarding 已完成（含从 localStorage 恢复的情况），直接回主页避免白屏。
  // 仅在没有 skip-brand 强制指定步骤时才跳转。
  useEffect(() => {
    if (state.step === "complete" && initialStep === "brand") {
      window.location.href = "/"
    }
  }, [state.step, initialStep])

  return (
    <div className="flex h-screen w-full flex-col bg-background">
      {state.step === "brand" && <BrandStep />}
      {state.step === "model-config" && <ModelConfigStep />}
      {state.step === "platform-login" && <PlatformLoginStep />}
      {state.step === "permit-reading" && <PermitReadingStep />}
      {state.step === "register" && <RegisterStep />}
    </div>
  )
}

export default function OnboardingPage() {
  return <OnboardingProvider><OnboardingFlow /></OnboardingProvider>
}
