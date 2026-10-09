import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildSubjectManifest } from "./subject-manifest.ts";

export const AUD26_EVIDENCE_SNAPSHOT_PATH = "artifacts/aud26/evidence-snapshot.json";
export const AUD26_EVIDENCE_ARTIFACTS = [
  "artifacts/aud26/control-plane.json",
  "artifacts/aud26/local-gates.json",
  "artifacts/aud26/visual-qa.json",
  "artifacts/aud26/external-gates.json"
] as const;

const AUD26_REQUIRED_EXECUTION_ARTIFACTS = new Set<string>([
  "artifacts/aud26/control-plane.json",
  "artifacts/aud26/local-gates.json",
  "artifacts/aud26/visual-qa.json"
]);

type Aud26EvidenceArtifact = {
  path: string;
  digest: string;
  modifiedAt: string;
  observedAt: string;
  status: string;
};

export type Aud26EvidenceSnapshot = {
  schemaVersion: 1;
  capturedAt: string;
  sourceSha: string;
  candidateFingerprint: string;
  worktree: "MODIFIED" | "CLEAN";
  program: "CVG-AUD26";
  artifacts: Aud26EvidenceArtifact[];
};

const root = process.cwd();
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/;
const sha256 = (value: string | Buffer): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function headSha(): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error("could not resolve HEAD");
  return result.stdout.trim();
}

function worktreeState(): "MODIFIED" | "CLEAN" {
  const result = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
  return result.stdout.trim() ? "MODIFIED" : "CLEAN";
}

function readEvidence(path: string): Record<string, unknown> {
  const value = JSON.parse(readFileSync(resolve(root, path), "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must contain a JSON object`);
  return value as Record<string, unknown>;
}

function artifactStatus(value: Record<string, unknown>, path: string): { observedAt: string; status: string } {
  const observedAt = typeof value.observedAt === "string" ? value.observedAt : null;
  const status = typeof value.status === "string" ? value.status : null;
  if (!observedAt || !Number.isFinite(Date.parse(observedAt))) throw new Error(`${path} must declare an ISO observedAt`);
  if (!status || !status.trim()) throw new Error(`${path} must declare an explicit status`);
  return { observedAt, status };
}

export function captureAud26Evidence(): Aud26EvidenceSnapshot {
  const subject = buildSubjectManifest(root);
  const sourceSha = headSha();
  const capturedAt = new Date().toISOString();
  const artifacts = AUD26_EVIDENCE_ARTIFACTS.map((path) => {
    const absolute = resolve(root, path);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) throw new Error(`${path} is missing or not a regular file`);
    const bytes = readFileSync(absolute);
    const value = readEvidence(path);
    if (value.program !== "CVG-AUD26" || value.sourceSha !== sourceSha || value.candidateFingerprint !== subject.fingerprint) throw new Error(`${path} is not bound to the current AUD26 subject`);
      const metadata = artifactStatus(value, path);
      if (AUD26_REQUIRED_EXECUTION_ARTIFACTS.has(path) && metadata.status === "NOT_RUN") throw new Error(`${path} cannot be captured while status is NOT_RUN`);
      return { path, digest: sha256(bytes), modifiedAt: statSync(absolute).mtime.toISOString(), ...metadata };
  });
  return { schemaVersion: 1, capturedAt, sourceSha, candidateFingerprint: subject.fingerprint, worktree: worktreeState(), program: "CVG-AUD26", artifacts };
}

export function verifyAud26Evidence(snapshot: Aud26EvidenceSnapshot, now = Date.now()): string[] {
  const errors: string[] = [];
  if (snapshot.schemaVersion !== 1 || snapshot.program !== "CVG-AUD26") errors.push("AUD26 evidence snapshot schema/program is invalid");
  if (!SOURCE_SHA_PATTERN.test(snapshot.sourceSha)) errors.push(`AUD26 evidence source SHA ${snapshot.sourceSha} is not a commit SHA`);
  if (!FINGERPRINT_PATTERN.test(snapshot.candidateFingerprint)) errors.push(`AUD26 evidence fingerprint ${snapshot.candidateFingerprint} is invalid`);
  // AUD26 is historical input to AUD27. Its identity must be internally
  // consistent, but it must not be rebound to the current AUD27 subject.
  const captured = Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(captured) || captured > now + 5 * 60_000) errors.push("AUD26 evidence capturedAt is invalid or in the future");
  if (!Array.isArray(snapshot.artifacts) || snapshot.artifacts.length !== AUD26_EVIDENCE_ARTIFACTS.length || snapshot.artifacts.map((entry) => entry.path).join("\n") !== AUD26_EVIDENCE_ARTIFACTS.join("\n")) errors.push("AUD26 evidence artifact inventory is not exact");
  for (const entry of Array.isArray(snapshot.artifacts) ? snapshot.artifacts : []) {
    try {
      const absolute = resolve(root, entry.path);
      const bytes = readFileSync(absolute);
      const value = readEvidence(entry.path);
      const metadata = artifactStatus(value, entry.path);
      if (AUD26_REQUIRED_EXECUTION_ARTIFACTS.has(entry.path) && metadata.status === "NOT_RUN") errors.push(`${entry.path} is NOT_RUN; current execution evidence is required`);
      if (sha256(bytes) !== entry.digest) errors.push(`${entry.path} digest differs from the snapshot`);
      // Git does not preserve modification times, so a fresh checkout cannot
      // reproduce modifiedAt; the digest above is what binds the bytes.
      if (metadata.observedAt !== entry.observedAt || metadata.status !== entry.status) errors.push(`${entry.path} status metadata differs from the snapshot`);
      if (value.sourceSha !== snapshot.sourceSha || value.candidateFingerprint !== snapshot.candidateFingerprint) errors.push(`${entry.path} is not bound to the historical snapshot subject`);
    } catch (error) {
      errors.push(`${entry.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return errors;
}

async function main(): Promise<void> {
  const capture = process.argv.includes("--capture");
  const snapshot = capture ? captureAud26Evidence() : JSON.parse(readFileSync(resolve(root, AUD26_EVIDENCE_SNAPSHOT_PATH), "utf8")) as Aud26EvidenceSnapshot;
  if (capture) writeFileSync(resolve(root, AUD26_EVIDENCE_SNAPSHOT_PATH), `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  const errors = verifyAud26Evidence(snapshot);
  if (errors.length > 0) {
    process.stderr.write(`AUD26_EVIDENCE_BLOCKED ${errors.join("; ")}\n`);
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`AUD26_EVIDENCE_VERIFIED fingerprint=${snapshot.candidateFingerprint} artifacts=${snapshot.artifacts.length}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
