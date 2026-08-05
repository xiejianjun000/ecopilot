import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("lucide-react", () => ({
  X: ({ className }: { className?: string }) => (
    <svg data-testid="icon-x" className={className} />
  ),
  Plus: ({ className }: { className?: string }) => (
    <svg data-testid="icon-plus" className={className} />
  ),
  Calendar: () => <svg data-testid="icon-calendar" />,
  Clock: () => <svg data-testid="icon-clock" />,
  MapPin: () => <svg data-testid="icon-map-pin" />,
  AlertTriangle: () => <svg data-testid="icon-alert-triangle" />,
  CheckCircle2: () => <svg data-testid="icon-check-circle" />,
  Loader2: ({ className }: { className?: string }) => (
    <svg data-testid="icon-loader" className={className} />
  ),
  Send: () => <svg data-testid="icon-send" />,
  ChevronDown: () => <svg data-testid="icon-chevron-down" />,
}))

vi.mock("@/lib/api", () => ({
  apiPost: vi.fn(),
}))

vi.mock("@/lib/utils", () => ({
  cn: (...classes: (string | boolean | undefined | null)[]) =>
    classes.filter(Boolean).join(" "),
}))

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

import { AddEventModal } from "./add-event-modal"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AddEventModal", () => {
  const defaults = {
    open: true,
    defaultDate: "2026-07-29",
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("visibility", () => {
    it("returns null when closed", () => {
      const { container } = render(
        <AddEventModal {...defaults} open={false} />
      )
      expect(container.innerHTML).toBe("")
    })

    it("renders the modal when open", () => {
      render(<AddEventModal {...defaults} />)
      expect(screen.getByRole("dialog")).toBeInTheDocument()
      expect(screen.getByRole("dialog")).toHaveAttribute(
        "aria-modal",
        "true"
      )
    })
  })

  describe("form fields", () => {
    it("renders the heading", () => {
      render(<AddEventModal {...defaults} />)
      expect(
        screen.getByRole("heading", { name: /新建日程/i })
      ).toBeInTheDocument()
    })

    it("renders the title input", () => {
      render(<AddEventModal {...defaults} />)
      expect(
        screen.getByPlaceholderText(/如：季度执行报告提交/i)
      ).toBeInTheDocument()
    })

    it("renders the date input", () => {
      render(<AddEventModal {...defaults} />)
      const dateInput = screen.getByDisplayValue("2026-07-29")
      expect(dateInput).toBeInTheDocument()
      expect(dateInput).toHaveAttribute("type", "date")
    })

    it("renders all five event-type buttons", () => {
      render(<AddEventModal {...defaults} />)
      // 许可, 报告, 监测, 台账, 告警
      expect(screen.getByRole("button", { name: /许可/i })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /报告/i })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /监测/i })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /台账/i })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /告警/i })).toBeInTheDocument()
    })

    it("renders the description textarea", () => {
      render(<AddEventModal {...defaults} />)
      expect(
        screen.getByPlaceholderText(/可选：补充说明/i)
      ).toBeInTheDocument()
    })

    it("renders the repeat-frequency input", () => {
      render(<AddEventModal {...defaults} />)
      expect(
        screen.getByPlaceholderText(/如：每月/)
      ).toBeInTheDocument()
    })
  })

  describe("action buttons", () => {
    it("renders the cancel button", () => {
      render(<AddEventModal {...defaults} />)
      expect(
        screen.getByRole("button", { name: /取消/i })
      ).toBeInTheDocument()
    })

    it("renders the submit button", () => {
      render(<AddEventModal {...defaults} />)
      expect(
        screen.getByRole("button", { name: /添加日程/i })
      ).toBeInTheDocument()
    })

    it("calls onClose when Cancel is clicked", async () => {
      const onClose = vi.fn()
      render(<AddEventModal {...defaults} onClose={onClose} />)
      await userEvent.click(screen.getByRole("button", { name: /取消/i }))
      expect(onClose).toHaveBeenCalledOnce()
    })

    it("calls onClose when X close button is clicked", async () => {
      const onClose = vi.fn()
      render(<AddEventModal {...defaults} onClose={onClose} />)
      await userEvent.click(screen.getByRole("button", { name: /关闭/i }))
      expect(onClose).toHaveBeenCalledOnce()
    })

    it("disables submit when title is empty", () => {
      render(<AddEventModal {...defaults} />)
      expect(screen.getByRole("button", { name: /添加日程/i })).toBeDisabled()
    })

    it("enables submit when title is filled", () => {
      render(<AddEventModal {...defaults} />)
      const input = screen.getByPlaceholderText(/如：季度执行报告提交/i)
      fireEvent.change(input, { target: { value: "foo" } })
      expect(screen.getByRole("button", { name: /添加日程/i })).toBeEnabled()
    })
  })
})
