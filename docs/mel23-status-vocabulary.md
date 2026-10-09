# Vocabulário de status MEL23/AUD27

O cruzamento MEL23→AUD27 é uma relação de requisitos com tarefas existentes. Ele não é um segundo backlog: o status de execução continua pertencendo a `.agent/backlog.json#items`, e recibos continuam em `.agent/verification.jsonl`.

## Status de tarefa

O verificador aceita somente estes valores em `items[].status`:

`READY`, `IN_PROGRESS`, `IMPLEMENTED_UNVERIFIED`, `PARTIAL`, `DONE`, `REOPEN`, `BLOCKED_BY_DEPENDENCIES`, `BLOCKED_EXTERNAL`, `BLOCKED_HUMAN`, `CANCELLED`, `PLANNED`, `SUPERSEDED`.

`BLOCKED` e aliases como `DONE-ISH`, `GREEN` ou `OK` não são estados de tarefa válidos. `PLANNED` e `SUPERSEDED` são mantidos para registros legados; tarefas AUD27 correntes usam o conjunto ativo definido pelo verificador de control plane.

## Estado da evidência

Quando `evidence_state` está presente, use um destes valores tipados:

`BLOCKED_BY_DIRTY_WORKTREE`, `BLOCKED_EXTERNAL`, `BLOCKED_HUMAN_REVIEW`, `HISTORICAL_SUBJECT_REBIND_ONLY`, `IMPLEMENTED_UNVERIFIED`, `PARTIAL_CLASSIFIED_NO_EXECUTION_PROOF`, `PARTIAL_LOCAL_BROWSER_ENVIRONMENT`, `PARTIAL_LOCAL_REAL`, `PARTIAL_LOCAL_WITH_EXTERNAL_GAP`, `PARTIAL_LOCAL_WITH_SEAMS_REMAINING`, `PLANNED`.

O estado de evidência descreve a força e a limitação da prova; não substitui o status da tarefa. O resultado por critério em `criterion_results` usa `PASS`, `PARTIAL` ou `BLOCKED` e precisa indicar comando, ambiente, timestamp e fingerprint observado. O campo geral `result` do recibo continua descrevendo o estado da tarefa AUD27 que o possui. Um fingerprint observado em árvore suja não é um fingerprint de candidato congelado.

## Veredito de promoção

O rótulo `PROPOSED` descreve um plano ainda não importado, não um status de tarefa. O veredito de promoção é outro eixo: `PROMOTION_BLOCKED` ou `PROMOTION_ELIGIBLE`. O estado de garantia é `AAA_NOT_PROVEN` até que todos os critérios obrigatórios tenham prova válida e independente. Um alias de sucesso ou a presença nominal de um artefato não muda esses vereditos.
