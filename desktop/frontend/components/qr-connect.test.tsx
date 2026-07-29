import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { QrConnect } from "./qr-connect"

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}))

vi.mock("lucide-react", () => ({
  QrCode: () => <span data-testid="icon-qrcode" />,
  Smartphone: () => <span data-testid="icon-smartphone" />,
  Loader2: () => <span data-testid="icon-loader2" />,
  CheckCircle2: () => <span data-testid="icon-checkcircle2" />,
  XCircle: () => <span data-testid="icon-xcircle" />,
  RefreshCw: () => <span data-testid="icon-refreshcw" />,
  X: () => <span data-testid="icon-x" />,
  Copy: () => <span data-testid="icon-copy" />,
  Check: () => <span data-testid="icon-check" />,
}))

describe("QrConnect", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  describe("conditional rendering", () => {
    it("renders nothing when open is false", () => {
      const { container } = render(<QrConnect open={false} onClose={() => {}} />)
      expect(container.innerHTML).toBe("")
    })

    it("renders modal content when open is true", () => {
      render(<QrConnect open={true} onClose={() => {}} />)
      expect(screen.getByText("扫码连接手机端")).toBeInTheDocument()
    })
  })

  describe("QR code placeholder", () => {
    it("displays the QR section with heading and description", () => {
      render(<QrConnect open={true} onClose={() => {}} />)
      expect(screen.getByText("扫码连接手机端")).toBeInTheDocument()
      expect(screen.getByText("使用手机浏览器扫描二维码，即可在移动端访问 EcoPilot")).toBeInTheDocument()
      expect(screen.getByText("二维码生成中")).toBeInTheDocument()
    })

    it("shows the Smartphone icon in the header area", () => {
      render(<QrConnect open={true} onClose={() => {}} />)
      expect(screen.getByTestId("icon-smartphone")).toBeInTheDocument()
    })

    it("shows the QrCode icon in the placeholder area", () => {
      render(<QrConnect open={true} onClose={() => {}} />)
      expect(screen.getByTestId("icon-qrcode")).toBeInTheDocument()
    })

    it("displays the default host before mount effect", () => {
      render(<QrConnect open={true} onClose={() => {}} />)
      expect(screen.getByText("localhost:3000")).toBeInTheDocument()
    })

    it("updates host from window.location after mount", () => {
      const { rerender } = render(<QrConnect open={true} onClose={() => {}} />)
      // After useEffect runs, host equals window.location.host
      expect(screen.getByText(window.location.host)).toBeInTheDocument()
    })
  })

  describe("close button", () => {
    it("calls onClose when the X close button is clicked", () => {
      const onClose = vi.fn()
      render(<QrConnect open={true} onClose={onClose} />)
      fireEvent.click(screen.getByLabelText("关闭"))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it("calls onClose when clicking the backdrop overlay", () => {
      const onClose = vi.fn()
      const { container } = render(<QrConnect open={true} onClose={onClose} />)
      // The outermost element is the fixed backdrop overlay
      const backdrop = container.firstChild as HTMLElement
      fireEvent.click(backdrop)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it("does NOT call onClose when clicking inside the modal card", () => {
      const onClose = vi.fn()
      render(<QrConnect open={true} onClose={onClose} />)
      // Clicking the heading (inside the card) should not propagate to the backdrop
      fireEvent.click(screen.getByText("扫码连接手机端"))
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe("copy button", () => {
    it("renders the copy button with initial label", () => {
      render(<QrConnect open={true} onClose={() => {}} />)
      expect(screen.getByText("复制链接")).toBeInTheDocument()
      expect(screen.getByLabelText("复制链接")).toBeInTheDocument()
      expect(screen.getByTestId("icon-copy")).toBeInTheDocument()
    })

    it("copies the full URL to clipboard on click", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(navigator, { clipboard: { writeText } })

      render(<QrConnect open={true} onClose={() => {}} />)
      await fireEvent.click(screen.getByLabelText("复制链接"))

      expect(writeText).toHaveBeenCalledWith("http://localhost:3000")
    })

    it("switches to copied state after clicking the copy button", async () => {
      Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })

      render(<QrConnect open={true} onClose={() => {}} />)
      await fireEvent.click(screen.getByLabelText("复制链接"))

      expect(await screen.findByText("已复制")).toBeInTheDocument()
      expect(screen.getByTestId("icon-check")).toBeInTheDocument()
    })

    it("reverts from copied state back to copy label after 2 seconds", async () => {
      vi.useFakeTimers()
      Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })

      render(<QrConnect open={true} onClose={() => {}} />)
      fireEvent.click(screen.getByLabelText("复制链接"))
      // Flush microtasks so the async handleCopy settles and setCopied(true) runs
      await act(async () => {})

      expect(screen.getByText("已复制")).toBeInTheDocument()

      act(() => vi.advanceTimersByTime(2000))

      expect(screen.getByText("复制链接")).toBeInTheDocument()
      expect(screen.getByTestId("icon-copy")).toBeInTheDocument()

      vi.useRealTimers()
    })

    it("does not throw when clipboard API is unavailable", async () => {
      // Simulate clipboard being unavailable (writeText rejects)
      Object.assign(navigator, {
        clipboard: { writeText: vi.fn().mockRejectedValue(new Error("not allowed")) },
      })

      render(<QrConnect open={true} onClose={() => {}} />)
      // Should not throw even though clipboard fails
      await fireEvent.click(screen.getByLabelText("复制链接"))

      // Should remain in the default copy state
      expect(screen.getByText("复制链接")).toBeInTheDocument()
    })
  })
})
