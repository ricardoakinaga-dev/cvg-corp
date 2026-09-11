# Fechamento local — 2026-09-11

Fotografia corrente do workspace `/home/ricardo/Área de trabalho/cvg-corp`: `VER-CVG-268` / `EVT-CVG-20260911-VERIFY-330`, sobre o HEAD `e43b3b0032aafb9d17563b1fce00fbae88ee0d51` com worktree modificado. O prompt normativo preservado é [`docs/prompt-final-operational-proof-2026-09-10.txt`](prompt-final-operational-proof-2026-09-10.txt), SHA-256 `39dfbb610267b61854b972bf8513f6562b0ee374aa308f7a79b38d21f2cdeae3`.

Checkpoint corrente: `VER-CVG-268` / `EVT-CVG-20260911-VERIFY-330`. A regressão local corrente está verde — 330 testes (329 pass, 1 skip), E2E 153 (124 pass, 29 skip), static 149/171, lint 169 e worker runtime 6 policies/35 focused — mas `npm run verify:triplo-aaa` encerra exit 2 `AAA_NOT_PROVEN`; o worktree está modificado e as provas externas, critics aprovadores e aceite humano continuam ausentes. A prova PostgreSQL corrente aplicou migrations 001–036 e passou concorrência e restore locais.

## Alterações verificadas

- `DeepSeekHarnessAdapter.health()` agora rejeita `READY` quando cancellation, approvals, replay e provenance não estão completos; nenhuma capability incompleta é promovida.
- O harness local executa tools pelo `ToolGateway.execute()`, com PDP, timeout, ledger, idempotência e executor sintético `LOCAL_ONLY`; o receipt de uma aprovação de alto impacto foi observado como `SUCCEEDED`.
- Lease expirada de outbox falha fechado e o startup exige explicitamente as migrations de cadeia de auditoria 026–028.
- A migration 029 adiciona `usage_record_id`/`provenance_json`, ledger de usage idempotente e políticas DML estritas para unit/workspace; a persistência agora rejeita divergência de uso/proveniência.
- A migration 030 adiciona ciclo durável de break-glass com MFA `WEBAUTHN`, FKs organizacionais, `FORCE RLS`, janela máxima de 15 minutos e guard forward-only para expiração, revogação e revisão; a capability pública continua `BLOCKED`.
- A leitura de auditoria foi extraída para um `AuditRepository` tipado: o caminho PostgreSQL consulta `audit_records` em transação `READ ONLY`, aplica organização/unidade/workspace e rejeita metadata, resultado ou versão de cadeia corrompidos; o runtime mantém o adapter de memória como fallback.
- A API passou a oferecer `/api/v1/ops/export`, protegido pelo PDP, finalidade/TTL/idempotência, SecretProvider e AES-256-GCM; purpose é devolvido com digest auditável, o envelope v2 autentica `expiresAt` no AAD e o decrypt rejeita cópias expiradas; sem PostgreSQL ou chave de 256 bits o endpoint falha fechado.
- O overlay `docker-compose.production.yml` usa `proxy.tls.conf`, certificados montados out-of-band, redirect 80→HTTPS e TLS 1.2/1.3; o verificador renderiza a composição e rejeita a porta 8080 de desenvolvimento, mas não inicia o proxy nem prova certificado/staging.
- O guard de PDP compara o catálogo inteiro de rotas protegidas e boundaries de aplicação, incluindo export, worker fenced e recovery durável.
- A API expõe `/internal/metrics` somente para a rede privada de observabilidade, com métricas agregadas sem tenant/rota; Prometheus, alertas de dependência, `OUTCOME_UNKNOWN`, reconciliação e poison outbox foram ligados estruturalmente.
- A UI separa login inicial de sessão expirada, `PERMISSION_DENIED` de revalidação, e `STALE` de degradação; 403 não repete a mesma solicitação e 401 durante sessão oculta o conteúdo.
- As leituras PostgreSQL de diagnostics, hospitalization, medication, stock, finance, communication, knowledge, queue e AI sessions agora atravessam repositories tipados em transações `READ ONLY`, com filtros contextuais, joins explícitos e validação fail-closed de linhas duráveis; o resumo operacional também usa esses adapters.
- A migration 031 adiciona `cvg_worker_jobs` e `cvg_worker_heartbeats` com `FORCE RLS`, admission idempotente por organização/lane/chave e digest imutável, claim com `SKIP LOCKED`, lease/fencing, tentativas limitadas, quarantine e liveness persistida com rejeição de heartbeat obsoleto.
- A persistência inclui jobs duráveis no bundle de recovery e no digest do manifesto; heartbeats são liveness operacional e não são restaurados como autoridade histórica. O worker aplica backpressure antes do claim, handlers explícitos, completion/failure fenced e métricas locais de depth/poison.

## Evidência local

| Procedimento | Resultado observado |
|---|---|
| `npm test` | PASS — 136 testes: 135 pass, 1 skip condicional |
| `npm run typecheck` | PASS |
| `npm run build` | PASS — typecheck + Vite |
| `npm run lint` | PASS — 122 fontes |
| `npm run verify:static` | PASS — 48 artefatos, 124 fontes; migration 031 e teste de jobs duráveis incluídos; `/internal/metrics` possui exceção explícita e rede privada documentada |
| `npm run verify:pdp` | PASS — 68 operações, 70 regras, 6 policies canônicas, 12 domínios |
| `npm run test:security` | PASS — 26 testes |
| `npm run test:database` | PASS — 25 testes: persistência, repositories normalizados de domínio, break-glass durável, exportação governada, restore e jobs/heartbeats duráveis |
| `npm run verify:provider-sandbox` | PASS — loopback HTTP, replay, `OUTCOME_UNKNOWN`, reconciliação e HMAC; `externalProvider=NOT_RUN` |
| `npm run verify:production` | PASS limitado — gates locais completos, Compose principal/observabilidade e overlay TLS renderizados; nenhum serviço de produção foi iniciado |
| `npm run audit:contrast` | PASS — 7/7 pares |
| `npm run audit:tokens` | PASS — 0 high/critical; 73 sinais medium heurísticos não bloqueantes |
| `npm run audit:licenses` | PASS — 207 dependências |
| `npm audit --omit=dev` | PASS — 0 vulnerabilidades |
| `npm run test:e2e` | PASS — 64 testes, 4 skips condicionais (Chromium/Firefox/stress) |
| `npm run benchmark:local` | PASS limitado — baseline do stub local; não é SLO/capacidade |
| `git diff --check` | PASS |

## Gates que corretamente não promovem AAA

- `npm run verify:triplo-aaa`: `AAA_NOT_PROVEN`, exit 2. Gates locais passaram; registry ficou bloqueado pela rede e não houve provider real, secret authority, staging, Collector/SLO, recovery/load production-like, WebKit, assistive tech, zoom real ou aceite humano.
- `npm run verify:staging`: `STAGING_EVIDENCE_INCOMPLETE`, exit 2. Nenhuma URL foi configurada e nenhuma chamada de rede foi feita.
- `npm run verify:deepseek-acp`: bloqueado, exit 2, sem o conjunto explícito `CVG_DEEPSEEK_ACP_*` e atestação. O bridge permanece fail-closed; não houve prompt/turno LLM real.

## Limitações mantidas

O artifact continua local-first e sintético. Usage/provenance, exportação governada, as leituras normalizadas de auditoria, encounters, clinical, diagnostics, hospitalization, medication, stock, finance, communication, knowledge, queue e AI sessions, a admission/lease/quarantine local de jobs e o armazenamento durável do ciclo break-glass estão implementados e cobertos localmente, mas a execução PostgreSQL concorrente real, handlers de negócio em produção, provider WebAuthn/secret authority, provider/DeepSeek, staging/TLS real, collector/alert dispatch/SLO medidos, carga/chaos, backup/RTO/RPO, leitor de tela, assistive tech e zoom real de 200% continuam `PARTIAL`, `NOT_RUN` ou `BLOCKED`. O host desta fotografia não tinha `DATABASE_URL` nem daemon Docker; por isso migration/role/RLS em PostgreSQL efêmero e startup de containers não foram executados neste checkpoint. Os commits `c3c18de` e `1f06632` fecham a fundação local de jobs/heartbeats e a qualificação do claim, mas não fecham V3-DATA-001 nem provam a execução production-like. A crítica fresh contra o SHA atual não retornou parecer e está registrada em [critique-worker-jobs-current-attempt-20260910.md](../.gauntlet/critique-worker-jobs-current-attempt-20260910.md); isso não é aprovação. O veredito global permanece `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.

## Incremento local — AuditRepository — 2026-09-10

No commit `135ae56`, `GET /api/v1/audit` deixou de acessar `CvgStore.listAudit` diretamente. Em PostgreSQL, `PostgresPersistence.listAudit` usa a transação contextual `READ ONLY`, consulta `audit_records` com organização e escopo de unidade/workspace, mantém paginação por cursor e valida os campos duráveis antes de serializar. Metadata não escalar, resultado desconhecido no banco ou versão de cadeia diferente de `2` produzem quarentena por corrupção, sem downgrade para lista vazia.

Evidência corrente: `npm test` passou com `121` testes (`120 pass`, `1 skip`); `npm run test:database` passou `15/15`, incluindo rota HTTP PostgreSQL-fake, escopo e linha corrompida; `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify:static`, `npm run verify:pdp`, `npm run verify:production` e `git diff --check` passaram. O incremento reduz a dependência operacional do snapshot para auditoria, mas não cria repositories completos para os demais bounded contexts nem evidência PostgreSQL/staging de produção.

Nenhum segredo, dado real, provider externo, publicação de efeito ou alteração no repositório `/home/ricardo/deepseek-harness` foi realizada.

## Incremento local — EncounterRepository e ClinicalRepository — 2026-09-10

No commit `6b3df2f`, `GET /api/v1/encounters` e `GET /api/v1/clinical/documents` passaram a atravessar `ReadApplicationService`, com policy de aplicação e adapters separados para memória e PostgreSQL. O adapter PostgreSQL consulta `encounters` e `clinical_documents` em transação `READ ONLY`, usa `cvg_request_organization()`/`cvg_request_scope_allows(...)`, filtros explícitos de unidade/workspace e valida IDs, enums, timestamps, versão e projeções relacionadas antes de devolver dados. O endpoint clínico continua removendo `content` da resposta pública.

Os testes cobrem linha conhecida-bom, status clínico persistido não suportado com rollback e rotas HTTP usando o pool PostgreSQL-fake; a verificação estática também bloqueia bypass direto dessas leituras. Evidência observada: `npm test` 122 (`121 pass`, `1 skip`), `npm run test:database` 16/16, typecheck, lint, build, static, PDP, `verify:production` estrutural e `git diff --check` passaram. O gate de produção confirmou Compose base, observabilidade e overlay TLS renderizados, sem iniciar serviços.

Esta onda não prova PostgreSQL real/concurrente, nem cria repositories para diagnostics, hospitalization, medication, stock, finance, communication ou jobs. O critic fresh não completou e nenhum status AAA foi inferido.

## Incremento local — Repositories operacionais e sessões de IA — 2026-09-10

No commit `bf0cc506ff2fbbb99c77d334cfa60ba5921ffb22`, as rotas de diagnostics, hospitalization, medication, stock, finance, communication, knowledge, queue e AI sessions passaram pelo `ReadApplicationService`. Os adapters PostgreSQL consultam as projeções duráveis em transações `READ ONLY`, aplicam organização/unidade/workspace e, quando necessário, derivam o escopo por encounter, charge/payment ou appointment; joins de produto, localização, paciente e contagem de turnos são explicitamente validados. Enums, IDs, timestamps, inteiros, conteúdo e metadados de proveniência inválidos produzem `PersistenceCorruptionError` e rollback, sem transformar corrupção em lista vazia.

Os testes adicionados cobrem linhas conhecidas, projeções relacionadas, filtros exatos, 20 transações `BEGIN READ ONLY`/`COMMIT`, status durável não suportado em cada tranche e roteamento HTTP PostgreSQL-fake. `npm test` passou com 126 testes (125 pass, 1 skip), `npm run test:database` 20/20, typecheck, lint, build, static, PDP, `verify:production` estrutural e `git diff --check` passaram. Isso reduz o bypass do snapshot no runtime, mas não prova PostgreSQL concorrente, staging, provider, DeepSeek, observabilidade operacional ou AAA.

## Incremento local — Jobs duráveis e heartbeats — 2026-09-10

No commit `c3c18de9282159fa25022d7f8ce591889b73445d`, a migration 031 adiciona a fila tenant-scoped `cvg_worker_jobs` e a tabela de liveness `cvg_worker_heartbeats`. A admission é idempotente por organização/lane/chave e compara o digest da carga imutável; o claim usa `FOR UPDATE SKIP LOCKED`, lease, fence token monotônico e limite de tentativas, enquanto completion/failure exigem o worker e fence vigentes. Jobs com tentativas esgotadas são colocados em `QUARANTINED`; a persistência expõe depth, idade, poison messages e heartbeat stale-protected. Ambas as tabelas têm `FORCE RLS`, políticas de organização e privilégios DML mínimos.

O worker aplica backpressure por lane antes de reclamar trabalho, executa somente handlers registrados, registra sucesso/erro com fencing e mantém desconhecidos/poison visíveis. O bundle de recovery inclui `workerJobs` e seu digest no manifesto; heartbeats são liveness corrente e são recriados, não usados para reativar autoridade histórica. Evidência local: `npm test` 135 (`134 pass`, `1 skip`), `npm run test:database` 25/25, `npm run typecheck`, `npm run lint` (122 fontes), `npm run build`, `npm run verify:static` (48 artefatos/124 fontes), `npm run verify:pdp`, `npm run verify:production` estrutural e `git diff --check` passaram.

Essa evidência usa pools sintéticos/fakes para as novas integrações; não prova PostgreSQL real concorrente, startup de container, handlers de negócio em produção, dead-letter operacional, métricas/heartbeat observados em staging, CI do SHA atual ou aceite humano. A crítica fresh read-only foi encerrada após duas janelas sem relatório; o registro [critique-worker-jobs-attempt-20260910.md](../.gauntlet/critique-worker-jobs-attempt-20260910.md) preserva os sentinelas e `NOT_COMPLETED`. O veredito permanece `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.

