# ADR 019 — Idempotência durável de comandos retryable

Status: Accepted for local implementation; distributed production proof pending
Data: 2026-09-10

## Contexto

O helper de idempotência em memória protegia uma única instância, mas não
admitia concorrência entre processos antes da execução de uma mutação ou de
um adapter remoto. Em PostgreSQL, `command_receipts.idempotency_lookup` já
possui a identidade composta por organização, ator, sessão, operação, chave,
recurso e escopo; faltava uma composição única que todos os comandos
retryable usassem antes do callback.

## Invariantes

Para uma intenção autenticada e seu escopo canônico:

1. o claim durável `IN_FLIGHT` acontece antes da mutação ou chamada ao
   adapter;
2. a mesma identidade e o mesmo digest de corpo reproduzem o resultado
   confirmado sem executar o callback novamente;
3. a mesma chave com corpo diferente é conflito, e um claim concorrente não
   entra no callback;
4. uma falha antes do commit autoritativo assenta `FAILED` ou
   `OUTCOME_UNKNOWN`; falha no assentamento bloqueia qualquer inferência de
   sucesso.

## Decisão

`DurableIdempotencyService` é o limite de aplicação para mutações de negócio
retryable, comandos de IA e exportação governada. Com PostgreSQL, ele chama
`claimCommandReceipt` numa transação com escopo/RLS, hidrata replays
confirmados e passa a reserva para `idempotentAsync`. Com modo memória, delega
ao mesmo contrato do domínio apenas para execução sintética/local sem
autoridade distribuída.

As rotas de negócio, os quatro comandos de IA e `ops.export` recebem a mesma
instância composta no runtime. A rota `clinical.sign` mantém o caminho
especializado porque precisa validar o resultado de replay e projetar o CAS
clínico normalizado; ela usa a mesma admissão e settlement duráveis. O escopo
de `role.grant` preserva unidade/workspace do alvo, em vez de substituí-lo
silenciosamente pelo escopo corrente.

Em caso de falha do commit final do request, a reserva pode permanecer
`IN_FLIGHT`/`OUTCOME_UNKNOWN`: a transação pode ter sido confirmada antes de
uma falha de transporte e somente reconciliação deve decidir o resultado.
Isso é deliberado e ainda requer prova operacional de reconciliação.

## Fora do escopo desta decisão

Login, MFA verify, recuperação, emissão de sessão demo, logout e rotação de
credencial não são convertidos em replay genérico: eles emitem ou revogam
segredos/sessões e precisam de semântica específica. Webhooks usam identidade
durável do evento externo. O limite de comando também não declara exactly-once
para provider: DeepSeek, pagamentos, mensagens e outros efeitos externos
precisam de idempotency key do provider, outbox/effect ledger e reconciliação.

## Consequências e verificação

- A admissão é única e observável para os caminhos cobertos, reduzindo o risco
  de duplicação entre instâncias.
- O fallback em memória continua explicitamente inadequado para produção.
- Testes locais cobrem claim antes do callback, replay, conflito de corpo,
  concorrência simulada e settlement de falha; eles não substituem PostgreSQL
  concorrente, crash/restart ou staging.
- O resultado global continua `FAIL_WITH_LIMITATIONS` /
  `AAA_NOT_PROVEN` até que as autoridades externas e o aceite humano exigidos
  pelo prompt sejam realmente evidenciados.
