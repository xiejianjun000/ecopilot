import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('./api', () => ({
  getApiBase: () => 'http://test.local',
  ensureAuthToken: vi.fn(),
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()

  // Prevent timer side effects from module-level setInterval
  vi.stubGlobal('setInterval', vi.fn(() => 123))
  vi.stubGlobal('clearInterval', vi.fn())

  // Mock fetch so .catch(() => {}) inside send() doesn't throw
  global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))

  // jsdom does not ship navigator.sendBeacon — polyfill it
  if (typeof navigator !== 'undefined') {
    Object.defineProperty(navigator, 'sendBeacon', {
      value: vi.fn(),
      writable: true,
      configurable: true,
    })
  }

  localStorage.clear()
})

// ── Object shape ──────────────────────────────────────────────────────

describe('monitor object exports', () => {
  it('exports a monitor object', async () => {
    const { monitor } = await import('./monitor-sdk')
    expect(monitor).toBeDefined()
    expect(typeof monitor).toBe('object')
  })

  it('has all expected public methods', async () => {
    const { monitor } = await import('./monitor-sdk')
    const methods: string[] = [
      'pageView', 'chat', 'toolCall', 'error', 'login',
      'download', 'upload', 'apiLatency', 'onboardingStep',
      'vaultSync', 'knowledgeSearch', 'licenseVerify', 'flush',
    ]
    for (const m of methods) {
      expect(typeof (monitor as Record<string, unknown>)[m]).toBe(`function`)
    }
  })
})

// ── monitor.error() ───────────────────────────────────────────────────

describe('monitor.error()', () => {
  it('pushes an error event with the given message', async () => {
    const { monitor } = await import('./monitor-sdk')
    monitor.error('something went wrong')
    monitor.flush()

    expect(fetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body).toMatchObject({
      type: 'error',
      severity: 'error',
      error: 'something went wrong',
    })
  })

  it('includes optional context fields in the event', async () => {
    const { monitor } = await import('./monitor-sdk')
    monitor.error('validation failed', { field: 'email', code: 422 })
    monitor.flush()

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body).toMatchObject({ error: 'validation failed', field: 'email', code: 422 })
  })

  it('propagates nested context objects', async () => {
    const { monitor } = await import('./monitor-sdk')
    monitor.error('nested', { details: { reason: 'timeout', retryable: true } })
    monitor.flush()

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body.details).toEqual({ reason: 'timeout', retryable: true })
  })

  it('accepts an empty string message', async () => {
    const { monitor } = await import('./monitor-sdk')
    expect(() => monitor.error('')).not.toThrow()
    monitor.flush()

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body.error).toBe('')
  })

  it('works without a context argument', async () => {
    const { monitor } = await import('./monitor-sdk')
    expect(() => monitor.error('just a message')).not.toThrow()
  })
})

// ── monitor.apiLatency() ──────────────────────────────────────────────

describe('monitor.apiLatency()', () => {
  it('pushes an api_latency event with endpoint and ms', async () => {
    const { monitor } = await import('./monitor-sdk')
    monitor.apiLatency('/api/search', 120)
    monitor.flush()

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body).toMatchObject({
      type: 'api_latency',
      endpoint: '/api/search',
      latency_ms: 120,
    })
  })

  it('sets severity=warning when latency > 5000', async () => {
    const { monitor } = await import('./monitor-sdk')
    monitor.apiLatency('/api/slow', 5001)
    monitor.flush()

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body.severity).toBe('warning')
  })

  it('sets severity=info when latency <= 5000', async () => {
    const { monitor } = await import('./monitor-sdk')
    monitor.apiLatency('/api/fast', 5000)
    monitor.flush()

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body.severity).toBe('info')
  })

  it('handles zero latency', async () => {
    const { monitor } = await import('./monitor-sdk')
    monitor.apiLatency('/api/instant', 0)
    monitor.flush()

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body.latency_ms).toBe(0)
    expect(body.severity).toBe('info')
  })

  it('handles negative latency (edge case)', async () => {
    const { monitor } = await import('./monitor-sdk')
    monitor.apiLatency('/api/weird', -1)
    monitor.flush()

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body.latency_ms).toBe(-1)
  })

  it('handles empty endpoint string', async () => {
    const { monitor } = await import('./monitor-sdk')
    monitor.apiLatency('', 100)
    monitor.flush()

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body.endpoint).toBe('')
  })

  it('handles very large latency value', async () => {
    const { monitor } = await import('./monitor-sdk')
    monitor.apiLatency('/api/huge', 999999)
    monitor.flush()

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body.latency_ms).toBe(999999)
    expect(body.severity).toBe('warning')
  })
})

