# ADR 038 — Persistência de sessão do Agent Runtime

**Status:** accepted (PostgreSQL com RLS + lease/fencing; retenção `PROPOSED`).
**Relacionados:** [ADR 004](004-persistence-and-ledgers.md) · [ADR 010](010-postgresql-rls.md) · itens 109–119, 134–136 do prompt.

## Contexto

O runtime embarcado precisa de sessão que sobreviva a crash e possa ser retomada sem repetir
efeitos externos, sem depender da memória do processo e sem criar uma segunda autoridade de
banco.

## Decisão

1. **Boundary única**: `AgentSessionStore` (`packages/agent-session`):

   ```ts
   interface AgentSessionStore {
     create(input): Promise<AgentSessionRecord>;
     load(sessionId, context): Promise<AgentSessionRecord | null>;
     checkpoint(checkpoint): Promise<AgentCheckpointRecord>;
     acquireLease(input): Promise<AgentLease | null>;
     renewLease(input): Promise<AgentLease | null>;
     releaseLease(input): Promise<void>;
     appendTurn(turn): Promise<void>;
     complete(sessionId, fence): Promise<void>;
   }
   ```

2. **Autoridade**: PostgreSQL do CVG (migrations CVG normais). Implementações:
   - `PostgresAgentSessionStore` — produção, com RLS organizacional e `FORCE ROW LEVEL SECURITY`;
   - `MemoryAgentSessionStore` — somente desenvolvimento/testes.
3. **Tabelas** (`db/migrations/038_agent_runtime_session_state.sql`): `agent_sessions`,
   `agent_turns` (turn ledger append-only), `agent_checkpoints`, `agent_leases`, todas com
   `organization_id` e políticas RLS derivadas do contexto transacional, FKs e índices.
   Nenhum banco paralelo do "harness".
4. **Fencing**: cada lease possui `fence` monotônico. Escrita com fence obsoleto falha com
   `DENIED_STALE_FENCE`; a instância antiga não pode persistir novo estado. Lease expirada pode
   ser adquirida por outra instância com fence maior.
5. **Checkpoint versionado**: todo checkpoint declara `schemaVersion`; migração por upcaster
   explícito; digest do conteúdo permite detectar adulteração.
6. **Turn ledger**: turnos concluídos nunca são sobrescritos; correções geram novo turno/evento.
   Cada turno guarda `inputDigest`, `contextDigest`, `modelRequestDigest`, `modelResponseDigest`,
   `toolRequestIds`, `usageRecordId`, `provenance` e timestamps.
7. **Nunca armazenar**: secrets em claro, credenciais de provider, payload clínico desnecessário.
   Preferir digest + provenance estruturada.
8. **Retenção**: metadados de turno, respostas cruas, snapshots de contexto e tool results têm
   políticas separadas; qualquer decisão legal/regulatória permanece `PROPOSED` até aprovação
   humana.

## Consequências

- Crash/restart retoma do checkpoint com lease/fence; `WAITING_HUMAN_APPROVAL` e `OUTCOME_UNKNOWN`
  persistem através do restart (nunca convertidos automaticamente).
- Duas instâncias nunca executam a mesma sessão simultaneamente.
- Backup/restore do estado de agente segue o processo de recuperação do CVG; a inclusão explícita
  no bundle gerenciado é um item de staging (limitação registrada, não provada localmente).
