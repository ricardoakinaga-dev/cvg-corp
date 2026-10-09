import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Environment doctor: validates the tools required to build, run and verify
 * CVG-Corp and prints the exact remediation for anything missing. Required
 * failures exit non-zero; optional tools only warn.
 */

export type DoctorStatus = "PASS" | "FAIL" | "WARN";

export type DoctorCheck = {
  id: string;
  label: string;
  required: boolean;
  status: DoctorStatus;
  detail: string;
  remedy?: string;
};

export type BrowserPresence = { chromium: boolean; firefox: boolean; webkit: boolean };

export function parseVersion(value: string): [number, number, number] | null {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function versionSatisfies(actual: string, minimum: string, maximumMajorExclusive: number): boolean {
  const parsed = parseVersion(actual);
  const floor = parseVersion(minimum);
  if (!parsed || !floor) return false;
  if (parsed[0] >= maximumMajorExclusive) return false;
  if (parsed[0] !== floor[0]) return parsed[0] > floor[0];
  if (parsed[1] !== floor[1]) return parsed[1] > floor[1];
  return parsed[2] >= floor[2];
}

export function playwrightBrowsersInstalled(cacheDirectory = join(homedir(), ".cache", "ms-playwright")): BrowserPresence {
  const present: BrowserPresence = { chromium: false, firefox: false, webkit: false };
  if (!existsSync(cacheDirectory)) return present;
  for (const entry of readdirSync(cacheDirectory)) {
    if (/^chromium(-\d+|_headless_shell-\d+)$/.test(entry)) present.chromium = true;
    if (/^firefox-\d+$/.test(entry)) present.firefox = true;
    if (/^webkit-\d+$/.test(entry)) present.webkit = true;
  }
  return present;
}

function run(command: string, args: string[]): { ok: boolean; output: string } {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 60_000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { ok: result.status === 0 && !result.error, output };
}

function requiredFailures(checks: DoctorCheck[]): number {
  return checks.filter((check) => check.required && check.status === "FAIL").length;
}

export function runDoctor(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const nodeVersion = process.versions.node;
  checks.push({
    id: "node",
    label: "Node.js 24.20.x",
    required: true,
    status: versionSatisfies(nodeVersion, "24.20.0", 25) ? "PASS" : "FAIL",
    detail: `encontrado ${nodeVersion}`,
    remedy: "instale Node 24.20.x (nvm: `nvm install 24.20.0 && nvm use 24.20.0`)"
  });
  const npm = run("npm", ["--version"]);
  checks.push({
    id: "npm",
    label: "npm 11.19.x",
    required: true,
    status: npm.ok && versionSatisfies(npm.output.split("\n").at(-1) ?? "", "11.19.0", 12) ? "PASS" : "FAIL",
    detail: npm.ok ? `encontrado ${npm.output.split("\n").at(-1)}` : "npm não respondeu",
    remedy: "instale npm 11.19.x (`npm install -g npm@11.19.0`)"
  });
  const git = run("git", ["--version"]);
  checks.push({
    id: "git",
    label: "Git",
    required: true,
    status: git.ok ? "PASS" : "FAIL",
    detail: git.ok ? git.output : "git não encontrado",
    remedy: "instale git (`sudo apt-get install -y git`)"
  });
  const docker = run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  checks.push({
    id: "docker",
    label: "Docker daemon",
    required: true,
    status: docker.ok ? "PASS" : "FAIL",
    detail: docker.ok ? `servidor ${docker.output}` : "daemon inacessível",
    remedy: "inicie o Docker (`sudo systemctl start docker`) ou rode o demo em memória, que não exige Docker"
  });
  const compose = run("docker", ["compose", "version"]);
  checks.push({
    id: "compose",
    label: "Docker Compose",
    required: true,
    status: compose.ok ? "PASS" : "FAIL",
    detail: compose.ok ? compose.output.split("\n")[0] ?? "" : "plugin compose ausente",
    remedy: "instale o plugin (`sudo apt-get install -y docker-compose-v2`)"
  });
  const buildx = run("docker", ["buildx", "version"]);
  checks.push({
    id: "buildx",
    label: "Docker Buildx",
    required: true,
    status: buildx.ok ? "PASS" : "FAIL",
    detail: buildx.ok ? buildx.output.split("\n")[0] ?? "" : "buildx ausente",
    remedy: "instale o buildx (`sudo apt-get install -y docker-buildx`)"
  });
  const browsers = playwrightBrowsersInstalled();
  checks.push({
    id: "playwright-browsers",
    label: "Browsers Playwright (Chromium, Firefox, WebKit)",
    required: true,
    status: browsers.chromium && browsers.firefox && browsers.webkit ? "PASS" : "FAIL",
    detail: `chromium=${browsers.chromium} firefox=${browsers.firefox} webkit=${browsers.webkit}`,
    remedy: "instale os browsers (`npx playwright install chromium firefox webkit`)"
  });
  const systemDeps = run("npx", ["playwright", "install-deps", "--dry-run"]);
  const systemDepsOk = systemDeps.ok && /All system dependencies are installed/i.test(systemDeps.output);
  const systemDepsLine = systemDeps.output.split("\n").find((line) => /All system dependencies are installed/i.test(line)) ?? systemDeps.output.split("\n").at(-1) ?? "instaladas";
  checks.push({
    id: "playwright-system-deps",
    label: "Bibliotecas de sistema do Playwright/WebKit",
    required: true,
    status: systemDepsOk ? "PASS" : systemDeps.ok ? "FAIL" : "WARN",
    detail: systemDepsOk ? systemDepsLine.trim() : "há dependências de sistema ausentes",
    remedy: "com nvm use `sudo env PATH=\"$PATH\" npx playwright install-deps` (o sudo não herda o PATH do nvm)"
  });
  const k6 = run("k6", ["version"]);
  checks.push({
    id: "k6",
    label: "k6 (carga, opcional)",
    required: false,
    status: k6.ok ? "PASS" : "WARN",
    detail: k6.ok ? k6.output.split("\n")[0] ?? "" : "k6 ausente",
    remedy: "instale k6 para `verify:load`: https://grafana.com/docs/k6/latest/set-up/install-k6/"
  });
  const psql = run("psql", ["--version"]);
  checks.push({
    id: "psql",
    label: "psql (operações e runbooks, opcional)",
    required: false,
    status: psql.ok ? "PASS" : "WARN",
    detail: psql.ok ? psql.output : "cliente PostgreSQL ausente",
    remedy: "instale o cliente (`sudo apt-get install -y postgresql-client`)"
  });
  const openssl = run("openssl", ["version"]);
  checks.push({
    id: "openssl",
    label: "openssl (TLS local, opcional)",
    required: false,
    status: openssl.ok ? "PASS" : "WARN",
    detail: openssl.ok ? openssl.output : "openssl ausente",
    remedy: "instale openssl (`sudo apt-get install -y openssl`)"
  });
  return checks;
}

function main(): void {
  const checks = runDoctor();
  for (const check of checks) {
    process.stdout.write(`${check.status.padEnd(4)} ${check.label}: ${check.detail}${check.remedy && check.status !== "PASS" ? `\n     correção: ${check.remedy}` : ""}\n`);
  }
  const failures = requiredFailures(checks);
  const warnings = checks.filter((check) => check.status === "WARN").length;
  process.stdout.write(`DOCTOR_VERDICT=${failures === 0 ? "PASS" : "FAIL"} required_failures=${failures} warnings=${warnings}\n`);
  if (failures > 0) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("doctor.ts")) main();
