import "@testing-library/jest-dom/vitest"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { DocEditor, type DocEditorProps } from "./doc-editor"

// ── Hoisted mocks ──────────────────────────────────────────
const { mockDispatch, mockApiGet, mockApiPost } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  mockApiGet: vi.fn(),
  mockApiPost: vi.fn(),
}))

// ── Module mocks (hoisted by vitest) ───────────────────────

vi.mock("lucide-react", () => {
  const icon = (name: string) => {
    const C = (props: any) => <span data-testid={`icon-${name}`} className={props.className} />
    C.displayName = name
    return C
  }
  return {
    FileText: icon("file-text"),
    X: icon("x"),
    Save: icon("save"),
    Loader2: icon("loader-2"),
    Download: icon("download"),
    Printer: icon("printer"),
    Check: icon("check"),
    ChevronDown: icon("chevron-down"),
    ChevronRight: icon("chevron-right"),
    Edit3: icon("edit-3"),
    Eye: icon("eye"),
    PanelRight: icon("panel-right"),
    Copy: icon("copy"),
    FileDown: icon("file-down"),
    FileType: icon("file-type"),
    Sparkles: icon("sparkles"),
    MessageSquare: icon("message-square"),
    Pencil: icon("pencil"),
    Calendar: icon("calendar"),
    Square: icon("square"),
  }
})

vi.mock("@/lib/api", () => ({
  getApiBase: vi.fn(() => "http://test-api"),
  authHeaders: vi.fn(() => ({})),
  apiPost: (...args: unknown[]) => mockApiPost(...args),
  ensureAuthToken: vi.fn(() => Promise.resolve()),
  apiGet: (...args: unknown[]) => mockApiGet(...args),
  streamSSE: vi.fn(),
}))

vi.mock("@/lib/store", () => ({
  useApp: () => ({ state: {}, dispatch: mockDispatch }),
}))

vi.mock("@/lib/utils", () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
}))

