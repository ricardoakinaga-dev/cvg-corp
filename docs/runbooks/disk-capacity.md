# Runbook — capacidade de disco esgotada

**Estado:** rotação e retenção locais implementadas (`FileDurableLogSink`, `verify:backup-retention`); monitoração de volume e expansão externas `BLOCKED_EXTERNAL`. Exercício de disco cheio real `NOT_RUN`.  
**Owner:** ops/plataforma. **Abortar se:** a contenção proposta exigir apagar auditoria, ledger, prontuário ou bundle de backup sem verificação, ou usar `docker compose down -v` / prune de volumes.

Objetivo: diagnosticar o consumo de disco, conter o crescimento sem destruir dados governados (auditoria append-only, ledger, documentos clínicos, bundles cifrados) e restaurar a operação com retenção configurada e evidência de verificação.

## 1. Diagnóstico

1. Estado do host (ferramentas padrão **não** versionadas no repositório — `PROPOSED`): `df -h` para o filesystem que hospeda os volumes Docker e `docker system df` para imagens/volumes/build cache.
2. Tamanho por volume/mount (o repositório define os nomes e destinos):
   - dados PostgreSQL: volume `cvg_corp_pgdata` montado em `/var/lib/postgresql` (`docker-compose.yml:15`), dentro do serviço `postgres` que é `read_only` com `tmpfs` limitado (`docker-compose.yml:16`);
   - backups: volume `cvg_corp_backups` montado em `/var/lib/cvg/backups` no `backup-init` (`docker-compose.yml:94`) e no `worker` (`docker-compose.yml:244`), com diretório `0700` e owner `65532:65532` (`docker/init-backup-volume.mjs`);
   - observabilidade: `cvg_tempo_data`, `cvg_prometheus_data`, `cvg_alertmanager_data`, `cvg_grafana_data` (`docker-compose.observability.yml:101` a `:104`).
3. Sinais de aplicação:
   - `cvg_telemetry_dropped` quando a escrita do sink falha ([observability-logs](observability-logs.md)); `FileDurableLogSink` incrementa `failures` e relança o erro em vez de confirmar durabilidade (`packages/ops/src/index.ts:212`);
   - `operational backup blocked: <ErrorName>` no worker (`apps/worker/src/main.ts:44`) quando o backup não conclui;
   - rotação do log durável aparece em `stats().rotated` (`packages/ops/src/index.ts:220`).
4. Confirmar os parâmetros de retenção efetivos antes de tocar em arquivos: sink do worker com `maxBytes: 8 * 1024 * 1024` e `maxBackups: 7` (`apps/worker/src/main.ts:20`); perfil local em `docker/observability/retention.yml:7` (32 MB, 7 dias, 7 backups); retenção de backup por `CVG_BACKUP_KEEP_LAST` (`docker-compose.yml:222`, `docker-compose.production.yml:68`) e `CVG_BACKUP_RETENTION_COUNT` na CLI (`scripts/verify-backup-retention.ts:41`).

## 2. Contenção

### 2.1 Logs duráveis (primeiro alvo; menor risco)

1. Confirmar onde o sink está configurado: o worker só grava NDJSON quando `CVG_DURABLE_LOG_FILE` está definido (`apps/worker/src/main.ts:19`). O arquivo é a fonte de rotação; **não** o apague manualmente.
2. Deixar a rotação agir: `FileDurableLogSink` rotaciona por tamanho e remove backups por idade/quantidade (`packages/ops/src/index.ts:224` a `:248`). Se a pressão for imediata, o caminho suportado é reduzir `maxBytes`/`maxBackups` no ponto de composição (`apps/worker/src/main.ts:20`) ou o perfil equivalente — decisão `PROPOSED`.
3. Arquivos já rotacionados (sufixo `.jsonl` com timestamp) podem ser movidos para mídia aprovada após registro; **nunca** remova o arquivo corrente nem edite seu conteúdo.
4. Consulta durante o incidente: filtrar por correlação sem carregar tudo em memória, como em [observability-logs](observability-logs.md).

### 2.2 Backups cifrados

1. Não apague bundles manualmente. A remoção suportada é a verificação de retenção, que só remove expirados **depois** de decifrar o conjunto ([backup](backup.md)).
2. Antes de rodar retenção, copie o diretório para mídia protegida e rode contra uma cópia; se a intenção for reduzir a janela, ajuste `CVG_BACKUP_KEEP_LAST` no ambiente gerenciado e registre o impacto em RPO (`PROPOSED` — decisão do owner de dados).
3. Se a chave estiver indisponível, **pare**: sem ela a verificação aborta e o prune pode não rodar; siga [key-loss](key-loss.md).

### 2.3 PostgreSQL e volumes Docker

