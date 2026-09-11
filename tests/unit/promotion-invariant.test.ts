import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promotionApprovalPayload, promotionInvariantErrors, type Promotion } from "../../scripts/verify-promotion-invariant.ts";

test("promotion invariant binds referenced evidence bytes, authority, residual risk and timestamp order", async () => {
  const root = await mkdtemp(join(tmpdir(), "cvg-promotion-"));
  const provenancePath = join(root, "provenance.json");
  const sbomPath = join(root, "sbom.json");
  const ciResultsPath = join(root, "ci-results.json");
  const smokePath = join(root, "smoke.json");
  const sha = "a".repeat(40);
  const artifactDigest = `sha256:${"b".repeat(64)}`;
  const digest = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const stable = (value: unknown): string => {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  };
  const provenanceValue: Record<string, unknown> = {
    schemaVersion: 1,
    sourceSha: sha,
    ciSha: sha,
    buildTimestamp: new Date().toISOString(),
    sbomDigest: `sha256:${"1".repeat(64)}`,
    sbomPath: "sbom.json",
    ciResultsDigest: `sha256:${"7".repeat(64)}`,
    ciResultsPath: "ci-results.json",
    containers: { api: `sha256:${"2".repeat(64)}`, web: `sha256:${"3".repeat(64)}` },
    artifactDigest,
    migration: { version: "001_initial.sql", digest: `sha256:${"4".repeat(64)}` },
    policyRevision: `sha256:${"5".repeat(64)}`,
    toolRegistryDigest: `sha256:${"6".repeat(64)}`,
    deepseekExpectedEngineCommit: "c".repeat(40)
  };
  const sbom = Buffer.from('{"bomFormat":"CycloneDX","specVersion":"1.5","components":[]}\n');
  const ciResults = Buffer.from(JSON.stringify({ schemaVersion: 1, sourceSha: sha, workflow: "ci", runId: "run-1", completedStages: ["checks", "container-build"], observedAt: new Date().toISOString() }) + "\n");
  provenanceValue.sbomDigest = digest(sbom);
  provenanceValue.ciResultsDigest = digest(ciResults);
  provenanceValue.manifestDigest = `sha256:${createHash("sha256").update(stable(provenanceValue)).digest("hex")}`;
  const provenance = Buffer.from(`${JSON.stringify(provenanceValue)}\n`);
  const smoke = Buffer.from(JSON.stringify({ schemaVersion: 1, kind: "container-smoke", sourceSha: sha, artifactDigest, environment: "staging", observedAt: new Date().toISOString(), shutdownObserved: true, outboxDurable: true, replayIdempotent: true, scenarios: { transport: true, authenticated: true, databaseWrite: true, workerHeartbeat: true, providerEffect: true, restart: true }, receipt: { receiptId: "receipt-1", effectId: "effect-1", auditRecordId: "audit-1", outcome: "RECONCILED" } }) + "\n");
  await writeFile(sbomPath, sbom);
  await writeFile(ciResultsPath, ciResults);
  await writeFile(provenancePath, provenance);
  await writeFile(smokePath, smoke);
  const now = Date.now();
  const value: Promotion = {
    schemaVersion: 1,
    sourceSha: sha,
    artifactDigest,
    provenanceDigest: digest(provenance),
    provenanceEvidencePath: "provenance.json",
    staging: { artifactDigest, sourceSha: sha, smokeEvidenceDigest: digest(smoke), smokeEvidencePath: "smoke.json", verifiedAt: new Date(now - 2_000).toISOString() },
    approval: { status: "APPROVED", approvedBy: "release-board", approvedAt: new Date(now - 1_000).toISOString(), authority: "production-change-authority", scope: "candidate promotion", residualRiskAccepted: true, attestationDigest: `sha256:${"c".repeat(64)}`, signatureAlgorithm: "Ed25519", signature: "A".repeat(86) },
    productionCandidate: { artifactDigest, sourceSha: sha, createdAt: new Date(now).toISOString() }
  };
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  value.approval.attestationDigest = digest(promotionApprovalPayload(value));
  value.approval.signature = sign(null, promotionApprovalPayload(value), privateKey).toString("base64url");
  const trustedPublicKey = publicKey.export({ type: "spki", format: "pem" }).toString();
  assert.deepEqual(await promotionInvariantErrors(value, sha, root, now, trustedPublicKey), []);
  assert.ok((await promotionInvariantErrors(value, sha, root, now, null)).some((error) => error.includes("public key is unavailable")));
  const tampered = { ...value, provenanceDigest: `sha256:${"d".repeat(64)}` };
  assert.ok((await promotionInvariantErrors(tampered, sha, root, now, trustedPublicKey)).some((error) => error.includes("provenance evidence digest mismatch")));
  assert.ok((await promotionInvariantErrors({ ...value, approval: { ...value.approval, residualRiskAccepted: false } }, sha, root, now, trustedPublicKey)).some((error) => error.includes("residual risk")));
  assert.ok((await promotionInvariantErrors({ ...value, productionCandidate: { ...value.productionCandidate, createdAt: new Date(now - 10_000).toISOString() } }, sha, root, now, trustedPublicKey)).some((error) => error.includes("cannot predate approval")));
  const wrongKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
  assert.ok((await promotionInvariantErrors(value, sha, root, now, wrongKey)).some((error) => error.includes("signature verification failed")));
});
