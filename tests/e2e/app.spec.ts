import { test, expect } from "@playwright/test";

test("demonstração local atravessa login, dashboard e pacientes", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  await expect(page.locator("#main-content")).toBeFocused();
  await expect(page.getByText("LOCAL SINTÉTICO", { exact: true })).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await expect(page.getByRole("group", { name: /Espaço ativo:/ })).toBeVisible();
  await page.getByRole("button", { name: "Pacientes" }).click();
  await expect(page.getByRole("heading", { name: "Pacientes", exact: true })).toBeVisible();
  await expect(page.getByText("Luna")).toBeVisible();
});

test("troca de contexto no menu móvel fecha o drawer e preserva o foco", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile-375"), "A troca de contexto no drawer é específica do viewport móvel.");
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  await menu.click();
  const contextSelect = page.getByLabel("Selecionar unidade e workspace");
  await contextSelect.selectOption({ label: "Unidade Sul · Operação clínica" });
  await expect(page.getByText("Aqui está o pulso da Unidade Sul.", { exact: true })).toBeVisible();
  await expect(page.locator(".sidebar.sidebar-open")).toHaveCount(0);
  await expect(page.locator("#cvg-mobile-nav")).toHaveAttribute("aria-hidden", "true");
  await expect(menu).toBeFocused();
});

test("rotas e controles permanecem utilizáveis sem overflow", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
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
    await expect(page.locator("main.content")).toBeFocused();
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
  await expect(page.locator("tbody td:nth-child(3)").first()).toBeVisible();
  await expect(page.locator("tbody td:nth-child(4)").first()).toBeVisible();
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

test("skip link and global search expose a visible keyboard focus", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("wide-1440"), "A busca global fica oculta em viewports móveis.");
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.locator("#main-content")).toBeFocused();
  await expect(page.locator("#main-content")).toHaveCSS("outline-style", "solid");

  const skipLink = page.getByRole("link", { name: "Pular para o conteúdo principal" });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toHaveCSS("transform", /matrix/);

  const search = page.getByLabel("Busca rápida");
  await search.focus();
  await expect(search.locator("..")).toHaveCSS("border-bottom-color", "rgb(12, 149, 136)");
  await expect(search).toHaveCSS("outline-style", "solid");
});

test("captura os limites visuais principais", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  await expect(page.getByText("Hoje na agenda", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Próximos atendimentos", exact: true })).toBeVisible();
  await page.screenshot({ path: `artifacts/runs/${testInfo.project.name}-dashboard.png`, fullPage: false });
  if (testInfo.project.name === "chromium-tablet-768") {
    const menu = page.getByRole("button", { name: "Abrir menu" });
    if (await menu.isVisible()) await menu.click();
    await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Agenda" }).click();
    await expect(page.getByRole("heading", { name: "Agenda", exact: true })).toBeVisible();
    await expect(page.locator(".sidebar.sidebar-open")).toHaveCount(0);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `artifacts/runs/${testInfo.project.name}-agenda.png`, fullPage: false });
  }
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

test("aviso não encolhe a área principal e permanece dispensável pelo teclado", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();

  const measure = () => page.evaluate(() => {
    const main = document.querySelector<HTMLElement>(".main-shell");
    const toast = document.querySelector<HTMLElement>(".toast");
    return {
      viewport: window.innerWidth,
      mainWidth: main?.getBoundingClientRect().width ?? 0,
      documentWidth: document.documentElement.scrollWidth,
      toastWidth: toast?.getBoundingClientRect().width ?? 0
    };
  });

  const before = await measure();
  await page.getByRole("button", { name: "Notificações" }).click();
  const toast = page.locator(".toast");
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Notificações detalhadas");
  const after = await measure();
  expect(after.mainWidth).toBeGreaterThanOrEqual(after.viewport * 0.55);
  expect(after.documentWidth).toBeLessThanOrEqual(after.viewport);
  expect(after.toastWidth).toBeGreaterThan(0);
  expect(Math.abs(after.mainWidth - before.mainWidth)).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Notificações" }).click();
  const repeated = await measure();
  expect(repeated.mainWidth).toBeGreaterThanOrEqual(repeated.viewport * 0.55);

  await page.getByRole("button", { name: "Fechar aviso" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".toast")).toHaveCount(0);
  await expect(page.locator("#main-content")).toBeFocused();

  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Financeiro", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Financeiro", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Exportar" }).click();
  await expect(page.locator(".toast")).toBeVisible();
  await expect(page.locator(".toast-message")).toHaveAttribute("aria-live", "polite");
  const long = await measure();
  expect(long.mainWidth).toBeGreaterThanOrEqual(long.viewport * 0.55);
  expect(long.documentWidth).toBeLessThanOrEqual(long.viewport);
});

test("saldo financeiro respeita o contrato e cobrança PAID não entra no aberto", async ({ page }) => {
  await page.route("**/api/v1/finance/charges**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: 1,
        data: {
          items: [{ id: "00000000-0000-4000-8000-000000000101", description: "Consulta sintética", amountCents: 10000, currency: "BRL", status: "PAID", createdAt: "2026-09-13T12:00:00.000Z" }],
          balance: { currency: "BRL", chargedCents: 10000, settledPaymentCents: 10000, pendingCents: 0, state: "PAID", refunds: { status: "NOT_APPLICABLE", amountCents: null }, observedAt: "2026-09-13T12:00:00.000Z" }
        },
        correlationId: "e2e-finance-paid"
      })
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Financeiro", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Financeiro", exact: true })).toBeVisible();
  await expect(page.getByText("EM ABERTO · VISÃO LOCAL")).toBeVisible();
  await expect(page.locator(".finance-summary strong")).toHaveText("R$ 0,00");
  await expect(page.getByText("Pago", { exact: true })).toBeVisible();
});

test("payload financeiro incompatível não chega ao estado da interface", async ({ page }) => {
  await page.route("**/api/v1/finance/charges**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ schemaVersion: 1, data: { items: "not-an-array", balance: null }, correlationId: "e2e-finance-invalid" })
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Financeiro", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Financeiro", exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "incompatíveis com o contrato" })).toBeVisible();
  await expect(page.getByText("Contas em aberto")).toHaveCount(0);
});

test("logout online confirma a revogação e não reaparece autenticado", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
  await expect(page.getByText("revogação desta sessão no servidor ainda não foi confirmada")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toHaveCount(0);
});

test("logout offline mantém a revogação pendente visível após reconectar e recarregar", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByRole("region", { name: "Estado do ambiente" }).getByText("OFFLINE_READ_ONLY", { exact: true })).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
  await expect(page.getByText("revogação desta sessão no servidor ainda não foi confirmada")).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByRole("region", { name: "Estado do ambiente" }).getByText("OFFLINE_READ_ONLY", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
  await page.getByRole("button", { name: "Tentar revogar novamente" }).click();
  await expect(page.getByText("revogação desta sessão no servidor ainda não foi confirmada")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
  await expect(page.getByText("revogação desta sessão no servidor ainda não foi confirmada")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toHaveCount(0);
});

test("falha do servidor no logout mostra pendência em vez de sucesso falso", async ({ page }) => {
  await page.route("**/api/v1/auth/logout", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, error: { code: "DEPENDENCY_UNAVAILABLE", message: "Logout indisponível." }, correlationId: "e2e-logout-503" }) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page.getByText("revogação desta sessão no servidor ainda não foi confirmada")).toBeVisible();
  await page.unroute("**/api/v1/auth/logout");
  await page.getByRole("button", { name: "Tentar revogar novamente" }).click();
  await expect(page.getByText("revogação desta sessão no servidor ainda não foi confirmada")).toHaveCount(0);
});

const mfaSessionPayload = {
  user: { id: "00000000-0000-4000-8000-000000000001", displayName: "Ricardo", email: "admin@cvg.local", status: "ACTIVE" },
  contexts: [{ organization: { id: "00000000-0000-4000-8000-000000000010", name: "CVG", slug: "cvg" }, unit: { id: "00000000-0000-4000-8000-000000000020", name: "Unidade Centro", code: "CENTRO" }, workspace: { id: "00000000-0000-4000-8000-000000000030", name: "Operação clínica", purpose: "clinical" }, roles: ["admin"] }],
  csrfToken: "synthetic-csrf-token"
};

