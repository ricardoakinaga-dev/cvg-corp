# Backlog de melhorias — CVG-AUD23

> **SUPERSEDED em 2026-09-20:** `CVG-AUD23-004 = DONE` foi rejeitado pela [auditoria da entrega](auditoria-entrega-cvg-aud23-004-2026-09-20.md). O backlog corrente é o [CVG-AUD24](backlog-melhorias-cvg-aud24-2026-09-20.md); este arquivo preserva o plano histórico.

**Fonte:** [auditoria AUD22-002](auditoria-entrega-cvg-aud22-002-2026-09-20.md)
**Roadmap:** [roadmap CVG-AUD23](roadmap-melhorias-cvg-aud23-2026-09-20.md)
**Regra:** `DONE` exige known-bad, known-good e receipt current do fingerprint exato
**Estado global inicial:** `PARTIAL / REJECT / AAA_NOT_PROVEN`

## Catálogo priorizado

| ID | Pri. | Estado inicial | Dependências | Dono | Entrega |
|---|---|---|---|---|---|
| CVG-AUD23-001 | P0 | READY | — | control-plane integrator | Eliminar o false-green e reconciliar o histórico append-only. |
| CVG-AUD23-002 | P0 | BLOCKED_BY_DEPENDENCIES | 001 | platform/data | Launcher PostgreSQL 16 descartável e isolado. |
| CVG-AUD23-003 | P0 | BLOCKED_BY_DEPENDENCIES | 002 | persistence/data | Prova real do guard de usage e taxonomia de erro. |
| CVG-AUD23-004 | P0 | BLOCKED_BY_DEPENDENCIES | 003 | persistence/data | Entry point selado de restore. |
| CVG-AUD23-005 | P0 | BLOCKED_BY_DEPENDENCIES | 004 | persistence/data | Atomicidade e oracle direto de rollback. |
| CVG-AUD23-006 | P0 | BLOCKED_BY_DEPENDENCIES | 002 | database security | Least privilege sem grants auxiliares. |
| CVG-AUD23-007 | P0 | BLOCKED_BY_DEPENDENCIES | 001 | evidence/release | Manifesto exact-subject e evidence root. |
| CVG-AUD23-008 | P0 | BLOCKED_BY_DEPENDENCIES | 007 | evidence/release | Exits semânticos e receipts por comando. |
| CVG-AUD23-009 | P0 | BLOCKED_BY_DEPENDENCIES | 001,007,008 | control-plane integrator | Verificador completo e CI obrigatória. |
| CVG-AUD23-010 | P1 | BLOCKED_BY_DEPENDENCIES | 001 | frontend | ESLint real, splitting, budgets e CWV. |
| CVG-AUD23-011 | P1 | BLOCKED_BY_DEPENDENCIES | 010 | frontend QA | Browsers e acessibilidade local. |
| CVG-AUD23-012 | P1 | BLOCKED_BY_DEPENDENCIES | 001 | observability/SRE | Alert drill local ponta a ponta. |
| CVG-AUD23-013 | P0 | BLOCKED_BY_DEPENDENCIES | 001 | platform/observability | Logs duráveis e redaction por valor. |
| CVG-AUD23-014 | P0 | BLOCKED_BY_DEPENDENCIES | 005,006,009,011,012,013 | database/release | Schema final e gates não mutantes. |
| CVG-AUD23-015 | P0 | BLOCKED_BY_DEPENDENCIES | 003,004,005,006,007,008,009,010,011,012,013,014 | release integrator | Qualificação local 2× same-fingerprint. |
| CVG-AUD23-016 | P0 | BLOCKED_BY_DEPENDENCIES | 015 | external platform authority | Staging/providers/secrets/collector/SLO. |
| CVG-AUD23-017 | P0 | BLOCKED_BY_DEPENDENCIES | 015 | accessibility specialist | AT/leitor de tela e zoom manual. |
| CVG-AUD23-018 | P0 | BLOCKED_BY_DEPENDENCIES | 015 | SRE/DR authority | Carga, chaos, backup/restore e RTO/RPO. |
| CVG-AUD23-019 | P0 | BLOCKED_BY_DEPENDENCIES | 015 | CI/supply-chain authority | CI, imagens, SBOM, scans e provenance. |
| CVG-AUD23-020 | P0 | BLOCKED_BY_DEPENDENCIES | 015,016,017,018,019 | fresh independent critics | Gauntlet técnico F0–F37. |
| CVG-AUD23-021 | P0 | BLOCKED_BY_DEPENDENCIES | 020 | named human release authority | F38 e decisão final. |

