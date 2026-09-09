# Estado da implementação local

**Data da leitura:** 2026-09-08
**Escopo:** artifact local-first em evolução vNext, dados sintéticos, loopback, memória descartável por padrão e PostgreSQL verificável somente quando uma instância explícita estiver disponível.
**Veredito atual:** `FAIL_WITH_LIMITATIONS` na barra v3; os gates locais determinísticos passam, mas não há release de produção.

Esta página é o estado corrente da implementação e complementa os registros históricos de preparação e veredito em [10](10-preparacao-m1.md) e [09](09-gauntlet-verdict.md). Os documentos históricos continuam válidos como registro do que era proposto ou ainda não executado naquele momento; esta página não transforma seus aceites documentais em aprovação operacional.

## O que existe no artifact

- BFF HTTP Fastify em `apps/api`, com envelope v1, login sintético, cookies, CSRF, escopo explícito, roles server-side, auditoria e erros correlacionáveis.
- Boundary de dados com minimização por papel: recepção/administrativo recebem apenas o cadastro mínimo do paciente; veterinário recebe os campos clínicos necessários; operador técnico não acessa diagnósticos, internação ou ordens de medicação por padrão.
- Domínio em `packages/domain`, com store isolado em memória e invariantes para pacientes, agenda/fila, encontros, documentos clínicos/addenda, diagnóstico/amostras/resultados, hospitalização, medicação/dispensação/administração, estoque por unidade, cobranças/ledger por unidade, comunicação staged e conhecimento D0–D2.
- Harness local determinístico em `packages/harness`, com registro de tools, policy, budget pré-turno, prompt injection em quarentena, approval contextual one-shot, provenance e replay.
- Interface React/Vite em `apps/web`, com estados de loading/empty/error, aviso de ambiente, caminho manual, telas operacionais, navegação por teclado, menu responsivo e capturas nativas em 375/768/1440.
- Migrations SQL em `db/migrations/001_initial.sql`–`019_runtime_scope_guards.sql`, compose local e `PostgresPersistence` formam uma fatia transacional executável: bootstrap, lock advisory, CAS de revisão, journal/snapshot com escopo organizacional, projeções normalizadas, leituras de guardians/patients/appointments, escopo contextual de paciente/tutor, ledgers independentes de auditoria/receipts, outbox com lease/fencing, usage ledger idempotente, inbox atômico com schema/assinatura verificados, efeitos externos com recibo obrigatório, reconciliação explícita, `FORCE RLS` em 54/54 tabelas de domínio, FKs cross-table com proveniência organizacional e escopo obrigatório nas projeções de IA. O JSONB ainda é a fonte agregada de reconstrução; repositories normalizados completos, PDP universal por unidade/workspace, provider real e consulta externa de reconciliação ainda não foram promovidos.

## Matriz de evidência da barra v2

