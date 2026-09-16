# Runbook — rollback configuracional do Agent Runtime

**Estado:** rollback por configuração implementado (`CVG_AGENT_RUNTIME`); exercício de rollback em staging `NOT_RUN`.
**Owner:** AI runtime + operações. **Abortar se:** o rollback proposto exigir apagar/alterar tabelas `agent_*` ou reescrever migration.

Objetivo: voltar do runtime embarcado para o harness externo (`external`) ou desligar IA (`disabled`) sem tocar no estado durável nem no schema.

## 1. Rotas de rollback

`CVG_AGENT_RUNTIME` aceita `auto | embedded | external | disabled` (`packages/config/src/index.ts:76`). A seleção está em `apps/api/src/app.ts:586-594`:

| Valor | Efeito | Pré-requisitos |
| --- | --- | --- |
| `embedded` | runtime embarcado CVG (`EmbeddedAgentRuntime`) | provider configurado (`CVG_EMBEDDED_MODEL_*`) |
| `external` | `DeepSeekHarnessAdapter` contra o harness externo | `CVG_DEEPSEEK_RUNTIME_ENABLED=true` (`packages/config/src/index.ts:134`) + base URL + `CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT` + `CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION`; em produção também bearer token ref e contexto assinado (linhas 123-124) |
| `disabled` | `DisabledAgentRuntime`, IA fail-closed | nenhum |
| `auto` | comportamento histórico: mock harness, ou DeepSeek externo se `deepseekRuntimeEnabled` | nenhum adicional |

Configuração é lida no boot: rollback exige reinício controlado.

## 2. Compatibilidade de estado

- As tabelas `agent_sessions`, `agent_turns`, `agent_checkpoints` e `agent_leases` pertencem ao runtime embarcado (`db/migrations/038_agent_runtime_session_state.sql`). O runtime externo não as lê, mas o rollback **não** deve removê-las: roll-forward depende delas.
- `agent_turns`/`agent_checkpoints` são append-only por trigger (`cvg_agent_runtime_append_only_guard`, migration 038 linhas 81-97). Correção = nova linha, nunca `UPDATE`/`DELETE`.
- Todos os checkpoints usam `schemaVersion: 1` (`packages/agent-kernel/src/index.ts:257`; `AGENT_SESSION_SCHEMA_VERSION = 1`, `packages/agent-session/src/index.ts:10`). O consumidor lê `payload.checkpoint` (`packages/embedded-agent-runtime/src/index.ts:1045`). Se um roll-forward futuro exigir versão nova, a leitura deve tolerar v1.
- Aprovações (`ai_approvals`) são one-shot e expiram em 5 minutos (`expiresAt`, `packages/embedded-agent-runtime/src/index.ts:951`). Elas não são portáveis entre runtimes: após o rollback, aprovações pendentes do runtime anterior simplesmente expiram.
- RLS por organização é forçada nas quatro tabelas (`force row level security`, migration 038). Não alterar.

## 3. Procedimento

1. Congelar novas entradas de IA (comunicar operação; manter o núcleo rodando).
2. Capturar evidência: `/api/v1/ai/ready` (status/reason), `/api/v1/ai/health`, manifest do runtime (`runtimeManifest()`, `packages/embedded-agent-runtime/src/index.ts:262`), lista de sessões abertas, turnos `OUTCOME_UNKNOWN` e aprovações pendentes.
3. Definir a variável de destino (`disabled` para contenção máxima; `external` para manter assistência pelo harness).
4. Reiniciar a API e confirmar `/api/v1/ai/ready` no estado esperado (`DISABLED` → 503 com `aiState: DISABLED`).
5. Confirmar `/api/v1/ready` do núcleo inalterado (`database`, `outbox`, `auditLedger` `READY`).
6. Encerrar/reconciliar turnos pendentes: `OUTCOME_UNKNOWN` exige reconciliação de efeito (ver `docs/runbooks/session-stuck.md`); aprovações pendentes expiram sozinhas e não devem ser recriadas no runtime novo.
7. Registrar decisão, horário, responsável e correlation IDs.

Preferência de recuperação (mesma regra do rollback de release, `docs/runbooks/rollback.md`): roll-forward ou restauração em destino isolado; downgrade automático de schema não é permitido.

## Verificação pós-rollback

- [ ] `/api/v1/ready` 200 com `database`, `outbox`, `auditLedger` `READY`;
- [ ] `/api/v1/ai/ready` no estado de destino (`DISABLED` → 503/`DISABLED`; `external` → conforme health do harness);
- [ ] `agent_sessions`/`agent_turns`/`agent_checkpoints` com a mesma contagem e digests de antes;
- [ ] nenhuma aprovação pendente recriada ou reaproveitada;
- [ ] sessões abertas sem dono listadas e encerradas/reconciliadas com registro;
- [ ] chaves de idempotência de turnos em andamento conhecidas: um retry com a mesma chave retorna o turno existente (`findExistingTurn`, `packages/embedded-agent-runtime/src/index.ts:1083`) e não duplica efeito;
- [ ] decisão registrada com horário, responsável e correlation IDs.

## Evidência

- valor de `CVG_AGENT_RUNTIME` antes/depois e `manifestVersion`/`engineCommit` de cada runtime;
- `/api/v1/ready` e `/api/v1/ai/ready` antes/depois;
- contagem e digests de `agent_turns`/`agent_checkpoints` preservados (prova de que o estado não foi alterado);
- lista de sessões abertas e destino de cada uma;
- registro de auditoria das ações operacionais.

## O que NÃO fazer

- Nunca apagar tabelas `agent_*`, colunas, triggers ou políticas de RLS para "limpar" o rollback.
- Nunca reescrever a migration 038 nem editar uma migration aplicada: mudança de schema = nova migration revisada.
- Nunca fazer `UPDATE`/`DELETE` em `agent_turns`/`agent_checkpoints`; o trigger rejeita, e tentar contorná-lo é incidente.
- Nunca reaproveitar `approvalId` entre runtimes ou ressuscitar aprovação expirada.
- Nunca usar `docker compose down -v` nem remover volumes.
- Nunca ligar `external` sem os pré-requisitos aprovados (commit/manifest/credencial): o adapter é fail-closed por desenho.
