# Reauditoria do resultado CVG-AUD20 — 2026-09-20

**Estado:** FINALIZADA
**Objeto:** worktree local derivado de `c990914148a8f375082cd12bbdb2ad20cfe1900f`
**Veredito:** `FAIL / REJECT` para promoção
**Nota:** não certificável neste objeto; a barra exige evidência executável current por dimensão
**Qualidade global:** `AAA_NOT_PROVEN`

Documentos derivados: [roadmap AUD21](roadmap-melhorias-cvg-aud21-2026-09-20.md) e [backlog AUD21](backlog-melhorias-cvg-aud21-2026-09-20.md).

## 1. Decisão executiva

O relatório CVG-AUD20 acertou o estado global `PARTIAL / AAA_NOT_PROVEN`, mas superestimou os fechamentos locais. Sete itens declarados `DONE` não atendem ao próprio contrato de aceite: `001`, `002`, `006`, `007`, `009`, `012` e `013`. Há contraprovas executáveis para seis deles e insuficiência objetiva de evidência para `012`.

As migrations 042/043, o manifesto de schema, a correção principal da busca e a propagação parcial de `AbortSignal` são avanços reais. Eles devem ser preservados. Entretanto, gates agregados verdes não capturam os seguintes comportamentos:

- uma sessão `COMPLETED` renova seu lease;
- o gate de PDP aceita um wrapper adiado por `Promise.then`;
- um provider pode abortar durante `deliver()` e ainda assim ser gravado como `SUCCEEDED` e reconhecido;
- uma combinação de IDs divergente retorna `NOT_FOUND`, não o `DIVERGENT` exigido;
- schemas web aceitam valores semanticamente corrompidos e removem campos consumidos pela UI;
- a rota de Conhecimento cai no `RootErrorBoundary` em Chromium e Firefox;
- o validador do control plane passa com ExecPlan, checkpoint, evento e evidência corrente divergentes.

O estado correto é:

- implementação local: **PARTIAL, com contraprovas P0 abertas**;
- evidência AUD20: **não vinculada de forma reproduzível ao candidato**;
- qualificação local dupla: **NOT_RUN**;
- produção/Triplo AAA: **REJECT / NOT_PROVEN**;
- próxima ação: `CVG-AUD21-001`, seguida das contraprovas de terminalidade, PDP, cancelamento, identidade e contratos web.

## 2. Escopo, identidade e método

A barra congelada foi `.gauntlet/bar-v4.json`, SHA-256 `2093461a8d6103641a555ad45371dde4649e5f144c32260b80244e219fa70697`. O `HEAD` permaneceu em `c990914148a8f375082cd12bbdb2ad20cfe1900f`; o worktree tinha 66 arquivos modificados ou não rastreados antes desta atualização documental.

O fingerprint de repositório+estado usado pelos três críticos foi `c61ba23c16db1426ff2441a6f7f4ec9700a43e895c8e809cff982c19168d0d2f`. O digest do artefato serializado pelo helper foi `bc4177fd0df737fe7a28f6b903c6ae327dacfc64eb9c7427599b8cb04e036f15`. O valor AUD20 `d19f39bea50a0b5a7f6aa337b0337db5e0465190003de13389d40109f98dfc1b` não possui manifesto, algoritmo e inventário de bytes reproduzíveis; os valores não devem ser comparados como se fossem a mesma função.

Três críticos frescos, read-only e sem contexto herdado cobriram backend/dados, frontend/operação e evidência/control plane. Todos terminaram em `REJECT`, com mutation sentinel estável.

| Crítico | Escopo | Decisão | Mutation sentinel |
|---|---|---|---|
| `AUD21-BACKEND-DATA` | 002–011, migrations, runtime e recovery | REJECT | MATCH |
| `AUD21-FRONTEND-OPS` | 012–018, browser e observabilidade | REJECT | MATCH |
| `AUD21-EVIDENCE-CONTROL` | 001 e 019–025 | REJECT | MATCH |

