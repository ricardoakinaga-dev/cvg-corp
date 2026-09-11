# Addendum — rerun final da guarda de encapsulamento/PDP

Data: 2026-09-11  
Modo: audit-only; nenhum código nem registro de controle foi alterado. Este addendum é a única escrita.

## Veredicto

**Local: PASS_WITH_LIMITATIONS.** O H-02 de cobertura insuficiente está **CLOSED/REPAIRED** para o artefato atual. `scripts/verify-pdp-universal.ts` enumera as 41 coleções do `CvgStore`, exige para cada uma backing `private readonly <collection>Store = new Map`, view pública `ReadonlyMap` e rejeita declaração pública `Map`. A mesma guarda varre `apps` e `packages` fora de `packages/domain` contra mutações diretas `.set/.delete/.clear` em todas as 41 coleções. A inspeção do domínio atual satisfaz esse contrato; não há bypass direto encontrado em API, harness ou worker.

**Global: AAA_NOT_PROVEN.** Permanecem ausentes as provas externas de provider/DeepSeek/Secret Authority, PostgreSQL e operação production-like, staging de deployment/observabilidade/headers, provenance same-SHA, revisão independente e aprovação humana criptograficamente atestada.

## Finding residual

### CRITICAL

**C-01 — promoção global continua sem provas externas.** O gate local de encapsulamento não demonstra provider real, operação distribuída, promoção same-SHA ou aprovação AAA.

### HIGH

**H-02-L — a guarda é textual/parcial por desenho.** A enumeração atual cobre o escopo real conhecido, mas regex e presença textual não fazem análise de call graph/data flow. A guarda pode não capturar aliases, casts `any`, acesso dinâmico, mutação de um objeto já retornado ou um novo campo omitido da lista hardcoded. `packages/domain` é excluído para permitir as escritas internas legítimas. Typecheck, testes de mutação e revisão do artefato continuam necessários para complementar o gate; não há falha de cobertura observada neste rerun.

## Evidência e limites

- Inspecionados `scripts/verify-pdp-universal.ts` e `packages/domain/src/index.ts`.
- Confirmados 41 nomes na lista governada, 41 backing maps privados e 41 views públicas `ReadonlyMap` defensivas; `quarantined` permanece backing privado com getter congelado.
- Inspecionados application, harness, worker e scripts; nenhuma chamada direta aos mutadores dos mapas governados foi encontrada fora do domínio.
- O verificador e os testes locais não foram executados neste rerun; não se declara resultado runtime, staging ou externo.

Independência: I1, contexto fresco e leitura contra o artefato atual.
