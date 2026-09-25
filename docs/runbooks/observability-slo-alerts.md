# Runbook — SLOs, alertas e drills de observabilidade

**Estado:** contrato local `PROPOSED`; drill sintético disponível; entrega de
alerta externa `BLOCKED_EXTERNAL`. **Owner:** platform-ops/observability-ops.

## SLI/SLO

| Sinal | Janela | Objetivo local | Evidência atual |
|---|---:|---:|---|
| disponibilidade da API | 30d | `>= 99,9%` | `NOT_RUN` |
| p95 da API | 30d | `<= 300 ms` | `NOT_RUN` |
| erro da API | 30d | `<= 1%` | `NOT_RUN` |
| dependências críticas | 30d | `>= 99,9%` | `NOT_RUN` |
| outbox/heartbeat | 30d | definido por ambiente | `NOT_RUN` |
| drops de telemetry | 30d | `0` | `NOT_RUN` |
| restore RTO/RPO | 30d | `UNKNOWN` | infraestrutura externa ausente |

Os valores acima são propostas de catálogo, não medição de produção. Um target
`null`, uma observação `UNKNOWN` ou uma janela sem amostra resulta em `NOT_RUN`,
nunca em PASS. O painel expõe `cvg_restore_rto_rpo_known 0` enquanto não houver
receipt aprovado do exercício externo.

## Alertas

`docker/observability/alerts.yml` exige `severity`, `for`, `runbook`, `owner` e
`channel`. Os nomes de rota, tenant, job e erro não entram em labels. Alertas de
RTO/RPO desconhecidos sinalizam a lacuna (`CvgRestoreRtoRpoUnknown`); não
transformam a lacuna em resultado de DR.

O `alertmanager.yml` principal continua exigindo uma URL fornecida por uma
autoridade externa. Para um drill isolado, use somente
`docker/observability/alertmanager.local.yml` e um receptor sintético local.
Não configure webhook real neste workspace.

## Drill local

```bash
node --import tsx scripts/ops/verify-observability-local.ts
docker compose -f docker/observability/compose.local.yml config
```

O primeiro comando avalia uma violação sintética e a condição de RTO/RPO
desconhecida, verifica o roteamento declarativo e exercita os harnesses. O
segundo apenas renderiza a topologia; subir containers, enviar alertas ou
consultar uma autoridade externa exige decisão e ambiente autorizados.

## Resposta a alerta

1. Preserve `requestId`, `traceId`, `correlationId`, `jobId` e o horário; não
   copie payloads ou segredos para o incidente.
2. Confirme se o sinal tem amostra e se é `MEASURED`; `NOT_RUN`/`UNKNOWN` abre
   o bloqueio correspondente.
3. Siga o runbook indicado pelo label `runbook`; contenha provider, fila ou
   banco sem retry cego e sem liberar efeito `OUTCOME_UNKNOWN`.
4. Registre a resolução e o receipt atual. A entrega a canal externo e a
   aceitação humana não são simuladas pelo drill local.
