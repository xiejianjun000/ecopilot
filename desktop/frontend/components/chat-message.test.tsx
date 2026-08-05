import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { ChatMessage } from "@/components/chat-message"
import type { Message } from "@/lib/types"

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  Copy: () => <span data-testid="icon-copy" />,
  Check: () => <span data-testid="icon-check" />,
  ThumbsUp: () => <span data-testid="icon-thumbs-up" />,
  ThumbsDown: () => <span data-testid="icon-thumbs-down" />,
  RotateCcw: () => <span data-testid="icon-rotate" />,
  AlertTriangle: () => <span data-testid="icon-alert" />,
  Loader2: () => <span data-testid="icon-loader" />,
  Wrench: () => <span data-testid="icon-wrench" />,
  ChevronDown: () => <span data-testid="icon-chevron-down" />,
  ChevronRight: () => <span data-testid="icon-chevron-right" />,
  Volume2: () => <span data-testid="icon-volume" />,
  Share2: () => <span data-testid="icon-share" />,
  FileText: () => <span data-testid="icon-file" />,
}))

vi.mock("@/lib/api", () => ({
  getApiBase: () => "http://127.0.0.1:8002",
  ensureAuthToken: vi.fn(),
  authHeaders: () => ({}),
}))

function userMsg(content: string, extra?: Partial<Message>): Message {
  return {
    id: "u1",
    role: "user",
    content,
    createdAt: "2026-01-01T00:00:00Z",
    ...extra,
  }
}

function assistantMsg(content: string, extra?: Partial<Message>): Message {
  return {
    id: "a1",
    role: "assistant",
    content,
    createdAt: "2026-01-01T00:00:00Z",
    ...extra,
  }
}

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
  })
})

describe("ChatMessage — 用户消息", () => {
  it("显示用户消息内容", () => {
    render(<ChatMessage message={userMsg("如何填写执行报告")} sending={false} />)
    expect(screen.getByText("如何填写执行报告")).toBeTruthy()
  })

  it("用户头像显示'我'", () => {
    render(<ChatMessage message={userMsg("测试")} sending={false} />)
    expect(screen.getByText("我")).toBeTruthy()
  })

  it("用户消息包含复制按钮", () => {
    render(<ChatMessage message={userMsg("测试内容")} sending={false} />)
    expect(screen.getByText("复制")).toBeTruthy()
  })

  it("用户消息使用绿色气泡样式", () => {
    const { container } = render(
      <ChatMessage message={userMsg("测试")} sending={false} />
    )
    expect(container.querySelector(".bg-eco-600")).toBeTruthy()
  })
})

describe("ChatMessage — 助手消息", () => {
  it("显示助手消息内容", () => {
    render(
      <ChatMessage
        message={assistantMsg("根据《排污许可管理条例》第21条...")}
        sending={false}
      />
    )
    expect(screen.getByText("根据《排污许可管理条例》第21条...")).toBeTruthy()
  })

  it("助手消息完成后显示操作栏按钮", () => {
    render(<ChatMessage message={assistantMsg("合规回复")} sending={false} />)
    expect(screen.getByLabelText("赞")).toBeTruthy()
    expect(screen.getByLabelText("踩")).toBeTruthy()
    expect(screen.getByLabelText("朗读")).toBeTruthy()
    expect(screen.getByLabelText("复制为 Markdown")).toBeTruthy()
  })
})

describe("ChatMessage — 加载态", () => {
  it("pending 且无内容时显示进度文本", () => {
    const pendingMsg: Message = { ...assistantMsg(""), pending: true }
    render(
      <ChatMessage
        message={pendingMsg}
        sending={true}
        progress={{ text: "正在检索法规库…" }}
      />
    )
    expect(screen.getByText("正在检索法规库…")).toBeTruthy()
  })

  it("pending 且有内容时同时显示内容和进度", () => {
    const pendingMsg: Message = { ...assistantMsg("部分回复"), pending: true }
    render(
      <ChatMessage
        message={pendingMsg}
        sending={true}
        progress={{ text: "继续生成中…" }}
      />
    )
    expect(screen.getByText("部分回复")).toBeTruthy()
    expect(screen.getByText("继续生成中…")).toBeTruthy()
  })
})

describe("ChatMessage — 错误态", () => {
  it("显示错误消息和重试按钮", () => {
    render(
      <ChatMessage
        message={assistantMsg("", { error: "API 调用超时" })}
        sending={false}
        onRegenerate={vi.fn()}
      />
    )
    expect(screen.getByText("API 调用超时")).toBeTruthy()
    expect(screen.getByText("重试")).toBeTruthy()
  })

  it("点击重试触发 onRegenerate", () => {
    const onRegenerate = vi.fn()
    render(
      <ChatMessage
        message={assistantMsg("", { error: "网络错误" })}
        sending={false}
        onRegenerate={onRegenerate}
      />
    )
    screen.getByText("重试").click()
    expect(onRegenerate).toHaveBeenCalledOnce()
  })
})

describe("ChatMessage — 工具调用", () => {
  it("有 toolCalls 时显示工具调用面板", () => {
    const msg = assistantMsg("合规检查结果", {
      toolCalls: [
        {
          name: "permit_quick_check",
          args: '{"id":"test"}',
          result: "排放口数: 48",
        },
      ],
    })
    render(<ChatMessage message={msg} sending={false} />)
    expect(screen.getByText(/工具调用/)).toBeTruthy()
  })

  it("toolCalls 为空数组时不显示面板", () => {
    render(
      <ChatMessage
        message={assistantMsg("纯文本回复", { toolCalls: [] })}
        sending={false}
      />
    )
    expect(screen.queryByText(/工具调用/)).toBeNull()
  })
})

describe("ChatMessage — 附件", () => {
  it("用户消息带图片附件时显示图片元素", () => {
    const msg = userMsg("[图片]", {
      attachments: [
        {
          name: "许可证.png",
          dataUrl: "data:image/png;base64,aaa",
        },
      ],
    })
    const { container } = render(
      <ChatMessage message={msg} sending={false} />
    )
    expect(container.querySelector("img")).toBeTruthy()
  })
})
