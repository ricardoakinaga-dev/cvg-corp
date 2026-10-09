import test from "node:test";
import assert from "node:assert/strict";
import type { Pool, PoolClient } from "pg";
import { Aud27MigrationError, Aud27MigrationExecutor, PostgresAud27MigrationAdapter, PostgresAud27MigrationCheckpointStore, type Aud27PostgresMigrationOptions } from "@cvg/persistence";
import type { Aud27MigrationBatchContext, Aud27MigrationCheckpoint, Aud27MigrationRecord } from "@cvg/persistence";

type QueryResult = { rows: Array<Record<string, unknown>>; rowCount: number };

class FakeMigrationDatabase {
  checkpoint: Record<string, unknown> | null = null;
  readonly records = new Map<string, Record<string, unknown>>();
  readonly statements: string[] = [];
  readonly directStatements: string[] = [];
  connectCalls = 0;
  failCheckpoint = false;
  failTarget = false;
  failCommit = false;
  failDelete = false;

  readonly pool: Pool;

  constructor() {
    const client = {
      query: async (sql: string, params: readonly unknown[] = []): Promise<QueryResult> => this.clientQuery(sql, params),
      release: () => undefined
    } as unknown as PoolClient;
    this.pool = {
      query: async (sql: string, params: readonly unknown[] = []): Promise<QueryResult> => this.query(sql, params),
      connect: async (): Promise<PoolClient> => { this.connectCalls += 1; return client; },
      end: async () => undefined
    } as unknown as Pool;
  }

  private async query(sql: string, params: readonly unknown[]): Promise<QueryResult> {
    this.statements.push(sql);
    this.directStatements.push(sql);
    if (sql.startsWith("select run_id")) return { rows: this.checkpoint ? [this.checkpoint] : [], rowCount: this.checkpoint ? 1 : 0 };
    if (sql.startsWith("insert into cvg_aud27_migration_checkpoints")) {
      if (this.failCheckpoint) return { rows: [], rowCount: 0 };
      this.checkpoint = {
        run_id: params[0], slice: params[1], tenant_id: params[2], source_digest: params[3],
        processed_keys: JSON.parse(String(params[4])), cursor: params[5], status: params[6], updated_at: params[7]
      };
      return { rows: [{ run_id: params[0] }], rowCount: 1 };
    }
    if (sql.startsWith("select tenant_id")) return { rows: [...this.records.values()].sort((left, right) => String(left.record_key).localeCompare(String(right.record_key))), rowCount: this.records.size };
    throw new Error(`unexpected pool statement: ${sql}`);
  }

  private async clientQuery(sql: string, params: readonly unknown[]): Promise<QueryResult> {
    this.statements.push(sql);
    if (sql.startsWith("select pg_try_advisory_lock")) return { rows: [{ acquired: true }], rowCount: 1 };
    if (sql.startsWith("select pg_advisory_unlock")) return { rows: [{ unlocked: true }], rowCount: 1 };
    if (sql === "begin" || sql === "rollback") return { rows: [], rowCount: 0 };
    if (sql === "commit") {
      if (this.failCommit) throw new Error("synthetic commit failure");
      return { rows: [], rowCount: 0 };
    }
    if (sql === "select set_config('cvg.aud27.tenant_id', $1, true)") return { rows: [], rowCount: 1 };
    if (sql.startsWith("select run_id")) return { rows: this.checkpoint ? [this.checkpoint] : [], rowCount: this.checkpoint ? 1 : 0 };
    if (sql.startsWith("insert into cvg_aud27_migration_checkpoints")) {
      if (this.failCheckpoint) return { rows: [], rowCount: 0 };
      this.checkpoint = {
        run_id: params[0], slice: params[1], tenant_id: params[2], source_digest: params[3],
        processed_keys: JSON.parse(String(params[4])), cursor: params[5], status: params[6], updated_at: params[7]
      };
      return { rows: [{ run_id: params[0] }], rowCount: 1 };
    }
    if (sql.startsWith("select tenant_id")) return { rows: [...this.records.values()].sort((left, right) => String(left.record_key).localeCompare(String(right.record_key))), rowCount: this.records.size };
    if (sql.startsWith("insert into cvg_aud27_migration_records")) {
      if (this.failTarget) return { rows: [], rowCount: 0 };
      const key = `${params[0]}:${params[1]}:${params[2]}:${params[3]}`;
      this.records.set(key, { tenant_id: params[2], record_key: params[3], version: params[4], value: JSON.parse(String(params[5])) });
      return { rows: [{ record_key: params[3] }], rowCount: 1 };
    }
    if (sql.startsWith("delete from cvg_aud27_migration_records")) {
      if (this.failDelete) throw new Error("synthetic delete failure");
      const runId = String(params[0]);
      const slice = String(params[1]);
      const tenantId = String(params[2]);
      const keys = params[3] as readonly string[];
      for (const key of keys) this.records.delete(`${runId}:${slice}:${tenantId}:${key}`);
      return { rows: [], rowCount: keys.length };
    }
    throw new Error(`unexpected client statement: ${sql}`);
  }
}

