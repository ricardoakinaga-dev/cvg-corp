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

  if (testInfo.project.name.includes("mobile-375") || testInfo.project.name.includes("tablet-768")) {
    await openMenuIfNeeded();
    await expect(page.locator(".sidebar.sidebar-open")).toBeVisible();
    await page.getByRole("button", { name: "Fechar menu" }).click();
    await expect(page.locator(".sidebar.sidebar-open")).toHaveCount(0);
  }
});

test("agenda alterna períodos e fila por meio de consultas reais", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Agenda" }).click();
  await expect(page.getByRole("heading", { name: "Agenda", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Próximos 7 dias", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Próximos 7 dias", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Visão de fila", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fila de atendimento", exact: true })).toBeVisible();
  await expect(page.getByText("Luna")).toBeVisible();
});

test("revalidação bloqueia conteúdo enquanto /me e /contexts respondem", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Copiloto", exact: true }).click();
  const prompt = page.getByLabel("Pedido");
  await prompt.fill("rascunho clínico que deve permanecer oculto");
  await context.setOffline(true);
  await expect(page.getByRole("heading", { name: "Conexão interrompida." })).toBeVisible();
  await expect(page.getByText("rascunho clínico que deve permanecer oculto")).toHaveCount(0);

  await page.route("**/api/v1/me", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
  await context.setOffline(false);
  await expect(page.getByRole("region", { name: "Estado do ambiente" }).getByText("REVALIDATING", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Pedido")).toHaveCount(0);
  await expect(page.getByText("rascunho clínico que deve permanecer oculto")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Copiloto", exact: true })).toBeVisible();
  await page.unroute("**/api/v1/me");
});

test("busca rápida abre pacientes com filtro e histórico do navegador", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("wide-1440"), "A busca global fica oculta em viewports móveis.");
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  await page.getByLabel("Busca rápida").fill("Luna");
  await page.getByLabel("Busca rápida").press("Enter");
  await expect(page).toHaveURL(/\/patients\?q=Luna$/);
  await expect(page.getByRole("heading", { name: "Pacientes", exact: true })).toBeVisible();
  await expect(page.getByText("Luna")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo.", exact: true })).toBeVisible();
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

test("403 de autorização exibe estado estável sem repetir a solicitação", async ({ page }) => {
  let userRequests = 0;
  await page.route("**/api/v1/users**", async (route) => {
    userRequests += 1;
    await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, error: { code: "FORBIDDEN", message: "A policy negou a operação." }, correlationId: "e2e-permission-denied" }) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Administração", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Acesso não autorizado.", exact: true })).toBeVisible();
  await expect(page.getByText("não repetirá a solicitação automaticamente")).toBeVisible();
  await expect.poll(() => userRequests).toBe(1);
});

test("401 durante uma sessão exibe sessão expirada e oculta o conteúdo", async ({ page }) => {
  let interceptPatients = false;
  await page.route("**/api/v1/patients**", async (route) => {
    if (!interceptPatients) {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, error: { code: "UNAUTHENTICATED", message: "A sessão expirou." }, correlationId: "e2e-session-expired" }) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  interceptPatients = true;
  await page.getByRole("button", { name: "Pacientes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sua sessão expirou.", exact: true })).toBeVisible();
  await expect(page.getByText("Nenhuma escrita crítica foi executada.")).toBeVisible();
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
  await expect(page.getByRole("region", { name: "Estado do ambiente" }).getByText("OFFLINE_READ_ONLY", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conexão interrompida." })).toBeVisible();
  await expect(page.getByLabel("Pedido")).toHaveCount(0);
  await expect(page.getByText("texto clínico que deve permanecer somente em memória")).toHaveCount(0);

  await context.setOffline(false);
  await expect(page.getByRole("heading", { name: "Copiloto", exact: true })).toBeVisible();
  await expect(page.getByLabel("Pedido")).toHaveValue("texto clínico que deve permanecer somente em memória");
});