1. Não remova o volume `cvg_corp_pgdata` nem rode `docker volume prune`; não execute `docker compose down -v`. A auditoria é append-only e não há caminho de expurgo parcial suportado ([worker-backlog](worker-backlog.md), migration `db/migrations/027_append_only_audit_guard.sql`).
2. Se o crescimento vier de dados/tabelas, a contenção correta é operacional/janela com o owner de dados (arquivamento/retenção aprovada), não `DELETE` ad hoc.
3. Expansão de volume/filesystem é ação de infraestrutura (`BLOCKED_EXTERNAL`/`PROPOSED` no repositório) e exige janela.
4. Build cache e imagens (`docker system df`) podem ser avaliados com o time de plataforma; `docker system prune` / `docker image prune` são `PROPOSED` e exigem confirmação — nunca use `--volumes`.

### 2.4 Observabilidade local

1. Retenção de traces Tempo: `block_retention: 168h` (`docker/observability/tempo.yml:21`); Prometheus local usa `--storage.tsdb.retention.time=1d` (`docker/observability/compose.local.yml:35`). Em ambiente gerenciado esses valores são `BLOCKED_EXTERNAL`.
2. Reduzir a retenção local é aceitável para conter o volume de dev; em produção, a decisão passa pelo owner de observabilidade e pelo perfil `docker/observability/retention.yml`.

## 3. Prevenção

1. Manter o sink durável explicitamente configurado e monitorar drops: o SLO `TELEMETRY_DROPS` tem alvo 0 (`packages/ops/src/index.ts:871`) e alerta associado (`packages/ops/src/index.ts:967`); validar com `npm run verify:alertmanager` (renderização/checagem do Alertmanager).
2. Agendar `npm run verify:backup-retention` no ciclo operacional: além de validar integridade, ele aplica a retenção configurada. Falha = incidente, não motivo para apagar à mão.
3. O gate `npm run verify:resource-pressure` cobre CPU, memória e file descriptors do worker/Compose (`scripts/verify-resource-pressure.ts`); **não** mede disco — não use como prova de capacidade de disco.
4. Definir limiares de capacidade e alerta de disco com owner (`PROPOSED`); hoje não há métrica de disco exportada pelo produto.
5. Revisar periodicamente o tamanho do dump/backup versus espaço reservado; a expansão deve ser planejada, não reativa.

## Evidência

- saída de `df -h`/`docker system df` (ou métrica equivalente aprovada) antes/depois, com filesystem e volume;
- estado do sink: `path`, `writes`, `rotated`, `failures` (`packages/ops/src/index.ts:220`) e ocorrências de `cvg_telemetry_dropped`;
- resultado de `npm run verify:backup-retention` (`BACKUP_RETENTION_VERIFIED` ou falha) e quantidade/watermark preservados;
- identidade dos arquivos/volumes movidos ou liberados, com digest quando aplicável;
- janela, autoridade e decisão de retenção/expansão;
- registro do que **não** foi apagado (auditoria, ledger, prontuário, bundles não verificados).

## Critérios de encerramento

- [ ] consumo contido e serviço estável (worker, API, PostgreSQL e proxy sem falha de escrita);
- [ ] nenhuma auditoria/ledger/documento clínico/bundle não verificado removido;
- [ ] retenção de log e de backup explicitamente configurada e aplicada pelo caminho suportado;
- [ ] `verify:backup-retention` verde ou bloqueio com owner declarado;
- [ ] causa raiz classificada (volume anormal, retenção desligada, dump maior, expansão não planejada) e ação preventiva com owner;
- [ ] alerta/limiar de capacidade definido ou registrado como `PROPOSED` com responsável.

## Aprovações pendentes (PROPOSED/UNKNOWN)

- limiares de disco, métrica exportada e alerta com owner — `PROPOSED`;
- política de retenção de dados/arquivamento aprovada pelo owner — `BLOCKED_HUMAN`;
- expansão de volume e backup gerenciado — `BLOCKED_EXTERNAL`;
- plano de descarte de mídia/log arquivado — `PROPOSED`.

## O que NÃO fazer

- Nunca rodar `docker volume prune`, `docker compose down -v` ou remover `cvg_corp_pgdata`.
- Nunca apagar o arquivo de log corrente, nem editar NDJSON para reduzir tamanho.
- Nunca apagar bundles de backup à mão: use a verificação de retenção, que decifra antes de remover.
- Nunca apagar registros de auditoria, ledger, prontuário ou recibo para liberar espaço.
- Nunca usar `--volumes` em prune ou associar disco cheio a “limpeza” de dados governados.
- Nunca marcar RPO/RTO como íntegros por causa da contenção de disco: seguem `UNKNOWN` até exercício ([restore](restore.md)).
- Nunca tratar `verify:resource-pressure` como prova de capacidade de disco.
