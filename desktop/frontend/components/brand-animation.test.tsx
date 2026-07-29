import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"
import { BrandAnimation } from "@/components/brand-animation"

describe("BrandAnimation", () => {
  it("renders without crashing", () => {
    const { container } = render(<BrandAnimation onDone={vi.fn()} />)
    expect(container.children.length).toBeGreaterThan(0)
  })

  it("has SVG element", () => {
    const { container } = render(<BrandAnimation onDone={vi.fn()} />)
    const svg = container.querySelector("svg")
    expect(svg).toBeTruthy()
  })
})
