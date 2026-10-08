import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const SUBJECT_MANIFEST_SCHEMA_VERSION = 1 as const;

/**
 * Control-plane ledgers and generated evidence are outputs of a qualification,
 * not inputs to the code subject. Including them would make their fingerprint
 * fields self-referential and would allow evidence rewrites to masquerade as a
 * source change. The Gauntlet quality bar is pinned and checked independently
 * by the Gauntlet state manager, so its mutable state and writer lock do not
 * belong in the candidate fingerprint.
 */
export const SUBJECT_EXCLUDED_PREFIXES = [
  ".agent/",
  "artifacts/",
  ".gauntlet/",
  ".opencode/",
  ".git/",
  "node_modules/",
  "dist/",
  "coverage/",
  ".vite/"
] as const;

const SHA256_PREFIX = "sha256:";

type SubjectFile = {
  path: string;
  kind: "file" | "symlink";
  mode: string;
  digest: string;
};

export type SubjectManifest = {
  schemaVersion: typeof SUBJECT_MANIFEST_SCHEMA_VERSION;
  candidateRoot: string;
  evidenceRoot: string | null;
  sourceSha: string;
  indexEntriesDigest: string;
  status: string;
  stagedDiff: string;
  unstagedDiff: string;
  trackedFiles: SubjectFile[];
  untrackedFiles: SubjectFile[];
  configurationFiles: SubjectFile[];
  exclusions: readonly string[];
};

export type SubjectManifestResult = {
  manifest: SubjectManifest;
  fingerprint: string;
};

function sha256(value: string | Buffer): string {
  return `${SHA256_PREFIX}${createHash("sha256").update(value).digest("hex")}`;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

function git(root: string, args: string[], allowFailure = false): string {
  // Dirty-worktree qualification diffs can exceed Node's small default
  // spawnSync buffer; truncation would make the subject manifest fail closed
  // for a repository that is otherwise readable and deterministic.
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0 && !allowFailure) throw new Error(`git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function pathExcluded(path: string): boolean {
  return SUBJECT_EXCLUDED_PREFIXES.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix));
}

function pathspecs(): string[] {
  return [".", ...SUBJECT_EXCLUDED_PREFIXES.map((prefix) => `:(exclude)${prefix}**`)];
}

function parseNullSeparated(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

function digestPath(root: string, path: string): SubjectFile {
  const absolute = resolve(root, path);
  const stat = lstatSync(absolute);
  const mode = `0${(stat.mode & 0o7777).toString(8)}`;
  if (stat.isSymbolicLink()) return { path, kind: "symlink", mode, digest: sha256(`SYMLINK\0${readlinkSync(absolute)}`) };
  if (!stat.isFile()) throw new Error(`subject path is not a regular file: ${path}`);
  return { path, kind: "file", mode, digest: sha256(readFileSync(absolute)) };
}

function currentFiles(root: string, tracked: boolean): SubjectFile[] {
  // The index still lists an unstaged deletion. Its absence is bound by the
  // index digest, Git status and full binary diff below, not by reading a file
  // that no longer exists. Only Git-confirmed tracked deletions are omitted;
  // unexpected read failures and non-regular paths continue to fail closed.
  const deleted = tracked ? new Set(parseNullSeparated(git(root, ["ls-files", "--deleted", "-z", "--", ...pathspecs()]))) : new Set<string>();
  const args = tracked
    ? ["ls-files", "-z", "--", ...pathspecs()]
    : ["ls-files", "--others", "--exclude-standard", "-z", "--", ...pathspecs()];
  return parseNullSeparated(git(root, args))
    .filter((path) => !pathExcluded(path) && !deleted.has(path))
    .map((path) => digestPath(root, path))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function configurationFiles(files: SubjectFile[]): SubjectFile[] {
  return files.filter(({ path }) => (
    path === "package.json" ||
    path === "package-lock.json" ||
    path === "npm-shrinkwrap.json" ||
    path === "tsconfig.json" ||
    path.startsWith("tsconfig.") ||
    path === "playwright.config.ts" ||
    path.endsWith("/vite.config.ts") ||
    path.startsWith(".github/workflows/") ||
    path.startsWith("docker/") ||
    path.startsWith("db/migrations/")
  ));
}

function indexEntriesDigest(root: string): string {
  const entries = git(root, ["ls-files", "-s", "-z", "--", ...pathspecs()]);
  return sha256(entries);
}

function diff(root: string, cached: boolean): string {
  const args = ["diff", "--binary", "--full-index", "--no-ext-diff", "--no-renames"];
  if (cached) args.push("--cached");
  args.push("--", ...pathspecs());
  return git(root, args);
}

export function subjectFingerprint(manifest: SubjectManifest): string {
  // Absolute roots are diagnostic metadata, not subject bytes. Equivalent
  // checkouts in different directories must produce the same fingerprint.
  return sha256(stable({ ...manifest, candidateRoot: ".", evidenceRoot: manifest.evidenceRoot ? "<external>" : null }));
}

export function buildSubjectManifest(rootValue = process.cwd()): SubjectManifestResult {
  const root = realpathSync(resolve(rootValue));
  const trackedFiles = currentFiles(root, true);
  const untrackedFiles = currentFiles(root, false);
  const manifest: SubjectManifest = {
    schemaVersion: SUBJECT_MANIFEST_SCHEMA_VERSION,
    candidateRoot: root,
    evidenceRoot: process.env.CVG_EVIDENCE_ROOT?.trim() || resolve(root, "..", "cvg-aud27-evidence"),
    sourceSha: git(root, ["rev-parse", "HEAD"]),
    indexEntriesDigest: indexEntriesDigest(root),
    status: git(root, ["status", "--porcelain=v2", "--untracked-files=all", "--", ...pathspecs()]),
    stagedDiff: diff(root, true),
    unstagedDiff: diff(root, false),
    trackedFiles,
    untrackedFiles,
    configurationFiles: configurationFiles([...trackedFiles, ...untrackedFiles]),
    exclusions: SUBJECT_EXCLUDED_PREFIXES
  };
  return { manifest, fingerprint: subjectFingerprint(manifest) };
}

export function validateSubjectManifest(result: SubjectManifestResult, rootValue = process.cwd()): string[] {
  const errors: string[] = [];
  const root = realpathSync(resolve(rootValue));
  if (result.manifest.schemaVersion !== SUBJECT_MANIFEST_SCHEMA_VERSION) errors.push("unsupported subject manifest schema");
  if (result.manifest.candidateRoot !== root) errors.push("subject manifest candidate root does not match the verifier root");
  if (result.fingerprint !== subjectFingerprint(result.manifest)) errors.push("subject manifest fingerprint does not match its bytes");
  if (result.manifest.sourceSha !== git(root, ["rev-parse", "HEAD"])) errors.push("subject manifest source SHA does not match HEAD");
  const current = buildSubjectManifest(root);
  if (current.fingerprint !== result.fingerprint) errors.push("subject manifest does not match the current candidate bytes, modes, index or diffs");
  return errors;
}

export function evidenceRootIsExternal(rootValue = process.cwd()): boolean {
  const root = realpathSync(resolve(rootValue));
  const evidence = resolve(process.env.CVG_EVIDENCE_ROOT?.trim() || resolve(root, "..", "cvg-aud27-evidence"));
  const relativePath = relative(root, evidence);
  return Boolean(relativePath) && (relativePath.startsWith("..") || isAbsolute(relativePath));
}

export function subjectPathIsExcluded(path: string): boolean {
  return pathExcluded(path);
}
