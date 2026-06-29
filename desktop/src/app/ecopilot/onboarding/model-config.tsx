/**
 * 第二步：模型配置检查
 * 自动检测已配置的大模型，配好自动进登录，未配引导用户设置
 */

import { useState, useEffect, useCallback } from 'react'
import { setStep } from '../store/onboarding'

const CHAT_API = 'http://localhost:8002'
const A = '#059669'

async function checkModelsReady(): Promise<{ ready: boolean; textModel: string; visionModel: string }> {
  try {
    const res = await fetch(`${CHAT_API}/api/chat/health`)
    const data = await res.json()
    return {
      ready: !!(data.text_model || data.vision_model),
      textModel: data.text_model || '',
      visionModel: data.vision_model || '',
    }
  } catch {
    return { ready: false, textModel: '', visionModel: '' }
  }
}

export function ModelConfig() {
  const [phase, setPhase] = useState<'checking' | 'not-found' | 'found' | 'done'>('checking')
  const [textModel, setTextModel] = useState('')
  const [visionModel, setVisionModel] = useState('')
  const [countdown, setCountdown] = useState(3)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const r = await checkModelsReady()
      if (cancelled) return
      if (r.ready) {
        setTextModel(r.textModel)
        setVisionModel(r.visionModel)
        setPhase('found')
      } else {
        setPhase('not-found')
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  // 已找到模型 → 倒计时自动跳转
  useEffect(() => {
    if (phase !== 'found' || countdown <= 0) return
    const t = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [phase, countdown])

  useEffect(() => {
    if (countdown === 0) setStep('platform-login')
  }, [countdown])

  const handleRetry = useCallback(async () => {
    setRetrying(true)
    setPhase('checking')
    const r = await checkModelsReady()
    if (r.ready) {
      setTextModel(r.textModel)
      setVisionModel(r.visionModel)
      setPhase('found')
    } else {
      setPhase('not-found')
    }
    setRetrying(false)
  }, [])

  const handleGoSettings = () => {
    window.dispatchEvent(new CustomEvent('ecopilot:open-settings', { detail: 'providers' }))
  }

  return (
    <div style={{
      width: '100%', height: '100dvh',
      display: 'flex', flexDirection: 'column',
      fontFamily: "-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif",
      background: '#fff',
    }}>
      {/* ═══ 顶部导航条 ═══ */}
      <div style={{
        height: 52, display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 20px', borderBottom: '1px solid #e5e7eb',
        background: '#fff', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: A, fontWeight: 600, fontSize: 14 }}>
          <span style={{ fontSize: 18 }}>🌳</span>
          <span>EcoPilot</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#9CA3AF' }}>
          <span style={{ color: A, fontWeight: 600 }}>② 模型配置</span>
          <span style={{ color: '#d1d5db' }}>→</span>
          <span style={{ color: '#d1d5db' }}>③ 平台登录</span>
          <span style={{ color: '#d1d5db' }}>→</span>
          <span style={{ color: '#d1d5db' }}>④ 读取许可</span>
          <span style={{ color: '#d1d5db' }}>→</span>
          <span style={{ color: '#d1d5db' }}>⑤ 手机绑定</span>
        </div>
      </div>

      {/* ═══ 内容区 ═══ */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(180deg, #f0fdf4 0%, #fff 100%)',
        padding: '40px 24px', gap: 24,
      }}>
        {/* 图标 + 标题 */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 72, height: 72, borderRadius: 18,
            background: 'linear-gradient(135deg, #059669, #10b981)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32, margin: '0 auto 16px',
            boxShadow: '0 4px 16px rgba(5,150,105,0.2)',
          }}>
            🧠
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: '0 0 6px' }}>
            {phase === 'checking' ? '正在检测 AI 模型' :
             phase === 'found' || phase === 'done' ? 'AI 模型已就绪' :
             '未检测到 AI 模型'}
          </h2>
          <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6, margin: 0, maxWidth: 380 }}>
            {phase === 'checking' && '正在验证 DeepSeek / Kimi 等大模型连接状态…'}
            {phase === 'not-found' && '请先配置至少一个大语言模型（如 DeepSeek），配置后自动继续。'}
            {(phase === 'found' || phase === 'done') &&
              `已检测到可用的 AI 模型，${countdown > 0 ? `${countdown} 秒后自动进入登录页面` : '即将跳转…'}`}
          </p>
        </div>

        {/* ═══ 检测中 ═══ */}
        {phase === 'checking' && (
          <div style={{
            background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb',
            padding: '28px 40px', boxShadow: '0 1px 8px rgba(0,0,0,0.04)',
            display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              border: '3px solid #e5e7eb', borderTopColor: A,
              animation: 'mc-spin 0.7s linear infinite',
            }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>
                {retrying ? '重新检测中' : '连接大模型服务'}
              </div>
              <div style={{ fontSize: 12, color: '#9CA3AF' }}>DeepSeek / Kimi / GLM …</div>
            </div>
          </div>
        )}

        {/* ═══ 未找到模型 ═══ */}
        {phase === 'not-found' && (
          <div style={{
            background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb',
            padding: 28, width: '100%', maxWidth: 440,
            boxShadow: '0 1px 8px rgba(0,0,0,0.04)',
          }}>
            {/* 三个模型供应商卡片 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {[
                { name: 'DeepSeek', icon: '🔷', desc: '国内性价比最高的模型，推荐首选', key: 'DEEPSEEK_API_KEY' },
                { name: 'Kimi (Moonshot)', icon: '🌙', desc: '支持超长上下文，适合证件/报告解析', key: 'KIMI_API_KEY' },
                { name: 'Xiaomi MiMo', icon: '🟠', desc: '视觉识别能力强，验证码/图表识别', key: 'XIAOMI_API_KEY' },
              ].map((p) => (
                <div key={p.key} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px', borderRadius: 12,
                  background: '#f9fafb', border: '1px solid #f3f4f6',
                }}>
                  <span style={{ fontSize: 24, flexShrink: 0 }}>{p.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: '#9CA3AF' }}>{p.desc}</div>
                  </div>
                  <span style={{ fontSize: 11, color: '#9CA3AF', background: '#f3f4f6', padding: '2px 8px', borderRadius: 4 }}>
                    {p.key}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={handleGoSettings} style={{
                flex: 1, padding: '12px 0', borderRadius: 10, border: 'none',
                background: `linear-gradient(135deg, ${A}, #10b981)`,
                color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer',
                boxShadow: '0 2px 12px rgba(5,150,105,0.25)',
              }}>
                打开设置 → 配置 API Key
              </button>
              <button onClick={handleRetry} disabled={retrying} style={{
                padding: '12px 20px', borderRadius: 10,
                border: '1px solid #d1d5db', background: '#fff',
                color: '#6B7280', fontSize: 14, cursor: 'pointer',
              }}>
                重试
              </button>
            </div>

            <p style={{ fontSize: 11, color: '#9CA3AF', margin: '12px 0 0', textAlign: 'center' }}>
              💡 至少配置一个文本模型即可使用。API Key 保存在本地，不会上传到云端。
            </p>
          </div>
        )}

        {/* ═══ 已找到模型 ═══ */}
        {(phase === 'found' || phase === 'done') && (
          <div style={{
            background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb',
            padding: 28, width: '100%', maxWidth: 440,
            boxShadow: '0 1px 8px rgba(0,0,0,0.04)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 12 }}>
              已检测到以下模型
            </div>
            {textModel && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 0', borderBottom: visionModel ? '1px solid #f3f4f6' : 'none',
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', background: A, flexShrink: 0,
                }} />
                <span style={{ fontSize: 13, color: '#6B7280', width: 40 }}>文本</span>
                <span style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>{textModel}</span>
              </div>
            )}
            {visionModel && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 0',
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', background: '#10b981', flexShrink: 0,
                }} />
                <span style={{ fontSize: 13, color: '#6B7280', width: 40 }}>视觉</span>
                <span style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>{visionModel}</span>
              </div>
            )}

            {/* 倒计时进度条 */}
            <div style={{ marginTop: 16 }}>
              <div style={{
                height: 4, borderRadius: 2, background: '#f3f4f6', overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  background: `linear-gradient(90deg, ${A}, #10b981)`,
                  width: `${((3 - countdown) / 3) * 100}%`,
                  transition: 'width 1s linear',
                }} />
              </div>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                marginTop: 6, fontSize: 12, color: '#9CA3AF',
              }}>
                <span />
                <span>{countdown > 0 ? `${countdown} 秒后自动继续` : '即将跳转'}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══ 底部 ═══ */}
      <div style={{
        height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderTop: '1px solid #e5e7eb', background: '#fff', flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, color: '#9CA3AF' }}>
          📍 模型通过 EcoPilot Chat Bridge (localhost:8002) 连接
        </span>
      </div>

      <style>{`
        @keyframes mc-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
