# Estado da implementação local

> **Regra temporal:** este arquivo é um log cronológico. Expressões como “atual” ou “corrente” valem somente para o checkpoint datado em que aparecem. O checkpoint AUD27 de 21/09 é histórico; consulte a última entrada ao fim do arquivo para a revalidação mais recente.

## Continuação AAA2-02/E01 — nova auditoria em 13/09/2026

A [auditoria da continuação](auditoria-continuacao-aaa2-02-2026-09-13.md) confirmou a correção de medicação no recorte local com probe HTTP independente. E01 permanece aprovado localmente com ressalva de PostgreSQL multiprocesso; AUD13-16 permanece incompleto e AUD13-17 parcial. Nesta rodada npm test teve 386 pass/1 skip; build, lint e static passaram. A falha static da auditoria anterior é histórica.

Os 327 registros de verificação e 392 eventos existem, mas não representam contagem de melhorias. State/backlog/marker/tail concordam; o primeiro Concrete Step não coincide com a ação ativa. Pai16 espera filho16A, que depende do pai; corrigir a dependência sem fechar o pai por inferência. D-02 não bloqueia as correções independentes de budget, autoridade e prontuário.

A [rodada AAA3](rodada-aaa3-2026-09-13/README.md) prioriza 12 contratos e preserva todos os 33 AAA2. Este adendo é documental: código e estado ativo não foram alterados. Veredito global permanece AAA_NOT_PROVEN; nenhuma prova externa ou decisão clínica foi inventada.


## Registro anterior — auditoria da entrega, 13/09/2026

**Veredito:** FAIL para Triplo AAA / AAA_NOT_PROVEN, segundo a barra v4. A [auditoria atual](auditoria-entrega-2026-09-13.md) registra 18 achados e distingue avanços locais de aceites ainda não comprovados. Foram executados npm test (384 pass, 1 skip), build/lint (PASS), Chromium desktop/mobile (76 pass, 4 skip) e static (FAIL por snapshot de outro SHA).

Prontuário/adendos, prescrição/dispensação e budget/autoridade ACP contêm defeitos reproduzidos. 24 coleções permanecem snapshotPrimary. CI/staging/provedores/assistividade/recuperação reais não foram executados nesta auditoria. AUD13-15 e AUD13-21 têm aceites contraditos; a reconciliação executiva pertence a AAA2-01.

O [novo programa](plano-triplo-aaa-pos-entrega-2026-09-13/README.md) contém 33 tarefas com ponte para todo o catálogo anterior. Esta atualização é documental; não modifica o backlog ativo nem declara melhorias implementadas. Os registros abaixo permanecem históricos e não substituem a avaliação atual.

## Registro histórico iniciado em 08/09/2026

**Data da leitura histórica:** 2026-09-08
**Escopo:** artifact local-first em evolução vNext, dados sintéticos, loopback, memória descartável por padrão e PostgreSQL verificável somente quando uma instância explícita estiver disponível.
**Veredito histórico desta seção:** `FAIL_WITH_LIMITATIONS` na barra v3; os gates locais determinísticos passam, mas não há release de produção.

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
| IMPL-02 | PARTIAL | schemas compartilhados, envelopes v1/schema 1, catálogo v1, compatibilidade v2 preparada e registro de upcasters fail-closed com testes de versões mistas | não há migração v1→v2 aprovada nem validação runtime uniforme de todas as respostas |
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

Mesmo com essa fatia, IMPL-02/03/04/05/06/08/09/10/11/12 seguem `PARTIAL` por ausência de migração de contrato v1→v2 aprovada, validação uniforme de respostas, PDP e leitura normalizada completos, efeitos externos com claim/lease/fencing, provider/usage ledger, backup/restore e crash drills, cache offline autorizado, browsers adicionais e SLO. A barra integral permanece `FAIL`.

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

## 23. Boundary de autenticação, worker e fault harness — 2026-09-09 00:05

A implementação corrente adicionou a boundary de segurança de autenticação em `@cvg/auth`, a migration aditiva `020_auth_security_boundary.sql` e os fluxos de MFA/TOTP, política de senha, lockout durável, recuperação por código de uso único, rotação de credencial, revogação/listagem de sessões e metadados redigidos de dispositivo. Os testes de API cobrem conhecido-bom e conhecido-ruim; nenhum segredo bruto é persistido ou impresso. A evidência é local/sintética: secret-provider/KMS, canal de recuperação, TLS público e sessão/rate limit distribuídos continuam não executados.

O entrypoint de `apps/worker` e `docker/worker.ts` agora compartilha `CvgWorkerApplication` e a variável canônica `CVG_WORKER_ORGANIZATION_ID`; a sink padrão permanece em quarentena. `tests/unit/worker.test.ts` cobre health, indisponibilidade da persistência, ausência de sink, quarentena e encerramento. `tests/integration/faults.test.ts` cobre crash após marcador de dispatch, transição para `OUTCOME_UNKNOWN`, ausência de retry cego e perda de lease com falha explícita. Isso melhora a evidência local de `V3-WORKER-001`/`V3-FAULT-001`, mas não substitui container smoke, Docker daemon, provider real, reconnect distribuído ou backup gerenciado.

Passe final reproduzido nesta fotografia:

- `npm run verify:all`: **PASS** — typecheck, build, static com 29 artefatos e 100 fontes, 65/65 testes unitários/integração e E2E Chromium com 22/22 executados em 375/768/1440; dois testes móveis foram pulados por serem inaplicáveis;
- `npm run audit:contrast`: **PASS 7/7**; `npm run audit:tokens -- --strict`: **PASS**, zero high/critical e 72 sinais médios heurísticos;
- `npm audit --omit=dev`: **PASS**, zero vulnerabilidades; `npm run audit:licenses`: **PASS**, 193 dependências; SBOM CycloneDX e `git diff --check`: **PASS**;
- `npm run benchmark:local`: **PASS limitado**, somente fixture local sintética, com login/PostgreSQL/outbox/recovery/provider externo explicitamente `notRun`;
- `npm run verify:production`: **PASS estrutural limitado**, Compose validado com valores sintéticos sem iniciar serviço; `node --import tsx scripts/verify-production.ts --production`: **FAIL-CLOSED esperado** pela ausência de configuração de produção real.

A tentativa do crítico amplo fresco `Zeno` e três janelas de espera não produziram relatório; o worker foi encerrado sem editar o workspace e isso foi mantido como `NOT_RUN`. As três críticas estreitas frescas de auth, frontend e worker também expiraram sem relatório em duas janelas; foram encerradas sem escrita e permanecem `NOT_RUN`, não aprovação. O veredito integral permanece **`FAIL_WITH_LIMITATIONS`**, o estado `IN_PROGRESS`/`PARTIAL` e Triplo AAA inelegível. Permanecem abertos provider/secret authority/TLS, PDP/ABAC completo de produção, browsers Firefox/WebKit e axe/leitor de tela, Docker/container smoke, CI remoto, fault/recovery distribuído, backup gerenciado, carga/SLO/RTO/RPO, vertical externa e aceite humano.

## 24. Revalidação do control plane após correção — 2026-09-09 00:18

Após a correção append-only do evento `EVT-CVG-20260909-CORRECTION-044`, os ponteiros `active_action_id` de `state.json`, backlog, plano e Gauntlet foram revalidados como `CVG-FULL-STATE-OF-THE-ART:PRODUCTION-LIKE-EVIDENCE`. A linha `VER-CVG-035` é a nova evidência corrente; `VER-CVG-034` permanece preservada como histórico e não foi reescrita.

O gate local continuou passando: 65/65 testes unitários/integração, 29 artefatos estáticos e 100 fontes, 22/22 E2E Chromium executados, contraste 7/7, auditorias de tokens/dependências/licenças, SBOM, benchmark sintético, verificação estrutural de release/Compose, diff check e hash do prompt. A verificação de produção permaneceu fail-closed pela ausência de configuração real.

Esta revalidação confirma integridade do control plane e do recorte local; não cria evidência production-like. O estado segue `IN_PROGRESS`/`PARTIAL`, o veredito `FAIL_WITH_LIMITATIONS` e o Triplo AAA inelegível até haver autoridade e execução para provider/secret manager, PostgreSQL/Docker alvo, fault/recovery distribuído, carga/SLO/RTO/RPO, matriz de browsers/acessibilidade e revisão independente.

