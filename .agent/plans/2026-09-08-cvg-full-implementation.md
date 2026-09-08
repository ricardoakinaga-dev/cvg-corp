# CVG-Corp — Implementação integral local-first

## Purpose / Big Picture

Construir uma primeira implementação executável e demonstrável do CVG-Corp a partir dos documentos preservados em `docs/`, com uma fatia operacional local/sintética que atravessa autenticação, escopo, agenda, pacientes, atendimento, estoque, financeiro e governança de IA. O artifact deve ser seguro por padrão, observável, responsivo e preparado para PostgreSQL sem fingir que provider real, autoridade clínica ou produção já foram aprovados.

## Progress

- [x] (2026-09-08T14:00:00-03:00) — Repositório conferido: somente `docs/` e `.git/`; nenhum código existente foi reutilizado.
- [x] (2026-09-08T14:05:00-03:00) — Escopo T3/SYSTEM identificado; bar de qualidade e matriz de ondas congelados neste plano.
- [x] (2026-09-08T14:20:00-03:00) — Implementar walking skeleton API + domínio + web; suíte agregada local passou.
- [ ] (2026-09-08T14:23:00-03:00) — Integrar persistência PostgreSQL opcional, migrations e bootstrap sintético.
- [x] (2026-09-08T14:21:00-03:00) — Exercitar testes unitários, API, segurança, recuperação e E2E visual; `verify:all` passou e E2E fechou 9/9.
- [x] (2026-09-08T14:32:00-03:00) — Corrigir serialização/validação de snapshots JSON e reexecutar a suíte agregada; 19 testes de domínio/API passaram.
- [x] (2026-09-08T14:48:00-03:00) — Reforçar o boundary de dados: pacientes têm resposta mínima por papel e o operador técnico não lê diagnósticos, internação ou ordens de medicação; testes negativos HTTP passaram.
- [x] (2026-09-08T14:55:00-03:00) — Reexecutar a suíte após escopo financeiro por unidade: 20/20 testes, build, estática e 9/9 E2E passaram; `db:check` permaneceu bloqueado por `ECONNREFUSED`.
- [x] (2026-09-08T14:56:00-03:00) — Rodar crítica independente nova, atualizar evidência e emitir veredito honesto: a barra integral permanece `FAIL` por persistência transacional/journal ausentes e limitações de UX/observabilidade.

## Surprises & Discoveries

- O workspace não contém runtime, manifests, migrations ou testes após a limpeza solicitada; o produto é greenfield de implementação.
- Docker e PostgreSQL nativos não estão disponíveis para o processo atual; a demonstração usa store em memória isolado e o adapter SQL/migration fica executável quando PostgreSQL for disponibilizado.
- Os documentos distinguem claramente a demonstração M1 de uma liberação clínica/produção; nenhum endpoint externo, provider real ou dado real será habilitado por configuração padrão.

## Decision Log

- 2026-09-08 — DEC-IMPL-01 (PROPOSED): modular monolith TypeScript/Fastify + React/Vite, contratos compartilhados e ports de persistência; motivo: preservar ownership sem acoplar o domínio ao runtime de IA.
- 2026-09-08 — DEC-IMPL-02 (PROPOSED): memória sintética é o modo padrão quando `CVG_STORAGE=memory`; PostgreSQL é o alvo de persistência operacional, com migration/health preparados, mas o runtime falha fechado até que o adapter transacional seja conectado. Motivo: manter a demo executável neste host sem mascarar a dependência.
- 2026-09-08 — DEC-IMPL-03 (PROPOSED): provider/modelo real permanece bloqueado; o Harness possui stub determinístico, budget, policy, approval e replay para provar a governança sem enviar dados a terceiros.
- 2026-09-08 — DEC-IMPL-04 (PROPOSED): a UI usa linguagem visual “clinical signal”: navy profundo, teal para continuidade, coral para ação e amber para atenção; a hierarquia prioriza fila/pendência/ação e mantém estados de erro e permissão visíveis.
- 2026-09-08 — DEC-IMPL-05 (PROPOSED): toda mutation HTTP relevante, inclusive `ai.turn` e `ai.approval.retry`, recebe uma chave estável e devolve receipt; replay compatível não reexecuta domínio, approval ou dispatch. Motivo: alinhar o boundary da API ao contrato de retry semântico dos documentos.

