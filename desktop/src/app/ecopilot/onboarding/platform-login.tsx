/**
 * 第二步：登录排污许可平台
 * 通过后端 Playwright 浏览器自动化完成 CAS 登录
 */

import { useState, useEffect, useCallback } from 'react'
import { setStep, setPermitSessionId } from '../store/onboarding'

const CHAT_API = 'http://localhost:8002'
const A = '#059669'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10,
  border: '1px solid #e5e7eb', outline: 'none',
  fontSize: 14, color: '#1D2129', background: '#fff',
  boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 500, color: '#6B7280', marginBottom: 5, display: 'block',
}

export function PlatformLogin() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [captcha, setCaptcha] = useState('')
  const [captchaBase64, setCaptchaBase64] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [phase, setPhase] = useState<'loading' | 'ready' | 'submitting' | 'done' | 'error'>('loading')
  const [error, setError] = useState('')

  // 启动浏览器会话，获取验证码
  useEffect(() => {
    startLogin()
    return () => {
      // 清理：如果离开页面时还没登录成功，关闭会话
      if (sessionId && phase !== 'done') {
        closeSession(sessionId)
      }
    }
  }, [])

  const startLogin = async () => {
    setPhase('loading')
    setError('')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 45000)
    try {
      const res = await fetch(`${CHAT_API}/api/permit/login/start`, {
        method: 'POST',
        signal: controller.signal,
      })
      clearTimeout(timeout)
      const data = await res.json()
      if (!data.ok) throw new Error(data.detail || '平台连接失败')
      setSessionId(data.session_id)
      setCaptchaBase64(data.captcha_base64)
      setPermitSessionId(data.session_id)
      setPhase('ready')
    } catch (e: any) {
      clearTimeout(timeout)
      if (e.name === 'AbortError') {
        setError('连接超时，请重试')
      } else {
        setError(e.message || '无法连接排污许可平台')
      }
      setPhase('error')
    }
  }

  const closeSession = async (sid: string) => {
    try {
      await fetch(`${CHAT_API}/api/permit/session/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid }),
      })
    } catch {}
  }

  const handleRefreshCaptcha = async () => {
    try {
      const res = await fetch(`${CHAT_API}/api/permit/captcha/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      })
      const data = await res.json()
      if (data.ok && data.captcha_base64) {
        setCaptchaBase64(data.captcha_base64)
        setCaptcha('')
      }
    } catch {}
  }

  const handleSubmit = useCallback(async () => {
    if (!username.trim() || !password.trim() || !captcha.trim()) {
      setError('请填写所有字段')
      return
    }
    setPhase('submitting')
    setError('')
    try {
      const res = await fetch(`${CHAT_API}/api/permit/login/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, username: username.trim(), password, captcha: captcha.trim() }),
      })
      const data = await res.json()
      if (!data.ok) {
        setPhase('ready')
        setError(data.detail || '登录失败')
        // 如果验证码错误，刷新验证码
        if (data.detail?.includes('验证码')) {
          handleRefreshCaptcha()
        }
        return
      }
      setPhase('done')
    } catch (e: any) {
      setPhase('ready')
      setError(e.message || '提交失败')
    }
  }, [username, password, captcha, sessionId])

  const handleContinue = () => {
    setStep('permit-reading')
  }

  return (
    <div style={{
      width: '100%', height: '100dvh',
      display: 'flex', flexDirection: 'column',
      fontFamily: "-apple-system,'PingFang SC','Microsoft YaHei',sans-serif",
      background: '#fff',
    }}>
      {/* ═══ 顶部导航条 ═══ */}
      <div style={{
        height: 52, display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 20px', borderBottom: '1px solid #e5e7eb',
        background: '#fff', flexShrink: 0,
      }}>
        <button onClick={() => setStep('brand')} style={{
          display: 'flex', alignItems: 'center', gap: 4,
          border: 'none', background: 'none', cursor: 'pointer',
          fontSize: 13, color: '#6B7280', padding: '6px 8px', borderRadius: 6,
        }}>
          <span style={{ fontSize: 16 }}>←</span>
          <span>返回</span>
        </button>
        <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: A, fontWeight: 600, fontSize: 14 }}>
          <span style={{ fontSize: 18 }}>🌳</span>
          <span>EcoPilot</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#9CA3AF' }}>
          <span style={{ color: A, fontWeight: 600 }}>① 平台登录</span>
          <span style={{ color: '#d1d5db' }}>→</span>
          <span style={{ color: '#d1d5db' }}>② 读取许可</span>
          <span style={{ color: '#d1d5db' }}>→</span>
          <span style={{ color: '#d1d5db' }}>③ 手机绑定</span>
        </div>
      </div>

      {/* ═══ 中间：登录表单 ═══ */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(180deg, #f0fdf4 0%, #fff 100%)',
        padding: '40px 24px', gap: 24,
      }}>
        {/* 标题 */}
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16,
            background: 'linear-gradient(135deg, #059669, #10b981)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28, margin: '0 auto 16px',
          }}>
            📋
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 8px 0' }}>
            登录排污许可平台
          </h2>
          <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.7, margin: 0 }}>
            请输入全国排污许可证管理信息平台的账号密码
          </p>
        </div>

        {/* 加载中 */}
        {phase === 'loading' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            color: A, fontSize: 14,
          }}>
            <div style={{
              width: 20, height: 20, borderRadius: '50%',
              border: '2px solid #e5e7eb', borderTopColor: A,
              animation: 'pl-spin 0.6s linear infinite',
            }} />
            <span>正在连接平台...</span>
          </div>
        )}

        {/* 错误重试 */}
        {phase === 'error' && (
          <div style={{
            background: '#fef2f2', borderRadius: 12,
            border: '1px solid #fecaca', padding: '16px 24px',
            textAlign: 'center', maxWidth: 400,
          }}>
            <p style={{ color: '#dc2626', fontSize: 14, margin: '0 0 12px 0' }}>{error}</p>
            <button onClick={startLogin} style={{
              padding: '8px 20px', borderRadius: 8, border: '1px solid #dc2626',
              background: '#fff', color: '#dc2626', fontSize: 13, cursor: 'pointer',
            }}>
              重新连接
            </button>
          </div>
        )}

        {/* 登录表单 */}
        {(phase === 'ready' || phase === 'submitting') && (
          <div style={{
            background: '#fff', borderRadius: 16,
            border: '1px solid #e5e7eb', padding: 24,
            width: '100%', maxWidth: 360,
            boxShadow: '0 1px 8px rgba(0,0,0,0.04)',
          }}>
            {/* 用户名 */}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>账号</label>
              <input type="text" style={inputStyle} placeholder="请输入平台账号"
                value={username} onChange={e => setUsername(e.target.value)}
                disabled={phase === 'submitting'} />
            </div>

            {/* 密码 */}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>密码</label>
              <input type="password" style={inputStyle} placeholder="请输入平台密码"
                value={password} onChange={e => setPassword(e.target.value)}
                disabled={phase === 'submitting'} />
            </div>

            {/* 验证码 */}
            <div style={{ marginBottom: 8 }}>
              <label style={labelStyle}>验证码</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <input type="text" style={{ ...inputStyle, flex: 1 }} placeholder="输入验证码"
                  value={captcha} onChange={e => setCaptcha(e.target.value)}
                  disabled={phase === 'submitting'}
                  maxLength={6} />
                {captchaBase64 && (
                  <img
                    src={`data:image/jpeg;base64,${captchaBase64}`}
                    alt="验证码"
                    onClick={handleRefreshCaptcha}
                    title="点击刷新验证码"
                    style={{
                      height: 40, borderRadius: 8, cursor: 'pointer',
                      border: '1px solid #e5e7eb', flexShrink: 0,
                    }}
                  />
                )}
              </div>
              <p style={{
                margin: '4px 0 0', fontSize: 11, color: '#9CA3AF',
                textAlign: 'right',
              }}>
                点击图片刷新
              </p>
            </div>

            {/* 错误提示 */}
            {error && (
              <p style={{
                margin: '8px 0', padding: '8px 12px',
                borderRadius: 8, background: '#fef2f2',
                fontSize: 12, color: '#dc2626',
              }}>
                {error}
              </p>
            )}

            {/* 隐私提示 */}
            <p style={{
              margin: '12px 0 0', fontSize: 11, color: '#9CA3AF',
              textAlign: 'center', lineHeight: 1.6,
            }}>
              🔒 凭据仅通过本地后端传输，密码经 RSA 加密后提交
            </p>
          </div>
        )}

        {/* 登录成功 */}
        {phase === 'done' && (
          <div style={{
            textAlign: 'center', maxWidth: 420,
            background: '#fff', borderRadius: 16,
            border: '1px solid #e5e7eb', padding: 32,
            boxShadow: '0 1px 8px rgba(0,0,0,0.04)',
          }}>
            <div style={{
              width: 60, height: 60, borderRadius: 16,
              background: '#d1fae5', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: 28, margin: '0 auto 16px',
            }}>
              ✅
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 600, color: '#111827', margin: '0 0 8px 0' }}>
              登录成功
            </h3>
            <p style={{ fontSize: 14, color: '#6B7280', margin: 0 }}>
              已成功登录全国排污许可证管理信息平台，接下来将自动读取您的许可证数据。
            </p>
          </div>
        )}
      </div>

      {/* ═══ 底部操作栏 ═══ */}
      <div style={{
        height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', borderTop: '1px solid #e5e7eb',
        background: '#fff', flexShrink: 0,
      }}>
        <div style={{ fontSize: 13, color: '#6B7280' }}>
          <span>📍 全国排污许可证管理信息平台</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setStep('register')} style={{
            padding: '8px 20px', borderRadius: 8, border: '1px solid #d1d5db',
            background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer',
          }}>
            跳过
          </button>

          {phase === 'ready' || phase === 'submitting' ? (
            <button onClick={handleSubmit} disabled={phase === 'submitting'}
              style={{
                padding: '8px 32px', borderRadius: 8, border: 'none',
                background: phase === 'submitting'
                  ? '#d1d5db'
                  : 'linear-gradient(135deg, #059669, #10b981)',
                color: '#fff', fontSize: 13, fontWeight: 600,
                cursor: phase === 'submitting' ? 'default' : 'pointer',
                boxShadow: phase === 'submitting' ? 'none' : '0 2px 8px rgba(5,150,105,0.25)',
              }}>
              {phase === 'submitting' ? '登录中...' : '登录'}
            </button>
          ) : phase === 'done' ? (
            <button onClick={handleContinue} style={{
              padding: '8px 32px', borderRadius: 8, border: 'none',
              background: 'linear-gradient(135deg, #059669, #10b981)',
              color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(5,150,105,0.25)',
            }}>
              继续读取许可 →
            </button>
          ) : null}
        </div>
      </div>

      <style>{`
        @keyframes pl-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
