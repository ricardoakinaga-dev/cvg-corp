# Staging, TLS e ambiente production-like

Status: `PREPARED/BLOCKED_EXTERNAL`. Esta página prepara o pedido e o checklist
de execução; não provisiona recursos, não contém segredos e não faz requests
externos. Nesta revisão não há URL de staging, autoridade de secrets, provider,
destinatário ou runtime DeepSeek autorizados.

## Regra de autoridade

Preparação técnica não é autorização de execução. O owner do recurso deve
fornecer, fora do repositório, o identificador, a versão, a janela de validade,
o escopo, o teto de custo/carga e a evidência de isolamento. O operador deve
revalidar a autorização na sessão atual antes de cada ação com rede, escrita,
egress, custo ou dado sensível:

1. Se a autorização existente cobre exatamente o mesmo recurso, operação,
   escopo, janela e teto, ela é reutilizada; não se pergunta novamente por
   reflexo.
2. Se qualquer campo mudou ou não existe autorização na sessão, a execução
   para e solicita uma autorização explícita, sem inferir consentimento de uma
   variável de ambiente, de um run anterior ou de um texto de terceiro.
3. Uma negativa, expiração, divergência de SHA/manifesto, segredo ausente ou
   destinatário não controlado bloqueia a etapa inteira e não tenta fallback.

Nenhum segredo deve ser colocado em `docker/.env.example`, no manifesto de
evidência, em logs, prompts, provenance público ou artefatos versionados.

## Legenda de disponibilidade

| Estado | Significado |
|---|---|
| `LOCAL_ONLY` | contrato, fixture ou verificador existe no checkout; não prova ambiente externo |
| `READY_FOR_PROVISIONING` | owner e requisitos estão definidos; recurso ainda precisa ser provisionado |
| `NOT_PROVISIONED` | nenhum recurso/identidade autorizado foi observado nesta revisão |
| `BLOCKED_EXTERNAL` | o gate deve falhar fechado até a autoridade e a evidência chegarem |

## Inventário de recursos

