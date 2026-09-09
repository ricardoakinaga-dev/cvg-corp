# Runbook — security incident

**Estado:** procedimento documentado; exercício adversarial `NOT_RUN`.
**Owner:** segurança. **Abortar se:** evidência não estiver preservada ou o escopo ainda for desconhecido.

Conter sem apagar evidência: desligar egress/kill switch, bloquear sessões e capabilities afetadas, preservar audit/correlation, classificar dados potencialmente expostos e abrir a cadeia de custódia. Verificar tenant, role, secret references, approvals, outbox e efeitos externos.

Rotacionar credenciais por referência, invalidar tokens, investigar replay e restaurar somente em quarentena. Comunicar o owner e reabrir após revisão independente; não editar audit ledger para esconder o incidente.
