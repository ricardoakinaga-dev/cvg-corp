# Carga, caos e resiliência

Status: `SYNTHETIC_ONLY/NOT_RUN`. O benchmark local é uma referência de desenvolvimento; não é um SLO. Não foi executado k6/autocannon/pgbench contra um ambiente production-like e não foi injetada falha em provider, banco, rede ou collector real.

## Cenários obrigatórios

1. login/MFA e leitura sob carga com isolamento por organização;
2. concorrência de mutation/idempotency key e conflito de revisão;
3. outbox com lease, fencing, backpressure, shutdown e poison message;
4. DeepSeek timeout/cancel/refusal/partial e budget de tokens;
5. provider receipt perdido, callback duplicado, unknown outcome e reconciliação;
6. restart/crash entre stage, dispatch marker, receipt e settlement;
7. perda de PostgreSQL, pool exhaustion, DNS/TLS e perda do collector;
8. backup adulterado, restore quarentenado e replay pós-watermark.

Cada cenário precisa registrar carga, versão, SLO, falha injetada, timeline, duplicidades, dados afetados, recuperação e decisão. Sem baseline medido e aprovação de thresholds, o resultado deve ser `NOT_RUN`, nunca `PASS` por ausência de erro local.

## Evidência local reproduzível

O ciclo local do worker agora executa seis lanes com concorrência limitada por lote, budgets de itens/tempo, sinal de cancelamento, métrica de falha/poison e backpressure antes do claim do outbox (`CVG_WORKER_MAX_OUTSTANDING`, default `1000`). O heartbeat de container e o `SIGTERM` acionam shutdown cooperativo. `tests/unit/worker.test.ts` cobre backpressure sem claim, orçamento excedido e concorrência limitada; isso é evidência sintética do scheduler, não um SLO nem prova de worker production-like.
