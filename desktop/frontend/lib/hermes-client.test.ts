/**
 * Tests for Hermes API client — covers every exported function, error paths,
 * default-parameter propagation, and URL-encoding edge cases.
 */

import {
  getHermesHealth,
  getCuratorStatus,
  triggerCuratorRun,
  curatorPause,
  curatorResume,
  curatorPrune,
  getSkills,
  searchSkills,
  installSkill,
  uninstallSkill,
  inspectSkill,
  getJourney,
  getJourneyStats,
  getInsights,
  getHermesDoctor,
} from './hermes-client'
import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ─── mocks ──────────────────────────────────────────── */

const mockAuthHeaders = vi.hoisted(() => vi.fn(() => ({ Authorization: 'Bearer test' })))
const mockEnsureAuthToken = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const testBaseUrl = vi.hoisted(() => 'http://test-base')

vi.mock('./api', () => ({
  getApiBase: () => testBaseUrl,
  authHeaders: () => mockAuthHeaders(),
  ensureAuthToken: () => mockEnsureAuthToken(),
}))

const fetchSpy = vi.spyOn(globalThis, 'fetch')

const OK_JSON = { ok: true }
const OK_RESPONSE = { ok: true, json: () => Promise.resolve(OK_JSON) } as Response
const FAIL_RESPONSE = { ok: false, status: 500 } as Response

beforeEach(() => {
  vi.clearAllMocks()
})

/* ─── helpers ────────────────────────────────────────── */

function expectFetchUrl(expected: string, count = 1) {
  expect(fetchSpy).toHaveBeenCalledTimes(count)
  const url = fetchSpy.mock.calls[0][0]
  expect(url).toBe(expected)
}

/* ─── Health ─────────────────────────────────────────── */

describe('getHermesHealth', () => {
  it('calls /api/hermes/health and returns JSON', async () => {
    fetchSpy.mockResolvedValue(OK_RESPONSE)
    await expect(getHermesHealth()).resolves.toEqual(OK_JSON)
    expectFetchUrl('http://test-base/api/hermes/health')
    expect(mockEnsureAuthToken).toHaveBeenCalled()
  })

  it('returns null when the server responds with an error status', async () => {
    fetchSpy.mockResolvedValue(FAIL_RESPONSE)
    await expect(getHermesHealth()).resolves.toBeNull()
  })

  it('rejects when fetch throws (network error)', async () => {
    fetchSpy.mockRejectedValue(new Error('Network failure'))
    await expect(getHermesHealth()).rejects.toThrow("Network failure")
  })
})

/* ─── Curator ────────────────────────────────────────── */

describe('getCuratorStatus', () => {
  it('calls GET /api/hermes/curator/status', async () => {
    fetchSpy.mockResolvedValue(OK_RESPONSE)
    await expect(getCuratorStatus()).resolves.toEqual(OK_JSON)
    expectFetchUrl('http://test-base/api/hermes/curator/status')
  })

  it('returns null on error', async () => {
    fetchSpy.mockResolvedValue(FAIL_RESPONSE)
    await expect(getCuratorStatus()).resolves.toBeNull()
  })
})

describe('triggerCuratorRun', () => {
  it('calls POST /api/hermes/curator/run', async () => {
    fetchSpy.mockResolvedValue(OK_RESPONSE)
    await expect(triggerCuratorRun()).resolves.toEqual(OK_JSON)
    expectFetchUrl('http://test-base/api/hermes/curator/run')
    expect(fetchSpy.mock.calls[0][1]?.method).toBe('POST')
  })
})

describe('curatorPause', () => {
  it('calls POST /api/hermes/curator/pause', async () => {
    fetchSpy.mockResolvedValue(OK_RESPONSE)
    await expect(curatorPause()).resolves.toEqual(OK_JSON)
    expect(fetchSpy.mock.calls[0][1]?.method).toBe('POST')
    expectFetchUrl('http://test-base/api/hermes/curator/pause')
  })
})

describe('curatorResume', () => {
  it('calls POST /api/hermes/curator/resume', async () => {
    fetchSpy.mockResolvedValue(OK_RESPONSE)
    await expect(curatorResume()).resolves.toEqual(OK_JSON)
    expect(fetchSpy.mock.calls[0][1]?.method).toBe('POST')
    expectFetchUrl('http://test-base/api/hermes/curator/resume')
  })
})

describe('curatorPrune', () => {
  it('uses default days=90 when called without arguments', async () => {
    fetchSpy.mockResolvedValue(OK_RESPONSE)
    await curatorPrune()
    expectFetchUrl('http://test-base/api/hermes/curator/prune?days=90')
    expect(fetchSpy.mock.calls[0][1]?.method).toBe('POST')
  })

  it('passes a custom days value', async () => {
    fetchSpy.mockResolvedValue(OK_RESPONSE)
    await curatorPrune(30)
    expectFetchUrl('http://test-base/api/hermes/curator/prune?days=30')
  })

  it('returns null on error', async () => {
    fetchSpy.mockResolvedValue(FAIL_RESPONSE)
    await expect(curatorPrune()).resolves.toBeNull()
  })
})

/* ─── Skills ─────────────────────────────────────────── */

