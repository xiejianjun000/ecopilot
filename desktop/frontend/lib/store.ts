"use client"
import React, { createContext, useContext, useReducer, useEffect, type Dispatch } from 'react'
import type { Message, Conversation, ActiveNav, ActiveView } from './types'
import { fetchMemories, fetchJournals } from './api'

export interface TaskSummary {
  id: string; time: string; title: string
  operations: string[]; findings: string[]; recommendations: string[]
  editing?: boolean
}
export interface OutputFile { id: string; name: string; type: string; createdAt: string; editing?: boolean }
export interface MemoryItem { id: string; category: string; content: string; createdAt: string; editing?: boolean }
export interface DiaryEntry { id: string; date: string; title: string; summary: string; editing?: boolean }

export interface AppState {
  activeNav: ActiveNav | ActiveView
  rightTab: 'chat'
  rightPanelOpen: boolean
  conversations: Conversation[]
  activeConversationId: string | null
  messages: Message[]
  sending: boolean
  /** 当前 SSE 进度提示（如"正在调用 check_permit_status…"） */
  progress: { step?: number; name?: string; text?: string } | null
  taskSummaries: TaskSummary[]
  outputFiles: OutputFile[]
  memories: MemoryItem[]
  diaryEntries: DiaryEntry[]
  /** 跨模块预填对话输入（如知识库"询问AI"），chat-input 消费后置空 */
  prefillInput: string | null
}

const STORAGE_KEY = 'ecopilot_state'

function loadState(): Partial<AppState> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

