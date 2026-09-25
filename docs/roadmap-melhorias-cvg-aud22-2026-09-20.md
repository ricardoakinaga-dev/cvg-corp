# Roadmap de melhorias — CVG-AUD22

> **SUPERSEDED em 2026-09-20:** este roadmap preserva o planejamento histórico. O estado e a sequência correntes estão no [roadmap CVG-AUD23](roadmap-melhorias-cvg-aud23-2026-09-20.md); não use os ponteiros abaixo para retomada.

**Data-base:** 2026-09-20  
**Origem:** [auditoria do resultado AUD21-013](auditoria-resultado-cvg-aud21-013-2026-09-20.md)  
**Backlog:** [catálogo CVG-AUD22](backlog-melhorias-cvg-aud22-2026-09-20.md)  
**Estado inicial:** `PARTIAL / REJECT / AAA_NOT_PROVEN`

## Objetivo

Fechar as contraprovas remanescentes sem refazer o progresso válido de AUD21, construir uma identidade exata e não mutante para o candidato, executar duas qualificações locais no mesmo objeto e separar claramente provas locais, externas e humanas.

AUD21-002–010 e 012 entram como `IMPLEMENTED_UNVERIFIED`: o código é preservado, mas seus receipts precisam ser reemitidos apenas depois do congelamento. AUD21-011 e 013 são reabertos por contraprovas funcionais.

## Caminho crítico

```text
R0 control plane e contenção append-only
  ├─ R1 recovery/restore e least privilege
  ├─ R2 manifesto, evidence root, exits e verificador forte
  └─ R3 qualidade web, browser local, alertas e logs
                 ↓ convergência
R4 schema/storage final e gates não mutantes
                 ↓
R5 candidato congelado + qualificação local 2×
  ├─ R6a staging/providers/observabilidade
  ├─ R6b AT/acessibilidade especialista
  ├─ R6c carga/chaos/DR
  └─ R6d CI/supply chain
                 ↓
R7 red teams e crítica técnica F0–F37
                 ↓
R8 decisão humana F38
```

R1, R2 e R3 podem avançar em paralelo depois de R0. R4 espera qualquer mudança de schema/storage, inclusive logs duráveis. R5 só congela o candidato quando todas as frentes locais convergirem. As quatro lanes externas de R6 não se bloqueiam mutuamente; cada uma depende apenas do candidato local congelado e de sua autoridade específica.

## R0 — contenção e verdade operacional

**Tarefa:** 001  
**Saída:** nenhuma próxima ação ou promoção depende de status falso.

- Reconciliar state, backlog, ExecPlan, checkpoint, last event, evidence e timestamps por eventos append-only.
- Preservar receipts existentes e marcá-los superseded/stale, sem edição retroativa.
- Reclassificar implementações sem fingerprint como `IMPLEMENTED_UNVERIFIED`.
- Fazer o known-bad real 013/014 reprovar antes de avançar.

**Gate:** um único active action, DAG válida, timestamps coerentes e `AAA_NOT_PROVEN`/promoção bloqueada.

## R1 — recovery, restore e privilégios

**Tarefas:** 002–004  
**Saída:** todo bundle semanticamente inválido falha antes de DML e nenhuma prova fabrica privilégios.

- Validar usage refs, leases, escopos, tenants, sequências, digests e fences.
- Criar um entrypoint único de restore que recebe e valida o bundle completo.
- Ampliar o oracle atômico para journal, snapshots, audit, receipts e ledgers.
- Remover `GRANT ON ALL` dos harnesses; migrations devem possuir a matriz de privilégios.

**Gate:** corpus completo conhecido-bad rejeitado em memória e PostgreSQL; known-good restaurado em quarentena; destino byte/row-equivalente após falha tardia.

## R2 — identidade do candidato e evidência

**Tarefas:** 005–007  
**Saída:** claims e receipts nomeiam exatamente os bytes avaliados.

- Manifesto canônico para HEAD, index, tracked diff, untracked relevante, lockfile, configuração e modos.
- Evidence root fora do source; outputs de build/test não alteram o subject.
- Exit semântico: `PASS=0`, `FAIL=1`, `BLOCKED_EXTERNAL=2`, antes de qualquer escrita.
- Control plane valida conteúdo de plano, DAG, transições, receipts, timestamps, refs, fingerprint e invalidadores.

