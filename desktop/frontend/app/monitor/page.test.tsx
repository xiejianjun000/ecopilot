"use client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import MonitorPage from "./page"

// ─── Mocks ───

vi.mock("lucide-react", () => {
  const icon = (name: string) => {
    const Cmp = (props: any) => <span data-testid={`icon-${name}`} {...props} />
    Cmp.displayName = name
    return Cmp
  }
  return {
    Activity: icon("activity"),
    Users: icon("users"),
    Building2: icon("building2"),
    AlertTriangle: icon("alert-triangle"),
    MessageSquare: icon("message-square"),
    TrendingUp: icon("trending-up"),
    Clock: icon("clock"),
    Cpu: icon("cpu"),
    HardDrive: icon("hard-drive"),
    RefreshCw: icon("refresh-cw"),
    Check: icon("check"),
    ChevronRight: icon("chevron-right"),
    Loader2: icon("loader2"),
    Zap: icon("zap"),
    ShieldAlert: icon("shield-alert"),
  }
})

vi.mock("@/lib/api", () => ({
  ensureAuthToken: vi.fn().mockResolvedValue(undefined),
  authHeaders: vi.fn().mockReturnValue({}),
  getApiBase: vi.fn().mockReturnValue("http://test-api"),
  apiGet: vi.fn(),
  apiPost: vi.fn().mockResolvedValue({ ok: true }),
}))

import { apiPost } from "@/lib/api"

// ─── Fixtures ───

const overviewResp = {
  ok: true,
  overview: {
    days: 7,
    total_events: 1000,
    by_type: { page_view: 400, chat: 300, error: 100, login: 200 },
    by_severity: { info: 600, warning: 200, error: 150, critical: 50 },
    active_users: 50,
    active_enterprises: 10,
    error_rate: 5.2,
    feedback_count: 3,
    unack_alerts: 2,
  },
  timeseries: [
    { bucket: "07/25 08:00", total: 100, errors: 5, chats: 30, logins: 20, unique_users: 10 },
    { bucket: "07/25 09:00", total: 200, errors: 10, chats: 50, logins: 30, unique_users: 15 },
  ],
}

const noAlertOverviewResp = {
  ...overviewResp,
  overview: { ...overviewResp.overview, error_rate: 3.0, unack_alerts: 0 },
}

const eventsResp = {
  ok: true,
  events: [
    { id: 1, ts: 1721812800, ts_str: "2026-07-25 08:00", type: "page_view", severity: "info", user_id: "u1", enterprise: "ent1", event_data: { url: "/" } },
    { id: 2, ts: 1721816400, ts_str: "2026-07-25 09:00", type: "error", severity: "critical", user_id: null, enterprise: null, event_data: null },
  ],
}

const feedbackResp = {
  ok: true,
  feedback: [
    { id: 1, ts: 1721812800, ts_str: "2026-07-25", user_id: "u1", enterprise: "ent1", message: "建议增加导出功能", contact: "user@test.com", status: "pending", response: null },
    { id: 2, ts: 1721816400, ts_str: "2026-07-24", user_id: "u2", enterprise: "ent2", message: "非常好用", contact: "", status: "responded", response: "感谢支持！" },
  ],
}

const alertsResp = {
  ok: true,
  alerts: [
    { id: 1, ts: 1721812800, ts_str: "2026-07-25 08:00", severity: "error", source: "system", title: "内存使用率过高", detail: "当前使用率 92%", acknowledged: 0 },
    { id: 2, ts: 1721816400, ts_str: "2026-07-25 07:00", severity: "warning", source: "network", title: "网络延迟异常", detail: null, acknowledged: 1 },
  ],
}

const enterprisesResp = {
  ok: true,
  enterprises: [
    { enterprise: "企业A", events: 500, users: 20, errors: 5, last_active: 1721812800, last_active_str: "2026-07-25" },
    { enterprise: "企业B", events: 300, users: 15, errors: 0, last_active: 1721816400, last_active_str: "2026-07-24" },
  ],
}

// ─── Fetch mock helpers ───

function mockOverviewFetch() {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(overviewResp) })
}

