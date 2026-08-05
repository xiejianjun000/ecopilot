"use client"
/**
 * EcoPilot 监控 SDK — 前端自动采集 + 上报
 * ============================================
 * 职责：
 *   1. 自动捕获页面访问、错误、API 延迟
 *   2. 提供手动上报 API（chat、login、upload 等业务事件）
 *   3. 批量缓冲上报（避免高频请求）
 */
import { getApiBase, ensureAuthToken } from "./api"

type EventType =
  | "page_view" | "chat" | "tool_call" | "error" | "feedback"
  | "download" | "login" | "upload" | "api_latency" | "license_verify"
  | "onboarding_step" | "vault_sync" | "knowledge_search"

type Severity = "info" | "warning" | "error" | "critical"

interface MonitorEvent {
  type: EventType
  severity?: Severity
  user_id?: string
  enterprise?: string
  [key: string]: any
}

// ─── 批量缓冲 ───
const BUFFER: MonitorEvent[] = []
const BUFFER_MAX = 20
const FLUSH_INTERVAL = 10000 // 10 秒
let flushTimer: ReturnType<typeof setInterval> | null = null

// ─── 本地存储用户信息 ───
function getUserId(): string | undefined {
  try {
    const u = localStorage.getItem("ecopilot_user")
    if (u) {
      const parsed = JSON.parse(u)
      return parsed.name || parsed.phone || "anonymous"
    }
  } catch { /* localStorage unavailable */ }
  return undefined
}

function getEnterprise(): string | undefined {
  try {
    const e = localStorage.getItem("ecopilot_enterprise")
    if (e) return JSON.parse(e).name
  } catch { /* localStorage unavailable */ }
  return undefined
}

// ─── 上报 ───
// 标志：页面正在卸载（beforeunload 触发时设为 true）
// 卸载场景下 fetch 会被浏览器中止（net::ERR_ABORTED），改用 sendBeacon
let isUnloading = false

function send(events: MonitorEvent[]): void {
  if (events.length === 0) return
  const base = getApiBase()
  const url = `${base}/api/ops/event`
  events.forEach(ev => {
    try {
      // 页面卸载场景：使用 sendBeacon（不会被中止，不触发 CORS 预检）
      // 注意：sendBeacon 发送 text/plain 类型（simple request），避免预检
      // 后端 request.json() 不检查 Content-Type，可正常解析
      if (isUnloading && typeof navigator !== "undefined" && navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(ev)], { type: "text/plain" })
        navigator.sendBeacon(url, blob)
        return
      }
      // 常规场景：fetch + keepalive 能正确处理 CORS 预检
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ev),
        keepalive: true,
      }).catch(() => {})
    } catch { /* localStorage unavailable */ }
  })
}

function flush(): void {
  if (BUFFER.length === 0) return
  const batch = BUFFER.splice(0)
  send(batch)
}

function push(ev: MonitorEvent): void {
  // 注入公共字段
  if (!ev.user_id) ev.user_id = getUserId()
  if (!ev.enterprise) ev.enterprise = getEnterprise()
  if (!ev.severity) ev.severity = "info"

  BUFFER.push(ev)
  if (BUFFER.length >= BUFFER_MAX) {
    flush()
  }
}

// ─── 启动定时刷新 ───
if (typeof window !== "undefined") {
  if (flushTimer) clearInterval(flushTimer)
  flushTimer = setInterval(flush, FLUSH_INTERVAL)

  // 页面关闭前刷新 — 设置卸载标志，让 send() 改用 sendBeacon
  // 避免 fetch 在页面卸载时被浏览器中止（net::ERR_ABORTED）
  window.addEventListener("beforeunload", () => {
    isUnloading = true
    flush()
  })
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush()
  })
}

// ─── 公开 API ───
export const monitor = {
  /** 记录页面访问 */
  pageView(path: string): void {
    push({ type: "page_view", path })
  },

  /** 记录对话 */
  chat(messageLength: number, model: string): void {
    push({ type: "chat", message_length: messageLength, model })
  },

  /** 记录工具调用 */
  toolCall(toolName: string, success: boolean, latencyMs?: number): void {
    push({
      type: "tool_call",
      tool: toolName,
      success,
      latency_ms: latencyMs,
      severity: success ? "info" : "warning",
    })
  },

  /** 记录错误 */
  error(message: string, context?: Record<string, any>): void {
    push({ type: "error", severity: "error", error: message, ...context })
  },

  /** 记录登录 */
  login(success: boolean, method?: string): void {
    push({
      type: "login",
      success,
      method,
      severity: success ? "info" : "warning",
    })
  },

  /** 记录下载 */
  download(filename: string): void {
    push({ type: "download", filename })
  },

  /** 记录上传 */
  upload(filename: string, size: number, success: boolean): void {
    push({
      type: "upload",
      filename,
      size,
      success,
      severity: success ? "info" : "error",
    })
  },

  /** 记录 API 延迟 */
  apiLatency(endpoint: string, latencyMs: number): void {
    push({
      type: "api_latency",
      endpoint,
      latency_ms: latencyMs,
      severity: latencyMs > 5000 ? "warning" : "info",
    })
  },

  /** 记录 Onboarding 步骤 */
  onboardingStep(step: string, success: boolean): void {
    push({
      type: "onboarding_step",
      step,
      success,
      severity: success ? "info" : "warning",
    })
  },

  /** 记录档案同步 */
  vaultSync(filename: string, success: boolean): void {
    push({
      type: "vault_sync",
      filename,
      success,
      severity: success ? "info" : "error",
    })
  },

  /** 记录知识库检索 */
  knowledgeSearch(query: string, resultCount: number): void {
    push({ type: "knowledge_search", query_length: query.length, result_count: resultCount })
  },

  /** 记录许可证验证 */
  licenseVerify(success: boolean, detail?: string): void {
    push({
      type: "license_verify",
      success,
      detail,
      severity: success ? "info" : "critical",
    })
  },

  /** 手动刷新缓冲 */
  flush,
}
