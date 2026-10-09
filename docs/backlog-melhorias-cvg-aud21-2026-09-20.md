# Backlog de melhorias — CVG-AUD21

> **SUPERSEDED em 2026-09-20:** este catálogo é histórico. Status e próxima ação correntes estão no [backlog CVG-AUD22](backlog-melhorias-cvg-aud22-2026-09-20.md); receipts AUD21 permanecem preservados como evidência histórica, não como aprovação.

**Fonte:** [reauditoria CVG-AUD20](auditoria-resultado-cvg-aud20-2026-09-20.md)
**Roadmap:** [roadmap CVG-AUD21](roadmap-melhorias-cvg-aud21-2026-09-20.md)
**Ordem:** risco e dependência
**Regra:** `DONE` exige known-bad, known-good e receipt do fingerprint exato

## Catálogo priorizado

| ID | Pri. | Tam. | Estado inicial | Dep. | Entrega |
|---|---|---:|---|---|---|
| CVG-AUD21-001 | P0 | S | READY | — | Conter promoção e reconciliar os falsos `DONE` append-only. |
| CVG-AUD21-002 | P0 | L | READY | 001 | Fechar terminalidade de leases e autoridade separada de restore. |
| CVG-AUD21-003 | P0 | M | READY | 001 | Tornar toda combinação contraditória de IDs `DIVERGENT`. |
| CVG-AUD21-004 | P0 | M | READY | 001,003 | Fechar wrappers assíncronos no gate universal de PDP. |
| CVG-AUD21-005 | P0 | M | READY | 001 | Cancelar outbox ponta a ponta e impedir sucesso/ack pós-abort. |
| CVG-AUD21-006 | P0 | L | READY | 001 | Substituir schemas web permissivos e corrigir a rota Knowledge. |
| CVG-AUD21-007 | P1 | M | READY | 006 | Completar prova StrictMode/unmount/error/abort da busca. |
| CVG-AUD21-008 | P1 | M | READY | 006 | Inventário tipado/AST exato de endpoints e contratos. |
| CVG-AUD21-009 | P1 | M | READY | 006,007 | Boundary observável, correlacionado e acessível. |
| CVG-AUD21-010 | P1 | M | READY | 002 | TTL determinístico com dois pools e 20 repetições. |
| CVG-AUD21-011 | P0 | L | READY | 002,010 | Matriz PostgreSQL adversarial e privilégios sem grants auxiliares. |
| CVG-AUD21-012 | P1 | L | READY | 002,005 | Matriz worker com crash e restart reais. |
| CVG-AUD21-013 | P1 | L | READY | 002 | Recovery semântico e atomicidade contra corpus adulterado. |
| CVG-AUD21-014 | P0 | M | READY | 002,010,011,013 | Requalificar migrations 042/043, readiness e clean install/upgrade. |
| CVG-AUD21-015 | P1 | L | READY | 006–009 | ESLint/a11y, splitting, budgets e CWV. |
| CVG-AUD21-016 | P1 | M | READY | 001 | Drill local Prometheus→Alertmanager→receiver. |
| CVG-AUD21-017 | P0 | XL | READY | 001 | Logs duráveis, consulta, retenção e redaction por valor. |
| CVG-AUD21-018 | P0 | L | READY | 001 | Manifesto/fingerprint reproduzível do candidato. |
| CVG-AUD21-019 | P0 | M | READY | 018 | Corrigir exit externo e evidence root fora do source. |
| CVG-AUD21-020 | P0 | L | READY | 018,019 | Control plane completo, testado e obrigatório na CI. |
| CVG-AUD21-021 | P1 | S | READY | 001 | Higiene de diff e gates não mutantes. |
| CVG-AUD21-022 | P0 | XL | BLOCKED_BY_DEPENDENCIES | 002–021 | Qualificação local duas vezes no mesmo fingerprint. |
| CVG-AUD21-023 | P0 | XL | BLOCKED_EXTERNAL | 022 | Staging, providers, secrets e observabilidade reais. |
| CVG-AUD21-024 | P0 | L | BLOCKED_EXTERNAL | 022 | Browser completo, AT e zoom no mesmo candidato. |
| CVG-AUD21-025 | P0 | XL | BLOCKED_EXTERNAL | 022,023 | Carga, chaos, backup, recovery e RTO/RPO. |
| CVG-AUD21-026 | P0 | L | BLOCKED_EXTERNAL | 022 | CI, imagens, SBOM, scans, provenance e container smoke same-SHA. |
| CVG-AUD21-027 | P0 | L | BLOCKED_BY_DEPENDENCIES | 022–026 | Red teams F23/F24 e fechamento técnico F0–F37. |
| CVG-AUD21-028 | P0 | S | BLOCKED_HUMAN | 027 | Decisão humana F38 e fechamento global 39/39. |

