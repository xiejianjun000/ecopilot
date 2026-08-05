import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// ------------------------------------------------------------------ //
// Mocks for server-component external dependencies (hoisted by vitest) //
// ------------------------------------------------------------------ //
vi.mock("geist/font/sans", () => ({
  GeistSans: { variable: "geist-sans" },
}))
vi.mock("geist/font/mono", () => ({
  GeistMono: { variable: "geist-mono" },
}))
vi.mock("katex/dist/katex.min.css", () => ({}))
vi.mock("highlight.js/styles/github.css", () => ({}))
vi.mock("highlight.js/styles/github-dark.css", () => ({}))
vi.mock("@/components/monitor-provider", () => ({
  MonitorProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

// ---- module under test (import after mocks) ---- //
import { metadata, viewport, default as RootLayout } from "./layout"

// ---------------------------------------------------------------- //
// Tests                                                           //
// ---------------------------------------------------------------- //
describe("layout", () => {
  describe("metadata export", () => {
    it("exports metadata with correct title and description", () => {
      expect(metadata).toBeDefined()
      expect(metadata.title).toBe("EcoPilot · 企业生态环境合规AI管家")
      expect(metadata.description).toBe(
        "全生命周期生态环境合规AI管家 — 排污许可 · 碳排放 · 督察整改 · 台账管理",
      )
    })

    it("exports metadata with icon references", () => {
      expect(metadata.icons).toBeDefined()
      expect(metadata.icons).toMatchObject({
        icon: [
          { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
          { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
        apple: "/apple-icon.png",
      })
    })

    it("exports viewport with light/dark theme-color", () => {
      expect(viewport).toBeDefined()
      expect(viewport.colorScheme).toBe("light dark")
      expect(viewport.themeColor).toEqual([
        { media: "(prefers-color-scheme: light)", color: "#ecfdf5" },
        { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
      ])
    })
  })

  describe("RootLayout", () => {
    it("renders children inside the html and body wrapper", () => {
      render(
        <RootLayout>
          <p data-testid="child">Hello, World</p>
        </RootLayout>,
      )

      const child = screen.getByTestId("child")
      expect(child).toBeInTheDocument()
      expect(child).toHaveTextContent("Hello, World")
    })

    it("sets lang attribute to zh-CN", () => {
      render(
        <RootLayout>
          <span>content</span>
        </RootLayout>,
      )

      expect(document.documentElement).toHaveAttribute("lang", "zh-CN")
    })

    it("wraps children in MonitorProvider", () => {
      render(
        <RootLayout>
          <span data-testid="inner">inner</span>
        </RootLayout>,
      )

      // The MonitorProvider mock simply passes children through, so
      // our test child must still be reachable.
      expect(screen.getByTestId("inner")).toBeInTheDocument()
    })
  })
})
