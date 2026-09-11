import { lstat, readFile, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { requireExternalEvidenceRoot } from "./evidence-boundary.ts";
import { DEEPSEEK_REAL_PROOF_STAGES, isDeepSeekProofEvidenceRef, validateDeepSeekRealProofEvidence } from "@cvg/deepseek-bridge";
import { PROVIDER_REAL_PROOF_STAGES, isProviderProofEvidenceRef, validateProviderRealProofEvidence } from "@cvg/integrations";

type GateStatus = "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED";
type EvidenceClass = "LOCAL_EXECUTION_ONLY" | "SYNTHETIC_ONLY" | "PROMOTION_EVIDENCE" | "NOT_EXECUTED" | "NETWORK_BLOCKED";

type GateResult = {
  gate: string;
  status: GateStatus;
  evidence: EvidenceClass;
  detail?: string;
};

type PackageManifest = {
  scripts?: Record<string, string>;
};

export type PromotionEvidenceManifest = {
  schemaVersion: 1;
  stateOfTheArtStatus: "STATE_OF_THE_ART_CANDIDATE" | "STATE_OF_THE_ART_NOT_PROVEN";
  status: "TRIPLE_AAA_CANDIDATE" | "AAA_NOT_PROVEN";
  sourceSha: string;
  ciSha: string | null;
  artifactSha: string | null;
  artifactDigest: string | null;
  artifactEvidencePath?: string | null;
  worktree: "CLEAN" | "MODIFIED";
  mandatoryGates: Record<string, "VERIFIED" | "BLOCKED_EXTERNAL" | "NOT_RUN" | "FAIL">;
  qualityBar: {
    architecture: number | null;
    security: number | null;
    reliability: number | null;
    mandatoryDimensions: Record<string, number | null>;
    criticalBlockers: "ZERO" | "PRESENT" | "UNKNOWN";
    unresolvedHigh: "ZERO" | "PRESENT" | "UNKNOWN";
  };
  scorecard: PromotionScorecard;
};

export const PROMOTION_SCORECARD_DIMENSION_KEYS = [
  "architecture",
  "domainIntegrity",
  "security",
  "authentication",
  "authorization",
  "pdp",
  "toolGateway",
  "database",
  "reliability",
  "workers",
  "deepseek",
  "aiGovernance",
  "providerIntegration",
  "frontend",
  "accessibility",
  "testing",
  "observability",
  "performance",
  "recovery",
  "devOps",
  "supplyChain",
  "productionReadiness"
] as const;

/**
 * The prompt has a stronger target than the generic 95-point candidate floor
 * for several dimensions. Keep those thresholds machine-readable so a bundle
 * cannot satisfy the scorecard with a single uniform number while claiming to
 * meet the stated objective.
 */
export const PROMOTION_SCORECARD_THRESHOLDS = {
  architecture: 97,
  domainIntegrity: 97,
  security: 97,
  authentication: 97,
  authorization: 97,
  pdp: 97,
  toolGateway: 97,
  database: 97,
  reliability: 97,
  workers: 96,
  deepseek: 95,
  aiGovernance: 97,
  providerIntegration: 95,
  frontend: 95,
  accessibility: 95,
  testing: 97,
  observability: 95,
  performance: 95,
  recovery: 97,
  devOps: 96,
  supplyChain: 95,
  productionReadiness: 95
} as const satisfies Record<(typeof PROMOTION_SCORECARD_DIMENSION_KEYS)[number], number>;

export type PromotionScorecardEntry = {
  score: number | null;
  evidence: string[];
  sha: string | null;
  test: string[];
  artifact: string[];
  limitations: string[];
  residualRisk: string[];
};

export type PromotionScorecard = {
  schemaVersion: 1;
  scale: "0-100";
  candidateThreshold: 95;
  requiredThresholds: typeof PROMOTION_SCORECARD_THRESHOLDS;
  overallThreshold: 97;
  dimensions: Record<(typeof PROMOTION_SCORECARD_DIMENSION_KEYS)[number], PromotionScorecardEntry>;
  overall: PromotionScorecardEntry;
};

type ExternalEvidenceBundle = {
  schemaVersion: 1;
  sourceSha: string;
  stateOfTheArtStatus: PromotionEvidenceManifest["stateOfTheArtStatus"];
  qualityBar: PromotionEvidenceManifest["qualityBar"];
  scorecard: PromotionScorecard;
  gates: Record<string, { status: "VERIFIED"; evidencePath: string; evidenceDigest: string }>;
  phaseCoverage: Record<string, { gate: string; evidenceDigest: string }>;
};

export type PromotionGateEvidenceReceipt = {
  schemaVersion: 1;
  gate: string;
  status: "VERIFIED";
  subjectSha: string;
  artifactSha: string;
  evidenceDigest: string;
  procedure: string;
  procedureStatus: "EXECUTED";
  exitStatus: 0;
  environment: string;
  observedAt: string;
  freshness: "CURRENT";
  evidenceKind: string;
  producer: string;
  reviewer: string;
  independentReview: boolean;
  executionEvidence: {
    path: string;
    digest: string;
    gate: string;
    sourceSha: string;
    artifactSha: string;
    executionId: string;
    status: "PASS";
  };
  independentReviewAttestation?: {
    reviewerId: string;
    keyId: string;
    signatureDigest: string;
    signatureAlgorithm: "Ed25519";
    signature: string;
  };
  redTeamEvidence?: {
    security: { path: string; digest: string; phase: "F23"; criteria: string[]; status: "VERIFIED" };
    database: { path: string; digest: string; phase: "F24"; criteria: string[]; status: "VERIFIED" };
  };
  criterionIds: string[];
  criticReports?: Array<{
    category: string;
    verdict: "PASS" | "PASS_WITH_LIMITATIONS" | "FAIL";
    findings: Array<{
      severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
      id: string;
      summary: string;
    }>;
  }>;
  limitations: string[];
  residualRisk: string[];
  specializedEvidencePath?: string;
  specializedEvidenceDigest?: string;
  attestation: {
    decision: "ATTESTED" | "APPROVED";
    authority: string;
    scope: string;
    signatureDigest: string;
    signatureAlgorithm: "Ed25519";
    signature: string;
    residualRiskAccepted: boolean;
  };
};

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const gateTimeoutMs = 180_000;
const results: GateResult[] = [];

/**
 * Keep one explicit promotion key for every operational phase that can be
 * claimed by a release bundle.  The broader gates (staging/recovery/etc.) do
 * not subsume the bounded proofs below: otherwise a bundle could claim AAA
 * while omitting pressure, edge-header/config, runbook, or repair-loop
 * evidence entirely.
 */
export const PROMOTION_MANDATORY_GATE_KEYS = [
  "universalPdp",
  "authoritativeWrites",
  "deepseek",
  "provider",
  "secretAuthority",
  "postgresConcurrency",
  "webauthnBreakGlass",
  "staging",
  "observability",
  "browserMatrix",
  "load",
  "chaos",
  "recovery",
  "restore",
  "rtoRpo",
  "ciSameSha",
  "resourcePressure",
  "securityHeaders",
  "productionConfig",
  "containerSmoke",
  "stagingPromotion",
  "runbookExecution",
  "critics",
  "repairLoop",
  "humanApproval"
] as const;
export const PROMOTION_MANDATORY_DIMENSION_KEYS = PROMOTION_SCORECARD_DIMENSION_KEYS;

/**
 * Every F0–F38 requirement from the preserved prompt must be attributed to a
 * concrete promotion receipt. A generic signed label cannot silently stand in
 * for an uncovered phase. The phase IDs are intentionally stable and are
 * carried by both the receipt criterionIds and the external bundle coverage.
 */
export const PROMOTION_PHASE_IDS = Array.from({ length: 39 }, (_, index) => `F${index}`) as string[];
/** The final gauntlet roster is part of the promotion contract, not prose. */
export const PROMOTION_CRITIC_ROSTER = [
  "architecture",
  "security",
  "authorization",
  "database",
  "reliability",
  "AI safety",
  "DeepSeek",
  "provider",
  "worker",
  "observability",
  "frontend",
  "accessibility",
  "recovery",
  "DevOps",
  "production readiness"
] as const;
/** F23/F24 are separate promotion evidence artifacts, and each artifact must
 * account for the complete criterion roster from the preserved prompt. */
export const PROMOTION_RED_TEAM_CRITERIA = {
  security: Array.from({ length: 16 }, (_, index) => `F23-${String(index + 1).padStart(2, "0")}`),
  database: Array.from({ length: 8 }, (_, index) => `F24-${String(index + 1).padStart(2, "0")}`)
} as const;
export const PROMOTION_GATE_PHASES: Record<(typeof PROMOTION_MANDATORY_GATE_KEYS)[number], readonly string[]> = {
  // These phase owners follow the active final operational prompt (F0–F38),
  // whose numbering differs from the earlier v2 prompt copy. Keep every
  // phase attached to the narrowest receipt that can actually prove it.
  universalPdp: ["F1", "F27"],
  authoritativeWrites: ["F2", "F25"],
  deepseek: ["F3", "F4"],
  provider: ["F5", "F6", "F26"],
  secretAuthority: ["F11"],
  postgresConcurrency: ["F7", "F8"],
  webauthnBreakGlass: ["F12"],
  staging: ["F13"],
  observability: ["F14", "F15"],
  browserMatrix: ["F21", "F22"],
  load: ["F16"],
  chaos: ["F17"],
  recovery: ["F18"],
  restore: ["F20"],
  rtoRpo: ["F19"],
  ciSameSha: ["F28", "F29"],
  resourcePressure: ["F9", "F10", "F31"],
  securityHeaders: ["F32"],
  productionConfig: ["F33"],
  containerSmoke: ["F30"],
  stagingPromotion: ["F34"],
  runbookExecution: ["F35"],
  critics: ["F0", "F23", "F24", "F36"],
  repairLoop: ["F37"],
  humanApproval: ["F38"]
};

export const PROMOTION_GATE_EVIDENCE_KINDS: Record<(typeof PROMOTION_MANDATORY_GATE_KEYS)[number], string> = Object.fromEntries(
  PROMOTION_MANDATORY_GATE_KEYS.map((gate) => [gate, `PROMOTION_${gate.toUpperCase()}_ATTESTATION`])
) as Record<(typeof PROMOTION_MANDATORY_GATE_KEYS)[number], string>;
PROMOTION_GATE_EVIDENCE_KINDS.deepseek = "DEEPSEEK_REAL_VERTICAL_ATTESTATION";
PROMOTION_GATE_EVIDENCE_KINDS.provider = "PROVIDER_REAL_VERTICAL_ATTESTATION";
PROMOTION_GATE_EVIDENCE_KINDS.postgresConcurrency = "POSTGRES_CONCURRENCY_ATTESTATION";
PROMOTION_GATE_EVIDENCE_KINDS.ciSameSha = "RELEASE_PROVENANCE_ATTESTATION";
PROMOTION_GATE_EVIDENCE_KINDS.stagingPromotion = "PROMOTION_INVARIANT_ATTESTATION";
PROMOTION_GATE_EVIDENCE_KINDS.containerSmoke = "CONTAINER_SMOKE_ATTESTATION";

const phaseOwners = new Map<string, string>();
for (const [gate, phases] of Object.entries(PROMOTION_GATE_PHASES)) {
  for (const phase of phases) if (!PROMOTION_PHASE_IDS.includes(phase)) throw new Error(`unknown promotion phase ${phase}`);
  for (const phase of phases) phaseOwners.set(phase, phaseOwners.get(phase) ?? gate);
}
if (phaseOwners.size !== PROMOTION_PHASE_IDS.length) throw new Error("promotion phase coverage does not account for every F0-F38 requirement");

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string" && entry.trim().length > 0);
}

