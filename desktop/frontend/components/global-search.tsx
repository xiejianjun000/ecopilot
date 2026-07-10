"use client"
import { useState, useEffect, useRef } from "react"
import { Search, X, MessageSquare, BookOpen, FileText, ExternalLink } from "lucide-react"
import { useApp } from "@/lib/store"
import type { ActiveNav, ActiveView } from "@/lib/types"

interface SearchItem {
  type: "nav" | "law" | "conversation"
  label: string
  desc: string
  action: string
}

const NAV_ITEMS: SearchItem[] = [
  { type:"nav", label:"仪表盘", desc:"合规态势总览", action:"dashboard" },
  { type:"nav", label:"合规日历", desc:"合规日程管理", action:"calendar" },
  { type:"nav", label:"交办整改", desc:"合规巡查与整改清单", action:"inspection" },
  { type:"nav", label:"申报平台", desc:"排污许可、碳排放、固废管理等政务平台", action:"links" },
  { type:"nav", label:"档案库", desc:"企业环境档案管理", action:"vault" },
  { type:"nav", label:"知识库", desc:"法规/标准/案例", action:"knowledge" },
  { type:"nav", label:"连接器", desc:"MCP服务管理", action:"connector" },
  { type:"nav", label:"设置", desc:"企业信息与模型配置", action:"settings" },
]

const LAW_ITEMS: SearchItem[] = [
  { type:"law", label:"排污许可管理条例", desc:"国务院 · 2021-03-01", action:"knowledge" },
  { type:"law", label:"大气污染防治法", desc:"全国人大常委会 · 2018-10-26", action:"knowledge" },
]

interface Props { open: boolean; onClose: () => void }
export function GlobalSearch({ open, onClose }: Props) {
  const [q, setQ] = useState("")
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const { state, dispatch } = useApp()

  useEffect(() => { if (open) { inputRef.current?.focus(); setQ(""); setSelected(0) } }, [open])

  const conversationItems: SearchItem[] = state.conversations.map(c => ({
    type: "conversation",
    label: c.title,
    desc: c.time,
    action: `chat-${c.id}`,
  }))

  const allItems: SearchItem[] = [...NAV_ITEMS, ...LAW_ITEMS, ...conversationItems]
  const filtered = allItems.filter(i => !q || i.label.includes(q) || i.desc.includes(q))

  const activate = (action: string) => {
    if (action.startsWith("chat-")) {
      dispatch({ type:"SET_CONVERSATION_ACTIVE", id:action.slice(5) })
      dispatch({ type:"SET_NAV", nav:"chat" })
    } else {
      dispatch({ type:"SET_NAV", nav: action as ActiveNav | ActiveView })
    }
    onClose()
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected(p => Math.min(p+1, filtered.length-1)) }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelected(p => Math.max(p-1, 0)) }
    if (e.key === "Enter" && filtered[selected]) { activate(filtered[selected].action) }
    if (e.key === "Escape") onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] bg-foreground/10 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[560px] rounded-2xl border border-border bg-popover shadow-popover overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <Search className="size-5 text-muted-foreground" />
          <input ref={inputRef} value={q} onChange={e => { setQ(e.target.value); setSelected(0) }} onKeyDown={handleKey}
            placeholder="搜索模块、法规、会话..." autoFocus
            className="flex-1 bg-transparent text-body text-foreground placeholder:text-muted-foreground focus:outline-none" />
          <span className="text-caption text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">ESC</span>
          <button onClick={onClose} aria-label="关闭" className="rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"><X className="size-4" /></button>
        </div>
        <div className="max-h-[360px] overflow-y-auto p-2">
          {filtered.map((item, i) => {
            const Icon = item.type==="nav" ? FileText : item.type==="law" ? BookOpen : MessageSquare
            return (
              <button key={i} onClick={() => activate(item.action)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${i===selected ? "bg-accent" : "hover:bg-accent/50"}`}>
                <div className="flex size-8 items-center justify-center rounded-lg bg-secondary">
                  <Icon className="size-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium text-foreground truncate">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
                <span className="text-caption text-muted-foreground rounded bg-secondary px-1.5 py-0.5">{item.type==="nav"?"页面":item.type==="law"?"法规":"会话"}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
