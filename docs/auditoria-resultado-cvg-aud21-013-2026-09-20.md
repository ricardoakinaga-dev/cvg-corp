# Auditoria do resultado CVG-AUD21-013

**Data:** 2026-09-20  
**Objeto:** worktree em `c990914148a8f375082cd12bbdb2ad20cfe1900f`, com alterações locais não commitadas  
**Barra preservada:** `.gauntlet/bar-v4.json`, SHA-256 `2093461a8d6103641a555ad45371dde4649e5f144c32260b80244e219fa70697`  
**Fingerprint antes da crítica:** `c9249fd2bbddf7cddcd06dd06b44cc9aca71e56633f397a2ba41a65a9e65ed06`  
**Autorização:** auditoria e documentação; nenhum commit, push, deploy ou uso de ambiente/dados reais

## Veredito

`PARTIAL / REJECT / AAA_NOT_PROVEN`.

O trabalho de recovery é material e o drill PostgreSQL real passa para o corpus exercitado, mas `CVG-AUD21-013` não está fechado. Dois bundles re-hashados semanticamente inválidos ainda são aceitos, a validação semântica não é uma pré-condição estrutural do método público de commit/restore e o control plane declara verde apesar de divergência observável.

O resultado correto para AUD21-013 é `REOPEN`. O código e os receipts existentes são progresso local reutilizável, não evidência suficiente de conclusão.

## Escopo e métodos

- Inspeção do validator, projeção de restore, migration 044, harness PostgreSQL, testes e receipts.
- Known-bads diretos sobre o validator e sobre a entrada pública `PostgresPersistence.commit`.
- PostgreSQL 16 descartável, migrations 001–044, runtime e schema owner separados.
- Reexecução de typecheck, lint, testes, build, schema manifest, diff e integridade JSON/JSONL.
- Três críticos I1 de contexto fresco, somente leitura: recovery/dados, control plane/evidência e evolução do backlog.
- Mutation sentinel dos críticos: `MATCH`, fingerprint `c9249fd2...e65ed06`.

## O que foi confirmado

| Claim | Resultado | Evidência e limite |
|---|---|---|
| Digest de checkpoint | PASS no corpus atual | Schema+payload divergente foi rejeitado. |
| `session.checkpointDigest` | PASS no corpus atual | Digest diferente do último checkpoint foi rejeitado. |
| Actor inexistente, gap de turn e fence futuro | PASS no corpus atual | Known-bads do harness foram rejeitados. |
| Restore conhecido-bom | PASS local real | PostgreSQL 16 restaurou `revision=1`, `QUARANTINED`; lease/login/readiness permaneceram bloqueados. |
| Falha tardia | PASS com limitação | A transação fez rollback e o bundle exportado permaneceu igual; o oracle não consulta diretamente `cvg_event_journal`. |
| Origem | PASS | O source bundle permaneceu inalterado. |
| Regressão | PASS | 560 testes: 559 pass, 0 fail, 1 skip; typecheck, lint e build com exit 0. |
| Schema/diff/JSON | PASS | Manifesto 044, `git diff --check` e parsing JSON/JSONL passaram. |
| Release/AAA | NÃO PROVADO | Sem candidate fingerprint, staging, WebKit/AT completo, evidência externa ou autoridade humana. |

## Achados

### AUD22-F01 — validator aceita referência de usage órfã

**Severidade:** alta  
**Confiança:** alta  
**Estado:** confirmado

Um turn pode conter `usageRecordId` não nulo ausente de `usageRecords`. O validator recebe o ledger de usage, mas `validateAgentRuntimeSemantics` não o usa e PostgreSQL não possui FK para esse campo.

Known-bad re-hashado executado contra o source corrente:

```text
dangling_usage_reference=ACCEPTED
```

**Fechamento:** validar a referência lógica, organization/escopo e compatibilidade do registro de usage; adicionar known-bad unitário e PostgreSQL.

### AUD22-F02 — lease com fence zero é aceito pelo bundle

**Severidade:** alta  
**Confiança:** alta  
**Estado:** confirmado

O parser comum permite fence `0` para leases. A verificação semântica compara apenas igualdade com a sessão, enquanto a tabela exige fence `>= 1`.

```text
zero_fence_lease=ACCEPTED
```

**Fechamento:** limite específico `>=1`, matriz de lease/session mismatch, lease em sessão terminal e datas inválidas.

### AUD22-F03 — validação semântica não está acoplada ao entrypoint de restore

**Severidade:** alta  
**Confiança:** alta  
**Estado:** confirmado por boundary fake; PostgreSQL cross-tenant direto não executado

`PostgresPersistence.commit` aceita arrays `recoveredAgent*` e chama diretamente `projectRecoveredAgentRuntime`. Ele não recebe o bundle completo nem executa `assertRestorableRecoveryBundle`/`validateRecoveryBundle` antes do DML. Um probe com pool controlado aceitou sessão com actor ausente e chegou a `COMMIT`.

Isso não prova que toda corrupção venceria constraints de um PostgreSQL real; prova que a garantia depende de todo chamador lembrar de validar fora do entrypoint.

**Fechamento:** um único comando de restore recebe o bundle completo, valida forma+semântica+migration fingerprint dentro de sua fronteira e só então projeta, na mesma transação.

### AUD22-F04 — control plane continua false-green

**Severidade:** crítica  
**Confiança:** alta  
**Estado:** confirmado

- O marcador inicial do ExecPlan aponta `CVG-AUD21-013:SEMANTIC-RECOVERY`.
- State, backlog, final do ExecPlan e logs apontam `CVG-AUD21-014:SCHEMA-REQUALIFICATION`.
- `npm run verify:control-plane` ainda retorna `CONTROL_PLANE_VERIFIED`.
- `state.updated_at` (`15:39`) é anterior ao event/receipt apontado como último (`15:41:16`).
- `CVG-AUD21-001` permanece `PARTIAL` com next action 008 já `DONE`; itens 002–013 dependem de 001 e foram marcados `DONE`.