| Critério | Estado | Evidência corrente | Limite declarado |
|---|---|---|---|
| IMPL-01 | EVIDENCED | `npm run typecheck`, `npm run build`, health/readiness e E2E local | somente loopback/fixture sintética |
| IMPL-02 | PARTIAL | schemas compartilhados, envelopes v1/schema 1, IDs e known-bad API | não há catálogo/upcasters nem validação runtime de todas as respostas e versões mistas |
| IMPL-03 | PARTIAL | login, cookie, CSRF, escopo exato, minimização por papel, rate limit, approval independente para alto impacto, RLS organizacional com FORCE e RLS clínico estrutural no catálogo de domínio, incluindo snapshot/journal | falta PDP ABAC de negócio, revalidação contextual completa, MFA, recuperação e sessão persistente de produção |
| IMPL-04 | PARTIAL | `PostgresPersistence` testa BEGIN/ROLLBACK, lock advisory, CAS, journal/snapshot escopados, projeções, leituras normalizadas e cadeia clínica; runtime recupera o agregado JSONB e o gate exercita crash após marcador de dispatch | PostgreSQL real foi verificado no banco sintético local, mas concorrência de negócio, PDP contextual completo e crash recovery geral ainda não foram provados |
| IMPL-05 | PARTIAL | audit/receipt são vinculados no runtime e gravados em tabelas normalizadas + ledgers append-only; outbox transacional tem claim/lease/fencing e worker bounded; inbox local é atômico com o outbox, exige assinatura HMAC verificável, efeitos exigem recibo e resultado desconhecido fica reconciliável | não há provider externo real, consulta externa real, settlement completo ou garantia de entrega além do recibo sintético |
| IMPL-06 | PARTIAL | injection em prompt e conhecimento recuperado, tool deny, approval one-shot, budget/provenance/replay, usage ledger sintético e duplo controle de alto impacto | harness é stub local; admission/credencial/egress/provider real e settlement completo não existem |
| IMPL-07 | EVIDENCED | rotas mínimas API para todos os contextos previstos no recorte local | não equivale às jornadas completas de produto ou integrações |
| IMPL-08 | PARTIAL | restore sintético PostgreSQL exporta e reinsere snapshot, outbox, usage, inbox e efeitos externos por digest em destino temporário, encapsula o bundle em AES-256-GCM com `keyRef`, rejeita adulteração, grava `RESTORE_QUARANTINED`, revoga sessões, bloqueia login/readiness e confirma origem inalterada; crash pós-marcador é reconciliado sem reenvio cego | backup gerenciado/operacional, watermark completo, fault points antes/depois de receipt, replay pós-watermark e restore de stores externos ainda não foram executados |
| IMPL-09 | PARTIAL | `/health`, `/ready` revalidando DB, `/metrics`, logs redigidos, status HTTP/dependências, outbox stats, profundidade de reconciliação e worker bounded | telemetria ainda é local; collector/alertas/SLO e worker de produção não estão conectados |
| IMPL-10 | PARTIAL | UI entra em `OFFLINE_READ_ONLY`, oculta dados, bloqueia efeitos, preserva buffer volátil e revalida `/me` no reconnect | não há cache D0–D2 autorizado, lease, purga auditada nem evento persistente `COMPOSER_CONTEXT_LOST` |
| IMPL-11 | PARTIAL | Playwright em 375/768/1440, screenshots, foco inicial, navegação, menu móvel rolável e fluxo offline | cobertura é Chromium; faltam Firefox/WebKit, DPR, touch, leitor de tela e estados completos |
| IMPL-12 | PARTIAL | plano, bar, código, testes, migrations e este estado apontam para `CVG-FULL-IMPLEMENTATION`; auditoria da rodada 3 abaixo | há gaps de produção e a crítica fresca não produziu parecer final |

## Limites que permanecem bloqueados
Não há dados reais, credenciais reais, pagamentos/mensagens/calendário externos, break-glass, exportação, deploy, homologação, piloto, decisão regulatória, retenção legal, MFA de produção ou aceite de risco residual. Os adapters de integração são deny-by-default. A UI apresenta ações manuais e mensagens de bloqueio; vários comandos de criação ainda são deliberadamente sinalizados como preparação, não como fluxo completo pronto para operação. O contrato offline tem contenção e revalidação local, mas ainda não tem cache/lease autorizado.

O runtime de memória é útil para demonstração e testes determinísticos, mas não oferece durabilidade ou recovery point. O adapter PostgreSQL implementa uma barreira transacional de snapshot/journal escopados, projeções, repositories de leitura selecionados, audit, receipt, outbox/usage, inbox assinado, efeitos externos com recibo e RLS forçado no catálogo de domínio; além do pool falso, `scripts/verify-postgres.ts` foi exercitado contra PostgreSQL 16.15 em banco sintético separado, com restart, idempotência, leituras normalizadas, worker, receipt sintético, resultado desconhecido, reconciliação, crash pós-marcador, usage, CAS e filtragem RLS por papel não-superusuário. `scripts/verify-postgres-restore.ts` exporta um bundle consistente de snapshot + outbox + usage + inbox + efeitos externos, cifra-o com AES-256-GCM, rejeita adulteração, restaura em destino temporário e confirma quarentena, ledgers preservados e origem inalterada. Isso não substitui PDP de negócio contextual, provider/consulta externa real, carga, backup gerenciado, fault points de produção ou crash recovery geral; a URL padrão em 5440 continua sem serviço neste host, e as verificações reais usaram URL de socket explicitamente fornecida.

