# Verificação — escrita normalizada autoritativa de pacientes

Data: 2026-09-10  
Estado: `PASS_WITH_LIMITATIONS`  
Veredito global: `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`

## O que foi fechado

`POST /api/v1/patients` deixou de depender somente do `onSend` genérico para
alcançar a tabela normalizada. O fluxo agora:

1. executa o comando através de `idempotentAsync`, preservando o mesmo receipt
   e o mesmo recurso em replay;
2. mantém a criação no `PatientApplicationService` e no port assíncrono do
   repositório;
3. antes de responder, envia `normalizedPatientWrite` ao commit durável;
4. grava o paciente com escopo `organization/unit/workspace` dentro da mesma
   transação que snapshot, journal, auditoria, receipt e outbox;
5. exclui esse paciente do passe de projeção genérico, evitando duas escritas
   concorrentes para o mesmo fato;
6. restaura o snapshot de baseline e falha fechado se a escrita normalizada,
   revisão, RLS ou commit não puder ser confirmado.

Os pontos de implementação são [patient-service.ts](../apps/api/src/application/patient-service.ts),
[app.ts](../apps/api/src/app.ts) e [persistence/index.ts](../packages/persistence/src/index.ts).

## Evidência local

- `npm test`: 138 testes, 137 pass, 1 skip condicional.
- `npm run test:database`: 27/27.
- `npm run test:security`: 26/26.
- `npm run test:fault`: 15/15.
- `CI=1 npm run test:e2e`: 64 pass, 4 skips intencionais de quick-open em
  viewport estreito.
- `npm run typecheck`: pass.
- `npm run build`: pass.
- `npm run lint`: 124 arquivos-fonte, pass.
- `npm run verify:static`: 50 artefatos/126 fontes, pass.
- `npm run verify:pdp`: 68 operações/70 regras/6 políticas canônicas/12
  domínios, pass.
- `npm run verify:production`: pass estrutural; nenhum serviço foi iniciado.
- `git diff --check`: pass.

Os testes novos cobrem tanto o SQL autoritativo dentro do commit quanto o
boundary HTTP em modo PostgreSQL com pool sintético. Eles não substituem a
execução em PostgreSQL concorrente fora do CI, nem provam RTO/RPO ou produção.

## Limites ainda explícitos

Esta mudança fecha somente a criação normalizada de pacientes. Outras mutações
de domínio ainda passam pelo snapshot/projeção genérico; `ops.restore` continua
deliberadamente sem replay seguro porque o restore invalida sessões e limpa os
receipts canônicos. Staging autorizado, provedor/DeepSeek real, autoridade de
segredos, Collector/SLO operacional, carga/chaos/recovery production-like,
WebKit/assistive-tech/zoom real e aceite humano continuam ausentes. Nenhum
destes limites autoriza promoção ou classificação Triplo AAA.

## CI do SHA publicado

O run GitHub Actions `34458595207` concluiu `success` para o SHA
`78bd717442e99ef6f7c4aadbc45a9ea17dbd7d4a`. O job principal
`102810773997` passou Browser E2E, migrations/PostgreSQL/RLS, restore,
release/Compose, performance, SBOM, artefatos e whitespace. O job de imagens
`102812568853` passou build e scan das imagens API e web.

Essa é evidência de pipeline remoto vinculada ao commit, não evidência de
staging, provider/DeepSeek, segredo/KMS, Collector/SLO operacional, carga,
recovery gerenciado ou aceite humano.
