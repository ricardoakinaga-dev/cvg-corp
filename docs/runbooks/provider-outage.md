# Runbook — provider outage

**Estado:** providers externos bloqueados nesta fotografia.
**Owner:** integração/ops. **Abortar se:** não houver contrato, status autorizado ou método de consulta.

Marcar a integração como `DEGRADED` ou `OUTCOME_UNKNOWN`, parar retries cegos, preservar a idempotency key e registrar o último receipt. O worker pode manter o item em quarentena. Consultar o provider somente por adapter aprovado; uma resposta tardia é vinculada ao effect ID original.

Não trocar por endpoint improvisado, não duplicar pagamento/mensagem/medicação e não declarar entrega com base em timeout ou ausência de erro.