## Crítica independente atual

A crítica read-only `CRIT-CVG-20260908-002` é histórica em relação às correções desta rodada: ela executou typecheck, 20 testes, build, verificação estática, 9 testes E2E e auditorias, classificando o adapter como inexistente. O registro completo permanece em [`.gauntlet/critique-round-2.md`](../.gauntlet/critique-round-2.md); a fatia PostgreSQL, escopo exato, offline e controles de approval foram ampliados depois. O critic worker fresco da rodada 3 excedeu os timeouts e foi encerrado sem relatório; portanto nenhum parecer independente inexistente é apresentado como evidência. A auditoria objetiva da rodada 3 está registrada abaixo.

## Como reproduzir a evidência local

```bash
npm install
npm run typecheck
npm test
npm run build
npm run verify:static
npm run audit:tokens
npm run audit:contrast
npm run test:e2e
npm audit --omit=dev
```

Para a demonstração, use `npm run dev` e o botão de dados sintéticos. A URL padrão em `127.0.0.1:5440` retornou `ECONNREFUSED`; com uma URL explícita para o banco sintético local em PostgreSQL 16.15, `npm run db:migrate`, `npm run verify:postgres` e `npm run verify:postgres:restore` passaram. O drill de restore remove apenas o banco temporário que ele mesmo cria; nenhum script do projeto remove banco existente.

## Atualização corrente da implementação — 2026-09-08

Desde a crítica round 2, foram incorporados:

- escopo `unitId`/`workspaceId` em auditoria, receipts, conhecimento, comunicações e sessões de IA, com filtros exatos e replay protegido;
- persistência normalizada de `audit_records`/`command_receipts` junto do snapshot, ledger append-only independente e detecção de journal ausente/divergente;
- quarentena durável no snapshot, propagada também para corrupção detectada no commit;
- schemas de envelope v1/schema 1, validação de snapshots legados com upcast seguro, rate limit local de login e duplo controle para tools de alto impacto;
- contenção offline fail-closed e revalidação explícita do contexto no primeiro reconnect;
- novos testes de escopo, corrupção, integração do runtime PostgreSQL falso, rate limit, aprovação independente e worker de outbox;
- leituras normalizadas transacionais de guardians/patients/appointments com joins mínimos e filtros de workspace;
- migration 004 com outbox durável, lease/fence token, bounded worker e ledger idempotente de uso;
- migration 005 com RLS de leitura da agenda por organização, unidade e workspace, mantendo mutações sob política organizacional;
- migration 006 com RLS de leitura por unidade/workspace nas projeções selecionadas e políticas de escrita organizacionais para projeção transacional;
- migration 007 com inbox idempotente e ledger de efeitos externos com admission/dispatch/outcome, lease/fence e bloqueio de retry cego;
- migration 008 com escopo derivado obrigatório em documentos clínicos e addenda, seguida da migration 010 que endurece suas políticas DML sem alterar checksum aplicado;
- migration 009 que invalida sucessos legados sem recibo verificável e exige receipt de provider para `SUCCEEDED`;
- migration 011 com `organization_id`, FK e `FORCE RLS` no snapshot/journal canônicos, além de leituras de revisão sempre escopadas em transação;
- migration 012 com versão de schema, HMAC/key reference e quarentena de inbox legado sem assinatura; o verificador sintético injeta a função de validação e não representa um secret-provider de produção;
- drill PostgreSQL de restore em banco temporário, com bundle de snapshot/outbox/usage/inbox/efeitos externos, quarentena, bloqueio de login/readiness e prova de origem inalterada;
- fault drill sintético de crash após o marcador de dispatch, com lease takeover, `OUTCOME_UNKNOWN`, reconciliação manual e nenhuma chamada posterior ao sink.

