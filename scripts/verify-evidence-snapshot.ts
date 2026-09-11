import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { EXPECTED_PROMPT_SHA256, PROMPT_REFERENCE, promptSha256 } from "./prompt-integrity.ts";

export const EVIDENCE_SNAPSHOT_PATH = "artifacts/operational-proof/evidence-snapshot.json";
export const SNAPSHOT_ARTIFACTS = [
  "artifacts/operational-proof/local-verification-2026-09-10.json",
  "artifacts/operational-proof/triple-aaa-evidence.json",
  "artifacts/operational-proof/pdp-universal-evidence.json",
  "artifacts/operational-proof/authoritative-write-evidence.json",
  "artifacts/operational-proof/audit-chain-evidence.json",
  "artifacts/operational-proof/browser-matrix-local-2026-09-10.json",
  "artifacts/operational-proof/postgres-real-local-2026-09-10.json",
  "artifacts/operational-proof/security-red-team-local.json",
  "artifacts/operational-proof/resource-pressure-local.json",
  "artifacts/operational-proof/runbook-execution-local.json"
] as const;

type SnapshotEntry = { path: string; digest: string; modifiedAt: string; declaredObservedAt: string | null };
export type EvidenceSnapshot = {
  schemaVersion: 1;
  capturedAt: string;
  sourceSha: string;
  worktree: "CLEAN" | "MODIFIED";
  prompt: { path: string; sha256: string };
  artifacts: SnapshotEntry[];
  runId: string;
};

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

function git(args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function jsonObservedAt(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.observedAt === "string") return record.observedAt;
  if (typeof record.finalVerification === "object" && record.finalVerification !== null && !Array.isArray(record.finalVerification)) {
    const nested = record.finalVerification as Record<string, unknown>;
    if (typeof nested.observedAt === "string") return nested.observedAt;
  }
  return null;
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * The two bound evidence artifacts intentionally repeat a small verification
 * summary for consumers that do not read the whole document.  A stale copy
 * must fail closed instead of becoming an apparently newer receipt.
 */
export function verifyEvidenceArtifactConsistency(pathValue: string, value: unknown): string[] {
  const errors: string[] = [];
  const rootRecord = jsonRecord(value);
  if (!rootRecord) return errors;
  if (pathValue === "artifacts/operational-proof/local-verification-2026-09-10.json") {
    const top = jsonRecord(rootRecord.finalVerification);
    const localSummary = jsonRecord(rootRecord.local);
    const local = jsonRecord(localSummary?.finalVerification);
    if (top && local) {
      for (const key of ["record", "observedAt", "tests", "static", "lint", "verdict", "globalVerdict"]) {
        if (JSON.stringify(top[key]) !== JSON.stringify(local[key])) errors.push(`${pathValue}: local.finalVerification.${key} diverges from top-level finalVerification`);
      }
    }
    if (top && localSummary) {
      for (const key of ["record", "observedAt", "globalVerdict"]) {
        if (JSON.stringify(top[key === "globalVerdict" ? "verdict" : key]) !== JSON.stringify(localSummary[key])) errors.push(`${pathValue}: local.${key} diverges from top-level finalVerification`);
      }
      const unit = jsonRecord(localSummary.unitIntegration);
      const tests = jsonRecord(localSummary.tests);
      if (unit && tests) {
        for (const key of ["total", "passed", "skipped", "failed"]) {
          if (JSON.stringify(unit[key]) !== JSON.stringify(tests[key])) errors.push(`${pathValue}: local.tests.${key} diverges from local.unitIntegration`);
        }
      }
      const browser = jsonRecord(localSummary.browser);
      const e2e = jsonRecord(localSummary.e2e);
      if (browser && e2e) {
        for (const key of ["tests", "passed", "skipped", "failed"]) {
          if (JSON.stringify(browser[key]) !== JSON.stringify(e2e[key])) errors.push(`${pathValue}: local.e2e.${key} diverges from local.browser`);
        }
      }
    }
  }
  if (pathValue === "artifacts/operational-proof/triple-aaa-evidence.json") {
    const local = jsonRecord(rootRecord.localVerification);
    const audit = jsonRecord(rootRecord.auditAddendum);
    if (local && audit) {
      for (const key of ["record", "observedAt", "globalVerdict"]) {
        if (JSON.stringify(local[key]) !== JSON.stringify(audit[key] ?? rootRecord[key])) errors.push(`${pathValue}: localVerification.${key} diverges from the current audit/root value`);
      }
    }
  }
  return errors;
}

async function regularFile(pathValue: string): Promise<{ bytes: Buffer; modifiedAt: string }> {
  const absolute = resolve(root, pathValue);
  const entry = await lstat(absolute);
  if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`${pathValue} must be a regular non-symlink file`);
  const canonical = await realpath(absolute);
  const outside = relative(root, canonical);
  if (outside.startsWith("..") || isAbsolute(outside)) throw new Error(`${pathValue} escapes the source root`);
  return { bytes: await readFile(canonical), modifiedAt: entry.mtime.toISOString() };
}