// ── monitor.flush() ───────────────────────────────────────────────────

describe('monitor.flush()', () => {
  it('is a function exported on the monitor object', async () => {
    const { monitor } = await import('./monitor-sdk')
    expect(typeof monitor.flush).toBe('function')
  })

  it('does not call fetch when the buffer is empty', async () => {
    const { monitor } = await import('./monitor-sdk')
    expect(fetch).not.toHaveBeenCalled()
    monitor.flush()
    expect(fetch).not.toHaveBeenCalled()
  })
})

// ── Buffer & flush integration ────────────────────────────────────────

describe('buffer and flush integration', () => {
  it('buffers multiple events and flushes them individually', async () => {
    const { monitor } = await import('./monitor-sdk')
    monitor.error('err one')
    monitor.error('err two')
    monitor.error('err three')
    expect(fetch).not.toHaveBeenCalled() // not yet flushed

    monitor.flush()
    // flush() sends each event as a separate fetch call
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('re-flush after empty buffer is a no-op', async () => {
    const { monitor } = await import('./monitor-sdk')
    monitor.error('first')
    monitor.flush()
    const callsAfterFirst = vi.mocked(fetch).mock.calls.length

    monitor.flush()
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsAfterFirst) // no new calls
  })
})

// ── localStorage enrichment ───────────────────────────────────────────

describe('localStorage enrichment', () => {
  it('attaches user_id from localStorage when present', async () => {
    localStorage.setItem('ecopilot_user', JSON.stringify({ name: 'alice' }))
    const { monitor } = await import('./monitor-sdk')
    monitor.error('test')
    monitor.flush()

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body.user_id).toBe('alice')
  })

  it('attaches enterprise from localStorage when present', async () => {
    localStorage.setItem('ecopilot_enterprise', JSON.stringify({ name: 'acme-corp' }))
    const { monitor } = await import('./monitor-sdk')
    monitor.error('test')
    monitor.flush()

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body.enterprise).toBe('acme-corp')
  })

  it('falls back to "anonymous" when ecopilot_user has no name/phone', async () => {
    localStorage.setItem('ecopilot_user', JSON.stringify({ id: '42' }))
    const { monitor } = await import('./monitor-sdk')
    monitor.error('test')
    monitor.flush()

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body.user_id).toBe('anonymous')
  })
})

// ── Additional method edge inputs ─────────────────────────────────────

describe('edge inputs for other methods', () => {
  it('chat with zero message length', async () => {
    const { monitor } = await import('./monitor-sdk')
    monitor.chat(0, 'gpt-4')
    monitor.flush()

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body).toMatchObject({ type: 'chat', message_length: 0, model: 'gpt-4' })
  })

  it('toolCall handles success with undefined latency', async () => {
    const { monitor } = await import('./monitor-sdk')
    monitor.toolCall('search', true)
    monitor.flush()

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body).toMatchObject({ type: 'tool_call', tool: 'search', success: true })
    expect(body.latency_ms).toBeUndefined()
  })

  it('pageView accepts any path string', async () => {
    const { monitor } = await import('./monitor-sdk')
    monitor.pageView('/')
    monitor.pageView('/settings/profile')
    monitor.flush()

    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('knowledgeSearch with zero results', async () => {
    const { monitor } = await import('./monitor-sdk')
    monitor.knowledgeSearch('nothing', 0)
    monitor.flush()

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body).toMatchObject({ type: 'knowledge_search', query_length: 7, result_count: 0 })
  })
})
