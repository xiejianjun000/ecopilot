"use client"
import { useState, useEffect, useRef, useCallback } from "react"
import {
  Upload, Search, AlertTriangle, CheckCircle2,
  FolderArchive, Download, X, Trash2, Loader2,
  ChevronDown, ChevronRight, PanelRightClose, Send, Sparkles,
  Settings2, Plus, GripVertical, ArrowUp, ArrowDown, Pencil,
  BookOpen, CheckCircle, Save,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getApiBase, streamSSE, apiGet, apiPost, apiDelete, apiPut, ensureAuthToken, authHeaders, getAuthToken } from "@/lib/api"

import { type VaultFile, type VaultOpResult } from "./types"

export function EditMetaModal({ file, categories, onClose, onSaved }: {
  file: VaultFile
  categories: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const [originalName, setOriginalName] = useState(file.original_name)
  const [category, setCategory] = useState(file.category)
  const [code, setCode] = useState(file.code || "")
  const [desc, setDesc] = useState(file.desc || "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const save = async () => {
    if (!originalName.trim()) { setError("文件名不能为空"); return }
    setSaving(true); setError("")
    try {
      const r = await apiPut<VaultOpResult>('/api/vault/file', {
        id: file.id,
        original_name: originalName.trim(),
        category,
        code: code.trim(),
        desc: desc.trim(),
      })
      if (r.ok && r.data?.ok) {
        onSaved()
      } else {
        setError(r.data?.detail || r.error || "保存失败")
      }
    } catch (e) {
      console.error('编辑档案失败:', e)
      setError("网络错误，保存失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/40" onClick={saving ? undefined : onClose} />
      <div className="relative z-10 w-[520px] max-w-[92vw] rounded-2xl border border-border bg-background shadow-modal">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-eco-50">
              <Pencil className="size-4.5 text-eco-600" />
            </div>
            <div>
              <h3 className="text-title font-semibold text-foreground">编辑档案信息</h3>
              <p className="text-caption text-muted-foreground">修改档案的显示名称、分类、文号和描述</p>
            </div>
          </div>
          <button onClick={onClose} disabled={saving} aria-label="关闭" className="rounded-lg p-2 text-muted-foreground hover:bg-accent disabled:opacity-40">
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-caption font-medium text-muted-foreground mb-1.5">档案名称</label>
            <input
              value={originalName}
              onChange={e => setOriginalName(e.target.value)}
              disabled={saving}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-body focus:outline-none focus:ring-2 focus:ring-eco-200 disabled:opacity-60"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-caption font-medium text-muted-foreground mb-1.5">档案分类</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                disabled={saving}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-body focus:outline-none focus:ring-2 focus:ring-eco-200 disabled:opacity-60"
              >
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-caption font-medium text-muted-foreground mb-1.5">文号 / 编号</label>
              <input
                value={code}
                onChange={e => setCode(e.target.value)}
                disabled={saving}
                placeholder="如：湘环评[2019]138号"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-body focus:outline-none focus:ring-2 focus:ring-eco-200 disabled:opacity-60"
              />
            </div>
          </div>
          <div>
            <label className="block text-caption font-medium text-muted-foreground mb-1.5">描述（可选）</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              disabled={saving}
              rows={3}
              placeholder="如：2025年度执行报告、废水零排放要求..."
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-body focus:outline-none focus:ring-2 focus:ring-eco-200 disabled:opacity-60 resize-none"
            />
          </div>
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="size-3.5 shrink-0" />{error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-border bg-secondary/20">
          <button onClick={onClose} disabled={saving} className="rounded-lg bg-secondary px-4 py-2 text-xs text-foreground hover:bg-accent disabled:opacity-40">取消</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-lg bg-eco-600 px-4 py-2 text-xs text-eco-50 hover:bg-eco-700 disabled:opacity-40">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
            {saving ? "保存中" : "保存"}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════
 * 右栏：文档预览 + AI 分析面板
 * ═══════════════════════════════════════════════════════ */

