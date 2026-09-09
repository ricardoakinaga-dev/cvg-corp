# Runbook — database incident

**Estado:** procedimento documentado; exercício com serviço real `NOT_RUN`.
**Owner:** dados/ops. **Abortar se:** não houver escopo do incidente, backup íntegro ou janela de intervenção.

1. Marcar dependência como indisponível e impedir novas escritas críticas.
2. Preservar logs redigidos, correlation IDs, health/readiness, migration watermark e sinais de lock/lease.
3. Não remover banco, volume ou migration aplicada.
4. Validar conectividade, schema checksum, RLS, último journal e ledgers em modo read-only.
5. Recuperar em destino isolado e seguir o runbook de restore; reconciliar qualquer efeito desconhecido.
6. Reabrir somente após smoke, auditoria e aprovação do owner.
