import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type RedTeamCriterion = {
  id: string;
  threat: string;
  testFile: string;
  testName: string;
  controlEvidence: string;
};

export const RED_TEAM_CRITERIA: readonly RedTeamCriterion[] = [
  { id: "F23-01", threat: "cross-organization access", testFile: "tests/integration/persistence.test.ts", testName: "authoritative validation rejects cross-parent and cross-tenant child relationships", controlEvidence: "cross-tenant" },
  { id: "F23-02", threat: "cross-unit access", testFile: "tests/integration/persistence.test.ts", testName: "authoritative validation rejects workspace and unit drift in operational children", controlEvidence: "unit drift" },
  { id: "F23-03", threat: "cross-workspace access", testFile: "tests/unit/domain.test.ts", testName: "scoped knowledge, communications and AI replay never cross workspaces", controlEvidence: "cross workspaces" },
  { id: "F23-04", threat: "IDOR", testFile: "tests/unit/vnext.test.ts", testName: "application PDP binds the authenticated session, registered capability and patient target", controlEvidence: "patient target" },
  { id: "F23-05", threat: "role escalation", testFile: "tests/unit/vnext.test.ts", testName: "application policy catalog denies an unlisted role before a durable read", controlEvidence: "unlisted role" },
  { id: "F23-06", threat: "session fixation", testFile: "tests/unit/vnext.test.ts", testName: "context authorization failures force a safe revalidation boundary", controlEvidence: "safe revalidation" },
  { id: "F23-07", threat: "CSRF", testFile: "apps/api/src/app.ts", testName: "requireCsrf", controlEvidence: "CSRF_INVALID" },
  { id: "F23-08", threat: "MFA bypass", testFile: "tests/unit/auth.test.ts", testName: "WebAuthn and break-glass boundaries fail closed before provider cryptography", controlEvidence: "fail closed" },
  { id: "F23-09", threat: "break-glass abuse", testFile: "tests/unit/auth.test.ts", testName: "break-glass lifecycle requires explicit activation, expires automatically and records independent review", controlEvidence: "independent review" },
  { id: "F23-10", threat: "prompt injection", testFile: "tests/unit/domain.test.ts", testName: "harness quarantines prompt injection and requires approval for impact tools", controlEvidence: "QUARANTINED" },
  { id: "F23-11", threat: "indirect prompt injection", testFile: "tests/unit/domain.test.ts", testName: "knowledge retrieval excludes an indirect prompt injection from approved references", controlEvidence: "indirect prompt injection" },
  { id: "F23-12", threat: "tool injection", testFile: "tests/unit/vnext.test.ts", testName: "ToolGateway denies a descriptor outside the canonical tool policy before registration", controlEvidence: "canonical tool policy" },
  { id: "F23-13", threat: "approval bypass", testFile: "tests/unit/domain.test.ts", testName: "high-impact harness approvals require a different authorized actor", controlEvidence: "different authorized actor" },
  { id: "F23-14", threat: "RAG poisoning", testFile: "tests/integration/persistence.test.ts", testName: "normalized read repositories scope the transaction and preserve joined projections", controlEvidence: "PersistenceCorruptionError" },
  { id: "F23-15", threat: "secret extraction", testFile: "tests/unit/vnext.test.ts", testName: "secret providers resolve only approved references", controlEvidence: "approved references" },
  { id: "F23-16", threat: "provider callback forgery", testFile: "tests/unit/integrations.test.ts", testName: "messaging callbacks require a valid HMAC and external sinks require the durable effect ledger", controlEvidence: "valid HMAC" },
  { id: "F24-01", threat: "RLS bypass", testFile: "db/migrations/030_break_glass_durable_lifecycle.sql", testName: "force row level security", controlEvidence: "create policy" },
  { id: "F24-02", threat: "superuser assumptions", testFile: "db/migrations/022_runtime_database_role.sql", testName: "nobypassrls", controlEvidence: "nosuperuser" },
  { id: "F24-03", threat: "runtime role escalation", testFile: "db/migrations/022_runtime_database_role.sql", testName: "noinherit", controlEvidence: "alter role cvg_runtime" },
  { id: "F24-04", threat: "cross-tenant joins", testFile: "db/migrations/014_cross_organization_foreign_keys.sql", testName: "same organization provenance", controlEvidence: "organization_id, id" },
  { id: "F24-05", threat: "FK poisoning", testFile: "db/migrations/014_cross_organization_foreign_keys.sql", testName: "foreign key", controlEvidence: "references" },
  { id: "F24-06", threat: "unsafe search_path", testFile: "db/migrations/034_diagnostic_child_integrity_backstop.sql", testName: "cvg_diagnostic_specimen_integrity_guard", controlEvidence: "set search_path = pg_catalog, public" },
  { id: "F24-07", threat: "SQL injection", testFile: "tests/integration/persistence.test.ts", testName: "Postgres persistence commits journal and snapshot atomically", controlEvidence: "$1" },
  { id: "F24-08", threat: "migration/runtime privilege confusion", testFile: "db/migrations/022_runtime_database_role.sql", testName: "migration connection owns this setup", controlEvidence: "separately provisioned LOGIN role" }
] as const;

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputPath = join(root, "artifacts/operational-proof/security-red-team-local.json");

