import { createHash } from "node:crypto";

/**
 * Durable, fenced agent session state.  PostgreSQL is the only production
 * authority; the memory store exists for development and tests.  A session can
 * never be executed by two instances at once: leases carry monotonic fencing
 * tokens and a stale writer is rejected with DENIED_STALE_FENCE.
 */

export const AGENT_SESSION_SCHEMA_VERSION = 1;

export type AgentRunState =
  | "CREATED"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "OUTCOME_UNKNOWN"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "QUARANTINED"
  | "QUARANTINED_RESTORE";

export interface AgentSessionScope {
  organizationId: string;
  actorId: string;
}

export interface AgentSessionRecord {
  sessionId: string;
  organizationId: string;
  actorId: string;
  unitId: string | null;
  workspaceId: string | null;
  purpose: string;
  taskObjective: string;
  status: "ACTIVE" | "COMPLETED" | "QUARANTINED";
  runState: AgentRunState;
  fence: number;
  checkpointDigest: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface AgentLease {
  sessionId: string;
  organizationId: string;
  ownerId: string;
  fence: number;
  acquiredAt: string;
  expiresAt: string;
}

export interface AgentCheckpointRecord {
  checkpointId: string;
  sessionId: string;
  sequence: number;
  schemaVersion: number;
  digest: string;
  payload: Record<string, unknown>;
  fence: number;
  createdAt: string;
}

export interface AgentTurnLedgerEntry {
  turnId: string;
  sessionId: string;
  sequence: number;
  status: "COMPLETED" | "FAILED" | "WAITING_APPROVAL" | "DENIED" | "CANCELLED" | "UNKNOWN";
  inputDigest: string;
  contextDigest: string | null;
  modelRequestDigest: string | null;
  modelResponseDigest: string | null;
  toolRequestIds: readonly string[];
  usageRecordId: string | null;
  provenance: Record<string, string | number | boolean | null>;
  startedAt: string;
  completedAt: string | null;
  fence: number;
}

export class AgentSessionError extends Error {
  constructor(readonly code: "DENIED_STALE_FENCE" | "LEASE_HELD" | "SESSION_NOT_FOUND" | "CHECKPOINT_TAMPERED" | "SESSION_INVALID", message: string) {
    super(message);
    this.name = "AgentSessionError";
  }
}

export interface CreateAgentSessionInput {
  sessionId: string;
  organizationId: string;
  actorId: string;
  unitId: string | null;
  workspaceId: string | null;
  purpose: string;
  taskObjective: string;
  ttlMs: number;
}

export interface AcquireLeaseInput {
  sessionId: string;
  organizationId: string;
  ownerId: string;
  ttlMs: number;
}

export interface ReleaseLeaseInput {
  sessionId: string;
  organizationId: string;
  ownerId: string;
  fence: number;
}

export interface AppendTurnInput extends AgentTurnLedgerEntry {
  organizationId: string;
}

export interface AgentSessionStore {
  create(input: CreateAgentSessionInput): Promise<AgentSessionRecord>;
  load(sessionId: string, scope: AgentSessionScope): Promise<AgentSessionRecord | null>;
  checkpoint(input: { sessionId: string; organizationId: string; fence: number; payload: Record<string, unknown>; schemaVersion?: number }): Promise<AgentCheckpointRecord>;
  latestCheckpoint(sessionId: string, scope: AgentSessionScope): Promise<AgentCheckpointRecord | null>;
  acquireLease(input: AcquireLeaseInput): Promise<AgentLease | null>;
  renewLease(input: AcquireLeaseInput & { fence: number }): Promise<AgentLease | null>;
  releaseLease(input: ReleaseLeaseInput): Promise<void>;
  appendTurn(input: AppendTurnInput): Promise<AgentTurnLedgerEntry>;
  listTurns(sessionId: string, scope: AgentSessionScope): Promise<AgentTurnLedgerEntry[]>;
  complete(input: { sessionId: string; organizationId: string; fence: number; runState: AgentRunState }): Promise<AgentSessionRecord>;
}

export function checkpointDigest(payload: Record<string, unknown>, schemaVersion = AGENT_SESSION_SCHEMA_VERSION): string {
  return createHash("sha256").update(`${schemaVersion}:${JSON.stringify(sortValue(payload))}`).digest("hex");
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([key, item]) => [key, sortValue(item)]));
}

