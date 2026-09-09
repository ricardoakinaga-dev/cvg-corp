# Deployment vNext

## Artifact

O caminho de release contém `Dockerfile.api`, `Dockerfile.web`, `docker-compose.yml`, proxy Nginx, worker separado, `.github/workflows/ci.yml`, `.github/dependabot.yml`, política SPDX local, scan Trivy de imagens no CI, `scripts/verify-production.ts`, baseline sintético, SBOM CycloneDX e runbooks de deploy, rollback e backup/incidente.

Compose define PostgreSQL, migration job, API, web, worker e proxy com healthchecks, dependências ordenadas, rede backend interna, containers read-only, non-root quando aplicável, capabilities removidas e sem publicação direta de API/worker. O worker Compose usa o mesmo `CvgWorkerApplication` de `apps/worker` e exige `CVG_WORKER_ORGANIZATION_ID` explícito.

## Gates reproduzidos

```bash
npm run typecheck
npm test
npm run build
npm run verify:static
node --import tsx scripts/verify-production.ts
git diff --check
```

O verificador usa valores sintéticos e valida o manifesto sem iniciar containers. O daemon Docker não foi usado para build/smoke nesta fotografia; portanto a imagem, startup integrado, migração em container e health real permanecem `NOT_RUN`.

No CI, o audit de dependências, a política de licenças, o SBOM, o scan Trivy de imagens e o upload do artifact são gates/artefatos separados. O scan de imagens está declarado no workflow, mas não foi executado neste host sem daemon Docker. Assinatura/proveniência do artifact e promoção entre ambientes ainda exigem integração operacional aprovada.

## Operação segura

O worker mantém `CVG_WORKER_SINK_MODE=quarantine` até que um sink governado exista. O runbook de deploy exige artifact imutável, configuração externa validada e smoke; rollback preserva schema/efeitos desconhecidos e exige reconciliação. Nenhum segredo é versionado ou embutido nos artefatos.
