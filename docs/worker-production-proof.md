# Prova de worker production-like

Status: `VERIFIED_LOCAL/PARTIAL_EXTERNAL` — handlers e limites locais executados; produção multi-instância ainda não provada. Revalidação corrente `VER-CVG-268`: 330 testes (329 pass, 1 skip), 6 policies/35 focused no worker runtime, auditoria de cadeia, digests imutáveis dos ledgers de recovery e PostgreSQL local migrations 001–036; gates externos permanecem bloqueados.

O worker mantém lanes separadas, `SKIP LOCKED`, leases, fencing, heartbeat, backpressure, budgets e quarentena. Cada job passa por `WORKER_POLICY_REGISTRY` e por uma definição tipada com validador, deadline, recurso, retry exponencial limitado e disposição explícita de timeout. Tipos ou payloads não registrados falham antes do efeito.

A composição de produção registra handlers executáveis para `storage.verify`, `schedule.tick`, `external.reconcile`, `communication.dispatch` e `maintenance.cleanup`; o outbox tem relay/ledger idempotente próprio e agora também passa por `WORKER_POLICY_REGISTRY` (`outbox.dispatch`) antes do claim. Schedule faz fan-out durável com organização herdada, reconciliação consulta o provider, notification usa o sink governado e maintenance remove somente jobs concluídos e heartbeats `STOPPED` antigos, preservando quarentena.

A composição de produção aceita somente essas definições tipadas; o fallback de `jobHandlers` foi removido. O worker exige `auditRequired` nessa composição e escreve cada tentativa em `appendAuditRecord`, que bloqueia o acknowledge quando a transação do ledger falha. O registro usa a mesma cadeia append-only por organização (`previousHash`/`recordHash`) e mantém o sink de auditoria separado da telemetria.

O claim durável respeita o budget de itens antes de tocar o banco. Bulkheads de ciclo, banco, provider e IA rejeitam imediatamente quando cheios, sem wait queue em memória. Uma amostra saturada do pool bloqueia todas as lanes antes de heartbeat/claim. Timeout de provider fica em quarentena como resultado ambíguo e um handler atrasado não consegue confirmar o job depois do deadline.

O backup operacional agora é composto nos dois entrypoints do worker por `createOperationalBackupJob`. Em produção ele exige `CVG_BACKUP_ENABLED=true`, uma única `CVG_BACKUP_ORGANIZATION_ID` igual à organização do worker, diretório persistente, retenção, intervalo e `CVG_RECOVERY_ENCRYPTION_KEY_REF`; a chave é resolvida apenas pelo `SecretProvider` configurado. Cada execução chama `exportRecoveryBundle` dentro do escopo da organização, grava o envelope cifrado, verifica todas as cópias antes da rotação e para o timer de forma limpa. Configuração parcial, chave ausente, estado durável inexistente ou bundle fora do escopo deixam a execução bloqueada e observável. Organizações adicionais exigem workers explicitamente configurados, sem cópia parcial silenciosa.

A cobertura local de composição está em `tests/unit/worker-backup.test.ts`, `npm run verify:worker-runtime` e nos contratos de Compose. O volume externo, a chave Docker e o agendamento gerenciado continuam dependências de produção; RPO/RTO observado, restore real e aceite operacional permanecem externos.

Evidência executável: `npx tsx scripts/verify-worker-runtime.ts`, `node --import tsx --test tests/unit/worker.test.ts tests/integration/worker-jobs.test.ts` e `npm run typecheck`. O gate cobre 6 policies (cinco handlers tipados e o relay outbox), input inválido, timeout tardio, retry/quarentena, audit/metrics, budget pre-claim, bulkheads sem fila, saturação do pool e retenção de quarentena.

Continuam externos: duas instâncias reais, pressão medida do pool PostgreSQL, provider real, collector/alertas, dead-letter/redrive operado, fairness por tenant e SLO de backlog. A evidência local não promove o sistema a AAA.


A atualização `VER-CVG-173` tornou explícita a policy `outbox/outbox.dispatch`: o relay não pode iniciar claim sem escopo organizacional e chave de idempotência válidos.

## Revalidação local — VER-CVG-258 — 2026-09-11

O caminho de reconciliação em `runCycle` agora prioriza o runner durável tipado quando ele está disponível. Assim, `external.reconcile` passa por policy, claim/fence em `cvg_worker_jobs`, timeout, retry/quarentena, auditoria e métricas; o adapter direto ficou restrito à seam sintética sem auditoria obrigatória. O teste de ciclo cobre a execução com adapter e confirma `STARTED`/`SUCCEEDED`, métricas e completion fenced.

O relay outbox agora recebe hooks de tentativa. Cada claim emite `worker.handler.attempt` e auditoria `STARTED`; o resultado final (`SUCCEEDED`, `RETRY_SCHEDULED` ou `QUARANTINED`) é auditado e metrificado antes de `completeOutbox`/`failOutbox`. A composição de produção bloqueia dispatch quando a auditoria durável está ausente, e o teste verifica a ordem auditoria → provider → auditoria final → acknowledge.