## 25. Reexecução da suíte núcleo — 2026-09-09 00:22

Após a reconciliação, `npm run verify:all` passou novamente com typecheck, build, static verification (29 artefatos obrigatórios e 100 fontes), 65/65 testes unitários/integração e 22/22 E2E Chromium executados em 375/768/1440; dois testes móveis foram pulados por serem inaplicáveis. `git diff --check` também passou. A evidência foi registrada em `VER-CVG-036`.

O resultado permanece restrito ao núcleo local. Não há promoção a production-like, release ou AAA; os gaps externos e a revisão independente continuam controlando o próximo gate.

## 26. Contratos de SLO e alertas — 2026-09-09 02:14

A implementação de `@cvg/ops` agora mantém oito sinais SLO tipados: disponibilidade, p95, login, busca de paciente, atraso de outbox, confirmação de mensagem, RTO e RPO. Os targets que possuem somente hipótese documental permanecem `PROPOSED`/`TBD`; os targets numéricos também não são uma medição de produção. O error budget só é derivado para o modelo de disponibilidade, evitando inferir budget de uma única métrica de latência ou de um restore sem exercício.

As regras de alerta são puras, versionáveis e ligadas a runbooks. `evaluateSlo` e `evaluateSloAlerts` mantêm `NOT_RUN` para target ausente, amostra vazia, evidência não medida ou avaliação indisponível. Portanto o novo harness permite known-good/known-bad e verificação fail-closed, mas não envia alertas, consulta collector, executa carga, mede SLO/RTO/RPO ou autoriza release.

Evidência `VER-CVG-043`: 73/73 testes, typecheck, lint, static, `verify:production`, hash/cópia do prompt, validação de ponteiros JSON/JSONL e diff check passaram; o modo production falhou fechado pela configuração real ausente. O estado integral continua **`FAIL_WITH_LIMITATIONS`** / `IN_PROGRESS`; permanecem `NOT_RUN` o baseline production-like, collector, carga, CI remoto, Docker runtime, provider/secret authority, recovery distribuído, browsers adicionais e revisão independente fresca.
## 27. Fechamento da implementação local — 2026-09-09

O prompt preservado foi implementado no recorte local e sua cópia em `docs/prompt-state-of-the-art-triplo-aaa-2026-09-09.txt` permanece byte-idêntica, SHA-256 `e6f6cb4b81f333433d7a5e7b497b602d4c266b107fb772925aaf9d0369ebdd79`. A entrega adiciona Tool Gateway com sessão/alvo/escopo e ledger durável, migrations 021–025, provider HTTP fail-closed com reconciliação, rate limit distribuído, callback HMAC sobre corpo bruto, UI sem dados temporais falsos, CSP endurecida, actions CI pinadas por SHA, limites de recursos no Compose e gates `verify:triplo-aaa`/`verify:staging`.

Na reexecução final, typecheck, lint (106 fontes), build, static (35 artefatos/108 fontes), `npm test` (82/82), `verify:production`, E2E Chromium (22 pass, 2 skips), contraste (7/7), tokens (0 high/critical; 72 medium heurísticos), licenças (193), auditoria de dependências, SBOM, benchmark sintético e diff check passaram. `verify:triplo-aaa` retornou `AAA_NOT_PROVEN`/exit 2 e `verify:staging` retornou `STAGING_EVIDENCE_INCOMPLETE`/exit 2, como exigido pelo fail-closed.

Não foram executados PostgreSQL/Docker production-like, CI remoto, imagens/scan, DeepSeek/provedor real, secret authority, egress/callback, observabilidade/SLO medido, carga, recovery distribuído, Firefox/WebKit/axe/leitor de tela ou aceite humano. Os críticos frescos Bacon e Hubble mantiveram `FAIL_WITH_LIMITATIONS`. O estado final desta fotografia é `IN_PROGRESS`/`PARTIAL`; nenhum dado real, segredo, break-glass, deploy, piloto, release ou declaração AAA é autorizado.

## 28. Leitura normalizada de auditoria — 2026-09-10

No commit `135ae56`, o endpoint `GET /api/v1/audit` passou a usar `AuditRepository` na camada de aplicação. O adapter PostgreSQL consulta `audit_records` em uma transação `READ ONLY`, aplica a organização e o escopo contextual de unidade/workspace, conserva o cursor da API e valida metadata escalar, resultado e versão da cadeia antes de expor a linha. O caminho de memória permanece como fallback explícito para desenvolvimento e testes.

Os testes de persistência cobrem a linha conhecida-bom, metadata malformada, rollback por corrupção e a rota HTTP com o adapter PostgreSQL falso. A verificação corrente passou `npm test` com 121 testes (120 pass, 1 skip), `npm run test:database` com 15/15, typecheck, lint, build, static, PDP, `verify:production` estrutural e diff check. A Fase 8 continua parcial: Encounter, Clinical, Diagnostic, Hospitalization, Medication, Stock, Finance e Communication ainda não possuem repositories operacionais equivalentes, e não há prova PostgreSQL concorrente ou production-like.

## 29. Repositories clínicos normalizados — 2026-09-10

No commit `6b3df2f`, as rotas `GET /api/v1/encounters` e `GET /api/v1/clinical/documents` passaram a usar `ReadApplicationService` com repositories de memória/PostgreSQL separados. `PostgresPersistence.listEncounters` e `listClinicalDocuments` usam transações `READ ONLY`, contexto de organização/unidade/workspace, filtros explícitos e validação fail-closed de IDs, enums, timestamps, versão e projeções relacionadas; a rota clínica remove `content` da resposta.

Os testes cobrem linhas válidas, status durável clínico não suportado com rollback e as duas rotas com pool PostgreSQL-fake. A verificação passou `npm test` 122 (121 pass, 1 skip), `test:database` 16/16, typecheck, lint, build, static, PDP, `verify:production` estrutural e diff check. A Fase 8 ainda é parcial para diagnostics, hospitalization, medication, stock, finance, communication e jobs; PostgreSQL concorrente, staging e crítica independente aprovadora continuam sem evidência.

## 30. Repositories de leitura operacionais — 2026-09-10

No commit `bf0cc506ff2fbbb99c77d334cfa60ba5921ffb22`, diagnostics, hospitalization, medication, stock, finance, communication, knowledge, queue e AI sessions passaram a usar repositories tipados via `ReadApplicationService`. Os adapters PostgreSQL consultam tabelas duráveis em transações `READ ONLY`, aplicam organização/unidade/workspace, derivam escopos por encounter/charge/payment/appointment quando necessário, validam joins e rejeitam corrupção de IDs, enums, timestamps, inteiros, conteúdo e proveniência com rollback. As rotas e o resumo operacional deixam de ler diretamente essas coleções no snapshot.

A regressão local passou `npm test` com 126 testes (125 pass, 1 skip), `test:database` 20/20, typecheck, lint, build, static, PDP, `verify:production` estrutural e diff check. A evidência é local/sintética e não prova PostgreSQL concorrente, jobs, staging, provider/DeepSeek, observabilidade operacional, carga/recuperação, browsers assistivos, CI do novo SHA ou aceite humano; a Fase 8 e o veredito global permanecem parciais (`FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`).

## 31. Jobs duráveis e heartbeats — 2026-09-10

Nos commits `c3c18de9282159fa25022d7f8ce591889b73445d` e `1f066327b6d992a233e5bffae921af8377054899`, a migration 031 adiciona `cvg_worker_jobs` e `cvg_worker_heartbeats`, ambas com `FORCE RLS`, política tenant-scoped e privilégios mínimos. A admission de job compara uma chave de idempotência por organização/lane com o digest imutável da carga; o claim usa `SKIP LOCKED`, lease e fence token monotônico, com o `RETURNING` do `UPDATE ... FROM` qualificado pelo alias da linha atualizada; completion/failure exigem a identidade do worker e o fence vigente. Tentativas excedidas são quarentenadas, e `workerJobStats` expõe depth, idade e poison messages.

