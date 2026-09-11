# Prova de observabilidade

Status: `PARTIAL`.

A aplicação e o worker têm seam OTLP redigido, endpoint Prometheus agregado, correlação e configuração Compose para Collector, Tempo, Prometheus, Grafana e Alertmanager. Testes locais validam redaction, protobuf e ausência de labels de tenant.

O contrato Prometheus agora expõe as séries consumidas pela configuração versionada: latência/error da API, profundidade e idade do outbox, heartbeat do worker (contagem e idade), reconciliação, mensagens poison, outcome desconhecido, dependências e disponibilidade do runtime. O dashboard usa os mesmos nomes emitidos pelo endpoint; ausência de heartbeat também dispara o alerta de worker stale.

Collector executando, delivery de alertas, dashboards preenchidos, SLO medido e incidentes em staging continuam `NOT_RUN`. O Alertmanager exige um webhook externo por `CVG_ALERTMANAGER_WEBHOOK_URL` e não possui receiver nulo; sem essa autoridade, o compose permanece sem delivery configurado. `npm run verify:staging` permanece fail-closed sem endpoint HTTPS autorizado.