## Incremento local — restore do ledger de jobs — 2026-09-10

No commit `c6048e4eb2b3714d4eb4ffc9603727b0cd2fe586`, `scripts/verify-postgres-restore.ts` passou a reaplicar `recoveredWorkerJobs` no destino quarentenado e comparar os digests de `workerJobs` após o restore e na verificação de que a origem não mudou. O round-trip criptografado também compara a cardinalidade desse ledger, e o payload de auditoria registra a contagem reaplicada.

Evidência local desta correção: typecheck, `npm test` 135 (`134 pass`, `1 skip`), `test:database` 25/25, worker 12/12, lint, build, static, PDP, `verify:production` estrutural e `git diff --check` passaram. O script de restore com PostgreSQL real não foi executado neste host sem `DATABASE_URL`/daemon Docker; portanto a nova asserção é preparada e compilável, não uma prova PostgreSQL concorrente ou de RTO/RPO. A crítica fresh correspondente terminou `NOT_COMPLETED` após janelas bounded, registrada em [critique-restore-worker-ledger-attempt-20260910.md](../.gauntlet/critique-restore-worker-ledger-attempt-20260910.md), sem aprovação. O veredito permanece `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.

## Incremento local — contrato de backpressure nos entrypoints — 2026-09-10

O commit `fe02a54f363952fc2d9da3956013c63a516265af` alinhou os dois entrypoints do worker: `apps/worker/src/main.ts` e `docker/worker.ts` passaram `maxOutstandingJobs` junto de `maxOutstandingOutbox`, ambos derivados de `config.workerMaxOutstandingOutbox`/`CVG_WORKER_MAX_OUTSTANDING`. A mudança preserva o limite operacional único para outbox e as cinco lanes duráveis.

A primeira crítica fresh read-only (`01a08a37-0a18-7881-a485-bf58c7a64309`, `Ohm`) confirmou o contrato, mas apontou um gap baixo: não havia teste da composição dos entrypoints e `docker/worker.ts` não entrava em typecheck/lint. O reparo nos commits `7971d27f039ae93530bf8eac93f573bbd2b77d9a` e `3b57fd5b7104e89bf8a0c5cb224b8e5dc611b147` extraiu `createWorkerDependencies`, adicionou teste unitário, incluiu `docker/**/*.ts` no `tsconfig` e `docker` nas raízes do lint; também corrigiu o narrowing do `workerOrganizationId` revelado pelo novo typecheck.

O commit `39024ca03af5a78ad1edabaf9e5be6654a98327d` endureceu os gates: `verify-static` exige os dois entrypoints, o call real compartilhado, `tsconfig.json` e a inclusão de `docker` no lint; `verify-production` exige os padrões de construção e os mesmos includes. A crítica fresh final (`01a08a42-8e65-7bf0-b101-bccc0eb54af5`, `Sartre`) concluiu `REVIEW_ONLY_PASS` para este recorte, sem aprovação AAA; o registro está em [critique-worker-entrypoint-final-attempt-20260910.md](../.gauntlet/critique-worker-entrypoint-final-attempt-20260910.md).

No SHA `39024ca`, a evidência local reproduzida foi: `npm test` 136 (`135 pass`, `1 skip`), `test:database` 25/25, worker 13/13, typecheck, lint (124 fontes), build, `verify:static` (50 artefatos/126 fontes), `verify:pdp` (68 operações/70 regras/6 policies/12 domínios), `verify:production` estrutural e `git diff --check` passaram. `verify:triplo-aaa` retornou `AAA_NOT_PROVEN`/exit 2, `verify:staging` retornou `STAGING_EVIDENCE_INCOMPLETE`/exit 2 e `verify:deepseek-acp` permaneceu bloqueado/exit 2. Nenhum serviço foi iniciado e nenhum egress foi autorizado.

O run remoto `34450040820` do SHA intermediário `fe02a54` terminou com falha somente no `Browser E2E`; typecheck, contratos, segurança, banco/recovery, testes, build, static e audits anteriores passaram, e os logs detalhados não estavam acessíveis sem autenticação. O run `34451105914` do SHA técnico `39024ca` terminou `success`: o job principal e o job de imagens passaram Browser E2E, migrations/PostgreSQL/RLS, restore, release/Compose, performance, SBOM, artifacts, builds e scans API/web. O commit posterior de documentação `8d80b31` disparou o run `34451891880`, que terminou `failure` no `Browser E2E`; os passos anteriores passaram, gates dependentes foram pulados e o job de imagens foi pulado. Os logs detalhados não estavam acessíveis sem autenticação. A falha documental deve ser investigada antes de tratá-la como verde; ela não altera o código verificado no SHA técnico. CI remoto, mesmo quando verde, não substitui staging/provider/secret/DeepSeek/observabilidade operacional, carga/recuperação production-like ou aceite humano; o veredito global permanece `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.

## Incremento local — idempotência da revogação de sessão — 2026-09-10

O commit `63487afdd0db41cac44f43b2a432dc835e904fcb` foi publicado em `origin/main`. `POST /api/v1/auth/sessions/:id/revoke` agora exige `Idempotency-Key`, vincula o recibo à organização, ator, sessão autenticada, alvo, unidade/workspace e corpo da intenção, executa a revogação dentro de `idempotent(...)`, registra `receiptId`/`replayed` na resposta e mantém a limpeza de cookies somente quando a própria sessão é revogada. O mapa de auditoria também passou a associar `identity.sessions.revoke` ao receipt, sem alegar exatamente-uma-vez fora da fronteira durável.

O teste de autenticação de produção cobre a primeira execução e o replay da mesma chave: ambos retornam `200`, o segundo marca `replayed=true`, o `receiptId` permanece igual e o alvo continua revogado. Evidência local no SHA publicado: API focada `17/17`; `npm test` `136` (`135 pass`, `1 skip`); `test:database` `25/25`; `test:security` `26/26`; typecheck, lint (`124` fontes), build, `verify:static` (`50` artefatos/`126` fontes), `verify:pdp` (`68` operações/`70` regras/`6` policies/`12` domínios), `verify:production` estrutural, `git diff --check` e `CI=1 npm run test:e2e` (`64 pass`, `4 skips`) passaram. O skip da suíte E2E é intencional para busca rápida em viewports sem largura mínima; o host continua sem dependências WebKit nativas.

O run GitHub Actions `34455417256` foi criado e concluído com sucesso para o SHA exato `63487af`. O job principal (`Typecheck, tests and release artifacts`) e o job de imagens (`Build API and web images`) passaram; os passos observados incluem Browser E2E, migrations/PostgreSQL/RLS, restore, Compose, performance, SBOM, builds e scans. As duas críticas fresh não herdadas solicitadas após o commit — visual `Avicenna` (`01a08a6f-c472-7291-9397-12dcec22dbee`) e segurança/contrato `Dewey` (`01a08a6f-c4c3-7a53-8467-c2376ddd3cb5`) — permaneceram `running` após janelas bounded e pedido de finalização, sendo encerradas sem relatório. Os artefatos de tentativa [visual](../.gauntlet/critique-visual-current-attempt-20260910.md) e [segurança/contrato](../.gauntlet/critique-session-revoke-current-attempt-20260910.md) registram `NOT_COMPLETED`; nenhuma aprovação foi inferida.