## Contratos de aceite

### CVG-AUD21-001 — contenção e reconciliação

- Reabrir 001, 002, 006, 007, 009, 012 e 013 sem editar eventos/receipts antigos.
- Alinhar estado, backlog, ExecPlan, checkpoint, last event e current evidence numa única próxima ação.
- Preservar `AAA_NOT_PROVEN` e bloquear promoção.
- **Prova:** parser JSON/JSONL, IDs/refs únicos, transições explícitas e comparação manual dos ponteiros enquanto 020 não estiver pronto.

### CVG-AUD21-002 — terminalidade e restore

- `acquireLease`, `renewLease` e qualquer operação que crie ou estenda autoridade exigem sessão `ACTIVE` em memory e PostgreSQL.
- Completion invalida/rejeita autoridade de lease; release pode ser cleanup idempotente, mas nunca reativa ou estende a sessão.
- Restore usa papel/procedure distinto do runtime e do owner genérico, transação atômica e auditoria.
- **Known-bad:** complete→renew; owner escrevendo em sessão terminal arbitrária; runtime criando restore state.

### CVG-AUD21-003 — identidade autoritativa

- Definir precedência de resolução sem vazar existência e sem mascarar divergência.
- Todo desacordo entre `resourceId`, `patientId` e `encounterId` retorna `DIVERGENT` antes de tool/provider.
- **Prova:** matriz cartesiana existente/inexistente, patient/encounter, tenant, unit e workspace; provider/tool calls iguais a zero nos inválidos.

### CVG-AUD21-004 — PDP universal

- Handler só é considerado síncrono quando a estrutura é comprovada.
- Callback sink desconhecido, `Promise.then/catch/finally`, timers, microtasks e wrappers deslocados falham fechado.
- **Prova:** mutantes por forma assíncrona mais inspeção runtime das rotas; remover decisão deve derrubar o gate.

### CVG-AUD21-005 — cancelamento autoritativo

- Sinal de `runCycle()` alcança relay, sink, mapper e provider.
- Revalidar abort e fence depois do await externo e antes de outcome/ack.
- Abort após possível dispatch produz estado reconciliável, nunca sucesso presumido.
- **Prova:** before-send, during-send, after-provider-before-outcome, before-ack, stop e timeout.

### CVG-AUD21-006 — contratos web semânticos

- Usar schemas canônicos estritos para todas as famílias consumidas.
- UUID/enums/timestamps/inteiros/centavos/versões e nested objects devem ser validados.
- Parsing não remove campos consumidos; `Knowledge` preserva e valida source/dataClass/createdAt.
- **Prova:** property/fixture known-bad por família e E2E Knowledge Chromium+Firefox.

### CVG-AUD21-007 — lifecycle da busca

- Component test usa `StrictMode` real, unmount em voo, resposta invertida, erro e abort.
- A execução corrente sempre encerra loading; execução obsoleta nunca altera estado.
- **Prova:** teste de componente e Playwright sem retries nos dois engines locais.

### CVG-AUD21-008 — catálogo de endpoints

- Fonte tipada/AST liga método, path, request e response schema ao catálogo canônico.
- Detectar ausente, duplicata, verbo incorreto, placeholder espúrio e alias inesperado.
- **Prova:** snapshots e mutantes discriminantes; nenhuma janela regex fixa.

### CVG-AUD21-009 — root boundary

- Erro de render emite evento redigido com correlation ID próprio.
- Foco, `role=alert`, teclado, retry/home e recuperação são exercitados.
- **Prova:** throw controlado, inspeção de telemetria, axe e screenshot em Chromium+Firefox.

### CVG-AUD21-010 — TTL determinístico

- Eliminar TTL de 80 ms dependente de roundtrip.
- Exercitar antes/no limite/depois do vencimento com dois pools e owners.
- **Prova:** 20 rodadas sem flake e relógio/avanço controlado ou primitiva DB determinística documentada.

### CVG-AUD21-011 — matriz PostgreSQL

- Cobrir fence stale/future/historical, expirada/terminal, tenant, conexões concorrentes, tabela/sequence futura e roles separados.
- Nenhum `GRANT ON ALL ...` pode ser introduzido pelo harness para fabricar o resultado.
- **Prova:** instalação limpa e upgrade em PostgreSQL 16 descartável, matriz de privilégios exata.

