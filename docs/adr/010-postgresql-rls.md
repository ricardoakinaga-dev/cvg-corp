# ADR 010 — PostgreSQL RLS como defesa de isolamento

**Status:** accepted; migrations aplicadas são imutáveis.

O PostgreSQL usa `ENABLE/FORCE RLS`, escopo organizacional e, quando aplicável, unidade/workspace derivados do contexto transacional. FKs compostas preservam proveniência entre entidades.

RLS não substitui autenticação, PDP, filtros de aplicação ou revisão de policy. A migration `019_runtime_scope_guards.sql` reforça o escopo persistido das projeções de IA sem reescrever migrations anteriores.
