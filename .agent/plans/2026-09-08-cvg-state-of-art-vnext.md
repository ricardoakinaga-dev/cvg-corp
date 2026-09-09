# CVG-Corp — State of the Art / Triplo AAA vNext

## Purpose / Big Picture

Transformar o artifact local-first existente em uma base modular, segura, observável, recuperável e preparada para produção conforme o prompt preservado em `docs/prompt-state-of-the-art-triplo-aaa.md`, sem inventar provider, autoridade, dados ou evidência que não existam.

O resultado esperado é um produto executável com uma rota completa de desenvolvimento até release evidence. A elegibilidade Triplo AAA só será avaliada depois de todos os critérios obrigatórios da barra `.gauntlet/bar-v3.json` terem evidência atual, score mínimo de 95 em cada dimensão e críticos independentes frescos sem blocker.

## Progress

- [x] (2026-09-08T20:54:00-03:00) — Prompt copiado e verificado byte a byte; SHA-256 registrado.
- [x] (2026-09-08T20:54:00-03:00) — Fase 0 concluída em `docs/architecture-audit-vNext.md` com inventário, trust boundaries, gaps, dependências, plano e rollback.
- [x] (2026-09-08T20:54:00-03:00) — Barra v3 congelada em `.gauntlet/bar-v3.json`; barra v2 histórica preservada.
- [x] (2026-09-08T20:54:00-03:00) — Sessão recuperada; estado, backlog, gates e ledgers JSON/JSONL validados.
- [ ] Onda A — contratos de runtime, Tool Gateway, PDP/ABAC, configuração typed e ADRs (fundação inicial implementada; integração, catálogo/proveniência completo e fechamento da onda ainda pendentes).
- [ ] Onda B — decomposição da API e application layer com compatibilidade v1.
- [ ] Onda C — repositories completos, worker separado, recovery e fault drills.
- [ ] Onda D — frontend modular, offline state machine e acessibilidade multi-browser.
- [ ] Onda E — deploy, CI, SBOM, observabilidade, SLOs e runbooks.
- [ ] Onda F — adapter DeepSeek/provider e vertical real, somente se autoridade e endpoint existirem.
- [ ] Onda G — verificação de produção, críticas independentes frescas e scorecard honesto.

## Context and Orientation

O repositório contém uma aplicação TypeScript/Fastify/React com domínio sintético, persistência PostgreSQL e migrations 001–018, Harness local determinístico e testes locais. O commit de entrada é `7b49bd22ec32c72d9aff8fb39bfb6be7fb6bd295`; o working tree inicial desta etapa contém somente a cópia do prompt não commitada.

O repositório local do DeepSeek Harness está em `/home/ricardo/deepseek-harness`, commit `5dda764ed3`. Ele é uma dependência externa observada e documentada, não uma autoridade de runtime do CVG e não será editado por este plano.

A especificação exige que o fluxo permaneça `CVG Domain → Application Layer → Agent Runtime Interface → Harness Adapter → DeepSeek Harness`. O domínio mantém a verdade transacional; o Harness só executa capacidades autorizadas; nenhum provider externo é considerado disponível sem health, versão, capabilities, credencial, aprovação e teste real.

## Scope and Constraints

Inclui refatoração, novos packages/apps, contratos, migrations aditivas, testes, documentação, CI, container e evidências locais/production-like que possam ser executadas neste workspace.

Não inclui obtenção de credenciais, envio de dados a terceiros, uso de dados reais, alteração do repositório DeepSeek, criação de infraestrutura externa, aprovação de risco, release ou push automático. Providers reais continuam deny-by-default até existir autoridade explícita.

Não editar migrations aplicadas 001–018. Qualquer evolução de schema deve usar migration nova, checksum, dry-run, compatibilidade e rollback-forward.

## Architecture and Interfaces

### Agent Runtime

