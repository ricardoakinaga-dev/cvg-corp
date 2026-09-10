# Provider externo e efeitos de produção

Status: `PARTIAL/LOCAL-CONTRACT/SYNTHETIC_ONLY`. O CVG tem contratos de provider, outbox, inbox, idempotência, recibos, efeitos desconhecidos e reconciliação fail-closed. `npm run verify:provider-sandbox` executa o `HttpMessagingProvider` contra um servidor HTTP real em loopback e prova replay, perda de resposta após aceite, consulta de reconciliação e callback HMAC. Isso não é um provider externo autorizado: `externalProvider` permanece `NOT_RUN`.

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
| Provider/receipt | `scripts/verify-provider-sandbox.ts` e `tests/integration/provider-sandbox.test.ts` cruzam HTTP loopback real; testes unitários mantêm a vertical sintética com `MessagingOutboxSink` | provider externo real `BLOCKED` |
| Callback/inbox | callback HMAC válido/inválido é aceito/rejeitado no sandbox loopback; inbox/dedupe seguem cobertos localmente | callback externo `NOT_RUN` |
| Reconciliation | resposta perdida no transporte retorna `OUTCOME_UNKNOWN`; consulta HTTP por idempotency key retorna `SUCCEEDED` e receipt | reconciliação externa `NOT_RUN` |
| Audit/settlement | ledger local e uso | custo/settlement real `NOT_RUN` |

Nenhum dado real, mensagem externa ou cobrança foi autorizada. A passagem de `PROPOSED` para `READY` exige um recibo redigido, callback assinado, replay idempotente, reconciliação de timeout e prova de que uma segunda entrega não produz efeito duplicado.

O bridge DeepSeek segue a mesma disciplina de fronteira: além do bearer de serviço, cada operação que carrega `CvgContext` pode exigir `x-cvg-context-signature: sha256=...`, calculado sobre `{ context, correlationId }`. Em produção a assinatura é obrigatória e o segredo deve ser resolvido por `CVG_DEEPSEEK_CONTEXT_SIGNING_SECRET_REF`; ausência, adulteração ou divergência de correlação retornam `UNAUTHENTICATED` antes do dispatch.
