# Backlog de melhorias — CVG-AUD22

> **SUPERSEDED em 2026-09-20:** este backlog preserva contratos históricos. O catálogo corrente está no [backlog CVG-AUD23](backlog-melhorias-cvg-aud23-2026-09-20.md); a próxima ação AUD22 abaixo não é mais autoritativa.

**Fonte:** [auditoria AUD21-013](auditoria-resultado-cvg-aud21-013-2026-09-20.md)  
**Roadmap:** [roadmap CVG-AUD22](roadmap-melhorias-cvg-aud22-2026-09-20.md)  
**Regra:** `DONE` exige known-bad, known-good e receipt current do fingerprint exato  
**Estado global inicial:** `PARTIAL / REJECT / AAA_NOT_PROVEN`

## Catálogo priorizado

| ID | Pri. | Estado inicial | Dependências | Dono | Entrega |
|---|---|---|---|---|---|
| CVG-AUD22-001 | P0 | READY | — | control-plane integrator | Reconciliar estado e eliminar o false-green. |
| CVG-AUD22-002 | P0 | BLOCKED_BY_DEPENDENCIES | 001 | persistence/data | Fechar semântica completa dos bundles. |
| CVG-AUD22-003 | P0 | BLOCKED_BY_DEPENDENCIES | 002 | persistence/data | Selar o entrypoint atômico de restore. |
| CVG-AUD22-004 | P0 | BLOCKED_BY_DEPENDENCIES | 001 | database security | Remover grants auxiliares e provar least privilege. |
| CVG-AUD22-005 | P0 | BLOCKED_BY_DEPENDENCIES | 001 | evidence/release | Criar manifesto exact-subject e evidence root externo. |
| CVG-AUD22-006 | P0 | BLOCKED_BY_DEPENDENCIES | 005 | evidence/release | Corrigir exits e escrita pré-pré-requisito. |
| CVG-AUD22-007 | P0 | BLOCKED_BY_DEPENDENCIES | 001,005,006 | control-plane integrator | Verificador completo e CI obrigatória. |
| CVG-AUD22-008 | P1 | BLOCKED_BY_DEPENDENCIES | 001 | frontend | ESLint, splitting, budgets, CWV e contraste. |
| CVG-AUD22-009 | P1 | BLOCKED_BY_DEPENDENCIES | 008 | frontend QA | Browser local e acessibilidade automatizável. |
| CVG-AUD22-010 | P1 | BLOCKED_BY_DEPENDENCIES | 001 | observability/SRE | Alert drill local ponta a ponta. |
| CVG-AUD22-011 | P0 | BLOCKED_BY_DEPENDENCIES | 001 | platform/observability | Logs duráveis e redaction por valor. |
| CVG-AUD22-012 | P0 | BLOCKED_BY_DEPENDENCIES | 003,004,007,011 | database | Requalificar o schema/storage final. |
| CVG-AUD22-013 | P0 | BLOCKED_BY_DEPENDENCIES | 005–012 | evidence/release | Tornar todos os gates não mutantes. |
| CVG-AUD22-014 | P0 | BLOCKED_BY_DEPENDENCIES | 003,004,007,009–013 | release integrator | Qualificação local 2× same-fingerprint. |
| CVG-AUD22-015 | P0 | BLOCKED_EXTERNAL | 014 | external platform authority | Staging/providers/secrets/collector/SLO. |
| CVG-AUD22-016 | P0 | BLOCKED_EXTERNAL | 014 | accessibility specialist | AT/leitor de tela e zoom manual. |
| CVG-AUD22-017 | P0 | BLOCKED_EXTERNAL | 014 | SRE/DR authority | Carga, chaos, backup/restore e RTO/RPO. |
| CVG-AUD22-018 | P0 | BLOCKED_EXTERNAL | 014 | CI/supply-chain authority | CI, imagens, SBOM, scans e provenance. |
| CVG-AUD22-019 | P0 | BLOCKED_BY_DEPENDENCIES | 014–018 | fresh independent critics | Red teams e fechamento F0–F37. |
| CVG-AUD22-020 | P0 | BLOCKED_HUMAN | 019 | named human release authority | F38 e decisão final. |

