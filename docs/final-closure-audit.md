# Auditoria de fechamento — CVG-Corp State of the Art / Triplo AAA

**Auditoria:** F0-2026-09-09-v2
**Revisão de referência do CVG:** `39024ca03af5a78ad1edabaf9e5be6654a98327d` (contrato compartilhado e gates reais dos entrypoints do worker, sobre a fila/heartbeat implementada em `c3c18de`, após `bf0cc50`/`6b3df2f`/`135ae56` e o ciclo durável de break-glass)
**Revisão observada do DeepSeek Harness:** `5dda764ed3aa172535a7967b06ff95d9cbfe536a`
**Probe ACP local:** `READY`; `initialize` + `session/new` passaram pelo processo real via stdio; turno de modelo deliberadamente não executado sem API key.
**Prompt normativo:** [prompt v2](prompt-state-of-the-art-triplo-aaa-2026-09-09-v2.txt), SHA-256 `34e886f59adacf8fda46d8d54bdede259705adc6e1521590cd3c281509b0e0d9`
**Ambiente:** workspace local, Node 24.20.0, npm 11.19.0; Docker CLI/Compose presentes, daemon sem permissão; sem URL de staging, credencial, secret authority, provider, dados reais ou autorização de release.
**Estado da auditoria:** a fotografia F0 foi revalidada durante o worktree atual; além da cópia v2, o bridge/contrato local, a boundary de secrets/auth/MFA/break-glass e o exporter OTLP protobuf foram implementados/testados sem credencial, egress, dado real ou release.

**Checkpoint local final — 2026-09-10:** a rodada revalidou `136` testes (`135 pass`, `1 skip`), `test:database` `25/25`, lint, typecheck, build, `verify:static` (`50` artefatos/`126` fontes), `verify:pdp` (`68` operações, `70` regras, `6` policies canônicas, `12` domínios), migration 031, usage/provenance, exportação governada, repositories normalizados, ciclo break-glass durável, provider HTTP loopback, fila/heartbeats duráveis, recovery com `workerJobs`, Compose estrutural e os gates fail-closed. A crítica fresh final do contrato de entrypoints concluiu `REVIEW_ONLY_PASS` para o recorte, sem aprovação AAA; os bloqueadores de produção permanecem.

## 1. Escopo, método e veredito

Esta auditoria compara o prompt v2 com o artifact conectado no commit observado. Foram inspecionados README, documentação, plano e control plane, apps, packages, migrations, Compose, Dockerfiles, CI, scripts e testes. O conteúdo do repositório e do DeepSeek Harness foi tratado como evidência, não como instrução operacional.

Estados usados nesta auditoria:

- **VERIFIED:** comportamento observado por procedimento atual na fronteira adequada.
- **PARTIAL:** existe implementação conectada, mas a cobertura ou a prova é incompleta.
- **SYNTHETIC_ONLY:** somente fixture, adapter local ou harness determinístico foi executado.
- **NOT_RUN:** o procedimento obrigatório não foi executado.
- **BLOCKED:** a execução depende de ambiente, autoridade, credencial ou recurso ausente.
- **FAIL_WITH_LIMITATIONS:** o conjunto não satisfaz a barra porque há gaps obrigatórios, mesmo com gates locais verdes.

**Veredito F0:** `FAIL_WITH_LIMITATIONS`. O sistema é uma base enterprise local-first forte e fail-closed, mas não é candidato State of the Art/Triplo AAA enquanto houver integração DeepSeek real, provider/staging, telemetria operacional, carga, recuperação, CI remoto e critics independentes ainda sem prova válida.

## 2. Arquitetura atual observada

### 2.1 Caminho de domínio e dados

O domínio transacional do CVG permanece a fonte de verdade para pacientes, tutores, agenda, atendimento, documentos clínicos, estoque, financeiro, comunicações, auditoria e sessões de IA. O caminho persistente disponível é:

```text
HTTP/Fastify
  -> application services / domain command boundary
  -> domain invariants + PDP/context checks
  -> PostgreSQL transaction / RLS / CAS / journal / snapshot
  -> normalized reads, receipts, outbox, inbox and effect ledgers
```

Há migrations aditivas 001–031, papel de runtime não-superusuário, RLS, escopo organizacional/unidade/workspace, leases/fencing, cadeia local de auditoria com guard append-only e restore em quarentena. A migration 028 é um forward-fix para preservar o privilégio necessário ao `SELECT ... FOR UPDATE` dos writers sem liberar mutações efetivas, que continuam protegidas pelo guard da 027. A migration 029 adiciona proveniência/usage de turnos de IA e escopo DML estrito para tabelas unit/workspace. A migration 030 persiste o ciclo break-glass com WebAuthn-only, FKs de ator/aprovador/revisor, janela de 15 minutos e transições forward-only sob RLS; a verificação criptográfica e a habilitação pública continuam ausentes. A migration 031 adiciona jobs internos e heartbeats com `FORCE RLS`, digest de admission, claim/lease/fence, quarantine e stale protection. Nos commits `135ae56`, `6b3df2f` e `bf0cc50`, as leituras de auditoria, encounters, clinical documents, diagnostics, hospitalization, medication, stock, finance, communication, knowledge, queue e AI sessions passaram por repositories tipados/normalizados em transações `READ ONLY`, com validação fail-closed de escopo e campos duráveis; `c3c18de` acrescenta a boundary durável dos jobs e `1f06632` qualifica o projection do claim. O snapshot JSONB ainda participa da reconstrução; alguns caminhos de identidade/organização, handlers de negócio, execução PostgreSQL concorrente e observabilidade production-like continuam fora da evidência atual.

### 2.2 Caminho de IA e Harness

```text
CVG Domain
  -> Application Layer
  -> policy/PDP + Tool Gateway
  -> AgentRuntime
  -> MockHarnessAdapter ou DeepSeekHarnessAdapter
  -> contrato HTTP CVG /v1 esperado
```

O Harness local não recebe acesso direto ao banco do CVG. O adapter DeepSeek valida health, commit, manifest, catálogo de tools, sessão, turno, approval, replay, timeout, cancelamento e proveniência, e não faz fallback automático para Mock.

O salto `/v1` customizado continua separado do processo Harness: a revisão observada de `/home/ricardo/deepseek-harness` não fornece endpoints CVG `/v1/health`, `/v1/sessions` ou o contrato exato consumido pelo adapter HTTP. Nesta continuação foi conectado um port ACP nativo opcional (`packages/deepseek-bridge/src/acp.ts`) que inicia o comando explicitamente, valida o `git HEAD`, o digest exato do manifesto e o agente esperado, então prova `initialize` e `session/new` contra o processo real. O probe observou commit `5dda764ed3aa172535a7967b06ff95d9cbfe536a` e profile digest `sha256:c64e05758755f57c3552263964fa2488bf910c022f2f8fe539d1b63904bad1ea`. Ainda não houve prompt/turno de modelo, provider externo, catálogo de tools CVG, approval/replay ou staging; portanto a integração é **PARTIAL/REAL-BOUNDARY**, não uma integração DeepSeek completa nem AAA.

### 2.3 Caminho de efeitos externos

```text
communication.stage
  -> policy + approval
  -> outbox
  -> worker
  -> MessagingProvider
  -> receipt/callback
  -> inbox
  -> effect ledger
  -> reconciliation
  -> audit
```

