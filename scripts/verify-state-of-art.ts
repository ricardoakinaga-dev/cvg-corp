import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Local State-of-the-Art gate composition.  Every layer runs on the same
 * working tree; external proofs are explicitly out of scope here
 * (see verify:state-of-art-external).
 */
const root = fileURLToPath(new URL("../", import.meta.url));
const gates = [
  "typecheck",
  "lint",
  "test",
  "test:contract",
  "test:security",
  "test:database",
  "test:fault",
  "build",
  "verify:architecture",
  "verify:pdp-universal",
  "verify:authoritative-writes",
  "verify:audit-chain",
  "verify:worker-runtime",
  "verify:agent-runtime",
  "verify:embedded-harness",
  "verify:agent-security",
  "verify:plugins",
  "verify:skills",
  "verify:agent-evals",
  "verify:ai-disabled",
  "verify:agent-runtime-smoke",
  "verify:agent-chaos",
  "benchmark:agent-runtime",
  "verify:evidence-snapshot",
  "test:e2e:smoke:serial",
  "verify:evidence-snapshot",
  "verify:static",
  "verify:docs-provenance",
  "verify:claims",
  "audit:licenses"
] as const;

const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout?.trim() ?? "unknown";
mkdirSync(`${root}artifacts/operational-proof`, { recursive: true });
writeFileSync(`${root}artifacts/operational-proof/state-of-art-local.json`, `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), subjectSha: sha, evidenceClass: "LOCAL_REAL", status: "STATE_OF_ART_LOCAL_RUNNING", results: [] }, null, 2)}\n`);
const results: { gate: string; status: "PASS" | "FAIL"; exitCode: number | null; seconds: number }[] = [];
for (const gate of gates) {
  const started = Date.now();
  const run = spawnSync("npm", ["run", "--silent", gate], { cwd: root, encoding: "utf8", stdio: "pipe", env: process.env });
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const ok = run.status === 0;
  results.push({ gate, status: ok ? "PASS" : "FAIL", exitCode: run.status, seconds });
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${gate} (${seconds}s)\n`);
  if (!ok) {
    process.stderr.write(`${run.stdout ?? ""}\n${run.stderr ?? ""}\n`);
  }
}
const failed = results.filter((result) => result.status === "FAIL");
const blockedGates = [
  {
    gate: "verify:production (full browser matrix)",
    status: "NOT_RUN",
    reason: "The full browser matrix is not included in this composition; host library availability is not inferred",
    handling: "This composition runs test:e2e:smoke:serial. Record separately executed full-matrix and production verification with their own current evidence."
  },
  {
    gate: "verify:deepseek-real / verify:provider-real / verify:staging / verify:load",
    status: "BLOCKED_EXTERNAL",
    reason: "no authorized endpoints, credentials, staging URL or load target",
    handling: "See artifacts/operational-proof/state-of-art-external.json."
  }
];
const artifact = { schemaVersion: 1, generatedAt: new Date().toISOString(), subjectSha: sha, evidenceClass: "LOCAL_REAL", status: failed.length === 0 ? "STATE_OF_ART_LOCAL_VERIFIED" : "STATE_OF_ART_LOCAL_FAILED", blockedGates, results };
mkdirSync(`${root}artifacts/operational-proof`, { recursive: true });
writeFileSync(`${root}artifacts/operational-proof/state-of-art-local.json`, `${JSON.stringify(artifact, null, 2)}\n`);
if (failed.length > 0) {
  process.stderr.write(`STATE_OF_ART_LOCAL_FAILED gates=${failed.map((result) => result.gate).join(",")}\n`);
  process.exit(1);
}
process.stdout.write(`STATE_OF_ART_LOCAL_VERIFIED gates=${results.length} subjectSha=${sha}\n`);
