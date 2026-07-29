import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"
import { InspectionView } from "@/components/views/inspection"

vi.mock("@/lib/store", () => ({
  useApp: () => ({ state: { activeNav: "inspection" }, dispatch: vi.fn() }),
}))

vi.mock("@/lib/api", () => ({
  getApiBase: () => "http://127.0.0.1:8002",
  apiGet: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  apiPost: vi.fn().mockResolvedValue({ ok: true }),
  apiDelete: vi.fn().mockResolvedValue({ ok: true }),
  apiPut: vi.fn().mockResolvedValue({ ok: true }),
  ensureAuthToken: vi.fn(),
  authHeaders: () => ({}),
}))

vi.mock("lucide-react", () => ({
  Zap: () => <span />, Scale: () => <span />, HardHat: () => <span />,
  Upload: () => <span />, Sparkles: () => <span />, Plus: () => <span />,
  X: () => <span />, Clock: () => <span />, AlertTriangle: () => <span />,
  CheckCircle2: () => <span />, FileText: () => <span />, Loader2: () => <span />,
  ShieldCheck: () => <span />, AlertCircle: () => <span />, Lightbulb: () => <span />,
  ChevronDown: () => <span />,
}))

vi.mock("@/components/views/inspection/create-task-modal", () => ({
  CreateTaskModal: () => null,
}))
vi.mock("@/components/views/inspection/upload-inspection-modal", () => ({
  UploadInspectionModal: () => null,
}))
vi.mock("@/components/views/inspection/task-detail", () => ({
  TaskDetail: () => null,
}))

describe("InspectionView", () => {
  it("renders without crashing", () => {
    const { container } = render(<InspectionView />)
    expect(container.children.length).toBeGreaterThan(0)
  })
})
