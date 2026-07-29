import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { GlobalSearch } from "./global-search"

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock("lucide-react", () => ({
  Search: () => <svg data-testid="icon-search" />,
  X: () => <svg data-testid="icon-x" />,
  MessageSquare: () => <svg data-testid="icon-message-square" />,
  BookOpen: () => <svg data-testid="icon-book-open" />,
  FileText: () => <svg data-testid="icon-file-text" />,
  ExternalLink: () => <svg data-testid="icon-external-link" />,
}))

const mockDispatch = vi.fn()

vi.mock("@/lib/store", () => ({
  useApp: () => mockUseApp(),
}))

const mockUseApp = vi.fn()

// ── Helpers ─────────────────────────────────────────────────────────

function buildState(overrides?: Record<string, unknown>) {
  return {
    activeNav: "chat",
    conversations: [
      { id: "conv-1", title: "排污许可咨询", time: "14:30", lastMessage: "关于排污许可的疑问", unread: false, active: false, messages: [], timestamp: "2026-07-29T06:30:00Z" },
      { id: "conv-2", title: "大气排放标准", time: "11:00", lastMessage: "大气排放标准咨询", unread: false, active: false, messages: [], timestamp: "2026-07-28T03:00:00Z" },
    ],
    ...overrides,
  }
}

function setup(open = true, onClose = vi.fn()) {
  mockUseApp.mockReturnValue({ state: buildState(), dispatch: mockDispatch })
  const utils = render(<GlobalSearch open={open} onClose={onClose} />)
  return { onClose, ...utils }
}

function typeInSearch(text: string) {
  const input = screen.getByPlaceholderText("搜索模块、法规、会话...")
  fireEvent.change(input, { target: { value: text } })
  return input
}

// ── Tests ───────────────────────────────────────────────────────────

