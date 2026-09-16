# ADR 029 — Fronteiras arquiteturais e ownership do artifact atual

- Status: Accepted for incremental migration
- Date: 2026-09-13
- Scope: ARC-01
- Base artifact: `1c22c5dc79c52151f4c7c94c4402dfdc86812cbc`
- Exclusive resource: `architecture-docs`

## Context

O CVG-Corp e um brownfield T4: a aplicacao Fastify/React ja possui contratos, dominio, persistencia PostgreSQL, worker e testes, mas a composicao da API ainda concentra autenticacao, hooks, rotas e wiring em `apps/api/src/app.ts`. O objetivo desta decisao e mapear fronteiras verificaveis antes de qualquer extracao. Tamanho de arquivo, sozinho, nao e criterio suficiente.

Este documento nao autoriza mudanca de codigo. ARC-02 e ARC-03 devem usar este mapa, confirmar as dependencias e atualizar a estrategia se a observacao do comportamento revelar uma fronteira diferente.

## Decision

Manter o caminho publico e as fontes de verdade atuais, com os seguintes owners e limites:

| Fronteira | Arquivos observados | Responsabilidade | Consumidores reais | Proxima extracao segura |
|---|---|---|---|---|
| Composicao HTTP | `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/routes/health.ts` | Criar runtime, plugins, hooks, auth/context, handlers e lifecycle | `apps/api/src/server.ts`, scripts de startup, testes de API/E2E | ARC-02 pode separar composition/plugins/routes sem mudar o entrypoint publico |
| Catalogo HTTP | `apps/api/src/route-catalog.ts`, `packages/contracts/src/api-catalog.ts`, `packages/contracts/src/version.ts` | Metodo, path, operacao, auth, policy, schemas, idempotencia, fingerprint e admissao startup | `app.ts`, `tests/integration/route-catalog.test.ts`, `tests/unit/contracts.test.ts` | Catalogo permanece fonte canonica; nenhuma rota pode ser criada apenas por observacao |
| Application services | `apps/api/src/application/*` | Casos de uso, contexto, policy e acesso a repositorios/ports | handlers de `app.ts`, testes de application e integracao | ARC-02 extrai por contexto com envelope, auth e idempotencia equivalentes |
| Domínio e store | `packages/domain/src/index.ts`, `packages/domain/src/authorization.ts`, `packages/domain/src/snapshot-validation.ts` | Invariantes, agregados, estado sintetico, receipts, snapshot e validacao de recuperacao | `app.ts`, `packages/harness/src/index.ts`, `packages/persistence/src/index.ts`, testes unitarios | Nao importar HTTP/provider; ARC-02 preserva commands e invariantes |
| Persistencia duravel | `packages/persistence/src/index.ts`, `db/migrations/`, `tests/integration/persistence.test.ts` | Transacao, CAS, RLS, journal, audit, receipts, outbox/inbox/effects, worker jobs e recovery | `app.ts`, `apps/worker/src/main.ts`, `apps/worker/src/worker.ts`, `docker/worker.ts`, scripts PostgreSQL | ARC-03 separa repositories/transaction/ledgers mantendo o mesmo commit atomico |
| Worker | `apps/worker/src/main.ts`, `apps/worker/src/worker.ts`, `docker/worker.ts` | Processo separado, heartbeat, lanes e admissao de jobs | compose, scripts e testes `worker-jobs`/`worker` | Nao compartilhar mutacao direta; usar ports e ledger duravel |
| Integracoes e harness | `packages/integrations/src/index.ts`, `packages/harness/src/index.ts`, `packages/harness-adapters/` | Gateway, provider fail-closed, efeitos externos, runtime local e provenance | `app.ts`, testes de provider/DeepSeek/PDP | Permanecer deny-by-default; nunca virar fonte de verdade |
| Contratos de pacote | `packages/contracts/src/index.ts`, `api-catalog.ts`, `version.ts` | Tipos, envelopes, erros, compatibilidade e catalogos | API, web, worker, testes de contrato e cliente | Alteracoes exigem upcaster/compatibilidade explicita e revalidacao dos consumidores |
| Dependencias | `package.json`, `package-lock.json`, manifests dos workspaces | Arvore resolvida, scripts e reproducibilidade | CI, build, lint, SBOM, testes e instalacao limpa | Nenhuma mudanca de dependencia nesta tarefa; SUP-01/SUP-02 tratam isso |