A evidência corrente executada nesta rodada é: `npm test` com 36 testes locais, `npm run typecheck`, `npm run build`, `npm run verify:static` com os novos artefatos, `npm run test:e2e` com 12/12 testes em quatro cenários e três viewports, `npm run verify:postgres` com leituras/outbox/usage/inbox/efeitos externos/crash/RLS contra banco sintético separado, `npm run verify:postgres:restore` com destino temporário em quarentena e os cinco conjuntos de recuperação preservados por digest, auditorias visual/dependência e `git diff --check`.

O veredito integral continua `FAIL`: o artifact é uma demonstração sintética com uma fatia durável localmente verificada, não um sistema corporativo autorizado para dados reais. Os gaps de PDP de negócio/contexto, provider e consulta externa reais, secret-provider, settlement completo de usage, backup operacional gerenciado, fault points de produção, cache offline autorizado, browsers adicionais, collector/alertas/SLO e aceite operacional permanecem abertos.

## Auditoria objetiva de fechamento — rodada 3 — 2026-09-08

O parecer independente fresco desta rodada não foi produzido: o worker read-only expirou em duas esperas e foi encerrado, sem alteração de arquivos e sem resultado aproveitável. Para manter a barra honesta, esta seção registra somente evidência reproduzida no workspace e conserva o `FAIL` integral.

- `npm run verify:all`: PASS — typecheck, 33/33 testes unitários/integração, build Vite, verificação estática e 12/12 testes E2E em 375/768/1440; o menu móvel rolável eliminou a regressão observada no primeiro passe.
- `npm run audit:contrast`: PASS — os cinco pares declarados passaram o limiar WCAG 4.5.
- `npm run audit:tokens -- --strict`: PASS — zero achados high/critical; 72 sinais medium permanecem heurísticos.
- `npm audit --omit=dev` e `git diff --check`: PASS — zero vulnerabilidades de produção e diff sem erro de whitespace.
- `npm run db:migrate` no banco sintético aplicou `001_initial`, `002_normalized_projection_support` e `003_organization_rls`; catálogo PostgreSQL confirmou `relrowsecurity=true` e `relforcerowsecurity=true` em organizações, pacientes e os ledgers.
- `npm run verify:postgres`: PASS — PostgreSQL 16.15, restart/read, idempotência, CAS concorrente e RLS organizacional (`rls: PASS`) passaram; contagem observada no último passe: 61 snapshots, 61 eventos de journal, 57 auditorias/ledgers e 3 receipts/ledgers. O banco é sintético e separado.

Mesmo com essa fatia, IMPL-02/03/04/05/06/08/09/10/11/12 seguem `PARTIAL` por ausência de catálogo/upcasters completo, PDP e leitura normalizada completos, efeitos externos com claim/lease/fencing, provider/usage ledger, backup/restore e crash drills, cache offline autorizado, browsers adicionais e SLO. A barra integral permanece `FAIL`.

## Continuação verificável após o fechamento da rodada 3 — 2026-09-08

O trabalho continuou sem alterar a barra congelada e sem promover o recorte a produção. Foram implementados e exercitados:

