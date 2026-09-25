import { createHash } from "node:crypto";
import { access, lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSubjectManifest } from "./subject-manifest.ts";
import { requireExternalEvidenceRoot } from "./evidence-boundary.ts";

/**
 * AUD27-005: validate the external evidence-root contract without treating a
 * local marker as promotion evidence.  The root is intentionally verified by
 * a separate command because it is an external dependency of the control
 * plane, not a source artifact that can be made green by editing the subject.
 */

export const AUD27_EVIDENCE_MANIFEST_FILE = "package-manifest.json";
export const AUD27_EVIDENCE_INTEGRITY_FILE = "package-integrity.json";

const SOURCE_SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const FINGERPRINT = /^sha256:[a-f0-9]{64}$/;

export const AUD27_EVIDENCE_READ_LIMITS = Object.freeze({
  manifestBytes: 1 * 1024 * 1024,
  integrityBytes: 64 * 1024,
  packageBytes: 1 * 1024 * 1024,
  detachedBytes: 1 * 1024 * 1024,
  artifactBytes: 16 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
  artifacts: 512,
  pathCharacters: 1_024
});

type EvidenceStatus = "LOCAL_SYNTHETIC_ONLY" | "EXTERNAL_AUTHORITY_VERIFIED";
type AnchorStatus = "NOT_PROVEN" | "VERIFIED";
type AuthorityStatus = "UNAVAILABLE" | "VERIFIED";
type RecoveryStatus = "NOT_EXECUTED" | "VERIFIED";

export type Aud27EvidenceArtifact = {
  path: string;
  digest: string;
};

export type Aud27EvidenceAnchor = {
  status: AnchorStatus;
  path?: string;
  digest?: string;
};

export type Aud27EvidenceAuthority = {
  status: AuthorityStatus;
  authorityId?: string;
  attestationPath?: string;
  attestationDigest?: string;
};

export type Aud27EvidenceRecovery = {
  status: RecoveryStatus;
  runbook: string;
  restoreProcedure: string;
  quarantineOnTamper: true;
  evidencePath?: string;
  evidenceDigest?: string;
};

export type Aud27EvidenceManifest = {
  schemaVersion: 1;
  kind: "cvg-aud27-evidence-root-manifest";
  packagePath: string;
  packageDigest: string;
  sourceSha: string;
  subjectFingerprint: string;
  status: EvidenceStatus;
  artifacts: Aud27EvidenceArtifact[];
  anchor: Aud27EvidenceAnchor;
  authority: Aud27EvidenceAuthority;
  recovery: Aud27EvidenceRecovery;
  limitations: string[];
};

export type Aud27EvidencePackage = {
  schemaVersion: 1;
  kind: "cvg-aud27-evidence-package";
  status: EvidenceStatus;
  sourceSha: string;
  subjectFingerprint: string;
  artifacts: Aud27EvidenceArtifact[];
  anchor: Aud27EvidenceAnchor;
  authority: Aud27EvidenceAuthority;
  recovery: Aud27EvidenceRecovery;
  limitations: string[];
};

type Aud27EvidenceIntegrity = {
  schemaVersion: 1;
  kind: "cvg-aud27-evidence-integrity";
  manifestPath: typeof AUD27_EVIDENCE_MANIFEST_FILE;
  manifestDigest: string;
  packagePath: string;
  packageDigest: string;
};

export type Aud27EvidenceRootResult = {
  status: "PASS" | "BLOCKED" | "FAIL";
  root: string | null;
  errors: string[];
  limitations: string[];
  manifest?: Aud27EvidenceManifest;
};

type FileRead = { bytes: Buffer; path: string };
type EvidenceReadContext = {
  root: string;
  rootDevice: number;
  rootInode: number;
  bytesRead: number;
};

function digest(bytes: string | Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasFallbackReference(value: string): boolean {
  return /aud24|cvg-aud24-evidence/i.test(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return stable(left) === stable(right);
  } catch {
    return false;
  }
}

function stable(value: unknown, state = { nodes: 0 }, depth = 0): string {
  state.nodes += 1;
  if (depth > 32 || state.nodes > 10_000) throw new Error("evidence object exceeds structural comparison limits");
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((item) => stable(item, state, depth + 1)).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + stable(record[key], state, depth + 1)).join(",") + "}";
}

