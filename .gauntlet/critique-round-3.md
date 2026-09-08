# Critique round 3 — CVG-Corp — 2026-09-08

## Estado do critic independente

Um worker read-only em contexto fresco foi iniciado para revisar o artifact contra [`.gauntlet/bar-v2.json`](bar-v2.json). Após duas esperas e uma interrupção explícita, permaneceu sem produzir parecer; foi encerrado. Não há relatório independente, score ou decisão do critic a registrar. Nenhuma alteração de arquivo foi atribuída ao worker.

## Auditoria objetiva reproduzida pelo agente principal

Esta auditoria não substitui o critic independente e não é apresentada como aprovação.

## Evidência final posterior — builder, não independente — 2026-09-08 17:58

O builder reexecutou `npm run verify:all` (36/36 testes, build, static com 38 arquivos-fonte e 12/12 E2E), contraste, tokens strict, `npm audit --omit=dev`, `git diff --check` e `db:check`; todos passaram. A revalidação PostgreSQL 16.15 sintética passou todos os cenários, com 302 snapshots/journals, 217 audits/ledgers, 65 outbox, 8 inbox e 23 efeitos externos. O restore foi executado depois, em série, e passou com sourceRevision 303, targetRevision 1, cinco conjuntos recuperados por digest, `QUARANTINED`, login/readiness bloqueados e `sourceUnchanged=true`.

Uma primeira chamada com senha incompatível retornou 401 antes de mutar o banco; a repetição com a credencial sintética correta passou. Esta seção não altera a ausência de parecer independente fresco nem o veredito `FAIL` integral.

| Evidência | Resultado | Observação |
|---|---|---|
| `npm run verify:all` | PASS | typecheck, 33/33 testes, build, static e 12/12 E2E em 375/768/1440 |
| `npm run audit:contrast` | PASS | cinco pares declarados acima de WCAG 4.5 |
| `npm run audit:tokens -- --strict` | PASS | zero high/critical; 72 sinais medium heurísticos |
| `npm audit --omit=dev` | PASS | zero vulnerabilidades de produção |
| `git diff --check` | PASS | sem erro de whitespace |
| `db:migrate` | PASS | migrations 001, 002 e 003 aplicadas no banco sintético separado |
| `npm run verify:postgres` | PASS | PostgreSQL 16.15, restart/read, idempotência, CAS concorrente, ledgers e RLS organizacional |

## Veredito de fechamento

**Barra integral: `FAIL`. Recorte local: `PASS WITH LIMITATIONS`.**

O artifact demonstra uma fatia local-first executável e uma barreira PostgreSQL transacional com journal, snapshot, projeções, receipts/auditoria e RLS organizacional. A verificação RLS foi feita com papel efêmero não-superusuário; o papel foi removido ao fim e nenhum banco existente foi removido.

Os bloqueadores restantes são materiais: PDP e repositories de leitura completos por unidade/workspace; outbox, workers e claim/lease/fencing de efeitos externos; provider e usage ledger reais; backup/restore e crash drills; cache offline autorizado e purga; browsers além de Chromium, acessibilidade profunda, SLOs/alertas e aceite operacional. Portanto não há base para declarar dados reais, produção, conformidade ou programa corporativo completo.

## Ação recomendada

Manter o estado `IN_PROGRESS`/`PARTIAL`, preservar este relatório como registro de que a crítica fresca não concluiu, e usar a próxima rodada para fechar os gaps de leitura/autorização e efeitos externos antes de qualquer homologação.

## Evidência posterior do builder — não independente — 2026-09-08

Depois da auditoria objetiva acima, o builder executou uma continuação bounded para reduzir os gaps identificados: leitura normalizada transacional de `guardians`, `patients` e `appointments`; migrations `004_outbox_usage_lease.sql`, `005_appointment_scope_rls.sql` e `006_scoped_projection_rls.sql`; outbox com claim/lease/fencing; `OutboxWorker` com retry limitado e quarentena; ledger sintético idempotente de uso; e restore PostgreSQL em destino temporário com bloqueio de login/readiness.

Os gates posteriores passaram: 35/35 testes locais; `verify:postgres` com leituras normalizadas, outbox, usage ledger, CAS e RLS organizacional + unidade/workspace; e `verify:postgres:restore` com 18 registros de outbox e 1 de usage recuperados por digest, `targetStatus=QUARANTINED`, `loginBlocked=true`, `readinessBlocked=true` e `sourceUnchanged=true`. Esta seção é evidência reproduzida pelo builder, não um relatório do critic fresco. O veredito integral continua `FAIL`: ainda faltam PDP/RLS completo em todo o domínio, provider/efeito externo e inbox/reconciliação, settlement real, backup criptografado, fault/crash drills de produção, cache offline autorizado, browsers adicionais, SLO/alertas e aceite operacional.

## Atualização posterior do builder — não independente — 2026-09-08

As migrations `007`–`012` foram aplicadas em ordem. O artifact agora tem inbox com schema v1 e HMAC/key reference validados por verificador injetado, ledger de efeitos externos com recibo obrigatório, reconciliação com digest/fonte, escopo clínico DML e `FORCE RLS` no snapshot/journal canônico. Registros inbox legados sem assinatura foram quarentenados; a migration 008 não sofreu alteração após aplicação.

O gate PostgreSQL revalidado passou com 36/36 testes locais, receipt sintético, `OUTCOME_UNKNOWN`, divergência de inbox, crash depois do marcador, takeover de lease/fence, reconciliação manual, RLS canônico/clínico negativo e restore dos cinco conjuntos por digest. Essa evidência reduz gaps, mas não é aprovação independente nem produção: provider/consulta externa reais, PDP/RLS de todas as tabelas, backup criptografado, RTO/RPO/SLO, stores externos, offline autorizado, browsers adicionais e aceite humano permanecem pendentes.
