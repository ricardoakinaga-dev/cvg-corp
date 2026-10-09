import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateAud27Semantics, knownBadSemanticFixtures } from "../../scripts/verify-aud27-semantics.ts";

type Fixture = Parameters<typeof validateAud27Semantics>[0];
type Backlog = Parameters<typeof validateAud27Semantics>[1];

function current(): { manifest: Fixture; backlog: Backlog } {
  return {
    manifest: JSON.parse(readFileSync("docs/aud27-semantic-manifest.json", "utf8")) as Fixture,
    backlog: JSON.parse(readFileSync(".agent/backlog.json", "utf8")) as Backlog
  };
}

test("AUD27 semantic manifest validates the current F01-F39 and AUD26 mappings", () => {
  const { manifest, backlog } = current();
  assert.deepEqual(validateAud27Semantics(manifest, backlog), []);
});

test("AUD27 rejects all known historical subject shifts", () => {
  const { manifest, backlog } = current();
  const fixtures = knownBadSemanticFixtures(manifest, backlog);
  assert.equal(fixtures.length, 5);
  assert.equal(fixtures.every((fixture) => fixture.rejected), true);
});

test("AUD27 rejects a title mutation even when the subject label is unchanged", () => {
  const { manifest, backlog } = current();
  const mutated: Backlog = {
    items: backlog.items.map((item) => item.id === "CVG-AUD26-022" ? { ...item, title: "browser matrix" } : item)
  };
  assert.ok(validateAud27Semantics(manifest, mutated).some((finding) => finding.code === "TASK_TITLE_MISMATCH"));
});

test("AUD27 rejects a coordinated manifest and backlog semantic mutation", () => {
  const { manifest, backlog } = current();
  const mutatedManifest = structuredClone(manifest);
  const mutatedBacklog = structuredClone(backlog);
  const manifestTask = mutatedManifest.aud26_task_catalog.find((task) => task.id === "CVG-AUD26-018");
  const backlogTask = mutatedBacklog.items.find((item) => item.id === "CVG-AUD26-018");
  assert.ok(manifestTask);
  assert.ok(backlogTask);
  manifestTask.semantic_subject = "known-bad-coordinated-mutant";
  backlogTask.semantic_subject = "known-bad-coordinated-mutant";
  assert.ok(validateAud27Semantics(mutatedManifest, mutatedBacklog).some((finding) => finding.code === "MANIFEST_CANONICAL_DIGEST"));
});
