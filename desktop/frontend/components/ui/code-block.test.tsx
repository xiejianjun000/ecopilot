import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { CodeBlock } from "@/components/ui/code-block"

vi.mock("lucide-react", () => ({
  Check: () => <span data-testid="icon-check" />,
  Copy: () => <span data-testid="icon-copy" />,
}))

describe("CodeBlock", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
    })
  })

  it("renders code content", () => {
    render(<CodeBlock code="console.log('hello')" />)
    expect(screen.getByText("console.log('hello')")).toBeTruthy()
  })

  it("shows language label", () => {
    render(<CodeBlock code="x" language="typescript" />)
    expect(screen.getByText("typescript")).toBeTruthy()
  })

  it("defaults language to text when not specified", () => {
    render(<CodeBlock code="x" />)
    expect(screen.getByText("text")).toBeTruthy()
  })

  it("normalizes language to lowercase", () => {
    render(<CodeBlock code="x" language="TypeScript" />)
    expect(screen.getByText("typescript")).toBeTruthy()
  })

  it("shows copy button", () => {
    render(<CodeBlock code="x" />)
    expect(screen.getByText("复制")).toBeTruthy()
  })

  it("copies to clipboard on click", () => {
    render(<CodeBlock code="hello world" />)
    screen.getByText("复制").click()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hello world")
  })
})
