# ADR 013 — Restore entra em quarentena

**Status:** accepted; execução operacional `NOT_RUN`.

Todo restore é isolado, identificado, validado por digest/watermark/schema/ACL e carregado como `QUARANTINED`. Sessões e autoridade herdadas não são reativadas; efeitos desconhecidos permanecem para reconciliação.

Somente revisão independente e evidência de continuidade do journal podem liberar leitura ou processamento. A existência de um bundle não é prova de restore utilizável.
