# Backlog de melhorias — CVG-AUD20

> **Superseded como catálogo corrente:** os estados executados foram auditados em [Reauditoria CVG-AUD20](auditoria-resultado-cvg-aud20-2026-09-20.md). A retomada autoritativa está no [backlog AUD21](backlog-melhorias-cvg-aud21-2026-09-20.md); este catálogo preserva o contrato e o histórico AUD20.

**Fonte:** [reauditoria CVG-AUD19](auditoria-resultado-cvg-aud19-2026-09-20.md)  
**Ordem:** risco e dependência  
**Regra:** `DONE` exige known-bad, known-good e receipt do fingerprint exato

## Catálogo priorizado

| ID | Pri. | Tam. | Estado inicial | Dep. | Entrega |
|---|---|---:|---|---|---|
| CVG-AUD20-001 | P0 | S | READY | — | Reconciliar control plane e bloquear promoção. |
| CVG-AUD20-002 | P0 | M | READY | 001 | Fechar terminalidade e autoridade de restore. |
| CVG-AUD20-003 | P0 | S | READY | 001 | Corrigir default privileges do runtime. |
| CVG-AUD20-004 | P0 | S | READY | 002,003 | Readiness sensível ao schema atual. |
| CVG-AUD20-005 | P0 | M | READY | 002–004 | Matriz de fence/terminalidade/privilégios. |
| CVG-AUD20-006 | P0 | M | READY | 001 | Rejeitar IDs divergentes ponta a ponta. |
| CVG-AUD20-007 | P0 | M | READY | 006 | Reparar gate universal de PDP. |
| CVG-AUD20-008 | P1 | M | READY | 002,004 | TTL/concurrency determinísticos. |
| CVG-AUD20-009 | P0 | M | READY | 001 | Propagar cancelamento ao provider. |
| CVG-AUD20-010 | P1 | L | READY | 002,009 | Completar matriz worker/crashes. |
| CVG-AUD20-011 | P1 | M | READY | 002 | Validar recovery semanticamente. |
| CVG-AUD20-012 | P0 | S | READY | 001 | Corrigir busca sob StrictMode. |
| CVG-AUD20-013 | P0 | L | READY | 001 | Substituir schemas permissivos. |
| CVG-AUD20-014 | P1 | M | READY | 013 | Inventário de endpoints exato. |
| CVG-AUD20-015 | P1 | M | READY | 012,013 | Provar RootErrorBoundary/correlação. |
| CVG-AUD20-016 | P1 | L | READY | 012–015 | ESLint, a11y, budgets e CWV. |
| CVG-AUD20-017 | P1 | M | READY | 001 | Drill local de Alertmanager; entrega real fica em 023/F14. |
| CVG-AUD20-018 | P0 | L | READY | 001 | Logs duráveis e redaction. |
| CVG-AUD20-019 | P0 | L | READY | 001 | Fingerprint/receipts reproduzíveis. |
| CVG-AUD20-020 | P0 | S | READY | 019 | Corrigir semântica do gate externo. |
| CVG-AUD20-021 | P0 | M | READY | 019,020 | Reconciliar state/backlog/plan/receipts. |
| CVG-AUD20-022 | P0 | XL | BLOCKED_BY_DEPENDENCIES | 002–021 | Qualificação local integrada. |
| CVG-AUD20-023 | P0 | XL | BLOCKED_EXTERNAL | 022 | Staging, providers e recovery gerenciado. |
| CVG-AUD20-024 | P0 | M | BLOCKED_BY_DEPENDENCIES | 022,023 | Crítica final independente. |
| CVG-AUD20-025 | P0 | S | BLOCKED_HUMAN | 024 | Decisão humana de release. |

## Rastreabilidade achado → tarefas

