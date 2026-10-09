import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeSync } from "node:fs";
import { Pool } from "pg";
import { Aud27MigrationError, Aud27MigrationExecutor, type Aud27MigrationAdapter, type Aud27MigrationBatchContext, type Aud27MigrationBatchEffect, type Aud27MigrationRecord, PostgresAud27MigrationAdapter, PostgresAud27MigrationCheckpointStore } from "@cvg/persistence";
import { cleanupAud27MigrationRuns } from "./aud27-postgres-migration-cleanup.ts";

const connectionString = process.env.CVG_AUD27_POSTGRES_URL?.trim();
if (!connectionString) {
  process.stderr.write("AUD27_POSTGRES_MIGRATION_BLOCKED provide CVG_AUD27_POSTGRES_URL explicitly; no database was contacted\n");
  process.exit(2);
}

type Value = { readonly label: string; readonly amount: number };
const crashWindowChild = process.argv.includes("--crash-window-child");
const pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 2_500, application_name: crashWindowChild ? "cvg-aud27-crash-window-child" : "cvg-aud27-migration-verifier" });
const tenantId = process.env.CVG_AUD27_TENANT_ID?.trim() || `aud27-tenant-${randomUUID()}`;
const slice = "protocol-contract";
const ownedRunIds = new Set<string>();
const source: readonly Aud27MigrationRecord<Value>[] = [
  { tenantId, key: "record-a", version: 1, value: { label: "A", amount: 10 } },
  { tenantId, key: "record-b", version: 1, value: { label: "B", amount: 20 } },
  { tenantId, key: "record-c", version: 1, value: { label: "C", amount: 30 } }
];

function createRunId(prefix: string): string {
  const runId = `${prefix}-${randomUUID()}`;
  ownedRunIds.add(runId);
  return runId;
}

function authorize(context: Aud27MigrationBatchContext): void {
  if (context.tenantId !== tenantId || context.slice !== slice) throw new Error("migration authorizer rejected tenant or slice");
  if (context.commandIds.some((commandId) => !commandId.startsWith(`aud27:${slice}:${tenantId}:`))) throw new Error("migration authorizer rejected command scope");
}

const options = { pool, authorize };
const checkpoints = new PostgresAud27MigrationCheckpointStore(options);
const adapter = new PostgresAud27MigrationAdapter<Value>(options);
const executor = new Aud27MigrationExecutor<Value>(checkpoints, () => "2026-09-21T22:00:00.000Z");

async function runCrashWindowChild(): Promise<void> {
  const runId = process.env.CVG_AUD27_CRASH_RUN_ID?.trim();
  if (!runId) throw new Error("crash-window child requires CVG_AUD27_CRASH_RUN_ID");
  ownedRunIds.add(runId);
  const interruptedAdapter: Aud27MigrationAdapter<Value> = {
    runScope: adapter.runScope,
    authorize: (context) => adapter.authorize(context),
    applyBatch: async (context, records): Promise<Aud27MigrationBatchEffect> => {
      const effect = await adapter.applyBatch(context, records);
      writeSync(1, "AUD27_CRASH_WINDOW_TARGET_COMMITTED\n");
      await new Promise<never>(() => undefined);
      return effect;
    },
    readTarget: (context) => adapter.readTarget(context)
  };
  await executor.run({ runId, slice, tenantId, sourceRecords: source, batchSize: 1 }, interruptedAdapter);
  throw new Error("crash-window child unexpectedly returned before its parent terminated it");
}