const context: Aud27MigrationBatchContext = {
  runId: "run-postgres-unit",
  slice: "patients",
  tenantId: "tenant-1",
  commandIds: ["command-1", "command-2"]
};

const records: readonly Aud27MigrationRecord<{ value: string }>[] = [
  { tenantId: context.tenantId, key: "patient:2", version: 1, value: { value: "B" } },
  { tenantId: context.tenantId, key: "patient:1", version: 1, value: { value: "A" } }
];

function options(pool: Pool, authorize: Aud27PostgresMigrationOptions["authorize"] = async () => undefined): Aud27PostgresMigrationOptions {
  return { pool, authorize };
}

test("PostgreSQL migration checkpoint store validates durable rows and source-digest conflicts", async () => {
  const database = new FakeMigrationDatabase();
  assert.throws(() => new PostgresAud27MigrationCheckpointStore({ pool: database.pool, connectionString: "postgres://both", authorize: async () => undefined }), /either/);
  assert.throws(() => new PostgresAud27MigrationCheckpointStore({ authorize: async () => undefined }), /explicit PostgreSQL/);

  const store = new PostgresAud27MigrationCheckpointStore(options(database.pool));
  assert.equal(await store.load(context.runId, context.slice, context.tenantId), null);
  const checkpoint: Aud27MigrationCheckpoint = { ...context, processedKeys: ["patient:2", "patient:1"], cursor: "patient:2", status: "CHECKPOINTED", sourceDigest: "a".repeat(64), updatedAt: "2026-09-21T22:00:00.000Z" };
  await store.save(checkpoint);
  assert.deepEqual(await store.load(context.runId, context.slice, context.tenantId), { runId: checkpoint.runId, slice: checkpoint.slice, tenantId: checkpoint.tenantId, sourceDigest: checkpoint.sourceDigest, processedKeys: ["patient:1", "patient:2"], cursor: checkpoint.cursor, status: checkpoint.status, updatedAt: checkpoint.updatedAt });
  assert.ok(database.statements.filter((statement) => statement === "select set_config('cvg.aud27.tenant_id', $1, true)").length >= 3);
  database.failCheckpoint = true;
  await assert.rejects(store.save(checkpoint), /source digest conflict/);
  database.failCheckpoint = false;

  database.checkpoint!.processed_keys = ["ok", 3];
  await assert.rejects(store.load(context.runId, context.slice, context.tenantId), /processed_keys/);
  database.checkpoint!.processed_keys = ["ok"];
  database.checkpoint!.status = "INVALID";
  await assert.rejects(store.load(context.runId, context.slice, context.tenantId), /status is invalid/);
  await store.close();
});

