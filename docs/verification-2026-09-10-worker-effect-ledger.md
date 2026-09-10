# Verificação — composição do worker com ledger de efeitos

Data: 2026-09-10
Base observada: `728896bc9674c5d34005522e21e3902b9f1b8590`
Resultado: `PASS_WITH_LIMITATIONS` local; `AAA_NOT_PROVEN` global

## Escopo

Esta fatia corrige somente a composição compartilhada do worker:

- `apps/worker/src/worker.ts` conecta `ExternalEffectLedger` quando os três
  métodos estão presentes;
- `health`, `runOnce` e `runCycle` refletem o bloqueio quando um sink exige
  ledger e ele não foi composto;
- `tests/unit/worker.test.ts` cobre composição completa, persistência parcial,
  ordem do outcome e ausência de chamadas/claims em condição bloqueada;
- `scripts/verify-static.ts` e ADR 017 registram o contrato.

Handlers de negócio, provider real, egress, staging, containers e banco real
ficaram fora da lane.

## Evidência local

- `npm run test:fault`: 17/17;
- `npm test`: 149 testes, 148 pass, 1 skip intencional;
- `npm run test:e2e`: 64 pass, 4 skips intencionais em viewport estreita;
- `npm run typecheck`, `npm run build`, `npm run lint`, `npm run verify:static`,
  `npm run verify:pdp`, `npm run test:contract`, `npm run verify:production` e
  `git diff --check`: pass.

O teste de composição completa observa
`ADMISSION_PENDING → DISPATCHED → PROVIDER → SUCCEEDED → COMPLETE`. Com
persistência parcial, health/dispatch ficam `BLOCKED`, não há claim e o sink
não é chamado.

## Crítica independente

O crítico fresh McClintock (`01a08b48-34f9-7622-b23c-145e351b4c71`) retornou
`REVIEW_ONLY_NO_BLOCKER` e `PASS` nos quatro invariantes. O fingerprint
`/tmp/cvg-corp-worker-final-pre-critic-20260910.json` foi verificado depois da
crítica com `match=true`. Isso é revisão local, não aprovação de produção.

## Limitações

Persistem sem prova PostgreSQL concorrente/RLS, crash/recovery, handlers de
produção, provider real, staging/TLS, telemetria operacional, carga/chaos,
matriz completa de browsers/assistive tech/zoom e aceite humano. O programa
continua `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.
