"use client"
/**
 * 全局错误边界 — Next.js App Router 约定
 * 捕获未处理的渲染错误，避免白屏
 */
import { useEffect } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // 上报到监控平台
    import("@/lib/monitor-sdk").then(({ monitor }) => {
      monitor.error(`渲染崩溃: ${error.message}`, {
        stack: error.stack?.slice(0, 500),
        digest: error.digest,
      })
    })
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md w-full rounded-2xl border border-destructive/30 bg-card p-8 shadow-lg text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="size-6 text-destructive" />
        </div>
        <h2 className="text-title font-semibold text-foreground mb-2">页面出错了</h2>
        <p className="text-body text-muted-foreground mb-1">
          抱歉，EcoPilot 遇到了一个意外错误。错误已自动上报，我们会尽快修复。
        </p>
        {error.digest && (
          <p className="text-caption text-muted-foreground/60 font-mono mt-2">
            错误编号: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-eco-600 px-4 py-2 text-body font-medium text-white hover:bg-eco-700 transition-colors"
        >
          <RefreshCw className="size-4" />
          重试
        </button>
      </div>
    </div>
  )
}
