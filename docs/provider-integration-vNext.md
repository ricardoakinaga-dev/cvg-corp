# Provider de comunicação — vertical controlada vNext

## Invariante

Uma intenção de comunicação pode ser staged e aprovada uma vez, mas um efeito
externo só pode ser considerado enviado com `providerRequestId` e receipt
verificável persistidos. Timeout, crash ou resposta inválida nunca recebe
retry cego.

## Fluxo

```text
communication.stage
  → approval independente
  → outbox transacional
  → worker com lease/fence
  → ExternalEffectLedger
  → provider
  → receipt/callback assinado
  → inbox deduplicada
  → effect ledger / audit ledger
```

`CURRENT`: o domínio cria uma mensagem `APPROVAL_REQUIRED`; persistência já
possui outbox, inbox, receipts e ledger de efeitos. O adapter de provider deve
ser provider-neutral, limitar payload, usar timeout, rate limit e circuit
breaker, e retornar `DELIVERED`, `RETRY` limitado, `QUARANTINE` ou
`OUTCOME_UNKNOWN` com IDs redigidos.

`PROPOSED`: o primeiro provider aprovado será um sandbox HTTP de mensagens,
com `Idempotency-Key`, endpoint de consulta para reconciliação e callback
HMAC-SHA256. Nenhum segredo ou egress é habilitado por código local.

## Estados e recuperação

- `ADMISSION_PENDING`: efeito preparado, ainda não despachado;
- `DISPATCHED`: chamada iniciada, portanto uma resposta perdida é desconhecida;
- `SUCCEEDED`: receipt persistido e outbox concluído;
- `FAILED_RETRYABLE`: falha antes do efeito, com orçamento e backoff;
- `OUTCOME_UNKNOWN`/`RECONCILIATION_REQUIRED`: dispatch não repetível até
  query aprovada;
- `QUARANTINED`: payload, receipt, callback ou autoridade não pôde ser
  validado.

## Evidência exigida

`SYNTHETIC_ONLY` cobre parser, timeout, receipt inválido, deduplicação,
reconciliação e ausência de retry. `STAGING_ONLY` exige provider sandbox,
segredo autorizado, TLS, callback real, consulta pós-timeout e ledger
durável. Sem ambos os conjuntos, a vertical continua `NOT_RUN` para produção.
