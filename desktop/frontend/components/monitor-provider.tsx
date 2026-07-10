"use client"
/**
 * 全局监控 Provider — 捕获未处理错误 + 自动页面访问上报
 * 挂在根 layout 顶部
 */
import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { monitor } from "@/lib/monitor-sdk"

export function MonitorProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  // 路由变化时上报 page_view
  useEffect(() => {
    if (pathname) {
      monitor.pageView(pathname)
    }
  }, [pathname])

  // 全局未捕获错误
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      monitor.error(event.message, {
        filename: event.filename,
        line: event.lineno,
        col: event.colno,
        stack: event.error?.stack?.slice(0, 500),
      })
    }
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      monitor.error(
        `Unhandled Promise Rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
        { stack: reason instanceof Error ? reason.stack?.slice(0, 500) : undefined }
      )
    }
    window.addEventListener("error", handleError)
    window.addEventListener("unhandledrejection", handleRejection)
    return () => {
      window.removeEventListener("error", handleError)
      window.removeEventListener("unhandledrejection", handleRejection)
    }
  }, [])

  return <>{children}</>
}
