# Runbook — rollback

Objetivo: voltar ao artifact anterior sem apagar o volume PostgreSQL nem confirmar efeitos externos.

1. Congele a mudança e preserve logs/horários/correlation IDs. Pare os escritores primeiro:

   ```bash
   docker compose --env-file "$CVG_ENV_FILE" stop worker api proxy
   ```

2. Verifique se o schema atual é compatível com o artifact anterior. Se não for, não faça downgrade automático: prefira roll-forward ou restauração em destino isolado com aprovação operacional.
3. Se as imagens anteriores estiverem disponíveis por digest, aponte `CVG_API_IMAGE` e `CVG_WEB_IMAGE` para elas e suba sem reconstruir:

   ```bash
   docker compose --env-file "$CVG_ENV_FILE" up -d --no-build api web worker proxy
   docker compose --env-file "$CVG_ENV_FILE" ps
   ```

4. Confirme os healthchecks, `/healthz`, `/api/v1/ready`, ausência de backlog inesperado e comportamento mínimo autorizado. O worker continua em modo fail-closed até existir sink governado.

Nunca use `docker compose down -v`, remova volumes, reverta migrations ou reenvie eventos para “destravar” o serviço. Efeitos `OUTCOME_UNKNOWN`, `QUARANTINED` ou `RECONCILIATION_REQUIRED` exigem reconciliação explícita; não há retry cego.
