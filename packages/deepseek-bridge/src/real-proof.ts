import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";

/**
 * A model turn smoke is not enough to close the DeepSeek gate.  This inventory
 * names every positive and negative operation required by the prompt so an
 * externally produced proof cannot silently omit the failure matrix.
 */
export const DEEPSEEK_REAL_PROOF_STAGES = [
  "health",
  "initialize",
  "session-new",
  "turn",
  "structured-response",
  "tool-request",
  "tool-denial",
  "tool-allow",
  "approval-required",
  "approval-accepted",
  "approval-rejected",
  "replay",
  "usage",
  "provenance",
  "cancellation",
  "timeout",
  "engine-restart",
  "wrong-engine-commit",
  "wrong-manifest",
  "wrong-tool-registry",
  "bad-attestation",
  "invalid-hmac",
  "expired-context",
  "invalid-json",
  "schema-mismatch",
  "slow-model",
  "broken-connection",
  "partial-output",
  "provider-failure",
  "replay-mismatch",
  "approval-replay"
] as const;

export type DeepSeekRealProofStage = (typeof DEEPSEEK_REAL_PROOF_STAGES)[number];

export interface DeepSeekRealProofStageEvidence {
  status: "PASS";
  observedAt: string;
  evidenceRef: string;
  evidenceDigest: string;
}

export interface DeepSeekRealProofEvidence {
  schemaVersion: 1;
  sourceSha: string;
  worktree: "CLEAN";
  engineCommit: string;
  manifestDigest: string;
  producer: string;
  reviewer: string;
  independentReview: true;
  stages: Record<DeepSeekRealProofStage, DeepSeekRealProofStageEvidence>;
  chainDigest: string;
  limitations: string[];
  residualRisk: string[];
  attestation: DeepSeekRealProofAttestation;
}

export interface DeepSeekRealProofAttestation {
  signatureAlgorithm: "Ed25519";
  signatureDigest: string;
  signature: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };

function stable(value: CanonicalValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key]!)}`).join(",")}}`;
}

/** The producer signs every identity, stage digest and residual-risk field. */
export function deepSeekRealProofAttestationPayload(value: Omit<DeepSeekRealProofEvidence, "attestation">): Buffer {
  return Buffer.from(stable(value as unknown as CanonicalValue), "utf8");
}

function attestationValid(value: DeepSeekRealProofEvidence, trustedPublicKey: string | undefined): boolean {
  const attestation = value.attestation;
  if (!attestation || attestation.signatureAlgorithm !== "Ed25519" || !/^[a-f0-9]{64}$/.test(attestation.signatureDigest) || !/^[A-Za-z0-9_-]{86}$/.test(attestation.signature) || !trustedPublicKey?.trim()) return false;
  const { attestation: _ignored, ...unsigned } = value;
  const payload = deepSeekRealProofAttestationPayload(unsigned);
  if (sha256(payload.toString("utf8")) !== attestation.signatureDigest) return false;
  try {
    const key = createPublicKey(trustedPublicKey);
    if (key.asymmetricKeyType !== "ed25519") return false;
    const signature = Buffer.from(attestation.signature, "base64url");
    return signature.length === 64 && verifySignature(null, payload, key, signature);
  } catch {
    return false;
  }
}

function currentTimestamp(value: unknown, now: number): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  const maxAgeMs = 7 * 24 * 60 * 60 * 1_000;
  return Number.isFinite(parsed) && parsed <= now + 5 * 60 * 1_000 && parsed >= now - maxAgeMs;
}

function nonEmptyStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

export function isDeepSeekProofEvidenceRef(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || value.trim() !== value || value.includes("\\") || value.startsWith("/")) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".." && /^[A-Za-z0-9._-]+$/.test(segment));
}

export function deepSeekRealProofChainDigest(stages: DeepSeekRealProofEvidence["stages"]): string {
  const canonical = DEEPSEEK_REAL_PROOF_STAGES.map((stage) => ({ stage, ...stages[stage] }));
  return sha256(JSON.stringify(canonical));
}

/** Validate a same-SHA, independently reviewed DeepSeek operation matrix. */
export function validateDeepSeekRealProofEvidence(value: unknown, expectedSourceSha: string, now = Date.now(), trustedPublicKey?: string): { ok: true; evidence: DeepSeekRealProofEvidence } | { ok: false; reason: string } {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.worktree !== "CLEAN" || value.sourceSha !== expectedSourceSha || typeof value.sourceSha !== "string" || !/^[a-f0-9]{40}$/.test(value.sourceSha)) return { ok: false, reason: "DeepSeek proof must be bound to a clean checkout and the current SHA" };
  if (typeof value.engineCommit !== "string" || !/^[a-f0-9]{40}$/.test(value.engineCommit) || typeof value.manifestDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.manifestDigest)) return { ok: false, reason: "DeepSeek proof identity is incomplete" };
  if (typeof value.producer !== "string" || value.producer.trim().length < 2 || typeof value.reviewer !== "string" || value.reviewer.trim().length < 2 || value.producer === value.reviewer || value.independentReview !== true) return { ok: false, reason: "DeepSeek proof requires distinct producer and independent reviewer" };
  if (!isRecord(value.stages) || Object.keys(value.stages).length !== DEEPSEEK_REAL_PROOF_STAGES.length) return { ok: false, reason: "DeepSeek proof does not contain the complete operation matrix" };
  const stages = {} as DeepSeekRealProofEvidence["stages"];
  for (const stage of DEEPSEEK_REAL_PROOF_STAGES) {
    const item = value.stages[stage];
    if (!isRecord(item) || item.status !== "PASS" || !currentTimestamp(item.observedAt, now) || !isDeepSeekProofEvidenceRef(item.evidenceRef) || typeof item.evidenceDigest !== "string" || !/^[a-f0-9]{64}$/.test(item.evidenceDigest)) return { ok: false, reason: `DeepSeek proof stage ${stage} is incomplete, unbound or stale` };
    stages[stage] = { status: "PASS", observedAt: item.observedAt, evidenceRef: item.evidenceRef, evidenceDigest: item.evidenceDigest };
  }
  if (typeof value.chainDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.chainDigest) || value.chainDigest !== deepSeekRealProofChainDigest(stages)) return { ok: false, reason: "DeepSeek proof chain digest does not match its stages" };
  if (!nonEmptyStrings(value.limitations) || !nonEmptyStrings(value.residualRisk)) return { ok: false, reason: "DeepSeek proof must state limitations and residual risk" };
  if (!attestationValid({ ...value, stages, attestation: value.attestation as DeepSeekRealProofAttestation } as DeepSeekRealProofEvidence, trustedPublicKey)) return { ok: false, reason: "DeepSeek proof lacks a valid Ed25519 producer attestation" };
  return {
    ok: true,
    evidence: {
      schemaVersion: 1,
      sourceSha: value.sourceSha,
      worktree: "CLEAN",
      engineCommit: value.engineCommit,
      manifestDigest: value.manifestDigest,
      producer: value.producer,
      reviewer: value.reviewer,
      independentReview: true,
      stages,
      chainDigest: value.chainDigest,
      limitations: value.limitations,
      residualRisk: value.residualRisk,
      attestation: value.attestation as DeepSeekRealProofAttestation
    }
  };
}
