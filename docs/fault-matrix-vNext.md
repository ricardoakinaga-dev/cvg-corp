# Fault matrix vNext

Esta matriz separa o que foi exercitado no runtime sintético do que depende de infraestrutura real. Nenhuma linha `PASS` abaixo autoriza efeito externo.

| Cenário | Evidência local | Estado | Regra de recuperação |
|---|---|---|---|
| crash before commit | teste de rollback transacional | PASS sintético | não há fato confirmado |
| crash after commit | idempotência/restart da persistência | PASS sintético | recuperar pelo journal/receipt |
| crash before dispatch | effect ledger/outbox | PASS sintético | manter pendente, sem envio cego |
| crash after dispatch | marcador + `OUTCOME_UNKNOWN` + `tests/integration/faults.test.ts` | PASS sintético | consultar receipt/reconciliar |
| crash before provider receipt | timeout do gateway | PASS sintético | resultado desconhecido |
| crash after provider receipt | contrato de receipt | PARTIAL | provider real não conectado |
| worker lease loss | fencing/lease tests + `tests/integration/faults.test.ts` | PASS sintético | somente o fence vigente conclui |
| database reconnect | PostgreSQL local opcional | NOT_RUN nesta fotografia | bloquear e revalidar readiness |
| provider timeout | deadline do Tool Gateway | PASS sintético | abortar/quarentenar, não repetir cegamente |
| duplicate provider callback | inbox idempotente | PASS sintético | devolver receipt original |
| corrupted restore | AES-GCM/tamper test | PASS sintético | manter destino em quarentena |
| partial restore | stores externos/objects ausentes | NOT_RUN | não liberar leitura ou egress |

Os testes existentes em `tests/integration/persistence.test.ts`, `tests/unit/integrations.test.ts`, `tests/integration/faults.test.ts` e `tests/unit/vnext.test.ts` são a evidência executável local. A ausência de serviço, provider, workload ou stores externos permanece explícita. O teste do processo separado em `tests/unit/worker.test.ts` cobre health, quarentena, ausência de sink e lifecycle de encerramento; não substitui container smoke ou inspeção de imagem.
