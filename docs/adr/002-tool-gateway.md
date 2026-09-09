# ADR 002 — Tool Gateway único

**Status:** accepted for implementation; execução externa continua deny-by-default.

Toda tool model-visible é registrada com capability, risco, roles, escopo, classe de dados, schema, approval, timeout, idempotência, audit, secrets e egress. A execução passa por `ToolGateway` e não por chamada direta do agente.

O gateway transforma decisões do PDP em `ALLOW`, `DENY` ou `APPROVAL_REQUIRED`; não concede permissões por fallback.
