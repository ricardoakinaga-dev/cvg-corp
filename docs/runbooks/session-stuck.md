# Runbook — sessão de agente travada

**Estado:** lease/fencing/checkpoint implementados (`MemoryAgentSessionStore` exercitado localmente; `PostgresAgentSessionStore` com SQL fenced); RLS/append-only em PostgreSQL real `NOT_RUN`.
**Owner:** AI runtime. **Abortar se:** houver dúvida sobre quem detém o lease, ou se a única saída proposta for editar/apagar `agent_*`.

Objetivo: destravar uma sessão sem repetir efeito e sem violar fencing. Nenhuma intervenção manual em tabela é caminho suportado.

## 1. Reconhecer os sintomas

| Sintoma | Código | Origem |
| --- | --- | --- |
| Outra instância executa a sessão | `ADMISSION_IN_PROGRESS` | `acquireLease` retorna `null` ou `LEASE_HELD` (`packages/embedded-agent-runtime/src/index.ts:975-980`) |
| Escritor antigo tentou commit | `DENIED_STALE_FENCE` | fence divergente em checkpoint/ledger (`packages/agent-session/src/index.ts:274`) |
| Checkpoint adulterado | `CHECKPOINT_TAMPERED` | digest do payload ≠ digest gravado (`packages/agent-session/src/index.ts:202,341`) |
| Resultado externo desconhecido | `OUTCOME_UNKNOWN` / `reconciliationRequired` | Tool Gateway sem confirmação do efeito (`packages/agent-tools/src/index.ts:217`) |

## 2. Entender lease e fence

- `acquireLease` cria/renova lease com `fence` monotônico; o SQL usa `ON CONFLICT ... fence = agent_leases.fence + 1` e só re-adquire se `expires_at <= now()` ou mesmo owner (`PostgresAgentSessionStore.acquireLease`, `packages/agent-session/src/index.ts:345-364`).
- Toda escrita fenced chama `requireFence`; fence antigo é rejeitado (`DENIED_STALE_FENCE`).
- O runtime embarcado adquire lease com `ttlMs: 60_000` (`packages/embedded-agent-runtime/src/index.ts:974`) e **não renova** o lease durante o turno. Turno mais longo que 60s pode ser assumido por outra instância com fence maior; o escritor antigo é rejeitado no commit — sem corrupção, mas com perda de trabalho e possível `ADMISSION_IN_PROGRESS`.
- `releaseLease` é best-effort (`packages/embedded-agent-runtime/src/index.ts:985-992`): lease expirado é re-adquirível com fence maior; não é preciso forçar.

## 3. Localizar o checkpoint

Tabelas da migration 038 (`db/migrations/038_agent_runtime_session_state.sql`):

```sql
-- último checkpoint da sessão (payload contém checkpoint + runState)
select sequence, schema_version, digest, fence, created_at
from agent_checkpoints
where session_id = $1 and organization_id = $2
order by sequence desc limit 1;

-- lease corrente: só intervir se expires_at <= now() e não houver turno vivo
select owner_id, fence, acquired_at, expires_at from agent_leases where session_id = $1;

-- ledger de turnos (append-only; sequência crescente)
select sequence, status, input_digest, context_digest, model_request_digest, model_response_digest, fence, completed_at
from agent_turns where session_id = $1 order by sequence asc;
```

- O payload é `{ checkpoint: KernelCheckpoint, runState: ... }`; o runtime lê `payload.checkpoint` (`packages/embedded-agent-runtime/src/index.ts:1045`).
- `KernelCheckpoint.schemaVersion` é `1` (`packages/agent-kernel/src/index.ts:257`) e o checkpoint guarda **digests**, não conteúdo bruto (history limitado a 32 entradas com `content: ""`, linhas 883-887).
- Trigger `cvg_agent_runtime_append_only_guard` bloqueia `UPDATE`/`DELETE` em `agent_turns` e `agent_checkpoints` (migration 038, linhas 81-97): não existe edição suportada.

## 4. Retomar sem repetir efeito

1. Preferir retomada pela API: `POST /api/v1/ai/approvals/:id/retry` ou novo `POST /api/v1/ai/turns` com `sessionId`; com `approvalId`, o runtime carrega o último checkpoint e re-semeia o histórico com o prompt atual + últimas 4 mensagens (`packages/embedded-agent-runtime/src/index.ts:502-505`).
2. Se o turno parou em `WAITING_HUMAN`, a aprovação tem validade de 5 minutos (`expiresAt`, `packages/embedded-agent-runtime/src/index.ts:951`). Expirada, não pode ser aprovada (`approve` rejeita com `POLICY_DENIED`, linhas 382-384) e não deve ser reescrita: gerar nova solicitação.
3. Se o turno terminou `OUTCOME_UNKNOWN`, não repetir a tool. O ledger de execução do gateway marca `OUTCOME_UNKNOWN` e recusa novo claim com o mesmo idempotency key (`packages/agent-tools/src/index.ts:119,217`). Reconciliar o efeito externo antes de qualquer novo turno.
4. Se o sintoma é `ADMISSION_IN_PROGRESS`, confirmar que a outra instância está viva. Se não estiver, aguardar a expiração do lease e reenviar; o fence sobe sozinho.

## 5. Quando intervir manualmente

- Somente após provar que `agent_leases.expires_at <= now()` ou que o owner não existe mais, e preservando toda a evidência.
- A intervenção suportada é operacional (reiniciar a instância que trava, manter o turno pausado, abrir novo turno com nova chave de idempotência), não SQL direto.
- Qualquer ação em banco exige aprovação de operações + DBA e registro; ainda assim, `UPDATE`/`DELETE` em `agent_turns`/`agent_checkpoints` falha pelo trigger append-only.

## Evidência

- `fence`, `owner_id`, `expires_at` e sequência de checkpoints antes/depois;
- `agent_turns` da sessão com status, digests e fence;
- `ai_turns` correspondentes com `status` e `usage.status`;
- `correlationId`, `runId` e eventos `agent.tool.completed/v1`/`agent.turn.completed/v1`;
- para `OUTCOME_UNKNOWN`: registro de reconciliação do efeito externo.

## O que NÃO fazer

- Nunca deletar lease para "liberar" a sessão: a expiração é o mecanismo previsto.
- Nunca reenviar turno `OUTCOME_UNKNOWN` como se nada tivesse acontecido.
- Nunca editar/apagar `agent_checkpoints`, `agent_turns` ou reescrever a migration 038.
- Nunca reaproveitar `approvalId` expirado ou consumido; aprovações são one-shot (`decision: "allowed-once"` → `"consumed"`, `packages/embedded-agent-runtime/src/index.ts:636`).
- Nunca iniciar uma segunda instância sobre a mesma sessão para "destravar": o fencing vai rejeitar um dos lados.
