import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { SNAPSHOT_ARTIFACTS, verifyEvidenceArtifactConsistency, verifyEvidenceSnapshot, type EvidenceSnapshot } from "../../scripts/verify-evidence-snapshot.ts";
import { EXPECTED_PROMPT_SHA256, PROMPT_REFERENCE } from "../../scripts/prompt-integrity.ts";

const HEAD = "a".repeat(40);
const NOW = Date.parse("2026-09-13T12:00:00.000Z");
const CAPTURED_AT = "2026-09-13T11:59:30.000Z";
const ARTIFACT_TIME = "2026-09-13T11:59:00.000Z";
const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

/** Builds the evidence fixture from controlled bytes instead of the live worktree. */
function fixture(worktree: EvidenceSnapshot["worktree"] = "MODIFIED") {
  const files = new Map<string, Buffer>();
  const artifacts = SNAPSHOT_ARTIFACTS.map((path) => {
    const bytes = Buffer.from(JSON.stringify({ path, observedAt: ARTIFACT_TIME }));
    files.set(path, bytes);
    return { path, digest: sha256(bytes), modifiedAt: ARTIFACT_TIME, declaredObservedAt: ARTIFACT_TIME };
  });
  const snapshot: EvidenceSnapshot = {
    schemaVersion: 1,
    capturedAt: CAPTURED_AT,
    sourceSha: HEAD,
    worktree,
    prompt: { path: PROMPT_REFERENCE, sha256: EXPECTED_PROMPT_SHA256 },
    artifacts,
    runId: ""
  };
  snapshot.runId = sha256(JSON.stringify({ sourceSha: snapshot.sourceSha, prompt: snapshot.prompt.sha256, artifacts: snapshot.artifacts }));
  // Ambient mtimes and checkout state cannot influence the verdict: they are injected.
  const environment = {
    now: NOW,
    headSha: HEAD,
    worktree,
    readArtifact: async (path: string) => ({ bytes: files.get(path) ?? Buffer.from("missing"), modifiedAt: "2027-02-01T00:00:00.000Z" })
  };
  return { snapshot, environment, files };
}

function reseal(snapshot: EvidenceSnapshot): void {
  snapshot.runId = sha256(JSON.stringify({ sourceSha: snapshot.sourceSha, prompt: snapshot.prompt.sha256, artifacts: snapshot.artifacts }));
}

test("evidence fixture verifies in clean and modified checkouts with byte-identical copies", async () => {
  const clean = fixture("CLEAN");
  assert.deepEqual(await verifyEvidenceSnapshot(clean.snapshot, clean.environment), []);
  const modified = fixture("MODIFIED");
  assert.deepEqual(await verifyEvidenceSnapshot(modified.snapshot, modified.environment), []);
  assert.notEqual(clean.files.get(SNAPSHOT_ARTIFACTS[0])?.toString("utf8"), undefined);
});

test("evidence snapshot rejects a worktree state that contradicts the controlled checkout", async () => {
  const clean = fixture("CLEAN");
  const errors = await verifyEvidenceSnapshot(clean.snapshot, { ...clean.environment, worktree: "MODIFIED" });
  assert.ok(errors.some((error) => error.includes("worktree state")));
});

test("evidence snapshot rejects stale capture timestamps", async () => {
  const { snapshot, environment } = fixture();
  const errors = await verifyEvidenceSnapshot({ ...snapshot, capturedAt: new Date(0).toISOString() }, environment);
  assert.ok(errors.some((error) => error.includes("capturedAt")));
});

test("evidence snapshot rejects tampered artifact bytes even with an otherwise valid record", async () => {
  const { snapshot, environment, files } = fixture();
  const target = SNAPSHOT_ARTIFACTS[0];
  files.set(target, Buffer.from(JSON.stringify({ tampered: true })));
  const errors = await verifyEvidenceSnapshot(snapshot, environment);
  assert.ok(errors.some((error) => error.includes(target) && error.includes("bytes differ")));
});

test("evidence snapshot rejects a tampered inventory even when the runId is resealed", async () => {
  const { snapshot, environment } = fixture();
  const tampered = { ...snapshot, artifacts: snapshot.artifacts.slice(0, -1) };
  reseal(tampered);
  const errors = await verifyEvidenceSnapshot(tampered, environment);
  assert.ok(errors.some((error) => error.includes("inventory is not exact")));
});

test("evidence snapshot rejects tampered modification and observation times", async () => {
  const modifiedAt = fixture();
  const first = modifiedAt.snapshot.artifacts[0];
  assert.ok(first);
  modifiedAt.snapshot.artifacts[0] = { ...first, modifiedAt: new Date(0).toISOString() };
  reseal(modifiedAt.snapshot);
  const modifiedErrors = await verifyEvidenceSnapshot(modifiedAt.snapshot, modifiedAt.environment);
  assert.ok(modifiedErrors.some((error) => error.includes("modification time is outside")));

  const observedAt = fixture();
  const second = observedAt.snapshot.artifacts[1];
  assert.ok(second);
  observedAt.snapshot.artifacts[1] = { ...second, declaredObservedAt: new Date(0).toISOString() };
  reseal(observedAt.snapshot);
  const observedErrors = await verifyEvidenceSnapshot(observedAt.snapshot, observedAt.environment);
  assert.ok(observedErrors.some((error) => error.includes("declared observedAt is outside")));
});

test("evidence snapshot rejects a historical run resealed as current", async () => {
  const { snapshot, environment } = fixture();
  const historical = { ...snapshot, capturedAt: "2026-08-01T00:00:00.000Z" };
  reseal(historical);
  const errors = await verifyEvidenceSnapshot(historical, environment);
  assert.ok(errors.some((error) => error.includes("capturedAt")));
});

test("evidence snapshot rejects stale duplicated verification metadata", () => {
  const errors = verifyEvidenceArtifactConsistency("artifacts/operational-proof/local-verification-2026-09-10.json", {
    finalVerification: { record: "VER-CVG-253", observedAt: "2026-09-11T14:14:31.861Z", tests: "321=320 pass+1 skip+0 fail", static: "PASS; 149 required artifacts/171 sources", lint: 169, verdict: "AAA_NOT_PROVEN", globalVerdict: "AAA_NOT_PROVEN" },
    local: { finalVerification: { record: "VER-CVG-249", observedAt: "2026-09-11T13:37:29.914Z", tests: "320=319 pass+1 skip+0 fail", static: "PASS; 147 required artifacts/170 sources", lint: 168, verdict: "AAA_NOT_PROVEN", globalVerdict: "AAA_NOT_PROVEN" } }
  });
  assert.equal(errors.length, 8);
  assert.ok(errors.every((error) => error.includes("diverges")));
});
