# Fluxo de dados do Agent Runtime — um turno de ponta a ponta

**Subject SHA:** `f53f9eb3e5a44240823f29cbf7307a52f6b5a139`
**Data:** 2026-09-16
**Status:** descrição do wiring vigente no worktree (runtime embarcado, fase LAB).
**Estado declarado:** `engineeringState = LOCAL_STATE_OF_THE_ART_CANDIDATE` · `aaaState = AAA_NOT_PROVEN` · `productionState = NOT_PROVEN`.

---

## 1. Visão em sequência

```
usuário       API (Fastify)          AgentApplication         EmbeddedAgentRuntime       Kernel/Providers/Store
   │                │                        │                          │                          │
   │ POST /ai/turns │                        │                          │                          │
   ├───────────────▶│ requireSession+CSRF    │                          │                          │
   │                │ requestContext         │                          │                          │
   │                │ enforceApplicationPolicy (PDP)                   │                          │
   │                ├───────────────────────▶│ validateContext          │                          │
   │                │                        │ enforceApplicationPolicy │                          │
   │                │                        │ DurableIdempotencyService│                          │
   │                │                        ├─────────────────────────▶│ aiEnabled? idempotência  │
   │                │                        │                          │ isInContext + purpose     │
   │                │                        │                          │ quarentena de injeção?    │
   │                │                        │                          │ lease+fence (sessão)      │
   │                │                        │                          ├─────▶ agent_leases       │
   │                │                        │                          │ AgentKernel.run           │
   │                │                        │                          ├─▶ ContextBuilder.build  │
   │                │                        │                          │   (trust/prioridade/      │
   │                │                        │                          │    firewall/projeção)     │
   │                │                        │                          ├─▶ budget.reserve        │
   │                │                        │                          │   (budgetReservations)    │
   │                │                        │                          ├─▶ ModelRouter.route     │
   │                │                        │                          │   capability + dataPolicy │
   │                │                        │                          ├─▶ provider.complete     │
   │                │                        │                          │   (retry + breaker)       │
   │                │                        │                          ├─▶ ToolGateway.execute   │
   │                │                        │                          │   └─▶ PDP ─▶ executor     │
   │                │                        │                          ├─▶ checkpoint + turn ledger
   │                │                        │                          │   (agent_checkpoints/     │
   │                │                        │                          │    agent_turns)           │
   │◀── 201/202 ────┤◀───────────────────────┤◀─────────────────────────┤                          │
   │   turn/approval/draft/provenance        │                          │                          │
```

## 2. Hops, confiança e persistência

### Hop 1 — requisição autenticada (`apps/api/src/app.ts:2033`)
`requireSession` + `requireCsrf` exigem cookie de sessão válido e token CSRF. `requestContext` (`apps/api/src/app.ts:921`) resolve unidade/workspace, monta o `CvgContext` e chama `enforceApplicationPolicy(context, "ai.turn.<purpose>")`. **Confiança:** ator autenticado do CVG; nada do modelo participa. **Persistido:** nada ainda.

### Hop 2 — aplicação (`apps/api/src/application/agent-service.ts:21`)
`validateContext` + segunda `enforceApplicationPolicy` + `DurableIdempotencyService` com `operation: "ai.turn"`, `key: input.idempotencyKey` e flag `external: true`. A idempotência é durável e cobre a chamada externa. **Persistido:** receipt de comando (`commandReceipts`) com `bodyDigest` e estado.

### Hop 3 — seleção de runtime (`apps/api/src/app.ts:115`, `:586`)
`config.agentRuntimeMode` (`auto | embedded | external | disabled`, `packages/config/src/index.ts:76`) decide o adapter. Em `embedded`, `createEmbeddedRuntimeAdapter` monta `MockModelProvider`, `DeepSeekModelProvider` ou `LocalModelProvider` conforme `embeddedModelProvider` e injeta `controls` (safe mode, providers/tools desabilitados). **Persistido:** nada; apenas configuração.

### Hop 4 — entrada do runtime (`packages/embedded-agent-runtime/src/index.ts:351`)
Kill switch (`aiEnabled`), atalho de idempotência (`findExistingTurn` por `usage.idempotencyKey`), verificação de injeção no texto do usuário, validação de `requestedTool` contra `TOOL_REGISTRY`/profile/roles, aquisição de lease com fence e `getOrCreateSession`. **Persistido:** `ai_sessions` + `agent_sessions`; turno `QUARANTINED` ou `DENIED` quando aplicável; `agent_leases` com `fence`.

### Hop 5 — kernel (`packages/agent-kernel/src/index.ts:354`)
O loop monta contexto, reserva orçamento, chama o modelo e despacha tools. Todo o estado volátil fica no kernel; cada turno vira um `KernelTurnRecord` com digests. **Persistido ao final:** `agent_checkpoints` (payload com digests) e `agent_turns` (digests + provenance).

