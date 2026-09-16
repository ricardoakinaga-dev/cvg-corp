# Matriz de rastreabilidade de segurança — Agent Runtime

**Subject SHA:** `f53f9eb3e5a44240823f29cbf7307a52f6b5a139`
**Data:** 2026-09-16
**Status:** controles implementados e verificados por gates locais; evidência externa permanece indisponível.
**Estado declarado:** `engineeringState = LOCAL_STATE_OF_THE_ART_CANDIDATE` · `aaaState = AAA_NOT_PROVEN` · `productionState = NOT_PROVEN`.

Legenda de evidência: **LOCAL_REAL** = código real executado nesta máquina (scripts + node:test); **SYNTHETIC** = provider mock determinístico, sem rede. Nenhuma linha abaixo tem evidência de ambiente externo: `npm run verify:state-of-art-external` reporta `BLOCKED_EXTERNAL` sem credenciais autorizadas (ver `artifacts/operational-proof/state-of-art-external.json`).

---

## Requisito → controle → implementação → teste → evidência

| # | Requisito | Controle | Implementação (arquivo) | Teste | Evidência / gate |
| --- | --- | --- | --- | --- | --- |
| 1 | IA não pode contornar o PDP | Toda entrada de IA revalida policy na rota e no serviço; decisão `DENY`/`APPROVAL_REQUIRED` é fail-closed | `apps/api/src/application/agent-service.ts:23`; `packages/agent-policy/src/index.ts:104` | `tests/unit/embedded-runtime.test.ts` — "embedded runtime denies a tool outside the agent profile"; `tests/unit/agent-security.test.ts` — "an AI turn cannot produce a side effect without the tool gateway and PDP" | `npm run verify:agent-security`; `npm run verify:pdp-universal` |
| 2 | IA não pode contornar o Tool Gateway | Kernel só emite `KernelToolPort.request`; o gateway é o único ponto de execução e valida o descritor contra a policy canônica | `packages/agent-kernel/src/index.ts:182`; `packages/agent-tools/src/index.ts:154`; `packages/harness/src/index.ts:99` | `tests/unit/embedded-runtime.test.ts` — "embedded runtime executes a read-only tool through the governed gateway"; eval `hospitalization-handoff` | `npm run verify:agent-runtime`; `npm run verify:agent-evals` |
| 3 | IA não acessa o banco diretamente | Kernel sem imports de domínio/persistência/`pg`/`node:fs`/`node:net`; I/O só por portas injetadas; store de sessão usa seam `SqlExecutor` | `packages/agent-kernel/src/index.ts:1`; `packages/agent-session/src/index.ts:288`; `scripts/verify-agent-runtime.ts` (bloqueio de imports) | Verificação estática de imports no gate do kernel e de fronteiras no gate de arquitetura | `npm run verify:agent-runtime`; `npm run verify:architecture` |
| 4 | IA não pode ler segredos | Permissões de plugin nunca incluem `secrets`; credencial de provider resolvida por callback no adapter, nunca no agente/contexto; firewall de contexto marca `SECRET_MATERIAL` | `packages/agent-plugins/src/index.ts:13`; `packages/model-adapters/src/index.ts:109`; `packages/agent-context/src/index.ts:139` | `tests/unit/agent-security.test.ts` — "secret-like material in untrusted context is quarantined"; `tests/unit/model-adapters.test.ts` — "deepseek provider fails closed without a credential before any network call" | `npm run verify:plugins`; `npm run verify:embedded-harness` |
| 5 | IA não pode se autoaprovar | Aprovação one-shot vinculada a `requestDigest`+`policyRevision`+expiração; alto impacto exige aprovador independente | `packages/embedded-agent-runtime/src/index.ts:391` e `:917`; `packages/agent-policy/src/index.ts:89` | `tests/unit/agent-security.test.ts` — "approval cannot be forged, reused, expired or self-approved for high impact"; `tests/unit/embedded-runtime.test.ts` — "embedded runtime pauses for approval, resumes via checkpoint and consumes the approval once" | `npm run verify:agent-security`; `npm run verify:agent-runtime-smoke` |
| 6 | IA não pode criar verdade de domínio | Saída clínica é rascunho derivado (`AiDraft`); promoção exige papel `veterinario` e cria documento via store de domínio; IA nunca assina | `packages/embedded-agent-runtime/src/index.ts:396`; `packages/harness/src/index.ts` (drafts) | eval `clinical-draft-review` (rascunho permanece `DRAFT`); rota `ai.draft.promote` com policy `["veterinario"]` | `npm run verify:agent-evals`; `npm run verify:pdp-universal` |
| 7 | IA não pode contornar idempotência | Chave durável na aplicação + ledger de tool com `claim`/`complete`/`markOutcomeUnknown`; repetição com argumentos diferentes é conflito | `apps/api/src/application/agent-service.ts:24`; `packages/agent-tools/src/index.ts:215`; `packages/harness/src/index.ts:44` (ledger de receipt) | `tests/unit/embedded-runtime.test.ts` — "embedded runtime is idempotent for the same key"; `tests/unit/agent-session.test.ts` — "turn ledger is append-only and fenced" | `npm run verify:agent-runtime`; `npm run verify:agent-evals` |
| 8 | IA não pode contornar auditoria | Rotas de IA gravam `audit()` com resultado e receipt; cadeia de auditoria é append-only | `apps/api/src/app.ts:2039`; `packages/persistence` (cadeia `previous_hash`/`record_hash`) | Verificação da cadeia + testes de persistência | `npm run verify:audit-chain` |
| 9 | IA não pode cruzar tenant | PDP compara `organizationId`/unidade/workspace; sessão e turno são escopados; RLS com `FORCE ROW LEVEL SECURITY` nas quatro tabelas | `packages/agent-policy/src/index.ts:132`; `db/migrations/038_agent_runtime_session_state.sql:99` | `tests/unit/agent-security.test.ts` — "cross-tenant replay and cross-organization resource access are denied"; `tests/unit/agent-session.test.ts` — "session store creates, loads and completes a scoped session" | `npm run verify:agent-security`; `npm run verify:embedded-harness` |
| 10 | Nenhum efeito externo duplicado | `OUTCOME_UNKNOWN` nunca vira retry cego; receipt/ledger bloqueia reexecução; reconciliação é explícita | `packages/agent-tools/src/index.ts:106`; `packages/agent-kernel/src/index.ts:431` | `tests/unit/agent-kernel.test.ts` — "kernel reports OUTCOME_UNKNOWN instead of retrying a tool with unknown outcome"; eval `tool-outcome-unknown` | `npm run verify:agent-evals`; `npm run verify:worker-runtime` |
| 11 | Nenhum commit com fence obsoleto | Lease monotônica; escrita com fence antigo falha com `DENIED_STALE_FENCE` | `packages/agent-session/src/index.ts:82` e `:271`; `packages/embedded-agent-runtime/src/index.ts:979` | `tests/unit/agent-session.test.ts` — "leases fence concurrent owners and reject stale writers"; "postgres session store issues fenced SQL and rejects stale completion"; `tests/unit/agent-security.test.ts` — "stale fencing prevents an old writer from committing" | `npm run verify:agent-runtime`; `npm run verify:agent-security` |
| 12 | Durabilidade de sessão | Checkpoint versionado e verificável, turn ledger append-only, tabelas com RLS no PostgreSQL | `packages/agent-session/src/index.ts:296`; `db/migrations/038_agent_runtime_session_state.sql` | `tests/unit/agent-session.test.ts` — "checkpoint is append-only, versioned and tamper-evident"; smoke de checkpoint/resume | `npm run verify:agent-runtime-smoke`; `npm run verify:embedded-harness` |
| 13 | Substituibilidade de provider | `ModelProvider` tipado com `capabilities`/`dataPolicy`; router por capability e classe de dados; adapters Mock/DeepSeek/Local | `packages/model-runtime/src/index.ts:108`; `packages/model-adapters/src/index.ts` | `tests/unit/model-runtime.test.ts` — "model router rejects providers without the required capability"; "model router never routes a data class the provider is not authorized for"; `tests/unit/model-adapters.test.ts` — "local provider declares on-prem data policy and works without credentials" | `npm run verify:architecture`; `npm run verify:embedded-harness` |
| 14 | Substituibilidade de harness | Porta `AgentRuntime` única; comparação diferencial embarcado vs. mock harness | `packages/agent-runtime/src/index.ts:55`; `packages/harness-adapters/src/index.ts:20`; `scripts/agent-evals.ts:205` | eval `reception-appointment-confirmation` com `PARITY` estrutural | `npm run verify:agent-evals`; `npm run verify:architecture` |
| 15 | Continuidade com IA desabilitada | `DisabledAgentRuntime` fail-closed; readiness geral não depende de IA; `/api/v1/ai/ready` reporta `DISABLED` | `packages/agent-runtime/src/disabled.ts`; `apps/api/src/routes/health.ts:96` | Verificação de prontidão e autenticação com `agentRuntimeMode: "disabled"` | `npm run verify:ai-disabled` |