vi.mock("@/lib/export", () => ({
  exportMarkdown: vi.fn(),
  exportDocx: vi.fn(),
  exportPdfPrint: vi.fn(),
  sanitizeFilename: vi.fn((name: string) => name.replace(/[\\/:*?"<>|]/g, "_").trim() || "未命名文档"),
}))

vi.mock("react-markdown", () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div data-testid="react-markdown">{children}</div>,
}))

vi.mock("remark-gfm", () => ({
  default: () => {},
}))

// ── Default props ──────────────────────────────────────────

function defaultProps(overrides: Partial<DocEditorProps> = {}): DocEditorProps {
  return {
    open: true,
    onClose: vi.fn(),
    ...overrides,
  }
}

// ── Suite ──────────────────────────────────────────────────

describe("DocEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Rendering: open/closed ────────────────────────────────

  it("renders null when open is false", () => {
    const { container } = render(<DocEditor {...defaultProps({ open: false })} />)
    expect(container.innerHTML).toBe("")
  })

  it("renders the editor panel when open is true in default modal mode", () => {
    render(<DocEditor {...defaultProps()} />)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.getByLabelText("文档编辑器")).toBeInTheDocument()
  })

  it("renders the embedded panel variant when embedded is true", () => {
    render(<DocEditor {...defaultProps({ embedded: true })} />)
    expect(screen.getByRole("complementary")).toBeInTheDocument()
    expect(screen.getByLabelText("文档编辑器")).toBeInTheDocument()
  })

  // ── Header content ────────────────────────────────────────

  it("displays the template name in the header", () => {
    render(<DocEditor {...defaultProps({ templateName: "月度执行报告" })} />)
    expect(screen.getByText("月度执行报告")).toBeInTheDocument()
  })

  it("displays the event title when no template name is given", () => {
    render(<DocEditor {...defaultProps({ eventTitle: "检查整改通知", templateName: undefined })} />)
    // eventTitle appears in both h2 and subtitle span
    const matches = screen.getAllByText("检查整改通知")
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it("shows fallback title when neither templateName nor eventTitle", () => {
    render(<DocEditor {...defaultProps({ templateName: undefined, eventTitle: undefined })} />)
    expect(screen.getByText("文档编辑器")).toBeInTheDocument()
  })

  it("shows the event date when provided", () => {
    render(<DocEditor {...defaultProps({ eventDate: "2026-07-15" })} />)
    // Date is rendered inside a span with a leading "· " bullet
    expect(screen.getByText(/2026-07-15/)).toBeInTheDocument()
  })

  // ── Loading & error states ────────────────────────────────

  it("shows loading indicator while fetching template", () => {
    mockApiGet.mockReturnValue(new Promise(() => {})) // never resolves
    render(<DocEditor {...defaultProps({ templateId: "tpl-1" })} />)
    expect(screen.getByText("正在加载模板...")).toBeInTheDocument()
  })

  it("shows error message when template loading fails", async () => {
    mockApiGet.mockResolvedValue({ ok: false, error: "模板加载失败" })
    render(<DocEditor {...defaultProps({ templateId: "tpl-1" })} />)
    // Component displays res.error directly when it exists
    expect(await screen.findByText("模板加载失败")).toBeInTheDocument()
  })

  it("shows network error on API rejection", async () => {
    mockApiGet.mockRejectedValue(new Error("Network error"))
    render(<DocEditor {...defaultProps({ templateId: "tpl-1" })} />)
    expect(await screen.findByText("网络错误，无法加载模板")).toBeInTheDocument()
  })

  // ── Mode tabs ─────────────────────────────────────────────

  it("renders edit mode by default with a textarea", () => {
    render(<DocEditor {...defaultProps()} />)
    expect(screen.getByLabelText("文档内容编辑区")).toBeInTheDocument()
  })

  it("switches to preview mode after clicking the preview tab", async () => {
    render(<DocEditor {...defaultProps()} />)
    fireEvent.click(screen.getByText("预览"))
    await waitFor(() => {
      expect(screen.getByTestId("react-markdown")).toBeInTheDocument()
    })
  })

  // ── Export toolbar ────────────────────────────────────────

  it("shows export buttons in the toolbar", () => {
    render(<DocEditor {...defaultProps()} />)
    expect(screen.getByText("下载 MD")).toBeInTheDocument()
    expect(screen.getByText("下载 Word")).toBeInTheDocument()
    expect(screen.getByText("打印")).toBeInTheDocument()
  })

  it("disables export buttons when content is empty (no templateId)", () => {
    render(<DocEditor {...defaultProps()} />)
    expect(screen.getByText("下载 MD").closest("button")).toBeDisabled()
    expect(screen.getByText("下载 Word").closest("button")).toBeDisabled()
    expect(screen.getByText("打印").closest("button")).toBeDisabled()
  })

  it("shows the save button", () => {
    render(<DocEditor {...defaultProps()} />)
    expect(screen.getByText("保存")).toBeInTheDocument()
  })

  it("shows the AI fill and 一问 AI buttons in modal mode", () => {
    render(<DocEditor {...defaultProps()} />)
    expect(screen.getByText("AI 填充")).toBeInTheDocument()
    expect(screen.getByText("一键问 AI")).toBeInTheDocument()
  })

  // ── Embedded mode: export buttons ─────────────────────────

  it("shows export buttons in embedded mode", () => {
    render(<DocEditor {...defaultProps({ embedded: true })} />)
    expect(screen.getByText("MD")).toBeInTheDocument()
    expect(screen.getByText("Word")).toBeInTheDocument()
    expect(screen.getByText("打印")).toBeInTheDocument()
  })

  // ── Icons rendered ────────────────────────────────────────

  it("renders expected icons", () => {
    render(<DocEditor {...defaultProps()} />)
    expect(screen.getByTestId("icon-file-text")).toBeInTheDocument()
    expect(screen.getByTestId("icon-x")).toBeInTheDocument()
    expect(screen.getByTestId("icon-save")).toBeInTheDocument()
    expect(screen.getByTestId("icon-printer")).toBeInTheDocument()
    expect(screen.getByTestId("icon-eye")).toBeInTheDocument()
    expect(screen.getByTestId("icon-pencil")).toBeInTheDocument()
  })
})
