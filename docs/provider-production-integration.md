# Provider externo e efeitos de produção

Status: `PARTIAL/SYNTHETIC_ONLY`. O CVG tem contratos de provider, outbox, inbox, idempotência, recibos, efeitos desconhecidos e reconciliação fail-closed. Nenhum sandbox real de messaging foi executado nesta revisão.

## Fluxo obrigatório

```text
stage -> approval independente -> outbox durável -> worker com lease/fence
  -> provider sandbox -> receipt/callback assinado -> inbox deduplicada
  -> effect ledger -> reconciliação -> audit/settlement
```

O worker default mantém o sink externo em quarentena quando o provider real não está habilitado. `OUTCOME_UNKNOWN` nunca é convertido em reenvio cego: o efeito precisa de consulta/reconciliação ou revisão manual. A reconciliação PostgreSQL agora reivindica atomicamente o efeito em `RECONCILING`, com lease e fence token; uma segunda tentativa concorrente é recusada enquanto a primeira mantém o lease.

O scheduler local mantém seis lanes com concorrência em lotes, budgets por lane, backpressure medido antes do claim e métricas de poison/falha. O limite de outbox é configurável por `CVG_WORKER_MAX_OUTSTANDING`; o default é conservador (`1000`) e não habilita provider. O heartbeat e o encerramento por `SIGINT`/`SIGTERM` são conectados no entrypoint Docker. A execução do container, banco, provider e collector continua `NOT_RUN` nesta revisão.

| Etapa | Código local | Evidência real |
|---|---|---|
| Stage/approval | implementado e testado com PDP/approval | não executada em sandbox |
| Outbox/lease/fencing | persistência e testes sintéticos | banco/worker de staging `NOT_RUN` |
| Provider/receipt | `tests/unit/integrations.test.ts` fecha vertical sintética com `MessagingOutboxSink`, receipt/unknown e idempotência | provider real `BLOCKED` |
| Callback/inbox | assinatura, dedupe e efeito | callback externo `NOT_RUN` |
| Reconciliation | claim/lease/fence PostgreSQL + vertical sintética consulta `PROVIDER_QUERY` | reconciliação externa `NOT_RUN` |
| Audit/settlement | ledger local e uso | custo/settlement real `NOT_RUN` |

Nenhum dado real, mensagem externa ou cobrança foi autorizada. A passagem de `PROPOSED` para `READY` exige um recibo redigido, callback assinado, replay idempotente, reconciliação de timeout e prova de que uma segunda entrega não produz efeito duplicado.