Criar uma interface estável com `health`, `createSession`, `executeTurn`, `approve`, `replay` e `shutdown`; definir requests/responses com correlation, actor, organization, unit/workspace, purpose, data classes, policy revision, budget, deadlines, approval binding, provenance e erro estável.

O Mock adapter é determinístico e seguro para testes. O DeepSeek adapter encapsula transporte e ciclo de vida do harness, verifica manifest/version/commit/tool registry e transforma timeout/cancelamento/provider failure em estados explícitos. Sem endpoint ou autoridade, o adapter retorna capability unavailable e não tenta egress.

### Tool Gateway and PDP

Tool metadata inclui risco, capability, roles, scope, schema, classes D0–D5, approval, timeout, idempotency, audit, secret refs e egress. O gateway é o único caminho de execução.

O PDP é separado e recebe subject/resource/context/purpose/operation/risk/time/policy/session. Ele devolve decisão explicável, policy revision e obrigações. High/critical exige aprovação humana independente, one-shot, TTL, digest binding e não pode aceitar o próprio ator como aprovador.

### Application and persistence

Routes validam requests e delegam a use cases. Use cases resolvem contexto, PDP, unidade de trabalho, domínio, repositories e outbox/receipt/audit. Repositories tipados são a porta de leitura/escrita; snapshot/journal continuam como reconstrução e trilha, não como atalho para cada rota.

Outbox/inbox/effect ledger têm lease/fencing, retry bounded, backoff, quarantine, unknown e reconciliation. Um efeito externo só é confirmado por receipt verificável ou consulta autorizada; callback duplicado é idempotente.

### Operational process model

`apps/worker` é um processo separado para outbox, jobs, reconciliation, notification e maintenance. API, worker e harness usam configuração validada, health/readiness, telemetry redigida e least privilege.

### Web

`apps/web` é separado em app shell, routes, features, components, hooks, API client, state machine e design tokens. O navegador exibe estados de autoridade e conectividade sem decidir autorização. Writes críticos ficam bloqueados em `OFFLINE_READ_ONLY`, e reconnect exige revalidação de identidade e contexto.

## Plan of Work

1. Congelar e validar a barra v3, atualizar este plano e o control plane.
2. Implementar contratos de config, runtime, provider, tools, policy, provenance, errors e API versioning.
3. Integrar Mock adapter e manter o adapter DeepSeek explícito, fail-closed e coberto por contrato.
4. Extrair PDP/Tool Gateway e decompor `server.ts`; migrar rotas por fatias pequenas com testes de regressão.
5. Criar application services e repositories por contexto; manter transações, RLS e migrations aditivas.
6. Criar worker separado, fault harness, backup/recovery manifest e drills sem apagar efeitos desconhecidos.
7. Modularizar a web, ampliar estados offline, acessibilidade, browsers e inspeção visual.
8. Criar Docker/CI/SBOM/config/headers/telemetria/SLO/runbooks e `verify:production`.
9. Implementar a vertical Appointment → comunicação apenas quando provider/authority existirem; caso contrário registrar `NOT_RUN`.
10. Rodar testes e críticos frescos; reparar somente findings reproduzíveis; gerar scorecard e veredito sem overclaim.

## Concrete Steps

<!-- engineering-framework: active_action_id=CVG-FULL-STATE-OF-THE-ART:PRODUCTION-LIKE-EVIDENCE -->

1. `CVG-FULL-STATE-OF-THE-ART:PRODUCTION-LIKE-EVIDENCE` — executar somente as evidências production-like que tenham ambiente e autoridade correspondentes; manter os gaps externos como `NOT_RUN` e continuar a evolução local nos maiores gaps reproduzíveis.
2. `CVG-FULL-STATE-OF-THE-ART:SLO-CONTRACTS-ALERTS` — concluída localmente: tipar targets SLO propostos, avaliar observações somente com amostra explícita e testar alertas/runbooks em harness sintético; não promover medição local a evidência de produção.

### Onda A — fundamento seguro

