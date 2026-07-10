"use client"
import { Compass, X, Zap, Globe, TrendingUp, ShieldCheck, BookOpen, ArrowRight } from "lucide-react"
import { useApp } from "@/lib/store"
import type { ActiveNav, ActiveView } from "@/lib/types"

const FEATURES: Array<{ icon: typeof ShieldCheck; title: string; desc: string; nav: ActiveNav | ActiveView }> = [
  { icon: ShieldCheck, title:"合规态势仪表盘", desc:"实时掌握企业许可证、监测、台账等5维合规状态", nav:"dashboard" },
  { icon: Zap, title:"AI 对话合规管家", desc:"相当于雇了一个全职环保专员，24小时回答环保问题", nav:"chat" },
  { icon: Globe, title:"政务平台直连", desc:"Safari 直驱全国排污许可平台，自动读取20个模块数据", nav:"links" },
  { icon: TrendingUp, title:"碳排放管理", desc:"碳核算/配额管理/CCER交易，钢铁行业2026首次履约", nav:"chat" },
  { icon: BookOpen, title:"法规知识库", desc:"4000+法规/标准/案例，支持行业筛选和关键词搜索", nav:"knowledge" },
  { icon: ShieldCheck, title:"督察整改追踪", desc:"中央/省级/部级交办问题全周期管理，逾期自动预警", nav:"dashboard" },
]

interface Props { open: boolean; onClose: () => void }
export function DiscoverPanel({ open, onClose }: Props) {
  const { dispatch } = useApp()
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-foreground/10 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[480px] max-h-[80vh] overflow-y-auto rounded-2xl border border-border bg-popover shadow-popover p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Compass className="size-5 text-eco-600" />
            <h2 className="text-section font-semibold text-foreground">发现更多功能</h2>
          </div>
          <button onClick={onClose} aria-label="关闭" className="rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"><X className="size-5" /></button>
        </div>
        <div className="space-y-3">
          {FEATURES.map(f => (
            <button key={f.title} onClick={() => { dispatch({ type:"SET_NAV", nav:f.nav }); onClose() }}
              className="flex w-full items-start gap-4 rounded-xl border border-border bg-card p-4 hover:border-eco-200 hover:shadow-sm transition-all text-left group">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-eco-50"><f.icon className="size-5 text-eco-600" /></div>
              <div className="min-w-0 flex-1">
                <p className="text-body font-semibold text-foreground group-hover:text-eco-700">{f.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{f.desc}</p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground group-hover:text-eco-600 shrink-0 mt-2" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