Existe `SyntheticMessagingProvider`, `HttpMessagingProvider`, HMAC de callback, allowlist/SSRF, timeout, circuit breaker, rate limit local, receipt validation, `OUTCOME_UNKNOWN`, consulta e reconciliação sem retry cego. O sink externo exige ledger durável. `npm run verify:provider-sandbox` agora cruza o transporte HTTP real em loopback e prova replay, resposta perdida após aceite, consulta por idempotency key e callback HMAC válido/inválido; provider externo, callback externo e settlement continuam não executados.

### 2.4 Caminho operacional

API e worker são processos separados. O worker nomeia seis lanes (`outbox`, `jobs`, `schedule`, `reconciliation`, `notifications`, `maintenance`) e bloqueia lanes sem runner/sink. API, worker e bridge possuem exporter OTLP protobuf real e redaction antes da exportação; o Compose de observabilidade declara Collector, Tempo, Prometheus, Grafana e Alertmanager, mas nenhum serviço de staging foi iniciado. Compose tem read-only, non-root/privilege restrictions, cap drop, healthchecks e limites CPU/memória. CI tem PostgreSQL efêmero, migrations, restore, E2E, SBOM e scan declarados, mas execução remota deste commit ainda não foi observada.

### 2.5 Caminho visual

`apps/web` tem shell, rotas, features, máquina de estado offline/revalidação, tokens e E2E Chromium/Firefox em 375/768/1440, além de um projeto stress em 320 CSS px, DPR 2, touch e reduced-motion. O render local foi inspecionado em screenshots reais e não apresentou overflow conhecido; axe passou em login, dashboard e administração com 8/8 estados auditados. WebKit foi baixado, mas não iniciou porque o host não possui bibliotecas nativas e sudo exige senha. Leitor de tela, zoom real de 200% e comparação visual por baseline ainda não têm evidência corrente.

## 3. Forças observadas

| Área | Evidência atual | Limite |
|---|---|---|
| Domínio soberano | contratos, domínio, services, RLS e projeções preservam o CVG como fonte de verdade | uso universal de todos os caminhos ainda não provado |
| Fail-closed | config production, secret/provider ausente, Tool Gateway, approvals, worker e staging/AAA bloqueiam | o bloqueio real de cada deployment depende de startup production-like |
| Tool Gateway | sessão, alvo, escopo, digest, idempotência, approval e ledger durável | concorrência/distribuição PostgreSQL real não executada |
| Efeitos externos | outbox/inbox/effect ledger, receipt, unknown outcome e reconciliação | provider e callback reais ausentes |
| Dados | migrations 001–031, RLS, CAS, locks, runtime role, restore manifest/quarantine, guard append-only, usage/provenance, ciclo break-glass e ledger de jobs/heartbeats | volume, mixed-version, backup gerenciado, recovery operacional e concorrência real ausentes |
| Identidade | password policy, lockout, TOTP, recuperação, rotação e revogação local | secret authority, WebAuthn real e sessão distribuída ausentes |
| Supply chain | actions pinadas, SBOM, licença, npm audit e Compose estrutural | execução remota e imagem/Trivy reais não observadas |
| UI | shell modular, estados offline, E2E Chromium/Firefox, projeto stress de reflow/DPR/touch/reduced-motion, axe e screenshots reais | WebKit/assistive tech/zoom real/baseline visual ausentes |

## 4. Matriz de fechamento por fase do prompt v2