## Contratos de aceite

### CVG-AUD22-001 — contenção e reconciliação

- Atualizar o control plane por eventos append-only; não editar receipts antigos.
- Alinhar state, backlog, ExecPlan marker/primeiro passo, checkpoint, last event, latest evidence, timestamps e next action.
- Reclassificar 002–010/012 como `IMPLEMENTED_UNVERIFIED`; reabrir 011/013; bloquear 014.
- Corrigir dependências e next actions obsoletas de 001/021.
- **Known-bad:** estado 014 com plano 013 deve falhar.
- **Prova:** verificador atual deve falhar antes da correção e o novo verificador deve passar depois, sem apagar histórico.

### CVG-AUD22-002 — semântica completa de recovery

- Rejeitar `usageRecordId` órfão/cross-tenant, lease fence `<1`, lease/session mismatch, lease terminal, timestamp invertido, unit/workspace inválido, gaps de turn/checkpoint e fences futuros.
- Recalcular record, ledger, manifest e envelope digests em todos os mutantes.
- **Known-bads mínimos:** `dangling_usage_reference`, `zero_fence_lease` e cada relação acima.
- **Prova:** testes puros + corpus PostgreSQL real; nenhum erro aceito apenas por digest antigo.

### CVG-AUD22-003 — entrypoint e atomicidade de restore

- Um único comando recebe `DurableRecoveryBundle`, migration fingerprint e autoridade.
- Forma, semântica, escopo e compatibilidade são validados dentro da fronteira antes do primeiro DML.
- Arrays `recoveredAgent*` crus não podem contornar o comando autorizado.
- Oracle de rollback compara contagem/digest de snapshot, event journal, audit, receipts e todos os ledgers.
- **Prova:** known-bad tardio e conhecido-bom em PostgreSQL 16, incluindo source unchanged e destino idêntico após rollback.

### CVG-AUD22-004 — least privilege sem grants do harness

- Remover `GRANT ... ON ALL SEQUENCES/TABLES` de `scripts/db.ts`, restore e worker-effects.
- Migrations/default privileges são a única fonte da matriz runtime.
- Runtime, owner e restore role têm capacidades distintas; future table/sequence permanecem negadas.
- **Prova:** busca estática fail-closed e matriz PostgreSQL negativa em clean install/upgrade.

### CVG-AUD22-005 — manifesto exact-subject

- Canonicalizar HEAD, index, tracked diff, untracked relevante, lockfile, configs e modos.
- Definir inclusões/exclusões fechadas; ignorados relevantes não desaparecem por conveniência.
- Separar candidate root de evidence root; outputs não alteram o subject.
- **Known-bad:** mudar um byte/modo/config/untracked relevante invalida o receipt.
- **Prova:** checkout limpo reproduz o digest; manifest verificado por lógica externa ao candidato.

### CVG-AUD22-006 — exits e pré-condições

- `PASS=0`, `FAIL=1`, `BLOCKED_EXTERNAL=2` em subprocesso.
- Nenhum gate escreve source/evidence antes de validar credenciais, URLs, autoridade e diretórios.
- Evidência parcial não recebe nome de sucesso.
- **Prova:** matriz com ausência, placeholder, combinação insegura, falha real e sucesso.

### CVG-AUD22-007 — control plane completo

- Validar conteúdo do ExecPlan e primeiro passo, DAG/ciclos/dependências, status/transições, evidence refs, last event/gate, timestamps, freshness e fingerprint.
- Aplicar o vocabulário também a AUD21/AUD22.
- Um `DONE` exige receipt completo, current, exact-subject e posterior à última mutação.
- **Prova:** known-bad independente para cada relação e integração obrigatória na CI/local qualification.

### CVG-AUD22-008 — toolchain e performance web

- ESLint TypeScript, React Hooks e jsx-a11y cobre app e testes.
- Route-level splitting e budgets JS/CSS falham acima do limite.
- Lighthouse/CWV executável com workload/viewport declarados.
- Contraste é derivado dos tokens/componentes renderizados.
- **Prova:** um known-bad por regra; remover splitting ou piorar token reprova.

