# CVG-Corp — Auditoria arquitetural vNext

**Estado:** CURRENT / VERIFY; a auditoria da Fase 0 abaixo é preservada como baseline e suas revalidações correntes estão na seção 14.

**Escopo:** implementação existente no baseline `7b49bd22ec32c72d9aff8fb39bfb6be7fb6bd295`, a especificação preservada em `docs/prompt-state-of-the-art-triplo-aaa.md` e o artifact vNext corrente no working tree.

**Conclusão:** o repositório contém uma demonstração local-first executável, uma fatia PostgreSQL sintética verificada e uma rota de detalhe com PDP target-bound localmente provada, mas não um produto State of the Art / Triplo AAA pronto para dados reais, provider externo, homologação, piloto ou produção.

## 1. Evidência e limites

Esta auditoria foi feita sobre o working tree compartilhado, os documentos existentes, o plano e os ledgers de execução, os migrations 001–018, o código TypeScript/React, o manifesto de dependências e o repositório local do DeepSeek Harness.

O prompt de origem foi preservado byte a byte em [`prompt-state-of-the-art-triplo-aaa.md`](prompt-state-of-the-art-triplo-aaa.md); SHA-256 do original e da cópia: `1fb482d752e37db2ad75fdf8c5ea8f893f9343102c42cde7da2fe32f9ad112da`.

As evidências históricas em `.agent/verification.jsonl` e `.gauntlet/critique-round-4.md` são válidas para o recorte e o ambiente registrados nelas, mas não são promoção automática para a nova barra vNext. O prompt e os artefatos vNext permanecem alterações locais até um commit explícito.

Comandos de descoberta executados: `git status --short`, `git log -1 --oneline`, `git remote -v`, validação de todos os JSON/JSONL de `.agent/`, `.gauntlet/` e `.agent/gates/`, inventário de fontes e migrations, leitura dos documentos `docs/00`–`docs/12`, inspeção do `server.ts`, manifests, testes, compose, configuração e documentação local do DeepSeek Harness.

## 2. Classificação de engenharia

| Campo | Decisão | Justificativa |
|---|---|---|
| Perfil | `BROWNFIELD` | Há um artifact executável, testes, migrations, estado de execução e dependências existentes. |
| Modo | `EVOLUTION` com overlays `SECURITY`, `MIGRATION`, `INTEGRATION` e `AUDIT` | A etapa amplia e reorganiza uma base funcional sem apagar contratos ou migrations aplicados. |
| Estágio | `BUILD` → `VERIFY` → `REVIEW` | Cada fatia deve ser implementada, verificada e criticada em contexto fresco. |
| Tier | `T4_CONTROLS` | O sistema trata contexto clínico, autorização, auditoria, medicação, estoque, financeiro, integração externa e recuperação irreversível. |
| Risco | `CRITICAL` | Erros podem expor dados, duplicar efeitos, reativar autoridade restaurada ou produzir decisão clínica/financeira não autorizada. |
| Blast radius | `SYSTEM` | A mudança atravessa API, domínio, persistência, worker, UI, deploy, observabilidade e contratos. |
| Fonte de verdade | Domínio transacional do CVG | O agente e o DeepSeek Harness não podem se tornar fonte de verdade clínica, financeira ou de autorização. |

Não existe autoridade registrada para dados reais, credenciais externas, deploy, provider real, retenção legal, residência de dados, MFA de produção, RTO/RPO ou aceite de risco residual. Esses itens permanecem `UNKNOWN` ou bloqueados.

## 3. Inventário atual

