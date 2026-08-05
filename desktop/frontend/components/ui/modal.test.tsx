import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Modal } from "@/components/ui/modal"

// Mock lucide-react
vi.mock("lucide-react", () => ({
  X: () => <span data-testid="icon-x" />,
}))

describe("Modal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("不渲染当 open=false", () => {
    render(
      <Modal open={false} onClose={vi.fn()}>
        <div>Content</div>
      </Modal>
    )
    expect(screen.queryByText("Content")).toBeNull()
  })

  it("渲染内容当 open=true", () => {
    render(
      <Modal open={true} onClose={vi.fn()}>
        <div>Modal Content</div>
      </Modal>
    )
    expect(screen.getByText("Modal Content")).toBeTruthy()
  })

  it("显示标题和描述", () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="设置" description="配置您的账户">
        <div>Body</div>
      </Modal>
    )
    expect(screen.getByText("设置")).toBeTruthy()
    expect(screen.getByText("配置您的账户")).toBeTruthy()
  })

  it("显示 footer", () => {
    render(
      <Modal open={true} onClose={vi.fn()} footer={<button>Save</button>}>
        <div>Body</div>
      </Modal>
    )
    expect(screen.getByText("Save")).toBeTruthy()
  })

  it("点击遮罩层触发 onClose", () => {
    const onClose = vi.fn()
    render(
      <Modal open={true} onClose={onClose}>
        <div>Content</div>
      </Modal>
    )
    const overlay = screen.getByRole("dialog").previousElementSibling
    if (overlay) fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalled()
  })

  it("点击关闭按钮触发 onClose", () => {
    const onClose = vi.fn()
    render(
      <Modal open={true} onClose={onClose} title="测试弹窗">
        <div>Content</div>
      </Modal>
    )
    // 关闭按钮在有 title 时才渲染在 header 中
    const closeBtn = screen.getAllByRole("button").find(b => b.getAttribute("aria-label") === "关闭弹窗")
    if (closeBtn) fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalled()
  })

  it("ESC 键触发 onClose", () => {
    const onClose = vi.fn()
    render(
      <Modal open={true} onClose={onClose}>
        <div>Content</div>
      </Modal>
    )
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalled()
  })

  it("不同 size 应用正确的 class", () => {
    const { container } = render(
      <Modal open={true} onClose={vi.fn()} size="lg">
        <div>Large</div>
      </Modal>
    )
    const dialog = screen.getByRole("dialog")
    expect(dialog.className).toContain("max-w-lg")
  })

  it("关闭时恢复 body overflow", () => {
    const { rerender } = render(
      <Modal open={true} onClose={vi.fn()}>
        <div>Open</div>
      </Modal>
    )
    expect(document.body.style.overflow).toBe("hidden")

    rerender(
      <Modal open={false} onClose={vi.fn()}>
        <div>Closed</div>
      </Modal>
    )
    expect(document.body.style.overflow).toBe("")
  })
})
