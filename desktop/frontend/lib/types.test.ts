import { describe, it, expect } from "vitest"
import type { Message, Conversation, ActiveNav, ActiveView } from "@/lib/types"

describe("Type system validation", () => {
  it("ActiveNav is chat or dashboard", () => {
    const chat: ActiveNav = "chat"
    const dash: ActiveNav = "dashboard"
    expect(chat).toBe("chat")
    expect(dash).toBe("dashboard")
  })

  it("ActiveView includes all feature views", () => {
    const views: ActiveView[] = [
      "inspection", "calendar", "links", "vault", "knowledge",
      "connector", "settings", "tasks", "notify",
    ]
    views.forEach((v) => {
      expect(typeof v).toBe("string")
    })
  })

  it("Message type has required fields", () => {
    const msg: Message = {
      id: "test-1",
      role: "user",
      content: "测试消息",
      createdAt: new Date().toISOString(),
    }
    expect(msg.id).toBe("test-1")
    expect(msg.role).toBe("user")
    expect(msg.content).toBeDefined()
  })

  it("Message supports attachments", () => {
    const msg: Message = {
      id: "test-2",
      role: "user",
      content: "[图片]",
      createdAt: new Date().toISOString(),
      attachments: [{ name: "test.png", dataUrl: "data:image/png;base64,abc" }],
    }
    expect(msg.attachments).toHaveLength(1)
  })

  it("Message supports toolCalls", () => {
    const msg: Message = {
      id: "test-3",
      role: "assistant",
      content: "查询结果",
      createdAt: new Date().toISOString(),
      toolCalls: [{ name: "knowledge_search", args: '{"query":"GB 28663"}', result: "found" }],
    }
    expect(msg.toolCalls).toHaveLength(1)
    expect(msg.toolCalls![0].name).toBe("knowledge_search")
  })

  it("Conversation type has required fields", () => {
    const conv: Conversation = {
      id: "conv-1",
      title: "测试会话",
      lastMessage: "最后一条消息",
      time: "10:00",
      timestamp: new Date().toISOString(),
      unread: false,
      active: false,
      messages: [],
    }
    expect(conv.id).toBe("conv-1")
    expect(conv.messages).toBeInstanceOf(Array)
  })

  it("Message supports pending and error states", () => {
    const pending: Message = {
      id: "p1", role: "assistant", content: "", createdAt: "",
      pending: true,
    }
    expect(pending.pending).toBe(true)

    const error: Message = {
      id: "e1", role: "assistant", content: "", createdAt: "",
      error: "API 调用超时",
    }
    expect(error.error).toBe("API 调用超时")
  })
})
