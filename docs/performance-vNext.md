# Performance, carga e capacidade vNext

## Contrato de medição

Benchmarks devem declarar commit, hardware, Node, dataset, concorrência,
warm-up, duração, percentis, erro, payload redigido e ambiente. Não misturar
medição sintética com SLO de produção. O workload não pode habilitar provider,
dados reais ou mutações fora do tenant de teste.

`CURRENT`: `npm run benchmark:local` mede somente a baseline local sintética;
targets de latência, outbox e restore estão tipados como propostas em
`@cvg/ops`.

`PROPOSED`: medir em staging separado API read/write, PDP, patient lookup,
login/MFA, outbox/worker e provider sandbox, com 1x/5x/10x carga, limites de
pool, rate limit, backpressure, circuit breaker e recuperação após dependência
lenta. O resultado deve alimentar error budget e uma decisão de capacidade.

Sem carga aprovada e amostra production-like, o status é `NOT_RUN` e não há
promessa AAA de performance.
