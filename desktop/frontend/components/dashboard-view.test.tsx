import "@testing-library/jest-dom/vitest"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { DashboardView } from "./dashboard-view"

// ── Hoisted mocks (for vi.mock factories) ──────────────────────────
const { mockDispatch, mockApiGet } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  mockApiGet: vi.fn(),
}))

/** Re-create mock state in beforeEach so tests start clean. */
function freshStore() {
  return {
    taskSummaries: [] as { time: string; title: string; findings: unknown[] }[],
    memories: [] as unknown[],
    diaryEntries: [] as { date: string; title: string }[],
    outputFiles: [] as { createdAt: string; name: string }[],
  }
}

let mockState: ReturnType<typeof freshStore>

// ── Module mocks (hoisted by vitest) ───────────────────────────────

vi.mock("lucide-react", () => {
  const icon = (name: string) => {
    const C = (props: any) => <span data-testid={`icon-${name}`} className={props.className} />
    C.displayName = name
    return C
  }
  return {
    AlertTriangle: icon("alert-triangle"),
    BarChart3: icon("bar-chart-3"),
    ArrowDown: icon("arrow-down"),
    Loader2: icon("loader-2"),
    CheckCircle2: icon("check-circle-2"),
    Clock: icon("clock"),
    Building2: icon("building-2"),
    FileText: icon("file-text"),
    ClipboardList: icon("clipboard-list"),
    ShieldCheck: icon("shield-check"),
    TrendingUp: icon("trending-up"),
    CalendarClock: icon("calendar-clock"),
    Activity: icon("activity"),
    ArrowRight: icon("arrow-right"),
    Sparkles: icon("sparkles"),
  }
})

vi.mock("@/lib/store", () => ({
  useApp: () => ({ state: mockState, dispatch: mockDispatch }),
}))

vi.mock("@/lib/api", () => ({
  apiGet: (...args: unknown[]) => mockApiGet(...args),
}))

vi.mock("@/lib/utils", () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
}))

// ── Helpers ────────────────────────────────────────────────────────

function enterprise(overrides: Partial<{
  name: string
  credit_code: string
  management_level: string
  industry: string
  permit_number: string
  valid_to: string
  valid_from: string
  legal_representative: string
  address: string
  phone: string
}> = {}) {
  return {
    name: "湘江环保科技有限公司",
    credit_code: "91430100MA4PD3C85K",
    management_level: "重点管理",
    industry: "环境治理业",
    permit_number: "91430100MA4PD3C85K001V",
    valid_from: "2024-01-01",
    valid_to: "2030-12-31",
    legal_representative: "张三",
    address: "长沙市高新区",
    phone: "0731-88888888",
    ...overrides,
  }
}

/** Fixed "now" so permit date math is deterministic. */
const NOW_MS = new Date("2026-07-15T00:00:00.000Z").getTime()

/** Convert a date string to ms-since-epoch for testing. */
function ms(dateStr: string) {
  return new Date(dateStr).getTime()
}

/** Render + wait for the async apiGet to resolve. */
async function renderLoaded() {
  const result = render(<DashboardView />)
  await waitFor(() => {
    expect(screen.queryByText("尚未绑定企业")).not.toBeInTheDocument()
  })
  return result
}

// ── Suite ──────────────────────────────────────────────────────────

