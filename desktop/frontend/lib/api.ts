import type { MemoryItem, DiaryEntry, SelfLearningSkill, EnterpriseEvolutionEntry } from "./store"
import type { WorkspaceEntry } from "./types"

// ═══════════════ EcoPilot API 客户端 ═══════════════

const API = typeof window !== 'undefined' && (window as any).__ECO_API_BASE__
  || process.env.NEXT_PUBLIC_API_BASE
  || 'http://127.0.0.1:8002'

/** 产品官网地址（闭环：升级/续费跳转） */
export const ECO_WEBSITE_URL = typeof window !== 'undefined' && (window as any).__ECO_WEBSITE_BASE__
  || 'http://81.71.49.185/site'

/** 获取升级定价页完整 URL */
export function getUpgradeUrl(tier?: string, billing?: string): string {
  let url = `${ECO_WEBSITE_URL}/pages/pricing.html`
  const params: string[] = []
  if (tier) params.push(`plan=${tier}`)
  if (billing) params.push(`billing=${billing}`)
  if (params.length) url += `?${params.join('&')}`
  return url
}

/** 获取升级弹窗内容 */
export function getUpgradeInfo(tier: string, reportsUsed: number, reportsQuota: number) {
  const isQuotaExceeded = tier === 'pro_trial' && reportsUsed >= reportsQuota
  return {
    show: isQuotaExceeded,
    title: isQuotaExceeded ? '试用版报告已用完' : '升级解锁更多功能',
    message: isQuotaExceeded
      ? `已使用 ${reportsUsed}/${reportsQuota} 份报告，升级专业版继续使用`
      : '升级专业版解锁无限报告生成',
    upgradeUrl: getUpgradeUrl('pro', 'monthly'),
    canDismiss: !isQuotaExceeded,
  }
}

export function getApiBase() { return API }

// C-2: 本地 token 认证（存内存，不存 localStorage）
let _authToken: string | null = null

/** 获取并缓存认证 token（首次调用时从 /api/auth/token 拉取）
 *  force=true 强制重取 — 后端每次重启会重新生成随机 token，
 *  前端缓存的旧 token 会 401，需要自愈刷新 */
export async function ensureAuthToken(force = false): Promise<void> {
  if (force) _authToken = null
  if (_authToken) return
  try {
    const res = await fetch(`${API}/api/auth/token`)
    if (res.ok) {
      const data = await res.json()
      if (data?.token) _authToken = data.token
    }
  } catch (err) {
    console.error("[api] ensureAuthToken 获取认证token失败:", err)
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
  let res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: body ? JSON.stringify(body) : undefined,
    signal,
  })
  // 401 自愈：后端重启后 token 已更换，重取后重试一次
  if (res.status === 401) {
    await ensureAuthToken(true)
    res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: body ? JSON.stringify(body) : undefined,
      signal,
    })
  }
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
async function post<T>(path: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  await ensureAuthToken()
  let res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: body ? JSON.stringify(body) : undefined,
    signal,
  })
  // 401 自愈：仅针对 token 失效（响应体不含 ok 字段）刷新重试；
  // 业务失败（ok:false，如验证码/密码/账号错误）不重试，避免重复登录尝试
  if (res.status === 401) {
    let isBusinessFailure = false
    try {
      const errBody = await res.clone().json()
      isBusinessFailure = typeof (errBody as { ok?: unknown })?.ok === 'boolean'
    } catch { /* 非 JSON 响应体，按 token 失效处理 */ }
    if (!isBusinessFailure) {
      await ensureAuthToken(true)
      res = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: body ? JSON.stringify(body) : undefined,
        signal,
      })
    }
  }
  if (!res.ok) {
    // 优先抛后端返回的具体原因（如"验证码错误"），避免只显示 "401"
    let detail = ''
    try {
      const body = await res.json()
      detail = (body as { detail?: string })?.detail || ''
    } catch { /* 忽略非 JSON 响应体 */ }
    throw new Error(detail || `${path}: ${res.status}`)
  }
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
  let res = await fetch(`${API}/api/models/available`, { headers: authHeaders() })
  if (res.status === 401) {
    await ensureAuthToken(true)
    res = await fetch(`${API}/api/models/available`, { headers: authHeaders() })
  }
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
  chatHistory?: { role: string; content: string }[],
) {
  return streamSSE('/api/chat/stream', {
    message,
    session_id: sessionId ?? undefined,
    permit_data: permitData,
    ...(model ? { model } : {}),
    ...(images && images.length > 0 ? { images_base64: images } : {}),
    ...(chatHistory && chatHistory.length > 0 ? { history: chatHistory } : {}),
  }, signal)
}

