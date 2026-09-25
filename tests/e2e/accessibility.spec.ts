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

type RenderedContrastSample = { id: string; selector: string; threshold?: number };

async function expectRenderedContrast(page: Page, state: string, samples: RenderedContrastSample[]): Promise<void> {
  const results = await page.evaluate((requested) => {
    type Rgb = [number, number, number, number];
    const parseColor = (value: string): Rgb | null => {
      const match = value.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\)/);
      return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])] : null;
    };
    const over = (front: Rgb, back: Rgb): Rgb => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      if (!alpha) return [0, 0, 0, 0];
      return [
        (front[0] * front[3] + back[0] * back[3] * (1 - front[3])) / alpha,
        (front[1] * front[3] + back[1] * back[3] * (1 - front[3])) / alpha,
        (front[2] * front[3] + back[2] * back[3] * (1 - front[3])) / alpha,
        alpha
      ];
    };
    const luminance = (rgb: Rgb): number => {
      const channel = (value: number): number => {
        const normalized = value / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    };
    const fallback: Rgb = [245, 248, 246, 1];
    return requested.map((sample) => {
      const element = document.querySelector<HTMLElement>(sample.selector);
      if (!element) return { ...sample, missing: true, ratio: null, threshold: sample.threshold ?? 4.5 };
      const styles = getComputedStyle(element);
      let background = fallback;
      const ancestors: Element[] = [];
      let current: Element | null = element;
      while (current) {
        ancestors.push(current);
        current = current.parentElement;
      }
      for (const ancestor of ancestors.reverse()) {
        const layer = parseColor(getComputedStyle(ancestor).backgroundColor);
        if (layer && layer[3] > 0) background = over(layer, background);
      }
      const foreground = parseColor(styles.color);
      if (!foreground) return { ...sample, missing: false, ratio: 0, threshold: sample.threshold ?? 4.5 };
      const ratio = (Math.max(luminance(foreground), luminance(background)) + 0.05) / (Math.min(luminance(foreground), luminance(background)) + 0.05);
      return { ...sample, missing: false, ratio: Number(ratio.toFixed(2)), threshold: sample.threshold ?? 4.5 };
    });
  }, samples);
  const missing = results.filter((result) => result.missing);
  const failures = results.filter((result) => !result.missing && result.ratio !== null && result.ratio < result.threshold);
  expect(missing, `${state}: rendered contrast selectors missing: ${JSON.stringify(missing)}`).toEqual([]);
  expect(failures, `${state}: rendered contrast failures: ${JSON.stringify(failures)}`).toEqual([]);
}

test("login, dashboard and every primary route remain axe-clean", async ({ page }) => {
  // This cross-browser scan visits every primary route; Firefox can exceed the
  // suite default while running serially under the full matrix.
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
  await expectNoAxeViolations(page, "login");

  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  await expectNoAxeViolations(page, "dashboard");
  await expectRenderedContrast(page, "dashboard", [
    { id: "page-heading", selector: ".page-header h1" },
    { id: "page-description", selector: ".page-header p" },
    { id: "primary-action", selector: ".page-header .button-primary" },
    { id: "text-action", selector: ".page-header .button + * .text-button, .signal-strip .text-button" },
    { id: "environment-label", selector: ".environment-banner .banner-mark" }
  ]);

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
  await navigate("Exames", "Pedidos, amostras e resultados", "exams");
  await navigate("Internação", "Internações em andamento", "hospital");
  await navigate("Comunicações", "Mensagens e aprovações", "communications");
  await navigate("Conhecimento", "Conhecimento governado", "knowledge");
  await navigate("Relatórios", "Relatórios", "reports");
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