O limite arquitetural permanece explícito: `PatientRepository.create` e `PatientApplicationService.create` ainda são síncronos e `PostgresPatientRepository.create` delega ao `CvgStore`; as tabelas normalizadas continuam projeção posterior no `onSend`/`projectDomain`. Fechar isso exige mover o comando para uma fronteira assíncrona transacional em `apps/api/src/app.ts`, coordenando rollback, audit, receipt e resposta; não foi aplicado um workaround síncrono. Além disso, `ops.restore` ainda aparece como idempotente no catálogo, mas `CvgStore.restore()` limpa `commandReceipts` antes de carregar o snapshot, portanto não foi falsamente marcado como seguro. O role runtime amplo da migration 022 e toda a evidência externa permanecem pendentes. O veredito global continua `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.

## PostgreSQL real local — 2026-09-10

Além das suítes sintéticas, um PostgreSQL 16.15 local foi migrado com os 34 arquivos e executado com a role `cvg_runtime` sem privilégios de superusuário ou `BYPASSRLS`. O exercício multiprocesso passou `CLAIMED`/`IN_FLIGHT`, replay durável, conflito de idempotência divergente e zero efeitos duplicados. `verify:postgres` passou as operações de restart, leituras normalizadas, diagnósticos, leases, idempotência, outbox, efeitos externos, inbox, usage, break-glass, CAS e RLS em 59/59 tabelas; `verify:postgres:restore` passou criptografia AES-256-GCM, rejeições de tamper/partial/stale/migration mismatch e restore quarentenado com login/readiness bloqueados.

Essa prova está em [`artifacts/operational-proof/postgres-real-local-2026-09-10.json`](../artifacts/operational-proof/postgres-real-local-2026-09-10.json) e em [`docs/postgres-concurrency-proof.md`](postgres-concurrency-proof.md). Ela é local e efêmera: não cobre staging multiinstância, backup gerenciado, RTO/RPO, observabilidade operacional ou autorização de promoção. O veredito global permanece `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.

## Matriz browser completa — 2026-09-10

O E2E completo foi reexecutado com Chromium, Firefox, WebKit e stress. Como o wrapper WebKit sobrescreve o caminho de bibliotecas e o host não possui privilégios para `install-deps`, foi usado um prefixo temporário de usuário com as bibliotecas Ubuntu necessárias; nenhum pacote do sistema ou arquivo do repositório foi alterado. Foram executados 102 casos: 96 pass, 6 skips condicionais da busca global em viewports móveis e zero falhas. A prova está em [`artifacts/operational-proof/browser-matrix-local-2026-09-10.json`](../artifacts/operational-proof/browser-matrix-local-2026-09-10.json). Leitor de tela, zoom real de 200%, revisão assistiva independente e baseline visual continuam pendentes.

## Fechamento da regressão integral — 2026-09-10

`VER-CVG-173` reexecutou `npm test` com 237 casos (236 pass, 1 skip) e o gate `verify:triplo-aaa`. Os checks locais passaram; o verificador retornou exit 2 `AAA_NOT_PROVEN` por ausência de bundle externo same-SHA. A matriz browser continua em 102 casos (96 pass, 6 skips), com WebKit local executado no prefixo temporário documentado; leitor de tela, tecnologia assistiva e zoom real de 200% permanecem pendentes.

## Fechamento final da regressão — VER-CVG-175 — 2026-09-10

O registro mais recente reexecutou `npm test` com 239 casos (238 pass, 1 skip), `test:database` 53/53, `test:security` 26/26, typecheck, lint com 152 fontes, build e `verify:static` com 81 artefatos obrigatórios e 154 fontes. O contrato de carga k6 para 50 usuários, 100 usuários e burst passou a ser verificado por `verify:load`; sem URL HTTPS de staging, token emitido pela Secret Authority, p95 observado e binário k6, o gate retorna `LOAD_EVIDENCE_BLOCKED_EXTERNAL` e não inventa capacidade.

`npm run verify:triplo-aaa` passou todos os checks locais disponíveis, mas terminou com exit 2 `AAA_NOT_PROVEN`. O manifesto continua `STATE_OF_THE_ART_NOT_PROVEN`/`AAA_NOT_PROVEN`, com provider/DeepSeek/secret authority, staging multiinstância, observabilidade/SLO, carga/chaos/recovery/RTO-RPO, CI same-SHA, revisão assistiva e aceite humano ausentes ou não executados. A matriz browser local permanece em 102 casos (96 pass, 6 skips); WebKit foi executado no prefixo temporário documentado, enquanto leitor de tela, tecnologia assistiva, zoom real de 200% e baseline visual independente permanecem sem prova.

## Revalidação documental e dos gates — VER-CVG-176 — 2026-09-10

Após a correção dos números de lint/static neste documento e no audit final, os gates determinísticos foram reexecutados: typecheck, lint (152 fontes), `npm test` (239: 238 pass, 1 skip), static (81 artefatos/154 fontes), PDP universal, worker runtime, authoritative writes e audit chain passaram. `verify:load` permaneceu corretamente em `LOAD_EVIDENCE_BLOCKED_EXTERNAL`; `verify:triplo-aaa` terminou novamente com exit 2 `AAA_NOT_PROVEN`, sem promover evidência local ou sintética.

## Endurecimento da exportação D4 — VER-CVG-177 — 2026-09-10

A prova de exportação agora executa o fluxo negativo completo: finalidade/escopo inválidos, replay idempotente, envelope expirado, ciphertext adulterado, chave incorreta e contexto de outra organização. A regressão atual passou `npm test` com 240 casos (239 pass, 1 skip) e `test:database` com 54/54; nenhum resultado local foi promovido como evidência externa.


## Settlement tipado de uso de IA — VER-CVG-178 — 2026-09-10

O ledger de IA agora carrega `AiUsageSettlement` tipado, vinculando modelo, tokens de entrada/saída, digest da resposta do provider, custo estimado, custo efetivo e discrepância. O serviço rejeita drift de modelo ou contadores; preço ausente fica em `UNAVAILABLE` e `NOT_EVALUATED`, enquanto o harness local declara `LOCAL_SYNTHETIC` com custo zero e revisão de pricing explícita. A projeção PostgreSQL preserva o settlement no record imutável do ledger.

A regressão atual passou `npm test` com 241 casos (240 pass, 1 skip), `test:database` 54/54, `test:security` 26/26, typecheck, build, lint (152 fontes), static (82 artefatos/154 fontes), PDP universal, worker, authoritative writes, audit chain e verify:production. O E2E atual passou 65 casos com 4 skips após remover um servidor local stale. `verify:load` retornou `LOAD_EVIDENCE_BLOCKED_EXTERNAL` e `verify:triplo-aaa` terminou exit 2 `AAA_NOT_PROVEN`. Pricing real, settlement financeiro assinado, staging, provider/DeepSeek/secret authority, observabilidade/SLO, carga/chaos/recovery/RTO-RPO, revisão assistiva e aceite humano continuam sem evidência autorizada.


## Revalidação pós-documentação — VER-CVG-179 — 2026-09-10

A documentação e os registros foram reconciliados após o settlement tipado. `verify:static` passou 82/154; JSON/JSONL de controle e `git diff --check` passaram; `verify:triplo-aaa` revalidou os gates locais e terminou exit 2 `AAA_NOT_PROVEN`, preservando o bloqueio por ausência de evidência externa same-SHA e aceite humano.


## Inventário F31-F37 — VER-CVG-182 — 2026-09-10

O manifesto agora explicita as 23 gates obrigatórias do verificador, incluindo pressure test, headers, configuração, promoção, runbooks e repair loop; sem execução externa, todas permanecem `NOT_RUN`. O teste permanente de configuração confirma rejeição fail-closed antes do runtime quando faltam autoridade, TLS, storage e integração real. A regressão passou `npm test` com 242 casos (241 pass, 1 skip), e `verify:triplo-aaa` terminou exit 2 `AAA_NOT_PROVEN`.


## Checkpoint VER-CVG-183 — revalidação final

Após a alteração do inventário de promoção, npm test passou 243 casos (242 pass, 1 skip), test:database 54/54, test:security 26/26, E2E 69 (65 pass, 4 skip), static 82/154 e verify:production. verify:triplo-aaa encerrou exit 2 AAA_NOT_PROVEN; DeepSeek/provider/secret authority/staging/observabilidade/carga/chaos/recovery/F31-F38/critics/human approval continuam sem evidência externa same-SHA.

## VER-CVG-184 — regressão corrente após reparos de runtime e segurança

A execução corrente passou 258 testes (257 pass, 1 skip), `test:database` 55/55, `test:security` 27/27, `test:fault` 25/25, E2E 69 (65 pass, 4 skip), typecheck, lint (157 fontes), build, static (88 artefatos/159 fontes), `verify:worker-runtime` (6 policies/29 verificações), `verify:pdp-universal`, `verify:authoritative-writes`, `verify:audit-chain`, `verify:security-red-team` (15/15), `verify:resource-pressure` (5/5), `verify:runbook-execution` (6/6) e `verify:production`. `verify:container-smoke` e `verify:promotion-invariant` retornam exit 2 quando não recebem URL/manifesto explícito, como exige o fail-closed.

`verify:triplo-aaa` também encerrou exit 2 `AAA_NOT_PROVEN`. O bundle externo same-SHA, provider/DeepSeek/secret authority, staging, observabilidade/SLO, carga/chaos/recovery/RTO-RPO, revisão assistiva independente, critics aprovadores e aceite humano não estão disponíveis; nenhum foi inferido a partir dos contratos locais.


## VER-CVG-185 — gate pós-documentação

Após reconciliar os documentos, o prompt preservado e os registros .agent/.gauntlet, verify:static passou 88/159, o SHA-256 da cópia do prompt coincidiu com a fonte recebida, o parse de JSON/JSONL e git diff --check passaram. verify:triplo-aaa encerrou exit 2 AAA_NOT_PROVEN; o worktree modificado não possui bundle externo same-SHA nem aceite humano.


## VER-CVG-186 — scorecard estrito e contrato DeepSeek real

A implementação passou a exigir os limiares específicos por dimensão do prompt, chaves exatas no scorecard e todos os gates VERIFIED antes de aceitar TRIPLE_AAA_CANDIDATE. O novo contrato DeepSeek exige 31 etapas, digest de cadeia, SHA limpo, identidade de engine/manifest, produtor distinto do revisor e risco residual. A regressão passou 262 testes (261 pass, 1 skip), database 55/55, security 27/27, fault 25/25, E2E 69 (65 pass, 4 skip), lint 158, static 88/160, typecheck, build e verify:production. Sem bundle externo e ambiente autorizado, verify:deepseek-real e verify:triplo-aaa permanecem bloqueados.


## VER-CVG-187 — inventário de prova atualizado

O gate estático agora exige explicitamente `packages/deepseek-bridge/src/real-proof.ts`, `tests/unit/deepseek-real-proof.test.ts`, `scripts/verify-triplo-aaa.ts`, `tests/unit/triplo-aaa.test.ts` e suas documentações. A execução passou 94 artefatos/160 fontes; `verify:triplo-aaa` permaneceu fail-closed em exit 2 `AAA_NOT_PROVEN` porque os recibos externos same-SHA e a aprovação humana não existem neste ambiente.