| Área | Estado observado | Evidência / risco |
|---|---|---|
| API | BFF Fastify v5 em `apps/api/src/server.ts`, com 1.209 linhas e rotas v1 para identidade, operação, clínica, financeiro, IA e integrações | Funciona localmente, porém composição, autenticação, casos de uso, serialização, auditoria, persistência e tratamento de erro estão fortemente concentrados em um arquivo. |
| Web | React 19/Vite em `apps/web/src/main.tsx` e `styles.css` | Há estados locais e E2E Chromium em 375/768/1440; falta decomposição por rotas/features e cobertura de acessibilidade profunda, browsers e estados operacionais completos. |
| Contratos | `packages/contracts/src/index.ts`, `packages/contracts/src/api-catalog.ts` e `packages/contracts/src/version.ts` | Há envelope v1, IDs opacos, classes D0–D5, catálogo de rotas, compatibilidade v2 preparada e registro de upcasters executável que falha fechado sem migração aprovada. Validação uniforme de todas as respostas e uma migração v1→v2 real continuam fora do recorte. |
| Domínio | `packages/domain/src/index.ts` e `authorization.ts` | Invariantes e store sintético cobrem muitos contextos; o PDP ainda está embutido no domínio/BFF e não é um serviço ABAC separado. |
| Runtime de agentes | `packages/harness/src/index.ts`, 239 linhas, `GovernedHarness` determinístico | Há budget, policy, aprovação, quarentena, provenance e replay locais; a interface Agent Runtime pedida ainda não está separada do engine concreto e não há adapter DeepSeek executável. |
| Tools/integrations | `packages/integrations/src/index.ts`, 318 linhas | Gateway e outbox sintéticos existem; providers reais permanecem desabilitados, credenciais não são obtidas por secret manager e não há vertical externa completa com receipt real. |
| Persistência | `packages/persistence/src/index.ts`, PostgreSQL, snapshot JSONB e recovery manifest | Há transação, CAS, journal, ledgers, RLS, leituras selecionadas, outbox, inbox, efeitos, manifesto com watermark/fingerprint/digests e restore sintético; repositories completos, replay pós-watermark, stores externos e backup operacional gerenciado faltam. |
| Worker | `apps/worker` e `docker/worker.ts` são processos separados com ciclo de seis lanes e heartbeat | O scheduler e os hooks são locais e default-deny; stores/jobs de manutenção, provider/reconciliação e smoke de container ainda não foram executados. |
| Operação | `packages/ops/src/index.ts`, health/readiness/metrics/log redaction, catálogo de SLO/alertas | Telemetria é memória local e best-effort; há contratos sintéticos fail-closed ligados a runbooks, mas faltam OTel/collector, dashboards, alertas enviados e SLO/error budget medidos. |
| Dados | Migrations 001–018, `FORCE RLS` e FKs organizacionais sintéticas | O isolamento estrutural foi exercitado em PostgreSQL local; faltam PDP ABAC completo, políticas de retenção, exportação governada, backup externo e prova em ambiente semelhante à produção. |
| Deploy | `docker-compose.yml` contém PostgreSQL, migration job, web/API/worker/proxy e rede interna | Ainda faltam harness/telemetria/Redis opcional, imagens endurecidas verificadas, smoke integrado e pipeline de promoção executado. |
| CI/CD | `.github/workflows/ci.yml` declara gates locais, PostgreSQL, E2E, segurança, SBOM e containers | Workflow remoto, serviço PostgreSQL, build/scan de imagens e upload de artifact ainda não foram executados neste host. |
| Portabilidade | `.env.example` e scripts locais existem | Há dependência de comandos locais e documentação histórica; a auditoria deve impedir `/home/ricardo/` e preparar Linux/CI/VPS/container. |
| DeepSeek Harness | Repositório externo local em `/home/ricardo/deepseek-harness`, commit `5dda764ed3`, release `dsh-0.1.5-alpha.1` | O repositório documenta seams de LLM, sessão, tools, aprovação, storage e gateway, mas não é uma dependência declarada do CVG nem prova de runtime conectado. |

## 4. Mapa de execução atual e alvo

### 4.1 Caminho atual

```text
HTTP Fastify / server.ts
  ├─ autenticação, cookies, CSRF, contexto e rate limit
  ├─ serialização e respostas v1
  ├─ chamadas diretas ao CvgStore e ao GovernedHarness
  ├─ auditoria/idempotência no mesmo módulo
  └─ hooks de persistência PostgreSQL e integração

CvgStore em memória ou PostgresPersistence
  ├─ snapshot JSONB como reconstrução agregada
  ├─ tabelas normalizadas para leituras selecionadas
  ├─ audit/receipt/outbox/inbox/effects
  └─ RLS estrutural e quarentena de restore

React/Vite → API v1
DeepSeek Harness → somente referência documental; nenhum processo externo conectado
```

### 4.2 Caminho obrigatório vNext

```text
CVG Domain
  → Application Use Cases
  → Agent Runtime Interface
  → Harness Adapter
  → DeepSeek Harness / provider

HTTP routes
  → request context + schema
  → PDP/ABAC
  → application service
  → domain invariant
  → typed repository / transaction
  → outbox + audit + receipt
  → worker / external provider
  → provider receipt or OUTCOME_UNKNOWN
  → reconciliation and append-only provenance
```

