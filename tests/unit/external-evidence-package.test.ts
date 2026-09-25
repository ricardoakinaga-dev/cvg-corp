import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertExternalOutput, buildExternalEvidencePackage, digestOf } from "../../scripts/external-evidence-package.ts";

test("external evidence package is digest-consistent and self-describing", () => {
  const root = process.cwd();
  const workspace = mkdtempSync(join(tmpdir(), "cvg-evidence-input-"));
  const output = join(workspace, "package");
  const anchor = join(workspace, "anchor-input.json");
  const recovery = join(workspace, "recovery-input.json");
  writeFileSync(anchor, `${JSON.stringify({ kind: "anchor", commands: ["npm test"] })}\n`);
  writeFileSync(recovery, `${JSON.stringify({ kind: "recovery", result: "drill" })}\n`);
  try {
    const result = buildExternalEvidencePackage({
      root,
      outputDirectory: output,
      authorityId: "release-authority-synthetic",
      anchorEvidencePath: anchor,
      recoveryEvidencePath: recovery
    });
    assert.equal(result.status, "EXTERNAL_AUTHORITY_VERIFIED");
    assert.match(result.subjectFingerprint, /^sha256:[a-f0-9]{64}$/);
    const payloadBytes = readFileSync(join(output, "package-payload.json"));
    const manifestBytes = readFileSync(join(output, "package-manifest.json"));
    const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
      packageDigest: string;
      artifacts: Array<{ path: string; digest: string }>;
      anchor: { digest: string };
      authority: { attestationDigest: string };
      recovery: { evidenceDigest: string };
    };
    const integrity = JSON.parse(readFileSync(join(output, "package-integrity.json"), "utf8")) as {
      manifestDigest: string;
      packageDigest: string;
    };
    assert.equal(manifest.packageDigest, digestOf(payloadBytes));
    assert.equal(integrity.manifestDigest, digestOf(manifestBytes));
    assert.equal(integrity.packageDigest, manifest.packageDigest);
    for (const artifact of manifest.artifacts) {
      assert.equal(digestOf(readFileSync(join(output, artifact.path))), artifact.digest);
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("external evidence output is rejected inside the candidate checkout", () => {
  const root = process.cwd();
  assert.throws(() => assertExternalOutput(root, join(root, "artifacts", "external-evidence")), /outside the candidate/);
  assert.equal(assertExternalOutput(root, join(tmpdir(), "cvg-external-evidence-synthetic")), join(tmpdir(), "cvg-external-evidence-synthetic"));
});
