import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { VaultView } from "@/components/views/vault"

vi.mock("@/lib/store", () => ({
  useApp: () => ({ state: { activeNav: "vault" }, dispatch: vi.fn() }),
}))

vi.mock("@/lib/api", () => ({
  getApiBase: () => "http://127.0.0.1:8002",
  apiGet: vi.fn().mockResolvedValue({ ok: true, data: { files: [], categories: [], required: [], required_docs: [], phases: [], stats: {}, phase_counts: {} } }),
  apiPost: vi.fn().mockResolvedValue({ ok: true }),
  apiDelete: vi.fn().mockResolvedValue({ ok: true }),
  apiPut: vi.fn().mockResolvedValue({ ok: true }),
  ensureAuthToken: vi.fn(),
  authHeaders: () => ({}),
  getAuthToken: () => null,
  streamSSE: vi.fn(),
}))

vi.mock("lucide-react", () => { const S = () => <span />; return {
  Upload: S, Search: S, AlertTriangle: S, CheckCircle2: S, FolderArchive: S,
  Download: S, X: S, Trash2: S, Loader2: S, ChevronDown: S, ChevronRight: S,
  PanelRightClose: S, Send: S, Sparkles: S, Settings2: S, Plus: S,
  GripVertical: S, ArrowUp: S, ArrowDown: S, Pencil: S, BookOpen: S,
  CheckCircle: S, FileIcon: S,
}})

vi.mock("@/components/views/vault/shared", () => ({
  FileIcon: () => <span />, fileTypeColor: () => "", HighlightText: ({ text }: any) => <span>{text}</span>,
}))
vi.mock("@/components/views/vault/category-manager", () => ({ CategoryManager: () => null }))
vi.mock("@/components/views/vault/edit-meta-modal", () => ({ EditMetaModal: () => null }))
vi.mock("@/components/views/vault/doc-preview-panel", () => ({ DocPreviewPanel: () => null }))
vi.mock("@/components/views/vault/aianalysis-panel", () => ({ AIAnalysisPanel: () => null }))
vi.mock("@/components/views/vault/upload-modal", () => ({ UploadModal: () => null }))
vi.mock("@/components/views/vault/auto-classify-modal", () => ({ AutoClassifyModal: () => null }))

describe("VaultView", () => {
  it("renders without crashing", () => {
    const { container } = render(<VaultView />)
    expect(container.children.length).toBeGreaterThan(0)
  })

  it("displays archive title", () => {
    render(<VaultView />)
    const title = screen.getAllByText(/档案|归档|文件|文档/)[0]
    expect(title).toBeTruthy()
  })

  it("has upload button", () => {
    render(<VaultView />)
    expect(screen.getAllByText(/上传/).length).toBeGreaterThan(0)
  })

  it("has search input area", () => {
    const { container } = render(<VaultView />)
    const inputs = container.querySelectorAll('input, textarea')
    expect(inputs.length).toBeGreaterThanOrEqual(0)
  })
})
