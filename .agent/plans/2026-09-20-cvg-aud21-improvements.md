# ExecPlan: CVG-AUD21 — reauditoria do resultado AUD20

<!-- status: ACTIVE; active_action_id: CVG-AUD21-013:SEMANTIC-RECOVERY -->

## Outcome

Converter o worktree AUD20 em um candidato local coerente e reproduzivel, fechando
primeiro as contraprovas P0 e preservando limites externos e humanos. Nenhuma
promocao ou declaracao AAA e permitida neste plano.

## Autoridade e restricoes

- Auditoria: `docs/auditoria-resultado-cvg-aud20-2026-09-20.md`.
- Roadmap: `docs/roadmap-melhorias-cvg-aud21-2026-09-20.md`.
- Backlog: `docs/backlog-melhorias-cvg-aud21-2026-09-20.md`.
- Barra imutavel: `.gauntlet/bar-v4.json`, SHA-256 `2093461a8d6103641a555ad45371dde4649e5f144c32260b80244e219fa70697`.
- Fingerprint observado pela reauditoria: `c61ba23c16db1426ff2441a6f7f4ec9700a43e895c8e809cff982c19168d0d2f`.
- O candidato AUD21 ainda nao esta congelado; a identidade reproduzivel fica para AUD21-018.
- Migrations 042/043 e historico de receipts sao preservados; novas correcoes sao append-only no control plane.

## Ordem

001/021 contencao e higiene -> 002–005 contraprovas P0 -> 006–009 frontend ->
010–014 banco/recovery -> 015–017 qualidade/operacao -> 018–020 proveniencia e
control plane -> 022 qualificacao local 2x -> 023–026 externos -> 027 critica
tecnica -> 028 decisao humana.

## Checkpoint R0 — 2026-09-20

- [x] AUD21-001: catalogo importado, sete AUD20 `DONE` reabertos e ponteiros correntes alinhados.
- [x] AUD21-021: os tres trailing whitespaces removidos e `git diff --check` validado.
- [x] AUD21-002: terminalidade e autoridade separada de restore; prova local real conhecida-bad/known-good e restore auditado concluidos.

R0 permanece `PARTIAL`, nao `DONE`, porque o worktree e modificado e o fingerprint
exact-subject reproduzivel ainda nao foi implementado. O veredito permanece
`FAIL / REJECT / AAA_NOT_PROVEN` e a promocao permanece bloqueada.

## Checkpoint AUD21-002 — 2026-09-20

- Memory e PostgreSQL store agora rejeitam `renewLease` quando a sessao nao esta `ACTIVE`.
- `complete` invalida a lease em memory e PostgreSQL; `releaseLease` continua cleanup idempotente.
- A migration 044 cria `cvg_restore_authority`, bloqueia escrita direta do owner generico/runtime em sessoes terminais e registra a autoridade no evento de restore.
- Typecheck, regressao completa (`548`: `547` pass, `1` skip), schema manifest, control plane e `git diff --check` passaram.
- PostgreSQL local descartavel passou os gates `042`/`043` como rejeitados e `044` como aceito, `verify:postgres` integral e `verify:postgres:restore` com autoridade separada, quarentena, leases descartadas, login/readiness bloqueados e source unchanged.

AUD21-002 esta `DONE` no escopo local real verificado. O R0 global permanece `PARTIAL`, `AAA_NOT_PROVEN` e com promocao bloqueada porque o fingerprint exact-subject de AUD21-018, a frente P0 seguinte e as provas production-like/humanas continuam pendentes.

## Next Action — AUD21-003

## Checkpoint AUD21-003 — 2026-09-20

- O resolver agora distingue `DIVERGENT` de `NOT_FOUND`: qualquer identidade conhecida combinada com ID explicito desconhecido ou contraditorio falha fechado.
- API, application service, embedded runtime e harness retornam `DIVERGENT` antes de PDP/tool/provider; o contrato HTTP usa `409` e o frontend preserva a distincao sem expor dados do recurso.
- A matriz cobre patient/encounter, combinacoes parcialmente conhecidas, tenant, unit e workspace; provider/tool capture confirmou zero dispatch nos casos invalidos.
- `npm test` passou com `553` testes: `552` pass, `0` fail, `1` skip; typecheck, PDP boundary e diff gate passaram.
- Receipt: `VER-CVG-AUD21-003-001`.

AUD21-003 esta `DONE` no escopo local verificado. O R0 global permanece `PARTIAL`, `AAA_NOT_PROVEN` e com promocao bloqueada porque o fingerprint exact-subject de AUD21-018, as provas production-like/humanas e as demais frentes P0/P1 continuam pendentes.

## Implementation Note — AUD21-004

- `CVG-AUD21-004:PDP-UNIVERSAL` e a proxima acao ativa.
- Adicionar known-bads para wrappers assincronos, microtasks, callbacks deslocados e sinks de decisao nao comprovados.

