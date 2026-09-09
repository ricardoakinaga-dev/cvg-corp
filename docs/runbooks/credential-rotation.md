# Runbook — credential rotation

**Estado:** referências e adapters locais existem; secret manager real `NOT_RUN`.
**Owner:** segurança/ops. **Abortar se:** a referência não estiver aprovada ou não houver teste de revogação.

Criar a nova versão no secret manager, validar escopo/uso e atualizar somente a referência de configuração. Testar health sem imprimir o valor, revogar a versão antiga, verificar que logs/provenance/respostas não contêm material secreto e registrar correlation/owner.

Se a rotação deixar a integração incerta, bloquear egress e marcar efeitos em `OUTCOME_UNKNOWN`; não repetir operações não reconciliadas.
