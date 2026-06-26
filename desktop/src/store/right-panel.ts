/**
 * 右侧面板 — 记忆/日记/资产 状态管理
 *
 * 记忆：AI 在任务结束时自动写 MEMORY.md 的结构化存储
 * 日记：按日历归档的工作日志
 * 资产：产出物结构化存储
 */

import { atom, computed } from 'nanostores'

// ─── 记忆 ───

export interface MemoryItem {
  id: string
  key: string
  value: string
  category: 'enterprise' | 'permit' | 'preference' | 'decision' | 'skill'
  createdAt: string
}

export const $memories = atom<MemoryItem[]>([
  { id: 'm1', key: '企业', value: '冷水江钢铁 · 黑色金属冶炼', category: 'enterprise', createdAt: '2026-06-23' },
  { id: 'm2', key: '许可证', value: '91431381748373560G001P · 2026-08-15到期', category: 'permit', createdAt: '2026-06-23' },
  { id: 'm3', key: '偏好', value: '报告格式：按工序分章节', category: 'preference', createdAt: '2026-06-24' },
  { id: 'm4', key: 'NH3-N超标应对流程', value: '检查脱硫废水处理系统 → 对比DB43/3082-2024标准 → 48h内检修并提交说明', category: 'skill', createdAt: '2026-06-25' },
  { id: 'm5', key: '许可证延续最佳路径', value: '到期前60天启动 → 先整改超标项 → 处理违规记录 → 提交延续申请', category: 'decision', createdAt: '2026-06-25' },
])

/** 添加记忆 */
export function addMemory(key: string, value: string, category: MemoryItem['category']): void {
  $memories.set([{ id: `m-${Date.now()}`, key, value, category, createdAt: new Date().toISOString().split('T')[0] }, ...$memories.get()])
}

// ─── 日记 ───

export interface DiaryEntry {
  id: string
  date: string
  time: string
  content: string
  tags: string[]
}

export const $diaryEntries = atom<DiaryEntry[]>([
  { id: 'd1', date: '2026-06-25', time: '14:30', content: '处理排污许可证延续申请 — 发现NH3-N超标，已记录超标处理流程', tags: ['许可证', '超标'] },
  { id: 'd2', date: '2026-06-25', time: '11:20', content: '碳排放数据核查 — 碳配额剩余12,500吨，按当前排放速率可用至9月', tags: ['碳排放'] },
  { id: 'd3', date: '2026-06-24', time: '09:00', content: '执行报告巡检 — Q2季度报告未提交（截止2026-07-15），已添加日历提醒', tags: ['执行报告', '巡检'] },
  { id: 'd4', date: '2026-06-23', time: '16:00', content: '合规日历配置 — 已设置许可证到期前60天预警、巡检任务调度', tags: ['日历'] },
  { id: 'd5', date: '2026-06-23', time: '10:30', content: '首次引导完成 — 绑定冷钢许可证、完成巡检、建立档案清单', tags: ['引导', '初始化'] },
])

/** 添加日记 */
export function addDiary(content: string, tags: string[]): void {
  const now = new Date()
  $diaryEntries.set([{
    id: `d-${Date.now()}`,
    date: now.toISOString().split('T')[0],
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    content,
    tags,
  }, ...$diaryEntries.get()])
}

// ─── 资产 ───

export interface AssetItem {
  id: string
  name: string
  type: 'report' | 'monitoring' | 'regulation' | 'carbon' | 'chart'
  category: string
  size: string
  updatedAt: string
}

export const $assets = atom<AssetItem[]>([
  { id: 'a1', name: '2026Q2排放报告', type: 'report', category: '报告文档', size: '2.3 MB', updatedAt: '2026-06-25' },
  { id: 'a2', name: '许可证延续申请材料', type: 'report', category: '报告文档', size: '856 KB', updatedAt: '2026-06-24' },
  { id: 'a3', name: '6月COD趋势图', type: 'monitoring', category: '监测数据', size: '124 KB', updatedAt: '2026-06-25' },
  { id: 'a4', name: '6月NH3-N趋势图', type: 'monitoring', category: '监测数据', size: '118 KB', updatedAt: '2026-06-25' },
  { id: 'a5', name: '排污许可管理条例', type: 'regulation', category: '法规资料', size: '45 KB', updatedAt: '2026-06-23' },
  { id: 'a6', name: '大气污染防治法', type: 'regulation', category: '法规资料', size: '38 KB', updatedAt: '2026-06-23' },
  { id: 'a7', name: '碳配额月度核算表', type: 'carbon', category: '碳数据', size: '234 KB', updatedAt: '2026-06-24' },
])

/** 按类型分组的 assets */
export const $assetsByType = computed($assets, list => {
  const map = new Map<string, AssetItem[]>()
  list.forEach(item => {
    const arr = map.get(item.category) || []
    arr.push(item)
    map.set(item.category, arr)
  })
  return map
})