function mockMultiTabFetch(overrides?: Record<string, any>) {
  const routes: Record<string, any> = {
    dashboard: overviewResp,
    events: { ok: true, events: [] },
    feedback: { ok: true, feedback: [] },
    alerts: { ok: true, alerts: [] },
    enterprises: { ok: true, enterprises: [] },
    ...overrides,
  }

  globalThis.fetch = vi.fn().mockImplementation((url: RequestInfo | URL) => {
    const urlStr = String(url)
    let data: any
    if (urlStr.includes("/api/ops/dashboard")) data = routes.dashboard
    else if (urlStr.includes("/api/ops/events")) data = routes.events
    else if (urlStr.includes("/api/ops/feedback")) data = routes.feedback
    else if (urlStr.includes("/api/ops/alerts")) data = routes.alerts
    else if (urlStr.includes("/api/ops/enterprises")) data = routes.enterprises
    else data = { ok: false }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(data) })
  })
}

function mockNeverSettle() {
  globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}))
}

function mockReject(errorMsg: string) {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error(errorMsg))
}

function mockHttpError(status: number) {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status, json: () => Promise.resolve({}) })
}

// ─── Tests ───

describe("MonitorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Basic render ──

  it("renders title and subtitle", () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    expect(screen.getByText("EcoPilot 运维监控")).toBeInTheDocument()
    expect(screen.getByText("生态环境合规AI管家 · 实时数据看板")).toBeInTheDocument()
  })

  it("renders all 5 tab buttons and controls", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => {
      expect(screen.getByText("总览")).toBeInTheDocument()
    })
    expect(screen.getByText("事件流")).toBeInTheDocument()
    expect(screen.getByText("用户反馈")).toBeInTheDocument()
    expect(screen.getByText("告警")).toBeInTheDocument()
    expect(screen.getByText("企业")).toBeInTheDocument()
    expect(screen.getByText("24h")).toBeInTheDocument()
    expect(screen.getByText("7天")).toBeInTheDocument()
    expect(screen.getByText("30天")).toBeInTheDocument()
    expect(screen.getByLabelText("刷新数据")).toBeInTheDocument()
  })

  // ── Loading / Error ──

  it("shows loading spinner while fetching overview", () => {
    mockNeverSettle()
    render(<MonitorPage />)
    expect(screen.getByTestId("icon-loader2")).toBeInTheDocument()
  })

  it("hides loading spinner after data loads", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => {
      expect(screen.queryByTestId("icon-loader2")).not.toBeInTheDocument()
    })
  })

  it("shows error banner on HTTP error", async () => {
    mockHttpError(500)
    render(<MonitorPage />)
    await waitFor(() => {
      expect(screen.getByText(/加载失败/)).toBeInTheDocument()
      expect(screen.getByText(/HTTP 500/)).toBeInTheDocument()
    })
    expect(screen.getByText("重试")).toBeInTheDocument()
  })

  it("shows error banner on network failure", async () => {
    mockReject("连接失败")
    render(<MonitorPage />)
    await waitFor(() => {
      expect(screen.getByText(/连接失败/)).toBeInTheDocument()
    })
  })

  it("retry button fetches data after clearing error", async () => {
    globalThis.fetch = vi.fn()
      .mockRejectedValueOnce(new Error("首次失败"))
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(overviewResp) })

    render(<MonitorPage />)
    await waitFor(() => {
      expect(screen.getByText(/首次失败/)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText("重试"))
    await waitFor(() => {
      expect(screen.getByText("1000")).toBeInTheDocument()
    })
    expect(screen.queryByText(/首次失败/)).not.toBeInTheDocument()
  })

  // ── Overview tab ──

  it("displays 4 KPI cards with correct values", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => {
      expect(screen.getByText("总事件数")).toBeInTheDocument()
    })
    expect(screen.getByText("1000")).toBeInTheDocument()
    // "50" appears as both KPI value (active_users) and severity count (critical=50)
    const fifties = screen.getAllByText("50")
    expect(fifties.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("10")).toBeInTheDocument()
    expect(screen.getByText("5.2%")).toBeInTheDocument()
    expect(screen.getByText("近 7 天")).toBeInTheDocument()
    expect(screen.getAllByText("去重").length).toBe(2)
  })

  it("applies destructive color to error rate KPI when > 5", async () => {
    mockOverviewFetch() // error_rate = 5.2
    render(<MonitorPage />)
    await waitFor(() => {
      const el = screen.getByText("5.2%")
      expect(el.className).toContain("text-destructive")
    })
  })

  it("applies success color to error rate KPI when <= 5", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(noAlertOverviewResp), // error_rate = 3.0
    })
    render(<MonitorPage />)
    await waitFor(() => {
      const el = screen.getByText("3%")
      expect(el.className).toContain("text-success")
    })
  })

  it("shows unacknowledged alert banner", async () => {
    mockOverviewFetch() // unack_alerts = 2
    render(<MonitorPage />)
    await waitFor(() => {
      expect(screen.getByText(/2 条未处理告警/)).toBeInTheDocument()
    })
  })

  it("does not show alert banner when unack_alerts is 0", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(noAlertOverviewResp),
    })
    render(<MonitorPage />)
    await waitFor(() => {
      expect(screen.getByText("总事件数")).toBeInTheDocument()
    })
    expect(screen.queryByText(/未处理告警/)).not.toBeInTheDocument()
  })

  it("'查看' link switches to alerts tab", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => {
      expect(screen.getByText(/2 条未处理告警/)).toBeInTheDocument()
    })

    mockMultiTabFetch({ alerts: alertsResp, dashboard: overviewResp })
    fireEvent.click(screen.getByText("查看 →"))
    await waitFor(() => {
      expect(screen.getByText("内存使用率过高")).toBeInTheDocument()
    })
  })

  it("renders time series chart with bucket labels and counts", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => {
      expect(screen.getByText("事件趋势")).toBeInTheDocument()
    })
    expect(screen.getByText("07/25 08:00")).toBeInTheDocument()
    expect(screen.getByText("07/25 09:00")).toBeInTheDocument()
    // "100" and "200" appear in both time series counts and type distribution counts
    const hundredMatches = screen.getAllByText("100")
    expect(hundredMatches.length).toBeGreaterThanOrEqual(1)
    const twoHundreds = screen.getAllByText("200")
    expect(twoHundreds.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("总事件")).toBeInTheDocument()
    // "错误" appears in legend, type distribution, and severity label
    const errors = screen.getAllByText("错误")
    expect(errors.length).toBeGreaterThanOrEqual(1)
  })

  it("shows empty time series placeholder when empty", async () => {
    const noTs = { ...overviewResp, timeseries: [] }
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(noTs) })
    render(<MonitorPage />)
    await waitFor(() => {
      expect(screen.getByText("暂无数据")).toBeInTheDocument()
    })
  })

  it("renders event type distribution", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => {
      expect(screen.getByText("事件类型分布")).toBeInTheDocument()
    })
    expect(screen.getByText("页面访问")).toBeInTheDocument()
    expect(screen.getByText("对话")).toBeInTheDocument()
    expect(screen.getByText("登录")).toBeInTheDocument()
  })

  it("renders severity distribution cards", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => {
      expect(screen.getByText("严重度分布")).toBeInTheDocument()
    })
    expect(screen.getByText("600")).toBeInTheDocument() // info
    // "200" also appears in time series and type distribution counts
    const twoHundreds = screen.getAllByText("200")
    expect(twoHundreds.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("150")).toBeInTheDocument() // error
    const fifties = screen.getAllByText("50")
    expect(fifties.length).toBeGreaterThanOrEqual(1) // critical
  })

  it("shows empty type distribution when by_type is empty", async () => {
    const emptyTypes = {
      ...overviewResp,
      overview: { ...overviewResp.overview, by_type: {} },
    }
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(emptyTypes) })
    render(<MonitorPage />)
    await waitFor(() => {
      expect(screen.getAllByText("暂无数据").length).toBeGreaterThanOrEqual(1)
    })
  })

  // ── Events tab ──

  it("renders events table after switching to events tab", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => expect(screen.getByText("总览")).toBeInTheDocument())

    mockMultiTabFetch({ events: eventsResp })
    fireEvent.click(screen.getByText("事件流"))
    await waitFor(() => {
      expect(screen.getByText(/最近事件/)).toBeInTheDocument()
    })
    expect(screen.getByText("u1")).toBeInTheDocument()
    expect(screen.getByText("ent1")).toBeInTheDocument()
    expect(screen.getByText("严重")).toBeInTheDocument()
  })

  it("shows empty state for events tab", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => expect(screen.getByText("总览")).toBeInTheDocument())

    mockMultiTabFetch({ events: { ok: true, events: [] } })
    fireEvent.click(screen.getByText("事件流"))
    await waitFor(() => {
      expect(screen.getByText("暂无事件")).toBeInTheDocument()
    })
  })

  // ── Feedback tab ──

  it("renders feedback cards with pending and responded status", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => expect(screen.getByText("总览")).toBeInTheDocument())

    mockMultiTabFetch({ feedback: feedbackResp })
    fireEvent.click(screen.getByText("用户反馈"))
    await waitFor(() => {
      expect(screen.getByText("user@test.com")).toBeInTheDocument()
    })
    expect(screen.getByText("建议增加导出功能")).toBeInTheDocument()
    expect(screen.getByText("非常好用")).toBeInTheDocument()
    expect(screen.getByText("待回复")).toBeInTheDocument()
    expect(screen.getByText("已回复")).toBeInTheDocument()
    expect(screen.getByText("感谢支持！")).toBeInTheDocument()
  })

  it("shows empty state for feedback tab", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => expect(screen.getByText("总览")).toBeInTheDocument())

    mockMultiTabFetch({ feedback: { ok: true, feedback: [] } })
    fireEvent.click(screen.getByText("用户反馈"))
    await waitFor(() => {
      expect(screen.getByText("暂无反馈")).toBeInTheDocument()
    })
  })

  it("feedback reply: show form, type, send, and cancel", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => expect(screen.getByText("总览")).toBeInTheDocument())

    mockMultiTabFetch({ feedback: feedbackResp })
    fireEvent.click(screen.getByText("用户反馈"))
    await waitFor(() => {
      expect(screen.getByText("建议增加导出功能")).toBeInTheDocument()
    })

    // Only the pending feedback has "回复" button
    const replyBtns = screen.getAllByText("回复")
    expect(replyBtns.length).toBe(1)
    fireEvent.click(replyBtns[0])

    const textarea = screen.getByPlaceholderText("输入回复内容...")
    expect(textarea).toBeInTheDocument()

    // Send disabled when empty
    const sendBtn = screen.getByText("发送回复")
    expect(sendBtn).toBeDisabled()

    // Type response
    fireEvent.change(textarea, { target: { value: "已收到建议" } })
    expect(sendBtn).not.toBeDisabled()

    // Cancel resets
    fireEvent.click(screen.getByText("取消"))
    expect(screen.queryByPlaceholderText("输入回复内容...")).not.toBeInTheDocument()
  })

  it("feedback send calls apiPost and hides form", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => expect(screen.getByText("总览")).toBeInTheDocument())

    mockMultiTabFetch({ feedback: feedbackResp })
    fireEvent.click(screen.getByText("用户反馈"))
    await waitFor(() => {
      expect(screen.getByText("建议增加导出功能")).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByText("回复")[0])
    const textarea = screen.getByPlaceholderText("输入回复内容...")
    fireEvent.change(textarea, { target: { value: "正在处理" } })
    fireEvent.click(screen.getByText("发送回复"))

    await waitFor(() => {
      expect(vi.mocked(apiPost)).toHaveBeenCalledWith("/api/ops/feedback/respond", {
        id: 1,
        response: "正在处理",
      })
    })
  })

  it("responded feedback shows no reply button", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => expect(screen.getByText("总览")).toBeInTheDocument())

    mockMultiTabFetch({ feedback: feedbackResp })
    fireEvent.click(screen.getByText("用户反馈"))
    await waitFor(() => {
      expect(screen.getByText("已回复")).toBeInTheDocument()
    })
    // Only 1 "回复" (for pending), not for responded
    expect(screen.getAllByText("回复").length).toBe(1)
  })

  // ── Alerts tab ──

  it("renders alert cards with acknowledge state", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => expect(screen.getByText("总览")).toBeInTheDocument())

    mockMultiTabFetch({ alerts: alertsResp })
    fireEvent.click(screen.getByText("告警"))
    await waitFor(() => {
      expect(screen.getByText("内存使用率过高")).toBeInTheDocument()
    })
    expect(screen.getByText("网络延迟异常")).toBeInTheDocument()
    expect(screen.getByText("标记已处理")).toBeInTheDocument() // unacknowledged
    expect(screen.getByText("已处理")).toBeInTheDocument() // acknowledged badge
    expect(screen.getByText(/当前使用率 92%/)).toBeInTheDocument() // detail
  })

  it("acknowledge button calls apiPost and disappears", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => expect(screen.getByText("总览")).toBeInTheDocument())

    mockMultiTabFetch({ alerts: alertsResp })
    fireEvent.click(screen.getByText("告警"))
    await waitFor(() => {
      expect(screen.getByText("标记已处理")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText("标记已处理"))
    await waitFor(() => {
      expect(screen.queryByText("标记已处理")).not.toBeInTheDocument()
    })
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith("/api/ops/alerts/ack", { id: 1 })
  })

  it("shows empty state for alerts tab", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => expect(screen.getByText("总览")).toBeInTheDocument())

    mockMultiTabFetch({ alerts: { ok: true, alerts: [] } })
    fireEvent.click(screen.getByText("告警"))
    await waitFor(() => {
      expect(screen.getByText("暂无告警")).toBeInTheDocument()
    })
  })

  // ── Enterprises tab ──

  it("renders enterprises table", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => expect(screen.getByText("总览")).toBeInTheDocument())

    mockMultiTabFetch({ enterprises: enterprisesResp })
    fireEvent.click(screen.getByText("企业"))
    await waitFor(() => {
      expect(screen.getByText("企业A")).toBeInTheDocument()
    })
    expect(screen.getByText("企业B")).toBeInTheDocument()
    expect(screen.getByText("500")).toBeInTheDocument()
    expect(screen.getByText("300")).toBeInTheDocument()
  })

  it("shows empty state for enterprises tab", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => expect(screen.getByText("总览")).toBeInTheDocument())

    mockMultiTabFetch({ enterprises: { ok: true, enterprises: [] } })
    fireEvent.click(screen.getByText("企业"))
    await waitFor(() => {
      expect(screen.getByText("暂无数据")).toBeInTheDocument()
    })
  })

  // ── Days selector ──

  it("default days=7 button has active styling", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    const btn7 = screen.getByText("7天")
    expect(btn7.className).toContain("bg-eco-600")
    expect(btn7.className).toContain("text-white")
  })

  it("changing days re-fetches with new parameter", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => expect(screen.getByText("总事件数")).toBeInTheDocument())

    mockOverviewFetch() // reset for next call
    fireEvent.click(screen.getByText("30天"))
    await waitFor(() => {
      const btn30 = screen.getByText("30天")
      expect(btn30.className).toContain("bg-eco-600")
    })
    const calls = vi.mocked(globalThis.fetch).mock.calls
    const lastCall = calls[calls.length - 1]
    expect(String(lastCall[0])).toContain("days=30")
  })

  // ── Refresh button ──

  it("refresh button triggers re-fetch", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => expect(screen.getByText("总事件数")).toBeInTheDocument())

    const fetch = vi.mocked(globalThis.fetch)
    const callCount = fetch.mock.calls.length
    fireEvent.click(screen.getByLabelText("刷新数据"))
    await waitFor(() => {
      expect(fetch.mock.calls.length).toBeGreaterThan(callCount)
    })
  })

  it("refresh button is disabled while loading", () => {
    mockNeverSettle()
    render(<MonitorPage />)
    const btn = screen.getByLabelText("刷新数据")
    expect(btn).toBeDisabled()
  })

  // ── Badge counts in tab bar ──

  it("shows feedback and alert badges in tab bar", async () => {
    mockOverviewFetch() // feedback_count=3, unack_alerts=2
    render(<MonitorPage />)
    await waitFor(() => {
      expect(screen.getByText("3")).toBeInTheDocument()
      expect(screen.getByText("2")).toBeInTheDocument()
    })
  })

  // ── Auto-refresh interval ──

  it("sets up 30-second auto-refresh interval", () => {
    const spy = vi.spyOn(globalThis, "setInterval")
    mockOverviewFetch()
    render(<MonitorPage />)
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 30000)
    spy.mockRestore()
  })

  it("clears interval on unmount", () => {
    const setSpy = vi.spyOn(globalThis, "setInterval")
    const clearSpy = vi.spyOn(globalThis, "clearInterval")
    mockOverviewFetch()
    const { unmount } = render(<MonitorPage />)
    expect(setSpy).toHaveBeenCalled()
    unmount()
    expect(clearSpy).toHaveBeenCalled()
    setSpy.mockRestore()
    clearSpy.mockRestore()
  })

  // ── Tab switching fetches correct endpoint ──

  it("loads overview endpoint on mount", async () => {
    mockOverviewFetch()
    render(<MonitorPage />)
    await waitFor(() => expect(screen.getByText("总事件数")).toBeInTheDocument())
    const firstCall = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(String(firstCall[0])).toContain("/api/ops/dashboard?days=7")
  })
})
