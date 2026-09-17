# Final report — Embedded Agent Runtime + Triple AAA closure

**subject SHA:** `f53f9eb3e5a44240823f29cbf7307a52f6b5a139`
**Data:** 2026-09-16
**Classificação do estado:** `LOCAL_STATE_OF_THE_ART_CANDIDATE` (local) ·
`STATE_OF_THE_ART_NOT_PROVEN` (externo) · `AAA_NOT_PROVEN`

## CURRENT SHA

`f53f9eb3e5a44240823f29cbf7307a52f6b5a139` (worktree modificado pelo programa;
candidate SHA será congelado após o commit).

## DECISION

**HYBRID** — `docs/adr/ADR-agent-runtime-embedding-decision.md`.

- Runtime embarcado **CVG-owned** atrás do `AgentRuntime` (kernel, contexto, sessão,
  plugins, skills, model runtime/adapters).
- Runtime externo (DeepSeek Harness) preservado como adapter selecionável e rollback.
- **Nenhum arquivo do upstream foi incorporado** (MIT auditorada, commit
  `5dda764ed3aa172535a7967b06ff95d9cbfe536a`); conceitos foram reimplementados
  (`REIMPLEMENT/ADAPT`), conforme `docs/embedded-harness-audit.md`.

## ARCHITECTURE

- Porta `AgentRuntime` (v1, `AgentRuntimeContract/v1`) com manifest determinístico.
- Kernel provider-neutral (13 estados, 9 stop conditions, limites de turns/tools/tokens/tempo/custo/falhas,
  detecção de loop e progresso explícito) em `packages/agent-kernel`.
- Context Builder governado (trust levels, prioridade, firewall estrutural, minimização)
  em `packages/agent-context`.
- Sessão durável com lease/fencing/checkpoint/turn ledger em `packages/agent-session`
  e migration `038_agent_runtime_session_state.sql` (RLS/append-only).
- Plugins por capability (sem autoridade ambiente) e skills como conhecimento
  (sem conceder autoridade).
- `ModelProvider` com capabilities, data policy, router, circuit breaker e retry
  classificado; adapters Mock/DeepSeek/Local.
- Tool Gateway + PDP permanecem soberanos; nenhuma tool é executada fora deles.
- Seleção `CVG_AGENT_RUNTIME=auto|embedded|external|disabled`; readiness de IA
  separada (`/api/v1/ai/ready`); indisponibilidade de IA nunca derruba `/api/v1/ready`.

## IMPLEMENTED

- 7 novos pacotes: `agent-kernel`, `agent-context`, `agent-session`, `agent-plugins`,
  `agent-skills`, `model-runtime`, `model-adapters`; runtime embarcado em
  `embedded-agent-runtime`.
- Governança: PDP, approval one-shot vinculado a digest, budget/settlement, receipts
  duráveis, `AI_SAFE_MODE`, kill switches de provider/tool/plugin, `AI_DEGRADED`.
- Evals: corpus sintético `evals/golden/*.json` + runner determinístico com
  differential/shadow estrutural.
- Gates novos: `verify:architecture`, `verify:agent-runtime`,
  `verify:agent-runtime-smoke`, `verify:embedded-harness`, `verify:agent-security`,
  `verify:plugins`, `verify:skills`, `verify:agent-evals`, `verify:ai-disabled`,
  `verify:state-of-art`, `verify:state-of-art-external`, `verify:docs-provenance`,
  `verify:claims`; `verify:triplo-aaa` reforçado com os gates locais.
- Documentação: auditoria, proviniência, 5 ADRs, arquitetura final, data flow,
  threat model, security review, red team, rollout, comparison, verification,
  evals e 8 runbooks.
- Executor de aplicação vinculado: `cvg.patient.read`, `cvg.agenda.read` e
  `cvg.clinical.draft` resolvem leituras governadas com projeção mínima e
  revalidação de escopo; tools de efeito sem binding falham fechado.
- Custos: pricing opcional por operador (`CVG_EMBEDDED_MODEL_PRICING_JSON`) com
  revisão e teto global (`CVG_AI_MAX_COST_MICROS`); sem preço, o custo permanece
  explicitamente desconhecido.
