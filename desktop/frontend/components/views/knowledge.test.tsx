import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"
import { KnowledgeView } from "@/components/views/knowledge"

vi.mock("@/lib/store", () => ({
  useApp: () => ({ state: { activeNav: "knowledge", prefillInput: null }, dispatch: vi.fn() }),
}))

vi.mock("@/lib/api", () => ({
  getApiBase: () => "http://127.0.0.1:8002",
  apiGet: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  apiPost: vi.fn().mockResolvedValue({ ok: true }),
  apiDelete: vi.fn().mockResolvedValue({ ok: true }),
  ensureAuthToken: vi.fn(),
  authHeaders: () => ({}),
}))

vi.mock("react-markdown", () => ({ default: ({ children }: any) => children }))
vi.mock("remark-gfm", () => ({ default: () => {} }))

vi.mock("lucide-react", () => ({
  BookOpen: () => null, Search: () => null, ExternalLink: () => null,
  X: () => null, ChevronDown: () => null, ChevronRight: () => null,
  FileText: () => null, Scale: () => null, AlertTriangle: () => null,
  Tag: () => null, ArrowLeft: () => null, Sparkles: () => null,
  Link2: () => null, Loader2: () => null, Hash: () => null,
  Maximize2: () => null, Network: () => null, Pencil: () => null,
  Plus: () => null, Trash2: () => null, CheckCircle2: () => null,
}))

vi.mock("@/components/views/knowledge-graph", () => ({
  KnowledgeGraph: () => null,
  KnowledgeGraphFullscreen: () => null,
}))

describe("KnowledgeView", () => {
  it("renders without crashing", () => {
    const { container } = render(<KnowledgeView />)
    expect(container.children.length).toBeGreaterThan(0)
  })
})