- repositories de leitura PostgreSQL para `guardians`, `patients` e `appointments`, cada leitura em transação `READ ONLY`, com `cvg.organization_id` transacional, joins mínimos e filtro de `unitId`/`workspaceId` na agenda;
- migration `004_outbox_usage_lease.sql`, com outbox idempotente na mesma transação do snapshot/journal, `CLAIMED`, lease, `fence_token`, retry limitado, `QUARANTINED` e `ai_usage_ledger` com chave lógica idempotente;
- migration `005_appointment_scope_rls.sql`, com políticas RLS de leitura da agenda condicionadas a unidade/workspace;
- migration `006_scoped_projection_rls.sql`, com RLS de leitura para atendimento, conhecimento, comunicação, IA, auditoria, atribuições e projeções unitárias, exercitado por papel sem `BYPASSRLS`;
- `OutboxWorker` em `packages/integrations`, que entrega apenas registros reivindicados pela porta de persistência, confirma pelo fence token e converte retries esgotados em quarentena;
- `scripts/verify-postgres-restore.ts`, que cria um banco temporário identificado, aplica todas as migrations, restaura snapshot + outbox + usage em quarentena, confirma bloqueio de login/readiness, verifica os ledgers e a origem e remove somente o destino criado pelo próprio drill.

Evidência nova: `npm run typecheck` e `npm test` com 35/35 testes passaram; `DATABASE_URL=<socket sintético> npm run db:migrate` aplicou as migrations 004, 005 e 006; `DATABASE_URL=<socket sintético> CVG_BOOTSTRAP_PASSWORD=<fixture> npm run verify:postgres` passou `normalizedReads`, `outbox`, `usageLedger`, `cas` e RLS organizacional + unidade/workspace; e `npm run verify:postgres:restore` passou com destino temporário `QUARANTINED`, 18 registros de outbox e 1 de usage recuperados por digest, login/readiness bloqueados e `sourceUnchanged=true`. As contagens são acumuladas do banco sintético, não uma meta de produção.

Essas correções reduzem os gaps de leitura, durabilidade de mensagens internas e recuperação sintética, mas não fecham a barra integral: a autorização por unidade/workspace ainda depende do PDP HTTP e filtros de aplicação, o worker ainda não possui provider/efeito externo real nem inbox/reconciliação, e continuam ausentes backup criptografado, fault injection de produção, cache offline autorizado, browsers além de Chromium, SLO/alertas e aprovação operacional independente. O veredito segue `FAIL` integral / `PASS WITH LIMITATIONS` local.

## 17. Atualização de segurança e recovery — 2026-09-08

Após o checkpoint histórico, foram aplicadas as migrations `007_external_effect_reconciliation.sql`, `008_clinical_scope_rls.sql`, `009_external_effect_receipts.sql`, `010_clinical_scope_dml_rls.sql`, `011_canonical_state_scope_rls.sql` e `012_inbox_signature_schema.sql`. A migration 008 não foi reescrita depois de aplicada: suas políticas DML originais foram preservadas e o endurecimento foi emitido em 010, mantendo o checksum auditável.

O caminho PostgreSQL agora escopa snapshot e journal por organização com `FORCE RLS`; deriva e exige unidade/workspace em documentos clínicos e addenda; exige recibo estruturado e `providerRequestId` antes de `SUCCEEDED`; transforma marcador de dispatch perdido em `OUTCOME_UNKNOWN`; impede retry cego; e aceita inbox somente com schema v1, HMAC/key reference e um verificador explicitamente configurado. Registros inbox legados sem assinatura foram colocados em quarentena durante a migração. A assinatura usada no gate é sintética e injetada pelo teste; ela não é uma credencial, secret-provider ou integração externa de produção.

Evidência executada após essas mudanças: `npm run typecheck` passou; `npm test` passou com 36/36; `npm run db:migrate` não encontrou drift; `verify:postgres` passou `postgres`, restart/read, leituras normalizadas, idempotência, outbox, efeitos externos com receipt, inbox assinado/atômico, reconciliação, crash pós-marcador, usage, CAS e RLS; contagem observada no último passe: 302 snapshots, 302 journals, 217 audits/ledgers, 3 receipts/ledgers, 65 outbox, 8 inbox e 23 efeitos externos; `verify:postgres:restore` passou com sourceRevision 303, targetRevision 1, targetStatus `QUARANTINED`, 65 outbox, 1 usage, 8 inbox, 23 efeitos externos, login/readiness bloqueados e `sourceUnchanged=true`.