test("PostgreSQL migration adapter authorizes, applies, reads and rolls back bounded batches", async () => {
  const database = new FakeMigrationDatabase();
  const authorized: string[] = [];
  const adapter = new PostgresAud27MigrationAdapter<{ value: string }>(options(database.pool, async (batch) => { authorized.push(batch.tenantId); }));
  await adapter.authorize(context);
  assert.deepEqual(authorized, [context.tenantId]);
  await assert.rejects(adapter.authorize({ ...context, commandIds: [] }), /non-empty command batch/);

  const effect = await adapter.applyBatch(context, records);
  assert.deepEqual(effect.writtenKeys, ["patient:2", "patient:1"]);
  assert.deepEqual(await adapter.readTarget(context), [...records].sort((left, right) => left.key.localeCompare(right.key)));
  await effect.rollback();
  assert.deepEqual(await adapter.readTarget(context), []);
  assert.ok(database.statements.filter((statement) => statement === "select set_config('cvg.aud27.tenant_id', $1, true)").length >= 4);
  await adapter.close();
});

test("PostgreSQL migration adapter rolls back failed transactions and rejects target conflicts", async () => {
  const database = new FakeMigrationDatabase();
  const adapter = new PostgresAud27MigrationAdapter<{ value: string }>(options(database.pool));
  database.failTarget = true;
  await assert.rejects(adapter.applyBatch(context, records), /target conflict/);
  assert.ok(database.statements.includes("rollback"));

  database.failTarget = false;
  database.failCommit = true;
  await assert.rejects(adapter.applyBatch(context, records), /commit failure/);
  database.failCommit = false;

  const effect = await adapter.applyBatch(context, records);
  database.failDelete = true;
  await assert.rejects(effect.rollback(), /delete failure/);
  await adapter.close();
});

test("owned PostgreSQL migration pools can close without contacting a database", async () => {
  const ownedStore = new PostgresAud27MigrationCheckpointStore({ connectionString: "postgres://127.0.0.1:1/unused", authorize: async () => undefined });
  const ownedAdapter = new PostgresAud27MigrationAdapter({ connectionString: "postgres://127.0.0.1:1/unused", authorize: async () => undefined });
  await ownedStore.close();
  await ownedAdapter.close();
});

test("PostgreSQL migration run lock shares its owning session with checkpoint and target SQL", async () => {
  const database = new FakeMigrationDatabase();
  const store = new PostgresAud27MigrationCheckpointStore(options(database.pool));
  const adapter = new PostgresAud27MigrationAdapter<{ value: string }>(options(database.pool));
  const executor = new Aud27MigrationExecutor(store);
  const receipt = await executor.run({ runId: context.runId, slice: context.slice, tenantId: context.tenantId, sourceRecords: records, batchSize: 1 }, adapter);

  assert.equal(receipt.outcome, "APPLIED");
  assert.equal(database.connectCalls, 1);
  assert.equal(database.directStatements.length, 0);
  assert.equal(database.statements.filter((statement) => statement.startsWith("select pg_try_advisory_lock")).length, 1);
  assert.equal(database.statements.filter((statement) => statement.startsWith("select pg_advisory_unlock")).length, 1);
  assert.equal((await store.load(context.runId, context.slice, context.tenantId))?.status, "RECONCILED");
  await store.close();
  await adapter.close();
});

test("PostgreSQL migration executor fails closed when its durable components use different run scopes", async () => {
  const checkpointDatabase = new FakeMigrationDatabase();
  const targetDatabase = new FakeMigrationDatabase();
  const store = new PostgresAud27MigrationCheckpointStore(options(checkpointDatabase.pool));
  const adapter = new PostgresAud27MigrationAdapter<{ value: string }>(options(targetDatabase.pool));
  const executor = new Aud27MigrationExecutor(store);

  await assert.rejects(
    () => executor.run({ runId: context.runId, slice: context.slice, tenantId: context.tenantId, sourceRecords: records }, adapter),
    (error: unknown) => error instanceof Aud27MigrationError && error.code === "RUN_SCOPE_MISMATCH"
  );
  assert.equal(checkpointDatabase.connectCalls, 0);
  assert.equal(targetDatabase.connectCalls, 0);
  await store.close();
  await adapter.close();
});
