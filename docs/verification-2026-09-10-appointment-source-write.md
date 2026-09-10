# Verificação — escrita normalizada autoritativa de appointment

Data: 2026-09-10
Escopo: `CVG-FULL-STATE-OF-THE-ART:AUTHORITATIVE-NORMALIZED-APPOINTMENT-WRITE`

## Contrato verificado

`POST /api/v1/appointments` agora atravessa um `AppointmentApplicationService`
com port assíncrono. No modo PostgreSQL, o resultado novo do comando é passado
como `normalizedAppointmentWrite` para o mesmo commit durável que grava o
snapshot canônico, journal, auditoria, receipt e outbox. A linha de appointment
é gravada com unit/workspace obrigatórios e é removida da projeção genérica;
replay idempotente não repete a escrita. Divergência do snapshot, dependência
fora da organização/escopo ou conflito da linha existente falha como corrupção,
com rollback e restauração do baseline pelo boundary HTTP.

Arquivos principais:

- `apps/api/src/application/appointment-service.ts`
- `apps/api/src/app.ts`
- `packages/persistence/src/index.ts`
- `tests/integration/persistence.test.ts`

## Evidência local observada

- `node --import tsx --test tests/integration/persistence.test.ts`: **23/23**.
- `npm test`: **140 testes; 139 pass, 1 skip**.
- `CI=1 npm run test:e2e`: **64 pass, 4 skips intencionais** de quick-open em
  viewport estreito.
- `npm run typecheck`: pass.
- `npm run build`: pass; bundle Vite produzido.
- `npm run lint`: pass, 125 fontes.
- `npm run verify:static`: pass, 50 artefatos/127 fontes.
- `npm run verify:pdp`: pass, 68 operações/70 regras/6 policies/12 domínios.
- `npm run verify:production`: pass estrutural, sem iniciar serviços.
- `npm run audit:contrast`: 7/7 combinações pass.
- `npm run audit:licenses`: 207 pacotes em policy pass.
- `git diff --check`: pass.

Os testes de persistência e boundary HTTP usam pool sintético. Eles comprovam
o contrato de chamada, SQL, escopo e falha local, mas não substituem
PostgreSQL concorrente/RLS em ambiente real, staging ou carga production-like.

## Evidência remota do SHA exato

O commit `9c304f39621736ad8bb5f4b39447c4ac9d94fd25` foi publicado em
`origin/main` e o run GitHub Actions `34462488394`
(https://github.com/ricardoakinaga-dev/cvg-corp/actions/runs/34462488394)
terminou `success`. O job principal `102823305023` passou lint, typecheck,
contratos, segurança, banco, fault, testes unit/integration, provider loopback,
build/static, Browser E2E, migrations/PostgreSQL/RLS, restore, Compose/release,
performance sintética, SBOM, artefatos e whitespace. O job de imagens
`102825161621` passou os builds e scans das imagens API e web.

Essa observação fecha a publicação e o CI do SHA exato, mas CI não equivale a
staging, provedor externo, DeepSeek nativo, autoridade de segredos, telemetria
operacional, carga/recuperação production-like ou aceite humano.

## Crítica e limites

Dois critics frescos, não herdados e somente leitura, foram comissionados após
esta mudança. Nenhum parecer foi recebido no momento deste registro; nenhuma
aprovação foi inferida. O scout visual anterior confirmou que a matriz atual de
screenshots cobre apenas o happy path, que WebKit/assistive-tech/zoom real e
estados específicos DeepSeek/provider permanecem sem prova.

Continuam sem evidência obrigatória: provider externo, DeepSeek nativo,
autoridade de segredos, staging/TLS operacional, Collector/SLO medido,
carga/chaos/recovery production-like, browser matrix completa, PostgreSQL
concorrente fora do CI e aceite humano. `ops.restore` também permanece sem
replay seguro porque invalida sessões e limpa receipts canônicos.

## Veredito

Esta fatia local é `PASS_WITH_LIMITATIONS`. O veredito do programa permanece
`FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`; não há promoção nem alegação de
Triplo AAA.