A verificação da cadeia de auditoria deixou de confiar na ordem de transporte: reconstrói cada organização por `previousHash`/`recordHash`, exige uma única cabeça e rejeita predecessor ausente, hash inválido, duplicação, ramificação, ciclo e registros desconectados. O teste aceita uma lista embaralhada e rejeita lacuna, branch e múltiplas cabeças.

A regressão corrente passou 326 testes (325 pass, 1 skip), typecheck, build, lint (169), static (149/171), `verify:worker-runtime` (6 policies/33 focused), `verify:audit-chain` e o gate estrutural. Isso permanece evidência local: duas instâncias PostgreSQL, provider real, collector/alert delivery, RTO/RPO observado, staging e aprovação externa continuam sem execução autorizada.

## Revalidação local — VER-CVG-259 — 2026-09-11

A precedência do handler durável de reconciliação foi fechada no modo de auditoria de produção: adapters e `dependencies.lanes` não podem executar antes da policy, claim/fence, auditoria, métricas e disposição tipada. O relay outbox mantém a mesma ordem durável por tentativa, com `STARTED` antes do efeito e `SUCCEEDED`, `RETRY_SCHEDULED` ou `QUARANTINED` antes do acknowledge final.

A cadeia append-only agora é verificada por reconstrução hash-based e não depende da ordem retornada pelo transporte. A suíte passou 327 testes (326 pass, 1 skip), `verify:worker-runtime` com 6 policies/35 focused, `verify:audit-chain`, typecheck, build, lint e static. Isso continua prova local; multi-instância, provider real, collector/alertas, RTO/RPO observado, staging e aprovação externa permanecem sem execução.

## Fotografia final — VER-CVG-260 — 2026-09-11

A prova local final registra 327 testes (326 pass, 1 skip), 6 policies/35 focused no worker runtime, auditoria de cadeia PASS e snapshot `1db5b18f6475a529816b5003bc62e9dc5201f09105a3c45e66e9e1f87b4dc878`. A crítica [VER-CVG-260](../.gauntlet/critique-final-gauntlet-20260911-VER260.md) é review-only; multi-instância, provider real, collector/alert delivery, RTO/RPO, staging e aprovação externa seguem sem execução.

## Revalidação corrente — VER-CVG-264 — 2026-09-11

O worker permanece em prova local com 6 policies/35 focused, auditoria antes do acknowledge e PostgreSQL local migrations 001–036. O snapshot `903db416c44e1df7f12f2270bd078bcf5724b50d878ffd1ea021691a801a8004` e a crítica [VER-CVG-264](../.gauntlet/critique-final-gauntlet-20260911-VER264.md) são review-only; provider, staging, observabilidade medida, RTO/RPO e aceite humano seguem externos.


## Revalidação corrente — VER-CVG-265 — 2026-09-11

Além da auditoria antes do acknowledge, a fronteira de recovery agora verifica a cadeia hash-based no domínio compartilhado antes de aceitar ou cifrar bundles. A adulteração reempacotada é rejeitada localmente; a fotografia `88b7fec93375728b68821917b64ed82d37b62731d45cd70a9dfc33406455680a` e a crítica [VER-CVG-265](../.gauntlet/critique-final-gauntlet-20260911-VER265.md) continuam review-only.


## Revalidação corrente — VER-CVG-266 — 2026-09-11

A fronteira de recovery verifica cadeia de auditoria e timestamps de autenticação antes de aceitar ou cifrar bundles. A fotografia `f02418cb693c74f94a05c96703b209d4413301b3cc2bd2c224125f3a9c92b69b` e a crítica [VER-CVG-266](../.gauntlet/critique-final-gauntlet-20260911-VER266.md) continuam review-only.


## Revalidação corrente — VER-CVG-267 — 2026-09-11

Além da cadeia de auditoria e dos timestamps, a fronteira de recovery rejeita autenticação incompleta antes de `parseSnapshot`, incluindo security de usuários, sessões e desafios. Snapshot `dbc1da159294f9a04c8509f46b99b5a4a7a3cb5ab2a738094d6b7f0d88ee8b07`; artifact local `98d31bc53f989dfae0e25c63d67cd7307744480683aa0c712b1808b40289ccb2`; crítica [critique-final-gauntlet-20260911-VER267.md](../.gauntlet/critique-final-gauntlet-20260911-VER267.md) review-only pendente.

## Revalidação corrente — VER-CVG-268 — 2026-09-11

Recovery agora recalcula os digests canônicos dos campos imutáveis de outbox, usage, inbox, efeitos externos e jobs, antes de aceitar o digest agregado do manifesto. O teste de payload adulterado passa por rejeição em validação e cifragem. Snapshot run `76518144d894beed7821e79789531bbe101c80db1ada5883303d161647c71ea4`, SHA `23c302c622488335e2152212d81e26862854a4b5f1ca5ee807e53ce501ffcd50`; crítica [critique-final-gauntlet-20260911-VER268.md](../.gauntlet/critique-final-gauntlet-20260911-VER268.md) review-only. Multi-instância, provider real, observabilidade medida, RTO/RPO e aprovação externa continuam sem prova.