- Adicionar `packages/agent-runtime`, `packages/agent-policy` e `packages/agent-tools` com contratos públicos e testes negativos.
- Adicionar provider registry, provenance model, data-class registry, stable error taxonomy e config schema typed.
- Adicionar ADRs 001–008 e catálogo executável de capabilities.
- Atualizar imports do Harness para depender da interface, preservando comportamento local.

### Onda B — API e aplicação

- Criar `apps/api/src/app`, `plugins`, `middleware`, `auth`, `context`, `routes`, `services`, `errors` e `telemetry`.
- Extrair primeiro health/auth/context/operations, depois identidade/admin/patient/appointment e por último clinical/AI/integrations.
- Manter `/api/v1`; preparar `/api/v2` apenas com schema/compatibilidade definidos.
- Fazer `server.ts` ficar abaixo de 300 linhas e provar o grafo de imports sem rota acessando store fora do use case.

### Onda C — dados e reliability

- Criar repositories typed para todos os bounded contexts e contratos de transação.
- Criar `apps/worker` e migrações de jobs/leases/reconciliation somente aditivas.
- Expandir fault matrix para crash before/after commit/dispatch/receipt, lease loss, reconnect, timeout, duplicate callback e restore cases.
- Separar backup manifest, key reference, checksum, quarantine, authority invalidation e replay pós-watermark.

### Onda D — web e acessibilidade

- Decompor `main.tsx` sem perder a demonstração local.
- Implementar state machine de conectividade e contexto, cache somente de dados permitidos e purge auditado se autorizado.
- Rodar Chromium/Firefox/WebKit, teclado, focus, reduced motion, touch, DPR e scanner de acessibilidade.

### Onda E — produção e operação

- Completar compose e Dockerfiles com proxy/web/api/worker/harness/postgres/telemetry; non-root, read-only, health, resources e secrets.
- Criar workflows de lint/typecheck/tests/postgres/e2e/security/migrations/docker/SBOM/artifact.
- Criar OTel seam, dashboards/alerts, measured SLOs/error budgets e runbooks com owners/abort criteria.
- Implementar `npm run verify:production` como gate bloqueante e atualizar README/documentação vNext.

### Onda F — provider e vertical

- Implementar DeepSeek adapter baseado somente em contrato observável do harness e provider abstraction.
- Executar health/version/capability/tool registry/session lifecycle com processo ou HTTP autorizado.
- Integrar uma Appointment communication staged com approval independente, outbox, receipt, audit e reconciliation.
- Se endpoint, credencial ou autoridade não estiverem disponíveis, não simular sucesso; manter adapter bloqueado e evidência `NOT_RUN`.

### Ação concluída — boundary de autenticação local

- Adicionar estado de segurança tipado para senha, credencial, MFA, lockout, recuperação e sessões; manter snapshots antigos compatíveis por normalização explícita.
- Criar primitives testáveis de política de senha, TOTP e códigos de recuperação sem persistir segredo bruto; resolver segredos somente por `SecretProvider` injetado.
- Expor desafios de MFA/recuperação com respostas não enumeráveis, tentativas limitadas, expiração, uso único, revogação de sessões e auditoria redigida.
- Adicionar migration aditiva e projeção PostgreSQL para os metadados de segurança; sem executar migration em banco não autorizado nesta sessão.
- Cobrir conhecido-bom e conhecido-ruim no domínio/API, atualizar a barra com evidência local honesta e retornar a próxima ação para evidência production-like.

Resultado: migration `020_auth_security_boundary.sql`, package `@cvg/auth`, MFA/TOTP, política de senha, lockout, recuperação, rotação, revogação de sessões/dispositivos, auditoria redigida e testes locais foram integrados. `npm test` cobre 65 casos. A boundary permanece `PARTIAL` para o critério de produção até haver secret-provider/canal/TLS/sessão distribuída autorizados.

### Ação concluída — worker e fault harness local

