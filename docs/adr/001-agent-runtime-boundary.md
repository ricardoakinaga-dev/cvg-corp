# ADR 001 — Boundary do Agent Runtime

**Status:** accepted for implementation; production execution remains blocked.

O CVG usa uma interface `AgentRuntime` com `health`, `createSession`, `executeTurn`, `approve`, `replay` e `shutdown`. O domínio conhece somente contratos CVG; adapters traduzem Mock, DeepSeek e providers futuros.

Essa decisão permite testes determinísticos e troca de runtime sem importar SDK, processo, URL ou credencial no domínio. Um adapter indisponível retorna estado explícito e não executa egress.
