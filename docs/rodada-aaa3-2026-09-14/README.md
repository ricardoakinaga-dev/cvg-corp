# Rodada AAA3 — fotografia local de 14/09/2026

## Veredito

`FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.

Esta rodada integra as melhorias implementáveis no checkout atual e revalida o
programa contra a barra v4. O candidato continua em `BUILD`, com worktree
modificado e sem autorização para promoção. Nenhum teste local é apresentado
como prova de produção, provider externo, autoridade de secrets ou aceite
humano.

## Entregas integradas

- jornadas React separadas para exames, internação, comunicações,
  conhecimento e relatórios operacionais;
- validação semântica fail-closed no cliente, navegação por rota, estados de
  sessão/reconexão/logout e persistência browser governada;
- readiness com probes dinâmicos, capacidade manual explícita e relatório
  operacional filtrável, limitado e vinculado ao `ReadApplicationService`;
- orçamento multidimensional, settlement/uso desconhecido, autoridade ACP
  durável, claim/fence de worker e ponte DeepSeek sem fallback implícito;
- fence durável de dispatch que impede o callback externo quando a confirmação
  do claim se perde, com migration `037_command_receipt_claim_fence` exigida no
  inventário de readiness;
- PDP de aplicação também no caminho ACP direto, lock por sessão para
  admission/settlement serializados, rejeição de correlation divergente e
  alocação nativa somente depois da autorização;
- refresh de todos os adendos assinados após mutação, preservação do último
  estado válido em erro e guards contra resposta obsoleta nas novas rotas;
- fila da Agenda legível em 375 px com prioridade/status visíveis, semântica
  `h1`/heading principal nas jornadas novas e fixture temporal determinística
  para eliminar flakiness da suíte clínica;
- contrato de carga com leituras/escritas clínicas, IA, provider, receipt e
  backlog, além de gates de Alertmanager que rejeitam placeholder e sink sem
  autoridade;
- headings semânticos nas cinco jornadas novas, axe cobrindo todas as rotas
  primárias e correção de contraste nos badges de auditoria;
- ajustes de isolamento Playwright para portas, origem, data e concorrência
  entre projetos.

## Evidência local reproduzida

| Gate | Resultado observado |
|---|---|
| `npm test` | PASS — 404 testes: 403 pass, 1 skip, 0 falhas |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS — 179 arquivos-fonte |
| `npm run build` | PASS — Vite; aviso não bloqueante de chunk > 500 kB |
| `npm run verify:static` | PASS — 150 artefatos obrigatórios, 181 fontes |
| `npm run verify:pdp-universal` | PASS — 85 operações, 88 regras, 12 domínios críticos |
| `npm run verify:authoritative-writes` | PASS — 32 domínios, invariantes e tamper guard |
| `npm run verify:evidence-snapshot` | PASS — run `833f9da27f78b0d6a44a4ec346dbf7b66828ae58b71da2d18a3fbcd65776e704`, 10 artefatos, source SHA `1c22c5dc79c52151f4c7c94c4402dfdc86812cbc` |
| `npm run audit:contrast` | PASS |
| `npm run audit:tokens -- --strict` | PASS — zero achados high; heurística medium permanece informativa |
| `npm run verify:worker-runtime` | PASS — 6 policies, 35 focused tests |
| `npm run verify:resource-pressure` | PASS — 6 controles |
| `npm run verify:runbook-execution` | PASS — 12 controles |
| `npm run verify:security-red-team` | PASS — 24 critérios contratuais locais |
| `CVG_ALERTMANAGER_WEBHOOK_URL=http://127.0.0.1:19093/webhook npm run verify:alertmanager` | PASS — fixture de sink loopback |
| `npm run verify:triplo-aaa` | BLOCKED/AAA_NOT_PROVEN — gates locais executáveis; manifesto não possui bundle externo same-SHA nem aprovação independente/humana |
| `PLAYWRIGHT_WEB_PORT=5248 PLAYWRIGHT_API_PORT=4358 npm run test:e2e:smoke -- --output=/tmp/cvg-corp-e2e-final-r2-20260914` | PASS — 254 pass, 22 skips condicionais, 0 falhas; 276 casos em Chromium/Firefox + stress |
| `PLAYWRIGHT_WEB_PORT=5242 PLAYWRIGHT_API_PORT=4352 npx playwright test tests/e2e/accessibility.spec.ts --project=chromium-wide-1440 --project=chromium-tablet-768 --project=chromium-mobile-375 --project=firefox-wide-1440 --project=firefox-tablet-768 --project=firefox-mobile-375 --output=/tmp/cvg-corp-playwright-isolated-20260914` | PASS — 14 pass, 4 skips condicionais; axe nas rotas primárias nos seis perfis Chromium/Firefox |
| `npx playwright test --list` | PASS — 423 casos em 12 projetos; o script padrão `test:e2e` agora aponta para a matriz completa |
| `PLAYWRIGHT_WEB_PORT=5236 PLAYWRIGHT_API_PORT=4346 npx playwright test tests/e2e/accessibility.spec.ts --project=webkit-wide-1440 --grep "login, dashboard"` | BLOCKED_ENVIRONMENT — MiniBrowser não inicia: `libgstcodecparsers-1.0.so.0` ausente |
| `env -u DATABASE_URL npm run verify:postgres` | BLOCKED_EXTERNAL — URL PostgreSQL explicitamente identificada é obrigatória |

