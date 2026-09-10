# ADR 017 — Composição do worker com ledger durável de efeitos

Status: Accepted for local implementation; production evidence pending
Data: 2026-09-10
Escopo: `createWorkerDependencies` e regressão de composição do worker

## Contexto

O sink de mensagens habilitado (`MessagingOutboxSink`) declara que exige um
ledger durável de efeitos antes de qualquer egress. A composição compartilhada
pelos dois entrypoints do worker recebia a persistência e o sink, mas não
conectava os métodos de efeitos ao `OutboxWorker`. O comportamento resultante
era fail-closed, porém a execução configurada era sempre quarantined antes do
provider e não criava a admissão durável necessária para reconciliação.

## Decisão

`createWorkerDependencies` passa a detectar os três métodos completos do
`ExternalEffectLedger` e expõe a própria persistência em `effects`. Quando a
capacidade não existe, `effects` é `null`; o `OutboxWorker` mantém a proteção
fail-closed para sinks que exigem ledger. A detecção é feita na factory comum,
portanto `apps/worker/src/main.ts` e `docker/worker.ts` recebem a mesma
composição.

A regressão usa a factory real, uma persistência sintética com as três
transições do ledger e um sink que exige ledger. Ela verifica a sequência
`ADMISSION_PENDING → DISPATCHED → SUCCEEDED`, uma única chamada ao sink e uma
entrega. A regressão existente para composição sem ledger continua exigindo
`effects: null`; a proteção do `OutboxWorker` continua cobrindo quarantine sem
chamar o sink.

## Consequências

- A composição de produção deixa de descartar o ledger que o sink requer.
- A ausência de implementação completa continua visível e bloqueante, em vez
  de ser mascarada como dispatch pronto.
- Health/readiness e `runCycle` também ficam `BLOCKED` quando um sink
  `ledger-required` não tem ledger composto; nessa condição o worker não
  reclama trabalho para depois quarantinar.
- Isso não cria handlers para `jobs`, `schedule`, `notifications` ou
  `maintenance`, não habilita provider real e não prova PostgreSQL concorrente,
  staging, observabilidade operacional ou recuperação production-like.
- O status global permanece `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN` até que
  os critérios externos e humanos da barra v3 tenham evidência.

## Verificação

Executar: `npm run test:fault`, `npm run typecheck`, `npm run lint`,
`npm run verify:static`, `npm run build`, `npm test` e `git diff --check`.
Depois da implementação, um crítico fresh read-only deve confirmar a factory,
as transições, a proteção sem ledger e a ausência de mutação fora da lane.