## Observed callers, routes and tests

### Ownership matrix

| Fronteira | Dono accountable | Arquivos exatos de referencia | Limite de decisao |
|---|---|---|---|
| Composicao HTTP | API | `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/routes/health.ts` | Preservar lifecycle, hooks, auth/context e resposta publica |
| Catalogo HTTP | Contratos | `packages/contracts/src/api-catalog.ts`, `apps/api/src/route-catalog.ts` | Nenhuma rota ou policy pode existir fora do catalogo |
| Application services | Aplicacao/API | `apps/api/src/application/` | Toda mutacao passa por use case e contexto autorizado |
| Dominio e store | Dominio | `packages/domain/src/index.ts`, `authorization.ts`, `snapshot-validation.ts` | Invariantes e fonte de verdade nao importam transporte |
| Persistencia duravel | Dados | `packages/persistence/src/index.ts`, `db/migrations/` | CAS, RLS, rollback e ledgers continuam no mesmo limite transacional |
| Worker | Operacoes | `apps/worker/src/main.ts`, `apps/worker/src/worker.ts`, `docker/worker.ts` | Jobs usam ports/ledgers e nao mutam dominio por atalho |
| Integracoes e harness | Integracao/AI runtime | `packages/integrations/src/index.ts`, `packages/harness/src/index.ts`, `packages/harness-adapters/` | Provider externo permanece deny-by-default |
| Contratos de pacote | Contratos | `packages/contracts/src/index.ts`, `version.ts` | Mudancas exigem compatibilidade explicita e revalidacao |
| Dependencias e lockfile | Supply chain | `package.json`, `package-lock.json` | Instalacao, build e SBOM devem usar a mesma arvore |

Os donos acima sao owners de integracao e decisao, nao uma autorizacao para alterar seus arquivos nesta tarefa. ARC-01 reserva somente a documentacao; ARC-02/ARC-03 devem adquirir os locks de codigo correspondentes.

### HTTP surface

O contrato nasce em `API_ROUTE_CATALOG` e e convertido por `runtimeRouteCatalog()` em `/api/v1`, mais `OPTIONS *` e `GET /internal/metrics`. GET gera HEAD derivado, e `installRuntimeRouteCatalog()` rejeita rota nao catalogada, duplicada, com constraint nao declarada ou registrada depois do selo.

O inventario fechado e o `API_ROUTE_CATALOG` completo em `packages/contracts/src/api-catalog.ts:19-95`, convertido sem omissao por `runtimeRouteCatalog()`; nao e uma lista “pelo menos”. Os paths API reais sao:

