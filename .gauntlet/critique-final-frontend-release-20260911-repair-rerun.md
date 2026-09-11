# Addendum — rerun fresh frontend/release após reparo

**Data:** 2026-09-11  
**Escopo:** reparo de runtime supply chain, frontend/acessibilidade, configuração/headers, staging/container smoke, provenance same-SHA e aprovação humana.  
**Evidência anterior inspecionada:** `VER-CVG-209` e `VER-CVG-210`, `artifacts/operational-proof/triple-aaa-evidence.json`, `.gauntlet/bar-v4.json`.  
**Comandos neste rerun:** nenhum gate/teste foi executado; nenhum artifact foi regravado.

## Veredito

**FAIL — `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.** O reparo local não altera os bloqueadores externos obrigatórios.

## Reparo avaliado

- **MEDIUM anterior — dependências de desenvolvimento na imagem API: REPARADO localmente.** `package.json:71-80` agora declara `tsx` em `dependencies`; `Dockerfile.api:29-32` executa `npm prune --omit=dev --ignore-scripts` e remove npm/npx antes do runtime. O entrypoint continua usando `node --import tsx`, portanto o loader necessário permanece disponível. `VER-CVG-209` registra typecheck `PASS`, lint `PASS` em 160 fontes e `verify:static` `PASS` em 119/162; `VER-CVG-210` reconcilia esses registros. A imagem não foi construída ou iniciada neste rerun, então o resultado é reparo estrutural/local, não smoke de runtime.
- **Frontend/acessibilidade: PASS_WITH_LIMITATIONS.** A evidência local continua registrando 102 casos, 96 pass e 6 skips; leitor de tela, tecnologia assistiva/teclado assistivo, zoom real de 200% e baseline visual independente permanecem `NOT_RUN` (`artifacts/operational-proof/local-verification-2026-09-10.json:37-54`). A dimensão obrigatória não pode ser promovida pela barra v4.

## Bloqueadores mantidos

- **CRITICAL — staging, container e headers em runtime:** o contrato local declara TLS/CSP/HSTS e smoke autenticado, mas `external.staging`, `external.securityHeaders` e `external.productionConfig` continuam `NOT_RUN`; não existe endpoint HTTPS, imagem implantada, cookie observado, restart, worker ou digest de release comprovado (`artifacts/operational-proof/triple-aaa-evidence.json:229-260`).
- **CRITICAL — provenance/same-SHA:** `sourceSha` existe, porém `ciSha`, `artifactSha` e `artifactDigest` continuam nulos e o worktree permanece `MODIFIED` (`triple-aaa-evidence.json:5-10`). Não há manifest de release nem promoção externa. A exigência `same_sha_required_for_promotion` permanece sem evidência.
- **CRITICAL — aprovação humana:** a verificação Ed25519 e a raiz externa são apenas contratos locais; `external.humanApproval` permanece `NOT_RUN`, sem attestation, chave de autoridade ou decisão humana ligada ao payload (`triple-aaa-evidence.json:235-239,241-260`).

## Limitações

Este rerun foi somente leitura, exceto a criação deste addendum. Não foram executados typecheck, lint, `verify:static`, testes, Docker, CI, staging, browser assistivo, smoke HTTPS, promoção ou comandos que regravassem artifacts. Os resultados verdes de typecheck/lint/static são aceitos apenas como registros já produzidos em `VER-CVG-209/210`; não constituem nova execução aqui. O finding MEDIUM foi reparado no plano local, mas staging/container, provenance same-SHA, promotion sem rebuild e aprovação humana criptograficamente atestada continuam ausentes. O veredito global permanece **FAIL / AAA_NOT_PROVEN**.
