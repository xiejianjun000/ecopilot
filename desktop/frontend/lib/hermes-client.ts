/**
 * Hermes API 客户端 — 访问所有 Hermes Agent 后端能力
 *
 * 对接 desktop/server/routes/hermes.py
 */

import { getApiBase, authHeaders, ensureAuthToken } from './api'

// ═══════════════ Types ═══════════════

export interface CuratorStatus {
  enabled: boolean
  runs?: number
  last_run?: string
  interval?: string
  stale_after?: string
  archive_after?: string
  consolidate?: string
  agent_skills_total?: number
  agent_skills_active?: number
  agent_skills_stale?: number
  agent_skills_archived?: number
  most_active?: SkillActivity[]
  least_active?: SkillActivity[]
  least_recently_active?: SkillActivity[]
}

export interface SkillActivity {
  name: string
  activity?: string
  use?: string
  view?: string
  patches?: string
  last_activity?: string
}

export interface HermesSkill {
  name: string
  category: string
  source: string
  trust: string
  status: string
}

export interface SkillsResponse {
  skills: HermesSkill[]
  total: number
}

export interface JourneyNode {
  id: string
  label: string
  kind: string
  timestamp: number
  category: string
  useCount: number
  state: string
  createdBy: string | null
  pinned: boolean
}

export interface JourneyResponse {
  nodes: JourneyNode[]
  edges?: Array<{ from: string; to: string }>
}

export interface JourneyStats {
  total_nodes: number
  total_edges: number
  categories: Record<string, number>
  states: Record<string, number>
  kinds: Record<string, number>
}

export interface HermesHealth {
  ok: boolean
  version?: string
  connected: boolean
}

// ═══════════════ Client ═══════════════

const API = getApiBase()

async function fetchHermes(path: string, options?: RequestInit) {
  await ensureAuthToken()
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...options?.headers },
  })
  if (!res.ok) {
    console.error(`[Hermes] ${path} failed: ${res.status}`)
    return null
  }
  return res.json()
}

// ─── Health ───────────────────────────

export async function getHermesHealth(): Promise<HermesHealth | null> {
  return fetchHermes('/api/hermes/health')
}

// ─── Curator ──────────────────────────

export async function getCuratorStatus(): Promise<CuratorStatus | null> {
  return fetchHermes('/api/hermes/curator/status')
}

export async function triggerCuratorRun(): Promise<{ triggered: boolean; output?: string } | null> {
  return fetchHermes('/api/hermes/curator/run', { method: 'POST' })
}

export async function curatorPause(): Promise<{ paused: boolean } | null> {
  return fetchHermes('/api/hermes/curator/pause', { method: 'POST' })
}

export async function curatorResume(): Promise<{ resumed: boolean } | null> {
  return fetchHermes('/api/hermes/curator/resume', { method: 'POST' })
}

export async function curatorPrune(days = 90): Promise<{ pruned: boolean; output?: string } | null> {
  return fetchHermes(`/api/hermes/curator/prune?days=${days}`, { method: 'POST' })
}

// ─── Skills ───────────────────────────

export async function getSkills(source = 'all'): Promise<SkillsResponse | null> {
  return fetchHermes(`/api/hermes/skills?source=${source}`)
}

export async function searchSkills(q: string): Promise<{ results: Array<{ name: string }> } | null> {
  return fetchHermes(`/api/hermes/skills/search?q=${encodeURIComponent(q)}`)
}

export async function installSkill(name: string): Promise<{ installed: boolean; output?: string } | null> {
  return fetchHermes('/api/hermes/skills/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function uninstallSkill(name: string): Promise<{ uninstalled: boolean; output?: string } | null> {
  return fetchHermes(`/api/hermes/skills/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

export async function inspectSkill(name: string): Promise<Record<string, string> | null> {
  return fetchHermes(`/api/hermes/skills/${encodeURIComponent(name)}`)
}

// ─── Journey ──────────────────────────

export async function getJourney(): Promise<JourneyResponse | null> {
  return fetchHermes('/api/hermes/journey')
}

export async function getJourneyStats(): Promise<JourneyStats | null> {
  return fetchHermes('/api/hermes/journey/stats')
}

// ─── Insights ─────────────────────────

export async function getInsights(): Promise<Record<string, any> | null> {
  return fetchHermes('/api/hermes/insights')
}

// ─── Doctor ───────────────────────────

export async function getHermesDoctor(): Promise<{ healthy: boolean; output?: string } | null> {
  return fetchHermes('/api/hermes/doctor')
}