test("login com challenge MFA aceita código, nega OTP inválido e permite cancelar", async ({ page }) => {
  const challengeId = "m".repeat(32);
  await page.route("**/api/v1/auth/demo", async (route) => {
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, data: { mfaRequired: true, challengeId, expiresAt: new Date(Date.now() + 120_000).toISOString() }, correlationId: "e2e-mfa-challenge" }) });
  });
  await page.route("**/api/v1/auth/mfa/verify", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { code?: string };
    if (body.code === "123456") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, data: mfaSessionPayload, correlationId: "e2e-mfa-verified" }) });
    } else {
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, error: { code: "MFA_INVALID", message: "O código MFA é inválido." }, correlationId: "e2e-mfa-invalid" }) });
    }
  });
  // The mocked MFA login never creates a server session, so every post-login
  // read must be fulfilled locally; otherwise a real 401 races the assertion
  // and flips the shell into REAUTH_REQUIRED.
  await page.route("**/api/v1/me", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, data: mfaSessionPayload.user, correlationId: "e2e-mfa-me" }) });
  });
  await page.route("**/api/v1/contexts", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, data: mfaSessionPayload.contexts, correlationId: "e2e-mfa-contexts" }) });
  });
  await page.route("**/api/v1/operations/summary", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, data: { appointmentsToday: 2, waitingPatients: 1, lowStockItems: 0, openCharges: 0, ai: { provider: "local", tools: 6 }, unit: "Unidade Centro" }, correlationId: "e2e-mfa-summary" }) });
  });
  await page.route("**/api/v1/appointments", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, data: { items: [] }, correlationId: "e2e-mfa-appointments" }) });
  });
  await page.route("**/api/v1/patients", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, data: { items: [] }, correlationId: "e2e-mfa-patients" }) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Verificação em duas etapas" })).toBeVisible();
  await expect(page.locator("#mfa-code")).toBeFocused();
  await page.locator("#mfa-code").fill("000000");
  await page.getByRole("button", { name: "Confirmar código" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "O código MFA é inválido." })).toBeVisible();
  await expect(page.getByText(/Cannot read properties/)).toHaveCount(0);
  await page.getByRole("button", { name: "Cancelar e voltar" }).click();
  await expect(page.locator("#login")).toBeVisible();
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.locator("#mfa-code")).toBeFocused();
  await page.locator("#mfa-code").fill("123456");
  await page.getByRole("button", { name: "Confirmar código" }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
});

test("challenge MFA expirado não confirma e oferece retorno", async ({ page }) => {
  const challengeId = "n".repeat(32);
  await page.route("**/api/v1/auth/demo", async (route) => {
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, data: { mfaRequired: true, challengeId, expiresAt: new Date(Date.now() + 1_000).toISOString() }, correlationId: "e2e-mfa-expired" }) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByText(/Código expirado/)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("button", { name: "Confirmar código" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancelar e voltar" }).click();
  await expect(page.locator("#login")).toBeVisible();
});

test("challenge MFA bloqueado depois de tentativas inválidas volta ao login", async ({ page }) => {
  const challengeId = "l".repeat(32);
  await page.route("**/api/v1/auth/demo", async (route) => {
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, data: { mfaRequired: true, challengeId, expiresAt: new Date(Date.now() + 120_000).toISOString() }, correlationId: "e2e-mfa-locked" }) });
  });
  await page.route("**/api/v1/auth/mfa/verify", async (route) => {
    await route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, error: { code: "ACCOUNT_LOCKED", message: "O desafio atingiu o limite de tentativas." }, correlationId: "e2e-mfa-locked-verify" }) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.locator("#mfa-code")).toBeFocused();
  await page.locator("#mfa-code").fill("111111");
  await page.getByRole("button", { name: "Confirmar código" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Inicie o login novamente." })).toBeVisible();
  await expect(page.locator("#login")).toBeVisible();
});

test("saldo parcial e estorno indefinido têm estado explícito no financeiro", async ({ page }) => {
  const partial = { currency: "BRL", chargedCents: 10000, settledPaymentCents: 4000, pendingCents: 6000, state: "PARTIALLY_PAID", refunds: { status: "NOT_APPLICABLE", amountCents: null }, observedAt: "2026-09-13T12:00:00.000Z" };
  const unresolved = { currency: "BRL", chargedCents: 10000, settledPaymentCents: 10000, pendingCents: null, state: "REQUIRES_POLICY", refunds: { status: "UNRESOLVED", amountCents: null }, observedAt: "2026-09-13T12:00:00.000Z" };
  type BalanceFixture = { currency: string; chargedCents: number; settledPaymentCents: number; pendingCents: number | null; state: string; refunds: { status: string; amountCents: number | null }; observedAt: string };
  let balance: BalanceFixture = partial;
  await page.route("**/api/v1/finance/charges**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: 1,
        data: {
          items: [{ id: "00000000-0000-4000-8000-000000000102", description: "Cobrança parcial", amountCents: 10000, currency: "BRL", status: "PARTIALLY_PAID", createdAt: "2026-09-13T12:00:00.000Z" }],
          balance
        },
        correlationId: "e2e-finance-state"
      })
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Financeiro", exact: true }).click();
  await expect(page.locator(".finance-summary strong")).toHaveText("R$ 60,00");
  await expect(page.getByText("Parcial", { exact: true })).toBeVisible();

  balance = unresolved;
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Visão geral", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Bom dia, Ricardo./ })).toBeVisible();
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Financeiro", exact: true }).click();
  await expect(page.getByText("SALDO NÃO AFIRMADO · POLÍTICA DE ESTORNO PENDENTE")).toBeVisible();
  await expect(page.locator(".finance-summary strong")).toHaveText("Em análise");
});