// ═══ 许可证 ═══
/** 许可证聚合包状态（官网 api 聚合池签发，内嵌 uid / points_quota） */
export interface LicenseStatus {
  valid: boolean
  customer: string
  user_id: string
  expire: string
  days_left: number
  tier: string
  report_quota: number
  reports_used: number
  quota_left: number
  trial_days: number
  points_quota: number
  points_used: number
  points_left: number
  daily_free_points: number
  can_chat: boolean
  can_report: boolean
  version: string
  // 向后兼容：旧字段仍可读取
  token_quota?: number
  tokens_used?: number
  tokens_left?: number
  daily_free_tokens?: number
}

export async function getLicenseStatus(): Promise<LicenseStatus> {
  const r = await apiGet<LicenseStatus>('/api/license/status')
  if (!r.ok || !r.data) {
    return {
      valid: false, customer: '', user_id: '', expire: '', days_left: 0, tier: 'free',
      report_quota: 0, reports_used: 0, quota_left: 0, trial_days: 0,
      points_quota: 0, points_used: 0, points_left: 0, daily_free_points: 0,
      can_chat: false, can_report: false, version: '1',
    }
  }
  return r.data
}

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

/** 许可证诊断状态（后端 GET /api/permit/summary 返回） */
/** 许可证详情单张卡（表格结构，rows 为二维单元格文本） */
export interface LicenseDetailCard {
  name: string
  tables: { rows: string[][] }[]
}

/** 许可证详情（排放口/限值/许可量/监测要求等 20 张数据卡） */
export interface LicenseDetail {
  ok: boolean
  dataid: string
  cards: Record<string, LicenseDetailCard>
  card_total: number
  ok_cards: number
}

/** 执行报告统计（平台读到的季度/年度报告） */
export interface ExecutionReports {
  total: number
  submitted: number
  quarter: number
  year: number
  month: number
  items: { type: string; year: number; quarter?: number; month?: number; label: string; status: string }[]
}

export interface PermitSummary {
  enterpriseName: string
  permitNumber: string
  creditCode: string
  validFrom: string
  validTo: string
  permitStatus: string
  permitApplyDate: string
  executionReportStatus: string
  monitoringStatus: string
  rectificationStatus: string
  industryCategory: string
  industryCode: string
  managementLevel: string
  legalRepresentative: string
  renewalHistory: unknown[]
  reapplicationHistory: unknown[]
  licenseDetail: LicenseDetail
  executionReports: ExecutionReports
  savedAt: number | null
}

/** 拉取许可证诊断状态（供合规诊断看板使用，无需平台会话） */
export async function getPermitSummary(): Promise<PermitSummary | null> {
  const r = await apiGet<{ ok: boolean; data: PermitSummary | null }>("/api/permit/summary")
  if (!r.ok || !r.data?.data) return null
  return r.data.data
}

/** 政务平台凭证（账户/密码，明文展示在卡片上） */
export interface PlatformCredentials {
  platform_id: string
  username: string
  password: string
}

/** 获取指定政务平台的已保存凭证 */
export async function getPlatformCredentials(platformId: string): Promise<PlatformCredentials | null> {
  const r = await apiGet<{ ok: boolean; data: PlatformCredentials | null }>("/api/platform/credentials", { platform_id: platformId })
  // status 0 = 网络错误（后端重启/不可达），抛出让调用方重试；其余情况返回 null 表示未保存凭证
  if (r.status === 0) throw new Error(r.error || "网络错误")
  if (!r.ok || !r.data?.data) return null
  return r.data.data
}

/** 保存指定政务平台的登录凭证（账户/密码） */
export async function savePlatformCredentials(platformId: string, username: string, password: string): Promise<boolean> {
  const r = await apiPost<{ ok: boolean; detail?: string }>("/api/platform/credentials", { platform_id: platformId, username, password })
  return r.ok === true
}

/** 无头浏览器实时截图（供右侧预览面板轮询） */
export interface BrowserScreenshot {
  image: string
  url: string
  logged_in: boolean
}