describe('getSkills', () => {
  it('uses default source=all', async () => {
    fetchSpy.mockResolvedValue(OK_RESPONSE)
    await getSkills()
    expectFetchUrl('http://test-base/api/hermes/skills?source=all')
  })

  it('passes a custom source', async () => {
    fetchSpy.mockResolvedValue(OK_RESPONSE)
    await getSkills('community')
    expectFetchUrl('http://test-base/api/hermes/skills?source=community')
  })

  it('returns null on error', async () => {
    fetchSpy.mockResolvedValue(FAIL_RESPONSE)
    await expect(getSkills()).resolves.toBeNull()
  })
})

describe('searchSkills', () => {
  it('URL-encodes the query parameter', async () => {
    fetchSpy.mockResolvedValue(OK_RESPONSE)
    await searchSkills('git push')
    expectFetchUrl('http://test-base/api/hermes/skills/search?q=git%20push')
  })

  it('encodes special characters', async () => {
    fetchSpy.mockResolvedValue(OK_RESPONSE)
    await searchSkills('a&b=c')
    expectFetchUrl('http://test-base/api/hermes/skills/search?q=a%26b%3Dc')
  })

  it('returns null on error', async () => {
    fetchSpy.mockResolvedValue(FAIL_RESPONSE)
    await expect(searchSkills('foo')).resolves.toBeNull()
  })
})

describe('installSkill', () => {
  it('sends POST with name in JSON body', async () => {
    fetchSpy.mockResolvedValue(OK_RESPONSE)
    await installSkill('my-skill')
    expectFetchUrl('http://test-base/api/hermes/skills/install')
    const opts = fetchSpy.mock.calls[0][1] as RequestInit
    expect(opts.method).toBe('POST')
    expect(opts.body).toBe(JSON.stringify({ name: 'my-skill' }))
  })

  it('encodes the skill name via JSON.stringify, not URL', async () => {
    fetchSpy.mockResolvedValue(OK_RESPONSE)
    await installSkill('skill/name')
    expectFetchUrl('http://test-base/api/hermes/skills/install')
  })
})

describe('uninstallSkill', () => {
  it('sends DELETE with URL-encoded name', async () => {
    fetchSpy.mockResolvedValue(OK_RESPONSE)
    await uninstallSkill('bad skill')
    expectFetchUrl('http://test-base/api/hermes/skills/bad%20skill')
    const opts = fetchSpy.mock.calls[0][1] as RequestInit
    expect(opts.method).toBe('DELETE')
  })

  it('encodes special characters in the name', async () => {
    fetchSpy.mockResolvedValue(OK_RESPONSE)
    await uninstallSkill('foo/bar')
    expectFetchUrl('http://test-base/api/hermes/skills/foo%2Fbar')
  })
})

describe('inspectSkill', () => {
  it('sends GET with URL-encoded name', async () => {
    fetchSpy.mockResolvedValue(OK_RESPONSE)
    await expect(inspectSkill('debug tool')).resolves.toEqual(OK_JSON)
    expectFetchUrl('http://test-base/api/hermes/skills/debug%20tool')
  })

  it('returns null on error', async () => {
    fetchSpy.mockResolvedValue(FAIL_RESPONSE)
    await expect(inspectSkill('x')).resolves.toBeNull()
  })
})

/* ─── Journey ────────────────────────────────────────── */

describe('getJourney', () => {
  it('calls GET /api/hermes/journey', async () => {
    fetchSpy.mockResolvedValue(OK_RESPONSE)
    await expect(getJourney()).resolves.toEqual(OK_JSON)
    expectFetchUrl('http://test-base/api/hermes/journey')
  })

  it('returns null on error', async () => {
    fetchSpy.mockResolvedValue(FAIL_RESPONSE)
    await expect(getJourney()).resolves.toBeNull()
  })
})

describe('getJourneyStats', () => {
  it('calls GET /api/hermes/journey/stats', async () => {
    fetchSpy.mockResolvedValue(OK_RESPONSE)
    await expect(getJourneyStats()).resolves.toEqual(OK_JSON)
    expectFetchUrl('http://test-base/api/hermes/journey/stats')
  })

  it('returns null on error', async () => {
    fetchSpy.mockResolvedValue(FAIL_RESPONSE)
    await expect(getJourneyStats()).resolves.toBeNull()
  })
})

/* ─── Insights ───────────────────────────────────────── */

describe('getInsights', () => {
  it('calls GET /api/hermes/insights', async () => {
    fetchSpy.mockResolvedValue(OK_RESPONSE)
    await expect(getInsights()).resolves.toEqual(OK_JSON)
    expectFetchUrl('http://test-base/api/hermes/insights')
  })

  it('returns null on error', async () => {
    fetchSpy.mockResolvedValue(FAIL_RESPONSE)
    await expect(getInsights()).resolves.toBeNull()
  })
})

/* ─── Doctor ─────────────────────────────────────────── */

describe('getHermesDoctor', () => {
  it('calls GET /api/hermes/doctor', async () => {
    fetchSpy.mockResolvedValue(OK_RESPONSE)
    await expect(getHermesDoctor()).resolves.toEqual(OK_JSON)
    expectFetchUrl('http://test-base/api/hermes/doctor')
  })

  it('returns null on error', async () => {
    fetchSpy.mockResolvedValue(FAIL_RESPONSE)
    await expect(getHermesDoctor()).resolves.toBeNull()
  })
})