export function promotionScorecardEntryValid(value: unknown): value is PromotionScorecardEntry {
  if (!isRecord(value)) return false;
  const score = value.score;
  const sha = value.sha;
  return (score === null || (typeof score === "number" && Number.isInteger(score) && score >= 0 && score <= 100))
    && (sha === null || (typeof sha === "string" && /^[a-f0-9]{40}$/.test(sha)))
    && stringArray(value.evidence)
    && stringArray(value.test)
    && stringArray(value.artifact)
    && stringArray(value.limitations)
    && stringArray(value.residualRisk);
}

export function promotionScorecardValid(value: unknown): value is PromotionScorecard {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.scale !== "0-100" || value.candidateThreshold !== 95 || !scorecardThresholdsValid(value.requiredThresholds) || value.overallThreshold !== 97 || !isRecord(value.dimensions) || !promotionScorecardEntryValid(value.overall)) return false;
  const dimensions = value.dimensions;
  return Object.keys(dimensions).length === PROMOTION_SCORECARD_DIMENSION_KEYS.length && PROMOTION_SCORECARD_DIMENSION_KEYS.every((key) => promotionScorecardEntryValid(dimensions[key]));
}

/**
 * A candidate scorecard is part of the release claim, so every non-null
 * score must be tied to the exact candidate source SHA.  The not-proven local
 * record may deliberately leave scores and SHAs null; a candidate may not.
 */
export function promotionScorecardBoundToSource(scorecard: PromotionScorecard, sourceSha: string): boolean {
  const entries = [...PROMOTION_SCORECARD_DIMENSION_KEYS.map((key) => scorecard.dimensions[key]), scorecard.overall];
  return entries.every((entry) => entry.score !== null && entry.sha === sourceSha);
}

function scorecardThresholdsValid(value: unknown): value is typeof PROMOTION_SCORECARD_THRESHOLDS {
  if (!isRecord(value)) return false;
  const keys = Object.keys(PROMOTION_SCORECARD_THRESHOLDS);
  return Object.keys(value).length === keys.length && keys.every((key) => value[key] === PROMOTION_SCORECARD_THRESHOLDS[key as keyof typeof PROMOTION_SCORECARD_THRESHOLDS]);
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };

function stable(value: CanonicalValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key]!)}`).join(",")}}`;
}

function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Human approval signs the exact current receipt, excluding only the
 * attestation's digest and signature fields. The source SHA and all execution
 * evidence remain inside the signed payload, so a detached approval cannot be
 * replayed for another candidate or gate.
 */
export function humanApprovalReceiptPayload(receipt: PromotionGateEvidenceReceipt): Buffer {
  const unsigned = {
    ...receipt,
    attestation: receipt.attestation ? {
      decision: receipt.attestation.decision,
      authority: receipt.attestation.authority,
      scope: receipt.attestation.scope,
      residualRiskAccepted: receipt.attestation.residualRiskAccepted
    } : undefined
  };
  return Buffer.from(stable(unsigned as unknown as CanonicalValue), "utf8");
}

