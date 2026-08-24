import { describe, it, expect, beforeEach, vi } from 'vitest'

const TOKEN_RESP = { token: 'test-token-123' }

function okJson(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
  } as Response
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  global.fetch = vi.fn()
})

describe('getApiBase', () => {
  it('returns a non-empty URL', async () => {
    const { getApiBase } = await import('./api')
    const base = getApiBase()
    expect(typeof base).toBe('string')
    expect(base.length).toBeGreaterThan(0)
    expect(base.startsWith('http')).toBe(true)
  })
})

describe('authHeaders', () => {
  it('does not include Authorization before token is set', async () => {
    const { authHeaders } = await import('./api')
    expect(authHeaders()).not.toHaveProperty('Authorization')
  })

  it('includes Authorization Bearer after ensureAuthToken', async () => {
    const { ensureAuthToken, authHeaders } = await import('./api')
    vi.mocked(fetch).mockResolvedValueOnce(okJson(TOKEN_RESP))
    await ensureAuthToken()
    const h = authHeaders()
    expect(h['Authorization']).toBe('Bearer test-token-123')
  })

  it('merges extra headers', async () => {
    const { authHeaders } = await import('./api')
    const h = authHeaders({ 'Content-Type': 'application/json' })
    expect(h['Content-Type']).toBe('application/json')
  })
})

describe('apiGet', () => {
  it('issues a GET request and parses data', async () => {
    const { apiGet } = await import('./api')
    vi.mocked(fetch)
      .mockResolvedValueOnce(okJson(TOKEN_RESP))   // ensureAuthToken
      .mockResolvedValueOnce(okJson({ items: [1, 2, 3] })) // actual GET

    const r = await apiGet('/api/memory/list')
    expect(r.ok).toBe(true)
    expect(r.data).toEqual({ items: [1, 2, 3] })

    // Second call is the actual request
    const [, secondCall] = vi.mocked(fetch).mock.calls
    expect(secondCall?.[0]).toContain('/api/memory/list')
    const opts = secondCall?.[1] as RequestInit
    expect(opts.method).toBe('GET')
    expect(opts.body).toBeUndefined()
  })

  it('returns ok=false on HTTP error', async () => {
    const { apiGet } = await import('./api')
    vi.mocked(fetch)
      .mockResolvedValueOnce(okJson(TOKEN_RESP))
      .mockResolvedValueOnce(okJson({ detail: 'not found' }, 404))

    const r = await apiGet('/api/missing')
    expect(r.ok).toBe(false)
    expect(r.status).toBe(404)
    expect(r.error).toBe('not found')
  })
})

describe('apiPost', () => {
  it('issues POST with JSON body', async () => {
    const { apiPost } = await import('./api')
    vi.mocked(fetch)
      .mockResolvedValueOnce(okJson(TOKEN_RESP))
      .mockResolvedValueOnce(okJson({ ok: true }))

    const r = await apiPost('/api/x', { name: 'ecopilot' })
    expect(r.ok).toBe(true)

    const [, secondCall] = vi.mocked(fetch).mock.calls
    const opts = secondCall?.[1] as RequestInit
    expect(opts.method).toBe('POST')
    expect(opts.body).toBe(JSON.stringify({ name: 'ecopilot' }))
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })
})

describe('apiPut', () => {
  it('issues PUT with JSON body', async () => {
    const { apiPut } = await import('./api')
    vi.mocked(fetch)
      .mockResolvedValueOnce(okJson(TOKEN_RESP))
      .mockResolvedValueOnce(okJson({ ok: true }))

    await apiPut('/api/x/1', { updated: true })
    const [, secondCall] = vi.mocked(fetch).mock.calls
    const opts = secondCall?.[1] as RequestInit
    expect(opts.method).toBe('PUT')
    expect(opts.body).toBe(JSON.stringify({ updated: true }))
  })
})

describe('apiDelete', () => {
  it('issues DELETE without body', async () => {
    const { apiDelete } = await import('./api')
    vi.mocked(fetch)
      .mockResolvedValueOnce(okJson(TOKEN_RESP))
      .mockResolvedValueOnce(okJson({ ok: true }))

    await apiDelete('/api/x/1')
    const [, secondCall] = vi.mocked(fetch).mock.calls
    const opts = secondCall?.[1] as RequestInit
    expect(opts.method).toBe('DELETE')
    expect(opts.body).toBeUndefined()
  })

  it('appends query string when provided', async () => {
    const { apiDelete } = await import('./api')
    vi.mocked(fetch)
      .mockResolvedValueOnce(okJson(TOKEN_RESP))
      .mockResolvedValueOnce(okJson({ ok: true }))

    await apiDelete('/api/x', { force: 'true' })
    const [, secondCall] = vi.mocked(fetch).mock.calls
    const url = String(secondCall?.[0])
    expect(url).toContain('?force=true')
  })
})

describe('ensureAuthToken 错误日志', () => {
  it('网络错误时打印 console.error，不抛异常', async () => {
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Connection refused'))

    const { ensureAuthToken, authHeaders } = await import('./api')

    // 不应抛异常
    await expect(ensureAuthToken()).resolves.toBeUndefined()

    // 应打印错误日志
    expect(consoleErr).toHaveBeenCalledTimes(1)
    expect(consoleErr).toHaveBeenCalledWith(
      '[api] ensureAuthToken 获取认证token失败:',
      expect.any(Error)
    )

    // authHeaders 不应包含 token
    expect(authHeaders()).not.toHaveProperty('Authorization')

    consoleErr.mockRestore()
  })

  it('服务器返回 500 而非 token 时不打印日志并静默', async () => {
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(fetch).mockResolvedValueOnce(okJson({ error: 'internal' }, 500))

    const { ensureAuthToken } = await import('./api')
    await expect(ensureAuthToken()).resolves.toBeUndefined()

    // HTTP 错误不抛异常，也不会走到 catch，所以 console.error 不被调用
    expect(consoleErr).not.toHaveBeenCalled()

    consoleErr.mockRestore()
  })
})
