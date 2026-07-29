import "@testing-library/jest-dom/vitest"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import { NotificationCenter } from "./notification-center"

// ── Hoisted mocks (for vi.mock factories) ──────────────────────────
const { mockApiGet } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
}))

// ── Module mocks (hoisted by vitest) ───────────────────────────────

vi.mock("lucide-react", () => {
  const icon = (name: string) => {
    const C = (props: any) => <span data-testid={`icon-${name}`} className={props.className} />
    C.displayName = name
    return C
  }
  return {
    Bell: icon("bell"),
    BellRing: icon("bell-ring"),
    CheckCheck: icon("check-check"),
    X: icon("x"),
    Loader2: icon("loader-2"),
    Settings: icon("settings"),
    Trash2: icon("trash-2"),
    ChevronRight: icon("chevron-right"),
    ExternalLink: icon("external-link"),
    AlertTriangle: icon("alert-triangle"),
    Calendar: icon("calendar"),
    CheckCircle2: icon("check-circle-2"),
    Clock: icon("clock"),
  }
})

vi.mock("@/lib/api", () => ({
  apiGet: (...args: unknown[]) => mockApiGet(...args),
}))

vi.mock("@/lib/utils", () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
}))

// ── Factory ────────────────────────────────────────────────────────

function notification(overrides: Partial<{
  id: string
  type: "urgent" | "warn" | "info"
  title: string
  desc: string
  time: string
  read: boolean
}> = {}) {
  return {
    id: "n1",
    type: "info" as const,
    title: "系统通知",
    desc: "这是一条测试通知",
    time: "2026-07-29 10:00",
    ...overrides,
  }
}

// ── Suite ──────────────────────────────────────────────────────────

