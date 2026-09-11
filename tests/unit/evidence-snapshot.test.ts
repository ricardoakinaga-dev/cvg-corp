import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verifyEvidenceArtifactConsistency, verifyEvidenceSnapshot, type EvidenceSnapshot } from "../../scripts/verify-evidence-snapshot.ts";

async function currentSnapshot(): Promise<EvidenceSnapshot> {
  return JSON.parse(await readFile("artifacts/operational-proof/evidence-snapshot.json", "utf8")) as EvidenceSnapshot;
}

test("evidence snapshot rejects stale capture timestamps", async () => {
  const snapshot = await currentSnapshot();
  const errors = await verifyEvidenceSnapshot({ ...snapshot, capturedAt: new Date(0).toISOString() });
  assert.ok(errors.some((error) => error.includes("capturedAt")));
});

test("evidence snapshot binds the captured worktree state", async () => {
  const snapshot = await currentSnapshot();
  const errors = await verifyEvidenceSnapshot({ ...snapshot, worktree: snapshot.worktree === "CLEAN" ? "MODIFIED" : "CLEAN" });
  assert.ok(errors.some((error) => error.includes("worktree state")));
});

test("evidence snapshot rejects stale duplicated verification metadata", () => {
  const errors = verifyEvidenceArtifactConsistency("artifacts/operational-proof/local-verification-2026-09-10.json", {
    finalVerification: { record: "VER-CVG-253", observedAt: "2026-09-11T14:14:31.861Z", tests: "321=320 pass+1 skip+0 fail", static: "PASS; 149 required artifacts/171 sources", lint: 169, verdict: "AAA_NOT_PROVEN", globalVerdict: "AAA_NOT_PROVEN" },
    local: { finalVerification: { record: "VER-CVG-249", observedAt: "2026-09-11T13:37:29.914Z", tests: "320=319 pass+1 skip+0 fail", static: "PASS; 147 required artifacts/170 sources", lint: 168, verdict: "AAA_NOT_PROVEN", globalVerdict: "AAA_NOT_PROVEN" } }
  });
  assert.equal(errors.length, 8);
  assert.ok(errors.every((error) => error.includes("diverges")));
});
