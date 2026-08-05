"use client"
import type { OnboardingStep } from "@/lib/onboarding-store"

const STEPS: { key: OnboardingStep; label: string }[] = [
  { key: "brand", label: "品牌" },
  { key: "model-config", label: "模型配置" },
  { key: "platform-login", label: "平台登录" },
  { key: "permit-reading", label: "读取许可" },
  { key: "register", label: "手机绑定" },
]

export function StepNav({ current }: { current: OnboardingStep }) {
  const idx = STEPS.findIndex(s => s.key === current)
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((s, i) => (
        <div key={s.key} className="flex items-center">
          {i > 0 && <div className={`w-7 h-px ${i <= idx ? "bg-eco-600" : "bg-border"}`} />}
          <div className={`flex items-center gap-1.5 ${i > idx ? "opacity-40" : ""}`}>
            <div className={`rounded-full ${i === idx ? "size-2 bg-eco-600 ring-2 ring-eco-500/30" : i < idx ? "size-1.5 bg-eco-600" : "size-1.5 bg-border"}`} />
            <span className={`text-caption whitespace-nowrap ${i === idx ? "font-semibold text-eco-600" : i < idx ? "text-muted-foreground" : "text-muted-foreground/50"}`}>{s.label}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
