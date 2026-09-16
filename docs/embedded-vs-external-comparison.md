# Runtime embarcado vs. runtime externo — comparação baseada em evidência

**Subject SHA:** `f53f9eb3e5a44240823f29cbf7307a52f6b5a139`
**Data:** 2026-09-16
**Status:** decisão HYBRID registrada em `docs/adr/ADR-agent-runtime-embedding-decision.md`; comparação diferencial limitada a paridade estrutural sintética.
**Estado declarado:** `engineeringState = LOCAL_STATE_OF_THE_ART_CANDIDATE` · `aaaState = AAA_NOT_PROVEN` · `productionState = NOT_PROVEN`.

---

## 1. Dimensões

| Dimensão | Runtime externo (DeepSeek Harness via adapter) | Embedded importando o upstream | Hybrid adotado (CVG-owned) | Evidência local |
| --- | --- | --- | --- | --- |
| Latência | Pior: hop de processo (ACP/HTTP) + serialização | Melhor em teoria | In-process por contrato de porta; sem número medido | Sem benchmark local de latência; `verify:load` externo indisponível |
| Segurança | Boundary já governado pelo CVG | Ruim: approval/sandbox/credenciais/persistência próprios competiriam com PDP e RLS | Boa: kernel sem autoridade; toda tool atravessa Tool Gateway → PDP | `docs/embedded-harness-audit.md` §6; `npm run verify:architecture` |
| Blast radius | Isolado por processo | Alto: Cordis + 267 pacotes + módulos nativos no mesmo repo/release | Médio: código CVG, fail-closed, readiness de IA separada | `docs/adr/ADR-agent-runtime-process-boundary.md`; `apps/api/src/routes/health.ts:96` |
| Atualização | Alinhada ao produto upstream | Fork vendorizado com patches de lockfile e toolchain divergente | Kernel próprio estável; upstream só via contrato `/v1` se usado como processo | `docs/third-party/deepseek-harness-provenance.md` |
| Debug | Difícil: processo opaco | Muito difícil: plugin tree Cordis + eventos `dsh` | Kernel local testável e determinístico | `npm run verify:agent-runtime` (focusedTests=46) |
| Operação | Segundo runtime de terceiro | Segundo toolchain (pnpm 11.7, Node ^22, TS 6 RC, Electron) | Um toolchain (npm, Node >=24); `CVG_AGENT_RUNTIME` alterna o adapter | `packages/config/src/index.ts:76`; `apps/api/src/app.ts:586` |
| Portabilidade | Presa ao produto upstream | Presa ao fork | Provider-neutral por contrato próprio (`ModelProvider`) | `packages/model-runtime/src/index.ts:108`; `tests/unit/model-adapters.test.ts` |
| Licença | MIT consumida como produto externo (não redistribuída) | MIT permite, mas arrasta Apache-2.0/SDKs/binários e exige NOTICE | Sem código de terceiro no produto; conceitos reimplementados | `docs/third-party/deepseek-harness-provenance.md`; `npm run audit:licenses` |
| Testabilidade | Limitada (mock da ponte) | Testes do upstream não cobrem o CVG | Alta: 7 cenários dourados + suíte focada + evals determinísticos | `npm run verify:agent-evals`; `tests/unit/*` |
| Vendor coupling | Alto (produto) | Altíssimo (fork) | Baixo (contrato `/v1` + `ModelProvider`) | `scripts/verify-architecture.ts` (domainImports=0) |
| Tamanho | 0 LOC no repo | +~222k LOC TS e ~267 manifests | Mínimo suficiente (8 pacotes novos + 1 migration) | `docs/embedded-harness-audit.md` §5 |

## 2. Por que a opção de embarcar o produto upstream foi rejeitada

Fatos registrados na auditoria (`docs/embedded-harness-audit.md`):

- o upstream não é uma biblioteca de kernel: o loop depende do framework Cordis, da sessão event-sourced v0→v3 e de vocabulário `dsh`;
- approval, permissões, sandbox, credenciais e persistência do upstream duplicariam a governança do CVG, criando uma segunda autoridade — proibido pela lei de soberania do PDP/Tool Gateway;
- o runtime completo exige toolchain divergente e módulos nativos (`node-pty`, `koffi`, addons Landlock, `sharp`, ripgrep), aumentando supply chain e blast radius sem benefício ao domínio veterinário;
- nenhum arquivo upstream foi incorporado; a proveniência registra “Nenhum” em `docs/third-party/deepseek-harness-provenance.md`.

