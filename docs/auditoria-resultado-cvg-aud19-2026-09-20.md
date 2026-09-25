# Reauditoria do resultado CVG-AUD19 — 2026-09-20

> **Histórico:** esta auditoria originou o CVG-AUD20. O estado corrente foi reavaliado em [Reauditoria do resultado CVG-AUD20](auditoria-resultado-cvg-aud20-2026-09-20.md); use o [roadmap AUD21](roadmap-melhorias-cvg-aud21-2026-09-20.md) e o [backlog AUD21](backlog-melhorias-cvg-aud21-2026-09-20.md) para retomada.

**Estado:** FINALIZADA  
**Objeto:** worktree local derivado de `c990914148a8f375082cd12bbdb2ad20cfe1900f`  
**Veredito:** `FAIL / REJECT` para promoção  
**Nota indicativa:** **57/100**  
**Qualidade global:** `AAA_NOT_PROVEN`

Documentos derivados: [roadmap AUD20](roadmap-melhorias-cvg-aud20-2026-09-20.md) e [backlog AUD20](backlog-melhorias-cvg-aud20-2026-09-20.md).

## 1. Decisão executiva

O relatório de encerramento do CVG-AUD19 é materialmente otimista. A base melhorou e a regressão unitária está verde, mas vários itens marcados como concluídos não sustentam esse estado. Há contraprovas executáveis em limites de segurança e consistência: IDs semanticamente divergentes chegam ao executor de ferramenta, uma sessão terminal continua gravável, o restore aceita fence histórico por uma transição disponível ao papel de runtime, tabelas futuras herdam DML amplo e o readiness aceita um banco sem as migrations 040/041.

No frontend, os dois testes Playwright adicionados para 018–020 falham. A busca de pacientes fica presa em loading sob `React.StrictMode`, e o registro de contratos aceita payloads semanticamente inválidos que a UI consome. No worker, o sinal de cancelamento não atravessa o relay de outbox até o provider.

O plano de controle também não permite certificar o fechamento: receipts AUD19 têm horários futuros em relação à coleta, omitem fingerprint reproduzível e convivem com ponteiros divergentes. `verify:docs-provenance` passa para um worktree arbitrariamente sujo, enquanto `verify:static` falha. O estado correto é:

- implementação local: **PARTIAL, com regressões altas**;
- evidência: **não confiável para fechamento**;
- produção/Triplo AAA: **REJECT / NOT_PROVEN**;
- próxima ação: iniciar `CVG-AUD20-001`, não `CVG-AUD19-024` isoladamente.

A nota é uma leitura dos 22 critérios da barra v4 e não é diretamente comparável aos 75/100 anteriores: esta rodada incluiu contraprovas novas e degradou a confiança das evidências AUD19.

## 2. Escopo, identidade e método

O `HEAD` permaneceu em `c990914148a8f375082cd12bbdb2ad20cfe1900f`, mas o objeto real é um worktree com dezenas de arquivos modificados e não rastreados. O fingerprint inicial foi `cecc6a7c7ecf7c093ede9bc454d3114e8a0d9e56c53f340529ddf8448cfed498`; verificadores mutantes alteraram artefatos durante a sessão, portanto esse valor identifica apenas o início da coleta e não um release.

Três críticos frescos cobriram backend/dados/workers, frontend/ops e evidência/control plane. As conclusões foram reconciliadas com inspeção direta e execuções do agente principal. O relatório fornecido não foi aceito como prova por si só.

| Revisão | Independência | Mutation sentinel | Uso nesta auditoria |
|---|---|---|---|
| `CRIT-AUD20-BACKEND-DATA` | I1; contexto fresco; não leu críticas históricas | Inconclusivo por processos concorrentes | Contraprovas foram rechecadas pelo agente principal. |
| `CRIT-AUD20-FRONTEND-OPS` | I1; contexto fresco; não leu críticas históricas | Inválido após gate mutante; fonte não editada | Achados de código e E2E foram rechecados; não conta como atestado de imutabilidade. |
| `CRIT-AUD20-EVIDENCE-CONTROL` | I1; contexto fresco; não leu críticas históricas | Inconclusivo global; arquivos focais estáveis | Sustenta achados de timestamps, receipts e ponteiros, não aprova o candidato. |

## 3. Achados bloqueadores

### AUD20-001 — Divergência de identidade é aceita

**Severidade:** ALTA  
**Reabre:** CVG-AUD19-002, 004 e 006

Quando `resourceId` nomeia um paciente e `encounterId` nomeia um atendimento desse paciente, o resolver troca o alvo por atendimento em vez de responder `DIVERGENT`. O executor conclui `cvg.clinical.draft`. A contraprova retornou `acceptedDivergentIds=true` e `status=COMPLETED`.

