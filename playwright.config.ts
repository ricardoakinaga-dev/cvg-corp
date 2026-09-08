import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "artifacts/playwright-report", open: "never" }]],
  use: { baseURL: "http://127.0.0.1:5173", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: [
    { command: "CVG_HOST=127.0.0.1 CVG_API_PORT=4310 CVG_STORAGE=memory CVG_DEMO_MODE=true npm run dev:api", url: "http://127.0.0.1:4310/api/v1/health", reuseExistingServer: false, timeout: 30_000 },
    { command: "npm run dev:web", url: "http://127.0.0.1:5173", reuseExistingServer: false, timeout: 30_000 }
  ],
  projects: [
    { name: "wide-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "tablet-768", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
    { name: "mobile-375", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, isMobile: true } }
  ]
});