/** Every external gate receipt is signed by the configured evidence authority. */
export function gateEvidenceReceiptPayload(receipt: PromotionGateEvidenceReceipt): Buffer {
  const unsigned = {
    ...receipt,
    attestation: {
      decision: receipt.attestation.decision,
      authority: receipt.attestation.authority,
      scope: receipt.attestation.scope,
      residualRiskAccepted: receipt.attestation.residualRiskAccepted
    }
  };
  return Buffer.from(stable(unsigned as unknown as CanonicalValue), "utf8");
}

/** Independent review is a separate cryptographic statement, not a boolean
 * asserted by the producer.  The reviewer signs the complete receipt body
 * while excluding only this detached reviewer signature. */
export function independentReviewReceiptPayload(receipt: PromotionGateEvidenceReceipt): Buffer {
  const unsigned = {
    ...receipt,
    independentReviewAttestation: receipt.independentReviewAttestation ? {
      reviewerId: receipt.independentReviewAttestation.reviewerId,
      keyId: receipt.independentReviewAttestation.keyId,
      signatureAlgorithm: receipt.independentReviewAttestation.signatureAlgorithm
    } : undefined,
    attestation: receipt.attestation ? {
      decision: receipt.attestation.decision,
      authority: receipt.attestation.authority,
      scope: receipt.attestation.scope,
      residualRiskAccepted: receipt.attestation.residualRiskAccepted
    } : undefined
  };
  return Buffer.from(stable(unsigned as unknown as CanonicalValue), "utf8");
}

export function verifyGateEvidenceReceiptSignature(receipt: PromotionGateEvidenceReceipt, sourceSha: string, expectedEvidenceDigest: string, trustedPublicKey: string): boolean {
  if (receipt.subjectSha !== sourceSha || receipt.evidenceDigest !== expectedEvidenceDigest || !receipt.attestation || !/^[a-f0-9]{64}$/.test(receipt.attestation.signatureDigest) || receipt.attestation.signatureAlgorithm !== "Ed25519" || !/^[A-Za-z0-9_-]{86}$/.test(receipt.attestation.signature)) return false;
  if (receipt.attestation.signatureDigest !== sha256Hex(gateEvidenceReceiptPayload(receipt))) return false;
  try {
    const key = createPublicKey(trustedPublicKey);
    if (key.asymmetricKeyType !== "ed25519") return false;
    const signature = Buffer.from(receipt.attestation.signature, "base64url");
    return signature.length === 64 && verifySignature(null, gateEvidenceReceiptPayload(receipt), key, signature);
  } catch {
    return false;
  }
}

export function verifyHumanApprovalReceiptSignature(receipt: PromotionGateEvidenceReceipt, sourceSha: string, trustedApprovalPublicKey: string): boolean {
  if (receipt.gate !== "humanApproval" || !receipt.attestation || receipt.attestation.decision !== "APPROVED" || receipt.attestation.signatureDigest !== sha256Hex(humanApprovalReceiptPayload(receipt))) return false;
  return verifyGateEvidenceReceiptSignature(receipt, sourceSha, receipt.evidenceDigest, trustedApprovalPublicKey);
}

export function verifyIndependentReviewSignature(receipt: PromotionGateEvidenceReceipt, trustedPublicKey: string): boolean {
  const review = receipt.independentReviewAttestation;
  if (!review || review.reviewerId !== receipt.reviewer || !review.reviewerId.trim() || !review.keyId.trim() || review.signatureAlgorithm !== "Ed25519" || !/^[a-f0-9]{64}$/.test(review.signatureDigest) || !/^[A-Za-z0-9_-]{86}$/.test(review.signature)) return false;
  if (review.signatureDigest !== sha256Hex(independentReviewReceiptPayload(receipt))) return false;
  try {
    const key = createPublicKey(trustedPublicKey);
    if (key.asymmetricKeyType !== "ed25519") return false;
    const signature = Buffer.from(review.signature, "base64url");
    return signature.length === 64 && verifySignature(null, independentReviewReceiptPayload(receipt), key, signature);
  } catch { return false; }
}

function isoTimestampCurrent(value: unknown, now = Date.now()): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const maxAgeMs = 7 * 24 * 60 * 60 * 1_000;
  return parsed <= now + 5 * 60 * 1_000 && parsed >= now - maxAgeMs;
}

const independentlyReviewedGates = new Set(["stagingPromotion", "critics", "repairLoop", "humanApproval"]);

export function promotionGateCriteria(gate: string): string[] {
  const phases = PROMOTION_GATE_PHASES[gate as keyof typeof PROMOTION_GATE_PHASES] ?? [];
  const stageCriteria = gate === "deepseek"
    ? [...DEEPSEEK_REAL_PROOF_STAGES]
    : gate === "provider"
      ? [...PROVIDER_REAL_PROOF_STAGES]
      : [];
  const criticCriteria = gate === "critics" ? PROMOTION_CRITIC_ROSTER.map((category) => `critic:${category}`) : [];
  return [gate, ...phases, ...stageCriteria, ...criticCriteria];
}

