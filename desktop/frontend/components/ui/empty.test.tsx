import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("lucide-react", () => ({
  Inbox: () => <span data-testid="icon-inbox" />,
}))

import { Empty } from "@/components/ui/empty"

describe("Empty", () => {
  it("renders default title", () => {
    render(<Empty />)
    expect(screen.getByText("暂无数据")).toBeTruthy()
  })

  it("renders custom title", () => {
    render(<Empty title="无搜索结果" />)
    expect(screen.getByText("无搜索结果")).toBeTruthy()
  })

  it("renders description when provided", () => {
    render(<Empty description="请尝试修改筛选条件" />)
    expect(screen.getByText("请尝试修改筛选条件")).toBeTruthy()
  })

  it("hides description when not provided", () => {
    render(<Empty />)
    expect(screen.queryByText("请尝试修改筛选条件")).toBeNull()
  })

  it("renders action slot", () => {
    render(<Empty action={<button>新建</button>} />)
    expect(screen.getByText("新建")).toBeTruthy()
  })
})
