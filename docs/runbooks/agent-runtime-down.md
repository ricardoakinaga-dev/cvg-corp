# Runbook — Agent Runtime indisponível

**Estado:** runtime embarcado implementado e exercitado apenas localmente (`npm run verify:ai-disabled` PASS); operação em staging/produção `NOT_RUN`.
**Owner:** AI runtime. **Abortar se:** a causa não estiver classificada como DISABLED, DEGRADED ou UNAVAILABLE, ou se a evidência de auditoria não estiver preservada.

Objetivo: classificar a indisponibilidade do runtime de IA, manter o hospital operando sem IA e registrar evidência. A indisponibilidade de IA **nunca bloqueia** o núcleo: agenda, prontuário, internação, estoque e financeiro continuam atendidos pelas rotas de domínio.

## 1. Classificar o estado

O contrato (`AgentRuntimeStatus`, `packages/agent-runtime/src/index.ts:17`) e o runtime embarcado (`health()`, `packages/embedded-agent-runtime/src/index.ts:299`) produzem um dos quatro estados:

| Estado | Como aparece | Causa típica |
| --- | --- | --- |
| `DISABLED` | `reason: "AI_DISABLED"` (controls) ou `reason: "CVG_AGENT_RUNTIME=disabled"` (`packages/agent-runtime/src/disabled.ts:23`) | runtime desligado por configuração |
| `DEGRADED` | `reason` do provider, com `PROVIDER_DEGRADED` como fallback | provider de modelo em `DEGRADED` |
| `UNAVAILABLE` | `RUNTIME_STOPPED`, `RUNTIME_DRAINING`, `MODEL_UNAVAILABLE` ou `MODEL_HEALTH_FAILED` | supervisor parado/drenando, provider indisponível ou health lançando exceção (`packages/embedded-agent-runtime/src/index.ts:305-316`) |
| `READY` | `reason: null` | runtime e provider saudáveis |

`DISABLED` não é `UNAVAILABLE`: `DISABLED` é decisão explícita de configuração; `UNAVAILABLE` é falha de dependência. `DEGRADED` ainda admite turnos — `tryBeginTurn` aceita `READY` e `DEGRADED` (`packages/embedded-agent-runtime/src/index.ts:95`).

O supervisor tem ainda os estados internos `STARTING`, `READY`, `DRAINING`, `UNAVAILABLE`, `STOPPED` (`SupervisorState`, `packages/embedded-agent-runtime/src/index.ts:51`); `markUnavailable(reason)` grava o motivo e `drain()` leva a `STOPPED`.

## 2. Verificar readiness

1. `GET /api/v1/ai/ready` (`apps/api/src/routes/health.ts:103`): `ready = status === "READY"`; `aiState` é `READY`, `DISABLED` ou `AI_DEGRADED`; HTTP 503 quando não está `READY`.
2. `GET /api/v1/ready` (`apps/api/src/routes/health.ts:50`): reporta `checks.agentRuntime`, `ai.status` e `ai.degraded`, mas **a IA nunca gateia** o readiness geral (`apps/api/src/routes/health.ts:96`). Só trate como indisponibilidade de banco se `database`, `outbox` ou `auditLedger` estiverem `UNAVAILABLE`.
3. `GET /api/v1/ai/health` (`apps/api/src/app.ts:2020`): exige role admin/veterinário/recepção e devolve o health completo com capabilities.
4. Observar telemetria de kernel: `agent.session.created/v1`, `agent.model.requested/v1`, `agent.model.responded/v1`, `agent.budget.exceeded/v1`, `agent.loop.detected/v1`, `agent.session.completed/v1` (`packages/agent-kernel/src/index.ts:209`), além de `agent_kernel_turn_ledger_append_failed`.

Checklist:
- [ ] estado classificado (DISABLED / DEGRADED / UNAVAILABLE)
- [ ] `/api/v1/ready` verde para o núcleo
- [ ] `/api/v1/ai/ready` com `reason` e `checkedAt` preservados no ticket
- [ ] provider, `engineCommit` e `manifestVersion` anotados (`health().capabilities`)
- [ ] nenhum turno `OUTCOME_UNKNOWN` órfão

## 3. O que continua funcionando

Toda a operação não-IA permanece disponível pelas rotas de domínio (`apps/api/src/app.ts`): `/api/v1/appointments`, `/api/v1/clinical/documents` (prontuário), `/api/v1/hospitalization/episodes`, `/api/v1/stock/*`, `/api/v1/finance/*`, `/api/v1/patients`, `/api/v1/diagnostics/*`, `/api/v1/medications/*`.

O script `scripts/verify-ai-disabled.ts` exercita exatamente esse cenário: com `agentRuntimeMode: "disabled"`, `/api/v1/health` e `/api/v1/ready` permanecem 200, `/api/v1/ai/ready` retorna 503/DISABLED e as rotas de negócio continuam exigindo autenticação (401 sem sessão). Isso é evidência local, não produção.

## 4. Desabilitar o runtime por configuração

`CVG_AGENT_RUNTIME=disabled` (`packages/config/src/index.ts:76`) seleciona `DisabledAgentRuntime` (`apps/api/src/app.ts:587`), que falha fechado com `AgentRuntimeUnavailableError` em toda operação de IA e reporta `DISABLED`.

- A variável é lida no boot: exige reinício controlado da API.
- `CVG_AI_SAFE_MODE`, `CVG_AI_DISABLED_PROVIDERS` e `CVG_AI_DISABLED_TOOLS` são controles independentes do runtime embarcado (`apps/api/src/app.ts:142`) e não substituem `disabled`.
- Registrar a mudança como decisão operacional com correlation ID, horário e responsável.

## Evidência

- resposta de `/api/v1/ready` e `/api/v1/ai/ready` antes/depois;
- `status`, `reason`, `checkedAt` e `capabilities` de `health()` (`AgentRuntimeHealth`, `packages/agent-runtime/src/index.ts:28`);
- turnos afetados em `ai_turns` com `status` (`DENIED`, `OUTCOME_UNKNOWN`) e `usage.status` (`RECONCILIATION_REQUIRED` quando aplicável, `packages/embedded-agent-runtime/src/index.ts:1151`);
- registro de auditoria `ai.turn` (`apps/api/src/app.ts:2039`) e eventos do kernel;
- para turnos `OUTCOME_UNKNOWN`: `reconciliationRequired` no `KernelTurnRecord` (`packages/agent-kernel/src/index.ts:251`).

## O que NÃO fazer

- Nunca simular resposta de IA, preencher `response` manualmente nem criar `ai_turns`/`ai_drafts` fora do runtime.
- Nunca afirmar capacidade disponível quando `/api/v1/ai/ready` não está `READY`.
- Nunca tratar `DEGRADED` ou `AI_DEGRADED` como indisponibilidade do núcleo: não escalar incidente de banco por causa de IA.
- Nunca reenviar turno `OUTCOME_UNKNOWN` sem reconciliação — o Tool Gateway bloqueia retry cego (`packages/agent-tools/src/index.ts:217`).
- Nunca editar/apagar linhas de `ai_turns`, do audit ledger ou das tabelas `agent_*` para "limpar" o estado.
- Nunca habilitar provider não aprovado para contornar health; o roteamento é fail-closed (`FALLBACK_NOT_ALLOWED`, `packages/model-runtime/src/index.ts:337`).