test.describe("agenda derivada do contexto e do relógio", () => {
  test.use({ timezoneId: "America/Sao_Paulo" });

  const openAgenda = async (page: import("@playwright/test").Page) => {
    const menu = page.getByRole("button", { name: "Abrir menu" });
    if (await menu.isVisible()) await menu.click();
    await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Agenda" }).click();
    await expect(page.getByRole("heading", { name: "Agenda", exact: true })).toBeVisible();
  };

  test("dia, semana e unidade seguem contexto e relógio, inclusive virada de dia", async ({ page }) => {
    const appointmentRequest = page.waitForRequest((request) => new URL(request.url()).pathname.endsWith("/appointments"));
    await page.clock.install({ time: new Date("2026-09-16T02:59:50Z") });
    await page.clock.pauseAt(new Date("2026-09-16T02:59:50Z"));
    await page.goto("/");
    await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
    await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
    await openAgenda(page);
    await expect(page.getByText("15 SET · UNIDADE CENTRO")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Terça-feira", exact: true })).toBeVisible();

    const centroHeaders = (await appointmentRequest).headers();
    const reservations = await page.evaluate(async (scope) => {
      const headers: Record<string, string> = {
        "content-type": "application/json", "x-cvg-unit-id": scope["x-cvg-unit-id"]!, "x-cvg-workspace-id": scope["x-cvg-workspace-id"]!,
        "x-csrf-token": decodeURIComponent(document.cookie.split("; ").find((value) => value.startsWith("cvg_csrf="))!.split("=")[1]!)
      };
      const read = async (path: string) => {
        const response = await fetch(`/api/v1${path}`, { headers });
        if (!response.ok) throw new Error(`Fixture read failed: ${response.status} ${await response.text()}`);
        const payload = await response.json();
        if (!payload?.data) throw new Error(`Fixture read without data: ${path} ${JSON.stringify(payload).slice(0, 300)}`);
        return payload.data;
      };
      const patients = await read("/patients");
      const options = await read("/scheduling/options");
      const ids: string[] = [];
      for (const [index, startsAt] of ["2026-09-16T02:59:59.999Z", "2026-09-16T03:00:00.000Z"].entries()) {
        const response = await fetch("/api/v1/appointments", { method: "POST", headers: { ...headers, "Idempotency-Key": `midnight-membership-${index}` }, body: JSON.stringify({
          patientId: patients.items[0].id, providerId: options.providers[0].id, serviceId: options.services[0].id, resourceId: null,
          startsAt, endsAt: new Date(Date.parse(startsAt) + 1).toISOString(), purpose: `Midnight membership ${index}`
        }) });
        if (response.status !== 201) throw new Error(`Fixture reservation failed: ${response.status} ${await response.text()}`);
        ids.push((await response.json()).data.appointment.id);
      }
      return ids;
    }, centroHeaders);
    await page.getByRole("button", { name: "Atualizar" }).click();
    await expect(page.locator("tr", { hasText: "Midnight membership 0" })).toBeVisible();
    await expect(page.locator("tr", { hasText: "Midnight membership 1" })).toHaveCount(0);

    const midnightRead = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith("/appointments") && url.searchParams.get("startsAt") === "2026-09-16T03:00:00.000Z";
    });
    await page.clock.runFor(10_001);
    expect((await midnightRead).status()).toBe(200);
    await expect(page.getByText("16 SET · UNIDADE CENTRO")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Quarta-feira", exact: true })).toBeVisible();
    await expect(page.locator("tr", { hasText: "Midnight membership 1" })).toBeVisible();
    await expect(page.locator("tr", { hasText: "Midnight membership 0" })).toHaveCount(0);

    await page.getByRole("button", { name: "Próximos 7 dias" }).click();
    await expect(page.getByText("16 SET–22 SET · UNIDADE CENTRO")).toBeVisible();
    await expect(page.locator("tr", { hasText: "Midnight membership 1" })).toBeVisible();

    const menu = page.getByRole("button", { name: "Abrir menu" });
    if (await menu.isVisible()) await menu.click();
    await page.getByLabel("Selecionar unidade e workspace").selectOption({ label: "Unidade Sul · Operação clínica" });
    await expect(page.getByText("16 SET · UNIDADE SUL")).toBeVisible();
    await expect(page.locator("tr", { hasText: "Midnight membership 1" })).toHaveCount(0);
  });

  test("meia-noite inexistente mantém limites e reservas do dia e da semana", async ({ page }) => {
    const instant = new Date("2018-11-04T12:00:00Z");
    await page.clock.install({ time: instant });
    await page.clock.pauseAt(instant);
    await page.goto("/");
    await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
    await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
    const initialRead = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith("/appointments") && url.searchParams.has("startsAt");
    });
    await openAgenda(page);
    const initialResponse = await initialRead;
    expect(initialResponse.status()).toBe(200);
    expect(new URL(initialResponse.url()).searchParams.get("startsAt")).toBe("2018-11-04T03:00:00.000Z");
    expect(new URL(initialResponse.url()).searchParams.get("endsAt")).toBe("2018-11-05T02:00:00.000Z");
    const ids = await page.evaluate(async (scope) => {
      const headers: Record<string, string> = {
        "content-type": "application/json", "x-cvg-unit-id": scope["x-cvg-unit-id"]!, "x-cvg-workspace-id": scope["x-cvg-workspace-id"]!,
        "x-csrf-token": decodeURIComponent(document.cookie.split("; ").find((value) => value.startsWith("cvg_csrf="))!.split("=")[1]!)
      };
      const read = async (path: string) => {
        const response = await fetch(`/api/v1${path}`, { headers });
        if (!response.ok) throw new Error(`Fixture read failed: ${response.status}`);
        return (await response.json()).data;
      };
      const patients = await read("/patients");
      const options = await read("/scheduling/options");
      const result: string[] = [];
      const instants = ["2018-11-04T03:00:00.000Z", "2018-11-05T01:59:59.999Z", "2018-11-05T02:00:00.000Z", "2018-11-11T01:59:59.999Z", "2018-11-11T02:00:00.000Z"];
      for (const [index, startsAt] of instants.entries()) {
        const response = await fetch("/api/v1/appointments", { method: "POST", headers: { ...headers, "Idempotency-Key": `skipped-midnight-2018-${index}` }, body: JSON.stringify({
          patientId: patients.items[0].id, providerId: options.providers[0].id, serviceId: options.services[0].id, resourceId: null,
          startsAt, endsAt: new Date(Date.parse(startsAt) + 1).toISOString(), purpose: `Skipped midnight ${index}`
        }) });
        if (response.status !== 201) throw new Error(`Fixture reservation failed: ${response.status} ${await response.text()}`);
        result.push((await response.json()).data.appointment.id);
      }
      return result;
    }, initialResponse.request().headers());
    const readWindow = (start: string, end: string) => page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith("/appointments") && url.searchParams.get("startsAt") === start && url.searchParams.get("endsAt") === end;
    });
    const today = readWindow("2018-11-04T03:00:00.000Z", "2018-11-05T02:00:00.000Z");
    await page.getByRole("button", { name: "Atualizar" }).click();
    expect((await (await today).json()).data.items.map((item: { id: string }) => item.id)).toEqual(ids.slice(0, 2));
    await expect(page.getByText("04 NOV · UNIDADE CENTRO")).toBeVisible();
    await expect(page.locator("tr", { hasText: "Skipped midnight 1" })).toBeVisible();
    await expect(page.locator("tr", { hasText: "Skipped midnight 2" })).toHaveCount(0);
    const week = readWindow("2018-11-04T03:00:00.000Z", "2018-11-11T02:00:00.000Z");
    await page.getByRole("button", { name: "Próximos 7 dias" }).click();
    expect((await (await week).json()).data.items.map((item: { id: string }) => item.id)).toEqual(ids.slice(0, 4));
    await expect(page.getByText("04 NOV–10 NOV · UNIDADE CENTRO")).toBeVisible();
    await expect(page.locator("tr", { hasText: "Skipped midnight 3" })).toBeVisible();
    await expect(page.locator("tr", { hasText: "Skipped midnight 4" })).toHaveCount(0);
    await page.getByRole("button", { name: "Hoje" }).click();
    await expect(page.locator("tr", { hasText: "Skipped midnight 1" })).toBeVisible();
    const midnight = readWindow("2018-11-05T02:00:00.000Z", "2018-11-06T02:00:00.000Z");
    await page.clock.fastForward(14 * 60 * 60_000);
    expect((await (await midnight).json()).data.items.map((item: { id: string }) => item.id)).toEqual([ids[2]]);
    await expect(page.getByText("05 NOV · UNIDADE CENTRO")).toBeVisible();
    await expect(page.locator("tr", { hasText: "Skipped midnight 2" })).toBeVisible();
    await expect(page.locator("tr", { hasText: "Skipped midnight 1" })).toHaveCount(0);
  });

  test.describe("limites de calendário com DST", () => {
    test.use({ timezoneId: "America/New_York" });
    for (const sample of [
      { clock: "2030-03-09T17:00:00Z", start: "2030-03-09T05:00:00.000Z", end: "2030-03-16T04:00:00.000Z", label: "09 MAR–15 MAR · UNIDADE CENTRO" },
      { clock: "2030-11-02T16:00:00Z", start: "2030-11-02T04:00:00.000Z", end: "2030-11-09T05:00:00.000Z", label: "02 NOV–08 NOV · UNIDADE CENTRO" }
    ]) {
      test(`semana usa dias locais: ${sample.clock}`, async ({ page }) => {
        const rangeRequest = page.waitForRequest((request) => new URL(request.url()).pathname.endsWith("/appointments"));
        await page.clock.setFixedTime(new Date(sample.clock));
        await page.goto("/");
        await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
        await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
        await openAgenda(page);
        const scopeHeaders = (await rangeRequest).headers();
        const seededIds = await page.evaluate(async ({ scope, tag }) => {
          const headers: Record<string, string> = {
            "content-type": "application/json", "x-cvg-unit-id": scope["x-cvg-unit-id"]!, "x-cvg-workspace-id": scope["x-cvg-workspace-id"]!,
            "x-csrf-token": decodeURIComponent(document.cookie.split("; ").find((value) => value.startsWith("cvg_csrf="))!.split("=")[1]!)
          };
          const read = async (path: string) => {
            const response = await fetch(`/api/v1${path}`, { headers });
            if (!response.ok) throw new Error(`Fixture read failed: ${response.status} ${await response.text()}`);
            const payload = await response.json();
            if (!payload?.data) throw new Error(`Fixture read without data: ${path}`);
            return payload.data;
          };
          const patients = await read("/patients");
          const options = await read("/scheduling/options");
          const ids: string[] = [];
          for (const [index, startsAt] of tag.instants.entries()) {
            const response = await fetch("/api/v1/appointments", { method: "POST", headers: { ...headers, "Idempotency-Key": `dst-membership-${tag.key}-${index}` }, body: JSON.stringify({
              patientId: patients.items[0].id, providerId: options.providers[0].id, serviceId: options.services[0].id, resourceId: null,
              startsAt, endsAt: new Date(Date.parse(startsAt) + 1).toISOString(), purpose: `DST membership ${tag.key} ${index}`
            }) });
            if (response.status !== 201) throw new Error(`Fixture reservation failed: ${response.status} ${await response.text()}`);
            ids.push((await response.json()).data.appointment.id);
          }
          return ids;
        }, { scope: scopeHeaders, tag: { key: sample.start, instants: [sample.start, sample.end] } });
        const read = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return url.pathname.endsWith("/appointments") && url.searchParams.get("endsAt") === sample.end;
        });
        await page.getByRole("button", { name: "Próximos 7 dias" }).click();
        const response = await read;
        expect(response.status()).toBe(200);
        expect(new URL(response.url()).searchParams.get("startsAt")).toBe(sample.start);
        const returned = (await response.json()).data.items.map((item: { id: string }) => item.id);
        expect(returned).toContain(seededIds[0]);
        expect(returned).not.toContain(seededIds[1]);
        await expect(page.getByText(sample.label)).toBeVisible();
        await expect(page.locator("tr", { hasText: `DST membership ${sample.start} 0` })).toBeVisible();
        await expect(page.locator("tr", { hasText: `DST membership ${sample.start} 1` })).toHaveCount(0);
      });
    }
  });

  for (const mode of ["success", "error"] as const) {
    test(`troca de contexto controlada com resposta atrasada do contexto antigo (${mode})`, async ({ page }) => {
      const seenUnits: string[] = [];
      let releaseOldContext = () => {};
      const oldContextRelease = new Promise<void>((resolve) => { releaseOldContext = resolve; });
      let staleContextReadArmed = false;
      const staleRow = { id: "00000000-0000-4000-8000-00000000d401", startsAt: "2033-05-19T12:00:00Z", endsAt: "2033-05-19T12:30:00Z", purpose: "Reserva Antiga Central", status: "SCHEDULED", version: 1, patient: { name: "Paciente Antigo" } };
      await page.route("**/api/v1/appointments**", async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get("endsAt") !== "2033-05-20T03:00:00.000Z") { await route.continue(); return; }
        const unit = route.request().headers()["x-cvg-unit-id"] ?? "";
        if (!seenUnits.includes(unit)) seenUnits.push(unit);
        if (unit !== seenUnits[0]) { await route.continue(); return; }
        if (staleContextReadArmed) {
          staleContextReadArmed = false;
          await oldContextRelease;
          if (mode === "success") {
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, data: { items: [staleRow] }, correlationId: "ctx-stale-success" }) });
            return;
          }
          await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, error: { code: "DEPENDENCY_UNAVAILABLE", message: "Agenda indisponível." }, correlationId: "ctx-stale-error" }) });
          return;
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, data: { items: [staleRow] }, correlationId: "ctx-old" }) });
      });
      await page.clock.setFixedTime(new Date("2033-05-19T15:00:00Z"));
      await page.goto("/");
      await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
      await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
      await openAgenda(page);
      const oldRow = page.locator("tr", { hasText: "Reserva Antiga Central" });
      const degradedHeading = page.locator("main.content").getByRole("heading", { name: "Conectividade parcial." });
      await expect(oldRow).toBeVisible();
      staleContextReadArmed = true;
      await page.getByRole("button", { name: "Atualizar" }).click();
      await page.getByLabel("Selecionar unidade e workspace").selectOption({ label: "Unidade Sul · Operação clínica" });
      await expect(page.getByText("19 MAI · UNIDADE SUL")).toBeVisible({ timeout: 10_000 });
      await expect(oldRow).toHaveCount(0);
      const staleResponse = page.waitForResponse(async (response) => {
        if (!new URL(response.url()).pathname.endsWith("/appointments")) return false;
        return (await response.json()).correlationId === `ctx-stale-${mode}`;
      });
      releaseOldContext();
      await (await staleResponse).finished();
      if (mode === "success") {
        await expect(page.getByText("19 MAI · UNIDADE SUL")).toBeVisible({ timeout: 10_000 });
        await expect(oldRow).toHaveCount(0);
        await expect(degradedHeading).toHaveCount(0);
      } else {
        await expect(degradedHeading).toBeVisible({ timeout: 10_000 });
        await expect(oldRow).toHaveCount(0);
      }
    });
  }

  test("resposta atrasada do dia não substitui a semana selecionada", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2031-09-15T15:00:00Z"));
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    let dayRequested = () => {};
    const requested = new Promise<void>((resolve) => { dayRequested = resolve; });
    await page.route("**/api/v1/appointments**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("endsAt") !== "2031-09-16T03:00:00.000Z") { await route.continue(); return; }
      dayRequested();
      await held;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, data: { items: [{ id: "stale-day", startsAt: "2031-09-15T12:00:00Z", endsAt: "2031-09-15T12:30:00Z", purpose: "Resposta obsoleta", status: "CANCELLED", patient: { name: "Paciente obsoleto" } }] }, correlationId: "stale-range" }) });
    });
    await page.goto("/");
    await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
    await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
    await openAgenda(page);
    await requested;
    await page.getByRole("button", { name: "Próximos 7 dias" }).click();
    await expect(page.getByText("Nenhuma janela encontrada")).toBeVisible();
    const stale = page.waitForResponse((response) => new URL(response.url()).searchParams.get("endsAt") === "2031-09-16T03:00:00.000Z");
    release();
    await (await stale).finished();
    await expect(page.getByText("15 SET–21 SET · UNIDADE CENTRO")).toBeVisible();
    await expect(page.getByText("Nenhuma janela encontrada")).toBeVisible();
    await expect(page.getByText("Paciente obsoleto")).toHaveCount(0);
  });

  test("agenda vazia e falha de leitura mostram estados explícitos", async ({ page }) => {
    let fail = false;
    await page.route("**/api/v1/appointments**", async (route) => {
      if (fail) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, error: { code: "DEPENDENCY_UNAVAILABLE", message: "Agenda indisponível." }, correlationId: "e2e-agenda-error" }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, data: { items: [] }, correlationId: "e2e-agenda-empty" }) });
    });
    await page.goto("/");
    await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
    await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
    await openAgenda(page);
    await expect(page.getByText("Nenhuma janela encontrada")).toBeVisible();
    fail = true;
    await page.getByRole("button", { name: "Atualizar" }).click();
    await expect(page.getByRole("heading", { name: "Conectividade parcial." })).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "Tentar revalidar" }).click();
    await expect(page.getByText("Nenhuma janela encontrada")).toBeVisible();
  });

  for (const [attempt, dayOffset] of [[0, 0], [1, 1]] as const) {
    test(`jornada de agenda: reserva, confirmação, remarcação, check-in, triagem e handoff (offset ${dayOffset})`, async ({ page }, testInfo) => {
      // 15-minute slots from 10:00: late enough to stay clear of the seeded
      // morning fixture in every runner timezone, and each project owns a
      // disjoint block per attempt so a retry never collides with its own
      // previous booking.
      // 13:00 start clears both seeded fixtures (10:30-11:15 clinical and
      // 12:00-12:45 reception, which the unit-scoped reschedule check also
      // considers); 60-minute project blocks (45-minute service + 15-minute
      // reschedule) touch but never overlap across projects.
      const SLOTS = Array.from({ length: 40 }, (_, index) => {
        const minutes = 13 * 60 + index * 15;
        return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      });
      const PROJECT_PAIRS: Record<string, number> = {
        "chromium-wide-1440": 0,
        "chromium-tablet-768": 1,
        "chromium-mobile-375": 2,
        "firefox-wide-1440": 3,
        "firefox-tablet-768": 4,
        "firefox-mobile-375": 5,
        "webkit-wide-1440": 6,
        "webkit-tablet-768": 7,
        "webkit-mobile-375": 8
      };
      const pairIndex = PROJECT_PAIRS[testInfo.project.name];
      if (pairIndex === undefined) throw new Error(`Projeto sem janela de agenda sintética: ${testInfo.project.name}`);
      // A retry moves to the next day so it can never collide with its own
      // previous booking.
      const windowIndex = pairIndex * 4;
      const startTime = SLOTS[windowIndex];
      const movedTime = SLOTS[windowIndex + 1];
      if (!startTime || !movedTime) throw new Error(`Sem janela sintética livre para o projeto ${testInfo.project.name}`);
      const frozenDay = new Date("2030-09-15T15:00:00Z");
      frozenDay.setUTCDate(frozenDay.getUTCDate() + dayOffset + testInfo.retry);
      await page.clock.setFixedTime(frozenDay);
      const suffix = `${windowIndex}${Date.now().toString(36)}`;
      const patientName = `Pac Agenda ${suffix}`;
      const purpose = `Consulta E2E ${suffix}`;

    await page.goto("/");
    await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
    await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
    const agendaDate = await page.evaluate(() => {
      const date = new Date();
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    });

    const menu = page.getByRole("button", { name: "Abrir menu" });
    if (await menu.isVisible()) await menu.click();
    await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Pacientes" }).click();
    await page.getByRole("button", { name: "Novo paciente" }).click();
    await page.getByRole("button", { name: "Novo responsável" }).click();
    await page.getByLabel("Nome do responsável").fill(`Tutor Agenda ${suffix}`);
    await page.getByLabel("Telefone").fill("+55 11 95555-0000");
    await page.getByLabel("Nome do paciente").fill(patientName);
    await page.getByLabel("Espécie").fill("Canina");
    await page.getByRole("button", { name: "Cadastrar paciente" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Recibo" })).toBeVisible();

    await openAgenda(page);
    await page.getByRole("button", { name: "Novo horário" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const patientValue = await page.locator("#agenda-patient option", { hasText: patientName }).first().getAttribute("value");
    await page.locator("#agenda-patient").selectOption(patientValue!);
    await page.locator("#agenda-service").selectOption({ index: 1 });
    await page.locator("#agenda-provider").selectOption({ index: 1 });
    await page.locator("#agenda-date").fill(agendaDate);
    await page.locator("#agenda-time").fill(startTime);
    await page.locator("#agenda-purpose").fill(purpose);
    await page.getByRole("button", { name: "Criar reserva" }).click();
    const row = page.locator("tr", { hasText: purpose });
    // The persisted row is the authoritative proof; the toast is transient.
    // The list reloads asynchronously after the POST, so allow a slower runner.
    await expect(row).toBeVisible({ timeout: 15_000 });

    await row.getByRole("button", { name: "Confirmar", exact: true }).click();
    await page.getByRole("button", { name: "Confirmar reserva" }).click();
    await expect(page.locator('p.table-sub[role="status"]', { hasText: "Reserva confirmada" })).toBeVisible();

    await row.getByRole("button", { name: "Reagendar" }).click();
    await page.locator("#agenda-reschedule-time").fill(movedTime);
    await page.getByRole("button", { name: "Confirmar nova janela" }).click();
    await expect(page.locator('p.table-sub[role="status"]', { hasText: "Reserva remarcada" })).toBeVisible();

    await row.getByRole("button", { name: "Check-in" }).click();
    await expect(page.locator('p.table-sub[role="status"]', { hasText: "Check-in registrado" })).toBeVisible();

    await page.getByRole("button", { name: "Visão de fila" }).click();
    const queueRow = page.locator("tr", { hasText: patientName }).first();
    await expect(queueRow).toBeVisible();
    await queueRow.getByRole("button", { name: "Triagem" }).click();
    await page.locator("#agenda-priority").selectOption("EMERGENCY");
    await page.getByRole("button", { name: "Registrar triagem" }).click();
    await expect(page.locator('p.table-sub[role="status"]', { hasText: "Triagem registrada" })).toBeVisible();

    const triagedRow = page.locator("tr", { hasText: patientName }).first();
    await triagedRow.getByRole("button", { name: "Handoff" }).click();
    await page.locator("#agenda-chief").fill("queixa E2E de handoff");
    await page.locator("#agenda-urgency").selectOption("URGENT");
    await page.getByRole("button", { name: "Abrir atendimento" }).click();
    await expect(page.locator('p.table-sub[role="status"]', { hasText: "Handoff concluído" })).toBeVisible();
    await expect(page.locator("tr", { hasText: patientName }).filter({ hasText: "Em atendimento" })).toBeVisible();

      await page.getByRole("button", { name: "Hoje" }).click();
      await page.getByRole("button", { name: "Novo horário" }).click();
      await page.locator("#agenda-patient").selectOption(patientValue!);
      await page.locator("#agenda-service").selectOption({ index: 1 });
      await page.locator("#agenda-provider").selectOption({ index: 1 });
      await page.locator("#agenda-date").fill(agendaDate);
      await page.locator("#agenda-time").fill(movedTime);
      await page.locator("#agenda-purpose").fill(`Conflito E2E ${suffix}`);
      await page.getByRole("button", { name: "Criar reserva" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "A janela escolhida já está ocupada." })).toBeVisible();
      await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
    });
  }
});

test("copiloto mostra a proveniência real da resposta, sem rótulo fixo", async ({ page }) => {
  await page.route("**/api/v1/ai/turns", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: 1,
        data: {
          turn: {
            id: "00000000-0000-4000-8000-000000000201",
            sessionId: "00000000-0000-4000-8000-000000000202",
            prompt: "organizar a fila",
            response: "Resposta governada para revisão.",
            status: "COMPLETED",
            model: "deepseek-v4.1-flash",
            inputTokens: 12,
            outputTokens: 8,
            references: [{ title: "Protocolo CVG", source: "knowledge://protocolo" }],
            createdAt: "2026-09-13T12:00:00.000Z"
          },
          approval: null,
          provenance: {
            provider: "deepseek-harness",
            engineCommit: "abcdef0123456789abcdef0123456789abcdef01",
            manifestVersion: "profile-2026-09",
            profileDigest: "d".repeat(64),
            policyRevision: "policy-42",
            references: [{ title: "Protocolo CVG", source: "knowledge://protocolo" }],
            correlationId: "e2e-copilot"
          },
          receiptId: "00000000-0000-4000-8000-000000000203"
        },
        correlationId: "e2e-copilot"
      })
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Copiloto", exact: true }).click();
  await page.getByLabel("Pedido").fill("organizar a fila");
  await page.getByRole("button", { name: "Processar turno" }).click();
  await expect(page.getByText("modelo: deepseek-v4.1-flash")).toBeVisible();
  await expect(page.getByText("provider: deepseek-harness")).toBeVisible();
  await expect(page.getByText("engine: abcdef012345")).toBeVisible();
  await expect(page.getByText(/policy-42/)).toBeVisible();
  await expect(page.getByText("fontes: 1")).toBeVisible();
  await expect(page.getByText("local-stub")).toHaveCount(0);
  await expect(page.locator(".copilot-response > p")).toHaveText("Resposta governada para revisão.");
});