## Context and Orientation

Os contratos de produto estão em `docs/01-prd-cvg.md`, arquitetura em `docs/02-arquitetura-alvo.md`, dados e rotas M1 em `docs/03-dominio-dados-contratos.md`, Harness em `docs/04-motor-deepseek-e-plugins.md`, segurança em `docs/05-seguranca-privacidade.md`, operação e recuperação em `docs/06-operacao-qualidade-e-recuperacao.md`, milestones em `docs/07-plano-execucao.md` e transição em `docs/10-preparacao-m1.md`/`docs/11-transicao-para-producao.md`.

Classificação atual: `GREENFIELD`, `FEATURE` com overlay `MIGRATION`, estágio `BUILD`, atividade `IMPLEMENT`, tier `T3_SYSTEM`, risco `HIGH`, blast radius `SYSTEM`, status `IN_PROGRESS`. Dados são sintéticos. A superfície pública é `/api/v1` e o artifact web em loopback.

## Scope and Constraints

Inclui uma implementação local demonstrável com default-deny, sessões cookie, CSRF, contexto explícito, auditoria redigida, idempotência, invariantes de agenda/clinical/stock/ledger, Harness governado e telas responsivas. Inclui contratos para todos os contextos, mesmo quando uma tela ainda é compacta.

Não inclui credenciais reais, provider real, dados reais, deploy, decisão regulatória, retenção legal, MFA de produção, pagamentos reais, mensagens reais ou autoridade clínica/financeira. Essas fronteiras permanecem `UNKNOWN`/bloqueadas conforme a documentação.

## Architecture and Interfaces

`apps/api` é o BFF/HTTP boundary. `packages/domain` mantém regras e store em memória; `packages/contracts` contém tipos, schemas, envelope de erro e enums; `packages/harness` controla sessões, budget, policy, approvals e replay; `packages/integrations` contém adapters deny-by-default; `packages/ops` contém health/metrics/redaction. `apps/web` consome apenas `/api/v1`.

PostgreSQL é acessado apenas por um futuro/atual port de persistência e migrations em `db/migrations`; o runtime não escreve SQL de domínio diretamente. A UI não decide autorização. O store sintético é descartável e reinicializável por comando explícito.

## Milestones

### M0 — Contratos e walking skeleton

Saída: instalação, typecheck, API health, web renderizável, contratos compartilhados e controle de escopo.

### M1 — Identidade e administração

Saída: login/logout, contexto, roles, allow/deny server-side, audit, idempotency receipt e UI administrativa.

### M2/M3 — Operação clínica e Harness mínimo

Saída: tutores/pacientes, agenda/fila, encontro/documentos, diagnóstico, Harness read-only/draft com approval e replay.

### M4/M5 — Tratamento, estoque, financeiro e comunicação

Saída: hospitalização, medicação, lotes/movimentos sem saldo negativo, ledger compensatório, mensagens staged e reconciliação.

### M6/M7 — Conhecimento, automações, recuperação e release evidence

Saída: indexação/automação governadas, outbox/inbox, backup/restore/quarentena, métricas e evidências de transição. Provider real continua fora sem contratos/autoridade.

## Plan of Work

1. Implementar contratos, store e serviços puros com invariantes determinísticas.
2. Expor a API real com sessão, CSRF, contexto, autorização, erros e auditoria.
3. Construir a UI por estados e rotas com tokens semânticos, acessibilidade e responsividade.
4. Adicionar Harness e adapters deny-by-default, migrations e scripts operacionais.
5. Executar testes conhecidos-bons/conhecidos-ruins, API/E2E, recuperação e QA visual em 375/768/1440.
6. Fazer self-review, crítica fresca sem contexto de construtor, corrigir gaps e atualizar evidências/documentação.

## Concrete Steps

<!-- engineering-framework: active_action_id=CVG-FULL-IMPLEMENTATION:PRODUCTION-READINESS-GAPS -->

## Continuação registrada — 2026-09-08

