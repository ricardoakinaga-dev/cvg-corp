import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * AUD27-017/022 VPS deployment helper. Validates the production inputs and,
 * with --apply, runs the same Compose path the CI validates against the
 * production overlay. It never invents secrets: every value comes from an
 * env file supplied outside the repository.
 */

export const PRODUCTION_REQUIRED_KEYS = [
  "POSTGRES_PASSWORD",
  "MIGRATION_DATABASE_URL",
  "DATABASE_URL",
  "CVG_RUNTIME_DB_USER",
  "CVG_RUNTIME_DB_PASSWORD",
  "CVG_BOOTSTRAP_PASSWORD",
  "CVG_WORKER_ORGANIZATION_ID",
  "CVG_RELEASE_SHA",
  "CVG_RELEASE_ARTIFACT_DIGEST",
  "CVG_TRUSTED_PROXY_IPS",
  "CVG_WEB_ORIGIN",
  "CVG_SECRET_PROVIDER",
  "CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT",
  "CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION",
  "CVG_TLS_DIR",
  "CVG_STAGING_URL",
  "CVG_CONTAINER_SMOKE_URL"
] as const;

export type VpsCheck = { id: string; status: "PASS" | "FAIL" | "WARN"; detail: string; remedy?: string };

export function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    values[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return values;
}

export function missingEnvKeys(values: Record<string, string>, required: readonly string[] = PRODUCTION_REQUIRED_KEYS): string[] {
  return required.filter((key) => !values[key] || values[key]!.trim().length === 0);
}