O relatório do agente foi tratado como alegação, não como prova. Contraprovas foram executadas no worktree ou em cópias isoladas sob `/tmp`; os críticos não editaram o repositório compartilhado.

Os relatórios dos críticos retornaram pela sessão de auditoria e não foram persistidos como artefatos assinados no repositório ou em evidence root externo. Portanto, identidade, decisões e sentinels acima são insumos read-only desta reauditoria, não satisfação durável de F0/F36 nem revisão independente de release. O backlog AUD21 exige essa persistência verificável em 018, 026 e 027.

## 3. Achados bloqueadores

### AUD21-001 — Control plane false-green

**Severidade:** CRÍTICA
**Reabre:** CVG-AUD20-001 e bloqueia 021/022

`verify:control-plane` retorna verde, porém o estado aponta para `CVG-AUD20-008:TTL-DETERMINISM` e o cabeçalho do ExecPlan aponta para `CVG-AUD20-002:TERMINALITY-RESTORE-AUTHORITY`. `active_checkpoint` e `current_evidence_note` ainda descrevem AUD13, e `last_event_id` aponta para 17/09 apesar de o log possuir eventos AUD20 posteriores.

O verificador não lê o conteúdo do ExecPlan nem valida checkpoint, evento corrente, evidência corrente, fingerprint, transições ou timestamps de state/backlog. Known-bads desses campos retornaram zero achados. `REC-CVG-AUD20-001` é `PASS_WITH_LIMITATION`, não possui fingerprint/hashes e não sustenta `DONE`.

Evidência: [verificador](../scripts/verify-control-plane.ts), [estado](../.agent/state.json), [ExecPlan](../.agent/plans/2026-09-20-cvg-aud20-improvements.md) e [backlog canônico](../.agent/backlog.json).

### AUD21-002 — Terminalidade não cobre renovação de lease nem autoridade de restore separada

**Severidade:** CRÍTICA
**Reabre:** CVG-AUD20-002

Após `complete()`, `renewLease()` retornou lease válido no store de memória. O store PostgreSQL repete a falha: verifica TTL, owner e fence, mas não `status='ACTIVE'`. A migration 042 protege inserts de turns/checkpoints, não leases.

Além disso, `cvg_agent_restore_authority()` equivale ao owner da tabela. Não existe papel/procedure de restore separado e auditado, e o owner recebe bypass amplo para qualquer sessão não ativa. Isso é menor que o contrato de aceite congelado.

Evidência: [agent-session](../packages/agent-session/src/index.ts) e [migration 042](../db/migrations/042_restore_authority_and_terminal_guards.sql).

### AUD21-003 — Gate universal de PDP aceita wrapper assíncrono

**Severidade:** ALTA
**Reabre:** CVG-AUD20-007

O analisador rejeita cinco APIs de deferral conhecidas, mas aceita `Promise.resolve().then(handler)`. A contraprova retornou inventário sem achados, embora a decisão tenha sido movida para uma microtask. O teste atual cobre `setTimeout`, não callbacks arbitrários ou `Promise.then`.

Evidência: [inventário PDP](../scripts/pdp-route-inventory.ts) e [teste atual](../tests/unit/pdp-universal.test.ts).

### AUD21-004 — Cancelamento ainda permite sucesso e ack

**Severidade:** CRÍTICA
**Reabre:** CVG-AUD20-009

`OutboxWorker` testa o sinal antes de `deliver()`, mas não o revalida depois do await e antes de persistir sucesso/ack. Na contraprova, o provider abortou o sinal dentro de `deliver()` e retornou um receipt; o resultado observado foi `ack=1`, efeito `SUCCEEDED` e `delivered=1`.

Há outro gap de composição: `runCycle()` cria um controller, mas o caminho de outbox chama `runOnce()` sem inserir esse sinal em `relayOptions`. O receipt 009 executou apenas `tests/unit/integrations.test.ts`; não provou stop, timeout e corrida com ack no worker composto.

