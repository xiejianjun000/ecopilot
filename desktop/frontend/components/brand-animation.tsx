"use client"
import { useEffect, useState, useRef } from "react"

const LETTERS = "EcoPilot"
// 使用 CSS 变量引用 eco-* token，避免硬编码
const COLORS = [
  "var(--color-eco-600)", "var(--color-eco-500)", "var(--color-eco-400)", "var(--color-eco-700)",
  "var(--color-eco-600)", "var(--color-eco-500)", "var(--color-eco-400)", "var(--color-eco-700)",
]

const TAGLINES = [
  { sub: "生态环境AI合规管家", desc: "企业的全生命周期生态环境合规伙伴" },
  { sub: "全国排污许可平台深度对接", desc: "自动巡检 · 实时预警 · 智能诊断" },
  { sub: "越用越聪明的专属AI助手", desc: "每次对话自动沉淀 · 持续学习企业合规知识" },
]

export function BrandAnimation({ onDone }: { onDone: () => void }) {
  const [letterIdx, setLetterIdx] = useState(-1)
  const [taglineIdx, setTaglineIdx] = useState(0)
  const [taglineFade, setTaglineFade] = useState(true)
  const phaseRef = useRef<number>(0)

  // Phase 0: animate letters
  useEffect(() => {
    const t = setInterval(() => {
      setLetterIdx(p => {
        if (p < LETTERS.length) return p + 1
        return p
      })
    }, 200)
    return () => clearInterval(t)
  }, [])

  // When letters complete, auto-dismiss
  useEffect(() => {
    if (letterIdx >= LETTERS.length && phaseRef.current === 0) {
      phaseRef.current = 1
      setTimeout(() => onDone(), 3000)
    }
  }, [letterIdx, onDone])

  // Tagline rotation
  useEffect(() => {
    if (phaseRef.current < 1) return
    const t = setInterval(() => { setTaglineFade(false); setTimeout(() => { setTaglineIdx(p => (p + 1) % TAGLINES.length); setTaglineFade(true) }, 400) }, 4000)
    return () => clearInterval(t)
  }, [])

  const t = TAGLINES[taglineIdx]

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 32, padding: "0 24px",
    }}>
      {/* Logo */}
      <div style={{
        width: 120, height: 120, borderRadius: 28,
        background: "linear-gradient(135deg, var(--color-eco-600), var(--color-eco-500))",
        boxShadow: "0 20px 60px color-mix(in oklch, var(--color-eco-600) 30%, transparent)",
        display: "flex", alignItems: "center", justifyContent: "center",
        opacity: letterIdx >= 0 ? 1 : 0,
        transform: letterIdx >= 0 ? "scale(1)" : "scale(0.8)",
        transition: "all 0.5s cubic-bezier(0.34,1.56,0.64,1)",
      }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <line x1="9" y1="12" x2="11" y2="14"/><line x1="11" y1="14" x2="15" y2="10"/>
        </svg>
      </div>

      {/* Letters */}
      <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
        {Array.from(LETTERS).map((ch, i) => {
          const active = i <= letterIdx
          return (
            <span key={i} style={{
              fontSize: active ? 64 : 40,
              fontWeight: active ? 700 : 300,
              color: active ? COLORS[i] : "var(--color-border)",
              transition: "all 0.35s cubic-bezier(0.34,1.56,0.64,1)",
              opacity: active ? 1 : 0.3,
              transform: active ? "translateY(0)" : "translateY(4px)",
              fontFamily: "Inter, SF Pro Display, -apple-system, sans-serif",
              letterSpacing: active ? "-0.01em" : "0",
            }}>{ch}</span>
          )
        })}
      </div>

      {/* Tagline */}
      <div style={{ textAlign: "center", minHeight: 54 }}>
        <div style={{
          opacity: taglineFade ? 1 : 0,
          transform: taglineFade ? "translateY(0)" : "translateY(8px)",
          transition: "opacity 0.4s, transform 0.4s",
        }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--color-eco-600)", marginBottom: 6 }}>{t.sub}</div>
          <div style={{ fontSize: 13, color: "var(--color-muted-foreground)", lineHeight: 1.5 }}>{t.desc}</div>
        </div>
      </div>

    </div>
  )
}
