# Production readiness vNext

**Status:** `FAIL_WITH_LIMITATIONS` — desenvolvimento local controlado; produção não autorizada.

Este documento é o gate operacional da implementação vNext. Um check estrutural ou um teste sintético não promove o sistema para dados reais, provider externo ou release.

## Evidência disponível

- TypeScript: `npm run typecheck` — PASS.
- Testes unitários e de integração: `npm test` — 82/82 PASS.
- Artifact web: `npm run build` — PASS.
- Verificação estática: `npm run verify:static` — PASS (35 artefatos, 108 fontes), incluindo a proibição de mutações de domínio diretamente no HTTP layer.
- E2E responsivo: `npm run test:e2e` — 22 executados PASS em Chromium, 375/768/1440; dois skips intencionais da busca global em viewports móveis.
- Contraste/tokens: `npm run audit:contrast` e `npm run audit:tokens -- --strict` — PASS; zero high/critical, 72 sinais médios heurísticos.
- Supply chain local: `npm audit --omit=dev`, `npm run audit:licenses` e SBOM CycloneDX — PASS.
- Fault/worker local: `npm run test:fault` — 8/8 PASS; cobre crash após marcador, perda de lease, health, quarentena, lifecycle, ciclo de seis lanes e falha de runner, sem alegar distribuição ou container smoke.
- SLO/alert evaluator local: `tests/unit/ops.test.ts` — PASS; catálogo com oito sinais, targets `PROPOSED`/`TBD`, avaliação known-good/known-bad e `NOT_RUN` sem amostra; regras somente apontam para runbooks e não disparam alertas operacionais.
- Release/Compose: `node --import tsx scripts/verify-production.ts` — PASS estrutural; nenhum serviço iniciado.
- Gate AAA: `npm run verify:triplo-aaa` — `AAA_NOT_PROVEN`, exit 2; as evidências externas permanecem `NOT_RUN`/`BLOCKED`.
- Gate staging: `npm run verify:staging` — `STAGING_EVIDENCE_INCOMPLETE`, exit 2; sem URL explícita nenhuma requisição é feita.
- Perfil de produção: `node --import tsx scripts/verify-production.ts --production` — FAIL-CLOSED esperado por ausência de configuração real.
- Workspace: `git diff --check` — PASS.

## Bloqueios de promoção

1. PostgreSQL limpo, RLS, restart, restore e concorrência production-like precisam de execução registrada em ambiente dedicado.
2. Secret manager aprovado, rotação, referência de token e política de retenção/residência ainda não foram fornecidos.
3. O adapter DeepSeek é uma ponte CVG `/v1`; health, manifest, commit, capabilities e tool-set reais não foram observados.
4. O worker só opera em quarentena sem sink externo aprovado.
5. Não há provider real, callback, receipt verificável, settlement ou reconciliação externa.
6. MFA, recuperação, rotação, lockout e revogação existem na boundary local e passam em fixtures sintéticas; secret manager/KMS, canal de recuperação, rate limit distribuído e sessão compartilhada de produção ainda não foram executados.
7. O scan local de dependências e a política de licenças passaram; scan de imagem declarado no CI, browsers adicionais, carga, collector OTel, alertas operacionais, SLO/RTO/RPO medidos e aceite independente ainda não foram executados. O avaliador de SLO local é um contrato de harness, não uma medição de produção.

## Regra de decisão

Enquanto qualquer bloqueio obrigatório estiver aberto, o ambiente deve permanecer com dados sintéticos, egress fechado e `OFFLINE_READ_ONLY` quando perder autoridade. A promoção exige evidência atual, dono nomeado, critérios de abortamento e aprovação humana registrada; intenção ou presença de código não é evidência.