async function countTarget(runId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "select count(*)::text as count from cvg_aud27_migration_records where run_id = $1 and slice = $2 and tenant_id = $3",
    [runId, slice, tenantId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function main(): Promise<void> {
  const runId = createRunId("aud27-run");
  const dryRun = await executor.run({ runId, slice, tenantId, sourceRecords: source, batchSize: 2, dryRun: true }, adapter);
  if (dryRun.outcome !== "DRY_RUN" || dryRun.targetCount !== 0) throw new Error("durable migration dry-run contract failed");

  const applied = await executor.run({ runId, slice, tenantId, sourceRecords: source, batchSize: 2 }, adapter);
  if (applied.outcome !== "APPLIED" || applied.checkpoint.status !== "RECONCILED" || applied.targetCount !== source.length) throw new Error("durable migration apply/reconciliation contract failed");

  const freshCheckpointStore = new PostgresAud27MigrationCheckpointStore(options);
  const replay = await new Aud27MigrationExecutor<Value>(freshCheckpointStore, () => "2026-09-21T22:00:01.000Z").run({ runId, slice, tenantId, sourceRecords: source, batchSize: 2 }, adapter);
  if (replay.outcome !== "REPLAY" || replay.targetCount !== source.length) throw new Error("durable migration restart/replay contract failed");

  let sourceDriftRejected = false;
  try {
    await executor.run({ runId, slice, tenantId, sourceRecords: source.map((record) => record.key === "record-b" ? { ...record, value: { ...record.value, amount: 99 } } : record), batchSize: 2 }, adapter);
  } catch (error) {
    sourceDriftRejected = error instanceof Error && error.message.includes("source digest changed");
  }
  if (!sourceDriftRejected) throw new Error("durable migration source drift was not rejected");

  let tenantCrossingRejected = false;
  try {
    await executor.run({ runId: createRunId("aud27-cross"), slice, tenantId, sourceRecords: [{ ...source[0]!, tenantId: "different-tenant" }], batchSize: 1 }, adapter);
  } catch (error) {
    tenantCrossingRejected = error instanceof Error && error.message.includes("tenant boundary");
  }
  if (!tenantCrossingRejected) throw new Error("durable migration tenant crossing was not rejected");

  const rollbackRunId = createRunId("aud27-rollback");
  let calls = 0;
  const failingAdapter: Aud27MigrationAdapter<Value> = {
    runScope: adapter.runScope,
    authorize: (context) => adapter.authorize(context),
    applyBatch: async (context, records): Promise<Aud27MigrationBatchEffect> => {
      calls += 1;
      if (calls === 2) throw new Error("synthetic second-batch failure after first durable commit");
      return adapter.applyBatch(context, records);
    },
    readTarget: (context) => adapter.readTarget(context)
  };
  let rollbackObserved = false;
  try {
    await executor.run({ runId: rollbackRunId, slice, tenantId, sourceRecords: source, batchSize: 1 }, failingAdapter);
  } catch (error) {
    rollbackObserved = error instanceof Error && error.message.includes("second-batch failure");
  }
  const rollbackRows = await countTarget(rollbackRunId);
  const rollbackCheckpoint = await checkpoints.load(rollbackRunId, slice, tenantId);
  if (!rollbackObserved || rollbackRows !== 0 || rollbackCheckpoint?.status !== "ROLLED_BACK") throw new Error(`durable migration rollback contract failed rows=${rollbackRows} checkpoint=${rollbackCheckpoint?.status ?? "missing"}`);

  const crashRunId = createRunId("aud27-crash-window");
  const scriptPath = process.argv[1];
  if (!scriptPath) throw new Error("cannot locate the migration verifier script for the crash-window child");
  const crashChild = spawn(process.execPath, ["--import", "tsx", scriptPath, "--crash-window-child"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CVG_AUD27_POSTGRES_URL: connectionString,
      CVG_AUD27_TENANT_ID: tenantId,
      CVG_AUD27_CRASH_RUN_ID: crashRunId
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  crashChild.stdout.setEncoding("utf8");
  crashChild.stderr.setEncoding("utf8");
  let childOutput = "";
  let childError = "";
  crashChild.stdout.on("data", (chunk: string) => { childOutput += chunk; });
  crashChild.stderr.on("data", (chunk: string) => { childError += chunk; });
  const childExit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    crashChild.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const committedMarker = new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`crash-window child did not commit its first batch; stdout=${childOutput} stderr=${childError}`));
    }, 20_000);
    crashChild.stdout.on("data", (chunk: string) => {
      if (settled || !chunk.includes("AUD27_CRASH_WINDOW_TARGET_COMMITTED")) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    });
    crashChild.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    crashChild.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`crash-window child exited before the commit marker code=${code} signal=${signal} stderr=${childError}`));
    });
  });
  let killedChild = false;
  try {
    await committedMarker;
    killedChild = crashChild.kill("SIGKILL");
    const exit = await childExit;
    if (!killedChild || exit.signal !== "SIGKILL") throw new Error(`crash-window child was not terminated at the commit/checkpoint boundary signal=${exit.signal}`);
  } finally {
    if (crashChild.exitCode === null && crashChild.signalCode === null) {
      crashChild.kill("SIGKILL");
      await childExit;
    }
  }

  const crashRowsAfterDeath = await countTarget(crashRunId);
  const crashCheckpointAfterDeath = await checkpoints.load(crashRunId, slice, tenantId);
  if (crashRowsAfterDeath !== 1 || crashCheckpointAfterDeath !== null) {
    throw new Error(`crash-window setup failed rows=${crashRowsAfterDeath} checkpoint=${crashCheckpointAfterDeath?.status ?? "missing"} child_output=${childOutput}`);
  }
  const recovered = await executor.run({ runId: crashRunId, slice, tenantId, sourceRecords: source, batchSize: 1 }, adapter);
  const crashTargetAfterRecovery = await adapter.readTarget({ runId: crashRunId, slice, tenantId });
  const crashCheckpointAfterRecovery = await checkpoints.load(crashRunId, slice, tenantId);
  const crashReplay = await new Aud27MigrationExecutor<Value>(new PostgresAud27MigrationCheckpointStore(options)).run(
    { runId: crashRunId, slice, tenantId, sourceRecords: source, batchSize: 1 },
    adapter
  );
  if (recovered.outcome !== "APPLIED" || recovered.sourceDigest !== recovered.targetDigest || crashTargetAfterRecovery.length !== source.length || crashCheckpointAfterRecovery?.status !== "RECONCILED" || crashReplay.outcome !== "REPLAY") {
    throw new Error(`crash recovery contract failed recovered=${recovered.outcome} parity=${recovered.sourceDigest === recovered.targetDigest} target=${crashTargetAfterRecovery.length}/${source.length} checkpoint=${crashCheckpointAfterRecovery?.status ?? "missing"} replay=${crashReplay.outcome}`);
  }

  const concurrentRunId = createRunId("aud27-concurrent");
  const concurrentSource = source.map((record) => ({ ...record, key: `concurrent:${record.key}` }));
  const competingPool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 2_500, application_name: "cvg-aud27-migration-competitor" });
  const competingOptions = { pool: competingPool, authorize };
  const competingCheckpoints = new PostgresAud27MigrationCheckpointStore(competingOptions);
  const competingAdapter = new PostgresAud27MigrationAdapter<Value>(competingOptions);
  const firstExecutor = new Aud27MigrationExecutor<Value>(checkpoints);
  const competingExecutor = new Aud27MigrationExecutor<Value>(competingCheckpoints);
  let releaseFirstValidation: (() => void) | undefined;
  let signalFirstValidation: (() => void) | undefined;
  const firstValidationEntered = new Promise<void>((resolve) => { signalFirstValidation = resolve; });
  const validationGate = new Promise<void>((resolve) => { releaseFirstValidation = resolve; });
  let firstRecordValidated = false;
  const firstRun = firstExecutor.run({
    runId: concurrentRunId,
    slice,
    tenantId,
    sourceRecords: concurrentSource,
    batchSize: 1,
    validateRecord: async () => {
      if (firstRecordValidated) return;
      firstRecordValidated = true;
      signalFirstValidation?.();
      await validationGate;
    }
  }, adapter);
  await firstValidationEntered;
  let competingOutcome: { result?: Awaited<typeof firstRun>; error?: unknown };
  try {
    competingOutcome = { result: await competingExecutor.run({ runId: concurrentRunId, slice, tenantId, sourceRecords: concurrentSource, batchSize: 1 }, competingAdapter) };
  } catch (error) {
    competingOutcome = { error };
  }
  releaseFirstValidation?.();
  const firstResult = await firstRun;
  await competingCheckpoints.close();
  await competingAdapter.close();
  await competingPool.end().catch(() => undefined);
  const concurrentTarget = await adapter.readTarget({ runId: concurrentRunId, slice, tenantId });
  const concurrentCheckpoint = await checkpoints.load(concurrentRunId, slice, tenantId);
  const competingRejected = competingOutcome.error instanceof Aud27MigrationError && competingOutcome.error.code === "RUN_IN_PROGRESS";
  if (!competingRejected || firstResult.outcome !== "APPLIED" || concurrentTarget.length !== concurrentSource.length || concurrentCheckpoint?.status !== "RECONCILED") {
    throw new Error(`same-run concurrency contract failed competing_rejected=${competingRejected} first=${firstResult.outcome} target=${concurrentTarget.length}/${concurrentSource.length} checkpoint=${concurrentCheckpoint?.status ?? "missing"}`);
  }
  const concurrentReplay = await firstExecutor.run({ runId: concurrentRunId, slice, tenantId, sourceRecords: concurrentSource, batchSize: 1 }, adapter);
  if (concurrentReplay.outcome !== "REPLAY") throw new Error(`migration run lock was not released after reconciliation: ${concurrentReplay.outcome}`);

  process.stdout.write(`AUD27_POSTGRES_MIGRATION_VERIFIED tenant_scope=PASS dry_run=PASS batches=2 durable_checkpoint=PASS apply=PASS replay=PASS source_drift=REJECTED tenant_crossing=REJECTED rollback=PASS crash_recovery=PASS same_run_concurrency=REJECTED lock_release=PASS target=${concurrentTarget.length} records=${source.length}\n`);
}

try {
  if (crashWindowChild) await runCrashWindowChild();
  else await main();
} catch (error) {
  process.stderr.write(`AUD27_POSTGRES_MIGRATION_FAILED ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  try {
    const cleanup = await cleanupAud27MigrationRuns(
      pool,
      { tenantId, slice, runIds: [...ownedRunIds] }
    );
    process.stdout.write(`AUD27_POSTGRES_MIGRATION_CLEANUP records=${cleanup.recordsDeleted} checkpoints=${cleanup.checkpointsDeleted} owned_runs=${ownedRunIds.size}\n`);
  } catch (error) {
    process.stderr.write(`AUD27_POSTGRES_MIGRATION_CLEANUP_FAILED ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
  await pool.end().catch(() => undefined);
}