A execução é sintética e serializada: o restore não deve rodar em paralelo com o verificador mutável, pois a comparação de imutabilidade da origem exige um watermark estável. A barra integral continua `FAIL`; permanecem obrigatórios PDP/RLS em todo o domínio, provider/consulta externa reais, backup criptografado, RTO/RPO/SLO, stores object/vector/session, browsers adicionais, fault points de produção e aceite humano independente.

## 18. Revalidação final do checkpoint — 2026-09-08 17:58

Os gates finais locais passaram: `npm run verify:all` concluiu typecheck, 36/36 testes, build Vite, verificação estática com 38 arquivos-fonte e 12/12 E2E nos viewports mobile 375, tablet 768 e wide 1440; contraste passou nos cinco pares; tokens strict não encontrou high/critical (72 sinais medium heurísticos); `npm audit --omit=dev`, `git diff --check` e `db:check` passaram, com PostgreSQL 16.15 por socket explícito.

Uma tentativa inicial do verificador PostgreSQL usou uma senha de fixture diferente da credencial já inicializada e recebeu `401` antes de qualquer mutação. A repetição com a senha sintética determinística do script passou integralmente; esse erro de invocação não é tratado como falha do produto. A execução mutável foi concluída antes do restore: 302 snapshots/journals, 217 audits/ledgers, 65 outbox, 8 inbox e 23 efeitos externos; o restore serial recuperou os cinco conjuntos por digest, atingiu `sourceRevision=303`, manteve `targetRevision=1`, `QUARANTINED`, bloqueou login/readiness e confirmou `sourceUnchanged=true`.

Este checkpoint continua sendo evidência do builder, não aprovação independente. O veredito integral permanece `FAIL` até existirem PDP/RLS completo, provider e consulta externa reais, secret-provider, backup criptografado, fault points e RTO/RPO/SLO aprovados, stores externos, cobertura de browsers/acessibilidade e aceite humano.

## 19. Isolamento completo do catálogo e restore criptografado — 2026-09-08 18:35

A migration `013_complete_domain_rls.sql` fechou as tabelas dependentes e legadas que ainda não tinham escopo direto (`ai_turns`, `ai_drafts`, lifecycle e `inbox_records`), derivando unidade/workspace de sessões quando aplicável e recusando legado sem organização. A migration `014_cross_organization_foreign_keys.sql` adicionou FKs compostas organização+id aos vínculos entre entidades, impedindo referências cross-tenant com UUIDs válidos.

O verificador PostgreSQL final passou com migrations `001`–`014`, `rlsDomainTables=54`, `rlsProtectedTables=54` e `organizationForeignKeys=90`. A contagem acumulada do banco sintético no último passe foi: 435 snapshots/journals, 289 audits/ledgers, 3 receipts/ledgers, 5 guardians, 127 outbox, 1 usage, 25 inbox e 50 efeitos externos. O restore serial passou depois do verificador com `sourceRevision=436`, destino temporário em `targetRevision=1`, cinco ledgers recuperados, `encryptedBackup=true`, `backupAlgorithm=AES-256-GCM`, `tamperRejected=true`, `targetStatus=QUARANTINED`, login/readiness bloqueados e `sourceUnchanged=true`. O destino temporário e o papel efêmero foram removidos; a consulta de resíduos encontrou ambos vazios.

O passe local corrente também passou `npm run verify:all`: 40/40 testes unitários/integração, typecheck, build, static com 40 arquivos-fonte e 12/12 E2E em 375/768/1440. `audit:contrast`, tokens strict (zero high/critical e 72 sinais medium heurísticos), `npm audit --omit=dev`, `git diff --check` e `db:check` passaram. O envelope criptográfico usa chave externa de 32 bytes referenciada por `keyRef`; a fixture não transforma essa chave em segredo de produção.

