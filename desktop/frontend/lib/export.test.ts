import { describe, it, expect, vi, beforeEach } from "vitest"

// --- hoisted mock references (needed because vi.mock factories are hoisted) ---
const mocks = vi.hoisted(() => {
  const mockSaveAs = vi.fn()
  const mockToPng = vi.fn(() => Promise.resolve("data:image/png;base64,mock"))
  const mockAddImage = vi.fn()
  const mockAddPage = vi.fn()
  const mockSave = vi.fn()

  return {
    mockSaveAs,
    mockToPng,
    mockJsPDF: vi.fn(function () {
      return {
        addImage: mockAddImage,
        addPage: mockAddPage,
        save: mockSave,
      }
    }),
    mockAddImage,
    mockAddPage,
    mockSave,
  }
})

vi.mock("file-saver", () => ({ saveAs: mocks.mockSaveAs }))
vi.mock("html-to-image", () => ({ toPng: mocks.mockToPng }))
vi.mock("jspdf", () => ({ jsPDF: mocks.mockJsPDF }))

import {
  exportMarkdown,
  exportDocx,
  exportPdfPrint,
  exportPdfImage,
  sanitizeFilename,
} from "./export"

// ---------------------------------------------------------------------------
// sanitizeFilename
// ---------------------------------------------------------------------------
describe("sanitizeFilename", () => {
  it("strips .md extension", () => {
    expect(sanitizeFilename("hello.md")).toBe("hello")
  })

  it("strips .markdown extension", () => {
    expect(sanitizeFilename("doc.markdown")).toBe("doc")
  })

  it("strips .txt extension", () => {
    expect(sanitizeFilename("notes.txt")).toBe("notes")
  })

  it("is case-insensitive when matching extensions", () => {
    expect(sanitizeFilename("README.MD")).toBe("README")
    expect(sanitizeFilename("doc.MarkDown")).toBe("doc")
  })

  it("replaces illegal filename characters with underscores", () => {
    expect(sanitizeFilename("a/b:c*d?e<f>g|h")).toBe("a_b_c_d_e_f_g_h")
  })

  it("replaces backslash", () => {
    expect(sanitizeFilename("a\\b")).toBe("a_b")
  })

  it("replaces all illegal characters including quotes", () => {
    expect(sanitizeFilename('he"llo"')).toBe("he_llo_")
  })

  it("trims leading and trailing whitespace", () => {
    // extension is stripped first; trailing whitespace after .md
    // is not stripped before the extension regex, so .md remains
    expect(sanitizeFilename("  foo  ")).toBe("foo")
  })

  it("trims whitespace around extension", () => {
    expect(sanitizeFilename("  hello.md  ")).toBe("hello.md")
  })

  it("falls back to 未命名文档 when result is empty string", () => {
    expect(sanitizeFilename("")).toBe("未命名文档")
  })

  it("falls back when input is only an extension", () => {
    expect(sanitizeFilename(".md")).toBe("未命名文档")
  })

  it("converts all-illegal-character input to underscores (not empty, so no fallback)", () => {
    expect(sanitizeFilename(":*?")).toBe("___")
  })

  it("strips whitespace around .md extension but does not remove it (trim happens after ext strip)", () => {
    expect(sanitizeFilename("  .md  ")).toBe(".md")
  })

  it("preserves filename with multiple dots and non-markdown extension", () => {
    expect(sanitizeFilename("my.report.md")).toBe("my.report")
  })

  it("returns the input unchanged when it has no extension or illegal chars", () => {
    expect(sanitizeFilename("readme")).toBe("readme")
  })

  it("handles filename with only a dot and no extension", () => {
    expect(sanitizeFilename("foo.")).toBe("foo.")
  })
})

