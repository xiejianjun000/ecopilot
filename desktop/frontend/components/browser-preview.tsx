"use client"
import { useEffect, useRef, useState, type MouseEvent } from "react"
import { X, RotateCw, Globe, ExternalLink, MousePointerClick } from "lucide-react"
import { getBrowserScreenshot, browserClick } from "@/lib/api"
import { cn } from "@/lib/utils"

/** 右侧无头浏览器预览面板：轮询后端截图，展示已登录平台实时画面 */
export function BrowserPreview({ open, sessionId, title, onClose }: {
  open: boolean
  sessionId: string
  title?: string
  onClose: () => void
}) {
  const [image, setImage] = useState("")
  const [url, setUrl] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [clicking, setClicking] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchShot = async () => {
    if (!sessionId) return
    setLoading(true)
    try {
      const s = await getBrowserScreenshot(sessionId)
      if (s) {
        setImage(s.image)
        setUrl(s.url)
        setError("")
      } else {
        setError("会话不存在或已过期，请重新登录")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "截图失败")
    } finally {
      setLoading(false)
    }
  }

  const doClick = async (x: number, y: number) => {
    setClicking(true)
    try {
      await browserClick(sessionId, x, y)
      await fetchShot()
    } catch (e) {
      setError(e instanceof Error ? e.message : "点击失败")
    } finally {
      setClicking(false)
    }
  }

  // 把预览面板里的点击坐标，按图片缩放比例换算成无头浏览器 viewport 坐标
  const handleImageClick = (e: MouseEvent<HTMLImageElement>) => {
    if (clicking) return
    const img = e.currentTarget
    const rect = img.getBoundingClientRect()
    const scaleX = img.naturalWidth / rect.width
    const scaleY = img.naturalHeight / rect.height
    const x = Math.round((e.clientX - rect.left) * scaleX)
    const y = Math.round((e.clientY - rect.top) * scaleY)
    doClick(x, y)
  }

  useEffect(() => {
    if (!open || !sessionId) return
    fetchShot()
    if (autoRefresh) {
      timerRef.current = setInterval(fetchShot, 1500)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId, autoRefresh])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* 头部 */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Globe className="size-4 shrink-0 text-eco-600" />
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-foreground">{title || "全国排污许可证管理平台"}</div>
          <div className="truncate text-caption text-muted-foreground">{url || "加载中..."}</div>
        </div>
        <button onClick={fetchShot} disabled={loading} title="刷新画面" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <RotateCw className={cn("size-4", loading && "animate-spin")} />
        </button>
        <button
          onClick={() => setAutoRefresh(v => !v)}
          className={cn("rounded-md px-2 py-1 text-caption", autoRefresh ? "bg-eco-50 text-eco-700" : "text-muted-foreground hover:bg-accent")}
        >
          {autoRefresh ? "自动刷新中" : "已暂停"}
        </button>
        <button onClick={onClose} title="关闭" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>

      {/* 浏览器画面 */}
      <div className="relative flex-1 overflow-auto bg-secondary/30 p-3">
        {error ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-caption text-destructive">{error}</div>
        ) : image ? (
          <>
            <div className="mb-2 flex items-center gap-1.5 text-caption text-muted-foreground">
              <MousePointerClick className="size-3.5 text-eco-600" /> 点击画面即可操作无头浏览器
            </div>
            <div className="relative">
              <img
                src={image} alt="无头浏览器画面"
                onClick={handleImageClick}
                title="点击操作无头浏览器"
                className="w-full cursor-pointer rounded-lg border border-border shadow-sm"
              />
              {clicking && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/50">
                  <span className="rounded-full bg-foreground/80 px-3 py-1 text-caption text-white">点击中...</span>
                </div>
              )}
            </div>
            {url && (
              <a
                href={url} target="_blank" rel="noopener noreferrer"
                className="mt-2 flex items-center justify-center gap-1 text-caption text-muted-foreground hover:text-eco-700"
              >
                <ExternalLink className="size-3" /> 在新窗口打开当前页面
              </a>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-caption text-muted-foreground">正在获取画面...</div>
        )}
      </div>
    </div>
  )
}
