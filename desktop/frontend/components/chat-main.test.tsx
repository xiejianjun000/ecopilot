import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ChatMain } from "@/components/chat-main"

// ── Mock all 21 lucide-react icons used in chat-main.tsx ──
vi.mock("lucide-react", () => ({
  PanelRight: () => <span data-testid="icon-panel-right" />,
  PanelLeft: () => <span data-testid="icon-panel-left" />,
  ShieldCheck: () => <span data-testid="icon-shield-check" />,
  Sparkles: () => <span data-testid="icon-sparkles" />,
  Clock: () => <span data-testid="icon-clock" />,
  ChevronRight: () => <span data-testid="icon-chevron-right" />,
  Calendar: () => <span data-testid="icon-calendar" />,
  ClipboardCheck: () => <span data-testid="icon-clipboard-check" />,
  Zap: () => <span data-testid="icon-zap" />,
  ExternalLink: () => <span data-testid="icon-external-link" />,
  FolderClosed: () => <span data-testid="icon-folder-closed" />,
  BookOpen: () => <span data-testid="icon-book-open" />,
  Plug: () => <span data-testid="icon-plug" />,
  Send: () => <span data-testid="icon-send" />,
  FileKey: () => <span data-testid="icon-file-key" />,
  Building2: () => <span data-testid="icon-building" />,
  Scale: () => <span data-testid="icon-scale" />,
  FileText: () => <span data-testid="icon-file-text" />,
  ClipboardList: () => <span data-testid="icon-clipboard-list" />,
  AlertTriangle: () => <span data-testid="icon-alert-triangle" />,
  BarChart3: () => <span data-testid="icon-bar-chart" />,
  ArrowDown: () => <span data-testid="icon-arrow-down" />,
  LinkIcon: () => <span data-testid="icon-link" />,
}))

// ── Mock all 11 imported view components ──
vi.mock("@/components/chat-message", () => ({
  ChatMessage: vi.fn(() => <div data-testid="chat-message" />),
}))

vi.mock("@/components/chat-input", () => ({
  ChatInput: vi.fn(() => <div data-testid="chat-input" />),
}))

vi.mock("@/components/dashboard-view", () => ({
  DashboardView: vi.fn(() => <div data-testid="dashboard-view" />),
}))

vi.mock("@/components/views/inspection", () => ({
  InspectionView: vi.fn(() => <div data-testid="inspection-view" />),
}))

vi.mock("@/components/views/calendar", () => ({
  CalendarView: vi.fn(() => <div data-testid="calendar-view" />),
}))

vi.mock("@/components/views/links", () => ({
  LinksView: vi.fn(() => <div data-testid="links-view" />),
}))

vi.mock("@/components/views/vault", () => ({
  VaultView: vi.fn(() => <div data-testid="vault-view" />),
}))

vi.mock("@/components/views/knowledge", () => ({
  KnowledgeView: vi.fn(() => <div data-testid="knowledge-view" />),
}))

vi.mock("@/components/views/connector", () => ({
  ConnectorView: vi.fn(() => <div data-testid="connector-view" />),
}))

vi.mock("@/components/views/tasks", () => ({
  TasksView: vi.fn(() => <div data-testid="tasks-view" />),
}))

vi.mock("@/components/views/notify", () => ({
  NotifyView: vi.fn(() => <div data-testid="notify-view" />),
}))

vi.mock("@/components/views/industry-compliance", () => ({
  IndustryComplianceView: vi.fn(() => <div data-testid="industry-compliance-view" />),
}))

// ── Mock store ──
const mockDispatch = vi.fn()
const defaultState = {
  activeNav: "chat" as const,
  rightPanelOpen: false,
  conversations: [],
  activeConversationId: null,
  messages: [],
  sending: false,
  progress: null,
  taskSummaries: [],
  outputFiles: [],
  memories: [],
  diaryEntries: [],
  prefillInput: null,
  reviewDocId: null,
  reviewIssues: [],
  browserDoc: null,
}

