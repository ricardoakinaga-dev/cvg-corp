# Runbook — quarantine

**Estado:** caminho implementado para fixtures; operação real `NOT_RUN`.
**Owner:** segurança/dados. **Abortar se:** a origem, digest ou motivo não puderem ser identificados.

Manter o recurso/ambiente bloqueado, registrar motivo, origem, policy revision e correlation, preservar o ledger e impedir leitura, exportação, retry e promoção. Revalidar schema, escopo, autoridade, receipt e journal; corrigir por nova versão ou reconciliar com owner.

Somente uma decisão auditada e independente remove a quarentena. Não apagar o item para fazê-lo desaparecer.
