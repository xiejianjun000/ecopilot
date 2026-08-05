import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"
import { BrandAnimation } from "@/components/brand-animation"

describe("BrandAnimation", () => {
  it("renders without crashing", () => {
    const { container } = render(<BrandAnimation onDone={vi.fn()} />)
    expect(container.children.length).toBeGreaterThan(0)
  })

  it("renders the official eco logo wordmark", () => {
    const { container } = render(<BrandAnimation onDone={vi.fn()} />)
    const img = container.querySelector("img[alt='EcoPilot']")
    expect(img).toBeTruthy()
    expect(img?.getAttribute("src")).toBe("/eco-logo.svg")
  })
})
