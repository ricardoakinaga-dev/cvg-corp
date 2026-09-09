# Observabilidade de produção

Status: `PROPOSED/NOT_RUN`. Há telemetria tipada, redaction e contratos de sinais/SLO no código, porém não há evidência de Collector, Prometheus, Grafana, Alertmanager, export OTLP ou alert dispatch de staging.

## Stack-alvo

```text
apps/api + worker + bridge -> OpenTelemetry SDK/exporter -> Collector
  -> metrics/traces/logs -> Prometheus/Grafana/Alertmanager
```

Cada request deve conservar correlation, tenant-safe attributes, operation, outcome, latency, queue age, provider status, unknown outcome, reconciliation state, AI model/commit/manifest, token usage e cost estimate sem conteúdo clínico ou segredo.

SLOs e budgets existentes são alvos propostos, não medições: disponibilidade/readiness, latência de API, outbox age, provider success, reconciliation age, AI timeout, audit write e restore RTO/RPO. Alertas devem apontar para os runbooks de deploy, provider/DeepSeek, worker, backup, segurança e SLO.

## Evidência necessária

- compose de observabilidade executado em staging;
- dashboards versionados com queries e retenção aprovadas;
- alerta disparado por fixture controlada e recuperado sem dados sensíveis;
- amostra de SLO com janela, denominador, error budget e timezone;
- teste de perda do collector sem bloquear transações críticas nem perder auditoria obrigatória.

Nesta máquina, o gate é mantido como `NOT_RUN`; telemetria local em memória não é promovida para disponibilidade ou SLO de produção.