O domínio não deve importar DeepSeek, Codex, OpenAI, Anthropic, MCP, processo, URL ou detalhe de provider. A UI não deve decidir autorização nem interpretar ausência de dados como permissão.

## 5. Pontos fortes preservados

O artifact já possui contratos compartilhados, IDs opacos, validação Zod, envelope de erro correlacionável, cookie HttpOnly, CSRF, sessão revogável, rate limit local de login, contexto explícito, minimização por papel e negação de capabilities fora do recorte.

O domínio mantém histórico lógico para documentos clínicos, ledger financeiro e movimentos de estoque, com invariantes de agenda, medicação, lote e refund; o Harness local tem aprovação one-shot, budget, replay, provenance e quarentena de conteúdo não confiável.

A camada PostgreSQL registra BEGIN/COMMIT/ROLLBACK, CAS, journal independente, auditoria, receipts, outbox com lease/fencing, inbox assinado, efeitos externos, reconciliação, RLS forçado no catálogo e FKs de proveniência organizacional. O restore sintético cifra o bundle com AES-256-GCM, rejeita adulteração, restaura em quarentena e não reativa sessões.

O ciclo anterior possui evidência local de typecheck, testes, build, static, E2E, contraste, auditoria de tokens, dependências e PostgreSQL/restore sintéticos. A crítica independente round 4 manteve a barra integral em `FAIL_WITH_LIMITATIONS`; esse veredito é a base honesta para a nova etapa.

## 6. Gaps contra a especificação vNext

| Prioridade | Gap | Consequência | Estado |
|---|---|---|---|
| P0 | Falta uma interface Agent Runtime com adapter Mock e DeepSeek separados | O BFF conhece o engine local e não consegue trocar runtime/provider com lifecycle, cancelamento, budget e provenance uniformes | `OPEN` |
| P0 | Tool Gateway/PDP ainda não têm prova de uso universal em todas as rotas | A fatia de detalhe de paciente valida sessão, capability, alvo e escopo, mas aprovação, escopo, risco, classe de dados, egress e decisão ainda podem divergir por rotas não migradas | `OPEN` |
| P0 | `server.ts` concentra toda a aplicação | Aumento de acoplamento, teste difícil, ownership difuso e risco de bypass no próximo contexto | `OPEN` |
| P0 | Provider real, secret provider e consulta externa não estão disponíveis | Não é possível provar a primeira vertical real, receipt externo, settlement, callback ou reconciliação | `BLOCKED_BY_AUTHORITY/DEPENDENCY` |
| P0 | Backup, restore e fault injection são sintéticos e parciais | Não há RTO/RPO, watermark completo, replay seguro ou prova operacional | `OPEN` |
| P0 | Auth de produção, MFA, recuperação e revogação distribuída faltam | Sessão em memória não serve como autoridade de produção | `OPEN` |
| P1 | Repositories tipados não cobrem todos os contextos | O snapshot agregado continua sendo fonte de reconstrução para parte importante do domínio | `OPEN` |
| P1 | Worker não é aplicação separada | Não há least privilege, health/readiness e escalabilidade operacional por processo | `OPEN` |
| P1 | Frontend ainda é monolítico e offline é apenas contenção | Falta composição de rotas/features, cache autorizado, lease, purge e `CONTEXT_INVALID` persistente | `OPEN` |
| P1 | Deploy, CI, SBOM, headers, config typed e runbooks estão incompletos | Não há caminho reprodutível de artifact até ambiente controlado | `OPEN` |
| P1 | OTel, dashboards, alertas, SLO e error budget não estão medidos | Falhas e degradação podem ser observadas apenas depois do incidente | `OPEN` |
| P1 | Knowledge governance e provenance ainda são locais | Não há pipeline de documentos APPROVED, owner, checksum, expiração e escopo em produção | `OPEN` |
| P2 | Benchmarks, browser matrix e acessibilidade profunda não estão executados | A alegação Triplo AAA não pode ser sustentada | `NOT_RUN` |
| P2 | ADRs/runbooks/documentos vNext não existem | Decisões, limites e procedimentos não são rastreáveis para operação | `OPEN` |

## 7. Dependências e autoridade

