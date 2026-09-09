# Runbook — credential rotation

**Estado:** endpoints locais de rotação/recuperação e referências existem; secret manager real `NOT_RUN`.
**Owner:** segurança/ops. **Abortar se:** a referência não estiver aprovada ou não houver teste de revogação.

Para a credencial de usuário, use `POST /api/v1/auth/password/rotate` com CSRF e senha atual; a operação incrementa `credentialVersion`, revoga todas as sessões antigas e cria uma sessão nova. Para MFA, atualize somente a referência `mfaSecretRef` por um resolver aprovado e valide um código TOTP dentro da janela autorizada. Códigos de recuperação devem ser reemitidos como digests one-shot, nunca copiados para logs.

Para uma integração, crie a nova versão no secret manager, valide escopo/uso e atualize somente a referência de configuração. Teste health sem imprimir o valor, revogue a versão antiga, verifique que logs/provenance/respostas não contêm material secreto e registre correlation/owner.

Se a rotação deixar a integração incerta, bloquear egress e marcar efeitos em `OUTCOME_UNKNOWN`; não repetir operações não reconciliadas.
