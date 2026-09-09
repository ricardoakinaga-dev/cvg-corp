# Production readiness vNext

**Status:** `FAIL_WITH_LIMITATIONS` — desenvolvimento local controlado; produção não autorizada.

Este documento é o gate operacional da implementação vNext. Um check estrutural ou um teste sintético não promove o sistema para dados reais, provider externo ou release.

## Evidência disponível

- TypeScript: `npm run typecheck` — PASS.
- Testes unitários e de integração: `npm test` — 56/56 PASS.
- Artifact web: `npm run build` — PASS.
- Verificação estática: `npm run verify:static` — PASS (23 artefatos, 97 fontes), incluindo a proibição de mutações de domínio diretamente no HTTP layer.
- E2E responsivo: `npm run test:e2e` — 15/15 PASS em Chromium, 375/768/1440.
- Contraste/tokens: `npm run audit:contrast` e `npm run audit:tokens -- --strict` — PASS; zero high/critical, 72 sinais médios heurísticos.
- Supply chain local: `npm audit --omit=dev`, `npm run audit:licenses` e SBOM CycloneDX — PASS.
- Release/Compose: `node --import tsx scripts/verify-production.ts` — PASS estrutural; nenhum serviço iniciado.
- Workspace: `git diff --check` — PASS.

## Bloqueios de promoção

1. PostgreSQL limpo, RLS, restart, restore e concorrência production-like precisam de execução registrada em ambiente dedicado.
2. Secret manager aprovado, rotação, referência de token e política de retenção/residência ainda não foram fornecidos.
3. O adapter DeepSeek é uma ponte CVG `/v1`; health, manifest, commit, capabilities e tool-set reais não foram observados.
4. O worker só opera em quarentena sem sink externo aprovado.
5. Não há provider real, callback, receipt verificável, settlement ou reconciliação externa.
6. MFA, recuperação de conta e sessão distribuída de produção não estão implementados.
7. O scan local de dependências e a política de licenças passaram; scan de imagem declarado no CI, browsers adicionais, carga, collector OTel, alertas, SLO/RTO/RPO e aceite independente ainda não foram executados.

## Regra de decisão

Enquanto qualquer bloqueio obrigatório estiver aberto, o ambiente deve permanecer com dados sintéticos, egress fechado e `OFFLINE_READ_ONLY` quando perder autoridade. A promoção exige evidência atual, dono nomeado, critérios de abortamento e aprovação humana registrada; intenção ou presença de código não é evidência.
