import { File, FileText, FileType, Image as ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FileIconProps {
  ext: string
  className?: string
}

export function FileIcon({ ext, className }: FileIconProps) {
  const e = ext.toLowerCase()
  if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff'].includes(e)) return <ImageIcon className={className} />
  if (e === '.pdf') return <FileType className={className} />
  if (['.doc', '.docx'].includes(e)) return <FileText className={className} />
  if (['.xls', '.xlsx', '.csv'].includes(e)) return <FileText className={className} />
  return <File className={className} />
}

/** 按文件扩展名返回背景+前景色 */
export function fileTypeColor(ext: string): { bg: string; fg: string } {
  const e = ext.toLowerCase()
  if (e === '.pdf') return { bg: 'bg-destructive/10', fg: 'text-destructive' }
  if (['.doc', '.docx'].includes(e)) return { bg: 'bg-info/10', fg: 'text-info' }
  if (['.xls', '.xlsx', '.csv'].includes(e)) return { bg: 'bg-success/10', fg: 'text-success' }
  if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff'].includes(e)) return { bg: 'bg-info/10', fg: 'text-info' }
  if (['.txt', '.md'].includes(e)) return { bg: 'bg-secondary', fg: 'text-muted-foreground' }
  return { bg: 'bg-warning/10', fg: 'text-warning' }
}

/** 扩展名标签（不含点，大写） */
export function extLabel(ext: string): string {
  return ext ? ext.replace('.', '').toUpperCase() : ''
}

/** 通用文件大小格式化 */
export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 通用日期格式化 */
export function fmtDate(iso: string): string {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('zh-CN') } catch { return iso.slice(0, 10) }
}

/** 路径扩展名（含点，小写） */
export function pathExt(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx).toLowerCase() : ''
}

/** cn 工具重导出，方便组件内使用 */
export { cn }
