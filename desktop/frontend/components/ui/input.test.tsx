import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Input } from "@/components/ui/input"

// Mock @base-ui/react/input
vi.mock("@base-ui/react/input", () => ({
  Input: ({ className, ...props }: any) => (
    <input className={className} {...props} />
  ),
}))

describe("Input", () => {
  it("renders an input element", () => {
    const { container } = render(<Input placeholder="Enter text" />)
    const input = container.querySelector("input")
    expect(input).toBeTruthy()
    expect(input?.getAttribute("placeholder")).toBe("Enter text")
  })

  it("accepts user typing", () => {
    const { container } = render(<Input />)
    const input = container.querySelector("input")!
    fireEvent.change(input, { target: { value: "hello" } })
    expect(input.value).toBe("hello")
  })

  it("applies disabled state", () => {
    const { container } = render(<Input disabled />)
    const input = container.querySelector("input")
    expect(input?.disabled).toBe(true)
  })

  it("merges custom className", () => {
    const { container } = render(<Input className="w-full" />)
    const input = container.querySelector("input")
    expect(input?.className).toContain("w-full")
  })

  it("passes through aria attributes", () => {
    render(<Input aria-label="Search" aria-invalid={true} />)
    const input = screen.getByLabelText("Search")
    expect(input.getAttribute("aria-invalid")).toBe("true")
  })
})
