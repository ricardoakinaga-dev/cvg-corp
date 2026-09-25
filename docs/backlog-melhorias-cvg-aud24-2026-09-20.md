> **SUPERSEDED em 2026-09-20 pelo [backlog CVG-AUD25](backlog-melhorias-cvg-aud25-2026-09-20.md).** O `DONE` de AUD24-003 foi rejeitado pela auditoria: a conexão que executa o restore não é a conexão cuja identidade e cujo schema foram validados. A correção do ledger/control plane deve ser append-only no próximo ciclo.

# Backlog de melhorias — CVG-AUD24

**Fonte:** [auditoria CVG-AUD23-004](auditoria-entrega-cvg-aud23-004-2026-09-20.md)  
**Roadmap:** [roadmap CVG-AUD24](roadmap-melhorias-cvg-aud24-2026-09-20.md)  
**Regra:** `DONE` exige known-bad, known-good, receipt current e fingerprint do sujeito exato recalculado  
**Estado global inicial:** `FAIL / REJECT / AAA_NOT_PROVEN`

## Catálogo priorizado

| ID | Pri. | Estado inicial | Dependências | Dono | Entrega |
|---|---|---|---|---|---|
| CVG-AUD24-001 | P0 | READY | — | control/evidence integrator | Exact-subject real e reconciliação append-only de AUD23-004/control plane. |
| CVG-AUD24-002 | P0 | BLOCKED_BY_DEPENDENCIES | 001 | persistence/security | Selar `commit()` contra `recoveredAgent*` em runtime. |
| CVG-AUD24-003 | P0 | BLOCKED_BY_DEPENDENCIES | 002 | database security | Vincular restore a principal/capacidade e fingerprint reais do destino. |
| CVG-AUD24-004 | P0 | BLOCKED_BY_DEPENDENCIES | 002,003 | persistence/data | Corpus inteiro pelo entrypoint, com zero connect/DML para inválidos. |
| CVG-AUD24-005 | P0 | BLOCKED_BY_DEPENDENCIES | 004 | persistence/data | Oracle de origem imutável e conhecido-bom independente. |
| CVG-AUD24-006 | P0 | BLOCKED_BY_DEPENDENCIES | 004,005 | persistence/data | Falha tardia pelo restore e rollback integral por SQL direto. |
| CVG-AUD24-007 | P0 | BLOCKED_BY_DEPENDENCIES | 003 | database security | Least privilege sem grants auxiliares. |
| CVG-AUD24-008 | P0 | BLOCKED_BY_DEPENDENCIES | 006,007 | persistence/resilience | Retry, replay, conflito e outcome unknown do restore. |
| CVG-AUD24-009 | P0 | BLOCKED_BY_DEPENDENCIES | 001 | evidence/release | Evidence root e snapshots static current. |
| CVG-AUD24-010 | P0 | BLOCKED_BY_DEPENDENCIES | 009 | evidence/release | Exits semânticos, transcripts e receipts por comando. |
| CVG-AUD24-011 | P0 | BLOCKED_BY_DEPENDENCIES | 001,009,010 | control-plane integrator | Gate integral e CI obrigatória para todo o DAG. |
| CVG-AUD24-012 | P1 | BLOCKED_BY_DEPENDENCIES | 001 | frontend | ESLint real, splitting, budgets e CWV. |
| CVG-AUD24-013 | P1 | BLOCKED_BY_DEPENDENCIES | 012 | frontend QA | Chromium/Firefox/WebKit e acessibilidade local. |
| CVG-AUD24-014 | P1 | BLOCKED_BY_DEPENDENCIES | 001 | observability/SRE | Alert drill ponta a ponta. |
| CVG-AUD24-015 | P0 | BLOCKED_BY_DEPENDENCIES | 001 | platform/observability | Logs duráveis e redaction por valor. |
| CVG-AUD24-016 | P0 | BLOCKED_BY_DEPENDENCIES | 008,011,013,014,015 | database/release | Schema final, requalificação e gates não mutantes. |
| CVG-AUD24-017 | P0 | BLOCKED_BY_DEPENDENCIES | 002–016 | release integrator | Qualificação local 2× no mesmo fingerprint. |
| CVG-AUD24-018 | P0 | BLOCKED_BY_DEPENDENCIES | 017 | external platform authority | Staging/providers/secrets/collector/SLO. |
| CVG-AUD24-019 | P0 | BLOCKED_BY_DEPENDENCIES | 017 | accessibility specialist | AT/leitor de tela e zoom manual. |
| CVG-AUD24-020 | P0 | BLOCKED_BY_DEPENDENCIES | 017 | SRE/DR authority | Carga, chaos, backup/restore e RTO/RPO. |
| CVG-AUD24-021 | P0 | BLOCKED_BY_DEPENDENCIES | 017 | CI/supply-chain authority | CI, imagens, SBOM, scans, assinatura e provenance. |
| CVG-AUD24-022 | P0 | BLOCKED_BY_DEPENDENCIES | 017–021 | fresh independent critics | Gauntlet técnico F0–F37. |
| CVG-AUD24-023 | P0 | BLOCKED_BY_DEPENDENCIES | 022 | named human release authority | F38 e decisão final. |