| Achado da auditoria | Tarefas de fechamento |
|---|---|
| AUD20-001 — divergência de identidade | CVG-AUD20-006, 007, 022 |
| AUD20-002 — escrita pós-terminal | CVG-AUD20-002, 005, 022 |
| AUD20-003 — bypass do fence de restore | CVG-AUD20-002, 005, 011, 022 |
| AUD20-004 — default privileges amplos | CVG-AUD20-003, 005, 022 |
| AUD20-005 — readiness em schema incompleto | CVG-AUD20-004, 005, 022 |
| AUD20-006 — gate universal de PDP vermelho | CVG-AUD20-007, 022 |
| AUD20-007 — cancelamento não chega ao provider | CVG-AUD20-009, 010, 022 |
| AUD20-008 — busca quebra sob StrictMode | CVG-AUD20-012, 022 |
| AUD20-009 — schemas frontend permissivos | CVG-AUD20-013, 014, 022 |
| AUD20-010 — proveniência não vincula bytes | CVG-AUD20-019, 020, 021, 022 |
| AUD20-011 — recovery/worker abaixo do contrato | CVG-AUD20-010, 011, 022 |
| AUD20-012 — TTL instável | CVG-AUD20-008, 022 |
| AUD20-013 — error boundary sem aceite | CVG-AUD20-015, 022 |
| AUD20-014 — observabilidade/performance/a11y | CVG-AUD20-016, 017, 018, 022, 023 |

`CVG-AUD20-001` é a contenção transversal do programa; `024` e `025` são os gates finais aplicáveis a todos os achados.

## Cobertura obrigatória da barra v4 — F0–F38

Cada linha abaixo é um subgate independente: ausência, falha, stale evidence ou `NOT_RUN` reprova `CVG-AUD20-022`/`023` conforme o ambiente. `PASS` exige artefato executável ligado ao mesmo fingerprint; uma tarefa agregadora não pode mascarar uma linha vermelha.