// ---------------------------------------------------------------------------
// exportMarkdown
// ---------------------------------------------------------------------------
describe("exportMarkdown", () => {
  beforeEach(() => {
    mocks.mockSaveAs.mockClear()
  })

  it("creates a Blob with markdown content and calls saveAs with .md suffix", () => {
    exportMarkdown("# Hello", "test-file")

    expect(mocks.mockSaveAs).toHaveBeenCalledTimes(1)
    const [blob, filename] = mocks.mockSaveAs.mock.calls[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe("text/markdown;charset=utf-8")
    expect(filename).toBe("test-file.md")
  })

  it("sets correct blob content", async () => {
    const content = "# Heading\n\nParagraph with **bold**."
    exportMarkdown(content, "test")

    const [blob] = mocks.mockSaveAs.mock.calls[0]
    const text = await (blob as Blob).text()
    expect(text).toBe(content)
  })

  it("handles empty content", () => {
    exportMarkdown("", "empty")

    expect(mocks.mockSaveAs).toHaveBeenCalledTimes(1)
    const [blob] = mocks.mockSaveAs.mock.calls[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe("text/markdown;charset=utf-8")
  })

  it("handles content with special characters", () => {
    exportMarkdown("special <>&\"'`", "safe")

    const [blob] = mocks.mockSaveAs.mock.calls[0]
    expect(blob).toBeInstanceOf(Blob)
  })

  it("handles filename with spaces and special characters", () => {
    exportMarkdown("content", "my report (1)")

    const [, filename] = mocks.mockSaveAs.mock.calls[0]
    expect(filename).toBe("my report (1).md")
  })
})

// ---------------------------------------------------------------------------
// exportDocx
// ---------------------------------------------------------------------------
describe("exportDocx", () => {
  beforeEach(() => {
    mocks.mockSaveAs.mockClear()
  })

  it("wraps htmlContent in Word XML document and calls saveAs with .doc suffix", () => {
    exportDocx("<p>Hello</p>", "report")

    expect(mocks.mockSaveAs).toHaveBeenCalledTimes(1)
    const [blob, filename] = mocks.mockSaveAs.mock.calls[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe("application/msword;charset=utf-8")
    expect(filename).toBe("report.doc")
  })

  it("prepends a UTF-8 BOM (EF BB BF) at the start of the blob", async () => {
    exportDocx("<p>Test</p>", "doc")

    const [blob] = mocks.mockSaveAs.mock.calls[0]
    const buf = await (blob as Blob).arrayBuffer()
    const header = new Uint8Array(buf, 0, 3)
    expect(header).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]))
  })

  it("includes Word XML namespace declarations", async () => {
    exportDocx("<p>Content</p>", "doc")

    const [blob] = mocks.mockSaveAs.mock.calls[0]
    const text = await (blob as Blob).text()
    expect(text).toContain('xmlns:o="urn:schemas-microsoft-com:office:office"')
    expect(text).toContain('xmlns:w="urn:schemas-microsoft-com:office:word"')
  })

  it("includes the Word XML header section", async () => {
    exportDocx("<p>Content</p>", "doc")

    const [blob] = mocks.mockSaveAs.mock.calls[0]
    const text = await (blob as Blob).text()
    expect(text).toContain("<w:WordDocument>")
    expect(text).toContain("DoNotOptimizeForBrowser")
  })

  it("embeds the provided HTML content inside the document body", async () => {
    const html = "<h1>Title</h1><p>Paragraph</p>"
    exportDocx(html, "doc")

    const [blob] = mocks.mockSaveAs.mock.calls[0]
    const text = await (blob as Blob).text()
    expect(text).toContain(`<body>${html}</body>`)
  })

  it("includes A4 page styles", async () => {
    exportDocx("<p>Hello</p>", "doc")

    const [blob] = mocks.mockSaveAs.mock.calls[0]
    const text = await (blob as Blob).text()
    expect(text).toContain("size: A4")
    expect(text).toContain("margin: 2cm")
  })

  it("handles empty htmlContent", async () => {
    exportDocx("", "empty")

    const [blob] = mocks.mockSaveAs.mock.calls[0]
    const text = await (blob as Blob).text()
    expect(text).toContain("<body></body>")
  })

  it("preserves UTF-8 characters in htmlContent", async () => {
    exportDocx("<p>中文 Español 日本語</p>", "utf8")

    const [blob] = mocks.mockSaveAs.mock.calls[0]
    const text = await (blob as Blob).text()
    expect(text).toContain("中文 Español 日本語")
  })
})

