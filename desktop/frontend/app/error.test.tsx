import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { vi, describe, it, expect, beforeEach } from "vitest"
import ErrorBoundary from "./error"

// ── mocks ──────────────────────────────────────────────────────────────────

vi.mock("lucide-react", () => ({
  AlertTriangle: () => <svg data-testid="icon-alert-triangle" />,
  RefreshCw: () => <svg data-testid="icon-refresh-cw" />,
}))

const mockMonitorError = vi.fn()
vi.mock("@/lib/monitor-sdk", () => ({
  monitor: { error: mockMonitorError },
}))

// ── helpers ────────────────────────────────────────────────────────────────

function renderError(
  overrides: Partial<{ error: Error; reset: () => void }> = {}
) {
  const error = overrides.error ?? new Error("测试错误")
  const reset = overrides.reset ?? vi.fn()
  return { reset, ...render(<ErrorBoundary error={error} reset={reset} />) }
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("ErrorBoundary (error.tsx)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders error title and descriptive message", () => {
    renderError()
    expect(screen.getByText("页面出错了")).toBeInTheDocument()
    expect(
      screen.getByText(/EcoPilot 遇到了一个意外错误/)
    ).toBeInTheDocument()
  })

  it("reports error to monitor SDK on mount", async () => {
    const error = new Error("数据库连接超时")
    error.stack = "Error: 数据库连接超时\n  at fn (file.tsx:10:5)"
    renderError({ error })

    // Wait for the dynamic import promise to resolve
    await vi.waitFor(() => {
      expect(mockMonitorError).toHaveBeenCalledWith(
        "渲染崩溃: 数据库连接超时",
        expect.objectContaining({
          stack: expect.stringContaining("数据库连接超时"),
        })
      )
    })
  })

  it("passes digest to monitor when present", async () => {
    const error = new Error("test")
    error.digest = "ERR-2026-00042"
    renderError({ error })

    await vi.waitFor(() => {
      expect(mockMonitorError).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ digest: "ERR-2026-00042" })
      )
    })
  })

  it("renders error digest when present", () => {
    const error = new Error("测试错误")
    error.digest = "ERR-2026-00042"
    renderError({ error })
    expect(screen.getByText("错误编号: ERR-2026-00042")).toBeInTheDocument()
  })

  it("does not render digest block when digest is absent", () => {
    renderError()
    expect(screen.queryByText(/错误编号/)).not.toBeInTheDocument()
  })

  it("has a retry button that triggers reset on click", async () => {
    const reset = vi.fn()
    renderError({ reset })
    const btn = screen.getByRole("button", { name: /重试/ })
    expect(btn).toBeInTheDocument()
    await userEvent.click(btn)
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it("renders the AlertTriangle and RefreshCw icons", () => {
    renderError()
    expect(screen.getByTestId("icon-alert-triangle")).toBeInTheDocument()
    expect(screen.getByTestId("icon-refresh-cw")).toBeInTheDocument()
  })

  describe("edge cases", () => {
    it("handles empty error message gracefully", () => {
      renderError({ error: new Error() })
      expect(screen.getByText("页面出错了")).toBeInTheDocument()
    })

    it("handles undefined stack gracefully", () => {
      const error = new Error("no stack")
      delete (error as { stack?: string }).stack
      renderError({ error })
      expect(screen.getByText("页面出错了")).toBeInTheDocument()
    })

    it("handles very long stack (truncated to 500 chars)", async () => {
      const error = new Error("长堆栈")
      error.stack = "Error: 长堆栈\n" + "  at fn (x.js:1:2)\n".repeat(200)
      renderError({ error })

      await vi.waitFor(() => {
        expect(mockMonitorError).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            stack: expect.stringMatching(/^.{1,500}$/s),
          })
        )
      })
    })
  })
})
