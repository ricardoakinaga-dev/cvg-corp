import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient } from "pg";
import { digest } from "@cvg/domain";
import { Aud27MigrationError } from "./migration-harness.js";
import type {
  Aud27MigrationAdapter,
  Aud27MigrationBatchContext,
  Aud27MigrationBatchEffect,
  Aud27MigrationCheckpoint,
  Aud27MigrationCheckpointStore,
  Aud27MigrationRecord,
  Aud27MigrationRunKey
} from "./migration-harness.js";

type CheckpointStatus = Aud27MigrationCheckpoint["status"];

const checkpointStatuses = new Set<CheckpointStatus>(["RUNNING", "CHECKPOINTED", "DRY_RUN", "RECONCILED", "ROLLED_BACK", "QUARANTINED"]);

export type Aud27MigrationAuthorizer = (context: Aud27MigrationBatchContext) => void | Promise<void>;

export type Aud27PostgresMigrationOptions = {
  connectionString?: string;
  pool?: Pool;
  runScope?: PostgresAud27MigrationRunScope;
  authorize: Aud27MigrationAuthorizer;
};

/**
 * Holds one PostgreSQL session advisory lock for a complete migration run.
 * Every store and adapter using this scope routes its run-time SQL through the
 * locked session, including short per-batch transactions and rollback hooks.
 */
export class PostgresAud27MigrationRunScope {
  private readonly activeRuns = new Set<string>();
  private readonly sessions = new AsyncLocalStorage<PoolClient>();

  constructor(private readonly pool: Pool) {}

  async withClient<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const active = this.sessions.getStore();
    if (active) return operation(active);
    const client = await pool.connect();
    try {
      return await operation(client);
    } finally {
      client.release();
    }
  }

  async runExclusive<T>(key: Aud27MigrationRunKey, operation: () => Promise<T>): Promise<T> {
    const serializedKey = JSON.stringify([key.tenantId, key.slice, key.runId]);
    if (this.activeRuns.has(serializedKey)) {
      throw new Aud27MigrationError("RUN_IN_PROGRESS", `migration run is already active: ${key.runId}:${key.slice}:${key.tenantId}`);
    }
    this.activeRuns.add(serializedKey);

    let client: PoolClient | undefined;
    let lockAcquired = false;
    let operationError: unknown;
    let operationFailed = false;
    let releaseError: Error | undefined;
    let result: T | undefined;
    try {
      client = await this.pool.connect();
      const acquisition = await client.query<{ acquired: boolean }>(
        "select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired",
        [serializedKey]
      );
      const acquired = acquisition.rows[0]?.acquired === true;
      if (!acquired) throw new Aud27MigrationError("RUN_IN_PROGRESS", `migration run is already active: ${key.runId}:${key.slice}:${key.tenantId}`);
      lockAcquired = true;
      result = await this.sessions.run(client, operation);
    } catch (error) {
      operationFailed = true;
      operationError = error;
    } finally {
      try {
        if (client && lockAcquired) {
          const result = await client.query<{ unlocked: boolean }>(
            "select pg_advisory_unlock(hashtextextended($1, 0)) as unlocked",
            [serializedKey]
          );
          if (result.rows[0]?.unlocked !== true) releaseError = new Error("AUD27 migration advisory lock ownership was lost before run completion");
        }
      } catch (error) {
        releaseError = error instanceof Error ? error : new Error(String(error));
      }
      client?.release(releaseError);
      this.activeRuns.delete(serializedKey);
    }

    if (releaseError) {
      if (operationFailed) throw new AggregateError([operationError, releaseError], "AUD27 migration operation failed and its locked PostgreSQL session could not be released cleanly");
      throw releaseError;
    }
    if (operationFailed) throw operationError;
    return result as T;
  }
}

const defaultRunScopes = new WeakMap<Pool, PostgresAud27MigrationRunScope>();

function runScopeFor(pool: Pool, configured?: PostgresAud27MigrationRunScope): PostgresAud27MigrationRunScope {
  if (configured) return configured;
  let scope = defaultRunScopes.get(pool);
  if (!scope) {
    scope = new PostgresAud27MigrationRunScope(pool);
    defaultRunScopes.set(pool, scope);
  }
  return scope;
}