| Fase | Tarefa(s) | Gate e evidência mínima | Estado inicial |
|---|---|---|---|
| F0 reauditoria final | 024 | Relatório independente assinado, barra congelada e objeto imutável. | BLOCKED_BY_DEPENDENCIES |
| F1 PDP universal | 006,007,022 | Catálogo completo, known-bad por wrapper/rota e PDP antes do efeito. | TODO_LOCAL |
| F2 authoritative writes | 002,005,006,022 | Matriz de escritas, terminalidade, tenant, transação e backstop DB. | TODO_LOCAL |
| F3 DeepSeek real | 023 | Processo/modelo real autorizado, receipts e identidade de versão. | BLOCKED_EXTERNAL |
| F4 DeepSeek failure matrix | 023 | Timeout, abort, indisponibilidade, payload inválido, restart e fallback fail-closed. | BLOCKED_EXTERNAL |
| F5 provider externo real | 009,023 | Vertical real, callback/receipt/reconciliação e nenhuma fixture sintética. | BLOCKED_EXTERNAL |
| F6 provider chaos | 009,010,023 | Latência, timeout, duplicidade, resposta ambígua, perda de rede e recovery. | BLOCKED_EXTERNAL |
| F7 idempotência concorrente | 005,010,022 | Multi-instância, mesmo comando, digest divergente, replay e fence. | TODO_LOCAL |
| F8 PostgreSQL multi-instance | 003,004,005,008,022 | Dois pools/processos, roles reais, RLS, TTL, schema e privilégios. | TODO_LOCAL |
| F9 worker handlers reais | 009,010,022,023 | Handlers de negócio + efeitos reais, ack/ledger/restart. | TODO_LOCAL + EXTERNAL |
| F10 backpressure | 010,022,023 | Limites de jobs/outbox, rejeição, drain e métricas sob pressão. | TODO_LOCAL + EXTERNAL |
| F11 secret authority real | 023 | KMS/Vault/authority real, rotação, negação e auditoria. | BLOCKED_EXTERNAL |
| F12 WebAuthn/break-glass real | 023 | Ceremony real, escopo, expiração, revogação e trilha. | BLOCKED_EXTERNAL |
| F13 observability staging | 017,018,023 | Traces, metrics e logs correlacionados e persistentes em staging. | TODO_LOCAL + EXTERNAL |
| F14 alert delivery real | 017,023 | Drill local sintético e entrega firing/resolved a receiver real autorizado. | TODO_LOCAL + EXTERNAL |
| F15 SLO measurements | 016,017,018,023 | SLI medido, janela, budget, burn rate e alerta sobre tráfego representativo. | BLOCKED_EXTERNAL |
| F16 load production-like | 008,010,016,022,023 | Perfil pré-declarado, thresholds, banco/worker/UI e resultados production-like. | TODO_LOCAL + EXTERNAL |
| F17 chaos infra | 009,010,023 | Falhas de rede/processo/banco/provider e recovery observável. | BLOCKED_EXTERNAL |
| F18 recovery real | 002,011,023 | Backup/restore real, corrupção, isolamento e autoridade separada. | TODO_LOCAL + EXTERNAL |
| F19 RTO/RPO | 023 | Cronometragem e perda de dados medidas contra targets aprovados. | BLOCKED_EXTERNAL |
| F20 backup operacional | 011,023 | Agenda, retenção, restauração, monitoramento e ownership. | BLOCKED_EXTERNAL |
| F21 browser matrix | 012–016,022,023 | Chromium/Firefox locais; WebKit no runner externo; viewports/stress sem retries. | TODO_LOCAL + EXTERNAL |
| F22 accessibility real | 015,016,023 | Axe/keyboard local e AT/zoom real com evidência humana/runner. | TODO_LOCAL + EXTERNAL |
| F23 security red team | 024 | Relatório separado de app/API/IA, explorações, reteste e assinatura. | BLOCKED_BY_DEPENDENCIES |
| F24 DB security red team | 003–005,024 | Relatório separado de DB/RLS/roles/fence/restore, reteste e assinatura. | BLOCKED_BY_DEPENDENCIES |
| F25 audit immutability | 003,005,019,022,023 | Append-only/tamper chain, concorrência e prova staging sem privilégio de bypass. | TODO_LOCAL + EXTERNAL |
| F26 usage settlement | 010,019,022,023 | Ledger, pricing/version, reconciliação, divergência e provider real. | TODO_LOCAL + EXTERNAL |
| F27 export hardening | 011,019,022,023 | Escopo, criptografia, digest, expiração, redaction e importação adversarial. | TODO_LOCAL + EXTERNAL |
| F28 CI do mesmo SHA | 019,021,023 | Run CI identifica exatamente fingerprint/imagens/testes sem drift. | TODO_LOCAL + EXTERNAL |
| F29 release provenance | 019,023 | Attestation de source, builder, imagens, deps e ambiente verificável. | TODO_LOCAL + EXTERNAL |
| F30 container smoke real | 009,010,023 | Startup, health, shutdown, outbox replay e restart em imagens candidatas. | BLOCKED_EXTERNAL |
| F31 resource pressure | 008,010,016,023 | CPU/memória/disco/conexões/backlog sob limites e degradação segura. | BLOCKED_EXTERNAL |
| F32 security headers real | 016,023 | Headers/TLS/CSP/cookies/CORS observados no endpoint staging e known-bad. | BLOCKED_EXTERNAL |
| F33 production config fail-closed | 020,023 | Ausência/inconsistência de secret, URL, role ou flag impede startup/promoção. | TODO_LOCAL + EXTERNAL |
| F34 staging promotion model | 019,021,023 | Candidato imutável, approvals, promotion/rollback e separação de ambientes. | BLOCKED_EXTERNAL |
| F35 runbook execution | 017,018,023 | Execução real de incidentes/deploy/rollback/backup com tempos e owner. | BLOCKED_EXTERNAL |
| F36 final gauntlet | 024 | Crítica I1 sobre objeto selado, assinatura e zero finding alto aberto. | BLOCKED_BY_DEPENDENCIES |
| F37 repair loop | 024 | Todo achado gera correção, known-bad, reteste e nova crítica até PASS. | BLOCKED_BY_DEPENDENCIES |
| F38 human approval | 025 | Aprovação criptograficamente atestada, escopo, validade, risco e rollback. | BLOCKED_HUMAN |

O fechamento global requer 39/39 fases em `PASS`, zero hard blocker, nota geral ≥97 e cada uma das 22 dimensões no threshold imutável de 95–97. F23 e F24 devem produzir artefatos separados. F28/F29 devem ligar resultados CI, digest do SBOM, imagens e source fingerprint no mesmo grafo de proveniência.

## Contratos de aceite

### CVG-AUD20-001 — Reconciliar programa e conter promoção

Registrar itens AUD19 reabertos; substituir `BLOCKED` genérico; alinhar `active_action_id`, checkpoint, ExecPlan e next action; preservar histórico append-only; impedir promoção com P0/P1 aberto.

**Prova:** validador JSON/JSONL e known-bad de ponteiros divergentes.

### CVG-AUD20-002 — Terminalidade e autoridade de restore