**Gate:** um mutante por relação é rejeitado; qualquer byte relevante alterado torna o receipt stale.

## R3 — qualidade local e operação

**Tarefas:** 008–011  
**Saída:** browser, qualidade web, alertas e logs possuem gates executáveis.

- ESLint TypeScript/React Hooks/jsx-a11y, code splitting, budgets e Lighthouse/CWV.
- Chromium, Firefox e WebKit sem retries; axe, teclado, foco e zoom automatizável.
- Prometheus→Alertmanager→receiver com `firing`, `resolved` e indisponibilidade.
- Logs persistentes com restart, retenção, correlação, acesso auditado e redaction por valor.

**Gate:** cada verificador rejeita um known-bad e emite evidência fora do candidato.

## R4 — schema/storage final e harness não mutante

**Tarefas:** 012–013  
**Saída:** o schema final, e não um intermediário, é qualificado.

- Reexecutar N-2/N-1/N, clean install, upgrade e readiness depois de recovery/logs/privilégios.
- Rodar gates em subprocessos/ambientes descartáveis sem escrever no source ou ampliar grants.
- Provar que o sentinel do candidato fica estável durante cada procedimento.

**Gate:** schema/runtime/restore/privilege passam duas vezes e known-bads de versão/privilégio falham.

## R5 — qualificação local congelada

**Tarefa:** 014  
**Saída:** um único candidato local reproduzível.

- Congelar o manifesto depois da convergência.
- Executar duas rodadas idênticas sem retries e sem drift.
- Incluir typecheck, ESLint, testes, build/budgets, browser, PDP, segurança, PostgreSQL, worker, recovery, alertas, logs, diff, proveniência e control plane.
- Reemitir receipts exact-subject para o progresso AUD21 preservado.

**Gate:** duas matrizes completas em `PASS` no mesmo fingerprint; zero P0/P1 local aberto.

## R6 — autoridades externas independentes

**Tarefas:** 015–018  
**Saída:** cada hard blocker recebe evidência do mesmo candidato, sem dependência artificial entre lanes.

- 015: staging, providers, secret authority, collector e SLO.
- 016: leitor de tela/AT e avaliação especialista de acessibilidade.
- 017: carga production-like, chaos, backup/restore gerenciado e RTO/RPO.
- 018: CI same-digest, imagens, SBOM, scans, provenance e container smoke.

**Gate:** receipts externos assinados e ligados ao manifesto de R5; ausência permanece `BLOCKED_EXTERNAL`.

## R7 — encerramento técnico

**Tarefa:** 019  
**Saída:** 38/38 fases técnicas F0–F37 em `PASS`.

- Red teams independentes F23/F24.
- Críticos frescos e separados para runtime/dados, frontend/operações, segurança/evidência e integração final.
- Mutation sentinel e repair loop para qualquer alto/crítico.

**Gate:** zero achado alto/crítico, todos os receipts current e mesmo candidato.

## R8 — decisão humana

**Tarefa:** 020  
**Saída:** F38 decidido pela autoridade nomeada.

**Gate final:** atestação criptográfica `APPROVE`, `REJECT` ou `DEFER` ligada ao candidato e ao rollback. Somente `APPROVE` pode permitir 39/39; o agente nunca preenche esse gate.

## Marcos

| Marco | Tarefas | Critério de saída |
|---|---|---|
| M0 verdade operacional | 001 | Control plane coerente e false-green eliminado. |
| M1 dados/restore | 002–004 | Sem corrupção aceita ou grant auxiliar. |
| M2 evidência | 005–007 | Subject/evidence separados e verificador forte. |
| M3 qualidade/ops | 008–011 | Web/browser/alert/log gates executáveis. |
| M4 schema final | 012–013 | Storage final requalificado sem mutação. |
| M5 qualificação local | 014 | Duas runs no mesmo fingerprint. |
| M6 externo | 015–018 | Quatro autoridades externas same-candidate. |
| M7 fechamento técnico | 019 | F0–F37, 38/38 técnicos. |
| M8 decisão humana | 020 | F38 e possível fechamento 39/39. |

## Regra de parada

Qualquer contraprova P0/P1, drift do fingerprint, receipt incompleto, exit incorreto, skip relevante, retry, fase `NOT_RUN`, achado alto/crítico ou autoridade ausente bloqueia promoção. Limite de contexto é motivo de checkpoint, nunca de `PASS`.