function requirePool(options: Aud27PostgresMigrationOptions): { pool: Pool; ownsPool: boolean } {
  if (options.pool && options.connectionString) throw new Error("provide either an existing PostgreSQL pool or a connectionString, not both");
  if (!options.pool && !options.connectionString) throw new Error("an explicit PostgreSQL pool or connectionString is required");
  return options.pool ? { pool: options.pool, ownsPool: false } : { pool: new Pool({ connectionString: options.connectionString, max: 2, connectionTimeoutMillis: 2_500, application_name: "cvg-aud27-migration" }), ownsPool: true };
}

function parseProcessedKeys(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error("AUD27 migration checkpoint processed_keys is invalid");
  return [...value].sort();
}

function parseStatus(value: unknown): CheckpointStatus {
  if (typeof value !== "string" || !checkpointStatuses.has(value as CheckpointStatus)) throw new Error(`AUD27 migration checkpoint status is invalid: ${String(value)}`);
  return value as CheckpointStatus;
}

function migrationCommandId(context: Aud27MigrationBatchContext, key: string): string {
  return `aud27:${context.slice}:${context.tenantId}:${key}`;
}

function recordDigest<T>(record: Aud27MigrationRecord<T>): string {
  return digest({ key: record.key, tenantId: record.tenantId, version: record.version, value: record.value });
}

function parseRecord<T>(row: { tenant_id: string; record_key: string; version: string | number; value: unknown }): Aud27MigrationRecord<T> {
  const version = Number(row.version);
  if (!Number.isSafeInteger(version) || version < 1) throw new Error(`AUD27 migration target version is invalid for ${row.record_key}`);
  return { tenantId: row.tenant_id, key: row.record_key, version, value: row.value as T };
}

const tenantSettingSql = "select set_config('cvg.aud27.tenant_id', $1, true)";

