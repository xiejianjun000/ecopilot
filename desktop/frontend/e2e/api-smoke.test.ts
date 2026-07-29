/**
 * API 冒烟测试 — 针对运行中的 EcoPilot 后端。
 * 运行前需启动: cd desktop/server && python3 chat_api.py
 */
import { describe, it, expect } from "vitest"

const API = "http://127.0.0.1:8002"
const FRONTEND = "http://127.0.0.1:3000"

async function get(path: string, headers?: Record<string, string>) {
  const res = await fetch(`${API}${path}`, { headers })
  const text = await res.text()
  let data: unknown
  try { data = JSON.parse(text) } catch { data = text }
  return { ok: res.ok, status: res.status, data: data as Record<string, unknown> }
}

describe("EcoPilot API 冒烟测试", () => {
  describe("公开端点", () => {
    it("GET /api/chat/health 返回健康状态", async () => {
      const r = await get("/api/chat/health")
      expect(r.ok).toBe(true)
      expect(r.data).toHaveProperty("status")
    })

    it("GET /api/auth/token 返回认证 token", async () => {
      const r = await get("/api/auth/token")
      expect(r.ok).toBe(true)
      expect(r.data).toHaveProperty("token")
      expect(typeof r.data.token).toBe("string")
      expect((r.data.token as string).length).toBeGreaterThan(32)
    })

    it("GET /api/license/status 返回许可证状态", async () => {
      const r = await get("/api/license/status")
      expect(r.status).toBeLessThan(500)
    })
  })

  describe("认证流程", () => {
    it("获取 token 后可访问受保护端点", async () => {
      const tokenRes = await get("/api/auth/token")
      const token = tokenRes.data.token as string

      const r = await get("/api/chat/health", {
        Authorization: `Bearer ${token}`,
      })
      expect(r.ok).toBe(true)
    })

    it("无 token 访问受保护端点返回 401", async () => {
      const r = await get("/api/enterprise")
      expect(r.status).toBe(401)
    })
  })

  describe("前端可达性", () => {
    it("GET / 返回 200", async () => {
      const res = await fetch(FRONTEND)
      expect(res.ok).toBe(true)
    })
  })
})