| Fase | Status | Evidência conectada | Gap obrigatório / próxima prova |
|---|---|---|---|
| 0 Reaudit | **VERIFIED local / FAIL overall** | este documento, HEAD, control plane, código, CI, migrations e testes inspecionados | manter auditoria sincronizada após cada onda |
| 1 DeepSeek Harness real | **PARTIAL/REAL-BOUNDARY** | port ACP explícito, attestation histórica de commit/manifesto/agente e probe real `initialize` + `session/new`; adapter rejeita capabilities incompletas | prompt/turno real, provider, secret authority, catálogo de tools CVG e staging autorizados |
| 2 Contract matrix DeepSeek | **PARTIAL/SYNTHETIC_ONLY** | testes HTTP/port known-good/known-bad, timeout/cancel/approval/replay/provenance/mismatch + ACP real sem modelo | executar refusal/partial/model failure e a matriz completa contra Harness com credencial autorizada |
| 3 Vertical provider | **PARTIAL/LOCAL-CONTRACT** | `tests/unit/integrations.test.ts` mantém outbox → effect ledger → provider; `scripts/verify-provider-sandbox.ts` cruza HTTP loopback, receipt, callback e unknown/reconciliation sem resend cego | provider sandbox externo autorizado, callback externo e settlement observados |
| 4 Provider contract | **PARTIAL/LOCAL-CONTRACT** | `HttpMessagingProvider` foi exercitado por transporte HTTP real em loopback com headers, replay e HMAC; testes negativos mantêm schema/SSRF/falhas | contrato externo real, idempotency/status/assinatura do provider autorizado |
| 5 Unknown outcome | **PARTIAL/LOCAL-CONTRACT** | resposta perdida após o provider já possuir o efeito retorna `OUTCOME_UNKNOWN`; consulta posterior pela chave recupera `SUCCEEDED` e receipt | prova externa de timeout após efeito e query autoritativa |
| 6 Durable idempotency | **PARTIAL/SYNTHETIC_ONLY** | ledger e testes de restart/fake persistence | concorrência multi-processo e PostgreSQL real com mesma chave/digest |
| 7 PDP universal | **PARTIAL/LOCAL-GUARDED** | `npm run verify:pdp`: 68 operações, 70 regras de aplicação, 6 policies de tools, 12 domínios; catálogo de rotas protegido, application services, worker fenced, jobs e export/recovery guardados | matriz universal de jobs/repositories e concorrência universal ainda precisam de prova; guard não substitui teste de runtime |
| 8 Repositories normalizados | **PARTIAL** | leituras tipadas e transacionais de guardian/patient/appointment, audit (`135ae56`), encounter/clinical (`6b3df2f`) e diagnostics/care/finance/communication/knowledge/queue/AI (`bf0cc50`), mais admission/claim/stats de jobs (`c3c18de`, SQL qualificado em `1f06632`), com RLS contextual, joins explícitos e corrupção fail-closed | identidade/organização, handlers de negócio, cobertura universal e prova PostgreSQL concorrente continuam ausentes |
| 9 Worker AAA | **PARTIAL/LOCAL-GUARDED** | seis lanes, fila `cvg_worker_jobs`, heartbeat `cvg_worker_heartbeats`, lease/fencing, budgets, concorrência limitada, backpressure antes do claim, poison metrics, retry/quarantine e shutdown cooperativo; testes unitários/integrados locais | execução em container/worker real, dead-letter operacional, métricas/heartbeat observados e SLO de backlog |
| 10 Secrets | **PARTIAL/LOCAL-GUARDED** | providers de ambiente/diretório/Docker, refs aprovadas, verificação sem material, readiness fail-closed para provider degradado e token DeepSeek | Docker secret em container, Vault/cloud authority, rotação real e prova operacional de não exposição |
| 11 Auth | **PARTIAL/SYNTHETIC_ONLY** | password, aging config, lockout, sessions, recovery, enrollment/revogação TOTP e audit local | sessões distribuídas e operação production-like |
| 12 MFA | **PARTIAL/SYNTHETIC_ONLY** | TOTP, enrollment por referência, expiração/replay/bloqueio de challenge, recovery e limites; WebAuthn seam | enrollment/challenge/revoke/recovery em ambiente real e WebAuthn/passkey |
| 13 Break-glass | **PARTIAL/LOCAL-GUARDED** | migration 030, adapter PostgreSQL, RLS/FKs, WebAuthn-only, TTL, expiração lazy, revogação, revisão e testes sintéticos; capability pública segue `BLOCKED` | provider WebAuthn real, prova criptográfica ligada ao approver, decisão humana, auditoria operacional/notificação e exercício pós-evento |
| 14 Rate limit distribuído | **PARTIAL** | PostgreSQL-safe schema/API limiter | execução multi-instância e métricas de login/MFA/AI/export/callback/high-impact |
| 15 Circuit breaker | **SYNTHETIC_ONLY** | provider breaker e failure tests | DeepSeek/provider real, métricas e half-open observado |
| 16 Observability real | **PARTIAL/LOCAL-EVIDENCED** | redaction, SDK/exporter OTLP protobuf real, teste local de envio e SLO/alert contracts | collector/staging executado e traces/metrics/logs correlacionados |
| 17 Observability stack | **PARTIAL/NOT_RUN** | Compose versionado, rede privada API/worker→Prometheus, Collector/Tempo/Prometheus/Grafana/Alertmanager, dashboards/alerts e `verify:production` estrutural | executar stack e dashboards/alerts em staging |
| 18 SLOs reais | **PROPOSED/SYNTHETIC_ONLY** | catálogo e evaluator local | workload staging medido, p95/availability/backlog/RTO/RPO aprovados |
| 19 Alertas reais | **PROPOSED/SYNTHETIC_ONLY** | regras tipadas e runbooks | dispatch/alertmanager real e exercícios de breach |
| 20 Staging | **BLOCKED** | `verify:staging` fail-closed sem URL | PostgreSQL, DeepSeek, provider sandbox, secret, TLS, worker e telemetry autorizados |
| 21 TLS/edge | **PARTIAL/CONFIG-VALIDATED** | overlay de produção com redirect 80→HTTPS, TLS 1.2/1.3, HSTS, cookies secure e certificados montados out-of-band; Compose renderizado sem a porta 8080 de desenvolvimento | endpoint HTTPS real, certificado válido, cookies/redirect/TLS policy observado em staging |
| 22 Browser matrix | **PARTIAL** | Chromium + Firefox × 375/768/1440; projeto stress Chromium em 320 CSS px/DPR 2/touch/reduced-motion; WebKit declarado e bloqueado por dependências nativas do host | WebKit executável e diferenças cross-engine ainda sem prova |
| 23 Accessibility | **PARTIAL/LOCAL-EVIDENCED** | axe login/dashboard/admin 8/8; contraste computado; keyboard/focus/dialogs, reflow estreito, DPR/touch e reduced-motion cobertos por E2E | leitor de tela, baseline visual e zoom real de 200% |
| 24 Load | **NOT_RUN** | benchmark local explicitamente sintético | k6/autocannon/pgbench em staging com workload, tails e recursos |
| 25 Chaos | **SYNTHETIC_ONLY/PARTIAL** | fault harness local | kill/restart/partition/secret/provider/DeepSeek/restore em ambiente real |
| 26 Recovery | **PARTIAL/SYNTHETIC_ONLY** | bundle manifest, encryption, quarantine e restore tests | RPO/RTO e restore/replay real com ledgers preservados |
| 27 Backup | **NOT_RUN** | runbooks e bundle local | pipeline encrypted/checksum/retention/rotation + restore periódico real |
| 28 Audit tamper evidence | **PARTIAL/LOCAL-GUARDED** | migrations 026–027 e domínio/persistência validam `chainVersion=2`, `previousHash`/`recordHash`, INSERT-only e bloqueio de UPDATE/DELETE; teste de adulteração local | WORM/assinatura externa, verificador operacional e restore/replicação da cadeia em produção |
| 29 Export governado | **PARTIAL/POSTGRES-BLOCKED** | `/ops/export` com purpose/purposeDigest/TTL, PDP, idempotência, SecretProvider, AES-256-GCM, manifesto, digest, envelope v2 com `expiresAt` autenticado e auditoria; teste local de entrega/replay/expiração | PostgreSQL/staging/secret authority e retenção operacional ainda não executados |
| 30 Supply chain | **PARTIAL** | SHA actions, SBOM, licenses, npm audit, Trivy declarado e gates locais no commit técnico `1f06632` | CI remoto e container scan do novo SHA ainda não foram observados como concluídos |
| 31 Containers | **PARTIAL** | read-only, cap drop, no-new-privileges, resource limits, healthchecks | build/startup/scan real e pids limits verificadas no runtime |
| 32 Database hardening | **PARTIAL** | pool/config/runtime role/timeout seams | PostgreSQL real: pool exhaustion, slow queries, locks/deadlocks, statement/transaction timeout |
| 33 Migration safety | **PARTIAL** | migrations append-only 001–031, checksums/guards e scripts; 028 corrige o privilégio de lock em forward-only, 029 escopa DML/proveniência e 031 adiciona jobs/heartbeats com RLS | dry-run, mixed-version, interruption/restart, volume representativo e prova remota ainda ausentes |
| 34 AI red team | **SYNTHETIC_ONLY** | prompt injection, scope/approval/secret negative tests | indirect injection/RAG/tool confusion/exfiltration em harness real e corpus aprovado |
| 35 AI provenance | **PARTIAL/SYNTHETIC_ONLY** | adapter/commit/manifest/model/provider/policy/correlation/reference; `ai_turns.usage_record_id`, `provenance_json` e ledger idempotente | provider/DeepSeek real, custo settlement e replay PostgreSQL concorrente ainda não executados |
| 36 Cost/usage ledger | **PARTIAL** | usage ledger local e budgets | input/output/model/provider/budget/reservation/settlement/custo real |
| 37 Frontend failure states | **PARTIAL/LOCAL-EVIDENCED** | offline/reconnect/context invalid, `PERMISSION_DENIED`, sessão expirada 401 e `STALE`; E2E direcionado 2/2 e deduplicação sob StrictMode | DeepSeek/provider/unknown outcome de staging, WebKit/assistive tech e zoom real ainda sem prova |
| 38 CI remoto | **PARTIAL/OBSERVED** | workflow declarativo; run `34427884550` verde no SHA publicado com E2E, PostgreSQL/RLS, restore, release, SBOM, builds e scans | observar o novo SHA desta rodada; CI verde anterior não prova staging/provider/AAA |
| 39 Quality gates | **PARTIAL/VERIFIED local** | scripts AAA/staging/production existem e falham fechado | ingestão de evidência externa e promoção somente com todos os gates |
| 40 Final Gauntlet | **FAIL_WITH_LIMITATIONS** | críticos I1 anteriores encontraram gaps em ACP/tools, PDP/auth, provider/recovery e frontend/a11y; findings locais foram endurecidos e revalidados; a tentativa fresh da wave de jobs não retornou parecer e não é aprovação AAA | eliminar blockers externos, executar staging/CI do novo SHA e obter aceite humano; manter crítica independente válida como pré-condição |

## 5. Blockers e risco ordenado

### Crítico

