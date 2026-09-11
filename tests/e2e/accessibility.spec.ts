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

test("login, dashboard and every primary route remain axe-clean", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
  await expectNoAxeViolations(page, "login");

  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  await expectNoAxeViolations(page, "dashboard");

  const navigate = async (label: string, heading: string, state: string) => {
    const menu = page.getByRole("button", { name: "Abrir menu" });
    if (await menu.isVisible()) await menu.click();
    await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: label }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expectNoAxeViolations(page, state);
  };

  await navigate("Agenda", "Agenda", "agenda");
  await navigate("Pacientes", "Pacientes", "patients");
  await navigate("Atendimento", "Atendimento", "clinical");
  await navigate("Farmácia", "Estoque", "stock");
  await navigate("Financeiro", "Financeiro", "finance");
  await navigate("Copiloto", "Copiloto", "copilot");
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Administração", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Administração", exact: true })).toBeVisible();
  await expectNoAxeViolations(page, "administration");
});

test("mobile navigation isolates the background and restores its trigger", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile-375"), "The navigation drawer is only modal on mobile.");
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await page.getByRole("heading", { name: "Bom dia, Ricardo." }).waitFor();

  const menu = page.getByRole("button", { name: "Abrir menu" });
  const mainShell = page.locator(".main-shell");
  await menu.click();
  await expect(page.getByRole("button", { name: "Fechar menu" })).toBeFocused();
  await expect(mainShell).toHaveAttribute("aria-hidden", "true");
  await expect(mainShell).toHaveJSProperty("inert", true);

  await page.getByRole("button", { name: "Fechar menu" }).click();
  await expect(mainShell).not.toHaveAttribute("aria-hidden", "true");
  await expect(menu).toBeFocused();
});

test("login errors expose a shared field relationship", async ({ page }) => {
  await page.route("**/api/v1/auth/login", async (route) => {
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, error: { code: "UNAUTHENTICATED", message: "Credenciais não conferem." }, correlationId: "a11y-login-error" }) });
  });
  await page.goto("/");
  await page.getByLabel("Senha").fill("incorreta");
  await page.getByRole("button", { name: "Entrar no CVG" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Identificação")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Identificação")).toHaveAttribute("aria-describedby", "login-error");
  await expect(page.getByLabel("Senha")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Senha")).toHaveAttribute("aria-describedby", "login-error");
});
