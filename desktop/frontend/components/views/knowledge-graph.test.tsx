import { describe, it, expect, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { KnowledgeGraph } from "@/components/views/knowledge-graph"

vi.mock("@/lib/utils", () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(" "),
}))

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({ ok: true, data: { ok: true, nodes: [], edges: [] } }),
}))

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as Record<string, any>),
    Network: () => null,
    ZoomIn: () => null,
    ZoomOut: () => null,
    RotateCcw: () => null,
    Loader2: () => null,
    Search: () => null,
    X: () => null,
  }
})

describe("KnowledgeGraph", () => {
  it("renders canvas element (SVG)", async () => {
    const { container } = render(<KnowledgeGraph />)
    await waitFor(() => {
      expect(container.querySelector("svg")).toBeInTheDocument()
    })
  })

  it("shows graph container", async () => {
    const { container } = render(<KnowledgeGraph />)
    await waitFor(() => {
      const wrapper = container.querySelector("div.relative")
      expect(wrapper).toBeInTheDocument()
      expect(wrapper).toHaveClass("relative", "h-full", "w-full", "overflow-hidden", "bg-background")
    })
  })
})