1. **Turno DeepSeek real ainda não executado:** o boundary ACP real e `session/new` foram provados localmente com attestation histórica, e o harness sintético agora executa pelo ToolGateway, mas não há prompt/LLM/provider nem execução de tools no port ACP; o método nativo permanece bloqueado até capabilities completas e ambiente autorizado. Risco: declarar integração completa sem provar resposta, refusal, usage, proveniência e falhas de modelo.
2. **Staging/provider/secret authority não disponíveis:** sem esses recursos não há prova de egress seguro, receipt, callback, reconciliação, TLS, rotação ou dados operacionais; os jobs duráveis locais ainda não possuem handlers de negócio production-like.
3. **Recovery/load/observability remotos não executados:** não há RTO/RPO, capacidade, error budget, collector ou diagnóstico operacional medidos.
4. **Crítica independente e aceite:** os pareceres I1 anteriores rejeitam AAA; as críticas fresh da wave de jobs, inclusive contra o SHA corrente, foram encerradas sem relatório (`NOT_COMPLETED`) e não são aprovação. Não existe aprovação independente AAA nem aceite humano para promoção.

### Alto

1. PDP/Tool Gateway e repositories não têm cobertura automática universal provada em todas as operações críticas.
2. Worker tem ciclo e contratos locais; reconciliação usa claim atômico/lease/fence e o scheduler possui budgets, concorrência limitada, backpressure, poison metrics, heartbeat e shutdown cooperativo, mas dead-letter, execução production-like e métricas operacionais ainda não foram executados.
3. Browser/accessibility melhoraram localmente, mas WebKit, assistive tech, baseline visual e zoom real de 200% permanecem sem prova.
4. Cadeia de audit tamper-evidence e export governado não estão demonstradas como operações de produção.

### Médio

1. Auditoria de tokens tem 73 sinais medium heurísticos de cores próximas; nenhum high/critical.
2. Documentação corrente ainda usa nomes `vNext`/históricos para entregáveis que o prompt v2 exige como artefatos canônicos.
3. README e plano contêm números históricos que precisam apontar para a evidência mais recente.

## 6. Plano de implementação por dependência

1. **Contrato e evidência:** concluído localmente nesta revisão; deliverables canônicos, README/ADR/runbook e matriz PDP foram adicionados, sem promover gaps externos.
2. **DeepSeek bridge:** boundary ACP real local concluído com default-deny, attestation, cancelamento e session binding; turno de modelo, tools, approvals, replay e egress continuam bloqueados até contrato/autoridade externos.
3. **PDP/repositories:** inventariar rotas, commands, tool registry e export; adicionar guard estático/contract test e repositories explícitos onde faltam, sem substituir o domínio por snapshot.
4. **Worker/ledger:** concluído o recorte local de admission/claim/lease/fence/retry/quarantine/jobs/heartbeats, budgets/backpressure/concorrência/poison/metrics e cadeia de auditoria; falta ligar handlers de negócio, executar container, dead-letter operacional e métricas em staging, mantendo provider externo bloqueado até autoridade.
5. **Observability:** concluído o recorte local do SDK/exporter OTLP protobuf, redaction e pontos API/worker/bridge; falta executar Collector/Prometheus/Grafana/Alertmanager, ligar métricas/logs correlacionados e provar SLO/alerts em staging.
6. **Staging gate:** preparar configuração reproduzível com TLS, secret provider, PostgreSQL, worker e provider sandbox; não inserir credenciais nem iniciar egress sem autoridade.
7. **Browser/accessibility/load/chaos/recovery:** Chromium/Firefox e axe têm prova local; executar WebKit/assistive tech/zoom e os drills restantes no ambiente autorizado, mantendo BLOCKED/NOT_RUN quando indisponível.
8. **Final Gauntlet:** rodar critics frescos read-only por domínio, verificar sentinel de mutação, reparar findings reproduzíveis, executar regressão e recalcular scorecard.

## 7. Rollback e contenção

- Migrations existentes são append-only; qualquer alteração de schema usa migration nova, checksum e procedimento forward-fix.
- Bridge ACP, provider, collector e novas lanes entram desabilitados por padrão; configuração incompleta, attestation divergente ou permission mode diferente de `read-only` retorna `BLOCKED`/capability unavailable.
- Em falha de integração, manter Mock somente em ambiente local/teste, sink externo em quarentena e nenhum fallback para egress.
- Em timeout externo, preservar `OUTCOME_UNKNOWN`, consultar/reconciliar por idempotency key e nunca reenviar cegamente.
- Em restore, usar destino temporário quarentenado, invalidar sessões/autoridade e preservar outbox/effect/audit ledgers.
- Em falha de migration/CI/staging, parar no último checkpoint, preservar artifacts e corrigir/reexecutar; não usar reset destrutivo ou force push.
- Antes de qualquer operação externa, exigir URL, credencial/referência, owner, janela, abort criteria, RTO/RPO/SLO e aprovação humana registrados fora do código.

## 8. Plano de verificação

### Local, executável neste workspace

```bash
npm run typecheck
npm run lint
npm test
npm run test:contract
npm run test:security
npm run test:database
npm run test:fault
npm run build
npm run verify:static
npm run test:e2e
npm run audit:contrast
npm run audit:tokens
npm run audit:licenses
npm audit --omit=dev --audit-level=high
npm run verify:production
npm run verify:triplo-aaa
npm run verify:staging
git diff --check
```

### Production-like, somente com autoridade

- Compose/PostgreSQL real: migrations, RLS, runtime role, pool/timeout, concurrent CAS, worker e restore.
- Bridge/Harness/DeepSeek: health/readiness, commit/manifest/agente, ACP `initialize`/`session/new`, e depois session/turn/approval/cancel/replay/provenance e failures da matriz.
- Provider sandbox: stage → approval → outbox → worker → request → receipt/callback → inbox → effect ledger → reconciliation.
- Observability: collector, traces, metrics, logs redigidos, dashboards, alerts, SLO/error budget e runbooks acionados.
- Browser/accessibility: Chromium/Firefox/WebKit × 375/768/1440, projeto stress de reflow/DPR/touch/reduced-motion, keyboard/focus/axe e zoom real.
- Load/chaos/recovery: workload aprovado, p95/p99, saturation, kill/restart/partition, backup/restore/replay, RPO/RTO.
- CI remoto: SHA exato, jobs obrigatórios verdes, image build/scan, SBOM e artifact manifest.

## 9. Gates de produção e regra de promoção

Os gates obrigatórios permanecem separados:

```text
local correctness
  -> production structure
  -> PostgreSQL/containers
  -> real DeepSeek bridge
  -> real provider
  -> secret authority + TLS
  -> telemetry + SLO/alerts
  -> browser/accessibility
  -> load + chaos + recovery
  -> remote CI
  -> fresh independent critics
  -> human residual-risk/release authority
```

`STATE_OF_THE_ART_CANDIDATE` exige todos os gates acima com evidência atual, sem blocker crítico. `TRIPLE_AAA_CANDIDATE` exige ainda todas as dimensões no mínimo exigido, sem `PARTIAL`, `NOT_RUN`, `BLOCKED` ou `SYNTHETIC_ONLY` obrigatório, critics independentes aprovando, staging estável e aprovação humana. A execução local não deve emitir nenhum desses rótulos.

## Current checkpoint — 2026-09-09 21:36

