/** 档案库共享 UI 组件 */
import { File, FileText, FileType, Image as ImageIcon } from "lucide-react"
import { extLabel } from "./types"

export function FileIcon({ ext, className }: { ext: string; className?: string }) {
  const e = ext.toLowerCase()
  if ([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff"].includes(e)) return <ImageIcon className={className} />
  if (e === ".pdf") return <FileType className={className} />
  if ([".doc", ".docx"].includes(e)) return <FileText className={className} />
  if ([".xls", ".xlsx", ".csv"].includes(e)) return <FileText className={className} />
  return <File className={className} />
}

/** 按文件类型返回配色（背景+前景） */
export function fileTypeColor(ext: string): { bg: string; fg: string } {
  const e = ext.toLowerCase()
  if (e === ".pdf") return { bg: "bg-destructive/10", fg: "text-destructive" }
  if ([".doc", ".docx"].includes(e)) return { bg: "bg-info/10", fg: "text-info" }
  if ([".xls", ".xlsx", ".csv"].includes(e)) return { bg: "bg-success/10", fg: "text-success" }
  if ([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff"].includes(e)) return { bg: "bg-info/10", fg: "text-info" }
  if ([".txt", ".md"].includes(e)) return { bg: "bg-secondary", fg: "text-muted-foreground" }
  return { bg: "bg-warning/10", fg: "text-warning" }
}

/** 搜索高亮：在 text 中高亮匹配的 query */
export function HighlightText({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q || !text) return <>{text}</>
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-warning/20 px-0.5 text-foreground">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  )
}

export { extLabel }