function criticReportsValid(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== PROMOTION_CRITIC_ROSTER.length) return false;
  const categories = new Set<string>();
  for (const report of value) {
    if (!isRecord(report) || typeof report.category !== "string" || !PROMOTION_CRITIC_ROSTER.includes(report.category as (typeof PROMOTION_CRITIC_ROSTER)[number]) || categories.has(report.category)) return false;
    categories.add(report.category);
    if (!["PASS", "PASS_WITH_LIMITATIONS"].includes(report.verdict as string) || !Array.isArray(report.findings)) return false;
    for (const finding of report.findings) {
      if (!isRecord(finding) || !["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(finding.severity as string) || typeof finding.id !== "string" || finding.id.trim().length < 2 || typeof finding.summary !== "string" || finding.summary.trim().length < 4) return false;
      // A final critics receipt may not carry an unresolved blocker.  F37
      // requires every CRITICAL or HIGH finding to go through the repair
      // loop, focused test, full regression and critic rerun before the
      // receipt can be admitted for promotion.
      if (finding.severity === "CRITICAL" || finding.severity === "HIGH") return false;
    }
  }
  return PROMOTION_CRITIC_ROSTER.every((category) => categories.has(category));
}

function exactCriterionRoster(value: unknown, expected: readonly string[]): value is string[] {
  return Array.isArray(value)
    && value.length === expected.length
    && new Set(value).size === value.length
    && expected.every((criterion) => value.includes(criterion));
}

export function promotionPhaseCoverageValid(value: unknown, gateEvidenceDigests: Record<string, string>): value is Record<string, { gate: string; evidenceDigest: string }> {
  if (!isRecord(value) || Object.keys(value).length !== PROMOTION_PHASE_IDS.length) return false;
  return PROMOTION_PHASE_IDS.every((phase) => {
    const entry = value[phase];
    if (!isRecord(entry) || typeof entry.gate !== "string" || !PROMOTION_MANDATORY_GATE_KEYS.includes(entry.gate as (typeof PROMOTION_MANDATORY_GATE_KEYS)[number]) || typeof entry.evidenceDigest !== "string" || !/^[a-f0-9]{64}$/.test(entry.evidenceDigest)) return false;
    return entry.gate === phaseOwners.get(phase) && gateEvidenceDigests[entry.gate] === entry.evidenceDigest;
  });
}

export function promotionGateEvidenceReceiptValid(value: unknown, gate: string, sourceSha: string, now = Date.now(), expectedEvidenceDigest?: string, expectedArtifactDigest?: string): value is PromotionGateEvidenceReceipt {
  if (!isRecord(value)) return false;
  const requiresSpecializedEvidence = gate === "deepseek" || gate === "provider";
  const executionEvidence = value.executionEvidence;
  if (value.schemaVersion !== 1 || value.gate !== gate || value.status !== "VERIFIED" || value.subjectSha !== sourceSha || !/^[a-f0-9]{40}$/.test(value.subjectSha as string) || !sha256(value.artifactSha) || !sha256(value.evidenceDigest) || (expectedEvidenceDigest !== undefined && value.evidenceDigest !== expectedEvidenceDigest) || (expectedArtifactDigest !== undefined && value.artifactSha !== expectedArtifactDigest) || typeof value.procedure !== "string" || value.procedure.trim().length < 8 || value.procedureStatus !== "EXECUTED" || value.exitStatus !== 0 || typeof value.environment !== "string" || value.environment.trim().length < 2 || !isoTimestampCurrent(value.observedAt, now) || value.freshness !== "CURRENT" || value.evidenceKind !== PROMOTION_GATE_EVIDENCE_KINDS[gate as keyof typeof PROMOTION_GATE_EVIDENCE_KINDS] || typeof value.producer !== "string" || value.producer.trim().length < 2 || typeof value.reviewer !== "string" || value.reviewer.trim().length < 2 || typeof value.independentReview !== "boolean" || !stringArray(value.criterionIds) || !stringArray(value.limitations) || !stringArray(value.residualRisk) || !isRecord(executionEvidence) || typeof executionEvidence.path !== "string" || executionEvidence.path.trim().length < 2 || !sha256(executionEvidence.digest) || executionEvidence.gate !== gate || executionEvidence.sourceSha !== sourceSha || executionEvidence.artifactSha !== value.artifactSha || typeof executionEvidence.executionId !== "string" || executionEvidence.executionId.trim().length < 4 || executionEvidence.status !== "PASS" || (requiresSpecializedEvidence && (typeof value.specializedEvidencePath !== "string" || typeof value.specializedEvidenceDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.specializedEvidenceDigest)))) return false;
  const criterionIds = value.criterionIds;
  const requiredCriteria = promotionGateCriteria(gate);
  if (criterionIds.length !== requiredCriteria.length || new Set(criterionIds).size !== criterionIds.length || !requiredCriteria.every((criterion) => criterionIds.includes(criterion))) return false;
  if (gate === "critics" && !criticReportsValid(value.criticReports)) return false;
  if (gate === "critics") {
    const redTeam = value.redTeamEvidence;
    if (!isRecord(redTeam) || !isRecord(redTeam.security) || !isRecord(redTeam.database)) return false;
    for (const [key, phase] of [["security", "F23"], ["database", "F24"]] as const) {
      const item = redTeam[key] as Record<string, unknown>;
      if (item.path === undefined || typeof item.path !== "string" || item.path.trim().length < 2 || !sha256(item.digest) || item.phase !== phase || item.status !== "VERIFIED" || !exactCriterionRoster(item.criteria, PROMOTION_RED_TEAM_CRITERIA[key])) return false;
    }
  }
  if (independentlyReviewedGates.has(gate) && (!value.independentReview || value.producer === value.reviewer)) return false;
  if (independentlyReviewedGates.has(gate)) {
    const review = value.independentReviewAttestation;
    if (!isRecord(review) || typeof review.reviewerId !== "string" || review.reviewerId !== value.reviewer || review.reviewerId.trim().length < 2 || typeof review.keyId !== "string" || review.keyId.trim().length < 2 || review.signatureAlgorithm !== "Ed25519" || !sha256(review.signatureDigest) || typeof review.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(review.signature)) return false;
  }
  const attestation = value.attestation;
  if (!isRecord(attestation) || !["ATTESTED", "APPROVED"].includes(attestation.decision as string) || typeof attestation.authority !== "string" || attestation.authority.trim().length < 2 || typeof attestation.scope !== "string" || attestation.scope.trim().length < 2 || !sha256(attestation.signatureDigest) || attestation.signatureAlgorithm !== "Ed25519" || typeof attestation.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(attestation.signature) || typeof attestation.residualRiskAccepted !== "boolean") return false;
  if (gate === "humanApproval" && (attestation.decision !== "APPROVED" || attestation.residualRiskAccepted !== true)) return false;
  if (gate !== "humanApproval" && attestation.decision !== "ATTESTED") return false;
  if (attestation.signatureDigest !== sha256Hex(gateEvidenceReceiptPayload(value as unknown as PromotionGateEvidenceReceipt))) return false;
  return true;
}

const qualityBarValid = (qualityBar: unknown): qualityBar is PromotionEvidenceManifest["qualityBar"] => {
  if (!isRecord(qualityBar)) return false;
  const scoreValid = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100);
  const mandatoryDimensions = qualityBar.mandatoryDimensions;
  if (!isRecord(mandatoryDimensions)) return false;
  return scoreValid(qualityBar.architecture)
    && scoreValid(qualityBar.security)
    && scoreValid(qualityBar.reliability)
    && Object.keys(mandatoryDimensions).length === PROMOTION_MANDATORY_DIMENSION_KEYS.length
    && PROMOTION_MANDATORY_DIMENSION_KEYS.every((key) => scoreValid(mandatoryDimensions[key]))
    && ["ZERO", "PRESENT", "UNKNOWN"].includes(qualityBar.criticalBlockers as string)
    && ["ZERO", "PRESENT", "UNKNOWN"].includes(qualityBar.unresolvedHigh as string);
};

