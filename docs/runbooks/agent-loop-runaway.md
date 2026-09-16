# Runbook — loop de agente descontrolado

**Estado:** limites, stop conditions e loop detection implementados e exercitados localmente (`tests/unit/agent-kernel.test.ts`, `tests/unit/embedded-runtime.test.ts`); contenção em produção `NOT_RUN`.
**Owner:** AI runtime. **Abortar se:** não houver budget/limite auditável, ou se a contenção proposta exigir aumentar limite.

Objetivo: interromper um turno que consome budget ou repete ações sem progresso, sem apagar evidência e sem elevar limites para "passar".

## 1. Conhecer os limites

`KernelLoopLimits` (`packages/agent-kernel/src/index.ts:40`): `maxTurns`, `maxToolCalls`, `maxTokens`, `maxWallTimeMs`, `maxCostMicros`, `maxFailures` e `maxRepeatedToolCalls` (default `DEFAULT_KERNEL_LIMITS`, linha 51: 6 turnos, 4 tool calls, 32k tokens, 60s, custo `null`, 2 falhas, 2 repetições).

O runtime embarcado sobrescreve com os budgets do profile e fixa `maxRepeatedToolCalls: 2` (`packages/embedded-agent-runtime/src/index.ts:507-515`). Budgets por profile (`packages/embedded-agent-runtime/src/profiles.ts`): Reception 4 turnos/3 tools/16k/45s; Clinical 5/4/24k/60s; Hospitalization 5/4/24k/60s; Administrative 4/3/16k/45s; `maxCostMicros: null` em todos.

Stop conditions (`KernelStopCondition`, `packages/agent-kernel/src/index.ts:27`) e `reason` correspondente:

| Causa | `reason` | Ponto |
| --- | --- | --- |
| turnos | `MAX_TURNS` | linha 451 |
| tool calls | `MAX_TOOL_CALLS` | linhas 478, 663 |
| tokens | `MAX_TOKENS` | linha 626 |
| custo | `MAX_COST` | linha 626 |
| wall time | `MAX_WALL_TIME` | linha 460 |
| falhas | `MAX_FAILURES` | linhas 517, 710 |
| repetição idêntica | `LOOP_DETECTED` | linha 674 |
| contexto grande demais | `CONTEXT_TOO_LARGE` | linha 583 |
| budget indisponível | `BUDGET_EXCEEDED`/`BUDGET_PORT_FAILURE` | linhas 547-552 |

## 2. Reconhecer `LOOP_DETECTED`

`loopDetected()` compara as últimas `maxRepeatedToolCalls + 1` assinaturas de tool (`tool:digest(input)`) e considera loop quando todas são iguais (`packages/agent-kernel/src/index.ts:801-807`). O kernel:
- para com `state: FAILED`, `stopCondition: NO_PROGRESS`, `reason: LOOP_DETECTED`;
- emite `agent.loop.detected/v1` com `{ tool, repetitions }` (linha 678).

Progresso **nunca** é inferido do texto do modelo: só do sinal explícito `progress` da porta de tools (`packages/agent-kernel/src/index.ts:177-179,681`).

## 3. Contenção imediata (ordem recomendada)

1. **Desabilitar a tool específica**: `CVG_AI_DISABLED_TOOLS` (`packages/config/src/index.ts:79`) → `controls().disabledTools` (`apps/api/src/app.ts:142`). No runtime, a tool é negada com `TOOL_KILL_SWITCH` antes de qualquer dispatch (`packages/embedded-agent-runtime/src/index.ts:838`) e sai também do contexto de tools (`packages/embedded-agent-runtime/src/index.ts:772`).
2. **AI_SAFE_MODE**: `CVG_AI_SAFE_MODE=true` (`packages/config/src/index.ts:77`) nega toda tool que não seja `READ_ONLY` com `SAFE_MODE_READ_ONLY` (`packages/embedded-agent-runtime/src/index.ts:839`); com tools requeridas, o runtime exige provider com `toolCalling` (`packages/embedded-agent-runtime/src/index.ts:666`).
3. **Desabilitar providers** se o problema for o provider, não a tool: `CVG_AI_DISABLED_PROVIDERS`.
4. **Desligar IA**: `CVG_AGENT_RUNTIME=disabled` (`apps/api/src/app.ts:587`) — medida mais ampla, exige reinício.
5. **Cancelar turno em processo**: `EmbeddedAgentRuntime.cancel(sessionId)` aborta o `AbortController` do turno em andamento e retorna `true` se havia sinal (`packages/embedded-agent-runtime/src/index.ts:418-427`). O kernel registra `CANCELLED_BEFORE_TURN` ou `CANCELLED_DURING_MODEL` (`packages/agent-kernel/src/index.ts:448,576`). **Não existe rota HTTP de cancelamento** hoje: fora do processo, a contenção é configuração/restart.
6. **Drain**: `shutdown()` chama `supervisor.drain()` — `DRAINING` até os turnos ativos terminarem ou `drainDeadlineMs` (default 10_000 ms) expirar (`packages/embedded-agent-runtime/src/index.ts:109-124,431`).
7. **Saturação**: `CVG_AI_MAX_CONCURRENT_TURNS` (default 8, `packages/config/src/index.ts:80`) limita turnos simultâneos; acima disso o runtime responde `DEPENDENCY_UNAVAILABLE` "runtime saturado" (`packages/embedded-agent-runtime/src/index.ts:436`).

## 4. Verificar budget e settlement

- Antes de cada chamada de modelo o kernel reserva `estimatedTokens + min(maxOutput, 1024)` (`packages/agent-kernel/src/index.ts:547`); a reserva usa `reserveBudget` no store (`packages/embedded-agent-runtime/src/index.ts:521-530`).
- Falha de settle vira `RECONCILIATION_REQUIRED` (`packages/embedded-agent-runtime/src/index.ts:539`); nunca inventar consumo zero.
- `costMicros === null` mantém `costKnown = false` e o teto de custo não dispara (`packages/agent-kernel/src/index.ts:605,833`).

## Evidência

- evento `agent.loop.detected/v1` e `agent.budget.exceeded/v1` com `reason`;
- `KernelRunResult.loop` (`turnsUsed`, `toolCallsUsed`, `tokensUsed`, `costKnown`, `failures`);
- `ai_turns` com status final e `usage.status`/`settlement`;
- `agent_turns` (ledger) com `sequence`, `status` e digests;
- captura do `reason` exato (`MAX_TURNS`, `MAX_TOOL_CALLS`, `MAX_TOKENS`, `MAX_COST`, `MAX_WALL_TIME`, `MAX_FAILURES`, `LOOP_DETECTED`).

## O que NÃO fazer

- Nunca aumentar budgets/limites para "destravar" um loop: trate a causa e registre a exceção.
- Nunca repetir a mesma tool com a mesma entrada esperando resultado diferente; o kernel já parou por desenho.
- Nunca apagar turnos/audit para reduzir ruído.
- Nunca reenviar `OUTCOME_UNKNOWN` (efeito pode ter ocorrido; ver `docs/runbooks/session-stuck.md`).
- Nunca rodar duas instâncias sobre a mesma sessão: uma será rejeitada por `ADMISSION_IN_PROGRESS`.
