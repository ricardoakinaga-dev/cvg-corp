import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

type GateStatus = "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED";
type EvidenceClass = "LOCAL_EXECUTION_ONLY" | "SYNTHETIC_ONLY" | "NOT_EXECUTED" | "NETWORK_BLOCKED";

type GateResult = {
  gate: string;
  status: GateStatus;
  evidence: EvidenceClass;
  detail?: string;
};

type PackageManifest = {
  scripts?: Record<string, string>;
};

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const gateTimeoutMs = 180_000;
const results: GateResult[] = [];

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

function recordExternalEvidenceBoundary(): void {
  for (const gate of ["real-provider", "secret-authority", "staging", "observability", "browser-matrix", "recovery-drill", "load-and-slo"]) {
    record(gate, "NOT_RUN", "NOT_EXECUTED", "no external evidence is executed by the local-only verifier");
  }
}

async function main(): Promise<void> {
  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as PackageManifest;
  } catch (error) {
    record("package-manifest", "BLOCKED", "NOT_EXECUTED", `cannot read package.json: ${error instanceof Error ? error.message : String(error)}`);
    recordExternalEvidenceBoundary();
    process.stdout.write("VERDICT AAA_NOT_PROVEN\n");
    process.stderr.write("FAIL-CLOSED local verification cannot inspect the package manifest\n");
    process.exitCode = 2;
    return;
  }

  runNpmScript(manifest, "lint", "lint", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "typecheck", "typecheck", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "test", "test", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "build", "build", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "static", "verify:static", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "contract", "test:contract", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "security", "test:security", "SYNTHETIC_ONLY");
  runNpmScript(manifest, "database", "test:database", "SYNTHETIC_ONLY");
  runNpmScript(manifest, "fault", "test:fault", "SYNTHETIC_ONLY");
  runNpmScript(manifest, "audit:licenses", "audit:licenses", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "audit:tokens", "audit:tokens", "LOCAL_EXECUTION_ONLY");
  runNpmScript(manifest, "audit:contrast", "audit:contrast", "LOCAL_EXECUTION_ONLY");

  // npm audit consults a registry. It is deliberately not invoked here: the
  // bounded verifier has no network authority. The local audit scripts above
  // still run and this missing external proof remains visible.
  record("audit:dependency-registry", "BLOCKED", "NETWORK_BLOCKED", "registry/network access is disabled by policy");

  if (npmSubcommandAvailable("sbom")) {
    runCommand("sbom", npmExecutable, ["sbom", "--sbom-format", "cyclonedx"], "LOCAL_EXECUTION_ONLY");
  } else {
    record("sbom", "NOT_RUN", "NOT_EXECUTED", "installed npm does not expose the sbom subcommand");
  }

  runCommand("diff", "git", ["diff", "--check", "HEAD", "--"], "LOCAL_EXECUTION_ONLY");
  recordExternalEvidenceBoundary();

  const hasFailure = results.some((result) => result.status === "FAIL");
  const incomplete = results.some((result) => result.status !== "PASS") || results.some((result) => result.evidence !== "LOCAL_EXECUTION_ONLY");
  process.stdout.write("VERDICT AAA_NOT_PROVEN\n");
  process.stdout.write("PROMOTION BLOCKED synthetic/local evidence is not Triple AAA evidence; use verify:staging with explicit evidence separately\n");

  if (hasFailure) {
    process.stderr.write("FAIL-CLOSED one or more local gates failed\n");
    process.exitCode = 1;
  } else if (incomplete) {
    process.stderr.write("FAIL-CLOSED verification is incomplete; no AAA promotion is possible\n");
    process.exitCode = 2;
  }
}

await main();
