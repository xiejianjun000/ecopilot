/**
 * 第三步：手机验证码绑定注册
 * 全 inline style — 零 Tailwind 依赖
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore } from '@nanostores/react'
import { $onboarding, setUserInfo, completeOnboarding } from '../store/onboarding'

const A = '#059669'
const CHAT_API = 'http://localhost:8002'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10,
  border: '1px solid #e5e7eb', outline: 'none',
  fontSize: 14, color: '#1D2129', background: '#fff',
  boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 500, color: '#6B7280', marginBottom: 5, display: 'block',
}

export function Register() {
  const { userName } = useStore($onboarding)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState(userName || '军哥')
  const [role, setRole] = useState<'环保专员' | '厂长' | '第三方咨询' | ''>('环保专员')
  const [countdown, setCountdown] = useState(0)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 倒计时
  useEffect(() => {
    if (countdown <= 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }
    intervalRef.current = setInterval(() => {
      setCountdown(prev => prev - 1)
    }, 1000)
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [countdown])

  const handleSendCode = useCallback(async () => {
    const trimmed = phone.replace(/\s/g, '')
    if (trimmed.length < 11) {
      setSendError('请输入正确的手机号')
      return
    }
    setSendError('')
    setSending(true)
    try {
      const res = await fetch(`${CHAT_API}/api/chat/send-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || '发送失败')
      if (data.code) {
        setCode(data.code)
      }
      setCountdown(60)
    } catch (e: any) {
      setSendError(e.message || '发送失败，请重试')
    } finally {
      setSending(false)
    }
  }, [phone])

  const handleSubmit = () => {
    setUserInfo(phone, code, name, role)
    completeOnboarding()
  }

  const canSubmit = phone.replace(/\s/g, '').length >= 11 && code.length >= 4 && name.trim().length > 0

  return (
    <div style={{ textAlign: 'center' }}>
      {/* ═══ 标题 ═══ */}
      <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1D2129', marginBottom: 8, letterSpacing: '-0.3px' }}>
        👤 创建您的账号
      </h1>
      <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6, marginBottom: 28 }}>
        最后一步，绑定手机号即可开始使用
      </p>

      {/* ═══ 表单 ═══ */}
      <div style={{ maxWidth: 360, margin: '0 auto' }}>
        {/* 手机号 + 发送验证码 */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>手机号</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="tel" style={{ ...inputStyle, flex: 1 }} placeholder="请输入手机号"
              value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))} />
            <button
              type="button"
              onClick={handleSendCode}
              disabled={countdown > 0 || sending}
              style={{
                padding: '10px 14px', borderRadius: 10,
                border: countdown > 0 ? '1px solid #d1d5db' : '1px solid #059669',
                background: countdown > 0 ? '#f9fafb' : '#ecfdf5',
                color: countdown > 0 ? '#9CA3AF' : '#059669',
                fontSize: 13, fontWeight: 500, cursor: countdown > 0 || sending ? 'default' : 'pointer',
                flexShrink: 0, whiteSpace: 'nowrap', minWidth: 90,
              }}>
              {sending ? '发送中...' : countdown > 0 ? `${countdown}s` : '发送验证码'}
            </button>
          </div>
          {sendError && (
            <p style={{ margin: '6px 0 0', fontSize: 12, color: '#ef4444', textAlign: 'left' }}>{sendError}</p>
          )}
        </div>

        {/* 验证码输入 */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>验证码</label>
          <input type="text" style={inputStyle} placeholder="请输入短信验证码"
            value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            maxLength={6} />
        </div>

        {/* 姓名 */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>姓名</label>
          <input type="text" style={inputStyle} placeholder="请输入您的姓名"
            value={name} onChange={e => setName(e.target.value)} />
        </div>

        {/* 角色 */}
        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>角色</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            {(['环保专员', '厂长', '第三方咨询'] as const).map(r => (
              <button key={r} type="button" onClick={() => setRole(r)} style={{
                padding: '8px 6px', borderRadius: 10, border: role === r ? `2px solid ${A}` : '1px solid #e5e7eb',
                background: role === r ? '#ecfdf5' : '#fff',
                color: role === r ? A : '#6B7280', fontSize: 13, fontWeight: role === r ? 600 : 400,
                cursor: 'pointer', transition: 'all 0.15s',
              }}>
                {r === '环保专员' ? '🌿 ' : r === '厂长' ? '🏭 ' : '📋 '}{r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ 按钮 ═══ */}
      <button type="button" onClick={handleSubmit} disabled={!canSubmit} style={{
        padding: '12px 56px', borderRadius: 12, border: 'none',
        background: canSubmit
          ? `linear-gradient(135deg, ${A}, #10b981)`
          : '#d1d5db',
        color: '#fff', fontSize: 15, fontWeight: 600,
        cursor: canSubmit ? 'pointer' : 'default',
        boxShadow: canSubmit ? `0 4px 16px rgba(5,150,105,0.28)` : 'none',
        letterSpacing: '0.2px',
      }}>
        进入 EcoPilot
      </button>

      {/* ═══ 底部小字 ═══ */}
      <p style={{ marginTop: 16, fontSize: 11, color: '#9CA3AF' }}>
        登录即代表同意 EcoPilot 服务协议与隐私政策
      </p>
    </div>
  )
}