- Unificar o entrypoint separado do worker com a mesma `CvgWorkerApplication` e configuração canônica `CVG_WORKER_ORGANIZATION_ID`.
- Cobrir health, quarentena, ausência de sink, encerramento, crash após marcador de dispatch, perda de lease e ausência de retry cego.
- Atualizar a matriz de falhas e executar novamente os gates completos antes de registrar o checkpoint.

Resultado: os entrypoints compartilham `CvgWorkerApplication`, o sink padrão continua em quarentena, e `tests/unit/worker.test.ts`/`tests/integration/faults.test.ts` passaram. O worker ainda não executa provider externo ou os loops de jobs/reconciliation/notifications/maintenance em ambiente real.

### Ação concluída — gates de CI e release

- Adicionar lint repository-owned e comandos separados para contrato, segurança, banco/recovery e fault/worker.
- Tornar o workflow explícito e bloqueante para instalação do Chromium, PostgreSQL efêmero, migrations, verificação PostgreSQL/RLS, restore, auditorias visuais, E2E, SBOM e build/scan de imagens.
- Fazer `npm run verify:production` executar os gates locais e validar o Compose com valores sintéticos sem iniciar serviços; manter `--production` fail-closed sem configuração real.

Resultado: `npm run verify:production` passou com lint, typecheck, testes, build, static (30 artefatos/101 fontes), E2E Chromium, auditorias, SBOM, benchmark, diff check e Compose estrutural. O workflow está versionado, mas CI remoto, PostgreSQL do serviço, build/scan de imagens e startup integrado permanecem `NOT_RUN` nesta máquina.

### Ação concluída — manifesto de recovery e fault coverage

- Adicionar manifesto versionado ao backup com tenant, watermark, fingerprint de migrações, timestamp e digests dos ledgers outbox/usage/inbox/external-effects.
- Validar o bundle antes da criptografia e depois da descriptografia; rejeitar bundle parcial, digest divergente, tenant divergente, schema incompatível, stale e fingerprint de migração incompatível.
- Cobrir bundle completo, ciphertext adulterado, chave errada, bundle parcial, stale e migration mismatch com testes determinísticos; integrar a validação ao drill PostgreSQL quando o daemon existir.

Resultado: `DurableRecoveryBundle` agora carrega manifesto versionado com tenant, watermark, timestamp, fingerprint de `schema_migrations` e digests dos ledgers outbox/usage/inbox/external-effects. Export, criptografia, descriptografia e restore validam a integridade; os testes locais cobrem bundle completo, ciphertext adulterado, chave errada, partial, stale por revisão/idade, migration mismatch e watermark divergente. O drill PostgreSQL incorpora a mesma validação para source/target, mas permanece `NOT_RUN` sem serviço autorizado.

Evidência: `VER-CVG-040`; 66/66 testes, 9/9 testes database, 5/5 fault/worker, typecheck, lint, static (30/101), build, `verify:production` e diff check passaram. O modo `--production` continua fail-closed por ausência de configuração real.

### Ação concluída — PDP target-bound do detalhe de paciente

- Vincular `sessionId`, operação/capability registrada, `resourceId`, finalidade, classe de dados, unidade e workspace ao decision point; ausência ou divergência deve negar sem revelar o recurso.
- Fazer `GET /api/v1/patients/:id` passar o alvo ao contexto, obter a projeção pelo PatientApplicationService e revalidar o escopo persistido antes de serializar.
- Cobrir policy conhecida-bom/ruim e API com sessão ausente/divergente, role não permitida, alvo inexistente/fora do contexto e representação minimizada; manter RLS como backstop separado.

Critério de saída: a rota de detalhe não usa `store.findPatient` diretamente, o PDP recebe e valida o alvo real e nenhum contexto, role ou capability forjado permite retorno de dados.

