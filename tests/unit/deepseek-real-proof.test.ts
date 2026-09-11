import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { DEEPSEEK_REAL_PROOF_STAGES, deepSeekRealProofAttestationPayload, deepSeekRealProofChainDigest, validateDeepSeekRealProofEvidence, type DeepSeekRealProofEvidence } from "@cvg/deepseek-bridge";

const proofKeys = generateKeyPairSync("ed25519");
const trustedPublicKey = proofKeys.publicKey.export({ format: "pem", type: "spki" }).toString();

function evidence(): DeepSeekRealProofEvidence {
  const stages = Object.fromEntries(DEEPSEEK_REAL_PROOF_STAGES.map((stage, index) => [stage, { status: "PASS" as const, observedAt: new Date().toISOString(), evidenceRef: `stages/${stage}.json`, evidenceDigest: index.toString(16).padStart(2, "0").repeat(32) }])) as DeepSeekRealProofEvidence["stages"];
  const unsigned: Omit<DeepSeekRealProofEvidence, "attestation"> = {
    schemaVersion: 1,
    sourceSha: "a".repeat(40),
    worktree: "CLEAN",
    engineCommit: "b".repeat(40),
    manifestDigest: `sha256:${"c".repeat(64)}`,
    producer: "deepseek-runner",
    reviewer: "independent-reviewer",
    independentReview: true,
    stages,
    chainDigest: deepSeekRealProofChainDigest(stages),
    limitations: ["controlled staging provider"],
    residualRisk: ["model behavior remains bounded by policy"]
  };
  const payload = deepSeekRealProofAttestationPayload(unsigned);
  return { ...unsigned, attestation: { signatureAlgorithm: "Ed25519", signatureDigest: createHash("sha256").update(payload).digest("hex"), signature: sign(null, payload, proofKeys.privateKey).toString("base64url") } };
}

test("DeepSeek real proof requires the complete positive and negative matrix", () => {
  const value = evidence();
  assert.equal(validateDeepSeekRealProofEvidence(value, value.sourceSha, Date.now(), trustedPublicKey).ok, true);
  const missingStages: Record<string, unknown> = { ...value.stages };
  delete missingStages["approval-replay"];
  const missing = { ...value, stages: missingStages };
  assert.equal(validateDeepSeekRealProofEvidence(missing, value.sourceSha, Date.now(), trustedPublicKey).ok, false);
});

test("DeepSeek real proof binds its chain digest and current timestamps", () => {
  const value = evidence();
  assert.equal(validateDeepSeekRealProofEvidence({ ...value, chainDigest: "d".repeat(64) }, value.sourceSha, Date.now(), trustedPublicKey).ok, false);
  const stale = { ...value, stages: { ...value.stages, turn: { ...value.stages.turn, observedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000).toISOString() } } };
  assert.equal(validateDeepSeekRealProofEvidence(stale, value.sourceSha, Date.now(), trustedPublicKey).ok, false);
});

test("DeepSeek real proof requires independent attribution and residual-risk text", () => {
  const value = evidence();
  assert.equal(validateDeepSeekRealProofEvidence({ ...value, reviewer: value.producer }, value.sourceSha, Date.now(), trustedPublicKey).ok, false);
  assert.equal(validateDeepSeekRealProofEvidence({ ...value, limitations: [] }, value.sourceSha, Date.now(), trustedPublicKey).ok, false);
  assert.equal(validateDeepSeekRealProofEvidence({ ...value, residualRisk: [] }, value.sourceSha, Date.now(), trustedPublicKey).ok, false);
  assert.equal(validateDeepSeekRealProofEvidence({ ...value, stages: { ...value.stages, turn: { ...value.stages.turn, evidenceRef: "../outside.json" } } }, value.sourceSha, Date.now(), trustedPublicKey).ok, false);
  assert.equal(validateDeepSeekRealProofEvidence(value, value.sourceSha, Date.now(), undefined).ok, false);
});
