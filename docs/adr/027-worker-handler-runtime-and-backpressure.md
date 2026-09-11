# ADR 027 — Runtime tipado de handlers e backpressure do worker

Status: aceito para o runtime local; prova multi-instância continua externa.

## Problema

As lanes, leases e fencing já existiam, mas os handlers de jobs eram funções sem contrato de payload, timeout ou classificação de recurso. O budget de itens era verificado depois da execução e não limitava o claim. Ciclos concorrentes também podiam ser iniciados sem um bulkhead de processo.

## Decisão

Cada job de produção é descrito por lane, tipo, validador de payload, recurso (`database`, `provider` ou `ai`), deadline, política de retry e disposição de timeout. O executor aplica a policy canônica antes do handler, limita o claim ao budget, registra início/resultado, mede tentativas e só confirma o job se o handler terminar dentro do deadline e o ciclo continuar ativo.

Timeout de provider é ambíguo e vai para quarentena/reconciliação; falhas de banco idempotentes usam retry exponencial limitado. Bulkheads rejeitam imediatamente quando cheios e não mantêm fila em memória. A fila durável permanece no PostgreSQL. Saturação observada do pool bloqueia o ciclo antes de heartbeat ou claim.

Os handlers compostos no entrypoint executam verificação de storage, fan-out idempotente de schedule, reconciliação de efeito externo, dispatch governado de comunicação e limpeza limitada de jobs concluídos/heartbeats parados. A manutenção nunca remove registros em quarentena.

## Consequências

O processo degrada com estado explícito em vez de criar promises ou filas sem limite. Os contadores do ciclo e spans/logs redigidos tornam retry, quarentena e backpressure observáveis. Jobs antigos `synthetic.rebuild` permanecem apenas para compatibilidade de testes e não são registrados pela composição de produção.

A prova local não mede capacidade, justiça entre organizações, SLO, takeover entre processos ou o comportamento de um provider/PostgreSQL reais. Esses itens exigem staging e continuam bloqueando a promoção AAA.
