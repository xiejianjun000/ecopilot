import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SettingModal } from "@/components/setting-modal"

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  apiPost: vi.fn().mockResolvedValue({ ok: true }),
  checkHealth: vi.fn().mockResolvedValue({ ready: true }),
}))

vi.mock("lucide-react", () => ({
  X: () => <span data-testid="icon-x" />,
  Settings: () => <span data-testid="icon-settings" />,
  Building2: () => <span data-testid="icon-building" />,
  Cpu: () => <span data-testid="icon-cpu" />,
  Palette: () => <span data-testid="icon-palette" />,
  Bell: () => <span data-testid="icon-bell" />,
  Shield: () => <span data-testid="icon-shield" />,
  Info: () => <span data-testid="icon-info" />,
  Save: () => <span data-testid="icon-save" />,
  Loader2: () => <span data-testid="icon-loader" />,
  CheckCircle2: () => <span data-testid="icon-check" />,
  XCircle: () => <span data-testid="icon-xcircle" />,
  Pencil: () => <span data-testid="icon-pencil" />,
  ShieldCheck: () => <span data-testid="icon-shieldcheck" />,
  Sun: () => <span data-testid="icon-sun" />,
  Moon: () => <span data-testid="icon-moon" />,
  Monitor: () => <span data-testid="icon-monitor" />,
  RefreshCw: () => <span data-testid="icon-refresh" />,
  LogOut: () => <span data-testid="icon-logout" />,
  Check: () => <span data-testid="icon-check-sm" />,
  ChevronRight: () => <span data-testid="icon-chevron-right" />,
  Key: () => <span data-testid="icon-key" />,
}))

describe("SettingModal", () => {
  it("不渲染当 open=false", () => {
    render(<SettingModal open={false} onClose={vi.fn()} />)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("渲染对话框当 open=true", () => {
    render(<SettingModal open={true} onClose={vi.fn()} />)
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("显示标签页切换按钮", () => {
    render(<SettingModal open={true} onClose={vi.fn()} />)
    // 六个标签都在侧边栏导航中可见
    expect(screen.getAllByText("企业信息").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("模型配置").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("外观设置").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("通知偏好").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("安全配置").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("关于我们").length).toBeGreaterThanOrEqual(1)
  })

  it("显示关于 EcoPilot 标题", () => {
    render(<SettingModal open={true} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText("关于我们"))
    expect(screen.getByText("关于 EcoPilot")).toBeTruthy()
  })

  it("ESC 触发 onClose", () => {
    const onClose = vi.fn()
    render(<SettingModal open={true} onClose={onClose} />)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalled()
  })

  it("关闭按钮触发 onClose", () => {
    const onClose = vi.fn()
    render(<SettingModal open={true} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText("关闭设置"))
    expect(onClose).toHaveBeenCalled()
  })

  it("对话框有 aria-modal 属性", () => {
    render(<SettingModal open={true} onClose={vi.fn()} />)
    const dialog = screen.getByRole("dialog")
    expect(dialog.getAttribute("aria-modal")).toBe("true")
  })
})