/** 对已登录会话截图（供右侧无头浏览器预览轮询） */
export async function getBrowserScreenshot(sessionId: string): Promise<BrowserScreenshot | null> {
  const r = await apiGet<{ ok: boolean; image?: string; url?: string; logged_in?: boolean }>("/api/permit/browser/screenshot", { session_id: sessionId })
  if (!r.ok || !r.data?.image) return null
  return { image: r.data.image, url: r.data.url || "", logged_in: !!r.data.logged_in }
}

/** 把预览面板的点击坐标转发到无头浏览器 */
export async function browserClick(sessionId: string, x: number, y: number): Promise<boolean> {
  const r = await apiPost<{ ok: boolean; detail?: string }>("/api/permit/browser/click", { session_id: sessionId, x, y })
  return r.ok === true
}

/** 打开指定平台的登录页（无头浏览器），返回 session_id 供预览面板手动登录 */
export async function openPlatformBrowser(platformId: string): Promise<{ ok: boolean; session_id: string; url: string; detail?: string }> {
  return post<{ ok: boolean; session_id: string; url: string; detail?: string }>(
    "/api/platform/browser/open",
    { platform_id: platformId },
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

// 通过 MCP（eco-permit-enterprise）读取排污许可平台数据
export function streamPermitReadMcp(textModel?: string) {
  return streamSSE('/api/permit/read-mcp', {
    ...(textModel ? { text_model: textModel } : {})
  })
}

export function streamSafariInspect() {
  return streamSSE('/api/permit/safari/inspect')
}

// ═══ 登录 ═══
// 人工登录：初始化会话，获取平台验证码图片
export async function initPermitLogin(signal?: AbortSignal) {
  return post<{ ok: boolean; session_id: string; captcha_image: string; detail: string }>(
    '/api/permit/login/init',
    {},
    signal
  )
}

// 人工登录：提交账号+密码+用户手动输入的验证码
export async function submitPermitLogin(sessionId: string, username: string, password: string, captcha: string) {
  return post<{ ok: boolean; session_id: string; detail: string }>(
    '/api/permit/login/submit',
    { session_id: sessionId, username, password, captcha }
  )
}

// 开发模式：跳过真实平台登录（后端仅在 ECOPILOT_DEV=1 时放行）
export async function devBypassLogin() {
  return post<{ ok: boolean; session_id: string; detail: string; dev: boolean }>(
    '/api/permit/login/dev-bypass',
    {}
  )
}

// 保存排污许可平台凭据到后端，触发 MCP stdio 连接重启
export async function savePermitCredentials(username: string, password: string) {
  return post<{ ok: boolean; detail: string; mcp_ready: boolean }>(
    '/api/permit/credentials/save',
    { username, password }
  )
}

// 通过 MCP（eco-permit-enterprise）auth_login 登录排污许可平台（无需验证码/浏览器）
export async function loginPermitMcp(username: string, password: string) {
  return post<{ ok: boolean; session_id: string; detail: string; mcp_ready: boolean; enterprise?: Record<string, unknown> }>(
    '/api/permit/login-mcp',
    { username, password }
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

/** 台账/自行监测周期义务（来自 card14/card15 平台解析 + 法规兜底） */
export interface ComplianceObligation {
  id: string
  type: 'monitor' | 'ledger'
  title: string
  frequency: string
  freqLabel: string
  intervalDays: number
  nextRunDate: string
  law: string
  desc: string
  source: 'platform' | 'regulation'
}

/** 拉取台账/自行监测周期义务列表（供合规日历与自动任务联动） */
export async function getComplianceObligations(): Promise<ComplianceObligation[]> {
  const r = await apiGet<{ ok: boolean; obligations: ComplianceObligation[] }>('/api/compliance/obligations')
  if (!r.ok || !r.data?.ok) return []
  return r.data.obligations || []
}

// ═══ 统一 API 请求封装 ═══
interface ApiResult<T> {
  ok: boolean
  data?: T
  error?: string
  status: number
  /** 402 配额耗尽时的升级信息 */
  quotaExceeded?: {
    code: string
    message: string
    upgrade_url: string
    current_tier: string
    reports_used: number
    reports_quota: number
  }
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
    let res = await fetch(url, {
      method,
      headers: authHeaders(body ? { 'Content-Type': 'application/json' } : undefined),
      body: body ? JSON.stringify(body) : undefined,
    })

    // 401 自愈：后端重启后 token 已更换，重取后重试一次
    if (res.status === 401 && path !== '/api/auth/token') {
      await ensureAuthToken(true)
      res = await fetch(url, {
        method,
        headers: authHeaders(body ? { 'Content-Type': 'application/json' } : undefined),
        body: body ? JSON.stringify(body) : undefined,
      })
    }

    const text = await res.text()
    let data: unknown
    try { data = text ? JSON.parse(text) : null }
    catch { data = text }

    if (!res.ok) {
      // ★ 402 配额耗尽: 携带升级信息给上层
      if (res.status === 402) {
        const qe = data as {
          code?: string; message?: string; upgrade_url?: string;
          current_tier?: string; reports_used?: number; reports_quota?: number;
        }
        return {
          ok: false,
          error: qe.message || '配额已用完',
          status: 402,
          quotaExceeded: {
            code: qe.code || 'QUOTA_EXCEEDED',
            message: qe.message || '配额已用完',
            upgrade_url: qe.upgrade_url || getUpgradeUrl(),
            current_tier: qe.current_tier || '',
            reports_used: qe.reports_used || 0,
            reports_quota: qe.reports_quota || 0,
          },
        }
      }
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

/**
 * 拉取自学习技能列表（后端 GET /api/self-learning/skills）
 */
export async function fetchSelfLearningSkills(): Promise<SelfLearningSkill[]> {
  const r = await apiGet<unknown>("/api/self-learning/skills")
  if (!r.ok || !r.data) return []
  const data = r.data
  const list: Record<string, unknown>[] = Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : ((data as { skills?: Record<string, unknown>[] })?.skills || []) as Record<string, unknown>[]
  return list.map(s => ({
    id: String(s.id ?? ""),
    name: String(s.name ?? ""),
    description: String(s.description ?? ""),
    autoGenerated: Boolean(s.auto_generated ?? false),
    generatedAt: String(s.generated_at ?? ""),
    size: Number(s.size ?? 0),
  }))
}

/**
 * 拉取企业进化日志（后端 GET /api/enterprise/evolution）
 */
export async function fetchEnterpriseEvolution(): Promise<EnterpriseEvolutionEntry[]> {
  const r = await apiGet<unknown>("/api/enterprise/evolution")
  if (!r.ok || !r.data) return []
  const data = r.data
  const list: Record<string, unknown>[] = Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : ((data as { entries?: Record<string, unknown>[] })?.entries || []) as Record<string, unknown>[]
  return list.map(e => ({
    timestamp: String(e.timestamp ?? ""),
    enterprise: String(e.enterprise ?? ""),
    knowledge: Array.isArray(e.knowledge) ? (e.knowledge as string[]) : [],
    sessionId: String(e.session_id ?? ""),
  }))
}

// ═══ 工作空间 ═══════════════════════════

export async function fetchWorkspaceList(path: string): Promise<WorkspaceEntry[]> {
  const r = await apiGet<{ ok: boolean; entries?: WorkspaceEntry[]; error?: string }>(`/api/workspace/list?path=${encodeURIComponent(path)}`)
  if (!r.ok || !r.data?.ok) {
    console.error('[api] 工作空间列表获取失败:', r.data?.error || r.error)
    return []
  }
  return r.data.entries || []
}

// ═══ Hermes Agent 集成（onboarding 流程）═══

/**
 * 唤醒 Hermes Agent — 配置大模型后调用
 *
 * 后端会:
 *   1. 初始化 HermesEngine 并 warmup
 *   2. 初始化 hermes_adapter 的 MemoryManager
 *   3. 返回 hermes_session_id（后续对话复用）
 *
 * 在 ModelConfigStep 保存模型后调用。
 */
export async function wakeHermes(): Promise<{
  ok: boolean
  hermes_session_id?: string
  detail?: string
}> {
  return post('/api/hermes/wake', {})
}

/**
 * 写入 Hermes 记忆 — 用户注册后 / 企业画像更新后调用
 *
 * @param target 写入目标: "user" | "enterprise" | "session"
 * @param id     用户ID / 企业ID / 会话ID
 * @param data   记忆数据
 *
 * - RegisterStep 注册后调用 (target=user)
 * - PermitReadingStep 读取许可证后调用 (target=enterprise)
 */
export async function saveToHermesMemory(
  target: 'user' | 'enterprise' | 'session',
  id: string,
  data: Record<string, unknown>,
): Promise<{ ok: boolean; detail?: string }> {
  return post('/api/hermes/memory', { target, id, data })
}

/**
 * 为指定行业批量安装 EcoSkill 技能
 *
 * 安装来源: http://111.230.89.107 (ecoskill.cn 备案中，暂用 IP)
 * 安装顺序:
 *   1. 行业专属远程技能 (INDUSTRY_REMOTE_SKILL_IDS)
 *   2. 通用远程技能 (UNIVERSAL_REMOTE_SKILL_IDS，所有行业都装)
 *   3. 行业兜底自定义技能（仅当远程无对应技能时）
 *
 * 在 PermitReadingStep 识别到行业后调用。
 */
export async function installIndustrySkills(industryCode: string): Promise<{
  ok: boolean
  industry_code?: string
  industry_name?: string
  installed?: string[]
  skipped?: string[]
  failed?: string[]
  total?: number
  detail?: string
}> {
  return post('/api/hermes/ecoskill/install-industry', { industry_code: industryCode })
}

/**
 * 获取行业对应的技能列表（不安装，仅预览）
 * 后端 GET /api/hermes/ecoskill/by-industry?code=<industry_code>
 */
export async function getIndustrySkills(industryCode: string): Promise<{
  ok: boolean
  industry_code?: string
  industry_name?: string
  industry_skill_ids?: string[]
  universal_skill_ids?: string[]
  custom_skills?: Array<Record<string, unknown>>
  market_skills?: Array<Record<string, unknown>>
}> {
  const r = await apiGet<Record<string, unknown>>(
    '/api/hermes/ecoskill/by-industry',
    { code: industryCode },
  )
  if (!r.ok || !r.data) return { ok: false }
  return { ok: true, ...(r.data as Record<string, unknown>) } as {
    ok: boolean
    industry_code?: string
    industry_name?: string
    industry_skill_ids?: string[]
    universal_skill_ids?: string[]
    custom_skills?: Array<Record<string, unknown>>
    market_skills?: Array<Record<string, unknown>>
  }
}

/**
 * 获取服务边界摘要（前端展示用）
 * 后端 GET /api/hermes/service-boundary
 */
export async function getServiceBoundary(): Promise<{
  ok: boolean
  management_level?: string
  scope?: string
  includes?: string[]
  excludes?: string[]
  report_freq?: string
  industry_code?: string
  industry_name?: string
  industry_mode?: string
  industry_standards?: string
  industry_focus?: string
}> {
  const r = await apiGet<Record<string, unknown>>('/api/hermes/service-boundary')
  if (!r.ok || !r.data) return { ok: false }
  return { ok: true, ...(r.data as Record<string, unknown>) } as {
    ok: boolean
    management_level?: string
    scope?: string
    includes?: string[]
    excludes?: string[]
    report_freq?: string
    industry_code?: string
    industry_name?: string
    industry_mode?: string
    industry_standards?: string
    industry_focus?: string
  }
}

// ═══ 写操作审批闸门（human-in-the-loop） ═══

/** 审批请求（写操作需用户批准后执行） */
export interface ApprovalItem {
  id: string
  op_type: string
  op_label: string
  status: 'pending' | 'approved' | 'rejected' | 'executed'
  preview: string
  source: string
  created_at: number
  reviewed_at: number | null
  executed_at: number | null
  reject_reason: string
  payload_size: number
}

/** 拉取审批列表（默认仅待审批） */
export async function fetchApprovals(pendingOnly = true): Promise<ApprovalItem[]> {
  const r = await apiGet<{ ok: boolean; approvals?: ApprovalItem[] }>(
    `/api/approval/list${pendingOnly ? '' : '?pending_only=false'}`
  )
  if (!r.ok || !r.data?.ok) return []
  return r.data.approvals || []
}

/** 批准审批请求（pending -> approved） */
export async function approveApproval(id: string): Promise<boolean> {
  const r = await apiPost<{ ok: boolean }>('/api/approval/approve', { approval_id: id })
  return r.ok === true
}

/** 拒绝审批请求（pending -> rejected） */
export async function rejectApproval(id: string, reason = ''): Promise<boolean> {
  const r = await apiPost<{ ok: boolean }>('/api/approval/reject', { approval_id: id, reason })
  return r.ok === true
}

/** 执行已批准的写操作（approved -> executed，一次性令牌） */
export async function executeApproval(id: string): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string }> {
  const r = await apiPost<{ ok: boolean; op_type?: string; result?: Record<string, unknown> }>(
    '/api/approval/execute', { approval_id: id }
  )
  if (!r.ok) return { ok: false, error: r.error }
  return { ok: true, result: r.data?.result }
}