Evidência: [worker](../apps/worker/src/worker.ts) e [OutboxWorker](../packages/integrations/src/index.ts).

### AUD21-005 — Matriz de identidade não cumpre “todo desacordo é DIVERGENT”

**Severidade:** ALTA
**Reabre:** CVG-AUD20-006

O resolver retorna imediatamente `NOT_FOUND` para `encounterId` inexistente antes de comparar um `resourceId`/`patientId` conhecido. A contraprova com paciente real e encounter diferente inexistente retornou `NOT_FOUND`; o contrato 006 exige `DIVERGENT` para todo desacordo e uma matriz patient × encounter × workspace, que não existe integralmente.

Evidência: [resolver de domínio](../packages/domain/src/index.ts) e [integração parcial](../tests/integration/aud19-clinical-isolation.test.ts).

### AUD21-006 — Contratos web permissivos causam crash em browser

**Severidade:** CRÍTICA
**Reabre:** CVG-AUD20-013

O receipt afirma “passthrough removido”, mas o código ainda usa `.passthrough()` e mantém IDs, status, timestamps e quantidades como strings/números irrestritos em várias famílias. Probes aceitaram diagnóstico com paciente/status inválidos, estoque negativo/fracionário, resumo com timestamp inválido e sessão IA com enums corrompidos.

O schema de conhecimento remove `source`, `dataClass` e `createdAt`; o componente usa `createdAt`. A jornada primária de acessibilidade caiu em Chromium e Firefox com `RangeError: Invalid time value` e exibiu o boundary raiz.

Evidência: [registry web](../apps/web/src/api/validation.ts) e [tela de conhecimento](../apps/web/src/features/knowledge/Knowledge.tsx).

### AUD21-007 — StrictMode melhorou, mas o aceite 012 não foi provado

**Severidade:** ALTA de evidência
**Reabre:** CVG-AUD20-012

A corrida de respostas passa 4/4 em Chromium+Firefox, e o desenho por `AbortController` é uma melhoria. Porém não há teste de componente montado sob `StrictMode`, unmount com request em voo ou erro da busca. O segundo E2E selecionado pelo receipt testa payload malformado e declara que o root boundary não foi acionado. Logo o subconjunto observado não basta para `DONE`.

### AUD21-008 — Proveniência e semântica de saída continuam abertas

**Severidade:** ALTA
**Mantém abertos:** CVG-AUD20-019/020/021

Não existe manifesto reproduzível para `d19f39…`; `.agent/backlog.json` foi modificado sete segundos depois do timestamp comum dos receipts. `artifacts/release-provenance.json` não existe.

`verify-state-of-art-external.ts` escreve um artefato dentro da árvore antes de verificar pré-requisitos e retorna exit `0` quando faltam credenciais. O artefato existente aponta para outro SHA. Isso viola a distinção entre `PASS`, `FAIL` e `BLOCKED_EXTERNAL` e impede evidência externa confiável.

### AUD21-009 — Recovery, TTL e matrizes adversariais permanecem parciais

**Severidade:** ALTA
**Mantém abertos:** CVG-AUD20-005/008/010/011

- TTL PostgreSQL ainda usa 80 ms e sleep de 350 ms; não há 20 repetições antes/no limite/depois do vencimento com dois pools.
- O gate de concorrência exercita command receipts, não sessões/owners.
- O schema-gate concede `ON ALL SEQUENCES` fora das migrations, contrariando a condição “zero grants fora das migrations”.
- Worker-effects não executa restart real nem todos os crash cutpoints; o ack failure é monkeypatch.
- Recovery valida `recordDigest` e formas básicas, mas não recalcula o digest semântico do checkpoint, não liga `session.checkpointDigest` e não fecha FKs/fences lógicos.

### AUD21-010 — Boundary, toolchain, alertas e logs não atingem o contrato

**Severidade:** ALTA
**Mantém abertos:** CVG-AUD20-015/016/017/018