function executeFixtures(): { status: "PASS" | "FAIL"; command: string; detail?: string } {
  const files = ["tests/unit/auth.test.ts", "tests/unit/vnext.test.ts", "tests/unit/integrations.test.ts", "tests/integration/persistence.test.ts", "tests/integration/faults.test.ts"];
  const command = `${process.execPath} --import tsx --test ${files.join(" ")}`;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { cwd: root, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
  if (result.status === 0) return { status: "PASS", command };
  const detail = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim().split("\n").slice(-3).join(" | ");
  return { status: "FAIL", command, ...(detail ? { detail } : {}) };
}

function executeCriterion(criterion: RedTeamCriterion): { status: "PASS" | "STATIC" | "FAIL"; command?: string; detail?: string } {
  if (!criterion.testFile.endsWith(".test.ts")) return { status: "STATIC" };
  const pattern = `^${criterion.testName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
  const command = `${process.execPath} --import tsx --test --test-name-pattern ${JSON.stringify(pattern)} ${criterion.testFile}`;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-name-pattern", pattern, criterion.testFile], { cwd: root, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status === 0 && !/ℹ tests 0/.test(output)) return { status: "PASS", command };
  const detail = output.trim().split("\n").slice(-3).join(" | ");
  return { status: "FAIL", command, ...(detail ? { detail } : {}) };
}

async function main(): Promise<void> {
  const findings: Array<RedTeamCriterion & { status: "VERIFIED_LOCAL_EXECUTION" | "VERIFIED_STATIC_CONTRACT" | "MISSING"; execution: { status: "PASS" | "STATIC" | "FAIL"; command?: string; detail?: string }; limitation: string }> = [];
  for (const criterion of RED_TEAM_CRITERIA) {
    const source = await readFile(join(root, criterion.testFile), "utf8").catch(() => "");
    const execution = executeCriterion(criterion);
    const sourcePresent = source.includes(criterion.testName) && source.includes(criterion.controlEvidence);
    const status = !sourcePresent || execution.status === "FAIL" ? "MISSING" : execution.status === "PASS" ? "VERIFIED_LOCAL_EXECUTION" : "VERIFIED_STATIC_CONTRACT";
    findings.push({ ...criterion, status, execution, limitation: execution.status === "STATIC" ? "static control contract only; adversarial staging execution and independent red-team review remain external" : "focused local fixture execution only; adversarial staging execution and independent red-team review remain external" });
  }
  const missing = findings.filter((finding) => finding.status === "MISSING");
  const fixtureExecution = executeFixtures();
  const report = { schemaVersion: 1, status: missing.length === 0 && fixtureExecution.status === "PASS" ? "SECURITY_RED_TEAM_LOCAL_CONTRACT_VERIFIED" : "SECURITY_RED_TEAM_LOCAL_CONTRACT_INCOMPLETE", observedAt: new Date().toISOString(), criteria: findings, fixtureExecution, externalLimitations: ["No production-like staging, live provider, secret authority, managed database, or independent human review was executed."] };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`${report.status} criteria=${findings.length} missing=${missing.length} artifact=${outputPath}\n`);
  if (missing.length || fixtureExecution.status !== "PASS") process.exitCode = 1;
}

await main();
