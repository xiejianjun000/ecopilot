import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { reducer, type AppState } from "./store"
import type { Message, Conversation } from "./types"

function makeMsg(overrides: Partial<Message> = {}): Message {
  return {
    id: overrides.id || `msg-${Date.now()}`,
    role: "user" as const,
    content: "test",
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeConv(id: string, msgCount = 1): Conversation {
  return {
    id,
    title: `Conv ${id}`,
    lastMessage: "test",
    time: "12:00",
    timestamp: new Date().toISOString(),
    unread: false,
    messages: Array.from({ length: msgCount }, (_, i) => makeMsg({ id: `${id}-msg-${i}` })),
  }
}

const emptyState: AppState = {
  activeNav: "chat",
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

describe("store persistence limits", () => {
  describe("MAX_CONVERSATIONS (50)", () => {
    it("prunes oldest non-active conversations when over 50", () => {
      // Create 51 conversations, all inactive
      const convs = Array.from({ length: 51 }, (_, i) => makeConv(`conv-${i}`))
      const state = { ...emptyState, conversations: convs }

      // Add a new message to trigger conversation creation
      const result = reducer(state, { type: "ADD_MESSAGE", message: makeMsg() })

      // Should have at most 51 (the new one + 50 kept)
      expect(result.conversations.length).toBeLessThanOrEqual(51)
      // The new conversation should be present
      expect(result.activeConversationId).toBeTruthy()
    })

    it("keeps active conversation when pruning", () => {
      // Create 50 conversations, mark the first as active
      const convs = Array.from({ length: 50 }, (_, i) => ({
        ...makeConv(`conv-${i}`),
        active: i === 0,
        messages: [makeMsg()],
      }))
      const state = { ...emptyState, conversations: convs, activeConversationId: "conv-0", messages: [makeMsg()] }

      // Add a new message (should trigger conversation list sync)
      const result = reducer(state, { type: "ADD_MESSAGE", message: makeMsg() })

      // Active conversation should still be in the list
      expect(result.conversations.find(c => c.id === "conv-0")).toBeTruthy()
    })
  })

  describe("MAX_MESSAGES (200)", () => {
    it("prunes oldest messages when over 200 per conversation", () => {
      // Create a conversation with 200 messages
      const msgs = Array.from({ length: 200 }, (_, i) => makeMsg({ id: `msg-${i}`, content: `msg ${i}` }))
      const state = { ...emptyState, messages: msgs, activeConversationId: "conv-1", conversations: [makeConv("conv-1")] }

      // Add one more message
      const result = reducer(state, { type: "ADD_MESSAGE", message: makeMsg({ id: "new-msg" }) })

      // Should still be 200 messages (oldest removed)
      expect(result.messages.length).toBe(200)
      // The new message should be present
      expect(result.messages.find(m => m.id === "new-msg")).toBeTruthy()
      // The oldest message (msg-0) should be gone
      expect(result.messages.find(m => m.id === "msg-0")).toBeFalsy()
    })

    it("allows messages under limit", () => {
      const msgs = Array.from({ length: 50 }, (_, i) => makeMsg({ id: `msg-${i}` }))
      const state = { ...emptyState, messages: msgs, activeConversationId: "conv-1", conversations: [makeConv("conv-1")] }

      const result = reducer(state, { type: "ADD_MESSAGE", message: makeMsg({ id: "new-msg" }) })
      expect(result.messages.length).toBe(51)
    })
  })

  describe("MAX_TOOL_CALLS (20) + arg/result limits", () => {
    it("limits tool calls per message to 20", () => {
      const MsgComponent: React.FC<{ toolCalls: number }> = ({ toolCalls }) => null
      const state = { ...emptyState, messages: [makeMsg({ id: "last-msg", role: "assistant" })] }

      // Add 25 tool calls
      let current = state
      for (let i = 0; i < 25; i++) {
        current = reducer(current, {
          type: "ADD_TOOL_CALL" as any,
          toolCall: { name: `tool-${i}`, args: "{}" },
        } as any)
      }

      const lastMsg = current.messages[current.messages.length - 1]
      expect(lastMsg.toolCalls?.length).toBeLessThanOrEqual(20)
    })

    it("truncates long args", () => {
      const longArgs = "x".repeat(3000)
      const state = { ...emptyState, messages: [makeMsg({ id: "last-msg", role: "assistant" })] }
      const result = reducer(state, {
        type: "ADD_TOOL_CALL" as any,
        toolCall: { name: "test-tool", args: longArgs },
      } as any)

      const lastMsg = result.messages[result.messages.length - 1]
      expect(lastMsg.toolCalls![0].args!.length).toBeLessThanOrEqual(2001) // 2000 + "…"
    })

    it("truncates long results", () => {
      const state = {
        ...emptyState,
        messages: [
          makeMsg({ id: "last-msg", role: "assistant", toolCalls: [{ name: "test-tool", args: "{}" }] }),
        ],
      }
      const longResult = "y".repeat(10000)
      const result = reducer(state, {
        type: "UPDATE_TOOL_RESULT" as any,
        name: "test-tool",
        result: longResult,
      } as any)

      const lastMsg = result.messages[result.messages.length - 1]
      expect(lastMsg.toolCalls![0].result!.length).toBeLessThanOrEqual(5001) // 5000 + "…"
    })
  })

  describe("MAX_MESSAGE_CONTENT (50000)", () => {
    it("truncates very long assistant responses", () => {
      const state = { ...emptyState, messages: [makeMsg({ id: "last-msg", role: "assistant", content: "" })] }
      const longContent = "x".repeat(60000)
      const result = reducer(state, { type: "UPDATE_LAST_MESSAGE", content: longContent })
      expect(result.messages[result.messages.length - 1].content.length).toBeLessThanOrEqual(50000)
    })
  })

  describe("HYDRATE with pruning", () => {
    it("prunes conversations and messages on HYDRATE", () => {
      const manyConvs = Array.from({ length: 60 }, (_, i) => makeConv(`conv-${i}`, 250))
      const result = reducer(emptyState, {
        type: "HYDRATE" as any,
        payload: {
          conversations: manyConvs,
          activeConversationId: null,
        },
      } as any)

      // Conversations should be pruned to 50
      expect(result.conversations.length).toBeLessThanOrEqual(50)
    })
  })
})
