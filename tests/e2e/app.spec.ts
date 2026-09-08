import { test, expect } from "@playwright/test";

test("demonstração local atravessa login, dashboard e pacientes", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  await expect(page.getByText("LOCAL SINTÉTICO", { exact: true })).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Pacientes" }).click();
  await expect(page.getByRole("heading", { name: "Pacientes", exact: true })).toBeVisible();
  await expect(page.getByText("Luna")).toBeVisible();
});

test("rotas e controles permanecem utilizáveis sem overflow", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.locator("#login")).toBeFocused();
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();

  const assertNoOverflow = async () => {
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth
    }));
    expect(dimensions.documentWidth, `document overflow: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.bodyWidth, `body overflow: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.viewport);
  };
  const openMenuIfNeeded = async () => {
    const menu = page.getByRole("button", { name: "Abrir menu" });
    if (await menu.isVisible()) await menu.click();
  };
  const navigate = async (label: string, heading: string) => {
    await openMenuIfNeeded();
    await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: label }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await assertNoOverflow();
  };

  await assertNoOverflow();
  await navigate("Agenda", "Agenda");
  await navigate("Pacientes", "Pacientes");
  await navigate("Atendimento", "Atendimento");
  await navigate("Farmácia", "Estoque");
  await navigate("Financeiro", "Financeiro");
  await navigate("Copiloto", "Copiloto");
  await expect(page.getByLabel("Pedido")).toBeVisible();
  await page.getByLabel("Pedido").fill("organize os pontos de atenção da fila");
  await page.getByRole("button", { name: /Processar turno/i }).click();
  await expect(page.getByText(/Resposta para revisão|Conteúdo retido/)).toBeVisible();

  if (testInfo.project.name === "mobile-375" || testInfo.project.name === "tablet-768") {
    await openMenuIfNeeded();
    await expect(page.locator(".sidebar.sidebar-open")).toBeVisible();
    await page.getByRole("button", { name: "Fechar menu" }).click();
    await expect(page.locator(".sidebar.sidebar-open")).toHaveCount(0);
  }
});

test("captura os limites visuais principais", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  await page.screenshot({ path: `artifacts/runs/${testInfo.project.name}-dashboard.png`, fullPage: false });
});

test("administração expõe concessão e trilha de auditoria", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Administração", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Administração", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Auditoria de negócio", exact: true })).toBeVisible();
  const grant = page.getByRole("button", { name: "Conceder acesso", exact: true });
  await expect(grant).toBeEnabled();
  await grant.click();
  const dialog = page.getByRole("dialog", { name: "Conceder acesso" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-describedby", "grant-description");
  await expect(dialog.getByRole("button", { name: "Fechar" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Confirmar acesso" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Fechar" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Pessoa")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("enters OFFLINE_READ_ONLY without exposing the composer buffer", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Copiloto", exact: true }).click();
  const prompt = page.getByLabel("Pedido");
  await prompt.fill("texto clínico que deve permanecer somente em memória");

  await context.setOffline(true);
  await expect(page.getByRole("region").getByText("OFFLINE_READ_ONLY", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conexão interrompida." })).toBeVisible();
  await expect(page.getByLabel("Pedido")).toHaveCount(0);
  await expect(page.getByText("texto clínico que deve permanecer somente em memória")).toHaveCount(0);

  await context.setOffline(false);
  await expect(page.getByRole("heading", { name: "Copiloto", exact: true })).toBeVisible();
  await expect(page.getByLabel("Pedido")).toHaveValue("texto clínico que deve permanecer somente em memória");
});
