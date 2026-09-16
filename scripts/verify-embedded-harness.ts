import { existsSync, readFileSync } from "node:fs";
import { requireTests } from "./lib/node-tests.ts";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");
const failures: string[] = [];

const requiredFiles = [
  "docs/embedded-harness-audit.md",
  "docs/third-party/deepseek-harness-provenance.md",
  "docs/third-party/deepseek-harness-upstream.md",
  "docs/adr/ADR-agent-runtime-embedding-decision.md",
  "docs/adr/ADR-agent-runtime-process-boundary.md",
  "docs/adr/ADR-model-provider-boundary.md",
  "docs/adr/ADR-plugin-security-model.md",
  "docs/adr/ADR-agent-session-persistence.md",
  "packages/agent-kernel/package.json",
  "packages/agent-context/package.json",
  "packages/agent-session/package.json",
  "packages/agent-plugins/package.json",
  "packages/agent-skills/package.json",
  "packages/model-runtime/package.json",
  "packages/model-adapters/package.json",
  "packages/embedded-agent-runtime/package.json",
  "db/migrations/038_agent_runtime_session_state.sql"
];
for (const path of requiredFiles) if (!existsSync(new URL(path, root))) failures.push(`missing artifact: ${path}`);

const decision = read("docs/adr/ADR-agent-runtime-embedding-decision.md");
if (!/HYBRID/.test(decision)) failures.push("embedding decision must record HYBRID");
const provenance = read("docs/third-party/deepseek-harness-provenance.md");
if (!provenance.includes("5dda764ed3aa172535a7967b06ff95d9cbfe536a")) failures.push("provenance must pin the audited upstream commit");
if (!/Nenhum/.test(provenance)) failures.push("provenance must record that no upstream file was embedded");
const migration = read("db/migrations/038_agent_runtime_session_state.sql");
for (const table of ["agent_sessions", "agent_turns", "agent_checkpoints", "agent_leases"]) if (!migration.includes(table)) failures.push(`migration missing ${table}`);
if (!/force row level security/i.test(migration)) failures.push("agent runtime tables must force RLS");

if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}

const passed = requireTests(
  ["tests/unit/agent-plugins.test.ts", "tests/unit/agent-skills.test.ts", "tests/unit/model-runtime.test.ts", "tests/unit/model-adapters.test.ts", "tests/unit/model-provider-contract.test.ts", "tests/unit/runtime-manifest.test.ts", "tests/unit/agent-metrics.test.ts", "tests/unit/agent-context.test.ts", "tests/unit/agent-session.test.ts"],
  "verify:embedded-harness"
);
process.stdout.write(`EMBEDDED_HARNESS_VERIFIED artifacts=${requiredFiles.length} focusedTests=${passed} license=MIT decision=HYBRID embeddedFiles=0\n`);
