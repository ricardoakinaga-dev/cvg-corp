# ADR 044 — Escopo de escrita para registros de controle

## Problema e invariante

As políticas de leitura de `audit_records`, `command_receipts` e
`role_assignments` já filtram organização, unidade e workspace. As políticas de
escrita dessas três tabelas ainda verificavam apenas a organização. A
invariante é que o escopo gravado na linha corresponda ao contexto PostgreSQL
da transação, usando o helper `cvg_request_dml_scope_allows` existente.

## Evidência atual e desconhecidos

Migrations 029, 010 e 033 já aplicam a mesma regra de escrita às demais
famílias escopadas, então alterar migrations antigas quebraria a cadeia de
checksums sem necessidade. `commitInternal` projeta múltiplos escopos em uma
transação, `projectIdentity` projeta vínculos de papel de vários escopos, e o
ciclo de vida de `command_receipts` possui transições diretas. A compatibilidade
com um ambiente gerenciado e seus dados reais continua `NOT_RUN`.

## Decisão

- Adicionar a migration forward-only `049_scoped_control_plane_dml_rls.sql`
  para aplicar a regra DML existente às três tabelas.
- Definir o GUC de unidade/workspace por registro nas projeções em lote de
  auditoria, receipts e vínculos de papel.
- Propagar o escopo do receipt nas transições de claim e reconciliação, e o
  escopo do evento no append de auditoria do worker.
- Propagar o escopo da auditoria no commit de ativação break-glass e rejeitar
  combinações incompatíveis entre o escopo do grant e o escopo auditado.
- Manter as políticas de leitura e os formatos dos registros. Não alterar nem
  reescrever migrations aplicadas.

## Alternativas rejeitadas

- Confiar somente nos filtros de aplicação mantém a divergência entre a linha
  persistida e o contexto da conexão.
- Usar uma transação por registro amplia a superfície de lock e altera a
  atomicidade dos commits sem necessidade; GUCs `SET LOCAL` preservam o commit
  atômico existente.
- Relaxar a política de leitura para compensar a escrita ampla não resolve a
  autorização de mutação.

## Falha, compatibilidade e recuperação

A migration não move nem remove dados. Um mismatch de escopo deve falhar com
RLS e provocar rollback da transação que já coordena snapshot, auditoria e
receipt. Se qualquer escritor legítimo omitir o contexto, a prova PostgreSQL
deve falhar antes de promover este resultado; a correção é propagar o escopo e
reexecutar a migração em um banco descartável. Nenhum cutover ou promoção
externa fica autorizado por esta decisão.

## Verificação e limites

O verificador PostgreSQL comprova leitura e inserção no escopo correto, e oculta
leituras e rejeita escrita cross-tenant, cross-unit e cross-workspace nas três
tabelas. Um papel descartável sem `BYPASSRLS`, com privilégios DML explícitos,
exercita `UPDATE` e `DELETE`: as mutações de `command_receipts` e
`role_assignments` funcionam no escopo correto e afetam zero linhas nos escopos
errados; `audit_records` permanece append-only. O fluxo real de ativação
break-glass também grava e lê uma auditoria workspace-scoped no banco
descartável. A evidência local cobre apenas estas três políticas; não prova
isolamento de todos os 24 slices `SNAPSHOT_PRIMARY`, cutover, restore
pós-cutover, staging ou aceitação humana.