### CVG-AUD21-012 — worker crash/restart

- Crash antes/depois do efeito, antes/depois do commit e ack, restart real, lease loss, duplicidade, poison retryable e outcome unknown.
- **Prova:** processo/container real, contagem de tentativas/efeitos e ledger/reconciliação; monkeypatch isolado não fecha o item.

### CVG-AUD21-013 — recovery semântico

- Recalcular checkpoint digest por schema+payload.
- Validar `session.checkpointDigest`, FKs lógicas, sequências, tenants e fences.
- Corrupção re-hasheada do envelope deve falhar e deixar destino inalterado.
- **Prova:** corpus adulterado e restore conhecido-bom atômico.

### CVG-AUD21-014 — requalificação de schema

- Reprovar migrations N-2/N-1 e aceitar somente N com smoke runtime.
- Provar 042/043 em clean install e upgrade sem privilégios auxiliares.
- **Prova:** duas execuções current/exact-subject de schema gates, terminal guards e future privileges.

### CVG-AUD21-015 — toolchain e performance web

- ESLint TypeScript/React Hooks/jsx-a11y real; retries zero.
- Code splitting e budgets JS/CSS fail-closed.
- Lighthouse/CWV e contraste derivados de UI/tokens.
- **Prova:** um known-bad por gate e artefatos ligados ao fingerprint.

### CVG-AUD21-016 — alert drill

- Prometheus entrega `firing` e `resolved` a receiver sintético.
- Indisponibilidade é detectada; regra, rota e runbook são correlacionados.
- **Prova:** transcript e known-bad removendo/quebrando receiver.

### CVG-AUD21-017 — logs duráveis e redaction

- Backend persistente com health, retenção, consulta por correlation ID, acesso auditado e restart survival.
- Redaction por classificação/padrão de valor, não apenas por chave.
- **Prova:** corpus e-mail/bearer/API key/secret sob nomes benignos, restart e query.

### CVG-AUD21-018 — fingerprint exato

- Manifesto cobre commit, tracked diff, untracked relevante, lockfile, configuração e hashes.
- Algoritmo/versionamento são públicos e reproduzíveis em checkout limpo.
- **Prova:** alterar qualquer byte relevante invalida receipt; bytes irrelevantes são declarados.

### CVG-AUD21-019 — gates externos

- Pré-requisitos são avaliados antes de qualquer escrita.
- `BLOCKED_EXTERNAL` retorna exit 2 ou outro não zero documentado.
- Evidência externa fica fora do source e sempre nomeia o candidato.
- **Prova:** matriz subprocess PASS/FAIL/BLOCKED e source fingerprint imutável.

### CVG-AUD21-020 — control plane completo

- Validar conteúdo do ExecPlan, action, checkpoint, last event, current evidence, fingerprint, refs, status transitions e timestamps de state/backlog/JSONL.
- `DONE` requer evidence refs atuais e contrato satisfeito.
- **Prova:** unit known-bad por relação, gate na CI e live state verde somente depois de 018/019.

### CVG-AUD21-021 — higiene e não mutação

- `git diff --check` obrigatório; remover os três whitespaces atuais.
- Classificar gates mutantes e executar artefatos fora do source quando possível.
- **Prova:** diff limpo e mutation sentinel entre gates.

### CVG-AUD21-022 — qualificação local

- Todos 002–021 fechados; nenhuma dependência P0/P1 local aberta.
- Matriz integral passa duas vezes, sem retries, no mesmo fingerprint.
- **Prova:** manifesto único, logs brutos, receipts por gate e sentinel estável.

### CVG-AUD21-023 — staging e verticais reais

- DeepSeek/provider/secret authority e observabilidade staging no candidato 022.
- **Prova:** receipts externos verificáveis; ausência não conta como pass.

### CVG-AUD21-024 — browser e acessibilidade reais

- Chromium, Firefox, WebKit, AT e zoom no candidato 022.
- **Prova:** matriz completa, axe, teclado, leitor de tela e artefatos visuais.

### CVG-AUD21-025 — carga, chaos e continuidade

- Perfil de carga pré-declarado, chaos infra, backup/restore gerenciado e medição RTO/RPO.
- **Prova:** resultados production-like e rollback exercitado.

### CVG-AUD21-026 — CI e supply chain

- CI, SBOM, imagens, scans, provenance e container smoke no mesmo SHA/fingerprint.
- **Prova:** shutdown, outbox replay, restart e pressão de recursos ligados aos artefatos promovíveis.

### CVG-AUD21-027 — críticas finais

