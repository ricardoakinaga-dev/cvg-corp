# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: logout-race.spec.ts >> diagnostic probe: delayed real context response resurrects a locally signed-out session
- Location: artifacts/audit-2026-10-03/logout-race.spec.ts:14:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('region', { name: 'Estado do ambiente' }).getByText('ONLINE', { exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('region', { name: 'Estado do ambiente' }).getByText('ONLINE', { exact: true }) with timeout 5000ms
  - waiting for getByRole('region', { name: 'Estado do ambiente' }).getByText('ONLINE', { exact: true })

```

```yaml
- link "Pular para o conteúdo principal":
  - /url: "#main-content"
- complementary "Navegação e contexto":
  - text: CVG• CARE OPS ESPAÇO ATIVO
  - 'group "Espaço ativo: Operação clínica, unidade Unidade Sul"'
  - combobox "Selecionar unidade e workspace":
    - option "Trocar espaço"
    - option "Unidade Centro · Operação clínica"
    - option "Unidade Centro · Recepção"
    - option "Unidade Sul · Operação clínica" [selected]
  - navigation "Navegação principal":
    - text: TRABALHO
    - button "Visão geral"
    - button "Agenda"
    - button "Pacientes"
    - button "Atendimento"
    - button "Farmácia"
    - button "Financeiro"
    - button "Copiloto"
    - text: JORNADAS OPERACIONAIS
    - button "Exames"
    - button "Internação"
    - button "Comunicações"
    - button "Conhecimento"
    - button "Relatórios"
  - button "Administração"
  - strong: Precisa de foco?
  - text: Veja a fila de hoje RA
  - strong: Ricardo Akinaga
  - text: admin@cvg.local
  - button "Sair"
- banner:
  - text: CVG
  - strong: Visão geral
  - textbox "Busca rápida":
    - /placeholder: Buscar paciente, tutor…
  - button "Notificações"
  - text: RA
- region "Estado do ambiente":
  - text: LOCAL SINTÉTICO Dados descartáveis · caminho manual disponível · providers externos bloqueados
  - button "Ocultar aviso"
- 'main "Página: Visão geral"':
  - text: SÁBADO · 03 DE OUTUBRO
  - heading "Bom dia, Ricardo." [level=1]
  - paragraph: Aqui está o pulso da Unidade Sul.
  - button "Novo atendimento"
  - text: LEITURA DO MOMENTO
  - strong: 0 pacientes aguardando atenção
  - text: Próximo atendimento
  - strong: sem janela
  - button "Ver fila"
  - article:
    - text: Hoje na agenda
    - strong: "00"
    - text: Agendamentos no contexto
  - article:
    - text: Na fila agora
    - strong: "00"
    - text: Sem pacientes aguardando
  - article:
    - text: Atenção no estoque
    - strong: "00"
    - text: Sem alertas ativos
  - article:
    - text: Cobranças em aberto
    - strong: "00"
    - text: Financeiro · quantidade no contexto
  - text: FLUXO DE HOJE
  - heading "Próximos atendimentos" [level=2]
  - button "Abrir agenda"
  - strong: Agenda livre
  - paragraph: Nenhum atendimento encontrado para este contexto.
  - button "Abrir agenda"
  - text: CVG COPILOTO
  - heading "Clareza para o próximo passo." [level=2]
  - paragraph: Resuma a fila, organize um rascunho ou encontre uma fonte aprovada — sempre com revisão humana.
  - button "Abrir copiloto"
  - text: provider local sintético sem envio externo PACIENTES RECENTES
  - heading "Relações em cuidado" [level=2]
  - button "Ver todos"
  - text: PROFILE DO COPILOTO sintético Atividade recente últimas 8 interações ILUSTRAÇÃO
  - img "Atividade recente do Copiloto em oito interações sintéticas"
  - strong: "6"
  - text: tools governadas no profile
  - button "Ver sinais"
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | import { writeFileSync } from "node:fs";
  3  | 
  4  | test("baseline: ordinary online logout stays on the login screen", async ({ page }) => {
  5  |   await page.goto("/");
  6  |   await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  7  |   await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  8  |   await page.getByRole("button", { name: "Sair", exact: true }).click();
  9  |   await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
  10 |   await page.reload();
  11 |   await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
  12 | });
  13 | 
  14 | test("diagnostic probe: delayed real context response resurrects a locally signed-out session", async ({ page }) => {
  15 |   // PASS here means the reported defect was reproduced, not that logout is safe.
  16 |   await page.goto("/");
  17 |   await page.getByRole("button", { name: /Abrir demonstração sintética/i }).click();
  18 |   await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
  19 |   let release!: () => void;
  20 |   let entered!: () => void;
  21 |   const responseReady = new Promise<void>((resolve) => { entered = resolve; });
  22 |   const releaseResponse = new Promise<void>((resolve) => { release = resolve; });
  23 |   let logoutRequests = 0;
  24 |   page.on("request", (request) => {
  25 |     if (request.url().endsWith("/api/v1/auth/logout")) logoutRequests += 1;
  26 |   });
  27 |   await page.route("**/api/v1/contexts", async (route) => {
  28 |     const actualResponse = await route.fetch();
  29 |     entered();
  30 |     await releaseResponse;
  31 |     await route.fulfill({ response: actualResponse });
  32 |   });
  33 |   try {
  34 |     await page.getByLabel("Selecionar unidade e workspace").selectOption({ label: "Unidade Sul · Operação clínica" });
  35 |     await responseReady;
  36 |     await expect(page.getByRole("region", { name: "Estado do ambiente" }).getByText("REVALIDATING", { exact: true })).toBeVisible();
  37 |     await page.getByRole("button", { name: "Sair", exact: true }).click();
  38 |     await expect(page.getByRole("heading", { name: "O cuidado em foco." })).toBeVisible();
  39 |     await expect(page.getByText("revogação desta sessão no servidor ainda não foi confirmada")).toBeVisible();
  40 |     release();
  41 |     await expect(page.getByRole("heading", { name: "Bom dia, Ricardo." })).toBeVisible();
> 42 |     await expect(page.getByRole("region", { name: "Estado do ambiente" }).getByText("ONLINE", { exact: true })).toBeVisible();
     |                                                                                                                 ^ Error: expect(locator).toBeVisible() failed
  43 |     const me = await page.request.get("/api/v1/me");
  44 |     const observation = {
  45 |       probe: "FQ06_LOGOUT_REVALIDATION_RACE", observedAt: new Date().toISOString(),
  46 |       loginScreenObservedAfterSignOut: true, pendingRevocationObserved: true,
  47 |       staleResponseReopenedAuthenticatedShell: true, runtimeOnline: true,
  48 |       logoutRequests, serverMeStatus: me.status(),
  49 |       scope: "Real React UI and local API, synthetic demo memory store, controlled delay of a real contexts response; no external service or production data.",
  50 |     };
  51 |     writeFileSync(new URL("./logout-race-observation.json", import.meta.url), JSON.stringify(observation, null, 2) + "\n");
  52 |     console.log(JSON.stringify(observation));
  53 |     expect(logoutRequests).toBe(0);
  54 |     expect(me.status()).toBe(200);
  55 |   } finally {
  56 |     release();
  57 |     await page.unroute("**/api/v1/contexts");
  58 |   }
  59 | });
  60 | 
```