# Runbook — restore

**Estado:** restore sintético disponível; restore operacional `NOT_RUN`.
**Owner:** dados/segurança. **Abortar se:** digest, migration, ACL, journal ou autoridade corrente divergirem.

Restaurar sempre em destino isolado e identificado. A entrada pode ser um bundle produzido pelo export governado (`POST /api/v1/ops/export`) ou por backup operacional; em ambos os casos valide envelope/chave, propósito, TTL, manifest e digest antes de abrir o artifact. Aplicar schema, validar continuidade do journal, recuperar ledgers de usage/provenance e outbox congelados, verificar RLS e invariantes, revogar autoridade herdada e manter o destino em `QUARANTINED`. Consultar eventos posteriores ao watermark antes de qualquer leitura ou envio.

Registrar o alvo de RTO/RPO antes do exercício, medir o tempo observado e a perda de dados, e bloquear a liberação se o resultado não satisfizer o orçamento aprovado.

Não restaurar diretamente sobre produção, não reativar sessões antigas e não reenviar efeitos `UNKNOWN`. A liberação exige revisão independente e evidência de reconciliação.

## Retorno reconciliado a READY (AUD13-24)

O restore entra e permanece em `QUARANTINED`. A liberação é um ato explícito, exercitado
pelo contrato `reconcileRestoredSnapshot` e pelas mesmas regras no drill externo:

1. Reúna as decisões registradas **depois** do watermark do backup (`REVOKE_SESSION`,
   `REVOKE_ROLE`, `RESTRICT_PATIENT`, `QUARANTINE_DOCUMENT`), cada uma com autor e
   horário.
2. Aplique-as ao snapshot quarentenado com uma **autoridade de reconciliação
   independente** (`role=recovery_authority`, `authorized=true`) que não seja autora de
   nenhuma das decisões.
3. Se qualquer decisão apontar para um recurso ausente, o destino **permanece
   `QUARANTINED`** com a lista de pendências; não há liberação parcial.
4. Somente com todas as decisões aplicadas o snapshot retorna a `READY`; registre
   `applied`, watermark, authority id e digests no dossiê do exercício.

Cobertura de stores (validada por `validateRecoveryStoreCoverage`): `database`,
`session`, `backup` e `export` são `INTEGRATED`; `vector` fica `QUARANTINED` (índice
derivado); `object`, `cache`, `provider` e `telemetry` são `NOT_INTEGRATED` e estão
declarados com owner — um store não integrado nunca é omitido silenciosamente.
