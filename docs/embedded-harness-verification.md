# Verificação do harness embarcado — gates, como executar e limitações

**Subject SHA:** `f53f9eb3e5a44240823f29cbf7307a52f6b5a139`
**Data:** 2026-09-16
**Status:** gates de IA executados e aprovados localmente nesta data; evidência externa permanece bloqueada.
**Estado declarado:** `engineeringState = LOCAL_STATE_OF_THE_ART_CANDIDATE` (somente com os gates abaixo aprovados) · `aaaState = AAA_NOT_PROVEN` · `productionState = NOT_PROVEN`.

---

## 1. Lista exata de comandos

```
npm run verify:embedded-harness
npm run verify:agent-runtime
npm run verify:agent-security
npm run verify:plugins
npm run verify:skills
npm run verify:agent-evals
npm run verify:ai-disabled
npm run verify:agent-runtime-smoke
npm run verify:architecture
npm run verify:state-of-art
npm run verify:state-of-art-external
```

O helper `scripts/lib/node-tests.ts` executa os arquivos de teste focados com `node:test` via `tsx` e conta os testes aprovados; um gate falha se o processo de teste falhar.

## 2. O que cada gate verifica

| Gate | O que verifica | Classe de evidência | Status em 2026-09-16 |
| --- | --- | --- | --- |
| `verify:embedded-harness` | Existência dos 17 artefatos obrigatórios (auditoria, ADRs, pacotes, migration), decisão `HYBRID`, commit de proveniência `5dda764ed3...`, tabelas e `FORCE ROW LEVEL SECURITY`; roda testes focados de plugins, skills, model-runtime, model-adapters, context e session | LOCAL_REAL | **PASS** — `artifacts=17 focusedTests=43 license=MIT decision=HYBRID embeddedFiles=0` |
| `verify:agent-runtime` | 13 estados e 9 stop conditions do kernel, limites (`maxTurns`, `maxToolCalls`, `maxTokens`, `maxWallTimeMs`, `maxCostMicros`, `maxFailures`), ausência de imports proibidos no kernel, marcadores do runtime embarcado e do contrato (`AgentRuntimeContract/v1`, replay, settlement); roda testes de kernel, embedded runtime, session e context | LOCAL_REAL | **PASS** — `states=13 stops=9 focusedTests=46` |
| `verify:agent-security` | Suíte adversarial de injeção, plugin, skill, aprovação, fencing, tenant, secrets e gateway; exige pelo menos 10 ataques | LOCAL_REAL | **PASS** — `attacks=10 scope=injection,plugin,skill,approval,fencing,tenant,secrets,gateway` |
| `verify:plugins` | Superfície de permissões (5 permitidas, nenhuma `database`/`filesystem`/`secrets`/`httpClient`), marcadores de allowlist/digest/risco/dependência, princípio “no ambient authority”, `DENIED_STALE_FENCE` no store; roda testes de plugin | LOCAL_REAL | **PASS** — `permissions=5 focusedTests=10` |
| `verify:skills` | Schema `cvg-agent-skill/1`, digest, quarentena, requisitos declarados e o princípio de que skill nunca concede autoridade; roda testes de skill | LOCAL_REAL | **PASS** — `schema=cvg-agent-skill/1 focusedTests=5` |
| `verify:agent-evals` | 7 cenários dourados + comparação diferencial; grava artefato `artifacts/evals/agent-evals-<sha>.json` quando executado via `scripts/agent-evals.ts` | SYNTHETIC | **PASS** — `scenarios=7 differentialParity=1/1 evidence=SYNTHETIC` |
| `verify:ai-disabled` | `createRuntime` com `agentRuntimeMode: "disabled"`: health 200, ready 200 sem depender de IA, `ai.status=DISABLED`, `/api/v1/ai/ready` 503 e acesso não autenticado 401 | LOCAL_REAL | **PASS** — `core=health,ready,auth patients=401 aiReadiness=503/DISABLED` |
| `verify:agent-runtime-smoke` | Ponta a ponta: criação de sessão, tool `READ_ONLY` governada, pausa por aprovação com checkpoint, resume após aprovação, ledger ≥ 3, replay com digest de 64 hex, negação de aprovação consumida e drain limpo | LOCAL_REAL | **PASS** — `session=created tool=governed approval=paused checkpoint=3992d6c6f48d resume=resumed ledger=3 drain=clean` |
| `verify:architecture` | Domínio não importa runtime/provider; kernel não importa domínio/persistência/tools/harness; serviços de aplicação não importam adapters; runtime embarcado depende de `ModelProvider` e implementa `AgentRuntime` | LOCAL_REAL | **PASS** — `runtimePackages=13 domainImports=0 applicationProviderImports=0` |
| `verify:state-of-art` | Composição local dos 25 gates (typecheck, lint, test, contract, security, database, fault, build, gates de IA, produção e licenças); grava `artifacts/operational-proof/state-of-art-local.json` | LOCAL_REAL (quando executado) | NÃO EXECUTADO nesta rodada; gates de IA individuais aprovados acima |
| `verify:state-of-art-external` | Verifica credenciais autorizadas para DeepSeek real, provider real, staging e carga; nunca fabrica execução | EXTERNAL_REAL | **BLOCKED_EXTERNAL** — 9 credenciais ausentes; artefato `artifacts/operational-proof/state-of-art-external.json` |

