import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const image = "zricethezav/gitleaks:v8.28.0@sha256:bf00b5e039f0fad4b32935dc5ec1e358f227ccd097bcb64b971f0331072fe2ae";

// These are literal REDACTED markers in historical evidence/synthetic tests,
// not credentials. `.opencode/` holds local agent-session runtime state: it is
// gitignored and never part of the product, and only generic-api-key markers
// written there are tolerated (every other rule still fails the scan). The
// narrow exception is owned by @ricardoakinaga-dev and must be reviewed or
// removed by 2026-12-31. New paths fail the scan.
const syntheticPath = /^(?:\.agent\/|\.gauntlet\/|\.opencode\/|artifacts\/|tests\/|(?:apps|packages)\/[^/]+\/tests\/)|^scripts\/(?:verify-agent-chaos|verify-postgres)\.ts$/;

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function runDocker(args, label) {
  return new Promise((resolveRun, rejectRun) => {
    process.stdout.write(`secret scan: ${label}\n`);
    const child = spawn("docker", args, { cwd: root, stdio: "inherit" });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (signal) rejectRun(new Error(`gitleaks terminated by ${signal}`));
      else resolveRun(code ?? 2);
    });
  });
}

async function readFindings(reportPath) {
  const content = await readFile(reportPath, "utf8").catch(() => "[]");
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error("gitleaks produced an invalid JSON report");
  }
}

async function scan({ tempDirectory, label, noGit, ignorePath }) {
  const reportPath = join(tempDirectory, `${noGit ? "working-tree" : "history"}.json`);
  const common = [
    "run", "--rm", "--read-only", "--network=none", "--tmpfs", "/tmp:rw,noexec,nosuid,size=32m",
    "-v", `${root}:/repo:ro`, "-v", `${tempDirectory}:/scan:rw`, image, "detect",
    "--source=/repo", "--config=/scan/config.toml", "--no-banner", "--no-color", "--redact", "--exit-code", "1", "--log-level", "error",
    "--report-format", "json", "--report-path", `/scan/${noGit ? "working-tree" : "history"}.json`
  ];
  if (noGit) common.push("--no-git");
  if (ignorePath) common.push("--gitleaks-ignore-path", "/scan/allowlist");
  const code = await runDocker(common, label);
  return { code, findings: await readFindings(reportPath) };
}

async function scanWithNarrowSyntheticException({ tempDirectory, label, noGit }) {
  const initial = await scan({ tempDirectory, label, noGit });
  if (initial.code === 0) return;
  if (initial.code !== 1) throw new Error(`gitleaks failed before reporting findings (status ${initial.code})`);

  const allowlisted = [];
  for (const finding of initial.findings) {
    const file = String(finding.File ?? "").replace(/^\/repo\//, "");
    if (finding.RuleID === "generic-api-key" && syntheticPath.test(file) && typeof finding.Fingerprint === "string") allowlisted.push(finding.Fingerprint);
    else throw new Error(`secret scan found an unallowlisted finding: ${String(finding.File)}:${String(finding.StartLine)} (${String(finding.RuleID)})`);
  }
  if (allowlisted.length === 0) throw new Error("gitleaks reported findings without usable fingerprints");
  await writeFile(join(tempDirectory, "allowlist"), `${allowlisted.join("\n")}\n`, { mode: 0o600 });
  const verified = await scan({ tempDirectory, label: `${label}, with documented synthetic-marker exception`, noGit, ignorePath: true });
  if (verified.code !== 0) throw new Error(`gitleaks did not clear the documented synthetic markers (status ${verified.code})`);
}

if (!(await exists(resolve(root, ".git")))) {
  throw new Error("secret scan requires a Git checkout so history coverage is observable");
}

const tempDirectory = await mkdtemp(join(tmpdir(), "cvg-gitleaks-"));
try {
  await writeFile(join(tempDirectory, "config.toml"), [
    "[extend]",
    "useDefault = true",
    "",
    "[[allowlists]]",
    'description = "generated build output is not a source credential boundary"',
    'paths = ["^/repo/dist/", "^dist/"]',
    ""
  ].join("\n"), { mode: 0o600 });
  await scanWithNarrowSyntheticException({ tempDirectory, label: "full Git history", noGit: false });
  await scanWithNarrowSyntheticException({ tempDirectory, label: "current working tree", noGit: true });
  process.stdout.write("secret scan: PASS (history and current tree)\n");
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
