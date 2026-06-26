// EcoPilot 桌面端入口 — 简化版
// 首次加载 = 品牌动画 → 点击 → reload → OnboardingPage

import './styles.css'
import { createRoot } from 'react-dom/client'
import { BrandAnimation } from './app/ecopilot/onboarding/brand-animation'
import OnboardingPage from './app/ecopilot/onboarding/index'
import { EcoPilotShell } from './EcoPilotShell'

const rootEl = document.getElementById('root')!
const step = localStorage.getItem('ecopilot-onboarding-step')
const completed = localStorage.getItem('ecopilot-onboarding-completed')

function App() {
  if (completed === 'true') {
    rootEl.style.cssText = 'width:100vw;height:100vh;margin:0;padding:0;overflow:hidden;'
    return <div data-theme="light" style={{ width: '100vw', height: '100vh' }}><EcoPilotShell /></div>
  }

  if (step && step !== 'brand') {
    rootEl.style.cssText = 'width:100vw;height:100vh;margin:0;padding:0;overflow-y:auto;'
    return <OnboardingPage />
  }

  // 品牌动画 — 全屏覆盖，自包含组件会自行跳转到下一步
  rootEl.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;margin:0;padding:0;overflow:hidden;'
  return <BrandAnimation />
}

createRoot(rootEl).render(<App />)