function invalidPath(value: string): boolean {
  return value.length > AUD27_EVIDENCE_READ_LIMITS.pathCharacters || isAbsolute(value) || value.split(/[\\/]/).some((part) => part === "..") || hasFallbackReference(value);
}

function isWithinRoot(root: string, path: string): boolean {
  const child = relative(root, path);
  return child.length > 0 && child !== ".." && !child.startsWith(".." + sep) && !isAbsolute(child);
}

function sameFileIdentity(left: { dev: number; ino: number; isFile(): boolean }, right: { dev: number; ino: number; isFile(): boolean }): boolean {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino;
}

function sameFileVersion(left: { size: number; mtimeMs: number; ctimeMs: number }, right: { size: number; mtimeMs: number; ctimeMs: number }): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function assertRootIdentity(context: EvidenceReadContext): Promise<void> {
  const [stats, canonicalPath] = await Promise.all([lstat(context.root), realpath(context.root)]);
  if (stats.isSymbolicLink() || !stats.isDirectory() || stats.dev !== context.rootDevice || stats.ino !== context.rootInode || canonicalPath !== context.root) {
    throw new Error("evidence root changed during verification");
  }
}

async function readHandleBounded(context: EvidenceReadContext, handle: FileHandle, expectedSize: number, maxBytes: number, label: string): Promise<Buffer> {
  if (expectedSize > maxBytes) throw new Error(label + " exceeds the bounded read limit (" + maxBytes + " bytes)");
  const bytes = Buffer.allocUnsafe(expectedSize + 1);
  let total = 0;
  while (total < bytes.length) {
    const { bytesRead } = await handle.read(bytes, total, bytes.length - total, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    context.bytesRead += bytesRead;
  }
  if (total > maxBytes) throw new Error(label + " exceeds the bounded read limit (" + maxBytes + " bytes)");
  if (total !== expectedSize) throw new Error(label + " changed while being read");
  return bytes.subarray(0, total);
}

async function readBoundedFile(context: EvidenceReadContext, candidate: string, label: string, maxFileBytes: number, errors: string[]): Promise<FileRead | null> {
  if (!nonEmpty(candidate) || invalidPath(candidate)) {
    errors.push(label + " path is invalid or references a forbidden AUD24 fallback");
    return null;
  }
  let handle: FileHandle | null = null;
  try {
    await assertRootIdentity(context);
    const path = resolve(context.root, candidate);
    const canonicalPath = await realpath(path);
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile() || !isWithinRoot(context.root, canonicalPath)) {
      throw new Error("must be a regular non-symlink file beneath the evidence root");
    }
    const remainingBytes = AUD27_EVIDENCE_READ_LIMITS.totalBytes - context.bytesRead;
    if (stats.size > maxFileBytes) throw new Error(label + " exceeds the bounded read limit (" + maxFileBytes + " bytes)");
    if (stats.size > remainingBytes) throw new Error(label + " exceeds the aggregate evidence read limit (" + AUD27_EVIDENCE_READ_LIMITS.totalBytes + " bytes)");

    const noFollow = constants.O_NOFOLLOW ?? 0;
    const nonBlocking = constants.O_NONBLOCK ?? 0;
    handle = await open(canonicalPath, constants.O_RDONLY | noFollow | nonBlocking);
    const openedStats = await handle.stat();
    const [pathStatsAfterOpen, canonicalPathAfterOpen] = await Promise.all([lstat(path), realpath(path)]);
    await assertRootIdentity(context);
    if (pathStatsAfterOpen.isSymbolicLink() || canonicalPathAfterOpen !== canonicalPath || !isWithinRoot(context.root, canonicalPathAfterOpen) || !sameFileIdentity(stats, openedStats) || !sameFileIdentity(stats, pathStatsAfterOpen)) {
      throw new Error("file path changed during evidence verification");
    }
    if (openedStats.size > maxFileBytes) throw new Error(label + " exceeds the bounded read limit (" + maxFileBytes + " bytes)");
    if (openedStats.size > remainingBytes) throw new Error(label + " exceeds the aggregate evidence read limit (" + AUD27_EVIDENCE_READ_LIMITS.totalBytes + " bytes)");

    const bytes = await readHandleBounded(context, handle, openedStats.size, Math.min(maxFileBytes, remainingBytes), label);
    const openedStatsAfterRead = await handle.stat();
    const [pathStatsAfterRead, canonicalPathAfterRead] = await Promise.all([lstat(path), realpath(path)]);
    await assertRootIdentity(context);
    if (pathStatsAfterRead.isSymbolicLink() || canonicalPathAfterRead !== canonicalPath || !isWithinRoot(context.root, canonicalPathAfterRead) || !sameFileIdentity(openedStats, pathStatsAfterRead) || !sameFileVersion(openedStats, openedStatsAfterRead) || !sameFileVersion(openedStats, pathStatsAfterRead)) {
      throw new Error("file changed during evidence verification");
    }
    return { bytes, path: canonicalPath };
  } catch (error) {
    errors.push(label + " " + (error instanceof Error ? error.message : String(error)));
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function validateArtifactShape(value: unknown, label: string, errors: string[]): value is Aud27EvidenceArtifact {
  if (!isRecord(value) || !nonEmpty(value.path) || !DIGEST.test(String(value.digest)) || invalidPath(value.path)) {
    errors.push(`${label} is invalid`);
    return false;
  }
  return true;
}

function validateBindingShape(value: unknown, label: string, errors: string[]): value is Aud27EvidenceAnchor | Aud27EvidenceAuthority {
  if (!isRecord(value) || typeof value.status !== "string") {
    errors.push(`${label} is invalid`);
    return false;
  }
  return true;
}

function validateRecovery(value: unknown, errors: string[]): value is Aud27EvidenceRecovery {
  if (!isRecord(value) || (value.status !== "NOT_EXECUTED" && value.status !== "VERIFIED") || !nonEmpty(value.runbook) || !nonEmpty(value.restoreProcedure) || value.quarantineOnTamper !== true) {
    errors.push("recovery contract must include a runbook, restore procedure and quarantine-on-tamper=true");
    return false;
  }
  const fallback = hasFallbackReference(value.runbook) || hasFallbackReference(value.restoreProcedure);
  if (fallback) errors.push("recovery contract references a forbidden AUD24 fallback");
  if (value.status === "VERIFIED" && (!nonEmpty(value.evidencePath) || !DIGEST.test(String(value.evidenceDigest)) || invalidPath(value.evidencePath))) {
    errors.push("verified recovery requires a bounded evidence path and digest");
  }
  if (nonEmpty(value.evidencePath) && invalidPath(value.evidencePath)) errors.push("recovery evidence path is invalid or references a forbidden AUD24 fallback");
  if (value.evidencePath !== undefined && !DIGEST.test(String(value.evidenceDigest))) errors.push("recovery evidence digest is invalid");
  return !fallback;
}

function validateEvidenceManifest(value: unknown, errors: string[]): value is Aud27EvidenceManifest {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.kind !== "cvg-aud27-evidence-root-manifest" || !nonEmpty(value.packagePath) || invalidPath(value.packagePath) || !DIGEST.test(String(value.packageDigest)) || !SOURCE_SHA.test(String(value.sourceSha)) || !FINGERPRINT.test(String(value.subjectFingerprint)) || (value.status !== "LOCAL_SYNTHETIC_ONLY" && value.status !== "EXTERNAL_AUTHORITY_VERIFIED") || !Array.isArray(value.artifacts) || !Array.isArray(value.limitations)) {
    errors.push("AUD27 evidence package manifest shape is invalid");
    return false;
  }
  if (value.artifacts.length > AUD27_EVIDENCE_READ_LIMITS.artifacts) {
    errors.push("AUD27 evidence package manifest exceeds the artifact count limit");
    return false;
  }
  if (value.limitations.length > 1_024 || !value.limitations.every((item) => typeof item === "string" && item.length <= 4_096)) {
    errors.push("AUD27 evidence package manifest limitations exceed structural limits");
    return false;
  }
  const artifactErrors: string[] = [];
  value.artifacts.forEach((artifact, index) => validateArtifactShape(artifact, `manifest artifact ${index}`, artifactErrors));
  errors.push(...artifactErrors);
  validateBindingShape(value.anchor, "manifest anchor", errors);
  validateBindingShape(value.authority, "manifest authority", errors);
  validateRecovery(value.recovery, errors);
  if (value.artifacts.length === 0 && value.status === "EXTERNAL_AUTHORITY_VERIFIED") errors.push("externally verified AUD27 package must list at least one evidence artifact");
  return errors.length === 0;
}

function validateEvidencePackage(value: unknown, errors: string[]): value is Aud27EvidencePackage {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.kind !== "cvg-aud27-evidence-package" || (value.status !== "LOCAL_SYNTHETIC_ONLY" && value.status !== "EXTERNAL_AUTHORITY_VERIFIED") || !SOURCE_SHA.test(String(value.sourceSha)) || !FINGERPRINT.test(String(value.subjectFingerprint)) || !Array.isArray(value.artifacts) || !Array.isArray(value.limitations)) {
    errors.push("AUD27 evidence package shape is invalid");
    return false;
  }
  if (value.artifacts.length > AUD27_EVIDENCE_READ_LIMITS.artifacts) {
    errors.push("AUD27 evidence package exceeds the artifact count limit");
    return false;
  }
  if (value.limitations.length > 1_024 || !value.limitations.every((item) => typeof item === "string" && item.length <= 4_096)) {
    errors.push("AUD27 evidence package limitations exceed structural limits");
    return false;
  }
  value.artifacts.forEach((artifact, index) => validateArtifactShape(artifact, `package artifact ${index}`, errors));
  validateBindingShape(value.anchor, "package anchor", errors);
  validateBindingShape(value.authority, "package authority", errors);
  validateRecovery(value.recovery, errors);
  return errors.length === 0;
}