| Dependência | Disponibilidade observada | Uso permitido nesta etapa | Bloqueio |
|---|---|---|---|
| Node/npm e dependências do workspace | Disponível localmente | Build, testes, refatoração e gates determinísticos | Nenhum para desenvolvimento local. |
| PostgreSQL sintético | Disponível por socket conforme evidência anterior | Verificação de migrations, RLS, transação e restore sintético | Não prova serviço de produção, backup gerenciado ou carga. |
| Docker/compose | Manifesto parcial; disponibilidade de runtime precisa ser revalidada antes do uso | Desenvolvimento e smoke se disponível | Não criar topologia de produção por inferência. |
| DeepSeek Harness local | Código e documentação presentes fora deste repositório | Inspeção contratual e adapter opcional, sem editar o repositório externo | Falta contrato de integração CVG aprovado, processo de execução autorizado e ambiente de provider. |
| Secret manager | Nenhuma autoridade/endpoint/credencial registrados | Implementar porta e providers de desenvolvimento sem segredo real | Provider real permanece bloqueado. |
| Messaging/payment/calendar/lab real | Apenas contrato sintético/deny-by-default | Testes de contrato e fault injection local | Vertical externa e settlement exigem autoridade e credencial. |
| Dados reais e decisão clínica/financeira | Não autorizados | Fixtures sintéticas e classificação D0–D5 | Bloqueio absoluto nesta etapa. |

## 8. Plano de migração incremental

### Onda A — Controle e contratos

Criar a barra vNext sem alterar `.gauntlet/bar-v2.json`, atualizar o ExecPlan e o estado para `T4_CONTROLS`, criar catálogo de capabilities/risco/classes de dados, endurecer configuração typed e publicar ADRs 001–008. Nenhuma feature real é habilitada nesta onda.

### Onda B — Runtime, Tool Gateway e PDP

Extrair `packages/agent-runtime`, `packages/agent-policy` e `packages/agent-tools`; definir `health`, `createSession`, `executeTurn`, `approve`, `replay` e `shutdown`; implementar Mock adapter determinístico e DeepSeek adapter que falha fechado quando o processo/versão/capability manifest não estiver disponível. Todas as tools devem passar por metadata, schema, risco, escopo, classe D, aprovação, timeout, idempotência, audit e egress.

### Onda C — Application layer e API modular

Separar `apps/api/src/app`, `plugins`, `middleware`, `auth`, `context`, `routes`, `services`, `errors` e `telemetry`; manter `server.ts` como entrypoint menor que 300 linhas. Cada rota deve chamar um use case que resolve autorização, transação, domínio e repository. A migração deve preservar `/api/v1` e permitir rollback por composição.

### Onda D — Persistência e execução assíncrona

Definir repositories por contexto, unidade de trabalho, outbox/inbox/effect ledger e receipts de provider; criar `apps/worker` com jobs bounded, claim/lease/fence, backoff, dead-letter/quarantine e reconciliation. Migrations novas são aditivas, ordenadas e checksumadas; migrations 001–018 não serão editadas.

### Onda E — Segurança, frontend e operação

Adicionar configuração fail-closed, `SecretProvider` por ambiente, auth boundary de produção, headers, rate limits por categoria, estados offline explícitos, app web modular, Docker endurecido, CI, SBOM, OTel, SLOs medidos, backups e runbooks. O modo sintético continuará isolado e claramente identificado.

### Onda F — Vertical e release evidence

Implementar Appointment → staged communication → aprovação humana → provider → outbox → receipt → audit → reconciliation apenas quando houver autoridade e provider reais. Sem isso, a vertical deve permanecer em `NOT_RUN`, com sink sintético explicitamente limitado e sem claim de entrega externa.

### Onda G — Gauntlet

Executar testes unitários, integração, contrato, banco real, auth/security, E2E, fault/recovery, performance, visual e operação; então solicitar críticas independentes frescas de arquitetura, segurança/dados, AI runtime, backend/reliability, frontend e operações. Qualquer blocker mantém o resultado abaixo de AAA.

## 9. Impacto por módulo

