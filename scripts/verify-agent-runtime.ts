import { readFileSync } from "node:fs";
import { requireTests } from "./lib/node-tests.ts";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");
const failures: string[] = [];

const kernel = read("packages/agent-kernel/src/index.ts");
const requiredStates = ["CREATED", "OBSERVING", "CONTEXT_BUILDING", "MODEL_PENDING", "MODEL_COMPLETED", "TOOL_PENDING", "TOOL_COMPLETED", "VERIFYING", "WAITING_APPROVAL", "COMPLETED", "FAILED", "QUARANTINED", "CANCELLED"];
for (const state of requiredStates) if (!kernel.includes(`"${state}"`)) failures.push(`kernel state missing: ${state}`);
const requiredStops = ["TASK_COMPLETED", "WAITING_HUMAN", "BUDGET_EXCEEDED", "POLICY_DENIED", "CANCELLED", "TIMEOUT", "NO_PROGRESS", "DEPENDENCY_UNAVAILABLE", "ERROR"];
for (const stop of requiredStops) if (!kernel.includes(`"${stop}"`)) failures.push(`kernel stop condition missing: ${stop}`);
for (const limit of ["maxTurns", "maxToolCalls", "maxTokens", "maxWallTimeMs", "maxCostMicros", "maxFailures"]) if (!kernel.includes(limit)) failures.push(`kernel limit missing: ${limit}`);

// The kernel must stay domain-free and provider-neutral.
for (const forbidden of ["@cvg/domain", "@cvg/persistence", "@cvg/agent-tools", "@cvg/harness", "node:fs", "node:net", "node:http", "from \"pg\""]) {
  if (kernel.includes(`from "${forbidden}"`)) failures.push(`agent-kernel must not import ${forbidden}`);
}

const embedded = read("packages/embedded-agent-runtime/src/index.ts");
for (const marker of ["implements AgentRuntime", "createGovernedToolGateway", "AgentKernel", "ContextBuilder", "MemoryAgentSessionStore", "runtimeManifest", "appendLedgerTurn"]) {
  if (!embedded.includes(marker)) failures.push(`embedded runtime is missing ${marker}`);
}
if (!embedded.includes("DENIED_STALE_FENCE")) failures.push("embedded runtime must surface DENIED_STALE_FENCE");
if (!embedded.includes("AI_DISABLED")) failures.push("embedded runtime must surface the AI disable state");

const manifestRuntime = read("packages/agent-runtime/src/runtime-manifest.ts");
for (const marker of ["AgentRuntimeContract/v1", "runtimeManifestDigest", "EXACT_REPLAY", "COMPATIBLE_REPLAY", "NON_EQUIVALENT_REPLAY", "buildAiUsageSettlement"]) {
  if (!manifestRuntime.includes(marker)) failures.push(`runtime manifest contract is missing ${marker}`);
}

if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}

const passed = requireTests(
  ["tests/unit/agent-kernel.test.ts", "tests/unit/embedded-runtime.test.ts", "tests/unit/agent-session.test.ts", "tests/unit/agent-context.test.ts"],
  "verify:agent-runtime"
);
process.stdout.write(`AGENT_RUNTIME_VERIFIED states=${requiredStates.length} stops=${requiredStops.length} focusedTests=${passed}\n`);
