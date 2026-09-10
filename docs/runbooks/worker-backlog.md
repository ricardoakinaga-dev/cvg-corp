# Runbook — worker backlog

**Estado:** worker separado com entrypoint Compose unificado em `CvgWorkerApplication`, fila durável `cvg_worker_jobs`, liveness `cvg_worker_heartbeats`, sink em quarentena e exercício production-like `NOT_RUN`.
**Owner:** operações. **Abortar se:** lease, fence token, organização ou migration não estiverem válidos.

Configurar `CVG_WORKER_ORGANIZATION_ID` explicitamente; não usar `CVG_ORGANIZATION_ID` como alias. Observar depth, oldest age, attempts, poison messages e reconciliation lag. Confirmar health do banco e do worker antes de alterar limites. Reivindicar somente com lease/fence, respeitar retry bounded e mover poison messages para `QUARANTINED`.

Para jobs internos, a admission usa `PostgresPersistence.enqueueWorkerJob` com chave de idempotência tenant-scoped e digest imutável. O ciclo usa `claimWorkerJobs` (`SKIP LOCKED`), handlers registrados por `jobType`, `completeWorkerJob`/`failWorkerJob` fenced e `workerJobStats` antes de reclamar. `recordWorkerHeartbeat` rejeita atualização com `last_seen_at` ou `started_at` obsoletos; uma falha ao persistir o heartbeat bloqueia o claim da cycle.

Consultar `cvg_worker_jobs` por organização/lane, status, `available_at`, `attempts`, `lease_until` e `last_error`; consultar `cvg_worker_heartbeats` por organização, worker, status e `expires_at`. `PENDING`/`CLAIMED` são backlog; `QUARANTINED` exige triagem/replay autorizado; `COMPLETED` não deve ser reaberto manualmente. Heartbeat expirado é sinal operacional, não autorização para assumir o job sem novo claim/fence.

Não aumentar concorrência como reação cega, não reenviar `UNKNOWN` e não apagar a fila. A recuperação deve deixar receipt, audit e motivo de cada decisão.