## Checkpoint AUD21-004 — 2026-09-20

- O inventario de rotas agora so aceita wrapper que invoca o callback diretamente ou usa `AsyncLocalStorage.run` reconhecido estruturalmente.
- `Promise.resolve().then(handler)`, `.catch(handler)`, `.finally(handler)`, APIs de defer e consumidores arbitrarios de callbacks falham fechado como `ROUTE_OPERATION_MISMATCH`.
- A rota real de AI continua coberta pelo wrapper `AsyncLocalStorage.run`; o gate de cobertura e o inventario runtime permanecem verdes.
- `npm run verify:pdp` passou com `85` operacoes request-bound, `88` regras de aplicacao, `6` politicas canonicas de tool e `12` dominios criticos; a regressao completa passou com `553` testes, `552` pass, `0` fail e `1` skip.
- Receipts: `VER-CVG-AUD21-004-001`, `VER-CVG-AUD21-004-002`.

AUD21-004 esta `DONE` no escopo local verificado. O R0 global permanece `PARTIAL`, `AAA_NOT_PROVEN` e com promocao bloqueada porque o fingerprint exact-subject de AUD21-018, as provas production-like/humanas e as demais frentes P0/P1 continuam pendentes.

## Next Action — AUD21-005

- `CVG-AUD21-005:CANCELLATION-AUTHORITY` e a proxima acao ativa.
- Revalidar abort/fence depois do provider e antes de persistir sucesso ou ack no worker composto.

## Checkpoint AUD21-005 — 2026-09-20

- `runCycle()` agora propaga o controller interno ao relay/outbox e ao sink/provider.
- Receipt `DELIVERED` recebido depois de abort nao vira `SUCCEEDED`: o efeito e registrado como `OUTCOME_UNKNOWN`, o outbox e colocado em quarentena e nenhum ack e emitido.
- A corrida composta com `stop()` foi coberta, incluindo sinal observado pelo sink e ausencia de sucesso/ack tardio.
- `npm run verify:worker-runtime` passou; a regressao completa passou com `555` testes, `554` pass, `0` fail e `1` skip.
- Receipts: `VER-CVG-AUD21-005-001`, `VER-CVG-AUD21-005-002`.

AUD21-005 esta `DONE` no escopo local verificado. O R0 global permanece `PARTIAL`, `AAA_NOT_PROVEN` e com promocao bloqueada porque PostgreSQL/staging production-like, provider externo, fingerprint exact-subject e aceite humano continuam pendentes.

## Checkpoint AUD21-006 — 2026-09-20

- Os schemas web agora sao estritos nos campos semanticos consumidos; UUID, enums, timestamps, versoes, MFA, AI, comunicacao e catalogo fail-closed nao aceitam corrupcao silenciosa.
- A rota Knowledge preserva `dataClass` e `createdAt`; o replay usa capacidades do runtime; `/auth/demo` aceita explicitamente challenge MFA ou sessao.
- Known-goods e known-bads passaram nos testes unitarios; a regressao passou com `556` testes, `555` pass, `0` fail e `1` skip; a matriz executavel Chromium/Firefox passou com `324` testes, `303` pass, `0` fail e `21` skip.
- WebKit nao iniciou por ausencia de `libgstcodecparsers-1.0.so.0`; `verify:static` rejeitou snapshots historicos stale. Nenhum bloqueio foi mascarado ou regenerado fora do processo.
- Receipt: `VER-CVG-AUD21-006-001`.

AUD21-006 esta `DONE` apenas no escopo local verificavel. O R0 global permanece `PARTIAL`, `AAA_NOT_PROVEN` e com promocao bloqueada por fingerprint exact-subject, evidencia externa, WebKit/ambiente, production-like e aceite humano pendentes.

## Checkpoint AUD21-007 — 2026-09-20

- O cleanup da busca agora aborta imediatamente a execucao em voo quando o componente desmonta ou a query/contexto muda; o controller corrente e limpo sem permitir que o `finally` obsoleto encerre o loading da nova execucao.
- A resposta corrente e a unica autorizada a alterar `items`, `error` e `loading`; respostas invertidas nao substituem uma consulta mais nova.
- A matriz focused passou com `18` execucoes, `0` falhas e `0` retries em Chromium/Firefox wide, tablet e mobile: busca invertida, erro semantico/retry e unmount/abort.
- Typecheck e regressao completa passaram (`556` testes: `555` pass, `0` fail, `1` skip); build passou com o warning existente de chunk grande; axe Firefox-wide passou (`2` pass, `1` skip).
- A tentativa de matriz integral de `336` testes excedeu a janela de 600 segundos; a fatia de aceite foi rerodada isoladamente sem falhas. WebKit continua indisponivel por `libgstcodecparsers-1.0.so.0` ausente, e `verify:static` continua rejeitando snapshots historicos stale.
- Receipt: `VER-CVG-AUD21-007-001`.