`CvgWorkerApplication` persiste heartbeat no início e no fim da cycle, rejeita liveness com `last_seen_at`/`started_at` obsoletos, mede pressão antes de reclamar cada lane e executa somente handlers explícitos. O bundle de recovery agora leva `workerJobs` e seu digest; heartbeats não são reativados como autoridade histórica. Os testes locais cobrem replay/divergência de digest, fencing, quarantine, heartbeat stale, corrupção de linha, recovery cifrado e backpressure.

Evidência desta wave: `npm test` 135 (`134 pass`, `1 skip`), `test:database` 25/25, typecheck, lint (122 fontes), build, static (48 artefatos/124 fontes), PDP, produção estrutural e diff check passaram. A prova nova usa fake pools e handlers sintéticos; não demonstra PostgreSQL concorrente real, worker/container production-like, dead-letter operacional, handlers de negócio, SLO de backlog, CI do SHA corrente ou aceite humano. A crítica fresh read-only contra o SHA corrente foi encerrada como `NOT_COMPLETED`, registrada em [`.gauntlet/critique-worker-jobs-current-attempt-20260910.md`](../.gauntlet/critique-worker-jobs-current-attempt-20260910.md), sem inferir aprovação. O estado integral permanece `IN_PROGRESS`/`PARTIAL`, com `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.

## 32. Drill de restore com ledger de jobs — 2026-09-10

No commit `c6048e4eb2b3714d4eb4ffc9603727b0cd2fe586`, o verificador `scripts/verify-postgres-restore.ts` deixou de apenas transportar `workerJobs` no bundle: ele os reaplica no destino quarentenado via `recoveredWorkerJobs`, compara os digests restaurados com a origem e verifica que a origem permanece inalterada. A rodada criptografada também compara a cardinalidade do ledger e registra `recoveredWorkerJobs` no payload do evento.

Typecheck, suíte completa (`135`, `134 pass`, `1 skip`), `test:database` 25/25, worker 12/12, lint, build, static, PDP, produção estrutural e diff check passaram. A execução PostgreSQL do drill não foi possível nesta fotografia por ausência de `DATABASE_URL` e daemon Docker; a mudança é uma preparação verificável, não evidência de RTO/RPO ou restore production-like. A crítica fresh correspondente foi encerrada como `NOT_COMPLETED` e registrada em [`.gauntlet/critique-restore-worker-ledger-attempt-20260910.md`](../.gauntlet/critique-restore-worker-ledger-attempt-20260910.md), sem aprovação. O estado permanece `IN_PROGRESS`/`PARTIAL`, `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.
## 33. Contrato de entrypoints e gates do worker — 2026-09-10

O commit `fe02a54f363952fc2d9da3956013c63a516265af` corrigiu o wiring do limite de backpressure: os entrypoints de processo e Docker passaram `maxOutstandingJobs` junto de `maxOutstandingOutbox`, ambos derivados de `CVG_WORKER_MAX_OUTSTANDING`. A crítica fresh encontrou um gap baixo — ausência de teste da composição e cobertura de `docker/worker.ts` no typecheck/lint — e não foi tratada como aprovação.

Nos commits `7971d27f039ae93530bf8eac93f573bbd2b77d9a` e `3b57fd5b7104e89bf8a0c5cb224b8e5dc611b147`, `createWorkerDependencies` virou a composição única, o teste unitário valida os dois limites, `docker/**/*.ts` entrou no `tsconfig`, `docker` entrou no lint e o narrowing nullable do entrypoint Docker foi corrigido. No commit `39024ca03af5a78ad1edabaf9e5be6654a98327d`, os verificadores passaram a exigir o call real compartilhado, não apenas símbolos soltos.

No SHA final, `npm test` passou 136 (`135 pass`, `1 skip`), `test:database` 25/25, worker 13/13, typecheck, lint (124 fontes), build, static (50 artefatos/126 fontes), PDP, `verify:production` estrutural e diff check passaram. A crítica fresh `Sartre` concluiu `REVIEW_ONLY_PASS` para este recorte e está registrada em `.gauntlet/critique-worker-entrypoint-final-attempt-20260910.md`; ela não aprova AAA. O veredito integral continua `IN_PROGRESS`/`PARTIAL`, `FAIL_WITH_LIMITATIONS`/`AAA_NOT_PROVEN`, com evidência externa e aceite humano ainda obrigatórios.

## Checkpoint 2026-09-17 — Embedded Agent Runtime / CI closure

**Fechamento CI-CLOSURE-01 em `141d7671f25c84a0d8f0ad34f649011e87b45269` (run `35246374977`, `success`):**
job `checks` verde (lint, testes, static, PDP, agent gates, Browser E2E com a
jornada de agenda, três gates PostgreSQL) e job `container-build` verde
(builder Buildx OCI-capaz, exports OCI API/web, scans Trivy HIGH/CRITICAL
exit-1 limpos, provenance same-SHA gerada e verificada, upload).
Correções da rodada: limites de calendário locais do navegador com validação
de range explícito (causa raiz do passo 30), isolamento de retries por janela,
builder OCI no CI, patch `libpcre2-8-0` na imagem API, scan sobre layouts OCI
extraídos (Trivy 0.70 não lê tar OCI direto), cache Trivy fora do checkout e
fallback para o engine commit pinnado do código com warning quando a variável
de repositório está ausente. `verify:state-of-art` 30/30 no mesmo SHA.
Veredito global permanece `AAA_NOT_PROVEN`; provas externas e aprovação
humana continuam ausentes. Detalhe auditável em
`artifacts/quality/ci-closure-local.json`.

**Base original:** `277f10f189750586ae32c7ae1974488c9c1b97ce` (CI run `35176228659`).
**Plano ativo de retomada:** [`.agent/plans/2026-09-17-embedded-runtime-ci-closure.md`](../.agent/plans/2026-09-17-embedded-runtime-ci-closure.md).

Estado: implementação local fechada e verificada — `verify:state-of-art` 30/30,
evals 7/7 com paridade diferencial, 10 ataques adversariais, chaos com 7 falhas,
baseline de carga 1–50 sessões e PostgreSQL 16.15 real local (migrations 001–039,
RLS, fence no banco, append-only, concorrência e restore). No CI remoto a run
`35170108792` passou os passos 1–36 (incluindo Browser E2E e os três gates
PostgreSQL); a run `35176228659` falhou apenas no passo 30 (jornada de agenda do
Browser E2E: recibo de criação presente, linha ausente na lista). O checkpoint
publica timeout de asserção ampliado (15 s) e diagnóstico de anexos com o
snapshot da página para a próxima run. Veredito global permanece
`AAA_NOT_PROVEN`; provas externas e aprovação humana continuam ausentes.

## Checkpoint 2026-09-20 — Reauditoria CVG-AUD20

A reauditoria do worktree AUD19 rejeitou o fechamento para promoção. Embora
typecheck, lint e a suíte de 543 testes tenham passado, contraprovas reproduziram
IDs divergentes aceitos pelo tool gateway, escrita após sessão terminal, bypass
de fence no caminho de restore, default privileges amplos em tabelas futuras e
readiness aceitando schema 039 sem as migrations 040/041. O gate universal de
PDP e `verify:static` estão vermelhos.

Os E2Es AUD19 018–020 também falham: a busca de pacientes fica presa sob
`StrictMode`, e os contratos frontend aceitam payloads semanticamente
corrompidos. Cancelamento do worker não alcança o provider de outbox. Receipts
AUD19 possuem problemas temporais e não vinculam exatamente os bytes do
worktree.

O estado corrente é `FAIL / PARTIAL / AAA_NOT_PROVEN`. Os documentos
autoritativos desta rodada são a
[reauditoria](auditoria-resultado-cvg-aud19-2026-09-20.md), o
[roadmap](roadmap-melhorias-cvg-aud20-2026-09-20.md) e o
[backlog](backlog-melhorias-cvg-aud20-2026-09-20.md). O próximo trabalho é
`CVG-AUD20-001`; nenhuma promoção, release ou declaração AAA está autorizada.

## Checkpoint 2026-09-20 — Reauditoria CVG-AUD21