export async function createEvidenceSnapshot(): Promise<EvidenceSnapshot> {
  const capturedAt = new Date().toISOString();
  const sourceSha = git(["rev-parse", "HEAD"]);
  const worktree = git(["status", "--porcelain=v1", "--untracked-files=all"]).trim().length === 0 ? "CLEAN" : "MODIFIED";
  const prompt = await readFile(resolve(root, PROMPT_REFERENCE));
  const artifacts: SnapshotEntry[] = [];
  for (const path of SNAPSHOT_ARTIFACTS) {
    const { bytes, modifiedAt } = await regularFile(path);
    const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    artifacts.push({ path, digest: sha256(bytes), modifiedAt, declaredObservedAt: jsonObservedAt(parsed) });
  }
  const runId = sha256(JSON.stringify({ sourceSha, prompt: promptSha256(prompt), artifacts }));
  return { schemaVersion: 1, capturedAt, sourceSha, worktree, prompt: { path: PROMPT_REFERENCE, sha256: promptSha256(prompt) }, artifacts, runId };
}

export async function verifyEvidenceSnapshot(snapshot: EvidenceSnapshot, now = Date.now()): Promise<string[]> {
  const errors: string[] = [];
  if (snapshot.schemaVersion !== 1) errors.push("unsupported evidence snapshot schema");
  const currentSha = git(["rev-parse", "HEAD"]);
  if (snapshot.sourceSha !== currentSha) errors.push("evidence snapshot source SHA does not match HEAD");
  const currentWorktree: EvidenceSnapshot["worktree"] = git(["status", "--porcelain=v1", "--untracked-files=all"]).trim().length === 0 ? "CLEAN" : "MODIFIED";
  if (snapshot.worktree !== "CLEAN" && snapshot.worktree !== "MODIFIED") errors.push("evidence snapshot worktree state is invalid");
  else if (snapshot.worktree !== currentWorktree) errors.push(`evidence snapshot worktree state ${snapshot.worktree} does not match current state ${currentWorktree}`);
  const captured = Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(captured) || captured > now + 5 * 60_000 || captured < now - 7 * 24 * 60 * 60_000) errors.push("evidence snapshot capturedAt is outside the bounded evidence window");
  if (snapshot.prompt.path !== PROMPT_REFERENCE || snapshot.prompt.sha256 !== EXPECTED_PROMPT_SHA256) errors.push("evidence snapshot prompt binding is invalid");
  const prompt = await readFile(resolve(root, PROMPT_REFERENCE)).catch(() => null);
  if (!prompt || promptSha256(prompt) !== snapshot.prompt.sha256) errors.push("preserved prompt bytes do not match evidence snapshot");
  if (!Array.isArray(snapshot.artifacts) || snapshot.artifacts.length !== SNAPSHOT_ARTIFACTS.length || snapshot.artifacts.map((entry) => entry.path).join("\n") !== SNAPSHOT_ARTIFACTS.join("\n")) errors.push("evidence snapshot artifact inventory is not exact");
  for (const entry of snapshot.artifacts) {
    try {
      const { bytes, modifiedAt } = await regularFile(entry.path);
      if (sha256(bytes) !== entry.digest) errors.push(`${entry.path} bytes differ from the snapshot digest`);
      try {
        errors.push(...verifyEvidenceArtifactConsistency(entry.path, JSON.parse(bytes.toString("utf8"))));
      } catch (error) {
        errors.push(`${entry.path}: JSON parse failed while checking duplicated verification metadata (${error instanceof Error ? error.message : String(error)})`);
      }
      if (modifiedAt !== entry.modifiedAt) errors.push(`${entry.path} mtime differs from the snapshot`);
      const modified = Date.parse(entry.modifiedAt);
      if (!Number.isFinite(modified) || modified > now + 5 * 60_000 || modified < now - 7 * 24 * 60 * 60_000) errors.push(`${entry.path} modification time is outside the bounded evidence window`);
      if (entry.declaredObservedAt !== null) {
        const observed = Date.parse(entry.declaredObservedAt);
        if (!Number.isFinite(observed) || observed > now + 5 * 60_000 || observed < now - 7 * 24 * 60 * 60_000) errors.push(`${entry.path} declared observedAt is outside the bounded evidence window`);
      }
    } catch (error) {
      errors.push(`${entry.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const runId = sha256(JSON.stringify({ sourceSha: snapshot.sourceSha, prompt: snapshot.prompt.sha256, artifacts: snapshot.artifacts }));
  if (snapshot.runId !== runId) errors.push("evidence snapshot runId does not bind its source, prompt and artifact entries");
  return errors;
}

async function main(): Promise<void> {
  try {
    const snapshot = await createEvidenceSnapshot();
    const errors = await verifyEvidenceSnapshot(snapshot);
    if (errors.length) throw new Error(errors.join("; "));
    await writeFile(resolve(root, EVIDENCE_SNAPSHOT_PATH), `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    process.stdout.write(`EVIDENCE_SNAPSHOT_VERIFIED runId=${snapshot.runId} artifacts=${snapshot.artifacts.length} sha=${snapshot.sourceSha}\n`);
  } catch (error) {
    process.stderr.write(`EVIDENCE_SNAPSHOT_BLOCKED ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)) : false;
if (entrypoint) await main();
