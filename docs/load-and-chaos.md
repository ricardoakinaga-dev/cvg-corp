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

O ciclo local do worker agora executa seis lanes com concorrência limitada por lote, budget aplicado antes do claim, deadlines por handler, sinal de cancelamento, métricas de tentativa/falha/quarentena e backpressure antes do claim. `CVG_WORKER_MAX_OUTSTANDING` (default `1000`) limita outbox e as cinco lanes duráveis. Bulkheads de ciclo, banco, provider e IA rejeitam excesso sem fila em memória; uma amostra saturada do pool bloqueia trabalho antes de heartbeat/claim. O heartbeat de container e o `SIGTERM` acionam shutdown cooperativo. `scripts/verify-worker-runtime.ts` e os testes focados cobrem os limites locais; isso continua sendo evidência sintética, não SLO nem prova production-like.

O Compose também declara limites de CPU/memória e `ulimits.nofile` para cada um dos seis serviços da topologia base. `scripts/verify-resource-pressure.ts` exige seis contratos de CPU/memória e seis limites de descritor, além dos controles executáveis de bulkhead, admissão, saturação do pool e observabilidade. Isso prova a configuração declarada; pressão real de cgroup, descritores e recuperação ainda exige staging autorizado.
