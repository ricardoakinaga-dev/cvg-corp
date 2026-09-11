# Runbook — deploy

Escopo: composição local/prod-like do CVG. Este procedimento não autoriza produção, não envia imagens e não chama providers externos.

1. Coloque os valores do ambiente em um arquivo externo, com permissão restrita. Não use credenciais do repositório; em produção, `NODE_ENV=production`, `CVG_DEMO_MODE=false`, PostgreSQL, HTTPS, secret-provider e runtime aprovado são obrigatórios. O `CVG_BOOTSTRAP_PASSWORD` deve ser definido fora do Git.
2. Valide somente artefatos e configuração:

   ```bash
   node --import tsx scripts/verify-production.ts --structural
   docker compose --env-file "$CVG_ENV_FILE" config --quiet
   ```

   Um retorno `2` do verificador significa evidência incompleta; pare o deploy.

3. Gere as imagens do commit identificado e suba a composição:

   ```bash
   docker compose --env-file "$CVG_ENV_FILE" build
   docker compose --env-file "$CVG_ENV_FILE" up -d
   docker compose --env-file "$CVG_ENV_FILE" ps
   ```

   `migrate` termina antes da API; API, web, worker e proxy precisam ficar `healthy`. O worker local usa `quarantine` e não faz egress externo.

4. Confirme `/healthz` no proxy e `/api/v1/ready` pelo proxy. Guarde o resultado, o digest das imagens, a revisão de migration e os logs redigidos. Não registre senhas, tokens ou payloads clínicos.

Se qualquer healthcheck falhar, pare a promoção e siga [rollback](rollback.md). Não execute `down -v` como correção.