## Controles complementares citados pelo prompt

| Tema | Controle | Implementação | Evidência / gate |
| --- | --- | --- | --- |
| Injeção de prompt | Quarentena antes do modelo + firewall estrutural de contexto | `packages/embedded-agent-runtime/src/index.ts:1232`; `packages/agent-context/src/index.ts:147` | `tests/unit/agent-security.test.ts` — "direct and indirect injection never reach the model or the tool gateway"; eval `prompt-injection-quarantine` |
| Plugin hostil | Allowlist + digest + permissões mínimas + lifecycle fail-closed | `packages/agent-plugins/src/index.ts:132` | `tests/unit/agent-security.test.ts` — "malicious plugin cannot escalate privileges or reach ambient authority"; `npm run verify:plugins` |
| Skill hostil | Skill é dado de baixo privilégio; nunca habilita tool | `packages/agent-skills/src/index.ts:121` | `tests/unit/agent-security.test.ts` — "malicious skill remains low-privilege data and cannot grant tools"; `npm run verify:skills` |
| Safe mode | Apenas tools `READ_ONLY` são despachadas | `packages/embedded-agent-runtime/src/index.ts:839` | eval `safe-mode-read-only`; `npm run verify:agent-evals` |
| Kill switches | `aiEnabled`, `disabledProviders`, `disabledTools`, safe mode | `packages/embedded-agent-runtime/src/index.ts:294`; `packages/config/src/index.ts:77` | `tests/unit/embedded-runtime.test.ts` — "embedded runtime respects tool kill switch and safe mode" |
| Concorrência de sessão | Uma instância por sessão via lease; segunda instância recebe conflito | `packages/embedded-agent-runtime/src/index.ts:975` | `tests/unit/embedded-runtime.test.ts` — "embedded runtime denies concurrent execution of the same session across instances" |