/** Development/test store.  Never a production authority. */
export class MemoryAgentSessionStore implements AgentSessionStore {
  private readonly sessions = new Map<string, AgentSessionRecord>();
  private readonly leases = new Map<string, AgentLease>();
  private readonly checkpoints = new Map<string, AgentCheckpointRecord[]>();
  private readonly turns = new Map<string, AgentTurnLedgerEntry[]>();

  constructor(private readonly clock: { now(): number } = { now: () => Date.now() }) {}

  async create(input: CreateAgentSessionInput): Promise<AgentSessionRecord> {
    const record: AgentSessionRecord = {
      sessionId: input.sessionId,
      organizationId: input.organizationId,
      actorId: input.actorId,
      unitId: input.unitId,
      workspaceId: input.workspaceId,
      purpose: input.purpose,
      taskObjective: input.taskObjective,
      status: "ACTIVE",
      runState: "CREATED",
      fence: 0,
      checkpointDigest: null,
      createdAt: this.iso(),
      updatedAt: this.iso(),
      expiresAt: new Date(this.clock.now() + input.ttlMs).toISOString()
    };
    this.sessions.set(input.sessionId, record);
    return { ...record };
  }

  async load(sessionId: string, scope: AgentSessionScope): Promise<AgentSessionRecord | null> {
    const record = this.sessions.get(sessionId);
    if (!record || record.organizationId !== scope.organizationId || record.actorId !== scope.actorId) return null;
    return { ...record };
  }

  async checkpoint(input: { sessionId: string; organizationId: string; fence: number; payload: Record<string, unknown>; schemaVersion?: number }): Promise<AgentCheckpointRecord> {
    const session = this.requireFence(input.sessionId, input.organizationId, input.fence);
    const schemaVersion = input.schemaVersion ?? AGENT_SESSION_SCHEMA_VERSION;
    const list = this.checkpoints.get(input.sessionId) ?? [];
    const record: AgentCheckpointRecord = {
      checkpointId: `${input.sessionId}:${list.length + 1}`,
      sessionId: input.sessionId,
      sequence: list.length + 1,
      schemaVersion,
      digest: checkpointDigest(input.payload, schemaVersion),
      payload: input.payload,
      fence: session.fence,
      createdAt: this.iso()
    };
    list.push(record);
    this.checkpoints.set(input.sessionId, list);
    this.sessions.set(input.sessionId, { ...session, checkpointDigest: record.digest, updatedAt: this.iso() });
    return { ...record };
  }

  async latestCheckpoint(sessionId: string, scope: AgentSessionScope): Promise<AgentCheckpointRecord | null> {
    const session = await this.load(sessionId, scope);
    if (!session) return null;
    const list = this.checkpoints.get(sessionId) ?? [];
    const latest = list.at(-1);
    if (!latest) return null;
    if (checkpointDigest(latest.payload, latest.schemaVersion) !== latest.digest) throw new AgentSessionError("CHECKPOINT_TAMPERED", "checkpoint digest does not match its payload");
    return { ...latest };
  }

  async acquireLease(input: AcquireLeaseInput): Promise<AgentLease | null> {
    const session = this.sessions.get(input.sessionId);
    if (!session || session.organizationId !== input.organizationId) throw new AgentSessionError("SESSION_NOT_FOUND", "agent session not found");
    const current = this.leases.get(input.sessionId);
    const expired = current !== undefined && Date.parse(current.expiresAt) <= this.clock.now();
    if (current && !expired && current.ownerId !== input.ownerId) return null;
    const fence = (current?.fence ?? session.fence) + 1;
    const lease: AgentLease = { sessionId: input.sessionId, organizationId: input.organizationId, ownerId: input.ownerId, fence, acquiredAt: this.iso(), expiresAt: new Date(this.clock.now() + input.ttlMs).toISOString() };
    this.leases.set(input.sessionId, lease);
    this.sessions.set(input.sessionId, { ...session, fence, updatedAt: this.iso() });
    return { ...lease };
  }