Os itens 016–019 mudam para `BLOCKED_EXTERNAL` somente depois de 015, caso a autoridade correspondente continue ausente. O item 021 muda para `BLOCKED_HUMAN` somente depois de 020.

## Contratos de aceite

### CVG-AUD23-001 — semântica do control plane

- Validar dependências satisfeitas antes de ativação, transições contínuas, status ativo não bloqueado, task/action únicas e exatas, primeiro passo físico do plano, tails, timestamps, freshness e resultado.
- Reconciliar state, backlog, plano e logs somente por eventos/receipts superseding; não editar histórico.
- **Known-bad:** o snapshot AUD22 atual, uma ação duplicada e um receipt stale/wrong-task precisam falhar.
- **Known-good:** estado mínimo com dependências concluídas e único ponteiro passa.
- **Evidência:** teste unitário por relação + `verify:control-plane` vermelho antes e verde depois.

### CVG-AUD23-002 — PostgreSQL descartável

- Criar PostgreSQL 16 dedicado por execução, porta e nomes aleatórios, credenciais sintéticas e roles separadas de schema-owner/runtime/restore.
- Não reutilizar nem alterar containers existentes; inventariar e limpar container, bancos, processos e temporários via trap.
- Ausência do launcher é `TODO_LOCAL`, não `BLOCKED_EXTERNAL`.
- **Known-bad:** porta ocupada, inicialização incompleta e cleanup interrompido falham com diagnóstico.
- **Evidência:** duas execuções limpas com inventário antes/depois idêntico.

### CVG-AUD23-003 — guard de usage no banco

- Reutilizar a correção `$10/$11`; evitar reimplementação sem contraprova.
- Provar usage válido, órfão e cross-tenant com runtime real; os inválidos não criam turn, audit, usage link ou efeito lateral.
- Separar erro de integridade/escopo de `DENIED_STALE_FENCE`, sem revelar existência cross-tenant.
- **Known-bad:** trocar novamente `$10` por `$11` ou usar usage de outro tenant deve falhar.
- **Evidência:** assertions diretas em PostgreSQL e transcript exact-subject.

### CVG-AUD23-004 — restore selado

- Um único comando recebe `DurableRecoveryBundle`, migration fingerprint e autoridade explícita.
- Forma, digests, semântica, tenant, escopo e compatibilidade são validados antes do primeiro DML.
- Remover arrays `recoveredAgent*` da fronteira pública e impedir elevação implícita por sua mera presença.
- **Known-bad:** chamadas com arrays crus, fingerprint errado ou autoridade ausente não compilam ou falham antes de conexão/DML.
- **Evidência:** API contract tests e corpus PostgreSQL.

### CVG-AUD23-005 — atomicidade de restore

- Oracle consulta diretamente snapshot, journal, audit, receipts, sessions, turns, checkpoints, leases e ledgers.
- Known-good termina em `revision=1`, `QUARANTINED`, com origem inalterada e leases ativos descartados.
- Falha tardia preserva contagens e digests do destino.
- **Known-bad:** erro após a penúltima projeção deve causar rollback integral.
- **Evidência:** duas rodadas PostgreSQL com hashes antes/depois.

### CVG-AUD23-006 — least privilege

- Remover `GRANT ... ON ALL TABLES/SEQUENCES` de `scripts/db.ts`, restore e worker-effects.
- Migrations/default privileges são a única fonte de autoridade; runtime, owner e restore role têm capacidades distintas.
- **Known-bad:** runtime cria/escreve objeto futuro, altera terminal ou restaura sem role; tudo deve ser negado.
- **Known-good:** operações legítimas mínimas passam em clean install e upgrade.
- **Evidência:** busca estática fail-closed + matriz negativa PostgreSQL.

### CVG-AUD23-007 — manifesto exact-subject

- Canonicalizar HEAD, index, tracked diff, untracked relevante, modos, lockfile e configurações.
- Definir inclusões/exclusões fechadas e separar candidate root de evidence root.
- **Known-bad:** mudar byte, modo, config ou untracked relevante invalida o receipt.
- **Known-good:** checkout equivalente reproduz o digest com verificador externo ao candidato.
- **Evidência:** manifesto versionado e corpus de mutantes.

### CVG-AUD23-008 — exits e receipts

- Preservar comando, timestamps, exit, stdout/stderr digest e resultado de cada procedimento.
- Agregar pelo pior resultado: `PASS=0`, `FAIL=1`, `BLOCKED_EXTERNAL=2`; `NOT_RUN` nunca vira sucesso.
- Validar pré-condições antes de escrever no source/evidence root.
- **Known-bad:** receipt composto com restore exit `2` e global `0` deve falhar.
- **Evidência:** matriz ausência/placeholder/falha/sucesso e receipt corretivo append-only.

