# Verificação — escrita normalizada autoritativa de encounter

Data: 2026-09-10
Escopo: `CVG-FULL-STATE-OF-THE-ART:AUTHORITATIVE-NORMALIZED-ENCOUNTER-WRITE`

## Contrato verificado

`POST /api/v1/encounters` agora atravessa `EncounterApplicationService` e um
port assíncrono de `EncounterRepository`, protegido por `idempotentAsync`.
Quando o runtime usa PostgreSQL, o resultado novo do comando é passado como
`normalizedEncounterWrite` para o mesmo commit durável que grava snapshot,
journal, auditoria, receipt e outbox.

A persistência grava a linha `encounters` com `unit_id`/`workspace_id`,
`ON CONFLICT` condicionado à igualdade de todos os campos e `RETURNING`. O ID
command-owned é removido da projeção genérica. O snapshot precisa conter a
mesma entidade; organização, paciente e appointment opcional precisam ser
resolvidos no mesmo escopo. Divergência, conflito ou falha de persistência
falham fechado e o boundary HTTP restaura o baseline quando aplicável. Replay
da mesma chave não executa uma segunda escrita normalizada.

Arquivos principais:

- `apps/api/src/application/encounter-service.ts`
- `apps/api/src/app.ts`
- `packages/persistence/src/index.ts`
- `tests/integration/persistence.test.ts`
- `docs/adr/016-authoritative-normalized-commands.md`

## Evidência local observada

- `node --import tsx --test tests/integration/persistence.test.ts`: **26/26**.
- `npm test`: **143 testes; 142 pass, 1 skip**.
- `npm run test:e2e`: **64 pass, 4 skips intencionais** para quick-open em
  viewport estreito, nos projetos Chromium/Firefox e stress.
- `npm run typecheck`: pass.
- `npm run build`: pass; bundle web produzido.
- `npm run lint`: pass, 126 fontes.
- `npm run verify:static`: pass, 50 artefatos/128 fontes.
- `npm run verify:pdp`: pass, 68 operações, 70 regras, 6 policies e 12
  domínios críticos.
- `npm run verify:production`: pass estrutural; nenhum serviço foi iniciado.
- `git diff --check`: pass.

Os testes de persistência e boundary HTTP usam pool sintético. Eles comprovam
o contrato de chamada, SQL, escopo, replay e falha local, mas não substituem
PostgreSQL concorrente/RLS em ambiente real, staging, carga ou recovery
production-like.

## Crítica independente

Um crítico fresco, não herdado e somente leitura foi comissionado após a
implementação e a regressão. Após janelas bounded e pedido de finalização, não
houve parecer, score ou decisão; o agente foi encerrado e a tentativa foi
registrada em `.gauntlet/critique-encounter-source-write-attempt-20260910.md`.
Nenhuma aprovação foi inferida.

## Limitações e veredito

Esta fatia local é `PASS_WITH_LIMITATIONS` se a verificação final permanecer
verde. O programa continua `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.
Como correção incidental de confiança visual durante a mesma rodada, o KPI
financeiro do dashboard deixou de transformar contagem em valor monetário e
agora exibe `Cobranças em aberto` como quantidade; isso não altera o escopo
transacional desta evidência.

Provider externo, turno DeepSeek real, autoridade de segredos, staging/TLS
operacional, Collector/SLO medido, carga/chaos/recovery production-like,
WebKit/assistive-tech/zoom real, PostgreSQL concorrente fora do CI, todas as
outras mutações normalizadas, replay seguro de `ops.restore` e aceite humano
continuam sem prova. Nenhuma promoção, credencial, dado real, egress ou
release foi acionado.
