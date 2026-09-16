# Arquitetura final — plano de negócio e plano de controle de IA

**Subject SHA:** `f53f9eb3e5a44240823f29cbf7307a52f6b5a139`
**Data:** 2026-09-16
**Status:** arquitetura vigente no worktree; runtime embarcado em fase LAB (`docs/embedded-runtime-rollout.md`).
**Estado declarado:** `engineeringState = LOCAL_STATE_OF_THE_ART_CANDIDATE` (gates locais `verify:embedded-harness` e `verify:agent-runtime` aprovados em 2026-09-16) · `aaaState = AAA_NOT_PROVEN` · `productionState = NOT_PROVEN`.

---

## 1. Dois planos, uma autoridade

O CVG-Corp separa dois planos que compartilham o mesmo processo e o mesmo PostgreSQL, mas nunca a mesma autoridade:

- **Plano de negócio:** pacientes, tutores, agenda, clínico, diagnósticos, internação, estoque, financeiro. Autoridade: camadas Application → Domain → Persistence do CVG.
- **Plano de controle de IA:** loop cognitivo, contexto, sessão, plugins, skills, providers e tools. Autoridade: nenhuma própria — o plano de IA só age atravessando PDP e Tool Gateway.

O domínio (`packages/domain`) não conhece runtime, provider ou harness; o runtime embarcado não conhece entidades de domínio. Essa separação é verificada estaticamente por `scripts/verify-architecture.ts` (`domainImports=0`, `applicationProviderImports=0`).

## 2. Wiring real

```
 usuário autenticado
        │  POST /api/v1/ai/turns (cookie de sessão + CSRF)
        ▼
 apps/api/src/app.ts ─ requireSession ─▶ requestContext ─▶ enforceApplicationPolicy (PDP)
        │                                                   packages/agent-policy
        ▼
 AgentApplicationService (idempotência durável, vínculo de escopo)
 apps/api/src/application/agent-service.ts
        │
        ▼  seleção por CVG_AGENT_RUNTIME (packages/config/src/index.ts:76)
        ├─ disabled ─▶ DisabledAgentRuntime ....... fail-closed, readiness DISABLED
        ├─ external ─▶ DeepSeekHarnessAdapter ..... processo externo via apps/deepseek-bridge
        ├─ auto ─────▶ MockHarnessAdapter + GovernedHarness (legado local)
        └─ embedded ─▶ EmbeddedAgentRuntime (packages/embedded-agent-runtime)
                              │
                              ├─ AgentKernel .................. packages/agent-kernel
                              │     loop: OBSERVING → CONTEXT_BUILDING → MODEL_PENDING
                              │           → TOOL_PENDING/TOOL_COMPLETED → VERIFYING
                              │
                              ├─ ContextBuilder .............. packages/agent-context
                              │     trust levels · prioridade · firewall · projeção mínima
                              │     KnowledgeGovernor (approve/quarantine)
                              │
                              ├─ ModelRouter + ModelProvider .. packages/model-runtime
                              │     Mock / DeepSeek / Local .. packages/model-adapters
                              │
                              ├─ ToolGateway ─▶ PDP ─▶ executor packages/agent-tools
                              │                                   packages/agent-policy
                              │
                              └─ AgentSessionStore ........... packages/agent-session
                                    agent_sessions · agent_turns · agent_checkpoints · agent_leases
                                    PostgreSQL + RLS (db/migrations/038_agent_runtime_session_state.sql)

 Plano de negócio (não conhece o runtime):
   apps/api/src/application/* ─▶ packages/domain ─▶ packages/persistence (PostgreSQL)
```

O gateway usado por todos os runtimes é único: `createGovernedToolGateway` (`packages/harness/src/index.ts:99`). Nenhum runtime registra tools próprias — um fork tornaria a divergência de PDP/capability indetectável.

## 3. Application → Domain → Persistence

- **Application:** `apps/api/src/application/*.ts` (ex.: `agent-service.ts`, `appointment-service.ts`) valida contexto, aplica policy e coordena idempotência. Serviços de aplicação dependem da porta `AgentRuntime`, nunca de adapters de provider (verificado por `scripts/verify-architecture.ts`).
- **Domain:** `packages/domain` mantém as entidades e invariantes; `CvgStore` é a fachada de estado/consulta.
- **Persistence:** `packages/persistence` grava snapshots/ledgers no PostgreSQL; a rota `apps/api/src/app.ts` usa uma seção curta de commit após chamadas externas, sem segurar lock durante a chamada de IA.
- **Workers:** `apps/worker` executa outbox, jobs, schedule, reconciliação e notificações com policy de worker (`WORKER_POLICY_REGISTRY`, `packages/agent-policy/src/index.ts:235`).
- **Integrações:** `packages/integrations` governa callbacks assinados (`assertIntegrationCallbackAllowed`, `packages/agent-policy/src/index.ts:209`) e efeitos externos.

## 4. Porta AgentRuntime

