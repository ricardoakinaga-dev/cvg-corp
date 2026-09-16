# ADR 032 - Identidade idempotente estavel e fence de claim

- Status: Accepted
- Date: 2026-09-13
- Scope: AUD13-22
- Base artifact: `1c22c5dc79c52151f4c7c94c4402dfdc86812cbc`
- Exclusive resource: `idempotency`

## Context

O docs04 §7 define a `IdempotencyLookupKey` derivada de organização, escopo
efetivo, ator, tipo de comando, recurso e chave do cliente, com ausência
codificada como `ABSENT`. O ADR019 registrou a implementação existente, cuja
chave (`v: 2`) incluía o `sessionId`. A auditoria de 13/09/2026 (H10) observou
que uma nova sessão mudava o lookup e podia produzir uma segunda execução, e que
não havia reconciliador para claim expirado.

## Decision

1. A identidade canônica passa a ser `v: 3`, **sem sessionId**:
   `organizationId + actorId + operation + key + resourceId + unitId + workspaceId`,
   com `ABSENT` explícito para escopos opcionais. Novas execuções usam essa
   chave; receipts históricas permanecem válidas pela leitura dupla da chave
   legada `v: 2` (que inclui sessão), sem reescrever hashes existentes.
2. Um receipt `IN_FLIGHT` carrega `claimEpoch`, `claimExpiresAt` e
   `dispatchState` (`NOT_STARTED` ou `DISPATCHED`). Enquanto o lease está vivo,
   repetições recebem `ADMISSION_IN_PROGRESS` com `claimExpiresAt`.
3. Claim expirado é reconciliado sob o fence:
   - `NOT_STARTED` → finalizado como `FAILED` com `failurePhase=PRE_DISPATCH`
     e a mesma chave devolve a mesma negação; uma nova execução exige nova chave
     (`CLAIM_ABANDONED`);
   - `DISPATCHED`/desconhecido → `OUTCOME_UNKNOWN`, sem retry cego.
4. Antes de cruzar um boundary externo, o serviço marca `DISPATCHED` sob o mesmo
   `claimEpoch`; o settlement limpa `claimExpiresAt` e registra a fase final.
5. A migração `037_command_receipt_claim_fence.sql` apenas adiciona as colunas
   de fence e marca `OUTCOME_UNKNOWN` existentes como `DISPATCHED`; não
   recalcula a identidade de receipts antigas.

## Consequences

- Re-login com a mesma chave e corpo devolve o receipt original (replay), mesmo
  em outra sessão.
- Dois processos convergem pela constraint única + leitura dupla; o vencedor
  detém o fence e o perdedor observa `IN_FLIGHT`/`ADMISSION_IN_PROGRESS`.
- O takeover real multiprocesso exige PostgreSQL; sem serviço disponível a
  prova permanece explicitamente `BLOCKED` (script
  `verify:postgres:concurrency` retorna `POSTGRES_CONCURRENCY_BLOCKED_EXTERNAL`).
- A prova local cobre a máquina de estados (domínio e persistência com pool
  simulado), incluindo `PRE_DISPATCH`, `POST_DISPATCH`, lease vivo e replay
  pós-relogin.
