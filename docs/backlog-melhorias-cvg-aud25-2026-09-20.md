# Backlog de melhorias — CVG-AUD25

**Fonte:** [auditoria CVG-AUD24-003](auditoria-entrega-cvg-aud24-003-2026-09-20.md)  
**Roadmap:** [roadmap CVG-AUD25](roadmap-melhorias-cvg-aud25-2026-09-20.md)  
**Regra:** `DONE` exige known-bad, known-good, receipt current e fingerprint recalculado  
**Estado global inicial:** `FAIL / REJECT / AAA_NOT_PROVEN`

## Catálogo priorizado

| ID | Pri. | Estado inicial | Dependências | Dono | Entrega |
|---|---|---|---|---|---|
| CVG-AUD25-001 | P0 | READY | — | control/evidence | Reabrir AUD24-003 por append, invalidar dependentes e recalcular sujeito. |
| CVG-AUD25-002 | P0 | BLOCKED_BY_DEPENDENCIES | 001 | persistence/security | Mesma conexão para preflight, transação e identidade auditada; contrato integral da role. |
| CVG-AUD25-003 | P0 | BLOCKED_BY_DEPENDENCIES | 002 | database security | Matriz negativa real de autoridade/fingerprint sem BEGIN/DML/mutação. |
| CVG-AUD25-004 | P0 | BLOCKED_BY_DEPENDENCIES | 003 | persistence/data | Corpus semântico completo pelo restore, com contadores pré-conexão. |
| CVG-AUD25-005 | P0 | BLOCKED_BY_DEPENDENCIES | 004 | persistence/data | Oracle independente de origem e conhecido-bom. |
| CVG-AUD25-006 | P0 | BLOCKED_BY_DEPENDENCIES | 004,005 | persistence/data | Falha tardia pelo restore e rollback integral por SQL direto. |
| CVG-AUD25-007 | P0 | BLOCKED_BY_DEPENDENCIES | 003 | database security | Least privilege sem auto-provisionamento/grants amplos. |
| CVG-AUD25-008 | P0 | BLOCKED_BY_DEPENDENCIES | 006,007 | persistence/resilience | Replay, conflito, disconnect e outcome unknown. |
| CVG-AUD25-009 | P0 | BLOCKED_BY_DEPENDENCIES | 001 | evidence/release | Evidence root e snapshots static current. |
| CVG-AUD25-010 | P0 | BLOCKED_BY_DEPENDENCIES | 009 | evidence/release | Exits, transcripts e receipts por subcomando. |
| CVG-AUD25-011 | P0 | BLOCKED_BY_DEPENDENCIES | 001,009,010 | control-plane | Gate integral do DAG e CI obrigatória. |
| CVG-AUD25-012 | P1 | BLOCKED_BY_DEPENDENCIES | 001 | frontend | ESLint real, splitting, budgets e CWV. |
| CVG-AUD25-013 | P1 | BLOCKED_BY_DEPENDENCIES | 012 | frontend QA | Chromium/Firefox/WebKit e a11y local. |
| CVG-AUD25-014 | P1 | BLOCKED_BY_DEPENDENCIES | 001 | observability/SRE | Alertmanager firing/resolved ponta a ponta. |
| CVG-AUD25-015 | P0 | BLOCKED_BY_DEPENDENCIES | 001 | platform/observability | Logs duráveis, retenção, acesso e redaction. |
| CVG-AUD25-016 | P0 | BLOCKED_BY_DEPENDENCIES | 008,011,013,014,015 | database/release | Schema final e gates não mutantes. |
| CVG-AUD25-017 | P0 | BLOCKED_BY_DEPENDENCIES | 002–016 | release | Qualificação local 2× no mesmo fingerprint. |
| CVG-AUD25-018 | P0 | BLOCKED_BY_DEPENDENCIES | 017 | external platform | Staging/providers/secrets/collector/SLO. |
| CVG-AUD25-019 | P0 | BLOCKED_BY_DEPENDENCIES | 017 | accessibility specialist | AT/leitor de tela e zoom manual. |
| CVG-AUD25-020 | P0 | BLOCKED_BY_DEPENDENCIES | 017 | SRE/DR | Carga, chaos, backup/restore e RTO/RPO. |
| CVG-AUD25-021 | P0 | BLOCKED_BY_DEPENDENCIES | 017 | CI/supply chain | Same-digest, imagens, SBOM, scans, assinatura e provenance. |
| CVG-AUD25-022 | P0 | BLOCKED_BY_DEPENDENCIES | 017–021 | fresh critics | Gauntlet técnico F0–F37. |
| CVG-AUD25-023 | P0 | BLOCKED_BY_DEPENDENCIES | 022 | human release authority | F38 e decisão final. |

