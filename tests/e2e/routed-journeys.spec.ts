import { test, expect } from "@playwright/test";

test("shell expõe exames, internação, comunicações, conhecimento e relatórios", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();

  const navigation = page.locator('nav[aria-label="Navegação principal"]');
  const routes = [
    { label: "Exames", heading: "Pedidos, amostras e resultados" },
    { label: "Internação", heading: "Internações em andamento" },
    { label: "Comunicações", heading: "Mensagens e aprovações" },
    { label: "Conhecimento", heading: "Conhecimento governado" },
    { label: "Relatórios", heading: "Relatórios" }
  ];

  for (const route of routes) {
    const menu = page.getByRole("button", { name: "Abrir menu" });
    if (await menu.isVisible()) await menu.click();

    const item = navigation.locator("button.nav-item").filter({ hasText: route.label });
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.getByRole("heading", { name: route.heading, exact: true })).toBeVisible();
    await expect(item).toHaveAttribute("aria-current", "page");
    await expect(page.locator("main.content")).toBeFocused();
    await expect(page.locator('[role="group"][aria-label^="Espaço ativo:"]')).toBeAttached();
  }
});

test("deep links das jornadas novas resolvem no shell", async ({ page }) => {
  const routes = [
    { path: "/exams", title: "Exames", heading: "Pedidos, amostras e resultados" },
    { path: "/hospital", title: "Internação", heading: "Internações em andamento" },
    { path: "/communications", title: "Comunicações", heading: "Mensagens e aprovações" },
    { path: "/knowledge", title: "Conhecimento", heading: "Conhecimento governado" },
    { path: "/reports", title: "Relatórios", heading: "Relatórios" }
  ];

  for (const route of routes) {
    await page.goto(route.path);
    const shellHeading = page.getByRole("heading", { name: route.heading, exact: true });
    const loginHeading = page.getByRole("heading", { name: "O cuidado em foco.", exact: true });
    await expect(loginHeading.or(shellHeading)).toBeVisible();
    const demo = page.getByRole("button", { name: /Abrir demonstração sintética/i });
    if (await loginHeading.isVisible()) {
      await expect(demo).toBeVisible();
      const demoResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/demo") && response.request().method() === "POST");
      await demo.click();
      expect((await demoResponse).status()).toBe(200);
    }
    await expect(shellHeading).toBeVisible();
    await expect(page.locator("main.content")).toHaveAttribute("aria-label", `Página: ${route.title}`);
    await expect(page).toHaveURL(new RegExp(`${route.path}$`));
  }
});