describe("NotificationCenter", () => {
  const onClose = vi.fn()

  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    mockApiGet.mockResolvedValue({ ok: true, data: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Visibility ───────────────────────────────────────────────

  it("renders nothing when open is false", () => {
    const { container } = render(<NotificationCenter open={false} onClose={onClose} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders the panel when open is true", () => {
    mockApiGet.mockResolvedValue({ ok: true, data: [] })
    render(<NotificationCenter open={true} onClose={onClose} />)
    expect(screen.getByText("通知中心")).toBeInTheDocument()
  })

  // ── Header ───────────────────────────────────────────────────

  it("has a header with Bell icon and title", () => {
    mockApiGet.mockResolvedValue({ ok: true, data: [] })
    render(<NotificationCenter open={true} onClose={onClose} />)
    expect(screen.getByText("通知中心")).toBeInTheDocument()
    expect(screen.getByTestId("icon-bell")).toBeInTheDocument()
  })

  it("shows unread badge when there are unread notifications", async () => {
    mockApiGet.mockResolvedValue({
      ok: true,
      data: [
        notification({ id: "1", read: false }),
        notification({ id: "2", read: false }),
        notification({ id: "3", read: true }),
      ],
    })
    render(<NotificationCenter open={true} onClose={onClose} />)
    await waitFor(() => {
      expect(screen.getByText("2 项未读")).toBeInTheDocument()
    })
  })

  it("does not show unread badge when all notifications are read", async () => {
    mockApiGet.mockResolvedValue({
      ok: true,
      data: [
        notification({ id: "1", read: true }),
        notification({ id: "2", read: true }),
      ],
    })
    render(<NotificationCenter open={true} onClose={onClose} />)
    await waitFor(() => {
      expect(screen.queryByText(/项未读/)).not.toBeInTheDocument()
    })
  })

  it("does not show unread badge when there are zero notifications", async () => {
    mockApiGet.mockResolvedValue({ ok: true, data: [] })
    render(<NotificationCenter open={true} onClose={onClose} />)
    await waitFor(() => {
      expect(screen.queryByText(/项未读/)).not.toBeInTheDocument()
    })
  })

  it("has a close button in the header", () => {
    mockApiGet.mockResolvedValue({ ok: true, data: [] })
    render(<NotificationCenter open={true} onClose={onClose} />)
    expect(screen.getByRole("button", { name: /关闭/ })).toBeInTheDocument()
  })

  it("calls onClose when the close button is clicked", () => {
    mockApiGet.mockResolvedValue({ ok: true, data: [] })
    render(<NotificationCenter open={true} onClose={onClose} />)
    fireEvent.click(screen.getByRole("button", { name: /关闭/ }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("calls onClose when clicking the overlay background", () => {
    mockApiGet.mockResolvedValue({ ok: true, data: [] })
    const { container } = render(<NotificationCenter open={true} onClose={onClose} />)
    // The outermost div (z-[200]) is the overlay with onClick={onClose}
    const overlay = container.firstChild as HTMLElement
    expect(overlay).toBeInTheDocument()
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("does not call onClose when clicking inside the panel", () => {
    mockApiGet.mockResolvedValue({ ok: true, data: [] })
    render(<NotificationCenter open={true} onClose={onClose} />)
    // The panel has onClick={e => e.stopPropagation()}
    fireEvent.click(screen.getByText("通知中心"))
    expect(onClose).not.toHaveBeenCalled()
  })

  // ── Loading state ────────────────────────────────────────────

  it("shows loading indicator while fetching", () => {
    // Never resolve the promise so loading persists
    mockApiGet.mockReturnValue(new Promise(() => {}))
    render(<NotificationCenter open={true} onClose={onClose} />)
    expect(screen.getByText("加载中…")).toBeInTheDocument()
  })

  // ── Empty state ──────────────────────────────────────────────

  it("shows empty state when API returns empty array", async () => {
    mockApiGet.mockResolvedValue({ ok: true, data: [] })
    render(<NotificationCenter open={true} onClose={onClose} />)
    await waitFor(() => {
      expect(screen.getByText("暂无通知")).toBeInTheDocument()
    })
  })

  it("shows empty state when API returns ok: false", async () => {
    mockApiGet.mockResolvedValue({ ok: false, data: null })
    render(<NotificationCenter open={true} onClose={onClose} />)
    await waitFor(() => {
      expect(screen.getByText("暂无通知")).toBeInTheDocument()
    })
  })

  it("shows empty state when API rejects", async () => {
    mockApiGet.mockRejectedValue(new Error("Network failure"))
    render(<NotificationCenter open={true} onClose={onClose} />)
    await waitFor(() => {
      expect(screen.getByText("暂无通知")).toBeInTheDocument()
    })
  })

  // ── Notification list ────────────────────────────────────────

  it("renders notification items from API data", async () => {
    mockApiGet.mockResolvedValue({
      ok: true,
      data: [
        notification({ id: "1", title: "许可证即将到期", desc: "距到期还有15天", time: "2026-07-29" }),
        notification({ id: "2", title: "巡查任务提醒", desc: "今日需完成3项巡查", time: "2026-07-29" }),
      ],
    })
    render(<NotificationCenter open={true} onClose={onClose} />)
    await waitFor(() => {
      expect(screen.getByText("许可证即将到期")).toBeInTheDocument()
    })
    expect(screen.getByText("巡查任务提醒")).toBeInTheDocument()
    expect(screen.getByText("距到期还有15天")).toBeInTheDocument()
    expect(screen.getByText("今日需完成3项巡查")).toBeInTheDocument()
  })

  it("renders notifications of different types with correct icons", async () => {
    mockApiGet.mockResolvedValue({
      ok: true,
      data: [
        notification({ id: "1", type: "urgent", title: "紧急通知" }),
        notification({ id: "2", type: "warn", title: "警告通知" }),
        notification({ id: "3", type: "info", title: "信息通知" }),
      ],
    })
    render(<NotificationCenter open={true} onClose={onClose} />)
    await waitFor(() => {
      expect(screen.getByText("紧急通知")).toBeInTheDocument()
    })
    expect(screen.getByText("警告通知")).toBeInTheDocument()
    expect(screen.getByText("信息通知")).toBeInTheDocument()
    // Each type maps to a specific icon
    expect(screen.getByTestId("icon-alert-triangle")).toBeInTheDocument()
    expect(screen.getByTestId("icon-calendar")).toBeInTheDocument()
    expect(screen.getByTestId("icon-check-circle-2")).toBeInTheDocument()
  })

  it("falls back to Clock icon for unknown notification types", async () => {
    mockApiGet.mockResolvedValue({
      ok: true,
      data: [
        notification({ id: "1", type: "unknown" as any, title: "未知类型" }),
      ],
    })
    render(<NotificationCenter open={true} onClose={onClose} />)
    await waitFor(() => {
      expect(screen.getByText("未知类型")).toBeInTheDocument()
    })
    expect(screen.getByTestId("icon-clock")).toBeInTheDocument()
  })

  it("renders timestamps for each notification", async () => {
    mockApiGet.mockResolvedValue({
      ok: true,
      data: [
        notification({ id: "1", time: "2026-07-29 14:30", title: "带时间戳的通知" }),
      ],
    })
    render(<NotificationCenter open={true} onClose={onClose} />)
    await waitFor(() => {
      expect(screen.getByText("2026-07-29 14:30")).toBeInTheDocument()
    })
  })

  // ── API call behavior ────────────────────────────────────────

  it("calls apiGet with /api/notifications when opened", () => {
    render(<NotificationCenter open={true} onClose={onClose} />)
    expect(mockApiGet).toHaveBeenCalledWith("/api/notifications")
  })

  it("does not call apiGet when open is false", () => {
    render(<NotificationCenter open={false} onClose={onClose} />)
    expect(mockApiGet).not.toHaveBeenCalled()
  })

  it("calls apiGet again when open toggles from false to true", () => {
    const { rerender } = render(<NotificationCenter open={false} onClose={onClose} />)
    expect(mockApiGet).not.toHaveBeenCalled()

    rerender(<NotificationCenter open={true} onClose={onClose} />)
    expect(mockApiGet).toHaveBeenCalledTimes(1)
    expect(mockApiGet).toHaveBeenCalledWith("/api/notifications")
  })

  // ── Edge cases ───────────────────────────────────────────────

  it("handles non-array API data gracefully", async () => {
    mockApiGet.mockResolvedValue({ ok: true, data: "not-an-array" })
    render(<NotificationCenter open={true} onClose={onClose} />)
    await waitFor(() => {
      expect(screen.getByText("暂无通知")).toBeInTheDocument()
    })
  })

  it("handles missing data field from API gracefully", async () => {
    mockApiGet.mockResolvedValue({ ok: true })
    render(<NotificationCenter open={true} onClose={onClose} />)
    await waitFor(() => {
      expect(screen.getByText("暂无通知")).toBeInTheDocument()
    })
  })
})
