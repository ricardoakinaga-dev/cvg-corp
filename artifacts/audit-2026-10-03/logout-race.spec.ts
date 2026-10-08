import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";

test("baseline: ordinary online logout stays on the login screen", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
});

test("diagnostic probe: delayed real context response resurrects a locally signed-out session", async ({ page }) => {
  // PASS here means the reported defect was reproduced, not that logout is safe.
  await page.goto("/");
  await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  let release!: () => void;
  let entered!: () => void;
  const responseReady = new Promise<void>((resolve) => { entered = resolve; });
  const releaseResponse = new Promise<void>((resolve) => { release = resolve; });
  let logoutRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/v1/auth/logout")) logoutRequests += 1;
  });
  await page.route("**/api/v1/contexts", async (route) => {
    const actualResponse = await route.fetch();
    entered();
    await releaseResponse;
    await route.fulfill({ response: actualResponse });
  });
  try {
    await page.getByLabel("Selecionar unidade e workspace").selectOption({ label: "Unidade Sul · Operação clínica" });
    await responseReady;
    await expect(page.getByRole("region", { name: "Estado do ambiente" }).getByText("REVALIDATING", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Sair", exact: true }).click();
    await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
    await expect(page.getByText("revogação desta sessão no servidor ainda não foi confirmada")).toBeVisible();
    release();
    await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
    // runtimeStatePresentation(ONLINE) deliberately renders LOCAL SINTÉTICO.
    await expect(page.getByRole("region", { name: "Estado do ambiente" }).getByText("LOCAL SINTÉTICO", { exact: true })).toBeVisible();
    const me = await page.request.get("/api/v1/me");
    const observation = {
      probe: "FQ06_LOGOUT_REVALIDATION_RACE", observedAt: new Date().toISOString(),
      loginScreenObservedAfterSignOut: true, pendingRevocationObserved: true,
      staleResponseReopenedAuthenticatedShell: true, runtimeOnline: true,
      logoutRequests, serverMeStatus: me.status(),
      scope: "Real React UI and local API, synthetic demo memory store, controlled delay of a real contexts response; no external service or production data.",
    };
    writeFileSync(new URL("./logout-race-observation.json", import.meta.url), JSON.stringify(observation, null, 2) + "\n");
    console.log(JSON.stringify(observation));
    expect(logoutRequests).toBe(0);
    expect(me.status()).toBe(200);
  } finally {
    release();
    await page.unroute("**/api/v1/contexts");
  }
});