Resultado: `GET /api/v1/patients/:id` carrega o alvo no contexto autenticado, consulta `PatientApplicationService`, retorna projeção mínima e revalida sessão, operação/capability, `resourceId`, classe de dados, unidade e workspace antes da serialização. O repository de memória não revela paciente fora do escopo; a leitura PostgreSQL permanece escopada e RLS é backstop. Testes conhecidos-bons e conhecidos-ruins cobrem sessão ausente/divergente, capability incompatível, alvo ausente/divergente, role/contexto fora do escopo e representação mínima. A fatia não prova uso universal do PDP/Tool Gateway.

Evidência: `VER-CVG-041`; 67/67 testes, 9/9 testes database, 5/5 fault/worker, typecheck, lint, static (30/101), `verify:production` e diff check passaram. O modo `--production` saiu 1 por configuração real ausente, fail-closed esperado.

### Ação concluída — scheduler de lanes do worker

- Adicionar um ciclo único observável para outbox, jobs, schedule, reconciliação, notificações e manutenção, com contagens, duração e resultado por lane.
- Expor runners injetáveis para cada lane; quando uma capacidade, adapter ou store não estiver configurado, retornar `BLOCKED` sem claim, egress, retry ou efeito implícito.
- Integrar os entrypoints `apps/worker` e `docker/worker.ts` ao ciclo, registrar heartbeat/saúde e cobrir execução, bloqueio, parada e erro de runner com testes determinísticos.

Critério de saída: um processo separado pode executar um ciclo com todas as lanes nomeadas, cada lane tem resultado auditável, capacidades ausentes falham fechado e nenhuma lane não configurada é tratada como sucesso.

Resultado: `CvgWorkerApplication` agora expõe um ciclo com as lanes `outbox`, `jobs`, `schedule`, `reconciliation`, `notifications` e `maintenance`, resultado global `COMPLETED/DEGRADED/FAILED`, contagens, duração, lifecycle e sinal de abort. Os entrypoints `apps/worker` e `docker/worker.ts` usam o ciclo; sink ausente/quarentena não faz claim e runners ausentes ficam `BLOCKED` sem efeito. Os testes cobrem health, parada, execução de todas as lanes, bloqueio e falha isolada.

Evidência: `VER-CVG-042`; 70/70 testes, 8/8 fault/worker, 9/9 database, typecheck, lint, static (30/101), `verify:production` e diff check passaram. O modo `--production` saiu 1 por configuração real ausente, fail-closed esperado. A implementação fornece a orquestração e os hooks; jobs, stores de manutenção, reconciliação externa e sink/provider real continuam não configurados.

### Ação concluída — contratos de SLO e alertas

- Escopo: `packages/ops`, testes de operações e documentação de verificação/runbooks.
- Entregar um catálogo tipado de SLOs explicitamente `PROPOSED`, observações com estado de evidência e avaliação determinística de budget/violação.
- Entregar regras de alerta ligadas a runbooks existentes, com estados `OK`, `ALERT` e `NOT_RUN`; nenhum collector, carga, provider, segredo, egress ou dado real será acionado.
- Verificar known-good, breach, amostra ausente, budget consumido e redaction sem alterar os critérios congelados da barra v3.

Resultado: `@cvg/ops` expõe oito definições SLO tipadas, quatro regras de alerta e avaliação fail-closed. Targets não aprovados permanecem `PROPOSED`/`TBD`; amostra ausente, target sem número ou evidência `NOT_RUN` não podem gerar `PASS`/`ALERT`. O runbook `docs/runbooks/slo-breach.md` liga as classificações a procedimentos sem disparar efeitos.

Evidência: `VER-CVG-043`; 73/73 testes, typecheck, lint (99 fontes), static (30/101), `verify:production`, hash byte-a-byte do prompt, validação dos ponteiros JSON/JSONL e diff check passaram. O modo `--production` saiu 1 por configuração real ausente, fail-closed esperado. Collector, carga, SLO medido, alerta operacional, provider, segredo, egress, Docker runtime, CI remoto e release continuam `NOT_RUN`.

### Ação corrente — evidência production-like

