# Addendum — rerun final de aliases do `CvgStore`

Data: 2026-09-11  
Modo: audit-only; nenhum código nem registro de controle foi alterado. Este addendum é a única escrita.

## Veredicto

**Local: PASS_WITH_LIMITATIONS.** O H-01 está **CLOSED/REPAIRED**. `getUser`, `getUserByLogin`, `findSession`, `findAuthChallenge`, `effectiveAssignments`, `getAssignment`, `findPatient`, todas as listas e os comandos de criação/alteração observados devolvem cópias. As únicas referências não clonadas encontradas (`getUserRecord`, `findPatientRecord` e `addLedger`) são helpers `private` usados apenas dentro do domínio. `markUserLogin` e `recordChallengeFailure` agora mutam por ID/seam e o app usa o estado clonado retornado do desafio. A busca atual não encontrou regressão nem mutação direta de mapas governados nos consumidores.

**Global: AAA_NOT_PROVEN.** Continuam ausentes as provas externas de provider/DeepSeek/Secret Authority, PostgreSQL e operação production-like, staging de deployment/observabilidade/headers, provenance same-SHA, revisão independente e aprovação humana criptograficamente atestada.

## Findings residuais

### CRITICAL

**C-01 — gates externos da promoção global continuam não provados.** O fechamento do alias boundary melhora o adapter local, mas não fornece as evidências necessárias para qualquer declaração AAA ou production readiness.

### HIGH

**H-02 — a guarda universal continua sendo uma verificação textual parcial.** `verify-pdp-universal.ts` cobre os seis nomes de mapas históricos e exclui as escritas legítimas do módulo de domínio; não resolve aliases, casts `any`, acesso dinâmico ou novos seams. O typecheck e o encapsulamento atual fecham o caminho normal, mas a guarda não demonstra dominância universal de PDP sozinha.

## Evidência e limites

- Inspecionado `packages/domain/src/index.ts` por retornos públicos, helpers privados, backing stores e views `ReadonlyMap`.
- Inspecionados `apps/api/src/app.ts`, application services, `packages/harness`, worker e a guarda estrutural; não foi encontrado bypass direto.
- `tests/unit/domain.test.ts` contém sentinelas para mutação de coleções, `quarantined`, credenciais destacadas, estado destacado e entidades retornadas; esses testes não foram executados neste rerun.
- Nenhum gate runtime, staging, provider externo, revisão humana ou mutation sentinel criptográfico foi executado.

Independência: I1, contexto fresco e leitura contra o artefato atual.