`VER-CVG-055` observa o GitHub Actions run `34421045621` do SHA `53860d08c12b21667c62d7ba032435bfcf797cf5`: checkout, dependências, lint, typecheck, testes, provider loopback, build, static, auditorias, E2E e aplicação das migrations passaram; `PostgreSQL integration and RLS gate` falhou e os passos posteriores foram pulados. A 027 foi restaurada sem alteração e a 028 foi adicionada como forward-fix para o privilégio exigido por `SELECT ... FOR UPDATE` nos writers, mantendo a mutação protegida pelo trigger append-only. Após a correção, a verificação local passou 111 testes (110/1 skip), E2E 52/4, lint 118 fontes, static 43/120, PDP 64/68/6/12, provider loopback, licenças 207, npm audit 0 e diff check.

## Current checkpoint — 2026-09-09 21:47

`VER-CVG-057` observa o GitHub Actions run `34422274248` do SHA `c132d1d183e269b908607a035df5fd55cad0961e`: o step `Browser E2E` falhou com exit 1 e os gates PostgreSQL/RLS, restore, release, performance, SBOM e artifacts foram pulados. O detalhe do log exige autenticação e não foi inventado. A suíte local executável permanece verde (E2E 52 pass + 4 skips); o `test:e2e:full` local continua limitado por dependências WebKit ausentes. Portanto, este run não prova nem refuta a 028; o veredito continua `FAIL_WITH_LIMITATIONS` e a próxima ação é diagnóstico/reexecução autorizada do E2E remoto antes de qualquer promoção.

## Current checkpoint — 2026-09-09 22:06

`VER-CVG-058` registra a reprodução local da falha do PostgreSQL com PostgreSQL 16.15 efêmero e role runtime sem `BYPASSRLS`: o `UPSERT` de `guardians` falhava porque o writer não estabelecia `unit_id/workspace_id` para a política `SELECT` usada pelo `ON CONFLICT`. O writer agora usa escopo obrigatório para `guardians`/`patients`, limpa o contexto depois da projeção e falha fechado se um registro contextual perder seu escopo; o teste de regressão correspondente foi adicionado. O verificador também reutiliza a sessão autenticada através do restart, configura o contexto RLS antes de consultar o catálogo e o drill de restore remove as variáveis exclusivas de provisionamento antes de iniciar o runtime restaurado.

`VER-CVG-059` confirma localmente, em banco novo separado, migrations `001`–`028`, `npm run verify:postgres` com `postgres=PASS`, `restartRead=PASS`, `normalizedReads=PASS`, `idempotency=PASS`, `outbox=PASS`, `externalEffects=PASS`, `inbox=PASS`, `usageLedger=PASS`, `cas=PASS`, `rls=PASS`, `rlsDomainTables=56`, `rlsProtectedTables=56`, `organizationForeignKeys=98`, e `npm run verify:postgres:restore` com AES-256-GCM, rejeição de tamper/partial/stale/migration mismatch, destino `QUARANTINED`, login/readiness bloqueados e `sourceUnchanged=true`. A bateria final local também passou `npm test` 112 (111/1 skip), typecheck, build, lint 118, static 43/120, PDP 64/68/6/12, provider loopback, contraste 7/7, tokens sem high/critical, licenças 207, `npm audit` sem vulnerabilidades e `git diff --check`.

O último CI remoto observado antes deste patch é o run `34422825560` no SHA `0a345da99a771c440b8c36d619a5f81e43683ca5`: `Browser E2E` e migrations passaram, mas `PostgreSQL integration and RLS gate` falhou; a 028 foi aplicada no runner. O detalhe público é apenas exit 1 e os logs completos exigem autenticação. A correção local ainda precisa ser publicada e observada no SHA exato; não converter a prova efêmera em aprovação remota ou AAA.

## Current checkpoint — 2026-09-09 22:20

`VER-CVG-060` registra o run remoto `34424409313` no SHA `2f1840af472351daa007ec2f1799f51cef822b61`: o job principal passou Browser E2E, migrations, PostgreSQL/RLS, restore, release/Compose, performance, SBOM, artifacts e whitespace; o job separado `Build API and web images` falhou no passo `Build API image` e pulou a imagem web/scans. O detalhe do log exige autenticação. A inspeção do Dockerfile mostrou que `tsconfig.json` não era copiado para a imagem apesar de `npm run typecheck`/`npm run build` dependerem dele; a correção foi adicionada a `Dockerfile.api` e `Dockerfile.web`, ainda sem prova remota.

`VER-CVG-061` confirma localmente após o ajuste dos Dockerfiles: `npm run typecheck`, `npm run build`, `npm run verify:static`, `npm run verify:production` e `git diff --check` passaram; Compose principal e observabilidade foram validados estruturalmente sem iniciar serviços. PostgreSQL/restore, suíte, PDP, provider, auditorias e demais evidências permanecem conforme `VER-CVG-058`/`VER-CVG-059`. O novo SHA precisa ser publicado e observado; o veredito segue `FAIL_WITH_LIMITATIONS`.

## Current checkpoint — 2026-09-09 22:38

`VER-CVG-062` registra o run remoto `34425442854` no SHA `359c938de7dedef6a053fb5c72f30e104dc64257`: o job principal passou e os builds API/web também passaram; `Scan API image` falhou e `Scan web image` foi pulado. O detalhe público é apenas exit 1. A reprodução local com Trivy 0.74 na base Node encontrou quatro findings HIGH no npm global (`brace-expansion`, `ip-address` e `tar`).

`VER-CVG-063` registra a correção local em `Dockerfile.api`: npm/npx são removidos somente do estágio runtime, sem afetar o builder/typecheck. Typecheck, build, static, Compose estrutural, observabilidade Compose estrutural e diff check passaram; a imagem, o scan e o startup continuam aguardando novo CI. O veredito segue `FAIL_WITH_LIMITATIONS`.

## Current checkpoint — 2026-09-09 22:47

`VER-CVG-064` registra o run remoto `34426562885` no SHA `426d9f640d3174a6962e35aa0b5be0ab8304ea47`: o job principal falhou no `Browser E2E` com a anotação pública genérica `Process completed with exit code 1`; migrations, PostgreSQL, release, imagens e scans foram pulados. Não há log autenticado para atribuir a causa. `VER-CVG-065` registra a suíte local Chromium/Firefox/stress verde (`52 pass`, `4 skips intencionais`) e a configuração Playwright ajustada para uma única retry somente sob CI (`retries: process.env.CI ? 1 : 0`). O próximo SHA precisa ser publicado e observado; o veredito segue `FAIL_WITH_LIMITATIONS`.

## Current checkpoint — 2026-09-09 22:59

`VER-CVG-066` registra o run remoto `34427078117` no SHA `90bddd919b2a847f67dd704d253da6dcaa34b15b`: o job principal passou E2E, migrations, PostgreSQL/RLS, restore, release/Compose, performance, SBOM e artifacts; builds API/web e `Scan API image` passaram, mas `Scan web image` falhou. A reprodução com Trivy 0.74 encontrou 34 findings HIGH/CRITICAL na base `nginxinc/nginx-unprivileged:1.27-alpine`/Alpine 3.21.3.