O slice PostgreSQL deixou de ser apenas preparação: migrations 001–006, snapshot/journal, projeções, leituras normalizadas, audit/receipt, outbox/usage, RLS organizacional e RLS de escopo em projeções selecionadas foram executados contra PostgreSQL 16.15 sintético. O restore exporta snapshot + outbox + usage por digest para destino temporário, grava `RESTORE_QUARANTINED`, bloqueia login/readiness e confirma a origem inalterada. O gate local final também passou com 35 testes e 12 E2E.

Isso não altera a barra congelada nem autoriza produção. Permanecem necessários PDP/RLS completo em todo o domínio, provider/efeitos externos com inbox e reconciliação, settlement real, backup criptografado, fault/crash drills, cache offline autorizado, browsers adicionais, SLO/alertas e aceite humano.

## Revalidação final registrada — 2026-09-08 17:58

Os gates locais passaram com 36/36 testes, build, static, 12/12 E2E em 375/768/1440, contraste, tokens sem high/critical, dependências, diff e `db:check`. A prova PostgreSQL sintética passou todos os cenários e o restore serial confirmou 302 snapshots/journals, 217 audits/ledgers, 65 outbox, 8 inbox, 23 efeitos externos, sourceRevision 303, destino em `QUARANTINED`, autoridade bloqueada e origem inalterada. Uma tentativa com senha incompatível falhou antes de mutação e foi repetida com a credencial fixture correta.

O resultado é `PASS WITH LIMITATIONS` para o recorte local e `FAIL` para a barra integral. Não há aprovação independente fresca nem autorização para dados reais; o maior gap permanece provider/consulta externa reais, PDP/RLS completo e recovery operacional aprovado.

1. [CVG-FULL-IMPLEMENTATION:POSTGRES-TRANSACTIONAL-VERTICAL-SLICE] — concluído no recorte sintético com adapter transacional, journal independente, receipt/audit atômicos, CAS/concurrency, leituras normalizadas, outbox/usage e RLS selecionado; a barra integral segue fechada pelos gaps de produção.
2. **CVG-FULL-IMPLEMENTATION:BUILD-SKELETON** — criar os contratos e o walking skeleton integrado em `packages/`, `apps/`, `db/` e `tests/`; conclusão quando `npm install`, `npm run typecheck`, `npm test` e `npm run build` executarem sem falhas.
3. **CVG-FULL-IMPLEMENTATION:DOMAIN-WAVES** — integrar as ondas de domínio restantes e suas rotas públicas; conclusão quando os critérios FR/BR aplicáveis tiverem fixtures e respostas observáveis.
4. **CVG-FULL-IMPLEMENTATION:UI-QUALITY** — capturar a matriz visual e de interação; conclusão quando o artifact renderizar nos três viewports, sem overflow/falhas de acessibilidade bloqueantes.
5. **CVG-FULL-IMPLEMENTATION:FINAL-VERIFY** — executar o pacote completo e atualizar state/traceability; conclusão quando cada critério obrigatório tiver evidência atual ou bloqueio honesto explicitamente documentado.

## Validation and Acceptance

Bar executável: `docs/00-quality-bar-v1.md` (v1.1) mais os critérios de implementação `IMPL-01..IMPL-12` em `.gauntlet/bar-v2.json`. Obrigatórios: typecheck/build; known-good e known-bad unit/integration; API M1; cross-scope/CSRF/session/idempotency/audit; invariantes de agenda/clinical/stock/ledger; Harness deny/approval/budget/replay; recuperação/quarentena; E2E de login e navegação; screenshots nativos 375/768/1440 e inspeção visual fresca.

## Risks and Human Decisions

R-01 cross-scope/privilege bypass (HIGH): prevenção no BFF+domain, testes deny, revisão fresca. R-02 registros clínicos ou ledger sobrescritos (HIGH): append-only lógico, invariants e tests. R-03 provider/secret leak (HIGH): nenhum secret em cliente/log/prompt, adapters deny. R-04 restore reativa autoridade antiga (CRITICAL se produção): quarantine e bloqueio por padrão; produção permanece fora. R-05 ausência de Postgres neste host (MEDIUM): memória sintética explicitamente sinalizada e SQL executável separado.

Decisões de produção, retenção, MFA real, provider, residência e aceite de risco residual exigem autoridade humana e não serão inferidas.

## Idempotence and Recovery

