# Prova PostgreSQL concorrente

## Evidência corrente — VER-CVG-264 — 2026-09-11

O contrato foi executado contra PostgreSQL 16.15 local real, em banco efêmero `cvg_verify_20260912` migrado pelos 36 arquivos atuais e com a conexão da aplicação usando `cvg_runtime` (`NOSUPERUSER`, `NOBYPASSRLS`, `NOINHERIT`, `NOCREATEDB`, `NOCREATEROLE`). A evidência local foi:

```text
verify:postgres:concurrency
POSTGRES_CONCURRENCY_VERIFIED processes=2 claims=CLAIMED,IN_FLIGHT replay=REPLAY conflict=IDEMPOTENCY_CONFLICT duplicateEffects=0

verify:postgres
postgres=PASS restartRead=PASS normalizedReads=PASS diagnosticRequest=PASS diagnosticSpecimen=PASS diagnosticResult=PASS diagnosticChildIntegrity=PASS idempotency=PASS outbox=PASS externalEffects=PASS inbox=PASS usageLedger=PASS breakGlass=PASS cas=PASS rls=PASS rlsDomainTables=59 rlsProtectedTables=59 organizationForeignKeys=116

verify:postgres:restore
restore=PASS encryptedBackup=true tamperRejected=true partialRejected=true staleRejected=true migrationMismatchRejected=true targetStatus=QUARANTINED loginBlocked=true readinessBlocked=true sourceUnchanged=true
```

Isso fecha uma prova local de execução multiprocesso, restart, CAS, RLS e restore criptografado. O banco foi isolado e não representa staging, alta disponibilidade, backup gerenciado, RTO/RPO ou autorização de promoção.

`npm run verify:postgres` e `npm run test:database` exercitam migrations, RLS, CAS, leases, recovery e idempotência quando um PostgreSQL autorizado está disponível. `npm run verify:postgres:concurrency` inicia dois processos Node independentes (cada um com seu próprio pool), exige exatamente um `CLAIMED` e um `IN_FLIGHT`, conclui o recibo pelo commit canônico, verifica `REPLAY` e verifica `IDEMPOTENCY_CONFLICT` para corpo divergente. O gate retorna `POSTGRES_CONCURRENCY_BLOCKED_EXTERNAL` sem `DATABASE_URL` ou sem um snapshot canônico de bootstrap; não deve criar dados silenciosamente em um banco de produção.

Não há capacidade, exactly-once ou RTO/RPO inferidos de promises no mesmo processo. A evidência global continua `AAA_NOT_PROVEN` até que o mesmo contrato seja executado em ambiente autorizado, com staging, observabilidade, CI/proveniência e aprovação humana.

O run histórico de 2026-09-10 com 34 migrations permanece abaixo apenas para proveniência; não representa o estado corrente.


## Revalidação local VER-CVG-190

Em um banco efêmero PostgreSQL 16.15 com as 34 migrations disponíveis naquela execução, a role `cvg_runtime` sem `SUPERUSER`, `BYPASSRLS`, `INHERIT`, `CREATEDB` ou `CREATEROLE`, `verify:postgres` passou 59/59 tabelas com RLS e 116 FKs organizacionais. Dois processos separados produziram `CLAIMED`/`IN_FLIGHT`, replay durável, conflito de digest e zero efeitos duplicados. O restore cifrado também passou rejeições de tamper, partial, stale e migration mismatch, quarentena, bloqueio de login/readiness e preservação da origem. Esta evidência é local/efêmera e não prova staging multi-instância, backup gerenciado, RTO/RPO ou promoção.

## Limite de revalidação VER-CVG-239 — migration035

O código atual inclui `035_break_glass_scope.sql` e `assertSchema` exige sua coluna, constraint e trigger. O artifact local machine-readable permanece uma prova histórica de migrations 001–034; não foi alterado para alegar que migration035 foi executada. A próxima execução autorizada de PostgreSQL deve aplicar migration035 e repetir concorrência, restore e readiness antes de qualquer promoção.

## Revalidação local corrente — VER-CVG-261 — 2026-09-11

Um banco efêmero isolado `cvg_verify_20260912` em PostgreSQL 16.15 recebeu todas as 36 migrations do source, incluindo `035_break_glass_scope.sql` e `036_runtime_migration_metadata_privileges.sql`. A role `cvg_runtime` permaneceu `NOSUPERUSER`, `NOBYPASSRLS`, `NOINHERIT`, `NOCREATEDB`, `NOCREATEROLE`, com apenas `SELECT` em `schema_migrations`.

`verify:postgres` passou 59/59 tabelas RLS, 116 FKs organizacionais, leituras normalizadas, diagnósticos, outbox, efeitos, inbox, usage, break-glass, CAS e idempotência. `verify:postgres:concurrency` passou com dois processos (`CLAIMED`, `IN_FLIGHT`, `REPLAY`, `IDEMPOTENCY_CONFLICT`, `duplicateEffects=0`). `verify:postgres:restore` passou AES-256-GCM e rejeitou tamper, partial, stale e migration mismatch, mantendo o destino `QUARANTINED`, login/readiness bloqueados e origem inalterada.

O snapshot `2e19a834afa9241a5d3d29a15416e6d8706afd6b6943bfe6ce447217600f1dfb` liga essa fotografia ao SHA atual. A evidência continua local/efêmera: staging multi-instância, backup gerenciado, RTO/RPO, observabilidade medida e promoção externa permanecem sem prova.

## Metadata final — VER-CVG-264

O artifact corrente permanece ligado ao snapshot `903db416c44e1df7f12f2270bd078bcf5724b50d878ffd1ea021691a801a8004`; as migrations 001–036 continuam provadas apenas no PostgreSQL local efêmero. A promoção global segue `AAA_NOT_PROVEN`.