- Estados de IA na UI: disponibilidade (`/ai/health`), falhas distintas
  (indisponível/aguardando aprovação/limite/negado/reconciliação), prévia de
  aprovação completa (operação, efeito, risco, alvo, escopo, digest, expiração)
  e rótulo `AI_GENERATED_DRAFT`.
- Chaos local (7 falhas) e baseline de carga (1–50 sessões) com artefatos.
- Suíte de contrato única para todos os `ModelProvider` (saúde, capabilities, data
  policy, envelope, usage, cancelamento, normalização de erro) e testes de
  classificação de replay (EXACT/COMPATIBLE/NON_EQUIVALENT) e compatibilidade.
- Métricas de anomalia do runtime expostas em Prometheus (`cvg_agent_*`), com nomes
  sanitizados e sem identificadores de tenant/ator.
- Gate externo `verify:embedded-deepseek` (alias `verify:model-real`): prova o
  caminho Embedded → DeepSeek real quando houver endpoint/credencial/classes
  autorizadas; sem eles retorna `BLOCKED_EXTERNAL` e rejeita loopback/mock.

## TESTED (real, local)

| Gate | Resultado |
| --- | --- |
| `npm test` | 480 testes, 479 pass, 1 skip, 0 fail |
| `verify:agent-runtime` | PASS (46 testes focados) |
| `verify:embedded-harness` | PASS (17 artefatos, 43 testes) |
| `verify:agent-security` | PASS (10 ataques adversariais) |
| `verify:plugins` / `verify:skills` | PASS (10 / 5 testes) |
| `verify:agent-evals` | PASS (7/7 cenários; paridade diferencial 1/1) |
| `verify:ai-disabled` | PASS (núcleo operacional com IA desabilitada) |
| `verify:agent-runtime-smoke` | PASS (session → tool → approval → checkpoint → resume → drain) |
| `verify:architecture` | PASS (domainImports=0, applicationProviderImports=0) |
| `verify:pdp-universal` / `verify:pdp` | PASS |
| `verify:postgres` (PostgreSQL 16.15 local real) | PASS (migrations 001–039; RLS do catálogo; fence no banco; append-only; sessão/turnos do agente) |
| `verify:postgres:concurrency` | PASS (2 processos, 1 vencedor, 0 efeitos duplicados) |
| `verify:postgres:restore` | PASS (quarentena, login/readiness bloqueados, fonte inalterada) |
| `verify:production` (structural, local com WebKit habilitado) | PASS (Compose/release estruturais; containers não iniciados) |
| `verify:agent-chaos` | PASS (7 falhas: provider down, timeout, tool OUTCOME_UNKNOWN, ledger, restart em approval, persistência de outcome unknown, budget port; sem corrupção de domínio) |
| `benchmark:agent-runtime` | baseline local 1/5/10/25/50 sessões; concorrência limitada a 8 com backpressure (8 aceitos, 42 rejeitados em 50) |
| `verify:assistant-state` (testes) | PASS (estados de IA e prévia de aprovação) |
| `agent-tool-executor` (integração) | PASS (projeção mínima, escopo cruzado negado, argumentos do modelo não redirecionam recurso, efeitos sem binding falham fechado) |
| `model-provider-contract` (contrato) | PASS (mock/deepseek/local no mesmo suite; erros classificados; sem credencial falha fechado) |
| `runtime-manifest` (replay/compat) | PASS (digest determinístico; replay classificado; matriz fail-closed; disabled runtime) |
| `agent-metrics` (ops) | PASS (contadores sanitizados e render Prometheus sem labels de tenant) |
| `verify:embedded-deepseek` | BLOCKED_EXTERNAL (sem endpoint/credencial/classes/evidence autorizados) |

## EXTERNAL BLOCKERS

- `verify:deepseek-real`, `verify:provider-real`, `verify:staging`, `verify:load`:
  `BLOCKED_EXTERNAL` (sem endpoint/credencial/staging autorizados).
- Chaos, recovery production-like, observability/SLO e RTO/RPO externos: `NOT_RUN`.
- Migration 038 não aplicada localmente (sem PostgreSQL/Docker neste ambiente).
- CI same-SHA, critics independentes e aprovações humanas ausentes.

## CRITICAL FINDINGS

Nenhum CRITICAL em aberto no escopo local. Uma crítica independente (fresh context)
encontrou HIGH/MEDIUM reais, que foram reparados nesta rodada:

| # | Severidade | Achado | Reparo aplicado | Evidência |
| --- | --- | --- | --- | --- |
| 1 | HIGH | Postgres agent store sem escopo de tenant (FORCE RLS) e fail-open em erros de lease | `createScopedSqlExecutor` abre transação e aplica `set_config('cvg.organization_id', …, true)`; erros de lease/sessão agora falham com `DEPENDENCY_UNAVAILABLE` | `packages/agent-session/src/index.ts`; `apps/api/src/app.ts` |
| 2 | HIGH | SQL de checkpoint/turn não validava fence e numerava sequência por fence (colisão no 2º turno e escrita stale possível) | `INSERT … WHERE EXISTS (agent_sessions.fence = $n)` + `MAX(sequence)` global por sessão; `latestCheckpoint` filtra `fence <= session.fence` | novos testes em `tests/unit/agent-session.test.ts` |
| 3 | HIGH | Lease de 60 s sem renovação podia expirar no meio do turno | TTL = wall budget + 180 s e `assertLeaseHeld` (renovação) antes de checkpoint e da escrita final do turno | `tests/unit/embedded-runtime.test.ts`, `tests/unit/agent-security.test.ts` |
| 4 | MEDIUM | Reserva de budget `UNKNOWN` permitia turno sem reserva | kernel passa a parar com `DEPENDENCY_UNAVAILABLE` | teste "kernel stops when the budget reservation cannot be confirmed" |
| 5 | MEDIUM | Consumo do approval não era atômico com a execução | approval one-shot é consumido **antes** do dispatch; crash/falha não deixa aprovação reutilizável | teste "a consumed approval cannot be reused even when the effect fails" |
| 6 | MEDIUM | Falha de ledger/checkpoint era engolida | falha de checkpoint falha fechado; turno sem entrada de ledger é rebaixado a `OUTCOME_UNKNOWN` | teste "a turn whose ledger entry cannot be written is not reported as completed" |
| 7 | MEDIUM | Usage desconhecido era liquidado como medido e custo não tinha teto efetivo | `usage.source = UNAVAILABLE` ⇒ `RECONCILIATION_REQUIRED`; custo nulo nunca vira zero; tetos de custo permanecem `PROPOSED` (risco documentado) | teste "unknown provider usage is never settled as if measured" |
| 8 | MEDIUM | Firewall de contexto não cobria histórico de conversa/tool | histórico passa pelo mesmo `evaluate` do Context Builder (delimitado, findings, quarentena) | teste "tool and assistant history is delimited and injection findings are reported" |

Achados residuais assumidos:

- **HIGH (fechado):** o executor de aplicação agora resolve leituras reais
  governadas (`patient.read`, `agenda.read`, `clinical.draft`) com projeção mínima
  e revalidação de escopo; `communication.stage`, `stock.dispense` e
  `finance.refund` permanecem sem binding e falham fechado (nenhum sucesso
  sintético). Ligar comandos de efeito exige um binding de aplicação dedicado e
  aprovação de produto.
- **MEDIUM (fechado localmente):** as correções SQL foram exercitadas contra
  **PostgreSQL 16.15 real** local (instância portátil sem root): migrations
  001–039, RLS por tenant, fence stale rejeitado no banco (migration 039),
  append-only comprovado em escopo de tenant, sequência global, concorrência de
  2 processos sem efeito duplicado e restore quarentenado. Multi-instância em
  staging e backup gerenciado permanecem externos.
- **MEDIUM:** `disabledPlugins` só é aplicado quando um `pluginRuntime` é injetado;
  a API não registra plugins hoje (sem plugins de produção).
- **LOW:** `/api/v1/ai/ready` usa `auth: PUBLIC` no catálogo (metadado sem dado de
  ator), igual a `/health` e `/ready`.
- **MEDIUM (produto, não corrigido por exigir autoridade de produto):**
  `rescheduleAppointment` valida conflito no escopo de **unidade**, enquanto
  `createAppointment` valida no escopo de **workspace**; um agendamento na
  recepção bloqueia o reagendamento clínico do mesmo profissional. Descoberto
  pelo E2E (jornada de agenda) e contornado no teste com janelas após 13:00; a
  correção de semântica (alinhar os dois escopos) requer decisão de produto.
