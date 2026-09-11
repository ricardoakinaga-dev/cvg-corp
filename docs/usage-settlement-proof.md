# Prova do settlement de usage de IA

O ledger de IA agora carrega um `AiUsageSettlement` tipado junto do turno. Ele vincula modelo, tokens de entrada/saída, digest da resposta do provider, estimativa, custo efetivo e discrepância. Valores ausentes de preço usam `source: UNAVAILABLE` e `NOT_EVALUATED`; isso não é tratado como custo zero nem promove um settlement financeiro.

O harness local determinístico usa uma política explícita `LOCAL_SYNTHETIC` com custo zero apenas para o fixture. A aplicação rejeita um settlement cujo modelo ou contadores não correspondam ao turno canônico. Na projeção PostgreSQL, o settlement é incluído no `record` imutável do `ai_usage_ledger`, preservando a evidência através do digest e do replay.

Evidência local:

- `tests/unit/contracts.test.ts` valida o contrato e a representação fail-closed de custo ausente.
- `tests/unit/vnext.test.ts` confirma que o harness emite settlement vinculado ao turno.
- `tests/integration/persistence.test.ts` confirma a projeção de usage dentro da transação PostgreSQL sintética.
- `npm run typecheck`, `npm run lint` e `npm test` passaram.

O `providerRequestId` identifica a tentativa, mas não é tratado como digest da resposta; sem evidência fornecida pelo adapter, `providerResponseDigest` permanece `null`.

Pricing real do provider, resposta financeira assinada, reconciliação de divergência e settlement em staging continuam `BLOCKED_EXTERNAL`; nenhuma cobrança real é inferida pelos fixtures locais.
