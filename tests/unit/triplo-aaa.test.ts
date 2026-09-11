import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { PROMOTION_CRITIC_ROSTER, PROMOTION_GATE_EVIDENCE_KINDS, PROMOTION_GATE_PHASES, PROMOTION_MANDATORY_DIMENSION_KEYS, PROMOTION_MANDATORY_GATE_KEYS, PROMOTION_PHASE_IDS, PROMOTION_RED_TEAM_CRITERIA, PROMOTION_SCORECARD_DIMENSION_KEYS, PROMOTION_SCORECARD_THRESHOLDS, gateEvidenceReceiptPayload, humanApprovalReceiptPayload, independentReviewReceiptPayload, promotionGateCriteria, promotionGateEvidenceReceiptValid, promotionManifestGateInventoryValid, promotionPhaseCoverageValid, promotionScorecardBoundToSource, verifyGateEvidenceReceiptSignature, verifyHumanApprovalReceiptSignature, verifyIndependentReviewSignature, type PromotionEvidenceManifest, type PromotionGateEvidenceReceipt, type PromotionScorecardEntry } from "../../scripts/verify-triplo-aaa.ts";
import { qualityBarPhaseInventoryValid } from "../../scripts/prompt-integrity.ts";

function scorecardEntry(score: number | null = 96): PromotionScorecardEntry {
  return {
    score,
    evidence: ["local-verification"],
    sha: "a".repeat(40),
    test: ["npm test"],
    artifact: ["artifacts/operational-proof/local-verification-2026-09-10.json"],
    limitations: ["external gates remain unavailable"],
    residualRisk: ["promotion requires independent external evidence"]
  };
}

function candidate(overrides: Partial<PromotionEvidenceManifest> = {}): PromotionEvidenceManifest {
  return {
    schemaVersion: 1,
    stateOfTheArtStatus: "STATE_OF_THE_ART_CANDIDATE",
    status: "TRIPLE_AAA_CANDIDATE",
    sourceSha: "a".repeat(40),
    ciSha: "a".repeat(40),
    artifactSha: "a".repeat(40),
    artifactDigest: "b".repeat(64),
    artifactEvidencePath: "artifacts/operational-proof/external-aaa-bundle.json",
    worktree: "CLEAN",
    mandatoryGates: Object.fromEntries(PROMOTION_MANDATORY_GATE_KEYS.map((key) => [key, "VERIFIED"])) as PromotionEvidenceManifest["mandatoryGates"],
    qualityBar: {
      architecture: 97,
      security: 98,
      reliability: 98,
      mandatoryDimensions: Object.fromEntries(PROMOTION_MANDATORY_DIMENSION_KEYS.map((key) => [key, Math.max(98, PROMOTION_SCORECARD_THRESHOLDS[key] + 1)])),
      criticalBlockers: "ZERO",
      unresolvedHigh: "ZERO"
    },
    scorecard: {
      schemaVersion: 1,
      scale: "0-100",
      candidateThreshold: 95,
      requiredThresholds: PROMOTION_SCORECARD_THRESHOLDS,
      overallThreshold: 97,
      dimensions: Object.fromEntries(PROMOTION_SCORECARD_DIMENSION_KEYS.map((key) => [key, scorecardEntry(Math.max(98, PROMOTION_SCORECARD_THRESHOLDS[key] + 1))])) as PromotionEvidenceManifest["scorecard"]["dimensions"],
      overall: scorecardEntry(97)
    },
    ...overrides
  };
}

test("Triplo AAA manifest inventory accepts a complete candidate shape", () => {
  assert.equal(promotionManifestGateInventoryValid(candidate()), true);
});

test("Triplo AAA inventory requires explicit F31-F37 closure gates", () => {
  const complete = candidate();
  const phaseClosureGates = [
    "resourcePressure",
    "securityHeaders",
    "productionConfig",
    "stagingPromotion",
    "runbookExecution",
    "critics",
    "repairLoop"
  ] as const;

  for (const gate of phaseClosureGates) {
    const omitted = { ...complete, mandatoryGates: { ...complete.mandatoryGates, [gate]: undefined } };
    assert.equal(promotionManifestGateInventoryValid(omitted), false, `omitted gate: ${gate}`);
  }
});

