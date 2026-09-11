import { expect, test } from "@playwright/test";

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    zoom: Number.parseFloat(document.documentElement.style.zoom || "1") || 1
  }));
  expect(dimensions.documentWidth / dimensions.zoom, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.bodyWidth / dimensions.zoom, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport);
}

test("reflow, reduced motion and DPR remain usable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();

  const capabilities = await page.evaluate(() => ({
    devicePixelRatio: window.devicePixelRatio,
    maxTouchPoints: navigator.maxTouchPoints,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches
  }));
  expect(capabilities.devicePixelRatio).toBe(2);
  expect(capabilities.reducedMotion).toBe(true);
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.keyboard.press("Tab");
  await expect(page.locator("button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible").first()).toBeVisible();
});

test("touch input capability is exposed when the engine supports it", async ({ page }) => {
  await page.goto("/");
  const maxTouchPoints = await page.evaluate(() => navigator.maxTouchPoints);
  test.skip(maxTouchPoints === 0, "This browser engine does not expose touch points in the current environment.");
  expect(maxTouchPoints).toBeGreaterThan(0);
});

test("keyboard focus, live status and high-zoom reflow supplement remain observable", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();

  // CSS zoom is an automated high-zoom supplement.  A real browser 200%
  // accessibility review remains a separate manual/assistive-tech gate.
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await assertZoomState(page);
  await expectNoHorizontalOverflow(page);

  const firstControl = page.locator("button:visible, input:visible, select:visible, textarea:visible").first();
  await firstControl.focus();
  await expect(firstControl).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus-visible")).toBeVisible();

  await page.getByRole("button", { name: "Notificações" }).click();
  await expect(page.getByRole("status")).toContainText("Notificações detalhadas");
});

async function assertZoomState(page: import("@playwright/test").Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.documentElement.style.zoom)).toBe("2");
}
