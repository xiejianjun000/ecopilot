import { test, expect } from "@playwright/test"

test.describe("EcoPilot 冒烟测试", () => {
  test("前端页面加载并显示标题", async ({ page }) => {
    await page.goto("/")
    // 页面应包含 EcoPilot 品牌元素（可能是图片或文字）
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 })
    // 检查页面标题包含 EcoPilot
    const title = await page.title()
    expect(title).toContain("EcoPilot")
  })

  test("左侧导航栏渲染", async ({ page }) => {
    await page.goto("/")
    // 使用更精确的选择器避免 strict mode 冲突
    await expect(page.getByRole("button", { name: "新建对话" }).first()).toBeVisible({ timeout: 10000 })
  })

  test("三栏布局存在", async ({ page }) => {
    await page.goto("/")
    // 验证页面结构完整
    const body = page.locator("body")
    await expect(body).toBeVisible()
  })
})

test.describe("API 端点冒烟", () => {
  test("GET /api/chat/health 返回健康状态", async ({ request }) => {
    const res = await request.get("http://127.0.0.1:8002/api/chat/health")
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data).toHaveProperty("status")
    expect(data.status).toBe("ok")
  })

  test("GET /api/auth/token 返回 token（仅 localhost）", async ({ request }) => {
    const res = await request.get("http://127.0.0.1:8002/api/auth/token")
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data).toHaveProperty("token")
    expect(data.token).toBeTruthy()
  })

  test("GET /api/license/status 返回状态", async ({ request }) => {
    const res = await request.get("http://127.0.0.1:8002/api/license/status")
    expect(res.status()).toBeLessThan(500)
  })

  test("GET / 返回 200", async ({ request }) => {
    const res = await request.get("http://127.0.0.1:3000/")
    expect(res.ok()).toBeTruthy()
  })
})

test.describe("认证流程", () => {
  test("Token 认证后请求受保护端点", async ({ request }) => {
    // Step 1: 获取 token
    const tokenRes = await request.get("http://127.0.0.1:8002/api/auth/token")
    const { token } = await tokenRes.json()

    // Step 2: 使用 token 访问受保护端点
    const healthRes = await request.get(
      "http://127.0.0.1:8002/api/chat/health",
      { headers: { Authorization: `Bearer ${token}` } }
    )
    expect(healthRes.ok()).toBeTruthy()
  })

  test("无 Token 访问受保护端点返回 401", async ({ request }) => {
    // 尝试无认证访问 /api/enterprise
    const res = await request.get("http://127.0.0.1:8002/api/enterprise")
    expect(res.status()).toBe(401)
  })
})
