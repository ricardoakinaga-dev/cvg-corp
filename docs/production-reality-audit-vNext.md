# Auditoria de realidade de produção — CVG-Corp vNext

**Data da fotografia:** 2026-09-09
**Commit observado:** `c7ee3acc1849ab7652ca0943b01947301a7e291a` (`feat: tighten tool gateway authorization`)
**Objetivo:** registrar o estado executável antes da implementação do prompt preservado em [`prompt-state-of-the-art-triplo-aaa-2026-09-09.txt`](prompt-state-of-the-art-triplo-aaa-2026-09-09.txt).

## Atualização corrente — implementação do prompt preservado

As seções abaixo preservam a auditoria histórica anterior à implementação. Esta atualização é a fonte corrente para a entrega deste commit.

O prompt foi salvo byte a byte em [`docs/prompt-state-of-the-art-triplo-aaa-2026-09-09.txt`](prompt-state-of-the-art-triplo-aaa-2026-09-09.txt), com SHA-256 `e6f6cb4b81f333433d7a5e7b497b602d4c266b107fb772925aaf9d0369ebdd79`. A arquitetura foi estendida sem transferir autoridade ao Harness: domínio → application layer → policy enforcement → AgentRuntime → Harness Adapter → DeepSeek Harness; o Tool Gateway exige sessão, alvo, escopo, digest, idempotência e ledger durável no caminho governado.

### Evidência local executada

| Gate | Resultado | Limite da evidência |
| --- | --- | --- |
| `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify:static`, `npm test` | PASS; 82/82 testes; lint 106 fontes; static 35 artefatos/108 fontes | execução local/sintética |
| `npm run verify:production` | PASS estrutural; Compose validado com valores sintéticos e limites de recursos | não iniciou serviços |
| `npm run test:e2e` | PASS; 22 testes executados em Chromium nos viewports 375/768/1440; 2 skips intencionais | Firefox/WebKit, axe e leitor de tela não executados |
| contraste, tokens, licenças, SBOM e auditoria de produção | PASS; contraste 7/7, 0 findings high, 72 medium heurísticos, 193 licenças, `npm audit --omit=dev` sem vulnerabilidades | tokens são análise estática; SBOM/auditoria local |
| `npm run verify:triplo-aaa` | `AAA_NOT_PROVEN`, exit 2; gates locais PASS, auditoria de registry `NETWORK_BLOCKED`, evidências externas `NOT_RUN` | fail-closed por desenho |
| `npm run verify:staging` | `STAGING_EVIDENCE_INCOMPLETE`, exit 2; URL não configurada, nenhuma requisição feita | não há staging autorizado nesta máquina |

### Blockers preservados

Docker CLI/Compose estão instalados, mas o daemon não é acessível pelo socket `/var/run/docker.sock`. Não foram executados PostgreSQL production-like/restore operacional, startup e scan de imagens, CI remoto, DeepSeek/provedor real, secret authority, egress/callback, collector/SLO medido, carga, recovery distribuído, Firefox/WebKit/axe ou aceite humano. Os críticos frescos Bacon e Hubble revisaram o artifact somente leitura e mantiveram `FAIL_WITH_LIMITATIONS`, apontando principalmente a ausência dessas provas externas e a necessidade de completar a cobertura universal em ambientes reais. Nenhum dado real, credencial, break-glass, egress ou release foi acionado.

O veredito corrente é `FAIL_WITH_LIMITATIONS`: a implementação local está compilável, testada e fail-closed, mas não é elegível para `STATE_OF_THE_ART_CANDIDATE` ou `TRIPLO_AAA_VERIFIED` sem as evidências e aprovações exigidas pela barra congelada.

## Veredito da fotografia histórica

O repositório é uma base brownfield local-first com uma demonstração sintética relativamente completa e várias barreiras de segurança já implementadas. Não é ainda um sistema de produção, homologação, piloto ou Triple AAA verificável.

O estado correto desta fotografia é `FAIL_WITH_LIMITATIONS` e `IN_PROGRESS`. A execução local também está momentaneamente vermelha: o endurecimento recente do Tool Gateway tornou `resourceRequired` e `sessionId` obrigatórios, mas os consumidores em `packages/harness` e `tests/unit/vnext.ts` ainda não foram atualizados. O primeiro passo de implementação é restaurar o contrato compilável e cobri-lo com casos positivos e negativos.

Nenhuma credencial, dado clínico real, provider externo, break-glass, deploy ou release foi acionado nesta auditoria.

## Evidência observada

