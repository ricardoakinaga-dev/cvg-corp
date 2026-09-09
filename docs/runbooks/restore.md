# Runbook — restore

**Estado:** restore sintético disponível; restore operacional `NOT_RUN`.
**Owner:** dados/segurança. **Abortar se:** digest, migration, ACL, journal ou autoridade corrente divergirem.

Restaurar sempre em destino isolado e identificado. Aplicar schema, validar manifest e continuidade do journal, recuperar ledgers e outbox congelados, verificar RLS e invariantes, revogar autoridade herdada e manter o destino em `QUARANTINED`. Consultar eventos posteriores ao watermark antes de qualquer leitura ou envio.

Não restaurar diretamente sobre produção, não reativar sessões antigas e não reenviar efeitos `UNKNOWN`. A liberação exige revisão independente e evidência de reconciliação.