O teste visual foi inspecionado nos renders Chromium de 375, 768 e 1440 px:
[mobile](../../artifacts/runs/chromium-mobile-375-dashboard.png),
[tablet](../../artifacts/runs/chromium-tablet-768-dashboard.png) e
[wide](../../artifacts/runs/chromium-wide-1440-dashboard.png). A geometria tablet
da Agenda também foi capturada após a transição do drawer:
[agenda tablet](../../artifacts/runs/chromium-tablet-768-agenda.png).

## Limitações que permanecem bloqueadoras

- WebKit host-native não inicia neste ambiente por dependência ausente
  (`libgstcodecparsers-1.0.so.0`); não foi convertido em aprovação ou skip
  silencioso.
- `verify:load` retorna `LOAD_EVIDENCE_BLOCKED_EXTERNAL` até receber URL de
  staging, token da autoridade de secrets, p95 observado aprovado e workload
  completo.
- DeepSeek real, provider real, PostgreSQL multi-processo/gerenciado,
  container smoke, staging, collector/alert delivery, chaos/recovery/RTO/RPO,
  assistive technology, zoom real e CI same-SHA não foram executados nesta
  rodada.
- Os filhos AUD13-14A, AUD13-16A, AUD13-17A, AUD13-18A, AUD13-20A e AUD13-25A
  dependem das decisões D-01/D-02/D-03 ou de contratos ainda não autorizados;
  não foram inventados para fechar o backlog.
- Crítica fresh independente e aprovação humana ainda são gates separados; a
  barra v4 exige parecer independente, risco residual aceito e decisão ligada
  ao digest do candidato.

## Reprodução

Execute a partir da raiz do checkout. O smoke local cobre os perfis suportados;
`npm run test:e2e`/`npm run test:e2e:full` é a matriz completa e inclui WebKit:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run verify:static
npm run verify:pdp-universal
npm run verify:authoritative-writes
PLAYWRIGHT_WEB_PORT=5248 PLAYWRIGHT_API_PORT=4358 npm run test:e2e:smoke -- --output=/tmp/cvg-corp-e2e-final-r2-20260914
PLAYWRIGHT_WEB_PORT=5248 PLAYWRIGHT_API_PORT=4358 npm run test:e2e
PLAYWRIGHT_WEB_PORT=5249 PLAYWRIGHT_API_PORT=4359 npm run verify:production
npm run verify:triplo-aaa
```

O último comando deve permanecer fail-closed enquanto a evidência externa e a
aprovação humana não existirem. Nesta máquina, a matriz completa também para
no lançamento do WebKit por dependência nativa ausente; isso é reportado como
limitação de ambiente, não como aprovação implícita.