  async renewLease(input: AcquireLeaseInput & { fence: number }): Promise<AgentLease | null> {
    const current = this.leases.get(input.sessionId);
    if (!current || current.ownerId !== input.ownerId || current.fence !== input.fence) return null;
    if (Date.parse(current.expiresAt) <= this.clock.now()) return null;
    const lease: AgentLease = { ...current, expiresAt: new Date(this.clock.now() + input.ttlMs).toISOString() };
    this.leases.set(input.sessionId, lease);
    return { ...lease };
  }

  async releaseLease(input: ReleaseLeaseInput): Promise<void> {
    const current = this.leases.get(input.sessionId);
    if (current && current.ownerId === input.ownerId && current.fence === input.fence) this.leases.delete(input.sessionId);
  }

  async appendTurn(input: AppendTurnInput): Promise<AgentTurnLedgerEntry> {
    const session = this.requireFence(input.sessionId, input.organizationId, input.fence);
    const list = this.turns.get(input.sessionId) ?? [];
    if (list.some((entry) => entry.turnId === input.turnId)) throw new AgentSessionError("SESSION_INVALID", "turn ledger is append-only; turnId already exists");
    const entry: AgentTurnLedgerEntry = {
      turnId: input.turnId,
      sessionId: input.sessionId,
      sequence: list.length + 1,
      status: input.status,
      inputDigest: input.inputDigest,
      contextDigest: input.contextDigest,
      modelRequestDigest: input.modelRequestDigest,
      modelResponseDigest: input.modelResponseDigest,
      toolRequestIds: [...input.toolRequestIds],
      usageRecordId: input.usageRecordId,
      provenance: { ...input.provenance },
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      fence: session.fence
    };
    list.push(entry);
    this.turns.set(input.sessionId, list);
    return { ...entry };
  }

  async listTurns(sessionId: string, scope: AgentSessionScope): Promise<AgentTurnLedgerEntry[]> {
    const session = await this.load(sessionId, scope);
    if (!session) return [];
    return [...(this.turns.get(sessionId) ?? [])];
  }

  async complete(input: { sessionId: string; organizationId: string; fence: number; runState: AgentRunState }): Promise<AgentSessionRecord> {
    const session = this.requireFence(input.sessionId, input.organizationId, input.fence);
    const updated: AgentSessionRecord = { ...session, runState: input.runState, status: input.runState === "QUARANTINED" || input.runState === "QUARANTINED_RESTORE" ? "QUARANTINED" : "COMPLETED", updatedAt: this.iso() };
    this.sessions.set(input.sessionId, updated);
    return { ...updated };
  }

  private requireFence(sessionId: string, organizationId: string, fence: number): AgentSessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session || session.organizationId !== organizationId) throw new AgentSessionError("SESSION_NOT_FOUND", "agent session not found");
    if (session.fence !== fence) throw new AgentSessionError("DENIED_STALE_FENCE", `fence ${fence} is stale; authoritative fence is ${session.fence}`);
    return session;
  }

  private iso(): string {
    return new Date(this.clock.now()).toISOString();
  }
}

export interface SqlQueryResult {
  rows: Record<string, unknown>[];
}

/**
 * Minimal executor seam so the store can use the existing CVG pool without
 * owning it.  Every agent statement runs inside a transaction that first sets
 * the tenant GUC, because the tables use FORCE ROW LEVEL SECURITY.
 */
export interface SqlExecutor {
  query(text: string, params: readonly unknown[]): Promise<SqlQueryResult>;
}

export interface ScopedSqlClient extends SqlExecutor {
  release(): void | Promise<void>;
}

export interface ScopedSqlPool {
  connect(): Promise<ScopedSqlClient>;
}

export interface ScopedSqlExecutor {
  withScopedTransaction<T>(organizationId: string, run: (query: SqlExecutor["query"]) => Promise<T>): Promise<T>;
}