async function withTenantTransaction<T>(scope: PostgresAud27MigrationRunScope, pool: Pool, tenantId: string, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  return scope.withClient(pool, async (client) => {
    try {
      await client.query("begin");
      await client.query(tenantSettingSql, [tenantId]);
      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  });
}

export class PostgresAud27MigrationCheckpointStore implements Aud27MigrationCheckpointStore {
  private readonly pool: Pool;
  private readonly ownsPool: boolean;
  readonly runScope: PostgresAud27MigrationRunScope;

  constructor(options: Aud27PostgresMigrationOptions) {
    const configured = requirePool(options);
    this.pool = configured.pool;
    this.ownsPool = configured.ownsPool;
    this.runScope = runScopeFor(this.pool, options.runScope);
  }

  async runExclusive<T>(key: Aud27MigrationRunKey, operation: () => Promise<T>): Promise<T> {
    return this.runScope.runExclusive(key, operation);
  }

  async load(runId: string, slice: string, tenantId: string): Promise<Aud27MigrationCheckpoint | null> {
    return withTenantTransaction(this.runScope, this.pool, tenantId, async (client) => {
      const result = await client.query<{ run_id: string; slice: string; tenant_id: string; source_digest: string; processed_keys: unknown; cursor: string | null; status: string; updated_at: Date | string }>(
        "select run_id, slice, tenant_id, source_digest, processed_keys, cursor, status, updated_at from cvg_aud27_migration_checkpoints where run_id = $1 and slice = $2 and tenant_id = $3",
        [runId, slice, tenantId]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        runId: row.run_id,
        slice: row.slice,
        tenantId: row.tenant_id,
        sourceDigest: row.source_digest,
        processedKeys: parseProcessedKeys(row.processed_keys),
        cursor: row.cursor,
        status: parseStatus(row.status),
        updatedAt: new Date(row.updated_at).toISOString()
      };
    });
  }

  async save(checkpoint: Aud27MigrationCheckpoint): Promise<void> {
    await withTenantTransaction(this.runScope, this.pool, checkpoint.tenantId, async (client) => {
      const result = await client.query(
        `insert into cvg_aud27_migration_checkpoints(run_id, slice, tenant_id, source_digest, processed_keys, cursor, status, updated_at)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::timestamptz)
         on conflict (run_id, slice, tenant_id) do update set
           processed_keys = excluded.processed_keys,
           cursor = excluded.cursor,
           status = excluded.status,
           updated_at = excluded.updated_at
         where cvg_aud27_migration_checkpoints.source_digest = excluded.source_digest
         returning run_id`,
        [checkpoint.runId, checkpoint.slice, checkpoint.tenantId, checkpoint.sourceDigest, JSON.stringify([...checkpoint.processedKeys].sort()), checkpoint.cursor, checkpoint.status, checkpoint.updatedAt]
      );
      if (result.rowCount === 1) return;
      throw new Error(`AUD27 migration checkpoint source digest conflict for ${checkpoint.runId}:${checkpoint.slice}:${checkpoint.tenantId}`);
    });
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }
}

export class PostgresAud27MigrationAdapter<T> implements Aud27MigrationAdapter<T> {
  private readonly pool: Pool;
  private readonly ownsPool: boolean;
  private readonly authorizeTenant: Aud27MigrationAuthorizer;
  readonly runScope: PostgresAud27MigrationRunScope;

  constructor(options: Aud27PostgresMigrationOptions) {
    const configured = requirePool(options);
    this.pool = configured.pool;
    this.ownsPool = configured.ownsPool;
    this.authorizeTenant = options.authorize;
    this.runScope = runScopeFor(this.pool, options.runScope);
  }

  async authorize(context: Aud27MigrationBatchContext): Promise<void> {
    await this.authorizeTenant(context);
    if (!context.commandIds.length) throw new Error("AUD27 migration authorization requires a non-empty command batch");
  }

  async applyBatch(context: Aud27MigrationBatchContext, records: readonly Aud27MigrationRecord<T>[]): Promise<Aud27MigrationBatchEffect> {
    const keys = records.map((record) => record.key);
    const commandIds = records.map((record) => migrationCommandId(context, record.key));
    return this.runScope.withClient(this.pool, async (client) => {
      try {
        await client.query("begin");
        await client.query(tenantSettingSql, [context.tenantId]);
        const writtenKeys: string[] = [];
        for (const record of records) {
          const valueDigest = recordDigest(record);
          const commandId = migrationCommandId(context, record.key);
          const value = JSON.stringify(record.value);
          const written = await client.query<{ record_key: string }>(
            `insert into cvg_aud27_migration_records(run_id, slice, tenant_id, record_key, version, value, value_digest, command_id)
             values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
             on conflict (run_id, slice, tenant_id, record_key) do update set
               version = excluded.version,
               value = excluded.value,
               value_digest = excluded.value_digest,
               command_id = excluded.command_id,
               updated_at = now()
             where cvg_aud27_migration_records.value_digest = excluded.value_digest
               and cvg_aud27_migration_records.version = excluded.version
             returning record_key`,
            [context.runId, context.slice, context.tenantId, record.key, record.version, value, valueDigest, commandId]
          );
          if (written.rowCount !== 1) throw new Error(`AUD27 migration target conflict for ${record.key}`);
          writtenKeys.push(record.key);
        }
        await client.query("commit");
        const rollback = async (): Promise<void> => {
          await this.rollbackBatch(context, keys, commandIds);
        };
        return { writtenKeys, rollback };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
    });
  }

  async readTarget(context: Omit<Aud27MigrationBatchContext, "commandIds">): Promise<readonly Aud27MigrationRecord<T>[]> {
    return withTenantTransaction(this.runScope, this.pool, context.tenantId, async (client) => {
      const result = await client.query<{ tenant_id: string; record_key: string; version: string | number; value: unknown }>(
        "select tenant_id, record_key, version, value from cvg_aud27_migration_records where run_id = $1 and slice = $2 and tenant_id = $3 order by record_key",
        [context.runId, context.slice, context.tenantId]
      );
      return result.rows.map((row) => parseRecord<T>(row));
    });
  }

  private async rollbackBatch(context: Aud27MigrationBatchContext, keys: readonly string[], commandIds: readonly string[]): Promise<void> {
    await this.runScope.withClient(this.pool, async (client) => {
      try {
        await client.query("begin");
        await client.query(tenantSettingSql, [context.tenantId]);
        await client.query(
          `delete from cvg_aud27_migration_records
           where run_id = $1 and slice = $2 and tenant_id = $3
             and record_key = any($4::text[])
             and command_id = any($5::text[])`,
          [context.runId, context.slice, context.tenantId, keys, commandIds]
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
    });
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }
}
