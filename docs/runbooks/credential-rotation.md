# Runbook — credential rotation

**Estado:** endpoints locais de rotação/recuperação e referências existem; secret manager real `NOT_RUN`.
**Owner:** segurança/ops. **Abortar se:** a referência não estiver aprovada ou não houver teste de revogação.

Para a credencial de usuário, use `POST /api/v1/auth/password/rotate` com CSRF e senha atual; a operação incrementa `credentialVersion`, revoga todas as sessões antigas e cria uma sessão nova. Para MFA, atualize somente a referência `mfaSecretRef` por um resolver aprovado e valide um código TOTP dentro da janela autorizada. Códigos de recuperação devem ser reemitidos como digests one-shot, nunca copiados para logs.

Para uma integração, crie a nova versão no secret manager, valide escopo/uso e atualize somente a referência de configuração. Teste health sem imprimir o valor, revogue a versão antiga, verifique que logs/provenance/respostas não contêm material secreto e registre correlation/owner.

Para a chave de assinatura de callbacks (`POST /api/v1/integrations/:provider/events`), cada referência só autentica o provider ao qual está vinculada em `CVG_INTEGRATION_CALLBACK_KEYS` (`provider=keyRef`, separados por vírgula). Para rotacionar, adicione o par `provider=novaRef` mantendo o antigo, reinicie a API, confirme que o provider passou a assinar com a nova referência e só então remova o par antigo. Um par ausente faz o callback ser recusado com 403 antes de qualquer escrita; nunca reutilize a chave de um provider para outro.

Se a rotação deixar a integração incerta, bloquear egress e marcar efeitos em `OUTCOME_UNKNOWN`; não repetir operações não reconciliadas.
