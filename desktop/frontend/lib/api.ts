import type { MemoryItem, DiaryEntry } from "./store"

// ═══════════════ EcoPilot API 客户端 ═══════════════

const API = typeof window !== 'undefined' && (window as any).__ECO_API_BASE__
  || process.env.NEXT_PUBLIC_API_BASE
  || 'http://127.0.0.1:8002'

export function getApiBase() { return API }

// C-2: 本地 token 认证（存内存，不存 localStorage）
let _authToken: string | null = null

/** 获取并缓存认证 token（首次调用时从 /api/auth/token 拉取） */
export async function ensureAuthToken(): Promise<void> {
  if (_authToken) return
  try {
    const res = await fetch(`${API}/api/auth/token`)
    if (res.ok) {
      const data = await res.json()
      if (data?.token) _authToken = data.token
    }
  } catch {
    // 忽略 — 后续请求会收到 401
  }
}

/** 构建带认证的请求头（供组件直接 fetch 时使用） */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra }
  if (_authToken) headers['Authorization'] = `Bearer ${_authToken}`
  return headers
}

/** 获取已缓存的 token 字符串（供构造 URL 查询参数时使用，需先调用 ensureAuthToken） */
export function getAuthToken(): string | null {
  return _authToken
}

/** SSE 流式请求（支持 AbortController 中断） */
export async function* streamSSE(
  path: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal
): AsyncGenerator<Record<string, unknown>> {
  await ensureAuthToken()
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: body ? JSON.stringify(body) : undefined,
    signal,
  })
  if (!res.ok || !res.body) throw new Error(`SSE 连接失败: ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try { yield JSON.parse(line.slice(6)) }
          catch { /* skip malformed */ }
        }
      }
    }
  } catch (err: unknown) {
    // AbortError 是预期的（用户点停止），其他错误抛出
    if (err instanceof Error && err.name === 'AbortError') return
    throw err
  } finally {
    try { reader.releaseLock() } catch {}
  }
}

/** JSON 请求 */
async function post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  await ensureAuthToken()
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json()
}

// ═══ 健康检查 ═══
export async function checkHealth() {
  const res = await fetch(`${API}/api/chat/health`)
  return res.json() as Promise<{
    ready: boolean
    text_model: string
    vision_model: string
    text_ready: boolean
    vision_ready: boolean
  }>
}

// ═══ 模型列表 ═══
export interface ModelInfo {
  id: string
  name: string
  provider: string
  available: boolean
  desc: string
}

export async function getAvailableModels() {
  await ensureAuthToken()
  const res = await fetch(`${API}/api/models/available`, { headers: authHeaders() })
  return res.json() as Promise<{
    text_models: ModelInfo[]
    vision_models: ModelInfo[]
    default_text: string
    default_vision: string
  }>
}

// ═══ 聊天 ═══
export function streamChat(
  message: string,
  permitData?: unknown,
  images?: string[],
  model?: string,
  signal?: AbortSignal,
  sessionId?: string,
) {
  return streamSSE('/api/chat/stream', {
    message,
    session_id: sessionId ?? undefined,
    permit_data: permitData,
    ...(model ? { model } : {}),
    ...(images && images.length > 0 ? { images_base64: images } : {})
  }, signal)
}

// ═══ 许可证 ═══
export async function quickCheck() {
  return post<{
    ok: boolean
    report_status: string
    report_date: string
    permit_status: string
    permit_date: string
    monitoring: string
    rectification: string
  }>('/api/permit/quick-check')
}

export async function getPermitData(sessionId: string) {
  return post<{ ok: boolean; data: Record<string, unknown> }>(
    '/api/permit/data',
    { session_id: sessionId }
  )
}

export function streamPermitRead(sessionId: string) {
  return streamSSE('/api/permit/license/full/stream', { session_id: sessionId })
}

/** 一站式全模块读取 + AI 综合分析（4阶段：许可证20卡 / 执行6模块 / 平台16模块 / AI分析） */
export function streamPermitFullRead(sessionId: string, textModel?: string) {
  return streamSSE('/api/permit/full/stream', {
    session_id: sessionId,
    ...(textModel ? { text_model: textModel } : {})
  })
}

export function streamSafariInspect() {
  return streamSSE('/api/permit/safari/inspect')
}

// ═══ 登录 ═══
export async function quickLogin(username: string, password: string, visionModel?: string) {
  return post<{ ok: boolean; session_id: string; detail: string }>(
    '/api/permit/login/quick',
    { username, password, vision_model: visionModel || "" }
  )
}

// 人工登录：初始化会话，获取平台验证码图片
export async function initPermitLogin() {
  return post<{ ok: boolean; session_id: string; captcha_image: string; detail: string }>(
    '/api/permit/login/init',
    {}
  )
}

// 人工登录：提交账号+密码+用户手动输入的验证码
export async function submitPermitLogin(sessionId: string, username: string, password: string, captcha: string) {
  return post<{ ok: boolean; session_id: string; detail: string }>(
    '/api/permit/login/submit',
    { session_id: sessionId, username, password, captcha }
  )
}

// ═══ 日历 / 台账 ═══
export async function getCalendarTasks() {
  return post<{ ok: boolean; tasks: Array<Record<string, unknown>> }>(
    '/api/calendar/tasks',
    { action: 'list' }
  )
}

export async function getLedger() {
  return post<{ ok: boolean; templates: Array<Record<string, unknown>> }>(
    '/api/calendar/ledger',
    { action: 'list' }
  )
}

// ═══ 统一 API 请求封装 ═══
interface ApiResult<T> {
  ok: boolean
  data?: T
  error?: string
  status: number
}

/**
 * 统一 API 请求封装 — 替代组件内直接 fetch
 * @example
 * const { ok, data, error } = await apiRequest<VaultList>('/api/vault/list')
 * if (!ok) showError(error)
 */
export async function apiRequest<T = unknown>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'DELETE' | 'PUT'
    body?: Record<string, unknown>
    query?: Record<string, string>
  } = {}
): Promise<ApiResult<T>> {
  const { method = 'GET', body, query } = options
  let url = `${API}${path}`
  if (query) {
    const sp = new URLSearchParams(query)
    url += `?${sp.toString()}`
  }

  // C-2: 获取认证 token（健康检查端点不需要，其他端点需要）
  if (path !== '/api/chat/health' && path !== '/api/auth/token') {
    await ensureAuthToken()
  }

  // 监控：记录 API 延迟（排除监控端点本身，避免循环）
  const _trackLatency = !path.startsWith('/api/ops/')
  const _t0 = _trackLatency ? performance.now() : 0

  try {
    const res = await fetch(url, {
      method,
      headers: authHeaders(body ? { 'Content-Type': 'application/json' } : undefined),
      body: body ? JSON.stringify(body) : undefined,
    })

    const text = await res.text()
    let data: unknown
    try { data = text ? JSON.parse(text) : null }
    catch { data = text }

    if (!res.ok) {
      const errMsg = (data as { detail?: string })?.detail || `请求失败: ${res.status}`
      // 上报错误
      if (_trackLatency && typeof window !== 'undefined') {
        import('./monitor-sdk').then(({ monitor }) => {
          monitor.error(`API ${path} ${res.status}: ${errMsg}`, { endpoint: path, status: res.status })
        })
      }
      return { ok: false, error: errMsg, status: res.status }
    }

    // 上报延迟
    if (_trackLatency && typeof window !== 'undefined') {
      const latency = performance.now() - _t0
      import('./monitor-sdk').then(({ monitor }) => {
        monitor.apiLatency(path, latency)
      })
    }

    return { ok: true, data: data as T, status: res.status }
  } catch (err) {
    if (_trackLatency && typeof window !== 'undefined') {
      import('./monitor-sdk').then(({ monitor }) => {
        monitor.error(`API ${path} 网络错误: ${err instanceof Error ? err.message : 'unknown'}`, { endpoint: path })
      })
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : '网络错误',
      status: 0,
    }
  }
}

/** GET 请求快捷方法 */
export const apiGet = <T = unknown>(path: string, query?: Record<string, string>) =>
  apiRequest<T>(path, { method: 'GET', query })

/** POST 请求快捷方法 */
export const apiPost = <T = unknown>(path: string, body?: Record<string, unknown>) =>
  apiRequest<T>(path, { method: 'POST', body })

/** DELETE 请求快捷方法 */
export const apiDelete = <T = unknown>(path: string, query?: Record<string, string>) =>
  apiRequest<T>(path, { method: 'DELETE', query })

/** PUT 请求快捷方法 */
export const apiPut = <T = unknown>(path: string, body?: Record<string, unknown>) =>
  apiRequest<T>(path, { method: 'PUT', body })

// ═══ 合规记忆 / 工作日志 ═══

/**
 * 拉取合规记忆列表（后端 GET /api/memory/list → {memories: [...]}）
 * 兼容数组直返 / {items: [...]} 等变体；后端字段 snake_case 自动映射
 */
export async function fetchMemories(): Promise<MemoryItem[]> {
  const r = await apiGet<unknown>("/api/memory/list")
  if (!r.ok || !r.data) return []
  const data = r.data
  const list: Record<string, unknown>[] = Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : ((data as { memories?: Record<string, unknown>[]; items?: Record<string, unknown>[] })?.memories
      || (data as { items?: Record<string, unknown>[] })?.items
      || []) as Record<string, unknown>[]
  return list.map((m, i) => ({
    id: String(m.id ?? `mem-${i}`),
    category: String(m.category ?? m.type ?? "其他"),
    content: String(m.content ?? m.text ?? ""),
    createdAt: String(m.createdAt ?? m.created_at ?? m.time ?? new Date().toISOString()),
  }))
}

/**
 * 删除合规记忆（后端 DELETE /api/memory/{id}）
 */
export async function deleteMemory(id: string): Promise<void> {
  await apiDelete(`/api/memory/${encodeURIComponent(id)}`)
}

/**
 * 拉取工作日志列表（后端 GET /api/journal/list → [{date, title, content, entries_count}]）
 * 字段映射：后端 content → 前端 summary；兼容 {journals: [...]} 包裹形式
 */
export async function fetchJournals(): Promise<DiaryEntry[]> {
  const r = await apiGet<unknown>("/api/journal/list")
  if (!r.ok || !r.data) return []
  const data = r.data
  const list: Record<string, unknown>[] = Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : ((data as { journals?: Record<string, unknown>[]; items?: Record<string, unknown>[] })?.journals
      || (data as { items?: Record<string, unknown>[] })?.items
      || []) as Record<string, unknown>[]
  return list.map((j, i) => {
    const date = String(j.date ?? "")
    return {
      id: String(j.id ?? (date || `journal-${i}`)),
      date,
      title: String(j.title ?? ""),
      summary: String(j.summary ?? j.content ?? ""),
    }
  })
}