Os itens 018–021 mudam para `BLOCKED_EXTERNAL` somente depois de 017, caso a autoridade correspondente continue ausente. O item 023 muda para `BLOCKED_HUMAN` somente depois de 022. Toda tarefa cujas dependências forem concluídas deve mudar para `READY`; deixá-la `BLOCKED_BY_DEPENDENCIES` é erro do control plane.

## Contratos de aceite

### CVG-AUD24-001 — exact-subject e reconciliação

- Canonicalizar HEAD, index, tracked diff, untracked relevante, modos, lockfile e configurações.
- Recalcular o fingerprint a partir dos bytes; comparar state, checkpoints, task, receipt e manifest.
- Reabrir AUD23-004 e invalidar sua evidência dependente por eventos/receipts superseding, sem editar histórico.
- Corrigir `current_audit_addendum`, status derivados das dependências e ponteiros para AUD24.
- **Known-bad:** hash repetido mas não derivado do worktree, mudança de modo/untracked/config e item bloqueado com dependências satisfeitas falham.
- **Known-good:** dois checkouts equivalentes geram o mesmo digest por verificadores independentes.
- **Evidência:** corpus de mutantes + `verify:control-plane` vermelho antes e verde depois.

### CVG-AUD24-002 — fronteira runtime de restore

- O caminho público `commit()` reconstrói um objeto allowlisted ou rejeita chaves desconhecidas sensíveis antes de conexão.
- Somente `restore()` pode alcançar projeções recuperadas; a capacidade interna não pode ser criada por input desserializado.
- Remover qualquer ativação de role baseada apenas na presença de arrays.
- **Known-bad:** `commit({...normal, recoveredAgentSessions: []})` via export JS, `as any` e objeto JSON falha antes de `pool.connect()`.
- **Known-good:** commit normal e restore autorizado continuam funcionando.
- **Evidência:** teste pelo pacote exportado, não somente inspeção de interface.

### CVG-AUD24-003 — autoridade e fingerprint vinculados

- Distinguir schema-owner, runtime e executor de restore; registrar identidade efetiva e membership mínima.
- Ler o migration fingerprint do destino por conexão confiável; não comparar apenas dois valores fornecidos pelo mesmo caller.
- Fazer `SET ROLE` falhar sem membership e impedir o runtime de obtê-la.
- **Known-bad:** role literal forjada, fingerprint caller/caller igual mas banco divergente e runtime sem membership falham.
- **Known-good:** principal autorizado restaura e o evento registra referência auditável.
- **Evidência:** matriz PostgreSQL direta de `session_user`, `current_user`, memberships e grants.

### CVG-AUD24-004 — corpus pré-conexão

- Encaminhar todos os mutantes de forma, digest, tenant, escopo, sequência, fence, lease, FK lógica e migration pelo `restore()` publicado.
- Medir separadamente `pool.connect`, BEGIN, statements DML e contagens do destino.
- Adicionar compile-negative para arrays crus, sem tratá-lo como substituto da prova runtime.
- **Known-bad:** cada mutante deve produzir `connect=0`, `DML=0` e destino idêntico.
- **Known-good:** bundle completo chega à transação.
- **Evidência:** tabela mutante→erro→contadores, no mesmo fingerprint.

