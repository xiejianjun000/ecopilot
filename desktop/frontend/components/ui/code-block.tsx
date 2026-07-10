"use client"
import { useState, useCallback } from "react"
import { Check, Copy } from "lucide-react"
import { cn } from "@/lib/utils"

interface CodeBlockProps {
  code: string
  language?: string
  className?: string
}

/** 代码块组件：语言标签 + 复制按钮 + 滚动条 */
export function CodeBlock({ code, language, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [code])

  const lang = language?.toLowerCase().trim() || "text"

  return (
    <div className={cn("group relative my-3 overflow-hidden rounded-xl border border-border bg-zinc-950", className)}>
      {/* 顶部栏：语言标签 + 复制按钮 */}
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-3 py-1.5">
        <span className="text-caption font-mono uppercase tracking-wider text-zinc-400">{lang}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-caption text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="复制代码"
        >
          {copied ? (
            <>
              <Check className="size-3" />
              已复制
            </>
          ) : (
            <>
              <Copy className="size-3" />
              复制
            </>
          )}
        </button>
      </div>
      {/* 代码内容 */}
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code className="font-mono text-zinc-100">{code}</code>
      </pre>
    </div>
  )
}
