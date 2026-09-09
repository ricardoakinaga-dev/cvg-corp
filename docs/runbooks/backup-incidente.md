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

4. Restaure apenas em banco novo e isolado; valide schema, contagens, checksums, quarentena, bloqueio de login/readiness e imutabilidade da origem antes de qualquer replay. Nunca restaure sobre a origem durante a investigação.
5. Classifique o incidente, revogue acessos pelo mecanismo autorizado e só reabra `api`/`worker` após evidência de impacto, integridade e aprovação. Falhas de provider ficam sem confirmação; nenhum dispatch externo é inferido a partir de logs locais.

Limitações conhecidas: o bundle criptografado e o backup operacional gerenciado ainda não têm um comando de produção neste recorte; RTO/RPO, retenção, chave externa e aceite humano precisam ser definidos no ambiente real.
