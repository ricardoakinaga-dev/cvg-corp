import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth
  }));
  expect(metrics.documentWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.bodyWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.viewportWidth + 1);
}

test("CVG-AUD21-009: root error emits redacted telemetry and retries by keyboard", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const events: unknown[] = [];
    if (new URL(window.location.href).searchParams.get("cvg_test") === "root-error") {
      (window as Window & { __CVG_TEST_ROOT_ERROR__?: boolean }).__CVG_TEST_ROOT_ERROR__ = true;
    }
    (window as Window & { __cvgRootErrorEvents?: unknown[] }).__cvgRootErrorEvents = events;
    window.addEventListener("cvg:root-error", (event) => events.push((event as CustomEvent).detail));
  });

  await page.goto("/?cvg_test=root-error");
  const panel = page.getByTestId("root-error-boundary");
  await expect(panel).toBeVisible();
  await expect(panel).toBeFocused();
  await expect(page.getByRole("heading", { name: "Algo saiu do previsto." })).toBeVisible();
  // FQ-03: the boundary cannot know whether earlier writes committed, so it must not deny them.
  await expect(page.getByText("confira o registro antes de repetir", { exact: false })).toBeVisible();
  await expect(page.getByText("Nenhum dado foi alterado", { exact: false })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await expect.poll(() => page.evaluate(() => (window as Window & { __cvgRootErrorEvents?: unknown[] }).__cvgRootErrorEvents?.length ?? 0)).toBe(1);
  const event = await page.evaluate(() => (window as Window & { __cvgRootErrorEvents?: Array<Record<string, unknown>> }).__cvgRootErrorEvents?.[0]);
  expect(event).toMatchObject({ event: "web.root_error", errorName: "Error", redacted: true });
  expect(event?.correlationId).toEqual(expect.stringMatching(/^root-error-[A-Za-z0-9._-]+$/));
  expect(event).not.toHaveProperty("message");
  expect(event).not.toHaveProperty("stack");

  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("root-error-boundary.png"), fullPage: true });

  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Tentar novamente", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
});

test("CVG-AUD21-009: home action exits the failed tree", async ({ page }) => {
  await page.addInitScript(() => {
    if (new URL(window.location.href).searchParams.get("cvg_test") === "root-error") {
      (window as Window & { __CVG_TEST_ROOT_ERROR__?: boolean }).__CVG_TEST_ROOT_ERROR__ = true;
    }
  });
  await page.goto("/?cvg_test=root-error");
  const panel = page.getByTestId("root-error-boundary");
  await expect(panel).toBeFocused();
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Voltar ao início", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
});