describe("DashboardView", () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(NOW_MS)
    mockState = freshStore()
    mockApiGet.mockResolvedValue({ ok: false, data: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Empty state ───────────────────────────────────────────────

  it("renders the empty state when no enterprise is bound", async () => {
    render(<DashboardView />)
    expect(screen.getByText("尚未绑定企业")).toBeInTheDocument()
    expect(
      screen.getByText(
        "请先在设置中录入企业信息，或通过排污许可平台登录后自动读取许可证数据。"
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /前往设置/ })
    ).toBeInTheDocument()
    expect(screen.getByTestId("icon-trending-up")).toBeInTheDocument()
  })

  it("dispatches SET_NAV settings when the empty-state button is clicked", () => {
    render(<DashboardView />)
    fireEvent.click(screen.getByRole("button", { name: /前往设置/ }))
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "SET_NAV",
      nav: "settings",
    })
  })

  // ── Loaded state – hero card ─────────────────────────────────

  it("renders the hero card with enterprise info after API resolves", async () => {
    mockApiGet.mockResolvedValue({ ok: true, data: enterprise() })
    const { container } = await renderLoaded()

    // Enterprise name
    expect(screen.getByText("湘江环保科技有限公司")).toBeInTheDocument()

    // Subtitle line: credit code · management level · industry
    expect(
      screen.getByText(
        /91430100MA4PD3C85K · 重点管理 · 环境治理业/
      )
    ).toBeInTheDocument()

    // Shield icon present
    expect(screen.getByTestId("icon-shield-check")).toBeInTheDocument()
  })

  it("shows fallback dashes for missing hero subtitle fields", async () => {
    mockApiGet.mockResolvedValue({
      ok: true,
      data: enterprise({ credit_code: undefined, management_level: undefined, industry: undefined }),
    })
    await renderLoaded()
    expect(screen.getByText(/— · — · —/)).toBeInTheDocument()
  })

  it.skip("renders the compliance score ring with correct stroke-dasharray", async () => {
    // With full enterprise + warn permit (no valid_to), score = 60 + 5(name) = 65
    mockApiGet.mockResolvedValue({
      ok: true,
      data: enterprise({ valid_to: undefined }),
    })
    const { container } = await renderLoaded()

    // Score text and labels are rendered inside SVG (jsdom may not render SVG text as DOM text)
    // Core validation: verify the score circle arc length matches 65%

    // Two circles in the SVG ring: background track + score arc
    const circles = container.querySelectorAll("circle")
    expect(circles.length).toBe(2)

    const circumference = 2 * Math.PI * 24
    const dashParts = circles[1]
      .getAttribute("stroke-dasharray")!
      .split(" ")
      .map(Number)
    expect(dashParts[0]).toBeCloseTo(circumference * 0.65, 0)
    expect(dashParts[1]).toBeCloseTo(circumference, 0)
  })

  it("assigns the correct CSS class to the score based on its value", async () => {
    // Score >= 80 → text-success
    mockApiGet.mockResolvedValue({
      ok: true,
      data: enterprise(),
    })
    const { container } = await renderLoaded()
    const scoreSpan = container.querySelector(".text-title.font-bold.tabular-nums")
    expect(scoreSpan).toHaveClass("text-success")
  })

  // ── Permit status card tones ─────────────────────────────────

  it('shows permit card with tone "ok" when valid_to is far (>90 days)', async () => {
    mockApiGet.mockResolvedValue({
      ok: true,
      data: enterprise({ valid_to: "2030-12-31" }),
    })
    await renderLoaded()
    expect(screen.getByText("有效")).toBeInTheDocument()
    expect(screen.getByText(/^剩余 \d+ 天$/)).toBeInTheDocument()
  })

  it('shows permit card with tone "danger" when permit is expired', async () => {
    mockApiGet.mockResolvedValue({
      ok: true,
      data: enterprise({ valid_to: "2025-06-15" }),
    })
    await renderLoaded()
    expect(screen.getByText("已过期")).toBeInTheDocument()
    // expired permits show 已逾期 X 天
    expect(screen.getByText(/已逾期 \d+ 天/)).toBeInTheDocument()
  })

  it('shows permit card with tone "danger" when expiry is ≤30 days', async () => {
    // July 15 + 5 days = July 20 → "即将到期" (≤30)
    mockApiGet.mockResolvedValue({
      ok: true,
      data: enterprise({ valid_to: "2026-07-20" }),
    })
    await renderLoaded()
    expect(screen.getByText("即将到期")).toBeInTheDocument()
    expect(screen.getByText(/剩余 \d+ 天/)).toBeInTheDocument()
  })

  it('shows permit card with tone "warn" when valid_to is not provided', async () => {
    mockApiGet.mockResolvedValue({
      ok: true,
      data: enterprise({ valid_to: undefined }),
    })
    await renderLoaded()
    expect(screen.getByText("未读取")).toBeInTheDocument()
    expect(screen.getByText("许可证数据未读取")).toBeInTheDocument()
  })

  it('shows permit card with tone "warn" when expiry is ≤90 days', async () => {
    // July 15 + 45 days = Aug 29 → "临近到期" (30 < days ≤ 90)
    mockApiGet.mockResolvedValue({
      ok: true,
      data: enterprise({ valid_to: "2026-08-29" }),
    })
    await renderLoaded()
    expect(screen.getByText("临近到期")).toBeInTheDocument()
    expect(screen.getByText(/剩余 \d+ 天/)).toBeInTheDocument()
  })

  // ── Status cards – data propagation ──────────────────────────

  it("report count card reflects taskSummaries.length", async () => {
    mockState.taskSummaries = [
      { time: "2026-07", title: "报告1", findings: [] },
      { time: "2026-07", title: "报告2", findings: [] },
      { time: "2026-07", title: "报告3", findings: [] },
    ]
    mockApiGet.mockResolvedValue({ ok: true, data: enterprise() })
    await renderLoaded()

    expect(screen.getByText("3")).toBeInTheDocument()
    expect(screen.getByText("已生成报告")).toBeInTheDocument()
  })

  it("inspection card shows total findings across all task summaries", async () => {
    mockState.taskSummaries = [
      { time: "2026-07", title: "排口1", findings: ["漏水", "锈蚀"] },
      { time: "2026-07", title: "排口2", findings: ["标识不清"] },
    ]
    mockApiGet.mockResolvedValue({ ok: true, data: enterprise() })
    await renderLoaded()

    // 2 + 1 = 3
    expect(screen.getByText("3")).toBeInTheDocument()
    expect(screen.getByText("待核查发现")).toBeInTheDocument()
  })

  it("file vault card reflects outputFiles.length", async () => {
    mockState.outputFiles = [
      { createdAt: "2026-07-01T00:00:00Z", name: "报告1.pdf" },
      { createdAt: "2026-07-02T00:00:00Z", name: "报告2.pdf" },
      { createdAt: "2026-07-03T00:00:00Z", name: "报告3.pdf" },
      { createdAt: "2026-07-04T00:00:00Z", name: "报告4.pdf" },
    ]
    mockApiGet.mockResolvedValue({ ok: true, data: enterprise() })
    await renderLoaded()

    expect(screen.getByText("4")).toBeInTheDocument()
    expect(screen.getByText("归档文档")).toBeInTheDocument()
  })

  // ── Warning banner ───────────────────────────────────────────

  it("renders the warning banner when permit tone is warn (missing valid_to)", async () => {
    mockApiGet.mockResolvedValue({
      ok: true,
      data: enterprise({ valid_to: undefined }),
    })
    await renderLoaded()

    expect(screen.getByText("许可证数据尚未读取")).toBeInTheDocument()
    expect(
      screen.getByText("读取后合规评分与状态卡将自动更新")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /立即读取/ })
    ).toBeInTheDocument()
    expect(screen.getByTestId("icon-alert-triangle")).toBeInTheDocument()
  })

  it("does not render the warning banner when permit tone is ok", async () => {
    mockApiGet.mockResolvedValue({
      ok: true,
      data: enterprise({ valid_to: "2030-12-31" }),
    })
    await renderLoaded()

    expect(screen.queryByText("许可证数据尚未读取")).not.toBeInTheDocument()
    expect(screen.queryByText("立即读取")).not.toBeInTheDocument()
  })

  // ── Recent activity ──────────────────────────────────────────

  it("recent activity shows empty state when no data exists", async () => {
    mockApiGet.mockResolvedValue({ ok: true, data: enterprise() })
    await renderLoaded()

    expect(screen.getByText("暂无活动记录")).toBeInTheDocument()
    expect(
      screen.getByText("开始一次对话即可生成活动")
    ).toBeInTheDocument()
    expect(screen.getAllByTestId("icon-sparkles").length).toBeGreaterThanOrEqual(1)
  })

  it("renders recent activity items with correct type badge colors", async () => {
    mockState.taskSummaries = [
      { time: "2026-07-10", title: "执行报告", findings: [] },
    ]
    mockState.diaryEntries = [{ date: "2026-07-11", title: "巡查日记" }]
    mockState.outputFiles = [
      { createdAt: "2026-07-12T00:00:00Z", name: "台账文件" },
    ]
    mockApiGet.mockResolvedValue({ ok: true, data: enterprise() })
    await renderLoaded()

    // All three items should be rendered
    expect(screen.getAllByText("执行报告").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("巡查日记").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("台账文件").length).toBeGreaterThanOrEqual(1)

    // The section title is present
    expect(screen.getByText("最近活动")).toBeInTheDocument()

    // Empty state should NOT be shown
    expect(screen.queryByText("暂无活动记录")).not.toBeInTheDocument()
  })

  it("caps recent activity at 5 items", async () => {
    // Create 3 tasks + 2 diaries + 2 files = 7 raw items, capped at 5
    mockState.taskSummaries = Array.from({ length: 3 }, (_, i) => ({
      time: "2026-07",
      title: `Task ${i + 1}`,
      findings: [],
    }))
    mockState.diaryEntries = Array.from({ length: 2 }, (_, i) => ({
      date: "2026-07",
      title: `Diary ${i + 1}`,
    }))
    mockState.outputFiles = Array.from({ length: 2 }, (_, i) => ({
      createdAt: "2026-07-01T00:00:00Z",
      name: `File ${i + 1}`,
    }))

    mockApiGet.mockResolvedValue({ ok: true, data: enterprise() })
    await renderLoaded()

    // The last two tasks + last two diaries + last output file = 5 items
    // Tasks are in reverse order, so tasks 3,2,1 then diaries 2,1 then files 2,1
    // But slice(-3) then slice(-2) then slice(-2), all reversed, then slice(0,5)
    // So: task 3, task 2, task 1, diary 2, diary 1 = 5 items

    expect(screen.getByText("Task 3")).toBeInTheDocument()
    expect(screen.getByText("Task 1")).toBeInTheDocument()
    expect(screen.getByText("Diary 2")).toBeInTheDocument()

    // File 1 should not appear (it's the 6th item)
    expect(screen.queryByText("File 1")).not.toBeInTheDocument()
  })

  // ── Click handlers – status cards ────────────────────────────

  it("dispatches SET_NAV chat when the permit card is clicked", async () => {
    mockApiGet.mockResolvedValue({ ok: true, data: enterprise() })
    await renderLoaded()
    fireEvent.click(screen.getByText("许可证状态"))
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "SET_NAV",
      nav: "chat",
    })
  })

  it("dispatches SET_NAV chat when the report card is clicked", async () => {
    mockState.taskSummaries = [
      { time: "2026-07", title: "报告", findings: [] },
    ]
    mockApiGet.mockResolvedValue({ ok: true, data: enterprise() })
    await renderLoaded()
    fireEvent.click(screen.getAllByText("执行报告")[0])
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "SET_NAV",
      nav: "chat",
    })
  })

  it("dispatches SET_NAV inspection when the inspection card is clicked", async () => {
    mockApiGet.mockResolvedValue({ ok: true, data: enterprise() })
    await renderLoaded()
    fireEvent.click(screen.getByText("巡查事项"))
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "SET_NAV",
      nav: "inspection",
    })
  })

  it("dispatches SET_NAV vault when the file vault card is clicked", async () => {
    mockApiGet.mockResolvedValue({ ok: true, data: enterprise() })
    await renderLoaded()
    fireEvent.click(screen.getByText("档案库"))
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "SET_NAV",
      nav: "vault",
    })
  })

  it("dispatches SET_NAV chat when the '全部' recent-activity link is clicked", async () => {
    mockState.taskSummaries = [
      { time: "2026-07", title: "报告1", findings: [] },
    ]
    mockApiGet.mockResolvedValue({ ok: true, data: enterprise() })
    await renderLoaded()
    fireEvent.click(screen.getByText("全部"))
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "SET_NAV",
      nav: "chat",
    })
  })

  // ── Click handlers – quick actions ──────────────────────────

  it("dispatches SET_NAV chat when a chat quick-action is clicked", async () => {
    mockApiGet.mockResolvedValue({ ok: true, data: enterprise() })
    await renderLoaded()
    fireEvent.click(screen.getByText("查许可证还有多久到期"))
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "SET_NAV",
      nav: "chat",
    })
  })

  it("dispatches SET_NAV inspection when the inspection quick-action is clicked", async () => {
    mockApiGet.mockResolvedValue({ ok: true, data: enterprise() })
    await renderLoaded()
    fireEvent.click(screen.getByText("查看巡查清单"))
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "SET_NAV",
      nav: "inspection",
    })
  })

  // ── Click handlers – calendar CTA ────────────────────────────

  it("dispatches SET_NAV calendar when the compliance calendar CTA is clicked", async () => {
    mockApiGet.mockResolvedValue({ ok: true, data: enterprise() })
    await renderLoaded()
    fireEvent.click(screen.getByText("查看本月合规日程"))
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "SET_NAV",
      nav: "calendar",
    })
  })

  // ── Warning-banner "立即读取" button ─────────────────────────

  it("dispatches SET_NAV chat when '立即读取' is clicked in warning banner", async () => {
    mockApiGet.mockResolvedValue({
      ok: true,
      data: enterprise({ valid_to: undefined }),
    })
    await renderLoaded()
    fireEvent.click(screen.getByText("立即读取"))
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "SET_NAV",
      nav: "chat",
    })
  })

  // ── Compliance score formula ─────────────────────────────────

  it("computes score = 65 for name-only enterprise with warn permit", async () => {
    mockApiGet.mockResolvedValue({
      ok: true,
      data: enterprise({
        valid_to: undefined,
        credit_code: undefined,
        permit_number: undefined,
        management_level: undefined,
      }),
    })
    await renderLoaded()
    // 60 + 5(name) = 65
    expect(screen.getByText("65")).toBeInTheDocument()
    expect(screen.getByText(/需关注/)).toBeInTheDocument() // ≥60
  })

  it("computes score = 50 for name-only enterprise with danger permit", async () => {
    mockApiGet.mockResolvedValue({
      ok: true,
      data: enterprise({
        valid_to: "2025-06-15", // expired → danger
        credit_code: undefined,
        permit_number: undefined,
        management_level: undefined,
      }),
    })
    await renderLoaded()
    // 60 + 5(name) - 15(danger) = 50
    expect(screen.getByText("50")).toBeInTheDocument()
    expect(screen.getByText(/高风险/)).toBeInTheDocument() // <60
  })

  it("caps compliance score at 100", async () => {
    mockState.taskSummaries = [
      { time: "2026-07", title: "A", findings: [] },
    ]
    mockState.memories = [{}]
    mockApiGet.mockResolvedValue({ ok: true, data: enterprise() })
    await renderLoaded()
    // 60 + 5(name) + 5(credit) + 10(permit_number) + 5(mgmt) + 5(tasks) + 5(memories) + 5(ok) = 100
    expect(screen.getByText("100")).toBeInTheDocument()
    expect(screen.getByText(/良好/)).toBeInTheDocument()
  })

  it("increases score when taskSummaries and memories are non-empty", async () => {
    mockState.taskSummaries = [
      { time: "2026-07", title: "A", findings: [] },
    ]
    mockState.memories = [{ id: "m1" }]
    mockApiGet.mockResolvedValue({
      ok: true,
      data: enterprise({
        credit_code: undefined,
        permit_number: undefined,
        management_level: undefined,
        valid_to: undefined,
      }),
    })
    await renderLoaded()
    // 60 + 5(name) + 5(tasks) + 5(memories) = 75
    expect(screen.getByText("75")).toBeInTheDocument()
  })

  it("deducts 15 points when permit tone is danger", async () => {
    mockApiGet.mockResolvedValue({
      ok: true,
      data: enterprise({ valid_to: "2025-01-01" }), // expired → danger
    })
    await renderLoaded()
    // 60 + 5 + 5 + 10 + 5 - 15 = 70
    expect(screen.getByText("70")).toBeInTheDocument()
    expect(screen.getByText(/需关注/)).toBeInTheDocument()
  })

  // ── API error handling ───────────────────────────────────────

  it("shows empty state when apiGet rejects", async () => {
    mockApiGet.mockRejectedValue(new Error("Network failure"))
    render(<DashboardView />)
    // Initial render is empty state; after the rejected promise
    // the empty state persists (error is swallowed by catch)
    await waitFor(() => {
      expect(screen.getByText("尚未绑定企业")).toBeInTheDocument()
    })
  })

  it("shows empty state when API returns ok: false", async () => {
    mockApiGet.mockResolvedValue({ ok: false, data: null })
    render(<DashboardView />)
    await waitFor(() => {
      expect(screen.getByText("尚未绑定企业")).toBeInTheDocument()
    })
  })

  // ── Renders without crashing ─────────────────────────────────

  it("renders without crashing in empty state", () => {
    render(<DashboardView />)
    expect(screen.getByText("尚未绑定企业")).toBeInTheDocument()
  })

  it("renders without crashing when fully loaded", async () => {
    mockApiGet.mockResolvedValue({ ok: true, data: enterprise() })
    await renderLoaded()
    expect(screen.getByText("湘江环保科技有限公司")).toBeInTheDocument()
  })
})