function saveState(state: AppState) {
  if (typeof window === 'undefined') return
  try {
    const toSave = {
      conversations: state.conversations.map(c => ({ ...c, messages: c.messages || [] })),
      activeConversationId: state.activeConversationId,
      taskSummaries: state.taskSummaries,
      outputFiles: state.outputFiles,
      memories: state.memories,
      diaryEntries: state.diaryEntries,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
  } catch {}
}

// 注意：initialState 不依赖 localStorage（避免 SSR/客户端不一致导致 hydration 不匹配）
// 已保存的状态在 AppProvider mount 后通过 HYDRATE action 恢复
const initialState: AppState = {
  activeNav: 'chat',
  rightTab: 'chat',
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
}

export type AppAction =
  | { type:'SET_NAV'; nav:ActiveNav|ActiveView }
  | { type:'SET_RIGHT_TAB'; tab:AppState['rightTab'] }
  | { type:'TOGGLE_RIGHT_PANEL' }
  | { type:'ADD_MESSAGE'; message:Message }
  | { type:'REMOVE_LAST_MESSAGE' }
  | { type:'UPDATE_LAST_MESSAGE'; content:string }
  | { type:'SET_SENDING'; sending:boolean }
  | { type:'SET_PROGRESS'; progress:{ step?:number; name?:string; text?:string } | null }
  | { type:'ADD_TOOL_CALL'; toolCall:{ name:string; args?:string } }
  | { type:'UPDATE_TOOL_RESULT'; name:string; result:string }
  | { type:'SET_LAST_MESSAGE_ERROR'; error:string }
  | { type:'SET_CONVERSATION_ACTIVE'; id:string }
  | { type:'NEW_CONVERSATION' }
  | { type:'SET_CONVERSATION_TITLE'; id:string; title:string }
  | { type:'DELETE_CONVERSATION'; id:string }
  | { type:'LOAD_MESSAGES'; messages:Message[] }
  | { type:'ADD_TASK_SUMMARY'; summary:Omit<TaskSummary,'id'|'editing'> }
  | { type:'ADD_OUTPUT_FILE'; file:Omit<OutputFile,'id'|'editing'> }
  | { type:'ADD_MEMORY'; memory:Omit<MemoryItem,'id'|'editing'> }
  | { type:'ADD_DIARY_ENTRY'; entry:Omit<DiaryEntry,'id'|'editing'> }
  | { type:'EDIT_TASK_SUMMARY'; id:string; data:Partial<TaskSummary> }
  | { type:'DELETE_TASK_SUMMARY'; id:string }
  | { type:'DELETE_MEMORY'; id:string }
  | { type:'DELETE_DIARY'; id:string }
  | { type:'UPDATE_MEMORY'; id:string; data:Partial<MemoryItem> }
  | { type:'UPDATE_DIARY'; id:string; data:Partial<DiaryEntry> }
  | { type:'SET_PREFILL_INPUT'; text:string|null }
  | { type:'HYDRATE'; payload: Partial<AppState> }

function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2,6)}` }

/** 当前时间 "HH:MM" 格式 */
function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

/** 从消息列表生成会话标题（取首条用户消息前 20 字） */
function titleFromMessages(msgs: Message[]): string {
  const firstUser = msgs.find(m => m.role === 'user')
  if (firstUser) {
    const t = firstUser.content.replace(/\[图片\]/g, '').trim()
    return t ? t.slice(0, 20) : '新对话'
  }
  return '新对话'
}

/** 同步 conversations 中活动会话的 messages / lastMessage / time */
function syncActiveConv(state: AppState, msgs: Message[]): Partial<AppState> {
  const activeId = state.activeConversationId
  if (!activeId) return { messages: msgs }
  const lastMsg = msgs[msgs.length - 1]
  return {
    messages: msgs,
    conversations: state.conversations.map(c =>
      c.id === activeId
        ? {
            ...c,
            messages: msgs,
            lastMessage: lastMsg ? lastMsg.content.replace(/\n/g, ' ').slice(0, 50) : c.lastMessage,
            time: nowTime(),
          }
        : c
    ),
  }
}

function reducer(state:AppState, action:AppAction):AppState {
  switch (action.type) {
    case 'SET_NAV': return { ...state, activeNav:action.nav }
    case 'SET_RIGHT_TAB': return { ...state, rightTab:action.tab }
    case 'TOGGLE_RIGHT_PANEL': return { ...state, rightPanelOpen:!state.rightPanelOpen }
    case 'SET_PROGRESS': return { ...state, progress: action.progress }

    case 'ADD_MESSAGE': {
      // 如果没有活动会话，自动创建一个
      if (!state.activeConversationId) {
        const newId = uid()
        const firstMsg = action.message
        const title = firstMsg.role === 'user' ? titleFromMessages([firstMsg]) : '新对话'
        const newConv: Conversation = {
          id: newId,
          title,
          lastMessage: firstMsg.content.replace(/\n/g, ' ').slice(0, 50),
          time: nowTime(),
          timestamp: new Date().toISOString(),
          unread: false,
          active: true,
          messages: [firstMsg],
        }
        return {
          ...state,
          messages: [...state.messages, firstMsg],
          conversations: [newConv, ...state.conversations.map(c => ({ ...c, active: false }))],
          activeConversationId: newId,
        }
      }
      // 已有活动会话：追加消息并同步
      const msgs = [...state.messages, action.message]
      return { ...state, ...syncActiveConv(state, msgs) }
    }

    case 'UPDATE_LAST_MESSAGE': {
      const msgs = [...state.messages]
      const last = msgs[msgs.length - 1]
      if (last?.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, content: last.content + action.content }
      }
      return { ...state, ...syncActiveConv(state, msgs) }
    }

    case 'REMOVE_LAST_MESSAGE': {
      const msgs = state.messages.slice(0, -1)
      return { ...state, ...syncActiveConv(state, msgs) }
    }

    case 'SET_LAST_MESSAGE_ERROR': {
      const msgs = state.messages.map((m, i) =>
        i === state.messages.length - 1 && m.role === 'assistant'
          ? { ...m, pending: false, error: action.error }
          : m
      )
      return { ...state, ...syncActiveConv(state, msgs) }
    }

    case 'ADD_TOOL_CALL': {
      const msgs = state.messages.map((m, i) => {
        if (i === state.messages.length - 1 && m.role === 'assistant') {
          return { ...m, toolCalls: [...(m.toolCalls || []), { name: action.toolCall.name, args: action.toolCall.args }] }
        }
        return m
      })
      return { ...state, ...syncActiveConv(state, msgs) }
    }

    case 'UPDATE_TOOL_RESULT': {
      const msgs = state.messages.map((m, i) => {
        if (i === state.messages.length - 1 && m.role === 'assistant' && m.toolCalls) {
          const toolCalls = m.toolCalls.map(tc =>
            tc.name === action.name && !tc.result
              ? { ...tc, result: action.result }
              : tc
          )
          return { ...m, toolCalls }
        }
        return m
      })
      return { ...state, ...syncActiveConv(state, msgs) }
    }

    case 'SET_SENDING': {
      const msgs = state.sending && !action.sending
        ? state.messages.map((m, i) => i === state.messages.length - 1 && m.role === 'assistant' ? { ...m, pending: false } : m)
        : state.messages
      return {
        ...state,
        sending: action.sending,
        messages: msgs,
        progress: action.sending ? state.progress : null,
        ...syncActiveConv(state, msgs),
      }
    }

    case 'SET_CONVERSATION_ACTIVE': {
      // 保存当前对话到 conversations 列表中
      const updated = state.conversations.map(c =>
        c.id === state.activeConversationId
          ? { ...c, messages: state.messages }
          : c
      )
      // 加载目标对话的 messages
      const target = updated.find(c => c.id === action.id)
      return {
        ...state,
        activeNav: 'chat',
        conversations: updated.map(c => ({ ...c, active: c.id === action.id, unread: c.id === action.id ? false : c.unread })),
        activeConversationId: action.id,
        messages: target?.messages || [],
        progress: null,
        taskSummaries: [], outputFiles: [], memories: [], diaryEntries: [],
      }
    }

    case 'NEW_CONVERSATION': {
      // 保存当前对话（如果有）
      let updated = state.conversations
      if (state.activeConversationId && state.messages.length > 0) {
        updated = state.conversations.map(c =>
          c.id === state.activeConversationId
            ? { ...c, messages: state.messages }
            : c
        )
      }
      return {
        ...state,
        activeNav: 'chat',
        conversations: updated.map(c => ({ ...c, active: false })),
        messages: [],
        activeConversationId: null,
        rightPanelOpen: false,
        progress: null,
        taskSummaries: [], outputFiles: [], memories: [], diaryEntries: [],
      }
    }

    case 'SET_CONVERSATION_TITLE':
      return { ...state, conversations: state.conversations.map(c => c.id === action.id ? { ...c, title: action.title } : c) }

    case 'DELETE_CONVERSATION': {
      const filtered = state.conversations.filter(c => c.id !== action.id)
      const wasActive = state.activeConversationId === action.id
      return {
        ...state,
        conversations: filtered,
        activeConversationId: wasActive ? null : state.activeConversationId,
        messages: wasActive ? [] : state.messages,
        rightPanelOpen: wasActive ? false : state.rightPanelOpen,
        progress: wasActive ? null : state.progress,
        taskSummaries: wasActive ? [] : state.taskSummaries,
      }
    }

    case 'LOAD_MESSAGES':
      return { ...state, messages: action.messages }
    case 'ADD_TASK_SUMMARY':
      return { ...state, taskSummaries:[{...action.summary,id:uid()},...state.taskSummaries].slice(0,20), rightPanelOpen:true, rightTab:'chat' }
    case 'ADD_OUTPUT_FILE':
      return { ...state, outputFiles:[{...action.file,id:uid()},...state.outputFiles].slice(0,50) }
    case 'ADD_MEMORY':
      return { ...state, memories:[{...action.memory,id:uid()},...state.memories].slice(0,100) }
    case 'ADD_DIARY_ENTRY':
      return { ...state, diaryEntries:[{...action.entry,id:uid()},...state.diaryEntries].slice(0,200) }
    case 'EDIT_TASK_SUMMARY':
      return { ...state, taskSummaries:state.taskSummaries.map(s=>s.id===action.id?{...s,...action.data}:s) }
    case 'DELETE_TASK_SUMMARY':
      return { ...state, taskSummaries:state.taskSummaries.filter(s=>s.id!==action.id) }
    case 'DELETE_MEMORY':
      return { ...state, memories:state.memories.filter(m=>m.id!==action.id) }
    case 'DELETE_DIARY':
      return { ...state, diaryEntries:state.diaryEntries.filter(d=>d.id!==action.id) }
    case 'UPDATE_MEMORY':
      return { ...state, memories:state.memories.map(m=>m.id===action.id?{...m,...action.data}:m) }
    case 'UPDATE_DIARY':
      return { ...state, diaryEntries:state.diaryEntries.map(d=>d.id===action.id?{...d,...action.data}:d) }
    case 'SET_PREFILL_INPUT':
      return { ...state, prefillInput: action.text }
    case 'HYDRATE': {
      // 从 localStorage 恢复持久化状态（mount 后调用，避免 hydration 不匹配）
      const p = action.payload
      const conversations = p.conversations || []
      const activeId = p.activeConversationId || null
      const activeConv = conversations.find(c => c.id === activeId)
      return {
        ...state,
        conversations,
        activeConversationId: activeId,
        messages: activeConv?.messages || [],
        taskSummaries: p.taskSummaries || [],
        outputFiles: p.outputFiles || [],
        memories: p.memories || [],
        diaryEntries: p.diaryEntries || [],
      }
    }
    default: return state
  }
}

const AppContext = createContext<{state:AppState;dispatch:Dispatch<AppAction>}|null>(null)

export function AppProvider({children}:{children:React.ReactNode}) {
  const [state, dispatch] = useReducer(reducer, initialState)

  // mount 后从 localStorage 恢复持久化状态（避免 SSR/客户端不一致导致 hydration 不匹配）
  useEffect(() => {
    const saved = loadState()
    if (saved && Object.keys(saved).length > 0) {
      dispatch({ type: 'HYDRATE', payload: saved })
    }
  }, [])

  // mount 后从后端拉取合规记忆和工作日志（后端数据优先于 localStorage）
  // 失败静默，不影响主界面；后端返回空数组时不覆盖本地数据
  useEffect(() => {
    fetchMemories()
      .then(memories => {
        if (memories.length > 0) {
          dispatch({ type: 'HYDRATE', payload: { memories } })
        }
      })
      .catch(() => { /* 失败静默，保留 localStorage 数据 */ })

    fetchJournals()
      .then(journals => {
        if (journals.length > 0) {
          dispatch({ type: 'HYDRATE', payload: { diaryEntries: journals } })
        }
      })
      .catch(() => { /* 失败静默，保留 localStorage 数据 */ })
  }, [])

  // 自动持久化
  useEffect(() => {
    const t = setTimeout(() => saveState(state), 500)
    return () => clearTimeout(t)
  }, [state.conversations, state.activeConversationId, state.taskSummaries, state.memories, state.diaryEntries])

  return React.createElement(AppContext.Provider, { value: { state, dispatch } }, children)
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
