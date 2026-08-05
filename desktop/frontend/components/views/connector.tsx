"use client"
import { useEffect, useState } from "react"
import { RefreshCw, Wifi, WifiOff, Terminal, ShieldCheck, FileText, Database, Lock, Navigation, ScanLine } from "lucide-react"
import { cn } from "@/lib/utils"
import { checkHealth } from "@/lib/api"

/* ═══════════════════════════════════════════════════════
 * EcoPilot 系统能力 — 业务语言视图
 *
 * 重构说明：
 *  - 移除 AI 模型卡片（模型配置已在「设置」模块，避免冗余）
 *  - 移除 chrome-devtools / safari MCP（运维专用通道，不暴露给企业用户）
 *  - 移除端口号展示（技术细节，无业务价值）
 *  - 工具名从技术标识符改为业务语言（quick_login → 许可证平台自动登录）
 *  - 后端服务保留健康状态展示（企业用户需确认系统可用性）
 * ═══════════════════════════════════════════════════════ */

/** 后端服务 — 企业用户需感知的系统可用性 */
const SERVICES = [
  { name: "EcoPilot 后端服务", icon: Terminal, desc: "提供许可证解析、合规审计、报告填报等核心能力", key: "backend" },
]

/** 业务能力清单 — 工具名转为业务语言 */
const CAPABILITIES = [
  { name: "排污许可合规审计", desc: "许可证 6 模块全覆盖合规检查", cat: "审计", icon: ShieldCheck },
  { name: "许可证数据提取", desc: "提取许可证完整数据（20 项指标）", cat: "数据", icon: Database },
  { name: "许可证卡片读取", desc: "读取许可证卡片关键信息", cat: "数据", icon: FileText },
  { name: "许可证平台自动登录", desc: "智能识别验证码并登录排污许可平台", cat: "认证", icon: Lock },
  { name: "模块导航", desc: "快速跳转至指定业务模块", cat: "导航", icon: Navigation },
  { name: "菜单项点击", desc: "模拟点击平台菜单项", cat: "导航", icon: Navigation },
  { name: "验证码刷新", desc: "自动刷新平台登录验证码", cat: "认证", icon: ScanLine },
]

export function ConnectorView() {
  const [health, setHealth] = useState<Record<string, boolean>>({})
  const [updated, setUpdated] = useState("")
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    setLoading(true)
    try {
      const h = await checkHealth()
      setHealth({ backend: true })
      setUpdated(new Date().toLocaleTimeString("zh-CN"))
      // 静默消费 text/vision 状态，不在系统能力页展示（模型配置走「设置」）
      void h.text_ready; void h.vision_ready; void h.text_model; void h.vision_model
    } catch { setHealth({ backend: false }) }
    setLoading(false)
  }

  useEffect(() => { refresh(); const t = setInterval(refresh, 30000); return () => clearInterval(t) }, [])

  const online = Object.values(health).filter(Boolean).length

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-2.5">
        <p className="text-caption text-muted-foreground">系统能力 · 后端服务状态 · 业务能力清单</p>
        <div className="flex items-center gap-3">
          <span className={cn("text-caption", online === SERVICES.length ? "text-muted-foreground" : "text-destructive")}>
            {online}/{SERVICES.length} 在线
          </span>
          <button onClick={refresh} aria-label="刷新连接状态" disabled={loading}
            className={cn("rounded-lg p-1.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-500", loading && "animate-spin")}>
            <RefreshCw className="size-4 text-muted-foreground" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-4xl space-y-5">

        {/* 状态概览卡片 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-card p-3 text-center">
            <div className={cn("text-xs mb-1", health.backend ? "text-muted-foreground" : "text-destructive")}>后端服务</div>
            <div className={cn("text-body font-medium", health.backend ? "text-foreground" : "text-destructive")}>
              {health.backend ? "运行中" : "离线"}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-3 text-center">
            <div className="text-xs mb-1 text-muted-foreground">状态更新</div>
            <div className="text-body font-medium text-foreground">{updated || "—"}</div>
          </div>
        </div>

        {/* 后端服务 */}
        <Section title="后端服务">
          {SERVICES.map(s => <ServiceRow key={s.key} s={s} ok={health[s.key] ?? false} />)}
        </Section>

        {/* 业务能力清单 */}
        <Section title={`业务能力（${CAPABILITIES.length} 项）`}>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {CAPABILITIES.map(c => (
              <div key={c.name} className="flex items-center gap-3 rounded-lg bg-secondary px-3 py-2.5 hover:bg-accent/50 transition-colors">
                <c.icon className="size-3.5 text-eco-600 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground">{c.name}</div>
                  <div className="text-caption text-muted-foreground">{c.desc}</div>
                </div>
                <span className="ml-auto shrink-0 text-caption px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{c.cat}</span>
              </div>
            ))}
          </div>
        </Section>

        <p className="text-center text-xs text-muted-foreground pb-6">每 30 秒自动刷新 · 模型配置请前往「设置」</p>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-body font-semibold text-muted-foreground uppercase tracking-wide mb-2">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function ServiceRow({ s, ok }: { s: typeof SERVICES[number]; ok: boolean }) {
  return (
    <div className={cn("flex items-center gap-4 rounded-xl border bg-card p-4 transition-colors",
      ok ? "border-border hover:border-eco-200" : "border-destructive/30 bg-destructive/10")}>
      <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", ok ? "bg-eco-50" : "bg-destructive/10")}>
        {ok ? <Wifi className="size-5 text-success" /> : <WifiOff className="size-5 text-destructive" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-body font-medium text-foreground">{s.name}</span>
          <span className={cn("size-1.5 rounded-full", ok ? "bg-success" : "bg-destructive")} />
          <span className={cn("text-xs", ok ? "text-success" : "text-destructive")}>{ok ? "已连接" : "离线"}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{s.desc}</div>
      </div>
    </div>
  )
}