Writes de turn/checkpoint/lease exigem `ACTIVE`; sessão terminal é imutável; runtime não cria estado de restore nem usa fence histórico; restore usa papel/procedure separado, auditado e transacional.

**Prova:** matriz memory/PostgreSQL por estado terminal, contraprova runtime de `QUARANTINED_RESTORE` e rollback integral.

### CVG-AUD20-003 — Default privileges mínimos

Remover DML default herdado de 022; declarar grants futuros mínimos; instalação limpa e upgrade convergem; testes não usam `GRANT ... ON ALL TABLES`.

**Prova:** tabela/sequence criadas depois da migration com negativas e positivas exatas como `cvg_runtime`.

### CVG-AUD20-004 — Readiness do schema atual

Derivar versão/manifesto esperado de fonte canônica e rejeitar 039/040 quando 041 é o alvo.

**Prova:** matriz N-2/N-1/N e known-bad com migration obrigatória ausente.

### CVG-AUD20-005 — Matriz adversarial de banco

Cobrir fence stale/future/histórico, sessão expirada/terminal, troca de tenant, tabela futura, instalação limpa/upgrade e duas conexões reais.

**Prova:** PostgreSQL 16 descartável, roles separados e zero grants fora das migrations.

### CVG-AUD20-006 — Identidade autoritativa de recurso

Todo desacordo entre `resourceId`, `patientId` e `encounterId` retorna `DIVERGENT`; PDP, tool e provider recebem uma identidade canônica; nenhum fallback reescreve o alvo.

**Prova:** matriz patient×encounter×workspace e provider capture com zero chamadas nos known-bad.

### CVG-AUD20-007 — Gate universal de PDP

Rotas IA/sensíveis são reconhecidas mesmo com wrappers assíncronos; não usar allowlist por rota para silenciar o defeito.

**Prova:** `verify:pdp-universal` verde e mutante que falha ao remover/mover a decisão.

### CVG-AUD20-008 — TTL e concorrência determinísticos

Eliminar TTL de 80 ms dependente de roundtrip; controlar tempo; provar duas instâncias/pools e owners concorrentes.

**Prova:** 20 repetições sem flaky e casos antes/no limite/depois do vencimento.

### CVG-AUD20-009 — Cancelamento cooperativo ponta a ponta

`AbortSignal` atravessa worker, relay, sink, mapper e adapter; timeout/stop aborta I/O em voo; efeito não vira sucesso depois do abort.

**Prova:** provider fake bloqueado observa abort; testes de stop, timeout e corrida com ack.

### CVG-AUD20-010 — Matriz completa de worker/effects

Cobrir crash antes do efeito, depois do efeito/antes do ack, depois do commit/antes da resposta, restart, lease loss, duplicidade, ack, poison retryable até esgotamento e `OUTCOME_UNKNOWN`.

**Prova:** tentativas/efeitos, ledger/reconciliação e restart real de processo/container.

### CVG-AUD20-011 — Integridade semântica do recovery

Recalcular digest de checkpoint por payload+schema; validar FKs lógicas, sequências, tenants e fences; corrupção re-hasheada do envelope deve falhar.

**Prova:** corpus de bundles adulterados e restore atômico conhecido-bom.

### CVG-AUD20-012 — Lifecycle da busca

Cada efeito possui cancelamento; cleanup de `StrictMode` não invalida a nova execução; resposta antiga não sobrescreve a nova; `finally` encerra loading corrente.

**Prova:** teste de componente em `StrictMode` e Playwright com resposta invertida, erro e unmount.

### CVG-AUD20-013 — Contratos semânticos frontend

Schemas canônicos/estritos para campos consumidos; validar ID, enum, timestamp, inteiro, centavos não negativos, versão e objetos aninhados; remover passthrough que esconde corrupção.

**Prova:** property tests/fixtures known-bad por família e integração impedindo render inválido.

### CVG-AUD20-014 — Inventário exato de endpoints

Catálogo por tipos ou AST; detectar rota ausente, duplicata, verbo errado e placeholder espúrio; remover `POST /knowledge/:id/:id`.

**Prova:** snapshots e mutantes conhecidos-ruins.

### CVG-AUD20-015 — Error boundary observável e acessível

Falha de render cai no boundary; correlation ID liga-se ao erro; telemetria redigida é emitida; foco, alerta, retry/reload e recuperação funcionam.

