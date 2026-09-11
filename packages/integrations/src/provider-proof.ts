import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";

/** The provider gate is a vertical proof, not an HTTP send smoke test. */
export const PROVIDER_REAL_PROOF_STAGES = [
  "appointment",
  "pdp",
  "approval",
  "outbox",
  "worker",
  "provider",
  "receipt",
  "callback",
  "inbox",
  "effect-ledger",
  "reconciliation",
  "audit"
] as const;

export type ProviderRealProofStage = (typeof PROVIDER_REAL_PROOF_STAGES)[number];

export interface ProviderRealProofStageEvidence {
  status: "PASS";
  observedAt: string;
  evidenceRef: string;
  evidenceDigest: string;
}

export interface ProviderRealProofEvidence {
  schemaVersion: 1;
  sourceSha: string;
  worktree: "CLEAN";
  transactionId: string;
  producer: string;
  reviewer: string;
  independentReview: true;
  stages: Record<ProviderRealProofStage, ProviderRealProofStageEvidence>;
  chainDigest: string;
  limitations: string[];
  residualRisk: string[];
  attestation: ProviderRealProofAttestation;
}

export interface ProviderRealProofAttestation {
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

/** The producer signs the exact same-SHA vertical proof validated below. */
export function providerRealProofAttestationPayload(value: Omit<ProviderRealProofEvidence, "attestation">): Buffer {
  return Buffer.from(stable(value as unknown as CanonicalValue), "utf8");
}

function nonEmptyStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function attestationValid(value: ProviderRealProofEvidence, trustedPublicKey: string | undefined): boolean {
  const attestation = value.attestation;
  if (!attestation || attestation.signatureAlgorithm !== "Ed25519" || !/^[a-f0-9]{64}$/.test(attestation.signatureDigest) || !/^[A-Za-z0-9_-]{86}$/.test(attestation.signature) || !trustedPublicKey?.trim()) return false;
  const { attestation: _ignored, ...unsigned } = value;
  const payload = providerRealProofAttestationPayload(unsigned);
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

function currentTimestamp(value: unknown, now = Date.now()): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  const maxAgeMs = 7 * 24 * 60 * 60 * 1_000;
  return Number.isFinite(parsed) && parsed <= now + 5 * 60 * 1_000 && parsed >= now - maxAgeMs;
}

export function isProviderProofEvidenceRef(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || value.trim() !== value || value.includes("\\") || value.startsWith("/")) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".." && /^[A-Za-z0-9._-]+$/.test(segment));
}

export function providerRealProofChainDigest(stages: ProviderRealProofEvidence["stages"]): string {
  const canonical = PROVIDER_REAL_PROOF_STAGES.map((stage) => ({ stage, ...stages[stage] }));
  return sha256(JSON.stringify(canonical));
}

/**
 * Validate an externally produced, same-SHA vertical proof before the script
 * is allowed to perform a provider call.  A direct provider receipt can never
 * satisfy this contract by itself.
 */
export function validateProviderRealProofEvidence(value: unknown, expectedSourceSha: string, now = Date.now(), trustedPublicKey?: string): { ok: true; evidence: ProviderRealProofEvidence } | { ok: false; reason: string } {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.worktree !== "CLEAN" || typeof value.sourceSha !== "string" || value.sourceSha !== expectedSourceSha || !/^[a-f0-9]{40}$/.test(value.sourceSha)) return { ok: false, reason: "provider proof must be bound to a clean checkout and the current SHA" };
  if (typeof value.transactionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(value.transactionId)) return { ok: false, reason: "provider proof transactionId is invalid" };
  if (!isRecord(value.stages) || Object.keys(value.stages).length !== PROVIDER_REAL_PROOF_STAGES.length) return { ok: false, reason: "provider proof does not contain the complete vertical stage inventory" };
  const stages = {} as ProviderRealProofEvidence["stages"];
  for (const stage of PROVIDER_REAL_PROOF_STAGES) {
    const item = value.stages[stage];
    if (!isRecord(item) || item.status !== "PASS" || !currentTimestamp(item.observedAt, now) || !isProviderProofEvidenceRef(item.evidenceRef) || typeof item.evidenceDigest !== "string" || !/^[a-f0-9]{64}$/.test(item.evidenceDigest)) return { ok: false, reason: `provider proof stage ${stage} is incomplete, unbound or stale` };
    stages[stage] = { status: "PASS", observedAt: item.observedAt, evidenceRef: item.evidenceRef, evidenceDigest: item.evidenceDigest };
  }
  if (typeof value.chainDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.chainDigest) || value.chainDigest !== providerRealProofChainDigest(stages)) return { ok: false, reason: "provider proof chain digest does not match its stages" };
  if (typeof value.producer !== "string" || value.producer.trim().length < 2 || typeof value.reviewer !== "string" || value.reviewer.trim().length < 2 || value.producer === value.reviewer || value.independentReview !== true || !nonEmptyStrings(value.limitations) || !nonEmptyStrings(value.residualRisk)) return { ok: false, reason: "provider proof requires distinct producer/reviewer, independent review, limitations and residual risk" };
  const candidate: ProviderRealProofEvidence = { schemaVersion: 1, sourceSha: value.sourceSha, worktree: "CLEAN", transactionId: value.transactionId, producer: value.producer, reviewer: value.reviewer, independentReview: true, stages, chainDigest: value.chainDigest, limitations: value.limitations, residualRisk: value.residualRisk, attestation: value.attestation as ProviderRealProofAttestation };
  if (!attestationValid(candidate, trustedPublicKey)) return { ok: false, reason: "provider proof lacks a valid Ed25519 producer attestation" };
  return { ok: true, evidence: candidate };
}
