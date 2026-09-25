# Runbook — perda ou indisponibilidade de chave de backup/recuperação

**Estado:** rotação/localização local implementadas (`verify:backup-retention`, `OperationalBackupJob`); autoridade de chave externa (KMS/Secret Authority) `BLOCKED_EXTERNAL`. Exercício de perda real `NOT_RUN`.  
**Owner:** segurança/ops + owner de dados. **Abortar se:** a intenção for regenerar a chave e sobrescrever material existente, ou marcar uma cópia como recuperável sem provar a decifragem.

Objetivo: conter a perda/indisponibilidade de `CVG_BACKUP_KEY_FILE` (CLI) e de `CVG_RECOVERY_ENCRYPTION_KEY_REF` (worker/API), provar o que ainda é decifrável, recuperar por uma alternativa segura e escalar sem destruir a única cópia de material ou de bundles.

## 1. Reconhecer o sintoma

| Sintoma | Onde aparece | Significado |
| --- | --- | --- |
| `operational backup blocked: <ErrorName>` | stderr do worker (`apps/worker/src/main.ts:44`) | o job de backup não concluiu o ciclo |
| `operational backup key is unavailable for <keyRef>` | `OperationalBackupJob.execute` (`packages/persistence/src/operational-backup-job.ts:73`) e verificação de diretório (`packages/persistence/src/index.ts:1718`) | o resolver não devolveu material para a referência |
| `BACKUP_RETENTION_BLOCKED_EXTERNAL <var> is required` + exit 2 | `npm run verify:backup-retention` sem `CVG_BACKUP_DIRECTORY`/`CVG_BACKUP_KEY_FILE`/`CVG_RECOVERY_ENCRYPTION_KEY_REF` (`scripts/verify-backup-retention.ts:24`) | pré-condição ausente; fail-closed |
| `BACKUP_RETENTION_FAILED ...` + exit 1 | chave ilegível/inválida ou bundle que não decifra (`scripts/verify-backup-retention.ts:50`) | material divergente ou corrompido |
| `encrypted recovery bundle authentication failed` | `decryptRecoveryBundle` (`packages/persistence/src/index.ts:1458`) | chave errada, `keyRef`/AAD errado ou ciphertext adulterado |
| `CREDENTIAL_UNAVAILABLE` (503, “A referência da chave de exportação não está disponível”) | `POST /api/v1/ops/export` (`apps/api/src/application/export-service.ts:61`) | a API também não resolve a mesma referência |

Distinguir três cenários antes de agir:

1. **Material perdido** — a referência existe na configuração, mas o segredo não está mais disponível na autoridade/provider.
2. **Material divergente** — existe uma chave, mas ela não é a que cifrou os bundles (`keyRef`/AAD diferentes).
3. **Material indisponível no processo** — provider `NOT_READY`, arquivo ausente/permissão errada, ref trocada; o material pode estar íntegro no cofre.

## 2. Entender o desenho (por que regenerar destrói)

- O worker resolve a chave por referência via `configuredSecretProvider(CVG_SECRET_PROVIDER, env, CVG_SECRET_DIR)` (`apps/worker/src/operational-backup.ts:44`). Só `env`, `file` e `docker` têm implementação; `vault`, `aws`, `gcp`, `azure` e `kubernetes` caem em `UnsupportedSecretProvider` (`packages/integrations/src/index.ts:190`) — por isso a autoridade externa é `BLOCKED_EXTERNAL` até existir.
- O material é um segredo de 256 bits em hex ou base64 (`apps/worker/src/operational-backup.ts:15`; `scripts/verify-backup-retention.ts:11`). O manifest **nunca** contém material de chave; ele liga envelope, tenant, watermark e `keyRef` (`packages/persistence/src/index.ts:1465`).
- O `keyRef` e o `payloadDigest` entram como *associated data* do AES-256-GCM (`packages/persistence/src/index.ts:719`). Um bundle cifrado com outra chave ou outro `keyRef` **não abre** — regenerar a chave e sobrescrever o material antigo torna os bundles existentes indecifráveis.
- O `verifyOperationalBackupDirectory` só remove expirados **depois** de decifrar o conjunto; qualquer chave ausente ou adulteração aborta ([backup](backup.md)).

## 3. Contenção

1. Registrar o erro exato, a referência (`keyRef`), a hora e o `correlationId`/log do worker — **sem** imprimir o material da chave.
2. Congelar escrita: não iniciar novo ciclo de backup com material incerto. O job é fail-closed; manter a falha visível em vez de desativar a verificação.
3. Preservar os bundles: copiar (não mover) o diretório `CVG_BACKUP_DIRECTORY` para mídia protegida **antes** de qualquer operação de retenção. Executar `verify:backup-retention` contra a **cópia**, nunca contra o diretório vivo durante a investigação, porque o verificador remove cópias expiradas após validar (`scripts/verify-backup-retention.ts:48`).
4. Não rotacionar a referência por impulso: rotação de credencial por referência é para credenciais de integração ([credential-rotation](credential-rotation.md)); a chave de recuperação exige autoridade de chave e plano de re-cifragem.
5. Não reativar restore/export de produção a partir de bundles enquanto a chave não for provada.

## 4. Alternativas de recuperação (em ordem)

