# Runbook — backup e incidente

Escopo: preservar evidência e produzir uma cópia lógica antes de recuperação. O diretório de destino deve ser externo, criptografado e acessível somente à equipe autorizada.

1. Isole a superfície e preserve o estado: remova o proxy do tráfego, pare `worker` e `api`, não apague o volume PostgreSQL e não altere registros para “limpar” o incidente.
2. Colete logs redigidos e metadados de versão sem imprimir ambiente, senhas, tokens ou dados clínicos:

   ```bash
   docker compose --env-file "$CVG_ENV_FILE" logs --no-color --timestamps api worker proxy > "$INCIDENT_LOG_FILE"
   sha256sum "$INCIDENT_LOG_FILE"
   ```

3. Faça um dump lógico para destino protegido e valide a listagem antes de considerá-lo recuperável:

   ```bash
   umask 077
   docker compose --env-file "$CVG_ENV_FILE" exec -T postgres \
     pg_dump --format=custom --no-owner --no-privileges -U cvg_app -d cvg_local > "$BACKUP_FILE"
   sha256sum "$BACKUP_FILE"
   ```

   Transfira o arquivo por canal aprovado, com criptografia e retenção definidas pelo operador. Este artifact não implementa upload para object storage nem substitui backup gerenciado.

   Para uma cópia operacional cifrada no boundary da aplicação, configure explicitamente o diretório e a referência de chave e execute a verificação fail-closed:

   ```bash
   CVG_BACKUP_DIRECTORY="$INCIDENT_BACKUP_DIRECTORY" \
   CVG_BACKUP_KEY_FILE="$RECOVERY_KEY_FILE" \
   CVG_RECOVERY_ENCRYPTION_KEY_REF="$RECOVERY_KEY_REF" \
   npm run verify:backup-retention
   ```

   O comando valida todos os artifacts antes da rotação e encerra com `BACKUP_RETENTION_BLOCKED_EXTERNAL` quando diretório ou autoridade de chave não estão configurados. Não use uma chave impressa no shell nem marque um bundle local como RPO observado.

4. Restaure apenas em banco novo e isolado; valide schema, contagens, checksums, quarentena, bloqueio de login/readiness e imutabilidade da origem antes de qualquer replay. Nunca restaure sobre a origem durante a investigação.
5. Classifique o incidente, revogue acessos pelo mecanismo autorizado e só reabra `api`/`worker` após evidência de impacto, integridade e aprovação. Falhas de provider ficam sem confirmação; nenhum dispatch externo é inferido a partir de logs locais.

Limitações conhecidas: a implementação local cobre escrita atômica, envelope, manifest, tamper, chave incorreta e rotação, mas não implementa upload para object storage, KMS/Secret Authority, agendamento gerenciado ou aceite humano. RTO/RPO observados, retenção externa e execução em produção precisam ser definidos no ambiente real.
