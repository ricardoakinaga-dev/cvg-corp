import { IdempotentMigrationCoordinator, reconcileMigrationRecords, snapshotMigrationCoverage, validateSnapshotMigrationPlan } from "@cvg/persistence";

const findings = validateSnapshotMigrationPlan();
if (findings.length > 0) {
  for (const finding of findings) process.stderr.write(`FAIL ${finding}\n`);
  process.exit(1);
}

const coordinator = new IdempotentMigrationCoordinator<{ id: string; value: number }>();
const rows = new Map<string, { id: string; value: number }>();
const input = {
  key: "synthetic-org:record-1",
  value: { id: "record-1", value: 1 },
  authorize: () => undefined,
  persist: async (value: { id: string; value: number }) => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    rows.set(value.id, value);
  }
};
const outcomes = await Promise.all([coordinator.apply(input), coordinator.apply(input)]);
const replayOutcome = await coordinator.apply(input);
const reconciliation = reconcileMigrationRecords([input.value], [...rows.values()]);
if (outcomes.filter((outcome) => outcome === "APPLIED").length !== 1 || outcomes.filter((outcome) => outcome === "REPLAY").length !== 1 || replayOutcome !== "REPLAY" || !reconciliation.equal) throw new Error(`snapshot command migration proof failed: ${JSON.stringify({ outcomes, replayOutcome, reconciliation })}`);

const failedRows = new Map<string, { id: string; value: number }>();
const failed = new IdempotentMigrationCoordinator<{ id: string; value: number }>();
let failedRollback = false;
try {
  await failed.apply({
    key: "synthetic-org:record-failure",
    value: { id: "record-failure", value: 1 },
    authorize: () => undefined,
    persist: () => {
      failedRows.set("record-failure", { id: "record-failure", value: 1 });
      throw new Error("synthetic backfill failure");
    },
    rollback: () => { failedRows.delete("record-failure"); failedRollback = true; }
  });
} catch (error) {
  if (!(error instanceof Error) || error.message !== "synthetic backfill failure") throw error;
}
if (!failedRollback || failedRows.size !== 0 || failed.get("synthetic-org:record-failure") !== null) throw new Error("snapshot command migration rollback proof failed");

const coverage = snapshotMigrationCoverage();
process.stdout.write(`SNAPSHOT_COMMAND_MIGRATION_VERIFIED collections=${coverage.total} command_authoritative=${coverage.commandAuthoritative} snapshot_primary=${coverage.snapshotPrimary} concurrent_replay=PASS rollback=PASS reconciliation=PASS\n`);
