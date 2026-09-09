import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoAxeViolations(page: Page, state: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target)
  }));
  expect(summary, `${state}: ${JSON.stringify(summary, null, 2)}`).toEqual([]);
}

test("login, dashboard and administration remain axe-clean", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
  await expectNoAxeViolations(page, "login");

  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  await expectNoAxeViolations(page, "dashboard");

  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Administração", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Administração", exact: true })).toBeVisible();
  await expectNoAxeViolations(page, "administration");
});