1. **Restaurar o material a partir da autoridade/provider.**
   - `file`/`docker`: confirmar que o segredo montado em `CVG_SECRET_DIR` existe, tem permissão correta e corresponde à referência. Em produção o overlay monta o secret `cvg-recovery-key` em `cvg/${CVG_RECOVERY_ENCRYPTION_KEY_REF}` (`docker-compose.production.yml:52-53` e `:80-81`).
   - `env`: confirmar que a variável resolvida pelo provider está presente no processo correto (API e worker).
   - Referência incorreta também é causa: o resolver devolve `null` quando `candidateKeyRef !== keyRef` ou o provider não está `READY` (`apps/worker/src/operational-backup.ts:45`).
2. **Provar com a CLI, sem tocar no diretório vivo.**

   ```bash
   CVG_BACKUP_DIRECTORY="$BACKUP_COPY_DIR" \
   CVG_BACKUP_KEY_FILE="$RECOVERY_KEY_FILE" \
   CVG_RECOVERY_ENCRYPTION_KEY_REF="$RECOVERY_KEY_REF" \
   CVG_BACKUP_RETENTION_COUNT=7 \
   npm run verify:backup-retention
   ```

   Sucesso imprime `BACKUP_RETENTION_VERIFIED backups=<n> removed=<n>` (`scripts/verify-backup-retention.ts:48`). Falha de decifragem significa que aquela chave não abre aquele conjunto — não a “conserte” apagando bundles.
3. **Recuperar por bundle anterior.** Se um bundle mais antigo decifra com uma chave ainda disponível, ele pode ser restaurado isoladamente seguindo [restore](restore.md) (destino isolado, `QUARANTINED`, reconciliação de decisões pós-watermark). Isso recupera até o watermark disponível, não o instante do incidente.
4. **Sem material em nenhuma origem.** O material não é reconstruível por engenharia. Manter o estado `UNKNOWN`/`BLOCKED_EXTERNAL` para RPO do período afetado, escalar para a autoridade de chave e o owner de dados, e registrar a lacuna. Não inferir perda zero.

## 5. Escalonamento

| Situação | Autoridade | Ação |
| --- | --- | --- |
| provider `NOT_READY`/permissão | ops/plataforma | corrigir montagem/permissão e reprovar sem rotacionar |
| referência trocada | segurança/ops | restaurar a referência correta; registrar a mudança |
| material perdido de verdade | owner de dados + autoridade de chave (`BLOCKED_HUMAN`) | plano de recuperação/re-cifragem com janela e aceite de RPO |
| suspeita de vazamento da chave | segurança | tratar como incidente ([security-incident](security-incident.md)) e planejar re-cifragem |
| export/restore bloqueado | owner do processo | manter bloqueado até a chave ser provada |

## Evidência

- mensagem de erro exata, `keyRef`, host/serviço, horário e `correlationId` (sem material);
- resultado de `npm run verify:backup-retention` contra a cópia, com contagens e exit status;
- manifestos/envelopes preservados com `sha256`, quantidade e watermark (sem segredo);
- decisão sobre a origem da chave (restaurada/perdida/divergente) e autoridade que decidiu;
- RPO afetado declarado como `UNKNOWN` quando não mensurável, com responsável;
- se houver re-cifragem futura: autorização, versão de chave, bundles migrados e verificação pós-migração.

## Critérios de encerramento

- [ ] material da chave localizado e provado contra uma cópia, ou perda declarada por autoridade;
- [ ] nenhum bundle apagado/sobrescrito e nenhuma chave regenerada por cima de material existente;
- [ ] backup periódico reabilitado apenas após verificação verde (ou bloqueio explícito com owner);
- [ ] RPO do período afetado declarado (`UNKNOWN` não vira zero);
- [ ] planos de restore/export destravados somente com chave provada;
- [ ] lição registrada: onde a chave vivia, o que falhou e qual controle evita repetição.

## Aprovações pendentes (PROPOSED/UNKNOWN)

- autoridade de chave externa com versionamento e recuperação (KMS/Secret Authority) — `BLOCKED_EXTERNAL`;
- procedimento de re-cifragem de bundles com janela e critério de sucesso — `PROPOSED`;
- retenção/expurgo de versões antigas de chave — `PROPOSED`;
- responsável humano nomeado pela custódia da chave — `BLOCKED_HUMAN`.

## O que NÃO fazer

- Nunca regenerar a chave e sobrescrever o material existente: bundles antigos deixam de decifrar (AAD inclui `keyRef` e digests).
- Nunca apagar bundles, manifests ou envelopes para “limpar” a falha.
- Nunca rodar retenção no diretório vivo enquanto houver dúvida sobre a chave; trabalhe em cópia.
- Nunca imprimir, logar, versionar ou passar a chave em linha de comando visível; use arquivo/segredo com permissão restrita.
- Nunca marcar backup/RPO como íntegro sem `BACKUP_RETENTION_VERIFIED`.
- Nunca restaurar/exportar sobre a origem nem liberar destino fora de quarentena sem reconciliação ([restore](restore.md)).
- Nunca tratar `UnsupportedSecretProvider` como autoridade real: vault/aws/gcp/azure/kubernetes não estão implementados.