## VER-CVG-188 — admissão exata de gates

A validação de promoção agora rejeita qualquer inventário diferente das 23 gates obrigatórias tanto no manifesto quanto no bundle externo. A suíte completa permaneceu em 262 casos (261 pass, 1 skip), com typecheck, lint 158, static 94/160 e os 10 testes focados passando; o resultado global segue `AAA_NOT_PROVEN` por limitações externas.


## VER-CVG-189 — deliverables protegidos pelo gate estático

A cópia do prompt e todos os documentos de prova exigidos agora fazem parte do inventário estático. A execução passou 109 artefatos/160 fontes, npm test 262 (261 pass, 1 skip), typecheck, lint 158 e os testes focados; o veredito de promoção continua `AAA_NOT_PROVEN` e fail-closed.


## VER-CVG-190 — prova PostgreSQL local corrente

`verify:postgres`, `verify:postgres:concurrency` e `verify:postgres:restore` passaram no banco efêmero corrente. A evidência foi anexada ao artifact PostgreSQL e marcada `LOCAL_ONLY`; nenhuma gate externa foi promovida.


## VER-CVG-191 — inventário machine-readable protegido

Os artifacts de prova local agora estão incluídos no inventário obrigatório e foram lidos com sucesso. `verify:static` passou 115/160 e `verify:triplo-aaa` permaneceu fail-closed em `AAA_NOT_PROVEN`.


## VER-CVG-193 — revalidação atual

O contrato k6 foi corrigido para duplicar durações compostas sem concatenar `2` à string; a suíte de carga local passou 3/3 casos. Adapters Vault/cloud sem implementação agora são identificados como `UNAVAILABLE` em vez de parecerem um registry vazio. A regressão atual passou `npm test` com 264 casos (263 pass, 1 skip), database 55/55, security 27/27, fault 25/25, E2E 69 (65 pass, 4 skip), lint 158, static 117/160, typecheck, build, produção estrutural, fixtures executáveis de red-team/pressão/runbook, os 10 testes focados de scorecard/DeepSeek e diff check.

`verify:triplo-aaa` permanece exit 2 `AAA_NOT_PROVEN`: DeepSeek/provider/secret authority/staging/observabilidade/load/chaos/recovery/RTO-RPO, bundle same-SHA, critics aprovadores e aceite humano continuam bloqueados ou não executados.

`verify:load` também foi executado no limite externo e encerrou exit 2 `LOAD_EVIDENCE_BLOCKED_EXTERNAL` sem URL HTTPS de staging, token do Secret Authority ou p95 observado; o contrato local não foi promovido a medição.

## VER-CVG-195 — backup operacional local e fechamento documental

A persistência passou a expor escrita e verificação de backup operacional com manifest `CVG-BACKUP-MANIFEST`, envelope AES-256-GCM, digest, referência de chave, criação atômica e retenção/rotação. `OperationalBackupJob` serializa ticks, executa a verificação antes da rotação e registra falhas de chave/corrupção. O teste focado de persistência passou 50/50; a regressão completa passou 266 testes (265 pass, 1 skip), lint 159 e static 118/161. Tamper e chave incorreta são rejeitados antes de qualquer remoção; o smoke positivo da CLI confirmou `keepLast=2`. Sem diretório/chave configurados, `npm run verify:backup-retention` encerra exit 2 `BACKUP_RETENTION_BLOCKED_EXTERNAL`.

O resultado continua `AAA_NOT_PROVEN`: backup gerenciado, object storage/KMS, RTO/RPO observado, staging, DeepSeek/provider, carga/chaos, bundle same-SHA, crítica aprovadora e aceite humano permanecem externos ou ausentes.

## VER-CVG-196 — job periódico de backup

`OperationalBackupJob` foi adicionado ao boundary de persistência. Ele coalesce ticks concorrentes, executa a criação de bundle e a verificação do diretório antes da rotação, mantém `lastFailure` quando a chave não está disponível e permite parada limpa do timer. O teste focado passou 50/50 e a suíte completa passou 266 testes (265 pass, 1 skip); typecheck, lint 159, static 118/161, `verify:production` e diff check passaram. Isso continua uma capability local: object storage/KMS, agendamento gerenciado, RTO/RPO observado e aceite humano seguem bloqueados.

## VER-CVG-197 — gate Triplo AAA final

Após o reparo da condição de corrida no encerramento do scheduler, `npm run verify:triplo-aaa` foi reexecutado e retornou exit 2 `AAA_NOT_PROVEN`. Os gates locais ficaram verdes; a promoção continua bloqueada por ausência de evidência externa same-SHA, ambientes autorizados, critics independentes e aceite humano.

## VER-CVG-198 — vínculo de arquivos da prova externa

Os contratos de prova DeepSeek/provider passaram a exigir um `evidenceRef` seguro por etapa. Os scripts externos verificam os bytes abaixo do diretório do bundle, rejeitam symlinks e traversal e só executam o smoke/provider quando o digest declarado coincide. A suíte completa passou 266 testes (265 pass, 1 skip), static 118/161, lint 159, `verify:production` e diff check; `verify:triplo-aaa` continua exit 2 `AAA_NOT_PROVEN` sem ambientes e aprovações externos.

## VER-CVG-199 — delivery de alertas fail-closed

O receiver `cvg-null` foi removido do Alertmanager. A configuração exige `CVG_ALERTMANAGER_WEBHOOK_URL`; o compose estrutural passa com valor sintético e rejeita a ausência ou o descarte silencioso. Nenhum endpoint de alertas foi exercitado, portanto observabilidade e SLO continuam `NOT_RUN` no gate externo.


## VER-CVG-200 — janela temporal e revalidação final

A prova de provider exige agora timestamp atual em cada uma das 12 etapas: máximo de sete dias de idade e máximo de cinco minutos no futuro. O `evidenceRef` continua relativo ao bundle imutável, com rejeição de symlink/traversal e digest dos bytes antes do envio.

A regressão passou 266 testes (265 pass, 1 skip), typecheck, lint 159, static 118/161, `verify:production` e `git diff --check`. `verify:triplo-aaa` encerrou exit 2 `AAA_NOT_PROVEN`; DeepSeek/provider/secret authority, staging, observabilidade, carga/chaos/recovery, critics e aceite humano permanecem ausentes ou não executados.

## VER-CVG-201 — revalidação criptográfica e fronteira de evidência — 2026-09-11

A execução corrente passou 270 testes (269 pass, 1 skip), typecheck, lint 160, static 118/162, `verify:production` e `git diff --check`. WebAuthn verifica a assertion com chave pública, challenge/origin, relying party, flags e contador; receipts de aprovação humana exigem Ed25519 e digest canônico. A raiz do bundle de promoção deve estar fora do checkout e os verificadores recusam symlink/traversal antes do vínculo por bytes. Heartbeat age/count, alerta de liveness, permissões de backup e digest dos bytes do SBOM foram revalidados.

`verify:triplo-aaa` encerrou exit 2 `AAA_NOT_PROVEN`. Bundle externo same-SHA, DeepSeek/provider/secret authority, staging, observabilidade operacional, carga/chaos/recovery, critics aprovadores e aceite humano continuam ausentes ou bloqueados; nenhuma promoção foi declarada.


## VER-CVG-202 — boundary assinada, worker auditável e smoke autenticado — 2026-09-11

A rodada final revalidou a barra ativa `.gauntlet/bar-v4.json` e o prompt SHA-256 `39dfbb610267b61854b972bf8513f6562b0ee374aa308f7a79b38d21f2cdeae3`. Os contratos DeepSeek (31 etapas) e provider (12 etapas) agora exigem atestação Ed25519 e binding dos bytes da evidência externa. O worker de produção aceita somente definições tipadas, exige `appendAuditRecord` durável e bloqueia o acknowledge quando a auditoria falha. O smoke de container separa o probe público do cenário autenticado e exige sessão `cvg_session`, flags, contexto, lookup, escrita controlada, heartbeat/outbox, health de integrações e restart explícito.

A regressão passou 272 testes (271 pass, 1 skip), typecheck, lint 160, static 119/162, `verify:production`, `verify:worker-runtime`, PDP universal, red-team por critério, resource-pressure por controle, testes focados de container e `git diff --check`. `verify:triplo-aaa` encerrou exit 2 `AAA_NOT_PROVEN`: DeepSeek/provider/secret authority, staging multi-instância, collector/SLO, carga/chaos/recovery, assistive tech/zoom real, bundle same-SHA, critics e aceite humano continuam externos, bloqueados ou não executados. Nenhuma promoção foi declarada.


## VER-CVG-203 — configuração, headers, runbooks e pressão — 2026-09-11

A rodada revalidou a barra ativa `.gauntlet/bar-v4.json` e o prompt SHA-256 `39dfbb610267b61854b972bf8513f6562b0ee374aa308f7a79b38d21f2cdeae3`. `verify:production` agora rejeita bindings ausentes ou inválidos de worker, role PostgreSQL, secret provider, release SHA/digest e configuração de produção; os perfis HTTP de desenvolvimento não emitem HSTS e o overlay TLS mantém HSTS, cookies estritos e overwrite de X-Forwarded-For.

O contrato de pressão exige limites de CPU/memória e `nofile` para os seis serviços; `verify:resource-pressure` passou 6 controles. `verify:runbook-execution` passou 12 contratos e mapeou os sete cenários da Fase 35 para transições dry-run explícitas e executou fixtures locais de restore/fault/worker/auth/DeepSeek, mantendo exercícios live como externos. A suíte passou 276 testes (275 pass, 1 skip), lint 160, static 119/162, typecheck, produção estrutural, PDP, worker, red-team e diff check. `verify:triplo-aaa` encerrou exit 2 `AAA_NOT_PROVEN`; nenhuma promoção foi declarada.


## VER-CVG-204 — fixtures locais de runbook — 2026-09-11

O verificador de runbooks passou 12 contratos e executou fixtures locais de restore, fault, worker-jobs, autenticação, bridge DeepSeek e ACP. A evidência continua sintética: exercícios live, incidentes reais, RTO/RPO e aprovação humana permanecem externos.


## VER-CVG-205 — gate Triplo AAA final fail-closed — 2026-09-11

Após a expansão dos fixtures locais, `verify:triplo-aaa` foi reexecutado. Os gates locais passaram; DeepSeek/provider/PostgreSQL/provenance/promotion/container externos ficaram BLOCKED_EXTERNAL, os gates operacionais externos/critics/humanos ficaram NOT_RUN e o resultado foi exit 2 `AAA_NOT_PROVEN`.

## VER-CVG-206 — reconciliação documental — 2026-09-11

Os ponteiros correntes foram alinhados com `VER-CVG-218`/`EVT-CVG-20260911-VERIFY-283`. `verify:static` passou 119/162, o hash do prompt e os control planes foram conferidos e `git diff --check` passou; o bloqueio externo/humano permanece inalterado.