/** Builds the tenant-scoped executor over a pg-like pool. */
export function createScopedSqlExecutor(pool: ScopedSqlPool): ScopedSqlExecutor {
  return {
    async withScopedTransaction<T>(organizationId: string, run: (query: SqlExecutor["query"]) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("begin", []);
        await client.query("select set_config('cvg.organization_id', $1, true)", [organizationId]);
        const result = await run((text, params) => client.query(text, params));
        await client.query("commit", []);
        return result;
      } catch (error) {
        try {
          await client.query("rollback", []);
        } catch {
          // A failed rollback keeps the original error; the transaction is discarded with the client.
        }
        throw error;
      } finally {
        await client.release();
      }
    }
  };
}

/**
 * Production session store.  Every statement is scoped by organization and
 * relies on the PostgreSQL RLS policies from migration 038 as defense in depth.
 */
export class PostgresAgentSessionStore implements AgentSessionStore {
  constructor(private readonly executor: ScopedSqlExecutor, private readonly clock: { now(): number } = { now: () => Date.now() }) {}

  async create(input: CreateAgentSessionInput): Promise<AgentSessionRecord> {
    return this.executor.withScopedTransaction(input.organizationId, async (query) => {
      const result = await query(
        `INSERT INTO agent_sessions (session_id, organization_id, actor_id, unit_id, workspace_id, purpose, task_objective, status, run_state, fence, checkpoint_digest, created_at, updated_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE','CREATED',0,NULL,now(),now(),now() + ($8 || ' milliseconds')::interval)
         RETURNING *`,
        [input.sessionId, input.organizationId, input.actorId, input.unitId, input.workspaceId, input.purpose, input.taskObjective, String(input.ttlMs)]
      );
      return mapSession(requireRow(result, "agent session insert returned no row"));
    });
  }

  async load(sessionId: string, scope: AgentSessionScope): Promise<AgentSessionRecord | null> {
    return this.executor.withScopedTransaction(scope.organizationId, async (query) => {
      const result = await query(
        `SELECT * FROM agent_sessions WHERE session_id = $1 AND organization_id = $2 AND actor_id = $3`,
        [sessionId, scope.organizationId, scope.actorId]
      );
      const row = result.rows[0];
      return row ? mapSession(row) : null;
    });
  }

  async checkpoint(input: { sessionId: string; organizationId: string; fence: number; payload: Record<string, unknown>; schemaVersion?: number }): Promise<AgentCheckpointRecord> {
    const schemaVersion = input.schemaVersion ?? AGENT_SESSION_SCHEMA_VERSION;
    const digest = checkpointDigest(input.payload, schemaVersion);
    return this.executor.withScopedTransaction(input.organizationId, async (query) => {
      // Fence and sequence are resolved by the database: the insert only lands
      // when the caller still holds the authoritative fence, and the sequence is
      // global per session (never per fence), so a takeover cannot reuse numbers.
      const result = await query(
        `INSERT INTO agent_checkpoints (session_id, organization_id, sequence, schema_version, digest, payload, fence, created_at)
         SELECT $1,$2,
                (SELECT COALESCE(MAX(sequence), 0) + 1 FROM agent_checkpoints WHERE session_id = $1),
                $3,$4,$5::jsonb,$6,now()
          WHERE EXISTS (SELECT 1 FROM agent_sessions WHERE session_id = $1 AND organization_id = $2 AND fence = $6)
         RETURNING *`,
        [input.sessionId, input.organizationId, schemaVersion, digest, JSON.stringify(input.payload), input.fence]
      );
      const inserted = requireRow(result, "checkpoint rejected: stale fence or unknown session");
      await query(`UPDATE agent_sessions SET checkpoint_digest = $3, updated_at = now() WHERE session_id = $1 AND organization_id = $2 AND fence = $4`, [input.sessionId, input.organizationId, digest, input.fence]);
      return mapCheckpoint(inserted);
    });
  }

