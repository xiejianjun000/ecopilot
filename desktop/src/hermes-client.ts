/**
 * EcoPilot Hermes Dashboard 客户端
 *
 * 通过 WebSocket (JSON-RPC) + REST 与本地 Hermes Dashboard (port 9119) 通信。
 *
 * 协议（来源：tui_gateway/server.py + web_server.py）：
 *   RPC: {"jsonrpc": "2.0", "id": 1, "method": "...", "params": {...}}
 *         → {"jsonrpc": "2.0", "id": 1, "result": {...}}
 *   事件: {"jsonrpc": "2.0", "method": "event",
 *          "params": {"type": "message.delta", "session_id": "...", "payload": {...}}}
 */

// ─── 类型定义 ───

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  pending?: boolean
  error?: string
  createdAt: string
  imageDataUrl?: string
}

export interface GatewayEvent {
  type: string
  session_id: string
  payload?: Record<string, unknown>
}

// ─── Hermes Client ───

export class HermesClient {
  private ws: WebSocket | null = null
  private requestId = 0
  private pendingRequests = new Map<number, {
    resolve: (v: unknown) => void
    reject: (e: Error) => void
    timeout: ReturnType<typeof setTimeout>
  }>()
  private eventHandlers = new Map<string, Set<(event: GatewayEvent) => void>>()
  private connectionHandlers = new Set<(connected: boolean) => void>()
  private _connected = false
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _closed = false
  private _log: (msg: string) => void

  constructor(
    private restBaseUrl: string,   // Vite proxy URL (REST 请求，避免 CORS)
    private directWsUrl: string,   // 直连 Dashboard 的 WS URL
    private token: string,
    log?: (msg: string) => void,
  ) {
    this._log = log || ((msg: string) => console.log('[HermesClient]', msg))
  }

  get connected() { return this._connected }