- Infra: `GET /api/v1/health`, `GET /api/v1/ready`, `POST /api/v1/integrations/:provider/events`, `OPTIONS *`, `GET /internal/metrics`.
- Auth: `POST /api/v1/auth/login`, `/auth/mfa/verify`, `/auth/mfa/enroll`, `/auth/mfa/revoke`, `/auth/recovery/start`, `/auth/recovery/complete`, `/auth/demo`, `/auth/logout`, `/auth/password/rotate`, `GET /api/v1/auth/sessions`, `POST /api/v1/auth/sessions/:id/revoke`.
- Identity and governance: `GET /api/v1/me`, `/contexts`, `/context`, `/users`, `/audit`; `POST /api/v1/role-assignments`; `DELETE /api/v1/role-assignments/:id`.
- Guardians and patients: `GET /api/v1/guardians`, `POST /api/v1/guardians`, `GET /api/v1/patients`, `GET /api/v1/patients/:id`, `POST /api/v1/patients`, `POST /api/v1/patients/:id/disable`, `POST /api/v1/patients/merge`.
- Agenda: `GET /api/v1/appointments`, `POST /api/v1/appointments`, `GET /api/v1/queue`, `POST /api/v1/appointments/:id/check-in`, `GET /api/v1/encounters`, `POST /api/v1/encounters`.
- Clinical and diagnostics: `GET /api/v1/clinical/documents`, `POST /api/v1/clinical/documents`, `POST /api/v1/clinical/documents/:id/sign`, `POST /api/v1/clinical/documents/:id/addenda`, `GET /api/v1/diagnostics/requests`, `POST /api/v1/diagnostics/requests`, `GET /api/v1/diagnostics/specimens`, `POST /api/v1/diagnostics/requests/:id/specimens`, `POST /api/v1/diagnostics/results`, `GET /api/v1/diagnostics/results`.
- Operacao e medicacao: `GET /api/v1/stock`, `POST /api/v1/stock/movements`, `GET /api/v1/hospitalization/beds`, `GET /api/v1/hospitalization/episodes`, `POST /api/v1/hospitalization/episodes`, `GET /api/v1/medications/orders`, `POST /api/v1/medications/orders`, `POST /api/v1/medications/orders/:id/dispense`, `POST /api/v1/medications/orders/:id/administer`.
- Financeiro e comunicacao: `GET /api/v1/finance/charges`, `POST /api/v1/finance/charges`, `POST /api/v1/finance/payments`, `GET /api/v1/finance/payments`, `GET /api/v1/finance/ledger`, `POST /api/v1/finance/refunds`, `GET /api/v1/communications`, `POST /api/v1/communications`, `POST /api/v1/communications/:id/approve`.
- Conhecimento, operacao e AI: `GET /api/v1/knowledge`, `POST /api/v1/knowledge`, `GET /api/v1/capabilities`, `GET /api/v1/operations/summary`, `GET /api/v1/metrics`, `GET /api/v1/ops/snapshot`, `POST /api/v1/ops/export`, `POST /api/v1/ops/restore`, `GET /api/v1/ai/health`, `GET /api/v1/ai/sessions`, `GET /api/v1/ai/sessions/:id/replay`, `POST /api/v1/ai/turns`, `POST /api/v1/ai/approvals/:id`, `POST /api/v1/ai/approvals/:id/retry`, `POST /api/v1/ai/drafts/:id/promote`.

O caller de todos os descriptors API e o registro Fastify em `apps/api/src/app.ts`; health/readiness sao registrados por `apps/api/src/routes/health.ts`. A prova de membership e `tests/integration/route-catalog.test.ts`; o comportamento dos handlers e coberto por `tests/integration/api.test.ts`, `tests/integration/persistence.test.ts` e `tests/e2e/app.spec.ts`, com contratos em `tests/unit/contracts.test.ts`. O catalogo e a fonte exata de metodo/path; GETs HEAD derivados nao sao duplicados no contrato.

Consumidores e verificadores concretos: `tests/integration/api.test.ts`, `tests/integration/route-catalog.test.ts`, `tests/e2e/app.spec.ts`, `tests/e2e/accessibility.spec.ts`, `tests/unit/contracts.test.ts` e `tests/unit/vnext.test.ts`.

### Non-HTTP callers

- `apps/worker/src/main.ts` constroi `PostgresPersistence` para o processo worker.
- `apps/worker/src/worker.ts` executa o ciclo de lanes e politicas de admissao.
- `docker/worker.ts` e o entrypoint de container do worker e tambem constroi persistencia.
- `packages/harness/src/index.ts` consome `CvgStore` para runtime local e ledger de tools.
- `scripts/verify-postgres.ts`, `scripts/verify-postgres-concurrency.ts`, `scripts/verify-postgres-restore.ts` e `scripts/verify-authoritative-writes.ts` exercitam limites da persistencia.
- Testes de dominio, PDP, idempotencia, persistencia, restore e worker validam os mesmos ports e invariantes fora do HTTP.

## Observable flow and compatibility rule

Exemplo: `POST /api/v1/appointments` em `app.ts` exige sessao e CSRF, valida `appointmentInputSchema`, cria contexto para `appointments.create`, exige `Idempotency-Key`, chama `appointmentApplication.create`, audita e, se nao for replay, chama `commitDurableRequest`.

