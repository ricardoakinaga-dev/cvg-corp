# Verificação — escritas normalizadas autoritativas de espécime e resultado

Data: 2026-09-10
Escopo: `CVG-FULL-STATE-OF-THE-ART:REPLAN-NEXT-NORMALIZED-DATA-LANE`

## Contrato implementado

`POST /api/v1/diagnostics/requests/:id/specimens` e
`POST /api/v1/diagnostics/results` atravessam application services com PDP,
CSRF, sessão e idempotência durável. No modo PostgreSQL, cada criação passa a
ser dona de uma escrita normalizada autoritativa no commit; replay passa o ID
da linha já materializada e não repete o DML.

`specimens` e `diagnostic_results` agora armazenam o escopo derivado do
atendimento. A projeção genérica também estabelece o contexto RLS por linha,
preserva o modo legado `null/null` apenas para pedidos sem atendimento e falha
quando a cadeia pedido→espécime→resultado perde proveniência.

## Evidência local direcionada

- `npm run typecheck`: **pass**;
- `node --import tsx --test tests/integration/persistence.test.ts`: **42/42**;
- testes cobrem UPSERT autoritativo, igualdade do snapshot, ausência de
  `RETURNING`, replay sem segundo DML e rollback;
- `db/migrations/033_diagnostic_specimen_result_scope.sql` contém backfill,
  shape checks, FKs compostas, índices e policies RLS/DML;
- o gate real `verify:postgres` foi ampliado para criação/replay, reads,
  colunas persistidas e isolamento RLS, mas sua execução neste checkpoint ainda
  depende do CI PostgreSQL efêmero.

## Evidência remota

`PENDING`: o CI precisa executar a migration 033 e o gate PostgreSQL completo.
Nenhuma prova sintética é promovida a prova de banco real.

## Limites preservados

Continuam sem prova AAA todos os gates externos de provider/DeepSeek, secret
authority, staging, observabilidade/SLO, carga/chaos/recovery, browser matrix,
aceite humano e concorrência PostgreSQL fora do ambiente executado. O veredito
global permanece `FAIL_WITH_LIMITATIONS / AAA_NOT_PROVEN`.
