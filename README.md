# CVG-Corp

Sistema operacional veterinário local-first, reconstruído a partir da especificação em [`docs/`](docs/README.md) e do prompt normativo preservado em [`docs/prompt-final-operational-proof-2026-09-10.txt`](docs/prompt-final-operational-proof-2026-09-10.txt). Esta fotografia inclui runtime governado, API modularizada, worker separado, web modular, persistência transacional e artefatos de release.

## Executar a demonstração

```bash
npm install
npm run bootstrap
npm run dev
```

Abra `http://127.0.0.1:5173`. A demonstração sintética pode ser acessada pelo botão próprio da tela inicial. Para login convencional, use as credenciais geradas em `.local/bootstrap-credentials.json`.

O modo padrão usa memória descartável para permanecer executável sem dependências externas. O adapter PostgreSQL implementa bootstrap, `BEGIN`/`COMMIT`/`ROLLBACK`, lock advisory, CAS de revisão, snapshot JSONB, journal independente com escopo organizacional, ledgers duráveis de auditoria/receipts com cadeia `previous_hash`/`record_hash`, leituras normalizadas de guardians/patients/appointments/audit e demais projeções cobertas com escopo de transação, outbox com claim/lease/fencing, fila interna `cvg_worker_jobs` com admission idempotente, `SKIP LOCKED`, lease/fence/retry/quarantine, heartbeat `cvg_worker_heartbeats`, ledger idempotente de uso e proveniência de turnos de IA, inbox atômico com assinatura/verificação configurável, ledger de efeitos externos com recibo obrigatório, reconciliação explícita, ciclo durável de break-glass com WebAuthn-only, verificação criptográfica de assertion, revisão e guard de transições, `ENABLE/FORCE RLS` nas tabelas de domínio e FKs cross-table com proveniência organizacional. A revalidação PostgreSQL local corrente aplicou em ordem as migrations `001_initial.sql`–`036_runtime_migration_metadata_privileges.sql` no banco efêmero `cvg_verify_20260912`; a role `cvg_runtime` permaneceu sem superusuário/BYPASSRLS e com acesso somente leitura a `schema_migrations`. Migrations já aplicadas não devem ser editadas; a 028 é um forward-fix que preserva o lock transacional usado pelo writer sem remover o guard append-only da 027, a 029 adiciona `usage_record_id`, `provenance_json`, ledger de usage e escopo DML estrito, a 030 fornece armazenamento durável para grants admitidos após aprovação independente verificada pela aplicação, a 031 adiciona jobs/heartbeats com RLS, as 032–035 fecham escopo e integridade dos filhos diagnósticos e do break-glass, e a 036 restringe a escrita do metadata de migrations à conexão de migration; nenhuma dessas provas locais substitui WebAuthn/concorrência production-like autorizada. O drill de restore exporta e verifica snapshot + outbox + usage + inbox + efeitos externos + jobs por digest, encapsula o bundle em AES-256-GCM com `keyRef`, rejeita adulteração e restaura em destino temporário quarentenado; inclui um cenário sintético de crash após marcador de dispatch sem reenvio cego. A API também possui exportação governada `POST /api/v1/ops/export`, que exige PostgreSQL, SecretProvider, referência `CVG_RECOVERY_ENCRYPTION_KEY_REF`, uma finalidade do registry (`INCIDENT_RECOVERY`, `AUDIT_REVIEW`, `MIGRATION_VALIDATION` ou `LEGAL_HOLD`), escopo `ORGANIZATION`, TTL, PDP, auditoria e `Idempotency-Key`; no modo memória ela falha fechado. O JSONB ainda é a fonte agregada de reconstrução em transição; handlers de negócio dos jobs, PDP universal em todas as rotas/repositories, provider real e consulta externa de reconciliação ainda não foram promovidos. Sem PostgreSQL disponível, `CVG_STORAGE=postgres` falha fechado para não simular durabilidade. Nenhum banco existente é removido por scripts do projeto.