A opção puramente externa também foi rejeitada porque impede latência local, teste sem credencial externa e a própria prova de neutralidade de provider exigida pelo programa.

## 3. O que os evals diferenciais compararam

`scripts/agent-evals.ts` executa o cenário com `differential: true` nos dois runtimes em processo: `EmbeddedAgentRuntime` e `MockHarnessAdapter` + `GovernedHarness` (`compareDifferential`, linha 205). A comparação é **estrutural** e olha somente:

1. `turnStatus` (ex.: `RECEIVED`, `COMPLETED`, `DENIED`, `QUARANTINED`);
2. presença de aprovação (`approval` booleano);
3. negação por policy (`policyDenied`).

Cenário comparado em 2026-09-16: `reception-appointment-confirmation`, com resultado `PARITY` (`embedded=RECEIVED+approval legacy=RECEIVED+approval`), gerado por `npm run verify:agent-evals` (scenarios=7; paridade 1/1; evidência `SYNTHETIC`).

## 4. O que os evals diferenciais NÃO compararam

- **Texto das respostas:** o conteúdo retornado não é comparado entre runtimes.
- **Latência:** não há medição de tempo (o mock não tem custo de rede) e `verify:load` externo está indisponível.
- **Provider real:** ambos os lados usam fixtures determinísticos; nenhum provedor de modelo externo foi contatado.
- **Usage/custo:** tokens e custo não entram na paridade; o settlement local usa fonte `LOCAL_SYNTHETIC`/`UNAVAILABLE`.
- **Tool receipts, drafts e eventos do kernel:** contagens e digests são observados no lado embarcado, mas não fazem parte do critério de paridade diferencial.
- **Processo externo real:** o “legacy” comparado é o harness mock in-process; o `DeepSeekHarnessAdapter` e o `apps/deepseek-bridge` não foram exercitados.
- **Contrato pós-restart:** resume/checkpoint é coberto por smoke local (`verify:agent-runtime-smoke`), não por comparação entre runtimes.

## 5. Evidência primária consultada

| Fonte | O que fornece |
| --- | --- |
| `docs/embedded-harness-audit.md` | Mapa do upstream (commit `5dda764ed3`, MIT, ~222k LOC, 267 manifests), classificação `EMBED/ADAPT/REIMPLEMENT/KEEP_EXTERNAL/REJECT` e limitações da auditoria |
| `docs/adr/ADR-agent-runtime-embedding-decision.md` | Tabela de decisão por critério e fatos decisivos contra `EMBED` e `KEEP_EXTERNAL` puro |
| `docs/adr/ADR-agent-runtime-process-boundary.md` | Comparação in-process vs. worker-thread vs. child-process vs. processo standalone; decisão pela biblioteca in-process na fase 1 |
| `docs/adr/ADR-model-provider-boundary.md` | Contrato `ModelProvider`, regras de capabilities e data policy |
| `docs/third-party/deepseek-harness-provenance.md` | Licença, ausência de código incorporado e dependências heterogêneas do ecossistema upstream |
| `packages/model-runtime/src/index.ts`, `packages/model-adapters/src/index.ts` | Implementação real de router, retry, breaker e três providers |
| `packages/harness-adapters/src/index.ts` | `MockHarnessAdapter` e `DeepSeekHarnessAdapter` (caminho `external`) |
| `scripts/agent-evals.ts` | Comparação diferencial estrutural e artefato `SYNTHETIC` |

## 6. Custo de manutenção assumido

- O CVG mantém o kernel, os adapters e as suítes de teste próprios; atualizações de provider são mudanças de adapter, não de arquitetura.
- Não há fork vendorizado nem segundo gerenciador de pacotes; a dívida evitada é a de acompanhar o upstream Cordis e suas 19 modificações locais.
- O runtime externo continua como produto de terceiro acionado por processo; quando usado, seu contrato é o `/v1` já validado por `DeepSeekHarnessAdapter` (commit/manifest esperados), não uma cópia de código.
- O custo aceito é o de manter paridade de comportamento apenas onde está provada (paridade estrutural) e declarar o restante como não comparado.

## 7. Consequência

O runtime embarcado é CVG-owned e provider-neutral, com o runtime externo preservado como caminho `CVG_AGENT_RUNTIME=external` e rollback. A comparação obtida até aqui é suficiente para paridade estrutural básica e insuficiente para qualquer alegação de equivalência funcional ou de prontidão operacional; essa lacuna é um critério explícito de staging (`docs/embedded-runtime-rollout.md`).