test("active quality bar binds phase labels to the final operational prompt", () => {
  const bar = JSON.parse(readFileSync(".gauntlet/bar-v4.json", "utf8")) as Record<string, unknown>;
  assert.equal(qualityBarPhaseInventoryValid(bar), true);
  const source = bar.source as Record<string, unknown>;
  const stale = { ...bar, required_phases: [...(bar.required_phases as string[])] };
  (stale.required_phases as string[])[28] = "F28-api-versioning";
  assert.equal(qualityBarPhaseInventoryValid(stale), false);
  const policyDrift = { ...bar, scorecard: { ...(bar.scorecard as Record<string, unknown>), overall_threshold: 96 } };
  assert.equal(qualityBarPhaseInventoryValid(policyDrift), false);
  assert.equal(source.prompt, "docs/prompt-final-operational-proof-2026-09-10.txt");
});

test("promotion phase ownership follows the final prompt F28-F38 contract", () => {
  const owner = (phase: string): string => PROMOTION_MANDATORY_GATE_KEYS.find((gate) => PROMOTION_GATE_PHASES[gate].includes(phase))!;
  assert.deepEqual(Object.fromEntries(Array.from({ length: 11 }, (_, index) => {
    const phase = `F${index + 28}`;
    return [phase, owner(phase)];
  })), {
    F28: "ciSameSha",
    F29: "ciSameSha",
    F30: "containerSmoke",
    F31: "resourcePressure",
    F32: "securityHeaders",
    F33: "productionConfig",
    F34: "stagingPromotion",
    F35: "runbookExecution",
    F36: "critics",
    F37: "repairLoop",
    F38: "humanApproval"
  });
});

test("promotion phase ownership gives F12 to WebAuthn break-glass and F13 to staging", () => {
  const owner = (phase: string): string => PROMOTION_MANDATORY_GATE_KEYS.find((gate) => PROMOTION_GATE_PHASES[gate].includes(phase))!;
  assert.equal(owner("F12"), "webauthnBreakGlass");
  assert.equal(owner("F13"), "staging");
  assert.equal(owner("F14"), "observability");
  assert.equal(owner("F15"), "observability");
});

test("Triplo AAA manifest inventory rejects omitted gates, malformed digests and incomplete status", () => {
  const complete = candidate();
  const omitted = { ...complete, mandatoryGates: { ...complete.mandatoryGates, browserMatrix: undefined } };
  assert.equal(promotionManifestGateInventoryValid(omitted), false);
  assert.equal(promotionManifestGateInventoryValid({ ...complete, artifactDigest: "invalid" }), false);
  assert.equal(promotionManifestGateInventoryValid({ ...complete, status: "AAA_NOT_PROVEN" }), true);
  assert.equal(promotionManifestGateInventoryValid({ ...complete, mandatoryGates: { ...complete.mandatoryGates, provider: "PASS" } }), false);
  assert.equal(promotionManifestGateInventoryValid({ ...complete, qualityBar: { ...complete.qualityBar, reliability: null } }), false);
  assert.equal(promotionManifestGateInventoryValid({ ...complete, qualityBar: { ...complete.qualityBar, unresolvedHigh: "PRESENT" } }), false);
  assert.equal(promotionManifestGateInventoryValid({ ...complete, qualityBar: { ...complete.qualityBar, mandatoryDimensions: { ...complete.qualityBar.mandatoryDimensions, accessibility: undefined } } }), false);
  assert.equal(promotionManifestGateInventoryValid({ ...complete, qualityBar: { ...complete.qualityBar, mandatoryDimensions: { ...complete.qualityBar.mandatoryDimensions, performance: 94 } } }), false);
  assert.equal(promotionManifestGateInventoryValid({ ...complete, mandatoryGates: { ...complete.mandatoryGates, provider: "BLOCKED_EXTERNAL" } }), false);
  assert.equal(promotionManifestGateInventoryValid({ ...complete, mandatoryGates: { ...complete.mandatoryGates, extraGate: "VERIFIED" } }), false);
  assert.equal(promotionManifestGateInventoryValid({ ...complete, stateOfTheArtStatus: "STATE_OF_THE_ART_NOT_PROVEN" }), false);
  assert.equal(promotionManifestGateInventoryValid({ ...complete, status: "AAA_NOT_PROVEN", stateOfTheArtStatus: "STATE_OF_THE_ART_NOT_PROVEN" }), true);
});