O verificador testa existência do arquivo de plano, não seu conteúdo. Também ignora DAG, evidence refs, last event, timestamps relativos, checkpoint e fingerprint; a validação de vocabulário nem inclui o programa AUD21.

### AUD22-F05 — receipts `DONE` não são exact-subject

**Severidade:** alta  
**Confiança:** alta  
**Estado:** confirmado

O backlog documental exige fingerprint exato e o roadmap proíbe `DONE` antes da convergência. Mesmo assim, 002–013 estão `DONE` com `candidate_fingerprint:null`. `VER-CVG-AUD21-013-002` não possui identidade completa do artefato nem freshness; `013-001` se declara `CURRENT` enquanto registra candidato não congelado.

**Correção de estado:** preservar como `IMPLEMENTED_UNVERIFIED`, exceto 011 e 013, que precisam ser `REOPEN` por contraprovas funcionais.

### AUD22-F06 — harnesses ainda ampliam privilégios

**Severidade:** alta  
**Confiança:** alta  
**Estado:** confirmado

Ainda existem `GRANT USAGE, SELECT ON ALL SEQUENCES` em:

- `scripts/db.ts`;
- `scripts/verify-postgres-restore.ts`;
- `scripts/verify-postgres-worker-effects.ts`.

Isso contradiz o aceite de AUD21-011 e torna a prova de least privilege dependente de privilégios auxiliares do harness.

### AUD22-F07 — oracle de rollback não cobre diretamente o journal

**Severidade:** média  
**Confiança:** alta  
**Estado:** lacuna de harness

O rollback tardio compara o bundle exportado, mas o commit tenta inserir `cvg_event_journal` antes da validação tardia de audit. A transação PostgreSQL deve reverter ambos; a prova deve contar/hashear diretamente snapshot, journal, audit, receipts e ledgers antes/depois.

### AUD22-F08 — documentação estava defasada; qualificação local permanece incompleta

**Severidade:** alta  
**Confiança:** alta  
**Estado:** documentação corrigida neste pacote; gaps de qualificação abertos

Na entrada da auditoria, o README e o estado da implementação ainda terminavam em AUD21-002; ambos foram atualizados para apontar este pacote AUD22. Os demais gaps permanecem: o lint continua sendo scanner próprio, o build produz um chunk JS de `572,88 kB`, alertas não foram entregues ponta a ponta e logs continuam sem backend durável. Build/Playwright/gates escrevem em `dist`, `test-results`, `artifacts` e `.agent`; a separação candidato/evidência precisa existir antes de duas runs no mesmo fingerprint.

## Estado corrigido do programa AUD21

| Itens | Estado auditado | Motivo |
|---|---|---|
| 001 | REOPEN | Control plane false-green e DAG incoerente. |
| 002–010 | IMPLEMENTED_UNVERIFIED | Implementação local preservada; falta receipt exact-subject no candidato final. |
| 011 | REOPEN | Grants auxiliares continuam nos harnesses. |
| 012 | IMPLEMENTED_UNVERIFIED | Prova local preservada; requer requalificação exact-subject. |
| 013 | REOPEN | Known-bads `usageRecordId` órfão e lease fence zero aceitos; entrada não sela validação. |
| 014 | BLOCKED_BY_DEPENDENCIES | Deve ocorrer depois do recovery, privilégios e storage finais. |
| 015–020 | READY | Trabalho local ainda não concluído. |
| 021 | PARTIAL | Whitespace fechado; gates não mutantes pendentes. |
| 022,027 | BLOCKED_BY_DEPENDENCIES | Qualificação/final técnico ainda impossíveis. |
| 023–026 | BLOCKED_EXTERNAL | Autoridades e ambientes externos ausentes. |
| 028 | BLOCKED_HUMAN | F38 não pode ser autoatribuído. |

Esta tabela é a conclusão documental da auditoria. O `.agent` continua divergente até a futura tarefa append-only de reconciliação.

## Verificações desta auditoria

| Procedimento | Resultado |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS; scanner próprio, 236 fontes |
| `npm test` | PASS; 560 total, 559 pass, 1 skip |
| `npm run build` | PASS com warning de chunk JS `572,88 kB` |
| `npm run verify:schema-manifest` | PASS; latest 044 |
| `npm run verify:diff` | PASS |
| parsing JSON/JSONL | PASS |
| `npm run verify:control-plane` | INVALID/false-green: exit 0 apesar da divergência 013/014 |
| `verify:postgres` em PostgreSQL 16 descartável | PASS no corpus atual |
| `verify:postgres:restore` em PostgreSQL 16 descartável | PASS no corpus atual |
| known-bad zero-fence lease | FAIL do produto: aceito |
| known-bad dangling usage | FAIL do produto: aceito |
| WebKit, staging, production-like, providers reais, AT, CI/supply chain e F38 | NOT_RUN/BLOCKED |

Duas tentativas de preparação do banco falharam antes da prova: uma por snapshot ausente e outra por variáveis de provisionamento rejeitadas pelo allowlist runtime. A terceira usou a sequência correta `migrate → verify:postgres → verify:postgres:restore` e passou. O container `cvg-aud22-audit-pg` foi removido. Os containers antigos `cvg-corp-aud19-pg` e `aud19-pg` permanecem ativos e não foram alterados por esta auditoria.

## Próxima ação

Executar `CVG-AUD22-001`: reconciliar o control plane de forma append-only, reclassificar os status acima e fazer o verificador rejeitar a divergência real antes de iniciar novas mudanças de produto.
