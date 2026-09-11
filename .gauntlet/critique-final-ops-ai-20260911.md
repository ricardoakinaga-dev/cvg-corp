# Critic final — operações, DeepSeek e AI governance

Data: 2026-09-11  
Critic: `critic_final_ops_ai` (fresh child, sem contexto de Builder; independência I1)  
Modo: auditoria read-only. O único artefato criado por esta rodada é este relatório; nenhum código, teste, configuração ou evidência existente foi editado.

## Decisão

Veredito global: **FAIL**.

Há contratos locais úteis e vários caminhos fail-closed, mas a barra v4 exige evidência executada no artefato real. Os gates externos continuam ausentes: o resultado correto é preservar `BLOCKED_EXTERNAL` e `NOT_RUN`, e não convertê-los em aprovação por fixtures, loopback ou documentação.

Identidade auditada:

- HEAD: `e43b3b0032aafb9d17563b1fce00fbae88ee0d51`.
- Prompt: `docs/prompt-final-operational-proof-2026-09-10.txt`, SHA-256 `39dfbb610267b61854b972bf8513f6562b0ee374aa308f7a79b38d21f2cdeae3`.
- Barra: `.gauntlet/bar-v4.json`, SHA-256 `c637440d9cba535351f9c7f40dffef168229f1147027bd05b428c7c8f88a8571`.
- Manifesto: `artifacts/operational-proof/triple-aaa-evidence.json`, `sourceSha` igual ao HEAD, `worktree: MODIFIED`, `ciSha: null`, `artifactSha: null`, `status: AAA_NOT_PROVEN`.

## Resultado por área

| Área | Estado da evidência | Julgamento do critic |
|---|---|---|
| DeepSeek / AI governance | Contrato ACP, HMAC, schemas, approval/replay e fixtures locais; modelo real, governance durável, egress, usage e Tool Gateway/PDP em produção não executados | `PASS_WITH_LIMITATIONS`; gate `BLOCKED_EXTERNAL` |
| Provider externo | Loopback/sandbox e reconciliação sintética; provider, callback e receipt externos não executados | `PASS_WITH_LIMITATIONS`; gate `BLOCKED_EXTERNAL` |
| Workers / backpressure | Policies tipadas, leases/fences, budgets, bulkheads, quarentena e saturação local verificadas; multi-instância, pool real, fairness, DLQ/redrive e SLO de backlog não provados | `PASS_WITH_LIMITATIONS` |
| Observabilidade | OTLP/redaction, Prometheus, dashboards e alert rules estruturais; Collector, dispatch Alertmanager, correlação em staging e SLO medido não executados | `PASS_WITH_LIMITATIONS`; gate `NOT_RUN` |
| Load / chaos / recovery | Contratos e fixtures locais; workload production-like, injeção de falha, restore operacional, RTO/RPO e backup gerenciado não executados | `FAIL` para os gates obrigatórios; `NOT_RUN`/`BLOCKED_EXTERNAL` preservados |
| Runbooks | 12 contratos e fixtures locais passam; os sete exercícios live da Fase 35 não foram executados | `PASS_WITH_LIMITATIONS`; execução live `NOT_RUN` |
| Promoção / revisão | Scorecard sem notas, worktree modificado, bundle externo, CI same-SHA, critics aprovadores e aprovação humana ausentes | `FAIL` |

## Findings

### CRITICAL — F-OPS-AI-001: DeepSeek real e governance operacional continuam ausentes

O prompt exige o caminho CVG API → AgentRuntime → adapter/bridge → Harness/modelo real, além de approval, tool denial/allow, replay, usage e falhas F3–F4. A própria prova registra que nenhum turno real foi executado e que `DeepSeekAcpGovernance` permanece apenas como seam injetável sem implementação production-like ligada ao Tool Gateway/PDP, ledger durável e egress controlado (`docs/deepseek-real-proof.md:3-5,25,33,39-49`). O gate executado confirmou `DEEPSEEK_REAL_BLOCKED_EXTERNAL` (exit 2) por ausência da URL, credenciais, identidade de engine/manifest, contexto e bundle assinado.

Impacto: não há evidência de que um modelo externo possa executar uma tool, pedir aprovação, registrar provenance/usage ou se recuperar sem bypass e sem efeito desconhecido. A barra classifica DeepSeek real como hard blocker (`.gauntlet/bar-v4.json:55-57`).

