# ADR 018 — Restore durável de auditoria e recibos

Status: Accepted for local implementation; production drill evidence pending
Data: 2026-09-10
Escopo: `scripts/verify-postgres-restore.ts`

## Contexto

O snapshot canônico já carrega `auditRecords` e `commandReceipts`, e o commit
durável possui projeções append-only para `audit_records`, `cvg_audit_ledger`,
`command_receipts` e `cvg_command_receipt_ledger`. O drill de restore, porém,
reprojetava os ledgers de outbox, uso, inbox, efeitos externos e jobs, mas não
repassava explicitamente a auditoria e os recibos ao commit do banco destino.

## Decisão

O restore em banco novo passa `restoredSnapshot.auditRecords` e
`restoredSnapshot.commandReceipts` ao mesmo commit que cria a revisão
`RESTORE_QUARANTINED`. Depois, o drill consulta as tabelas canônicas por meio
da sequência dos dois ledgers append-only no destino, compara IDs e digests em
ordem com a origem e ainda compara os registros do snapshot exportado. A
origem continua sendo exportada antes e depois para provar que não sofreu
mutação.

A cadeia de auditoria é inserida na ordem do snapshot e validada pelo contrato
existente de `chainVersion`, `previousHash` e `recordHash`; conflitos falham
fechado. Recibos preservam a identidade e o digest do corpo através da
projeção idempotente existente.

## Consequências

- O restore não perde a trilha de decisão nem a idempotência histórica.
- Sessões continuam revogadas após a persistência e o destino continua em
  quarentena; nenhum login ou readiness de produção é liberado pelo drill.
- A prova continua sintética/CI: não equivale a backup gerenciado, RTO/RPO,
  concorrência production-like, staging, provider ou aceite AAA.

## Verificação

`verify-postgres-restore.ts` deve validar os ledgers canônicos de auditoria e
recibos, além dos ledgers operacionais já existentes. `verify:static`, testes
de persistência, typecheck, lint, build e o CI exato devem passar.
