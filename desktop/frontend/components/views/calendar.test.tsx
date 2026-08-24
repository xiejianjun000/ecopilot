import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"
import { CalendarView } from "@/components/views/calendar"

vi.mock("@/lib/store", () => ({
  useApp: () => ({ state: { activeNav: "calendar" }, dispatch: vi.fn() }),
}))

vi.mock("@/lib/api", () => ({
  getApiBase: () => "http://127.0.0.1:8002",
  apiGet: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  apiPost: vi.fn().mockResolvedValue({ ok: true, tasks: [] }),
  ensureAuthToken: vi.fn(),
  authHeaders: () => ({}),
  getComplianceObligations: vi.fn().mockResolvedValue([]),
}))

vi.mock("lucide-react", () => ({
  ChevronLeft: () => null, ChevronRight: () => null, X: () => null,
  Loader2: () => null, Calendar: () => null, List: () => null,
  Factory: () => null, Recycle: () => null, Package: () => null,
  Trash2: () => null, Activity: () => null, FileText: () => null,
  AlertTriangle: () => null, ShieldAlert: () => null, Clock: () => null,
  Sparkles: () => null, Plus: () => null, ClipboardList: () => null,
  ChevronDown: () => null, Bell: () => null, Send: () => null,
  MapPin: () => null, CheckCircle2: () => null, CalendarIcon: () => null,
}))

vi.mock("@/components/views/calendar/add-event-modal", () => ({
  AddEventModal: () => null,
}))

describe("CalendarView", () => {
  it("renders without crashing", () => {
    const { container } = render(<CalendarView />)
    expect(container.children.length).toBeGreaterThan(0)
  })
  it("has DOM content", () => {
    const { container } = render(<CalendarView />)
    expect(container.innerHTML.length).toBeGreaterThan(50)
  })
})
