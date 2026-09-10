# Verificação — escrita normalizada autoritativa de Guardian

Data: 2026-09-10  
Escopo: `CVG-FULL-STATE-OF-THE-ART:NORMALIZED-GUARDIAN-WRITE`

## Contrato implementado

`POST /api/v1/guardians` agora usa `guardianInputSchema`, atravessa
`GuardianApplicationService` e o port `GuardianRepository`, e permanece
protegido por `DurableIdempotencyService`. No modo PostgreSQL, uma criação nova
passa `normalizedGuardianWrite` ao commit durável; replay passa apenas o ID
reproduzido para não executar o DML normalizado novamente.

O commit valida equivalência com o snapshot, organização e escopo de unidade /
workspace, estabelece o contexto RLS e executa um UPSERT autoritativo com
`RETURNING`. O Guardian command-owned é removido da projeção genérica. Falhas
de equivalência, escopo, conflito ou transação falham fechado.

Arquivos principais:

- `packages/contracts/src/index.ts`
- `apps/api/src/application/guardian-service.ts`
- `apps/api/src/app.ts`
- `packages/persistence/src/index.ts`
- `tests/integration/persistence.test.ts`
- `docs/adr/021-authoritative-normalized-guardian-write.md`

## Evidência local direcionada

- testes de persistência, API e PDP: **55/55**;
- `npm run typecheck`: pass;
- `npm run verify:pdp`: pass, 68 operações, 70 regras, 6 policies e 12
  domínios críticos;
- `npm run verify:static`: pass, 59 artefatos obrigatórios / 132 fontes;
- `npm run build`: pass;
- `git diff --check`: pass.

Os testes usam pool sintético e comprovam o contrato SQL, escopo, replay sem
segundo Guardian DML, divergência e boundary HTTP. Eles não substituem a
concorrência PostgreSQL/RLS de processos reais.

## CI remoto — SHA exato

A lane foi integrada em `1486a8c749e7f2121aed4038f98dcd2a357fdf18` e observada
no CVG CI #77 (`34496670076`). O job principal
(`102936758677`) e o job de imagens (`102939189944`) terminaram com sucesso;
foram publicados os artifacts
`cvg-verification-1486a8c749e7f2121aed4038f98dcd2a357fdf18` e
`cvg-browser-e2e-1486a8c749e7f2121aed4038f98dcd2a357fdf18`.

## Resultado e limites

Esta fatia é `PASS_WITH_LIMITATIONS` enquanto a regressão completa e o CI do
SHA desta alteração não forem concluídos. A tabela e as policies já existentes
foram reutilizadas; nenhuma migration, credencial, dado real, provider,
staging, egress ou promoção foi acionada.

O programa permanece `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`: contextos
normalizados adicionais, worker actor/session PDP, PostgreSQL concorrente,
staging, provider/DeepSeek, Collector/SLO, carga/chaos/recovery, matriz
assistiva completa e aceite humano continuam sem prova.
