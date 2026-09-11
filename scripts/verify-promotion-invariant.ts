import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireExternalEvidenceRoot } from "./evidence-boundary.ts";

export type Promotion = {
  schemaVersion: 1;
  sourceSha: string;
  artifactDigest: string;
  provenanceDigest: string;
  provenanceEvidencePath: string;
  staging: { artifactDigest: string; sourceSha: string; smokeEvidenceDigest: string; smokeEvidencePath: string; verifiedAt: string };
  approval: {
    status: "APPROVED";
    approvedBy: string;
    approvedAt: string;
    authority: string;
    scope: string;
    residualRiskAccepted: boolean;
    attestationDigest: string;
    signatureAlgorithm: "Ed25519";
    signature: string;
  };
  productionCandidate: { artifactDigest: string; sourceSha: string; createdAt: string };
};

export type ContainerSmokeEvidence = {
  schemaVersion: 1;
  kind: "container-smoke";
  sourceSha: string;
  artifactDigest: string;
  environment: "staging" | "production-like";
  observedAt: string;
  shutdownObserved: true;
  outboxDurable: true;
  replayIdempotent: true;
  scenarios: {
    transport: true;
    authenticated: true;
    databaseWrite: true;
    workerHeartbeat: true;
    providerEffect: true;
    restart: true;
  };
  receipt: {
    receiptId: string;
    effectId: string;
    auditRecordId: string;
    outcome: "DELIVERED" | "RECONCILED" | "OUTCOME_UNKNOWN";
  };
};

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sha40 = /^[a-f0-9]{40}$/;
const digest = /^sha256:[a-f0-9]{64}$/;
const maxEvidenceAgeMs = 7 * 24 * 60 * 60 * 1_000;

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };

type ReleaseProvenance = {
  schemaVersion: 1;
  sourceSha: string;
  ciSha: string;
  buildTimestamp: string;
  sbomDigest: string;
  sbomPath: string;
  ciResultsDigest: string;
  ciResultsPath: string;
  containers: { api: string; web: string };
  artifactDigest: string;
  migration: { version: string; digest: string };
  policyRevision: string;
  toolRegistryDigest: string;
  deepseekExpectedEngineCommit: string;
  manifestDigest: string;
};

function stable(value: CanonicalValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key]!)}`).join(",")}}`;
}

function sha256(value: string | Buffer): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }

export function containerSmokeEvidenceValid(value: unknown, expectedSha: string, expectedArtifact: string, now = Date.now()): value is ContainerSmokeEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const evidence = value as Partial<ContainerSmokeEvidence>;
  const scenarios = evidence.scenarios;
  const receipt = evidence.receipt;
  const current = typeof evidence.observedAt === "string" && Number.isFinite(Date.parse(evidence.observedAt))
    && Date.parse(evidence.observedAt) <= now + 5 * 60 * 1_000
    && Date.parse(evidence.observedAt) >= now - maxEvidenceAgeMs;
  return evidence.schemaVersion === 1
    && evidence.kind === "container-smoke"
    && evidence.sourceSha === expectedSha
    && sha40.test(evidence.sourceSha)
    && evidence.artifactDigest === expectedArtifact
    && digest.test(evidence.artifactDigest)
    && (evidence.environment === "staging" || evidence.environment === "production-like")
    && current
    && evidence.shutdownObserved === true
    && evidence.outboxDurable === true
    && evidence.replayIdempotent === true
    && !!scenarios
    && scenarios.transport === true
    && scenarios.authenticated === true
    && scenarios.databaseWrite === true
    && scenarios.workerHeartbeat === true
    && scenarios.providerEffect === true
    && scenarios.restart === true
    && !!receipt
    && typeof receipt.receiptId === "string" && receipt.receiptId.trim().length > 0
    && typeof receipt.effectId === "string" && receipt.effectId.trim().length > 0
    && typeof receipt.auditRecordId === "string" && receipt.auditRecordId.trim().length > 0
    && typeof receipt.outcome === "string"
    && ["DELIVERED", "RECONCILED", "OUTCOME_UNKNOWN"].includes(receipt.outcome);
}

/**
 * The human approval signs the complete promotion decision and its
 * no-rebuild bindings. Signature and digest fields are intentionally excluded
 * from the signed payload. Stable key ordering makes the bytes independent of
 * JSON property order.
 */