A execução parcial AUD20 foi auditada por três críticos frescos e rejeitada
para promoção. O estado global `PARTIAL / AAA_NOT_PROVEN` estava correto, mas
sete itens marcados `DONE` não atendem ao aceite: 001, 002, 006, 007, 009, 012
e 013.

Contraprovas reproduziram renovação de lease após `COMPLETED`, wrapper PDP por
`Promise.then` aceito, sucesso/ack após abort durante provider, divergência de
IDs convertida em `NOT_FOUND` e payloads web semanticamente corrompidos aceitos.
Na jornada primária, a rota Conhecimento caiu no `RootErrorBoundary` em
Chromium e Firefox por campo `createdAt` removido pelo schema. O gate do control
plane continuou verde apesar de ExecPlan, checkpoint, last event e evidência
corrente divergirem.

As migrations 042/043, o manifesto 043 e a correção principal da corrida de
busca são preservados como progresso, mas não como prova suficiente de
fechamento. `git diff --check` também está vermelho por três whitespaces. A
qualificação local dupla, staging, providers reais, browser/AT completo,
carga/chaos/RTO-RPO, crítica F0–F38 e decisão humana continuam ausentes.

O estado corrente permanece `FAIL / PARTIAL / AAA_NOT_PROVEN`. As fontes
autoritativas para a próxima execução são a
[reauditoria AUD20](auditoria-resultado-cvg-aud20-2026-09-20.md), o
[roadmap AUD21](roadmap-melhorias-cvg-aud21-2026-09-20.md) e o
[backlog AUD21](backlog-melhorias-cvg-aud21-2026-09-20.md). A próxima ação é
`CVG-AUD21-001`; nenhum commit, deploy, release ou declaração AAA foi
autorizado por esta atualização documental.

## Checkpoint 2026-09-20 — CVG-AUD21 R0

AUD21-001 e AUD21-021 foram executadas no control plane: o catalogo AUD21 foi
importado, os sete fechamentos AUD20 falsos foram reabertos sem editar receipts
ou eventos antigos, e os tres trailing whitespaces de
`tests/unit/pdp-universal.test.ts` foram removidos. `git diff --check` passou.

O proximo passo canonico e `CVG-AUD21-002:TERMINALITY-RESTORE-AUTHORITY`.
R0 permanece `PARTIAL` porque o fingerprint exact-subject reproduzivel ainda
depende de AUD21-018. O estado global permanece `FAIL / REJECT / AAA_NOT_PROVEN`;
nenhum commit, deploy, release ou declaracao AAA foi autorizado.

## Checkpoint 2026-09-20 — CVG-AUD21-002

Foi corrigida a contraprova de terminalidade no store em memoria e no store
PostgreSQL: `renewLease` exige sessao `ACTIVE`, `complete` remove a lease e
`QUARANTINED_RESTORE` continua reservado ao restore. A migration 044 adiciona o
papel `cvg_restore_authority`, bloqueia escrita direta do owner generico/runtime
em sessoes terminais e executa a projeção de restore sob esse papel dentro da
transação de commit, incluindo a autoridade no evento de journal.

Provas locais: typecheck, 548 testes (`547` pass, `1` skip), schema manifest,
control plane e `git diff --check` passaram. `npm run verify:postgres` não foi
executado além do bloqueio inicial porque `DATABASE_URL` não está autorizado;
portanto a prova PostgreSQL, a autoridade de restore em banco e a qualificação
AAA continuam `PARTIAL / BLOCKED_EXTERNAL`.

## Checkpoint 2026-09-20 — Auditoria do fechamento CVG-AUD21-013

O fechamento declarado de `CVG-AUD21-013` foi reavaliado contra o worktree
real, com três críticos independentes somente leitura e PostgreSQL 16
descartável. O progresso é material: o drill corrente restaurou o conhecido-bom
em `revision=1`/`QUARANTINED`, rejeitou seu corpus de known-bads, preservou a
origem e fez rollback na falha tardia. Typecheck, lint, build, manifesto 044,
diff, JSON/JSONL e 560 testes (`559` pass, `0` fail, `1` skip) passaram.

O fechamento, porém, foi rejeitado. Contraprovas re-hashadas mostraram que o
validator ainda aceita `usageRecordId` órfão e lease com fence zero. O método
público de commit/restore aceita projeções `recoveredAgent*` sem tornar a
validação do bundle completo uma pré-condição interna. O verificador do control
plane também retorna verde com o plano marcando 013 e state/backlog marcando
014; há dependências e timestamps incoerentes. Além disso, harnesses ainda
contêm `GRANT USAGE, SELECT ON ALL SEQUENCES`, contrariando o aceite de least
privilege.

Assim, `CVG-AUD21-013` e `CVG-AUD21-011` são `REOPEN`; implementações AUD21 sem
fingerprint exato permanecem `IMPLEMENTED_UNVERIFIED`. O estado global é
`PARTIAL / REJECT / AAA_NOT_PROVEN`, com promoção bloqueada. As fontes correntes
são a [auditoria AUD21-013](auditoria-resultado-cvg-aud21-013-2026-09-20.md), o
[roadmap AUD22](roadmap-melhorias-cvg-aud22-2026-09-20.md) e o
[backlog AUD22](backlog-melhorias-cvg-aud22-2026-09-20.md). A próxima ação é
`CVG-AUD22-001`; nenhum commit, push, deploy, credencial ou dado real foi usado.

## Checkpoint 2026-09-20 — Auditoria da entrega CVG-AUD22-002

A troca do guard SQL de `usageRecordId` de `$11` para `$10` está implementada e
o teste focado confirma a ordem `$10/$11`. A suíte local passou com 567 testes
(`566` pass, `0` fail, `1` skip), além de 18/18 focados, typecheck, lint,
manifesto de schema e diff. O build consta como aprovado no relato do agente e
não foi reexecutado nesta auditoria porque escreve artefatos no worktree.

O fechamento foi rejeitado. O teste do guard inspeciona SQL e parâmetros, mas o
executor falso não avalia a referência de usage; a prova comportamental em
PostgreSQL não rodou porque as URLs estavam ausentes e terminou com exit `2`.
Essa ausência é `TODO_LOCAL / NOT_RUN` enquanto um PostgreSQL 16 descartável
puder ser provisionado localmente, e não prova por si só bloqueio externo.

Críticos independentes também confirmaram grants amplos de sequência nos
harnesses, arrays `recoveredAgent*` ainda públicos e um false-green material no
control plane: `CVG-AUD22-002` está ativa apesar de depender de 001 ainda
`PARTIAL`, e o receipt agregado informa exit `0` apesar do restore exit `2`.
Por isso, o verde de `verify:control-plane` não é evidência válida de
fechamento.

O estado corrente é `PARTIAL / REJECT / AAA_NOT_PROVEN`, com promoção
bloqueada. As fontes correntes são a
[auditoria AUD22-002](auditoria-entrega-cvg-aud22-002-2026-09-20.md), o
[roadmap AUD23](roadmap-melhorias-cvg-aud23-2026-09-20.md) e o
[backlog AUD23](backlog-melhorias-cvg-aud23-2026-09-20.md). A próxima ação é
`CVG-AUD23-001:CONTROL-PLANE-SEMANTICS`. Esta atualização não alterou `.agent`,
bancos ou containers e não realizou commit, push ou deploy.

## Checkpoint 2026-09-20 — Auditoria da entrega CVG-AUD23-004

O caminho direto de restore avançou: `PostgresPersistence.restore()` valida o
bundle antes da conexão, produz snapshot/sessões em quarentena e não revive
leases. Em PostgreSQL 16 descartável, 44 migrations e o conhecido-bom passaram;
o inventário Docker ficou idêntico antes/depois. A regressão local passou com
570 testes (`569` pass, `0` fail, `1` skip), persistência 59/59, typecheck,
lint e diff.

O fechamento `CVG-AUD23-004 = DONE` foi rejeitado. Uma contraprova pela API
exportada mostrou que `commit()` ainda aceita propriedades `recoveredAgent*`
extras em runtime, assume `cvg_restore_authority` e grava sem bundle,
fingerprint ou autoridade do entrypoint `restore()`. O conhecido-ruim de
rollback chama `commit()`, não `restore()`, usa oracle circular e o harness
concede privilégio amplo sobre sequences. A afirmação de origem inalterada
também parte de uma fotografia posterior à criação das fixtures.

