import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync, utimesSync } from "node:fs";
import { resolve } from "node:path";
import { AUD26_EVIDENCE_SNAPSHOT_PATH, verifyAud26Evidence, type Aud26EvidenceSnapshot } from "../../scripts/verify-aud26-evidence.ts";
import { buildSubjectManifest } from "../../scripts/subject-manifest.ts";

function historicalSnapshot(): Aud26EvidenceSnapshot {
  return JSON.parse(readFileSync(AUD26_EVIDENCE_SNAPSHOT_PATH, "utf8")) as Aud26EvidenceSnapshot;
}

test("historical AUD26 evidence remains valid without rebinding to the current AUD27 subject", () => {
  const snapshot = historicalSnapshot();
  const current = buildSubjectManifest();

  assert.notEqual(snapshot.candidateFingerprint, current.fingerprint);
  assert.deepEqual(verifyAud26Evidence(snapshot, Date.parse("2026-09-30T00:00:00.000Z")), []);
});

test("historical AUD26 evidence survives a fresh checkout's modification times but not altered bytes", () => {
  const snapshot = historicalSnapshot();
  const path = resolve(snapshot.artifacts[0]!.path);
  const original = statSync(path);
  try {
    utimesSync(path, new Date(), new Date());
    assert.deepEqual(verifyAud26Evidence(snapshot, Date.parse("2026-09-30T00:00:00.000Z")), []);
  } finally {
    utimesSync(path, original.atime, original.mtime);
  }
  const tampered = { ...snapshot, artifacts: snapshot.artifacts.map((entry, index) => index === 0 ? { ...entry, digest: "0".repeat(64) } : entry) };
  assert.ok(verifyAud26Evidence(tampered, Date.parse("2026-09-30T00:00:00.000Z")).some((error) => error.includes("digest differs from the snapshot")));
});

test("historical AUD26 evidence rejects an artifact rebound to another subject", () => {
  const snapshot = historicalSnapshot();
  const rebound = { ...snapshot, candidateFingerprint: buildSubjectManifest().fingerprint };
  const errors = verifyAud26Evidence(rebound, Date.parse("2026-09-30T00:00:00.000Z"));

  assert.ok(errors.some((error) => error.includes("not bound to the historical snapshot subject")));
});

test("historical AUD26 evidence rejects a future capture", () => {
  const snapshot = historicalSnapshot();
  const errors = verifyAud26Evidence({ ...snapshot, capturedAt: "2026-10-01T00:00:00.000Z" }, Date.parse("2026-09-30T00:00:00.000Z"));

  assert.ok(errors.some((error) => error.includes("capturedAt is invalid or in the future")));
});