- `componentDidCatch` não emite telemetria; a correlação exibida é o último ID global, não um evento ligado ao erro.
- `lint` é scanner textual, sem ESLint/React Hooks/jsx-a11y.
- O build gera chunk JS de 539,14 kB, emite warning e passa; não há budget, code splitting, Lighthouse ou CWV.
- O contraste cobre sete pares hard-coded, não componentes renderizados.
- A topologia Prometheus→Alertmanager existe, mas não há drill firing→receiver→resolved.
- Logs ficam em ring buffer; redaction é por nome de chave. Um valor contendo e-mail, bearer e secret sob a chave `note` permaneceu integral. Não há retenção, consulta, restart survival ou acesso auditado.

### AUD21-011 — Higiene do diff já está vermelha

**Severidade:** MÉDIA
**Bloqueia:** qualificação local

`git diff --check` falhou por trailing whitespace em três fixtures de `tests/unit/pdp-universal.test.ts`. A suíte e o lint customizado não detectam essa falha.

## 4. Estado corrigido do CVG-AUD20

| Item | Registrado | Estado auditado | Motivo |
|---|---|---|---|
| 001 | DONE | **REOPEN** | Ponteiros divergentes e gate false-green. |
| 002 | DONE | **REOPEN** | Lease renova após terminal; restore não tem autoridade separada/auditada. |
| 003 | DONE | **IMPLEMENTED_UNVERIFIED** | Migration 043 é coerente; falta prova current/exact-subject de clean install e upgrade. |
| 004 | DONE | **IMPLEMENTED_UNVERIFIED** | Manifesto estático passa; prova PostgreSQL não está vinculada ao candidato atual. |
| 005 | PARTIAL | **PARTIAL** | Matriz incompleta e ref `VER-CVG-AUD20-005` inexistente. |
| 006 | DONE | **REOPEN** | Combinação divergente pode retornar NOT_FOUND. |
| 007 | DONE | **REOPEN** | `Promise.then` contorna o gate. |
| 008 | IN_PROGRESS | **IN_PROGRESS** | 80 ms/sleep e matriz de borda ausente. |
| 009 | DONE | **REOPEN** | Abort durante provider ainda vira sucesso/ack. |
| 010 | READY | **PARTIAL** | Harness parcial existe; crash/restart real ausente. |
| 011 | READY | **PARTIAL** | Validação estrutural existe; corrupção semântica é aceita. |
| 012 | DONE | **REOPEN/EVIDENCE** | Corrida passa; StrictMode/unmount/error não provados. |
| 013 | DONE | **REOPEN** | Known-bads aceitos e crash web reproduzido. |
| 014 | PARTIAL | **PARTIAL** | Limitação AST/mutantes foi declarada honestamente. |
| 015–018 | READY | **READY** | Implementações parciais não cumprem o aceite. |
| 019 | READY | **READY** | Manifesto/fingerprint não implementado. |
| 020 | READY | **READY, known-bad confirmado** | Exit externo e artifact root incorretos. |
| 021 | READY | **BLOCKED_BY_DEPENDENCIES** | Depende de 019/020 e seu gate atual é insuficiente. |
| 022 | BLOCKED_BY_DEPENDENCIES | **BLOCKED_BY_DEPENDENCIES / NOT_RUN** | Matriz dupla same-fingerprint não ocorreu. |
| 023 | BLOCKED_EXTERNAL | **BLOCKED_EXTERNAL / NOT_RUN** | Sem staging/providers/autoridades. |
| 024 | BLOCKED_BY_DEPENDENCIES | **BLOCKED_BY_DEPENDENCIES / NOT_RUN** | Esta auditoria não é o F0–F38 final. |
| 025 | BLOCKED_HUMAN | **BLOCKED_HUMAN / NOT_RUN** | Sem atestação humana criptográfica. |

## 5. Verificações observadas