`VER-CVG-067` registra a atualização para `nginxinc/nginx-unprivileged:1.31.5-alpine3.24` fixada pelo digest multi-arch; a reprodução local passou sem findings, e typecheck/build/static/produção estrutural/diff check passaram. O scan remoto do novo SHA ainda é necessário; o veredito segue `FAIL_WITH_LIMITATIONS`.

## 10. Próxima ação

**Ação concluída localmente:** `CVG-FULL-STATE-OF-THE-ART:PROVIDER-CONTRACT-AND-UNIVERSAL-PDP`.

**Sinal observado:** contrato do bridge documentado, bridge thin conectado somente a interfaces CVG, matriz conhecida-bom/conhecida-ruim executada localmente e adapter sem fallback permissivo; integração externa continua marcada `NOT_RUN/BLOCKED` até endpoint/autoridade reais.

**Ação concluída localmente:** `CVG-FULL-STATE-OF-THE-ART:PROVIDER-LOOPBACK-SANDBOX`. O verificador e o teste de integração atravessaram HTTP loopback real, com replay idempotente, aceite antes de resposta perdida, `OUTCOME_UNKNOWN`, reconciliação por chave e callback HMAC válido/inválido; `externalProvider` permanece `NOT_RUN`.

**Próxima ação:** `CVG-FULL-STATE-OF-THE-ART:REMOTE-CI-OBSERVATION`, obter diagnóstico/reexecução autorizada do `Browser E2E` no runner remoto e depois observar os gates PostgreSQL/release; sem logs/acesso, registrar `NOT_RUN`/`BLOCKED` e manter os gaps externos.

**Owner:** Lead/integrator do repositório.
**Dependências:** contrato observável do DeepSeek Harness; nenhuma credencial ou efeito externo é necessária para a etapa local.
**Revalidação:** após qualquer mudança em adapter, contracts, tool registry, auth, provider, migrations, CI ou staging.

## Current checkpoint — 2026-09-09 23:12

`VER-CVG-068` registra o run remoto `34427884550` no SHA `b232648bfbc3f1ae37ec099705ac16d045582b4d`: o job principal passou Browser E2E, migrations, PostgreSQL/RLS, restore, release/Compose, performance, SBOM, artifacts e whitespace; o job de containers passou Build API image, Build web image, Scan API image e Scan web image. `VER-CVG-069` registra o fechamento do plano de controle e a publicação do resultado. O CI do repositório está verde para o SHA publicado, mas o veredito global permanece `FAIL_WITH_LIMITATIONS`/`AAA_NOT_PROVEN` por falta de staging autorizado, provider/secret authority, turno DeepSeek, collector/SLO, carga/recuperação production-like, WebKit/assistive-tech/zoom real, crítica independente aprovadora e aceite humano.

## Current checkpoint — 2026-09-10 local closure

`docs/verification-2026-09-10-local-closure.md` registra a nova fotografia: `npm test` 119 (`118 pass`, `1 skip`), typecheck/build/lint/static/PDP/security/database/restore, provider loopback, exportação governada, ciclo break-glass durável, produção estrutural/TLS overlay, contrast/tokens/licenses/audit e os E2E completos (`64 pass`, `4 skips`) passaram. O harness local agora usa `ToolGateway.execute()` com ledger e timeout; a UI diferencia 401 inicial, sessão expirada, 403 estável e `STALE`; métricas Prometheus agregadas estão isoladas na rede privada de observabilidade. `verify:triplo-aaa` permanece `AAA_NOT_PROVEN`, `verify:staging` permanece `STAGING_EVIDENCE_INCOMPLETE` e `verify:deepseek-acp` está bloqueado sem configuração explícita. O CI verde `34427884550` pertence ao SHA anterior; o commit técnico `e846904` foi publicado, mas sua página de checks não apresentou resultado final observável nesta fotografia. O veredito permanece `FAIL_WITH_LIMITATIONS`.

## Current checkpoint — 2026-09-10 governed data closure

O commit `1fe6350` adiciona migration 029 para `usage_record_id`/`provenance_json`, ledger de usage idempotente e políticas DML estritas por organização/unidade/workspace; `AgentApplicationService`, harness local e persistência agora carregam e verificam referências, digests, correlation, policy revision e estado de reconciliação. O novo `ExportApplicationService` expõe `/api/v1/ops/export` com PDP `ops.export`, role admin, purpose/purposeDigest, TTL, `Idempotency-Key`, SecretProvider e envelope AES-256-GCM v2 com `expiresAt` autenticado; o teste local prova entrega cifrada, replay idempotente e rejeição de cópia expirada, enquanto o endpoint em memória retorna `CAPABILITY_DISABLED`. A onda de endurecimento posterior adiciona overlay TLS de produção e valida a composição renderizada sem publicar a porta de desenvolvimento `8080`; isso continua sendo prova estrutural, não staging.

O guard `npm run verify:pdp` passou com 68 operações vinculadas, 70 regras de aplicação, 6 policies canônicas de tools e 12 domínios, incluindo route catalog, application services, worker fenced e recovery/export. A bateria completa local passou `npm test` 118 (`117 pass`, `1 skip`), typecheck, lint, build, static, security, fault, database/restore, E2E (`64 pass`, `4 skips`), contrast, tokens e produção estrutural. `verify:triplo-aaa` continua `AAA_NOT_PROVEN`; `verify:staging` continua `STAGING_EVIDENCE_INCOMPLETE`; sem DeepSeek real, provider externo, secret authority, staging/TLS, collector/SLO, carga/caos/backup e aceite humano não há promoção AAA.

## Current checkpoint — 2026-09-10 clinical read closure

`VER-CVG-084` registra o commit `6b3df2f424ebfbe77acc4b332e4c55fbcb734321`. A API agora encaminha `GET /api/v1/encounters` e `GET /api/v1/clinical/documents` pelo `ReadApplicationService`; em PostgreSQL, os adapters consultam `encounters`/`clinical_documents` em transação `READ ONLY`, estabelecem o contexto organizacional e filtram/validam unit/workspace, enums, timestamps, versão e projeções relacionadas. `VER-CVG-085` confirma `npm test` 122 (`121 pass`, `1 skip`), `test:database` 16/16, typecheck, lint, build, static, PDP, `verify:production` estrutural e diff check. `VER-CVG-086` registra que o critic fresh não retornou parecer; o mutation sentinel ficou estável e nenhuma aprovação foi inferida.

O incremento é uma redução verificável do bypass de snapshot, não uma prova de completude. Diagnostics, hospitalization, medication, stock, finance, communication, knowledge, queue e AI sessions agora também têm repositories normalizados no commit seguinte; jobs, PostgreSQL concorrente, staging, provider/DeepSeek, observabilidade operacional, load/chaos/recovery, browser assistive e aceite humano continuam gaps; o veredito segue `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.

## Current checkpoint — 2026-09-10 operational read closure

`VER-CVG-087` registra o commit `bf0cc506ff2fbbb99c77d334cfa60ba5921ffb22`: diagnostics, hospitalization, medication, stock, finance, communication, knowledge, queue e AI sessions foram extraídos para repositories tipados. A camada de aplicação e os adapters PostgreSQL usam transações `READ ONLY`, escopo contextual, joins explícitos e validação fail-closed; as rotas e o resumo operacional não acessam essas coleções diretamente.

`VER-CVG-088` confirma `npm test` 126 (`125 pass`, `1 skip`), `test:database` 20/20, typecheck, lint, build, static, PDP, `verify:production` estrutural e diff check. `VER-CVG-089` registra a tentativa de critic fresh da onda operacional; ausência de relatório será preservada como `NOT_COMPLETED`, sem inferir aprovação. Esta evidência continua local/sintética: não prova PostgreSQL concorrente, staging, provider/DeepSeek, secret authority, collector/SLO, load/chaos/recovery, WebKit/assistive tech/zoom real, CI do novo SHA ou aceite humano. O veredito permanece `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.

