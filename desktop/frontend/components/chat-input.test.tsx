import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ChatInput } from "@/components/chat-input"

vi.mock("@/lib/store", () => ({
  useApp: () => ({
    state: { activeNav: "chat", prefillInput: null },
    dispatch: vi.fn(),
  }),
}))

vi.mock("@/lib/api", () => ({
  checkHealth: vi.fn().mockResolvedValue({
    ready: true, text_model: "deepseek-chat", vision_model: "moonshot-v1",
    text_ready: true, vision_ready: true,
  }),
  getApiBase: () => "http://127.0.0.1:8002",
}))

vi.mock("lucide-react", () => ({
  ArrowUp: () => <span data-testid="icon-arrow-up" />,
  Square: () => <span data-testid="icon-stop" />,
  Paperclip: () => <span data-testid="icon-paperclip" />,
  X: () => <span data-testid="icon-x" />,
  FileText: () => <span data-testid="icon-file" />,
  Loader2: () => <span data-testid="icon-loader" />,
  ChevronDown: () => <span data-testid="icon-chevron" />,
  Mic: () => <span data-testid="icon-mic" />,
  MessageSquare: () => <span data-testid="icon-message" />,
  Eye: () => <span data-testid="icon-eye" />,
  Check: () => <span data-testid="icon-check" />,
  Brain: () => <span data-testid="icon-brain" />,
  FolderPlus: () => <span data-testid="icon-folder-plus" />,
  FolderOpen: () => <span data-testid="icon-folder-open" />,
}))

describe("ChatInput", () => {
  const baseProps = {
    onSend: vi.fn(),
    sending: false,
    onStop: vi.fn(),
    model: "deepseek-chat",
    onModelChange: vi.fn(),
  }

  it("renders without crashing", () => {
    const { container } = render(<ChatInput {...baseProps} />)
    expect(container.children.length).toBeGreaterThan(0)
  })

  it("renders textarea for input", () => {
    const { container } = render(<ChatInput {...baseProps} />)
    const textarea = container.querySelector("textarea")
    expect(textarea).toBeTruthy()
  })

  it("renders send button area", () => {
    const { container } = render(<ChatInput {...baseProps} />)
    const btn = container.querySelector('[data-testid="icon-arrow-up"]')
    expect(btn).toBeTruthy()
  })

  it("renders stop button when sending", () => {
    render(<ChatInput {...baseProps} sending={true} />)
    // The stop button has a Square icon
    const stopBtn = screen.getByLabelText("停止生成")
    expect(stopBtn).toBeTruthy()
  })

  it("model selector has correct aria label", () => {
    render(<ChatInput {...baseProps} model="deepseek-chat" />)
    const btn = screen.getByLabelText(/模型选择，当前/)
    expect(btn).toBeTruthy()
  })

  it("shows attachment button", () => {
    const { container } = render(<ChatInput {...baseProps} />)
    const attachBtn = container.querySelector('[data-testid="icon-paperclip"]')
    expect(attachBtn).toBeTruthy()
  })
})