Este avanço reduz os gaps de isolamento e de proteção do artefato de recuperação, mas não muda o veredito integral: providers/consulta externa e secret-provider reais, PDP com autorização de negócio completa, backup operacional gerenciado, replay de lifecycle pós-watermark, stores externos, fault points de produção, workload, RTO/RPO/SLO, browsers adicionais e aceite humano independente continuam abertos. Estado: `IN_PROGRESS` / `PASS WITH LIMITATIONS` para a fatia sintética; sem dados reais, homologação, piloto ou produção.

## 20. Revalidação de implementação e interface — 2026-09-08 19:46

O passe final do artifact incorporou `015_patient_guardian_scope.sql`, `016_repair_patient_guardian_scope.sql`, `017_patient_relationship_scope_rls.sql` e `018_require_patient_context.sql`. Pacientes e tutores agora têm escopo persistido, reparo determinístico de legado com evidência de relacionamento e leitura alinhada entre domínio, repositories normalizados e RLS; relações válidas por agenda, encontro ou comunicação continuam sendo avaliadas no contexto da requisição, e ausência de unidade não abre leitura organizacional. A policy de aplicação usa matriz de capabilities fechada, rejeita widening de papéis/contexto e limita concessão administrativa a `recepcao`/`veterinario`, sem autopromoção ou revogação do próprio administrador. Lotes vencidos também são rejeitados em dispensação/transferência.

Na superfície operacional, `/health` distingue o processo vivo de capabilities sintéticas, `/metrics` gera trilha de leitura e o seam de secret-provider falha fechado sem credencial pronta. A UI faz bootstrap atômico de identidade/contexto, exibe loading/error/empty, materializa concessão/revogação e auditoria, fecha o menu móvel com `inert`/foco restaurado, mantém agenda utilizável em viewport estreito e prende o foco do diálogo administrativo. O aviso local continua explícito: sem provider/egress real e sem dados reais.

Evidência reproduzida após essas mudanças:

- `npm run typecheck`: **PASS**; `npm test`: **43/43 PASS**; `npm run build`: **PASS**;
- `npm run verify:static`: **PASS** — 9 artefatos obrigatórios e 45 arquivos-fonte;
- `npm run audit:contrast`: **PASS** — cinco pares, todos acima de 4.5:1;
- `npm run test:e2e`: **15/15 PASS** em Chromium, projetos 375/768/1440, incluindo administração, auditoria, offline, estados de erro e screenshots;
- `verify:postgres`: **PASS** — migrations `001`–`018`, `rlsDomainTables=54`, `rlsProtectedTables=54`, `organizationForeignKeys=94`; acumulado observado: 506 snapshots/journals, 332 audits/ledgers, 5 receipts/ledgers, 7 guardians, 155 outbox, 1 usage, 33 inbox e 62 efeitos externos; o caso sem unidade retornou zero pacientes/tutores;
- `verify:postgres:restore`: **PASS** — `sourceRevision=507`, `targetRevision=1`, `encryptedBackup=true`, `backupAlgorithm=AES-256-GCM`, `tamperRejected=true`, `targetStatus=QUARANTINED`, 155 outbox/1 usage/33 inbox/62 efeitos recuperados, login/readiness bloqueados e `sourceUnchanged=true`;
- `git diff --check`: **PASS**.

Este é um resultado local sintético, não uma certificação independente nem aprovação operacional. A barra integral permanece **`FAIL`**: faltam provider/consulta externa e secret-provider reais, PDP de negócio completo em produção, backup gerenciado, stores externos, replay pós-watermark, fault injection, workload, RTO/RPO/SLO, browsers além de Chromium, acessibilidade profunda e aceite humano. O estado permanece `IN_PROGRESS` / `PASS WITH LIMITATIONS`; nenhum dado real, homologação, piloto ou release é autorizado por esta revalidação.

## 21. Crítica independente fresca — round 4 — 2026-09-08 20:00