AUD21-007 esta `DONE` apenas no escopo local verificavel. O R0 global permanece `PARTIAL`, `AAA_NOT_PROVEN` e com promocao bloqueada por fingerprint exact-subject, evidencia externa, WebKit/ambiente, production-like e aceite humano pendentes.

## Checkpoint AUD21-008 — 2026-09-20

- O catalogo canonico agora valida em runtime metodo, path, operacao, auth, request/response schema, idempotencia, deprecation e chaves duplicadas; paths com placeholder ou parametro repetido falham fechado.
- O inventario runtime transporta request/response schema junto do metodo/path e o guard Fastify continua selando a admissao real; o static gate deixou de usar a janela regex e passou a consumir o mesmo analisador AST.
- Known-bads de rota ausente, duplicata, verbo incorreto, parametro placeholder, alias trailing-slash e schema placeholder foram rejeitados; known-good de runtime, metadata e wrappers PDP permaneceram verdes.
- Prova focused passou com `37` testes; a regressao completa passou com `559` testes: `558` pass, `0` fail, `1` skip; typecheck, build, PDP e diff passaram.
- `verify:static` continua falhando somente pelos snapshots historicos stale de evidence; nenhum artefato historico foi regenerado ou mascarado.
- Receipt: `VER-CVG-AUD21-008-001`.

AUD21-008 esta `DONE` apenas no escopo local verificavel. O R0 global permanece `PARTIAL`, `AAA_NOT_PROVEN` e com promocao bloqueada por fingerprint exact-subject, evidencia externa, WebKit/ambiente, production-like e aceite humano pendentes.

## Checkpoint AUD21-009 — 2026-09-20

- `RootErrorBoundary` agora emite `web.root_error` com correlation ID proprio, apenas `errorName` sanitizado e sem message/stack; o ID tambem fica disponivel para suporte na tela.
- Throw controlado foi exercitado em Chromium/Firefox wide/mobile; o fallback recebeu foco, `role=alert`/`aria-live`, axe passou sem violacoes, Tab/Enter alcancaram retry/home e ambas as recuperacoes funcionaram.
- Screenshots do fallback foram capturados por `testInfo.outputPath`; o collector externo nao foi alegado como provado.
- Regressao passou com `559` testes: `558` pass, `0` fail, `1` skip; typecheck, build, PDP, schema manifest e diff passaram. `verify:static` continua limitado aos snapshots historicos stale.
- Receipt: `VER-CVG-AUD21-009-001`.

AUD21-009 esta `DONE` apenas no escopo local verificavel. O R0 global permanece `PARTIAL`, `AAA_NOT_PROVEN` e com promocao bloqueada por fingerprint exact-subject, evidencia externa, WebKit/ambiente, production-like e aceite humano pendentes.

## Checkpoint AUD21-010 — 2026-09-20

- `verify-postgres.ts` substituiu o TTL de `80 ms` e o `sleep(350)` por uma matriz deterministica de `120000 ms`: a expiracao e escrita por uma conexao PostgreSQL separada em `AT_LIMIT` e `AFTER_LIMIT`.
- A matriz executa `20` repeticoes com dois `PostgresAgentSessionStore`/pools, owners concorrentes, load antes/no/depois do limite, acquire/renew bloqueados apos expiracao e release de cleanup.
- O teste unitario local repetiu a mesma fronteira deterministica `20` vezes; a prova PostgreSQL 16 descartavel passou integralmente com `agentSession.ttlContract.status=PASS`, dois pools e `DATABASE_EXPIRY_WRITE_NO_SLEEP`.
- Regressao completa passou com `560` testes: `559` pass, `0` fail, `1` skip; typecheck, build, PDP, schema manifest e diff passaram. O build manteve o warning existente de chunk grande (`572.88 kB`).
- Receipt: `VER-CVG-AUD21-010-001`.
- Reconciliation receipt: `VER-CVG-AUD21-010-002`.
- Current-source revalidation receipt: `VER-CVG-AUD21-010-003`.

AUD21-010 esta `DONE` apenas no escopo local real verificavel. O R0 global permanece `PARTIAL`, `AAA_NOT_PROVEN` e com promocao bloqueada por fingerprint exact-subject, evidencia externa, WebKit/ambiente, production-like e aceite humano pendentes.

## Checkpoint AUD21-011 — 2026-09-20

