import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import { ConnectorView } from "./connector"

const mockCheckHealth = vi.hoisted(() => vi.fn())

vi.mock("@/lib/api", () => ({
  checkHealth: mockCheckHealth,
}))

vi.mock("lucide-react", () => {
  const icon = (name: string) => (props: any) => <span data-testid={`icon-${name}`} />
  return {
    RefreshCw: icon("RefreshCw"), Wifi: icon("Wifi"), WifiOff: icon("WifiOff"),
    Terminal: icon("Terminal"), ShieldCheck: icon("ShieldCheck"),
    FileText: icon("FileText"), Database: icon("Database"),
    Lock: icon("Lock"), Navigation: icon("Navigation"), ScanLine: icon("ScanLine"),
  }
})

describe("ConnectorView", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders without crashing", async () => {
    mockCheckHealth.mockResolvedValue({
      text_ready: true, vision_ready: true,
      text_model: "gpt-4", vision_model: "gpt-4-vision",
    })
    await act(async () => { render(<ConnectorView />) })
    expect(screen.getAllByText(/系统能力/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/后端服务/).length).toBeGreaterThanOrEqual(1)
  })

  it("calls checkHealth on mount", async () => {
    mockCheckHealth.mockResolvedValue({
      text_ready: true, vision_ready: true,
      text_model: "gpt-4", vision_model: "gpt-4-vision",
    })
    await act(async () => { render(<ConnectorView />) })
    expect(mockCheckHealth).toHaveBeenCalledTimes(1)
  })

  it("shows offline state when checkHealth fails", async () => {
    mockCheckHealth.mockRejectedValue(new Error("fail"))
    await act(async () => { render(<ConnectorView />) })
    expect(screen.getAllByText(/离线/).length).toBeGreaterThanOrEqual(1)
  })

  it("renders capabilities list", async () => {
    mockCheckHealth.mockResolvedValue({
      text_ready: true, vision_ready: true,
      text_model: "gpt-4", vision_model: "gpt-4-vision",
    })
    const caps = ["排污许可合规审计", "许可证数据提取", "许可证卡片读取", "许可证平台自动登录"]
    await act(async () => { render(<ConnectorView />) })
    for (const c of caps) {
      expect(screen.getAllByText(c).length).toBeGreaterThanOrEqual(1)
    }
  })
})
