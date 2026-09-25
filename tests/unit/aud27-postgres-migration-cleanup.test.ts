import test from "node:test";
import assert from "node:assert/strict";
import { cleanupAud27MigrationRuns } from "../../scripts/aud27-postgres-migration-cleanup.ts";

type Entry = { tenantId: string; slice: string; runId: string; key: string };

test("AUD27 verifier cleanup deletes only explicitly owned run IDs within the RLS tenant and slice", async () => {
  const records: Entry[] = [
    { tenantId: "tenant-a", slice: "protocol-contract", runId: "owned-1", key: "record-a" },
    { tenantId: "tenant-a", slice: "protocol-contract", runId: "owned-2", key: "record-b" },
    { tenantId: "tenant-a", slice: "other-slice", runId: "owned-1", key: "record-c" },
    { tenantId: "tenant-a", slice: "protocol-contract", runId: "unrelated-run", key: "record-d" },
    { tenantId: "tenant-b", slice: "protocol-contract", runId: "owned-1", key: "record-e" }
  ];
  const checkpoints: Entry[] = structuredClone(records);
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  let released = false;
  const pool = {
    connect: async () => ({
      query: async (sql: string, params: unknown[]) => {
        statements.push({ sql, params });
        if (sql === "begin" || sql === "commit" || sql === "select set_config('cvg.aud27.tenant_id', $1, true)") return { rowCount: 0 };
        const [tenantId, slice, runIds] = params as [string, string, string[]];
        const target = sql.includes("cvg_aud27_migration_records") ? records : checkpoints;
        const before = target.length;
        for (let index = target.length - 1; index >= 0; index -= 1) {
          const entry = target[index]!;
          if (entry.tenantId === tenantId && entry.slice === slice && runIds.includes(entry.runId)) target.splice(index, 1);
        }
        return { rowCount: before - target.length };
      },
      release: () => { released = true; }
    })
  };

  const result = await cleanupAud27MigrationRuns(pool, {
    tenantId: " tenant-a ",
    slice: " protocol-contract ",
    runIds: ["owned-2", "owned-1", "owned-1"]
  });

  assert.deepEqual(result, { recordsDeleted: 2, checkpointsDeleted: 2 });
  assert.equal(statements[0]?.sql, "begin");
  assert.equal(statements[1]?.sql, "select set_config('cvg.aud27.tenant_id', $1, true)");
  assert.deepEqual(statements[1]?.params, ["tenant-a"]);
  assert.deepEqual(statements[2]?.params, ["tenant-a", "protocol-contract", ["owned-1", "owned-2"]]);
  assert.deepEqual(records.map(({ runId, slice, tenantId }) => `${tenantId}:${slice}:${runId}`).sort(), [
    "tenant-a:other-slice:owned-1",
    "tenant-a:protocol-contract:unrelated-run",
    "tenant-b:protocol-contract:owned-1"
  ]);
  assert.deepEqual(checkpoints, records);
  assert.equal(statements.at(-1)?.sql, "commit");
  assert.equal(released, true);
});

test("AUD27 verifier cleanup is a no-op without owned run IDs", async () => {
  let queries = 0;
  const result = await cleanupAud27MigrationRuns({ connect: async () => {
    queries += 1;
    throw new Error("empty cleanup must not connect");
  } }, { tenantId: "tenant-a", slice: "protocol-contract", runIds: ["", "   "] });

  assert.deepEqual(result, { recordsDeleted: 0, checkpointsDeleted: 0 });
  assert.equal(queries, 0);
});
