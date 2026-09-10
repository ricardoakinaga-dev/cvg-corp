# ADR 020 — Guard universal dos boundaries do PDP

## Status

Aceito para o ciclo vNext. A evidência é local e reproduzível; não constitui
prova de staging, PostgreSQL concorrente, RLS externo, provider real ou aceite
humano AAA.

## Contexto

O catálogo de policies e o `requestContext` já protegiam a borda HTTP, mas uma
lista manual de arquivos não garantia que um novo `ApplicationService` fosse
descoberto. Um serviço novo poderia compilar e ainda omitir o PDP sem que o
gate de cobertura percebesse.

## Decisão

`scripts/pdp-boundary.ts` é o guard canônico para
`apps/api/src/application` e para o `GovernedHarness`. Ele analisa a árvore
TypeScript e:

- descobre todas as classes com sufixo `ApplicationService` e
  `DomainCommandService`;
- exige uma chamada direta a `enforceApplicationPolicy` em cada boundary;
- exige que cada método público tenha enforcement direto ou uma delegação
  explícita para `this.run`/`this.authorize`;
- resolve literais, concatenações e templates canônicos, verificando cada
  operação contra `APPLICATION_POLICY_REGISTRY`;
- rejeita operação ausente, dinâmica, sem argumento ou desconhecida;
- aceita a delegação dinâmica do `DomainCommandService` somente porque todos os
  chamadores de `run`/`authorize` são enumerados estaticamente;
- permite health/readiness apenas com a anotação `@pdp-exempt health`, pois
  esse contrato não acessa ator, recurso, tenant ou classe de dados.

`verify:pdp` e `verify:static` executam o mesmo guard, incluindo o lifecycle
do harness. `verify:production`
trata o helper e os dois gates como artefatos obrigatórios. Assim, remover o
guard do build ou adicionar um boundary sensível sem policy vira falha de
verificação.

O worker não recebe um PDP HTTP artificial: ele consome apenas jobs/outbox já
autorizados e mantém os controles próprios de tenant, lease, fencing,
backpressure e effect ledger. Essa exceção arquitetural continua coberta pelos
invariantes específicos do worker em `verify:pdp`.

## Evidência

- `node --import tsx --test tests/unit/pdp-coverage.test.ts`: 4/4;
- o mesmo teste analisa todos os application boundaries reais e encontrou oito
  ou mais boundaries sem findings;
- os fixtures known-bad demonstram falha para ausência de enforcement,
  operação desconhecida e operação dinâmica;
- `npm run verify:pdp`, `npm run verify:static`, `npm run typecheck` e `npm run
  lint` passam localmente.

## Limites

O guard prova cobertura estrutural do código-fonte e resolução contra o
registry. Ele não substitui testes de autorização em runtime, RLS PostgreSQL,
isolamento multi-processo, staging, telemetria, provider/DeepSeek real, carga,
chaos, recuperação ou aprovação humana. O veredito global permanece
`FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN` até esses gates externos serem
executados com autoridade e evidência correspondente.
