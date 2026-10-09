import test from "node:test";
import assert from "node:assert/strict";
import { IdempotentMigrationCoordinator, SNAPSHOT_MIGRATION_PLAN, reconcileMigrationRecords, snapshotMigrationCoverage, validateSnapshotMigrationPlan } from "@cvg/persistence";

test("snapshot migration inventory covers all 32 collections without hiding the 24 residual primary paths", () => {
  assert.deepEqual(validateSnapshotMigrationPlan(), []);
  assert.deepEqual(snapshotMigrationCoverage(), { total: 32, commandAuthoritative: 8, snapshotPrimary: 24, frameworkReady: 24 });
  assert.equal(SNAPSHOT_MIGRATION_PLAN.filter((entry) => entry.authority === "SNAPSHOT_PRIMARY").every((entry) => entry.lifecycle === "FRAMEWORK_READY"), true);
});

test("idempotent migration coordinator serializes concurrent replay and rejects divergent input", async () => {
  const coordinator = new IdempotentMigrationCoordinator<{ id: string; value: number }>();
  const writes: string[] = [];
  const input = {
    key: "organization-1:record-1",
    value: { id: "record-1", value: 1 },
    authorize: () => undefined,
    persist: async (_value: { id: string; value: number }, commandId: string) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      writes.push(commandId);
    }
  };
  const outcomes = await Promise.all([coordinator.apply(input), coordinator.apply(input)]);
  assert.deepEqual(outcomes.sort(), ["APPLIED", "REPLAY"]);
  assert.deepEqual(writes, ["migration:organization-1:record-1"]);
  await assert.rejects(() => coordinator.apply({ ...input, value: { id: "record-1", value: 2 } }), /idempotency conflict/);
});

test("migration coordinator rolls back an adapter failure and reconciliation detects drift", async () => {
  const coordinator = new IdempotentMigrationCoordinator<{ id: string; value: number }>();
  const rows = new Map<string, { id: string; value: number }>();
  await assert.rejects(() => coordinator.apply({
    key: "organization-1:record-failure",
    value: { id: "record-failure", value: 1 },
    authorize: () => undefined,
    persist: () => {
      rows.set("record-failure", { id: "record-failure", value: 1 });
      throw new Error("synthetic backfill failure");
    },
    rollback: () => { rows.delete("record-failure"); }
  }), /synthetic backfill failure/);
  assert.equal(rows.size, 0);
  assert.equal(coordinator.get("organization-1:record-failure"), null);
  const equivalent = reconcileMigrationRecords([{ id: "record-1", value: 1 }], [{ id: "record-1", value: 1 }]);
  const divergent = reconcileMigrationRecords([{ id: "record-1", value: 1 }], [{ id: "record-1", value: 2 }]);
  assert.equal(equivalent.equal, true);
  assert.equal(divergent.equal, false);
});
