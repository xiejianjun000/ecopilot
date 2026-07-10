"use client"
import { OnboardingProvider, useOnboarding } from "@/lib/onboarding-store"
import { BrandStep } from "@/components/onboarding/brand-step"
import { ModelConfigStep } from "@/components/onboarding/model-config-step"
import { PlatformLoginStep } from "@/components/onboarding/platform-login-step"
import { PermitReadingStep } from "@/components/onboarding/permit-reading-step"
import { RegisterStep } from "@/components/onboarding/register-step"

function OnboardingFlow() {
  const { state } = useOnboarding()
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