| Área | Estado observado | Evidência | Limitação que permanece |
| --- | --- | --- | --- |
| Produto e stack | Implementado localmente | `apps/api` Fastify, `apps/web` React/Vite, `apps/worker`, packages de contratos/domínio/runtime/policy/tools/persistence/integrations/ops | Não há ambiente-alvo de staging executado nesta máquina |
| Contratos e API | Parcialmente implementado | `packages/contracts/src/index.ts`, `packages/contracts/src/api-catalog.ts`, `/api/v1`, schemas Zod e envelopes estáveis | Cobertura universal do PDP/application layer ainda não foi provada |
| Domínio | Implementado em memória com projeção PostgreSQL | `packages/domain/src/index.ts`, `apps/api/src/application/*`, migrations `001`–`020` | O snapshot JSON continua fonte agregada de reconstrução; repositories normalizados não cobrem todo o domínio |
| Runtime de IA | Interface e Mock implementados; adapter DeepSeek HTTP existe | `packages/agent-runtime`, `packages/harness`, `packages/harness-adapters` | O bridge fala o contrato CVG `/v1`; não há evidência de processo/protocolo nativo DeepSeek Harness executado |
| Tool Gateway/PDP | Barreira estática e autorização contextual implementadas | `packages/agent-tools/src/index.ts`, `packages/agent-policy/src/index.ts` | Há regressão de compilação no consumidor; universalidade de todas as rotas ainda não demonstrada |
| Outbox/effects/recovery | Ledger, lease/fencing, inbox, recibo, reconciliação e bundle cifrado implementados para testes | `packages/persistence/src/index.ts`, `packages/integrations/src/index.ts`, `scripts/verify-postgres*.ts` | Provider/consulta externa, backup gerenciado e recovery distribuído não foram exercitados |
| Worker | Processo separado e seis lanes observáveis | `apps/worker/src/worker.ts`, `docker/worker.ts`, `tests/unit/worker.test.ts` | Sink padrão é quarentena; jobs, provider, reconciliação e manutenção reais não estão configurados |
| Autenticação | Senha, lockout, recuperação, TOTP, sessões e rotação possuem primitives locais | `packages/auth/src/index.ts`, `db/migrations/020_auth_security_boundary.sql`, `apps/api/src/app.ts` | Secret manager, WebAuthn, canal de recuperação e sessão/rate-limit distribuídos não foram provados |
| Segredos | Providers `env` e `file` com referências e fail-closed; extensões cloud ainda são placeholders | `packages/integrations/src/index.ts`, `packages/config/src/index.ts` | Nenhum secret authority externo foi configurado; nenhum segredo pode ser inferido como disponível |
| Observabilidade | Logs redigidos, spans/metrics em memória e contratos SLO/alerta tipados | `packages/ops/src/index.ts`, `apps/api/src/app.ts` | Não há collector, Prometheus/Grafana/Alertmanager, SLO medido ou alerta operacional |
| Web/UX | Shell modular, estados offline/revalidação, agenda, pacientes, clínico, estoque, financeiro, copiloto e admin | `apps/web/src`, `tests/e2e/app.spec.ts`, `scripts/audit-design-tokens.ts`, `scripts/check-contrast.ts` | E2E configurado apenas para Chromium; Firefox/WebKit, axe/leitor de tela e inspeção visual independente não foram executados |
| Supply chain/deploy | Dockerfiles não-root/read-only e SBOM/licença/auditorias versionados | `Dockerfile.*`, `docker-compose.yml`, `.github/workflows/ci.yml` | Daemon Docker inacessível; imagens/containers não foram construídos/escaneados; actions não estão pinadas por SHA |

## Inventário realizado

Foram lidos o README, a documentação `docs/00`–`docs/12`, ADRs, runbooks, estado/backlog/plano do control plane, barra `.gauntlet/bar-v3.json`, runtime e adapter, contratos, PDP, Tool Gateway, domínio, API/application services, persistência, integrações, worker, frontend, Playwright, scripts, testes e migrations `001`–`020`. A orientação do repositório externo `/home/ricardo/deepseek-harness` foi consultada em `AGENTS.md` e `docs/architecture.md` sem editar esse repositório.

O prompt anexado foi copiado byte a byte. Os hashes SHA-256 coincidem:

```text
e6f6cb4b81f333433d7a5e7b497b602d4c266b107fb772925aaf9d0369ebdd79
```

Ambiente da fotografia:

