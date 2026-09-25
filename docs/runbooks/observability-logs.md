# Runbook — logs operacionais, correlação e retenção

**Estado:** sink local NDJSON verificável; backend de logs externo `BLOCKED_EXTERNAL`.
**Owner:** observability-ops. **Canal:** local-ops. **Abortar se:** o evento contiver
payload clínico, segredo, query bruta ou um identificador que não possa ser
limitado/redigido.

## Contrato

`@cvg/ops` normaliza nomes de operação para método + route template, remove
query/fragmentos, reserva um bucket `__overflow__` e mantém budgets para mapas,
atributos, metadados, spans, latências e logs. `prompt`, `content`, `payload`,
`body`, URL/URI, credenciais, tokens e material de autenticação são redigidos.
IDs de correlação podem permanecer apenas como identificadores opacos bounded:
`requestId`, `traceId`, `correlationId`, `jobId`, `outboxId` e
`providerRequestId`.

O span deve terminar uma vez com `response`, `error`, `abort`, `timeout` ou
`disconnect`. `openSpanCount` e `telemetry.duplicates` são sinais de diagnóstico;
um contador diferente de zero exige investigação.

## Sink local

`FileDurableLogSink` grava NDJSON append-only com modo `0600`, diretório `0700`,
`fsync` por registro, rotação por tamanho e retenção bounded. O worker só usa o
sink quando `CVG_DURABLE_LOG_FILE` é explicitamente configurado. Consultas locais
devem filtrar por correlação, por exemplo:

```bash
rg 'corr-local|job-local' /tmp/cvg-operational.jsonl
```

O arquivo é um mecanismo local de continuidade e não uma autorização para usar
dados reais. Um erro de escrita gera `cvg_telemetry_dropped`; o processo não
confirma durabilidade quando o sink está sob pressão.

## Verificação local

```bash
node --import tsx packages/ops/tests/observability.test.ts
node --import tsx scripts/ops/verify-observability-local.ts
```

Esses comandos usam somente identificadores e payloads sintéticos. Persistência
após reinício é verificada no diretório temporário do harness. Retenção gerida,
controle de acesso corporativo, TLS/autenticação e busca em backend aprovado
permanecem `BLOCKED_EXTERNAL`.
