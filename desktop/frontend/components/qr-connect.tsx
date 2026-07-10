"use client"
import { useState, useEffect } from "react"
import { Smartphone, X, QrCode, Copy, Check } from "lucide-react"

interface Props { open: boolean; onClose: () => void }
export function QrConnect({ open, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  // host 在 mount 后获取，避免 SSR/客户端不一致导致 hydration 不匹配
  const [host, setHost] = useState("localhost:3000")
  useEffect(() => { setHost(window.location.host) }, [])
  if (!open) return null
  const url = `http://${host}`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 剪贴板不可用时静默失败
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-foreground/10 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[400px] rounded-2xl border border-border bg-popover shadow-popover p-8 text-center" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} aria-label="关闭" className="absolute top-4 right-4 rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"><X className="size-5" /></button>
        <div className="flex size-16 items-center justify-center rounded-2xl bg-eco-50 mx-auto mb-4">
          <Smartphone className="size-8 text-eco-600" />
        </div>
        <h3 className="text-section font-semibold text-foreground">扫码连接手机端</h3>
        <p className="mt-2 text-body text-muted-foreground">使用手机浏览器扫描二维码，即可在移动端访问 EcoPilot</p>
        <div className="my-6 mx-auto flex size-48 items-center justify-center rounded-2xl border-2 border-dashed border-border bg-secondary">
          <div className="text-center">
            <QrCode className="size-12 text-muted-foreground mx-auto mb-2" />
            <p className="text-caption text-muted-foreground">二维码生成中</p>
            <p className="text-caption text-muted-foreground font-mono mt-1">{host}</p>
          </div>
        </div>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-xs text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label="复制链接"
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5 text-muted-foreground" />}
          <span className={copied ? "text-success" : "text-muted-foreground"}>{copied ? "已复制" : "复制链接"}</span>
        </button>
      </div>
    </div>
  )
}