## Verificação

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
npm run audit:licenses
npm run audit:contrast
npm run audit:tokens -- --strict
npm run benchmark:local
npm run verify:production
npm run verify:release-provenance -- --manifest artifacts/release-provenance.json
npm run verify:promotion-invariant -- --manifest promotion.json
npm run verify:container-smoke -- --url https://staging.example --release-sha <sha> --artifact-digest <sha256>
npm run verify:provider-sandbox
npm run verify:provider-real
npm run verify:staging
npm run verify:deepseek-acp
npm run verify:deepseek-real
npm run verify:pdp-universal
npm run verify:audit-chain
npm run verify:authoritative-writes
npm run verify:postgres:concurrency
npm run verify:triplo-aaa
node --import tsx --test tests/unit/deepseek-bridge.test.ts
```

Com PostgreSQL local disponível, aplique as migrations e execute a verificação durável com uma URL de conexão explícita:

```bash
DATABASE_URL='postgresql://...' npm run db:migrate
DATABASE_URL='postgresql://...' CVG_STORAGE=postgres CVG_BOOTSTRAP_PASSWORD='senha-sintética' npm run verify:postgres
DATABASE_URL='postgresql://...' CVG_BOOTSTRAP_PASSWORD='senha-sintética' npm run verify:postgres:restore
```

O verificador exercita bootstrap, login, mutation idempotente, commit de journal/auditoria/receipt, restart, leituras normalizadas recuperadas, outbox/worker, recibo de provider sintético, resultado desconhecido e reconciliação, inbox atômico com assinatura HMAC sintética, CAS concorrente, crash após marcador de dispatch e isolamento RLS organizacional + unidade/workspace — inclusive snapshot/journal e mutações clínicas negativas — usando papel efêmero não-superusuário removido ao final. O drill de restore cria apenas um banco temporário identificado, recupera os seis conjuntos de evidência (snapshot, outbox, usage, inbox, efeitos externos e jobs) por digest, reaplica `workerJobs` e verifica que tentativas, status e fences foram preservados, valida quarentena/login/readiness e remove somente o destino criado pelo próprio drill; nenhum banco existente é alvo. `verify:production` valida os artefatos de release e o Compose em ambiente sintético, sem iniciar serviços; quando Docker não está disponível, encerra com falha fechada/resultado incompleto.

O artifact atual demonstra identidade, contexto, agenda, pacientes, atendimento, estoque, financeiro e copiloto governado com dados sintéticos. Provider real, credenciais externas, dados reais, break-glass e produção são bloqueados na API, não apenas ocultados na UI. A exportação governada existe como capability durável de PostgreSQL, mas permanece indisponível em memória e sem Secret Authority operacional. `verify:pdp-universal` e `verify:authoritative-writes` são verdes para o boundary local estático, Fastify, worker e invariantes das 32 coleções normalizadas; `verify:deepseek-real` e `verify:provider-real` terminam `BLOCKED_EXTERNAL` sem endpoints e credenciais autorizados.

`npm run verify:provider-sandbox` executa uma prova local de transporte HTTP pelo `HttpMessagingProvider`, em loopback e com segredo de fixture não produtivo: replay com a mesma chave, perda de resposta após aceite (`OUTCOME_UNKNOWN`), consulta por idempotência e callback HMAC válido/inválido. Essa prova fortalece o contrato de integração, mas `externalProvider` permanece `NOT_RUN` e não autoriza egress real.

O caminho de IA usa a interface `AgentRuntime`, um adapter Mock determinístico e um adapter DeepSeek opcional. O Mock tem policy, budget, approval, provenance, quarentena de prompt injection e replay. O bridge DeepSeek funciona como uma ponte CVG `/v1` com health/manifest/tool-set estritos, bearer de serviço, assinatura HMAC do contexto, correlation, cancel, timeout e envelopes de erro; seu port nativo default é `UNAVAILABLE`, não há fallback implícito e nenhuma conexão externa é alegada neste workspace. Consulte [`docs/deepseek-production-integration.md`](docs/deepseek-production-integration.md).

## Estrutura

- `apps/api`: BFF Fastify, application services, rotas de health, pacientes, IA e exportação governada, autenticação, escopo e auditoria.
- `apps/worker`: processo separado com health, heartbeat persistido, shutdown cooperativo e ciclo de outbox/jobs/schedule/reconciliation/notifications/maintenance; cinco handlers duráveis tipados, policy explícita do relay outbox, budgets, retries, quarentena, auditoria, métricas e bulkheads fail-closed.
- `apps/web`: interface React/Vite responsiva, modular por shell/rotas/features e com máquina de estados operacionais.
- `packages/contracts`: schemas e contratos públicos compartilhados.
- `packages/domain`: invariantes e store sintético.
- `packages/agent-runtime`, `packages/agent-policy`, `packages/agent-tools`: contratos de runtime, PDP/ABAC e gateway governado.
- `packages/harness-adapters`: adapters Mock e DeepSeek com fail-closed.
- `packages/deepseek-bridge` e `apps/deepseek-bridge`: contrato `/v1` provider-neutral, sem fallback, com port nativo explícito.
- `packages/config`: configuração typed e validação fail-closed.
- `packages/harness`: governança de sessões/tools/approval/budget/replay.
- `packages/persistence`: boundary PostgreSQL transacional, leituras normalizadas, outbox/jobs/heartbeats/usage/provenance, export/restore e validação de snapshot/journal.
- `packages/integrations`: contratos, adapters deny-by-default e worker bounded de outbox.
- `packages/ops`: métricas e redaction.
- `docker/`: Compose local, overlay `docker-compose.production.yml`, Nginx/TLS, observabilidade, secrets e worker container.
- `db/migrations`: schema PostgreSQL sem seed real.
- `.agent/` e `.gauntlet/`: estado de execução e bar de verificação deste trabalho.

## Estado de qualidade

O worker de produção usa somente handlers tipados, exige auditoria durável append-only e bloqueia o acknowledge quando o append falha. O smoke de container separa o probe público do cenário autenticado: login/MFA, cookie observado, patient lookup, escrita controlada, heartbeat/outbox, DeepSeek/provider e restart só passam com entradas externas explícitas.

A reauditoria do prompt operacional de 2026-09-10 está em [`docs/final-operational-proof-audit.md`](docs/final-operational-proof-audit.md), com a [cópia integral do prompt](docs/prompt-final-operational-proof-2026-09-10.txt). `npm run verify:pdp-universal` compõe inventário HTTP real, services de aplicação, callbacks assinados, registry de jobs e testes de violações; sua aprovação cobre o boundary local e não equivale a aprovação de produção. O histórico abaixo pertence a checkpoints anteriores e não comprova o SHA corrente.

Os gates locais determinísticos desta fotografia incluem 330 testes (329 pass, 1 skip), persistência 61/61, segurança 28/28, fault 27/27, contrato 5/5, E2E Playwright 124 pass/29 skips/0 falhas em 153 casos de Chromium/Firefox/WebKit wide/tablet/mobile e stress cross-engine (WebKit via prefixo de bibliotecas no espaço do usuário; touch fica explicitamente sem prova nos engines que não expõem maxTouchPoints), lint (169 fontes), typecheck, build Vite, verificação estática (149 artefatos/171 fontes), PDP universal, invariantes de writes authoritative, cadeia de auditoria, contratos executáveis de security red-team (24/24), resource-pressure (6/6), runbook (12/12; F35 fixtures 7/7 EXECUTED_LOCAL) e verificação estrutural de produção. O worker runtime local validou 6 policies e 35 focused tests, com fila em modo reject. A recuperação agora reconstrói os digests imutáveis de outbox, usage, inbox, efeitos externos e jobs antes de aceitar o manifesto. A compatibilidade de contratos v1/v2 preparada usa um registro de upcasters explícito e fail-closed, sem aceitar schema legado não aprovado. A fronteira local também verifica criptograficamente assertions WebAuthn e receipts Ed25519 de aprovação humana, exige raiz de evidência externa fora do checkout e vincula bytes de prova e SBOM aos seus digests; isso não cria autoridade humana ou evidência production-like. O contrato de critics exige as 15 categorias do prompt, rejeita `FAIL`/`CRITICAL`/`HIGH`, exige assinatura Ed25519 de revisor independente e artefatos red-team separados para F23/F24. Receipts de gate precisam de um artefato de execução separado; smoke exige shutdown/outbox/replay/restart. A persistência oferece backup operacional atômico com envelope AES-256-GCM, manifest vinculado, tamper/chave incorreta rejeitados, retenção local verificável e `OperationalBackupJob` periódico serializado; object storage, autoridade de chave, agendamento gerenciado e RTO/RPO continuam externos. O scorecard machine-readable exige os limiares específicos do prompt por dimensão (95–97) e `Overall` 97; uma nota abaixo do limiar próprio invalida um candidato. O bundle externo do DeepSeek também precisa cobrir as 31 operações positivas/negativas, identidade same-SHA, revisão independente e risco residual antes de qualquer verificação real. A prova vertical do provider exige ainda timestamps atuais por etapa e rejeita evidência velha, futura ou sem arquivo vinculado. O ledger de IA agora expõe AiUsageSettlement tipado, com modelo/tokens/digest/custo/discrepância e estados explícitos para preço ausente. O workflow CI executa também os gates universais, tamper-evidence, writes authoritative e concorrência PostgreSQL no mesmo checkout e publica SBOM/recibo de estágios CI com o provenance. A barra ativa v4 permanece `FAIL_WITH_LIMITATIONS`: produção, dados reais, secret manager real, provider externo, turno DeepSeek, entrega efetiva, PostgreSQL concorrente autorizado, collector/SLO/alertas medidos, carga/chaos/recovery production-like, assistive tech/zoom real e aprovação independente ainda não foram provados. O sistema não deve ser apresentado como Triplo AAA ou release pronto; o scorecard honesto está em [`docs/triple-aaa-final-scorecard.md`](docs/triple-aaa-final-scorecard.md), com revalidação final `VER-CVG-268`.


## VER-CVG-259 — revalidação corrente

A execução local atual passou 327 testes (326 pass, 1 skip, 0 fail), worker runtime 6 policies/35 focused, cadeia de auditoria, typecheck, build, lint 169 e static 149/171. O snapshot byte-bound é `fc9fe3cbd58c2e9a513db04208a9316b7c59bdffffe65b4da1aa2e22d351fc21`. O caminho de reconciliação usa o handler durável tipado, o outbox audita e metrifica cada tentativa antes do acknowledge e a cadeia é reconstruída por hashes. A crítica [VER-CVG-259](.gauntlet/critique-final-gauntlet-20260911-VER259.md) é review-only; gates externos, críticos aprovadores e aceite humano continuam ausentes, portanto o veredito honesto é `AAA_NOT_PROVEN`.


## VER-CVG-260 — fotografia final

A fotografia final local passou 327 testes (326 pass, 1 skip, 0 fail), worker runtime 6 policies/35 focused, cadeia de auditoria, typecheck, build, lint 169 e static 149/171. O snapshot byte-bound é `1db5b18f6475a529816b5003bc62e9dc5201f09105a3c45e66e9e1f87b4dc878`. A crítica [VER-CVG-260](.gauntlet/critique-final-gauntlet-20260911-VER260.md) é review-only; gates externos, críticos aprovadores e aceite humano continuam ausentes, portanto `AAA_NOT_PROVEN` e promoção bloqueada permanecem corretos.


## VER-CVG-261 — PostgreSQL

A revalidação local aplicou as 36 migrations atuais em PostgreSQL 16.15 efêmero e passou `verify:postgres`, concorrência em dois processos e restore AES-256-GCM. O snapshot é `2e19a834afa9241a5d3d29a15416e6d8706afd6b6943bfe6ce447217600f1dfb`; a prova segue local, com gates externos e humanos ausentes.


## VER-CVG-262 — estado final

O bundle local final está reconciliado ao snapshot `5eea301f3c2af29d6ebca101d85b5113494eaafdfcd4f4a3f29e0291f1cad903`; a crítica fresh é review-only e o veredito honesto permanece `AAA_NOT_PROVEN`.

## VER-CVG-264 — metadata final

O snapshot final `903db416c44e1df7f12f2270bd078bcf5724b50d878ffd1ea021691a801a8004` liga os artifacts reconciliados ao HEAD e ao prompt preservado. A crítica fresh final continua review-only; faltam as provas externas, críticos aprovadores e aceite humano, portanto `AAA_NOT_PROVEN` permanece correto.


## VER-CVG-265 — recuperação auditável

A fronteira de recovery agora reutiliza `verifyAuditChain` no domínio: `validateRecoveryBundle` e `encryptRecoveryBundle` rejeitam snapshots que tenham sido reempacotados com um registro de auditoria adulterado, mesmo quando o digest do snapshot e o manifesto são recalculados. A regressão confirmou rejeição em validação e cifragem. A fotografia local registra 328 testes (327 pass, 1 skip, 0 fail), snapshot `88b7fec93375728b68821917b64ed82d37b62731d45cd70a9dfc33406455680a`, SHA do snapshot `c28800072dd4ace183810b94ce1e242e49c0319322174c6e2426a6a70a3de49f` e crítica fresh [.gauntlet/critique-final-gauntlet-20260911-VER265.md](.gauntlet/critique-final-gauntlet-20260911-VER265.md); os gates externos e a aprovação humana continuam ausentes, portanto `AAA_NOT_PROVEN` permanece correto.


## VER-CVG-266 — recovery autenticação estrita

A fronteira de recovery agora rejeita sessões e desafios sem timestamps obrigatórios, além de verificar a cadeia de auditoria antes de aceitar ou cifrar o bundle. A regressão cobre adulteração reempacotada e `expiresAt` ausente. A fotografia local registra 329 testes (328 pass, 1 skip, 0 fail), snapshot `f02418cb693c74f94a05c96703b209d4413301b3cc2bd2c224125f3a9c92b69b`, SHA `89417f80ec60b708182a9ccfd689885f4bcd52af766bfd0118712cf4531ce167` e crítica fresh [.gauntlet/critique-final-gauntlet-20260911-VER266.md](.gauntlet/critique-final-gauntlet-20260911-VER266.md); os gates externos e a aprovação humana continuam ausentes, portanto `AAA_NOT_PROVEN` permanece correto.


## VER-CVG-267 — recovery sem normalização silenciosa

A fronteira de recovery valida a forma bruta do estado de autenticação antes de `parseSnapshot`: usuários exigem estado de segurança completo, sessões e desafios exigem timestamps, versões e contadores obrigatórios, e a cadeia de auditoria continua sendo reconstruída antes da aceitação ou cifragem. A regressão completa registra 329 testes (328 pass, 1 skip, 0 fail). Snapshot `dbc1da159294f9a04c8509f46b99b5a4a7a3cb5ab2a738094d6b7f0d88ee8b07`, SHA `6b6d7d6b77a5481c510cef1f3142a6ec0de13989940a10bbac17f29c08dfcde9`; artifact local `98d31bc53f989dfae0e25c63d67cd7307744480683aa0c712b1808b40289ccb2`; crítica fresh [.gauntlet/critique-final-gauntlet-20260911-VER267.md](.gauntlet/critique-final-gauntlet-20260911-VER267.md) pendente de revisão. Os gates externos e a aprovação humana continuam ausentes; `AAA_NOT_PROVEN` permanece correto.

## VER-CVG-268 — digests imutáveis dos ledgers de recovery

A fronteira de recovery agora recalcula o digest canônico dos campos imutáveis de outbox, usage, inbox, efeitos externos e jobs, rejeitando conteúdo divergente mesmo quando o manifesto é refeito. A regressão inclui payload de outbox adulterado e passou 330 testes (329 pass, 1 skip, 0 fail), typecheck, build, lint 169 e static 149/171. Snapshot run `76518144d894beed7821e79789531bbe101c80db1ada5883303d161647c71ea4`, SHA `23c302c622488335e2152212d81e26862854a4b5f1ca5ee807e53ce501ffcd50`; artifact local `bc0807b388a59ab906e35a1a66a7acec208433451a81d03cadad18d599748034`; crítica fresh [critique-final-gauntlet-20260911-VER268.md](.gauntlet/critique-final-gauntlet-20260911-VER268.md) review-only. Os gates externos e a aprovação humana continuam ausentes; `AAA_NOT_PROVEN` permanece correto.