  async latestCheckpoint(sessionId: string, scope: AgentSessionScope): Promise<AgentCheckpointRecord | null> {
    return this.executor.withScopedTransaction(scope.organizationId, async (query) => {
      // A checkpoint written by a future (unknown) fence is never resumable.
      const result = await query(
        `SELECT checkpoint.* FROM agent_checkpoints AS checkpoint
           JOIN agent_sessions AS session ON session.session_id = checkpoint.session_id
          WHERE checkpoint.session_id = $1 AND checkpoint.organization_id = $2 AND checkpoint.fence <= session.fence
          ORDER BY checkpoint.sequence DESC LIMIT 1`,
        [sessionId, scope.organizationId]
      );
      const row = result.rows[0];
      if (!row) return null;
      const record = mapCheckpoint(row);
      if (checkpointDigest(record.payload, record.schemaVersion) !== record.digest) throw new AgentSessionError("CHECKPOINT_TAMPERED", "checkpoint digest does not match its payload");
      return record;
    });
  }

  async acquireLease(input: AcquireLeaseInput): Promise<AgentLease | null> {
    return this.executor.withScopedTransaction(input.organizationId, async (query) => {
      const result = await query(
        `INSERT INTO agent_leases (session_id, organization_id, owner_id, fence, acquired_at, expires_at)
         VALUES ($1,$2,$3,1,now(),now() + ($4 || ' milliseconds')::interval)
         ON CONFLICT (session_id) DO UPDATE
           SET owner_id = EXCLUDED.owner_id,
               fence = agent_leases.fence + 1,
               acquired_at = now(),
               expires_at = now() + ($4 || ' milliseconds')::interval
           WHERE agent_leases.organization_id = EXCLUDED.organization_id
             AND (agent_leases.expires_at <= now() OR agent_leases.owner_id = EXCLUDED.owner_id)
         RETURNING *`,
        [input.sessionId, input.organizationId, input.ownerId, String(input.ttlMs)]
      );
      const row = result.rows[0];
      if (!row) return null;
      const lease = mapLease(row);
      await query(`UPDATE agent_sessions SET fence = $3, updated_at = now() WHERE session_id = $1 AND organization_id = $2 AND fence < $3`, [input.sessionId, input.organizationId, lease.fence]);
      return lease;
    });
  }

  async renewLease(input: AcquireLeaseInput & { fence: number }): Promise<AgentLease | null> {
    return this.executor.withScopedTransaction(input.organizationId, async (query) => {
      const result = await query(
        `UPDATE agent_leases SET expires_at = now() + ($4 || ' milliseconds')::interval
          WHERE session_id = $1 AND organization_id = $2 AND owner_id = $3 AND fence = $5 AND expires_at > now()
          RETURNING *`,
        [input.sessionId, input.organizationId, input.ownerId, String(input.ttlMs), input.fence]
      );
      const row = result.rows[0];
      return row ? mapLease(row) : null;
    });
  }

  async releaseLease(input: ReleaseLeaseInput): Promise<void> {
    await this.executor.withScopedTransaction(input.organizationId, async (query) => {
      await query(`DELETE FROM agent_leases WHERE session_id = $1 AND owner_id = $2 AND fence = $3`, [input.sessionId, input.ownerId, input.fence]);
    });
  }

  async appendTurn(input: AppendTurnInput): Promise<AgentTurnLedgerEntry> {
    return this.executor.withScopedTransaction(input.organizationId, async (query) => {
      const result = await query(
        `INSERT INTO agent_turns (turn_id, session_id, organization_id, sequence, status, input_digest, context_digest, model_request_digest, model_response_digest, tool_request_ids, usage_record_id, provenance, started_at, completed_at, fence)
         SELECT $1,$2,$3,
                (SELECT COALESCE(MAX(sequence), 0) + 1 FROM agent_turns WHERE session_id = $2),
                $4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13,$14
          WHERE EXISTS (SELECT 1 FROM agent_sessions WHERE session_id = $2 AND organization_id = $3 AND fence = $14)
         RETURNING *`,
        [input.turnId, input.sessionId, input.organizationId, input.status, input.inputDigest, input.contextDigest, input.modelRequestDigest, input.modelResponseDigest, JSON.stringify(input.toolRequestIds), input.usageRecordId, JSON.stringify(input.provenance), input.startedAt, input.completedAt, input.fence]
      );
      return mapTurn(requireRow(result, "turn append rejected: stale fence or unknown session"));
    });
  }

