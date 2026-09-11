# Prova de carga e SLO

Status: `BLOCKED_EXTERNAL` para workload production-like; benchmark local e contrato k6 são `SYNTHETIC_ONLY`.

O contrato executável de carga está em [`tests/load/cvg-staging.k6.js`](../tests/load/cvg-staging.k6.js). Ele declara cenários separados para 50 usuários, 100 usuários e burst, thresholds de p95/erro e grupos opcionais para AI, provider e backlog do worker. `npm run verify:load` falha fechado quando URL HTTPS, token entregue pelo Secret Authority, threshold p95 observado ou o binário k6 não estão disponíveis; a existência do script nunca é contada como medição.

O benchmark local registra amostras brutas e não atribui capacidade. Ainda é necessário executar 50/100 usuários, burst, AI, provider e backlog em staging com p50/p95/p99, erros, saturação e orçamento aprovado. Nenhum SLO é marcado como `MEASURED` por esta documentação.


A fixture estrutural e os testes do contrato foram verificados em `VER-CVG-175`. Sem ambiente staging autorizado, `verify:load` retorna `LOAD_EVIDENCE_BLOCKED_EXTERNAL` e não marca SLO como medido.

Na revalidação `VER-CVG-194`, a duração do burst foi corrigida para duplicar unidades compostas (`30s` → `60s`, `1m30s` → `180s`) e o fixture passou 3/3 casos. A execução real continuou bloqueada porque não havia URL HTTPS, token do Secret Authority ou p95 observado.
