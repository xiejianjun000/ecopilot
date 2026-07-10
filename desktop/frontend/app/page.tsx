"use client"
import { useState, useEffect, useCallback } from "react"
import { LeftSidebar } from "@/components/left-sidebar"
import { ChatMain } from "@/components/chat-main"
import { RightPanel } from "@/components/right-panel"
import { UserPanel } from "@/components/user-panel"
import { GlobalSearch } from "@/components/global-search"
import { NotificationCenter } from "@/components/notification-center"
import { QrConnect } from "@/components/qr-connect"
import { DiscoverPanel } from "@/components/discover-panel"
import { MdViewer } from "@/components/md-viewer"
import { FeedbackModal } from "@/components/feedback-modal"
import { SettingModal } from "@/components/setting-modal"
import { AppProvider, useApp } from "@/lib/store"

function AppShell() {
  const [leftOpen, setLeftOpen] = useState(true)
  const [leftWidth, setLeftWidth] = useState(220)
  const [rightWidth, setRightWidth] = useState(320)
  const [userPanelOpen, setUserPanelOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const [discoverOpen, setDiscoverOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const [mdViewerFile, setMdViewerFile] = useState<{ name: string; content: string } | null>(null)
  const { state, dispatch } = useApp()

  // P2-1: onboarding 完成标志校验 — 未完成则重定向到 /onboarding
  // 开发模式：URL 带 ?dev=1 可跳过 onboarding
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search)
      if (params.get("dev") === "1") {
        localStorage.setItem("ecopilot-onboarding-done", "true")
        localStorage.setItem("ecopilot-onboarding", JSON.stringify({ step: "complete", modelReady: true, textModel: "deepseek-chat", visionModel: "deepseek-vision", sessionId: "", loginMethod: "quick", phone: "13800138000", name: "开发者", role: "环保专员" }))
        return
      }
      const done = localStorage.getItem("ecopilot-onboarding-done")
      const onboardingState = localStorage.getItem("ecopilot-onboarding")
      const isComplete = done === "true" || (onboardingState && JSON.parse(onboardingState).step === "complete")
      if (!isComplete) {
        window.location.href = "/onboarding"
        return
      }
    }
  }, [])

  // Auto-close overlays when activeNav changes
  useEffect(() => {
    setUserPanelOpen(false)
    setSearchOpen(false)
    setNotifOpen(false)
  }, [state.activeNav])

  // 注意：不再自动收起主左侧栏 — 档案库/知识库等视图内部已有自适应布局，
  // 收起主侧栏会阻断用户在9个导航模块间切换，造成"迷路"问题。

  useEffect(() => {
    // 初始检查 + 窗口大小变化时自动收起/展开
    const mq = window.matchMedia("(max-width: 767px)")
    const apply = () => setLeftOpen(!mq.matches)
    apply()
    // 监听视口变化（手机旋转、窗口缩放）
    mq.addEventListener("change", apply)
    const handlers: Array<[string, ()=>void]> = [
      ["ecopilot:open-user-panel", () => setUserPanelOpen(true)],
      ["ecopilot:search", () => setSearchOpen(true)],
      ["ecopilot:notifications", () => setNotifOpen(true)],
      ["ecopilot:qr", () => setQrOpen(true)],
      ["ecopilot:feedback", () => setFeedbackOpen(true)],
      ["ecopilot:open-settings", () => setSettingsOpen(true)],
      ["ecopilot:discover", () => setDiscoverOpen(true)],
      ["ecopilot:open-md", (() => { const f = (window as Window & { __ecopilotMdFile?: { name: string; content: string } }).__ecopilotMdFile; if (f) setMdViewerFile(f) })],
    ]
    handlers.forEach(([name, fn]) => window.addEventListener(name, fn))
    return () => {
      mq.removeEventListener("change", apply)
      handlers.forEach(([name, fn]) => window.removeEventListener(name, fn))
    }
  }, [])

  // Resize handlers
  const handleLeftResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); const sx = e.clientX; const sw = leftWidth
    const move = (ev: MouseEvent) => setLeftWidth(Math.min(380, Math.max(180, sw + (ev.clientX - sx))))
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up) }
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up)
  }, [leftWidth])

  const handleRightResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); const sx = e.clientX; const sw = rightWidth
    const move = (ev: MouseEvent) => setRightWidth(Math.min(500, Math.max(240, sw + (sx - ev.clientX))))
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up) }
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up)
  }, [rightWidth])

  const isChat = state.activeNav === 'chat'
  const rightOpen = isChat && state.rightPanelOpen

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Left sidebar wrapper — 栏间不再用 border-r 硬细线，靠 sidebar 背景色与 main 背景色阶分层
          (sidebar oklch(0.965 0.005 155) vs main oklch(0.985 0 0)，2% 亮度差自然断开) */}
      <div style={{ width: leftOpen ? leftWidth : 0 }} className="h-full shrink-0 overflow-hidden transition-[width] duration-300">
        <LeftSidebar open={leftOpen} onToggle={() => setLeftOpen(v => !v)} />
      </div>
      {leftOpen && (
        <div onMouseDown={handleLeftResize} className="w-px shrink-0 cursor-col-resize bg-border hover:w-1 hover:bg-eco-400 transition-all z-20" />
      )}
      <ChatMain leftOpen={leftOpen} onToggleLeft={() => setLeftOpen(v => !v)} />
      {rightOpen && (
        <div onMouseDown={handleRightResize} className="w-px shrink-0 cursor-col-resize bg-border hover:w-1 hover:bg-eco-400 transition-all z-20" />
      )}
      {isChat && (
        <div style={{ width: rightOpen ? rightWidth : 0 }} className="h-full shrink-0 overflow-hidden transition-[width] duration-300">
          <RightPanel open={rightOpen} onToggle={() => dispatch({ type: "TOGGLE_RIGHT_PANEL" })} />
        </div>
      )}
      <UserPanel open={userPanelOpen} onClose={() => setUserPanelOpen(false)} />
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <NotificationCenter open={notifOpen} onClose={() => setNotifOpen(false)} />
      <QrConnect open={qrOpen} onClose={() => setQrOpen(false)} />
      <DiscoverPanel open={discoverOpen} onClose={() => setDiscoverOpen(false)} />
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <SettingModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <MdViewer open={!!mdViewerFile} file={mdViewerFile} onClose={() => setMdViewerFile(null)} />
      {leftOpen && !isChat && (
        <button aria-label="关闭面板" onClick={() => setLeftOpen(false)} className="fixed inset-0 z-40 bg-foreground/30 md:hidden" />
      )}
    </div>
  )
}

export default function Page() {
  return <AppProvider><AppShell /></AppProvider>
}
