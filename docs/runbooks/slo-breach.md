# Runbook — SLO e error budget

**Estado:** catálogo e avaliador sintéticos implementados; medição production-like e alertas operacionais `NOT_RUN`.
**Owner:** operações. **Apoio:** dados, segurança e responsável do serviço afetado. **Abortar se:** não houver ambiente, janela, autoridade ou amostra rastreável.

## Escopo

O catálogo em `@cvg/ops` cobre disponibilidade da API, p95, login, busca de paciente, atraso de outbox, confirmação de mensagem, RTO e RPO. Os targets são `PROPOSED`; metas `TBD` permanecem sem número. `evaluateSlo` só produz `PASS`/`BREACH` para uma observação com amostra explícita e evidência `MEASURED`. Sem isso, o resultado correto é `NOT_RUN`.

As regras também são `PROPOSED`. Elas apenas classificam um resultado e apontam para este ou outro runbook; não enviam notificação, alteram configuração, fazem retry ou autorizam release.

## Procedimento seguro

1. Registrar `observedAt`, ambiente, versão, operação, tamanho da amostra, fonte, correlação e o avaliador usado. Não registrar prompt, segredo, token ou conteúdo clínico.
2. Confirmar que a amostra é sintética ou production-like autorizada e que o target ainda tem aprovação. Ausência de amostra, target `TBD` ou collector indisponível permanece `NOT_RUN`.
3. Em breach de disponibilidade/latência, preservar logs redigidos e consultar [`database-incident.md`](database-incident.md); não aumentar concorrência ou mascarar erros.
4. Em atraso/poison de outbox, consultar [`worker-backlog.md`](worker-backlog.md); respeitar lease, fence, backoff, quarentena e não reenviar `UNKNOWN`.
5. Em confirmação externa atrasada, consultar [`provider-outage.md`](provider-outage.md); manter a idempotency key e o receipt pendente.
6. Em RTO/RPO fora do target, consultar [`restore.md`](restore.md), validar destino isolado e bloquear a promoção até reconciliação e aprovação do owner.
7. Registrar a decisão, owner, janela, critério de abortamento, impacto, reconciliação e horário de retorno. Fechar somente após uma nova amostra válida e sem apagar a evidência anterior.

## Critérios de abortamento

- Não executar carga, consulta externa, envio, retry de efeito desconhecido ou alteração de target para reduzir uma violação.
- Interromper se houver dado real, segredo, egress, provider, break-glass ou release sem autoridade registrada.
- Se a causa não puder ser distinguida entre dependência, policy, fila, auditoria ou instrumentação, manter a capacidade em estado degradado/quarentena e classificar o SLO como `NOT_RUN` até a evidência ser recuperável.

