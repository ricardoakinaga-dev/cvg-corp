# ExecPlan: CVG-AUD22 - requalificacao do resultado AUD21

<!-- status: ACTIVE; active_action_id: CVG-AUD22-002:POSTGRES-RESTORE-PROOF -->

## Outcome

Eliminar o false-green do control plane, preservar o historico append-only e
avancar somente com evidencias current ligadas ao subject exato. O veredito
global permanece PARTIAL / REJECT / AAA_NOT_PROVEN enquanto houver gates locais,
externos ou humanos nao executados.

## Autoridade e restricoes

- Auditoria: `docs/auditoria-resultado-cvg-aud21-013-2026-09-20.md`.
- Roadmap: `docs/roadmap-melhorias-cvg-aud22-2026-09-20.md`.
- Backlog: `docs/backlog-melhorias-cvg-aud22-2026-09-20.md`.
- Barra preservada: `.gauntlet/bar-v4.json`, SHA-256 `2093461a8d6103641a555ad45371dde4649e5f144c32260b80244e219fa70697`.
- Receipts e eventos antigos permanecem preservados; novas correcoes sao append-only.
- Nenhum commit, push, deploy, dado real, credencial, provider externo ou ambiente de producao sera usado.

## Ordem

001 control plane -> 002-004 recovery/priviliegios -> 005-007 subject/evidence
-> 008-011 qualidade local -> 012-013 schema/gates nao mutantes -> 014
qualificacao local 2x -> 015-018 autoridades externas -> 019 critica tecnica
-> 020 decisao humana.

## Next Action - CVG-AUD22-002

- action_id: CVG-AUD22-002:POSTGRES-RESTORE-PROOF
- A semantica de recovery local esta implementada e passa known-good/known-bad,
  boundary pre-DML, regressao completa e o guard SQL de usageRecordId.
- Executar a matriz de restore em PostgreSQL autorizado; sem DATABASE_URL e
  MIGRATION_DATABASE_URL, manter AUD22-002 como PARTIAL/BLOCKED_EXTERNAL.

## Gate

Um unico active action, DAG sem ciclos, timestamps ordenados, plano e primeiro
passo coerentes, receipts current ligados aos IDs reais, prova PostgreSQL
explicitamente separada da prova local e promocao bloqueada.