export function promotionApprovalPayload(promotion: Promotion): Buffer {
  const unsigned = {
    schemaVersion: promotion.schemaVersion,
    sourceSha: promotion.sourceSha,
    artifactDigest: promotion.artifactDigest,
    provenanceDigest: promotion.provenanceDigest,
    provenanceEvidencePath: promotion.provenanceEvidencePath,
    staging: promotion.staging,
    approval: {
      status: promotion.approval.status,
      approvedBy: promotion.approval.approvedBy,
      approvedAt: promotion.approval.approvedAt,
      authority: promotion.approval.authority,
      scope: promotion.approval.scope,
      residualRiskAccepted: promotion.approval.residualRiskAccepted
    },
    productionCandidate: promotion.productionCandidate
  };
  return Buffer.from(stable(unsigned as unknown as CanonicalValue), "utf8");
}

function option(name: string): string | undefined { const at = process.argv.indexOf(name); return at >= 0 ? process.argv[at + 1]?.trim() : process.argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1).trim(); }
function currentSha(): string { const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }); if (result.status !== 0) throw new Error("cannot resolve current Git SHA"); return result.stdout.trim(); }
function isCurrentTime(value: unknown, now: number): value is string { if (typeof value !== "string") return false; const parsed = Date.parse(value); return Number.isFinite(parsed) && parsed <= now + 5 * 60 * 1_000 && parsed >= now - maxEvidenceAgeMs; }
function requireString(value: unknown, name: string, errors: string[], pattern?: RegExp): value is string { if (typeof value !== "string" || !value.trim() || (pattern && !pattern.test(value))) { errors.push(`${name} is invalid`); return false; } return true; }