### CVG-AUD24-005 — origem e conhecido-bom

- Capturar estado da origem antes de qualquer DML do verifier ou criar a fixture em setup explicitamente fora da janela comparada.
- Comparar diretamente origem antes/depois e destino com SQL independente.
- Exigir destino em revision 1, snapshot/sessões `QUARANTINED`, fences e histórico preservados, leases ativos ausentes e autoridade de login revogada.
- **Known-bad:** qualquer mutação da origem ou lease revivido falha.
- **Evidência:** hashes canônicos por relação de origem/destino.

### CVG-AUD24-006 — rollback direto

- Injetar falha determinística pelo entrypoint `restore()` depois da penúltima projeção e antes do COMMIT.
- Consultar diretamente snapshots, journal, audit records/ledger, receipts/ledger, outbox, usage, inbox, efeitos, jobs, sessions, turns, checkpoints, leases e sequências.
- O oracle vive fora de `exportRecoveryBundle()` e não reutiliza o validator como prova única.
- **Known-bad:** falha tardia deixa contagens, valores, digests, sequences e revision exatamente como antes.
- **Evidência:** duas rodadas PostgreSQL independentes, hashes antes/depois e ponto de injeção registrado.

### CVG-AUD24-007 — least privilege

- Remover `GRANT ... ON ALL TABLES/SEQUENCES` de helpers de restore, banco e worker-effects.
- Migrations/default privileges são a única fonte de autoridade; restore role é `NOLOGIN` e não herdá privilégios amplos.
- **Known-bad:** runtime cria/escreve objeto futuro, assume restore role ou altera sessão terminal; tudo negado.
- **Known-good:** operações mínimas passam em clean install e upgrade.
- **Evidência:** busca estática fail-closed + matriz PostgreSQL negativa.

### CVG-AUD24-008 — retries e outcome unknown

- Definir idempotência do mesmo bundle, conflito com destino não vazio/revision stale e duplicate IDs.
- Cobrir perda antes de BEGIN, no meio das projeções, antes/depois de COMMIT e resposta perdida.
- Nunca repetir cegamente um commit de resultado desconhecido; reconciliar por event/operation id.
- **Known-bad:** replay divergente, destino parcialmente populado e retry após outcome unknown falham ou reconciliam sem duplicar.
- **Evidência:** matriz de falhas e estado direto no PostgreSQL.

### CVG-AUD24-009 — evidence root e static

- Separar artefatos operacionais do candidate root com manifestos e política de retenção.
- Renovar os sete snapshots promovíveis para o SHA/fingerprint corrente ou marcá-los como históricos fora do gate corrente.
- Não relaxar limites de freshness para fazer a evidência antiga passar.
- **Known-bad:** SHA, mtime ou observedAt stale falha.
- **Known-good:** snapshot current verificável passa sem mutar o candidato.
- **Evidência:** `verify:static` verde e mutantes vermelhos.

### CVG-AUD24-010 — exits, transcripts e receipts

- Preservar comando, início/fim, exit, stdout/stderr digest, ambiente permitido, artifact digest e resultado por procedimento.
- Agregar pelo pior resultado; `FAIL`, `BLOCKED_EXTERNAL` e `NOT_RUN` nunca viram sucesso.
- Escrever evidence somente depois de validar precondições e fora do subject.
- **Known-bad:** subprocesso exit 1/2 com receipt global 0, transcript ausente e digest divergente falham.
- **Evidência:** matriz de exits e receipt corretivo append-only.

### CVG-AUD24-011 — control plane integral

- Validar todos os itens, status derivados, DAG, task/action, addendum, plano, checkpoints, tails, timestamps, freshness, fingerprint e receipts.
- Tornar o gate obrigatório na CI e na qualificação.
- **Known-bad:** dependência satisfeita ainda bloqueada, stale surface, hash opaco, transição ilegal e receipt divergente falham isoladamente.
- **Known-good:** fixture completa com lanes paralelas passa.
- **Evidência:** corpus versionado com uma contraprova por relação.

### CVG-AUD24-012 — toolchain e performance web