test("Triplo AAA scorecard requires every prompt dimension and the overall record", () => {
  const complete = candidate();
  for (const key of PROMOTION_SCORECARD_DIMENSION_KEYS) {
    const dimensions = { ...complete.scorecard.dimensions };
    delete dimensions[key];
    assert.equal(promotionManifestGateInventoryValid({ ...complete, scorecard: { ...complete.scorecard, dimensions } }), false, `omitted scorecard dimension: ${key}`);
  }
  assert.equal(promotionManifestGateInventoryValid({ ...complete, scorecard: { ...complete.scorecard, scale: "0-5" as "0-100" } }), false);
  assert.equal(promotionManifestGateInventoryValid({ ...complete, scorecard: { ...complete.scorecard, overall: scorecardEntry(96) } }), false);
  assert.equal(promotionManifestGateInventoryValid({ ...complete, scorecard: { ...complete.scorecard, dimensions: { ...complete.scorecard.dimensions, extra: scorecardEntry() } } }), false);
  assert.equal(promotionManifestGateInventoryValid({ ...complete, scorecard: { ...complete.scorecard, dimensions: { ...complete.scorecard.dimensions, security: scorecardEntry(94) } } }), false);
  assert.equal(promotionManifestGateInventoryValid({ ...complete, scorecard: { ...complete.scorecard, dimensions: { ...complete.scorecard.dimensions, security: { ...scorecardEntry(), evidence: [] } } } }), false);
  assert.equal(promotionManifestGateInventoryValid({ ...complete, qualityBar: { ...complete.qualityBar, mandatoryDimensions: { ...complete.qualityBar.mandatoryDimensions, extra: 99 } } }), false);
});

test("Triplo AAA scorecard enforces the prompt's per-dimension thresholds", () => {
  const complete = candidate();
  assert.equal(promotionManifestGateInventoryValid({
    ...complete,
    scorecard: {
      ...complete.scorecard,
      dimensions: { ...complete.scorecard.dimensions, architecture: scorecardEntry(96) }
    }
  }), false);
  assert.equal(promotionManifestGateInventoryValid({
    ...complete,
    scorecard: {
      ...complete.scorecard,
      requiredThresholds: { ...complete.scorecard.requiredThresholds, workers: 95 }
    }
  }), false);
  assert.equal(promotionManifestGateInventoryValid({
    ...complete,
    qualityBar: {
      ...complete.qualityBar,
      mandatoryDimensions: { ...complete.qualityBar.mandatoryDimensions, reliability: 96 }
    }
  }), false);
  assert.equal(promotionManifestGateInventoryValid({
    ...complete,
    scorecard: {
      ...complete.scorecard,
      dimensions: { ...complete.scorecard.dimensions, security: { ...scorecardEntry(98), sha: "b".repeat(40) } }
    }
  }), false);
  assert.equal(promotionManifestGateInventoryValid({
    ...complete,
    scorecard: {
      ...complete.scorecard,
      overall: { ...scorecardEntry(98), sha: null }
    }
  }), false);
});

test("Triplo AAA candidate scorecard binding requires the exact source SHA", () => {
  const complete = candidate();
  assert.equal(promotionScorecardBoundToSource(complete.scorecard, complete.sourceSha), true);
  assert.equal(promotionScorecardBoundToSource({
    ...complete.scorecard,
    dimensions: { ...complete.scorecard.dimensions, security: { ...complete.scorecard.dimensions.security, sha: "b".repeat(40) } }
  }, complete.sourceSha), false);
  assert.equal(promotionScorecardBoundToSource({
    ...complete.scorecard,
    overall: { ...complete.scorecard.overall, sha: null }
  }, complete.sourceSha), false);
});

