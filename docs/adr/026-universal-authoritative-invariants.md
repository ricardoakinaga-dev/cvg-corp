# ADR-026 — Invariantes universais antes da projeção normalizada

Status: Accepted for local implementation; PostgreSQL production-like validation pending.

## Contexto

O domínio mantém um agregado canônico em memória durante a requisição e o persistence adapter materializa tabelas normalizadas na mesma transação. Alguns comandos já possuíam DML command-owned; os demais ainda dependiam da projeção completa do agregado. Um filho inconsistente não pode alcançar qualquer uma dessas escritas.

## Decisão

`AUTHORITATIVE_DOMAIN_REGISTRY` enumera cada coleção de negócio e sua tabela normalizada. `validateAuthoritativeSnapshot` roda dentro da transação, antes de `projectIdentity` ou `projectDomain`, e falha com `PersistenceCorruptionError` em qualquer drift de tenant, unidade/workspace, referência pai/filho ou relacionamento financeiro/IA. Resultados diagnósticos externos sem pai resolvido são a única exceção explícita: permanecem `QUARANTINED` e não podem ser lidos como válidos.

O gate `npm run verify:authoritative-writes` valida o registro, confirma a presença do SQL normalizado e executa uma mutação negativa. As migrations existentes continuam imutáveis; reparos futuros usam migration forward-only.

## Consequências

A proteção é aplicável a HTTP, worker, restore e callers futuros do adapter, e não depende de um teste de rota específico. A prova local não demonstra concorrência de PostgreSQL, RLS em staging ou RTO/RPO; `npm run verify:postgres:concurrency` permanece um gate externo quando `DATABASE_URL` não está autorizado.
