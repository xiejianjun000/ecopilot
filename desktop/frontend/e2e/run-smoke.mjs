#!/usr/bin/env node
/**
 * EcoPilot API 冒烟测试 — 快速版（无长时间等待）
 * 运行: node e2e/run-smoke.mjs
 */
const API = "http://127.0.0.1:8002"
const FRONTEND = "http://127.0.0.1:3000"

let passed = 0, failed = 0

async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`) }
}

async function get(path, headers) {
  const res = await fetch(`${API}${path}`, { headers, signal: AbortSignal.timeout(5000) })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { ok: res.ok, status: res.status, data, headers: res.headers }
}

async function tokenAuth(path, opts = {}) {
  const t = await get("/api/auth/token")
  const headers = { Authorization: `Bearer ${t.data.token}`, ...(opts.headers || {}) }
  return fetch(`${API}${path}`, { ...opts, headers, signal: AbortSignal.timeout(5000) })
}

console.log("\n═══ EcoPilot API 冒烟测试 ═══\n")

// ═══ 核心端点 ═══
await test("GET /api/chat/health", async () => {
  const r = await get("/api/chat/health")
  if (!r.ok) throw Error(`HTTP ${r.status}`)
})

await test("GET /api/auth/token", async () => {
  const r = await get("/api/auth/token")
  if (!r.data.token || r.data.token.length < 32) throw Error("bad token")
})

await test("GET /api/license/status", async () => {
  const r = await get("/api/license/status")
  if (r.status >= 500) throw Error(`HTTP ${r.status}`)
})

await test("Auth endpoint works", async () => {
  const t = await get("/api/auth/token")
  const r = await get("/api/chat/health", { Authorization: `Bearer ${t.data.token}` })
  if (!r.ok) throw Error(`HTTP ${r.status}`)
})

await test("No-auth returns 401", async () => {
  const r = await get("/api/enterprise")
  if (r.status !== 401) throw Error(`Expected 401, got ${r.status}`)
})

await test("Frontend HTTP 200", async () => {
  const res = await fetch(FRONTEND, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw Error(`HTTP ${res.status}`)
})

// ═══ 安全头 ═══
await test("CORS headers present", async () => {
  const res = await fetch(`${API}/api/chat/health`, { headers: { Origin: "http://localhost:3000" } })
  if (!res.headers.get("access-control-allow-origin")) throw Error("missing CORS")
})

await test("Security headers present", async () => {
  const res = await fetch(`${API}/api/chat/health`)
  if (!res.headers.get("x-content-type-options")) throw Error("missing XCTO")
  if (!res.headers.get("x-frame-options")) throw Error("missing XFO")
})

await test("Content-Security-Policy present", async () => {
  const res = await fetch(`${API}/api/chat/health`)
  if (!res.headers.get("content-security-policy")) throw Error("missing CSP")
})

// ═══ Vault 端点 ═══
await test("GET /api/vault/list", async () => {
  const res = await tokenAuth("/api/vault/list")
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

await test("GET /api/vault/categories", async () => {
  const res = await tokenAuth("/api/vault/categories")
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

await test("POST /api/vault/upload (no file)", async () => {
  const res = await tokenAuth("/api/vault/upload", { method: "POST" })
  if (res.status !== 422) throw Error(`Expected 422, got ${res.status}`)
})

// ═══ Calendar 端点 ═══
await test("POST /api/calendar/tasks", async () => {
  const res = await tokenAuth("/api/calendar/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "list" }),
  })
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

await test("POST /api/calendar/ledger", async () => {
  const res = await tokenAuth("/api/calendar/ledger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "list" }),
  })
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

await test("GET /api/calendar/templates", async () => {
  const res = await tokenAuth("/api/calendar/templates")
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

// ═══ Ops 端点 ═══
await test("GET /api/ops/dashboard", async () => {
  const res = await tokenAuth("/api/ops/dashboard")
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

// ═══ 数据端点 ═══
await test("GET /api/memory/list", async () => {
  const res = await tokenAuth("/api/memory/list")
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

await test("GET /api/journal/list", async () => {
  const res = await tokenAuth("/api/journal/list")
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

await test("GET /api/models/available", async () => {
  const res = await tokenAuth("/api/models/available")
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

await test("GET /api/mcp-servers", async () => {
  const res = await tokenAuth("/api/mcp-servers")
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

await test("GET /api/permit/dashboard", async () => {
  const res = await tokenAuth("/api/permit/dashboard")
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

await test("GET /api/user", async () => {
  const res = await tokenAuth("/api/user")
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

// ═══ CRUD 端点 ═══
await test("POST /api/chat/tts", async () => {
  const res = await tokenAuth("/api/chat/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "环保合规" }),
  })
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

await test("POST /api/feedback", async () => {
  const res = await tokenAuth("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "测试", contact: "" }),
  })
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

await test("GET /api/notifications", async () => {
  const res = await tokenAuth("/api/notifications")
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

await test("GET /api/notify/platforms", async () => {
  const res = await tokenAuth("/api/notify/platforms")
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

await test("GET /api/notify/channels", async () => {
  const res = await tokenAuth("/api/notify/channels")
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

await test("POST /api/rectification/tasks", async () => {
  const res = await tokenAuth("/api/rectification/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "list" }),
  })
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

await test("POST /api/models/save", async () => {
  const res = await tokenAuth("/api/models/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text_model: "deepseek-chat" }),
  })
  if (res.status !== 200 && res.status !== 400) throw Error(`HTTP ${res.status}`)
})

await test("GET /api/chat/system-prompt", async () => {
  const res = await tokenAuth("/api/chat/system-prompt")
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

await test("GET /api/vault/file (missing id)", async () => {
  const res = await tokenAuth("/api/vault/file")
  if (res.status !== 400 && res.status !== 404) throw Error(`Expected 400/404, got ${res.status}`)
})

await test("POST /api/vault/sync-to-knowledge", async () => {
  const res = await tokenAuth("/api/vault/sync-to-knowledge", { method: "POST" })
  if (res.status !== 200 && res.status !== 422) throw Error(`HTTP ${res.status}`)
})

await test("POST /api/enterprise save", async () => {
  const res = await tokenAuth("/api/enterprise", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "E2E企业" }),
  })
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

await test("POST /api/user save", async () => {
  const res = await tokenAuth("/api/user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "测试", role: "环保专员" }),
  })
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

await test("DELETE /api/memory/nonexistent", async () => {
  const res = await tokenAuth("/api/memory/test-id", { method: "DELETE" })
  if (res.status !== 200 && res.status !== 404) throw Error(`HTTP ${res.status}`)
})

await test("OpenAPI docs accessible", async () => {
  const res = await fetch(`${API}/docs`, { signal: AbortSignal.timeout(5000) })
  if (res.status !== 200) throw Error(`HTTP ${res.status}`)
})

console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══`)
process.exit(failed > 0 ? 1 : 0)
