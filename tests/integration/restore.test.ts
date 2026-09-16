import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { id } from "@cvg/contracts";
import { CvgStore } from "@cvg/domain";
import { PersistenceStateError, reconcileRestoredSnapshot, RECOVERY_STORE_COVERAGE, validateRecoveryStoreCoverage, type RecoveryDecision } from "@cvg/persistence";

test("restore fixture never reactivates old authority", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  store.createSession(store.bootstrapCredentials.userId, "digest", "csrf", 60);
  const snapshot = store.snapshot();
  store.restore(snapshot);
  assert.equal(store.healthStatus, "QUARANTINED");
  assert.equal(store.findSession("digest"), undefined);
  assert.equal(store.quarantined.at(-1)?.kind, "RESTORE");
});

test("restore reconciliation reapplies post-backup decisions only under an independent authority", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const adminId = store.bootstrapCredentials.userId;
  const session = store.createSession(adminId, "restore-reconcile-token", "restore-reconcile-csrf", 60);
  const assignment = [...store.roleAssignments.values()].find((candidate) => candidate.revokedAt === null && candidate.role !== "admin");
  const patient = [...store.patients.values()][0];
  const document = [...store.knowledgeDocuments.values()][0];
  assert.ok(assignment && patient && document);
  const backup = store.snapshot();
  backup.healthStatus = "QUARANTINED";
  const decidedAt = new Date().toISOString();
  const decisions: RecoveryDecision[] = [
    { kind: "REVOKE_SESSION", resourceId: session.id, decidedAt, authorityRef: "incident-commander" },
    { kind: "REVOKE_ROLE", resourceId: assignment.id, decidedAt, authorityRef: "security-officer" },
    { kind: "RESTRICT_PATIENT", resourceId: patient.id, decidedAt, authorityRef: "clinical-director" },
    { kind: "QUARANTINE_DOCUMENT", resourceId: document.id, decidedAt, authorityRef: "knowledge-owner" }
  ];
  const result = reconcileRestoredSnapshot({
    snapshot: backup,
    decisions,
    backupWatermark: new Date(Date.now() - 60_000).toISOString(),
    authority: { id: "recovery-officer", role: "recovery_authority", authorized: true }
  });
  assert.equal(result.state, "READY");
  assert.equal(result.applied.length, 4);
  assert.equal(result.pending.length, 0);
  assert.ok(result.snapshot.sessions.find((candidate) => candidate.id === session.id)?.revokedAt);
  assert.ok(result.snapshot.roleAssignments.find((candidate) => candidate.id === assignment.id)?.revokedAt);
  assert.equal(result.snapshot.patients.find((candidate) => candidate.id === patient.id)?.status, "INACTIVE");
  assert.equal(result.snapshot.knowledgeDocuments.find((candidate) => candidate.id === document.id)?.status, "QUARANTINED");
  assert.equal(backup.healthStatus, "QUARANTINED", "the input snapshot must remain untouched");
});

test("restore reconciliation stays quarantined while any post-backup decision is unresolved", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const backup = store.snapshot();
  backup.healthStatus = "QUARANTINED";
  const result = reconcileRestoredSnapshot({
    snapshot: backup,
    decisions: [{ kind: "REVOKE_SESSION", resourceId: id(randomUUID()), decidedAt: new Date().toISOString(), authorityRef: "incident-commander" }],
    backupWatermark: new Date(Date.now() - 60_000).toISOString(),
    authority: { id: "recovery-officer", role: "recovery_authority", authorized: true }
  });
  assert.equal(result.state, "QUARANTINED");
  assert.equal(result.pending.length, 1);
  assert.equal(result.applied.length, 0);
});

test("restore reconciliation refuses non-quarantined snapshots, unauthorized or non-independent authorities", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const quarantined = store.snapshot();
  quarantined.healthStatus = "QUARANTINED";
  assert.throws(
    () => reconcileRestoredSnapshot({ snapshot: store.snapshot(), decisions: [], backupWatermark: new Date().toISOString(), authority: { id: "recovery-officer", role: "recovery_authority", authorized: true } }),
    (error: unknown) => error instanceof PersistenceStateError
  );
  assert.throws(
    () => reconcileRestoredSnapshot({ snapshot: quarantined, decisions: [], backupWatermark: new Date().toISOString(), authority: { id: "recovery-officer", role: "operator", authorized: true } }),
    (error: unknown) => error instanceof PersistenceStateError
  );
  const decision: RecoveryDecision = { kind: "REVOKE_SESSION", resourceId: id(randomUUID()), decidedAt: new Date().toISOString(), authorityRef: "recovery-officer" };
  assert.throws(
    () => reconcileRestoredSnapshot({ snapshot: quarantined, decisions: [decision], backupWatermark: new Date(Date.now() - 60_000).toISOString(), authority: { id: "recovery-officer", role: "recovery_authority", authorized: true } }),
    (error: unknown) => error instanceof PersistenceStateError && error.message.includes("independent")
  );
});

test("recovery store coverage declares every store with an explicit owner", () => {
  validateRecoveryStoreCoverage();
  assert.equal(RECOVERY_STORE_COVERAGE.length, 9);
  assert.throws(
    () => validateRecoveryStoreCoverage([...RECOVERY_STORE_COVERAGE.slice(0, 8)]),
    (error: unknown) => error instanceof PersistenceStateError && error.message.includes("export")
  );
  assert.throws(
    () => validateRecoveryStoreCoverage([...RECOVERY_STORE_COVERAGE, RECOVERY_STORE_COVERAGE[0]!]),
    (error: unknown) => error instanceof PersistenceStateError && error.message.includes("duplicate")
  );
});
