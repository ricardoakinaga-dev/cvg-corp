import { createServer } from "node:net";
import { defineConfig, devices, type Project } from "@playwright/test";

const viewports: Record<string, { width: number; height: number; isMobile: boolean }> = {
  "wide-1440": { width: 1440, height: 1000, isMobile: false },
  "tablet-768": { width: 768, height: 1024, isMobile: false },
  "mobile-375": { width: 375, height: 812, isMobile: true }
};

function configuredPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) throw new Error(`${name} must be a local TCP port`);
  return port;
}

async function ephemeralPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!port) throw new Error("Could not reserve an ephemeral Playwright port");
  return port;
}

function configuredRetries(): number {
  const raw = process.env.PLAYWRIGHT_RETRIES ?? (process.env.CI ? "1" : "0");
  const retries = Number(raw);
  if (!Number.isInteger(retries) || retries < 0 || retries > 2) throw new Error("PLAYWRIGHT_RETRIES must be an integer between 0 and 2");
  return retries;
}

// Keep test-runner knobs outside the CVG_ namespace: the API intentionally
// rejects unknown CVG_* configuration keys at startup.
const requestedWebPort = process.env.PLAYWRIGHT_WEB_PORT ? configuredPort("PLAYWRIGHT_WEB_PORT", 5_173) : await ephemeralPort();
const requestedApiPort = process.env.PLAYWRIGHT_API_PORT ? configuredPort("PLAYWRIGHT_API_PORT", 4_310) : await ephemeralPort();
if (requestedWebPort === requestedApiPort) throw new Error("PLAYWRIGHT_WEB_PORT and PLAYWRIGHT_API_PORT must be different");
const webPort = requestedWebPort;
const apiPort = requestedApiPort;
// Playwright may load this config in the runner and in worker processes. Carry
// the allocation forward so every process uses the same pair of servers.
process.env.PLAYWRIGHT_WEB_PORT = String(webPort);
process.env.PLAYWRIGHT_API_PORT = String(apiPort);

const browserDevices = [
  ["chromium", devices["Desktop Chrome"]],
  ["firefox", devices["Desktop Firefox"]],
  ["webkit", devices["Desktop Safari"]]
] as const;

const browserProjects: Project[] = browserDevices.flatMap(([browser, browserDevice]) => Object.entries(viewports).map(([viewport, settings]) => ({
  name: `${browser}-${viewport}`,
  testIgnore: /accessibility-stress\.spec\.ts/,
  use: { ...browserDevice, viewport: { width: settings.width, height: settings.height }, isMobile: settings.isMobile }
})));

const stressProjects: Project[] = browserDevices.map(([browser, browserDevice]) => ({
  name: browser + "-stress",
  testMatch: /accessibility.*\.spec\.ts/,
  use: {
    ...(browser === "webkit" ? devices["iPhone 13"] : browserDevice),
    viewport: { width: 320, height: 812 },
    deviceScaleFactor: 2,
    hasTouch: browser !== "firefox",
    isMobile: true,
    reducedMotion: "reduce"
  }
}));

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  // A retry is bounded and explicit. Local runs default to zero so a flaky
  // test remains visible; CI may opt into exactly one diagnostic retry.
  retries: configuredRetries(),
  reporter: [["list"], ["html", { outputFolder: "artifacts/playwright-report", open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    storageState: { cookies: [], origins: [] },
    serviceWorkers: "block",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  // The webServer below exposes one disposable in-memory CVG store for the
  // run. Browser contexts never reuse cookies/storage; projects stay serial so
  // synthetic server mutations cannot race each other.
  workers: 1,
  webServer: [
    // The synthetic server is shared by parallel browser projects. Keep its route bucket
    // above the suite's aggregate request volume while leaving production limits unchanged.
    { command: `CVG_HOST=127.0.0.1 CVG_API_PORT=${apiPort} CVG_WEB_ORIGIN=http://127.0.0.1:${webPort} CVG_STORAGE=memory CVG_DEMO_MODE=true CVG_RATE_LIMIT_REQUESTS_PER_WINDOW=10000 npm run dev:api`, url: `http://127.0.0.1:${apiPort}/api/v1/health`, reuseExistingServer: false, timeout: 30_000 },
    { command: `npm run dev:web -- --port ${webPort}`, url: `http://127.0.0.1:${webPort}`, reuseExistingServer: false, timeout: 30_000 }
  ],
  projects: [...browserProjects, ...stressProjects]
});
