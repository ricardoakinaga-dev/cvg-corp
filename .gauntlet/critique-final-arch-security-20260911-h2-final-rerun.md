# Addendum — rerun final do H2 de estado do `CvgStore`

Data: 2026-09-11  
Modo: audit-only; nenhum código ou registro de controle foi alterado. Este addendum é a única escrita.

## Veredicto

**Local: PASS_WITH_LIMITATIONS.** O H2 está **CLOSED/REPAIRED**. `bootstrapCredentials` agora é exposto por getter com clone; `storageMode` e `healthStatus` usam backing privado e getters; o app define o modo apenas por `store.setStorageMode(config.storageMode)` durante a composição do runtime. Não encontrei atribuição direta desses campos, mutação direta de `quarantined` ou mutação direta dos mapas governados em application, harness ou worker.

**Global: AAA_NOT_PROVEN.** Permanecem sem evidência os gates externos de provider/DeepSeek/Secret Authority, PostgreSQL e operação production-like, staging de deployment/observabilidade/headers, provenance same-SHA, revisão independente e aprovação humana criptograficamente atestada.

## Findings residuais

### CRITICAL

**C-01 — promoção global continua sem provas externas.** A correção do H2 não muda os hard blockers da barra v4; nenhuma declaração AAA ou de production readiness é sustentada por este rerun local.

### HIGH

**H-01 — aliases fora dos seams permanecem possíveis.** Métodos públicos de domínio que criam ou localizam entidades, como sessão, usuário e desafio, ainda podem retornar a referência mantida no backing store. Um consumidor interno que retenha esse retorno pode alterar estado canônico sem passar por update governado. Fechamento completo exige cópia defensiva nesses retornos ou tipos imutáveis.

**H-02 — guarda PDP continua estrutural e parcial.** `verify-pdp-universal.ts` cobre os seis nomes de mapas históricos, mas não resolve aliases, casts `any`, acesso dinâmico, mutação de objetos retornados ou novos seams. O encapsulamento atual reduz o bypass normal de TypeScript; a guarda não prova dominância universal sozinha.

## Evidência e limites

- Confirmados em `packages/domain/src/index.ts`: backing privado, getter clonado de `bootstrapCredentials`, getters de estado, `setStorageMode`, getter congelado de `quarantined` e seams com cópia defensiva.
- Confirmado em `apps/api/src/app.ts`: uso de `store.setStorageMode(config.storageMode)` na composição; não há atribuição direta a `storageMode`/`healthStatus`.
- Inspecionados application, harness, worker e a guarda universal; nenhum bypass direto foi encontrado.
- Não foram executados testes, gates runtime, staging, provider externo, revisão humana ou mutation sentinel criptográfico neste rerun.

Independência: I1, contexto fresco e leitura contra o artefato atual.
