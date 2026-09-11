# Prova final de recovery

Status: `PASS_WITH_LIMITATIONS` / `BLOCKED_EXTERNAL`.

Bundles cifrados, manifestos, digest, migration compatibility, sessões revogadas, audit/receipt/workers e restore quarentenado têm testes locais. A camada de backup operacional agora grava de forma atômica, com modo restrito, manifest vinculado ao envelope AES-256-GCM, digest, referência de chave e retenção/rotação; tamper e chave incorreta são rejeitados. `OperationalBackupJob` fornece o ciclo periódico serializado, registra falha de chave/corrupção e verifica o diretório antes de rotacionar. `npm run verify:postgres:restore` exige PostgreSQL autorizado para verificar a origem e o destino.

O fixture de persistência passou 49/49 e o smoke positivo da CLI confirmou a rotação (`keepLast=2`) em diretório temporário. Sem `CVG_BACKUP_DIRECTORY` e `CVG_BACKUP_KEY_FILE`, `npm run verify:backup-retention` encerra exit 2 `BACKUP_RETENTION_BLOCKED_EXTERNAL`, preservando o fail-closed. Backup gerenciado/objeto externo, autoridade de chave, cópia adulterada em ambiente separado, cron operacional e RTO/RPO observados ainda não foram executados; valores teóricos não são aceitos.