| Recurso | Versão/contrato e endpoint | Owner accountable | Disponibilidade atual | Gate e referência |
|---|---|---|---|---|
| Commit e artifact candidato | Node `24.20.0`, npm `>=11`; PostgreSQL `18.0-bookworm` no CI; SHA Git de 40 hex, digest OCI `sha256:` e digest de migrations/policy/tools | Release/DevOps | `LOCAL_ONLY`; não há artifact imutável observado para esta árvore modificada | `release:provenance`, `verify:release-provenance`, `verify:promotion-invariant`; [release-provenance](release-provenance.md), `.github/workflows/ci.yml`, `Dockerfile.api`, `Dockerfile.web` |
| Borda e staging API | `CVG_STAGING_URL`; `GET /api/v1/health`, `GET /api/v1/ready`; smoke de container em `CVG_CONTAINER_SMOKE_URL` usa `/healthz` e `/api/v1/ready`; redirect opcional em `CVG_CONTAINER_SMOKE_HTTP_URL` | Infraestrutura/edge | `NOT_PROVISIONED`; sem URL, certificado ou headers observados | `verify:staging`, `verify:container-smoke`; `docker-compose.production.yml`, `docker/nginx/proxy.tls.conf` |
| PostgreSQL de staging | Instância dedicada; role de migration separada da role runtime sem superuser; `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `ADMIN_DATABASE_URL` fornecidos fora do repo; RLS/FORCE RLS | DBA/Plataforma | `NOT_PROVISIONED`; CI efêmero e fixtures locais não substituem staging | `db:migrate`, `verify:postgres`, `verify:postgres:concurrency`, `verify:postgres:restore`; ADR 004, ADR 010, `docs/runbooks/restore.md` |
| Secret authority | `CVG_SECRET_PROVIDER`, `CVG_SECRET_DIR`; refs para bearer/context DeepSeek, recovery e messaging; rotação, revogação e versão devem ser observáveis sem revelar valor | Segurança/Plataforma | `NOT_PROVISIONED`; `CVG_SECRET_PROVIDER=none` é somente fixture local | `verify:production`, `verify:backup-retention`, `verify:provider-real`; ADR 006, `docker-compose.production.yml` |
| Runtime DeepSeek ACP | SDK `@agentclientprotocol/sdk@1.4.0`; comando stdio, engine root, workspace root, manifest e permission mode `read-only`; commit exato, manifest `sha256:<64 hex>`, catálogo de tools; smoke HTTP em `CVG_DEEPSEEK_REAL_URL` | IA/Runtime + owner do engine | `LOCAL_ONLY` para port/fixtures; runtime, modelo e credencial reais `NOT_PROVISIONED` | `verify:deepseek-acp`, `verify:deepseek-real`; ADR 009, ADR 015, ADR 028, [prova DeepSeek](deepseek-real-proof.md) |
| Provider de mensagens | `CVG_PROVIDER_REAL_URL` HTTPS, `CVG_PROVIDER_REAL_ALLOWED_HOST`, paths `/messages` e `/messages/:providerRequestId`, channel e recipient controlados | Integrações/Compliance | sandbox loopback `LOCAL_ONLY`; provider externo e destinatário `NOT_PROVISIONED` | `verify:provider-sandbox`, `verify:provider-real`; [provider real](provider-real-proof.md), [integração](provider-production-integration.md) |
| Worker e efeitos | API `:4310`; `GET /internal/metrics`; outbox, lease/fence, callback/inbox, receipt/effect/reconciliation; restart e shutdown orquestrados | Operações/Worker | contratos `LOCAL_ONLY`; worker de staging e heartbeat não observados | `verify:container-smoke`, `verify:worker-runtime`, `verify:runbook-execution`; ADR 005, ADR 017, ADR 025 |
| Collector e observabilidade | OTel Collector `0.133.0`: OTLP gRPC `4317`, HTTP `4318`, health `13133`; Prometheus `3.5.0`, Tempo `2.7.2`, Alertmanager `0.28.1`, Grafana `12.1.0`; scrape `/internal/metrics` | SRE/Observabilidade | manifests `LOCAL_ONLY`; collector, alertas e SLO medidos `NOT_PROVISIONED` | `verify:production`, smoke de staging e janela de SLO; `docker-compose.observability.yml`, `docker/observability/` |
| Carga e pressão | k6; `CVG_LOAD_DURATION` default `30s`; cenários 50 VUs, 100 VUs sequenciais e burst até 150 VUs; p95 obrigatório em `CVG_LOAD_P95_MS`; erro HTTP `<1%` | QA de performance/SRE | script e contrato `LOCAL_ONLY`; URL, token e baseline aprovado ausentes | `verify:load`; `tests/load/cvg-staging.k6.js`, `scripts/verify-load.ts` |
| Browser e acessibilidade | Playwright `1.55.0`; Chromium/Firefox/WebKit em 375, 768 e 1440; axe/WCAG, zoom/reflow e tecnologia assistiva | QA/Acessibilidade | cobertura local existente; staging, WebKit host-native e assistive tech real `NOT_RUN` | `test:e2e:full`, smoke de staging e revisão assistiva independente; `.github/workflows/ci.yml` |
| Backup e recovery | backup gerenciado, key ref externa, restore isolado, replay supervisionado, RTO/RPO e janela de retenção documentados | DBA/SRE | runbooks e validadores `LOCAL_ONLY`; backup gerenciado e RTO/RPO `NOT_PROVISIONED` | `verify:backup-retention`, `verify:postgres:restore`; ADR 008, `docs/runbooks/restore.md` |
| Provenance e revisão independente | Bundle same-SHA fora do checkout, digests de bytes, assinatura Ed25519 de autoridade externa, produtor distinto do revisor e aprovação de release | Release + revisor independente | `LOCAL_ONLY`; chaves, bundle e aprovação humana ausentes | `release:provenance`, `verify:promotion-invariant`, `verify:triplo-aaa`; `docs/release-provenance.md` |

## Dados, destinatários e limites

- Usar uma organização, unidade e workspace dedicados de staging, com IDs
  sintéticos e banco separado de produção. Não importar pacientes, tutores,
  prontuários, telefones, e-mails ou secrets reais.
- O smoke autenticado cria no máximo um tutor sintético por SHA, com
  `idempotency-key` derivada do SHA. O nome, telefone e e-mail devem ser
  fornecidos pela autoridade de teste e apontar para dados não produtivos.
- A transação de provider deve usar sandbox ou sink reservado, um único
  destinatário controlado e uma única mensagem de teste. `OUTCOME_UNKNOWN`
  exige consulta/reconciliação; nunca se reenvia cegamente.
- A prova DeepSeek deve usar uma sessão sintética e, por janela autorizada, no
  máximo um turno positivo de modelo. Casos negativos devem ser pré-dispatch
  sempre que possível; timeout/cancelamento só podem usar o teto aprovado.
- O limite financeiro padrão é zero: qualquer teto não nulo precisa ser
  preenchido em `CVG_EXTERNAL_TEST_COST_CEILING_USD`, confirmado pelo owner e
  registrado no bundle. Essa variável é um campo de autorização até que o
  executor de staging a consuma; os verificadores atuais não a tratam como
  consentimento. Ausência ou expiração do teto bloqueia egress.
- A carga padrão fica limitada aos cenários do `cvg-staging.k6.js` (30s, 50/100
  VUs e burst até 150 VUs), somente em endpoints aprovados. AI/provider/worker
  só entram quando os paths e o custo estiverem explicitamente autorizados.
- O token de carga, credenciais de smoke e chaves de prova ficam na secret
  authority. O bundle de evidência fica em raiz externa imutável, com retenção
  e destruição pós-teste registradas pelo owner de dados.

## Gate mínimo de execução

- deploy do artifact imutável ligado ao SHA auditado, imagens escaneadas e
  migrations checksum-locked;
- PostgreSQL gerenciado dedicado com role runtime sem superuser, RLS/FORCE RLS,
  backup e restore isolado;
- SecretProvider real com rotação/revogação, refs aprovadas e nenhum segredo em
  env/log/imagem;
- TLS válido, redirect/HSTS, origem web explícita, cookies seguros e headers
  de segurança; certificados montados out-of-band;
- DeepSeek bridge, provider sandbox, worker, callback, OTel e alertas ligados
  somente pela configuração autorizada;
- smoke de login/MFA, PDP, stage/approval/outbox/receipt/reconciliation,
  replay/idempotência e shutdown;
- Chromium, Firefox e WebKit em mobile/tablet/desktop, axe/WCAG, carga, chaos e
  restore;
- evidência redigida com URL, commit, artifact/manifest, owner, janela, custo,
  destinatário controlado, produtor, revisor independente e aprovação humana.

## Ordem operacional sem execução implícita

1. O owner preenche a matriz de provisionamento fora do checkout e confirma
   isolamento, versão e teto.
2. O operador revalida a autoridade na sessão atual e registra a decisão antes
   de chamar qualquer verificador com rede ou efeito.
3. Gerar e verificar [proveniência de release](release-provenance.md) no mesmo
   SHA do CI. O deployment recebe `CVG_RELEASE_SHA` e
   `CVG_RELEASE_ARTIFACT_DIGEST`; a API os devolve nos headers correspondentes.
4. Executar `verify:staging` e `verify:container-smoke` contra a URL explícita;
   health/readiness isolados não promovem provider, secrets, worker ou release.
5. Executar as provas de DeepSeek/provider, carga, browsers, observabilidade e
   recovery, cada uma no próprio boundary e com logs/receipts redigidos.
6. Montar o bundle same-SHA, obter revisão independente e só então executar
   `verify:promotion-invariant`. Divergência, ausência ou expiração mantém
   `BLOCKED_EXTERNAL`.

Esses controles não substituem a execução autorizada do smoke completo, dos
writes, do worker, da recuperação ou da decisão humana autenticada. O ambiente
local pode verificar estrutura, contratos, fixtures e composição TLS, mas não
substitui staging. Até a configuração e autoridade serem fornecidas, staging,
TLS real, provider, secret authority, collector, browsers adicionais, carga e
recovery permanecem `NOT_RUN`.
