# Deployment vNext

## Artifact

O caminho de release contém `Dockerfile.api`, `Dockerfile.web`, `docker-compose.yml`, o overlay `docker-compose.production.yml` com `docker/nginx/proxy.tls.conf`, proxy Nginx, worker separado, `.github/workflows/ci.yml`, `.github/dependabot.yml`, lint repository-owned, política SPDX local, scan Trivy de imagens no CI, `scripts/verify-production.ts`, baseline sintético, SBOM CycloneDX e runbooks de deploy, rollback e backup/incidente.

Compose define PostgreSQL, migration job, API, web, worker e proxy com healthchecks, dependências ordenadas, rede backend interna, containers read-only, non-root quando aplicável, capabilities removidas e sem publicação direta de API/worker. O worker Compose usa o mesmo `CvgWorkerApplication` de `apps/worker`, executa o ciclo observável de outbox/jobs/schedule/reconciliation/notifications/maintenance e exige `CVG_WORKER_ORGANIZATION_ID` explícito.

## Gates reproduzidos

```bash
npm run typecheck
npm run lint
npm run test:contract
npm run test:security
npm run test:database
npm run test:fault
npm test
npm run build
npm run verify:static
npm run test:e2e
node --import tsx scripts/verify-production.ts
git diff --check
```

O verificador usa valores sintéticos e valida o manifesto sem iniciar containers. O daemon Docker não foi usado para build/smoke nesta fotografia; portanto a imagem, startup integrado, migração em container e health real permanecem `NOT_RUN`.

No CI, lint, testes de contrato/segurança/banco/fault, E2E Chromium, migrations, verificação PostgreSQL/RLS, restore, audit de dependências, política de licenças, SBOM, scan Trivy de imagens e upload do artifact são gates/artefatos separados. O scan de imagens, o serviço PostgreSQL do workflow e a execução remota do CI não foram executados neste host. Assinatura/proveniência do artifact e promoção entre ambientes ainda exigem integração operacional aprovada.

## Operação segura

O worker mantém `CVG_WORKER_SINK_MODE=quarantine` até que um sink governado exista. O ciclo publica status, duração, contagens e lanes bloqueadas/fracassadas no heartbeat; runners de jobs, schedule, reconciliação, notificações e manutenção são injetáveis e ausências permanecem `BLOCKED`. O runbook de deploy exige artifact imutável, configuração externa validada e smoke; rollback preserva schema/efeitos desconhecidos e exige reconciliação. Nenhum segredo é versionado ou embutido nos artefatos.