### CVG-AUD22-009 — browser e acessibilidade local

- Chromium, Firefox e WebKit executam jornadas críticas com retries zero.
- Axe, teclado, foco, reduced motion e zoom automatizável passam por viewport.
- Ausência de biblioteca WebKit é falha de ambiente explícita, não skip aceito.
- **Prova:** matriz ligada ao fingerprint, screenshots/traces no evidence root.

### CVG-AUD22-010 — alert drill

- Prometheus gera alerta, Alertmanager roteia, receiver observa `firing` e `resolved`.
- Receiver indisponível produz falha detectável e runbook correlacionado.
- **Prova:** transcript e known-bad de rota/receiver quebrado.

### CVG-AUD22-011 — logs duráveis

- Backend persistente com health, retenção, consulta por correlação, restart survival e acesso auditado.
- Redaction combina classificação estrutural e padrão de valor.
- Corpus inclui email, bearer, key, password e segredo sob nomes benignos.
- **Prova:** restart/query/retention/access/redaction drills em processo separado.

### CVG-AUD22-012 — schema final

- Executar N-2/N-1/N, clean install e upgrade sobre o schema final.
- N-2/N-1 rejeitam readiness; N aceita somente com smoke runtime/restore/privilégios.
- Duas execuções sem grants auxiliares.
- **Prova:** PostgreSQL 16 descartável e transcript exact-subject.

### CVG-AUD22-013 — gates não mutantes

- Build, browser, PostgreSQL e verificadores escrevem apenas em temp/evidence root.
- Sentinel antes/depois de cada gate permanece idêntico para o subject.
- Processos, portas, bancos e containers criados são inventariados e limpos.
- **Prova:** mutante que escreve no candidato reprova e deixa caminho diagnóstico.

### CVG-AUD22-014 — qualificação local 2×

- Congelar o manifesto depois de 002–013.
- Executar duas rodadas completas, sem retry, no mesmo fingerprint.
- Reemitir receipts current de todas as implementações preservadas de AUD21.
- Zero P0/P1 local, skip relevante, warning de budget ou drift.
- **Prova:** dois manifests/result sets independentes com igualdade de subject.

### CVG-AUD22-015 — staging e integrações reais

- Staging, DeepSeek/provider reais, secret authority, collector e SLO usam o candidato 014.
- Falhas de timeout/abort/revogação/indisponibilidade permanecem fail-closed.
- **Prova:** receipts externos assinados; sem autoridade, `BLOCKED_EXTERNAL`.

### CVG-AUD22-016 — acessibilidade especialista

- Leitor de tela/AT e zoom manual por jornada e plataforma declarada.
- Não depende de provider/staging quando a aplicação local congelada é suficiente.
- **Prova:** relatório de especialista ligado ao fingerprint; sem especialista, `BLOCKED_EXTERNAL`.

### CVG-AUD22-017 — carga, chaos e DR

- Workload/thresholds pré-declarados, carga production-like e falhas de processo/rede/banco.
- Backup/restore gerenciado, RTO/RPO medidos, perda de dados e reconciliação explicitadas.
- **Prova:** ambiente autorizado e receipts same-candidate.

### CVG-AUD22-018 — CI e supply chain

- CI usa o mesmo SHA/fingerprint sem rebuild na promoção.
- Imagens, SBOM, scans, assinaturas, provenance e container smoke vinculados.
- **Prova:** logs/artefatos remotos verificáveis; ausência é `BLOCKED_EXTERNAL`.

### CVG-AUD22-019 — gauntlet técnico final

- Críticos frescos, sem contexto herdado e sem permissão de escrita.
- Red teams F23/F24 separados; mutation sentinel obrigatório.
- Repair loop reexecuta checks afetados e invalida receipts antigos.
- **Prova:** F0–F37 em 38/38 `PASS`, zero alto/crítico.

### CVG-AUD22-020 — F38 humano

- Autoridade humana nomeada recebe candidato, riscos, rollback e evidências.
- Decisão `APPROVE/REJECT/DEFER` é criptograficamente vinculada ao subject.
- **Prova:** atestação verificável; nenhum agente pode executar ou inferir esse aceite.

