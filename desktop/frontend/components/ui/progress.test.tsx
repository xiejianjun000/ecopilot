import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Progress } from "@/components/ui/progress"

describe("Progress", () => {
  it("renders progress bar", () => {
    const { container } = render(<Progress value={50} />)
    const indicator = container.querySelector(".h-full")
    expect(indicator).toBeTruthy()
  })

  it("clamps value to 0-100 range", () => {
    const { container } = render(<Progress value={150} />)
    const indicator = container.querySelector(".h-full") as HTMLElement
    expect(indicator.style.width).toBe("100%")
  })

  it("shows success color at >= 80%", () => {
    const { container } = render(<Progress value={85} />)
    const indicator = container.querySelector(".h-full")
    expect(indicator?.className).toContain("bg-success")
  })

  it("shows warning color at >= 50%", () => {
    const { container } = render(<Progress value={60} />)
    const indicator = container.querySelector(".h-full")
    expect(indicator?.className).toContain("bg-warning")
  })

  it("shows label when showLabel is true", () => {
    render(<Progress value={75} showLabel label="合规进度" />)
    expect(screen.getByText("合规进度")).toBeTruthy()
    expect(screen.getByText("75%")).toBeTruthy()
  })

  it("does not show label by default", () => {
    render(<Progress value={30} />)
    expect(screen.queryByText(/30/)).toBeNull()
  })

  it("merges custom className", () => {
    const { container } = render(<Progress value={10} className="mt-4" />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain("mt-4")
  })
})