`AgentRuntime` (`packages/agent-runtime/src/index.ts:55`) expõe `health`, `createSession`, `executeTurn`, `approve`, `promoteDraft`, `replay` e `shutdown`; o contrato é versionado em `AgentRuntimeContract/v1` (`packages/agent-runtime/src/runtime-manifest.ts:9`). Quatro implementações o satisfazem: embarcada, mock harness, DeepSeek externo e desabilitada. `DisabledAgentRuntime` (`packages/agent-runtime/src/disabled.ts`) mantém o hospital operacional quando a IA é desligada.

## 5. Kernel embarcado

`packages/agent-kernel/src/index.ts` define:

- **Estados:** `CREATED`, `OBSERVING`, `CONTEXT_BUILDING`, `MODEL_PENDING`, `MODEL_COMPLETED`, `TOOL_PENDING`, `TOOL_COMPLETED`, `VERIFYING`, `WAITING_APPROVAL`, `COMPLETED`, `FAILED`, `QUARANTINED`, `CANCELLED`.
- **Stop conditions:** `TASK_COMPLETED`, `WAITING_HUMAN`, `BUDGET_EXCEEDED`, `POLICY_DENIED`, `CANCELLED`, `TIMEOUT`, `NO_PROGRESS`, `DEPENDENCY_UNAVAILABLE`, `ERROR`.
- **Limites:** `maxTurns`, `maxToolCalls`, `maxTokens`, `maxWallTimeMs`, `maxCostMicros`, `maxFailures` e detecção de loop por assinatura de tool repetida.
- **Portas injetadas:** `clock`, `model`, `context`, `tools`, `budget`, `events`, `verification` — todas abstratas. O kernel não importa `@cvg/domain`, `@cvg/persistence`, `@cvg/agent-tools`, `@cvg/harness`, `pg`, `node:fs` nem `node:net` (`scripts/verify-agent-runtime.ts`).
- **Checkpoint:** guarda digests e objetivos, nunca conteúdo bruto; o histórico é reduzido a `role` + `digest` (`packages/agent-kernel/src/index.ts:883`).

## 6. Context Builder

`packages/agent-context/src/index.ts` decide o que chega ao modelo:

- **Trust levels:** `SYSTEM_TRUSTED`, `CVG_TRUSTED`, `USER_SUPPLIED`, `RETRIEVED_UNTRUSTED`, `EXTERNAL_UNTRUSTED`, `TOOL_RESULT`.
- **Prioridade e orçamento:** `CONTEXT_PRIORITY` (system 1000 → retrieval 500 → histórico 400) e corte por orçamento de tokens, sem truncar a partir do início.
- **Prompt firewall:** `inspectUntrustedContent` sinaliza `INSTRUCTION_OVERRIDE`, `APPROVAL_SYNTHESIS_ATTEMPT`, `PERMISSION_ESCALATION`, `SECRET_MATERIAL`, `CROSS_TENANT_REFERENCE` etc.; a garantia estrutural é `renderUntrusted`, que emite conteúdo não confiável como dado delimitado que não pode virar policy, habilitar tool ou aprovar ação.
- **Minimização/projeção:** `projectMinimalFields`, `DEFAULT_DATA_PROJECTIONS` e `projectionFor` reduzem objetos ao mínimo por finalidade; campo desconhecido é descartado.
- **Compaction determinística:** `compactConversation` nunca inventa conteúdo clínico nem substitui registros governados.

## 7. Governança de retrieval

`KnowledgeGovernor` (mesmo pacote) registra documento com digest sha-256, escopo (organização/unidade/workspace), classificação e ciclo `DRAFT → APPROVED → QUARANTINED`; `select` só devolve `APPROVED` dentro do escopo e das classes permitidas. No runtime embarcado, a seleção adicionalmente exige `status === "APPROVED"`, `isInContext`, classe permitida pelo profile e passa por verificação de injeção (`packages/embedded-agent-runtime/src/index.ts:755`). Retrieval contribui contexto; não concede autoridade.

## 8. Sessão durável (lease/fence/checkpoint/turn ledger)

`AgentSessionStore` (`packages/agent-session/src/index.ts:116`) define `create`, `load`, `checkpoint`, `latestCheckpoint`, `acquireLease`, `renewLease`, `releaseLease`, `appendTurn`, `listTurns` e `complete`. Implementações: `PostgresAgentSessionStore` (produção) e `MemoryAgentSessionStore` (desenvolvimento/testes). Regras:

- lease com `fence` monotônico; escrita com fence obsoleto falha com `DENIED_STALE_FENCE`;
- checkpoint versionado (`schemaVersion`) e verificável por digest; adulteração gera `CHECKPOINT_TAMPERED`;
- `agent_turns` é append-only (trigger no banco) e guarda digests de input, contexto, request/response de modelo, ids de tool, usage e provenance;
- quatro tabelas com `FORCE ROW LEVEL SECURITY` e policy `cvg_org_isolation` (`db/migrations/038_agent_runtime_session_state.sql`).

**Nota de wiring (limitação honesta):** `createEmbeddedRuntimeAdapter` (`apps/api/src/app.ts:115`) não injeta `sessionStore`; o runtime usa `MemoryAgentSessionStore` por default. O caminho PostgreSQL já existe e é testado no store, mas a conexão do app ao `PostgresAgentSessionStore` permanece item de staging (não provada localmente).