- Executar PostgreSQL/Docker, CI remoto, imagem/container smoke, provider/secret authority, fault/recovery distribuído, carga/SLO e matriz de browsers/acessibilidade somente quando o ambiente e a aprovação correspondentes existirem.
- Registrar cada ausência como `NOT_RUN`, preservar egress fechado e não promover o artifact a dados reais, homologação, piloto ou release.

## Validation and Acceptance

Cada ação deve adicionar teste conhecido-bom e conhecido-ruim. Nenhum status `PASS` será promovido a partir de source inspection isolada.

Gates mínimos por onda: `npm run typecheck`, testes focados, `npm run build`, static/contract/security checks, database checks quando aplicável, E2E/visual quando UI mudar e fingerprint antes/depois de critics.

Gates finais: `npm run verify:production`, PostgreSQL production-like, restore/fault matrix, benchmark, browser matrix, dependency/SBOM scan, diff check, audit ledger parse, fresh independent critiques e scorecard. Falhas permanecem registradas.

Critérios detalhados, prioridade e blockers pertencem a `.gauntlet/bar-v3.json`; este plano não reduz a barra.

## Risks and Human Decisions

R-01: bypass de PDP/Tool Gateway. Mitigação: imports disjuntos, default deny, matrix negativa, RLS e crítico fresco.

R-02: duplicação de efeito externo. Mitigação: idempotency key, effect ledger, receipt, fencing, unknown e reconciliation.

R-03: vazamento de segredo/dado clínico. Mitigação: SecretProvider, D-class, redaction, egress deny e provider gate.

R-04: restore reativa autoridade antiga. Mitigação: quarantine, session revoke, readiness blocked e replay supervisionado.

R-05: regressão de API/UI durante decomposição. Mitigação: rotas v1, testes contract/E2E, extração incremental e rollback por commit.

R-06: alegação falsa de AAA. Mitigação: barra imutável, scorecard por evidência, critics frescos e política de elegibilidade explícita.

Decisões de provider, credenciais, dados reais, retenção, residência, MFA, RTO/RPO, SLO, suporte, break-glass e risco residual exigem autoridade humana e permanecem abertas.

## Idempotence and Recovery

Todas as mudanças de schema são append-only. Todos os comandos externos usam chaves idempotentes e receipts; erro desconhecido nunca recebe retry cego. A recuperação começa por preservar o estado, consultar ledgers e quarentenar quando integridade/autoridade não puder ser provada.

O plan/recovery pointer é `.agent/state.json` → este arquivo → `.agent/backlog.json` → `.agent/execution-log.jsonl`/`.agent/verification.jsonl` → gate e bar atuais. O plano anterior continua em `.agent/plans/2026-09-08-cvg-full-implementation.md` como histórico de execução do recorte local.

## Artifacts and Evidence

- Requisitos: `docs/prompt-state-of-the-art-triplo-aaa.md` e docs 00–12.
- Auditoria: `docs/architecture-audit-vNext.md`.
- Barra: `.gauntlet/bar-v3.json`.
- Plano corrente: este arquivo.
- Estado/ledger: `.agent/state.json`, `.agent/backlog.json`, `.agent/*.jsonl`.
- Artefatos de execução: `artifacts/runs/<timestamp>/` sem serem fonte de autorização.
- Entregáveis finais: `docs/production-readiness-vNext.md`, `docs/security-review-vNext.md`, `docs/ai-runtime-vNext.md`, `docs/deployment-vNext.md`, `docs/verification-vNext.md`, `docs/state-of-the-art-scorecard.md`, `docs/adr/`, `docs/runbooks/` e README atualizado.

## Outcomes & Retrospective

O ponto de partida é uma demonstração local robusta, não uma plataforma de produção. A principal decisão é preservar esse recorte como fixture segura enquanto a arquitetura é extraída e as garantias externas são provadas. O resultado final poderá ser `AAA`, `FAIL_WITH_LIMITATIONS` ou `BLOCKED`; o plano não autoriza elevar o status por intenção.

