import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Provenance = {
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

type CiResults = {
  schemaVersion: 1;
  sourceSha: string;
  workflow: string;
  runId: string;
  completedStages: string[];
  observedAt: string;
};

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sha40 = /^[a-f0-9]{40}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;

function fail(message: string): never { throw new Error(message); }
function sha256(value: string | Buffer): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stable(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key]!)}`).join(",")}}`;
}
function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1]?.trim();
  const prefix = `${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length).trim();
}
function git(args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) fail(`git ${args.join(" ")} failed`);
  return result.stdout.trim();
}
function requireSha(value: string | undefined, field: string): string {
  if (!value || !sha40.test(value)) fail(`${field} must be a 40-character lowercase Git SHA`);
  return value;
}
function requireDigest(value: string | undefined, field: string): string {
  if (!value || !digestPattern.test(value)) fail(`${field} must be an immutable sha256:<64 hex> digest`);
  return value;
}
function withoutManifestDigest(manifest: Provenance): Omit<Provenance, "manifestDigest"> {
  const { manifestDigest: _ignored, ...unsigned } = manifest;
  return unsigned;
}

async function migrationFingerprint(): Promise<{ version: string; digest: string }> {
  const directory = join(root, "db/migrations");
  const names = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  if (names.length === 0) fail("no SQL migrations were found");
  const records: Json[] = [];
  for (const name of names) records.push({ name, digest: sha256(await readFile(join(directory, name))) });
  return { version: names.at(-1)!, digest: sha256(stable(records)) };
}

async function immutableFileDigest(pathValue: string, label: string): Promise<string> {
  const absolute = resolve(root, pathValue);
  const stats = await lstat(absolute).catch(() => null);
  if (!stats || !stats.isFile() || stats.isSymbolicLink()) fail(`${label} must be a regular non-symlink file: ${pathValue}`);
  return sha256(await readFile(absolute));
}

/** Bind an external SBOM manifest field to the exact regular file bytes. */
export async function verifySbomDigest(expected: string, pathValue: string): Promise<void> {
  requireDigest(expected, "sbomDigest");
  const observed = await immutableFileDigest(pathValue, "SBOM");
  if (expected !== observed) fail(`SBOM digest does not match provenance manifest: expected ${expected}, observed ${observed}`);
}

async function verifyCiResults(pathValue: string, expectedDigest: string, expectedSha: string): Promise<void> {
  requireDigest(expectedDigest, "ciResultsDigest");
  const observed = await immutableFileDigest(pathValue, "CI results");
  if (observed !== expectedDigest) fail(`CI results digest does not match provenance manifest: expected ${expectedDigest}, observed ${observed}`);
  let parsed: CiResults;
  try { parsed = JSON.parse(await readFile(resolve(root, pathValue), "utf8")) as CiResults; } catch (error) { fail(`CI results JSON is invalid: ${error instanceof Error ? error.message : String(error)}`); }
  if (!ciResultsValid(parsed, expectedSha)) fail("CI results must bind the exact source SHA and completed CI stages");
}

export function ciResultsValid(value: unknown, expectedSha: string, now = Date.now()): value is CiResults {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const parsed = value as Partial<CiResults>;
  const observed = typeof parsed.observedAt === "string" ? Date.parse(parsed.observedAt) : Number.NaN;
  return parsed.schemaVersion === 1
    && parsed.sourceSha === expectedSha
    && sha40.test(parsed.sourceSha)
    && typeof parsed.workflow === "string" && parsed.workflow.trim().length > 0
    && typeof parsed.runId === "string" && parsed.runId.trim().length > 0
    && Array.isArray(parsed.completedStages)
    && parsed.completedStages.length >= 2
    && parsed.completedStages.every((stage) => typeof stage === "string" && stage.trim().length > 0)
    && Number.isFinite(observed)
    && observed <= now + 5 * 60 * 1_000
    && observed >= now - 7 * 24 * 60 * 60 * 1_000;
}

async function sourceDigest(relative: string): Promise<string> { return immutableFileDigest(relative, relative); }

async function createProvenance(): Promise<Provenance> {
  // CI writes the SBOM and provenance output below `artifacts/` before this
  // command runs. Those generated files are evidence, not source changes;
  // every tracked or non-artifact change still invalidates same-SHA release
  // provenance.
  const dirtySource = git(["status", "--porcelain"]).split(/\r?\n/).filter(Boolean).filter((line) => !line.slice(3).startsWith("artifacts/") && !line.slice(3).startsWith("./artifacts/"));
  if (dirtySource.length) fail(`refusing provenance generation from a dirty source worktree: ${dirtySource.join(", ")}`);
  const sourceSha = requireSha(git(["rev-parse", "HEAD"]), "source SHA");
  const ciSha = requireSha(process.env.GITHUB_SHA?.trim(), "CI SHA");
  if (sourceSha !== ciSha) fail(`same-SHA violation: checkout ${sourceSha} differs from CI ${ciSha}`);
  const sbom = argument("--sbom") ?? "artifacts/sbom.cdx.json";
  const sbomDigest = await immutableFileDigest(sbom, "SBOM");
  const ciResults = argument("--ci-results") ?? process.env.CVG_CI_RESULTS_PATH?.trim() ?? "artifacts/ci-results.json";
  const ciResultsDigest = await immutableFileDigest(ciResults, "CI results");
  await verifyCiResults(ciResults, ciResultsDigest, sourceSha);
  const api = requireDigest(argument("--api-digest") ?? process.env.CVG_API_IMAGE_DIGEST, "API container digest");
  const web = requireDigest(argument("--web-digest") ?? process.env.CVG_WEB_IMAGE_DIGEST, "web container digest");
  const deepseekExpectedEngineCommit = requireSha(process.env.CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT?.trim(), "DeepSeek expected engine commit");
  if (/^0{40}$/.test(deepseekExpectedEngineCommit)) fail("DeepSeek expected engine commit cannot be a placeholder");
  const migration = await migrationFingerprint();
  const unsigned: Omit<Provenance, "manifestDigest"> = {
    schemaVersion: 1,
    sourceSha,
    ciSha,
    buildTimestamp: new Date().toISOString(),
    sbomDigest,
    sbomPath: sbom,
    ciResultsDigest,
    ciResultsPath: ciResults,
    containers: { api, web },
    artifactDigest: sha256(stable({ sourceSha, sbomDigest, containers: { api, web }, migration, policyRevision: await sourceDigest("packages/agent-policy/src/index.ts"), toolRegistryDigest: sha256(stable({ harness: await sourceDigest("packages/harness/src/index.ts"), gateway: await sourceDigest("packages/agent-tools/src/index.ts") })), deepseekExpectedEngineCommit })),
    migration,
    policyRevision: await sourceDigest("packages/agent-policy/src/index.ts"),
    toolRegistryDigest: sha256(stable({ harness: await sourceDigest("packages/harness/src/index.ts"), gateway: await sourceDigest("packages/agent-tools/src/index.ts") })),
    deepseekExpectedEngineCommit
  };
  return { ...unsigned, manifestDigest: sha256(stable(unsigned)) };
}

async function verify(manifest: Provenance, requireCi: boolean): Promise<void> {
  if (manifest.schemaVersion !== 1) fail("unsupported provenance schema");
  const shaFields: Array<[string, string | undefined]> = [["sourceSha", manifest.sourceSha], ["ciSha", manifest.ciSha], ["deepseekExpectedEngineCommit", manifest.deepseekExpectedEngineCommit]];
  for (const [name, value] of shaFields) requireSha(value, name);
  const digestFields: Array<[string, string | undefined]> = [["sbomDigest", manifest.sbomDigest], ["ciResultsDigest", manifest.ciResultsDigest], ["containers.api", manifest.containers?.api], ["containers.web", manifest.containers?.web], ["artifactDigest", manifest.artifactDigest], ["migration.digest", manifest.migration?.digest], ["policyRevision", manifest.policyRevision], ["toolRegistryDigest", manifest.toolRegistryDigest], ["manifestDigest", manifest.manifestDigest]];
  for (const [name, value] of digestFields) requireDigest(value, name);
  if (/^0{40}$/.test(manifest.deepseekExpectedEngineCommit)) fail("placeholder DeepSeek expected engine commit is forbidden");
  if (!manifest.migration?.version || !/^\d+_.+\.sql$/.test(manifest.migration.version)) fail("migration version is invalid");
  if (!Number.isFinite(Date.parse(manifest.buildTimestamp))) fail("build timestamp is invalid");
  const expectedManifestDigest = sha256(stable(withoutManifestDigest(manifest)));
  if (manifest.manifestDigest !== expectedManifestDigest) fail("provenance manifest digest does not match its contents");
  const currentSha = requireSha(git(["rev-parse", "HEAD"]), "current checkout SHA");
  if (manifest.sourceSha !== currentSha) fail(`same-SHA violation: provenance ${manifest.sourceSha} differs from checkout ${currentSha}`);
  if (manifest.ciSha !== currentSha) fail(`same-SHA violation: CI ${manifest.ciSha} differs from checkout ${currentSha}`);
  const ciSha = process.env.GITHUB_SHA?.trim();
  if (requireCi && !ciSha) fail("GITHUB_SHA is required to establish remote CI provenance");
  if (ciSha && ciSha !== currentSha) fail(`same-SHA violation: GITHUB_SHA ${ciSha} differs from checkout ${currentSha}`);
  const migration = await migrationFingerprint();
  if (stable(manifest.migration) !== stable(migration)) fail("migration provenance no longer matches repository migrations");
  if (manifest.policyRevision !== await sourceDigest("packages/agent-policy/src/index.ts")) fail("policy revision provenance no longer matches source");
  const toolRegistryDigest = sha256(stable({ harness: await sourceDigest("packages/harness/src/index.ts"), gateway: await sourceDigest("packages/agent-tools/src/index.ts") }));
  if (manifest.toolRegistryDigest !== toolRegistryDigest) fail("tool registry provenance no longer matches source");
  const sbom = argument("--sbom") ?? process.env.CVG_SBOM_PATH?.trim() ?? manifest.sbomPath ?? "artifacts/sbom.cdx.json";
  await verifySbomDigest(manifest.sbomDigest, sbom);
  const ciResults = argument("--ci-results") ?? process.env.CVG_CI_RESULTS_PATH?.trim() ?? manifest.ciResultsPath ?? "artifacts/ci-results.json";
  await verifyCiResults(ciResults, manifest.ciResultsDigest, manifest.sourceSha);
}

async function main(): Promise<void> {
  try {
    const output = argument("--write");
    const manifestPath = argument("--manifest");
    if (output && manifestPath) fail("use either --write or --manifest");
    if (output) {
      const manifest = await createProvenance();
      const destination = resolve(root, output);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      process.stdout.write(`RELEASE_PROVENANCE_CREATED sha=${manifest.sourceSha} artifact=${manifest.artifactDigest} manifest=${manifest.manifestDigest}\n`);
      return;
    }
    if (!manifestPath) fail("provide --manifest <release-provenance.json> or --write <path>");
    const manifest = JSON.parse(await readFile(resolve(root, manifestPath), "utf8")) as Provenance;
    await verify(manifest, true);
    process.stdout.write(`RELEASE_PROVENANCE_VERIFIED sha=${manifest.sourceSha} artifact=${manifest.artifactDigest} manifest=${manifest.manifestDigest}\n`);
  } catch (error) {
    process.stderr.write(`RELEASE_PROVENANCE_BLOCKED ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)) : false;
if (entrypoint) await main();