  async listTurns(sessionId: string, scope: AgentSessionScope): Promise<AgentTurnLedgerEntry[]> {
    return this.executor.withScopedTransaction(scope.organizationId, async (query) => {
      const result = await query(`SELECT * FROM agent_turns WHERE session_id = $1 AND organization_id = $2 ORDER BY sequence ASC`, [sessionId, scope.organizationId]);
      return result.rows.map(mapTurn);
    });
  }

  async complete(input: { sessionId: string; organizationId: string; fence: number; runState: AgentRunState }): Promise<AgentSessionRecord> {
    return this.executor.withScopedTransaction(input.organizationId, async (query) => {
      const result = await query(
        `UPDATE agent_sessions
            SET run_state = $3, status = CASE WHEN $3 IN ('QUARANTINED','QUARANTINED_RESTORE') THEN 'QUARANTINED' ELSE 'COMPLETED' END, updated_at = now()
          WHERE session_id = $1 AND organization_id = $2 AND fence = $4
          RETURNING *`,
        [input.sessionId, input.organizationId, input.runState, input.fence]
      );
      return mapSession(requireRow(result, "session completion rejected: stale fence"));
    });
  }
}

function requireRow(result: SqlQueryResult, message: string): Record<string, unknown> {
  const row = result.rows[0];
  if (!row) throw new AgentSessionError("DENIED_STALE_FENCE", message);
  return row;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

function nullableStr(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function mapSession(row: Record<string, unknown>): AgentSessionRecord {
  return {
    sessionId: str(row.session_id),
    organizationId: str(row.organization_id),
    actorId: str(row.actor_id),
    unitId: nullableStr(row.unit_id),
    workspaceId: nullableStr(row.workspace_id),
    purpose: str(row.purpose),
    taskObjective: str(row.task_objective),
    status: str(row.status) as AgentSessionRecord["status"],
    runState: str(row.run_state) as AgentRunState,
    fence: num(row.fence),
    checkpointDigest: nullableStr(row.checkpoint_digest),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    expiresAt: toIso(row.expires_at)
  };
}

function mapLease(row: Record<string, unknown>): AgentLease {
  return { sessionId: str(row.session_id), organizationId: str(row.organization_id), ownerId: str(row.owner_id), fence: num(row.fence), acquiredAt: toIso(row.acquired_at), expiresAt: toIso(row.expires_at) };
}

function mapCheckpoint(row: Record<string, unknown>): AgentCheckpointRecord {
  const payload = row.payload;
  if (typeof payload !== "object" || payload === null) throw new AgentSessionError("CHECKPOINT_TAMPERED", "checkpoint payload is not a JSON object");
  return {
    checkpointId: str(row.checkpoint_id),
    sessionId: str(row.session_id),
    sequence: num(row.sequence),
    schemaVersion: num(row.schema_version),
    digest: str(row.digest),
    payload: payload as Record<string, unknown>,
    fence: num(row.fence),
    createdAt: toIso(row.created_at)
  };
}

function mapTurn(row: Record<string, unknown>): AgentTurnLedgerEntry {
  const provenance = row.provenance;
  const toolRequestIds = row.tool_request_ids;
  return {
    turnId: str(row.turn_id),
    sessionId: str(row.session_id),
    sequence: num(row.sequence),
    status: str(row.status) as AgentTurnLedgerEntry["status"],
    inputDigest: str(row.input_digest),
    contextDigest: nullableStr(row.context_digest),
    modelRequestDigest: nullableStr(row.model_request_digest),
    modelResponseDigest: nullableStr(row.model_response_digest),
    toolRequestIds: Array.isArray(toolRequestIds) ? toolRequestIds.map(String) : [],
    usageRecordId: nullableStr(row.usage_record_id),
    provenance: (typeof provenance === "object" && provenance !== null ? provenance : {}) as AgentTurnLedgerEntry["provenance"],
    startedAt: toIso(row.started_at),
    completedAt: row.completed_at === null || row.completed_at === undefined ? null : toIso(row.completed_at),
    fence: num(row.fence)
  };
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