  /** 连接 WebSocket（直连 Dashboard） */
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return
    this._closed = false

    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(this.directWsUrl)
        ws.onopen = () => {
          this._log('WebSocket connected to ' + this.directWsUrl.replace(/\?.*/, '?'))
          this._connected = true
          this.connectionHandlers.forEach(h => h(true))
          resolve()
        }
        ws.onmessage = (event) => {
          try {
            this.handleMessage(JSON.parse(event.data))
          } catch (e) { /* ignore malformed frames */ }
        }
        ws.onclose = (ev) => {
          this._log(`WebSocket closed (code=${ev.code} reason=${ev.reason})`)
          this._connected = false
          this.connectionHandlers.forEach(h => h(false))
          for (const [id, { reject }] of this.pendingRequests) {
            reject(new Error('WebSocket connection closed'))
            clearTimeout(this.pendingRequests.get(id)!.timeout)
          }
          this.pendingRequests.clear()
          this.scheduleReconnect()
        }
        ws.onerror = () => {
          if (!this._connected) reject(new Error('WebSocket connection failed'))
        }
        this.ws = ws
      } catch (e) {
        reject(e)
      }
    })
  }

  disconnect(): void {
    this._closed = true
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer)
    this.ws?.close()
    this.ws = null
    this._connected = false
  }

  /** JSON-RPC 调用 */
  async request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected')
    }

    const id = ++this.requestId
    this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`RPC ${method} timed out`))
      }, 120000)
      this.pendingRequests.set(id, { resolve: resolve as (v: unknown) => void, reject, timeout })
    })
  }

  /** REST API 调用（通过 Vite proxy） */
  async api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.restBaseUrl}${path}`
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Hermes-Session-Token': this.token,
        ...(options.headers || {}),
      },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`API ${res.status}: ${text}`)
    }
    return res.json()
  }

  // ─── RPC 包装 ───

  async createSession(systemPrompt?: string): Promise<string> {
    const params: Record<string, unknown> = { cols: 120 }
    if (systemPrompt) {
      params.messages = [{ role: 'system', content: systemPrompt }]
    }
    const result = await this.request<{ session_id: string }>('session.create', params)
    this._log(`session created: ${result.session_id}`)
    return result.session_id
  }

  async submitPrompt(sessionId: string, text: string): Promise<void> {
    this._log(`submitPrompt: session=${sessionId} text="${text.substring(0, 50)}..."`)
    await this.request('prompt.submit', { session_id: sessionId, text })
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.request('session.interrupt', { session_id: sessionId })
  }

  /** 通过 REST API 轮询消息列表 */
  async pollMessages(sessionId: string): Promise<any[]> {
    try {
      const result = await this.api<{ messages: any[] }>(
        `/api/sessions/${encodeURIComponent(sessionId)}/messages`
      )
      return result.messages || []
    } catch {
      return []
    }
  }

  // ─── 事件系统 ───

  /** 订阅流事件 */
  onStream(sessionId: string, handler: (event: GatewayEvent) => void): () => void {
    const key = `stream:${sessionId}`
    if (!this.eventHandlers.has(key)) {
      this.eventHandlers.set(key, new Set())
    }
    this.eventHandlers.get(key)!.add(handler)
    return () => this.eventHandlers.get(key)?.delete(handler)
  }

  onConnectionChange(handler: (connected: boolean) => void): () => void {
    this.connectionHandlers.add(handler)
    return () => this.connectionHandlers.delete(handler)
  }

  // ─── 内部 ───

  private handleMessage(data: any): void {
    // RPC 响应
    if (data.id != null && this.pendingRequests.has(data.id)) {
      const { resolve, reject, timeout } = this.pendingRequests.get(data.id)!
      clearTimeout(timeout)
      this.pendingRequests.delete(data.id)
      if (data.error) {
        this._log(`RPC error (id=${data.id}): ${data.error.message}`)
        reject(new Error(data.error.message || JSON.stringify(data.error)))
      } else {
        resolve(data.result)
      }
      return
    }

    // 事件：method="event", params={type, session_id, payload}
    if (data.method === 'event' && data.params) {
      const eventType = data.params.type
      const sid = data.params.session_id
      if (!eventType || !sid) return

      const event: GatewayEvent = {
        type: eventType,
        session_id: sid,
        payload: data.params.payload,
      }

      this._log(`event: ${eventType} session=${sid}`)

      // 分发给 stream handler
      const handlers = this.eventHandlers.get(`stream:${sid}`)
      if (handlers) handlers.forEach(h => h(event))
    }
  }

  private scheduleReconnect(): void {
    if (this._closed || this._reconnectTimer) return
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null
      if (!this._closed) this.connect().catch(() => {})
    }, 3000)
  }
}

// ─── 工厂 ───

export const DASHBOARD_URL = 'http://127.0.0.1:9119'

export async function createHermesClient(): Promise<HermesClient> {
  // REST 走 Vite proxy
  const restBaseUrl = typeof window !== 'undefined' ? window.location.origin : DASHBOARD_URL

  // 获取 token
  const html = await fetch(`${restBaseUrl}/hermes-proxy`).then(r => r.text())
  const m = html.match(/window\.__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"/)
  if (!m) throw new Error('无法获取 Hermes Dashboard session token')
  const token = m[1]

  // WS 直连 Dashboard
  const wsUrl = `ws://127.0.0.1:9119/api/ws?token=${encodeURIComponent(token)}`

  const client = new HermesClient(restBaseUrl, wsUrl, token)
  await client.connect()
  return client
}

// ─── HTTP SSE 回退客户端（无需 Dashboard） ───

export const CHAT_BRIDGE_URL = 'http://localhost:8002'

export class SimpleHermesClient {
  private _sessionId: string

  get connected() { return true }
  get sessionId() { return this._sessionId }

  constructor(sessionId?: string) {
    this._sessionId = sessionId || `http-${Date.now().toString(36)}`
  }

  async createSession(_prompt?: string): Promise<string> {
    return this._sessionId
  }

  async submitPrompt(_sid: string, _text: string): Promise<void> {}

  async interrupt(): Promise<void> {}

  async sendMessage(
    text: string,
    attachments?: string[],
    onDelta?: (text: string) => void,
    onDone?: () => void,
    onError?: (msg: string) => void,
  ): Promise<void> {
    try {
      const body: Record<string, unknown> = { message: text, session_id: this._sessionId }
      if (attachments?.length) {
        const b64 = attachments[0].replace(/^data:image\/\w+;base64,/, '')
        body.image_base64 = b64
      }
      const res = await fetch(`${CHAT_BRIDGE_URL}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const d = JSON.parse(line.slice(6))
              if (d.type === 'text_delta') onDelta(d.text)
              else if (d.type === 'error') onError(d.text)
            } catch {}
          }
        }
      }
      onDone()
    } catch (e: any) {
      onError(e.message || 'Chat Bridge 未启动 (python server/chat_api.py)')
    }
  }

  onConnectionChange(_: (c: boolean) => void): () => void { return () => {} }
  onStream(_sid: string, _h: (e: any) => void): () => void { return () => {} }
}

export async function checkBridgeHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${CHAT_BRIDGE_URL}/api/chat/health`, { signal: AbortSignal.timeout(5000) })
    return res.ok
  } catch { return false }
}
