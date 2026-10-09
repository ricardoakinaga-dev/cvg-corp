import test from "node:test";
import assert from "node:assert/strict";
import { Aud27MigrationError, Aud27MigrationExecutor, InMemoryAud27MigrationCheckpointStore, type Aud27MigrationAdapter, type Aud27MigrationRecord } from "@cvg/persistence";

type Row = { id: string; value: number };

function adapter(rows: Map<string, Aud27MigrationRecord<Row>>, options: { failAfter?: number } = {}): Aud27MigrationAdapter<Row> {
  let batches = 0;
  return {
    authorize: async ({ tenantId }) => { if (tenantId !== "org-1") throw new Error("tenant denied"); },
    applyBatch: async (_context, records) => {
      batches += 1;
      const before = new Map([...rows.entries()].filter(([key]) => records.some((record) => record.key === key)));
      for (const record of records) rows.set(record.key, structuredClone(record));
      if (options.failAfter === batches) {
        records.forEach((record) => before.has(record.key) ? rows.set(record.key, before.get(record.key)!) : rows.delete(record.key));
        throw new Error("synthetic batch failure");
      }
      return {
        writtenKeys: records.map((record) => record.key),
        rollback: async () => {
          records.forEach((record) => before.has(record.key) ? rows.set(record.key, before.get(record.key)!) : rows.delete(record.key));
        }
      };
    },
    readTarget: async ({ tenantId }) => [...rows.values()].filter((record) => record.tenantId === tenantId)
  };
}

function records(): Aud27MigrationRecord<Row>[] {
  return [
    { tenantId: "org-1", key: "record:a", version: 1, value: { id: "a", value: 1 } },
    { tenantId: "org-1", key: "record:b", version: 1, value: { id: "b", value: 2 } },
    { tenantId: "org-1", key: "record:c", version: 1, value: { id: "c", value: 3 } }
  ];
}

test("AUD27 migration harness supports dry-run, checkpoints, parity and replay", async () => {
  const store = new InMemoryAud27MigrationCheckpointStore();
  const rows = new Map<string, Aud27MigrationRecord<Row>>();
  const executor = new Aud27MigrationExecutor(store, () => "2026-09-21T20:00:00.000Z");
  const input = { runId: "run-1", slice: "queue", tenantId: "org-1", sourceRecords: records(), batchSize: 2 };
  const dry = await executor.run({ ...input, dryRun: true }, adapter(rows));
  assert.equal(dry.outcome, "DRY_RUN");
  assert.equal(rows.size, 0);
  const applied = await executor.run(input, adapter(rows));
  assert.equal(applied.outcome, "APPLIED");
  assert.equal(applied.sourceDigest, applied.targetDigest);
  assert.equal(rows.size, 3);
  const replay = await executor.run(input, adapter(rows));
  assert.equal(replay.outcome, "REPLAY");
  assert.deepEqual(replay.processedKeys, ["record:a", "record:b", "record:c"]);
});

test("AUD27 migration harness quarantines a drifted target during replay", async () => {
  const store = new InMemoryAud27MigrationCheckpointStore();
  const rows = new Map<string, Aud27MigrationRecord<Row>>();
  const executor = new Aud27MigrationExecutor(store, () => "2026-09-21T20:00:00.000Z");
  const input = { runId: "run-replay-drift", slice: "queue", tenantId: "org-1", sourceRecords: records() };
  await executor.run(input, adapter(rows));
  rows.delete("record:b");

  await assert.rejects(() => executor.run(input, adapter(rows)), /reconciled target drifted/);
  assert.equal((await store.load(input.runId, input.slice, input.tenantId))?.status, "QUARANTINED");
});

test("AUD27 migration harness rejects tenant crossing and rolls back failed batches", async () => {
  const store = new InMemoryAud27MigrationCheckpointStore();
  const rows = new Map<string, Aud27MigrationRecord<Row>>();
  const executor = new Aud27MigrationExecutor(store, () => "2026-09-21T20:00:00.000Z");
  await assert.rejects(() => executor.run({ runId: "run-tenant", slice: "queue", tenantId: "org-1", sourceRecords: [{ tenantId: "org-2", key: "record:x", version: 1, value: { id: "x", value: 1 } }] }, adapter(rows)), /tenant boundary/);
  await assert.rejects(() => executor.run({ runId: "run-fail", slice: "queue", tenantId: "org-1", sourceRecords: records(), batchSize: 2 }, adapter(rows, { failAfter: 1 })), /synthetic batch failure/);
  assert.equal(rows.size, 0);
});

test("AUD27 migration harness rejects a tampered target through parity", async () => {
  const store = new InMemoryAud27MigrationCheckpointStore();
  const rows = new Map<string, Aud27MigrationRecord<Row>>();
  const executor = new Aud27MigrationExecutor(store, () => "2026-09-21T20:00:00.000Z");
  const badAdapter = adapter(rows);
  const original = badAdapter.applyBatch;
  badAdapter.applyBatch = async (context, source) => {
    const effect = await original.call(badAdapter, context, source);
    rows.get(source[0]!.key)!.value.value = 99;
    return effect;
  };
  await assert.rejects(() => executor.run({ runId: "run-parity", slice: "queue", tenantId: "org-1", sourceRecords: records() }, badAdapter), /target parity failed/);
  assert.equal((await store.load("run-parity", "queue", "org-1"))?.status, "QUARANTINED");
});

test("AUD27 migration harness rejects a concurrent owner for the same run key", async () => {
  const store = new InMemoryAud27MigrationCheckpointStore();
  const rows = new Map<string, Aud27MigrationRecord<Row>>();
  const firstExecutor = new Aud27MigrationExecutor(store);
  const competingExecutor = new Aud27MigrationExecutor(store);
  const input = { runId: "run-concurrent", slice: "queue", tenantId: "org-1", sourceRecords: records(), batchSize: 1 };
  let releaseValidation: (() => void) | undefined;
  let signalValidation: (() => void) | undefined;
  const enteredValidation = new Promise<void>((resolve) => { signalValidation = resolve; });
  const validationGate = new Promise<void>((resolve) => { releaseValidation = resolve; });
  let firstValidation = false;
  const firstRun = firstExecutor.run({
    ...input,
    validateRecord: async () => {
      if (firstValidation) return;
      firstValidation = true;
      signalValidation?.();
      await validationGate;
    }
  }, adapter(rows));

  await enteredValidation;
  await assert.rejects(
    () => competingExecutor.run(input, adapter(rows)),
    (error: unknown) => error instanceof Aud27MigrationError && error.code === "RUN_IN_PROGRESS"
  );
  releaseValidation?.();
  const applied = await firstRun;
  assert.equal(applied.outcome, "APPLIED");
  assert.equal((await store.load(input.runId, input.slice, input.tenantId))?.status, "RECONCILED");
  assert.equal(rows.size, records().length);
});