## Crítica fresh final — 2026-09-11

Dois críticos independentes produziram relatórios `FAIL` para a barra global, registrando blockers externos e riscos locais de dominância do PDP/escrita direta de estado de IA, além de mutação observada durante o sentinel read-only. Não houve aprovação; o terceiro recorte frontend/release permanece `NOT_RUN`, e o gate final conserva `AAA_NOT_PROVEN`.

## VER-CVG-209 — reparo de supply chain e gate final — 2026-09-11

O runtime da imagem API agora instala `tsx` como dependência de produção e remove dependências de desenvolvimento com `npm prune --omit=dev`. Typecheck, lint, suíte 276 (275 pass, 1 skip), `verify:production` e static 119/162 passaram. `verify:triplo-aaa` foi repetido depois do reparo e encerrou exit 2 `AAA_NOT_PROVEN`; nenhuma promoção foi declarada.

## Reparação Fase 37 — boundary de memória — 2026-09-11

API e harness deixaram de escrever diretamente nos mapas de receipts, IA e budget; as mutações passam por seams explícitas e o gate PDP universal cobre essa regra. O risco residual dos mapas públicos mutáveis permanece documentado como HIGH e requer novo reparo/critic antes de aceite.

## VER-CVG-212 — gate final após boundary de memória — 2026-09-11

O gate Triplo AAA foi repetido depois do reparo do boundary local e manteve exit 2 `AAA_NOT_PROVEN`. Os gates externos, staging, same-SHA, operação production-like e aprovação humana continuam sem prova; o risco de encapsulamento do mapa público permanece aberto.

## VER-CVG-216 — fechamento final do boundary de memória — 2026-09-11

As seams do `CvgStore` agora clonam entradas e saídas; updates retornam cópias; `quarantined` usa backing privado e visão congelada; e o claim de idempotência sincroniza o objeto do adapter sem aliasar o backing store. A execução final passou 277 testes (276 pass, 1 skip), typecheck, lint 160, static 119/162, PDP universal, worker runtime, produção estrutural e diff check.

O critic [`critique-final-arch-security-20260911-encapsulation-final-rerun.md`](../.gauntlet/critique-final-arch-security-20260911-encapsulation-final-rerun.md) fechou os findings de mapas públicos e seams, mas identificou residual HIGH em aliases de outros retornos públicos do domínio e flags/credenciais de controle mutáveis. `verify:triplo-aaa` terminou exit 2 `AAA_NOT_PROVEN`; provas externas same-SHA, staging, provider/DeepSeek/Secret Authority, operação production-like, acessibilidade assistiva e aceite humano permanecem ausentes. Nenhuma promoção foi declarada.

## VER-CVG-217 — H2 de estado público fechado — 2026-09-11

`bootstrapCredentials` agora retorna cópia, e `storageMode`/`healthStatus` têm estado privado e getters; a composição usa `setStorageMode`. O critic [`critique-final-arch-security-20260911-h2-final-rerun.md`](../.gauntlet/critique-final-arch-security-20260911-h2-final-rerun.md) confirma H2 `CLOSED/REPAIRED` e mantém `AAA_NOT_PROVEN` global. Restam aliases de métodos públicos de domínio e guarda PDP parcial; nenhuma promoção foi declarada.


## VER-CVG-218 — H-01 fechado e guard universal ampliado — 2026-09-11

Os retornos públicos do CvgStore agora são cópias defensivas em todos os métodos de leitura/criação/atualização/listagem; referências canônicas ficam em getUserRecord e findPatientRecord. A aplicação usa markUserLogin e o estado devolvido por recordChallengeFailure. verify:pdp-universal confere as 41 coleções com backing privado, visões ReadonlyMap clonadas e rejeição de mutação direta.

A regressão passou 277 testes (276 pass, 1 skip), typecheck, lint 160, static 119/162, PDP universal, worker runtime, produção estrutural e diff check. verify:triplo-aaa reexecutou com exit 2 AAA_NOT_PROVEN; nenhuma prova externa ou aprovação humana foi inventada. O critic [critique-final-arch-security-20260911-h01-final-rerun.md](../.gauntlet/critique-final-arch-security-20260911-h01-final-rerun.md) fechou os aliases H-01; permanece HIGH somente a limitação textual/parcial do guard, sem aprovação.


## VER-CVG-219 — addendum fresh da guarda universal do PDP — 2026-09-11

A auditoria read-only [.gauntlet/critique-final-arch-security-20260911-h02-guard-final-rerun.md](../.gauntlet/critique-final-arch-security-20260911-h02-guard-final-rerun.md) confirmou o fechamento de H-02 para o artefato atual: a guarda enumera as 41 coleções governadas do CvgStore, exige backing privado e view ReadonlyMap defensiva para cada uma e não encontrou mutador direto fora do domínio em API, harness ou worker. O resultado local é PASS_WITH_LIMITATIONS.

O residual H-02-L permanece HIGH porque a guarda é textual/parcial e não prova call graph ou data flow; aliases dinâmicos, casts any e campos futuros continuam fora do alcance dessa técnica. O addendum não reexecutou runtime nem adicionou provider/DeepSeek/Secret Authority, staging, PostgreSQL multi-instância, observabilidade, carga/chaos/recovery, provenance, promoção ou aprovação humana. O gate Triplo AAA permanece VER-CVG-218, exit 2, AAA_NOT_PROVEN, com promoção bloqueada.
## VER-CVG-220 — revalidação final local — 2026-09-11

Após a correção da trilha de quarentena e da fronteira `hydrate`/`restore`, a regressão passou 284 testes (283 pass, 1 skip, 0 fail), typecheck, build, lint 162, static 120/164, PDP universal, authoritative writes, audit chain, worker runtime e Compose estrutural. O snapshot `evidence-snapshot.json` foi regenerado depois dos writers locais e validou o prompt SHA, HEAD, bytes, mtime e `runId`.

O guard AST e os receipts Ed25519 fortalecem a admissão, mas não constituem evidência externa. O critic fresh permanece `PASS_WITH_LIMITATIONS`, H-02-L médio/advisory, e não emite aprovação. `verify:triplo-aaa` encerrou exit 2 `AAA_NOT_PROVEN`; promoção continua bloqueada até bundle same-SHA, execuções externas e aprovação humana verificável.

## VER-CVG-221 — fechamento estrito do parser de snapshot — 2026-09-11

`parseSnapshot` agora rejeita campos de topo desconhecidos e qualquer resultado diagnóstico cujo status não seja `RECEIVED`, `VALID` ou `REJECTED`. A mesma regra é aplicada antes de `hydrate`/`restore` e na validação do snapshot autoritativo; a cadeia request → specimen → patient continua obrigatória. A suíte terminou com 285 testes (284 pass, 1 skip, 0 fail), e o estado global permanece `AAA_NOT_PROVEN` por ausência das provas externas e do aceite humano.

## VER-CVG-222 — critic fresh pós-reparo H-04 — 2026-09-11

A revisão independente read-only [`critique-final-arch-security-20260911-h04-closure-rerun.md`](../.gauntlet/critique-final-arch-security-20260911-h04-closure-rerun.md) confirmou a rejeição de campos desconhecidos, `QUARANTINED`, status inválidos e cadeias órfãs no parser, na persistência, em `hydrate` e em `restore`. O único residual novo é M-03: a validação semântica completa de entidades não diagnósticas ocorre antes da persistência autoritativa, não integralmente no boundary in-memory. O estado global continua `AAA_NOT_PROVEN`.

## VER-CVG-223 — última execução verificável — 2026-09-11

`verify:triplo-aaa` passou os controles locais e terminou exit 2 `AAA_NOT_PROVEN`. O snapshot pós-gate `dff3981742ab2c486f03287c2edb90da12c3f1f6a062cacaf68132b14075a70d` validou HEAD, prompt SHA, bytes e mtimes de dez artefatos; `verify:static` passou 120/164. As gates externas e humanas permanecem sem prova.

## VER-CVG-224 — reparo M-03 e regressão local — 2026-09-11

O validator semântico completo foi extraído para `packages/domain/src/snapshot-validation.ts`, com registry canônico em `@cvg/contracts`. Domínio e persistência chamam a mesma função; testes negativos confirmam que `hydrate` e `restore` rejeitam appointment/guardian adulterados antes de substituir a autoridade. A suíte passou 286 testes (285 pass, 1 skip, 0 fail), lint 163 e static 120/165. A revisão fresh pós-extração permanece pendente e o resultado global é `AAA_NOT_PROVEN`.

Após incluir `packages/domain/src/snapshot-validation.ts` no inventário obrigatório, `verify:static` passou 121/165 e o snapshot foi regenerado para essa fotografia.

## VER-CVG-225 — revalidação do parser, recuperação e invariantes de medicação — 2026-09-11

O validator semântico único agora é executado no parser, em `hydrate`/`restore`, em `validateRecoveryBundle` e antes da projeção PostgreSQL. A regressão cobre produto de prescrição versus lote, atores cross-organization, duplicatas em todas as coleções, auditoria/receipts, assinatura clínica e aprovação de IA. A suíte passou `293` testes (`292 pass`, `1 skip`, `0 fail`), com typecheck, build, lint, static, PDP universal, authoritative writes, worker, red-team, resource pressure, runbook e Compose estrutural locais verdes.

O critic fresh classificou a implementação local como `PASS_WITH_LIMITATIONS`; a fotografia permanece `AAA_NOT_PROVEN` porque as provas externas e a aprovação humana exigidas pelo prompt não estão disponíveis.


## VER-CVG-226 — revalidação final Triplo AAA e produção — 2026-09-11

Triplo AAA local passou e encerrou exit 2 por ausência das provas externas/humanas. `verify:production` foi repetido em sequência e passou; `verify:evidence-snapshot` validou runId `6ea94fb7ddb9706b08cc3fc6a6536c6225ec997368ce2683dbb2ce61ada2eb2e` para dez artefatos; `verify:static` passou `121/165`; `git diff --check` e os parsers JSON/JSONL passaram. Resultado global: `AAA_NOT_PROVEN`, promoção bloqueada.

## VER-CVG-227 — fotografia final após o contrato de critics — 2026-09-11

O Final Gauntlet passou a exigir as 15 categorias do prompt, com um veredito por categoria (PASS, PASS_WITH_LIMITATIONS ou FAIL) e findings com severidade (CRITICAL, HIGH, MEDIUM, LOW) antes de aceitar uma receipt externa. A regra reforça a forma da evidência; não transforma critic local em aprovação.

Na fotografia corrente, npm test passou 297 casos (296 pass, 1 skip, 0 fail); test:database 58/58, test:security 28/28, test:fault 27/27, test:contract 4/4, lint 163, static 121/165, PDP universal 68 operações/70 regras/6 políticas/26 testes, authoritative writes 32 domínios, audit chain, worker runtime, red-team 24 critérios, resource pressure 6 controles e runbook 12 controles. O E2E atual passou 67/75, com 8 skips condicionais e zero falhas em Chromium/Firefox wide/tablet/mobile e stress; WebKit e revisão assistiva permanecem não executados nesta fotografia.

