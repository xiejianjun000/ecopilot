import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { NotifyView } from "@/components/views/notify"

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockImplementation((path: string) => {
    if (path === "/api/notify/platforms") {
      return Promise.resolve({
        ok: true,
        data: {
          platforms: [
            {
              id: "feishu",
              name: "飞书",
              icon: "message-square",
              doc_url: "https://open.feishu.cn/",
              env_keys: ["FEISHU_APP_ID", "FEISHU_APP_SECRET"],
              target_hint: "chat_xxxxxx",
              target_prefix: "chat_",
              maturity: 4,
              description: "飞书群机器人通知",
              configured: true,
              missing_env: [],
            },
            {
              id: "wecom",
              name: "企业微信",
              icon: "send",
              doc_url: "https://developer.work.weixin.qq.com/",
              env_keys: ["WECOM_CORP_ID", "WECOM_AGENT_ID", "WECOM_SECRET"],
              target_hint: "wx_xxxxxx",
              target_prefix: "wx_",
              maturity: 3,
              description: "企业微信群机器人通知",
              configured: false,
              missing_env: ["WECOM_CORP_ID"],
            },
          ],
        },
      })
    }
    if (path === "/api/notify/channels") {
      return Promise.resolve({
        ok: true,
        data: {
          channels: [
            {
              id: "ch-1",
              name: "合规预警群",
              platform: "feishu",
              target: "chat_abc123",
              enabled: true,
              note: "钢铁事业部专用",
              created_at: 1700000000,
              updated_at: 1700000000,
            },
            {
              id: "ch-2",
              name: "整改通知群",
              platform: "wecom",
              target: "wx_def456",
              enabled: false,
              note: "",
              created_at: 1700000001,
              updated_at: 1700000001,
            },
          ],
        },
      })
    }
    return Promise.resolve({ ok: true, data: null })
  }),
  apiPost: vi.fn().mockResolvedValue({ ok: true }),
  apiDelete: vi.fn().mockResolvedValue({ ok: true }),
  getApiBase: () => "http://127.0.0.1:8002",
  ensureAuthToken: vi.fn(),
  authHeaders: () => ({}),
}))

vi.mock("lucide-react", () => {
  const S = () => null
  return {
    Bell: S, BellRing: S, BellOff: S, Send: S, Loader2: S,
    Settings: S, Plus: S, Trash2: S, CheckCircle2: S, XCircle: S,
    ChevronRight: S, ExternalLink: S, RefreshCw: S,
    Check: S, X: S, AlertTriangle: S, MessageSquare: S,
    TestTube: S, Zap: S, ShieldCheck: S, QrCode: S, KeyRound: S,
  }
})

describe("NotifyView", () => {
  it("renders notification list with channels", async () => {
    render(<NotifyView />)

    // 标题
    expect(await screen.findByText("通讯中心")).toBeTruthy()

    // 平台凭证状态
    expect(screen.getByText("平台凭证状态")).toBeTruthy()
    // "飞书" and "企业微信" appear in hero desc AND platform cards
    expect(screen.getAllByText("飞书").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("企业微信").length).toBeGreaterThanOrEqual(1)

    // 渠道列表
    expect(screen.getByText("我的通讯渠道")).toBeTruthy()
    expect(screen.getByText("合规预警群")).toBeTruthy()
    expect(screen.getByText("整改通知群")).toBeTruthy()

    // 已禁用标记
    expect(screen.getByText("已禁用")).toBeTruthy()

    // 凭证缺失标记
    expect(screen.getByText("凭证缺失")).toBeTruthy()

    // 新增渠道按钮
    expect(screen.getByText("新增渠道")).toBeTruthy()
  })

  it("shows channel configuration guide", async () => {
    render(<NotifyView />)

    expect(await screen.findByText("配置引导")).toBeTruthy()
    expect(screen.getByText(/微信（个人号）/)).toBeTruthy()
    expect(screen.getByText(/飞书 \/ 企业微信/)).toBeTruthy()
  })

  it("displays platform credential status counts", async () => {
    render(<NotifyView />)

    expect(await screen.findByText("1/2 已配置")).toBeTruthy()
    expect(screen.getAllByText("已配置").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("待配置")).toBeTruthy()
  })

  it("renders empty channel state", async () => {
    const { apiGet } = await import("@/lib/api")
    vi.mocked(apiGet).mockImplementation((path: string) => {
      if (path === "/api/notify/platforms") {
        return Promise.resolve({
          ok: true,
          data: {
            platforms: [
              {
                id: "feishu",
                name: "飞书",
                icon: "message-square",
                doc_url: "https://open.feishu.cn/",
                env_keys: ["FEISHU_APP_ID", "FEISHU_APP_SECRET"],
                target_hint: "chat_xxxxxx",
                target_prefix: "chat_",
                maturity: 4,
                description: "飞书群机器人通知",
                configured: true,
                missing_env: [],
              },
            ],
          },
        })
      }
      if (path === "/api/notify/channels") {
        return Promise.resolve({ ok: true, data: { channels: [] } })
      }
      return Promise.resolve({ ok: true, data: null })
    })

    render(<NotifyView />)

    expect(await screen.findByText("还没有通讯渠道")).toBeTruthy()
    expect(screen.getByText("添加第一个渠道")).toBeTruthy()
  })
})
