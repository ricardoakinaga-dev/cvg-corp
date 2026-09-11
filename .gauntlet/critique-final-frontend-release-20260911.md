# Critique final — frontend, release e produção

**Data:** 2026-09-11  
**Escopo:** frontend/acessibilidade, DevOps/supply chain, configuração de produção, containers/headers, provenance, mesmo SHA e aprovação humana.  
**Bar:** `.gauntlet/bar-v4.json` + `docs/prompt-final-operational-proof-2026-09-10.txt`  
**Veredito:** **FAIL** (`FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`).

## Evidência local

- **Frontend:** `PASS_WITH_LIMITATIONS`. A matriz local registra 102 casos, 96 pass e 6 skips em Chromium/Firefox/WebKit, além de axe para login/dashboard/admin (`artifacts/operational-proof/local-verification-2026-09-10.json:26-54`, `tests/e2e/accessibility.spec.ts:14-28`). O fluxo implementa foco de rota, estados live e reflow suplementar (`apps/web/src/app-shell/Shell.tsx:51-55`, `tests/e2e/accessibility-stress.spec.ts:35-55`).
- **Acessibilidade:** **HIGH — PARTIAL_ASSISTIVE**. Permanecem sem execução independente leitor de tela, tecnologia assistiva/teclado assistivo, zoom real de 200% e baseline visual independente (`docs/accessibility-proof.md:1-5`, artifact local `:48-54`). Pela barra, dimensão obrigatória parcial ou `NOT_RUN` não passa (`.gauntlet/bar-v4.json:16-20,52-64`).
- **Configuração e headers:** `PASS_WITH_LIMITATIONS` como contrato estático. TLS, HSTS, CSP, COOP/CORP, `nosniff`, frame policy, cookies e redirect HTTP estão declarados (`docker/nginx/proxy.tls.conf:14-44`, `docker-compose.production.yml:11-57`). `verify:production`/checks locais não iniciaram serviços; o próprio artifact mantém `securityHeaders`, `productionConfig` e `containerSmoke` como `NOT_RUN`/contrato local. Não há observação HTTPS em staging.
- **DevOps/supply chain:** `PASS_WITH_LIMITATIONS` local. O workflow declara `npm ci`, audit/licenças, SBOM, Trivy, builds e ações pinadas por SHA (`.github/workflows/ci.yml`). Isso não constitui evidência do SHA auditado no estado atual. Há também exposição residual **MEDIUM**: `Dockerfile.api:14-38` instala `--include=dev` e o runtime herda `node_modules` de desenvolvimento, sem prune de produção; a remoção do npm não remove essa superfície.

## Bloqueadores

- **CRITICAL — release provenance e mesmo SHA ausentes.** O artifact canônico registra `sourceSha=e43b3b0032aafb9d17563b1fce00fbae88ee0d51`, mas `ciSha=null`, `artifactSha=null`, `artifactDigest=null` e `worktree=MODIFIED` (`artifacts/operational-proof/triple-aaa-evidence.json:5-10`). Não existem `artifacts/release-provenance.json` nem manifesto de promoção no checkout. Isso viola `same_sha_required_for_promotion` e mantém F36/F37 bloqueadas.
- **CRITICAL — staging/container/security-header smoke não provado.** Não há endpoint, certificado, imagem implantada ou smoke externo que confirme health/readiness, headers, cookies, worker, restart e digest. A barra nomeia essa ausência como hard blocker (`.gauntlet/bar-v4.json:55-63`); configuração declarada não prova runtime.
- **CRITICAL — aprovação humana não provada.** O verificador exige decisão Ed25519 ligada ao payload, chave pública externa e evidência fora do worktree (`scripts/verify-promotion-invariant.ts:102-163`, `docs/release-provenance.md:9-11`), mas não existe manifesto/attestation e o artifact marca `humanApproval=NOT_RUN` (`triple-aaa-evidence.json:26-34`). Código que implementa a verificação não é aceite humano.

## Limitações explícitas

Não executei testes, browser, Docker, CI, staging, leitor de tela, tecnologia assistiva, zoom real, smoke HTTPS, promoção ou qualquer comando que regrave artefatos. A revisão é somente leitura, exceto este relatório. A matriz browser é local/sintética; não prova staging nem produção. CI same-SHA, digest de artifact, raiz externa imutável, promoção sem rebuild e aprovação humana criptograficamente atestada continuam ausentes. Portanto não há base para `PASS`, `PRODUCTION_READY`, `STATE_OF_THE_ART_CANDIDATE` ou `TRIPLE_AAA_CANDIDATE`.
