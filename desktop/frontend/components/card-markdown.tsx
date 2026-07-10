"use client"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { AlertTriangle, ShieldCheck, Scale, TrendingUp, FileText, Info } from "lucide-react"

/* ── 卡片头部样式 ── */
function cardMeta(text: string): { border: string; icon: typeof ShieldCheck; accent: string } {
  const t = text.toLowerCase()
  if (t.includes("致命")||t.includes("违反")||t.includes("逾期")||t.includes("处罚")||t.includes("罚款")||t.includes("🔴"))
    return { border: "border-l-destructive", icon: AlertTriangle, accent: "bg-destructive/10 border-destructive/30" }
  if (t.includes("风险")||t.includes("注意")||t.includes("补正")||t.includes("🟠")||t.includes("⚠️"))
    return { border: "border-l-warning", icon: AlertTriangle, accent: "bg-warning/10 border-warning/30" }
  if (t.includes("完成")||t.includes("正常")||t.includes("通过")||t.includes("✅"))
    return { border: "border-l-success", icon: ShieldCheck, accent: "bg-success/10 border-success/30" }
  if (t.includes("法规")||t.includes("条款")||t.includes("条例")||t.includes("§"))
    return { border: "border-l-info", icon: Scale, accent: "bg-info/10 border-info/30" }
  if (t.includes("案例")||t.includes("万元"))
    return { border: "border-l-warning", icon: FileText, accent: "bg-warning/10 border-warning/30" }
  if (t.includes("标准")||t.includes("限值")||t.includes("mg/")||t.includes("监测"))
    return { border: "border-l-info", icon: TrendingUp, accent: "bg-info/10 border-info/30" }
  if (t.includes("建议")||t.includes("下一步"))
    return { border: "border-l-eco-500", icon: Info, accent: "bg-eco-50/50 border-eco-200" }
  return { border: "border-l-border", icon: Info, accent: "bg-secondary/50 border-border" }
}

export function CardMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h2: ({ children, ...props }) => {
          const text = String(children || "")
          const meta = cardMeta(text)
          const Icon = meta.icon
          return (
            <div className={`rounded-xl border ${meta.border} ${meta.accent} overflow-hidden shadow-sm hover:shadow transition-shadow mb-3`}>
              <div className="flex items-center gap-2 px-4 py-2.5">
                <Icon className="size-3.5 text-muted-foreground shrink-0" strokeWidth={1.5} />
                <span className="text-body font-semibold text-foreground">{children}</span>
              </div>
            </div>
          )
        },
        p: ({ children }) => <p className="my-0.5 text-body leading-relaxed text-foreground">{children}</p>,
        ul: ({ children }) => <ul className="my-0.5 pl-5 space-y-0">{children}</ul>,
        ol: ({ children }) => <ol className="my-0.5 pl-5 space-y-0">{children}</ol>,
        li: ({ children }) => <li className="my-0 text-body">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-eco-300 pl-3 my-1 italic text-muted-foreground">{children}</blockquote>
        ),
        code: ({ children, className }) =>
          !className
            ? <code className="bg-secondary px-1.5 py-0.5 rounded text-body font-mono">{children}</code>
            : <code className={className}>{children}</code>,
        pre: ({ children }) => <pre className="bg-secondary rounded-lg p-3 my-1.5 overflow-x-auto text-body font-mono">{children}</pre>,
        table: ({ children }) => (
          <div className="overflow-x-auto my-1.5"><table className="w-full text-body border-collapse">{children}</table></div>
        ),
        th: ({ children }) => <th className="border border-border bg-secondary px-2.5 py-1.5 text-left font-semibold">{children}</th>,
        td: ({ children }) => <td className="border border-border px-2.5 py-1.5">{children}</td>,
        hr: () => <hr className="my-2 border-border" />,
      }}
    />
  )
}
