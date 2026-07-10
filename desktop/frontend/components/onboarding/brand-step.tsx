"use client"
import { useState } from "react"
import { useOnboarding } from "@/lib/onboarding-store"
import { BrandAnimation } from "@/components/brand-animation"
import { ArrowRight } from "lucide-react"

export function BrandStep() {
  const { setStep } = useOnboarding()
  const [animationDone, setAnimationDone] = useState(false)

  return (
    <div className="flex h-full flex-col items-center justify-center relative">
      <BrandAnimation onDone={() => setAnimationDone(true)} />
      {animationDone && (
        <button
          onClick={() => setStep("model-config")}
          aria-label="进入 EcoPilot"
          className="absolute bottom-20 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-xl bg-eco-600 px-8 py-3 text-body font-semibold text-white shadow-modal hover:bg-eco-700 transition-colors animate-in fade-in slide-in-from-bottom-4 duration-500"
        >
          进入 <ArrowRight className="size-4" />
        </button>
      )}
    </div>
  )
}