| Verificação | Resultado | Leitura correta |
|---|---|---|
| `npm run typecheck` | PASS | Tipagem configurada, não prova invariantes. |
| `npm run lint` | PASS, 233 arquivos | Scanner customizado; não é ESLint e não pegou whitespace. |
| `npm test` | 546; 545 pass; 1 skip | Regressão ampla verde, mas known-bads novos passam fora dela. |
| `verify:control-plane` | PASS falso-verde | Não valida o contrato 001/021. |
| `verify:schema-manifest` | PASS | Manifesto e arquivos 043 estão alinhados. |
| `verify:pdp-universal` | PASS falso-verde parcial | `Promise.then` não é detectado. |
| `verify:agent-security` | PASS, 10 ataques | Não cobre os achados desta rodada. |
| Probes terminal/identity/PDP/cancel | **FAIL reproduzido** | Contraprovas 002/006/007/009. |
| Probes de contratos/redaction | **FAIL reproduzido** | Payloads inválidos e segredo por valor aceitos. |
| E2E selecionado 012 | 4/4 PASS | Apenas corrida e payload malformado. |
| Jornada axe primária Chromium+Firefox | 2 FAIL, 2 PASS, 2 skip | Knowledge quebra nos dois engines. |
| `npm run build` | PASS com warning | Chunk JS 539,14 kB sem budget. |
| `git diff --check` | **FAIL** | Três ocorrências de trailing whitespace. |
| PostgreSQL 16 independente nesta auditoria | NOT_ESTABLISHED | A tentativa não alcançou o harness por conexão runtime indisponível; não conta como falha de produto nem como prova current. |
| Alertmanager, logs duráveis, Lighthouse/CWV | NOT_RUN | Estrutura não equivale a drill. |
| WebKit/AT/zoom, staging, provider, carga/chaos/RTO-RPO | BLOCKED_EXTERNAL / NOT_RUN | Não contam como pass. |

## 6. Leitura por dimensão

Uma nota numérica não é emitida: o objeto não possui evidência current/exact-subject suficiente para aplicar os thresholds da barra de forma reproduzível. A classificação abaixo indica o tipo de lacuna, não substitui o scorecard final.

| Dimensões | Estado auditado | Razão dominante |
|---|---|---|
| Arquitetura, domínio, autorização, PDP e tool gateway | **FAIL / PARTIAL** | Contraprovas de terminalidade, identidade e wrapper assíncrono. |
| Banco, confiabilidade, workers e recovery | **FAIL / PARTIAL** | TTL, cancelamento, crash/restart e validação semântica incompletos. |
| Frontend, acessibilidade, testes e performance | **FAIL / PARTIAL** | Crash Knowledge, schemas permissivos e gates/toolchain ausentes. |
| Observabilidade | **NOT_PROVEN** | Sem alert drill e logs duráveis/redigidos. |
| DeepSeek, provider e governança externa | **BLOCKED_EXTERNAL / NOT_RUN** | Verticais reais e autoridades ausentes. |
| DevOps, supply chain e prontidão de produção | **FAIL / NOT_PROVEN** | Fingerprint, exits, CI/provenance e control plane não fecham. |

Nenhuma dimensão pode ser promovida pelos thresholds 95–97 enquanto houver contraprova P0, stale evidence ou fase obrigatória `NOT_RUN`.

## 7. Limites e retomada

- Nenhum commit, push, deploy, PR, credencial real, dado real ou decisão humana foi produzido.
- A auditoria atualizou somente documentação; não reconciliou `.agent/*` nem alterou produto.
- O PostgreSQL descartável existente não forneceu uma conexão runtime reproduzível nesta coleta independente; receipts anteriores não foram promovidos a evidência current.
- Esta rodada não substitui a crítica final F0–F38 nem os red teams separados F23/F24.

A retomada deve seguir o [roadmap AUD21](roadmap-melhorias-cvg-aud21-2026-09-20.md) e o [backlog AUD21](backlog-melhorias-cvg-aud21-2026-09-20.md). Promoção continua proibida até: zero contraprova P0, qualificação local duas vezes no mesmo fingerprint, evidência externa same-candidate, críticos finais independentes e decisão humana atestada.
