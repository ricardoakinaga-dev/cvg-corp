# Runbook — worker backlog

**Estado:** worker separado com sink em quarentena; exercício production-like `NOT_RUN`.
**Owner:** operações. **Abortar se:** lease, fence token, organização ou migration não estiverem válidos.

Observar depth, oldest age, attempts, poison messages e reconciliation lag. Confirmar health do banco e do worker antes de alterar limites. Reivindicar somente com lease/fence, respeitar retry bounded e mover poison messages para `QUARANTINED`.

Não aumentar concorrência como reação cega, não reenviar `UNKNOWN` e não apagar a fila. A recuperação deve deixar receipt, audit e motivo de cada decisão.
