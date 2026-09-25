import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AUD27_EVIDENCE_INTEGRITY_FILE, AUD27_EVIDENCE_MANIFEST_FILE, AUD27_EVIDENCE_READ_LIMITS, verifyAud27EvidenceRoot, type Aud27EvidenceArtifact, type Aud27EvidenceManifest, type Aud27EvidencePackage } from "../../scripts/verify-aud27-evidence-root.ts";

const sourceRoot = process.cwd();
const sourceSha = "a".repeat(40);
const subjectFingerprint = `sha256:${"b".repeat(64)}`;

function digest(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function digestZeros(size: number): string {
  const hash = createHash("sha256");
  const zeroBlock = Buffer.alloc(64 * 1024);
  for (let remaining = size; remaining > 0; remaining -= zeroBlock.length) {
    hash.update(zeroBlock.subarray(0, Math.min(remaining, zeroBlock.length)));
  }
  return "sha256:" + hash.digest("hex");
}

async function fixture(status: "LOCAL_SYNTHETIC_ONLY" | "EXTERNAL_AUTHORITY_VERIFIED" = "LOCAL_SYNTHETIC_ONLY") {
  const root = await mkdtemp(join(tmpdir(), "cvg-aud27-evidence-"));
  const artifactBytes = Buffer.from("local audit artifact\n");
  const artifact: Aud27EvidenceArtifact = { path: "artifact.txt", digest: digest(artifactBytes) };
  await writeFile(join(root, artifact.path), artifactBytes, { mode: 0o600 });
  const anchor = status === "EXTERNAL_AUTHORITY_VERIFIED"
    ? { status: "VERIFIED" as const, path: "anchor.json", digest: digest("anchor\n") }
    : { status: "NOT_PROVEN" as const };
  const authority = status === "EXTERNAL_AUTHORITY_VERIFIED"
    ? { status: "VERIFIED" as const, authorityId: "test-authority", attestationPath: "authority.json", attestationDigest: digest("authority\n") }
    : { status: "UNAVAILABLE" as const };
  if (status === "EXTERNAL_AUTHORITY_VERIFIED") {
    await writeFile(join(root, "anchor.json"), "anchor\n", { mode: 0o600 });
    await writeFile(join(root, "authority.json"), "authority\n", { mode: 0o600 });
    await writeFile(join(root, "recovery.json"), "recovery\n", { mode: 0o600 });
  }
  const recovery = status === "EXTERNAL_AUTHORITY_VERIFIED"
    ? { status: "VERIFIED" as const, runbook: "runbooks/aud27-evidence-recovery.md", restoreProcedure: "restore from the last external package", quarantineOnTamper: true as const, evidencePath: "recovery.json", evidenceDigest: digest("recovery\n") }
    : { status: "NOT_EXECUTED" as const, runbook: "runbooks/aud27-evidence-recovery.md", restoreProcedure: "restore from the last external package", quarantineOnTamper: true as const };
  const limitations = status === "LOCAL_SYNTHETIC_ONLY" ? ["synthetic fixture only"] : [];
  const manifest: Aud27EvidenceManifest = {
    schemaVersion: 1,
    kind: "cvg-aud27-evidence-root-manifest",
    packagePath: "package-payload.json",
    packageDigest: "",
    sourceSha,
    subjectFingerprint,
    status,
    artifacts: [artifact],
    anchor,
    authority,
    recovery,
    limitations
  };
  const payload: Aud27EvidencePackage = {
    schemaVersion: 1,
    kind: "cvg-aud27-evidence-package",
    status,
    sourceSha,
    subjectFingerprint,
    artifacts: [artifact],
    anchor,
    authority,
    recovery,
    limitations
  };
  const payloadBytes = Buffer.from(`${JSON.stringify(payload)}\n`);
  manifest.packageDigest = digest(payloadBytes);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  const integrity = {
    schemaVersion: 1,
    kind: "cvg-aud27-evidence-integrity" as const,
    manifestPath: AUD27_EVIDENCE_MANIFEST_FILE as typeof AUD27_EVIDENCE_MANIFEST_FILE,
    manifestDigest: digest(manifestBytes),
    packagePath: manifest.packagePath,
    packageDigest: manifest.packageDigest
  };
  await writeFile(join(root, AUD27_EVIDENCE_MANIFEST_FILE), manifestBytes, { mode: 0o600 });
  await writeFile(join(root, AUD27_EVIDENCE_INTEGRITY_FILE), `${JSON.stringify(integrity)}\n`, { mode: 0o600 });
  await writeFile(join(root, manifest.packagePath), payloadBytes, { mode: 0o600 });
  return { root, manifest, payload, payloadPath: join(root, manifest.packagePath) };
}

async function rewritePackage(value: Awaited<ReturnType<typeof fixture>>, trailingBytes = 0): Promise<void> {
  const packageBytes = Buffer.from(`${JSON.stringify(value.payload)}\n${" ".repeat(trailingBytes)}`);
  value.manifest.packageDigest = digest(packageBytes);
  await writeFile(value.payloadPath, packageBytes, { mode: 0o600 });
  const manifestBytes = Buffer.from(`${JSON.stringify(value.manifest)}\n`);
  await writeFile(join(value.root, AUD27_EVIDENCE_MANIFEST_FILE), manifestBytes, { mode: 0o600 });
  const integrityPath = join(value.root, AUD27_EVIDENCE_INTEGRITY_FILE);
  const integrity = JSON.parse(await readFile(integrityPath, "utf8")) as Record<string, unknown>;
  integrity.manifestDigest = digest(manifestBytes);
  integrity.packageDigest = value.manifest.packageDigest;
  await writeFile(integrityPath, `${JSON.stringify(integrity)}\n`, { mode: 0o600 });
}

async function cleanup(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

test("AUD27 evidence root accepts a structurally valid package but keeps synthetic evidence blocked", async () => {
  const value = await fixture();
  try {
    const result = await verifyAud27EvidenceRoot({ sourceRoot, evidenceRoot: value.root, expectedSourceSha: sourceSha, expectedSubjectFingerprint: subjectFingerprint });
    assert.equal(result.status, "BLOCKED");
    assert.deepEqual(result.errors, []);
    assert.ok(result.limitations.some((item) => item.includes("LOCAL_SYNTHETIC_ONLY")));
  } finally {
    await cleanup(value.root);
  }
});

test("AUD27 evidence root accepts the complete external package shape", async () => {
  const value = await fixture("EXTERNAL_AUTHORITY_VERIFIED");
  try {
    const result = await verifyAud27EvidenceRoot({ sourceRoot, evidenceRoot: value.root, expectedSourceSha: sourceSha, expectedSubjectFingerprint: subjectFingerprint });
    assert.equal(result.status, "PASS");
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.limitations, []);
  } finally {
    await cleanup(value.root);
  }
});

test("AUD27 evidence root rejects a tampered package payload", async () => {
  const value = await fixture();
  try {
    const original = await readFile(value.payloadPath, "utf8");
    await writeFile(value.payloadPath, original.replace("synthetic fixture only", "tampered fixture only"));
    const result = await verifyAud27EvidenceRoot({ sourceRoot, evidenceRoot: value.root, expectedSourceSha: sourceSha, expectedSubjectFingerprint: subjectFingerprint });
    assert.equal(result.status, "FAIL");
    assert.ok(result.errors.some((item) => item.includes("digest")));
  } finally {
    await cleanup(value.root);
  }
});

test("AUD27 evidence root rejects a package bound to another candidate", async () => {
  const value = await fixture();
  try {
    const result = await verifyAud27EvidenceRoot({ sourceRoot, evidenceRoot: value.root, expectedSourceSha: "c".repeat(40), expectedSubjectFingerprint: subjectFingerprint });
    assert.equal(result.status, "FAIL");
    assert.ok(result.errors.some((item) => item.includes("source SHA")));
  } finally {
    await cleanup(value.root);
  }
});

test("AUD27 evidence root requires an external directory and rejects missing packages", async () => {
  const result = await verifyAud27EvidenceRoot({ sourceRoot, evidenceRoot: sourceRoot, expectedSourceSha: sourceSha, expectedSubjectFingerprint: subjectFingerprint });
  assert.equal(result.status, "FAIL");
  assert.ok(result.errors.some((item) => item.includes("outside the source worktree")));

  const root = await mkdtemp(join(tmpdir(), "cvg-aud27-empty-"));
  try {
    const missing = await verifyAud27EvidenceRoot({ sourceRoot, evidenceRoot: root, expectedSourceSha: sourceSha, expectedSubjectFingerprint: subjectFingerprint });
    assert.equal(missing.status, "FAIL");
    assert.ok(missing.errors.some((item) => item.includes("package manifest")));
  } finally {
    await cleanup(root);
  }
});

test("AUD27 evidence root rejects a fully bound package payload above the bounded-read limit", async () => {
  const value = await fixture();
  try {
    await rewritePackage(value, AUD27_EVIDENCE_READ_LIMITS.packageBytes);
    const result = await verifyAud27EvidenceRoot({ sourceRoot, evidenceRoot: value.root, expectedSourceSha: sourceSha, expectedSubjectFingerprint: subjectFingerprint });
    assert.equal(result.status, "FAIL");
    assert.ok(result.errors.some((item) => item.includes("package") && item.toLowerCase().includes("limit")));
  } finally {
    await cleanup(value.root);
  }
});

test("AUD27 evidence root rejects a fully bound artifact above the per-file read limit", async () => {
  const value = await fixture();
  try {
    const artifactBytes = Buffer.alloc(AUD27_EVIDENCE_READ_LIMITS.artifactBytes + 1, 0x61);
    value.manifest.artifacts[0]!.digest = digest(artifactBytes);
    await writeFile(join(value.root, value.manifest.artifacts[0]!.path), artifactBytes, { mode: 0o600 });
    await rewritePackage(value);
    const result = await verifyAud27EvidenceRoot({ sourceRoot, evidenceRoot: value.root, expectedSourceSha: sourceSha, expectedSubjectFingerprint: subjectFingerprint });
    assert.equal(result.status, "FAIL");
    assert.ok(result.errors.some((item) => item.includes("artifact") && item.toLowerCase().includes("limit")));
  } finally {
    await cleanup(value.root);
  }
});

test("AUD27 evidence root rejects an oversized manifest before JSON parsing", async () => {
  const value = await fixture();
  try {
    await writeFile(join(value.root, AUD27_EVIDENCE_MANIFEST_FILE), Buffer.alloc(AUD27_EVIDENCE_READ_LIMITS.manifestBytes + 1, 0x20), { mode: 0o600 });
    const result = await verifyAud27EvidenceRoot({ sourceRoot, evidenceRoot: value.root, expectedSourceSha: sourceSha, expectedSubjectFingerprint: subjectFingerprint });
    assert.equal(result.status, "FAIL");
    assert.ok(result.errors.some((item) => item.includes("manifest") && item.toLowerCase().includes("limit")));
  } finally {
    await cleanup(value.root);
  }
});

test("AUD27 evidence root rejects packages with too many artifact paths before opening them", async () => {
  const value = await fixture();
  try {
    const artifacts = Array.from({ length: AUD27_EVIDENCE_READ_LIMITS.artifacts + 1 }, (_, index) => ({ path: "artifact-" + index + ".txt", digest: digest("fixture\n") }));
    value.manifest.artifacts = artifacts;
    value.payload.artifacts = artifacts;
    await rewritePackage(value);
    const result = await verifyAud27EvidenceRoot({ sourceRoot, evidenceRoot: value.root, expectedSourceSha: sourceSha, expectedSubjectFingerprint: subjectFingerprint });
    assert.equal(result.status, "FAIL");
    assert.ok(result.errors.some((item) => item.toLowerCase().includes("artifact count limit")));
  } finally {
    await cleanup(value.root);
  }
});

test("AUD27 evidence root fails closed on excessive structural nesting", async () => {
  const value = await fixture();
  try {
    let nested: Record<string, unknown> = { leaf: true };
    for (let depth = 0; depth < 40; depth += 1) nested = { child: nested };
    Object.assign(value.manifest.artifacts[0]!, { extension: nested });
    await rewritePackage(value);
    const result = await verifyAud27EvidenceRoot({ sourceRoot, evidenceRoot: value.root, expectedSourceSha: sourceSha, expectedSubjectFingerprint: subjectFingerprint });
    assert.equal(result.status, "FAIL");
    assert.ok(result.errors.some((item) => item.includes("diverge")));
  } finally {
    await cleanup(value.root);
  }
});

test("AUD27 evidence root bounds aggregate artifact reads across the package", async () => {
  const value = await fixture();
  try {
    const artifactSize = AUD27_EVIDENCE_READ_LIMITS.artifactBytes;
    const artifactDigest = digestZeros(artifactSize);
    const artifacts = Array.from({ length: 5 }, (_, index) => ({ path: "aggregate-" + index + ".bin", digest: artifactDigest }));
    value.manifest.artifacts = artifacts;
    value.payload.artifacts = artifacts;
    for (const artifact of artifacts) {
      const path = join(value.root, artifact.path);
      await writeFile(path, Buffer.alloc(0), { mode: 0o600 });
      await truncate(path, artifactSize);
    }
    await rewritePackage(value);
    const result = await verifyAud27EvidenceRoot({ sourceRoot, evidenceRoot: value.root, expectedSourceSha: sourceSha, expectedSubjectFingerprint: subjectFingerprint });
    assert.equal(result.status, "FAIL");
    assert.ok(result.errors.some((item) => item.includes("aggregate evidence read limit")));
  } finally {
    await cleanup(value.root);
  }
});

test("AUD27 evidence root rejects artifacts reached through an external symlinked directory", async () => {
  const value = await fixture();
  const outsideRoot = await mkdtemp(join(tmpdir(), "cvg-aud27-evidence-outside-"));
  try {
    const outsideBytes = Buffer.from("outside evidence\n");
    await writeFile(join(outsideRoot, "artifact.txt"), outsideBytes, { mode: 0o600 });
    await symlink(outsideRoot, join(value.root, "linked-evidence"), "dir");
    value.manifest.artifacts[0]!.path = "linked-evidence/artifact.txt";
    value.manifest.artifacts[0]!.digest = digest(outsideBytes);
    await rewritePackage(value);
    const result = await verifyAud27EvidenceRoot({ sourceRoot, evidenceRoot: value.root, expectedSourceSha: sourceSha, expectedSubjectFingerprint: subjectFingerprint });
    assert.equal(result.status, "FAIL");
    assert.ok(result.errors.some((item) => item.includes("beneath the evidence root")));
  } finally {
    await cleanup(value.root);
    await cleanup(outsideRoot);
  }
});