O control plane continua verde somente por comparar strings de fingerprint,
sem recalculá-las do worktree; possui addendum antigo e status de dependências
incoerentes. `verify:static` permanece vermelho por SHA/freshness de snapshots
operacionais antigos. Assim, AUD23-004 é `PARTIAL / REOPEN`, AUD23-005 não
pode fechar e o programa permanece `FAIL / REJECT / AAA_NOT_PROVEN`.

As fontes correntes são a
[auditoria AUD23-004](auditoria-entrega-cvg-aud23-004-2026-09-20.md), o
[roadmap AUD24](roadmap-melhorias-cvg-aud24-2026-09-20.md) e o
[backlog AUD24](backlog-melhorias-cvg-aud24-2026-09-20.md). A próxima ação é
`CVG-AUD24-001:EXACT-SUBJECT-CONTROL-RECONCILIATION`. Esta atualização foi
somente documental: não alterou `.agent`, produto, banco ou container e não
realizou commit, push ou deploy.

## Checkpoint 2026-09-20 — Auditoria da entrega CVG-AUD24-003

O exact-subject e a fronteira pública de restore avançaram: o fingerprint
`sha256:5963cc8c…0c5a` foi recalculado e conferido antes desta atualização
documental; `commit()` rejeita campos de recovery; o conhecido-bom restaurou em
PostgreSQL 16 com 44 migrations, revision `1`, quarentena, continuidade do
runtime do agente, leases descartados e cleanup. A regressão auditada passou
com 576 testes (`575` pass, `0` fail, `1` skip), database 71/71, fault 34/34,
typecheck, lint de 238 arquivos, JSON/JSONL e diff.

O fechamento `CVG-AUD24-003 = DONE`, porém, foi rejeitado. O preflight lê
identidade, owner, membership e `schema_migrations` em um client e o libera;
`commitInternal()` adquire outro client e chega a `BEGIN`/DML sem verificar sua
identidade. Uma contraprova pública split-client observou duas conexões, zero
checagem de identidade na conexão de commit e `insert into organizations`
executado. O contrato também não verifica `CREATEDB`, `CREATEROLE` e
`REPLICATION`, e os known-bads de identidade/membership/drift existem apenas no
fake pool, não numa matriz PostgreSQL direta.

O drill positivo não prova rollback de restore: a falha tardia chama
`commit()`, e o oracle de destino usa `exportRecoveryBundle()` da mesma
implementação. Helpers ainda auto-provisionam roles/grants, incluindo `ON ALL
SEQUENCES`. `verify:static` continua falhando em 15 checks de SHA/freshness.

O estado correto é `AUD24-003 = PARTIAL / REOPEN`, programa `FAIL / REJECT /
AAA_NOT_PROVEN` e promoção bloqueada. As fontes correntes são a
[auditoria AUD24-003](auditoria-entrega-cvg-aud24-003-2026-09-20.md), o
[roadmap AUD25](roadmap-melhorias-cvg-aud25-2026-09-20.md) e o
[backlog AUD25](backlog-melhorias-cvg-aud25-2026-09-20.md). A próxima ação é
`CVG-AUD25-001:REOPEN-AUTHORITY-CONTROL`. Esta edição não altera `.agent`; a
reconciliação deve ocorrer por append e recalcular o sujeito depois das mudanças
documentais.

## Checkpoint 2026-09-21 — Reauditoria técnica da entrega CVG-AUD26

A [auditoria CVG-AUD27](auditoria-resultado-cvg-aud27-2026-09-21.md) confirmou a
contagem declarada de 36 tarefas AUD26: 15 `DONE`, 19 `PARTIAL`, 1
`BLOCKED_EXTERNAL` e 1 `BLOCKED_HUMAN`. Antes desta atualização documental,
foram reexecutados `verify:control-plane`, `verify:aud26-evidence`,
`verify:static`, 599 testes (`598` pass, `0` fail e `1` skip), typecheck e lint,
todos verdes. O gate de licenças permaneceu vermelho em 10 dependências. Um
sentinela pre/post confirmou que as validações não mutaram o sujeito auditado.

O veredito global AUD26 estava correto, mas a reauditoria encontrou divergência
semântica entre IDs, títulos, achados originais e quality bar. O control plane
prova a forma dos registros, não que cada tarefa preserva o significado do
achado. `CVG-AUD26-024` foi marcado `DONE` embora contraste/tokens permaneçam
parciais; `CVG-AUD26-026` não possui smoke real da imagem; F38 foi declarado
`PASS_LOCAL` sem `LICENSE`/`COPYING`. Há ainda 78/80 schemas de resposta
genéricos, 24 slices snapshot-primary, 14 parciais sem evidence refs, evidence
root externo ausente e candidato dependente de uma árvore Git modificada e
não consolidada.

A nota auditada é 69/100 para a entrega técnica e 40/100 para prontidão
de produção. O estado formal AUD26 continua `IN_PROGRESS`; portanto,
“execução concluída” representa apenas o encerramento do handoff anterior. O
[roadmap AUD27](roadmap-melhorias-cvg-aud27-2026-09-21.md) e o
[backlog AUD27](backlog-melhorias-cvg-aud27-2026-09-21.md) são `PROPOSED` e
não alteram `.agent`. O fingerprint AUD26 `sha256:585ac671…` identifica a
fotografia anterior a estes documentos e agora é histórico. O veredito
permanece `PROMOTION_BLOCKED — AAA_NOT_PROVEN`.

## Checkpoint intermediário MEL23 — 2026-09-23

O apontamento `last_gate_record`/`last_event_id` foi reconciliado por novos
registros append-only; os registros anteriores permanecem intactos. A mutação
`missing_transition` agora altera o evento resolvido por `state.last_event_id`,
e os demais mutantes de receipt alteram a evidência efetivamente apontada. O
caso conhecido-bom e os conhecidos-ruins passaram nos testes focados.

Na última regressão local, `npm test` terminou com 681 testes (`680` pass,
`0` fail, `1` skip). Typecheck, build, `verify:static` (250 artefatos/284
fontes), `verify:docs-integrity` (251 arquivos/0 achados), manifesto de
schemas/migrations e arquitetura passaram. Coverage ficou em 88,41% de linhas,
75,95% de branches e 86,63% de funções; a campanha seletiva matou 25/25
mutantes. A suíte focal da API passou 90/90; o catálogo mantém 105 rotas e 80
schemas específicos. `test:fault` passou 34/34.

O relatório MEL23 gera 50 linhas ligadas aos owners AUD27, incluindo alvos,
comandos, receipts, ambientes, resultados e fingerprint. Dezesseis critérios
estão qualificados PASS no sujeito local observado: control plane, regressão,
verificadores e documentação, cobertura/mutação seletiva, invariantes locais
de timeout/reconciliação e contratos principais da API. Os outros 34 têm
receipts que registram PARTIAL ou BLOCKED e mantêm o gate global fechado;
nenhum status foi copiado para um segundo backlog.

PostgreSQL 16 descartável demonstrou RLS, paridade de escrita normalizada
24/24, replay e rollback, mas cutover não foi reivindicado e 24 das 32 fatias
continuam sem autoridade de comando final. Carga, caos e restore locais usam
harness sintético; RTO/RPO são desconhecidos. A matriz browser permanece
parcial por skips, runtime WebKit descartável e falta de avaliação assistiva
e aceite humano.

Limites daquele checkpoint: a árvore continuava dirty e
`UNFROZEN_UNTIL_AUD27-004`; `audit:licenses` ainda rejeitava dependências sem
decisão legal. Os números acima foram supersedidos pela atualização abaixo.

## Atualização de verificação MEL23 — 23/09/2026

A topologia Compose agora separa a rede `backend` (internal) da rede `edge`.
Postgres, migração, API, web e worker só participam das redes internas; apenas o
proxy participa também de `edge`, necessária para publicar a porta no host. A
overlay de produção conserva essa separação e continua controlando bind/TLS por
variáveis de configuração. A edge concede egress de rede ao proxy; filtragem de
saída em produção permanece uma decisão operacional pendente.