async function verifyDetachedBinding(context: EvidenceReadContext, binding: Aud27EvidenceAnchor | Aud27EvidenceAuthority, label: string, errors: string[]): Promise<void> {
  if (binding.status === "NOT_PROVEN" || binding.status === "UNAVAILABLE") return;
  if (binding.status !== "VERIFIED") {
    errors.push(`${label} status is invalid`);
    return;
  }
  const isAuthority = "attestationPath" in binding;
  const pathValue = isAuthority ? (binding as Aud27EvidenceAuthority).attestationPath : (binding as Aud27EvidenceAnchor).path;
  const digestValue = isAuthority ? (binding as Aud27EvidenceAuthority).attestationDigest : (binding as Aud27EvidenceAnchor).digest;
  if (!nonEmpty(pathValue) || !DIGEST.test(String(digestValue))) {
    errors.push(`${label} VERIFIED status requires a bounded attestation path and digest`);
    return;
  }
  const file = await readBoundedFile(context, pathValue, label + " attestation", AUD27_EVIDENCE_READ_LIMITS.detachedBytes, errors);
  if (file && digest(file.bytes) !== digestValue) errors.push(`${label} attestation digest mismatch`);
}

async function verifyRecoveryEvidence(context: EvidenceReadContext, recovery: Aud27EvidenceRecovery, errors: string[]): Promise<void> {
  if (recovery.status !== "VERIFIED" || !recovery.evidencePath || !recovery.evidenceDigest) return;
  const file = await readBoundedFile(context, recovery.evidencePath, "recovery attestation", AUD27_EVIDENCE_READ_LIMITS.detachedBytes, errors);
  if (file && digest(file.bytes) !== recovery.evidenceDigest) errors.push("recovery attestation digest mismatch");
}

