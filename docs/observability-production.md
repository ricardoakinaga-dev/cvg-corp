# Observabilidade de produção

Status: `SDK_WIRED/LOCAL_STACK_DECLARED/NOT_RUN`. API, worker e bridge possuem um exporter OTLP protobuf real, com redaction antes da criação do span; a prova local envia um span para um collector HTTP controlado. Nenhum serviço de observabilidade, export de staging ou alert dispatch de produção foi executado nesta máquina.

## Stack-alvo

```text
apps/api + worker + bridge -> OpenTelemetry SDK/exporter OTLP protobuf -> Collector
  -> metrics/traces/logs -> Prometheus/Grafana/Alertmanager
```

Cada request deve conservar correlation, tenant-safe attributes, operation, outcome, latency, queue age, provider status, unknown outcome, reconciliation state, AI model/commit/manifest, token usage e cost estimate sem conteúdo clínico ou segredo.

O endpoint Prometheus mantém o contrato sem labels de tenant/rota e emite as séries agregadas usadas pelo dashboard e pelos alertas, incluindo `cvg_worker_heartbeat_age_seconds` e `cvg_worker_heartbeat_count`. A idade é calculada a partir do heartbeat durável mais antigo no escopo da organização; contagem zero é tratada como ausência de liveness.

O SDK é opt-in por `OTEL_EXPORTER_OTLP_ENDPOINT` ou `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`; em produção o endpoint precisa ser HTTPS/TLS. O stack local está em [`docker-compose.observability.yml`](../docker-compose.observability.yml), com configuração do Collector em [`docker/observability/`](../docker/observability/), dashboards versionados e alertas associados a runbooks. API e worker entram também na rede privada `observability`; Prometheus coleta `/internal/metrics`, um endpoint fora de `/api/v1` que expõe somente agregados redigidos, sem tenant ou rota. O endpoint não é publicado pelo proxy e não substitui autenticação de uma superfície pública. O receiver de logs usa exporter `debug` como default seguro; receivers/exports de staging precisam de endpoints e retenção aprovados.

SLOs e budgets existentes são alvos propostos, não medições: disponibilidade/readiness, latência de API, outbox age, provider success, reconciliation age, AI timeout, audit write e restore RTO/RPO. Alertas devem apontar para os runbooks de deploy, provider/DeepSeek, worker, backup, segurança e SLO.

## Evidência necessária

- compose de observabilidade executado em staging;
- dashboards versionados com queries e retenção aprovadas;
- alerta disparado por fixture controlada e recuperado sem dados sensíveis;
- amostra de SLO com janela, denominador, error budget e timezone;
- teste de perda do collector sem bloquear transações críticas nem perder auditoria obrigatória.

Nesta máquina, o gate operacional é mantido como `NOT_RUN`; o span OTLP local e o endpoint Prometheus agregado provam somente o contrato/redaction, não disponibilidade, correlação completa de métricas/logs ou SLO de produção. O Alertmanager agora exige `CVG_ALERTMANAGER_WEBHOOK_URL` e usa um receiver webhook explícito; sem a autoridade de alertas, a configuração permanece bloqueada em vez de descartar notificações. Antes do uso real, as imagens devem ser fixadas por digest, os receivers devem operar com TLS/identidade aprovados e o canal precisa ser exercitado. O Compose e os alertas foram renderizados estruturalmente, mas Collector, dashboards, dispatch e exercícios de breach não foram iniciados.
