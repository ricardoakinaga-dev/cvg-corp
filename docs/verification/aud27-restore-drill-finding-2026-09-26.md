# Achado — drill de restore vermelho na composição com o verificador de comportamento — 26/09/2026

**Gate:** `verify:ephemeral-postgres -- --run-restore` (e a sequência manual `verify:postgres` → `verify:postgres:restore` no mesmo banco).
**Resultado observado:** `EPHEMERAL_POSTGRES_FAILED code=POSTGRES_BEHAVIOR_FAILED` — `direct SQL oracle relation audit_records diverged` (origem 24 linhas, destino restaurado 22).
**Reprodução:** duas execuções independentes nesta data, PostgreSQL 16 descartável, dados sintéticos.
**Status:** `OPEN — DECISÃO HUMANA PENDENTE` sobre a correção do oráculo.

## Causa raiz

1. O wrapper efêmero executa `runPostgresVerifier` antes do drill de restore no mesmo banco (`--run-restore` força isso, pois o drill depende do estado semeado).
2. O verificador de comportamento (`verify:postgres`) insere, por SQL cru, linhas-sonda `verify.rls.scope` em `audit_records` na mesma organização de fixture, para provar o escopo RLS e o append-only. Essas linhas ficam **fora da cadeia tamper-evident** (`record_hash` nulo) e **fora da autoridade de snapshot**, e são indeléveis por design (o próprio probe prova que `update`/`delete` retornam SQLSTATE 55000).
3. O bundle de recuperação carrega auditoria pela autoridade de snapshot; o restore, portanto, reproduz 22 das 24 linhas.
4. O oráculo SQL exato (`exactRelationNames`), introduzido no fechamento MEL24 (`fc8a5d1`, 25/09), exige igualdade byte-exata da relação inteira — e falha. A composição nunca passou desde então; a matriz de 25/09 não executou este gate.

## O que o achado significa

O restore em si preservou integralmente a autoridade de recuperação (known-bads 5/5 rejeitados, known-good PASS, rollback atômico). A divergência é entre **resíduo de verificação fora da autoridade** e um **oráculo que pede a relação inteira**. Não há evidência de perda de dados do caminho autoritativo; há incompatibilidade estrutural entre dois verificadores do mesmo pacote.

## Correção proposta (aguardando decisão humana)

Particionar `audit_records` no oráculo: comparar byte-exato o conjunto encadeado (`record_hash` não nulo) e tratar o resíduo explicitamente — qualquer linha sem cadeia que **não** seja a sonda conhecida (`action = 'verify.rls.scope'`) continua reprovando na origem, e o destino restaurado não pode conter resíduo algum. Isso preserva a força do oráculo (nenhuma linha autoritativa pode divergir; resíduo inesperado continua sendo falha) e reconhece o contrato real do bundle. A tentativa de aplicar essa correção nesta sessão foi bloqueada pelo classificador de permissões como alteração de teste de segurança; a decisão pertence ao responsável humano. Alternativa mais invasiva: mover a sonda RLS para uma organização descartável própria, exigindo fixture completa de org/usuário/unidade/workspace por SQL cru.

## Evidência

- Log das execuções: `artifacts/operational-proof/mel26-local-revalidation-20260926/` (rodada desta data).
- Primeira linha divergente identificada: `action='verify.rls.scope'`, `record_hash=null`, `previous_hash=null`, unidade/workspace de fixture `…0011`/`…0021`.
- Origem das sondas: `scripts/verify-postgres.ts` (inserts crus de RLS scope); oráculo: `scripts/verify-postgres-restore.ts` (`exactRelationNames`).
