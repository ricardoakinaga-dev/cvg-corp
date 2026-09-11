# Prova de writes authoritative

Status: `VERIFIED_LOCAL` — 32 coleções normalizadas passam por uma validação de agregado fail-closed antes de qualquer DML; a prova PostgreSQL concorrente production-like continua externa.

## Evidência local

Guardians, patients, appointments, encounters, clinical signing, diagnostic requests, specimens e diagnostic results têm writes normalizados command-owned com CAS/idempotência. Hospitalização, medicação, estoque, finanças, comunicação, conhecimento e estado de IA também são materializados na mesma transação durável, com o registro executável `AUTHORITATIVE_DOMAIN_REGISTRY` e `validateAuthoritativeSnapshot` validando organização, unidade/workspace, referências pai/filho, vínculos financeiros, estado de IA e a exceção explícita de quarentena para resultado externo sem pai resolvido. As migrations 032–034 adicionam FKs compostas, triggers de integridade e RLS para os filhos diagnósticos.

Comandos: `npm test`, `npm run test:database`, `npm run verify:authoritative-writes`, `npm run verify:postgres` (requer `DATABASE_URL`) e `npm run verify:static`.

## Gaps restantes

O gate local não substitui concorrência multi-instância, RLS real, rollback de infraestrutura ou carga production-like; esses itens permanecem `BLOCKED_EXTERNAL`/`NOT_RUN` até haver PostgreSQL e staging autorizados. A aplicação permanece fail-closed quando a persistência transacional não está disponível.

Rollback: migration forward-only e restauração quarentenada; não editar migrations aplicadas.
## Quarentena de resultados externos

Um resultado diagnóstico que não resolve simultaneamente pedido, amostra, paciente e escopo é rejeitado antes da projeção. O adaptador de memória registra somente um marcador na trilha `quarantined`; ele não insere um `DiagnosticResult` órfão no snapshot autoritativo. A validação do snapshot e o projetor PostgreSQL aplicam o mesmo contrato, alinhado às FKs e aos triggers das migrations 033–034. O resultado só entra em `diagnostic_results` depois que a cadeia request → specimen → patient → encounter está resolvida.