O critic `Galileo` (`01a0833c-36b2-7f70-92cc-bf05a0fa62d7`) produziu um parecer somente leitura em contexto fresco, registrado em [`.gauntlet/critique-round-4.md`](../.gauntlet/critique-round-4.md). Sua matriz marcou IMPL-01–IMPL-10 e IMPL-12 como `PARTIAL`, IMPL-11 como `NOT_RUN` na inspeção e AAA como **não elegível**. O parecer confirma que o recorte local não deve ser confundido com produção.

O único achado técnico novo diretamente corrigível — leitura de pacientes/tutores sem unidade nas policies RLS — foi fechado pela migration aditiva `018_require_patient_context.sql`, pelo PDP em memória e por uma asserção negativa no verificador. A reexecução passou `verify:postgres` com migrations `001`–`018`, 54/54 tabelas sob `FORCE RLS`, 94 FKs organizacionais e zero visibilidade sem unidade. Continuam abertos PDP/ABAC completo, provider/secret-provider e consulta externa reais, backup gerenciado, replay pós-watermark, stores externos, fault/workload, RTO/RPO/SLO, browsers adicionais, acessibilidade profunda e aceite humano.

O resultado consolidado da rodada é `FAIL_WITH_LIMITATIONS`: evidência local sintética suficiente para continuar desenvolvimento, insuficiente para `VERIFIED`, `RELEASE_READY`, dados reais, homologação, piloto ou produção.

## 22. Fechamento da fotografia vNext — 2026-09-08 22:53

Depois da crítica independente, a fundação vNext foi integrada ao artifact corrente: runtime/policy/tools tipados, bridge DeepSeek fail-closed, catálogo de rotas v1, application services, read repositories e `DomainCommandService`, PDP de aplicação no request boundary, worker isolado em quarentena, máquina de estados web, Compose/Dockerfiles, telemetria OTel redigida, runbooks, barra v3, scorecard e verificador de release. O prompt preservado em `docs/prompt-state-of-the-art-triplo-aaa.md` continua byte-a-byte idêntico à fonte anexada.

Evidência local mais recente:

- `npm run typecheck`: **PASS**;
- `npm test`: **56/56 PASS**;
- `npm run build`: **PASS**;
- `npm run verify:static`: **PASS** — 23 artefatos e 97 arquivos-fonte; inclui bloqueio estático de mutações de domínio diretamente no HTTP layer;
- `npm run test:e2e`: **15/15 PASS** em Chromium, projetos mobile 375, tablet 768 e desktop 1440;
- `npm run audit:contrast`: **PASS**; `npm run audit:tokens -- --strict`: **PASS**, zero high/critical e 72 sinais médios heurísticos;
- `npm audit --omit=dev`, `npm run audit:licenses` (193 dependências de terceiros), SBOM CycloneDX e `git diff --check`: **PASS**;
- `npm run benchmark:local`: **PASS limitado**, com amostras brutas da fixture local e sem SLO;
- `node --import tsx scripts/verify-production.ts`: **PASS limitado**, artifacts e Compose estrutural validados, nenhum serviço iniciado.

Os comandos de design foram internalizados em `scripts/check-contrast.ts` e `scripts/audit-design-tokens.ts`, eliminando a dependência de `/home/ricardo/` para build e verificação. O workflow adiciona Dependabot, política de licenças e scan Trivy de imagens; o scan de imagens não foi executado neste host porque o daemon Docker não está disponível.

O veredito permanece **`FAIL_WITH_LIMITATIONS`** e a tarefa continua `IN_PROGRESS`/`PARTIAL`. Ainda não há evidência de PostgreSQL/Docker production-like nesta fotografia, MFA/secret manager real, processo DeepSeek real, provider/receipt/reconciliation externos, sink habilitado, fault/recovery distribuído, carga e SLO/RTO/RPO medidos, browsers Firefox/WebKit, axe/leitor de tela ou aceite humano independente. Nenhum dado real, segredo, egress, break-glass, deploy, piloto ou produção foi acionado; Triplo AAA continua inelegível pela barra congelada.
