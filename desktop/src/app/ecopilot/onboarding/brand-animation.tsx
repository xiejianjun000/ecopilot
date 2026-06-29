/**
 * EcoPilot 品牌动画 — 零外部依赖版
 * 自包含组件：动画播放完毕或用户点击后自动进入下一步。
 */

import { useState, useEffect } from 'react'
import { setStep } from '../store/onboarding'

const phases = [
  { icon: '🌳', title: 'EcoPilot', subtitle: '生态环境AI合规管家', desc: '企业的全生命周期生态环境合规专家' },
  { icon: '📄', title: '认识您的企业', subtitle: '上传排污许可证', desc: 'AI自动识别行业类别、排放标准、管理要求' },
  { icon: '🔎', title: '全面巡检', subtitle: '登录平台检查合规状态', desc: '自动检查执行报告、监测数据、违规记录' },
  { icon: '🧠', title: '越用越聪明', subtitle: '每次处理问题自动沉淀经验', desc: '持续学习企业的合规知识库，越用越精准' },
]

export function BrandAnimation() {
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setPhase(p => Math.min(p + 1, phases.length - 1)), 7000)
    return () => clearInterval(t)
  }, [])

  const handleStart = () => {
    setStep('model-config')
    
  }

  const p = phases[phase]

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999999,
      background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 30%, #ffffff 70%, #f0fdf4 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: "-apple-system,'PingFang SC','Microsoft YaHei',sans-serif",
      overflow: 'hidden',
    }}>
      {/* 装饰圆 */}
      <div style={{
        position: 'absolute', top: '-10%', right: '-5%', width: '50%', height: '50%',
        borderRadius: '50%', background: 'radial-gradient(circle, rgba(5,150,105,0.08) 0%, transparent 70%)',
      }} />
      <div style={{
        position: 'absolute', bottom: '-10%', left: '-10%', width: '40%', height: '40%',
        borderRadius: '50%', background: 'radial-gradient(circle, rgba(5,150,105,0.06) 0%, transparent 70%)',
      }} />

      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', padding: '0 32px' }}>
        {/* 图标 */}
        <div key={`i-${phase}`} style={{
          width: 80, height: 80, borderRadius: 24, margin: '0 auto 32px',
          background: 'linear-gradient(135deg,#059669,#10b981)',
          boxShadow: '0 12px 40px rgba(5,150,105,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 36, animation: 'bi 0.6s cubic-bezier(0.34,1.56,0.64,1)',
        }}>{p.icon}</div>

        {/* 标题 */}
        <div key={`t-${phase}`} style={{
          fontSize: 30, fontWeight: 700, color: '#065f46', marginBottom: 12,
          animation: 'fs 0.8s ease-out',
        }}>{p.title}</div>

        {/* 副标题 */}
        <div key={`s-${phase}`} style={{
          fontSize: 18, fontWeight: 500, color: '#059669', marginBottom: 16,
          animation: 'fs 0.8s ease-out 0.2s both',
        }}>{p.subtitle}</div>

        {/* 描述 */}
        <div key={`d-${phase}`} style={{
          fontSize: 14, color: '#6b7280', lineHeight: 1.6, maxWidth: 320, margin: '0 auto',
          animation: 'fs 0.8s ease-out 0.4s both',
        }}>{p.desc}</div>
      </div>

      {/* 阶段点 */}
      <div style={{ display: 'flex', gap: 8, marginTop: 48, zIndex: 1 }}>
        {phases.map((_, i) => (
          <button key={i} onClick={() => setPhase(i)} style={{
            width: i === phase ? 24 : 8, height: 8, borderRadius: 4,
            border: 'none', background: i === phase ? '#059669' : '#d1d5db',
            cursor: 'pointer', transition: 'all 0.3s', padding: 0,
          }} />
        ))}
      </div>

      {/* 按钮 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 40, zIndex: 1 }}>
        <button onClick={handleStart} style={{
          padding: '12px 44px', borderRadius: 12, border: 'none',
          background: 'linear-gradient(135deg,#059669,#10b981)',
          color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(5,150,105,0.3)',
        }}>开始使用 EcoPilot</button>
        <button onClick={handleStart} style={{
          padding: '8px 16px', border: 'none', background: 'transparent',
          color: '#9ca3af', fontSize: 13, cursor: 'pointer',
        }}>跳过动画，直接开始</button>
      </div>

      <style>{`
        @keyframes bi { 0%{transform:scale(0.5);opacity:0} 100%{transform:scale(1);opacity:1} }
        @keyframes fs { 0%{opacity:0;transform:translateY(16px)} 100%{opacity:1;transform:translateY(0)} }
      `}</style>
    </div>
  )
}
