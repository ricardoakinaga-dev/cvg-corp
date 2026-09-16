# Rollout do runtime embarcado — fases, rollback e critérios de promoção

**Subject SHA:** `f53f9eb3e5a44240823f29cbf7307a52f6b5a139`
**Data:** 2026-09-16
**Status:** LAB executado localmente; SHADOW apenas em modo diferencial sintético; STAGING em diante bloqueado por ausência de ambiente e credenciais autorizadas.
**Estado declarado:** `engineeringState = LOCAL_STATE_OF_THE_ART_CANDIDATE` · `aaaState = AAA_NOT_PROVEN` · `productionState = NOT_PROVEN`.

---

## 1. Modelo de fases

| Fase | Objetivo | Evidência de saída | Status em 2026-09-16 |
| --- | --- | --- | --- |
| **LAB** | Kernel, contexto, sessão, plugins, skills e provider funcionando localmente com provider determinístico | Gates `verify:embedded-harness` e `verify:agent-runtime` + os demais gates de IA | CONCLUÍDO (local) |
| **SHADOW** | Comparar o runtime embarcado com o runtime externo/mock sem executar efeitos reais | Evals diferenciais `scripts/agent-evals.ts` (paridade estrutural) | PARCIAL — só comparação sintética; sem espelho de tráfego real |
| **STAGING** | Processo/ambiente autorizado, provider real, PostgreSQL real, carga controlada | `verify:staging`, `verify:deepseek-real`, `verify:provider-real`, `verify:load` | BLOQUEADO — `BLOCKED_EXTERNAL` |
| **CANARY** | Fração pequena do tráfego de IA com kill switch e rollback imediato | Monitoração, shadow comparativo e decisão humana | NÃO INICIADO (depende de STAGING) |
| **PRODUCTION** | Decisão humana explícita com evidência externa | Aprovação humana + evidência externa arquivada | NOT_PROVEN — não autorizado |

A sequência e as opções de arquitetura estão em `docs/adr/ADR-agent-runtime-embedding-decision.md` (HYBRID) e `docs/adr/ADR-agent-runtime-process-boundary.md` (in-process na fase 1; processo standalone deferido).

## 2. O que foi concluído localmente (LAB)

- Pacotes autorais: `packages/agent-kernel`, `agent-context`, `agent-session`, `agent-plugins`, `agent-skills`, `model-runtime`, `model-adapters`, `embedded-agent-runtime`; migração `db/migrations/038_agent_runtime_session_state.sql`.
- Seleção de runtime por configuração: `auto | embedded | external | disabled` (`packages/config/src/index.ts:76`; wiring em `apps/api/src/app.ts:586`).
- Evals dourados determinísticos (7 cenários) e uma comparação diferencial com paridade estrutural (`npm run verify:agent-evals`).
- Rollback de IA desabilitada comprovado localmente: `npm run verify:ai-disabled` mantém health/ready e rejeita acesso não autenticado com a IA desligada.
- Smoke de ponta a ponta com sessão, tool governada, pausa por aprovação, checkpoint/resume, ledger e drain: `npm run verify:agent-runtime-smoke`.

Contagens registradas em 2026-09-16 (detalhe em `docs/embedded-harness-verification.md`): `verify:embedded-harness` focusedTests=43; `verify:agent-runtime` focusedTests=46; `verify:agent-security` attacks=10; `verify:plugins` focusedTests=10; `verify:skills` focusedTests=5; `verify:agent-evals` scenarios=7 com paridade 1/1.

## 3. O que está bloqueado (STAGING em diante)

| Bloqueio | Evidência | Consequência |
| --- | --- | --- |
| Sem staging autorizado | `CVG_STAGING_URL` ausente; `verify:state-of-art-external` → `BLOCKED_EXTERNAL` | Nenhuma execução em ambiente real; nenhuma prova de carga/chaos/recovery externos |
| Sem DeepSeek real | `CVG_DEEPSEEK_REAL_URL`, `CVG_DEEPSEEK_REAL_BEARER_TOKEN`, `CVG_DEEPSEEK_REAL_CONTEXT_SIGNING_SECRET`, `CVG_DEEPSEEK_REAL_EVIDENCE_FILE` ausentes | Provider real não exercitado; evals permanecem sintéticos |
| Sem provider externo real | `CVG_PROVIDER_REAL_ENDPOINT`, `CVG_PROVIDER_REAL_TOKEN`, `CVG_PROVIDER_REAL_RECIPIENT` ausentes | Egress e efeitos externos reais não provados |
| Sem Docker neste ambiente | ADR 035, fase 2 deferida | Sem prova de isolamento de processo para o runtime |
| Sem carga externa | `CVG_LOAD_BASE_URL` ausente | Sem prova de latência ou throughput |
| Sessão Postgres não conectada no app | `createEmbeddedRuntimeAdapter` não injeta `sessionStore` (`apps/api/src/app.ts:139`) | Persistência durável de sessão fica em `MemoryAgentSessionStore` no wiring atual |
| Retenção de dados de IA | ADR 038, item 8 | Políticas permanecem `PROPOSED` até aprovação humana |
| Promoção a produção | Nenhuma autoridade humana designada | `productionState = NOT_PROVEN` |

