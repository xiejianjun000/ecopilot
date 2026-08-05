import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { FeedbackModal } from "./feedback-modal"

vi.mock("lucide-react", () => ({
  MessageSquare: () => <span data-testid="icon-message-square" />,
  Send: () => <span data-testid="icon-send" />,
  X: () => <span data-testid="icon-x" />,
  Loader2: () => <span data-testid="icon-loader" />,
  CheckCircle2: () => <span data-testid="icon-check" />,
  Star: () => <span data-testid="icon-star" />,
}))

const mockApiPost = vi.fn()
vi.mock("@/lib/api", () => ({
  apiPost: (...args: unknown[]) => mockApiPost(...args),
}))

describe("FeedbackModal", () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders null when closed", () => {
    const { container } = render(<FeedbackModal open={false} onClose={onClose} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders modal with all elements when open", () => {
    render(<FeedbackModal open={true} onClose={onClose} />)

    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.getByText("意见反馈")).toBeInTheDocument()

    const textarea = screen.getByPlaceholderText("描述您遇到的问题或建议...")
    expect(textarea).toBeInTheDocument()

    const contactInput = screen.getByPlaceholderText("手机号 / 微信 / 邮箱")
    expect(contactInput).toBeInTheDocument()

    expect(screen.getByRole("button", { name: "发送反馈" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument()
  })

  it("provides message textarea and submit button", () => {
    render(<FeedbackModal open={true} onClose={onClose} />)

    const textarea = screen.getByPlaceholderText("描述您遇到的问题或建议...")
    expect(textarea.tagName).toBe("TEXTAREA")

    const submitBtn = screen.getByRole("button", { name: "发送反馈" })
    expect(submitBtn).toBeInTheDocument()
  })

  it("disables submit button when message is empty", () => {
    render(<FeedbackModal open={true} onClose={onClose} />)
    expect(screen.getByRole("button", { name: "发送反馈" })).toBeDisabled()
  })

  it("enables submit button when message is typed", async () => {
    const user = userEvent.setup()
    render(<FeedbackModal open={true} onClose={onClose} />)

    await user.type(
      screen.getByPlaceholderText("描述您遇到的问题或建议..."),
      "测试反馈",
    )

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "发送反馈" })).toBeEnabled()
    })
  })

  it("close button triggers onClose", async () => {
    const user = userEvent.setup()
    render(<FeedbackModal open={true} onClose={onClose} />)

    await user.click(screen.getByRole("button", { name: "关闭" }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("Escape key triggers onClose", async () => {
    const user = userEvent.setup()
    render(<FeedbackModal open={true} onClose={onClose} />)

    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("backdrop click triggers onClose", async () => {
    const user = userEvent.setup()
    render(<FeedbackModal open={true} onClose={onClose} />)

    const backdrop = screen.getByRole("dialog").parentElement!
    await user.click(backdrop)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("click inside modal does not trigger onClose", async () => {
    const user = userEvent.setup()
    render(<FeedbackModal open={true} onClose={onClose} />)

    await user.click(screen.getByRole("dialog"))
    expect(onClose).not.toHaveBeenCalled()
  })
})