### Hop 6 — ContextBuilder (`packages/agent-context/src/index.ts:240`)
Cada item recebe `trust`, `priority`, `dataClass`, `tokens` e `provenance`. Conteúdo `RETRIEVED_UNTRUSTED`/`EXTERNAL_UNTRUSTED`/`USER_SUPPLIED` é emitido como dado delimitado (`renderUntrusted`); itens que disparam o firewall são quarentenados (exceto `TOOL_RESULT`, que segue como dado não confiável). O orçamento corta por prioridade. **Confiança:** `SYSTEM_TRUSTED`/`CVG_TRUSTED` para instruções e tarefa; retrieval nunca vira policy. **Persistido:** apenas o `contextDigest`; os itens não são gravados.

### Hop 7 — roteamento e provider (`packages/model-runtime/src/index.ts:295`)
`ModelRouter.route` exige `toolCalling` quando há tools, testa as classes de dados usadas contra `provider.dataPolicy().allowedDataClasses`, aplica kill switch por chamada e circuit breaker; `withModelRetry` só repete erro classificado como retryable. **Confiança:** fronteira externa — somente a projeção minimizada e o contexto delimitado saem; credencial é resolvida por callback no adapter. **Persistido:** `providerId`, `model` e digests; usage entra no turno.

### Hop 8 — tool request (`packages/embedded-agent-runtime/src/index.ts:823`)
Checagens locais (registro, profile, kill switch, safe mode, risco) e então `ToolGateway.execute` → `authorize` (PDP) → ledger `claim` → executor injetado. Sem aprovação válida, o runtime persiste um turno `RECEIVED` e cria `AiApproval` one-shot; o kernel para em `WAITING_HUMAN`. **Confiança:** autoridade é o PDP; o executor só recebe input já autorizado. **Persistido:** receipt de tool (`commandReceipts`) com `requestDigest`; `agent_turns.tool_request_ids`; `ai_approvals` com digest/expiração/policyRevision.

### Hop 9 — resultado e ledger (`apps/api/src/application/agent-service.ts:77`)
`persistRuntimeResult` revalida autoridade e escopo, pode rebaixar o turno para `OUTCOME_UNKNOWN` (nunca grava `COMPLETED` com autoridade obsoleta), anexa settlement de usage e persiste sessão/turno/rascunho/aprovação no `CvgStore`. A rota grava o registro de auditoria (`apps/api/src/app.ts:2039`) e o commit durável no PostgreSQL. **Persistido:** `ai_turns` (+usage), `auditRecords` (cadeia append-only); rascunho clínico só quando o purpose é `DRAFT_CLINICAL` e o status é `COMPLETED`.

## 3. O que é persistido vs. só digest

| Dado | Onde | Forma |
| --- | --- | --- |
| Prompt do turno | `ai_turns.prompt` | texto integral no store governado; digest em `agent_turns.input_digest` |
| Contexto montado | `agent_turns.context_digest` | somente digest; itens não persistem |
| Request de modelo | `agent_turns.model_request_digest` | somente digest |
| Resposta do modelo | `ai_turns.response` | texto (após scrub de autoridade) + digest em `agent_turns.model_response_digest` |
| Tool request/result | `commandReceipts`, `agent_turns.tool_request_ids` | receipt com `bodyDigest` e resultado para replay idempotente; preview só no contexto do kernel |
| Aprovação | `ai_approvals` | `requestDigest`, `policyRevision`, `expiresAt`, decisão e `decidedBy` |
| Usage/settlement | `AiTurn.usage` + `budgetReservations` | `reservedUnits`, `consumedUnits`, `status` (inclui `RECONCILIATION_REQUIRED`) |
| Checkpoint | `agent_checkpoints` | payload versionado com histórico só de digests; digest próprio verificável |
| Provenance | `ai_turns.provenance`, `agent_turns.provenance` | provider, modelo, engineCommit, profileDigest, policyRevision, correlationId, referencesDigest |
| Auditoria | `auditRecords` | cadeia append-only `previous_hash`/`record_hash` |

Nunca persistem: secrets em claro, credenciais de provider, tokens de sessão e payload clínico que não seja necessário ao rascunho governado.

## 4. Retenção e descarte (PROPOSED)

As políticas de retenção abaixo são **propostas** e dependem de aprovação humana; nenhuma foi validada por autoridade regulatória:

- **Metadados de turno** (`agent_turns`): manter enquanto a sessão for auditável; remoção por expiração de retenção ainda não decidida.
- **Respostas cruas** (`ai_turns.response`): retenção separada dos metadados; descarte não deve quebrar digest/auditoria.
- **Snapshots de contexto**: não existem; somente digest, portanto sem retenção própria.
- **Tool results**: residem no receipt governado; reconciliação de `OUTCOME_UNKNOWN` precede qualquer descarte.
- **Checkpoints**: candidatos a TTL curto após `complete`; a decisão legal/regulatória permanece `PROPOSED` (ADR 038, item 8).

Até a aprovação, o comportamento é conservador: nada é apagado automaticamente e nenhuma política é declarada como cumprida.
