# Verificação — guard universal do PDP — 2026-09-10

## Escopo

Esta lane fecha a lacuna estrutural da Fase 7: o guard deixou de depender de
uma lista manual de serviços e passou a analisar, por AST, todos os
`ApplicationService`, o `DomainCommandService` e o `GovernedHarness`.

## Evidência local

- `node --import tsx --test tests/unit/pdp-coverage.test.ts tests/unit/domain.test.ts tests/unit/vnext.test.ts`: 42/42;
- `npm test`: 158 testes, 157 pass, 1 skip;
- `npm run test:database`: 35/35;
- `npm run test:fault`: 17/17;
- `npm run test:e2e`: 64 pass, 4 skips intencionais;
- `npm run typecheck`, `npm run build`, `npm run lint`, `npm run verify:pdp`,
  `npm run verify:static`, `npm run verify:production`, contraste, tokens,
  licenças e `git diff --check`: pass;
- `verify:pdp`: 68 operações vinculadas, 70 policies de aplicação, 6 policies
  canônicas de tools, 12 domínios críticos e 9 boundaries AST analisados;
- fixtures known-bad demonstram findings para serviço sem PDP, método público
  bypass, operação desconhecida e operação dinâmica;
- runtime known-bad demonstra que o `GovernedHarness` não cria sessão sem
  contexto autenticado;
- `ai.approval.retry` foi verificado na rota, no serviço e no registry;
- `verify:m1`, `verify:production` e CI agora executam `verify:pdp` como gate
  explícito.

Durante a primeira execução de `verify:production`, o benchmark sintético
revelou que seu fixture criava um `CvgContext` sem sessão, incompatível com o
novo enforcement do harness. O fixture foi corrigido para criar uma sessão
sintética autenticada; o benchmark passou e uma nova execução completa de
`verify:production` terminou com sucesso.

## Critique independente

Foi aberta uma revisão fresh read-only após a regressão, com fingerprint
pré-critic `3ab434be12820bd3179a17a7fc0f485445a5c03d23192f0b9793550381c2cc1a`
no estado-base `25987b13d18706374c4c030bfbf283339897dd06`. O critic não
devolveu relatório após três janelas bounded e foi encerrado; não há aprovação
nem veto atribuível. A ausência do parecer é registrada como
`NOT_COMPLETED`, não como sucesso.

## Limites honestos

O scanner é uma prova estrutural do código-fonte, não uma prova de execução
em todos os processos. O worker continua com a autoridade própria de jobs e
outbox duráveis, tenant, lease, fencing, backpressure e effect ledger; não há
sessão de usuário sintética. Persistem sem evidência AAA a matriz completa de
PDP em PostgreSQL/RLS concorrente, handlers de produção, staging, provider e
DeepSeek reais, Collector/SLO operacional, carga/chaos/recovery externos,
WebKit/assistive-tech/zoom real e aceite humano. O veredito global continua
`FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.