`npm run bootstrap` só inicializa a store/local fixture identificada. Comandos administrativos exigem `Idempotency-Key`; retries com digest igual retornam o receipt, digest divergente falha. Harness grava decisões em memória/ledger append-only e não repete dispatch. Restore de fixture cria estado `QUARANTINED`, invalida sessões e não reenvia exportações; o drill PostgreSQL transporta outbox/usage/inbox/efeitos por digest e usa envelope AES-256-GCM em fixture, mas ainda não é um backup operacional gerenciado nem cobre stores externos.

Para retomar: leia `.agent/state.json`, este plano, o backlog, o tail dos ledgers e `git status`; confirme o pointer `active_action_id` antes de executar. Se uma resposta/efeito estiver desconhecido, consulte o receipt antes de qualquer retry.

## Artifacts and Evidence

Artefatos de execução ficam em `artifacts/runs/<timestamp>/`, ledgers em `.agent/`, quality bar em `.gauntlet/bar-v2.json` e estado em `.gauntlet/state.json`. Documentação preservada continua a fonte de requisitos; este plano não altera seus estados históricos sem evidência nova.

## Outcomes & Retrospective

O recorte local sintético foi implementado e verificado. A crítica fresca round 4 concluiu em contexto separado e confirmou `FAIL`/AAA não elegível; não foi usada como aprovação. O builder reduziu os gaps com o slice PostgreSQL sintético, RLS contextual, outbox/usage e restore por digest; ainda não há claim de produção. O estado permanece `IN_PROGRESS`/`PARTIAL` porque as garantias externas, operacionais e de release continuam abertas.

## Checkpoint final desta continuação — 2026-09-08 18:35

Foram implementadas as migrations `013_complete_domain_rls.sql` e `014_cross_organization_foreign_keys.sql`, fechando RLS forçado em todo o catálogo de domínio e FKs compostas de proveniência. O recovery bundle ganhou envelope AES-256-GCM com `keyRef` externo, digest autenticado e teste anti-adulteração; o drill PostgreSQL usa essa cópia antes da quarentena.

Evidência corrente: `npm run verify:all` passou 40/40 testes, build, static com 40 arquivos-fonte e 12/12 E2E; `db:migrate` não encontrou drift; `verify:postgres` passou com 54/54 tabelas protegidas e 90 FKs organizacionais; `verify:postgres:restore` passou com sourceRevision 436, targetRevision 1, cinco ledgers recuperados, `tamperRejected=true`, quarentena, login/readiness bloqueados e origem inalterada. Nenhuma aprovação de produção foi inferida; o maior gap segue a combinação provider/secret-provider/PDP e recovery operacional aprovado.

## Revalidação final da rodada 4 — 2026-09-08 20:00

O critic independente fresco confirmou `FAIL`/AAA não elegível e apontou leitura RLS de paciente/tutor sem unidade. A correção foi feita como migration aditiva `018_require_patient_context.sql`, alinhada ao PDP em memória e coberta por asserção negativa no verificador; nenhuma migration aplicada foi editada.

Evidência final do artifact: `npm run verify:all` passou 43/43 testes, build, static com 45 arquivos-fonte e 15/15 E2E em 375/768/1440; contraste passou nos cinco pares; tokens strict permaneceu sem achados high/critical (72 sinais medium heurísticos); `npm audit --omit=dev` encontrou 0 vulnerabilidades; `git diff --check` passou. PostgreSQL 16.15 sintético passou migrations `001`–`018`, 54/54 tabelas com FORCE RLS, 94 FKs organizacionais e zero pacientes/tutores visíveis sem unidade. Restore serial passou com AES-256-GCM, `sourceRevision=507`, `targetRevision=1`, `QUARANTINED`, tamper rejection, 155 outbox/1 usage/33 inbox/62 efeitos recuperados, login/readiness bloqueados e origem inalterada.

Integrações/provider/secret-provider reais, PDP/ABAC de produção, backup gerenciado, replay pós-watermark, stores externos, fault/workload, RTO/RPO/SLO, browsers adicionais, acessibilidade profunda e aceite humano seguem bloqueadores. A rodada foi consolidada em `.gauntlet/critique-round-4.md` e `.agent/gates/production-readiness-review-002.json`; manter `IN_PROGRESS`/`PARTIAL` e não liberar dados reais ou release.
