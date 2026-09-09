import { expect, test } from "@playwright/test";

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth
  }));
  expect(dimensions.documentWidth, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.bodyWidth, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport);
}

test("reflow, reduced motion, DPR and touch remain usable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();

  const capabilities = await page.evaluate(() => ({
    devicePixelRatio: window.devicePixelRatio,
    maxTouchPoints: navigator.maxTouchPoints,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches
  }));
  expect(capabilities.devicePixelRatio).toBe(2);
  expect(capabilities.maxTouchPoints).toBeGreaterThan(0);
  expect(capabilities.reducedMotion).toBe(true);
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.keyboard.press("Tab");
  await expect(page.locator("button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible").first()).toBeVisible();
});
