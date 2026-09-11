# Runbook — backup

**Estado:** utilitário local verificável; backup gerenciado `NOT_RUN`.
**Owner:** dados/ops. **Abortar se:** watermark, integridade, retenção, chave ou escopo não puderem ser comprovados.

O utilitário `writeOperationalBackup` produz um manifest `CVG-BACKUP-MANIFEST` com artifact/schema, watermark reconciliado, escopo, classes de dados, digest, timestamp, retenção e referência de chave. O payload continua cifrado por AES-256-GCM, o arquivo temporário é criado com `wx` e renomeado atomicamente, o diretório é revalidado para modo `0700` mesmo quando já existe e o artifact usa `0600`. `verifyOperationalBackupDirectory` valida todos os manifestos e envelopes antes de remover expirados; qualquer adulteração, chave ausente ou conjunto vazio aborta. `OperationalBackupJob` pode ser conectado ao scheduler do worker: cada tick é serializado, cria uma cópia nova, verifica todas as cópias e expõe a última falha para o health/alerting. A CLI local é:

```bash
CVG_BACKUP_DIRECTORY=/srv/cvg/backups \
CVG_BACKUP_KEY_FILE=/run/secrets/cvg/recovery-key.hex \
CVG_RECOVERY_ENCRYPTION_KEY_REF=prod-recovery-key \
npm run verify:backup-retention
```

Snapshot, journal, audit, receipts, outbox/inbox, usage/provenance e efeitos externos são inventariados sem incluir segredo. Os entrypoints do worker conectam `OperationalBackupJob` quando `CVG_BACKUP_ENABLED=true`; a configuração exige uma única `CVG_BACKUP_ORGANIZATION_ID` igual à organização do worker, diretório persistente, retenção, intervalo e `CVG_RECOVERY_ENCRYPTION_KEY_REF`. Quando uma cópia governada for necessária pelo caminho da aplicação, use `POST /api/v1/ops/export` com purpose, TTL e `Idempotency-Key`; essa capability exige PostgreSQL e não substitui backup gerenciado.

Validar contagem, digest, chave, retenção e isolamento antes de marcar o job como concluído. Falha ou watermark incompleto deixa o bundle bloqueado e abre incidente; o utilitário local não fornece evidência de RPO/RTO nem substitui object storage, KMS/Secret Authority, agendamento ou retenção gerenciada.