let mockState = { ...defaultState }
vi.mock("@/lib/store", () => ({
  useApp: vi.fn(() => ({ state: mockState, dispatch: mockDispatch })),
  // re-export AppProvider as a no-op wrapper so tests using it still work
  AppProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// ── Mock API ──
vi.mock("@/lib/api", () => ({
  streamChat: vi.fn(),
  apiGet: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  getApiBase: vi.fn(() => "http://127.0.0.1:8002"),
}))

describe("ChatMain", () => {
  const baseProps = {
    leftOpen: true,
    onToggleLeft: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockState = { ...defaultState }
  })

  // ──────────── Rendering ────────────

  it("renders without crashing", () => {
    const { container } = render(<ChatMain {...baseProps} />)
    expect(container.querySelector("main")).toBeTruthy()
  })

  it("renders the sidebar toggle button", () => {
    render(<ChatMain {...baseProps} />)
    const toggleBtn = screen.getByLabelText("收起侧栏")
    expect(toggleBtn).toBeTruthy()
  })

  it("renders header toggle with PanelLeft icon", () => {
    render(<ChatMain {...baseProps} />)
    expect(screen.getByTestId("icon-panel-left")).toBeTruthy()
  })

  it("renders the right panel toggle button when nav is chat", () => {
    render(<ChatMain {...baseProps} />)
    const rightBtn = screen.getByLabelText("右面板")
    expect(rightBtn).toBeTruthy()
    expect(screen.getByTestId("icon-panel-right")).toBeTruthy()
  })

  // ──────────── Welcome / empty state ────────────

  it("shows welcome greeting when no messages exist", () => {
    render(<ChatMain {...baseProps} />)
    expect(screen.getByText("Pilot")).toBeTruthy()
    expect(screen.getByText("企业生态环境全生命周期AI管家")).toBeTruthy()
  })

  it("shows quick prompt buttons when no messages", () => {
    render(<ChatMain {...baseProps} />)
    expect(screen.getByText("快捷指令")).toBeTruthy()
    expect(screen.getByText("生成本月执行报告草稿")).toBeTruthy()
    expect(screen.getByText("查我的许可证还有多久到期")).toBeTruthy()
    expect(screen.getByText("台账缺失项排查")).toBeTruthy()
    expect(screen.getByText("近期环保处罚案例")).toBeTruthy()
  })

  it("shows Sparkles icon in quick prompts section", () => {
    render(<ChatMain {...baseProps} />)
    expect(screen.getByTestId("icon-sparkles")).toBeTruthy()
  })

  it("renders ChatInput when nav is chat", () => {
    render(<ChatMain {...baseProps} />)
    expect(screen.getByTestId("chat-input")).toBeTruthy()
  })

  // ──────────── Chat / messages state ────────────

  it("shows message area when messages exist", () => {
    mockState.messages = [
      { id: "m1", role: "user" as const, content: "Hello", createdAt: "2024-01-01T00:00:00Z" },
    ]
    render(<ChatMain {...baseProps} />)
    // The chat area has aria-live="polite"
    const msgArea = screen.getByRole("log")
    expect(msgArea).toBeTruthy()
    // ChatMessage component should be rendered
    expect(screen.getByTestId("chat-message")).toBeTruthy()
  })

  it("hides welcome greeting when messages exist", () => {
    mockState.messages = [
      { id: "m1", role: "user" as const, content: "Hello", createdAt: "2024-01-01T00:00:00Z" },
    ]
    render(<ChatMain {...baseProps} />)
    expect(screen.queryByText("Pilot")).toBeNull()
    expect(screen.queryByText("快捷指令")).toBeNull()
  })

  it("shows ChatInput even when messages exist", () => {
    mockState.messages = [
      { id: "m1", role: "user" as const, content: "Hello", createdAt: "2024-01-01T00:00:00Z" },
    ]
    render(<ChatMain {...baseProps} />)
    expect(screen.getByTestId("chat-input")).toBeTruthy()
  })

  it("sets aria-live polite on message area", () => {
    mockState.messages = [
      { id: "m1", role: "user" as const, content: "Hello", createdAt: "2024-01-01T00:00:00Z" },
    ]
    render(<ChatMain {...baseProps} />)
    const log = screen.getByRole("log")
    expect(log.getAttribute("aria-live")).toBe("polite")
    expect(log.getAttribute("aria-label")).toBe("对话消息")
  })

  // ──────────── Toggle button visibility ────────────

  it("shows sidebar toggle in md:hidden class when leftOpen is true", () => {
    render(<ChatMain leftOpen={true} onToggleLeft={vi.fn()} />)
    const toggleBtn = screen.getByLabelText("收起侧栏")
    // Button should have the "md:hidden" class when leftOpen is true
    expect(toggleBtn.className).toContain("md:hidden")
  })

  it("shows sidebar toggle without md:hidden when leftOpen is false", () => {
    render(<ChatMain leftOpen={false} onToggleLeft={vi.fn()} />)
    const toggleBtn = screen.getByLabelText("展开侧栏")
    expect(toggleBtn).toBeTruthy()
  })

  it("calls onToggleLeft when toggle button is clicked", () => {
    const onToggleLeft = vi.fn()
    render(<ChatMain leftOpen={true} onToggleLeft={onToggleLeft} />)
    fireEvent.click(screen.getByLabelText("收起侧栏"))
    expect(onToggleLeft).toHaveBeenCalledTimes(1)
  })

  // ──────────── View routing ────────────

  it("renders DashboardView when nav is dashboard", () => {
    mockState.activeNav = "dashboard"
    render(<ChatMain {...baseProps} />)
    expect(screen.getByTestId("dashboard-view")).toBeTruthy()
  })

  it("does not render ChatInput when nav is dashboard", () => {
    mockState.activeNav = "dashboard"
    render(<ChatMain {...baseProps} />)
    expect(screen.queryByTestId("chat-input")).toBeNull()
  })

  it("renders InspectionView when nav is inspection", () => {
    mockState.activeNav = "inspection"
    render(<ChatMain {...baseProps} />)
    expect(screen.getByTestId("inspection-view")).toBeTruthy()
  })

  it("renders CalendarView when nav is calendar", () => {
    mockState.activeNav = "calendar"
    render(<ChatMain {...baseProps} />)
    expect(screen.getByTestId("calendar-view")).toBeTruthy()
  })

  it("renders LinksView when nav is links", () => {
    mockState.activeNav = "links"
    render(<ChatMain {...baseProps} />)
    expect(screen.getByTestId("links-view")).toBeTruthy()
  })

  it("renders VaultView when nav is vault", () => {
    mockState.activeNav = "vault"
    render(<ChatMain {...baseProps} />)
    expect(screen.getByTestId("vault-view")).toBeTruthy()
  })

  it("renders KnowledgeView when nav is knowledge", () => {
    mockState.activeNav = "knowledge"
    render(<ChatMain {...baseProps} />)
    expect(screen.getByTestId("knowledge-view")).toBeTruthy()
  })

  it("renders ConnectorView when nav is connector", () => {
    mockState.activeNav = "connector"
    render(<ChatMain {...baseProps} />)
    expect(screen.getByTestId("connector-view")).toBeTruthy()
  })

  it("renders TasksView when nav is tasks", () => {
    mockState.activeNav = "tasks"
    render(<ChatMain {...baseProps} />)
    expect(screen.getByTestId("tasks-view")).toBeTruthy()
  })

  it("renders NotifyView when nav is notify", () => {
    mockState.activeNav = "notify"
    render(<ChatMain {...baseProps} />)
    expect(screen.getByTestId("notify-view")).toBeTruthy()
  })

  // ──────────── View header meta display ────────────

  it("shows nav meta icon and name for non-chat views", () => {
    mockState.activeNav = "calendar"
    render(<ChatMain {...baseProps} />)
    expect(screen.getByTestId("icon-calendar")).toBeTruthy()
    expect(screen.getByText("合规日历")).toBeTruthy()
  })

  it("shows back-to-chat button on non-chat views", () => {
    mockState.activeNav = "vault"
    render(<ChatMain {...baseProps} />)
    expect(screen.getByText("← 对话")).toBeTruthy()
  })

  it("does not render ChatInput when viewing a non-chat view", () => {
    mockState.activeNav = "knowledge"
    render(<ChatMain {...baseProps} />)
    expect(screen.queryByTestId("chat-input")).toBeNull()
  })

  // ──────────── Right panel button visibility ────────────

  it("does not show right panel button when nav is not chat", () => {
    mockState.activeNav = "dashboard"
    render(<ChatMain {...baseProps} />)
    expect(screen.queryByLabelText("右面板")).toBeNull()
  })

  // ──────────── Tab / switcher in header ────────────

  it("shows chat/dashboard switcher when nav is chat", () => {
    mockState.activeNav = "chat"
    render(<ChatMain {...baseProps} />)
    // Both switcher buttons should be rendered
    expect(screen.getByText("对话")).toBeTruthy()
    expect(screen.getByText("仪表盘")).toBeTruthy()
  })

  // ──────────── dispatch calls ────────────

  it("dispatches SET_NAV to dashboard when dashboard button clicked", () => {
    render(<ChatMain {...baseProps} />)
    fireEvent.click(screen.getByText("仪表盘"))
    expect(mockDispatch).toHaveBeenCalledWith({ type: "SET_NAV", nav: "dashboard" })
  })

  it("dispatches TOGGLE_RIGHT_PANEL when right panel button clicked", () => {
    render(<ChatMain {...baseProps} />)
    fireEvent.click(screen.getByLabelText("右面板"))
    expect(mockDispatch).toHaveBeenCalledWith({ type: "TOGGLE_RIGHT_PANEL" })
  })
})

describe("F3 首入许可证卡片", () => {
  it("shows PermitWelcomeCard when ecopilot-first-entry flag is set and enterprise exists", async () => {
    localStorage.setItem("ecopilot-first-entry", "1")
    const { apiGet } = await import("@/lib/api")
    ;(apiGet as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === "/api/enterprise")
        return Promise.resolve({ ok: true, data: { name: "测试钢铁公司", permit_number: "PN001", industry: "钢铁", valid_to: "2027-01-01" } })
      if (url === "/api/permit/data")
        return Promise.resolve({ ok: true, data: { ok: true, parsed: { emissionOutlets: [1, 2] }, ai: { compliance_score: 88 } } })
      return Promise.resolve({ ok: true, data: {} })
    })
    render(<ChatMain leftOpen={true} onToggleLeft={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText("已接入企业排污许可证")).toBeTruthy()
    }, { timeout: 3000 })
    expect(screen.getByText("测试钢铁公司")).toBeTruthy()
    expect(localStorage.getItem("ecopilot-first-entry")).toBeNull()
  })
})
