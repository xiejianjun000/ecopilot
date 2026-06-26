/**
 * EcoPilot 首次使用引导流程（精简版）
 *
 * 品牌动画 → 上传许可证 → 平台登录 → 注册绑定
 * 其他信息在进入对话后逐步收集。
 */

import { useStore } from '@nanostores/react'
import { $currentStep } from '../store/onboarding'
import { BrandAnimation } from './brand-animation'
import { PermitUpload } from './permit-upload'
import { PlatformLogin } from './platform-login'
import { Register } from './register'

export default function OnboardingPage() {
  const step = useStore($currentStep)

  if (step === 'brand') {
    return <BrandAnimation />
  }

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(180deg, var(--bg-primary), rgba(0,0,0,0.03))',
    }}>
      <div style={{ width: '100%', maxWidth: 560, padding: '0 24px' }}>
        {step !== 'complete' && <StepIndicator current={step} />}
        <div style={{ marginTop: 32 }}>
          {step === 'permit-upload' && <PermitUpload />}
          {step === 'platform-login' && <PlatformLogin />}
          {step === 'register' && <Register />}
        </div>
      </div>
    </div>
  )
}

const STEPS = [
  { key: 'permit-upload', label: '许可证' },
  { key: 'platform-login', label: '平台登录' },
  { key: 'register', label: '注册' },
]

function StepIndicator({ current }: { current: string }) {
  const idx = STEPS.findIndex(s => s.key === current)

  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 4 }}>
      {STEPS.map((s, i) => (
        <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: i === idx ? '#059669' : i < idx ? '#6ee7b7' : '#e5e7eb',
            transition: 'all 0.3s',
          }} />
          {i < STEPS.length - 1 && (
            <div style={{
              width: 16,
              height: 2,
              background: i < idx ? '#6ee7b7' : '#e5e7eb',
              transition: 'all 0.3s',
            }} />
          )}
        </div>
      ))}
    </div>
  )
}