Quando persistencia esta ativa, o `preHandler` carrega o snapshot e revisao; o handler executa a mutacao; `onSend`/`commitRequest` calcula os novos audit records e receipts e chama `persistence.commit` com `expectedRevision`. Conflito CAS, corrupcao ou falha de commit restaura o baseline e marca receipts como `OUTCOME_UNKNOWN` quando necessario. O teste observado prova a linha normalizada de appointment; ele nao demonstra que um registro outbox especifico seja criado para appointment. Outbox permanece uma capacidade do limite duravel para fluxos que o solicitam. Essa sequencia e a fronteira comportamental que ARC-02/ARC-03 devem preservar.

Uma extracao somente e aceita se mantiver: metodo/path/catalog fingerprint, envelope e erro, auth/CSRF/PDP, idempotencia, auditoria, status HTTP, CAS/rollback, `OUTCOME_UNKNOWN` e callers existentes. A compatibilidade deve ser medida por testes de contrato, integracao e E2E, nao por equivalencia textual.

### Negative scenario retained by the shared boundary

O teste `tests/integration/persistence.test.ts` tambem cobre falha final de commit e exige `OUTCOME_UNKNOWN`; o teste de appointment cobre a escrita normalizada e o replay/commit compartilhado. ARC-01 nao afirma uma prova negativa exclusiva de appointment: a hipotese para ARC-02/ARC-03 e que a mesma falha de `persistence.commit` deve devolver erro fail-closed, restaurar o baseline e nao anunciar sucesso, e isso devera ganhar um teste especifico quando a extracao tocar o handler. Registrar a lacuna assim evita transformar o teste de patient em prova de appointment.

## Exact reservations

ARC-01 reserva somente:

- `docs/adr/029-architecture-boundaries-and-ownership.md`
- `docs/architecture-audit-vNext.md`

Nenhum arquivo de codigo, teste, migration, lockfile ou configuracao e parte desta tarefa. Os locks `api-root`, `domain-core` e `persistence-core` ficam disponiveis para tarefas futuras e nao sao adquiridos por ARC-01.

## Evidence manifest for this task

O candidato desta tarefa e um overlay documental no worktree, nao um commit novo: `subject_sha=1c22c5dc79c52151f4c7c94c4402dfdc86812cbc`, `worktree=MODIFIED`. O ADR 029 e novo no worktree e a secao ARC-01 foi adicionada ao audit existente; o HEAD sozinho nao contem essas duas alteracoes. Por isso este manifesto nao e evidencia de release nem de AAA global.

| Procedimento | Resultado observado |
|---|---|
| `git status --short` restrito aos caminhos ARC-01 | `docs/adr/029-architecture-boundaries-and-ownership.md` novo; `docs/architecture-audit-vNext.md` modificado |
| `git diff --check` | PASS |
| `npm run typecheck` | PASS |
| `python3 docs/plano-aaa-2026-09-12/validar-plano.py` | PASS documental |
| SHA-256 da barra v4 | `2093461a8d6103641a555ad45371dde4649e5f144c32260b80244e219fa70697` |
| Identidade dos artefatos | SHA-256 final do ADR e do audit e registrado no ledger `.agent/verification.jsonl` depois da escrita; qualquer mudanca exige recalculo |

Os digests acima sao do worktree observado e devem ser recalculados se qualquer arquivo mudar. A prova transacional citada e uma leitura do teste sintetico existente, nao uma nova prova de PostgreSQL staging.

## Consequences and follow-up

O mapa torna ownership e consumidores revisaveis sem introduzir uma abstracao ficticia. A concentracao em `app.ts` continua um risco conhecido, mas nao e corrigida por uma extracao ampla sem testes de contrato. ARC-02 deve primeiro fechar o inventario HTTP antes de mover composition/application; ARC-03 deve separar persistencia somente depois de preservar a transacao e os ledgers. Falta de PostgreSQL staging ou provider externo nao bloqueia este mapa documental, mas impede qualquer claim de producao ou AAA global.
