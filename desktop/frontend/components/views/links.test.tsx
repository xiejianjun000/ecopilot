import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { LinksView } from "@/components/views/links"

vi.mock("@/lib/utils", () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(" "),
}))

vi.mock("@/lib/api", () => ({
  getApiBase: () => "http://127.0.0.1:8002",
  apiGet: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  apiPost: vi.fn().mockResolvedValue({ ok: true }),
  apiDelete: vi.fn().mockResolvedValue({ ok: true }),
  ensureAuthToken: vi.fn(),
  authHeaders: () => ({}),
  getPlatformCredentials: vi.fn().mockResolvedValue(null),
  savePlatformCredentials: vi.fn().mockResolvedValue(true),
  initPermitLogin: vi.fn().mockResolvedValue({ ok: true, session_id: "s", captcha_image: "" }),
  submitPermitLogin: vi.fn().mockResolvedValue({ ok: true }),
  openPlatformBrowser: vi.fn().mockResolvedValue({ ok: true, session_id: "s", url: "" }),
}))

vi.mock("lucide-react", () => ({
  ExternalLink: () => null,
  Search: () => null,
  WifiOff: () => null,
  ShieldCheck: () => null,
  Clock: () => null,
  Plus: () => null,
  X: () => null,
  Globe: () => null,
  KeyRound: () => null,
  RefreshCw: () => null,
  Pencil: () => null,
  Eye: () => null,
  EyeOff: () => null,
}))

const ALL_LINK_NAMES = [
  "全国排污许可证管理信息平台",
  "国家固体废物污染环境防治信息平台",
  "在线监测管理平台",
]

describe("LinksView", () => {
  it("renders without crashing", () => {
    const { container } = render(<LinksView />)
    expect(container.children.length).toBeGreaterThan(0)
  })

  it("shows header with entry count and connection summary", () => {
    render(<LinksView />)
    expect(screen.getByText("3 个官方入口 · 新窗口打开")).toBeInTheDocument()
    expect(screen.getByText("已连接 1/3")).toBeInTheDocument()
  })

  it("renders category filter buttons", () => {
    render(<LinksView />)
    expect(screen.getByRole("button", { name: "全部" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "核心" })).toBeInTheDocument()
  })

  it("renders search input with correct placeholder and aria-label", () => {
    render(<LinksView />)
    const input = screen.getByPlaceholderText("搜索平台名称或描述...")
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute("aria-label", "搜索政务平台")
  })

  it("displays all platform links by default", () => {
    render(<LinksView />)
    for (const name of ALL_LINK_NAMES) {
      expect(screen.getByTitle(name)).toBeInTheDocument()
    }
  })

  it("shows category badge on each link card", () => {
    render(<LinksView />)
    // 核心 should appear on 3 cards (plus the category tab button itself)
    const coreBadges = screen.getAllByText("核心")
    expect(coreBadges.length).toBeGreaterThanOrEqual(3)
  })

  it("displays connection status text for every link", () => {
    render(<LinksView />)
    expect(screen.getByText("已连接")).toBeInTheDocument()
    expect(screen.getAllByText("待测试")).toHaveLength(2)
  })

  it("filters links by category when '核心' is clicked", () => {
    render(<LinksView />)
    fireEvent.click(screen.getByRole("button", { name: "核心" }))
    for (const name of ALL_LINK_NAMES) {
      expect(screen.getByTitle(name)).toBeInTheDocument()
    }
  })

  it("filters links by search keyword (name match)", () => {
    render(<LinksView />)
    const input = screen.getByPlaceholderText("搜索平台名称或描述...")
    fireEvent.change(input, { target: { value: "排污" } })
    expect(screen.getByTitle("全国排污许可证管理信息平台")).toBeInTheDocument()
    expect(screen.queryByTitle("国家固体废物污染环境防治信息平台")).not.toBeInTheDocument()
  })

  it("filters links by search keyword (desc match)", () => {
    render(<LinksView />)
    const input = screen.getByPlaceholderText("搜索平台名称或描述...")
    fireEvent.change(input, { target: { value: "危险废物" } })
    expect(screen.getByTitle("国家固体废物污染环境防治信息平台")).toBeInTheDocument()
  })

  it("shows empty state when search matches nothing", () => {
    render(<LinksView />)
    const input = screen.getByPlaceholderText("搜索平台名称或描述...")
    fireEvent.change(input, { target: { value: "ZZZZNOMATCH" } })
    expect(screen.getByText("未找到匹配的政务平台")).toBeInTheDocument()
    expect(screen.getByText("尝试更换关键词或切换分类")).toBeInTheDocument()
  })

  it("has working external links with target='_blank' and rel='noopener noreferrer'", () => {
    render(<LinksView />)
    const link = screen.getByTitle("全国排污许可证管理信息平台")
    expect(link.tagName).toBe("A")
    expect(link).toHaveAttribute("href", "https://permit.mee.gov.cn")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
  })
})