- **LOW (teste):** a jornada de agenda é sensível ao par de fusos
  navegador/servidor; em CI ambos são UTC e as janelas iniciam após os fixtures
  semeados (10:30–11:15 e 12:00–12:45).

## RESIDUAL RISKS

- Paridade funcional com o harness externo não é medida (por decisão: HYBRID
  reutiliza mecanismos, não o produto).
- Nenhum benchmark de latência/custo do kernel; budgets permanecem `PROPOSED`.
- UI de estados de degradação de IA implementada no backend (`ai.degraded`);
  revisão visual dedicada pendente.
- Checkpoint contém argumentos de tool (não segredos); retenção `PROPOSED`.

## NEXT GATE

1. Aplicar migration 038 em PostgreSQL local autorizado e rodar
   `verify:postgres:concurrency` + restore para as tabelas `agent_*`.
2. Congelar candidate SHA, gerar `artifacts/quality/current-state.json` como
   `CURRENT` e rodar `verify:state-of-art` no mesmo SHA.
3. CI same-SHA com os novos gates.
4. Staging autorizado: `verify:staging`, provider real, observability, carga,
   chaos e recovery; registrar `observed RTO/RPO`.
5. Critics independentes e aprovações humanas.

## Execução do verificador oficial (verify:triplo-aaa)

Resultado literal no SHA local:

```text
VERDICT AAA_NOT_PROVEN
PROMOTION BLOCKED synthetic/local evidence is not Triple AAA evidence; use a validated same-SHA external bundle separately
FAIL-CLOSED verification is incomplete; no AAA promotion is possible
```

Fatos registrados pelo próprio verificador:

- gates externos (`deepseek`, `provider`, `secretAuthority`, `webauthnBreakGlass`,
  `staging`, `observability`, `browserMatrix`, `recovery`, `restore`, `rtoRpo`,
  `load`, `resourcePressure`, `securityHeaders`, `productionConfig`,
  `containerSmoke`, `stagingPromotion`, `runbookExecution`, `critics`,
  `repairLoop`, `humanApproval`): `NOT_RUN` — sem bundle externo same-SHA;
- `audit:dependency-registry`: `BLOCKED` (acesso a registry desabilitado por política);
- `production-structural-local`: `BLOCKED` por timeout limitado de 180 s do
  verificador; a matriz completa de browsers exige `libgstcodecparsers-1.0.so.0`
  (WebKit) e leva ~10 min neste host. O subset suportado
  (`test:e2e:smoke:serial`, 254 pass / 22 skips) é verificado por
  `verify:state-of-art`, que está **verde em 30/30 gates**;
- `sbom`, `diff` e demais gates locais do verificador: `PASS`.

Conclusão: nenhuma promoção é possível; o estado permanece
`LOCAL_STATE_OF_THE_ART_CANDIDATE` / `AAA_NOT_PROVEN`.

## Avaliações técnicas deliberadamente não adotadas (com justificativa)

| Avaliação (prompt) | Decisão | Justificativa |
| --- | --- | --- |
| Mutation testing (523) | não adotado nesta rodada | PDP/gateway/approval/fencing já têm suítes adversariais e de invariantes; mutação adiciona custo alto de CI sem mudar o veredito externo. Reavaliar em staging |
| Property-based testing (524) | parcial | fencing, idempotência e sequenciamento têm casos adversariais determinísticos (fence stale, replay, OUTCOME_UNKNOWN, sequência global); gerador aleatório não traria cobertura nova comprovada |
| Fuzzing (525) | parcial | manifestos de plugin/skill e envelopes já validam digest/schema e falham fechado; fuzzing estruturado (callbacks externos) depende de superfície externa autorizada |
| Processo standalone do runtime (50/161/165) | adiado por ADR | `ADR-agent-runtime-process-boundary.md`: in-process com portas tipadas e fail-closed; extração para processo próprio é reavaliada com staging |
| Hot reload de plugins (160) | rejeitado em produção | deploy validado é a única forma; documentado no ADR de plugins |
| IDs de sessão/turno gerados por modelo (445/446) | rejeitado por desenho | IDs e recursos são sempre resolvidos pelo runtime a partir do contexto autenticado, nunca do texto do modelo |