- ESLint TypeScript, React Hooks e jsx-a11y cobre aplicação e testes; lint customizado permanece auxiliar.
- Route-level splitting e budgets JS/CSS são fail-closed; CWV declara workload, viewport e hardware.
- **Known-bad:** hook inválido, regra a11y, chunk monolítico e budget excedido falham.
- **Evidência:** reports ligados ao fingerprint no evidence root.

### CVG-AUD24-013 — browsers e acessibilidade local

- Chromium, Firefox e WebKit executam jornadas críticas com retries zero.
- Axe, teclado, foco, reduced motion e zoom automatizável passam por viewport.
- Engine ausente é falha explícita, não skip aceito.
- **Known-bad:** regressão de foco, contraste, zoom ou contrato falha na engine afetada.
- **Evidência:** traces/screenshots/matriz same-subject.

### CVG-AUD24-014 — alert drill

- Prometheus gera alerta, Alertmanager roteia e receiver observa `firing` e `resolved`.
- Rota quebrada, receiver 5xx e ausência de resolução falham com runbook correlacionado.
- **Evidência:** transcript temporal e estado das três pontas.

### CVG-AUD24-015 — logs duráveis

- Backend persistente oferece health, retenção, busca por correlação, restart survival e acesso auditado.
- Redaction combina classificação estrutural e padrões de valor.
- **Known-bad:** bearer, key, password, email e segredo sob chave benigna não aparecem em claro.
- **Evidência:** drills em processo separado de restart/query/retention/access/redaction.

### CVG-AUD24-016 — schema final e não mutação

- Executar clean install, upgrade, N-2/N-1/N, readiness, restore, privilégios e recovery após as migrations finais.
- Build, browsers e PostgreSQL escrevem apenas em temporários/evidence root; todos os recursos são limpos.
- **Known-bad:** N-1, privilégio indevido, stale schema ou gate que escreve no subject falha.
- **Evidência:** mutation sentinel e inventário antes/depois em duas rodadas.

### CVG-AUD24-017 — qualificação local 2×

- Congelar o manifesto depois de 002–016.
- Executar duas matrizes completas, independentes, sem retry e sem skip relevante no mesmo fingerprint.
- Incluir tipos, ESLint, testes, build/budgets, browsers, PDP, segurança, PostgreSQL, worker, recovery, alertas, logs, static, diff, proveniência e control plane.
- **Known-bad:** drift, warning de budget, skip ou resíduo invalida a rodada.
- **Evidência:** dois result sets, zero P0/P1 local.

### CVG-AUD24-018 — staging e integrações reais

- Staging, providers reais, secret authority, collector e SLO usam exatamente o candidato 017.
- Timeout, abort, revogação e indisponibilidade permanecem fail-closed.
- **Evidência:** receipts externos verificáveis; sem autoridade após 017, `BLOCKED_EXTERNAL`.

### CVG-AUD24-019 — acessibilidade especialista

- Leitor de tela/AT e zoom manual por jornada e plataforma declarada.
- **Evidência:** relatório de especialista ligado ao fingerprint; sem especialista após 017, `BLOCKED_EXTERNAL`.

### CVG-AUD24-020 — carga, chaos e DR

- Workload e thresholds pré-declarados, carga production-like e falhas de processo/rede/banco.
- Backup/restore gerenciado mede RTO/RPO, perda e reconciliação.
- **Evidência:** ambiente autorizado e receipts same-candidate; ausência após 017, `BLOCKED_EXTERNAL`.

### CVG-AUD24-021 — CI e supply chain

- CI usa o mesmo SHA/fingerprint sem rebuild na promoção.
- Imagens, SBOM, scans, assinaturas, provenance e container smoke permanecem vinculados.
- **Evidência:** logs/artefatos remotos verificáveis; ausência após 017, `BLOCKED_EXTERNAL`.

### CVG-AUD24-022 — gauntlet técnico final

- Críticos frescos, sem contexto herdado, somente leitura e com mutation sentinel.
- Red teams F23/F24 separados; repair loop invalida e reexecuta toda evidência afetada.
- **Known-bad:** qualquer alto/crítico, receipt stale ou oracle circular impede fechamento.
- **Evidência:** F0–F37 em 38/38 `PASS`, zero alto/crítico.

