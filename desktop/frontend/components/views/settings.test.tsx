import "@testing-library/jest-dom/vitest"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { SettingsView } from "./settings"

// ── Mock helpers (hoisted so vi.mock sees them) ─────────────────

const { mockApiGet, mockApiPost, mockCheckHealth } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPost: vi.fn(),
  mockCheckHealth: vi.fn(),
}))

// ── Module mocks ───────────────────────────────────────────────

vi.mock("lucide-react", () => {
  const icon = (name: string) => {
    const C = (props: any) => <span data-testid={`icon-${name}`} className={props.className} />
    C.displayName = name
    return C
  }
  return {
    ShieldCheck: icon("shield-check"),
    CheckCircle2: icon("check-circle-2"),
    XCircle: icon("x-circle"),
    Pencil: icon("pencil"),
    Save: icon("save"),
    Loader2: icon("loader-2"),
  }
})

vi.mock("@/lib/api", () => ({
  apiGet: (...args: unknown[]) => mockApiGet(...args),
  apiPost: (...args: unknown[]) => mockApiPost(...args),
  checkHealth: (...args: unknown[]) => mockCheckHealth(...args),
}))

vi.mock("@/lib/utils", () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
}))

// ── Helpers ─────────────────────────────────────────────────────

function userForm(overrides: Partial<{ name: string; role: string; phone: string }> = {}) {
  return { name: "张三", role: "环保专员", phone: "13800138000", ...overrides }
}

function enterpriseForm(overrides: Partial<{
  name: string; credit_code: string; permit_number: string
  management_level: string; industry: string; address: string
}> = {}) {
  return {
    name: "湘江环保科技有限公司",
    credit_code: "91430100MA4PD3C85K",
    permit_number: "91430100MA4PD3C85K001V",
    management_level: "重点管理",
    industry: "环境治理业",
    address: "长沙市高新区",
    ...overrides,
  }
}

function healthOk() {
  return { text: "deepseek-v4", vision: "kimi-vision", text_ready: true, vision_ready: true }
}

function healthNotReady() {
  return { text: "", vision: "", text_ready: false, vision_ready: false }
}

/** Render and wait for data loading to complete. */
async function renderLoaded() {
  const result = render(<SettingsView />)
  await waitFor(() => {
    expect(screen.queryAllByTestId("icon-loader-2").length).toBe(0)
  })
  return result
}

// ── Suite ───────────────────────────────────────────────────────