## Current checkpoint — 2026-09-10 durable worker SQL hardening

`1f066327b6d992a233e5bffae921af8377054899` qualifica todas as colunas retornadas pelo `UPDATE ... FROM` de claim através do alias `job`, removendo uma ambiguidade potencial entre a tabela-alvo e a CTE `candidates`. A regressão do SHA corrente passou `npm test` 135 (`134 pass`, `1 skip`), `test:database` 25/25, worker 12/12, typecheck, lint, build, `verify:static` 48/124, `verify:pdp`, `verify:production` estrutural e `git diff --check`. Os gates `verify:triplo-aaa`, `verify:staging` e `verify:deepseek-acp` continuam fail-closed por falta de evidência/ambiente externo; o resultado global permanece `FAIL_WITH_LIMITATIONS`/`AAA_NOT_PROVEN`.

## Current checkpoint — 2026-09-10 restore worker ledger

`c6048e4eb2b3714d4eb4ffc9603727b0cd2fe586` corrige a cobertura do drill de restore: `verify-postgres-restore.ts` reaplica `recoveredWorkerJobs`, compara seus digests no destino e confirma sua preservação na origem; o round-trip cifrado compara também a cardinalidade do ledger e registra a contagem no evento de restore. Os gates locais passaram (`npm test` 135, `test:database` 25/25, worker 12/12, typecheck/lint/build/static/PDP/verify:production/diff check). O script PostgreSQL real não foi executado por falta de `DATABASE_URL`/daemon Docker; o run remoto `34449276645` do SHA publicado ainda estava em execução na última observação. A crítica fresh do incremento foi encerrada como `NOT_COMPLETED`, registrada em [`.gauntlet/critique-restore-worker-ledger-attempt-20260910.md`](../.gauntlet/critique-restore-worker-ledger-attempt-20260910.md), sem aprovação. Isso reforça a preparação de recovery, mas não prova PostgreSQL concorrente, RTO/RPO, backup gerenciado ou produção; o veredito segue `FAIL_WITH_LIMITATIONS`/`AAA_NOT_PROVEN`.
## Checkpoint atual — 2026-09-10 contrato de entrypoints do worker

O recorte final `39024ca03af5a78ad1edabaf9e5be6654a98327d` centraliza a composição em `createWorkerDependencies`, aplica o mesmo `workerMaxOutstandingOutbox` a `maxOutstandingOutbox` e `maxOutstandingJobs`, compila/linta `docker/worker.ts`, testa a composição e exige o wiring nos gates estáticos e de release. A crítica fresh final registrou `REVIEW_ONLY_PASS` para o recorte, sem decisão AAA.

Evidência local exata: `npm test` 136 (`135 pass`, `1 skip`), `test:database` 25/25, worker 13/13, typecheck, lint 124 fontes, build, `verify:static` 50 artefatos/126 fontes, PDP, `verify:production` estrutural e diff check passaram. O provider, secret authority, staging, turno DeepSeek, PostgreSQL concorrente, worker/container production-like, observabilidade/SLO medidos, carga/chaos/recovery operacional, WebKit/assistive tech/zoom real, CI final concluído e aceite humano continuam sem prova; `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN` permanece.
## Observação remota — 2026-09-10

O run GitHub Actions `34451105914` do SHA técnico `39024ca03af5a78ad1edabaf9e5be6654a98327d` terminou `success` nos jobs principal e de imagens: Browser E2E, migrations/PostgreSQL/RLS, restore, release/Compose, performance, SBOM, builds e scans API/web passaram. O run posterior `34451891880`, do commit documental `8d80b31`, terminou `failure` no passo `Browser E2E`; os passos anteriores passaram e os gates dependentes foram pulados, enquanto o job de imagens também foi pulado. Os logs detalhados não estavam acessíveis sem autenticação. Isso é uma falha de CI a investigar, não autorização para promoção: CI não é staging nem aceite humano; o veredito segue `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.

## Checkpoint atual — 2026-09-10 escrita normalizada autoritativa

O recorte atual fecha a maior lacuna local de criação: `PatientApplicationService`
e o port de criação são assíncronos; `POST /api/v1/patients` executa
`idempotentAsync`; e o boundary PostgreSQL envia `normalizedPatientWrite` ao
mesmo commit que grava snapshot, journal, auditoria, receipt e outbox. A linha
autoritativa é escrita com escopo contextual e o id é removido da projeção
genérica; qualquer divergência, escopo incompleto, conflito ou indisponibilidade
restaura o baseline em memória e falha fechado.

Evidência local: `npm test` 138 (`137 pass`, `1 skip`), `test:database` 27/27,
`test:security` 26/26, `test:fault` 15/15, E2E 64/4 skips intencionais,
typecheck, build, lint, static, PDP, produção estrutural e diff check passaram.
Os testes HTTP/SQL usam pool sintético e não substituem PostgreSQL concorrente
fora do CI. As críticas fresh desta fatia foram encerradas sem relatório e
registradas como `NOT_COMPLETED`, sem aprovação.

O recorte não fecha todas as mutações normalizadas e não torna `ops.restore`
seguramente idempotente, pois o restore invalida sessões e limpa os receipts
canônicos. Staging, provider/DeepSeek, autoridade de segredos, Collector/SLO
operacional, carga/chaos/recovery production-like, WebKit/assistive-tech/zoom
real e aceite humano continuam ausentes. O veredito global permanece
`FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.

## Observação CI — escrita normalizada de paciente

O commit publicado `78bd717442e99ef6f7c4aadbc45a9ea17dbd7d4a` teve o run
`34458595207` concluído com `success`. O job principal `102810773997` passou
Browser E2E, migrations/PostgreSQL/RLS, restore, release/Compose, performance,
SBOM e artefatos; o job `102812568853` passou os builds e scans das imagens API
e web. O resultado é limitado ao pipeline remoto: não substitui staging,
providers/DeepSeek, autoridade de segredos, observabilidade operacional,
carga/chaos/recovery production-like ou aceite humano.

## Checkpoint atual — 2026-09-10 escrita normalizada autoritativa de appointment

`docs/verification-2026-09-10-appointment-source-write.md` registra a segunda
fatia local de escrita: `POST /api/v1/appointments` usa port assíncrono de
aplicação, `idempotentAsync` e envia `normalizedAppointmentWrite` para o mesmo
commit durável de snapshot, journal, auditoria, receipt e outbox. A linha
normalizada contextual é escrita uma vez com guard de igualdade e o id é
omitido da projeção genérica. A regressão local passou `npm test` 140
(`139 pass`, `1 skip`), E2E 64/4 skips, typecheck, build, lint, static, PDP,
produção estrutural, contraste, licenças e 23/23 testes de persistência.

