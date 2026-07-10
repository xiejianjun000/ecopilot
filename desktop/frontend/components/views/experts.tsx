"use client"
import { Brain, ShieldCheck, Leaf, Search, ChartBar, AlertTriangle, RefreshCw, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { useApp } from "@/lib/store"

// 语义化颜色 token，不再硬编码
const EXPERTS = [
  { id:"ecomind",name:"综合管家",desc:"全链条统筹协调·意图识别→专家路由", icon:Brain, color:"var(--color-success)", skills:3, lastUsed:"14:30" },
  { id:"permit",name:"排污许可专家",desc:"许可证申领/变更/延续·60天预警", icon:ShieldCheck, color:"var(--color-info)", skills:5, lastUsed:"11:20" },
  { id:"carbon",name:"碳排放专家",desc:"碳核算/配额/碳市场·MRV管理", icon:Leaf, color:"var(--color-muted-foreground)", skills:4, lastUsed:"昨天" },
  { id:"env-monitoring",name:"环境监测专家",desc:"CEMS/自行监测·数据造假识别", icon:ChartBar, color:"var(--color-info)", skills:6, lastUsed:"昨天" },
  { id:"compliance",name:"合规巡检专家",desc:"台账管理/自查自纠·执行报告追踪", icon:Search, color:"var(--color-warning)", skills:4, lastUsed:"6/20" },
  { id:"emergency",name:"应急专家",desc:"应急预案/隐患排查·应急处置方案", icon:AlertTriangle, color:"var(--color-destructive)", skills:3, lastUsed:"6/20" },
  { id:"cleaner",name:"清洁生产专家",desc:"清洁生产/绿色工厂·节能减排方案", icon:RefreshCw, color:"var(--color-success)", skills:2, lastUsed:"5/15", offline:true },
]

export function ExpertsView() {
  const { dispatch } = useApp()

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-display font-bold text-foreground flex items-center gap-2"><Brain className="size-5 text-eco-600"/>专家团队</h2>
          <span className="text-xs text-muted-foreground">{EXPERTS.filter(e=>!e.offline).length}/{EXPERTS.length} 在线</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {EXPERTS.map(e=>{
            const Icon = e.icon
            return (
              <div key={e.id} className={cn("rounded-xl border bg-card p-5 hover:border-eco-300 hover:shadow-sm transition-all cursor-pointer group", e.offline?"opacity-50":"border-border")}>
                <div className="flex items-start gap-3 mb-3">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-xl" style={{background:e.color+"15"}}>
                    <Icon className="size-6" style={{color:e.color}} strokeWidth={1.5}/>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-foreground text-body">{e.name}</h3>
                      <span className={cn("size-2 rounded-full",e.offline?"bg-muted-foreground/40":"bg-success")}/>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{e.desc}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{e.skills} skills</span>
                    <span>上次 {e.lastUsed}</span>
                  </div>
                  <button onClick={()=>{
                    dispatch({type:"SET_NAV",nav:"chat"})
                  }} disabled={e.offline}
                    className="flex items-center gap-1.5 rounded-lg bg-eco-600 px-3 py-1.5 text-xs text-white hover:bg-eco-700 disabled:opacity-50 transition-colors">
                    <Zap className="size-3"/>召唤
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
