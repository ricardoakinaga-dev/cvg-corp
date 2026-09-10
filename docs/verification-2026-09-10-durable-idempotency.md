# Verificação — idempotência durável de comandos retryable

Data: 2026-09-10
Resultado local: `PASS_WITH_LIMITATIONS`
Resultado global: `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`

## Escopo

Esta lane compõe `DurableIdempotencyService` no API runtime para comandos de
negócio, IA e exportação governada. O PostgreSQL admite o recibo `IN_FLIGHT`
antes do callback; replay, conflito de corpo, claim concorrente e falhas
seguem estados explícitos. `clinical.sign` continua no caminho especializado
com a mesma autoridade de claim por causa do CAS clínico e da validação do
resultado de replay.

## Evidência local

- `tests/unit/idempotency-service.test.ts` prova claim-before-work, replay sem
  segunda execução, claim concorrente, conflito de corpo e settlement de
  falha;
- `scripts/verify-static.ts` exige o artefato e a composição no request
  boundary;
- `scripts/verify-pdp-coverage.ts` exige `commands.execute` nos boundaries de
  IA/exportação, além de policy e encryption da exportação;
- `apps/api/src/app.ts` injeta uma única instância do executor no runtime e
  aplica o limite às mutações retryable.

## Execução registrada

- `npm test`: 153 testes, 152 pass, 1 skip condicional;
- `npm run test:database`: 35/35;
- `npm run test:fault`: 17/17;
- `npm run test:e2e`: 64 pass, 4 skips intencionais;
- `npm run typecheck`, `npm run build`, `npm run lint`, `npm run verify:static`,
  `npm run verify:pdp`, `npm run verify:production` estrutural e `git diff
  --check`: pass;
- `npm run verify:provider-sandbox`: pass no loopback HTTP; provider externo
  `NOT_RUN`;
- `npm run verify:triplo-aaa`: `AAA_NOT_PROVEN`; staging e DeepSeek sem
  configuração permanecem fail-closed;
- contraste, tokens e licenças: pass.

As tentativas de crítica fresh James/Parfit foram encerradas como
`NOT_COMPLETED` após janelas bounded; o sentinel
`/tmp/cvg-corp-idempotency-pre-critic-20260910.json` permaneceu inalterado.

## Limitações

Os testes desta lane usam store local e fake persistence; não são prova de
concorrência PostgreSQL real, RLS cross-tenant, crash/restart, reconciliação
operacional ou exactly-once em provider externo. O commit final ainda ocorre
no hook transacional do request e um erro ambíguo pode exigir reconciliação.
Login/MFA/recuperação/emissão de sessão permanecem sem replay genérico por
emitirem ou revogarem segredos. Não houve staging, provider/DeepSeek real,
Collector/SLO, carga/chaos/recovery production-like ou aceite humano.