Evidência: [`packages/domain/src/index.ts`](../packages/domain/src/index.ts#L1216) e [`apps/api/src/agent-tool-executor.ts`](../apps/api/src/agent-tool-executor.ts#L91).

### AUD20-002 — Sessões terminais continuam graváveis

**Severidade:** ALTA  
**Reabre:** CVG-AUD19-008 e 011

O guard em memória e os inserts PostgreSQL verificam fence e TTL, mas não exigem `status='ACTIVE'`. Uma contraprova completou a sessão e anexou novo turno com o mesmo fence.

Evidência: [`packages/agent-session/src/index.ts`](../packages/agent-session/src/index.ts#L278), [`packages/agent-session/src/index.ts`](../packages/agent-session/src/index.ts#L378) e [`packages/agent-session/src/index.ts`](../packages/agent-session/src/index.ts#L466).

### AUD20-003 — Restore contorna o fence no banco

**Severidade:** ALTA  
**Reabre:** CVG-AUD19-011 e 012

A migration 041 permite fence histórico em `QUARANTINED_RESTORE`, e `cvg_runtime` pode atualizar `agent_sessions`. No banco descartável, o papel alterou o estado e inseriu um turno com fence `0` quando o autoritativo era `2`; a transação foi revertida depois da contraprova.

Evidência: [`db/migrations/040_runtime_least_privilege.sql`](../db/migrations/040_runtime_least_privilege.sql#L14) e [`db/migrations/041_agent_restore_fence_guard.sql`](../db/migrations/041_agent_restore_fence_guard.sql#L14).

### AUD20-004 — Default privileges mantêm DML amplo

**Severidade:** ALTA  
**Reabre:** CVG-AUD19-012

A migration 022 concedeu `SELECT, INSERT, UPDATE, DELETE` por default ao runtime. A 040 revoga tabelas atuais, mas não o default. Uma tabela criada após as migrations concedeu as quatro operações. Os drills de restore/worker também reconcedem DML amplo.

Evidência: [`db/migrations/022_runtime_database_role.sql`](../db/migrations/022_runtime_database_role.sql#L14), [`db/migrations/040_runtime_least_privilege.sql`](../db/migrations/040_runtime_least_privilege.sql#L8), [`scripts/verify-postgres-restore.ts`](../scripts/verify-postgres-restore.ts#L73) e [`scripts/verify-postgres-worker-effects.ts`](../scripts/verify-postgres-worker-effects.ts#L71).

### AUD20-005 — Readiness aceita schema incompleto

**Severidade:** ALTA  
**Reabre:** CVG-AUD19-009

Depois das migrations 040/041, `assertSchema()` ainda considera 039 suficiente. Um banco sem least privilege e sem o guard de restore pode ficar ready.

Evidência: [`packages/persistence/src/index.ts`](../packages/persistence/src/index.ts#L3275) e [`scripts/verify-postgres-schema-gates.ts`](../scripts/verify-postgres-schema-gates.ts#L36).

### AUD20-006 — Gate universal de PDP está vermelho

**Severidade:** ALTA  
**Reabre:** CVG-AUD19-004 e 006

`npm run verify:pdp-universal` falhou para `POST /api/v1/ai/turns` e `POST /api/v1/ai/approvals/:id/retry`: o analisador observou `none` depois da introdução de `runWithRequestFork`.

### AUD20-007 — Cancelamento não chega ao provider

**Severidade:** ALTA  
**Reabre:** CVG-AUD19-016 e 017

O worker aborta o controller, mas `OutboxDispatchContext` não possui `AbortSignal`, e `MessagingOutboxSink` chama o provider sem sinal. Um envio bloqueado pode continuar depois de timeout ou `stop()`.

Evidência: [`apps/worker/src/worker.ts`](../apps/worker/src/worker.ts#L397) e [`packages/integrations/src/index.ts`](../packages/integrations/src/index.ts#L941).

### AUD20-008 — Busca trava sob StrictMode

**Severidade:** ALTA  
**Reabre:** CVG-AUD19-020

O cleanup define `mounted.current=false`, mas a segunda execução do efeito não restaura o valor. Resposta, erro e `finally` são descartados. A regressão Playwright de sequência invertida falhou.

Evidência: [`apps/web/src/main.tsx`](../apps/web/src/main.tsx#L7), [`apps/web/src/features/patients/Patients.tsx`](../apps/web/src/features/patients/Patients.tsx#L89) e [`tests/e2e/app.spec.ts`](../tests/e2e/app.spec.ts#L1680).

### AUD20-009 — Contratos frontend não são semânticos

**Severidade:** ALTA  
**Reabre:** CVG-AUD19-018

O helper usa `.passthrough()`, enums relevantes são `string` e valores financeiros/versões não têm invariantes. Payload de paciente com `breed: 42`, `guardian: "malformed"` e status arbitrário foi aceito. Há também finance duplicado e a rota espúria `POST /knowledge/:id/:id`.

Evidência: [`apps/web/src/api/validation.ts`](../apps/web/src/api/validation.ts#L43) e [`tests/unit/contracts.test.ts`](../tests/unit/contracts.test.ts#L148).

### AUD20-010 — Proveniência AUD19 não vincula os bytes

**Severidade:** ALTA  
**Reabre:** evidência de 009–020; 024/025 seguem abertos

Nove receipts possuem timestamps futuros e omitem ambiente, exit status, observed-at, freshness, hashes e fingerprint. `verify:docs-provenance` aceita qualquer worktree sujo; o snapshot exclui não rastreados; `verify:static` falha. O verificador externo escreve artefato e retorna `0` quando faltam credenciais.

Evidência: [`.agent/verification.jsonl`](../.agent/verification.jsonl), [`scripts/verify-docs-provenance.ts`](../scripts/verify-docs-provenance.ts), [`scripts/verify-evidence-snapshot.ts`](../scripts/verify-evidence-snapshot.ts) e [`scripts/verify-state-of-art-external.ts`](../scripts/verify-state-of-art-external.ts#L40).

### AUD20-011 — Recovery e matriz worker provam menos que o contrato

**Severidade:** MÉDIA  
**Reabre:** CVG-AUD19-010, 014 e 017

O import não recalcula o digest semântico de cada checkpoint nem cruza todas as referências. A matriz worker não cobre crash antes/depois do efeito e restart; o caso poison vira `OUTCOME_UNKNOWN` na primeira tentativa. O isolamento por request não cobre todas as fronteiras transacionais declaradas.

### AUD20-012 — TTL PostgreSQL é instável

**Severidade:** MÉDIA  
**Reabre:** evidência de CVG-AUD19-003 e 008

`verify:postgres` falhou na primeira execução porque o lease de 80 ms venceu durante roundtrips e passou na reexecução imediata. O contrato depende de tempo de parede e não prova duas instâncias independentes.

### AUD20-013 — Error boundary existe sem prova de aceite

**Severidade:** MÉDIA  
**Reabre:** CVG-AUD19-019

Nenhum teste injeta falha de render. `componentDidCatch` não publica telemetria e o correlation ID é o último valor global, não um valor ligado ao erro capturado. O E2E rotulado 018/019 testa apenas erro local e falha.

### AUD20-014 — Observabilidade, performance e a11y incompletas

**Severidade:** MÉDIA, com efeito bloqueador

Não há drill firing→receiver→resolved do Alertmanager. Logs seguem em memória/debug, sem retenção e redaction known-bad. Não existem ESLint/React Hooks/jsx-a11y reais, budget executável, CWV/Lighthouse ou cobertura suficiente de contraste. O build passou com chunk JS de 538,44 kB. WebKit está bloqueado no host por biblioteca nativa ausente.

## 4. Revisão do estado CVG-AUD19

| Itens | Estado após auditoria | Motivo resumido |
|---|---|---|
| 001, 005, 007, 013, 015 | **IMPLEMENTED_UNVERIFIED** | Nenhuma contraprova neste recorte, mas os receipts AUD19 não atendem à política de evidência. |
| 002, 004, 006 | **REOPEN** | Divergência de alvo e gate PDP. |
| 003 | **REOPEN/EVIDENCE** | TTL flaky e prova multi-instância incompleta. |
| 008 | **REOPEN** | Escrita pós-terminal. |
| 009 | **REOPEN** | Readiness aceita 039. |
| 010 | **REOPEN** | Digest/referências incompletos. |
| 011, 012 | **REOPEN** | Fence de restore e default privileges. |
| 014 | **REOPEN/EVIDENCE** | Matriz de crash incompleta. |
| 016, 017 | **REOPEN** | Cancelamento e fault matrix incompletos. |
| 018, 020 | **REOPEN** | Known-bad aceito e E2Es falham. |
| 019 | **REOPEN/EVIDENCE** | Boundary não exercitado/observável. |
| 021 | **PARTIAL** | Wiring estático sem entrega real. |
| 022 | **TODO local** | Implementação é acionável; não é bloqueio externo integral. |
| 023 | **PARTIAL** | Demais gates de qualidade ausentes. |
| 024 | **IN_PROGRESS local** | Fingerprint/receipts podem ser implementados agora. |
| 025 | **READY** | Exit code é correção local. |
| 026, 029 | **BLOCKED_BY_DEPENDENCIES** | Dependências ainda abertas. |
| 027 | **PARTIAL/TODO** | Parte local acionável; recovery gerenciado externo. |
| 028 | **BLOCKED_EXTERNAL** | Staging/providers/autoridades ausentes. |
| 030 | **BLOCKED_HUMAN** | Decisão humana posterior à evidência. |

## 5. Verificações observadas

| Verificação | Resultado | Leitura correta |
|---|---|---|
| `git diff --check` | PASS | Não valida comportamento. |
| `npm run typecheck` | PASS | Escopo TypeScript configurado. |
| `npm run lint` | PASS, 229 arquivos | Scanner textual; não ESLint. |
| `npm test` | 543; 542 pass; 1 skip | Não detecta as contraprovas. |
| `npm run build` | PASS com warning | Chunk principal 538,44 kB. |
| `verify:architecture` | PASS | Gate estrutural local. |
| `verify:pdp-universal` | **FAIL** | Duas rotas IA não reconhecidas. |
| `verify:agent-security`, `verify:agent-runtime`, `verify:worker-runtime` | PASS | Recortes locais; não compensam known-bad. |
| Playwright AUD19 018–020 / Chromium wide | **2 FAIL** | Loading permanente/mensagem ausente. |
| `verify:postgres` | **FAIL e depois PASS** | Flaky por TTL de parede. |
| concurrency, isolation, restore, worker-effects | PASS | Cobertura parcial descrita nos achados. |
| `verify:postgres:schema-gates` | PASS do contrato atual | Contrato incorreto ao aceitar 039. |
| `verify:static` | **FAIL** | SHA/janela divergentes. |
| `verify:docs-provenance` | PASS falso-verde | Não vincula bytes sujos. |
| `verify:claims` | PASS | Declara `AAA_NOT_PROVEN`. |
| `verify:alertmanager` | FAIL sem webhook | Autoridade externa ausente. |
| `verify:production` / `verify:triplo-aaa` | NOT_COMPLETED | Não contam como evidência. |

## 6. Scorecard indicativo

| Critério | Nota | Meta | Estado resumido |
|---|---:|---:|---|
| Arquitetura | 80 | 97 | Guard e restore divergem do desenho. |
| Integridade de domínio | 70 | 97 | Identidade divergente e pós-terminal. |
| Segurança | 55 | 97 | Bypass de fence e grants amplos. |
| Autenticação | 92 | 97 | Sem contraprova; exact-subject ausente. |
| Autorização | 65 | 97 | Resolução de alvo falha. |
| PDP/políticas | 58 | 97 | Gate obrigatório falha. |
| Gateway de ferramentas | 60 | 97 | Tool aceita IDs divergentes. |
| Banco de dados | 50 | 97 | Readiness, fence e privilégios falhos. |
| Confiabilidade | 52 | 97 | TTL flaky e cancelamento incompleto. |
| Workers | 54 | 96 | Cancelamento/fault matrix incompletos. |
| DeepSeek | 70 | 95 | Local; autoridade real ausente. |
| Governança de IA | 60 | 97 | Alvo/fence não fecham. |
| Integrações externas | 60 | 95 | Vertical real bloqueada. |
| Frontend | 45 | 95 | E2Es falham; schemas permissivos. |
| Acessibilidade | 52 | 95 | Boundary/WebKit/AT/zoom pendentes. |
| Testes | 60 | 97 | Known-bad passam; flakiness. |
| Observabilidade | 40 | 95 | Alertas sem drill; logs voláteis. |
| Performance | 45 | 95 | Sem budget/CWV. |
| Recuperação | 50 | 97 | Autoridade/digests insuficientes. |
| DevOps/CI | 45 | 96 | Proveniência não vincula candidato. |
| Supply chain | 70 | 95 | Artefato promovível não provado. |
| Prontidão para produção | 25 | 95 | Altos locais e externos pendentes. |

Média: **57/100**. Achados altos impedem aprovação independentemente da média.

## 7. Limites e retomada

- PostgreSQL foi local/descartável; não representa staging.
- Nenhum provider, dado, credencial, deploy, commit, push ou release real foi usado.
- WebKit, AT, zoom, staging, carga representativa, chaos distribuído e RTO/RPO gerenciado permanecem `NOT_RUN` ou `BLOCKED_EXTERNAL`.
- Verificadores mutantes impediram atestado formal de imutabilidade do worktree.
- Os documentos AUD19 ficam preservados como histórico, mas seus `DONE` não devem controlar a execução futura.

A retomada deve seguir o [roadmap](roadmap-melhorias-cvg-aud20-2026-09-20.md) e o [backlog](backlog-melhorias-cvg-aud20-2026-09-20.md). Promoção exige fechar as contraprovas altas, executar o conjunto local duas vezes no mesmo objeto, obter evidência externa same-SHA, crítica independente e decisão humana. O fechamento integral ainda exige F0–F38 em `PASS`, zero hard blocker, nota geral ≥97 e todas as dimensões nos thresholds congelados de 95–97.