test("Triplo AAA phase coverage is exact and bound to the receipt digests", () => {
  const gateEvidenceDigests = Object.fromEntries(PROMOTION_MANDATORY_GATE_KEYS.map((gate, index) => [gate, `${index.toString(16).padStart(2, "0")}${"d".repeat(62)}`]));
  const phaseCoverage = Object.fromEntries(PROMOTION_PHASE_IDS.map((phase) => {
    const gate = PROMOTION_MANDATORY_GATE_KEYS.find((candidateGate) => PROMOTION_GATE_PHASES[candidateGate].includes(phase))!;
    return [phase, { gate, evidenceDigest: gateEvidenceDigests[gate] }];
  }));
  assert.equal(promotionPhaseCoverageValid(phaseCoverage, gateEvidenceDigests), true);
  const missing = { ...phaseCoverage };
  delete missing.F38;
  assert.equal(promotionPhaseCoverageValid(missing, gateEvidenceDigests), false);
  assert.equal(promotionPhaseCoverageValid({ ...phaseCoverage, F38: { gate: "critics", evidenceDigest: gateEvidenceDigests.critics } }, gateEvidenceDigests), false);
  assert.equal(promotionPhaseCoverageValid({ ...phaseCoverage, F38: { gate: "humanApproval", evidenceDigest: "e".repeat(64) } }, gateEvidenceDigests), false);
});

function receipt(gate: string, sourceSha = "a".repeat(40)): PromotionGateEvidenceReceipt {
  const result: PromotionGateEvidenceReceipt = {
    schemaVersion: 1,
    gate,
    status: "VERIFIED",
    subjectSha: sourceSha,
    artifactSha: "b".repeat(64),
    evidenceDigest: "c".repeat(64),
    procedure: `executed ${gate} procedure against the candidate`,
    procedureStatus: "EXECUTED",
    exitStatus: 0,
    environment: "staging-ci",
    observedAt: new Date().toISOString(),
    freshness: "CURRENT",
    evidenceKind: PROMOTION_GATE_EVIDENCE_KINDS[gate as keyof typeof PROMOTION_GATE_EVIDENCE_KINDS],
    producer: "runner-a",
    reviewer: "reviewer-b",
    independentReview: true,
    executionEvidence: {
      path: `external/${gate}-execution.json`,
      digest: "e".repeat(64),
      gate,
      sourceSha,
      artifactSha: "b".repeat(64),
      executionId: `execution-${gate}`,
      status: "PASS"
    },
    criterionIds: promotionGateCriteria(gate),
    ...(gate === "critics" ? {
      criticReports: PROMOTION_CRITIC_ROSTER.map((category) => ({
        category,
        verdict: "PASS_WITH_LIMITATIONS" as const,
        findings: [{ severity: "LOW" as const, id: `finding-${category}`, summary: "bounded audit finding recorded" }]
      }))
    } : {}),
    ...(gate === "critics" ? {
      redTeamEvidence: {
        security: { path: "external/red-team-security.json", digest: "f".repeat(64), phase: "F23" as const, criteria: [...PROMOTION_RED_TEAM_CRITERIA.security], status: "VERIFIED" as const },
        database: { path: "external/red-team-database.json", digest: "a".repeat(64), phase: "F24" as const, criteria: [...PROMOTION_RED_TEAM_CRITERIA.database], status: "VERIFIED" as const }
      }
    } : {}),
    ...(new Set(["stagingPromotion", "critics", "repairLoop", "humanApproval"]).has(gate) ? {
      independentReviewAttestation: { reviewerId: "reviewer-b", keyId: "reviewer-key", signatureDigest: "0".repeat(64), signatureAlgorithm: "Ed25519" as const, signature: "A".repeat(86) }
    } : {}),
    limitations: ["external authority scope is recorded separately"],
    residualRisk: ["residual risk accepted only by the release authority"],
    ...(gate === "deepseek" || gate === "provider" ? { specializedEvidencePath: `external/${gate}-proof.json`, specializedEvidenceDigest: "e".repeat(64) } : {}),
    attestation: {
      decision: gate === "humanApproval" ? "APPROVED" : "ATTESTED",
      authority: "evidence-authority",
      scope: `gate:${gate}`,
      signatureDigest: "d".repeat(64),
      signatureAlgorithm: "Ed25519",
      signature: "A".repeat(86),
      residualRiskAccepted: gate === "humanApproval"
    }
  };
  if (result.independentReviewAttestation) result.independentReviewAttestation.signatureDigest = createHash("sha256").update(independentReviewReceiptPayload(result)).digest("hex");
  result.attestation.signatureDigest = createHash("sha256").update(gateEvidenceReceiptPayload(result)).digest("hex");
  return result;
}