test("gráfico sintético tem rótulo permanente de ilustração", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  await expect(page.getByText("ILUSTRAÇÃO", { exact: true })).toBeVisible();
});

test.describe("jornada de pacientes", () => {
  const openPatients = async (page: import("@playwright/test").Page) => {
    const menu = page.getByRole("button", { name: "Abrir menu" });
    if (await menu.isVisible()) await menu.click();
    await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Pacientes" }).click();
    await expect(page.getByRole("heading", { name: "Pacientes", exact: true })).toBeVisible();
  };

  test("cadastro, busca, ficha, desativação e mesclagem com recibos explícitos", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
    await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
    await openPatients(page);

    const suffix = Date.now().toString(36);
    const nina = `Nina ${suffix}`;
    const toby = `Toby ${suffix}`;
    await page.getByRole("button", { name: "Novo paciente" }).click();
    await page.getByRole("button", { name: "Novo responsável" }).click();
    await page.getByLabel("Nome do responsável").fill(`Tutor ${suffix}`);
    await page.getByLabel("Telefone").fill("+55 11 90000-0000");
    await page.getByLabel("Nome do paciente").fill(nina);
    await page.getByLabel("Espécie").fill("Felina");
    await page.getByLabel("Microchip/identificador (opcional)").fill(`MICRO-${suffix}`);
    await page.getByRole("button", { name: "Cadastrar paciente" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Recibo" })).toBeVisible();
    await expect(page.locator(".patient-list").getByText(nina, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Novo paciente" }).click();
    await page.locator("#patient-guardian").selectOption({ label: `Tutor ${suffix} · +55 11 90000-0000` });
    await page.getByLabel("Nome do paciente").fill(toby);
    await page.getByLabel("Espécie").fill("Canina");
    await page.getByRole("button", { name: "Cadastrar paciente" }).click();
    await expect(page.locator(".patient-list").getByText(toby, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: `Abrir ficha de ${toby}` }).click();
    await expect(page.getByRole("heading", { name: `Ficha de ${toby}` })).toBeVisible();
    await page.getByRole("button", { name: "Desativar cadastro" }).click();
    await page.getByRole("button", { name: "Confirmar desativação" }).click();
    await expect(page.getByRole("status").filter({ hasText: "desativado" })).toBeVisible();
    await expect(page.locator(".patient-list").getByText(toby, { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: `Abrir ficha de ${nina}` }).click();
    await expect(page.getByRole("heading", { name: `Ficha de ${nina}` })).toBeVisible();
    await page.getByRole("button", { name: "Mesclar cadastro" }).click();
    await page.locator("#merge-target").selectOption({ index: 1 });
    await page.getByLabel("Motivo").fill("cadastro duplicado sintético para a jornada");
    await page.getByLabel(/Confirmo que revisei/).check();
    await page.getByRole("button", { name: "Confirmar mesclagem" }).click();
    await expect(page.getByRole("status").filter({ hasText: "mesclado em" })).toBeVisible();
    await expect(page.locator(".patient-list").getByText(nina, { exact: true })).toHaveCount(0);
  });

  test("duplicidade nega sem parcialidade e recupera pela revalidação", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
    await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
    await openPatients(page);
    const suffix = Date.now().toString(36);
    const original = `Dupe ${suffix}`;
    const clone = `Clone ${suffix}`;
    const identifier = `MICRO-DUP-${suffix}`;

    await page.getByRole("button", { name: "Novo paciente" }).click();
    await page.locator("#patient-guardian").selectOption({ index: 1 });
    await page.getByLabel("Nome do paciente").fill(original);
    await page.getByLabel("Espécie").fill("Canina");
    await page.getByLabel("Microchip/identificador (opcional)").fill(identifier);
    await page.getByRole("button", { name: "Cadastrar paciente" }).click();
    await expect(page.locator(".patient-list").getByText(original, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Novo paciente" }).click();
    await page.locator("#patient-guardian").selectOption({ index: 1 });
    await page.getByLabel("Nome do paciente").fill(clone);
    await page.getByLabel("Espécie").fill("Canina");
    await page.getByLabel("Microchip/identificador (opcional)").fill(identifier);
    await page.getByRole("button", { name: "Cadastrar paciente" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Identificador já vinculado a outro paciente ativo." })).toBeVisible();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Cancelar" }).click();
    await page.getByLabel("Buscar pacientes").fill(clone);
    await expect(page.getByText("Nenhum paciente encontrado")).toBeVisible();
    await page.getByLabel("Buscar pacientes").fill(original);
    await expect(page.locator(".patient-list").getByText(original, { exact: true })).toBeVisible();
  });

  test("retry reutiliza a chave idempotente e conclui no segundo envio", async ({ page }) => {
    let failFirst = true;
    const keys: string[] = [];
    await page.route("**/api/v1/patients", async (route) => {
      const request = route.request();
      if (request.method() !== "POST") { await route.continue(); return; }
      keys.push(request.headers()["idempotency-key"] ?? "");
      if (failFirst) {
        failFirst = false;
        await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, error: { code: "INVALID_INPUT", message: "Falha sintética de validação." }, correlationId: "e2e-patient-retry" }) });
        return;
      }
      await route.continue();
    });
    await page.goto("/");
    await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
    await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
    await openPatients(page);
    const suffix = Date.now().toString(36);
    await page.getByRole("button", { name: "Novo paciente" }).click();
    await page.locator("#patient-guardian").selectOption({ index: 1 });
    await page.getByLabel("Nome do paciente").fill(`Retry ${suffix}`);
    await page.getByLabel("Espécie").fill("Canina");
    await page.getByRole("button", { name: "Cadastrar paciente" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Falha sintética de validação." })).toBeVisible();
    await page.getByRole("button", { name: "Cadastrar paciente" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Recibo" })).toBeVisible();
    expect(keys.length).toBe(2);
    expect(keys[0]).toBe(keys[1]);
  });

  test("diálogo da jornada prende o foco, cancela com Escape e busca responsável", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
    await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
    await openPatients(page);
    const opener = page.getByRole("button", { name: "Novo paciente" });
    await opener.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.locator("#guardian-search")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.locator(":focus")).toHaveCount(1);
    await page.getByLabel("Buscar responsável").fill("Marina");
    await expect(page.locator("#patient-guardian option", { hasText: "Marina Souza" })).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});

test("prontuário manual: rascunho, revisão, assinatura imutável e adendo sem IA", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const documentTitle = `Evolução E2E ${suffix}`;
  await page.goto("/");
  await page.locator("#login").fill("ana.vet@cvg.local");
  await page.locator("#password").fill("veterinario-synthetic-0002");
  await page.getByRole("button", { name: "Entrar no CVG" }).click();
  await expect(page.locator('nav[aria-label="Navegação principal"]')).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Agenda" }).click();
  await page.getByRole("button", { name: "Visão de fila" }).click();
  const lunaRow = page.locator("tr", { hasText: "Luna" }).first();
  await expect(lunaRow).toBeVisible();
  if (await lunaRow.getByRole("button", { name: "Handoff" }).count()) {
    await lunaRow.getByRole("button", { name: "Handoff" }).click();
    await page.locator("#agenda-chief").fill("preparo do prontuário E2E");
    await page.locator("#agenda-urgency").selectOption("ROUTINE");
    await page.getByRole("button", { name: "Abrir atendimento" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Handoff concluído" }).or(page.getByRole("alert"))).toBeVisible();
    if (await page.getByRole("dialog").count()) await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
  }
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Atendimento" }).click();
  await expect(page.getByRole("heading", { name: "Atendimento", exact: true })).toBeVisible();
  await page.locator(".encounter-card").first().getByRole("button", { name: "Abrir atendimento" }).click();
  await expect(page.getByRole("heading", { name: "Documentos do atendimento" })).toBeVisible();

  await page.getByRole("button", { name: "Novo documento" }).click();
  await page.locator("#clinical-title").fill(documentTitle);
  await page.locator("#clinical-content").fill("texto inicial manual, sem IA");
  await page.getByRole("button", { name: "Criar rascunho" }).click();
  await expect(page.getByRole("status").filter({ hasText: "criado" })).toBeVisible();
  const documentRow = () => page.locator(".audit-row", { hasText: documentTitle });
  await expect(documentRow().getByText("Rascunho", { exact: true })).toBeVisible();

  await documentRow().getByRole("button", { name: "Abrir editor" }).click();
  await page.locator("#clinical-edit-content").fill("texto revisado manual, sem IA");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Rascunho salvo" })).toBeVisible();

  await documentRow().getByRole("button", { name: "Enviar para revisão" }).click();
  await expect(page.getByRole("status").filter({ hasText: "marcado para revisão" })).toBeVisible();
  await expect(documentRow().getByText("Em revisão", { exact: true })).toBeVisible();

  await documentRow().getByRole("button", { name: "Assinar" }).click();
  await page.getByRole("button", { name: "Confirmar assinatura" }).click();
  await expect(page.getByRole("status").filter({ hasText: "assinado e imutável" })).toBeVisible();
  await expect(documentRow().getByText("Assinado", { exact: true })).toBeVisible();
  await expect(documentRow().getByRole("button", { name: "Abrir editor" })).toHaveCount(0);

  await documentRow().getByRole("button", { name: "Ver conteúdo" }).click();
  const signedDocumentDialog = page.getByRole("dialog");
  const signedDocumentClose = signedDocumentDialog.getByRole("button", { name: "Fechar" }).first();
  await expect(signedDocumentDialog).toBeVisible();
  await expect(signedDocumentClose).toBeFocused();
  await signedDocumentClose.click();

  await documentRow().getByRole("button", { name: "Adicionar adendo" }).click();
  await page.locator("#clinical-addendum-reason").fill("correção pós-assinatura E2E");
  await page.locator("#clinical-addendum-content").fill("complemento registrado sem alterar o original");
  await page.getByRole("button", { name: "Registrar adendo" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Adendo registrado" })).toBeVisible();
  await expect(page.getByText("Adendo: correção pós-assinatura E2E").first()).toBeVisible();

  const secondDocumentTitle = `Evolução E2E secundária ${suffix}`;
  await page.getByRole("button", { name: "Novo documento" }).click();
  await page.locator("#clinical-title").fill(secondDocumentTitle);
  await page.locator("#clinical-content").fill("segundo documento manual, sem IA");
  await page.getByRole("button", { name: "Criar rascunho" }).click();
  await expect(page.getByRole("status").filter({ hasText: "criado" })).toBeVisible();
  const secondDocumentRow = () => page.locator(".audit-row", { hasText: secondDocumentTitle });
  await expect(secondDocumentRow().getByText("Rascunho", { exact: true })).toBeVisible();
  await secondDocumentRow().getByRole("button", { name: "Enviar para revisão" }).click();
  await expect(page.getByRole("status").filter({ hasText: "marcado para revisão" })).toBeVisible();
  await secondDocumentRow().getByRole("button", { name: "Assinar" }).click();
  await page.getByRole("button", { name: "Confirmar assinatura" }).click();
  await expect(page.getByRole("status").filter({ hasText: "assinado e imutável" })).toBeVisible();
  await expect(page.getByText("Adendo: correção pós-assinatura E2E").first()).toBeVisible();
});

test("administrador revisa mas não assina, e anexos falham fechado com razão explícita", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const documentTitle = `Evolução Admin ${suffix}`;
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Agenda" }).click();
  await page.getByRole("button", { name: "Visão de fila" }).click();
  const lunaRow = page.locator("tr", { hasText: "Luna" }).first();
  await expect(lunaRow).toBeVisible();
  if (await lunaRow.getByRole("button", { name: "Handoff" }).count()) {
    await lunaRow.getByRole("button", { name: "Handoff" }).click();
    await page.locator("#agenda-chief").fill("preparo do prontuário do administrador");
    await page.locator("#agenda-urgency").selectOption("ROUTINE");
    await page.getByRole("button", { name: "Abrir atendimento" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Handoff concluído" }).or(page.getByRole("alert"))).toBeVisible();
    if (await page.getByRole("dialog").count()) await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
  }
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Atendimento" }).click();
  await expect(page.getByRole("heading", { name: "Atendimento", exact: true })).toBeVisible();
  const firstEncounter = page.locator(".encounter-card").first();
  await expect(firstEncounter).toBeVisible();
  await firstEncounter.getByRole("button", { name: "Abrir atendimento" }).click();
  await page.getByRole("button", { name: "Novo documento" }).click();
  await page.locator("#clinical-title").fill(documentTitle);
  await page.locator("#clinical-content").fill("documento criado pelo administrador");
  await page.getByRole("button", { name: "Criar rascunho" }).click();
  await expect(page.getByRole("status").filter({ hasText: "criado" })).toBeVisible();
  const documentRow = () => page.locator(".audit-row", { hasText: documentTitle });
  await expect(documentRow().getByRole("button", { name: "Assinar" })).toHaveCount(0);
  await expect(page.getByText("Assinatura exige role veterinário no escopo atual")).toBeVisible();
  await documentRow().getByRole("button", { name: "Enviar para revisão" }).click();
  await expect(page.getByRole("status").filter({ hasText: "marcado para revisão" })).toBeVisible();
  await expect(documentRow().getByRole("button", { name: "Assinar" })).toBeDisabled();
  await page.getByRole("button", { name: "Anexar arquivo" }).click();
  await expect(page.getByText(/Anexos bloqueados com razão explícita/)).toBeVisible();
  await expect(page.locator("#clinical-attachment-file")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Enviar anexo" })).toBeDisabled();
  await page.getByRole("dialog").getByRole("button", { name: "Fechar" }).last().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("cadeia diagnóstica: pedido, amostra, resultado, duplicidade quarentenada e revisão", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const testName = `Hemograma E2E ${suffix}`;
  await page.goto("/");
  await page.locator("#login").fill("ana.vet@cvg.local");
  await page.locator("#password").fill("veterinario-synthetic-0002");
  await page.getByRole("button", { name: "Entrar no CVG" }).click();
  await expect(page.locator('nav[aria-label="Navegação principal"]')).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  const navigation = page.locator('nav[aria-label="Navegação principal"]');
  const clickNavigation = async (label: string) => {
    if (await menu.isVisible()) await menu.click();
    await navigation.getByRole("button", { name: label }).click();
  };
  await clickNavigation("Agenda");
  await page.getByRole("button", { name: "Visão de fila" }).click();
  const lunaRow = page.locator("tr", { hasText: "Luna" }).first();
  await expect(lunaRow).toBeVisible();
  if (await lunaRow.getByRole("button", { name: "Handoff" }).count()) {
    await lunaRow.getByRole("button", { name: "Handoff" }).click();
    await page.locator("#agenda-chief").fill("preparo da cadeia diagnóstica");
    await page.locator("#agenda-urgency").selectOption("ROUTINE");
    await page.getByRole("button", { name: "Abrir atendimento" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Handoff concluído" }).or(page.getByRole("alert"))).toBeVisible();
    if (await page.getByRole("dialog").count()) await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
  }
  await clickNavigation("Atendimento");
  await clickNavigation("Exames");
  await expect(page.getByRole("heading", { name: "Pedidos, amostras e resultados" })).toBeVisible();

  await page.getByRole("button", { name: "Novo pedido" }).click();
  const lunaValue = await page.locator("#exam-patient option", { hasText: "Luna" }).first().getAttribute("value");
  await page.locator("#exam-patient").selectOption(lunaValue!);
  await page.locator("#exam-encounter").selectOption({ index: 1 });
  await page.locator("#exam-name").fill(testName);
  await page.locator("#exam-priority").selectOption("URGENT");
  await page.getByRole("button", { name: "Criar pedido" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Pedido ${testName} criado` })).toBeVisible();

  const requestRow = () => page.locator(".audit-row", { hasText: testName });
  await requestRow().getByRole("button", { name: "Registrar amostra" }).click();
  await page.locator("#exam-specimen-label").fill(`AMOSTRA-${suffix}`);
  await page.getByRole("button", { name: "Registrar amostra" }).last().click();
  await expect(page.getByRole("status").filter({ hasText: `Amostra AMOSTRA-${suffix} registrada` })).toBeVisible();

  await requestRow().getByRole("button", { name: "Registrar resultado" }).click();
  await page.locator("#exam-result-value").fill("leucócitos dentro da referência");
  await page.locator("#exam-result-source").fill("laboratório E2E");
  await page.locator("#exam-result-version").fill("v-e2e-1");
  await page.getByRole("button", { name: "Registrar resultado" }).last().click();
  await expect(page.getByRole("status").filter({ hasText: "Resultado registrado" })).toBeVisible();
  await expect(requestRow().getByText(/leucócitos dentro da referência/)).toBeVisible();

  await requestRow().getByRole("button", { name: "Registrar resultado" }).click();
  await page.locator("#exam-result-value").fill("duplicata indevida");
  await page.locator("#exam-result-source").fill("laboratório E2E");
  await page.locator("#exam-result-version").fill("v-e2e-1");
  await page.getByRole("button", { name: "Registrar resultado" }).last().click();
  await expect(page.getByRole("alert").filter({ hasText: "duplicado" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
  await expect(requestRow().getByText(/Resultado: /)).toHaveCount(1);
  await expect(requestRow().getByText(/duplicata indevida/)).toHaveCount(0);

  await requestRow().getByRole("button", { name: "Revisar" }).click();
  await expect(page.getByRole("status").filter({ hasText: `${testName} revisado` })).toBeVisible();
  await expect(requestRow().getByText("Revisado", { exact: true })).toBeVisible();
});

test("jornada de internação: admissão, prescrição, administração, handoff e alta com pendências", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-wide-1440", "leito único compartilhado exige execução serial");
  const suffix = Date.now().toString(36);
  await page.goto("/");
  await page.locator("#login").fill("ana.vet@cvg.local");
  await page.locator("#password").fill("veterinario-synthetic-0002");
  await page.getByRole("button", { name: "Entrar no CVG" }).click();
  await expect(page.locator('nav[aria-label="Navegação principal"]')).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Agenda" }).click();
  await page.getByRole("button", { name: "Visão de fila" }).click();
  const lunaRow = page.locator("tr", { hasText: "Luna" }).first();
  await expect(lunaRow).toBeVisible();
  if (await lunaRow.getByRole("button", { name: "Handoff" }).count()) {
    await lunaRow.getByRole("button", { name: "Handoff" }).click();
    await page.locator("#agenda-chief").fill("preparo da internação E2E");
    await page.locator("#agenda-urgency").selectOption("ROUTINE");
    await page.getByRole("button", { name: "Abrir atendimento" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Handoff concluído" }).or(page.getByRole("alert"))).toBeVisible();
    if (await page.getByRole("dialog").count()) await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
  }
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Atendimento" }).click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Internação", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Internações em andamento" })).toBeVisible();

  await page.getByRole("button", { name: "Nova internação" }).click();
  const lunaValue = await page.locator("#hospital-patient option", { hasText: "Luna" }).first().getAttribute("value");
  await page.locator("#hospital-patient").selectOption(lunaValue!);
  await page.locator("#hospital-encounter").selectOption({ index: 1 });
  await page.locator("#hospital-bed").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Internar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Internação admitida" })).toBeVisible();

  const episodeRow = () => page.locator(".audit-row", { hasText: "Luna" }).first();
  await expect(episodeRow().getByText("Internado", { exact: true })).toBeVisible();
  await episodeRow().getByRole("button", { name: "Prescrever" }).click();
  await page.locator("#hospital-product").selectOption({ index: 1 });
  await page.locator("#hospital-dose").fill("1 comprimido");
  await page.locator("#hospital-route").fill("oral");
  await page.locator("#hospital-frequency").fill("12h");
  await page.getByRole("button", { name: "Criar prescrição" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Prescrição de" })).toBeVisible();

  await episodeRow().getByRole("button", { name: "Administrar" }).first().click();
  await page.locator("#hospital-admin-status").selectOption("ADMINISTERED");
  await page.getByRole("button", { name: "Registrar administração" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Administração registrada" })).toBeVisible();

  await episodeRow().getByRole("button", { name: "Administrar" }).first().click();
  await page.locator("#hospital-admin-status").selectOption("ADMINISTERED");
  await page.getByRole("button", { name: "Registrar administração" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Administração duplicada" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
  await expect(episodeRow().getByText(/Administrada/)).toHaveCount(1);

  await episodeRow().getByRole("button", { name: "Procedimento" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Em procedimento" })).toBeVisible();

  await episodeRow().getByRole("button", { name: "Alta" }).click();
  await page.getByRole("button", { name: "Confirmar alta" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "documento de alta assinado" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();

  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Atendimento", exact: true }).click();
  await page.getByRole("button", { name: "Prontuário", exact: true }).click();
  await page.locator(".encounter-card", { hasText: "Luna" }).first().getByRole("button", { name: "Abrir atendimento" }).click();
  await page.getByRole("button", { name: "Novo documento" }).click();
  await page.locator("#clinical-type").selectOption("DISCHARGE");
  await page.locator("#clinical-title").fill(`Alta E2E ${suffix}`);
  await page.locator("#clinical-content").fill("plano de retorno em 7 dias com reavaliação");
  await page.getByRole("button", { name: "Criar rascunho" }).click();
  const documentRow = () => page.locator(".audit-row", { hasText: `Alta E2E ${suffix}` });
  await expect(documentRow().getByText("Rascunho", { exact: true })).toBeVisible();
  await documentRow().getByRole("button", { name: "Enviar para revisão" }).click();
  await expect(documentRow().getByText("Em revisão", { exact: true })).toBeVisible();
  await documentRow().getByRole("button", { name: "Assinar" }).click();
  await page.getByRole("button", { name: "Confirmar assinatura" }).click();
  await expect(documentRow().getByText("Assinado", { exact: true })).toBeVisible();

  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Internação", exact: true }).click();
  await episodeRow().getByRole("button", { name: "Alta" }).click();
  await page.getByRole("button", { name: "Confirmar alta" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Alta registrada" })).toBeVisible();
  await expect(episodeRow().getByText("Alta registrada", { exact: true })).toBeVisible();
});

test("jornada de estoque: entrada, dispensação, negativa de saldo, devolução e inventário", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const productName = `Produto E2E ${suffix}`;
  const lotNumber = `LOTE-E2E-${suffix}`;
  const expiry = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Farmácia" }).click();
  await expect(page.getByRole("heading", { name: "Estoque", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Registrar entrada" }).click();
  await page.getByRole("button", { name: "Novo produto" }).click();
  await page.locator("#stock-sku").fill(`SKU-E2E-${suffix}`);
  await page.locator("#stock-name").fill(productName);
  await page.locator("#stock-category").fill("Sintético");
  await page.locator("#stock-lot").fill(lotNumber);
  await page.locator("#stock-expiry").fill(expiry);
  await page.locator("#stock-quantity").fill("5");
  await page.locator("#stock-location").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Confirmar entrada" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Lote ${lotNumber} com saldo 5` })).toBeVisible();

  const lotCard = () => page.locator(".stock-card", { hasText: productName });
  await expect(lotCard()).toBeVisible();
  await lotCard().getByRole("button", { name: "Movimento" }).click();
  await page.locator("#stock-movement-type").selectOption("DISPENSE");
  await page.locator("#stock-movement-quantity").fill("2");
  await page.locator("#stock-movement-reason").fill("consumo E2E");
  await page.getByRole("button", { name: "Registrar movimento" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Dispensação/consumo registrada" })).toBeVisible();

  await lotCard().getByRole("button", { name: "Movimento" }).click();
  await page.locator("#stock-movement-type").selectOption("DISPENSE");
  await page.locator("#stock-movement-quantity").fill("10");
  await page.locator("#stock-movement-reason").fill("tentativa acima do saldo");
  await page.getByRole("button", { name: "Registrar movimento" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "saldo insuficiente" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();

  await lotCard().getByRole("button", { name: "Movimento" }).click();
  await page.locator("#stock-movement-type").selectOption("RETURN");
  await page.locator("#stock-movement-quantity").fill("1");
  await page.locator("#stock-movement-reason").fill("devolução E2E");
  await page.getByRole("button", { name: "Registrar movimento" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Devolução registrada" })).toBeVisible();

  await lotCard().getByRole("button", { name: "Inventário" }).click();
  await page.locator("#stock-count").fill("3");
  await page.locator("#stock-count-reason").fill("divergência encontrada na contagem E2E");
  await page.getByRole("button", { name: "Confirmar contagem" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Inventário ajustado em -1" })).toBeVisible();
  await expect(page.locator(".audit-row", { hasText: "Ajuste de baixa" }).first()).toBeVisible();
});

test("jornada financeira: cobrança, pagamento, negativa de excesso, estorno e ledger", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const description = `Consulta E2E ${suffix}`;
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Financeiro" }).click();
  await expect(page.getByRole("heading", { name: "Financeiro", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Nova cobrança" }).click();
  await page.locator("#finance-description").fill(description);
  await page.locator("#finance-amount").fill("100,00");
  await page.getByRole("button", { name: "Criar cobrança" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cobrança de R$ 100,00 criada" })).toBeVisible();

  const chargeRow = () => page.locator(".ledger-row", { hasText: description });
  await expect(chargeRow().getByText("Em aberto", { exact: true })).toBeVisible();
  await chargeRow().getByRole("button", { name: "Pagamento" }).click();
  await page.locator("#finance-payment-amount").fill("40,00");
  await page.getByRole("button", { name: "Registrar pagamento" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Pagamento de R$ 40,00 liquidado" })).toBeVisible();
  await expect(chargeRow().getByText("Parcial", { exact: true })).toBeVisible();

  await chargeRow().getByRole("button", { name: "Pagamento" }).click();
  await page.locator("#finance-payment-amount").fill("70,00");
  await page.getByRole("button", { name: "Registrar pagamento" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "excede o saldo" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
  await expect(chargeRow().getByText("Parcial", { exact: true })).toBeVisible();

  await chargeRow().getByRole("button", { name: "Pagamento" }).click();
  await page.locator("#finance-payment-amount").fill("60,00");
  await page.getByRole("button", { name: "Registrar pagamento" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Pagamento de R$ 60,00 liquidado" })).toBeVisible();
  await expect(chargeRow().getByText("Pago", { exact: true })).toBeVisible();

  await chargeRow().getByRole("button", { name: "Estorno" }).click();
  await page.locator("#finance-refund-reason").fill("estorno E2E com política pendente");
  await page.getByRole("button", { name: "Confirmar estorno" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Estorno de" })).toBeVisible();
  await expect(chargeRow().getByText("Estornado", { exact: true })).toBeVisible();
  await expect(page.getByText("SALDO NÃO AFIRMADO · POLÍTICA DE ESTORNO PENDENTE")).toBeVisible();
  await expect(page.locator(".audit-row", { hasText: "Estorno ·" }).first()).toBeVisible();
});

test("copiloto reutiliza sessão, reconstrói histórico e não autoenvia", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Copiloto", exact: true }).click();
  await expect(page.getByText("SESSÃO NOVA")).toBeVisible();
  await expect(page.locator(".audit-row")).toHaveCount(0);

  const lunaValue = await page.locator("#copilot-patient option", { hasText: "Luna" }).first().getAttribute("value");
  await page.locator("#copilot-patient").selectOption(lunaValue!);
  if (await page.locator("#copilot-encounter option").count() > 1) await page.locator("#copilot-encounter").selectOption({ index: 1 });
  await page.getByLabel("Pedido").fill("organize os pontos de atenção do turno E2E 1");
  await expect(page.locator(".audit-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Processar turno" }).click();
  await expect(page.getByRole("heading", { name: /Resposta para revisão|Conteúdo retido/ })).toBeVisible();
  await expect(page.getByText(/SESSÃO [0-9a-f]{8}/)).toBeVisible();
  await expect(page.locator(".audit-row")).toHaveCount(1);

  await page.getByLabel("Pedido").fill("e o turno E2E 2 na mesma sessão");
  await expect(page.locator(".audit-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Processar turno" }).click();
  await expect(page.locator(".audit-row")).toHaveCount(2);

  await page.getByRole("button", { name: "Recarregar histórico" }).click();
  await expect(page.getByText(/Histórico reconstruído \(2 turnos\)/)).toBeVisible();
  await expect(page.locator(".audit-row")).toHaveCount(2);

  await page.locator("#copilot-session").selectOption("");
  await expect(page.locator(".audit-row")).toHaveCount(0);
  await expect(page.getByText("SESSÃO NOVA")).toBeVisible();
});

test("conhecimento: rascunho não recuperável, aprovação, indexação, busca com checksum e quarentena", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const title = `Protocolo E2E ${suffix}`;
  const token = `isolamento-${suffix}`;
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  const navigation = page.locator('nav[aria-label="Navegação principal"]');
  const clickNavigation = async (label: string) => {
    if (await menu.isVisible()) await menu.click();
    await navigation.getByRole("button", { name: label }).click();
  };
  await clickNavigation("Copiloto");
  await clickNavigation("Conhecimento");
  await expect(page.getByRole("heading", { name: "Conhecimento governado" })).toBeVisible();

  await page.getByRole("button", { name: "Novo documento" }).click();
  await page.locator("#knowledge-title").fill(title);
  await page.locator("#knowledge-source").fill("Direção clínica E2E");
  await page.locator("#knowledge-content").fill(`Primeiro parágrafo com ${token}. Segundo parágrafo com precauções adicionais.`);
  await page.getByRole("button", { name: "Criar rascunho" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Rascunho ${title} criado` })).toBeVisible();
  const documentRow = () => page.locator(".audit-row", { hasText: title }).first();
  await expect(documentRow().getByText("Rascunho", { exact: true })).toBeVisible();

  await page.getByLabel("Buscar conhecimento").fill(token);
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByText("Nada recuperado")).toBeVisible();
  await page.getByRole("button", { name: "Limpar" }).click();

  await documentRow().getByRole("button", { name: "Aprovar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "agora está Aprovado" })).toBeVisible();
  await page.getByLabel("Buscar conhecimento").fill(token);
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByText("Nada recuperado")).toBeVisible();
  await page.getByRole("button", { name: "Limpar" }).click();

  await documentRow().getByRole("button", { name: "Indexar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "agora está Indexado" })).toBeVisible();
  await page.getByLabel("Buscar conhecimento").fill(token);
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByText(new RegExp(`checksum [a-f0-9]{12}`)).first()).toBeVisible();
  await expect(page.getByText(new RegExp(`\\[0\\] Primeiro parágrafo com ${token}`))).toBeVisible();
  await page.getByRole("button", { name: "Limpar" }).click();

  await documentRow().getByRole("button", { name: "Ver índice" }).click();
  await expect(page.getByRole("dialog").getByText(/checksum [a-f0-9]{20}/).first()).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Fechar" }).last().click();

  await documentRow().getByRole("button", { name: "Quarentenar" }).click();
  await page.locator("#knowledge-quarantine-reason").fill("substituído por versão nova E2E");
  await page.getByRole("button", { name: "Confirmar quarentena" }).click();
  await expect(page.getByRole("status").filter({ hasText: "em quarentena e fora da recuperação" })).toBeVisible();
  await page.getByLabel("Buscar conhecimento").fill(token);
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByText("Nada recuperado")).toBeVisible();
});

test("comunicação: preparar, decidir por outro ator e aprovação sem outbox durável nunca vira sucesso", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const firstTemplate = `Lembrete E2E A ${suffix}`;
  const secondTemplate = `Lembrete E2E B ${suffix}`;
  const recipient = `+55 11 90000-${String(parseInt(suffix.slice(-4), 36) % 10000).padStart(4, "0")}`;
  await page.goto("/");
  await page.locator("#login").fill("ana.vet@cvg.local");
  await page.locator("#password").fill("veterinario-synthetic-0002");
  await page.getByRole("button", { name: "Entrar no CVG" }).click();
  await expect(page.locator('nav[aria-label="Navegação principal"]')).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Atendimento" }).click();
  await page.getByRole("button", { name: "Comunicação", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mensagens e aprovações" })).toBeVisible();

  const compose = async (template: string) => {
    await page.getByRole("button", { name: "Preparar mensagem" }).click();
    const lunaValue = await page.locator("#comm-patient option", { hasText: "Luna" }).first().getAttribute("value");
    if (lunaValue) await page.locator("#comm-patient").selectOption(lunaValue);
    await page.locator("#comm-recipient").fill(recipient);
    await page.locator("#comm-template").fill(template);
    await page.locator("#comm-body").fill("Mensagem sintética aguardando aprovação independente.");
    await page.getByRole("button", { name: "Preparar mensagem" }).last().click();
    await expect(page.getByRole("status").filter({ hasText: "Mensagem preparada" })).toBeVisible();
  };
  await compose(firstTemplate);
  const firstRow = () => page.locator(".audit-row", { hasText: firstTemplate }).first();
  await expect(firstRow().getByText("Aguardando aprovação", { exact: true })).toBeVisible();

  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  // The authenticated deep link is intentionally preserved across re-login.
  await expect(page.getByRole("heading", { name: "Atendimento", exact: true })).toBeVisible();
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav[aria-label="Navegação principal"]').getByRole("button", { name: "Atendimento" }).click();
  await page.getByRole("button", { name: "Comunicação", exact: true }).click();
  await firstRow().getByRole("button", { name: "Revisar" }).click();
  await page.locator("#comm-reason").fill("segundo ator revisou e negou o conteúdo");
  await page.getByRole("button", { name: "Negar e não enviar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Mensagem rejeitada sem envio" })).toBeVisible();
  await expect(firstRow().getByText("Rejeitada", { exact: true })).toBeVisible();

  await compose(secondTemplate);
  const secondRow = () => page.locator(".audit-row", { hasText: secondTemplate }).first();
  await secondRow().getByRole("button", { name: "Revisar" }).click();
  await page.getByRole("button", { name: "Aprovar e enfileirar" }).click();
  await expect(page.getByRole("heading", { name: "Conectividade parcial." })).toBeVisible();
  await page.getByRole("button", { name: "Tentar revalidar" }).click();
  await expect(page.getByRole("heading", { name: "Atendimento", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Comunicação", exact: true }).click();
  await expect(secondRow().getByText("Aguardando aprovação", { exact: true })).toBeVisible();
  await expect(page.getByText(/Mensagem aprovada/)).toHaveCount(0);
});