function run(command: string, args: string[]): { ok: boolean; output: string } {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 900_000 });
  return { ok: result.status === 0 && !result.error, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

export function runVpsChecks(envFile: string): VpsCheck[] {
  const checks: VpsCheck[] = [];
  const absoluteEnv = resolve(envFile);
  if (!existsSync(absoluteEnv)) {
    return [{ id: "env-file", status: "FAIL", detail: `env file not found: ${absoluteEnv}`, remedy: "copy docker/.env.example outside the repo and fill the required keys" }];
  }
  const values = parseEnvFile(readFileSync(absoluteEnv, "utf8"));
  const missing = missingEnvKeys(values);
  checks.push({
    id: "env-keys",
    status: missing.length === 0 ? "PASS" : "FAIL",
    detail: missing.length === 0 ? `${PRODUCTION_REQUIRED_KEYS.length} required keys present` : `missing: ${missing.join(", ")}`,
    remedy: "fill the missing keys in the external env file"
  });
  const docker = run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  checks.push({ id: "docker", status: docker.ok ? "PASS" : "FAIL", detail: docker.ok ? `server ${docker.output}` : "docker daemon unreachable", remedy: "install/start Docker Engine" });
  const compose = run("docker", ["compose", "version"]);
  checks.push({ id: "compose", status: compose.ok ? "PASS" : "FAIL", detail: compose.ok ? compose.output.split("\n")[0] ?? "" : "compose v2 missing", remedy: "install docker-compose-v2" });
  const buildx = run("docker", ["buildx", "version"]);
  checks.push({ id: "buildx", status: buildx.ok ? "PASS" : "FAIL", detail: buildx.ok ? buildx.output.split("\n")[0] ?? "" : "buildx missing", remedy: "install docker-buildx" });
  const tlsDir = values.CVG_TLS_DIR;
  if (tlsDir && isAbsolute(tlsDir)) {
    const fullchain = join(tlsDir, "fullchain.pem");
    const privkey = join(tlsDir, "privkey.pem");
    const ok = existsSync(fullchain) && existsSync(privkey) && statSync(fullchain).isFile() && statSync(privkey).isFile();
    checks.push({ id: "tls-material", status: ok ? "PASS" : "FAIL", detail: ok ? `certificate and key present in ${tlsDir}` : `fullchain.pem/privkey.pem missing under ${tlsDir}`, remedy: "provision a real certificate (e.g. Let's Encrypt) outside the repository" });
  } else {
    checks.push({ id: "tls-material", status: tlsDir ? "FAIL" : "FAIL", detail: "CVG_TLS_DIR must be an absolute path", remedy: "set CVG_TLS_DIR to the external certificate directory" });
  }
  const sha = values.CVG_RELEASE_SHA ?? "";
  checks.push({ id: "release-sha", status: /^[a-f0-9]{40}$/.test(sha) ? "PASS" : "FAIL", detail: /^[a-f0-9]{40}$/.test(sha) ? sha : "CVG_RELEASE_SHA must be the audited 40-char commit", remedy: "set the audited commit SHA" });
  const digest = values.CVG_RELEASE_ARTIFACT_DIGEST ?? "";
  checks.push({ id: "release-digest", status: /^sha256:[a-f0-9]{64}$/.test(digest) ? "PASS" : "FAIL", detail: /^sha256:[a-f0-9]{64}$/.test(digest) ? digest : "CVG_RELEASE_ARTIFACT_DIGEST must be an immutable sha256 digest", remedy: "set the image digest produced by the release build" });
  for (const secret of ["cvg-deepseek-bearer", "cvg-deepseek-context", "cvg-recovery-key", "cvg-messaging-credential"]) {
    const result = run("docker", ["secret", "inspect", secret]);
    checks.push({ id: `docker-secret:${secret}`, status: result.ok ? "PASS" : "WARN", detail: result.ok ? "present" : "not found in the swarm secret store", remedy: "create the external secret or use the approved secret authority" });
  }
  return checks;
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.length === 0) {
    process.stdout.write([
      "Usage: npx tsx scripts/vps-bootstrap.ts --env-file <abs-path-outside-repo> [--apply]",
      "",
      "--check (default) validates the production inputs; --apply builds and starts the production compose overlay.",
      "It never generates secrets; every value comes from the external env file.",
      ""
    ].join("\n"));
    if (argv.length === 0) process.exitCode = 1;
    return;
  }
  const envIndex = argv.indexOf("--env-file");
  const envFile = envIndex >= 0 ? argv[envIndex + 1] : undefined;
  if (!envFile) {
    process.stderr.write("--env-file is required\n");
    process.exitCode = 1;
    return;
  }
  const apply = argv.includes("--apply");
  const checks = runVpsChecks(envFile);
  for (const check of checks) {
    process.stdout.write(`${check.status.padEnd(4)} ${check.id}: ${check.detail}${check.remedy && check.status !== "PASS" ? `\n     correção: ${check.remedy}` : ""}\n`);
  }
  const failures = checks.filter((check) => check.status === "FAIL");
  if (failures.length > 0) {
    process.stdout.write(`VPS_CHECK_FAIL required_failures=${failures.length}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`VPS_CHECK_PASS warnings=${checks.filter((check) => check.status === "WARN").length}\n`);
  if (!apply) {
    process.stdout.write("VPS_DRY_RUN pass --apply to build, migrate and start the production overlay\n");
    return;
  }
  const root = resolve(process.cwd());
  const composeArgs = ["compose", "--env-file", resolve(envFile), "-f", join(root, "docker-compose.yml"), "-f", join(root, "docker-compose.production.yml"), "-p", "cvg-production"];
  for (const [label, args] of [
    ["build", [...composeArgs, "build"]],
    ["up", [...composeArgs, "up", "-d"]],
    ["migrate", [...composeArgs, "run", "--rm", "migrate"]]
  ] as const) {
    const result = run("docker", [...args]);
    process.stdout.write(`${result.ok ? "PASS" : "FAIL"} vps:${label}\n`);
    if (!result.ok) {
      process.stderr.write(`${result.output.slice(-2_000)}\n`);
      process.exitCode = 1;
      return;
    }
  }
  process.stdout.write("VPS_DEPLOY_APPLIED run verify:staging, verify:container-smoke and re-issue the external evidence package\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
