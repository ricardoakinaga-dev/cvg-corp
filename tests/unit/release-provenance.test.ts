import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ciResultsValid, verifySbomDigest } from "../../scripts/verify-release-provenance.ts";

test("release provenance binds the SBOM digest to regular file bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cvg-sbom-proof-"));
  const path = join(directory, "sbom.json");
  const original = Buffer.from('{"bomFormat":"CycloneDX","components":[]}', "utf8");
  const digest = `sha256:${createHash("sha256").update(original).digest("hex")}`;
  try {
    await writeFile(path, original, { mode: 0o600 });
    await verifySbomDigest(digest, path);
    await writeFile(path, Buffer.from('{"tampered":true}', "utf8"), { mode: 0o600 });
    await assert.rejects(() => verifySbomDigest(digest, path), /SBOM digest does not match/);
    const link = join(directory, "sbom-link.json");
    await symlink(path, link);
    await assert.rejects(() => verifySbomDigest(digest, link), /regular non-symlink file/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release provenance requires a current completed CI result bound to the source SHA", () => {
  const now = Date.now();
  const valid = { schemaVersion: 1, sourceSha: "a".repeat(40), workflow: "ci", runId: "123", completedStages: ["checks", "container-build"], observedAt: new Date(now - 1_000).toISOString() };
  assert.equal(ciResultsValid(valid, valid.sourceSha, now), true);
  assert.equal(ciResultsValid({ ...valid, sourceSha: "b".repeat(40) }, valid.sourceSha, now), false);
  assert.equal(ciResultsValid({ ...valid, completedStages: ["checks"] }, valid.sourceSha, now), false);
  assert.equal(ciResultsValid({ ...valid, observedAt: new Date(now - 8 * 24 * 60 * 60 * 1_000).toISOString() }, valid.sourceSha, now), false);
});
