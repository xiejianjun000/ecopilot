import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Badge } from "@/components/ui/badge"

describe("Badge", () => {
  it("renders text content", () => {
    render(<Badge>New</Badge>)
    expect(screen.getByText("New")).toBeTruthy()
  })

  it("applies default variant classes", () => {
    const { container } = render(<Badge>Default</Badge>)
    const span = container.querySelector("span")
    expect(span?.className).toContain("bg-primary/10")
  })

  it("applies destructive variant", () => {
    const { container } = render(<Badge variant="destructive">Error</Badge>)
    const span = container.querySelector("span")
    expect(span?.className).toContain("text-destructive")
  })

  it("applies success variant", () => {
    const { container } = render(<Badge variant="success">Done</Badge>)
    const span = container.querySelector("span")
    expect(span?.className).toContain("text-success")
  })

  it("merges custom className", () => {
    const { container } = render(<Badge className="ml-2">Custom</Badge>)
    const span = container.querySelector("span")
    expect(span?.className).toContain("ml-2")
  })

  it("passes through HTML attributes", () => {
    render(<Badge aria-label="3 unread messages" id="badge-1">3</Badge>)
    const badge = screen.getByLabelText("3 unread messages")
    expect(badge).toBeTruthy()
    expect(badge.id).toBe("badge-1")
  })
})