- `verify-postgres-schema-gates.ts` agora gerencia explicitamente os pools runtime e absorve apenas o `57P01` esperado no teardown dos bancos N-2/N-1; falhas de schema continuam sendo fatais.
- O harness nao usa `GRANT ... ON ALL ...` para fabricar privilegios. Os schema gates exercitam clean install `042`/`043` rejeitados, clean `044` aceito e upgrade `043 -> 044` aceito com smoke duravel de agent session.
- `verify:postgres` confirmou fence futuro/stale/historical, terminalidade, RLS/tenant, privilegios de tabela/sequence futuros e roles separados; `verify:postgres:concurrency` confirmou dois processos, `CLAIMED`/`IN_FLIGHT`, replay e `IDEMPOTENCY_CONFLICT`; isolamento/CAS confirmou commit bloqueado invisivel e conflito `409`.
- Regressao passou com `560` testes: `559` pass, `0` fail, `1` skip; typecheck, build, schema manifest e diff passaram. O build manteve o warning de chunk grande (`572.88 kB`).
- Receipt: `VER-CVG-AUD21-011-001`.
- Reconciliation receipt: `VER-CVG-AUD21-011-002`.

AUD21-011 esta `DONE` apenas no escopo local real verificavel. O R0 global permanece `PARTIAL`, `AAA_NOT_PROVEN` e com promocao bloqueada por fingerprint exact-subject, evidencia externa, WebKit/ambiente, production-like e aceite humano pendentes.

## Next Action — AUD21-012

- `CVG-AUD21-012:WORKER-CRASH-RESTART` e a proxima acao ativa.
- Exercitar crash/restart real antes/depois de efeito, commit e ack, lease loss, duplicidade, poison retryable e outcome unknown.

## Checkpoint AUD21-012 — 2026-09-20

- `scripts/verify-postgres-worker-crash-restart.ts` adiciona um gate de processo real: o parent cria um PostgreSQL 16 descartavel, filhos Node independentes executam o worker/persistencia, e um provider sintetico separado persiste efeitos com `fsync`.
- A matriz injeta `SIGKILL` antes do efeito, depois do efeito/antes do outcome, depois do outcome/antes do ack e depois do ack; cada restart confirma fence/lease, estado duravel, contagem de requests/efeitos e ausencia de reenvio cego.
- O mesmo processo separado prova takeover de lease com ack stale rejeitado, duplicidade sem segundo efeito, poison retryable em duas tentativas ate `QUARANTINED` e `OUTCOME_UNKNOWN` mantido ate query/reconciliacao explicita.
- `npm run verify:postgres:worker-crash-restart` passou todos os oito cenarios; `npm run verify:postgres:worker-effects` permaneceu verde como matriz legada de regressao.
- Regressao corrente: `npm test` passou com `560` testes (`559` pass, `0` fail, `1` skip); typecheck, lint e build passaram. O build manteve o warning existente de chunk grande (`572.88 kB`).
- Receipt: `VER-CVG-AUD21-012-001`.

AUD21-012 esta `DONE` apenas no escopo local real verificavel. O R0 global permanece `PARTIAL`, `AAA_NOT_PROVEN` e com promocao bloqueada por fingerprint exact-subject, evidencia externa, WebKit/ambiente, production-like e aceite humano pendentes.

## Checkpoint AUD21-013 — 2026-09-20

- `packages/persistence/src/index.ts` agora valida semantica de recovery alem da forma: FKs logicas de organizacao/actor, escopo unit/workspace, sequencias contiguas, fences, digest canonico de checkpoint, digest da sessao e leases.
- `scripts/verify-postgres-restore.ts` agora executa known-bads de payload/digest de checkpoint, digest de sessao, actor estrangeiro, gap de sequencia, fence futuro, envelope AES-GCM re-hasheado e falha tardia de restore.
- PostgreSQL 16 descartavel passou clean migrations 001-044, `verify:postgres` e o restore real. O known-good restaurou o destino em `QUARANTINED`, `revision=1`; a falha tardia preservou o digest do estado duravel do destino.
- Regressao corrente: `npm test` passou com `560` testes (`559` pass, `0` fail, `1` skip); typecheck, lint, build, schema manifest e diff passaram. O build manteve o warning existente de chunk grande.
- O container `cvg-aud21-013-pg` e bancos `cvg_restore_*` foram removidos apos a verificacao.
- Receipt: `VER-CVG-AUD21-013-001`.

AUD21-013 esta `DONE` apenas no escopo local real verificavel, com `VERIFY` para revalidacao apos AUD21-018. O R0 global permanece `PARTIAL`, `AAA_NOT_PROVEN` e com promocao bloqueada por fingerprint exact-subject, evidencia externa, WebKit/ambiente, production-like e aceite humano pendentes.

## Next Action — AUD21-014

- `CVG-AUD21-014:SCHEMA-REQUALIFICATION` e a proxima acao ativa.
- Reexecutar clean install, upgrade e readiness N-2/N-1/N das migrations 042-044, preservando os gates de privilegio e o smoke duravel de agent-session.
