import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { LeftSidebar } from "@/components/left-sidebar"

const mockDispatch = vi.fn()
const mockState = {
  activeNav: "chat" as const,
  rightPanelOpen: false,
  conversations: [],
  activeConversationId: null,
  messages: [],
  sending: false,
  progress: null,
  taskSummaries: [],
  outputFiles: [],
  memories: [],
  diaryEntries: [],
  selfLearningSkills: [],
  enterpriseEvolution: [],
  workspaceFolders: [],
  prefillInput: null,
}

vi.mock("@/lib/store", () => ({
  useApp: () => ({ state: mockState, dispatch: mockDispatch }),
}))

describe("LeftSidebar", () => {
  it("渲染时不崩溃（展开状态）", () => {
    const { container } = render(
      <LeftSidebar open={true} onToggle={vi.fn()} />
    )
    expect(container.children.length).toBeGreaterThan(0)
  })

  it("渲染时不崩溃（收起状态）", () => {
    const { container } = render(
      <LeftSidebar open={false} onToggle={vi.fn()} />
    )
    expect(container.children.length).toBeGreaterThan(0)
  })

  it("新建对话按钮存在且可交互", () => {
    render(<LeftSidebar open={true} onToggle={vi.fn()} />)
    const elements = screen.getAllByText("新建对话")
    expect(elements.length).toBeGreaterThan(0)
    // 点击任一按钮应触发 NEW_CONVERSATION
    elements[0].click()
    expect(mockDispatch).toHaveBeenCalledWith({ type: "NEW_CONVERSATION" })
  })
})