async function verifyPackageFiles(context: EvidenceReadContext, manifest: Aud27EvidenceManifest, integrity: Aud27EvidenceIntegrity, packageFile: FileRead, errors: string[]): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageFile.bytes.toString("utf8"));
  } catch (error) {
    errors.push(`AUD27 evidence package JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const packageErrors: string[] = [];
  if (!validateEvidencePackage(parsed, packageErrors)) {
    errors.push(...packageErrors);
    return;
  }
  const evidencePackage = parsed as Aud27EvidencePackage;
  if (evidencePackage.sourceSha !== manifest.sourceSha || evidencePackage.subjectFingerprint !== manifest.subjectFingerprint) errors.push("evidence package is not bound to the manifest candidate");
  if (evidencePackage.status !== manifest.status) errors.push("evidence package status diverges from the manifest");
  if (!sameJson(evidencePackage.artifacts, manifest.artifacts) || !sameJson(evidencePackage.anchor, manifest.anchor) || !sameJson(evidencePackage.authority, manifest.authority) || !sameJson(evidencePackage.recovery, manifest.recovery)) errors.push("evidence package contents diverge from the manifest contract");
  if (integrity.packagePath !== manifest.packagePath || integrity.packageDigest !== manifest.packageDigest || digest(packageFile.bytes) !== manifest.packageDigest) errors.push("evidence package digest does not match the manifest and detached integrity record");
  await verifyDetachedBinding(context, manifest.anchor, "anchor", errors);
  await verifyDetachedBinding(context, manifest.authority, "authority", errors);
  await verifyRecoveryEvidence(context, manifest.recovery, errors);
  const seen = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (seen.has(artifact.path)) {
      errors.push(`duplicate evidence artifact path: ${artifact.path}`);
      continue;
    }
    seen.add(artifact.path);
    const artifactFile = await readBoundedFile(context, artifact.path, "evidence artifact " + artifact.path, AUD27_EVIDENCE_READ_LIMITS.artifactBytes, errors);
    if (artifactFile && digest(artifactFile.bytes) !== artifact.digest) errors.push(`evidence artifact digest mismatch: ${artifact.path}`);
  }
}

function pushAuthorityLimitations(manifest: Aud27EvidenceManifest, limitations: string[]): void {
  if (manifest.status === "LOCAL_SYNTHETIC_ONLY") limitations.push("package is LOCAL_SYNTHETIC_ONLY; it is not an independent authority receipt");
  if (manifest.anchor.status !== "VERIFIED") limitations.push("independent candidate anchor is NOT_PROVEN");
  if (manifest.authority.status !== "VERIFIED") limitations.push("external evidence authority is unavailable");
  if (manifest.recovery.status !== "VERIFIED") limitations.push("tamper/recovery procedure is declared but not independently executed");
}

export async function verifyAud27EvidenceRoot(options: {
  sourceRoot: string;
  evidenceRoot: string;
  expectedSourceSha: string;
  expectedSubjectFingerprint: string;
}): Promise<Aud27EvidenceRootResult> {
  const errors: string[] = [];
  const limitations: string[] = [];
  let root: string;
  let context: EvidenceReadContext;
  try {
    root = await requireExternalEvidenceRoot(options.evidenceRoot, options.sourceRoot);
    if (hasFallbackReference(basename(root))) errors.push("evidence root references the forbidden AUD24 fallback");
    await access(root, constants.W_OK);
    const rootStats = await lstat(root);
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) throw new Error("evidence root must remain a regular directory");
    context = { root, rootDevice: rootStats.dev, rootInode: rootStats.ino, bytesRead: 0 };
    await assertRootIdentity(context);
  } catch (error) {
    return { status: "FAIL", root: null, errors: [error instanceof Error ? error.message : String(error)], limitations };
  }

  const manifestFile = await readBoundedFile(context, AUD27_EVIDENCE_MANIFEST_FILE, "AUD27 package manifest", AUD27_EVIDENCE_READ_LIMITS.manifestBytes, errors);
  const integrityFile = await readBoundedFile(context, AUD27_EVIDENCE_INTEGRITY_FILE, "AUD27 package integrity record", AUD27_EVIDENCE_READ_LIMITS.integrityBytes, errors);
  if (!manifestFile || !integrityFile) return { status: "FAIL", root, errors, limitations };

  let manifestValue: unknown;
  let integrityValue: unknown;
  try {
    manifestValue = JSON.parse(manifestFile.bytes.toString("utf8"));
    integrityValue = JSON.parse(integrityFile.bytes.toString("utf8"));
  } catch (error) {
    return { status: "FAIL", root, errors: [`AUD27 evidence root JSON is invalid: ${error instanceof Error ? error.message : String(error)}`], limitations };
  }
  const manifestErrors: string[] = [];
  if (!validateEvidenceManifest(manifestValue, manifestErrors)) errors.push(...manifestErrors);
  const integrity = integrityValue as Partial<Aud27EvidenceIntegrity>;
  if (!isRecord(integrityValue) || integrity.schemaVersion !== 1 || integrity.kind !== "cvg-aud27-evidence-integrity" || integrity.manifestPath !== AUD27_EVIDENCE_MANIFEST_FILE || !DIGEST.test(String(integrity.manifestDigest)) || !nonEmpty(integrity.packagePath) || invalidPath(integrity.packagePath) || !DIGEST.test(String(integrity.packageDigest))) errors.push("AUD27 package integrity record shape is invalid");
  if (errors.length > 0 || !validateEvidenceManifest(manifestValue, [])) return { status: "FAIL", root, errors, limitations };

  const manifest = manifestValue as Aud27EvidenceManifest;
  if (manifest.status === "LOCAL_SYNTHETIC_ONLY" && (manifest.anchor.status !== "NOT_PROVEN" || manifest.authority.status !== "UNAVAILABLE" || manifest.recovery.status !== "NOT_EXECUTED")) {
    errors.push("LOCAL_SYNTHETIC_ONLY packages must declare anchor NOT_PROVEN, authority UNAVAILABLE and recovery NOT_EXECUTED");
  }
  if (manifest.status === "EXTERNAL_AUTHORITY_VERIFIED" && (manifest.anchor.status !== "VERIFIED" || manifest.authority.status !== "VERIFIED" || manifest.recovery.status !== "VERIFIED")) {
    errors.push("EXTERNAL_AUTHORITY_VERIFIED packages require verified anchor, authority and recovery evidence");
  }
  if (manifest.sourceSha !== options.expectedSourceSha) errors.push("AUD27 evidence package source SHA does not match the current candidate");
  if (manifest.subjectFingerprint !== options.expectedSubjectFingerprint) errors.push("AUD27 evidence package subject fingerprint does not match the current candidate");
  if (digest(manifestFile.bytes) !== integrity.manifestDigest) errors.push("AUD27 package manifest digest mismatch");
  if (hasFallbackReference(manifest.packagePath) || manifest.artifacts.some((artifact) => hasFallbackReference(artifact.path))) errors.push("AUD27 evidence package references a forbidden AUD24 fallback");
  if (manifest.packagePath === AUD27_EVIDENCE_MANIFEST_FILE || manifest.packagePath === AUD27_EVIDENCE_INTEGRITY_FILE) errors.push("AUD27 package path must be distinct from its manifest and integrity record");

  const packageFile = await readBoundedFile(context, manifest.packagePath, "AUD27 evidence package", AUD27_EVIDENCE_READ_LIMITS.packageBytes, errors);
  if (packageFile) await verifyPackageFiles(context, manifest, integrity as Aud27EvidenceIntegrity, packageFile, errors);
  if (errors.length > 0) return { status: "FAIL", root, errors, limitations, manifest };

  pushAuthorityLimitations(manifest, limitations);
  if (limitations.length > 0) return { status: "BLOCKED", root, errors, limitations, manifest };
  return { status: "PASS", root, errors, limitations, manifest };
}

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const evidenceRoot = process.env.CVG_EVIDENCE_ROOT?.trim() || resolve(root, "..", "cvg-aud27-evidence");
  const subject = buildSubjectManifest(root);
  const result = await verifyAud27EvidenceRoot({
    sourceRoot: root,
    evidenceRoot,
    expectedSourceSha: subject.manifest.sourceSha,
    expectedSubjectFingerprint: subject.fingerprint
  });
  process.stdout.write(`AUD27_EVIDENCE_ROOT_${result.status} root=${result.root ?? evidenceRoot}\n`);
  for (const limitation of result.limitations) process.stdout.write(`LIMITATION ${limitation}\n`);
  for (const error of result.errors) process.stderr.write(`FAIL ${error}\n`);
  if (result.status !== "PASS") process.exitCode = 1;
}
