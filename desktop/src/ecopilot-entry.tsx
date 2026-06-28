// EcoPilot 桌面端入口 — 简化版
// 首次加载 = 品牌动画 → 点击 → reload → OnboardingPage

import './styles.css'
import { createRoot } from 'react-dom/client'
import { useStore } from '@nanostores/react'
import { $onboarding } from './app/ecopilot/store/onboarding'
import { BrandAnimation } from './app/ecopilot/onboarding/brand-animation'
import OnboardingPage from './app/ecopilot/onboarding/index'
import { EcoPilotShell } from './EcoPilotShell'

// ?reset=1 清除引导状态，重新开始
// ?skip=1 跳过引导，直接进入仪表盘
const params = new URLSearchParams(window.location.search)
if (params.has('reset')) {
  localStorage.clear()
  document.location.href = '/'
}
if (params.has('skip')) {
  localStorage.setItem('ecopilot-onboarding-completed', 'true')
  window.location.replace(window.location.pathname)
}

const rootEl = document.getElementById('root')!

function App() {
  const { completed, step } = useStore($onboarding)

  // 已完成引导 → 仪表盘
  if (completed) {
    rootEl.style.cssText = 'width:100vw;height:100dvh;margin:0;padding:0;overflow:hidden;'
    return <div data-theme="light" style={{ width: '100vw', height: '100dvh' }}><EcoPilotShell /></div>
  }

  // 引导进行中
  if (step && step !== 'brand') {
    rootEl.style.cssText = 'width:100vw;height:100dvh;margin:0;padding:0;overflow-y:auto;'
    return <OnboardingPage />
  }

  // 品牌动画
  rootEl.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100dvh;margin:0;padding:0;overflow:hidden;'
  return <BrandAnimation />
}

createRoot(rootEl).render(<App />)
