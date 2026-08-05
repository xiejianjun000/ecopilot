/** 档案库共享类型与工具函数 */

/** 上传目标 */
export interface UploadTarget { tpl_id: string; name: string; cat: string }

/** 档案操作响应 */
export interface VaultOpResult {
  ok: boolean
  detail?: string
  md_filename?: string
  results?: SyncResult[]
}

/** 单个档案同步结果 */
interface SyncResult {
  ok: boolean
  vault_id?: string
  md_filename?: string
  detail?: string
}

export interface VaultFile {
  id: string; filename: string; original_name: string; category: string
  code: string; desc: string; tpl_id: string | null
  upload_date: string; size: number; mime_type: string; ext: string
}

export interface RequiredDoc {
  tpl_id: string; name: string; cat: string; desc: string; uploaded: boolean
}

export type MergedItem =
  | (VaultFile & { kind: "uploaded" })
  | (RequiredDoc & { kind: "missing" })

export interface Subcat { name: string; phase: string }
export interface Phase { id: string; label: string }

export const VAULT_ALLOWED_EXT = [
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp",
  ".txt", ".md", ".csv", ".zip", ".rar", ".7z",
]

/** 兼容别名（与 vault.tsx 内部命名保持一致） */
export const ALLOWED_EXT = VAULT_ALLOWED_EXT

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function fmtDate(iso: string): string {
  if (!iso) return ""
  try { return new Date(iso).toLocaleDateString("zh-CN") } catch { return iso.slice(0, 10) }
}

export function pathExt(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx).toLowerCase() : ''
}

export function extLabel(ext: string): string {
  return ext ? ext.replace(".", "").toUpperCase() : ""
}