### CVG-AUD23-009 — controle completo

- Integrar manifesto, receipts, eventos, plano e backlog num gate obrigatório da CI e da qualificação.
- Exigir `DONE` somente com evidence current, exact-subject e posterior à última mutação relevante.
- **Known-bad:** dependência parcial, plano fora de ordem, tail divergente, timestamp futuro, stale fingerprint e transição ilegal falham isoladamente.
- **Known-good:** fixture completa passa.
- **Evidência:** corpus versionado com uma contraprova por relação.

### CVG-AUD23-010 — toolchain e performance web

- ESLint TypeScript, React Hooks e jsx-a11y cobre aplicação e testes; o lint customizado pode permanecer auxiliar, não autoridade única.
- Route-level splitting e budgets JS/CSS falham acima do limite; CWV declara workload e viewport.
- **Known-bad:** hook inválido, regra a11y, chunk monolítico e budget excedido reprovam.
- **Evidência:** reports versionados no evidence root.

### CVG-AUD23-011 — browser e acessibilidade local

- Chromium, Firefox e WebKit executam jornadas críticas com retries zero.
- Axe, teclado, foco, reduced motion e zoom automatizável passam por viewport.
- Biblioteca/engine ausente é falha de ambiente explícita, não skip aceito.
- **Known-bad:** quebra de foco, contraste, zoom ou contrato de resposta falha na engine afetada.
- **Evidência:** traces/screenshots e matriz ligada ao fingerprint.

### CVG-AUD23-012 — alert drill

- Prometheus gera alerta, Alertmanager roteia e receiver observa `firing` e `resolved`.
- Receiver/rota indisponível produz falha detectável e runbook correlacionado.
- **Known-bad:** rota quebrada ou receiver 5xx falha o gate.
- **Evidência:** transcript temporal e consulta de estado das três pontas.

### CVG-AUD23-013 — logs duráveis

- Backend persistente oferece health, retenção, consulta por correlação, restart survival e acesso auditado.
- Redaction combina classificação estrutural e padrão de valor.
- **Known-bad:** bearer, key, password, email e segredo sob chave benigna nunca aparecem em claro.
- **Evidência:** drills em processo separado de restart/query/retention/access/redaction.

### CVG-AUD23-014 — schema final e não mutação

- Executar clean install, upgrade, N-2/N-1/N, readiness, restore e privilégios depois das mudanças finais.
- Build, browser e PostgreSQL escrevem apenas em temporários/evidence root; todos os recursos criados são limpos.
- **Known-bad:** N-1, privilégio indevido ou gate que escreve no subject falha.
- **Known-good:** schema N e smoke runtime/restore passam duas vezes.
- **Evidência:** mutation sentinel e inventário antes/depois.

### CVG-AUD23-015 — qualificação local 2×

- Congelar o manifesto após 003–014.
- Executar duas matrizes completas, sem retry e sem skip relevante, no mesmo fingerprint.
- Reemitir receipts de implementações AUD21/AUD22 preservadas.
- **Known-bad:** drift entre rodadas ou warning de budget invalida ambas.
- **Evidência:** dois manifests/result sets independentes, zero P0/P1 local.

### CVG-AUD23-016 — staging e integrações reais

- Staging, providers reais, secret authority, collector e SLO usam o candidato 015.
- Timeout, abort, revogação e indisponibilidade permanecem fail-closed.
- **Evidência:** receipts externos assinados; sem autoridade após 015, `BLOCKED_EXTERNAL`.

### CVG-AUD23-017 — acessibilidade especialista

- Leitor de tela/AT e zoom manual por jornada e plataforma declarada.
- **Evidência:** relatório de especialista ligado ao fingerprint; sem especialista após 015, `BLOCKED_EXTERNAL`.

### CVG-AUD23-018 — carga, chaos e DR

- Workload/thresholds pré-declarados, carga production-like e falhas de processo/rede/banco.
- Backup/restore gerenciado mede RTO/RPO, perda e reconciliação.
- **Evidência:** ambiente autorizado e receipts same-candidate; ausência após 015 é `BLOCKED_EXTERNAL`.

### CVG-AUD23-019 — CI e supply chain

- CI usa o mesmo SHA/fingerprint sem rebuild na promoção.
- Imagens, SBOM, scans, assinaturas, provenance e container smoke permanecem vinculados.
- **Evidência:** logs/artefatos remotos verificáveis; ausência após 015 é `BLOCKED_EXTERNAL`.

