# Prova de recuperação

Status: `PARTIAL/SYNTHETIC_ONLY`. O projeto valida localmente manifesto/digests, AES-256-GCM com `keyRef`, rejeição de bundle adulterado, restauração em destino temporário quarentenado e bloqueio de login/readiness. Backup gerenciado, storage externo, crash matrix completa e RTO/RPO aprovados não foram executados.

## Invariantes

- origem não é sobrescrita pelo drill;
- bundle parcial, stale, migration mismatch, watermark divergente, ciphertext ou chave inválida falham fechado;
- destino restaurado inicia em quarentena e sem login/readiness;
- outbox, inbox, efeitos externos, usage, auditoria e `workerJobs` conservam digest/watermark; jobs preservam tentativas, limite, estado e fence token;
- heartbeats não são restaurados como prova de liveness antiga: o destino exige um heartbeat novo do worker autorizado;
- unknown outcome exige reconciliação ou revisão manual, nunca reenvio cego;
- liberação só ocorre após validação de migrations, integridade, escopo, proveniência e aprovação.

## Evidência ainda exigida

- backup criptografado gerenciado com retenção/residência aprovadas;
- restore em conta/cluster isolado usando o mesmo commit e role sem superuser;
- pontos de crash em cada transição e reexecução após watermark;
- medição RTO/RPO, perda máxima, fila residual e alertas;
- teste de revogação de chave, expiração, acesso break-glass e audit chain;
- replay/quarantine de `workerJobs` em PostgreSQL concorrente, com leases/fences e heartbeat em processos separados;
- parecer independente para o mesmo artefato.

O drill local é útil para regressão, mas não autoriza declarar continuidade operacional ou produção pronta.
