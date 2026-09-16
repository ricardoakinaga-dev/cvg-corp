import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * External State-of-the-Art gates.  Without authorized endpoints/credentials
 * this script reports BLOCKED_EXTERNAL and never fabricates execution:
 * loopback is not a provider, a mock is not DeepSeek, local PostgreSQL is not
 * staging.
 */
const root = fileURLToPath(new URL("../", import.meta.url));
const requiredCredentials: { name: string; gates: string[] }[] = [
  { name: "CVG_DEEPSEEK_REAL_URL", gates: ["verify:deepseek-real"] },
  { name: "CVG_DEEPSEEK_REAL_BEARER_TOKEN", gates: ["verify:deepseek-real"] },
  { name: "CVG_DEEPSEEK_REAL_CONTEXT_SIGNING_SECRET", gates: ["verify:deepseek-real"] },
  { name: "CVG_DEEPSEEK_REAL_EVIDENCE_FILE", gates: ["verify:deepseek-real"] },
  { name: "CVG_PROVIDER_REAL_ENDPOINT", gates: ["verify:provider-real"] },
  { name: "CVG_PROVIDER_REAL_TOKEN", gates: ["verify:provider-real"] },
  { name: "CVG_PROVIDER_REAL_RECIPIENT", gates: ["verify:provider-real"] },
  { name: "CVG_STAGING_URL", gates: ["verify:staging"] },
  { name: "CVG_LOAD_BASE_URL", gates: ["verify:load"] }
];
const missing = requiredCredentials.filter((credential) => !process.env[credential.name]?.trim()).map((credential) => credential.name);
const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout?.trim() ?? "unknown";
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  subjectSha: sha,
  evidenceClass: "EXTERNAL_REAL" as const,
  status: missing.length > 0 ? "BLOCKED_EXTERNAL" : "RUNNING",
  missingCredentials: missing,
  gates: ["verify:deepseek-real", "verify:provider-real", "verify:staging", "verify:load"],
  notRun: ["verify:chaos (external)", "verify:recovery-production", "verify:observability (external)"],
  note: "Chaos, recovery and observability external proofs have no authorized runner in this environment and remain NOT_RUN."
};
mkdirSync(`${root}artifacts/operational-proof`, { recursive: true });
writeFileSync(`${root}artifacts/operational-proof/state-of-art-external.json`, `${JSON.stringify(report, null, 2)}\n`);
if (missing.length > 0) {
  process.stdout.write(`BLOCKED_EXTERNAL missing=${missing.join(",")} artifact=artifacts/operational-proof/state-of-art-external.json\n`);
  process.exit(0);
}
const results: { gate: string; status: string }[] = [];
for (const gate of report.gates) {
  const run = spawnSync("npm", ["run", "--silent", gate], { cwd: root, encoding: "utf8", stdio: "pipe", env: process.env });
  results.push({ gate, status: run.status === 0 ? "PASS" : "FAIL" });
  process.stdout.write(`${run.status === 0 ? "PASS" : "FAIL"} ${gate}\n`);
  if (run.status !== 0) process.stderr.write(`${run.stdout ?? ""}\n${run.stderr ?? ""}\n`);
}
report.status = results.every((result) => result.status === "PASS") ? "STATE_OF_ART_EXTERNAL_VERIFIED" : "STATE_OF_ART_EXTERNAL_FAILED";
writeFileSync(`${root}artifacts/operational-proof/state-of-art-external.json`, `${JSON.stringify({ ...report, results }, null, 2)}\n`);
if (report.status.endsWith("FAILED")) process.exit(1);
process.stdout.write(`STATE_OF_ART_EXTERNAL_VERIFIED subjectSha=${sha}\n`);
