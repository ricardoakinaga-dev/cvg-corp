import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { PROVIDER_REAL_PROOF_STAGES, providerRealProofAttestationPayload, providerRealProofChainDigest, validateProviderRealProofEvidence, type ProviderRealProofEvidence } from "@cvg/integrations";

const proofKeys = generateKeyPairSync("ed25519");
const trustedPublicKey = proofKeys.publicKey.export({ format: "pem", type: "spki" }).toString();

function evidence(sourceSha = "a".repeat(40)): ProviderRealProofEvidence {
  const stages = Object.fromEntries(PROVIDER_REAL_PROOF_STAGES.map((stage, index) => [stage, { status: "PASS" as const, observedAt: `2026-09-10T00:${String(index).padStart(2, "0")}:00.000Z`, evidenceRef: `stages/${stage}.json`, evidenceDigest: String(index + 1).padStart(64, "0") }])) as ProviderRealProofEvidence["stages"];
  const unsigned: Omit<ProviderRealProofEvidence, "attestation"> = { schemaVersion: 1, sourceSha, worktree: "CLEAN", transactionId: "proof-transaction-1", producer: "provider-runner", reviewer: "independent-reviewer", independentReview: true, stages, chainDigest: providerRealProofChainDigest(stages), limitations: ["controlled staging provider"], residualRisk: ["provider behavior remains externally bounded"] };
  const payload = providerRealProofAttestationPayload(unsigned);
  return { ...unsigned, attestation: { signatureAlgorithm: "Ed25519", signatureDigest: createHash("sha256").update(payload).digest("hex"), signature: sign(null, payload, proofKeys.privateKey).toString("base64url") } };
}

test("provider real proof requires every vertical stage and a matching chain digest", () => {
  const value = evidence();
  const result = validateProviderRealProofEvidence(value, value.sourceSha, Date.now(), trustedPublicKey);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.evidence.transactionId, "proof-transaction-1");
  const missing = { ...value, stages: { ...value.stages, callback: { ...value.stages.callback, status: "FAIL" as never } } };
  assert.equal(validateProviderRealProofEvidence(missing, value.sourceSha, Date.now(), trustedPublicKey).ok, false);
  assert.equal(validateProviderRealProofEvidence({ ...value, chainDigest: "f".repeat(64) }, value.sourceSha, Date.now(), trustedPublicKey).ok, false);
  assert.equal(validateProviderRealProofEvidence({ ...value, stages: { ...value.stages, callback: { ...value.stages.callback, evidenceRef: "../outside.json" } } }, value.sourceSha, Date.now(), trustedPublicKey).ok, false);
  assert.equal(validateProviderRealProofEvidence({ ...value, attestation: { ...value.attestation, signature: "A".repeat(86) } }, value.sourceSha, Date.now(), trustedPublicKey).ok, false);
});

test("provider real proof is bound to the expected clean source SHA", () => {
  const value = evidence();
  assert.equal(validateProviderRealProofEvidence({ ...value, worktree: "MODIFIED" }, value.sourceSha, Date.now(), trustedPublicKey).ok, false);
  assert.equal(validateProviderRealProofEvidence(value, "b".repeat(40), Date.now(), trustedPublicKey).ok, false);
  assert.equal(validateProviderRealProofEvidence(value, value.sourceSha, Date.now(), undefined).ok, false);
});