describe("SettingsView", () => {
  beforeEach(() => {
    cleanup()
    // resetAllMocks clears both calls AND implementations so each test starts clean
    vi.resetAllMocks()
    mockApiGet
      .mockResolvedValueOnce({ ok: true, data: userForm() })
      .mockResolvedValueOnce({ ok: true, data: enterpriseForm() })
    mockCheckHealth.mockResolvedValue(healthOk())
    mockApiPost.mockResolvedValue({ ok: true })
  })

  // ── Header ─────────────────────────────────────────────────

  it("renders the header text", async () => {
    await renderLoaded()
    expect(screen.getByText("企业信息 · 模型配置 · 授权管理")).toBeInTheDocument()
  })

  // ── Loading state ──────────────────────────────────────────

  it("shows a loading spinner while data is being fetched", () => {
    mockApiGet.mockImplementation(() => new Promise(() => {}))
    mockCheckHealth.mockImplementation(() => new Promise(() => {}))
    render(<SettingsView />)
    // Two loader spinners: one in the user section, one in the enterprise section
    expect(screen.getAllByTestId("icon-loader-2").length).toBeGreaterThanOrEqual(1)
  })

  // ── Section headings ───────────────────────────────────────

  it("renders all three sections after loading", async () => {
    await renderLoaded()
    expect(screen.getByText("个人档案")).toBeInTheDocument()
    expect(screen.getByText("企业信息")).toBeInTheDocument()
    expect(screen.getByText("模型配置")).toBeInTheDocument()
  })

  // ── User info ──────────────────────────────────────────────

  it("displays user name, role and phone after loading", async () => {
    await renderLoaded()
    // The user name appears both as an h3 heading and inside a Field span
    const nameElements = screen.getAllByText("张三")
    expect(nameElements.length).toBe(2)
    expect(screen.getByText("环保专员 · 13800138000")).toBeInTheDocument()
  })

  it("shows the first letter of the user name as avatar initial", async () => {
    await renderLoaded()
    expect(screen.getByText("张")).toBeInTheDocument()
  })

  it("falls back to 'E' as initial when user name is empty", async () => {
    mockApiGet.mockReset()
      .mockResolvedValueOnce({ ok: true, data: userForm({ name: "" }) })
      .mockResolvedValueOnce({ ok: true, data: enterpriseForm() })
    mockCheckHealth.mockReset().mockResolvedValue(healthOk())
    await renderLoaded()
    expect(screen.getByText("E")).toBeInTheDocument()
  })

  it("shows fallback text when user name is not set", async () => {
    mockApiGet.mockReset()
      .mockResolvedValueOnce({ ok: true, data: userForm({ name: "" }) })
      .mockResolvedValueOnce({ ok: true, data: enterpriseForm() })
    mockCheckHealth.mockReset().mockResolvedValue(healthOk())
    await renderLoaded()
    expect(screen.getByText("未设置")).toBeInTheDocument()
  })

  // ── Enterprise info ────────────────────────────────────────

  it("displays enterprise fields after loading", async () => {
    await renderLoaded()
    const ent = enterpriseForm()
    expect(screen.getByText(ent.name)).toBeInTheDocument()
    expect(screen.getByText(ent.credit_code)).toBeInTheDocument()
    expect(screen.getByText(ent.permit_number)).toBeInTheDocument()
    expect(screen.getByText(ent.management_level)).toBeInTheDocument()
    expect(screen.getByText(ent.industry)).toBeInTheDocument()
    expect(screen.getByText(ent.address)).toBeInTheDocument()
  })

  it("shows em dash for empty enterprise fields", async () => {
    mockApiGet.mockReset()
      .mockResolvedValueOnce({ ok: true, data: userForm() })
      .mockResolvedValueOnce({ ok: true, data: enterpriseForm({ name: "", credit_code: "" }) })
    mockCheckHealth.mockReset().mockResolvedValue(healthOk())
    await renderLoaded()
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1)
  })

  // ── Model status ───────────────────────────────────────────

  it("shows model status entries with ready state", async () => {
    await renderLoaded()
    expect(screen.getByText("DeepSeek V4")).toBeInTheDocument()
    expect(screen.getByText("Kimi Vision")).toBeInTheDocument()
    expect(screen.getByText("deepseek-v4")).toBeInTheDocument()
    expect(screen.getByText("kimi-vision")).toBeInTheDocument()
    expect(screen.getAllByTestId("icon-check-circle-2").length).toBe(2)
  })

  it("shows XCircle and placeholder text when models are not ready", async () => {
    mockApiGet.mockReset()
      .mockResolvedValueOnce({ ok: true, data: userForm() })
      .mockResolvedValueOnce({ ok: true, data: enterpriseForm() })
    mockCheckHealth.mockReset().mockResolvedValue(healthNotReady())
    await renderLoaded()
    expect(screen.getByText("DeepSeek V4")).toBeInTheDocument()
    expect(screen.getAllByText("检测中...").length).toBe(2)
    expect(screen.getAllByTestId("icon-x-circle").length).toBe(2)
  })

  it("shows API key storage hint", async () => {
    await renderLoaded()
    expect(
      screen.getByText(/API Key 配置存储在 ~\/\.ecopilot-home\/\.env/)
    ).toBeInTheDocument()
  })

  // ── Edit / Save interaction ─────────────────────────────────

  it("shows edit button that toggles editing mode", async () => {
    await renderLoaded()
    const editBtn = screen.getByRole("button", { name: /编辑/ })
    expect(editBtn).toBeInTheDocument()
    fireEvent.click(editBtn)
    expect(screen.getByRole("button", { name: /保存/ })).toBeInTheDocument()
  })

  it("toggles back to edit after save completes", async () => {
    mockApiPost.mockReset().mockResolvedValue({ ok: true })
    await renderLoaded()
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }))
    fireEvent.click(screen.getByRole("button", { name: /保存/ }))
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /编辑/ })).toBeInTheDocument()
    })
  })

  it("calls apiPost with user and enterprise data on save", async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }))
    fireEvent.click(screen.getByRole("button", { name: /保存/ }))
    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith("/api/user", {
        name: "张三",
        role: "环保专员",
        phone: "13800138000",
      })
    })
    expect(mockApiPost).toHaveBeenCalledWith("/api/enterprise", enterpriseForm())
  })

  it("shows success toast message after save", async () => {
    mockApiPost.mockReset().mockResolvedValue({ ok: true })
    await renderLoaded()
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }))
    fireEvent.click(screen.getByRole("button", { name: /保存/ }))
    await waitFor(() => {
      expect(screen.getByText("保存成功")).toBeInTheDocument()
    })
  })

  it("shows error message when save fails", async () => {
    mockApiPost.mockReset().mockResolvedValue({ ok: false, error: "网络错误" })
    await renderLoaded()
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }))
    fireEvent.click(screen.getByRole("button", { name: /保存/ }))
    await waitFor(() => {
      expect(screen.getByText("网络错误")).toBeInTheDocument()
    })
  })

  it("disables save button while saving", async () => {
    mockApiPost.mockReset().mockImplementation(() => new Promise(() => {}))
    await renderLoaded()
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }))
    fireEvent.click(screen.getByRole("button", { name: /保存/ }))
    await waitFor(() => {
      // The button is disabled while saving. The button text changes to "保存" (Save)
      // but since it may show a spinner, use a more robust selector.
      const saveBtn = screen.getByRole("button", { name: /保存/ })
      expect(saveBtn).toBeDisabled()
    })
  })

  it("shows Loader2 spinner while saving", async () => {
    mockApiPost.mockReset().mockImplementation(() => new Promise(() => {}))
    await renderLoaded()
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }))
    // Before clicking save, the Save icon is visible (editing=true, saving=false)
    expect(screen.getByTestId("icon-save")).toBeInTheDocument()
    // Now click save to trigger the saving state
    fireEvent.click(screen.getByRole("button", { name: /保存/ }))
    // The button switches from Save icon to Loader2 spinner
    await waitFor(() => {
      expect(screen.getByTestId("icon-loader-2")).toBeInTheDocument()
    })
  })

  it("shows generic error when save fails without error message", async () => {
    mockApiPost.mockReset().mockResolvedValue({ ok: false, error: undefined })
    await renderLoaded()
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }))
    fireEvent.click(screen.getByRole("button", { name: /保存/ }))
    await waitFor(() => {
      expect(screen.getByText("保存失败")).toBeInTheDocument()
    })
  })

  it("renders fields in read-only mode by default", async () => {
    await renderLoaded()
    // In read-only mode, no input/texbox elements should exist
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    // Values are rendered as plain spans; the user name appears
    // both as an h3 heading and inside a Field span
    expect(screen.getAllByText("张三").length).toBe(2)
  })

  it("renders input fields after clicking edit", async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }))
    const inputs = screen.getAllByRole("textbox")
    expect(inputs.length).toBeGreaterThanOrEqual(1)
    expect(inputs[0]).toHaveValue("张三")
  })

  it("updates user name when editing", async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }))
    const nameInput = screen.getByDisplayValue("张三")
    fireEvent.change(nameInput, { target: { value: "李四" } })
    expect(nameInput).toHaveValue("李四")
  })

  // ── Renders without crashing ────────────────────────────────

  it("renders without crashing", async () => {
    const { container } = await renderLoaded()
    expect(container.querySelector(".flex.h-full.flex-col")).toBeInTheDocument()
  })
})