test("promotion receipts bind gate, source SHA, execution, freshness and attribution", () => {
  const sourceSha = "a".repeat(40);
  assert.equal(promotionGateEvidenceReceiptValid(receipt("critics", sourceSha), "critics", sourceSha), true);
  assert.equal(promotionGateEvidenceReceiptValid({ ...receipt("critics", sourceSha), attestation: undefined }, "critics", sourceSha), false);
  assert.equal(promotionGateEvidenceReceiptValid({ ...receipt("critics", sourceSha), subjectSha: "c".repeat(40) }, "critics", sourceSha), false);
  assert.equal(promotionGateEvidenceReceiptValid({ ...receipt("critics", sourceSha), gate: "provider" }, "critics", sourceSha), false);
  assert.equal(promotionGateEvidenceReceiptValid({ ...receipt("critics", sourceSha), exitStatus: 1 }, "critics", sourceSha), false);
  assert.equal(promotionGateEvidenceReceiptValid({ ...receipt("critics", sourceSha), observedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000).toISOString() }, "critics", sourceSha), false);
  assert.equal(promotionGateEvidenceReceiptValid({ ...receipt("critics", sourceSha), producer: "same", reviewer: "same" }, "critics", sourceSha), false);
  assert.equal(promotionGateEvidenceReceiptValid({ ...receipt("critics", sourceSha), artifactSha: "e".repeat(64) }, "critics", sourceSha, Date.now(), undefined, "b".repeat(64)), false);
  assert.equal(promotionGateEvidenceReceiptValid({ ...receipt("critics", sourceSha), evidenceKind: "independent-execution-receipt" }, "critics", sourceSha), false);
  assert.equal(promotionGateEvidenceReceiptValid({ ...receipt("critics", sourceSha), criterionIds: ["critics"] }, "critics", sourceSha), false);
  assert.equal(promotionGateEvidenceReceiptValid({ ...receipt("critics", sourceSha), criticReports: receipt("critics", sourceSha).criticReports?.slice(1) }, "critics", sourceSha), false);
  assert.equal(promotionGateEvidenceReceiptValid({ ...receipt("critics", sourceSha), criticReports: receipt("critics", sourceSha).criticReports?.map((report, index) => index === 0 ? { ...report, category: "unknown" } : report) }, "critics", sourceSha), false);
  assert.equal(promotionGateEvidenceReceiptValid({ ...receipt("critics", sourceSha), criticReports: receipt("critics", sourceSha).criticReports?.map((report, index) => index === 0 ? { ...report, verdict: "FAIL" as const } : report) }, "critics", sourceSha), false);
  assert.equal(promotionGateEvidenceReceiptValid({ ...receipt("critics", sourceSha), criticReports: receipt("critics", sourceSha).criticReports?.map((report, index) => index === 0 ? { ...report, findings: [{ severity: "CRITICAL" as const, id: "critical", summary: "blocking finding" }] } : report) }, "critics", sourceSha), false);
  assert.equal(promotionGateEvidenceReceiptValid({ ...receipt("critics", sourceSha), criticReports: receipt("critics", sourceSha).criticReports?.map((report, index) => index === 0 ? { ...report, findings: [{ severity: "HIGH" as const, id: "high", summary: "unrepaired high finding" }] } : report) }, "critics", sourceSha), false);
  assert.equal(promotionGateEvidenceReceiptValid({ ...receipt("critics", sourceSha), criterionIds: [...promotionGateCriteria("critics"), "critic:extra"] }, "critics", sourceSha), false);
  assert.equal(promotionGateEvidenceReceiptValid({ ...receipt("critics", sourceSha), criterionIds: [...promotionGateCriteria("critics"), promotionGateCriteria("critics")[0]] }, "critics", sourceSha), false);
  assert.equal(promotionGateEvidenceReceiptValid({ ...receipt("critics", sourceSha), redTeamEvidence: { ...receipt("critics", sourceSha).redTeamEvidence!, security: { ...receipt("critics", sourceSha).redTeamEvidence!.security, criteria: ["F23-01"] } } }, "critics", sourceSha), false);
  assert.equal(promotionGateEvidenceReceiptValid({ ...receipt("critics", sourceSha), redTeamEvidence: { ...receipt("critics", sourceSha).redTeamEvidence!, database: { ...receipt("critics", sourceSha).redTeamEvidence!.database, criteria: [...PROMOTION_RED_TEAM_CRITERIA.database, "F24-09"] } } }, "critics", sourceSha), false);
  assert.equal(promotionGateEvidenceReceiptValid({ ...receipt("critics", sourceSha), attestation: { ...receipt("critics", sourceSha).attestation, signatureDigest: "d".repeat(64) } }, "critics", sourceSha), false);
});

