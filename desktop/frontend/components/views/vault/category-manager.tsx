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

import { type VaultOpResult } from "./types"

export function CategoryManager({ subcats, phases, onClose, onSaved }: {
  subcats: { name: string; phase: string }[]
  phases: { id: string; label: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const [list, setList] = useState<{ name: string; phase: string }[]>(subcats.map(s => ({ ...s })))
  const [renames, setRenames] = useState<Record<string, string>>({})
  const [newCat, setNewCat] = useState("")
  const [newCatPhase, setNewCatPhase] = useState(phases[1]?.id || "operation")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const updateName = (i: number, val: string) => {
    const old = list[i].name
    const next = [...list]
    next[i] = { ...next[i], name: val }
    setList(next)
    if (val !== old) {
      setRenames(r => ({ ...r, [old]: val }))
    } else {
      setRenames(r => {
        const c = { ...r }; delete c[old]; return c
      })
    }
  }

  const updatePhase = (i: number, phase: string) => {
    const next = [...list]
    next[i] = { ...next[i], phase }
    setList(next)
  }

  const remove = (i: number) => {
    const name = list[i].name
    if (name === "其他") { setError("“其他”是系统兜底分类，不可删除"); return }
    const next = [...list]; next.splice(i, 1)
    setList(next)
    setRenames(r => {
      const c = { ...r }; delete c[name]; return c
    })
  }

  const add = () => {
    const v = newCat.trim()
    if (!v) return
    if (list.some(s => s.name === v)) { setError("分类已存在"); return }
    setList([...list, { name: v, phase: newCatPhase }])
    setNewCat("")
    setError("")
  }

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= list.length) return
    const next = [...list]
    ;[next[i], next[j]] = [next[j], next[i]]
    setList(next)
  }

  const save = async () => {
    const seen = new Set<string>()
    for (const sc of list) {
      if (!sc.name.trim()) { setError("分类名不能为空"); return }
      if (seen.has(sc.name)) { setError(`分类名重复：${sc.name}`); return }
      seen.add(sc.name)
    }
    if (!list.some(s => s.name === "其他")) {
      list.push({ name: "其他", phase: "operation" })
    }
    setSaving(true); setError("")
    try {
      const r = await apiPost<VaultOpResult>('/api/vault/categories', { subcats: list, renames })
      if (r.ok && r.data?.ok) onSaved()
      else setError(r.data?.detail || r.error || "保存失败")
    } catch (e) {
      console.error('保存分类失败:', e)
      setError("网络错误")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/40" onClick={saving ? undefined : onClose} />
      <div className="relative z-10 w-[580px] max-w-[94vw] max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-background shadow-modal">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-eco-50">
              <Settings2 className="size-4.5 text-eco-600" />
            </div>
            <div>
              <h3 className="text-title font-semibold text-foreground">分类管理</h3>
              <p className="text-caption text-muted-foreground">按阶段管理子分类：重命名、新增、删除、调整归属</p>
            </div>
          </div>
          <button onClick={onClose} disabled={saving} aria-label="关闭" className="rounded-lg p-2 text-muted-foreground hover:bg-accent disabled:opacity-40">
            <X className="size-4" />
          </button>
        </div>

        {/* Body — 按阶段分组编辑 */}
        <div className="p-5 space-y-5">
          {phases.map(phase => {
            const phaseItems = list.map((s, i) => ({ ...s, _i: i })).filter(s => s.phase === phase.id)
            return (
              <div key={phase.id}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="rounded-md bg-eco-50 px-2 py-0.5 text-xs font-semibold text-eco-700">{phase.label}</span>
                  <span className="text-caption text-muted-foreground tabular-nums">{phaseItems.length} 项</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="space-y-1.5">
                  {phaseItems.map(item => (
                    <div key={item._i} className="flex items-center gap-2">
                      <div className="flex flex-col gap-0.5">
                        <button onClick={() => move(item._i, -1)} disabled={item._i === 0} aria-label="上移" className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                          <ArrowUp className="size-3" />
                        </button>
                        <button onClick={() => move(item._i, 1)} disabled={item._i === list.length - 1} aria-label="下移" className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                          <ArrowDown className="size-3" />
                        </button>
                      </div>
                      <GripVertical className="size-3.5 text-muted-foreground/40" />
                      <input
                        value={item.name}
                        onChange={e => updateName(item._i, e.target.value)}
                        disabled={saving}
                        className={cn(
                          "flex-1 rounded-lg border border-border bg-card px-3 py-2 text-body focus:outline-none focus:ring-2 focus:ring-eco-200 disabled:opacity-60",
                          renames[item.name] && renames[item.name] !== item.name && "border-warning/40 bg-warning/10"
                        )}
                      />
                      {/* 阶段切换下拉 */}
                      <select
                        value={item.phase}
                        onChange={e => updatePhase(item._i, e.target.value)}
                        disabled={saving || item.name === "其他"}
                        className="rounded-lg border border-border bg-card px-2 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-eco-200 disabled:opacity-60"
                      >
                        {phases.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                      <button
                        onClick={() => remove(item._i)}
                        disabled={saving || item.name === "其他"}
                        className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:cursor-not-allowed"
                        title={item.name === "其他" ? "“其他”不可删除" : "删除分类"}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  {phaseItems.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground/60 text-center">
                      此阶段暂无子分类
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* 新增分类 */}
          <div className="flex items-center gap-2 pt-3 border-t border-border">
            <input
              value={newCat}
              onChange={e => setNewCat(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") add() }}
              disabled={saving}
              placeholder="输入新分类名称，如：碳排放、土壤调查..."
              className="flex-1 rounded-lg border border-dashed border-eco-300 bg-eco-50/30 px-3 py-2 text-body focus:outline-none focus:ring-2 focus:ring-eco-200 disabled:opacity-60"
            />
            <select
              value={newCatPhase}
              onChange={e => setNewCatPhase(e.target.value)}
              disabled={saving}
              className="rounded-lg border border-border bg-card px-2 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-eco-200 disabled:opacity-60"
            >
              {phases.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <button onClick={add} disabled={saving || !newCat.trim()} className="flex items-center gap-1 rounded-lg bg-eco-600 px-3 py-2 text-xs text-eco-50 hover:bg-eco-700 disabled:opacity-40">
              <Plus className="size-3.5" /> 添加
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="size-3.5 shrink-0" />{error}
            </div>
          )}

          {/* 说明 */}
          <div className="rounded-lg bg-secondary/40 p-3 text-caption text-muted-foreground space-y-1">
            <p>• 重命名后，已上传档案的分类会自动同步</p>
            <p>• 删除分类后，该分类下的档案会归入"其他"</p>
            <p>• "其他"是系统兜底分类，不可删除、不可更改阶段</p>
            <p>• 可通过下拉框调整子分类所属阶段</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-border bg-secondary/20">
          <button onClick={onClose} disabled={saving} className="rounded-lg bg-secondary px-4 py-2 text-xs text-foreground hover:bg-accent disabled:opacity-40">取消</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-lg bg-eco-600 px-4 py-2 text-xs text-eco-50 hover:bg-eco-700 disabled:opacity-40">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
            {saving ? "保存中" : "保存分类"}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════
 * 编辑档案元数据弹窗（名称/分类/文号/描述）
 * ═══════════════════════════════════════════════════════ */

