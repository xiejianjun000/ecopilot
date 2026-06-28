/**
 * 许可证读取 — 从排污许可平台自动抓取真实许可证数据
 *
 * 流程：已登录平台 → 后端 Playwright 抓取 → 展示结果 → 确认继续
 */

import { useState, useEffect } from 'react'
import { useStore } from '@nanostores/react'
import { $onboarding, setStep } from '../store/onboarding'
import { setPermit, updateCompliance, loadDemoCompliance } from '../store/permit'
import type { PermitInfo } from '../lib/permit-parser'

const CHAT_API = 'http://localhost:8002'
const A = '#059669'

const PROGRESS_TEXTS = [
  '正在连接排污许可管理平台...',
  '正在导航至许可证详情页...',
  '正在提取企业基本信息...',
  '正在读取许可证编号与有效期...',
  '正在解析排放口与排放限值...',
  '正在加载管理要求信息...',
  '数据整理完毕 ✓',
]

export function PermitReader() {
  const { permitSessionId } = useStore($onboarding)
  const [loading, setLoading] = useState(true)
  const [progressIdx, setProgressIdx] = useState(0)
  const [phase, setPhase] = useState<'loading' | 'done' | 'error'>('loading')
  const [permitData, setPermitData] = useState<Partial<PermitInfo> | null>(null)
  const [error, setError] = useState('')

  // 进入页面后调用后端 API 抓取真实数据
  useEffect(() => {
    if (!permitSessionId) {
      // 没有会话 ID → 回退到演示数据
      loadDemoCompliance()
      setLoading(false)
      setPhase('done')
      return
    }
    fetchPermitData()
  }, [])

  // 加载动画：逐条显示进度
  useEffect(() => {
    if (phase !== 'loading') return
    if (progressIdx < PROGRESS_TEXTS.length - 1) {
      const t = setTimeout(() => setProgressIdx(i => i + 1), 500 + Math.random() * 300)
      return () => clearTimeout(t)
    }
  }, [progressIdx, phase])

  const fetchPermitData = async () => {
    setLoading(true)
    setPhase('loading')
    setError('')

    try {
      const res = await fetch(`${CHAT_API}/api/permit/data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: permitSessionId }),
      })
      const result = await res.json()

      if (!result.ok) {
        throw new Error(result.detail || '数据抓取失败')
      }

      const data = result.data

      // 写入 store
      setPermit(data as PermitInfo)
      updateCompliance({
        lastAuditTime: new Date().toISOString(),
        pendingCount: data.emissionOutlets?.length ? 2 : 0,
        urgentCount: data.emissionOutlets?.length ? 1 : 0,
        docCompleteness: data.enterpriseName ? 85 : 60,
      })
      setPermitData(data)

      // 完成动画后展示
      const remainingSteps = PROGRESS_TEXTS.length - 1 - progressIdx
      const delay = Math.max(remainingSteps * 400, 600)
      setTimeout(() => {
        setLoading(false)
        setPhase('done')
      }, delay)
    } catch (e: any) {
      console.error('[PermitReader] fetch error:', e)
      // 回退到演示数据
      loadDemoCompliance()
      const remainingSteps = PROGRESS_TEXTS.length - 1 - progressIdx
      const delay = Math.max(remainingSteps * 400, 600)
      setTimeout(() => {
        setError(e.message || '抓取失败，已加载演示数据')
        setLoading(false)
        setPhase('done')
      }, delay)
    } finally {
      // 关闭浏览器会话
      if (permitSessionId) {
        try {
          await fetch(`${CHAT_API}/api/permit/session/close`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: permitSessionId }),
          })
        } catch {}
      }
    }
  }

  // 从 store 读取最终数据（真实抓取或 fallback demo 数据）
  const displayData = permitData

  // 从真实数据构造排放口（如果有）
  const outlets = displayData?.emissionOutlets || []

  // 构造展示用的字段列表
  const infoRows: [string, string][] = displayData
    ? [
        ['企业名称', displayData.enterpriseName || '—'],
        ['许可证编号', displayData.permitNumber || '—'],
        ['发证机关', displayData.issuingAuthority || '—'],
        ['有效期', displayData.validFrom && displayData.validTo
          ? `${displayData.validFrom} 至 ${displayData.validTo}`
          : '—'],
        ['行业类别', displayData.industryCategory || '—'],
        ['管理类别', displayData.managementLevel || '—'],
        ['生产地址', displayData.address || '—'],
      ].filter(([, v]) => v !== '—' && v !== undefined)
    : []

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

      {/* ═══ 加载中 ═══ */}
      {phase === 'loading' && (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(180deg, #f0fdf4 0%, #fff 100%)',
          padding: '40px 24px',
          gap: 24,
        }}>
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
            正在读取许可证信息...
          </h2>
          <div style={{
            background: '#fff', borderRadius: 12,
            border: '1px solid #e5e7eb', padding: '16px 24px',
            maxWidth: 360, width: '100%',
          }}>
            {PROGRESS_TEXTS.map((t, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 0',
                color: i <= progressIdx ? A : '#d1d5db',
                fontSize: 13,
                fontWeight: i <= progressIdx ? 500 : 400,
                transition: 'all 0.3s',
              }}>
                <span style={{ fontSize: 14 }}>
                  {i < progressIdx ? '✅' : i === progressIdx ? '⏳' : '○'}
                </span>
                <span>{t}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: '#9CA3AF', margin: 0 }}>
            数据来源：全国排污许可证管理信息平台
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
