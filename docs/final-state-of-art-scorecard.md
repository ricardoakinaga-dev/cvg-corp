# Final State-of-the-Art Scorecard (local)

**subject SHA:** `f53f9eb3e5a44240823f29cbf7307a52f6b5a139`
**Classificação:** WORKTREE (worktree modificado; não é um candidate SHA congelado)
**Data:** 2026-09-16
**Regra:** nenhum score sem evidência correspondente. Onde não há evidência suficiente, `score = null`.

`engineeringState = LOCAL_STATE_OF_THE_ART_CANDIDATE`
`stateOfTheArtState = STATE_OF_THE_ART_NOT_PROVEN`
`productionState = NOT_PROVEN`
`aaaState = AAA_NOT_PROVEN`

## Dimensões

| # | Dimensão | Score | Status | Evidência principal | Limitações / risco residual |
| --- | --- | --- | --- | --- | --- |
| 1 | Architecture | null | PROVEN_LOCAL | `npm run verify:architecture` (domainImports=0, applicationProviderImports=0); ADR 034–038; `docs/architecture-final.md` | Sem prova de processo isolado (worker-thread/standalone) |
| 2 | Domain Integrity | null | PROVEN_LOCAL | `npm test` (480 testes, 0 falhas); `verify:authoritative-writes`; `verify:audit-chain` | Sem PostgreSQL real nesta máquina |
| 3 | Security | null | PROVEN_LOCAL | `verify:agent-security` (10 ataques); `verify:security-red-team`; `docs/agent-runtime-threat-model.md` | Sem pentest externo; sem varredura CVE do upstream |
| 4 | Authentication | null | NOT_RUN_FOR_CHANGE | `tests/unit/auth.test.ts`, `tests/integration/api.test.ts` (inalterados) | Fluxo MFA real sem Segredo Authority externo |
| 5 | Authorization | null | PROVEN_LOCAL | `verify:pdp-universal` (85 operações, 88 regras); `verify:pdp` | PDP de produção ainda exige homologação humana |
| 6 | PDP | null | PROVEN_LOCAL | `scripts/verify-pdp-universal.ts`; `packages/agent-policy/src/index.ts` | — |
| 7 | Tool Gateway | null | PROVEN_LOCAL | `packages/agent-tools/src/index.ts`; `createGovernedToolGateway`; receipts duráveis em `store.commandReceipts` | Executor de aplicação real ainda é injetável (sintético por padrão) |
| 8 | Agent Runtime | null | PROVEN_LOCAL | `verify:agent-runtime` (55 testes focados); `verify:agent-runtime-smoke`; `verify:agent-chaos` (7 falhas + retomada após restart); `benchmark:agent-runtime` (1–50 sessões, backpressure em 8) | Execução multi-instância com PostgreSQL real coberta por `verify:postgres` (CI/staging), não executada nesta máquina |
| 9 | Embedded Harness | null | PROVEN_LOCAL | `verify:embedded-harness` (17 artefatos, 43 testes); decisão HYBRID; 0 arquivos upstream incorporados | Paridade com o harness externo não é pretendida nem medida |
| 10 | Plugin Security | null | PROVEN_LOCAL | `verify:plugins` (manifesto, digest, allowlist, risco, dependências, ciclo, crash); kill switch de plugin aplicado pelo runtime quando `pluginRuntime` é injetado | Sandbox de plugins HIGH/UNTRUSTED não implementado (não exigido sem plugin real); API não registra plugins hoje |
| 11 | Skill Governance | null | PROVEN_LOCAL | `verify:skills` (schema, digest, requirementos, quarentena, frontmatter) | Nenhuma skill aprovada em produção |
| 12 | Context Governance | null | PROVEN_LOCAL | `tests/unit/agent-context.test.ts`; firewall estrutural + findings; projeção mínima | Custo de token real por provider não medido |
| 13 | Database | null | NOT_RUN | migrations 001–037 aplicadas em evidência anterior; migration 038 escrita | 038 não aplicada/validada localmente (sem PostgreSQL/Docker) |
| 14 | Reliability | null | PARTIAL | leases/fencing (`DENIED_STALE_FENCE`), `OUTCOME_UNKNOWN` persistente, retry classificado, circuit breaker; reparos pós-crítica: RLS scoping, fence no SQL, renovação de lease, budget `UNKNOWN` fail-closed, consumo atômico de approval | Correções SQL ainda não executadas contra PostgreSQL real (sem Docker/PostgreSQL local) |
| 15 | Workers | null | PROVEN_LOCAL | `verify:worker-runtime` (6 policies, 35 testes focados) | Handlers de negócio de produção inalterados |
| 16 | DeepSeek Integration | null | BLOCKED_EXTERNAL | `verify:deepseek-real` ausente de credenciais; `verify:state-of-art-external` → BLOCKED_EXTERNAL | Nenhum turno real executado |
| 17 | AI Governance | null | PROVEN_LOCAL | PDP + approval one-shot + kill switches + `AI_SAFE_MODE` + `/api/v1/ai/ready` | Sem prova de runtime sob carga real |
| 18 | Provider Integration | null | BLOCKED_EXTERNAL | `verify:provider-real` requer endpoint/token reais | Callbacks reais e reconciliação externa não executados |
| 19 | Frontend | null | PROVEN_LOCAL | Estados de IA (`apps/web/src/features/copilot/assistant-state.ts`), banner de degradação via `/ai/health`, prévia de aprovação completa e rótulo AI_GENERATED_DRAFT; testes unitários e E2E de copiloto verdes | Revisão visual dedicada e leitor de tela permanecem fora desta rodada |
| 20 | Accessibility | null | NOT_RUN_FOR_CHANGE | Matriz axe anterior inalterada | Sem re-execução completa nesta rodada |
| 21 | Testing | null | PROVEN_LOCAL | `npm test` 480/479 pass + 1 skip; evals 7/7; diferencial 1/1 | Sem cobertura E2E nova para o runtime embarcado |
| 22 | Observability | null | PARTIAL | `EmbeddedTelemetryPort` + eventos do kernel + `/api/v1/ai/ready` | Sem collector/SLO externos |
| 23 | Performance | null | PROVEN_LOCAL | `benchmark:agent-runtime` (overhead do runtime com provider determinístico; amostras brutas em `artifacts/operational-proof/agent-runtime-load-local.json`) | Sem baseline de provider real; budgets `PROPOSED` |
| 24 | Recovery | null | PARTIAL | Checkpoint/resume comprovado (`verify:agent-runtime-smoke`); retomada após restart durante WAITING_APPROVAL e persistência de OUTCOME_UNKNOWN (`verify:agent-chaos`) | Backup/restore de `agent_*` e RTO/RPO não medidos |
| 25 | DevOps | null | PARTIAL | Gates declarados em `package.json`; CI existente inalterado | Nenhum dos novos gates foi adicionado ao workflow CI ainda |
| 26 | Supply Chain | null | PROVEN_LOCAL | `audit:licenses`; 0 dependências novas; SBOM inalterado | Sem análise CVE do upstream incorporado (porque nada foi incorporado) |
| 27 | Production Readiness | null | NOT_PROVEN | — | Requer staging, provider real, observability, carga/chaos/recovery e aprovação humana |

## Critérios do item 238 (STATE_OF_THE_ART_CANDIDATE)

| Critério | Estado |
| --- | --- |
| architecture >= 95 | null (sem score calibrado; evidências locais fortes) |
| domain integrity >= 95 | null |
| security >= 95 | null |
| authorization >= 95 | null |
| reliability >= 95 | null |
| AgentRuntime proven | PROVEN_LOCAL (não externo) |
| Tool Gateway proven | PROVEN_LOCAL |
| no critical blocker | nenhum bloqueador crítico local; bloqueadores externos presentes |

Resultado honesto: `STATE_OF_THE_ART_NOT_PROVEN`; o melhor rótulo local é
`LOCAL_STATE_OF_THE_ART_CANDIDATE` (item 479).