async function boundFile(pathValue: unknown, label: string, evidenceRoot: string, expected: string, errors: string[]): Promise<Buffer | null> {
  if (!requireString(pathValue, `${label} path`, errors)) return null;
  try {
    const canonicalRoot = await realpath(evidenceRoot);
    // Promotion manifests are portable across runners: relative evidence
    // paths are rooted at CVG_PROMOTION_EVIDENCE_ROOT, while absolute paths
    // remain usable for an explicitly provisioned external bundle.
    const path = isAbsolute(pathValue) ? resolve(pathValue) : resolve(canonicalRoot, pathValue);
    const canonicalPath = await realpath(path);
    const stats = await lstat(path);
    const rel = relative(canonicalRoot, canonicalPath);
    if (stats.isSymbolicLink() || !stats.isFile() || rel.startsWith("..") || isAbsolute(rel)) throw new Error("must be a regular non-symlink file below the immutable evidence root");
    const bytes = await readFile(canonicalPath);
    const observed = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (observed !== expected) throw new Error(`digest mismatch; observed ${observed}`);
    return bytes;
  } catch (error) {
    errors.push(`${label} ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function promotionInvariantErrors(value: unknown, expectedSha: string, evidenceRoot: string, now = Date.now(), trustedApprovalPublicKey?: string | null): Promise<string[]> {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["promotion manifest must be an object"];
  const promotion = value as Partial<Promotion>;
  if (promotion.schemaVersion !== 1) errors.push("unsupported promotion schema");
  const sourceShaValid = requireString(promotion.sourceSha, "sourceSha", errors, sha40);
  const artifactDigestValid = requireString(promotion.artifactDigest, "artifactDigest", errors, digest);
  const provenanceDigestValid = requireString(promotion.provenanceDigest, "provenanceDigest", errors, digest);
  requireString(expectedSha, "current SHA", errors, sha40);
  if (promotion.sourceSha !== expectedSha) errors.push("promotion source SHA does not equal current checkout");
  if (!promotion.staging || !promotion.productionCandidate || !promotion.approval) return [...errors, "staging, approval and production candidate records are required"];
  if (promotion.staging.sourceSha !== promotion.sourceSha || promotion.productionCandidate.sourceSha !== promotion.sourceSha) errors.push("staging/production SHA mismatch");
  if (promotion.staging.artifactDigest !== promotion.artifactDigest || promotion.productionCandidate.artifactDigest !== promotion.artifactDigest) errors.push("no-rebuild invariant violated: staging and production candidate must use the exact artifact digest");
  requireString(promotion.staging.smokeEvidenceDigest, "staging.smokeEvidenceDigest", errors, digest);
  const attestationDigestValid = requireString(promotion.approval.attestationDigest, "approval.attestationDigest", errors, digest);
  const signatureAlgorithmValid = requireString(promotion.approval.signatureAlgorithm, "approval.signatureAlgorithm", errors, /^Ed25519$/);
  const signatureValid = requireString(promotion.approval.signature, "approval.signature", errors, /^[A-Za-z0-9_-]{86}$/);
  const approvedByValid = requireString(promotion.approval.approvedBy, "approval.approvedBy", errors);
  const authorityValid = requireString(promotion.approval.authority, "approval.authority", errors);
  const scopeValid = requireString(promotion.approval.scope, "approval.scope", errors);
  if (promotion.approval.status !== "APPROVED" || promotion.approval.residualRiskAccepted !== true) errors.push("explicit approval must accept residual risk and use APPROVED status");
  const stagingAt = Date.parse(String(promotion.staging.verifiedAt));
  const approvedAt = Date.parse(String(promotion.approval.approvedAt));
  const candidateAt = Date.parse(String(promotion.productionCandidate.createdAt));
  if (!isCurrentTime(promotion.staging.verifiedAt, now) || !isCurrentTime(promotion.approval.approvedAt, now) || !isCurrentTime(promotion.productionCandidate.createdAt, now)) errors.push("staging, approval and candidate timestamps must be current and bounded");
  if (Number.isFinite(stagingAt) && Number.isFinite(approvedAt) && stagingAt > approvedAt) errors.push("approval cannot predate staging verification");
  if (Number.isFinite(approvedAt) && Number.isFinite(candidateAt) && approvedAt > candidateAt) errors.push("production candidate cannot predate approval");
  const completeDecisionShape = typeof promotion.staging.sourceSha === "string"
    && typeof promotion.staging.artifactDigest === "string"
    && typeof promotion.staging.verifiedAt === "string"
    && typeof promotion.staging.smokeEvidenceDigest === "string"
    && typeof promotion.staging.smokeEvidencePath === "string"
    && typeof promotion.approval.approvedAt === "string"
    && typeof promotion.productionCandidate.sourceSha === "string"
    && typeof promotion.productionCandidate.artifactDigest === "string"
    && typeof promotion.productionCandidate.createdAt === "string"
    && sourceShaValid
    && artifactDigestValid
    && provenanceDigestValid
    && attestationDigestValid
    && signatureAlgorithmValid
    && signatureValid
    && approvedByValid
    && authorityValid
    && scopeValid;
  if (completeDecisionShape) {
    const approvalPayload = promotionApprovalPayload(promotion as Promotion);
    const expectedAttestationDigest = sha256(approvalPayload);
    if (promotion.approval.attestationDigest !== expectedAttestationDigest) errors.push("approval attestation digest does not bind the complete promotion decision");
    const approvalPublicKey = trustedApprovalPublicKey === undefined ? process.env.CVG_RELEASE_APPROVAL_PUBLIC_KEY?.trim() : trustedApprovalPublicKey?.trim();
    if (!approvalPublicKey) {
      errors.push("human approval authority public key is unavailable; approval remains blocked");
    } else {
      try {
        const key = createPublicKey(approvalPublicKey);
        if (key.asymmetricKeyType !== "ed25519") throw new Error("approval authority key must be Ed25519");
        const signature = Buffer.from(promotion.approval.signature, "base64url");
        if (signature.length !== 64 || !verifySignature(null, approvalPayload, key, signature)) throw new Error("approval signature is invalid");
      } catch (error) {
        errors.push(`human approval signature verification failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  let evidenceRootPath: string;
  try {
    evidenceRootPath = await requireExternalEvidenceRoot(evidenceRoot, root);
  } catch (error) {
    errors.push(`evidence root is not external: ${error instanceof Error ? error.message : String(error)}`);
    return errors;
  }
  const provenanceBytes = await boundFile(promotion.provenanceEvidencePath, "provenance evidence", evidenceRootPath, promotion.provenanceDigest ?? "", errors);
  const smokeBytes = await boundFile(promotion.staging.smokeEvidencePath, "staging smoke evidence", evidenceRootPath, promotion.staging.smokeEvidenceDigest ?? "", errors);
  if (smokeBytes) {
    try {
      const smokeEvidence: unknown = JSON.parse(smokeBytes.toString("utf8"));
      if (!containerSmokeEvidenceValid(smokeEvidence, promotion.sourceSha ?? "", promotion.artifactDigest ?? "", now)) {
        errors.push("staging smoke evidence must prove authenticated transport, durable outbox/effect, shutdown, replay idempotency and restart for the exact candidate");
      }
    } catch (error) {
      errors.push(`staging smoke evidence JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (provenanceBytes) {
    try {
      const provenance = JSON.parse(provenanceBytes.toString("utf8")) as Partial<ReleaseProvenance>;
      const containers = provenance.containers;
      const provenanceShape = provenance.schemaVersion === 1
        && typeof provenance.sourceSha === "string"
        && typeof provenance.ciSha === "string"
        && typeof provenance.sbomPath === "string"
        && typeof provenance.ciResultsDigest === "string"
        && typeof provenance.ciResultsPath === "string"
        && typeof provenance.artifactDigest === "string"
        && typeof provenance.manifestDigest === "string"
        && containers !== undefined
        && typeof containers.api === "string"
        && typeof containers.web === "string";
      if (!provenanceShape) errors.push("provenance evidence JSON shape is incomplete");
      else {
        if (provenance.sourceSha !== promotion.sourceSha) errors.push("provenance source SHA does not match promotion source SHA");
        if (provenance.ciSha !== promotion.sourceSha) errors.push("provenance CI SHA does not match promotion source SHA");
        if (provenance.artifactDigest !== promotion.artifactDigest) errors.push("provenance artifact digest does not match promotion artifact digest");
        if (!digest.test(provenance.sbomDigest ?? "") || !digest.test(provenance.ciResultsDigest ?? "")) errors.push("provenance SBOM/CI result digests are invalid");
        const sbomBytes = await boundFile(provenance.sbomPath, "provenance SBOM", evidenceRootPath, provenance.sbomDigest ?? "", errors);
        const ciBytes = await boundFile(provenance.ciResultsPath, "provenance CI results", evidenceRootPath, provenance.ciResultsDigest ?? "", errors);
        if (sbomBytes) {
          try {
            const sbom = JSON.parse(sbomBytes.toString("utf8")) as Record<string, unknown>;
            if (sbom.bomFormat !== "CycloneDX") errors.push("provenance SBOM is not a CycloneDX document");
          } catch (error) { errors.push(`provenance SBOM JSON is invalid: ${error instanceof Error ? error.message : String(error)}`); }
        }
        if (ciBytes) {
          try {
            const ci = JSON.parse(ciBytes.toString("utf8")) as Record<string, unknown>;
            if (ci.schemaVersion !== 1 || ci.sourceSha !== promotion.sourceSha || typeof ci.workflow !== "string" || typeof ci.runId !== "string" || !Array.isArray(ci.completedStages) || ci.completedStages.length < 2) errors.push("provenance CI results do not bind a completed workflow to the promotion SHA");
          } catch (error) { errors.push(`provenance CI results JSON is invalid: ${error instanceof Error ? error.message : String(error)}`); }
        }
        if (!digest.test(containers.api) || !digest.test(containers.web)) errors.push("provenance container digests are invalid");
        const { manifestDigest: _ignored, ...unsigned } = provenance as ReleaseProvenance;
        if (provenance.manifestDigest !== sha256(stable(unsigned as unknown as CanonicalValue))) errors.push("provenance manifest digest does not bind its JSON contents");
      }
    } catch (error) {
      errors.push(`provenance evidence JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return errors;
}

async function main(): Promise<void> {
  try {
    const path = option("--manifest");
    if (!path) throw new Error("provide --manifest <promotion.json>");
    const value = JSON.parse(await readFile(isAbsolute(path) ? path : resolve(root, path), "utf8")) as Promotion;
    const errors = await promotionInvariantErrors(value, currentSha(), resolve(process.env.CVG_PROMOTION_EVIDENCE_ROOT ?? resolve(root, "artifacts/operational-proof")));
    if (errors.length) throw new Error(errors.join("; "));
    process.stdout.write(`PROMOTION_INVARIANT_VERIFIED sha=${value.sourceSha} artifact=${value.artifactDigest} noRebuild=true evidence=bound\n`);
  } catch (error) {
    process.stderr.write(`PROMOTION_BLOCKED ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)) : false;
if (entrypoint) await main();