O smoke Compose local confirmou a publicação em `127.0.0.1:45001`. Pela porta do
host, login sintético, criação idempotente de guardian, listagem, reinício da API,
novo login e leitura do registro persistido passaram. Os containers estavam
saudáveis e os serviços de aplicação não entraram na rede `edge`. Esse resultado
é local e sintético, sem afirmar TLS, endpoint externo ou dado clínico real.

No checkpoint revalidado, `npm test` passou com 684 testes (683 pass, 0 fail,
1 skip), na última execução coverage registrou 89,08% linhas, 76,21% branches e
87,98% funções, e
25/25 mutantes foram mortos. Typecheck, lint, `verify:static` (250 artefatos / 291
fontes), integridade documental, manifesto e control plane passaram. O audit npm
de licenças passou para 183 pacotes e SPDX aprovados; a decisão humana sobre a
licença raiz e avisos legais não foi tomada.

E2E: 503/540 casos passaram, 37 foram skips explícitos e zero falharam, nos 12
projetos; houve workaround local temporário para WebKit. Avaliação assistiva e
aceite humano continuam ausentes. Trivy local reportou API: zero altas/críticas,
15 médias e 7 baixas; web: zero vulnerabilidades; nenhum dos dois scans reportou
segredos. A verificação de secrets do repositório ainda aponta um valor genérico
com formato de API key em trace Playwright gerado; nenhuma allowlist foi
adicionada. SBOM e proveniência BuildKit existem apenas em OCI local e não têm
publicação/assinatura/issuer externo aceito. Harnesses locais de carga, caos,
restore e observabilidade são sintéticos; `verify:load` permanece bloqueado por
falta de endpoint e parâmetros autorizados e RTO/RPO seguem desconhecidos.

Naquele checkpoint intermediário, o crosswalk conservava 50 requisitos e 16/50
critérios qualificados; parcial não virava PASS por haver runtime local. A árvore continuava dirty e
`UNFROZEN_UNTIL_AUD27-004`; pacote externo AUD27, staging, registry/proveniência,
providers, autoridade de segredo, decisão legal e aceite humano seguem abertos.
O veredito permanece `PROMOTION_BLOCKED / AAA_NOT_PROVEN`.

## Atualização MEL23-015/016/039 — 23/09/2026

As imagens locais foram reconstruídas após as correções de entrada de migração e
inicialização do volume de backup. A API r4 aplicou 48 migrations com o comando
nu `migrate`, passou login sintético, escrita/leitura de Guardian e leitura
persistida depois de stop/start. O container foi validado como UID 65532, root
filesystem somente leitura, `cap_drop: ALL` e `no-new-privileges`. A imagem web
r2 serviu a página e dois assets estáticos; saúde e headers de segurança
passaram como UID 101 com o mesmo isolamento de capabilities e filesystem.
BuildKit SPDX/SLSA e Trivy foram ligados aos manifestos e configs das imagens.

O scan API reportou 22 vulnerabilidades OS (15 médias, 7 baixas), todas sem
versão de correção indicada; web reportou zero. Não foi definida política de
aceite de risco. A configuração de produção Compose resolveu com ambiente
sintético e sem iniciar serviços. O Postgres pinado executou como UID 999 com
capabilities removidas; o probe de backup confirmou criação/leitura pelo worker
sem alterar bytes, modo ou owner de arquivo preexistente. A rede `edge` mantém
egress para o proxy; filtragem de saída, TLS/segredos externos e operação de
produção não foram testados. O relato e artefatos estão em
[`mel23-container-smoke-supply-chain-2026-09-23.md`](verification/mel23-container-smoke-supply-chain-2026-09-23.md).

Naquele ponto intermediário, a matriz estava em 0/50 qualificados porque nenhum
receipt focal correspondia ao fingerprint então observado. A continuação abaixo
registra a requalificação posterior. HEAD continua `c990914148a8f375082cd12bbdb2ad20cfe1900f`,
árvore dirty, candidato não congelado e licença raiz sem decisão humana.
`PROMOTION_BLOCKED / AAA_NOT_PROVEN` continua sendo o veredito.

A rodada Gauntlet 10 permanece sem registro válido: o verificador de evidências
sobrescreveu o `mel23-evidence-matrix.json` imutável registrado na rodada 9 e
seu SHA-256 anterior não foi recuperado. A gravação da rodada continua suspensa;
nenhum arquivo `.gauntlet` foi ajustado manualmente. Uma crítica fresh também
não foi obtida dentro do limite de agentes da sessão, portanto não há aprovação
independente final.

## Continuação local M0 e fatia inicial de products — 23/09/2026

O validador de saída composta do control plane agora rejeita resultado de
subprocesso ausente, lista de subprocessos vazia, status agregado malformado e
divergência entre o status agregado e os resultados individuais; eventos
isolados com um exit status inteiro válido continuam aceitos. Os testes focados,
`npm run verify:control-plane`, `npm run verify:aud27-semantics` e `npm test`
passaram; a regressão completa terminou com 722 testes (721 pass, 0 fail,
1 skip). `npm run typecheck` e `npm run verify:docs-integrity` também passaram.

O gerador da matriz MEL23 agora grava por padrão em
`mel23-evidence-matrix-current.json` e rejeita como destino o arquivo da matriz
registrada no Gauntlet. O capture do control plane também grava em
`mel23-control-plane-current.json` e preserva o artefato histórico registrado.
Testes cobrem ambos os destinos seguros. A matriz out-of-tree atual qualifica
14/50 critérios no sujeito observado; MEL23-008..012 permanecem PARTIAL pela
fatia de `products`, sem reatribuir recibos históricos ao sujeito dirty atual.
Nenhuma rodada ou registro `.gauntlet` foi reescrito.

A primeira fatia de stock foi a criação de `products`: a API e o Postgres fazem
a escrita dedicada na mesma transação do snapshot, e replay confirma que a linha
normalizada já existe e corresponde ao snapshot sem emitir DML. Em PostgreSQL
16 descartável, o verificador passou paridade de projeção e contagem 24/24,
replay, rollback geral e rejeição da exclusão de uma linha-semente inalterada;
para `products`, passou criação, replay sem DML, rollback do commit, rejeição do
SKU duplicado dentro da mesma organização e aceitação do mesmo SKU em outra
organização, pela restrição `(organization_id, sku)`. A regra de domínio reserva
também SKUs de produtos inativos, e a violação conhecida da restrição vira HTTP
409 com recibo `FAILED/PRE_DISPATCH`, depois do rollback. O resultado não cobre
backfill completo, concorrência de comandos, restore pós-cutover, remoção de
fallback ou leitura inteiramente relacional. `products` continua
`SNAPSHOT_PRIMARY`, com escopo organizacional.

O audit de licenças segue PASS somente para os 183 pacotes no lockfile atual; a
licença raiz e as dez ocorrências históricas ainda requerem resolução e decisão
humana. O sujeito permanece dirty e sem fingerprint de candidato congelado.
Rotas/schemas reais completos, matriz atual de browsers, AT humana, cutovers e
restore relacionais das 24 coleções, CI remoto, evidência externa de supply
chain, staging, RTO/RPO e decisão de promoção continuam sem qualificação.
Veredito: `PROMOTION_BLOCKED / AAA_NOT_PROVEN`.

## Checkpoint MEL23 M0 — 24/09/2026 (anterior à revalidação atual)

`npm test` passou com 722 testes (721 pass, 0 fail, 1 skip). O control plane
passou com 334 itens e manteve `AUD27-001:SEMANTIC-RECONCILIATION` ativo; a
verificação semântica reportou 39 findings e rejeitou 5/5 conhecidos-ruins.
As provas MEL23-001..003 e os itens documentais M0 foram reavaliados no sujeito
local observado e registrados por recibos focais append-only. O relatório
[`mel23-evidence-matrix-current.json`](../artifacts/operational-proof/mel23-evidence-matrix-current.json)
é a fonte do total qualificado, dos recibos e do fingerprint observado; os
checkpoints anteriores permanecem históricos.

