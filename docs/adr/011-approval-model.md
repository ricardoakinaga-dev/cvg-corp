# ADR 011 — Modelo de aprovação

**Status:** accepted for synthetic runtime; high-impact production use `NOT_RUN`.

Approval é one-shot, limitado por TTL, policy revision, request digest e recurso. Risco alto/crítico exige ator aprovador independente; rejeição, expiração, digest divergente e reuso falham fechado.

A aprovação autoriza a operação exata, não altera role, policy ou contexto e não confirma efeito externo sem receipt.