## Códigos de falha que materializam os controles

Cada negação abaixo é um caminho de código real; a existência do código é verificada por teste ou gate, e nenhum deles é convertido em sucesso silencioso.

| Código | Origem | Significado de segurança |
| --- | --- | --- |
| `POLICY_DENIED` | `packages/agent-policy/src/index.ts` | Operação sem policy registrada, fora de escopo, com role/classe inválida ou aprovação inválida |
| `APPROVAL_REQUIRED` | `packages/agent-policy/src/index.ts` | Ação exige aprovação humana vinculada a argumentos e policy |
| `CAPABILITY_DISABLED` | `packages/agent-tools/src/index.ts` | Tool não registrada ou descritor divergente da policy canônica |
| `IDEMPOTENCY_CONFLICT` | `packages/agent-tools/src/index.ts` | Mesma chave reutilizada com argumentos diferentes |
| `OUTCOME_UNKNOWN` | `packages/agent-tools/src/index.ts` | Resultado externo incerto; nunca vira retry cego |
| `DENIED_STALE_FENCE` | `packages/agent-session/src/index.ts` | Escrita com fence obsoleto; instância antiga perde autoridade de escrita |
| `CHECKPOINT_TAMPERED` | `packages/agent-session/src/index.ts` | Digest do checkpoint não confere com o payload |
| `AI_DISABLED` / `AI_DEGRADED` | `packages/embedded-agent-runtime/src/index.ts` | Kill switch e indisponibilidade explícitos, sem tocar no domínio |
| `TOOL_NOT_DECLARED` / `PROFILE_TOOL_NOT_ALLOWED` | `packages/agent-kernel/src/index.ts`; `packages/embedded-agent-runtime/src/index.ts` | Tool fora do contrato do turno ou do profile do agente |
| `TOOL_KILL_SWITCH` / `SAFE_MODE_READ_ONLY` / `PROFILE_RISK_LIMIT` | `packages/embedded-agent-runtime/src/index.ts` | Kill switches e limites de risco por profile |
| `BUDGET_EXCEEDED` / `LOOP_DETECTED` / `MAX_FAILURES` | `packages/agent-kernel/src/index.ts` | Paradas duras do loop por orçamento, repetição sem progresso ou falhas |

## Como as evidências foram produzidas (2026-09-16)

- **Testes focados:** `scripts/lib/node-tests.ts` executa `node --import tsx --test` sobre arquivos de `tests/unit` e conta os testes aprovados; qualquer falha reprova o gate.
- **Verificação estática de fronteira:** `scripts/verify-architecture.ts` percorre `packages/domain/src`, `packages/agent-kernel/src` e `apps/api/src/application` por AST textual de imports; `scripts/verify-agent-runtime.ts` bloqueia imports proibidos no kernel.
- **Análise do migration:** `scripts/verify-embedded-harness.ts` exige as quatro tabelas e `FORCE ROW LEVEL SECURITY` no texto de `db/migrations/038_agent_runtime_session_state.sql`.
- **Evals comportamentais:** `scripts/agent-evals.ts` executa cenários determinísticos e compara o runtime embarcado com o harness mock; evidência `SYNTHETIC` (provider `mock-model`).
- **Artefatos gerados:** `artifacts/evals/agent-evals-*.json` (evals) e `artifacts/operational-proof/state-of-art-external.json` (`BLOCKED_EXTERNAL`, sem execução externa).

## Limitações desta matriz

- Evidência é local e sintética; não há prova de staging, provider real, carga externa ou isolamento de processo (bloqueios registrados em `docs/embedded-runtime-rollout.md`).
- O gate `verify:pdp-universal` cobre rotas e workers, não cada condição interna do kernel; as condições internas são cobertas pelos testes de unidade citados.
- A conexão do app ao `PostgresAgentSessionStore` ainda não está ligada no wiring da API; o RLS é verificado por análise do migration e por testes de shape SQL, não por um PostgreSQL real neste gate.
- Nenhuma linha deve ser lida como certificação externa; `npm run verify:state-of-art-external` permanece `BLOCKED_EXTERNAL`.