**Prova:** teste de componente/E2E com throw, axe, keyboard, screenshot e inspeção do evento.

### CVG-AUD20-016 — Toolchain de qualidade web

ESLint TypeScript/React Hooks/jsx-a11y real; budgets JS/CSS; code splitting; CWV/Lighthouse com limites; contraste derivado de tokens/componentes; retries zero.

**Prova:** cada known-bad derruba seu gate; relatório vinculado ao fingerprint.

### CVG-AUD20-017 — Drill local de Alertmanager

Prometheus envia alerta a receiver sintético local; o harness confirma firing/resolved; indisponibilidade é detectada; regra, rota e runbook são correlacionados. Entrega a receiver real pertence a CVG-AUD20-023/F14.

**Prova:** transcript do drill e known-bad removendo a configuração.

### CVG-AUD20-018 — Logs duráveis e redação

Backend com retenção, health e consulta; eventos sobrevivem restart; PII/segredos são redigidos por valor/classificação, não só nome de chave; acesso auditado.

**Prova:** restart, query por correlation ID, retenção e corpus known-bad de PII/segredo.

### CVG-AUD20-019 — Fingerprint e receipts reproduzíveis

Manifesto cobre commit, tracked diff, untracked relevante, dependências, configuração e hashes; receipt registra comando, ambiente, timestamps, exit, freshness e fingerprint.

**Prova:** qualquer byte relevante invalida o gate; reprodução em checkout limpo.

### CVG-AUD20-020 — Semântica fail-closed dos gates externos

Credencial/runner ausente retorna exit `2` ou não zero documentado; relatório informativo é separado; gate chamado structural não executa browser nem escreve sem declarar.

**Prova:** matriz PASS/FAIL/BLOCKED_EXTERNAL testando exit status do processo filho.

### CVG-AUD20-021 — Control plane singular

State, backlog, ExecPlan, checkpoint, last event e current evidence apontam para a mesma ação/fingerprint; timestamps não podem estar no futuro; `DONE` não pode ter next action `IMPLEMENT`.

**Prova:** validador determinístico e reconciliação append-only dos registros AUD19 inválidos.

### CVG-AUD20-022 — Qualificação local integrada

Toda a matriz R4 passa duas vezes, sem retries e no mesmo fingerprint; instalação limpa e upgrade; todos os P0/P1 locais fechados.

**Prova:** manifesto único, logs brutos e receipts por gate.

### CVG-AUD20-023 — Evidência externa same-SHA

Staging, imagens, providers, secrets, telemetria, alert receiver real, carga/chaos, recovery gerenciado, RTO/RPO, WebKit/AT/zoom no candidato de 022. O resultado CI, o digest do SBOM, as imagens e o source fingerprint devem estar explicitamente ligados no mesmo grafo/attestation de proveniência.

**Prova:** receipts da autoridade externa em evidence root fora da árvore de source; `BLOCKED_EXTERNAL` não conta como pass.

### CVG-AUD20-024 — Crítica final independente

Crítico read-only e fresco, barra congelada, objeto imutável e mutation sentinel estável; F23 e F24 em relatórios separados; zero achado alto; 39/39 fases em PASS; thresholds dimensionais e geral atingidos; assinatura verificável da revisão independente.

**Prova:** relatório independente assinado/verificável com cobertura, limitações, hashes, thresholds e veredito; relatórios F23/F24 separados.

### CVG-AUD20-025 — Decisão humana de release

Autoridade nomeada registra `APPROVE`, `REJECT` ou `DEFER`, escopo, riscos, rollback e validade em atestação criptograficamente verificável ligada ao candidato. Nenhum agente autoaprova.

**Prova:** atestação criptográfica da autoridade humana vinculando exatamente o candidato e o veredito.

## Definition of Done global

Uma tarefa só muda para `DONE` quando aceite e known-bad/known-good passam, regressões adjacentes estão verdes, o receipt registra exit/tempo/ambiente/artefatos/fingerprint e não há efeito colateral não declarado. Dependência externa ausente permanece `BLOCKED_EXTERNAL`, nunca `PASS`. A entrega integral só fecha com F0–F38 em `PASS`, todas as dimensões e a nota geral acima dos thresholds congelados, zero hard blocker, revisão independente assinada e aprovação humana criptograficamente atestada.
