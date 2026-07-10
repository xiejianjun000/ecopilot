"use client"
import { useState } from "react"
import { ExternalLink, Search, WifiOff, ShieldCheck, Clock } from "lucide-react"
import { cn } from "@/lib/utils"

const CATS = ["全部","核心","金融","报告","管理","监测"]

interface LinkItem {
  name: string
  url: string
  cat: string
  desc: string
  connected: boolean
  /** 暂未确认官方入口，渲染"即将上线"徽标 */
  soon?: boolean
}

const LINKS: LinkItem[] = [
  {name:"全国排污许可证管理信息平台",url:"https://permit.mee.gov.cn",cat:"核心",desc:"企业端。读许可证、执行报告、台账记录",connected:true},
  {name:"全国碳排放权交易市场",url:"https://www.cneeex.com",cat:"核心",desc:"钢铁行业2024年纳入。MRV数据报送、配额管理",connected:false},
  {name:"国家固体废物污染环境防治信息平台",url:"https://swmd.mee.gov.cn",cat:"核心",desc:"危险废物全过程管理+一般固废台账",connected:false},
  {name:"全国建设项目竣工环境保护验收信息系统",url:"http://114.251.109.18",cat:"核心",desc:"环境影响评价申报+审批进度查询",connected:false},
  {name:"全国污染源监测信息管理与共享平台",url:"https://monitoring.mee.gov.cn",cat:"核心",desc:"全国重点污染源在线监测数据平台",connected:false},
  {name:"环保税申报",url:"https://etax.chinatax.gov.cn",cat:"金融",desc:"环境保护税季度申报。污染当量数计算+减免条件判定",connected:false},
  // 以下暂未确认官方入口，标记为"即将上线"
  {name:"环境统计报表",url:"https://permit.mee.gov.cn",cat:"报告",desc:"年度环境统计报表。排放数据、能耗、水耗汇总上报",connected:false,soon:true},
  {name:"环境信息依法披露系统",url:"https://permit.mee.gov.cn",cat:"报告",desc:"企业环境信息依法披露。年度8大类信息+临时披露",connected:false,soon:true},
  {name:"环境应急预案备案",url:"https://permit.mee.gov.cn",cat:"管理",desc:"突发环境事件应急预案备案+更新提醒",connected:false,soon:true},
  {name:"清洁生产审核",url:"https://permit.mee.gov.cn",cat:"管理",desc:"清洁生产审核报告提交+评估验收",connected:false,soon:true},
  {name:"土壤污染隐患排查与地下水监测",url:"https://permit.mee.gov.cn",cat:"监测",desc:"土壤污染隐患排查+自行监测方案+污染修复",connected:false,soon:true},
  {name:"企业环境信用评价",url:"https://sthjt.fujian.gov.cn",cat:"金融",desc:"企业环境信用评价。五级评分+修复路径+绿色金融对接",connected:false},
]

export function LinksView() {
  const [cat, setCat] = useState("全部")
  const [search, setSearch] = useState("")
  const q = search.trim().toLowerCase()
  const filtered = LINKS.filter(l => (cat === "全部" || l.cat === cat) && (!q || l.name.toLowerCase().includes(q) || l.desc.toLowerCase().includes(q)))
  const connected = LINKS.filter(l=>l.connected).length

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-2.5">
        <p className="text-caption text-muted-foreground">12 个官方申报入口 · 新窗口打开</p>
        <span className="text-caption text-muted-foreground">已连接 {connected}/{LINKS.length}</span>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-4xl space-y-5">
        {/* Category tabs */}
        <div className="flex flex-wrap gap-1.5">
          {CATS.map(c=>(<button key={c} onClick={()=>setCat(c)} className={cn("rounded-lg px-3 py-1.5 text-xs",c===cat?"bg-eco-50 text-eco-700 font-medium":"text-muted-foreground hover:text-foreground hover:bg-accent")}>{c}</button>))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"/>
          <input value={search} onChange={e=>setSearch(e.target.value)} aria-label="搜索政务平台" placeholder="搜索平台名称或描述..."
            className="w-full rounded-xl border border-border bg-card pl-10 pr-4 py-2.5 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-eco-500"/>
        </div>

        {/* Link cards */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {filtered.length === 0 ? (
            <div className="col-span-full rounded-xl border border-dashed border-border bg-card p-8 text-center">
              <p className="text-body text-muted-foreground">未找到匹配的政务平台</p>
              <p className="text-caption text-muted-foreground mt-1">尝试更换关键词或切换分类</p>
            </div>
          ) : filtered.map(l=>(
            <a key={l.name} href={l.url} target="_blank" rel="noopener noreferrer" title={l.name} className={cn("flex items-start gap-3 rounded-xl border bg-card p-4 hover:border-eco-200 transition-colors group", l.connected?"border-border":"border-warning/30 bg-warning/10")}>
              <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg",l.connected?"bg-eco-50":"bg-warning/10")}>
                {l.connected?<ShieldCheck className="size-5 text-success"/>:l.soon?<Clock className="size-5 text-muted-foreground"/>:<WifiOff className="size-5 text-warning"/>}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-body font-medium text-foreground group-hover:text-eco-700">{l.name}</span>
                  <span className="text-caption rounded bg-secondary px-1 py-0.5 text-muted-foreground">{l.cat}</span>
                  {l.soon && (
                    <span className="text-caption rounded bg-info/10 px-1.5 py-0.5 font-medium text-info">即将上线</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{l.desc}</p>
                <div className="flex items-center gap-1.5 mt-2">
                  <span className={cn("size-1.5 rounded-full",l.connected?"bg-success":"bg-warning")}/>
                  <span className={cn("text-caption",l.connected?"text-success":"text-warning")}>{l.connected?"已连接":"待测试"}</span>
                </div>
              </div>
              <ExternalLink className="size-4 text-muted-foreground group-hover:text-eco-600 shrink-0 mt-1"/>
            </a>
          ))}
        </div>
        </div>
      </div>
    </div>
  )
}