export function promotionManifestGateInventoryValid(value: unknown): value is PromotionEvidenceManifest {
  if (!isRecord(value)) return false;
  const manifest = value as Partial<PromotionEvidenceManifest>;
  if (manifest.schemaVersion !== 1 || !["STATE_OF_THE_ART_CANDIDATE", "STATE_OF_THE_ART_NOT_PROVEN"].includes(manifest.stateOfTheArtStatus ?? "") || !["TRIPLE_AAA_CANDIDATE", "AAA_NOT_PROVEN"].includes(manifest.status ?? "") || typeof manifest.sourceSha !== "string" || !/^[a-f0-9]{40}$/.test(manifest.sourceSha) || (manifest.ciSha !== null && typeof manifest.ciSha !== "string" || (typeof manifest.ciSha === "string" && !/^[a-f0-9]{40}$/.test(manifest.ciSha))) || (manifest.artifactSha !== null && typeof manifest.artifactSha !== "string" || (typeof manifest.artifactSha === "string" && !/^[a-f0-9]{40}$/.test(manifest.artifactSha))) || (manifest.artifactDigest !== null && typeof manifest.artifactDigest !== "string" || (typeof manifest.artifactDigest === "string" && !/^[a-f0-9]{64}$/.test(manifest.artifactDigest))) || (manifest.artifactEvidencePath !== undefined && manifest.artifactEvidencePath !== null && typeof manifest.artifactEvidencePath !== "string") || !isRecord(manifest.mandatoryGates) || !qualityBarValid(manifest.qualityBar) || !promotionScorecardValid(manifest.scorecard)) return false;
  const qualityBar = manifest.qualityBar;
  const scorecard = manifest.scorecard;
  if (manifest.status === "TRIPLE_AAA_CANDIDATE" && manifest.stateOfTheArtStatus !== "STATE_OF_THE_ART_CANDIDATE") return false;
  const gateInventoryValid = Object.keys(manifest.mandatoryGates).length === PROMOTION_MANDATORY_GATE_KEYS.length
    && PROMOTION_MANDATORY_GATE_KEYS.every((key) => ["VERIFIED", "BLOCKED_EXTERNAL", "NOT_RUN", "FAIL"].includes(manifest.mandatoryGates?.[key] as string));
  if (!gateInventoryValid) return false;
  if (manifest.status === "TRIPLE_AAA_CANDIDATE" && (!PROMOTION_MANDATORY_GATE_KEYS.every((key) => manifest.mandatoryGates?.[key] === "VERIFIED") || manifest.worktree !== "CLEAN" || typeof manifest.ciSha !== "string" || typeof manifest.artifactSha !== "string" || typeof manifest.artifactDigest !== "string" || typeof manifest.artifactEvidencePath !== "string" || qualityBar.architecture === null || qualityBar.security === null || qualityBar.reliability === null || qualityBar.architecture < PROMOTION_SCORECARD_THRESHOLDS.architecture || qualityBar.security < PROMOTION_SCORECARD_THRESHOLDS.security || qualityBar.reliability < PROMOTION_SCORECARD_THRESHOLDS.reliability || PROMOTION_MANDATORY_DIMENSION_KEYS.some((key) => qualityBar.mandatoryDimensions[key] === null || (qualityBar.mandatoryDimensions[key] ?? 0) < PROMOTION_SCORECARD_THRESHOLDS[key]) || qualityBar.criticalBlockers !== "ZERO" || qualityBar.unresolvedHigh !== "ZERO" || scorecard.overall.score === null || scorecard.overall.score < scorecard.overallThreshold || PROMOTION_SCORECARD_DIMENSION_KEYS.some((key) => scorecard.dimensions[key].score === null || (scorecard.dimensions[key].score ?? 0) < PROMOTION_SCORECARD_THRESHOLDS[key]) || !promotionScorecardBoundToSource(scorecard, manifest.sourceSha))) return false;
  return true;
}

/**
 * Local gates must not inherit credential-bearing configuration. This also
 * prevents a package script from accidentally using an external database or
 * provider while this bounded verifier is running.
 */
function localEnvironment(): NodeJS.ProcessEnv {
  const sensitiveName = /(?:PASSWORD|SECRET|TOKEN|CREDENTIAL|PRIVATE_KEY|ACCESS_KEY|AUTHORIZATION|COOKIE|SESSION|DATABASE_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGSERVICE|AWS_|AZURE_|GOOGLE_|VAULT_)/i;
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!sensitiveName.test(name) && value !== undefined) environment[name] = value;
  }
  environment.FORCE_COLOR = "0";
  environment.VERIFY_EXTERNAL = "disabled";
  environment.npm_config_offline = "true";
  environment.npm_config_audit = "false";
  environment.npm_config_fund = "false";
  environment.npm_config_update_notifier = "false";
  return environment;
}

const env = localEnvironment();

