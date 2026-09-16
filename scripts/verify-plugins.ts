import { readFileSync } from "node:fs";
import { AGENT_PLUGIN_PERMISSIONS } from "@cvg/agent-plugins";
import { requireTests } from "./lib/node-tests.ts";

const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("packages/agent-plugins/src/index.ts", root), "utf8");
const failures: string[] = [];

const requiredPermissions = ["logger", "metrics", "scoped-config", "approved-tools", "clock"];
if (AGENT_PLUGIN_PERMISSIONS.length !== requiredPermissions.length) failures.push("plugin permission surface drifted from the audited capability list");
for (const permission of requiredPermissions) if (!AGENT_PLUGIN_PERMISSIONS.includes(permission as never)) failures.push(`plugin permission missing: ${permission}`);
for (const forbidden of ["database", "filesystem", "secrets", "httpClient"]) {
  if ((AGENT_PLUGIN_PERMISSIONS as readonly string[]).includes(forbidden)) failures.push(`plugin permission must never include ${forbidden}`);
}
for (const marker of ["pluginManifestDigest", "NOT_ALLOWLISTED", "MANIFEST_DIGEST_MISMATCH", "RISKY_PLUGIN_NOT_APPROVED", "DEPENDENCY_RESOLUTION_FAILED", "AgentPluginContext"]) {
  if (!source.includes(marker)) failures.push(`plugin runtime is missing ${marker}`);
}
if (!/no ambient authority/i.test(source)) failures.push("plugin runtime must document the no-ambient-authority principle");
if (!/DENIED_STALE_FENCE/.test(readFileSync(new URL("packages/agent-session/src/index.ts", root), "utf8"))) failures.push("session store must reject stale fences");

if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}

const passed = requireTests(["tests/unit/agent-plugins.test.ts"], "verify:plugins");
process.stdout.write(`PLUGIN_GATE_VERIFIED permissions=${requiredPermissions.length} focusedTests=${passed}\n`);
