# Addendum — rerun final da guarda AST de encapsulamento/PDP

Data: 2026-09-11  
Modo: audit-only; nenhum código nem registro de controle foi alterado. Este addendum é a única escrita.

## Veredicto

**Local: PASS_WITH_LIMITATIONS.** O reparo da guarda AST fecha o finding H-02 de cobertura textual simples para o artefato atual. `collectDirectStoreMutations` usa AST do TypeScript e resolve aliases locais, acesso por colchetes, casts/assertions, destructuring renomeado e mutadores extraídos; os testes também confirmam que comentários, strings e mapas não governados não geram finding. A descoberta de domínio compara o registro com os conjuntos reais de backing maps privados, views `ReadonlyMap` e campos de `StoreSnapshot`, falhando em caso de drift. A varredura atual inclui `apps`, `packages` e `scripts` fora de `packages/domain`; não há mutador direto governado encontrado na inspeção.

**Global: AAA_NOT_PROVEN.** Continuam ausentes provider/DeepSeek/Secret Authority reais, PostgreSQL e operação production-like, staging de deployment/observabilidade/headers, provenance same-SHA, revisão independente e aprovação humana criptograficamente atestada.

## Findings residuais

### CRITICAL

**C-01 — promoção global sem provas externas.** O gate AST local não demonstra operação distribuída, provider real, promoção same-SHA ou aprovação AAA.

### MEDIUM / ADVISORY

**H-02-L — a guarda AST ainda não é análise semântica completa.** A implementação pode não resolver aliases passados por parâmetros/retornos, destructuring aninhado ou shorthand de métodos (`const { set } = store.patients`), e acessos dinâmicos cujo nome não é literal. Também não há fixtures negativas específicas para drift de registro ou cada uma dessas formas. Isso permanece uma limitação de cobertura, rebaixada de HIGH para MEDIUM/advisory no artefato atual porque o registro fail-closed detecta divergência estrutural e as views públicas são privadas, congeladas e mutadores lançam erro; um caso não detectado não fornece uma escrita canônica silenciosa.

## Evidência e limites

- Inspecionados `scripts/verify-pdp-universal.ts` e `tests/unit/pdp-universal.test.ts`.
- Confirmados fixtures AST para alias, bracket access, destructuring renomeado, cast, comentários/strings e mapa não governado.
- Confirmados checks de drift entre 41 coleções governadas e os conjuntos descobertos no domínio; a implementação atual não acusa mutadores diretos na inspeção de application, harness, worker ou scripts.
- Os testes e o verificador não foram executados neste rerun; portanto não se declara um resultado runtime. A conclusão local é baseada na leitura do código, fixtures e estado atual do artefato.

Independência: I1, contexto fresco e leitura contra o artefato atual.