Os itens 018–021 só mudam para `BLOCKED_EXTERNAL` depois de 017 se a autoridade continuar indisponível. O item 023 só muda para `BLOCKED_HUMAN` depois de 022.

## Contratos P0 de restore e controle

### CVG-AUD25-001 — reabertura e sujeito

- Acrescentar evento/receipt que supersedem o fechamento de `VER-CVG-AUD24-003-003`, sem editar história.
- Reclassificar AUD24-003 como `PARTIAL/REOPEN` e bloquear 004, 007 e dependentes.
- Importar AUD25 e recalcular o manifesto pós-documentação.
- **Known-bad:** state antigo, dependente READY e fingerprint pré-documentação falham.
- **Evidência:** ledger append-only, DAG inteiro e control plane verdes no digest novo.

### CVG-AUD25-002 — conexão transacional autorizada

- Passar o client validado à escrita e liberá-lo somente após COMMIT/ROLLBACK.
- Validar `session_user=current_user=owner` e `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`.
- Validar membership positiva do schema-owner e negativa do runtime; ler migrations no mesmo client.
- Gravar no journal apenas identidade/fingerprint desse client.
- **Known-bad:** pool retorna owner no primeiro connect e outro principal no segundo; segundo connect, BEGIN e DML são proibidos.

### CVG-AUD25-003 — matriz PostgreSQL de autoridade

- Criar destinos isolados para executor divergente, owner divergente, cada atributo proibido, owner sem membership, runtime com membership e migration drift.
- Chamar `restore()` em todos os casos e observar PID/transação/estado por conexão independente.
- **Known-bad:** erro tipado, zero BEGIN/DML persistente e hash direto idêntico por caso.
- **Known-good:** role exata/membership mínima passa sem grants auxiliares.

### CVG-AUD25-004 — corpus pré-conexão

- Passar pelo `restore()` mutantes de forma, digest, tenant, escopo, sequência, fence, lease, FK lógica e manifest/migration.
- Instrumentar `connect`, BEGIN e DML; inválidos independentes do destino exigem `connect=0`.
- **Evidência:** tabela mutante→erro→contadores→hash do destino.

### CVG-AUD25-005 — origem e conhecido-bom

- Fotografar origem antes da janela auditada ou preparar fixture fora dela.
- Consultar diretamente origem/destino e comparar digests por relação.
- Exigir revision 1, quarentena, fences/histórico íntegros, leases ausentes e login/readiness bloqueados.

### CVG-AUD25-006 — rollback direto

- Injetar falha pelo `restore()` depois de projeções reais e antes de COMMIT.
- Comparar por SQL direto snapshots, journal, audit/receipt e ledgers, outbox, usage, inbox, efeitos, jobs, sessões, turns, checkpoints, leases e sequences.
- Proibir `exportRecoveryBundle()` como oracle de atomicidade.
- **Evidência:** duas rodadas com ponto de falha e hashes antes/depois.

### CVG-AUD25-007 — least privilege

- Remover `GRANT ... ON ALL TABLES/SEQUENCES` e criação/alteração de roles dos verificadores.
- Migrations/default privileges são a única autoridade.
- Provar negações a runtime, objeto futuro e membership indevida em clean install/upgrade.

### CVG-AUD25-008 — retry e outcome unknown

- Especificar replay idempotente, destino não vazio, concorrência, queda antes/depois do commit e reconciliação de outcome unknown.
- **Known-bad:** duplicidade, revisão dupla ou retry cego após resultado incerto falha.