- F23 e F24 em relatórios separados; depois crítica fresca de todos os gates técnicos F0–F37.
- Barra congelada, objeto imutável, mutation sentinel e assinatura verificável.
- **Aceite:** zero achado alto/crítico e 38/38 fases técnicas F0–F37 em PASS; F38 permanece `BLOCKED_HUMAN` até 028.

### CVG-AUD21-028 — decisão humana

- Autoridade nomeada registra `APPROVE`, `REJECT` ou `DEFER`, escopo, riscos, rollback e validade.
- Atestação criptográfica liga a decisão ao candidato final.
- Nenhum agente pode autoaprovar.
- **Aceite:** F38 passa somente com atestação válida; então, e somente então, o fechamento global pode declarar 39/39 fases em `PASS`.

## Rastreabilidade achado → tarefas

| Achado AUD21 | Tarefas de fechamento |
|---|---|
| 001 control plane false-green | 001,018–021,022 |
| 002 terminalidade/restore | 002,010,011,014,022 |
| 003 wrapper PDP | 004,022 |
| 004 sucesso pós-abort | 005,012,022 |
| 005 divergência de identidade | 003,004,022 |
| 006 contratos/crash web | 006,008,015,022 |
| 007 prova StrictMode incompleta | 007,022 |
| 008 proveniência/exit | 018–020,022,026 |
| 009 recovery/TTL/matrizes | 010–014,022,025 |
| 010 boundary/toolchain/ops | 009,015–017,022–025 |
| 011 diff vermelho | 021,022 |

## Subgates executáveis da barra v4 — F0–F38

Cada fase abaixo é um gate independente. O dono deve anexar comando/procedimento, ambiente, início/fim, exit, logs brutos, subject fingerprint e limitações. Ausência, `NOT_RUN`, `PARTIAL`, stale evidence ou bloqueio nunca vira `PASS` por agregação.