- Node `v24.20.0`, npm `11.19.0` e Playwright `1.63.0` estão disponíveis.
- `psql` não está instalado.
- O binário Docker existe (`29.1.3`), mas o daemon retornou `permission denied` no socket `/var/run/docker.sock`; portanto nenhum serviço foi iniciado.
- O workspace estava limpo no commit observado, exceto a cópia nova do prompt não commitada.
- A verificação anterior do estado corrente registrou `npm run typecheck` falhando nos campos obrigatórios do Tool Gateway; esse fato é um blocker de build, não uma aprovação parcial do código.

## Arquitetura e limites de autoridade

O desenho alvo é:

```text
CVG Domain → Application Layer → Policy Enforcement → AgentRuntime
           → Harness Adapter → DeepSeek Harness
```

O Harness não deve ser autoridade sobre prontuário, estoque, financeiro, autenticação, autorização, auditoria ou segredos. O estado canônico deve continuar no domínio/persistência; a aplicação deve resolver contexto e PDP antes de mutar; o Tool Gateway deve ser o único caminho para tools; e efeitos externos devem passar por outbox, effect ledger, recibo e reconciliação.

O código já contém partes dessa arquitetura, mas a fotografia não prova o grafo completo. Em especial, ainda é necessário demonstrar por verificador estático e testes que não existem rotas, repositories ou adapters que contornem a autorização contextual, o application layer ou o gateway.

## Gaps, riscos e dependências

| ID | Gap ou risco | Severidade | Dependência | Estado |
| --- | --- | --- | --- | --- |
| B-001 | Consumidores não acompanham o contrato endurecido do Tool Gateway | Crítico | Atualização coordenada de harness e testes | Reproduzido |
| B-002 | Nenhum processo DeepSeek Harness compatível foi executado | Crítico | Endpoint/processo aprovado, manifest, commit, capabilities e protocolo observáveis | Bloqueado por ambiente |
| B-003 | Não existe `MessagingProvider` real habilitado | Crítico | Sandbox, credencial, callback assinado, contrato de dados e aprovação humana | Bloqueado por autoridade |
| B-004 | Secret providers cloud são somente extensões sem autoridade configurada | Crítico | Vault/KMS/serviço aprovado, rotação e política de acesso | Bloqueado por ambiente |
| B-005 | Egress e callback reais não foram testados | Crítico | Provider sandbox e rede/TLS de staging | Bloqueado por ambiente |
| B-006 | Durabilidade distribuída, leases e recuperação só têm prova sintética/local | Alto | PostgreSQL alvo, múltiplos workers, fault injection e backup gerenciado | Parcial |
| B-007 | PDP/application boundary não foi provado para todas as rotas e repositories | Crítico | Verificador de imports, matriz de operações e testes negativos completos | Aberto |
| B-008 | Repositories normalizados não cobrem todos os bounded contexts | Alto | Modelagem de tabelas, migrations aditivas, DML/RLS e migração segura | Aberto |
| B-009 | Observabilidade é local/in-memory; SLOs estão propostos, não medidos | Alto | OTel Collector/Prometheus, carga, janela e owners aprovados | Bloqueado por ambiente |
| B-010 | TLS público, CSP completa e limites de recursos não têm smoke de container | Alto | Daemon Docker, proxy de staging e revisão operacional | Bloqueado por ambiente |
| B-011 | Matriz Firefox/WebKit, axe e leitor de tela não foi executada | Alto | Browsers/deps e runner CI | Não executado |
| B-012 | Não existe gate único `verify:triplo-aaa`/`verify:staging` que agregue a barra sem overclaim | Alto | Contratos de status e artefatos de evidência | Aberto |
| B-013 | Não há aceite humano para dados, retenção, residência, break-glass, RTO/RPO, SLO e risco residual | Crítico | Donos de negócio, segurança, privacidade e operações | Bloqueado por decisão |
| B-014 | Revisão global em `cvg_state_snapshots` pode colidir entre organizações, embora a leitura de revisão seja por organização | Alto | PostgreSQL com duas organizações, migration forward-only e teste de concorrência | Risco reproduzível por inspeção |
| B-015 | Sem `ExternalEffectLedger`, uma falha de sink ainda pode virar `RETRY`; a política de `OUTCOME_UNKNOWN` precisa ser obrigatória para egress | Crítico | Wiring do worker e contrato de dispatch externo | Aberto |

Riscos principais: bypass de autorização; duplicação de efeitos quando o provider responde de modo desconhecido; vazamento de dado/segredo em logs, prompts ou telemetry; restauração de autoridade obsoleta; regressão da API v1/UI; e falsa promoção de evidência sintética para produção.