Aceite: adapter nativo e governance durável no mesmo SHA; execução das 31 operações F3–F4 em endpoint autorizado; bundle externo same-SHA assinado por autoridade independente; replay, cancelamento, timeout, restart, approval replay e `OUTCOME_UNKNOWN` observados.

### CRITICAL — F-OPS-AI-002: provider externo e autoridade de segredo não têm prova vertical

`docs/provider-real-proof.md:3,9` mantém `BLOCKED_EXTERNAL` e exige as 12 etapas appointment → PDP → approval → outbox → worker → provider → receipt → callback → inbox → effect ledger → reconciliation → audit. O documento distingue corretamente o sandbox loopback do provider autorizado real. `npm run verify:provider-real` encerrou `PROVIDER_REAL_BLOCKED_EXTERNAL`; o manifesto mantém `provider: BLOCKED_EXTERNAL` e `secretAuthority: NOT_RUN` (`artifacts/operational-proof/triple-aaa-evidence.json:14-16`).

Impacto: timeout, 429/500, callback duplicado ou resposta perdida podem produzir `OUTCOME_UNKNOWN` sem prova de que o adapter consulta o provider e impede efeito duplicado. Rotação, revogação e indisponibilidade da autoridade de segredo também não foram demonstradas.

Aceite: provider/sandbox externo controlado, Secret Authority autorizado, receipt e callback HMAC redigidos, queryStatus após resposta ambígua, duplicidade/reconciliação e rotação de segredo no mesmo SHA.

### CRITICAL — F-OPS-AI-003: load, chaos, recovery e RTO/RPO são apenas contratos

`docs/load-proof.md:3-12` classifica o workload production-like como `BLOCKED_EXTERNAL`/`SYNTHETIC_ONLY`; `docs/chaos-proof.md:3` mantém chaos real `NOT_RUN`; `docs/recovery-proof-final.md:3,7` aceita somente prova local limitada e registra backup gerenciado, autoridade de chave, cópia adulterada isolada, cron e RTO/RPO como não executados. Os comandos confirmaram `LOAD_EVIDENCE_BLOCKED_EXTERNAL` (exit 2) e staging bloqueado sem qualquer request externo.

Impacto: não há p50/p95/p99, erro/saturação, ou observação de integridade após kill/restart/partição/provider/DeepSeek/secret outage. Restore local e fixtures não estabelecem RTO/RPO nem recuperação operacional. A barra lista PostgreSQL production-like, load, chaos, recovery e RTO/RPO como hard blocker (`.gauntlet/bar-v4.json:57-58`).

Aceite: ambiente isolado production-like com carga 50/100/burst e AI/provider/backlog; drills cronometrados de falha; restore em destino separado; métricas observadas de RTO/RPO, duplicidade, auditoria, outbox, usage e jobs ligadas ao mesmo SHA.

### CRITICAL — F-OPS-AI-004: promoção e revisão não são admissíveis

O manifesto declara `sourceSha` sem `ciSha`/`artifactSha`, `worktree: MODIFIED`, dimensões nulas e `AAA_NOT_PROVEN` (`artifacts/operational-proof/triple-aaa-evidence.json:4-10,53-68,540-568`). A barra exige bundle same-SHA, critics independentes e aprovação humana criptograficamente atestada; esses gates permanecem `NOT_RUN` (`artifacts/operational-proof/triple-aaa-evidence.json:25-34`; `.gauntlet/bar-v4.json:59-64`).

Impacto: mesmo que os contratos locais estejam verdes, não existe identidade de release limpa nem autoridade para converter evidência local em `STATE_OF_THE_ART_CANDIDATE`, `TRIPLE_AAA_CANDIDATE` ou release.

Aceite: commit limpo e artifact imutável, CI e promoção no mesmo SHA, bundle externo fora do checkout, critic final independente com veredito e aprovação humana Ed25519/WebAuthn vinculada ao payload e ao risco residual.

### HIGH — F-OPS-AI-005: workers e backpressure não foram validados no ambiente concorrente alvo

`docs/worker-production-proof.md:3,13,18` mostra handlers/policies, leases, fencing, budgets, bulkheads e quarentena locais, mas declara ausentes PostgreSQL multi-instância, pressão medida do pool, provider/collector, DLQ/redrive operado, fairness por tenant e SLO de backlog. A barra exige F9–F10 e a dimensão `workers` tem limiar 96 (`.gauntlet/bar-v4.json:23,42`). O check `verify:resource-pressure` passou 6/6 controles locais, o que prova o contrato e não o comportamento sob processos/containeres concorrentes.