// ---------------------------------------------------------------------------
// exportPdfPrint
// ---------------------------------------------------------------------------
describe("exportPdfPrint", () => {
  it("calls window.print() once", () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {})
    try {
      exportPdfPrint()
      expect(printSpy).toHaveBeenCalledTimes(1)
    } finally {
      printSpy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// exportPdfImage
// ---------------------------------------------------------------------------
describe("exportPdfImage", () => {
  const baseElement = { offsetHeight: 1000, offsetWidth: 800 } as HTMLElement

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("calls toPng with the target element and correct options", async () => {
    await exportPdfImage(baseElement, "output")

    expect(mocks.mockToPng).toHaveBeenCalledTimes(1)
    expect(mocks.mockToPng).toHaveBeenCalledWith(
      baseElement,
      expect.objectContaining({
        quality: 0.95,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      }),
    )
  })

  it("creates a single-page A4 PDF and saves it with the correct filename", async () => {
    await exportPdfImage(baseElement, "output")

    expect(mocks.mockJsPDF).toHaveBeenCalledWith("p", "mm", "a4")
    expect(mocks.mockAddImage).toHaveBeenCalled()
    expect(mocks.mockAddPage).not.toHaveBeenCalled()
    expect(mocks.mockSave).toHaveBeenCalledWith("output.pdf")
  })

  it("passes the dataUrl from toPng to addImage", async () => {
    await exportPdfImage(baseElement, "output")

    const dataUrl = mocks.mockAddImage.mock.calls[0][0]
    expect(dataUrl).toBe("data:image/png;base64,mock")
  })

  it("creates additional pages when element height exceeds A4 capacity", async () => {
    const tallElement = { offsetHeight: 12000, offsetWidth: 800 } as HTMLElement

    await exportPdfImage(tallElement, "multi")

    expect(mocks.mockAddPage).toHaveBeenCalled()
    expect(mocks.mockAddPage.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(mocks.mockSave).toHaveBeenCalledWith("multi.pdf")
  })

  it("calls onProgress with snapshot, render, and done in order", async () => {
    const onProgress = vi.fn()

    await exportPdfImage(baseElement, "progress", onProgress)

    expect(onProgress).toHaveBeenCalledTimes(3)
    expect(onProgress.mock.calls[0][0]).toBe("snapshot")
    expect(onProgress.mock.calls[1][0]).toBe("render")
    expect(onProgress.mock.calls[2][0]).toBe("done")
  })

  it("does not throw when onProgress is omitted", async () => {
    await expect(
      exportPdfImage(baseElement, "no-progress"),
    ).resolves.toBeUndefined()
  })

  it("does not throw when onProgress is undefined", async () => {
    await expect(
      exportPdfImage(baseElement, "undefined-cb", undefined),
    ).resolves.toBeUndefined()
  })

  it("filters out nodes with data-print-hide attribute via the toPng filter option", async () => {
    await exportPdfImage(baseElement, "filter")

    const filterFn = mocks.mockToPng.mock.calls[0][1].filter as (
      node: Node,
    ) => boolean

    // HTMLElement with printHide === "true" → filter out (return false)
    const hidden = document.createElement("div")
    hidden.dataset.printHide = "true"
    expect(filterFn(hidden)).toBe(false)

    // plain HTMLElement without printHide → keep (return true)
    const visible = document.createElement("span")
    expect(filterFn(visible)).toBe(true)

    // TextNode (not HTMLElement) → keep (return true)
    expect(filterFn(document.createTextNode("text"))).toBe(true)
  })

  it("handles very wide elements", async () => {
    const wideElement = { offsetHeight: 500, offsetWidth: 2400 } as HTMLElement

    await exportPdfImage(wideElement, "wide")

    expect(mocks.mockAddImage).toHaveBeenCalled()
    expect(mocks.mockSave).toHaveBeenCalledWith("wide.pdf")
  })
})