Pool sintético não prova PostgreSQL concorrente/RLS fora do CI. Outras mutações
ainda dependem da projeção agregada; `ops.restore` continua sem replay seguro.
Provider/DeepSeek/secret authority, staging/TLS operacional, Collector/SLO,
carga/chaos/recovery production-like, browser/assistive-tech/zoom completo,
crítica independente aprovadora e aceite humano continuam ausentes. O
veredito permanece `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.

## Observação CI — escrita normalizada autoritativa de appointment

O commit publicado `9c304f39621736ad8bb5f4b39447c4ac9d94fd25` teve o run
GitHub Actions `34462488394` concluído com `success`. O job principal
`102823305023` passou os gates públicos de lint, typecheck, contratos,
segurança, banco, fault, testes, provider loopback, build/static, Browser E2E,
migrations/PostgreSQL/RLS, restore, Compose/release, performance sintética,
SBOM, artefatos e whitespace; o job de imagens `102825161621` passou build e
scan das imagens API e web. O resultado está vinculado ao SHA exato e não
substitui staging, provider/DeepSeek/secret authority, Collector/SLO medido,
carga/chaos/recovery production-like, browser completo, crítica aprovadora ou
aceite humano. O veredito global permanece `FAIL_WITH_LIMITATIONS` /
`AAA_NOT_PROVEN`.

## Fechamento de integração — idempotência durável — 2026-09-10

O commit `5d09f25a224faecdd75631fdd7070e3fc8b14fda` foi enviado para
`origin/main`. O [CVG CI #74](https://github.com/ricardoakinaga-dev/cvg-corp/actions/runs/34487688940)
terminou `Success`; os jobs principal (`102906073863`) e de imagens
(`102909026577`) também terminaram com sucesso. O próximo gate é
`EXTERNAL-EVIDENCE-AND-HUMAN-ACCEPTANCE`. Não há autorização para declarar
AAA ou promover dados, provider, segredos, staging ou produção.

## Checkpoint atual — 2026-09-10 escrita normalizada autoritativa de encounter

`POST /api/v1/encounters` agora usa `EncounterApplicationService`, repository
assíncrono e `idempotentAsync`. Em PostgreSQL, `normalizedEncounterWrite` é
entregue ao mesmo commit durável de snapshot, journal, auditoria, receipt e
outbox; a linha `encounters` tem DML contextual equality-guarded e é omitida
da projeção genérica. A persistência valida digest, organização, paciente e
appointment opcional, com `IS NOT DISTINCT FROM` nos campos nulos e falha
fechada em divergência.

Evidência local: persistência 26/26, `npm test` 143 (142 pass, 1 skip), E2E
64/4 skips intencionais, typecheck, build, lint 126 fontes, static 50/128,
PDP 68/70/6/12, produção estrutural e diff check passaram. A crítica fresca
foi encerrada como `NOT_COMPLETED`, sem score ou aprovação. O KPI financeiro
do dashboard também foi corrigido para exibir contagem de cobranças em aberto,
sem fabricar montante.

Esta fatia não prova PostgreSQL concorrente/RLS fora do CI, staging, provider/
DeepSeek/secret authority, Collector/SLO operacional, carga/chaos/recovery,
WebKit/assistive-tech/zoom real, demais mutações, replay seguro de
`ops.restore` ou aceite humano. O veredito global permanece
`FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.

## Observação CI e correção visual — 2026-09-10

O commit técnico `0f4018fc6143b179f49a1f7ad97b37b4fd0fea04` foi publicado em
`origin/main` e o run GitHub Actions `34466375415` terminou `success`; os jobs
`102835822550` (checks/release) e `102837781437` (imagens) passaram. Isso
confirma o pipeline para o SHA exato, sem provar staging, provider/DeepSeek,
autoridade de segredos, observabilidade operacional, carga/chaos/recovery ou
aceite humano.

Na sequência, a web recebeu uma correção local de verdade de estado e foco:
validação inicial não mostra login antes de confirmar a sessão, permissão
negada oferece seleção de contexto autorizado quando disponível e navegação
SPA entrega foco ao `main` inclusive após fechar o menu móvel. Typecheck, lint,
build e E2E 64/4 passaram localmente; a nova fatia ainda precisa de seu SHA e
CI próprios. O veredito permanece `FAIL_WITH_LIMITATIONS` /
`AAA_NOT_PROVEN`.

## Current checkpoint — authoritative clinical signing

`clinical.sign` now has an explicit application/repository boundary, requires
`expectedVersion`, increments the document version atomically in the domain and
uses an update-only contextual CAS in PostgreSQL. The same operation claims its
unique `idempotency_lookup` durably as `IN_FLIGHT` before mutation, settles
pre-commit failures, excludes the signed document from generic projection on
replay and records replay observation without replacing the original receipt
audit link. Encounter organization/patient consistency is checked in the
domain as well as persistence.

The fresh Nash review is recorded in
`.gauntlet/critique-clinical-sign-20260910.md`; it found one HIGH, two MEDIUM
and one LOW issue, with the applicable findings repaired and the transaction
boundary limitation retained explicitly. Local evidence is 147 tests (146
pass, 1 skip), E2E 64/4 intentional skips, lint 127, static 51/129, typecheck,
build, PDP, production structural verification and diff check green. Commit
`05e417975bd83701105d378a7aef53a34245e7c5` is published; exact-SHA CI run
`34471837382` completed successfully. Global verdict remains
`FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.

## Remote CI observation — authoritative clinical signing

The technical commit `05e417975bd83701105d378a7aef53a34245e7c5` was published
to `origin/main`. [GitHub Actions run 34471837382](https://github.com/ricardoakinaga-dev/cvg-corp/actions/runs/34471837382)
completed with conclusion `success` for the exact SHA. The main job
`102853294375` and image build/scan job `102855264534` also completed
`success`, and the verification and Browser E2E artifacts were published.

This is exact-SHA CI evidence only. It does not establish authorized
staging/TLS operation, real provider/DeepSeek/secret authority, operational
Collector/SLO evidence, production-like load/chaos/recovery, the full
browser/assistive-technology matrix, or human AAA acceptance. The global
verdict remains `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.

## Checkpoint atual — idempotência durável de comandos retryable

`DurableIdempotencyService` agora é injetado no runtime e compõe as mutações
retryable da API, os quatro comandos de IA e a exportação governada. O claim
PostgreSQL (`IN_FLIGHT`) acontece antes do callback; replay, conflito de corpo,
claim concorrente e settlement de falha têm estados explícitos. A rota
`clinical.sign` permanece especializada para validar replay e projetar o CAS
clínico, mas usa a mesma autoridade de recibo. Login/MFA/recuperação/emissão de
sessão e webhooks não foram forçados a uma semântica genérica incompatível
com segredos ou identidade de evento.

Evidência local desta lane: `npm test` 153 (`152 pass`, `1 skip`),
`test:database` 35/35, `test:fault` 17/17, E2E 64/4 skips, typecheck, build,
lint, static 52/130, PDP 68/70/6/12, `verify:production` estrutural,
provider loopback, contraste, tokens, licenças e diff check passaram.
As tentativas de crítica fresh foram encerradas como `NOT_COMPLETED`, sem
aprovação. O claim local ainda usa fake persistence nos testes da nova classe;
concorrência PostgreSQL real, crash/restart, staging, provider/DeepSeek,
segredos, Collector/SLO, carga/chaos/recovery e aceite humano permanecem
ausentes. O veredito global não muda: `FAIL_WITH_LIMITATIONS` /
`AAA_NOT_PROVEN`.
