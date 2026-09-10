# Verificação — escrita normalizada autoritativa de pedido de exame

Data: 2026-09-10
Escopo: `CVG-FULL-STATE-OF-THE-ART:NORMALIZED-DIAGNOSTIC-REQUEST-WRITE`

## Contrato implementado

`POST /api/v1/diagnostics/requests` agora atravessa
`DiagnosticRequestApplicationService` e o port `DiagnosticRequestRepository`,
mantendo sessão, CSRF, PDP e idempotência durável. Em PostgreSQL, uma criação
nova passa `normalizedDiagnosticRequestWrite` ao commit; replay passa somente
o ID reproduzido, sem novo DML normalizado.

O commit confere a identidade do pedido com o snapshot, verifica paciente,
atendimento, solicitante e escopo, estabelece o contexto RLS e executa um
UPSERT autoritativo com `RETURNING`. O pedido command-owned é retirado da
projeção genérica. Divergência, dependência ausente, conflito ou falha
transacional falham fechado.

Arquivos principais:

- `packages/contracts/src/index.ts`
- `apps/api/src/application/diagnostic-service.ts`
- `apps/api/src/app.ts`
- `packages/persistence/src/index.ts`
- `db/migrations/032_diagnostic_request_scope.sql`
- `tests/integration/persistence.test.ts`
- `scripts/verify-pdp-coverage.ts`
- `scripts/verify-static.ts`
- `scripts/verify-production.ts`
- `docs/adr/022-authoritative-diagnostic-request-write.md`

## Evidência local direcionada

- testes de persistência, API e PDP: **60/60**;
- equivalência/divergência/replay do pedido cobertos por pool sintético;
- `RETURNING` sem linha cobre falha fechado e `ROLLBACK`;
- boundary HTTP cobre criação e replay com um DML normalizado;
- `npm test`: **167** testes, **166 pass**, **1 skip**;
- `npm run test:database`: **44/44**;
- `npm run test:fault`: **17/17**;
- `npm run test:e2e`: **64 pass**, **4 skips** na repetição após uma primeira
  tentativa com dois `ENOENT` transitórios de artefatos Firefox;
- lint (**132 fontes**), typecheck, build, `verify:pdp` (**68 operações, 70
  regras, 6 policies, 12 domínios**), `verify:static` (**61 artefatos / 134
  fontes**), `verify:production`, benchmark local e `git diff --check`: pass;
- `verify:postgres` agora inclui a criação/replay real de um pedido, persiste
  `unit_id`/`workspace_id` derivados do atendimento e verifica isolamento RLS;
  essa prova só será executada no PostgreSQL efêmero do CI ou em ambiente
  explicitamente identificado.

## Revisão independente

A crítica fresh Beauvoir foi executada sobre o WIP e retornou `NOT_COMPLETED`.
Ela não emitiu aprovação. Os achados sobre escopo PostgreSQL e inventário
foram incorporados nesta revisão: migration 032 adiciona colunas derivadas,
FKs compostas, shape check e policies DML exatas; ADR/evidência foram incluídos
nos inventários static/production e no índice de documentação. O pool sintético
continua declarado como evidência de contrato, não como prova de PostgreSQL.

## CI remoto do Guardian anterior

A lane anterior foi observada no SHA exato
`1486a8c749e7f2121aed4038f98dcd2a357fdf18`: o CVG CI #77 (`34496670076`)
terminou `success`, com job principal `102936758677`, job de imagens
`102939189944` e os dois artifacts de verificação publicados.

## Resultado e limites

Esta fatia só pode ser marcada `PASS_WITH_LIMITATIONS` depois da regressão
focada final, da revisão independente registrada e do CI do SHA exato desta
alteração. O CI não substitui PostgreSQL concorrente fora do runner, staging,
provider/DeepSeek, segredos, Collector/SLO, carga/chaos/recovery, matriz
assistiva completa ou aceite humano.

O programa permanece `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.
