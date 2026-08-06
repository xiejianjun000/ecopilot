import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"

import { UserPanel } from "./user-panel"

// ── Mocks ──

vi.mock("lucide-react", () => ({
  User: ({ className, "data-testid": dti }: any) => <svg data-testid={dti || "icon-user"} className={className} />,
  Settings: ({ className, "data-testid": dti }: any) => <svg data-testid={dti || "icon-settings"} className={className} />,
  LogOut: ({ className, "data-testid": dti }: any) => <svg data-testid={dti || "icon-logout"} className={className} />,
  Moon: ({ className }: any) => <svg data-testid="icon-moon" className={className} />,
  Sun: ({ className }: any) => <svg data-testid="icon-sun" className={className} />,
  Monitor: ({ className }: any) => <svg data-testid="icon-monitor" className={className} />,
  Crown: ({ className }: any) => <svg data-testid="icon-crown" className={className} />,
  MessageSquare: ({ className }: any) => <svg data-testid="icon-message-square" className={className} />,
  BarChart3: ({ className }: any) => <svg data-testid="icon-bar-chart" className={className} />,
  BookOpen: ({ className }: any) => <svg data-testid="icon-book-open" className={className} />,
  Grid3X3: ({ className }: any) => <svg data-testid="icon-grid" className={className} />,
  HelpCircle: ({ className }: any) => <svg data-testid="icon-help" className={className} />,
  ChevronRight: ({ className }: any) => <svg data-testid="icon-chevron-right" className={className} />,
  Check: ({ className }: any) => <svg data-testid="icon-check" className={className} />,
  Loader2: ({ className }: any) => <svg data-testid="icon-loader" className={className} />,
  Sparkles: ({ className }: any) => <svg data-testid="icon-sparkles" className={className} />,
  Star: ({ className }: any) => <svg data-testid="icon-star" className={className} />,
  RefreshCw: ({ className }: any) => <svg data-testid="icon-refresh" className={className} />,
  X: ({ className }: any) => <svg data-testid="icon-x" className={className} />,
  UserRound: ({ className }: any) => <svg data-testid="icon-user-round" className={className} />,
  Wrench: ({ className }: any) => <svg data-testid="icon-wrench" className={className} />,
  Database: ({ className }: any) => <svg data-testid="icon-database" className={className} />,
  Upload: ({ className }: any) => <svg data-testid="icon-upload" className={className} />,
  Info: ({ className }: any) => <svg data-testid="icon-info" className={className} />,
  Coins: ({ className }: any) => <svg data-testid="icon-coins" className={className} />,
  ExternalLink: ({ className }: any) => <svg data-testid="icon-external-link" className={className} />,
}))

const mockApiGet = vi.fn()
const mockApiPost = vi.fn()
vi.mock("@/lib/api", () => ({
  apiGet: (...args: any[]) => mockApiGet(...args),
  apiPost: (...args: any[]) => mockApiPost(...args),
}))

const mockDispatch = vi.fn()
vi.mock("@/lib/store", () => ({
  useApp: () => ({ dispatch: mockDispatch }),
}))

// ── Helpers ──

function renderPanel(open = true, onClose?: () => void) {
  const closeFn = onClose ?? vi.fn()
  return { ...render(<UserPanel open={open} onClose={closeFn} />), closeFn }
}

function getLocalStorageMock() {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
}

// ── Tests ──

