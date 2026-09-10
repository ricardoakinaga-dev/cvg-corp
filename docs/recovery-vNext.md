# Recovery, replay e continuidade vNext

## Invariantes

O restore nunca reativa autoridade, sessão, segredo ou efeito externo sem
revalidação independente. O banco de origem não é modificado durante o drill;
o destino inicia em quarentena. Efeitos desconhecidos são preservados para
reconciliação, não apagados nem repetidos automaticamente.

`CURRENT`: o bundle durável contém tenant, schema, watermark, event id,
snapshot digest, fingerprint de migrations e digests de outbox/usage/inbox/
external-effects/worker-jobs; o digest de `workerJobs` cobre admission, payload,
estado, tentativas e fence token. AES-256-GCM autentica o payload. Heartbeats
não são autoridade histórica: são liveness corrente e devem ser recriados no
destino. A migration 021 corrige a chave de revisão por organização e a 031
adiciona a fila durável/liveness com RLS.

## Procedimento

1. congelar ingestão e registrar correlation/incident ID;
2. obter backup autorizado e validar manifest, idade, tenant, schema,
   fingerprint, digests e watermark;
3. descriptografar somente em memória/volume protegido;
4. restaurar em destino isolado, validar migrations e colocar em quarentena;
5. reconciliar outbox/effects/inbox, retomar ou quarentenar `workerJobs` e verificar receipts;
6. invalidar sessões e revalidar policy/segredos;
7. executar smoke e replay somente após aprovação independente;
8. registrar RTO/RPO medidos e liberar ou descartar o destino.

`NOT_RUN`: não há backup gerenciado, banco alvo ou daemon Docker autorizado
nesta entrega; portanto RTO/RPO e restore distribuído não são alegados.