### CVG-AUD24-023 — F38 humano

- Autoridade humana nomeada recebe candidato, riscos residuais, rollout e rollback.
- Decisão `APPROVE`, `REJECT` ou `DEFER` é verificavelmente ligada ao sujeito.
- **Evidência:** atestação humana; nenhum agente pode produzir ou inferir o aceite.

## Cobertura F0–F38

| Fase | Donos AUD24 | Estado inicial |
|---|---|---|
| F0 reauditoria final | 022 | BLOCKED_BY_DEPENDENCIES |
| F1 PDP universal | 011,017,022 | IMPLEMENTED_UNVERIFIED |
| F2 authoritative writes | 002–008,016,017,022 | REOPEN |
| F3 DeepSeek harness real | 018 | BLOCKED_BY_DEPENDENCIES |
| F4 DeepSeek failure matrix | 018,020 | BLOCKED_BY_DEPENDENCIES |
| F5 provider externo real | 018 | BLOCKED_BY_DEPENDENCIES |
| F6 provider chaos | 018,020 | BLOCKED_BY_DEPENDENCIES |
| F7 idempotência concorrente | 008,017,022 | REOPEN |
| F8 PostgreSQL multi-instance | 003–008,016,017 | REOPEN |
| F9 worker handlers reais | 017,018 | IMPLEMENTED_UNVERIFIED |
| F10 backpressure | 012,017,020 | IMPLEMENTED_UNVERIFIED |
| F11 secret authority real | 018 | BLOCKED_BY_DEPENDENCIES |
| F12 WebAuthn/break-glass real | 018 | BLOCKED_BY_DEPENDENCIES |
| F13 observability staging | 014,015,018 | TODO_LOCAL |
| F14 alert delivery real | 014,018 | TODO_LOCAL |
| F15 SLO measurements | 018,020 | BLOCKED_BY_DEPENDENCIES |
| F16 load production-like | 012,020 | BLOCKED_BY_DEPENDENCIES |
| F17 chaos infra | 020 | BLOCKED_BY_DEPENDENCIES |
| F18 recovery real | 002–008,020 | REOPEN |
| F19 RTO/RPO | 020 | BLOCKED_BY_DEPENDENCIES |
| F20 backup operacional | 005,006,015,020 | TODO_LOCAL |
| F21 full browser matrix | 013 | TODO_LOCAL |
| F22 accessibility real | 013,019 | TODO_LOCAL |
| F23 security red-team | 022 | BLOCKED_BY_DEPENDENCIES |
| F24 DB security red-team | 022 | BLOCKED_BY_DEPENDENCIES |
| F25 audit immutability | 006,007,011,015,017,022 | REOPEN |
| F26 usage settlement | 016–018 | IMPLEMENTED_UNVERIFIED |
| F27 export hardening | 015,017,018 | TODO_LOCAL |
| F28 CI do mesmo SHA | 001,011,021 | REOPEN |
| F29 release provenance | 001,009–011,021 | REOPEN |
| F30 container smoke real | 021 | BLOCKED_BY_DEPENDENCIES |
| F31 resource pressure | 012,020,021 | BLOCKED_BY_DEPENDENCIES |
| F32 security headers real | 018,021 | BLOCKED_BY_DEPENDENCIES |
| F33 production config fail-closed | 010,018,021 | TODO_LOCAL |
| F34 staging promotion model | 001,010,018,021 | BLOCKED_BY_DEPENDENCIES |
| F35 runbook execution | 014,015,018,020,021 | TODO_LOCAL |
| F36 final gauntlet | 022 | BLOCKED_BY_DEPENDENCIES |
| F37 repair loop | 022 | BLOCKED_BY_DEPENDENCIES |
| F38 human approval gate | 023 | BLOCKED_BY_DEPENDENCIES |

## Próxima ação única

`CVG-AUD24-001:EXACT-SUBJECT-CONTROL-RECONCILIATION` — construir o manifesto reproduzível e o verificador independente; fazer o snapshot atual falhar; registrar por append a reabertura de AUD23-004 e ativar AUD24-001 com todas as superfícies/status coerentes.