| Módulo | Ação planejada | Dono da mudança |
|---|---|---|
| `packages/contracts` | adicionar IDs/commands/events/runtime/tool/policy/provenance/config/health e compatibilidade v1/v2 preparada | lead + contrato |
| `packages/domain` | conservar invariantes; remover dependência conceitual de provider; expor ports de aplicação | domínio |
| `packages/harness` | tornar adapter legado compatível com interface nova ou mover engine para runtime mock | AI runtime |
| `packages/integrations` | reduzir ao gateway/ports/adapters e reconciliação; manter deny-by-default | integração |
| `packages/persistence` | separar unidade transacional, repositories, backup/recovery e ledgers | dados |
| `apps/api` | decompor entrypoint e rotas; centralizar authz/erro/telemetria sem bypass | API |
| `apps/worker` | novo processo para outbox, jobs e reconciliação | operações |
| `apps/web` | decompor app, rotas, features, API client e design system | frontend |
| `db/migrations` | novas migrations somente aditivas; índices, policy e catálogo de jobs/backup | dados |
| `scripts` | config audit, production verify, fault drills, benchmark e migration checks | operações |
| `.github/workflows` | criar pipelines de qualidade, segurança, banco, E2E, container e SBOM | CI |
| `docs/adr`, `docs/runbooks`, docs vNext | registrar decisões e procedimentos atuais | documentação |

## 10. Estratégia de rollback e recuperação

Cada onda deve alterar um conjunto disjunto de arquivos, ter um commit lógico e manter o modo `memory` sintético como fallback explícito de demonstração. A reversão de aplicação será feita por commit/revert ou por flag de composição; não haverá `git reset --hard`, force push ou edição de migration aplicada.

Mudanças de schema seguem expand/contract: adicionar tabela/coluna/policy compatível, dual-read/dual-write somente com evidência, backfill auditado, cutover reversível e remoção em migration posterior após retenção definida. Um snapshot restaurado entra em quarentena e não desfaz efeitos externos; efeitos desconhecidos são consultados por receipt/reconciliation antes de qualquer repetição.

Se um gate falhar, preservar logs, artefatos e falha; voltar somente o componente introduzido pela onda que falhou; executar smoke, testes de regressão e fingerprint antes de continuar. O principal kill switch permanece fechado para provider, egress, dados reais, break-glass e produção.

## 11. Bloqueios e decisões humanas necessárias

O adapter DeepSeek pode ser implementado como integração de processo/HTTP documentada e testável, mas não deve alegar conexão real sem endpoint, processo, health, versão, capability manifest, credencial e teste executado. O repositório externo não será editado como parte desta tarefa.

Para promoção operacional ainda são necessárias autoridade nomeada, política de retenção, classificação aprovada, residência/região, MFA e recuperação, secret manager, provider contracts, limites de custo, RTO/RPO, SLO/error budget, suporte, incident response, backup ownership e aceite de risco residual.

Até essas decisões, o sistema deve permanecer em loopback/fixtures, com real providers bloqueados também na API e nos workers. Nenhuma tela, métrica ou documentação pode usar um stub como evidência de entrega externa.

## 12. Critério de saída da Fase 0

Esta auditoria atende à saída documental da Fase 0: mapeia arquitetura corrente, forças, gaps, riscos, dependências, trust boundaries, módulos afetados, sequência de migração e rollback. O próximo passo autorizado é criar a barra vNext e executar a Onda A; a implementação ampla só começa após essa barra e o ExecPlan estarem persistidos.

**Veredito da auditoria:** `PASS_WITH_LIMITATIONS` para iniciar BUILD local controlado; `FAIL` para qualquer claim de produção, AAA, dados reais ou provider real.

## 13. Delta implementado depois da auditoria

A Fase 0 autorizou a fundação; a implementação subsequente já adicionou os seguintes componentes, todos ainda sujeitos à barra v3 e sem habilitar efeitos externos:

| Componente | Evidência atual | Limite que continua aberto |
|---|---|---|
| Runtime de agentes | `packages/agent-runtime` + `packages/harness-adapters`, lifecycle, health, replay, promoção e contrato DeepSeek fail-closed | processo/protocolo DeepSeek real, cancelamento distribuído e provider externo não executados |
| PDP e Tool Gateway | `packages/agent-policy` + `packages/agent-tools`, catálogo de seis tools, risco, aprovação independente, timeout, idempotência e digest; detalhe de paciente com sessão/capability/resource target-bound | nem toda rota/repository usa o gateway/PDP universalmente; execução externa está bloqueada |
| API/application layer | `apps/api/src/server.ts` virou entrypoint pequeno; health, agent e patient services/routes foram extraídos; detalhe usa `PatientApplicationService` | `apps/api/src/app.ts` ainda é grande e o grafo completo de use cases não foi fechado |
| Persistência | migration aditiva `019_runtime_scope_guards.sql`, escopo obrigatório nas projeções de IA, hydrate latest e asserção de schema | PostgreSQL limpo/multi-instância/RLS completo e restore operacional não foram executados nesta fotografia |
| Worker | `apps/worker` e `docker/worker.ts` separados, health, heartbeat, ciclo e seis lanes com default-deny | não existe sink/provider/store de jobs aprovado; lanes sem runner permanecem bloqueadas e o worker não declara entrega externa |
| Web | shell, rotas, features, hooks, cliente API e estados `ONLINE`, `OFFLINE_READ_ONLY`, `DEGRADED`, `CONTEXT_INVALID`, `REAUTH_REQUIRED` | matriz de browsers, acessibilidade profunda, cache autorizado, lease e purge não foram executados |
| Release | Dockerfiles, Compose, proxy, CI, Dependabot, política de licenças, verify-production e runbooks | daemon Docker, imagens, startup integrado, scan de imagem e promoção não foram executados; SBOM local passou |

