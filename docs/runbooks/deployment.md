# Runbook — deployment

**Estado:** procedimento documentado; exercício de produção `NOT_RUN`.
**Owner:** operações da CVG. **Abortar se:** artifact, migration, configuração, health ou aprovação não forem identificados.

1. Fixar o commit/artifact e gerar `sha256` fora do sistema de autorização.
2. Executar `npm run typecheck`, `npm test`, `npm run build`, `npm run verify:static` e `npm run verify:production`.
3. Validar configuração externa com `NODE_ENV=production`, PostgreSQL, HTTPS, secret provider, `CVG_RECOVERY_ENCRYPTION_KEY_REF` e runtime aprovado; não usar defaults locais.
   Renderize a configuração efetiva do Alertmanager em diretório externo e somente depois aponte `CVG_ALERTMANAGER_CONFIG_FILE` para ela:

   ```bash
   CVG_ALERTMANAGER_WEBHOOK_URL='https://sink.aprovado.example/cvg' \
     npm exec -- tsx scripts/render-alertmanager.ts --production --output /run/cvg/observability/alertmanager.yml
   ```

   O comando falha sem autoridade, URL HTTPS ou arquivo efetivo; não monte o template do repositório no serviço.
4. Aplicar migrations aditivas em janela controlada e aguardar `service_completed_successfully`.
5. Iniciar API/web/worker/proxy; liberar tráfego somente após health/readiness e smoke autenticado.
6. Registrar artifact, migration watermark, correlation IDs, owner e decisão de release.

O worker permanece em quarentena até existir sink governado. Falha interrompe a promoção; não há fallback silencioso para memória ou mock.