verify:triplo-aaa encerrou exit 2 com AAA_NOT_PROVEN; verify:production passou durante a execução final. O snapshot final foi regenerado com runId 867fb1d8f39fe34f96afcf76022d1694c45876f96a4438beca4ebd11273681ce. As provas externas e humanas obrigatórias continuam ausentes, e nenhuma promoção foi declarada.

## VER-CVG-228 — fechamento da regressão e boundaries de aplicação — 2026-09-11

Após a extração das leituras de identidade/contexto e a composição do serviço de break-glass, npm test passou 306 casos (305 pass, 1 skip, 0 fail). verify:static passou com 125 artefatos obrigatórios e 168 fontes; lint verificou 166 fontes; verify:pdp-universal passou 68 operações, 72 regras, 6 políticas e 26 testes de admissão. Os testes focados dos novos boundaries passaram, incluindo 6 casos de break-glass e 3 de identidade/contexto.

O gate final continua fail-closed: npm run verify:triplo-aaa terminou exit 2 e AAA_NOT_PROVEN. O snapshot final foi regenerado com runId 867fb1d8f39fe34f96afcf76022d1694c45876f96a4438beca4ebd11273681ce; as provas externas e a aprovação humana continuam ausentes.


## VER-CVG-229 — WebKit corrente e matriz cross-engine — 2026-09-11

WebKit foi executado com um prefixo de bibliotecas no espaço do usuário, sem alterar o sistema: 42 casos, 36 pass, 6 skips condicionais e zero falhas. Com a execução Chromium/Firefox/stress revalidada, a fotografia corrente tem 131 casos, 112 pass, 19 skips e zero falhas. A cobertura permanece local; leitor de tela, tecnologia assistiva independente, zoom real de 200% e baseline visual continuam pendentes.

O veredito não muda: verify:triplo-aaa continua fail-closed em AAA_NOT_PROVEN sem DeepSeek/provider/Secret Authority reais, staging, observabilidade/load/chaos/recovery/RTO-RPO, provenance same-SHA e aceite humano.

## VER-CVG-230 — backup operacional composto no worker — 2026-09-11

Os dois entrypoints do worker agora iniciam e param `OperationalBackupJob` após a saúde e o bootstrap da organização. A configuração e o Compose exigem `CVG_BACKUP_ENABLED=true`, organização explícita igual à do worker, volume externo persistente, retenção/intervalo, referência de chave e montagem `cvg-recovery-key`; a factory resolve o segredo pelo provider e rejeita escopo divergente ou estado durável ausente. A validação local passou 312 testes (311 pass, 1 skip), typecheck, lint e worker runtime. Secret Authority/volume reais, scheduler gerenciado, restore, RPO/RTO e cobertura multi-tenant permanecem não executados; `AAA_NOT_PROVEN` segue fail-closed.

## VER-CVG-231 — admissão de evidências e smoke fail-closed — 2026-09-11

Cada receipt de promoção agora exige artefato de execução separado e digestado, com gate, SHA fonte, artifact, `executionId` e status `PASS`; as gates de revisão exigem assinatura Ed25519 de revisor independente. Critics rejeita `FAIL` e findings `CRITICAL` e separa os artefatos F23/F24. O smoke exige shutdown gracioso, outbox/effect/reconciliação duráveis, replay idempotente e restart recuperado. Provenance inclui SBOM e recibo de estágios CI por digest; `verify:production` exige `--structural` ou `--production`; os 16 runbooks F35 estão no inventário static.

Typecheck, lint (167 fontes), npm test (312: 311 pass, 1 skip), focused evidence tests (20/20) e static (145/169) passaram. `verify:triplo-aaa` encerrou exit 2 `AAA_NOT_PROVEN`; DeepSeek/provider/Secret Authority, staging, observabilidade/load/chaos/recovery/RTO-RPO, same-SHA do HEAD, revisão externa e aprovação humana continuam sem prova. O snapshot final de 10 artefatos foi revalidado com runId `cc6fea9b55f01b06ad1223974b08356a9d9bc265e82a16c7c6c4784b62aa2d54`. Nenhuma promoção foi declarada.


## VER-CVG-232 — reconciliação da regressão completa — 2026-09-11

O inventário estático atual contém os 16 arquivos em `docs/runbooks/`; os sete cenários exigidos pela Fase 35 continuam identificados separadamente como contratos locais, sem convertê-los em execução live.

A suíte completa corrente passou `npm test` com **314 testes (313 pass, 1 skip, 0 fail)** e os testes focados de evidência passaram **20/20**. A reexecução de `npm run verify:triplo-aaa` preservou exit 2 `AAA_NOT_PROVEN`; gates externos, revisão operacional independente e aprovação humana continuam sem prova. O snapshot byte-bound de dez artefatos usa runId `02efd39eba8e94eb1902a3352bf2e1b4b31fa897c45320b6a613a26af5cedd2b`. Nenhuma promoção foi declarada.


## VER-CVG-233 — lifecycle do backup e transições F35 — 2026-09-11

A configuração e os dois entrypoints do worker voltaram a compor `OperationalBackupJob`, com start após bootstrap durável e stop no encerramento. A verificação local confirmou a organização única, resolução de chave por SecretProvider, persistência cifrada/manifest-bound e falha observável para chave ou estado ausente. Backup gerenciado, autoridade de chave real, restore operacional e RPO/RTO continuam `BLOCKED_EXTERNAL`.

O gate de runbooks executou os sete cenários F35 em fixtures de transição determinística (**7/7 PASS**, `EXECUTED_LOCAL`), mantendo a declaração explícita de que não houve exercício live, alerta, rotação real, restore production-like, break-glass humano ou aprovação. O snapshot final de dez artifacts é `3da0c1a99bc5da4ee89a4950680600227f3b92a69627196f54d81d3bcfade613`.


## VER-CVG-234 — gate final após reconciliação — 2026-09-11

A rodada final reexecutou o verificador Triplo AAA depois da asserção dos fixtures F35. Os sete cenários permanecem **7/7 `EXECUTED_LOCAL`**, e o backup operacional está composto e encerrado com o worker nos dois entrypoints. O snapshot final de dez artifacts é `6849441a8eda5209facf509c29799e1aa3c4184a6f857abde833d1c85dd5880a`.

Os gates externos e a aprovação humana continuam ausentes; por isso o processo encerrou exit 2 `AAA_NOT_PROVEN` e não houve promoção.


## VER-CVG-235 — fotografia local reconciliada — 2026-09-11

Os metadados machine-readable da fotografia anterior registravam `npm test` 314 e E2E 111; a revalidação VER-CVG-239 registra `npm test` 316 (315 pass, 1 skip, 0 fail), E2E 131 (112 pass, 19 skip, 0 fail), static 146/169 e lint 167. `npm run verify:triplo-aaa` terminou exit 2 `AAA_NOT_PROVEN`; o fail-closed continua preservado. O snapshot atual de dez artifacts é `fa0da4d5bc3d89dd72963c9573682d087827b8916d0028ef4da74cf3f5463082`, associado a `EVT-CVG-20260911-VERIFY-304`. Nenhuma evidência local foi convertida em aprovação externa ou promoção.


## VER-CVG-236 — snapshot final — 2026-09-11

O snapshot byte-bound foi regenerado após o alinhamento dos artifacts locais e passou com runId `71984a7f2ff9aa4242b45125dcb2ab1f8af9c1d46c3701a0295813b6e54144b8` para os dez arquivos exigidos. O estado continua `AAA_NOT_PROVEN`; a atualização apenas melhora a consistência da fotografia local e não substitui DeepSeek/provider/staging/critics/aceite humano. Evento `EVT-CVG-20260911-VERIFY-301`.

## VER-CVG-237 — hardening local final e regressão corrente — 2026-09-11

O registry de worker em produção agora contém somente as seis policies reais; `synthetic.rebuild` foi isolado na registry de testes. O gate de authoritative writes deriva a cobertura diretamente das 32 entradas canônicas e verifica unicidade de chaves e tabelas. O sink de mensagens e o bridge DeepSeek exigem `SecretProvider` em estado `READY`, com regressões para provider de arquivo degradado.

`npm test` passou **316 (315 pass, 1 skip, 0 fail)**; typecheck, lint 167, build, PDP universal, static 145/169, authoritative writes 32 domínios, worker runtime 6 policies/32 focused tests e F35 7/7 `EXECUTED_LOCAL` passaram. O gate Triplo AAA continua exit 2 `AAA_NOT_PROVEN`; as provas externas e humanas permanecem ausentes, e nenhuma promoção foi declarada.

## VER-CVG-238 — inventário final da migração 035 — 2026-09-11

`db/migrations/035_break_glass_scope.sql` entrou nos inventários static e production; a cobertura local agora é **146 artefatos obrigatórios/169 fontes**. A segunda execução bounded do Triplo AAA passou os gates locais e terminou exit 2 `AAA_NOT_PROVEN`, mantendo todas as limitações externas e humanas explícitas. O snapshot final dessa execução foi `386896d6061164bb1b8f1f5c998ef5568526ebdd68cd54212a2a09abe7c7886f`, associado ao evento `EVT-CVG-20260911-VERIFY-303`.

## VER-CVG-239 — revalidação após hardening de runtime — 2026-09-11

A execução local passou 316 testes (315 pass, 1 skip), typecheck, lint, build, contrast 7/7, worker runtime 6 policies/32 focused tests e a matriz Playwright completa com 131 casos (112 pass, 19 skips, 0 falhas). WebKit cobriu 42 casos (36 pass, 6 skips) com bibliotecas no espaço do usuário; a invocação host-native continua bloqueada pela dependência ausente. A cadeia de auditoria agora usa lock advisory transacional comum a commits, append de worker e break-glass; readiness inclui migration035; o worker faz preflight criptográfico de backup; e F12 tem receipt própria `webauthnBreakGlass`.

O artifact PostgreSQL local continua explicitamente histórico até migrations 001–034; migration035 consta no inventário de fonte, mas não foi reexecutada nesse artifact. O veredito permanece `AAA_NOT_PROVEN`, porque as gates externas e a aprovação humana não foram fornecidas.


## VER-CVG-240 — revalidação final da suíte e do snapshot — 2026-09-11

A suíte atual passou **318 testes (317 pass, 1 skip, 0 fail)**; typecheck, lint 167, build, PDP universal, authoritative writes (32 domínios), worker runtime (6 policies/32 focused), contraste 7/7 e static 146/169 passaram. A matriz browser permanece em 131 casos (112 pass, 19 skips, 0 falhas), com WebKit por prefixo de bibliotecas no espaço do usuário.

