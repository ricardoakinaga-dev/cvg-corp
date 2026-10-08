import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { CvgStore, digest, serializeSnapshot } from "@cvg/domain";
import { PersistenceCorruptionError, PostgresPersistence, validateRecoveryBundle } from "@cvg/persistence";

function fixture() {
  const store = new CvgStore({ bootstrapPassword: "synthetic-recovery-hardening-password" });
  const { organizationId, userId } = store.bootstrapCredentials;
  const record = (action: string) => store.recordAudit({
    organizationId, actorId: userId, unitId: null, workspaceId: null,
    action, resourceType: "verification", resourceId: null, result: "ALLOWED",
    reason: null, correlationId: randomUUID(), metadata: { synthetic: true }
  });
  record("snapshot.audit");
  const snapshot = store.snapshot();
  const snapshotDigest = digest(JSON.parse(serializeSnapshot(snapshot)));
  const late = record("worker.after_snapshot");
  const ledger = store.snapshot().auditRecords.map((audit) => ({
    audit_id: audit.id, organization_id: organizationId, record: structuredClone(audit),
    record_digest: digest(audit), previous_hash: audit.previousHash,
    record_hash: audit.recordHash, chain_version: audit.chainVersion
  }));
  const statements: string[] = [];
  const client = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes("from cvg_state_snapshots s")) return { rows: [{
        revision: "7", organization_id: organizationId, schema_version: 1,
        snapshot: JSON.parse(serializeSnapshot(snapshot)), snapshot_digest: snapshotDigest,
        event_id: "synthetic-snapshot-event", journal_snapshot_digest: snapshotDigest
      }] };
      if (sql.includes("from cvg_audit_ledger")) return { rows: ledger };
      if (sql.includes("from schema_migrations")) return { rows: [{ version: "049", checksum: "synthetic-checksum" }] };
      return { rows: [] };
    },
    release() { statements.push("RELEASE"); }
  };
  const pool = { connect: async () => client } as unknown as Pool;
  const persistence = new PostgresPersistence({ connectionString: "unused-synthetic-fixture", pool });
  return { persistence, snapshot, snapshotDigest, late, ledger, statements, organizationId };
}

test("production hardening: backup preserves a durable worker audit after the last snapshot", async () => {
  const f = fixture();
  const bundle = await f.persistence.exportRecoveryBundle(f.organizationId);
  assert.ok(bundle);
  assert.ok(bundle.snapshot.auditRecords.some((audit) => audit.id === f.late.id), "durable audit was omitted from the backup");
  assert.equal(bundle.snapshot.auditRecords.length, f.snapshot.auditRecords.length + 1);
  assert.equal(f.snapshot.auditRecords.some((audit) => audit.id === f.late.id), false, "stored snapshot must remain unchanged");
  assert.notEqual(bundle.snapshotDigest, f.snapshotDigest);
  assert.equal(bundle.snapshotDigest, bundle.manifest.watermark.snapshotDigest);
  assert.equal(bundle.revision, 7n);
  assert.doesNotThrow(() => validateRecoveryBundle(bundle));
  assert.equal(f.statements[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(f.statements.some((sql) => /^(insert|update|delete)\b/i.test(sql)), false);
  assert.ok(f.statements.includes("COMMIT"));
});

for (const scenario of ["tampered digest", "truncated history", "foreign organization", "disconnected chain", "ledger metadata"] as const) {
  test(`production hardening: backup rejects ${scenario} without emitting a bundle`, async () => {
    const f = fixture();
    const last = f.ledger[f.ledger.length - 1]!;
    if (scenario === "tampered digest") last.record.metadata = { synthetic: false };
    if (scenario === "truncated history") f.ledger.splice(0, f.ledger.length);
    if (scenario === "foreign organization") last.organization_id = randomUUID() as typeof last.organization_id;
    if (scenario === "disconnected chain") {
      last.record.previousHash = "a".repeat(64);
      last.record_digest = digest(last.record);
      last.previous_hash = last.record.previousHash;
    }
    if (scenario === "ledger metadata") last.record_hash = "b".repeat(64);
    await assert.rejects(() => f.persistence.exportRecoveryBundle(f.organizationId), PersistenceCorruptionError);
    assert.ok(f.statements.includes("ROLLBACK"));
    assert.equal(f.statements.includes("COMMIT"), false);
  });
}