## 9. Plugins — capability, sem autoridade ambiente

`packages/agent-plugins/src/index.ts` exige manifesto (`name`, `version`, `publisher`, `digest`, `permissions[]`, `capabilities[]`, `dependencies[]`, `apiVersion`, `risk`), allowlist por nome+versão+digest, `apiVersion` compatível e resolução de dependências por capability (ciclos/conflitos falham o startup). O contexto de inicialização concede apenas `logger`, `metrics`, `scopedConfig`, `approvedToolClient` (que passa pelo Tool Gateway) e `clock`; nunca `database`, `filesystem`, `secrets` ou `httpClient`. Lifecycle `DISCOVERED → VALIDATED → LOADED → INITIALIZED → READY` com `DEGRADED`, `DISABLED`, `FAILED`; sem hot reload.

## 10. Skills — conhecimento, sem autoridade

`packages/agent-skills/src/index.ts` registra skill com digest sha-256 e schema `cvg-agent-skill/1`; `select` só escolhe skill `APPROVED` cujos `requiredTools`, `requiredCapabilities` e `dataClasses` estejam integralmente satisfeitos. Uma skill nunca habilita tool ou capability que declara (`tests/unit/agent-skills.test.ts`, "a skill cannot grant a tool or capability it declares").

## 11. ModelProvider — infraestrutura substituível

`packages/model-runtime/src/index.ts` define `ModelProvider` (`providerId`, `health`, `capabilities`, `dataPolicy`, `complete`, `stream?`, `cancel`), `classifyModelError`, `withModelRetry`, `CircuitBreaker`, `ModelRouter` e `reconcileUsage`. O router decide por capability obrigatória, classe de dados autorizada pela `dataPolicy` do provider, kill switch por chamada, circuit breaker e fallback somente quando `allowedFallback` é verdadeiro. Adapters em `packages/model-adapters`: `MockModelProvider` (determinístico), `createDeepSeekModelProvider` (chat-completions/SSE; credential resolvida por callback, nunca armazenada) e `createLocalModelProvider` (endpoint OpenAI-compatible on-prem; prova de que o harness não é DeepSeek). Nenhuma regra de negócio nos adapters.

## 12. Tool Gateway + soberania do PDP

`packages/agent-tools/src/index.ts` é o único ponto de execução de tools visíveis ao modelo: valida descritor contra a policy canônica, exige sessão autenticada, aplica PDP (`StaticPolicyDecisionPoint`, `packages/agent-policy/src/index.ts:104`), trava idempotência em ledger (`claim`/`complete`/`markOutcomeUnknown`) e nunca faz egress implícito. `TOOL_REGISTRY` (`packages/harness/src/index.ts:34`) lista as seis tools governadas; `TOOL_POLICY_REGISTRY` (`packages/agent-policy/src/index.ts:418`) é a metadata canônica — declarar um descritor mais permissivo é rejeitado (`CAPABILITY_DISABLED`). O kernel só emite `KernelToolPort.request`; não executa nada.

## 13. Observabilidade

`packages/ops` fornece OTel, métricas Prometheus e redaction. O runtime embarcado expõe `EmbeddedTelemetryPort` (`increment`, `recordKernelEvent`) e emite eventos `agent.*/v1`; readiness de IA é separada da readiness geral (`/api/v1/ai/ready` vs `/api/v1/ready`, `apps/api/src/routes/health.ts:103`). Indisponibilidade de IA aparece como `AI_DEGRADED`, nunca derruba a readiness do hospital (`apps/api/src/routes/health.ts:96`).

## 14. As sete leis arquiteturais (verbetes do prompt, itens 402–408)

> The AI runtime may reason about the CVG domain, but it never becomes the authority of the CVG domain.

> All side effects requested by AI must cross the same governed application boundaries used by non-AI callers.

> Model providers are replaceable infrastructure. They are not the agent architecture.

> Skills provide knowledge and procedure; plugins provide executable capability; tools provide governed domain actions.

> Retrieval contributes context. It does not grant authority.

> Human approval is an external authority and can never be synthesized by the model.

> Failure of AI must degrade AI capabilities, not corrupt or disable the core hospital system.

Fonte: `docs/prompt-embedded-agent-runtime-2026-09-16.md`, itens 402–408. Cada lei tem controle correspondente na matriz `docs/security-traceability-matrix.md`.

## 15. Limitações registradas

- O runtime embarcado não foi promovido a processo standalone (ADR 035, fase 2 deferida).
- STAGING/CANARY/PRODUCTION não foram iniciados: sem staging autorizado, sem DeepSeek real e sem Docker neste ambiente (`docs/embedded-runtime-rollout.md`).
- Evals são sintéticos (provider mock); latência e texto real de provider não foram medidos (`docs/agent-evals.md`).
- A conexão do app ao `PostgresAgentSessionStore` e a retenção de dados de IA permanecem `PROPOSED` (ADR 038).