test("final gauntlet requires every prompt critic category", () => {
  assert.equal(PROMOTION_CRITIC_ROSTER.length, 15);
  assert.deepEqual(promotionGateCriteria("critics").filter((criterion) => criterion.startsWith("critic:")), PROMOTION_CRITIC_ROSTER.map((category) => `critic:${category}`));
});

test("independent review is a separately signed statement", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const value = receipt("critics");
  value.independentReviewAttestation!.signatureDigest = createHash("sha256").update(independentReviewReceiptPayload(value)).digest("hex");
  value.independentReviewAttestation!.signature = sign(null, independentReviewReceiptPayload(value), privateKey).toString("base64url");
  const trusted = publicKey.export({ type: "spki", format: "pem" }).toString();
  assert.equal(verifyIndependentReviewSignature(value, trusted), true);
  assert.equal(verifyIndependentReviewSignature({ ...value, reviewer: "tampered" }, trusted), false);
});

test("external gate receipts require an Ed25519 signature bound to the exact evidence digest", () => {
  const sourceSha = "a".repeat(40);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const valid = receipt("provider", sourceSha);
  valid.attestation.signatureDigest = createHash("sha256").update(gateEvidenceReceiptPayload(valid)).digest("hex");
  valid.attestation.signature = sign(null, gateEvidenceReceiptPayload(valid), privateKey).toString("base64url");
  const trustedPublicKey = publicKey.export({ type: "spki", format: "pem" }).toString();
  assert.equal(verifyGateEvidenceReceiptSignature(valid, sourceSha, valid.evidenceDigest, trustedPublicKey), true);
  assert.equal(verifyGateEvidenceReceiptSignature({ ...valid, evidenceDigest: "f".repeat(64) }, sourceSha, valid.evidenceDigest, trustedPublicKey), false);
  assert.equal(verifyGateEvidenceReceiptSignature({ ...valid, attestation: { ...valid.attestation, signature: "A".repeat(86) } }, sourceSha, valid.evidenceDigest, trustedPublicKey), false);
});

test("human approval receipt requires an explicit cryptographically verifiable attestation", () => {
  const sourceSha = "a".repeat(40);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const valid = { ...receipt("humanApproval", sourceSha), attestation: { decision: "APPROVED" as const, authority: "release-board", scope: "candidate promotion", signatureDigest: "c".repeat(64), signatureAlgorithm: "Ed25519" as const, signature: "A".repeat(86), residualRiskAccepted: true } };
  valid.attestation.signatureDigest = createHash("sha256").update(humanApprovalReceiptPayload(valid)).digest("hex");
  valid.attestation.signature = sign(null, humanApprovalReceiptPayload(valid), privateKey).toString("base64url");
  const trustedPublicKey = publicKey.export({ type: "spki", format: "pem" }).toString();
  assert.equal(promotionGateEvidenceReceiptValid(valid, "humanApproval", sourceSha), true);
  assert.equal(verifyHumanApprovalReceiptSignature(valid, sourceSha, trustedPublicKey), true);
  assert.equal(verifyHumanApprovalReceiptSignature({ ...valid, subjectSha: "b".repeat(40) }, sourceSha, trustedPublicKey), false);
  assert.equal(promotionGateEvidenceReceiptValid({ ...valid, attestation: { ...valid.attestation, residualRiskAccepted: false } }, "humanApproval", sourceSha), false);
  assert.equal(promotionGateEvidenceReceiptValid({ ...valid, attestation: undefined }, "humanApproval", sourceSha), false);
  assert.equal(promotionGateEvidenceReceiptValid({ ...valid, attestation: { ...valid.attestation, signature: "A".repeat(86) } }, "humanApproval", sourceSha), true);
  assert.equal(verifyHumanApprovalReceiptSignature({ ...valid, attestation: { ...valid.attestation, signature: "A".repeat(86) } }, sourceSha, trustedPublicKey), false);
});
