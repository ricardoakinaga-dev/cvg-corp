# Evidências locais da auditoria de entrega

Candidato e arquivos: baseline.json. Alterações autorizadas e preservação: sentinel.json. Achados: findings.json. Julgamento documental final: final-review.md.

Logs de teste/build/lint/static e browser foram capturados na cópia isolada. browser.log e browser-isolated.log registram bloqueios de portas; browser-freeports.log é INVALID por origem CSRF não alinhada e foi interrompido. browser-origin-corrected.log é a execução válida, 76 pass/4 skip, exit 0.

Os probes backend e frontend reproduzem defeitos; exit 0 deles não significa produto correto. Backend usa somente domínio/governance sintéticos. Frontend monta o Clinical real com ApiClient controlado; imagem não representa paciente real. Probe de roles usa contexto estoque no domínio. Ops usa handler health com dependências controladas e função de contratos de runbook.

Scripts capturados preservam caminhos da execução original. Para repetir em outro local, usar uma cópia isolada do candidato, substituir o prefixo /tmp/cvg-delivery-audit-20260913-bcsdpob2/repo nas importações pelo caminho da cópia, alinhar porta/origin/proxy dos configs e direcionar saídas para novo diretório temporário. probe.mjs requer Vite e ajuste da URL 50431 para a porta escolhida. Nunca apontar esses testes para produção.

Comandos usados na raiz da cópia:

```bash
npm test
npm run build
npm run lint
npm run verify:static
npm run verify:authoritative-writes
npx playwright test --config=audit-playwright.config.ts tests/e2e/app.spec.ts --project=chromium-wide-1440 --project=chromium-mobile-375 --workers=1 --reporter=list
node --import tsx audit-ops-probe.ts
node --import tsx audit-role-probe.ts
node --import tsx /tmp/cvg-delivery-audit-20260913-bcsdpob2/evidence/backend/probe.mts
```

Nenhum trace.zip de rede foi arquivado, evitando transportar cookies sintéticos desnecessários. Este diretório é evidência consultiva local, não bundle externo de promoção.
