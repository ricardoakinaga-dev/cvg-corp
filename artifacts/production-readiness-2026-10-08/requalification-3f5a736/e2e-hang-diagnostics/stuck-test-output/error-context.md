# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accessibility-stress.spec.ts >> reflow, reduced motion and DPR remain usable
- Location: tests/e2e/accessibility-stress.spec.ts:14:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.goto: Test timeout of 30000ms exceeded.
Call log:
  - navigating to "http://127.0.0.1:33971/", waiting until "load"

```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  |
  3  | async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  4  |   const dimensions = await page.evaluate(() => ({
  5  |     viewport: document.documentElement.clientWidth,
  6  |     documentWidth: document.documentElement.scrollWidth,
  7  |     bodyWidth: document.body.scrollWidth,
  8  |     zoom: Number.parseFloat(document.documentElement.style.zoom || "1") || 1
  9  |   }));
  10 |   expect(dimensions.documentWidth / dimensions.zoom, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport);
  11 |   expect(dimensions.bodyWidth / dimensions.zoom, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport);
  12 | }
  13 |
  14 | test("reflow, reduced motion and DPR remain usable", async ({ page }) => {
> 15 |   await page.goto("/");
     |              ^ Error: page.goto: Test timeout of 30000ms exceeded.
  16 |   await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
  17 |
  18 |   const capabilities = await page.evaluate(() => ({
  19 |     devicePixelRatio: window.devicePixelRatio,
  20 |     maxTouchPoints: navigator.maxTouchPoints,
  21 |     reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches
  22 |   }));
  23 |   expect(capabilities.devicePixelRatio).toBe(2);
  24 |   expect(capabilities.reducedMotion).toBe(true);
  25 |   await expectNoHorizontalOverflow(page);
  26 |
  27 |   await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  28 |   await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  29 |   await expectNoHorizontalOverflow(page);
  30 |
  31 |   await page.keyboard.press("Tab");
  32 |   await expect(page.locator("button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible").first()).toBeVisible();
  33 | });
  34 |
  35 | test("touch input capability is exposed when the engine supports it", async ({ page }) => {
  36 |   await page.goto("/");
  37 |   const maxTouchPoints = await page.evaluate(() => navigator.maxTouchPoints);
  38 |   test.skip(maxTouchPoints === 0, "This browser engine does not expose touch points in the current environment.");
  39 |   expect(maxTouchPoints).toBeGreaterThan(0);
  40 | });
  41 |
  42 | test("keyboard focus, live status and high-zoom reflow supplement remain observable", async ({ page }) => {
  43 |   await page.setViewportSize({ width: 1280, height: 900 });
  44 |   await page.goto("/");
  45 |   await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
  46 |   await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  47 |   await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  48 |
  49 |   // CSS zoom is an automated high-zoom supplement.  A real browser 200%
  50 |   // accessibility review remains a separate manual/assistive-tech gate.
  51 |   await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  52 |   await assertZoomState(page);
  53 |   await expectNoHorizontalOverflow(page);
  54 |
  55 |   const firstControl = page.locator("button:visible, input:visible, select:visible, textarea:visible").first();
  56 |   await firstControl.focus();
  57 |   await expect(firstControl).toBeFocused();
  58 |   await page.keyboard.press("Tab");
  59 |   await expect(page.locator(":focus-visible")).toBeVisible();
  60 |
  61 |   await page.getByRole("button", { name: "Notificações" }).click();
  62 |   await expect(page.getByRole("status")).toContainText("Notificações detalhadas");
  63 | });
  64 |
  65 | async function assertZoomState(page: import("@playwright/test").Page): Promise<void> {
  66 |   await expect.poll(() => page.evaluate(() => document.documentElement.style.zoom)).toBe("2");
  67 | }
  68 |
```