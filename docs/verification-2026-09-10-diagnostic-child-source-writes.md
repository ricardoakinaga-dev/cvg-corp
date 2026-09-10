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
- `node --import tsx --test tests/integration/persistence.test.ts`: **43/43**;
- `npm test`: **172 testes, 171 pass, 1 skip**;
- `npm run lint`, `npm run build`, `npm run verify:static`, `npm run verify:pdp`,
  `npm run test:database`, `npm run test:fault`, `npm run verify:production` e
  `git diff --check`: **pass**;
- testes cobrem UPSERT autoritativo, igualdade do snapshot, ausência de
  `RETURNING`, replay sem segundo DML e rollback;
- `db/migrations/033_diagnostic_specimen_result_scope.sql` contém backfill,
  shape checks, FKs compostas, índices e policies RLS/DML;
- `db/migrations/034_diagnostic_child_integrity_backstop.sql` adiciona FKs de
  paciente/cadeia, guards contra bypass `NULL/NULL` e policy de leitura exata;
- o gate real `verify:postgres` cobre criação/replay, reads sem contexto,
  tentativa de espécime sem escopo, cadeia resultado→pedido/espécime inválida,
  colunas persistidas e isolamento RLS.

## Evidência remota

O CI exato do SHA `400e40f5a76529f9a661c31a66d6950d7d0bfc2e` terminou com
sucesso no run `34507439496`, jobs `102972978597` (gates locais, migrations e
PostgreSQL/RLS efêmero) e `102975332632` (imagens API/web). Foram publicados
`cvg-verification-400e40f5a76529f9a661c31a66d6950d7d0bfc2e` e
`cvg-browser-e2e-400e40f5a76529f9a661c31a66d6950d7d0bfc2e`.

Essa evidência é válida para o SHA anterior à migration 034; o CI do SHA
corrigido ainda precisa executar a migration 034 e os novos negativos. Nenhuma
prova sintética ou CI anterior é promovida a prova do banco corrigido.

## Limites preservados

Continuam sem prova AAA todos os gates externos de provider/DeepSeek, secret
authority, staging, observabilidade/SLO, carga/chaos/recovery, browser matrix,
aceite humano e concorrência PostgreSQL fora do ambiente executado. O veredito
global permanece `FAIL_WITH_LIMITATIONS / AAA_NOT_PROVEN`.