`npm run verify:triplo-aaa` encerrou exit 2 `AAA_NOT_PROVEN`; DeepSeek/provider/Secret Authority, staging PostgreSQL com migration035, observabilidade/SLO, carga/chaos/recovery/RTO-RPO, same-SHA de promoção, revisão independente e aprovação humana continuam sem prova. O snapshot atual de dez artifacts é `c3bcffe75402498db8dc1a3880d31624beeb1730352881a8f8809dc98b52a1ba`, associado a `EVT-CVG-20260911-VERIFY-305`.
## VER-CVG-241 — revalidação final da suíte, ACL e foco móvel — 2026-09-11

O reparo do drawer móvel agora restaura o foco ao botão de menu após a troca de unidade, e o teste E2E verifica fechamento, `aria-hidden`, conteúdo da unidade e foco nos viewports móveis. A migration forward 036 restringe o runtime a `SELECT` em `public.schema_migrations`; bootstrap, restore e readiness reaplicam e verificam o ACL, sem alterar migrations históricas. A fonte já inventaria 001–036, mas a prova PostgreSQL local registrada continua executada até 034.

A regressão corrente passou: npm test 319 (318 pass, 1 skip, 0 fail); E2E 140 casos (115 pass, 25 skip, 0 fail); static 147 required artifacts/170 source files; lint 168 sources; typecheck, build, contraste, PDP universal, writes autoritativos, worker runtime, snapshot semântico e produção estrutural. `verify:triplo-aaa` terminou exit 2 `AAA_NOT_PROVEN`, com DeepSeek/provider/Secret Authority, staging multi-instância, observabilidade/SLO, carga/chaos/recovery/RTO-RPO, provenance same-SHA, host-native WebKit, revisão assistiva manual, critics aprovadores e aceite humano ausentes. O snapshot atual é `b989b026b02d4a4cef10eeba75436568671df779802a2b047599c5a440a93cf6`, capturado em `2026-09-11T12:22:32.562Z`, e nenhuma promoção foi declarada.
## VER-CVG-242 — stress cross-engine e matriz browser ampliada — 2026-09-11

A configuração Playwright agora aplica o stress de DPR 2, reduced-motion, reflow, foco e axe a Chromium, Firefox e WebKit. A matriz completa terminou com 153 casos, 124 pass, 29 skips e zero falhas. O teste de touch passa em Chromium; Firefox e WebKit ficam em skip quando o engine não expõe `navigator.maxTouchPoints`, mantendo a limitação explícita. O foco móvel de troca de contexto passou nos três engines móveis. WebKit foi executado com bibliotecas no espaço do usuário; o host-native continua bloqueado por `libgstcodecparsers-1.0.so.0`.

O snapshot atual é `7c2dd0ef75a956451a0a82f4683f412b0b7a92a2b163169603c2888859090bd6`, capturado em `2026-09-11T12:48:48.010Z`. `npm test` permanece em 319 (318 pass, 1 skip); typecheck, build, lint 168, static 147/170, produção estrutural e diff check passaram. O gate global continua `AAA_NOT_PROVEN`; staging, provedores reais, observabilidade, carga/chaos/recovery, same-SHA de promoção, avaliação assistiva manual, critics aprovadores e aceite humano permanecem ausentes.
## VER-CVG-243 — gate final fail-closed após a matriz cross-engine — 2026-09-11

A reexecução de `npm run verify:triplo-aaa` terminou exit 2 `AAA_NOT_PROVEN`. A matriz local de browser permanece em 153 casos (124 pass, 29 skips, zero falhas), a suíte em 319 (318 pass, 1 skip), static em 147/170 e lint em 168; typecheck, build, PDP universal, writes autoritativos, worker runtime, contraste, produção estrutural e diff check passaram. O snapshot atualizado é `9bf7b1c316475bd8e4327f33945bb4f1cab33d963d490e747611a8fb9fcf38ec`, capturado em `2026-09-11T12:55:02.812Z`.

Os gates externos e humanos continuam ausentes: DeepSeek/provider/Secret Authority, PostgreSQL de staging, CI/provenance same-SHA, staging promotion, container smoke, observabilidade/SLO, carga/chaos/recovery/RTO-RPO, host-native WebKit, touch cross-engine não exposto, avaliação assistiva manual, critics aprovadores e aceite humano. Nenhuma promoção foi declarada.

## VER-CVG-244 — guard AST de aliases e gate final fail-closed — 2026-09-11

O guard AST agora resolve aliases de parâmetros e retornos de funções, destructuring aninhado e mutadores extraídos, mantendo acesso dinâmico como finding fail-closed. O teste focal passou 5/5 e o gate universal completo permaneceu verde.

A regressão corrente passou **320 testes (319 pass, 1 skip, 0 fail)**; typecheck, build, lint 168, static 147/170, PDP universal, produção estrutural e diff check passaram. O gate Triplo AAA encerrou exit 2 `AAA_NOT_PROVEN`. O snapshot corrente é `17cb06cde90018315f3bde880a7a6aa2f08961ca883ab27562fb0f3add15c8f6`, capturado em `2026-09-11T13:12:11.274Z`; as provas externas, critics aprovadores e aceite humano continuam ausentes.

## VER-CVG-245 — reexecução final após reconciliação — 2026-09-11

O verifier final foi reexecutado sobre os artifacts locais reconciliados e encerrou exit 2 `AAA_NOT_PROVEN`. A suíte corrente permanece em **320 testes (319 pass, 1 skip, 0 fail)**; a matriz browser permanece 153 (124 pass, 29 skips, zero falhas).

O snapshot byte-bound é `fdfdee988ba60c1d7e786bb4ed2c4ad3d2df7120eff3510e5e2a1f47bf18de53`, capturado em `2026-09-11T13:18:04.803Z`; o guard AST cobre aliases de função e destructuring aninhado, mas o residual H-02-L continua advisory. As provas externas, critics aprovadores e aceite humano continuam ausentes.

## VER-CVG-246 — reconciliação de completude dos artifacts — 2026-09-11

A limitação stale do artifact local foi corrigida: a matriz browser corrente é 153 casos (124 pass, 29 skips, zero falhas), e não 140. O snapshot `0b01c6a9aa0e5a7e44c63ab4a441e7f81b1589a858d6a480be4188441975aa7b` foi regenerado e verificado. O gate global permanece `AAA_NOT_PROVEN`; esta correção não executa staging, provedores reais, critics aprovadores ou aceite humano.

## VER-CVG-247 — crítica fresh de 15 categorias — 2026-09-11

A crítica bounded somente leitura [critique-final-gauntlet-20260911-VER247.md](../.gauntlet/critique-final-gauntlet-20260911-VER247.md) percorreu as 15 categorias exigidas pelas fases F36–F38 e concluiu `FAIL` / `AAA_NOT_PROVEN`. Ela confirma que os contratos locais estão verificáveis, mas não há prova de provider/DeepSeek/Secret Authority, staging, observabilidade, carga/chaos/recovery, CI same-SHA ou aceite humano. H-02-L continua MEDIUM/advisory porque a guarda AST não substitui análise completa de call graph/data flow. O registro é review-only e não autoriza promoção.

## VER-CVG-248 — revalidação final local e freshness do snapshot — 2026-09-11

Após a crítica fresh, a suíte final passou 320 testes (319 pass, 1 skip, 0 fail), lint 168, typecheck/build e static 147/170. O verificador de snapshot regenerou e validou os mesmos dez artifacts, sem alterar seus bytes: runId `0b01c6a9aa0e5a7e44c63ab4a441e7f81b1589a858d6a480be4188441975aa7b`, capturado em `2026-09-11T13:32:27.575Z`, ligado ao HEAD e ao prompt preservado. A crítica anterior está em [critique-final-gauntlet-20260911-VER247.md](../.gauntlet/critique-final-gauntlet-20260911-VER247.md).

Essa revalidação confirma apenas a fotografia local. O gate Triplo AAA continua `AAA_NOT_PROVEN`; DeepSeek/provider/Secret Authority, staging, operações production-like, CI same-SHA, avaliação assistiva, críticos aprovadores e aceite humano continuam sem prova.

## VER-CVG-249 — gate Triplo AAA final fail-closed — 2026-09-11

A reexecução de `npm run verify:triplo-aaa` terminou exit 2 com `AAA_NOT_PROVEN`. Os gates locais passaram, mas DeepSeek/provider/PostgreSQL concorrente/provenance same-SHA/staging/container foram bloqueados por ausência de autoridade ou manifesto; observabilidade, load, chaos, recovery/RTO-RPO, browser assistivo, critics aprovadores e aceite humano ficaram `NOT_RUN`. O log completo está em `/tmp/cvg-verify-249-final.log`.

O snapshot final dos dez artifacts foi verificado com runId `3b7215da2ba9a025d68ad738e2690541dafb56b0147e539ec357f2e9d56d9db9`, capturado em `2026-09-11T13:37:29.914Z`, ligado ao HEAD e ao prompt preservado. A crítica fresh de 15 categorias permanece em [critique-final-gauntlet-20260911-VER247.md](../.gauntlet/critique-final-gauntlet-20260911-VER247.md) como review-only. Nenhuma promoção ou certificação AAA foi declarada.

## VER-CVG-250 — reconciliação da metadata machine-readable — 2026-09-11

A auditoria detectou que os artifacts locais ainda identificavam o campo `finalVerification` como VER-CVG-246 depois do gate final VER-CVG-249. A metadata foi alinhada ao gate realmente executado, sem alterar resultados, contagens ou limitações. O snapshot foi regenerado e verificado com runId `c91e0cb6c93fee9c91358af1e02ca9a5d537bc1f3199f69cf4ef772bbc99cd34`, capturado em `2026-09-11T13:41:02.927Z`, vinculando os dez artifacts ao HEAD e ao prompt preservado.

Essa alteração é reconciliação de metadata e não nova prova externa. O gate VER-CVG-249 continua exit 2 `AAA_NOT_PROVEN`; a crítica fresh permanece em [critique-final-gauntlet-20260911-VER247.md](../.gauntlet/critique-final-gauntlet-20260911-VER247.md) e nenhuma promoção foi declarada.

## VER-CVG-251 — reconciliação documental visual e assistiva — 2026-09-11

Os documentos correntes de visual QA e acessibilidade ainda diziam 131 casos, 112 pass e 19 skips. Eles foram alinhados ao artifact browser verificado: 153 casos, 124 pass, 29 skips e zero falhas. A correção é documental; não altera o runtime e não transforma axe/Playwright em prova de leitor de tela, assistive tech, zoom real ou baseline visual independente.

## VER-CVG-252 — compatibilidade de contratos fail-closed — 2026-09-11