## Plano de implementação e verificação

1. Corrigir B-001 com `resourceRequired`, `sessionId`, alvo, escopo, digest, idempotência, egress e parser coerentes em todos os descriptors/requests; adicionar testes known-good/known-bad e verificador estático.
2. Fechar o grafo application layer/PDP para todas as mutações e leituras sensíveis, mantendo repositories como portas tipadas e RLS como backstop.
3. Corrigir B-014 com uma migration forward-only e prova multi-organização antes de promover a persistência como production-like.
4. Evoluir o catálogo de providers com `MessagingProvider` sintético e HTTP sandbox fail-closed, rate limit, circuit breaker, timeout, retry bounded, provider/request IDs, receipts e `OUTCOME_UNKNOWN` reconciliável.
5. Completar a persistência aditivamente: efeito de tool durable, outbox/worker com lease/fencing, crash points, replay após watermark, quarantine e idempotência same-key/same-digest; tornar o ledger obrigatório em qualquer caminho de egress (B-015).
6. Completar SecretProvider, autenticação/MFA/WebAuthn-ready, break-glass explícito e auditável, rate limiting distribuído e rotação, sem colocar valores secretos em código ou artefatos.
7. Instrumentar traces/metrics/logs com correlação e cardinalidade segura; entregar compose opcional de observabilidade, dashboards, alertas e SLOs com status `PROPOSED` até medição real.
8. Endurecer build/release: CSP/TLS configurável, limites de recursos, actions pinadas por SHA, SBOM/Trivy, migrações forward-only, `verify:triplo-aaa` e `verify:staging` fail-closed.
9. Executar os gates locais e, somente com ambiente/autoridade correspondentes, PostgreSQL/Docker, DeepSeek, provider, fault/recovery, carga/SLO, browsers e acessibilidade. Gerar scorecard por dimensão com evidência, limitação e risco.
10. Rodar críticos independentes frescos somente leitura com sentinel de mutação; integrar findings reproduzíveis; emitir `STATE_OF_THE_ART_CANDIDATE` ou `TRIPLO_AAA_VERIFIED` apenas se a barra congelada e as aprovações forem satisfeitas.

## Plano de rollback e não regressão

- Cada fatia deve ser um commit pequeno e reversível; antes de integrar, preservar `git diff`, estado do control plane e artefatos de verificação.
- Migrations aplicadas nunca são editadas. Evoluções são novas migrations, com checksum, compatibilidade, dry-run e rollback-forward documentado.
- Em falha de runtime, manter `CVG_STORAGE=memory`, sink `quarantine`, providers desabilitados e DeepSeek desligado; não habilitar fallback para egress.
- Em falha de migration ou restore, parar o processo, manter o banco de origem inalterado, quarentenar o destino e preservar ledgers/unknown effects para reconciliação.
- Antes de cada integração: `npm run typecheck`, testes focados, `npm test`, `npm run build`, `npm run verify:static`, `git diff --check`; quando a superfície alterar, E2E/contraste/tokens. PostgreSQL, restore, Docker, browser matrix e scans devem ser marcados `NOT_RUN` quando o ambiente não existir.
- Casos negativos obrigatórios: sessão ausente/divergente, alvo fora do contexto, role/capability incompatível, digest divergente, approval expirado/errado, segredo ausente, provider indisponível, timeout/recibo inválido, callback duplicado/adulterado, lease perdido, restore stale e configuração de produção incompleta.

## Critérios de aceitação da auditoria

Esta auditoria é considerada atualizada quando:

- o estado, commit, ambiente, evidências e limitações refletem comandos realmente executados;
- cada gap crítico tem owner, dependência, status e próximo teste reproduzível;
- nenhuma credencial, dado real ou efeito externo aparece nos artefatos;
- a implementação mantém o fluxo de autoridade e o fail-closed;
- o gate final distingue `PASS`, `NOT_RUN`, `PARTIAL`, `SYNTHETIC_ONLY`, `STAGING_ONLY`, `BLOCKED` e `FAIL_WITH_LIMITATIONS`;
- o scorecard não usa intenção, inspeção de source ou teste sintético como prova de produção;
- a decisão Triplo AAA continua sujeita a críticos independentes, ambiente estável e aprovação humana.

## Próxima ação executável

`CVG-FULL-STATE-OF-THE-ART:TOOL-GATEWAY-BOUNDARY` — atualizar os consumidores do contrato endurecido, restaurar `npm run typecheck`, adicionar casos negativos e então revalidar a superfície antes de iniciar a próxima onda.
