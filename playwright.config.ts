import { defineConfig, devices } from "@playwright/test";

const viewports = {
  "wide-1440": { width: 1440, height: 1000, isMobile: false },
  "tablet-768": { width: 768, height: 1024, isMobile: false },
  "mobile-375": { width: 375, height: 812, isMobile: true }
} as const;

const browserDevices = [
  ["chromium", devices["Desktop Chrome"]],
  ["firefox", devices["Desktop Firefox"]],
  ["webkit", devices["Desktop Safari"]]
] as const;

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
  projects: browserDevices.flatMap(([browser, browserDevice]) => Object.entries(viewports).map(([viewport, settings]) => ({
    name: `${browser}-${viewport}`,
    use: { ...browserDevice, viewport: { width: settings.width, height: settings.height }, isMobile: settings.isMobile }
  })))
});