## Current checkpoint — 2026-09-08 22:20

The current working tree passes typecheck, 56 unit/integration tests, web build, static verification (including the domain-command boundary), 15 Chromium E2E tests across three viewports, contrast/token audits, dependency/license audit, CycloneDX SBOM, synthetic benchmark, release verification and diff check. Local design audits are repository-owned and no longer depend on `/home/ricardo/`. The CI declares Dependabot and Trivy image scans, but Docker image build/scan and remote CI execution remain unrun here. PostgreSQL/provider/secret-manager production evidence, fault/recovery drills, production SLOs, expanded browser/accessibility matrix and a new final independent review remain required before any AAA decision.

## Current checkpoint — 2026-09-09 00:05

The auth boundary is now locally exercised through MFA/TOTP, password policy, lockout, recovery, rotation, session/device revocation and redacted audit paths, with additive migration `020_auth_security_boundary.sql`. The worker entrypoints share `CvgWorkerApplication`; `tests/unit/worker.test.ts` covers lifecycle/health/quarantine and `tests/integration/faults.test.ts` covers dispatch-marker crash, `OUTCOME_UNKNOWN`, no blind retry and lease loss.

Fresh local evidence: 65/65 unit/integration tests, build, static verification with 29 required artifacts and 100 source files, 22/22 executed Chromium E2E cases across 375/768/1440 (two mobile skips), contrast 7/7, token audit with zero high/critical and 72 heuristic medium findings, zero production dependency vulnerabilities, 193 approved third-party licenses, SBOM, synthetic benchmark, release/Compose structural verification and diff check. Production-mode verification fails closed because real configuration is absent. The fresh critic attempts timed out and are recorded as `NOT_RUN`; the prior negative/limited critique remains authoritative for the current local bar. Next action is `CVG-FULL-STATE-OF-THE-ART:PRODUCTION-LIKE-EVIDENCE`; the artifact remains `IN_PROGRESS`/`FAIL_WITH_LIMITATIONS` and not AAA-eligible.

## Current checkpoint — 2026-09-09 00:18

Após `EVT-CVG-20260909-CORRECTION-044`, o control plane foi revalidado e os ponteiros de state, backlog, plano e Gauntlet estão alinhados na ação `CVG-FULL-STATE-OF-THE-ART:PRODUCTION-LIKE-EVIDENCE`. A nova evidência corrente é `VER-CVG-035`; ela confirma os gates locais, mas não promove o resultado a production-like ou AAA. O próximo passo continua condicionado a ambiente, autoridade e revisão independente executáveis.

## Current checkpoint — 2026-09-09 00:22

`VER-CVG-036` registra nova execução verde de `npm run verify:all` e `git diff --check`. O pointer de recuperação não mudou: `CVG-FULL-STATE-OF-THE-ART:PRODUCTION-LIKE-EVIDENCE`. O núcleo local permanece verificável, enquanto a barra integral segue `FAIL_WITH_LIMITATIONS` até a evidência externa e a revisão independente exigidas.

## Current checkpoint — 2026-09-09 00:42

`VER-CVG-037` registra a execução do novo gate agregado: lint repository-owned, typecheck, contratos, segurança, banco/recovery, fault/worker, suíte unitária/integração, build, static (30/101), E2E Chromium, contraste, tokens, dependências, licenças, SBOM, benchmark e `git diff --check`. O Compose foi validado estruturalmente com valores sintéticos e nenhum serviço foi iniciado. A verificação `--production` falhou fechado por ausência de configuração real. O workflow agora declara gates remotos de PostgreSQL/migrations/restore, browser, visual, SBOM e containers, mas esses gates continuam `NOT_RUN` nesta máquina. O artifact segue `IN_PROGRESS`/`FAIL_WITH_LIMITATIONS`, não AAA-eligible; a próxima ação é `CVG-FULL-STATE-OF-THE-ART:PRODUCTION-LIKE-EVIDENCE`.

