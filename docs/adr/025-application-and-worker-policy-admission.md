# ADR-025 — Admissão de callbacks, métricas e jobs no boundary de aplicação

## Contexto

O catálogo HTTP e a aplicação já possuíam policy, mas três efeitos duráveis ainda eram chamados no compositor HTTP: inbox de provider, claim da assinatura clínica e leituras operacionais de outbox. Jobs duráveis também podiam ser escolhidos apenas pelo nome do handler.

## Decisão

Usar services explícitos para cada boundary (`IntegrationInboxApplicationService`, `ClinicalSignApplicationService.signIdempotent` e `OperationalMetricsApplicationService`) e uma `INTEGRATION_POLICY_REGISTRY` para callbacks sem sessão. Jobs passam por `WORKER_POLICY_REGISTRY` e `enforceWorkerPolicy` antes do handler. Tipos sem registro falham fechado e podem ser quarentenados pela política de retry.

## Consequências

O arquivo HTTP compõe rotas e serializa respostas, mas não reivindica receipts nem acessa repositórios de inbox/métricas. O worker conserva escopo organizacional, chave de idempotência e payload validado antes de executar um handler. O registro local não prova provider externo, PostgreSQL concorrente ou staging; esses gates permanecem separados e bloqueados até evidência real.

