import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { Button } from "@/components/ui/button"

// Mock @base-ui/react/button
vi.mock("@base-ui/react/button", () => ({
  Button: ({ children, className, ...props }: any) => (
    <button className={className} {...props}>{children}</button>
  ),
}))

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Click me</Button>)
    expect(screen.getByText("Click me")).toBeTruthy()
  })

  it("applies default variant classes", () => {
    const { container } = render(<Button>Default</Button>)
    const btn = container.querySelector("button")
    expect(btn?.className).toContain("bg-primary")
  })

  it("renders outline variant", () => {
    const { container } = render(<Button variant="outline">Outline</Button>)
    const btn = container.querySelector("button")
    expect(btn?.className).toContain("border-border")
  })

  it("renders ghost variant", () => {
    const { container } = render(<Button variant="ghost">Ghost</Button>)
    const btn = container.querySelector("button")
    expect(btn?.className).toContain("hover:bg-muted")
  })

  it("renders different sizes", () => {
    const { container } = render(<Button size="sm">Small</Button>)
    const btn = container.querySelector("button")
    expect(btn?.className).toContain("h-7")
  })

  it("passes through additional props", () => {
    render(<Button aria-label="close" disabled>Disabled</Button>)
    const btn = screen.getByLabelText("close")
    expect(btn).toBeTruthy()
  })
})