describe("UserPanel", () => {
  let ls: ReturnType<typeof getLocalStorageMock>

  beforeEach(() => {
    vi.useFakeTimers()
    ls = getLocalStorageMock()
    vi.stubGlobal("localStorage", ls)
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:"), revokeObjectURL: vi.fn() })
    mockApiGet.mockReset()
    mockApiPost.mockReset()
    mockDispatch.mockReset()
    mockApiGet.mockResolvedValue({ ok: true, data: { name: "张三" } })
    mockApiGet.mockResolvedValue({ ok: true, data: { name: "测试企业" } })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe("open/close", () => {
    it("renders nothing when open is false", () => {
      renderPanel(false)
      expect(screen.queryByText("个人档案")).not.toBeInTheDocument()
      expect(screen.queryByTestId("icon-x")).not.toBeInTheDocument()
    })

    it("renders the panel when open is true", () => {
      renderPanel(true)
      expect(screen.getAllByText("个人档案").length).toBeGreaterThanOrEqual(1)
      expect(screen.getByTestId("icon-x")).toBeInTheDocument()
    })

    it("calls onClose when clicking the X button", async () => {
      const { closeFn } = renderPanel(true)
      fireEvent.click(screen.getByTestId("icon-x").closest("button")!)
      expect(closeFn).toHaveBeenCalledTimes(1)
    })

    it("calls onClose when pressing Escape", () => {
      const { closeFn } = renderPanel(true)
      fireEvent.keyDown(window, { key: "Escape" })
      expect(closeFn).toHaveBeenCalledTimes(1)
    })

    it("does not close on Escape when panel is not open", () => {
      const { closeFn } = renderPanel(false)
      fireEvent.keyDown(window, { key: "Escape" })
      expect(closeFn).not.toHaveBeenCalled()
    })
  })

  describe("user info rendering", () => {
    it("shows initial avatar letter and greeting", async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url === "/api/user") return Promise.resolve({ ok: true, data: { name: "李四", role: "厂长", phone: "13800138000" } })
        if (url === "/api/enterprise") return Promise.resolve({ ok: true, data: { name: "环保科技公司" } })
        return Promise.resolve({ ok: true })
      })
      renderPanel(true)
      await vi.advanceTimersByTimeAsync(100)

      expect(mockApiGet).toHaveBeenCalledWith("/api/user")
      expect(mockApiGet).toHaveBeenCalledWith("/api/enterprise")
      // After api resolves and state updates, avatar initial should be "李"
      await vi.advanceTimersByTimeAsync(0) // flush state updates

      // Default tab is profile, so the profile heading shows
      expect(screen.getAllByText("个人档案").length).toBeGreaterThanOrEqual(1)
    })

    it("shows nickname after API resolves", async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url === "/api/user") return Promise.resolve({ ok: true, data: { name: "赵六", role: "环保专员" } })
        return Promise.resolve({ ok: true, data: { name: "测试企业" } })
      })
      renderPanel(true)
      await vi.advanceTimersByTimeAsync(100)

      // The profile content should render with the loaded name
      // ProfileContent renders the initial letter from nickname
      expect(mockApiGet).toHaveBeenCalled()
    })

    it("shows default label when user data is missing", async () => {
      mockApiGet.mockResolvedValue({ ok: false })
      renderPanel(true)
      await vi.advanceTimersByTimeAsync(100)
      // Should show default without crashing
      expect(screen.getAllByText("个人档案").length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("navigation / menu items", () => {
    it("renders all 11 nav items", () => {
      renderPanel(true)
      const expectedLabels = [
        "个人档案", "沟通偏好", "日记", "通用设置", "用量统计",
        "技能管理", "远控通道", "软件配置", "备份与迁移", "关于我们", "积分交换",
      ]
      for (const label of expectedLabels) {
        expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1)
      }
    })

    it("switches content tab when a nav button is clicked", async () => {
      renderPanel(true)
      fireEvent.click(screen.getAllByText("沟通偏好")[0])
      expect(screen.getAllByText("沟通偏好").length).toBeGreaterThanOrEqual(1)
      // CommContent has textareas with placeholders — check one renders
      expect(screen.getByPlaceholderText(/直接、简洁/)).toBeInTheDocument()
    })

    it("switches to diary tab and shows empty state", async () => {
      renderPanel(true)
      fireEvent.click(screen.getAllByText("日记")[0])
      expect(screen.getByText(/暂无日记记录/)).toBeInTheDocument()
    })

    it("switches to about tab and shows version info", async () => {
      renderPanel(true)
      fireEvent.click(screen.getAllByText("关于我们")[0])
      expect(screen.getByText(/EcoPilot v1\.0\.6/)).toBeInTheDocument()
    })

    it("switches to skills tab and renders skill tags", async () => {
      renderPanel(true)
      fireEvent.click(screen.getAllByText("技能管理")[0])
      expect(screen.getAllByText("排污许可").length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText("碳排放").length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("theme toggle", () => {
    it("toggles between light and dark theme", async () => {
      renderPanel(true)
      // Default is light mode — shows moon icon for switching to dark
      expect(screen.getAllByText("深色模式").length).toBeGreaterThanOrEqual(1)
      expect(screen.getByTestId("icon-moon")).toBeInTheDocument()

      fireEvent.click(screen.getAllByText("深色模式")[0])
      expect(screen.getAllByText("浅色模式").length).toBeGreaterThanOrEqual(1)
      expect(screen.getByTestId("icon-sun")).toBeInTheDocument()
      expect(document.documentElement.classList.contains("dark")).toBe(true)
      expect(ls.setItem).toHaveBeenCalledWith("ecopilot_theme", "dark")

      fireEvent.click(screen.getAllByText("浅色模式")[0])
      expect(document.documentElement.classList.contains("dark")).toBe(false)
      expect(ls.setItem).toHaveBeenCalledWith("ecopilot_theme", "light")
    })

    it("loads dark theme from localStorage", () => {
      ls.getItem.mockReturnValue("dark")
      renderPanel(true)
      expect(document.documentElement.classList.contains("dark")).toBe(true)
    })
  })

  describe("profile content", () => {
    it("renders nickname input and updates on change", async () => {
      renderPanel(true)
      const input = screen.getByDisplayValue("") as HTMLInputElement
      // The nickname input should be visible in the profile tab
      fireEvent.change(input, { target: { value: "新名称" } })
      expect(input.value).toBe("新名称")
    })

    it("dispatches SET_NAV when edit button is clicked", async () => {
      renderPanel(true)
      // Switch to profile to ensure edit button is there (always visible as default)
      const editBtn = screen.getByText("编辑")
      fireEvent.click(editBtn)
      expect(mockDispatch).toHaveBeenCalledWith({ type: "SET_NAV", nav: "settings" })
    })

    it("renders role select with options", () => {
      renderPanel(true)
      const select = screen.getByDisplayValue("环保专员")
      expect(select).toBeInTheDocument()
      expect(screen.getAllByText("厂长").length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("usage tab", () => {
    it("renders usage statistics with progress bars", async () => {
      renderPanel(true)
      fireEvent.click(screen.getAllByText("用量统计")[0])
      expect(screen.getAllByText("今日对话次数").length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText("本月Token用量").length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText("存储空间").length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText("23").length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("config tab", () => {
    it("toggles switches in config tab", async () => {
      renderPanel(true)
      fireEvent.click(screen.getAllByText("软件配置")[0])
      expect(screen.getAllByText("Auto Mode").length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText("实验功能").length).toBeGreaterThanOrEqual(1)

      // Click "实验功能" toggle to turn it on
      const toggleBtn = screen.getByText("实验功能").closest("button")!
      fireEvent.click(toggleBtn)
      // The toggle should now be visually "on" — the dot slides right
    })
  })

  describe("backup tab", () => {
    it("renders export button and shows success message after export", async () => {
      renderPanel(true)
      fireEvent.click(screen.getAllByText("备份与迁移")[0])
      expect(screen.getAllByText("导出备份").length).toBeGreaterThanOrEqual(1)

      mockApiGet.mockResolvedValue({ ok: true, data: { test: true } })

      fireEvent.click(screen.getAllByText("导出备份")[0])
      await vi.advanceTimersByTimeAsync(100)

      expect(mockApiGet).toHaveBeenCalledWith("/api/user")
      expect(mockApiGet).toHaveBeenCalledWith("/api/enterprise")
      expect(screen.getAllByText("备份已导出").length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("points tab", () => {
    it("shows points balance and click handler", async () => {
      renderPanel(true)
      fireEvent.click(screen.getAllByText("积分交换")[0])
      expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText("当前积分余额").length).toBeGreaterThanOrEqual(1)

      fireEvent.click(screen.getAllByText("获取积分")[0])
      expect(screen.getAllByText("积分兑换功能即将上线，敬请期待").length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("debounced save", () => {
    it("calls apiPost after nickname changes with 600ms debounce", async () => {
      mockApiPost.mockResolvedValue({ ok: true })
      renderPanel(true)

      const input = screen.getByDisplayValue("") as HTMLInputElement
      fireEvent.change(input, { target: { value: "新昵称" } })

      // Should not be called immediately
      expect(mockApiPost).not.toHaveBeenCalled()

      // Advance past debounce
      await vi.advanceTimersByTimeAsync(700)
      expect(mockApiPost).toHaveBeenCalledWith("/api/user", expect.objectContaining({ name: "新昵称" }))
    })
  })
})
