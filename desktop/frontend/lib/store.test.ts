import { describe, it, expect } from 'vitest'
import { reducer, titleFromMessages } from './store'
import type { AppState } from './store'
import type { Message } from './types'

const baseState: AppState = {
  activeNav: 'chat',
  rightPanelOpen: false,
  conversations: [],
  activeConversationId: null,
  messages: [],
  sending: false,
  progress: null,
  taskSummaries: [],
  outputFiles: [],
  memories: [],
  diaryEntries: [],
  prefillInput: null,
  reviewDocId: null,
  reviewIssues: [],
  browserDoc: null,
}

function userMsg(content: string): Message {
  return { id: 'u1', role: 'user', content, createdAt: '2026-01-01T00:00:00Z' }
}
function assistantMsg(content: string): Message {
  return { id: 'a1', role: 'assistant', content, createdAt: '2026-01-01T00:00:00Z' }
}

describe('titleFromMessages', () => {
  it('returns 新对话 when no user message', () => {
    expect(titleFromMessages([])).toBe('新对话')
    expect(titleFromMessages([assistantMsg('hello')])).toBe('新对话')
  })

  it('uses first user message content', () => {
    expect(titleFromMessages([userMsg('如何填写执行报告')])).toBe('如何填写执行报告')
  })

  it('truncates to 20 chars', () => {
    const long = '一二三四五六七八九十一二三四五六七八九十一二三四五'
    expect(titleFromMessages([userMsg(long)]).length).toBe(20)
  })

  it('strips [图片] placeholders', () => {
    expect(titleFromMessages([userMsg('[图片]查看这张许可证')])).toBe('查看这张许可证')
  })

  it('returns 新对话 when content is only [图片]', () => {
    expect(titleFromMessages([userMsg('[图片][图片]')])).toBe('新对话')
  })

  it('uses first user message even if not first in list', () => {
    expect(titleFromMessages([assistantMsg('hi'), userMsg('帮我查排污许可证')])).toBe('帮我查排污许可证')
  })
})

describe('reducer', () => {
  describe('SET_NAV', () => {
    it('updates activeNav', () => {
      const next = reducer(baseState, { type: 'SET_NAV', nav: 'calendar' })
      expect(next.activeNav).toBe('calendar')
    })

    it('does not mutate original state', () => {
      const before = { ...baseState }
      reducer(baseState, { type: 'SET_NAV', nav: 'dashboard' })
      expect(baseState).toEqual(before)
    })
  })

  describe('SET_PREFILL_INPUT', () => {
    it('sets prefillInput text', () => {
      const next = reducer(baseState, { type: 'SET_PREFILL_INPUT', text: '帮我查法规' })
      expect(next.prefillInput).toBe('帮我查法规')
    })

    it('clears prefillInput with null', () => {
      const state = { ...baseState, prefillInput: 'hi' }
      const next = reducer(state, { type: 'SET_PREFILL_INPUT', text: null })
      expect(next.prefillInput).toBeNull()
    })
  })

  describe('HYDRATE', () => {
    it('restores conversations and active id', () => {
      const conv = {
        id: 'c1', title: 'T', lastMessage: 'lm', time: '10:00',
        timestamp: '2026-01-01T00:00:00Z', unread: false, messages: [userMsg('hello')]
      }
      const next = reducer(baseState, {
        type: 'HYDRATE',
        payload: { conversations: [conv], activeConversationId: 'c1' }
      })
      expect(next.conversations).toHaveLength(1)
      expect(next.activeConversationId).toBe('c1')
      expect(next.messages).toEqual([userMsg('hello')])
    })

    it('falls back to empty messages when active conv missing', () => {
      const next = reducer(baseState, {
        type: 'HYDRATE',
        payload: { conversations: [], activeConversationId: 'nope' }
      })
      expect(next.messages).toEqual([])
    })

    it('restores memories and diary entries', () => {
      const mem = { id: 'm1', category: '法规', content: 'x', createdAt: '2026-01-01' }
      const diary = { id: 'd1', date: '2026-01-01', title: '日志', summary: 's' }
      const next = reducer(baseState, {
        type: 'HYDRATE',
        payload: { memories: [mem], diaryEntries: [diary] }
      })
      expect(next.memories).toHaveLength(1)
      expect(next.diaryEntries).toHaveLength(1)
    })
  })

  describe('TOGGLE_RIGHT_PANEL', () => {
    it('flips rightPanelOpen', () => {
      expect(reducer(baseState, { type: 'TOGGLE_RIGHT_PANEL' }).rightPanelOpen).toBe(true)
      expect(reducer({ ...baseState, rightPanelOpen: true }, { type: 'TOGGLE_RIGHT_PANEL' }).rightPanelOpen).toBe(false)
    })
  })

  describe('SET_SENDING', () => {
    it('sets sending flag and clears progress when stopping', () => {
      const state = { ...baseState, progress: { text: 'working' } as any, sending: true }
      const next = reducer(state, { type: 'SET_SENDING', sending: false })
      expect(next.sending).toBe(false)
      expect(next.progress).toBeNull()
    })
  })

  describe('DELETE_MEMORY', () => {
    it('removes memory by id', () => {
      const state = { ...baseState, memories: [
        { id: 'm1', category: 'x', content: 'a', createdAt: 't1' },
        { id: 'm2', category: 'y', content: 'b', createdAt: 't2' },
      ] }
      const next = reducer(state, { type: 'DELETE_MEMORY', id: 'm1' })
      expect(next.memories).toHaveLength(1)
      expect(next.memories[0].id).toBe('m2')
    })
  })

  describe('SET_REVIEW_DOC', () => {
    it('sets reviewDocId and clears issues', () => {
      const state = { ...baseState, reviewIssues: [{ id: 'r1', type: 'error' as const, label: '超标', detail: 'x' }] }
      const next = reducer(state, { type: 'SET_REVIEW_DOC', id: 'doc-123' })
      expect(next.reviewDocId).toBe('doc-123')
      expect(next.reviewIssues).toHaveLength(0)
    })
  })

  describe('SET_REVIEW_ISSUES', () => {
    it('stores review issues', () => {
      const issues = [{ id: 'r1', type: 'error' as const, label: '超标', detail: '颗粒物超标' }]
      const next = reducer(baseState, { type: 'SET_REVIEW_ISSUES', issues })
      expect(next.reviewIssues).toEqual(issues)
    })
  })

  describe('OPEN_BROWSER_DOC', () => {
    it('sets browser doc and opens right panel', () => {
      const doc = { id: 'doc-1', title: '报告.md', content: '# 内容', type: 'md' as const, source: 'knowledge' }
      const next = reducer(baseState, { type: 'OPEN_BROWSER_DOC', doc })
      expect(next.browserDoc).toEqual(doc)
      expect(next.rightPanelOpen).toBe(true)
    })
  })

  describe('CLOSE_BROWSER_DOC', () => {
    it('clears browser doc and issues', () => {
      const state = { ...baseState, browserDoc: { id: 'doc-1', title: '报告.md', content: '', type: 'md' as const, source: 'knowledge' }, reviewIssues: [{ id: 'r1', type: 'error' as const, label: '超标', detail: 'x' }] }
      const next = reducer(state, { type: 'CLOSE_BROWSER_DOC' })
      expect(next.browserDoc).toBeNull()
      expect(next.reviewIssues).toHaveLength(0)
    })
  })
})
