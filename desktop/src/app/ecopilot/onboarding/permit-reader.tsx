/**
 * 许可证读取 — SSE 流式进度 + 倒计时
 *
 * 使用 POST /api/permit/license/full/stream 实时接收每张卡片读取进度
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore } from '@nanostores/react'
import { $onboarding, setStep } from '../store/onboarding'
import { loadDemoCompliance, loadRealPermit } from '../store/permit'
import { loadMonitoringFromPermit } from '../store/monitoring'
import type { PermitInfo } from '../lib/permit-parser'

const CHAT_API = 'http://localhost:8002'
const A = '#059669'

interface ProgressEvent {
  type: 'progress' | 'done' | 'error'
  step: number
  total: number
  name: string
  elapsed: number
  remaining: number
  cards?: any
  parsed?: any
  detail?: string
  dataid?: string
}

export function PermitReader() {
  const { permitSessionId } = useStore($onboarding)
  const [loading, setLoading] = useState(true)
  const [phase, setPhase] = useState<'loading' | 'done' | 'error'>('loading')
  const [permitData, setPermitData] = useState<Partial<PermitInfo> | null>(null)
  const [error, setError] = useState('')

  // SSE 进度状态
  const [progress, setProgress] = useState({ step: 0, total: 20, name: '准备连接平台...' })
  const [elapsed, setElapsed] = useState(0)
  const [remaining, setRemaining] = useState(60)
  const [ticks, setTicks] = useState(0)
  const cardList = useRef<string[]>([])

  // 进入页面后调用 SSE 流式读取
  useEffect(() => {
    if (!permitSessionId) {
      loadDemoCompliance()
      setLoading(false)
      setPhase('done')
      return
    }
    fetchPermitStream()
  }, [])

  // 每秒刷新倒计时
  useEffect(() => {
    if (phase !== 'loading') return
    const timer = setInterval(() => setTicks(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [phase])

  const fetchPermitStream = async () => {
    setLoading(true)
    setPhase('loading')
    setError('')

    try {
      const res = await fetch(`${CHAT_API}/api/permit/license/full/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: permitSessionId }),
      })

      if (!res.ok || !res.body) throw new Error('流式连接失败')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event: ProgressEvent = JSON.parse(line.slice(6))

            if (event.type === 'progress') {
              setProgress({ step: event.step, total: event.total, name: event.name })
              setElapsed(event.elapsed)
              setRemaining(event.remaining)
              cardList.current = [...cardList.current, event.name]
            } else if (event.type === 'done') {
              // SSE 流式读完 → 使用结构化解析数据替代演示数据
              if (event.parsed && event.parsed.enterpriseName) {
                loadRealPermit(event.parsed as PermitInfo)
                setPermitData(event.parsed as Partial<PermitInfo>)
                // 行业通用：从排放口列表生成监测任务
                const outlets = (event.parsed as any).emissionOutlets || []
                if (outlets.length > 0) {
                  loadMonitoringFromPermit(outlets)
                }
              } else {
                loadDemoCompliance()
              }
              setProgress({ step: event.total, total: event.total, name: '读取完成 ✓' })
              // 平滑过渡
              setTimeout(() => {
                setLoading(false)
                setPhase('done')
              }, 800)
            } else if (event.type === 'error') {
              throw new Error(event.detail || '读取失败')
            }
          } catch (e: any) {
            if (e.message.includes('JSON')) continue
            throw e
          }
        }
      }
    } catch (e: any) {
      console.error('[PermitReader] SSE error:', e)
      loadDemoCompliance()
      setError(e.message || '读取失败，已加载演示数据')
      setLoading(false)
      setPhase('done')
    } finally {
      if (permitSessionId) {
        try {
          await fetch(`${CHAT_API}/api/permit/session/close`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: permitSessionId }),
          })
        } catch {}
      }
    }
  }

  const displayData = permitData
  const outlets = displayData?.emissionOutlets || []
  const infoRows: [string, string][] = displayData
    ? [
        ['企业名称', displayData.enterpriseName || '—'],
        ['许可证编号', displayData.permitNumber || '—'],
        ['发证机关', displayData.issuingAuthority || '—'],
        ['有效期', displayData.validFrom && displayData.validTo
          ? `${displayData.validFrom} 至 ${displayData.validTo}` : '—'],
        ['行业类别', displayData.industryCategory || '—'],
        ['管理类别', displayData.managementLevel || '—'],
        ['生产地址', displayData.address || '—'],
      ].filter(([, v]) => v !== '—' && v !== undefined)
    : []

  const pct = Math.round((progress.step / progress.total) * 100)
  const displayRemaining = Math.max(0, remaining - Math.floor((ticks - elapsed)))
  const estimatedTotal = elapsed > 0 ? elapsed + remaining : 65

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column' as const,
      fontFamily: "-apple-system,'PingFang SC','Microsoft YaHei',sans-serif",
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
          <span style={{ color: '#6ee7b7' }}>✅ ① 平台登录</span>
          <span style={{ color: A, fontWeight: 600 }}>→</span>
          <span style={{ color: A, fontWeight: 600 }}>② 读取许可</span>
          <span style={{ color: '#d1d5db' }}>→</span>
          <span style={{ color: '#d1d5db' }}>③ 手机绑定</span>
        </div>
      </div>

      {/* ═══ 加载中 — SSE 倒计时 + 进度 ═══ */}
      {phase === 'loading' && (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(180deg, #f0fdf4 0%, #fff 100%)',
          padding: '40px 24px',
          gap: 24,
        }}>
          {/* 旋转图标 */}
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            border: '4px solid #e5e7eb',
            borderTopColor: A,
            animation: 'pr-spin 0.8s linear infinite',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 32 }}>📋</span>
          </div>

          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>
            正在读取许可证全部数据...
          </h2>

          {/* 倒计时 + 进度条 */}
          <div style={{
            background: '#fff', borderRadius: 16,
            border: '1px solid #e5e7eb', padding: '20px 28px',
            boxShadow: '0 1px 8px rgba(0,0,0,0.04)',
            width: '100%', maxWidth: 440,
          }}>
            {/* 倒计时数字 */}
            <div style={{ textAlign: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 2 }}>
                预计剩余
              </div>
              <div style={{ fontSize: 36, fontWeight: 800, color: A, fontVariantNumeric: 'tabular-nums' }}>
                {Math.max(0, displayRemaining)}<span style={{ fontSize: 16, fontWeight: 500 }}> 秒</span>
              </div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                预计共需 {estimatedTotal} 秒
              </div>
            </div>

            {/* 进度条 */}
            <div style={{
              height: 8, borderRadius: 4, background: '#f3f4f6',
              overflow: 'hidden', marginBottom: 10,
            }}>
              <div style={{
                height: '100%', borderRadius: 4,
                background: `linear-gradient(90deg, ${A}, #10b981)`,
                width: `${pct}%`,
                transition: 'width 0.4s ease',
              }} />
            </div>

            {/* 进度文字 */}
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 12, color: '#6B7280',
            }}>
              <span style={{ fontWeight: 500, color: A }}>
                {progress.name}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {progress.step} / {progress.total}
              </span>
            </div>

            {/* 已完成卡片流水 */}
            <div style={{
              marginTop: 14, maxHeight: 140, overflow: 'hidden',
              borderTop: '1px solid #f3f4f6', paddingTop: 8,
            }}>
              {cardList.current.map((c, i) => {
                const isLatest = i === cardList.current.length - 1
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '2px 0',
                    fontSize: 11,
                    color: isLatest ? A : '#9CA3AF',
                    fontWeight: isLatest ? 500 : 400,
                    transition: 'all 0.3s',
                  }}>
                    <span style={{ fontSize: 10, width: 16, textAlign: 'center' }}>
                      {isLatest ? '⏳' : i < cardList.current.length ? '✅' : '○'}
                    </span>
                    <span>{c}</span>
                  </div>
                )
              })}
            </div>
          </div>

          <p style={{ fontSize: 12, color: '#9CA3AF', margin: 0 }}>
            正在从全国排污许可证管理信息平台实时读取
          </p>
        </div>
      )}

      {/* ═══ 读取完成 ═══ */}
      {phase === 'done' && (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center',
          background: 'linear-gradient(180deg, #f0fdf4 0%, #fff 100%)',
          padding: '32px 24px',
          gap: 16,
          overflow: 'auto',
        }}>
          <div style={{
            width: 60, height: 60, borderRadius: 16,
            background: '#d1fae5', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: 28, flexShrink: 0,
          }}>
            ✅
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>
            许可证读取完成
          </h2>
          <p style={{ fontSize: 13, color: '#6B7280', margin: 0, marginBottom: 4 }}>
            {error
              ? `⚠️ ${error}`
              : '已从排污许可管理平台读取到以下信息'}
          </p>

          {/* 企业信息 */}
          {infoRows.length > 0 && (
            <div style={{
              background: '#fff', borderRadius: 12,
              border: '1px solid #e5e7eb', padding: 16,
              width: '100%', maxWidth: 480,
            }}>
              <div style={{
                fontSize: 13, fontWeight: 600, color: A, marginBottom: 8,
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <span>🏢</span> 企业信息
              </div>
              {infoRows.map(([k, v]) => (
                <div key={k} style={{
                  display: 'flex', justifyContent: 'space-between', gap: 8,
                  padding: '7px 0', borderBottom: '1px solid #f3f4f6',
                  fontSize: 13,
                }}>
                  <span style={{ color: '#6B7280', flexShrink: 0 }}>{k}</span>
                  <span style={{ color: '#111827', fontWeight: 500, textAlign: 'right' }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {/* 排放口 */}
          {outlets.length > 0 && (
            <div style={{
              background: '#fff', borderRadius: 12,
              border: '1px solid #e5e7eb', padding: 16,
              width: '100%', maxWidth: 480,
            }}>
              <div style={{
                fontSize: 13, fontWeight: 600, color: A, marginBottom: 8,
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <span>🏭</span> 排放口（{outlets.length} 个）
              </div>
              {outlets.map((o: any) => (
                <div key={o.code} style={{
                  padding: '8px 0', borderBottom: '1px solid #f3f4f6',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#111827', marginBottom: 4 }}>
                    {o.code} {o.name}
                    <span style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 6 }}>
                      ({o.type || '主要'}排放口)
                    </span>
                  </div>
                  {(o.latitude || o.longitude) && (
                    <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>
                      📍 {o.latitude?.toFixed(6)}, {o.longitude?.toFixed(6)}
                    </div>
                  )}
                  {o.limits && o.limits.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {o.limits.map((l: any) => (
                        <span key={l.factor} style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 4,
                          background: '#f0fdf4', color: A,
                        }}>
                          {l.factor} ≤ {l.limit}{l.unit}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 操作按钮 */}
          <div style={{ display: 'flex', gap: 10, marginTop: 8, paddingBottom: 24 }}>
            <button onClick={() => setStep('register')} style={{
              padding: '12px 40px', borderRadius: 10, border: 'none',
              background: `linear-gradient(135deg, ${A}, #10b981)`,
              color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(5,150,105,0.25)',
            }}>
              确认无误，继续 →
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pr-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