O sujeito segue dirty e `UNFROZEN_UNTIL_AUD27-004`. As 24 coleções
`SNAPSHOT_PRIMARY`, autoridade externa, gates de provider/staging, revisão
independente, decisão humana e demais critérios sem evidência atual continuam
abertos. Estado global: `AAA_NOT_PROVEN`; promoção: `PROMOTION_BLOCKED`.

## Checkpoint MEL23 M2 e telemetria — 24/09/2026 (anterior à revalidação atual)

A suíte passou com 723 testes (722 pass, 0 fail, 1 skip), typecheck passou e `git diff --check` não encontrou erros. O teste de respostas chamou as 105 rotas, validou 41/45 respostas GET autenticadas contra os schemas específicos, confirmou quatro 404 versionados para IDs sintéticos inexistentes e repetiu 35 fixtures válidas de sucesso. O verificador PostgreSQL passou nas rotas de inbox e exportação criptografada; o container temporário foi removido e o inventário Docker permaneceu igual. A revalidação encontrou e corrigiu um 500 em `/metrics`: chaves de contador derivadas de caminhos com nomes sensíveis agora são redigidas e contadores coincidentes são agregados.

`verify:control-plane` continua em 334 itens; a verificação semântica rejeitou 5/5 conhecidos-ruins, integridade documental passou em 255 arquivos e a verificação estática passou em 250 artefatos/293 fontes. A matriz [`mel23-evidence-matrix-current.json`](../artifacts/operational-proof/mel23-evidence-matrix-current.json) é a fonte autoritativa para a qualificação e o fingerprint após esta rodada. MEL23-021 permanece PARTIAL: 103/105 rotas têm fixtures explícitas de sucesso validadas, com 45/45 GETs; ingresso de integração e exportação governada continuam sem sucesso de fixture no runtime local e falham fechados. O sujeito segue dirty e unfrozen; staging, provedores, autoridade externa, restore pós-cutover, revisões independentes e decisão humana continuam sem prova. Veredito: `PROMOTION_BLOCKED / AAA_NOT_PROVEN`.

## Revalidação MEL23 M0/M2 e documentação — 24/09/2026

Esta é a fotografia local mais recente; os checkpoints anteriores preservam os resultados das respectivas execuções. `npm test` passou com 724 testes (723 pass, 0 fail, 1 skip), `npm run typecheck` passou, e os testes semânticos rejeitaram 11 casos conhecidos-ruins. O control plane verificou 334 itens e manteve `AUD27-001:SEMANTIC-RECONCILIATION` ativo. A validação documental cobre 256 arquivos sem findings. Os resultados exatos dos verificadores e o fingerprint observado estão ligados pelo [manifest da revalidação atual](../artifacts/operational-proof/mel23-current-doc-revalidation-20260924-da0315/verification-manifest.json) e pelos recibos focais atuais.

A chamada de 105 rotas manteve envelopes versionados, validou schemas em 41/45 respostas GET autenticadas e agora executa fixtures explícitas de sucesso para 103/105 rotas, com 45/45 GETs. Fluxos sintéticos exercitam sucesso de payload em auth/MFA/recuperação, clínica, diagnóstico, estoque, medicação, internação, finanças, conhecimento e aprovação de IA. Ingresso de integração requer PostgreSQL e verificação de assinatura; exportação governada permanece desabilitada no runtime isolado de memória. O verificador PostgreSQL passou em duas rotas duráveis; o container descartável foi removido e o inventário Docker ficou igual. MEL23-021 segue PARTIAL enquanto as duas exceções não tiverem fixtures de sucesso validadas no ambiente adequado. A matriz [`mel23-evidence-matrix-current.json`](../artifacts/operational-proof/mel23-evidence-matrix-current.json) é a fonte autoritativa para o total qualificado e os bloqueios no fingerprint atual.

O sujeito segue dirty e `UNFROZEN_UNTIL_AUD27-004`. A raiz externa AUD27, o cutover e restore pós-cutover, provedores, staging, autoridade de segredo, decisão legal, revisão independente e aprovação humana permanecem sem prova. Estado global: `AAA_NOT_PROVEN`; promoção: `PROMOTION_BLOCKED`.

## Revalidação MEL23 M0 após reconciliação documental — 24/09/2026

Esta entrada supersede somente a afirmação de atualidade do checkpoint imediatamente anterior; os resultados datados anteriores permanecem como histórico. A suíte corrente passou com 726 testes (725 pass, 0 fail, 1 skip). O typecheck passou. O lint passou após ajustar a limpeza do advisory lock para não lançar exceções dentro de `finally` e tornar constante a coleção `products`. O harness local de migração passou 5/5; ele valida o protocolo com fixtures e não representa cutover de dados existentes.

O catálogo de respostas continua com fixtures explícitas de sucesso e schema para 103/105 rotas, incluindo 45/45 GETs. Ingresso de integração ainda exige PostgreSQL e verificação de assinatura; exportação governada continua indisponível no runtime isolado em memória. Permanecem 24/32 coleções `SNAPSHOT_PRIMARY`; as provas PostgreSQL disponíveis para os slices são sintéticas e não qualificam backfill, autoridade relacional ou cutover.

`npm run audit:licenses` passou para 183 pacotes de terceiros sob a allowlist existente, sem ampliar a política. A decisão jurídica e a licença raiz continuam pendentes. A raiz externa AUD27 continua sem correspondência ao fingerprint atual. O arquivo registrado de matriz MEL23 permanece byte a byte sem alteração porque a cópia original com o digest esperado não está disponível; a revalidação corrente usa o sidecar separado [`mel23-evidence-matrix-current.json`](../artifacts/operational-proof/mel23-evidence-matrix-current.json). Consulte nele o fingerprint observado, os recibos focais, a qualificação e os bloqueios atuais; este arquivo de estado não fixa um fingerprint que se tornaria obsoleto após a próxima mudança.

Esses resultados qualificam apenas a árvore local observada. O candidato continua dirty e unfrozen; staging, provedores reais, autoridade de segredo, restore operacional pós-cutover, revisões independentes e decisão humana seguem sem prova. Estado global: `AAA_NOT_PROVEN`; promoção: `PROMOTION_BLOCKED`.

## Revalidação corrente MEL23/AUD27 — 24/09/2026

Esta entrada substitui as afirmações de atualidade dos checkpoints anteriores; os resultados de cada rodada permanecem preservados. `npm test` passou com 735 testes (734 aprovados, 0 falhas e 1 skip). Typecheck, lint, build, schema manifest, static, semântica AUD27, migration harness (5/5), integridade documental (256 arquivos/0 findings) e control plane (334 itens) também passaram.

As 105 rotas mantêm probes de envelope versionado; os 80 schemas específicos executáveis foram conferidos, com 103/105 fixtures de sucesso em memória e as duas respostas restantes validadas em PostgreSQL descartável: callback HMAC `202/PROCESSED` e exportação AES-256-GCM `201`. Os 45 GETs têm fixture explícita de sucesso e schema; 41/45 respostas autenticadas carregam payload de dados, e as quatro rotas por ID sintético também retêm probes 404 versionados.

No PostgreSQL 16 sintético, o backfill sombra de `products` passou dry-run sem DML, digest integral, replay sem DML, quarentena de drift, rollback/retomada, crash pós-commit recuperado por executor novo depois de SIGKILL, escopo tenant e concorrência de SKU. Provas independentes de normalized-writes e dos 24 slices passaram escrita/removal, paridade de linha/contagem 24/24, replay e rollback. O protocolo geral AUD27 aplicou 49 migrations e passou recuperação/replay/rollback e limpeza identificada de records/checkpoints. Todos os bancos sintéticos foram descartados com seus containers tmpfs e o inventário dos 21 containers preexistentes permaneceu igual.