function redact(value: string): string {
  return value
    .replace(/(Bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[REDACTED]@")
    .replace(/((?:password|secret|token|credential|authorization|cookie)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi, "$1[REDACTED]")
    .replace(/\r?\n/g, " | ")
    .trim();
}

function detailFrom(output: string): string | undefined {
  const safe = redact(output).slice(-1_000).trim();
  return safe.length > 0 ? safe : undefined;
}

function record(gate: string, status: GateStatus, evidence: EvidenceClass, detail?: string): void {
  const result: GateResult = { gate, status, evidence };
  if (detail) result.detail = redact(detail).slice(0, 1_000);
  results.push(result);
  const suffix = result.detail ? ` detail=${JSON.stringify(result.detail)}` : "";
  process.stdout.write(`${status} ${gate} evidence=${evidence}${suffix}\n`);
}

function currentSha(): string | null {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) return null;
  const sha = (result.stdout ?? "").trim();
  return /^[a-f0-9]{40}$/.test(sha) ? sha : null;
}

function worktreeIsClean(): boolean {
  const result = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return result.status === 0 && (result.stdout ?? "").trim().length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function inspectPromotionEvidence(): Promise<boolean> {
  const manifestLocation = process.env.CVG_TRIPLO_EVIDENCE_MANIFEST ?? "artifacts/operational-proof/triple-aaa-evidence.json";
  const manifestPath = isAbsolute(manifestLocation) ? manifestLocation : join(root, manifestLocation);
  let manifest: PromotionEvidenceManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PromotionEvidenceManifest;
  } catch (error) {
    record("evidence-manifest", "BLOCKED", "NOT_EXECUTED", `required promotion evidence manifest is missing or unreadable: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
  const sha = currentSha();
  const requiredKeys = PROMOTION_MANDATORY_GATE_KEYS;
  const malformed = !promotionManifestGateInventoryValid(manifest);
  if (malformed) {
    record("evidence-manifest", "FAIL", "LOCAL_EXECUTION_ONLY", "promotion evidence manifest schema or mandatory gate inventory is invalid");
    return false;
  }
  if (manifest.status !== "TRIPLE_AAA_CANDIDATE") {
    record("evidence-manifest", "BLOCKED", "LOCAL_EXECUTION_ONLY", "promotion evidence manifest explicitly records AAA_NOT_PROVEN");
    return false;
  }
  const qualityBar = manifest.qualityBar;
  if (qualityBar.architecture === null || qualityBar.security === null || qualityBar.reliability === null || qualityBar.architecture < PROMOTION_SCORECARD_THRESHOLDS.architecture || qualityBar.security < PROMOTION_SCORECARD_THRESHOLDS.security || qualityBar.reliability < PROMOTION_SCORECARD_THRESHOLDS.reliability || PROMOTION_MANDATORY_DIMENSION_KEYS.some((key) => qualityBar.mandatoryDimensions[key] === null || (qualityBar.mandatoryDimensions[key] ?? 0) < PROMOTION_SCORECARD_THRESHOLDS[key]) || qualityBar.criticalBlockers !== "ZERO" || qualityBar.unresolvedHigh !== "ZERO") {
    record("evidence-manifest", "BLOCKED", "NETWORK_BLOCKED", "promotion requires each mandatory dimension to meet its prompt threshold (95-97) with zero critical and unresolved high blockers");
    return false;
  }
  if (!sha || manifest.sourceSha !== sha || manifest.ciSha !== sha || manifest.artifactSha !== sha || manifest.worktree !== "CLEAN" || !worktreeIsClean()) {
    record("evidence-manifest", "BLOCKED", "LOCAL_EXECUTION_ONLY", `promotion requires sourceSha==ciSha==artifactSha==HEAD and a clean worktree; head=${sha ?? "unavailable"} source=${manifest.sourceSha} ci=${manifest.ciSha ?? "null"} artifact=${manifest.artifactSha ?? "null"} worktree=${manifest.worktree}`);
    return false;
  }
  if (!manifest.artifactEvidencePath || !manifest.artifactDigest) {
    record("evidence-manifest", "BLOCKED", "LOCAL_EXECUTION_ONLY", "promotion requires an external evidence bundle path and SHA-256 digest; a manifest with only gate labels cannot certify content");
    return false;
  }
  const evidenceRoot = resolve(process.env.CVG_TRIPLO_EVIDENCE_ROOT ?? join(root, "artifacts/operational-proof"));
  let rootReal: string;
  try {
    rootReal = await requireExternalEvidenceRoot(evidenceRoot, root);
  } catch (error) {
    record("evidence-manifest", "BLOCKED", "LOCAL_EXECUTION_ONLY", error instanceof Error ? error.message : String(error));
    return false;
  }
  const resolveEvidencePath = (candidate: string): string => isAbsolute(candidate) ? resolve(candidate) : resolve(rootReal, candidate);
  const assertEvidenceFile = async (candidate: string): Promise<string> => {
    const path = resolveEvidencePath(candidate);
    const canonical = await realpath(path);
    const entry = await lstat(path);
    const rel = relative(rootReal, canonical);
    if (entry.isSymbolicLink() || !entry.isFile() || rel.startsWith("..") || isAbsolute(rel)) throw new Error("evidence path must be a regular non-symlink file beneath the immutable evidence root");
    return canonical;
  };
  const evidencePath = await assertEvidenceFile(manifest.artifactEvidencePath).catch((error) => {
    record("evidence-manifest", "FAIL", "LOCAL_EXECUTION_ONLY", error instanceof Error ? error.message : String(error));
    return null;
  });
  if (!evidencePath) return false;
  let evidenceBytes: Buffer;
  let bundle: ExternalEvidenceBundle;
  try {
    evidenceBytes = await readFile(evidencePath);
    const digest = createHash("sha256").update(evidenceBytes).digest("hex");
    if (digest !== manifest.artifactDigest) {
      record("evidence-manifest", "FAIL", "LOCAL_EXECUTION_ONLY", `external evidence digest mismatch for ${manifest.artifactEvidencePath}`);
      return false;
    }
    const parsed: unknown = JSON.parse(evidenceBytes.toString("utf8"));
    if (!isRecord(parsed)) throw new Error("external evidence bundle schema/sourceSha/state-of-the-art/quality-bar/scorecard/gate inventory is invalid");
    const parsedGates = parsed.gates;
    if (parsed.schemaVersion !== 1 || parsed.sourceSha !== manifest.sourceSha || parsed.stateOfTheArtStatus !== manifest.stateOfTheArtStatus || !qualityBarValid(parsed.qualityBar) || !promotionScorecardValid(parsed.scorecard) || !isRecord(parsedGates)) throw new Error("external evidence bundle schema/sourceSha/state-of-the-art/quality-bar/scorecard/gate inventory is invalid");
    if (Object.keys(parsedGates).length !== requiredKeys.length || requiredKeys.some((key) => !(key in parsedGates))) throw new Error("external evidence bundle gate inventory is not exact");
    const parsedQualityBar = parsed.qualityBar;
    const parsedScorecard = parsed.scorecard;
    const manifestQualityBar = manifest.qualityBar;
    if (JSON.stringify(parsedQualityBar) !== JSON.stringify(manifestQualityBar)) throw new Error("external evidence bundle quality-bar does not match the promotion manifest");
    if (JSON.stringify(parsedScorecard) !== JSON.stringify(manifest.scorecard)) throw new Error("external evidence bundle scorecard does not match the promotion manifest");
    if (!promotionScorecardBoundToSource(parsedScorecard, manifest.sourceSha)) throw new Error("external evidence bundle scorecard entries are not bound to the candidate source SHA");
    bundle = { schemaVersion: 1, sourceSha: parsed.sourceSha as string, stateOfTheArtStatus: parsed.stateOfTheArtStatus as PromotionEvidenceManifest["stateOfTheArtStatus"], qualityBar: parsedQualityBar, scorecard: parsedScorecard, gates: {}, phaseCoverage: {} };
    const seenPaths = new Set<string>();
    const seenDigests = new Set<string>();
    const gateEvidenceDigests: Record<string, string> = {};
    const gateEvidencePaths = new Set<string>([evidencePath]);
    for (const key of requiredKeys) {
      const entry = parsedGates[key];
      if (!isRecord(entry) || entry.status !== "VERIFIED" || typeof entry.evidencePath !== "string" || typeof entry.evidenceDigest !== "string" || !/^[a-f0-9]{64}$/.test(entry.evidenceDigest)) throw new Error(`gate ${key} lacks a verified artifact and digest`);
      const gatePath = await assertEvidenceFile(entry.evidencePath);
      if (seenPaths.has(gatePath) || seenDigests.has(entry.evidenceDigest)) throw new Error(`gate ${key} reuses another gate's evidence path or digest`);
      const gateBytes = await readFile(gatePath);
      const gateDigest = createHash("sha256").update(gateBytes).digest("hex");
      if (gateDigest !== entry.evidenceDigest) throw new Error(`gate ${key} evidence digest mismatch`);
      const receipt: unknown = JSON.parse(gateBytes.toString("utf8"));
      if (!promotionGateEvidenceReceiptValid(receipt, key, manifest.sourceSha, Date.now(), entry.evidenceDigest, manifest.artifactDigest)) throw new Error(`gate ${key} evidence receipt is not a current, executed, independently attributable, artifact-bound proof`);
      const typedReceipt = receipt as PromotionGateEvidenceReceipt;
      const executionFile = await assertEvidenceFile(typedReceipt.executionEvidence.path);
      if (executionFile === gatePath) throw new Error(`gate ${key} execution evidence must be a separate gate-specific artifact`);
      if (createHash("sha256").update(await readFile(executionFile)).digest("hex") !== typedReceipt.executionEvidence.digest) throw new Error(`gate ${key} execution evidence digest mismatch`);
      try {
        const execution = JSON.parse(await readFile(executionFile, "utf8")) as Record<string, unknown>;
        if (execution.gate !== key || execution.sourceSha !== manifest.sourceSha || execution.artifactSha !== manifest.artifactDigest || execution.executionId !== typedReceipt.executionEvidence.executionId || execution.status !== "PASS" || execution.exitStatus !== 0) throw new Error("execution artifact does not bind gate, source, artifact, execution id and zero exit");
      } catch (error) { throw new Error(`gate ${key} execution evidence is invalid: ${error instanceof Error ? error.message : String(error)}`); }
      gateEvidencePaths.add(executionFile);
      const trustedEvidencePublicKey = process.env.CVG_EXTERNAL_EVIDENCE_PUBLIC_KEY?.trim();
      if (!trustedEvidencePublicKey || !verifyGateEvidenceReceiptSignature(receipt, manifest.sourceSha, entry.evidenceDigest, trustedEvidencePublicKey)) throw new Error(`gate ${key} evidence receipt lacks a valid Ed25519 signature from the configured external evidence authority`);
      if (independentlyReviewedGates.has(key)) {
        const reviewerPublicKey = process.env.CVG_INDEPENDENT_REVIEW_PUBLIC_KEY?.trim();
        if (!reviewerPublicKey || !verifyIndependentReviewSignature(typedReceipt, reviewerPublicKey)) throw new Error(`gate ${key} lacks a valid signature from the separate independent reviewer authority`);
      }
      if (key === "humanApproval") {
        const trustedApprovalPublicKey = process.env.CVG_RELEASE_APPROVAL_PUBLIC_KEY?.trim();
        if (!trustedApprovalPublicKey || !verifyHumanApprovalReceiptSignature(receipt, manifest.sourceSha, trustedApprovalPublicKey)) throw new Error("human approval receipt lacks a valid Ed25519 signature from the configured external authority");
      }
      if (key === "deepseek" || key === "provider") {
        const specializedPath = typedReceipt.specializedEvidencePath;
        const specializedDigest = typedReceipt.specializedEvidenceDigest;
        if (!specializedPath || !specializedDigest) throw new Error(`${key} receipt lacks its specialized vertical proof reference`);
        const specializedFile = await assertEvidenceFile(specializedPath);
        const specializedBytes = await readFile(specializedFile);
        if (createHash("sha256").update(specializedBytes).digest("hex") !== specializedDigest) throw new Error(`${key} specialized vertical proof digest mismatch`);
        const specializedRaw: unknown = JSON.parse(specializedBytes.toString("utf8"));
        const specializedPublicKey = process.env[key === "deepseek" ? "CVG_DEEPSEEK_REAL_PROOF_PUBLIC_KEY" : "CVG_PROVIDER_REAL_PROOF_PUBLIC_KEY"]?.trim();
        if (!specializedPublicKey) throw new Error(`${key} specialized proof authority key is not configured`);
        if (key === "deepseek") {
          const validation = validateDeepSeekRealProofEvidence(specializedRaw, manifest.sourceSha, Date.now(), specializedPublicKey);
          if (!validation.ok) throw new Error(`DeepSeek specialized proof invalid: ${validation.reason}`);
          const expectedEngine = process.env.CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT?.trim();
          const expectedManifest = process.env.CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION?.trim();
          if (!expectedEngine || !expectedManifest || validation.evidence.engineCommit !== expectedEngine || validation.evidence.manifestDigest !== expectedManifest) throw new Error("DeepSeek specialized proof identity does not match the configured engine and manifest");
          for (const stage of Object.values(validation.evidence.stages)) {
            if (!isDeepSeekProofEvidenceRef(stage.evidenceRef)) throw new Error("DeepSeek specialized stage reference is invalid");
            const stageFile = await assertEvidenceFile(resolve(dirname(specializedFile), stage.evidenceRef));
            if (createHash("sha256").update(await readFile(stageFile)).digest("hex") !== stage.evidenceDigest) throw new Error("DeepSeek specialized stage digest mismatch");
          }
        } else {
          const validation = validateProviderRealProofEvidence(specializedRaw, manifest.sourceSha, Date.now(), specializedPublicKey);
          if (!validation.ok) throw new Error(`provider specialized proof invalid: ${validation.reason}`);
          for (const stage of Object.values(validation.evidence.stages)) {
            if (!isProviderProofEvidenceRef(stage.evidenceRef)) throw new Error("provider specialized stage reference is invalid");
            const stageFile = await assertEvidenceFile(resolve(dirname(specializedFile), stage.evidenceRef));
            if (createHash("sha256").update(await readFile(stageFile)).digest("hex") !== stage.evidenceDigest) throw new Error("provider specialized stage digest mismatch");
          }
        }
        gateEvidencePaths.add(specializedFile);
      }
      if (key === "critics") {
        const redTeam = typedReceipt.redTeamEvidence!;
        for (const [redTeamKey, item] of [["security", redTeam.security], ["database", redTeam.database]] as const) {
          const redFile = await assertEvidenceFile(item.path);
          if (createHash("sha256").update(await readFile(redFile)).digest("hex") !== item.digest) throw new Error(`critics ${item.phase} red-team evidence digest mismatch`);
          try {
            const red = JSON.parse(await readFile(redFile, "utf8")) as Record<string, unknown>;
            if (red.phase !== item.phase || red.sourceSha !== manifest.sourceSha || red.artifactSha !== manifest.artifactDigest || red.status !== "VERIFIED" || !exactCriterionRoster(red.criteria, PROMOTION_RED_TEAM_CRITERIA[redTeamKey]) || JSON.stringify(red.criteria) !== JSON.stringify(item.criteria)) throw new Error("red-team artifact does not bind phase, source, artifact and exact criteria");
          } catch (error) { throw new Error(`critics ${item.phase} red-team evidence is invalid: ${error instanceof Error ? error.message : String(error)}`); }
          gateEvidencePaths.add(redFile);
        }
      }
      seenPaths.add(gatePath);
      seenDigests.add(entry.evidenceDigest);
      gateEvidenceDigests[key] = entry.evidenceDigest;
      gateEvidencePaths.add(gatePath);
      bundle.gates[key] = { status: "VERIFIED", evidencePath: entry.evidencePath, evidenceDigest: entry.evidenceDigest };
    }
    if (!promotionPhaseCoverageValid(parsed.phaseCoverage, gateEvidenceDigests)) throw new Error("external evidence bundle phase coverage is not exact or is not bound to the verified gate receipts");
    bundle.phaseCoverage = parsed.phaseCoverage as ExternalEvidenceBundle["phaseCoverage"];
    const scorecardEntries = [...PROMOTION_SCORECARD_DIMENSION_KEYS.map((key) => parsedScorecard.dimensions[key]), parsedScorecard.overall];
    for (const entry of scorecardEntries) {
      for (const artifact of entry.artifact) {
        const artifactPath = await assertEvidenceFile(artifact);
        if (!gateEvidencePaths.has(artifactPath)) throw new Error(`scorecard artifact ${artifact} is not bound to the manifest or a verified gate receipt`);
      }
    }
  } catch (error) {
    record("evidence-manifest", "BLOCKED", "NOT_EXECUTED", `external evidence bundle is missing, unreadable or incomplete: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
  const unresolved = requiredKeys.filter((key) => manifest.mandatoryGates[key] !== "VERIFIED");
  if (unresolved.length) {
    record("evidence-manifest", "BLOCKED", "NETWORK_BLOCKED", `mandatory evidence is not verified: ${unresolved.join(",")}`);
    return false;
  }
  record("evidence-manifest", "PASS", "LOCAL_EXECUTION_ONLY", `promotion manifest is bound to ${sha}`);
  return true;
}

function commandNotFound(error: Error | undefined): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function commandTimedOut(error: Error | undefined): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
}

function runCommand(gate: string, command: string, args: string[], evidence: EvidenceClass): void {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: gateTimeoutMs,
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (commandNotFound(result.error)) {
    record(gate, "NOT_RUN", "NOT_EXECUTED", `${command} is unavailable`);
    return;
  }
  if (commandTimedOut(result.error)) {
    record(gate, "BLOCKED", evidence, `bounded timeout after ${gateTimeoutMs}ms`);
    return;
  }
  if (result.status === 0) {
    record(gate, "PASS", evidence);
    return;
  }

  const output = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  const explicitlyBlocked = evidence === "NETWORK_BLOCKED" && /(?:BLOCKED|NOT_RUN|INCOMPLETE|NO_AUTHORITY|UNAVAILABLE|SKIPPED_EXTERNAL)/i.test(output);
  if (result.status === 2 && explicitlyBlocked) {
    record(gate, "BLOCKED", evidence, detailFrom(output));
    return;
  }
  const signal = result.signal ? ` signal=${result.signal}` : "";
  record(gate, "FAIL", evidence, `exit=${result.status ?? "unknown"}${signal}${detailFrom(output) ? ` ${detailFrom(output)}` : ""}`);
}

function npmScriptAvailable(manifest: PackageManifest, script: string): boolean {
  return typeof manifest.scripts?.[script] === "string" && manifest.scripts[script].trim().length > 0;
}

function runNpmScript(manifest: PackageManifest, gate: string, script: string, evidence: EvidenceClass): void {
  if (!npmScriptAvailable(manifest, script)) {
    record(gate, "NOT_RUN", "NOT_EXECUTED", `npm script ${script} is not declared`);
    return;
  }
  runCommand(gate, npmExecutable, ["run", script], evidence);
}

function npmSubcommandAvailable(subcommand: string): boolean {
  const result = spawnSync(npmExecutable, [subcommand, "--help"], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 15_000,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error || result.status !== 0) return false;
  return `${result.stdout ?? ""}\\n${result.stderr ?? ""}`.toLowerCase().includes(subcommand.toLowerCase());
}

function recordExternalEvidenceBoundary(promotionEvidenceVerified: boolean): void {
  for (const gate of [
    "provider",
    "secretAuthority",
    "webauthnBreakGlass",
    "staging",
    "observability",
    "browserMatrix",
    "recovery",
    "restore",
    "rtoRpo",
    "load",
    "resourcePressure",
    "securityHeaders",
    "productionConfig",
    "containerSmoke",
    "stagingPromotion",
    "runbookExecution",
    "critics",
    "repairLoop",
    "humanApproval"
  ]) {
    if (promotionEvidenceVerified) record(gate, "PASS", "PROMOTION_EVIDENCE", "validated same-SHA external evidence bundle; no network call was repeated by the bounded verifier");
    else record(gate, "NOT_RUN", "NOT_EXECUTED", "no external evidence is executed by the local-only verifier");
  }
}

async function main(): Promise<void> {
  const promotionEvidenceVerified = await inspectPromotionEvidence();
  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as PackageManifest;
  } catch (error) {
    record("package-manifest", "BLOCKED", "NOT_EXECUTED", `cannot read package.json: ${error instanceof Error ? error.message : String(error)}`);
    recordExternalEvidenceBoundary(promotionEvidenceVerified);
    process.stdout.write("VERDICT AAA_NOT_PROVEN\n");
    process.stderr.write("FAIL-CLOSED local verification cannot inspect the package manifest\n");
    process.exitCode = 2;
    return;
  }

  runNpmScript(manifest, "lint", "lint", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "typecheck", "typecheck", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "test", "test", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "provider-loopback-sandbox", "verify:provider-sandbox", "LOCAL_EXECUTION_ONLY");
  runCommand("deepseek-bridge-contract", process.execPath, ["--import", "tsx", "--test", "tests/unit/deepseek-bridge.test.ts"], "SYNTHETIC_ONLY");
  if (promotionEvidenceVerified) {
    for (const [gate, detail] of [
      ["deepseek", "deepseek"],
      ["provider", "provider"],
      ["postgresConcurrency", "postgresConcurrency"],
      ["ciSameSha", "ciSameSha"],
      ["stagingPromotion", "stagingPromotion"],
      ["containerSmoke", "containerSmoke"],
      ["resourcePressure", "resourcePressure"],
      ["productionConfig", "productionConfig"],
      ["runbookExecution", "runbookExecution"],
      ["repairLoop", "repairLoop"]
    ] as const) record(gate, "PASS", "PROMOTION_EVIDENCE", `validated mandatory gate ${detail} from the same-SHA external bundle`);
  } else {
    runNpmScript(manifest, "deepseek", "verify:deepseek-real", "NETWORK_BLOCKED");
    runNpmScript(manifest, "provider", "verify:provider-real", "NETWORK_BLOCKED");
    runNpmScript(manifest, "postgresConcurrency", "verify:postgres:concurrency", "NETWORK_BLOCKED");
    runNpmScript(manifest, "ciSameSha", "verify:release-provenance", "NETWORK_BLOCKED");
    runNpmScript(manifest, "stagingPromotion", "verify:promotion-invariant", "NETWORK_BLOCKED");
    runNpmScript(manifest, "containerSmoke", "verify:container-smoke", "NETWORK_BLOCKED");
  }
  runNpmScript(manifest, "pdp", "verify:pdp", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "pdp-universal", "verify:pdp-universal", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "authoritative-writes", "verify:authoritative-writes", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "build", "build", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "contract", "test:contract", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "security", "test:security", "SYNTHETIC_ONLY");
  runNpmScript(manifest, "security-red-team-local", "verify:security-red-team", "SYNTHETIC_ONLY");
  runNpmScript(manifest, "resource-pressure-local", "verify:resource-pressure", "SYNTHETIC_ONLY");
  runNpmScript(manifest, "runbook-contract-local", "verify:runbook-execution", "SYNTHETIC_ONLY");
  runNpmScript(manifest, "audit-chain-local", "verify:audit-chain", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "worker-runtime-local", "verify:worker-runtime", "LOCAL_EXECUTION_ONLY");
  // verify:production runs static verification before its own local contract
  // writers; provide it with a snapshot that includes the writers above.
  runNpmScript(manifest, "evidence-snapshot-pre-production", "verify:evidence-snapshot", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "production-structural-local", "verify:production", "LOCAL_EXECUTION_ONLY");
  // The production structural command re-runs artifact-producing local
  // contracts. Capture the snapshot only after every such writer has stopped,
  // then run static verification against that final photograph.
  runNpmScript(manifest, "evidence-snapshot", "verify:evidence-snapshot", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "static", "verify:static", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "database", "test:database", "SYNTHETIC_ONLY");
  runNpmScript(manifest, "fault", "test:fault", "SYNTHETIC_ONLY");
  runNpmScript(manifest, "audit:licenses", "audit:licenses", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "audit:tokens", "audit:tokens", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "audit:contrast", "audit:contrast", "LOCAL_EXECUTION_ONLY");

  // npm audit consults a registry. It is deliberately not invoked here: the
  // bounded verifier has no network authority. The local audit scripts above
  // still run and this missing external proof remains visible.
  if (promotionEvidenceVerified) record("audit:dependency-registry", "PASS", "PROMOTION_EVIDENCE", "registry audit is covered by the validated external evidence bundle");
  else record("audit:dependency-registry", "BLOCKED", "NETWORK_BLOCKED", "registry/network access is disabled by policy");

  if (npmSubcommandAvailable("sbom")) {
    runCommand("sbom", npmExecutable, ["sbom", "--sbom-format", "cyclonedx"], "LOCAL_EXECUTION_ONLY");
  } else {
    if (promotionEvidenceVerified) record("sbom", "PASS", "PROMOTION_EVIDENCE", "SBOM is covered by the validated external evidence bundle");
    else record("sbom", "NOT_RUN", "NOT_EXECUTED", "installed npm does not expose the sbom subcommand");
  }

  runCommand("diff", "git", ["diff", "--check", "HEAD", "--"], "LOCAL_EXECUTION_ONLY");
  recordExternalEvidenceBoundary(promotionEvidenceVerified);

  const hasFailure = results.some((result) => result.status === "FAIL");
  const incomplete = results.some((result) => result.status !== "PASS") || (!promotionEvidenceVerified && results.some((result) => result.evidence !== "LOCAL_EXECUTION_ONLY"));
  process.stdout.write(`VERDICT ${promotionEvidenceVerified && !hasFailure && !incomplete ? "TRIPLE_AAA_VERIFIED" : "AAA_NOT_PROVEN"}\n`);
  if (!promotionEvidenceVerified || incomplete) process.stdout.write("PROMOTION BLOCKED synthetic/local evidence is not Triple AAA evidence; use a validated same-SHA external bundle separately\n");

  if (hasFailure) {
    process.stderr.write("FAIL-CLOSED one or more local gates failed\n");
    process.exitCode = 1;
  } else if (incomplete) {
    process.stderr.write("FAIL-CLOSED verification is incomplete; no AAA promotion is possible\n");
    process.exitCode = 2;
  }
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)) : false;
if (entrypoint) await main();
