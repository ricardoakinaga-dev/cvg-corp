# Runbook — DeepSeek Harness outage

**Estado:** ponte DeepSeek CVG `/v1` não conectada; procedimento `NOT_RUN`.
**Owner:** AI runtime. **Abortar se:** commit, manifest, capability set, health ou credencial não forem exatamente os aprovados.

Colocar o adapter em `UNAVAILABLE`, preservar provenance e correlation, bloquear turnos dependentes e manter o caminho manual do CVG. Não substituir silenciosamente o provider, não mudar policy para contornar health e não enviar prompts para endpoint não aprovado.

Após recuperação, validar health, engine commit, manifest, registry digest, timeout e replay em ambiente sintético; só então solicitar aprovação de habilitação.
