# Crítica independente — round 4

**Critic:** `01a0833c-36b2-7f70-92cc-bf05a0fa62d7` (`Galileo`)
**Data:** 2026-09-08 20:00
**Modo:** contexto fresco, somente leitura; nenhum arquivo alterado pelo critic.
**Barra:** `.gauntlet/bar-v2.json` — IMPL-01..IMPL-12.

## Matriz independente

| Critério | Estado | Observação do critic |
|---|---|---|
| IMPL-01 | PARTIAL | Health/readiness e inicialização existem; runtime não foi executado nesta crítica. |
| IMPL-02 | PARTIAL | Schemas/envelopes/IDs opacos presentes; cobertura integral de respostas e versões não comprovada. |
| IMPL-03 | PARTIAL | Login, cookie, CSRF e escopo server-side presentes; PDP contextual/ABAC e sessão de produção ainda faltam. |
| IMPL-04 | PARTIAL | Invariantes, CAS, locks e transações presentes; concorrência de negócio não foi executada na crítica. |
| IMPL-05 | PARTIAL | Auditoria, receipts e outbox presentes; entrega/settlement externo real inexistente. |
| IMPL-06 | PARTIAL | Harness local tem policy, approval, budget, provenance e replay; provider/egress reais bloqueados. |
| IMPL-07 | PARTIAL | Rotas mínimas existem; jornadas completas de produto não estão demonstradas. |
| IMPL-08 | PARTIAL | Restore/quarentena existem; backup gerenciado, watermark completo e stores externos faltam. |
| IMPL-09 | PARTIAL | Health, readiness, métricas e logs existem; collector, alertas e SLO de produção faltam. |
| IMPL-10 | PARTIAL | Offline/fail-closed existe; cache autorizado, lease e purga auditada faltam. |
| IMPL-11 | NOT_RUN | O critic não executou inspeção visual nem cross-browser nesta rodada. |
| IMPL-12 | PARTIAL | Código, bar e docs apontam ao escopo; o relatório não foi persistido pelo critic. |

## Achados

1. **BLOCKER — autorização de produção incompleta.** `apps/api/src/server.ts` e `packages/domain/src/index.ts` derivam contexto de headers/assignments locais; ainda falta PDP ABAC completo. Isso impede alegar autorização contextual corporativa para dados reais.
2. **HIGH — RLS de paciente/tutor permitia leitura sem unidade.** As policies em `015`/`017` tinham caminho `cvg_request_unit() is null`; a API normalmente exigia contexto, mas um consumidor SQL direto poderia obter leitura organizacional. O lead corrigiu o achado com `018_require_patient_context.sql`, alinhou o PDP em memória e adicionou asserção negativa; `verify:postgres` passou depois da correção.
3. **BLOCKER — persistência/recovery operacional permanecem sintéticos.** O modo local padrão é memória; o adapter PostgreSQL e o restore são uma fatia sintética. Não há prova de HA, RPO/RTO ou operação gerenciada.
4. **HIGH — integrações reais não existem.** Pagamento, mensageria e calendário continuam bloqueados/`DISABLED`; não há settlement, entrega ou reconciliação externa real.
5. **MEDIUM — UI é parcialmente demonstrativa.** Várias ações ainda comunicam bloqueio em vez de executar jornadas completas; offline continua sem cache autorizado.

## Veredito

**AAA: NÃO ELEGÍVEL — FAIL.** Há evidência local sintética plausível, mas não certificação independente de produção. O achado de RLS sem unidade foi corrigido após o parecer e revalidado; os demais bloqueadores permanecem abertos.
