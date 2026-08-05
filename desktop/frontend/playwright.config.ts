import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/*.spec.ts", "**/*.spec.js"],
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "echo 'E2E: 请先手动启动后端 (cd desktop/server && python3 chat_api.py) 和前端 (pnpm dev)'",
    port: 3000,
    reuseExistingServer: true,
    timeout: 5000,
  },
})