O catálogo v1 agora expõe um registro de upcasters executável e fail-closed. O registro vazio é intencional até existir uma migração de schema revisada; `upcastApiValue` copia payloads da versão corrente e rejeita versões antiga/futura ou transições ausentes. O teste focado passou 5/5; a suíte corrente passou 321 (320 pass, 1 skip), static 149/171 e lint 169. Snapshot corrente: `58666f3e5d957676a0bb129508fee8cf38ffecd5d280d71847cb43c14ecc4b2a`. A barra global permanece `AAA_NOT_PROVEN`.

O snapshot `58666f3e5d957676a0bb129508fee8cf38ffecd5d280d71847cb43c14ecc4b2a` é o vínculo byte-bound corrente; a crítica fresh [critique-final-gauntlet-20260911-VER247.md](../.gauntlet/critique-final-gauntlet-20260911-VER247.md) continua review-only. O estado global permanece `AAA_NOT_PROVEN`.

## VER-CVG-253 — reconciliação dos artifacts machine-readable — 2026-09-11

Cópias duplicadas de `localVerification` ainda registravam VER249. Elas foram alinhadas ao recorte corrente de 321 testes (320 pass, 1 skip, 0 fail), static 149/171 e lint 169; a alteração não cria prova externa nem muda o veredito.

O snapshot regenerado é `ef46bc13e46e50f8e3a367acd3f001f187540e8f0a17c572ecf74f04b2afde7c`, com dez artifacts vinculados ao HEAD e ao prompt preservado. O gate global continua `AAA_NOT_PROVEN`.

## VER-CVG-254 — guard de consistência do snapshot — 2026-09-11

O snapshot agora rejeita divergência entre os campos duplicados de verificação dos artifacts. O teste focal e a suíte completa passaram: 322 testes (321 pass, 1 skip, 0 fail), static 149/171, lint 169, typecheck e build.

O novo snapshot é `4cad58f058f565fb60f14df45c7327111e46111c50cdfa922c6fd1f9f3563c23`; o gate global continua `AAA_NOT_PROVEN` e nenhuma prova externa ou aprovação humana foi inferida.


## VER-CVG-255 — guard expandido e revalidação global — 2026-09-11

O verificador agora cobre as cópias duplicadas de `finalVerification`, os rollups `unitIntegration`/`tests` e `browser`/`e2e`, além do `auditAddendum` do bundle Triplo AAA. A suíte passou 322 testes (321 pass, 1 skip, 0 fail), contrato 5/5, typecheck, build, lint 169 e static 149/171.

O gate global foi reexecutado e encerrou internamente exit 2 `AAA_NOT_PROVEN`, com os gates externos bloqueados ou `NOT_RUN`. Snapshot byte-bound corrente: `080c86770231911726ca8a75afc6daaeaeab05316d1e98215ae3eee38d28e123`. Nenhuma prova externa, aprovação de critic independente ou aceite humano foi inferida.


## VER-CVG-256 — hardening do contrato de critics e fresh gauntlet — 2026-09-11

A admissão de receipts de critics agora falha fechado para findings `CRITICAL` ou `HIGH` e para qualquer conjunto de critérios que não seja exatamente o contrato da gate. O teste focal passou 15/15; a documentação PDP corrente registra 68 operações, 72 regras, 6 policies, 114 registros e 26/26 testes de runtime.

A crítica fresh [VER-CVG-256](../.gauntlet/critique-final-gauntlet-20260911-VER256.md) percorreu as 15 categorias e concluiu `FAIL / AAA_NOT_PROVEN`, sem aprovação. Snapshot byte-bound: `f7e0632a5939a93bc599257ce69303c3cd42c47df14393e33d002abb508e45ec`; suíte completa 322 (321 pass, 1 skip, 0 fail), typecheck/build, lint 169 e static 149/171 passaram.

## VER-CVG-259 — fechamento de seam e revalidação local — 2026-09-11

A composição de produção não permite que `dependencies.lanes` ou o adapter de reconciliação antecedam o handler durável tipado quando `auditRequired` está ativo. O outbox agora registra auditoria e métricas por tentativa antes de completar ou falhar a entrega. `verify-audit-chain` reconstrói cadeias por predecessor/hash e rejeita gaps, branches, ciclos, múltiplas cabeças e desconexões, mesmo com transporte embaralhado.

A suíte atual passou 327 (326 pass, 1 skip, 0 fail), typecheck/build, lint 169, static 149/171, worker runtime 6 policies/35 focused, auditoria de cadeia, snapshot byte-bound `fc9fe3cbd58c2e9a513db04208a9316b7c59bdffffe65b4da1aa2e22d351fc21` e verificação estrutural. `verify:triplo-aaa` encerrou exit 2 com `AAA_NOT_PROVEN`; os gates externos e a aprovação humana permanecem bloqueados ou não executados.

A crítica fresh [VER-CVG-259](../.gauntlet/critique-final-gauntlet-20260911-VER259.md) é review-only e não é receipt de promoção. A matriz browser continua limitada ao run com prefixo de usuário (153/124/29/0); host-native WebKit ficou bloqueado pela biblioteca ausente.

## VER-CVG-260 — fotografia final e gauntlet fresh — 2026-09-11

A fotografia byte-bound `1db5b18f6475a529816b5003bc62e9dc5201f09105a3c45e66e9e1f87b4dc878` foi regenerada após alinhar os dois artifacts machine-readable ao registro VER-CVG-260. A suíte passou 327 (326 pass, 1 skip, 0 fail), worker runtime 6 policies/35 focused, auditoria de cadeia, typecheck/build, lint 169 e static 149/171.

A revisão fresh final [VER-CVG-260](../.gauntlet/critique-final-gauntlet-20260911-VER260.md) cobre exatamente 15 categorias, é review-only e não é aprovação externa ou humana. `verify:triplo-aaa` permanece exit 2 / `AAA_NOT_PROVEN`; nenhuma gate externa foi inferida.

## VER-CVG-261 — migrations 001–036 e PostgreSQL local atual — 2026-09-11

A evidência PostgreSQL foi reexecutada em banco efêmero isolado com as 36 migrations atuais. `verify:postgres`, `verify:postgres:concurrency` e `verify:postgres:restore` passaram; a role runtime não pode escrever em `schema_migrations`. Snapshot: `2e19a834afa9241a5d3d29a15416e6d8706afd6b6943bfe6ce447217600f1dfb`.

Isso corrige a defasagem local do artifact, mas não substitui staging, backup gerenciado, RTO/RPO, observabilidade, CI same-SHA, revisão independente ou aceite humano.

## VER-CVG-262 — metadata final e crítica reconciliada — 2026-09-11

O bundle local final está alinhado ao snapshot `5eea301f3c2af29d6ebca101d85b5113494eaafdfcd4f4a3f29e0291f1cad903` e marca a crítica fresh como `FAIL`/review-only. A prova PostgreSQL local permanece em migrations 001–036; a promoção global continua `AAA_NOT_PROVEN`.

## VER-CVG-264 — metadata final e crítica congelada — 2026-09-11

Os artifacts foram sincronizados para `VER-CVG-264` e o snapshot `903db416c44e1df7f12f2270bd078bcf5724b50d878ffd1ea021691a801a8004`. A crítica fresh permanece review-only com 15 categorias; gates externos e aprovação humana continuam ausentes.


## VER-CVG-265 — recovery rejeita cadeia adulterada — 2026-09-11

A validação de recovery passou a invocar o verificador compartilhado de `@cvg/domain`, cobrindo a cadeia `previousHash`/`recordHash` antes de validação final e cifragem. O novo teste reempacota um snapshot adulterado com digest recalculado e confirma rejeição por `validateRecoveryBundle` e `encryptRecoveryBundle`. A suíte passou 328 testes (327 pass, 1 skip, 0 fail); snapshot `88b7fec93375728b68821917b64ed82d37b62731d45cd70a9dfc33406455680a`, SHA `c28800072dd4ace183810b94ce1e242e49c0319322174c6e2426a6a70a3de49f`; crítica [.gauntlet/critique-final-gauntlet-20260911-VER265.md](.gauntlet/critique-final-gauntlet-20260911-VER265.md) review-only. `AAA_NOT_PROVEN` permanece porque nenhuma prova externa ou aprovação humana foi criada.


## VER-CVG-266 — timestamps de autenticação no recovery — 2026-09-11

`validateRecoveryBundle` passou a rejeitar sessões e desafios com timestamps ausentes ou inválidos antes da aceitação do snapshot; a cifragem reutiliza a mesma validação. O teste cobre `sessions[0].expiresAt` ausente após recálculo do digest. A suíte passou 329 testes (328 pass, 1 skip, 0 fail); snapshot `f02418cb693c74f94a05c96703b209d4413301b3cc2bd2c224125f3a9c92b69b`, SHA `89417f80ec60b708182a9ccfd689885f4bcd52af766bfd0118712cf4531ce167`; crítica [VER-CVG-266](../.gauntlet/critique-final-gauntlet-20260911-VER266.md) review-only. `AAA_NOT_PROVEN` permanece sem provas externas ou aprovação humana.


## VER-CVG-267 — guarda de forma bruta no recovery — 2026-09-11

A validação de recovery passou a verificar usuários, security, sessões e desafios no objeto bruto antes da normalização de `parseSnapshot`; registros incompletos são rejeitados, e a cifragem/hydrate usa a mesma fronteira. A suíte passou 329 testes (328 pass, 1 skip, 0 fail), typecheck, build, lint 169 e static 149/171. Snapshot `dbc1da159294f9a04c8509f46b99b5a4a7a3cb5ab2a738094d6b7f0d88ee8b07` (SHA `6b6d7d6b77a5481c510cef1f3142a6ec0de13989940a10bbac17f29c08dfcde9`), artifact local `98d31bc53f989dfae0e25c63d67cd7307744480683aa0c712b1808b40289ccb2` e crítica [critique-final-gauntlet-20260911-VER267.md](../.gauntlet/critique-final-gauntlet-20260911-VER267.md) review-only pendente. `AAA_NOT_PROVEN` permanece sem provas externas ou aprovação humana.

## VER-CVG-268 — digests imutáveis dos ledgers de recovery — 2026-09-11

A validação de recovery recalcula os digests dos campos imutáveis de outbox, usage, inbox, efeitos externos e jobs. Mesmo com o payload de outbox alterado e o digest agregado do manifesto refeito, `validateRecoveryBundle` e `encryptRecoveryBundle` rejeitam o bundle. A suíte passou 330 testes (329 pass, 1 skip, 0 fail), `npm run test:database` 61/61, typecheck, build, lint 169 e static 149/171. Snapshot run `76518144d894beed7821e79789531bbe101c80db1ada5883303d161647c71ea4`, SHA `23c302c622488335e2152212d81e26862854a4b5f1ca5ee807e53ce501ffcd50`, artifact local `bc0807b388a59ab906e35a1a66a7acec208433451a81d03cadad18d599748034`; crítica [critique-final-gauntlet-20260911-VER268.md](../.gauntlet/critique-final-gauntlet-20260911-VER268.md) review-only. `AAA_NOT_PROVEN` permanece sem provas externas ou aprovação humana.