Os gates locais reproduzidos nas fotografias anteriores são preservados como histórico. Na fotografia corrente, `npm run lint`, `npm run typecheck`, `npm test` (82/82), `npm run build`, `npm run verify:static` (35 artefatos/108 fontes), os testes dedicados de contrato/segurança/banco/fault, `npm run audit:licenses`, `npm run audit:contrast`, `npm run audit:tokens`, `npm run test:e2e` (22 executados, 2 skips intencionais), `npm audit --omit=dev`, `npm sbom --sbom-format cyclonedx`, `npm run benchmark:local`, `npm run verify:production` e `git diff --check` compõem os gates locais. A rota de detalhe de paciente, o Tool Gateway com ledger durável, a reconciliação de efeitos e o provider fail-closed também foram revalidados localmente. O verificador de release valida estrutura e Compose sem iniciar serviços; `verify:triplo-aaa` retorna `AAA_NOT_PROVEN` e `verify:staging` retorna `STAGING_EVIDENCE_INCOMPLETE` sem evidência externa. O veredito permanece `FAIL_WITH_LIMITATIONS`; nenhuma linha acima é evidência de produção ou de elegibilidade Triplo AAA.

## 15. Revalidação do artifact corrente — PDP target-bound do detalhe

A rota `GET /api/v1/patients/:id` agora carrega o paciente-alvo no contexto autenticado, passa por `PatientApplicationService`, obtém uma projeção mínima e revalida a policy com sessão, operação/capability registrada, `resourceId`, classe de dados, unidade e workspace antes de serializar. O repositório de memória trata alvo fora do escopo como ausência sem revelar o recurso; a leitura PostgreSQL permanece escopada pela consulta repository-owned e RLS é o backstop.

Os testes cobrem conhecido-bom e conhecido-ruim para sessão ausente/divergente, capability incompatível, alvo ausente/divergente, role/contexto fora do escopo e representação pública mínima. Após a mudança, `npm test` passou 67/67, `npm run test:database` 9/9, `npm run test:fault` 5/5, typecheck, lint, static 30/101, `verify:production` e diff check passaram; `--production` saiu 1 por configuração real ausente, fail-closed esperado.

Esta é uma fatia local delimitada: não fecha o critério de PDP/Tool Gateway universal, nem prova PostgreSQL production-like, CI remoto, provider, secret manager, fault distribuído, SLO, browsers adicionais ou revisão independente fresca.

## 14. Revalidação do artifact corrente — gates de CI e release

Depois da baseline, o artifact ganhou lint repository-owned, comandos separados para contrato, segurança, banco e fault/recovery, e um workflow que instala Chromium, inicia PostgreSQL efêmero, aplica migrations, executa verificação PostgreSQL/RLS e restore, e mantém build/scan de imagens bloqueantes. `scripts/verify-production.ts` exige esses controles no workflow e inclui os gates locais no comando único.

Na execução local corrente, `npm run verify:production` saiu com código 0 após completar esses gates locais e validar `docker compose config` com valores sintéticos; nenhum serviço foi iniciado. A execução `node --import tsx scripts/verify-production.ts --production` saiu com código 1 porque a configuração real obrigatória não existe no workspace, comportamento fail-closed esperado.

Esta seção não transforma a execução local em evidência de CI remoto: o serviço PostgreSQL do workflow, o runner GitHub, o build/scan de imagens e qualquer promoção continuam `NOT_RUN` nesta máquina. O maior gap corrente permanece a evidência production-like autorizada e a revisão independente final.