| Fase | Donos AUD21 | Evidência mínima de aceite | Estado inicial |
|---|---|---|---|
| F0 reauditoria final | 027 | Crítica fresca sobre objeto congelado, barra íntegra e zero alto/crítico. | BLOCKED_BY_DEPENDENCIES |
| F1 PDP universal | 003,004,022 | Catálogo completo; mutantes de rota, wrapper e microtask; decisão antes do efeito. | TODO_LOCAL |
| F2 authoritative writes | 002,003,011,014,022 | Matriz de estados/escopos, transação, fence e backstop PostgreSQL. | TODO_LOCAL |
| F3 DeepSeek harness real | 023 | Processo/modelo autorizado, identidade de versão e transcript real same-candidate. | BLOCKED_EXTERNAL |
| F4 DeepSeek failure matrix | 023,025 | Timeout, abort, payload inválido, crash/restart, indisponibilidade e fallback fail-closed. | BLOCKED_EXTERNAL |
| F5 provider externo real | 005,023 | Envio/callback/receipt/reconciliação real; nenhuma fixture usada como autoridade. | BLOCKED_EXTERNAL |
| F6 provider chaos | 005,012,023,025 | Latência, timeout, rede, duplicidade, resposta ambígua e recovery reconciliado. | BLOCKED_EXTERNAL |
| F7 idempotência concorrente | 011,012,022 | Dois processos, mesma chave, digest igual/divergente, replay, fence e zero efeito duplicado. | TODO_LOCAL |
| F8 PostgreSQL multi-instance | 002,010,011,014,022 | Dois pools/processos, roles reais, RLS, TTL, schema e privilégios sem grant auxiliar. | TODO_LOCAL |
| F9 worker handlers reais | 005,012,023 | Handlers de negócio, efeitos reais, ack durável, restart e ledger. | TODO_LOCAL + BLOCKED_EXTERNAL |
| F10 backpressure | 012,015,025 | Pressão de outbox/jobs/pool, rejeição bounded, drain e métricas. | TODO_LOCAL + BLOCKED_EXTERNAL |
| F11 secret authority real | 023 | KMS/Vault autorizado, rotação, negação, auditoria e nenhum segredo em source/log. | BLOCKED_EXTERNAL |
| F12 WebAuthn/break-glass real | 023 | Ceremony WebAuthn, autoridade independente, escopo, expiração, revogação e trilha. | BLOCKED_EXTERNAL |
| F13 observability staging | 009,016,017,023 | Traces, métricas e logs persistentes correlacionados no staging candidato. | TODO_LOCAL + BLOCKED_EXTERNAL |
| F14 alert delivery real | 016,023 | Drill local firing/resolved e entrega a receiver real autorizado, com indisponibilidade detectada. | TODO_LOCAL + BLOCKED_EXTERNAL |
| F15 SLO measurements | 016,017,023,025 | SLI medido, janela, target, budget, burn rate e alerta sob tráfego representativo. | BLOCKED_EXTERNAL |
| F16 load production-like | 010,012,015,025 | Perfil pré-declarado, thresholds, banco/worker/UI e resultados production-like. | TODO_LOCAL + BLOCKED_EXTERNAL |
| F17 chaos infra | 012,025 | Falhas de processo, rede, banco e dependências; contenção e recuperação observadas. | BLOCKED_EXTERNAL |
| F18 recovery real | 013,025 | Restore gerenciado do candidato, corpus íntegro e reconciliação de efeitos. | TODO_LOCAL + BLOCKED_EXTERNAL |
| F19 RTO/RPO | 025 | Cronometragem e perda de dados medidas contra targets aprovados. | BLOCKED_EXTERNAL |
| F20 backup operacional | 013,025 | Backup agendado, retenção, cifra, restore e purge exercitados. | TODO_LOCAL + BLOCKED_EXTERNAL |
| F21 full browser matrix | 006–009,015,024 | Chromium, Firefox e WebKit nas jornadas críticas, sem retries. | TODO_LOCAL + BLOCKED_EXTERNAL |
| F22 accessibility real | 009,015,024 | Axe, teclado, zoom e leitor de tela com resultados por jornada. | TODO_LOCAL + BLOCKED_EXTERNAL |
| F23 security red-team | 027 | Relatório independente de segurança, exploits/negativas e zero alto/crítico. | BLOCKED_BY_DEPENDENCIES |
| F24 DB security red-team | 027 | Relatório separado de RLS, roles, grants, restore/fence e injeção. | BLOCKED_BY_DEPENDENCIES |
| F25 audit immutability | 011,017,020,022,027 | WORM/append-only; update/delete/rechain/timestamp adulterado rejeitados; cadeia e acesso auditado verificados. | TODO_LOCAL |
| F26 usage settlement | 022,023 | Reserva, medição, preço/proveniência real, estimate×actual, discrepância e reconciliação sem custo inventado. | TODO_LOCAL + BLOCKED_EXTERNAL |
| F27 export hardening | 017,022,023 | Matriz negativa de purpose/escopo/TTL/cifra/redaction/revogação, trilha e armazenamento autorizado. | TODO_LOCAL + BLOCKED_EXTERNAL |
| F28 CI do mesmo SHA | 018,020,026 | CI remoto referencia o mesmo commit/fingerprint e publica logs verificáveis. | TODO_LOCAL + BLOCKED_EXTERNAL |
| F29 release provenance | 018,026 | Commit, diff, SBOM, imagens, scans, assinaturas e staging ligados no manifesto. | TODO_LOCAL + BLOCKED_EXTERNAL |
| F30 container smoke real | 026 | API/web/worker reais: startup, health, shutdown, outbox replay e restart. | BLOCKED_EXTERNAL |
| F31 resource pressure test | 012,015,025,026 | CPU/memória/disco/pool/fila sob pressão, limites e recuperação medidos. | BLOCKED_EXTERNAL |
| F32 security headers real | 023,026 | TLS/CSP/HSTS/cookies/CORS/headers observados no endpoint staging, não só em config. | BLOCKED_EXTERNAL |
| F33 production config fail-closed | 019,023,026 | Matriz subprocess/container rejeita placeholder, ausência e combinação insegura com exit não zero. | TODO_LOCAL + BLOCKED_EXTERNAL |
| F34 staging promotion model | 018,019,023,026 | Promote/rollback do mesmo digest, sem rebuild, com autoridade segregada e evidência fora do source. | BLOCKED_EXTERNAL |
| F35 runbook execution | 016,017,023,025,026 | Sete transcripts: alerta, outage de provider, rotação de segredo, backup, restore, rollback e incidente de segurança. | TODO_LOCAL + BLOCKED_EXTERNAL |
| F36 final gauntlet | 027 | Críticos frescos, separados, barra congelada, mutation sentinel e scorecard final. | BLOCKED_BY_DEPENDENCIES |
| F37 repair loop | 027 | Cada achado possui owner, correção, known-bad/known-good, reexecução e nova crítica. | BLOCKED_BY_DEPENDENCIES |
| F38 human approval gate | 028 | Atestação criptográfica APPROVE/REJECT/DEFER ligada ao candidato e rollback. | BLOCKED_HUMAN |
