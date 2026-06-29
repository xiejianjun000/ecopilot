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

import React from 'react'

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {error: Error|null}> {
  constructor(props: any) { super(props); this.state = {error: null} }
  static getDerivedStateFromError(error: Error) { return {error} }
  render() {
    if (this.state.error) {
      return <div style={{padding:40,fontFamily:'monospace',color:'#111',background:'#fff'}}>
        <h2 style={{color:'red'}}>白屏原因：{this.state.error.message}</h2>
        <pre style={{fontSize:12,whiteSpace:'pre-wrap'}}>{this.state.error.stack}</pre>
      </div>
    }
    return this.props.children
  }
}

function App() {
  const { completed, step } = useStore($onboarding)

  if (completed) {
    rootEl.style.cssText = 'width:100vw;height:100dvh;margin:0;padding:0;overflow:hidden;'
    return <div data-theme="light" style={{ width: '100vw', height: '100dvh', background: '#f7f7f7' }}><EcoPilotShell /></div>
  }

  if (step && step !== 'brand') {
    rootEl.style.cssText = 'width:100vw;height:100dvh;margin:0;padding:0;overflow-y:auto;'
    return <OnboardingPage />
  }

  rootEl.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100dvh;margin:0;padding:0;overflow:hidden;'
  return <BrandAnimation />
}

createRoot(rootEl).render(<ErrorBoundary><App /></ErrorBoundary>)
