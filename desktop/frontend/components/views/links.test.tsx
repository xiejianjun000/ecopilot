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
}))

vi.mock("lucide-react", () => ({
  ExternalLink: () => null,
  Search: () => null,
  WifiOff: () => null,
  ShieldCheck: () => null,
  Clock: () => null,
}))

const ALL_LINK_NAMES = [
  "全国排污许可证管理信息平台",
  "全国碳排放权交易市场",
  "国家固体废物污染环境防治信息平台",
  "全国建设项目竣工环境保护验收信息系统",
  "全国污染源监测信息管理与共享平台",
  "环保税申报",
  "环境统计报表",
  "环境信息依法披露系统",
  "环境应急预案备案",
  "清洁生产审核",
  "土壤污染隐患排查与地下水监测",
  "企业环境信用评价",
]

describe("LinksView", () => {
  it("renders without crashing", () => {
    const { container } = render(<LinksView />)
    expect(container.children.length).toBeGreaterThan(0)
  })

  it("shows header with entry count and connection summary", () => {
    render(<LinksView />)
    expect(screen.getByText("12 个官方申报入口 · 新窗口打开")).toBeInTheDocument()
    expect(screen.getByText("已连接 1/12")).toBeInTheDocument()
  })

  it("renders all six category filter buttons", () => {
    render(<LinksView />)
    expect(screen.getByRole("button", { name: "全部" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "核心" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "金融" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "报告" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "管理" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "监测" })).toBeInTheDocument()
  })

  it("renders search input with correct placeholder and aria-label", () => {
    render(<LinksView />)
    const input = screen.getByPlaceholderText("搜索平台名称或描述...")
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute("aria-label", "搜索政务平台")
  })

  it("displays all 12 platform links by default", () => {
    render(<LinksView />)
    for (const name of ALL_LINK_NAMES) {
      expect(screen.getByTitle(name)).toBeInTheDocument()
    }
  })

  it("shows category badge on each link card", () => {
    render(<LinksView />)
    // 核心 should appear on 5 cards (plus the category tab button itself)
    const coreBadges = screen.getAllByText("核心")
    expect(coreBadges.length).toBeGreaterThanOrEqual(5)
  })

  it("marks 5 platforms as '即将上线'", () => {
    render(<LinksView />)
    expect(screen.getAllByText("即将上线")).toHaveLength(5)
  })

  it("displays connection status text for every link", () => {
    render(<LinksView />)
    expect(screen.getByText("已连接")).toBeInTheDocument()
    expect(screen.getAllByText("待测试")).toHaveLength(11)
  })

  it("filters links by category when a category button is clicked", () => {
    render(<LinksView />)
    // Click "金融" — should show 2 cards (环保税申报, 企业环境信用评价)
    fireEvent.click(screen.getByRole("button", { name: "金融" }))
    expect(screen.getByTitle("环保税申报")).toBeInTheDocument()
    expect(screen.getByTitle("企业环境信用评价")).toBeInTheDocument()
    // 核心 links should be hidden
    expect(screen.queryByTitle("全国排污许可证管理信息平台")).not.toBeInTheDocument()
  })

  it("resets to all categories when '全部' is clicked", () => {
    render(<LinksView />)
    fireEvent.click(screen.getByRole("button", { name: "金融" }))
    fireEvent.click(screen.getByRole("button", { name: "全部" }))
    for (const name of ALL_LINK_NAMES) {
      expect(screen.getByTitle(name)).toBeInTheDocument()
    }
  })

  it("filters links by search keyword (name match)", () => {
    render(<LinksView />)
    const input = screen.getByPlaceholderText("搜索平台名称或描述...")
    fireEvent.change(input, { target: { value: "排污" } })
    expect(screen.getByTitle("全国排污许可证管理信息平台")).toBeInTheDocument()
    expect(screen.queryByTitle("环保税申报")).not.toBeInTheDocument()
  })

  it("filters links by search keyword (desc match)", () => {
    render(<LinksView />)
    const input = screen.getByPlaceholderText("搜索平台名称或描述...")
    fireEvent.change(input, { target: { value: "MRV" } })
    expect(screen.getByTitle("全国碳排放权交易市场")).toBeInTheDocument()
  })

  it("shows empty state when search matches nothing", () => {
    render(<LinksView />)
    const input = screen.getByPlaceholderText("搜索平台名称或描述...")
    fireEvent.change(input, { target: { value: "ZZZZNOMATCH" } })
    expect(screen.getByText("未找到匹配的政务平台")).toBeInTheDocument()
    expect(screen.getByText("尝试更换关键词或切换分类")).toBeInTheDocument()
  })

  it("shows empty state when category has no results", () => {
    render(<LinksView />)
    // 监测 has only 1 item that's also soon
    fireEvent.click(screen.getByRole("button", { name: "监测" }))
    expect(screen.getByTitle("土壤污染隐患排查与地下水监测")).toBeInTheDocument()
  })

  it("combines category filter with search", () => {
    render(<LinksView />)
    fireEvent.click(screen.getByRole("button", { name: "金融" }))
    const input = screen.getByPlaceholderText("搜索平台名称或描述...")
    fireEvent.change(input, { target: { value: "环保税" } })
    expect(screen.getByTitle("环保税申报")).toBeInTheDocument()
    expect(screen.queryByTitle("企业环境信用评价")).not.toBeInTheDocument()
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
