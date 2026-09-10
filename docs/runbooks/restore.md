# Runbook — restore

**Estado:** restore sintético disponível; restore operacional `NOT_RUN`.
**Owner:** dados/segurança. **Abortar se:** digest, migration, ACL, journal ou autoridade corrente divergirem.

Restaurar sempre em destino isolado e identificado. A entrada pode ser um bundle produzido pelo export governado (`POST /api/v1/ops/export`) ou por backup operacional; em ambos os casos valide envelope/chave, propósito, TTL, manifest e digest antes de abrir o artifact. Aplicar schema, validar continuidade do journal, recuperar ledgers de usage/provenance e outbox congelados, verificar RLS e invariantes, revogar autoridade herdada e manter o destino em `QUARANTINED`. Consultar eventos posteriores ao watermark antes de qualquer leitura ou envio.

Não restaurar diretamente sobre produção, não reativar sessões antigas e não reenviar efeitos `UNKNOWN`. A liberação exige revisão independente e evidência de reconciliação.