Gates que dependem do estado canônico `artifacts/quality/current-state.json` (`npm run verify:docs-provenance` e `npm run verify:claims`) não foram avaliados neste worktree porque o arquivo canônico está ausente; por isso os documentos desta entrega declaram o SHA de assunto, a data e os estados manualmente, sem alegar `CURRENT`.

## 3. Como reproduzir

```
git rev-parse HEAD                 # deve ser f53f9eb3e5a44240823f29cbf7307a52f6b5a139
npm ci                             # ou npm install
npm run verify:embedded-harness
npm run verify:agent-runtime
npm run verify:agent-security
npm run verify:plugins
npm run verify:skills
npm run verify:agent-evals
npm run verify:ai-disabled
npm run verify:agent-runtime-smoke
npm run verify:architecture
```

Todos os comandos acima são offline: nenhum provedor, credencial ou dado de paciente é usado. O artefato de evals é sintético (`evidenceClass: "SYNTHETIC"`, provider `mock-model`).

## 4. Interpretação: o que os gates provam e o que não provam

O que está provado localmente:

- O kernel implementa os estados, stop conditions e limites documentados e não importa domínio, persistência, rede ou filesystem.
- Toda tool de IA executada nos cenários atravessa `ToolGateway` → PDP; negações por profile, safe mode, kill switch, risco e policy produzem `DENIED` sem dispatch.
- Sessão, checkpoint e turn ledger funcionam com fence monotônica; aprovação é one-shot, vinculada a digest/policy e resistente a replay.
- Injeção de prompt é quarentenada antes do modelo; conteúdo não confiável nunca ocupa seção confiável de contexto.
- A IA pode ser desligada (`disabled`) sem derrubar health/ready do hospital.
- O runtime embarcado e o harness mock produzem a mesma estrutura de decisão no cenário diferencial marcado.

O que não está provado:

- Comportamento com provider real (DeepSeek ou local), incluindo erros de rede, rate limit e formato de resposta real.
- Latência, throughput e estabilidade sob carga; não há medição local.
- Persistência durável no wiring da API (`MemoryAgentSessionStore` é o default atual) e RLS em PostgreSQL real.
- Isolamento de processo, deploy, TLS interno ou sidecar (ADR 035, fase 2).
- Paridade funcional além de `turnStatus`/`approval`/`policyDenied` no cenário diferencial.
- Qualquer decisão de promoção: STAGING em diante permanece bloqueado (`docs/embedded-runtime-rollout.md`).

## 5. Limitações

- **Provider mock:** os evals e o smoke usam `MockModelProvider`; não há medição de latência, qualidade de texto, custo real ou comportamento de rede.
- **Sessão em memória no wiring da API:** `createEmbeddedRuntimeAdapter` não injeta `sessionStore`; a verificação de persistência durável usa o store em memória. O `PostgresAgentSessionStore` é coberto por testes de unidade que checam o SQL emitido, não por um PostgreSQL real neste conjunto de gates.
- **RLS por análise e teste de shape:** o `FORCE ROW LEVEL SECURITY` é verificado no texto do migration (`verify:embedded-harness`) e por testes de unidade; não houve execução em instância PostgreSQL dedicada nesta rodada.
- **Sem isolamento de processo:** o runtime roda in-process; a prova de isolamento de processo (ADR 035, fase 2) depende de staging e Docker, indisponíveis aqui.
- **Sem staging/carga/chaos:** `verify:staging`, `verify:deepseek-real`, `verify:provider-real` e `verify:load` estão bloqueados por credenciais; chaos/recovery/observabilidade externos estão `NOT_RUN`.
- **Comparação diferencial estreita:** apenas `turnStatus`, `approval` e `policyDenied` do cenário `reception-appointment-confirmation` foram comparados entre embedded e legacy (`docs/embedded-vs-external-comparison.md`).
- **Estado canônico ausente:** `artifacts/quality/current-state.json` não existe neste worktree; os documentos declaram `LOCAL_STATE_OF_THE_ART_CANDIDATE`/`AAA_NOT_PROVEN`/`NOT_PROVEN` com base nos gates locais, e não como certificação.