### CVG-AUD25-009 — static/evidence root

- Separar bytes candidatos de evidência; classificar snapshots históricos fora do gate promovível.
- Renovar sete snapshots com SHA, tempos e digest coerentes.
- **Known-bad:** stale SHA/time/artifact falha isoladamente.

### CVG-AUD25-010 — receipts e exits

- Preservar comando, exit, duração, stdout/stderr digest, ambiente permitido, artifact digest e cleanup por subcomando.
- Não colapsar filho falho/bloqueado em `PASS` nem descartar stdout bem-sucedido.

### CVG-AUD25-011 — control plane integral

- Validar todo o DAG, ponteiros, supersedes, ação ativa, estado derivado e sujeito recalculado.
- Integrar gates à CI sem mutar o candidate root.

## Qualidade e operação local

- **CVG-AUD25-012:** ESLint TypeScript/React Hooks/jsx-a11y, splitting, budgets e CWV; known-bads de rule/bundle/budget.
- **CVG-AUD25-013:** Chromium, Firefox e WebKit sem retries; axe, teclado, foco, reduced motion e zoom automatizável.
- **CVG-AUD25-014:** drill Prometheus→Alertmanager→receiver para firing/resolved e rotas negativas.
- **CVG-AUD25-015:** logs duráveis com restart, retenção, consulta, correlação, acesso auditado e redaction por valor.
- **CVG-AUD25-016:** clean install, upgrades N-2/N-1/N, readiness, restore, privilégios e recovery; gates não mutantes.
- **CVG-AUD25-017:** duas matrizes completas, independentes, sem retry/skip relevante, no mesmo fingerprint; zero P0/P1 local.

## Externo e encerramento

- **CVG-AUD25-018:** staging/providers/secrets/collector/SLO no mesmo candidato.
- **CVG-AUD25-019:** leitor de tela/AT e zoom manual por especialista.
- **CVG-AUD25-020:** carga production-like, chaos e DR gerenciado com RTO/RPO.
- **CVG-AUD25-021:** CI same-digest, imagens, SBOM, scans, assinatura, provenance e smoke.
- **CVG-AUD25-022:** críticos frescos, mutation sentinel, red teams F23/F24 e F0–F37 em PASS, zero alto/crítico.
- **CVG-AUD25-023:** decisão humana `APPROVE`, `REJECT` ou `DEFER`, vinculada ao candidato; agentes não podem produzi-la.

## Cobertura F0–F38

| Faixa | Donos AUD25 | Estado inicial |
|---|---|---|
| F0/F36/F37 auditoria e repair | 022 | BLOCKED_BY_DEPENDENCIES |
| F1/F2/F7/F8/F18/F25 dados, DB e recovery | 002–008,016,017,022 | REOPEN |
| F3–F6/F11/F12 integrações e authorities | 018,020 | BLOCKED_BY_DEPENDENCIES |
| F9/F10 worker/backpressure | 012,017,018,020 | IMPLEMENTED_UNVERIFIED |
| F13/F14 observability/alerts | 014,015,018 | TODO_LOCAL |
| F15–F17/F19/F20 carga, chaos e recovery | 005,006,015,020 | BLOCKED_BY_DEPENDENCIES |
| F21/F22 browser/a11y | 013,019 | TODO_LOCAL |
| F23/F24 red teams | 022 | BLOCKED_BY_DEPENDENCIES |
| F26/F27 usage/export | 015–018 | IMPLEMENTED_UNVERIFIED |
| F28–F35 CI/release/container/config/runbooks | 001,009–011,018,020,021 | REOPEN/BLOCKED_BY_DEPENDENCIES |
| F38 aprovação humana | 023 | BLOCKED_BY_DEPENDENCIES |

## Próxima ação única

`CVG-AUD25-001:REOPEN-AUTHORITY-CONTROL` — reconciliar append-only o falso fechamento de AUD24-003, invalidar seus dependentes e registrar o fingerprint pós-documentação; depois ativar `CVG-AUD25-002:SAME-CONNECTION-RESTORE-AUTHORITY`.
