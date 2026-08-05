import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { HermesView } from "@/components/views/hermes"

vi.mock("lucide-react", () => ({
  Sparkles: () => <span />,
  Cpu: () => <span />,
  Brain: () => <span />,
  MessageSquare: () => <span />,
  Loader2: () => <span />,
  ChevronDown: () => <span />,
  ChevronRight: () => <span />,
  X: () => <span />,
  Settings: () => <span />,
  RefreshCw: () => <span />,
  Play: () => <span />,
  Pause: () => <span />,
  Trash2: () => <span />,
  BookOpen: () => <span />,
  BarChart3: () => <span />,
  Network: () => <span />,
  Search: () => <span />,
  Check: () => <span />,
  AlertTriangle: () => <span />,
  Wrench: () => <span />,
  Clock: () => <span />,
  Layers: () => <span />,
  Activity: () => <span />,
}))

vi.mock("@/lib/api", () => ({
  getApiBase: () => "http://127.0.0.1:8002",
  apiGet: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  apiPost: vi.fn().mockResolvedValue({ ok: true }),
  apiDelete: vi.fn().mockResolvedValue({ ok: true }),
  apiPut: vi.fn().mockResolvedValue({ ok: true }),
  ensureAuthToken: vi.fn().mockResolvedValue(undefined),
  authHeaders: () => ({}),
}))

vi.mock("@/lib/hermes-client", () => ({
  getCuratorStatus: vi.fn().mockResolvedValue({
    enabled: true,
    runs: 42,
    last_run: "2026-07-29 10:00",
    interval: "1h",
    stale_after: "30d",
    agent_skills_total: 15,
    agent_skills_active: 8,
    agent_skills_stale: 2,
    agent_skills_archived: 5,
    most_active: [{ name: "skill-a", activity: "10" }],
  }),
  triggerCuratorRun: vi.fn(),
  curatorPause: vi.fn(),
  curatorResume: vi.fn(),
  curatorPrune: vi.fn(),
  getSkills: vi.fn().mockResolvedValue({ skills: [], total: 0 }),
  searchSkills: vi.fn(),
  installSkill: vi.fn(),
  uninstallSkill: vi.fn(),
  getJourney: vi.fn(),
  getJourneyStats: vi.fn().mockResolvedValue({
    total_nodes: 50,
    total_edges: 120,
    categories: { programming: 20 },
    states: { active: 30, stale: 10, archived: 10 },
    kinds: {},
  }),
  getInsights: vi.fn().mockResolvedValue({}),
  getHermesHealth: vi.fn().mockResolvedValue({ connected: true, version: "1.0.0" }),
}))

describe("HermesView", () => {
  it("renders without crashing", () => {
    const { container } = render(<HermesView />)
    expect(container.children.length).toBeGreaterThan(0)
  })

  it("shows hermes title", () => {
    render(<HermesView />)
    expect(screen.getByText("🤖 EcoPilot AI 引擎")).toBeDefined()
  })
})