## Cobertura F0–F38

| Fase | Donos AUD22 | Estado inicial |
|---|---|---|
| F0 reauditoria final | 019 | BLOCKED_BY_DEPENDENCIES |
| F1 PDP universal | 007,014,019 | IMPLEMENTED_UNVERIFIED |
| F2 authoritative writes | 002–004,012,014,019 | REOPEN |
| F3 DeepSeek harness real | 015 | BLOCKED_EXTERNAL |
| F4 DeepSeek failure matrix | 015,017 | BLOCKED_EXTERNAL |
| F5 provider externo real | 015 | BLOCKED_EXTERNAL |
| F6 provider chaos | 015,017 | BLOCKED_EXTERNAL |
| F7 idempotência concorrente | 014,019 | IMPLEMENTED_UNVERIFIED |
| F8 PostgreSQL multi-instance | 004,012,014 | REOPEN |
| F9 worker handlers reais | 014,015 | IMPLEMENTED_UNVERIFIED + BLOCKED_EXTERNAL |
| F10 backpressure | 008,014,017 | IMPLEMENTED_UNVERIFIED + BLOCKED_EXTERNAL |
| F11 secret authority real | 015 | BLOCKED_EXTERNAL |
| F12 WebAuthn/break-glass real | 015 | BLOCKED_EXTERNAL |
| F13 observability staging | 010,011,015 | TODO_LOCAL + BLOCKED_EXTERNAL |
| F14 alert delivery real | 010,015 | TODO_LOCAL + BLOCKED_EXTERNAL |
| F15 SLO measurements | 015,017 | BLOCKED_EXTERNAL |
| F16 load production-like | 008,017 | TODO_LOCAL + BLOCKED_EXTERNAL |
| F17 chaos infra | 017 | BLOCKED_EXTERNAL |
| F18 recovery real | 002,003,017 | REOPEN + BLOCKED_EXTERNAL |
| F19 RTO/RPO | 017 | BLOCKED_EXTERNAL |
| F20 backup operacional | 003,011,017 | TODO_LOCAL + BLOCKED_EXTERNAL |
| F21 full browser matrix | 009 | TODO_LOCAL |
| F22 accessibility real | 009,016 | TODO_LOCAL + BLOCKED_EXTERNAL |
| F23 security red-team | 019 | BLOCKED_BY_DEPENDENCIES |
| F24 DB security red-team | 019 | BLOCKED_BY_DEPENDENCIES |
| F25 audit immutability | 004,007,011,014,019 | TODO_LOCAL |
| F26 usage settlement | 002,014,015 | REOPEN + BLOCKED_EXTERNAL |
| F27 export hardening | 011,014,015 | TODO_LOCAL + BLOCKED_EXTERNAL |
| F28 CI do mesmo SHA | 005,007,018 | TODO_LOCAL + BLOCKED_EXTERNAL |
| F29 release provenance | 005,018 | TODO_LOCAL + BLOCKED_EXTERNAL |
| F30 container smoke real | 018 | BLOCKED_EXTERNAL |
| F31 resource pressure | 008,017,018 | BLOCKED_EXTERNAL |
| F32 security headers real | 015,018 | BLOCKED_EXTERNAL |
| F33 production config fail-closed | 006,015,018 | TODO_LOCAL + BLOCKED_EXTERNAL |
| F34 staging promotion model | 005,006,015,018 | BLOCKED_EXTERNAL |
| F35 runbook execution | 010,011,015,017,018 | TODO_LOCAL + BLOCKED_EXTERNAL |
| F36 final gauntlet | 019 | BLOCKED_BY_DEPENDENCIES |
| F37 repair loop | 019 | BLOCKED_BY_DEPENDENCIES |
| F38 human approval gate | 020 | BLOCKED_HUMAN |

## Próxima ação única

`CVG-AUD22-001:CONTROL-PLANE-RECONCILIATION` — registrar as reaberturas/reclassificações append-only, alinhar todos os ponteiros em uma ação e provar que o known-bad 013/014 deixa de produzir false-green.