Essas execuções qualificam somente comportamento local com dados sintéticos. Não alegam cutover, restore pós-cutover, autoridade relacional ou backfill completo; 24/32 coleções continuam `SNAPSHOT_PRIMARY`. O sidecar [`mel23-evidence-matrix-current.json`](../artifacts/operational-proof/mel23-evidence-matrix-current.json) registra o fingerprint observado, recibos focais e qualificação após esta rodada. O candidato continua dirty e `UNFROZEN_UNTIL_AUD27-004`; a raiz externa AUD27 segue sem correspondência ao sujeito, e staging, providers reais, autoridade de segredo, decisão legal, revisões independentes e aprovação humana permanecem pendentes. A cópia registrada `mel23-evidence-matrix.json` não foi alterada: a versão original com o digest esperado não está disponível. Estado global: `AAA_NOT_PROVEN`; promoção: `PROMOTION_BLOCKED`.

## Gates locais adicionais — 24/09/2026

A cobertura completa passou no piso observado: 88,41% linhas, 76,62% branches e 87,96% funções; a métrica de declarações é equivalente à cobertura de linhas nativa do Node. A coleta executou 735 testes (734 aprovados, 0 falhas, 1 skip). O verificador real de mutação matou 25/25 mutações (100%, nenhuma sobrevivente ou inválida). O projeto Playwright `chromium-stress` passou 5 testes e ignorou 1 cenário condicional.

O E2E completo continua sem aprovação: Chromium e Firefox terminaram seus projetos, mas o WebKit não iniciou por dependências do sistema ausentes (`libgstcodecparsers-1.0.so.0`, `libWPEWebKit-2.0.so.1`, `libbacktrace.so.0`, `libjxl.so.0.8` e `libavif.so.16`). A tentativa integral terminou com falhas de inicialização no WebKit e casos não executados. Não houve instalação de dependências de sistema. Registros: [`coverage-final.log`](../artifacts/operational-proof/mel23-final-revalidation-20260924-r2/coverage-final.log), [`mutation-final.log`](../artifacts/operational-proof/mel23-final-revalidation-20260924-r2/mutation-final.log), [`e2e-chromium-stress.log`](../artifacts/operational-proof/mel23-final-revalidation-20260924-r2/e2e-chromium-stress.log) e [`e2e.log`](../artifacts/operational-proof/mel23-final-revalidation-20260924-r2/e2e.log).

Os testes adicionais exercitam rejeições de produto nulo, SKU não textual, estado desconhecido e tenant sem UUID. Eles não alteram limites de cobertura nem comportamento de produção. No sujeito atual, repetimos o backfill PostgreSQL de `products`, as duas rotas duráveis, o protocolo de migração (49 migrations), normalized writes e a paridade/rollback dos 24 slices; os verificadores removeram seus containers exatos e mantiveram o inventário preexistente. Logs: [`migrations.log`](../artifacts/operational-proof/mel23-final-revalidation-20260924-r2/products-backfill-postgres/migrations.log), [`products-backfill.log`](../artifacts/operational-proof/mel23-final-revalidation-20260924-r2/products-backfill-postgres/products-backfill.log), [`api-response-postgres-final.log`](../artifacts/operational-proof/mel23-final-revalidation-20260924-r2/api-response-postgres-final.log), [`aud27-migration-postgres-final.log`](../artifacts/operational-proof/mel23-final-revalidation-20260924-r2/aud27-migration-postgres-final.log), [`aud27-normalized-writes-postgres-final.log`](../artifacts/operational-proof/mel23-final-revalidation-20260924-r2/aud27-normalized-writes-postgres-final.log) e [`aud27-24-slices-postgres-final.log`](../artifacts/operational-proof/mel23-final-revalidation-20260924-r2/aud27-24-slices-postgres-final.log). O artefato de matriz registrado continua intacto e indisponível em sua forma original; o sujeito permanece dirty e unfrozen, sem cutover, autoridade externa, aprovação humana ou promoção.

## Revalidação pós-auditoria MEL24 (M0/M1 local) — 24/09/2026

Esta entrada substitui as afirmações de atualidade dos checkpoints anteriores sem reescrever os resultados datados. A árvore local corrigiu a divergência entre o duplo de teste `fakePool` e o contrato de commit durável — o duplo passou a devolver `snapshot`/`snapshot_digest` e a projetar a tabela `products` — restaurando a suíte: `npm test` passou com 741 testes (740 aprovados, 0 falhas, 1 skip). Também passaram typecheck, lint, build, static (250 artefatos/298 fontes), schema manifest, semântica AUD27, migration harness, integridade documental (264 arquivos/0 achados), control plane (334 itens), `verify:coverage` (ratchet 88,40%; execuções consecutivas entre 88,43%–88,48% de linhas e 76,69%–76,74% de branches, sempre acima do piso; artefato `artifacts/coverage-summary.json`), `verify:architecture`, `verify:authoritative-writes` (32 domínios/8 comandos/24 snapshot-primary), `verify:secrets`, `verify:production --structural --skip-local-gates` e o projeto Playwright `chromium-wide-1440` (56 aprovados, 2 skips, 0 falhas). A mutação permaneceu 25/25 e o worker 6 policies/38 testes focados.

O seam AUD27 de escrita normalizada recebeu teste de contrato das 24 projeções e a declaração explícita `AUD27_TRANSITIONAL_WRITE_FIELDS` para a fatia `products`, que permanece `SNAPSHOT_PRIMARY`; nenhum cutover foi executado. A cobertura ganhou margem com testes reais de continuidade da IA desabilitada e das distinções de erro/resultado do copiloto. O scan de segredos manteve a exceção existente (restrita a `generic-api-key` em `.agent/`, `.gauntlet/`, `artifacts/`, `tests/`, testes de `apps`/`packages` e dois scripts) e acrescentou somente o estado local `.opencode/` (gitignored, nunca parte do produto); as demais regras continuam falhando. A exceção preexistente é uma decisão do projeto com revisão marcada para 2026-12-31 e permanece como risco residual declarado: `tests/` e `artifacts/` não são gitignored. O gate `verify:production` ganhou o flag documentado `--skip-local-gates` para execução local limitada, sem alterar o padrão da CI.

Reconciliação de contradições: o fingerprint `sha256:585ac671…` pertence ao pacote AUD26 (o índice o atribuía também à reauditoria AUD27); as 105 rotas têm fixtures de sucesso 103/105 em memória + 2/2 PostgreSQL, e a classificação `PARTIAL` de MEL23-021 decorre do vínculo de fingerprint, não da ausência de fixture; os gates locais de PostgreSQL usam 16.15 enquanto a CI fixa `postgres:18.0` — os dois ambientes estão declarados e não são equivalentes.

Limites: nada aqui qualifica candidato congelado. O sujeito continua dirty e `UNFROZEN_UNTIL_AUD27-004`; 24/32 coleções `SNAPSHOT_PRIMARY`; congelamento Git, licença de raiz, staging, provedores reais, autoridade de segredo, observabilidade externa, carga/caos/DR, WebKit/tecnologia assistiva, revisões independentes e decisão humana seguem pendentes. Estado global: `AAA_NOT_PROVEN`; promoção: `PROMOTION_BLOCKED`.

Adendo de freeze autorizado — 25/09/2026: o sujeito foi consolidado em commit, o estado local `.opencode/` (92 arquivos rastreados por engano) foi destrackeado conforme a intenção do `.gitignore`, e o fingerprint passou a excluir `.opencode/` em `scripts/subject-manifest.ts`. Um checkout novo reproduz typecheck, build e o mesmo fingerprint de sujeito; SHA e fingerprint canônicos ficam no controle (`.agent/subject-manifest.json`), fora do sujeito. A revalidação focal dos recibos (fingerprints anteriores) e a raiz externa `LOCAL_SYNTHETIC_ONLY` seguem abertas; a transição canônica de status permanece no fluxo append-only. O veredito global não muda: `PROMOTION_BLOCKED / AAA_NOT_PROVEN`.

Segundo candidato — 25/09/2026: a matriz de mutação foi ampliada de 25 para 30 mutantes, cobrindo auditoria (elo de cadeia), agenda (sobreposição de janela), idempotência (corpo divergente), escrita normalizada AUD27 (digest divergente) e expiração de desafio WebAuthn; todos foram mortos com score 100% e a cobertura permaneceu acima do ratchet. O novo commit e fingerprint são registrados no controle (`.agent/subject-manifest.json`); cutover, autoridade externa, staging, tecnologia assistiva e decisão humana continuam pendentes.
