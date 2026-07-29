import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MdViewer } from "@/components/md-viewer"

// ---------------------------------------------------------------------------
// External dependency mocks
// ---------------------------------------------------------------------------

vi.mock("lucide-react", () => ({
  X: () => <span data-testid="icon-x" />,
  FileText: () => <span data-testid="icon-file-text" />,
  FileDown: () => <span data-testid="icon-file-down" />,
  FileType: () => <span data-testid="icon-file-type" />,
  Printer: () => <span data-testid="icon-printer" />,
  Loader2: () => <span data-testid="icon-loader" />,
  Check: () => <span data-testid="icon-check" />,
}))

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid="react-markdown">{children}</div>
  ),
}))

vi.mock("remark-gfm", () => ({
  default: vi.fn(),
}))

vi.mock("@/lib/export", () => ({
  exportMarkdown: vi.fn(),
  exportDocx: vi.fn(),
  exportPdfPrint: vi.fn(),
  exportPdfImage: vi.fn(),
  sanitizeFilename: vi.fn((name: string) => name.replace(/\.[^.]+$/, "")),
}))

vi.mock("@/lib/utils", () => ({
  cn: (...classes: (string | boolean | undefined | null)[]) =>
    classes.filter(Boolean).join(" "),
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MdViewer", () => {
  const baseProps = {
    open: true,
    file: { name: "test-file.md", content: "# Hello\n\nThis is **markdown** content." },
    onClose: vi.fn(),
  }

  it("renders without crashing with markdown content", () => {
    const { container } = render(<MdViewer {...baseProps} />)
    // Dialog renders panel
    expect(container.querySelector('[role="dialog"]')).toBeTruthy()
    // File name is shown
    expect(screen.getByText("test-file.md")).toBeTruthy()
    // Markdown content is passed through
    expect(screen.getByTestId("react-markdown")).toBeTruthy()
    // Content text appears inside the markdown mock
    expect(screen.getByText(/Hello/)).toBeTruthy()
    // All expected icon-based controls are present
    // FileDown icon appears in two buttons (download MD + screenshot PDF)
    expect(screen.getAllByTestId("icon-file-down")).toHaveLength(2)
    expect(screen.getByTestId("icon-file-type")).toBeTruthy()
    expect(screen.getByTestId("icon-printer")).toBeTruthy()
    expect(screen.getByTestId("icon-x")).toBeTruthy()
  })

  it("returns null when open is false", () => {
    const { container } = render(
      <MdViewer open={false} file={baseProps.file} onClose={vi.fn()} />,
    )
    expect(container.children.length).toBe(0)
  })

  it("returns null when file is null", () => {
    const { container } = render(
      <MdViewer open={true} file={null} onClose={vi.fn()} />,
    )
    expect(container.children.length).toBe(0)
  })

  it("shows placeholder content when file has no content", () => {
    const name = "placeholder.md"
    render(
      <MdViewer
        open={true}
        file={{ name }}
        onClose={vi.fn()}
      />,
    )
    // Fallback text should appear
    expect(screen.getByText(/文件内容正在生成中/)).toBeTruthy()
  })
})
