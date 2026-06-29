/**
 * EcoPilot 首次使用引导 — 卡片化容器
 */

import { useStore } from '@nanostores/react'
import { $currentStep } from '../store/onboarding'
import { BrandAnimation } from './brand-animation'
import { ModelConfig } from './model-config'
import { PlatformLogin } from './platform-login'
import { PermitReader } from './permit-reader'
import { Register } from './register'

export default function OnboardingPage() {
  const step = useStore($currentStep)

  if (step === 'brand') return <BrandAnimation />

  // 全屏步骤（不显示步骤指示器和卡片容器）
  const fullscreenSteps = new Set(['model-config', 'platform-login', 'permit-reading'])
  if (fullscreenSteps.has(step)) {
    if (step === 'model-config') {
      return <div style={{ width: '100dvw', height: '100dvh', display: 'flex', flexDirection: 'column' }}><ModelConfig /></div>
    }
    if (step === 'platform-login') {
      return <div style={{ width: '100dvw', height: '100dvh', display: 'flex', flexDirection: 'column' }}><PlatformLogin /></div>
    }
    if (step === 'permit-reading') {
      return <div style={{ width: '100dvw', height: '100dvh', display: 'flex', flexDirection: 'column' }}><PermitReader /></div>
    }
  }

  return (
    <div style={{
      width: '100dvw', height: '100dvh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(170deg, #f0fdf6 0%, #f8fafc 40%, #ffffff 100%)',
    }}>
      {/* ── 卡片 ── */}
      <div style={{
        width: '100%', maxWidth: 580,
        margin: '0 24px',
        padding: '40px 36px 36px',
        borderRadius: 20,
        background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 12px 40px rgba(0,0,0,0.06)',
      }}>
        {/* ── 步骤指示器 ── */}
        {step !== 'complete' && <StepIndicator current={step} />}

        {/* ── 内容 ── */}
        <div style={{ marginTop: 36 }}>
          {step === 'register' && <Register />}
        </div>
      </div>
    </div>
  )
}

/* ── 步骤指示器 ── */

const STEPS = [
  { key: 'platform-login', label: '平台账号' },
  { key: 'permit-reading', label: '读取许可' },
  { key: 'register', label: '手机绑定' },
]

function StepIndicator({ current }: { current: string }) {
  const idx = STEPS.findIndex(s => s.key === current)

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0 }}>
      {STEPS.map((s, i) => {
        const done = i < idx
        const active = i === idx
        const dotColor = active ? '#059669' : done ? '#6ee7b7' : '#e5e7eb'
        const textColor = active ? '#059669' : done ? '#6ee7b7' : '#d1d5db'

        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            {/* 圆点 + 标签 */}
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            }}>
              <div style={{
                width: active ? 12 : 8, height: active ? 12 : 8,
                borderRadius: '50%', background: dotColor,
                transition: 'all 0.4s ease',
                boxShadow: active ? `0 0 0 4px rgba(5,150,105,0.12)` : 'none',
              }} />
              <span style={{
                fontSize: 11, fontWeight: active ? 600 : 400, color: textColor,
                transition: 'color 0.3s',
              }}>{s.label}</span>
            </div>
            {/* 连线 */}
            {i < STEPS.length - 1 && (
              <div style={{
                width: 64, height: 2, margin: '0 8px',
                background: done ? '#6ee7b7' : '#e5e7eb',
                transition: 'background 0.4s ease',
                marginBottom: 18,
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}