## Current checkpoint — 2026-09-09 00:48

`VER-CVG-038` reexecuta o gate agregado após endurecer `verify-production` para conferir também os quatro comandos dedicados do workflow (`test:contract`, `test:security`, `test:database` e `test:fault`); o resultado foi código 0. A verificação `--production` novamente saiu código 1 por configuração real ausente, e `git diff --check` passou. O resultado permanece `FAIL_WITH_LIMITATIONS`, sem promoção a AAA.

## Current checkpoint — 2026-09-09 01:12

`VER-CVG-039` registra a conclusão local da ação `CVG-FULL-STATE-OF-THE-ART:RECOVERY-MANIFEST-FAULT-COVERAGE`. O recovery bundle agora tem manifesto verificável com tenant, watermark, fingerprint de migrações, timestamp e digests dos quatro ledgers; export e restore PostgreSQL usam a mesma validação. A suíte passou com 66/66 testes, incluindo rejeição de bundle parcial, stale, migration mismatch, watermark divergente, ciphertext adulterado e chave errada. `verify:production` passou e `--production` permaneceu fail-closed; o próximo pointer é `CVG-FULL-STATE-OF-THE-ART:PRODUCTION-LIKE-EVIDENCE`, ainda com resultado `FAIL_WITH_LIMITATIONS` e sem elegibilidade AAA.

## Current checkpoint — 2026-09-09 01:17

Após a validação adicional no próprio `exportRecoveryBundle`, `VER-CVG-040` reexecutou os gates sem regressão: 66/66 testes, database 9/9, fault/worker 5/5, lint, typecheck, static 30/101, build, `verify:production` e diff check. O modo production permaneceu fail-closed por configuração real ausente. O pointer continua `CVG-FULL-STATE-OF-THE-ART:PRODUCTION-LIKE-EVIDENCE`; a barra integral segue `FAIL_WITH_LIMITATIONS`.

## Current checkpoint — 2026-09-09 01:38

`VER-CVG-041` registra a conclusão local da fatia PDP target-bound do detalhe de paciente: sessão autenticada, capability/operation registrada, `resourceId`, escopo persistido, projeção por application service e revalidação antes da serialização. A suíte passou 67/67, database 9/9, fault/worker 5/5, typecheck, lint, static 30/101, `verify:production` e diff check; `--production` permaneceu fail-closed por configuração real ausente. O pointer retorna a `CVG-FULL-STATE-OF-THE-ART:PRODUCTION-LIKE-EVIDENCE`; o uso universal do PDP, evidência production-like, provider/secret authority, recovery distribuído, SLOs e crítica independente fresca continuam pendentes, e o resultado não é AAA-eligible.

## Current checkpoint — 2026-09-09 02:07

Após `EVT-CVG-20260909-VERIFY-057`, foi aberta a ação local `CVG-FULL-STATE-OF-THE-ART:SLO-CONTRACTS-ALERTS`. O pointer de BUILD foi alinhado em state, backlog, plano, execution log e Gauntlet antes da implementação. A fatia não autoriza medição de produção, collector, carga, provider, segredo, egress ou release.

## Current checkpoint — 2026-09-09 02:14

`VER-CVG-043` registra os contratos de SLO/alerta: oito sinais tipados, targets sem aprovação como `PROPOSED`/`TBD`, error budget somente onde o modelo é derivável, amostras ausentes como `NOT_RUN`, regras ligadas a runbooks e nenhum dispatch operacional. A suíte passou 73/73, typecheck, lint (99 fontes), static (30/101), `verify:production`, verificação de ponteiros JSON/JSONL, hash/cópia do prompt e diff check; `--production` saiu 1 fail-closed por configuração real ausente. O pointer retorna à ação `CVG-FULL-STATE-OF-THE-ART:PRODUCTION-LIKE-EVIDENCE`; SLOs medidos, collector, carga, CI remoto, containers, provider, secret authority e revisão independente continuam `NOT_RUN`.