Impacto: não é possível concluir que claim/fence, heartbeat, budget e backpressure permanecem bounded durante pool saturation, restart e backlog real, nem que quarentena/redrive é operável.

Aceite: duas ou mais instâncias API/worker contra PostgreSQL autorizado, saturação controlada de pool/provider/AI, métricas de backlog/oldest age/fairness, restart/takeover e redrive de poison message observados.

### HIGH — F-OPS-AI-006: observabilidade não foi despachada nem correlacionada em staging

`docs/observability-proof.md:3,9` e `docs/observability-production.md` descrevem OTLP/redaction, métricas, dashboards e alertas, mas mantêm Collector, delivery, dashboards preenchidos, SLO e incidentes de staging como `NOT_RUN`; o Alertmanager depende de `CVG_ALERTMANAGER_WEBHOOK_URL`. As regras locais apenas ligam séries a runbooks. A barra exige F19–F20 e o manifesto mantém `observability: NOT_RUN` (`artifacts/operational-proof/triple-aaa-evidence.json:18-19`).

Impacto: não há prova de que API, PDP, worker, provider, DeepSeek, DB e outbox possam ser diagnosticados durante uma falha, nem que um alerta chega a sink controlado sem bloquear auditoria/transação crítica.

Aceite: stack executada em staging, trace/metric/log redigidos correlacionados por request/correlation/session/tool/job/outbox/provider IDs, alertas disparados e recuperados para API/worker/outbox/provider/DeepSeek/DB, e SLO com janela/denominador/error budget observados.

### HIGH — F-OPS-AI-007: runbooks têm contratos e fixtures, mas não exercícios operacionais

`npm run verify:runbook-execution` passou `RUNBOOK_LOCAL_CONTRACT_VERIFIED controls=12`, e isso é evidência útil de presença/estrutura. Porém `docs/runbooks/database-incident.md:3`, `docs/runbooks/worker-backlog.md:3`, `docs/runbooks/deepseek-harness-outage.md:3`, `docs/runbooks/restore.md:3` e `docs/runbooks/credential-rotation.md:3` marcam serviço real/production-like como `NOT_RUN`; break-glass permanece `BLOCKED` (`docs/runbooks/break-glass.md:3-10`).

Impacto: provider outage, worker backlog, DB outage, DeepSeek outage, restore, secret rotation e break-glass não têm timeline, owner executor, decisão de abort, evidência de recuperação ou RTO/RPO observados. A Fase 35 exige execução; contrato local não satisfaz essa gate.

Aceite: executar os sete cenários em ambiente autorizado, registrar receipt redigida, versão/SHA, sinais antes/depois, ações, abortamento, reconciliação, owner/revisor e resultado.

## Checks e limites

Executados nesta auditoria, sem suíte completa:

- `npm run verify:deepseek-real` → exit 2, `DEEPSEEK_REAL_BLOCKED_EXTERNAL`.
- `npm run verify:provider-real` → exit 2, `PROVIDER_REAL_BLOCKED_EXTERNAL`.
- `npm run verify:load` → exit 2, `LOAD_EVIDENCE_BLOCKED_EXTERNAL`.
- `npm run verify:staging` → exit 2; URL ausente, nenhum request externo; health/readiness `BLOCKED` e demais gates `NOT_RUN`.
- `npm run verify:runbook-execution` → exit 0, `RUNBOOK_LOCAL_CONTRACT_VERIFIED controls=12`.
- `npm run verify:resource-pressure` → exit 0, `RESOURCE_PRESSURE_LOCAL_CONTRACT_VERIFIED controls=6`.
- Inspeção do manifesto, prompt preservado, barra v4, provas e código/seams DeepSeek, provider, worker, ops e runbooks.

Não foram executados: provider/DeepSeek real, staging, collector/Alertmanager, load k6/autocannon, chaos de infra, restore operacional, RTO/RPO, CI same-SHA, revisão independente aprovadora ou aprovação humana. Esses estados permanecem `BLOCKED_EXTERNAL`/`NOT_RUN` no manifesto; não foram tratados como falha de configuração do software nem como PASS.

## Conclusão de independência e mutação

Este é um critic fresh separado do Builder, em nível I1. A inspeção não alterou arquivos de código, testes, configuração ou evidências. A criação deste relatório foi a única escrita autorizada e deve ser considerada ao comparar fingerprints de estado. Não há base para um veredito de produção; o próximo maior gap é a vertical DeepSeek/provider + Secret Authority em um SHA limpo, seguida por staging observável com carga/chaos/recovery e execução live dos runbooks.
