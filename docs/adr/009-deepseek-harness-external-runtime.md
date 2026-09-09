# ADR 009 — DeepSeek Harness como runtime externo

**Status:** accepted as an adapter boundary; external execution `NOT_RUN`.

O CVG não importa o engine externo no domínio. `packages/harness-adapters` traduz a interface `AgentRuntime` e valida health, commit, manifest, capabilities e tool registry antes de qualquer turno.

Nesta etapa a implementação é uma ponte CVG HTTP `/v1`, não uma afirmação sobre o protocolo nativo do repositório externo. Sem endpoint e autoridade aprovados, o adapter permanece `UNAVAILABLE` e não realiza egress.
