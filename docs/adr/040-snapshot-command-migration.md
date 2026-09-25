# ADR 040 — Migração segura de snapshot para comando

Status: accepted as a migration framework; individual slice cutovers remain gated by current evidence.

## Contexto

O `StoreSnapshot` contém 32 coleções de domínio. Oito já possuem caminhos de escrita normalizados e autoritativos; as outras 24 ainda dependem do projetor de snapshot como fonte operacional primária. Remover esse projetor sem uma transição explícita criaria perda de dados, divergência entre leituras e replay não determinístico.

## Decisão

Cada coleção é descrita no inventário `SNAPSHOT_MIGRATION_PLAN` com:

- comando e aggregate versionados;
- chave de idempotência por organização e registro;
- autorização PDP nomeada;
- transação de organização;
- evento durável de comando;
- reconciliação por contagem, digest e invariantes;
- lifecycle explícito (`FRAMEWORK_READY`, `BACKFILL`, `DUAL_WRITE`, `CUTOVER`, `RECONCILED`, `RETIRED`).

O backfill deve usar uma chave única durável no adaptador SQL. A primeira aplicação grava o comando; replay com o mesmo digest é no-op; replay divergente falha fechado. Concorrência é serializada pela mesma chave. Falhas devem desfazer a projeção parcial dentro da transação e não registrar o comando como aplicado.

O snapshot continua sendo mantido durante a prova de equivalência. O cutover de cada slice somente pode ocorrer depois de backfill idempotente, concorrência, replay, autorização e reconciliação verdes. Nenhum caminho legado é removido por este framework sozinho.

## Consequências

O inventário passa a ser verificável e não permite declarar as 24 coleções residuais como migradas. O harness local prova o protocolo de replay, concorrência, rollback e equivalência, mas não substitui a prova de cada slice em PostgreSQL descartável e no ambiente representativo autorizado. Essa separação evita um falso `DONE` para AUD26-017..020.

## Evidência local

- `packages/persistence/src/snapshot-migration.ts`
- `tests/unit/snapshot-migration.test.ts`
- `npm run verify:snapshot-command-migration`