### CVG-AUD23-020 — gauntlet técnico final

- Críticos frescos, sem contexto herdado, somente leitura e com mutation sentinel.
- Red teams F23/F24 separados; repair loop invalida e reexecuta evidências afetadas.
- **Known-bad:** um alto/crítico ou receipt stale impede fechamento.
- **Evidência:** F0–F37 em 38/38 `PASS`, zero alto/crítico.

### CVG-AUD23-021 — F38 humano

- Autoridade humana nomeada recebe candidato, riscos residuais, rollout e rollback.
- Decisão `APPROVE/REJECT/DEFER` é verificavelmente ligada ao subject.
- **Evidência:** atestação humana; nenhum agente pode produzir ou inferir esse aceite.

## Cobertura F0–F38

| Fase | Donos AUD23 | Estado inicial |
|---|---|---|
| F0 reauditoria final | 020 | BLOCKED_BY_DEPENDENCIES |
| F1 PDP universal | 009,015,020 | IMPLEMENTED_UNVERIFIED |
| F2 authoritative writes | 003–006,014,015,020 | REOPEN |
| F3 DeepSeek harness real | 016 | BLOCKED_BY_DEPENDENCIES |
| F4 DeepSeek failure matrix | 016,018 | BLOCKED_BY_DEPENDENCIES |
| F5 provider externo real | 016 | BLOCKED_BY_DEPENDENCIES |
| F6 provider chaos | 016,018 | BLOCKED_BY_DEPENDENCIES |
| F7 idempotência concorrente | 015,020 | IMPLEMENTED_UNVERIFIED |
| F8 PostgreSQL multi-instance | 002,006,014,015 | REOPEN |
| F9 worker handlers reais | 015,016 | IMPLEMENTED_UNVERIFIED |
| F10 backpressure | 010,015,018 | IMPLEMENTED_UNVERIFIED |
| F11 secret authority real | 016 | BLOCKED_BY_DEPENDENCIES |
| F12 WebAuthn/break-glass real | 016 | BLOCKED_BY_DEPENDENCIES |
| F13 observability staging | 012,013,016 | TODO_LOCAL |
| F14 alert delivery real | 012,016 | TODO_LOCAL |
| F15 SLO measurements | 016,018 | BLOCKED_BY_DEPENDENCIES |
| F16 load production-like | 010,018 | BLOCKED_BY_DEPENDENCIES |
| F17 chaos infra | 018 | BLOCKED_BY_DEPENDENCIES |
| F18 recovery real | 002–005,018 | REOPEN |
| F19 RTO/RPO | 018 | BLOCKED_BY_DEPENDENCIES |
| F20 backup operacional | 005,013,018 | TODO_LOCAL |
| F21 full browser matrix | 011 | TODO_LOCAL |
| F22 accessibility real | 011,017 | TODO_LOCAL |
| F23 security red-team | 020 | BLOCKED_BY_DEPENDENCIES |
| F24 DB security red-team | 020 | BLOCKED_BY_DEPENDENCIES |
| F25 audit immutability | 006,009,013,015,020 | TODO_LOCAL |
| F26 usage settlement | 003,015,016 | REOPEN |
| F27 export hardening | 013,015,016 | TODO_LOCAL |
| F28 CI do mesmo SHA | 007,009,019 | TODO_LOCAL |
| F29 release provenance | 007,019 | TODO_LOCAL |
| F30 container smoke real | 019 | BLOCKED_BY_DEPENDENCIES |
| F31 resource pressure | 010,018,019 | BLOCKED_BY_DEPENDENCIES |
| F32 security headers real | 016,019 | BLOCKED_BY_DEPENDENCIES |
| F33 production config fail-closed | 008,016,019 | TODO_LOCAL |
| F34 staging promotion model | 007,008,016,019 | BLOCKED_BY_DEPENDENCIES |
| F35 runbook execution | 012,013,016,018,019 | TODO_LOCAL |
| F36 final gauntlet | 020 | BLOCKED_BY_DEPENDENCIES |
| F37 repair loop | 020 | BLOCKED_BY_DEPENDENCIES |
| F38 human approval gate | 021 | BLOCKED_BY_DEPENDENCIES |

## Próxima ação única

`CVG-AUD23-001:CONTROL-PLANE-SEMANTICS` — adicionar contraprovas para dependência insatisfeita, ação duplicada, status/transição, receipt/tail/freshness/fingerprint e exit composto; fazer o snapshot atual falhar; depois reconciliar os ponteiros com novos registros append-only.