describe("GlobalSearch", () => {
  beforeEach(() => {
    mockDispatch.mockClear()
    mockUseApp.mockClear()
  })

  // ── Visibility ──────────────────────────────────────────────────

  describe("visibility", () => {
    it("renders nothing when open is false", () => {
      const { container } = setup(false)
      expect(container.firstChild).toBeNull()
    })

    it("renders the overlay when open is true", () => {
      setup(true)
      expect(screen.getByPlaceholderText("搜索模块、法规、会话...")).toBeInTheDocument()
    })
  })

  // ── Basic rendering ─────────────────────────────────────────────

  describe("basic rendering", () => {
    it("shows the search input with placeholder text", () => {
      setup(true)
      const input = screen.getByPlaceholderText("搜索模块、法规、会话...")
      expect(input).toBeInTheDocument()
      expect(input).toBeVisible()
    })

    it("shows the ESC badge", () => {
      setup(true)
      expect(screen.getByText("ESC")).toBeInTheDocument()
    })

    it("shows the Search icon", () => {
      setup(true)
      expect(screen.getByTestId("icon-search")).toBeInTheDocument()
    })

    it("shows the close button with X icon", () => {
      setup(true)
      expect(screen.getByTestId("icon-x")).toBeInTheDocument()
    })
  })

  // ── Focus and state reset ───────────────────────────────────────

  describe("focus and state reset", () => {
    it("focuses the input when opened", () => {
      const { rerender } = render(<GlobalSearch open={false} onClose={vi.fn()} />)
      mockUseApp.mockReturnValue({ state: buildState(), dispatch: mockDispatch })
      rerender(<GlobalSearch open={true} onClose={vi.fn()} />)
      expect(screen.getByPlaceholderText("搜索模块、法规、会话...")).toHaveFocus()
    })

    it("clears the query when opened", () => {
      const { rerender } = render(<GlobalSearch open={false} onClose={vi.fn()} />)
      mockUseApp.mockReturnValue({ state: buildState(), dispatch: mockDispatch })
      rerender(<GlobalSearch open={true} onClose={vi.fn()} />)
      expect(screen.getByPlaceholderText("搜索模块、法规、会话...")).toHaveValue("")
    })
  })

  // ── Search results ─────────────────────────────────────────────

  describe("search results", () => {
    it("renders all nav items when query is empty", () => {
      setup(true)
      expect(screen.getByText("仪表盘")).toBeInTheDocument()
      expect(screen.getByText("合规日历")).toBeInTheDocument()
      expect(screen.getByText("交办整改")).toBeInTheDocument()
      expect(screen.getByText("申报平台")).toBeInTheDocument()
      expect(screen.getByText("档案库")).toBeInTheDocument()
      expect(screen.getByText("知识库")).toBeInTheDocument()
      expect(screen.getByText("连接器")).toBeInTheDocument()
      expect(screen.getByText("设置")).toBeInTheDocument()
    })

    it("renders all law items when query is empty", () => {
      setup(true)
      expect(screen.getByText("排污许可管理条例")).toBeInTheDocument()
      expect(screen.getByText("大气污染防治法")).toBeInTheDocument()
    })

    it("renders conversation items from the store", () => {
      setup(true)
      expect(screen.getByText("排污许可咨询")).toBeInTheDocument()
      expect(screen.getByText("大气排放标准")).toBeInTheDocument()
    })

    it("renders type badges for each result category", () => {
      setup(true)
      expect(screen.getAllByText("页面").length).toBe(8)
      expect(screen.getAllByText("法规").length).toBe(2)
      expect(screen.getAllByText("会话").length).toBe(2)
    })

    it("shows descriptions for nav and law items", () => {
      setup(true)
      expect(screen.getByText("合规态势总览")).toBeInTheDocument()
      expect(screen.getByText("国务院 · 2021-03-01")).toBeInTheDocument()
    })
  })

  // ── Filtering ──────────────────────────────────────────────────

  describe("filtering", () => {
    it("filters results by label substring match", () => {
      setup(true)
      typeInSearch("仪表")
      expect(screen.getByText("仪表盘")).toBeInTheDocument()
      expect(screen.queryByText("合规日历")).not.toBeInTheDocument()
    })

    it("filters results by description substring match", () => {
      setup(true)
      typeInSearch("合规态势")
      expect(screen.getByText("仪表盘")).toBeInTheDocument()
      expect(screen.queryByText("合规日历")).not.toBeInTheDocument()
    })

    it("shows no items when nothing matches", () => {
      setup(true)
      typeInSearch("zzznotfound")
      expect(screen.queryByText("仪表盘")).not.toBeInTheDocument()
      expect(screen.queryByText("排污许可管理条例")).not.toBeInTheDocument()
      expect(screen.queryByText("排污许可咨询")).not.toBeInTheDocument()
    })

    it("shows all items when query is cleared after filtering", () => {
      setup(true)
      typeInSearch("仪表")
      expect(screen.queryByText("合规日历")).not.toBeInTheDocument()
      typeInSearch("")
      expect(screen.getByText("合规日历")).toBeInTheDocument()
    })

    it("resets selection index to 0 when query changes", () => {
      setup(true)
      const input = screen.getByPlaceholderText("搜索模块、法规、会话...")
      fireEvent.keyDown(input, { key: "ArrowDown" })
      typeInSearch("法")
      // First item matching "法" should be activated on Enter
      fireEvent.keyDown(input, { key: "Enter" })
      // 大气污染防治法 is the first item matching "法"
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SET_NAV" })
      )
    })
  })

  // ── Keyboard navigation ────────────────────────────────────────

  describe("keyboard navigation", () => {
    it("moves selection down with ArrowDown and highlights the next item", () => {
      setup(true)
      const input = screen.getByPlaceholderText("搜索模块、法规、会话...")
      fireEvent.keyDown(input, { key: "ArrowDown" })
      const selectedButton = screen.getByText("合规日历").closest("button")!
      expect(selectedButton.className).toContain("bg-accent")
    })

    it("moves selection up with ArrowUp", () => {
      setup(true)
      const input = screen.getByPlaceholderText("搜索模块、法规、会话...")
      fireEvent.keyDown(input, { key: "ArrowDown" })
      fireEvent.keyDown(input, { key: "ArrowDown" })
      // Now at index 2 (交办整改)
      fireEvent.keyDown(input, { key: "ArrowUp" })
      // Back to index 1 (合规日历)
      const selectedButton = screen.getByText("合规日历").closest("button")!
      expect(selectedButton.className).toContain("bg-accent")
    })

    it("clamps selection to 0 when pressing ArrowUp at the top", () => {
      setup(true)
      const input = screen.getByPlaceholderText("搜索模块、法规、会话...")
      fireEvent.keyDown(input, { key: "ArrowUp" })
      // First item stays selected; pressing Enter activates first item
      fireEvent.keyDown(input, { key: "Enter" })
      expect(mockDispatch).toHaveBeenCalledWith({ type: "SET_NAV", nav: "dashboard" })
    })

    it("clamps selection to last index when pressing ArrowDown past bottom", () => {
      setup(true)
      const input = screen.getByPlaceholderText("搜索模块、法规、会话...")
      // There are 12 items total (8 nav + 2 law + 2 conv)
      for (let i = 0; i < 20; i++) {
        fireEvent.keyDown(input, { key: "ArrowDown" })
      }
      // Should not crash; last item should be "大气排放标准"
      fireEvent.keyDown(input, { key: "Enter" })
      // conversations dispatch SET_CONVERSATION_ACTIVE + SET_NAV
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SET_CONVERSATION_ACTIVE" })
      )
    })

    it("activates the selected item on Enter", () => {
      setup(true)
      const input = screen.getByPlaceholderText("搜索模块、法规、会话...")
      fireEvent.keyDown(input, { key: "ArrowDown" }) // index 1 = 合规日历
      fireEvent.keyDown(input, { key: "Enter" })
      expect(mockDispatch).toHaveBeenCalledWith({ type: "SET_NAV", nav: "calendar" })
    })

    it("calls onClose on Escape", () => {
      const onClose = vi.fn()
      setup(true, onClose)
      const input = screen.getByPlaceholderText("搜索模块、法规、会话...")
      fireEvent.keyDown(input, { key: "Escape" })
      expect(onClose).toHaveBeenCalledOnce()
    })
  })

  // ── Activation on click ────────────────────────────────────────

  describe("activation on click", () => {
    it("dispatches SET_CONVERSATION_ACTIVE and SET_NAV when clicking a conversation item", () => {
      setup(true)
      const convButton = screen.getByText("排污许可咨询").closest("button")!
      fireEvent.click(convButton)
      expect(mockDispatch).toHaveBeenCalledWith({ type: "SET_CONVERSATION_ACTIVE", id: "conv-1" })
      expect(mockDispatch).toHaveBeenCalledWith({ type: "SET_NAV", nav: "chat" })
    })

    it("dispatches SET_NAV when clicking a nav item", () => {
      setup(true)
      const navButton = screen.getByText("仪表盘").closest("button")!
      fireEvent.click(navButton)
      expect(mockDispatch).toHaveBeenCalledWith({ type: "SET_NAV", nav: "dashboard" })
    })

    it("dispatches SET_NAV when clicking a law item", () => {
      setup(true)
      const lawButton = screen.getByText("排污许可管理条例").closest("button")!
      fireEvent.click(lawButton)
      expect(mockDispatch).toHaveBeenCalledWith({ type: "SET_NAV", nav: "knowledge" })
    })

    it("calls onClose after clicking a result", () => {
      const onClose = vi.fn()
      setup(true, onClose)
      const navButton = screen.getByText("仪表盘").closest("button")!
      fireEvent.click(navButton)
      expect(onClose).toHaveBeenCalledOnce()
    })
  })

  // ── Backdrop click ─────────────────────────────────────────────

  describe("backdrop click", () => {
    it("calls onClose when clicking the backdrop overlay", () => {
      const onClose = vi.fn()
      setup(true, onClose)
      // The outermost div has onClick={onClose}
      const backdrop = document.querySelector(".fixed.inset-0")!
      fireEvent.click(backdrop)
      expect(onClose).toHaveBeenCalledOnce()
    })

    it("does not call onClose when clicking inside the card", () => {
      const onClose = vi.fn()
      setup(true, onClose)
      // Clicking the input (inside the card with stopPropagation)
      const input = screen.getByPlaceholderText("搜索模块、法规、会话...")
      fireEvent.click(input)
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  // ── Icons per type ─────────────────────────────────────────────

  describe("icons per type", () => {
    it("renders FileText icon for each nav item", () => {
      setup(true)
      expect(screen.getAllByTestId("icon-file-text").length).toBe(8)
    })

    it("renders BookOpen icon for each law item", () => {
      setup(true)
      expect(screen.getAllByTestId("icon-book-open").length).toBe(2)
    })

    it("renders MessageSquare icon for each conversation item", () => {
      setup(true)
      expect(screen.getAllByTestId("icon-message-square").length).toBe(2)
    })
  })

  // ── Edge cases ─────────────────────────────────────────────────

  describe("edge cases", () => {
    it("works with no conversations", () => {
      mockUseApp.mockReturnValue({ state: buildState({ conversations: [] }), dispatch: mockDispatch })
      render(<GlobalSearch open={true} onClose={vi.fn()} />)
      expect(screen.getByText("仪表盘")).toBeInTheDocument()
      expect(screen.queryAllByText("会话").length).toBe(0)
    })

    it("does not crash on Enter when the filtered list is empty", () => {
      setup(true)
      const input = screen.getByPlaceholderText("搜索模块、法规、会话...")
      typeInSearch("zzznoresults")
      expect(() => {
        fireEvent.keyDown(input, { key: "Enter" })
      }).not.toThrow()
      expect(mockDispatch).not.toHaveBeenCalled()
    })

    it("does not dispatch when Enter pressed and selected index is out of bounds (empty results)", () => {
      setup(true)
      const input = screen.getByPlaceholderText("搜索模块、法规、会话...")
      fireEvent.change(input, { target: { value: "zzz" } })
      fireEvent.keyDown(input, { key: "Enter" })
      expect(mockDispatch).not.toHaveBeenCalled()
    })
  })
})