O script `scripts/verify-state-of-art-external.ts` nunca fabrica execução: sem credenciais ele grava `artifacts/operational-proof/state-of-art-external.json` com `status: BLOCKED_EXTERNAL` e a lista de credenciais ausentes, e sai com código 0.

## 4. Rollback

| Ação | Como | Efeito |
| --- | --- | --- |
| Voltar ao harness externo | `CVG_AGENT_RUNTIME=external` (exige `deepseekRuntimeEnabled` + URL/commit/manifest aprovados, `packages/config/src/index.ts:134`) | Delegação ao `DeepSeekHarnessAdapter` (`packages/harness-adapters/src/index.ts:184`); domínio intacto |
| Desligar IA | `CVG_AGENT_RUNTIME=disabled` | `DisabledAgentRuntime` fail-closed; readiness de IA `DISABLED`, hospital segue operando (`npm run verify:ai-disabled`) |
| Voltar ao harness mock local | `CVG_AGENT_RUNTIME=auto` sem DeepSeek habilitado | `MockHarnessAdapter` + `GovernedHarness` |
| Desabilitar provider específico | `CVG_AI_DISABLED_PROVIDERS` | Roteador recusa o provider por chamada (`ModelRouter.isEnabled`) |
| Desabilitar tool específica | `CVG_AI_DISABLED_TOOLS` | `requestTool` nega com `TOOL_KILL_SWITCH` |
| Somente leitura de IA | `CVG_AI_SAFE_MODE=true` | Tools não `READ_ONLY` negadas com `SAFE_MODE_READ_ONLY`; eval `safe-mode-read-only` |
| Drenar instância | `shutdown()` do runtime | Supervisor aguarda `activeTurns` até o deadline e para; lease expirada é readquirível com fence maior |

O rollback é configuracional e não altera domínio, banco de negócio nem audit chain — a falha de IA degrada a IA, não o hospital.

## 5. Gatilhos de parada (halt triggers)

| Sinal | Gatilho | Resposta esperada |
| --- | --- | --- |
| Provider `UNAVAILABLE`/`DEGRADED` | `health()` do provider ou do runtime | Desabilitar provider; IA reporta `AI_DEGRADED` |
| Aumento de quarentena por injeção | eventos `agent.turn.completed` com conteúdo retido | Safe mode e/ou desligar runtime |
| `DENIED_STALE_FENCE` | conflito de lease/fence | Bloquear novas admissões da sessão e investigar concorrência |
| `OUTCOME_UNKNOWN`/`RECONCILIATION_REQUIRED` | tool ou settlement incerto | Nenhum retry cego; reconciliar antes de nova tool de efeito |
| `BUDGET_EXCEEDED`, `MAX_FAILURES`, `LOOP_DETECTED` | limites do kernel | Parada automática do turno (comportamento já implementado) |
| Falha de tenant/RLS | erro de escopo em sessão/leitura | Parar o runtime e tratar como incidente de segurança |
| `aiMaxConcurrentTurns` saturado | supervisor retorna `RUNTIME_UNAVAILABLE` | Degradação explícita; não enfileirar sem backpressure |

## 6. Checklist de promoção (status atual)

| Item | Verificação | Status 2026-09-16 |
| --- | --- | --- |
| Compilação, lint, testes e build completos | `npm run verify:state-of-art` (composição de 25 gates) | NÃO EXECUTADO nesta rodada; gates de IA individuais aprovados |
| Contrato do kernel | `npm run verify:agent-runtime` | PASS (focusedTests=46) |
| Artefatos e decisão de embedding | `npm run verify:embedded-harness` | PASS (focusedTests=43) |
| Segurança adversarial | `npm run verify:agent-security` | PASS (attacks=10) |
| Plugins | `npm run verify:plugins` | PASS (focusedTests=10) |
| Skills | `npm run verify:skills` | PASS (focusedTests=5) |
| Evals dourados + diferencial | `npm run verify:agent-evals` | PASS (scenarios=7; paridade 1/1, SYNTHETIC) |
| Continuidade com IA desabilitada | `npm run verify:ai-disabled` | PASS |
| Smoke de sessão/aprovação/checkpoint | `npm run verify:agent-runtime-smoke` | PASS |
| Fronteiras arquiteturais | `npm run verify:architecture` | PASS |
| Proveniência documental | `npm run verify:docs-provenance` | NÃO AVALIADO — depende de `artifacts/quality/current-state.json`, ausente neste worktree |
| Detector de overclaim | `npm run verify:claims` | NÃO AVALIADO — mesma dependência acima |
| Evidência externa | `npm run verify:state-of-art-external` | BLOCKED_EXTERNAL (9 credenciais ausentes) |
| Persistência de sessão PostgreSQL no app | wiring + teste de integração real | PENDENTE |
| Processo standalone (ADR 035 fase 2) | staging + isolamento | DEFERIDO |
| Retenção de dados de IA | aprovação humana | PROPOSED |
| Decisão de promoção | autoridade humana | PENDENTE |
