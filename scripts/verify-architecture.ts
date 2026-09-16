import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Architecture invariants: the domain never depends on the agent runtime or a
 * model provider; the kernel is domain-free; application services depend on
 * the AgentRuntime port, never on provider adapters.
 */
const failures: string[] = [];
const runtimePackages = ["harness", "harness-adapters", "agent-runtime", "agent-kernel", "agent-context", "agent-session", "agent-plugins", "agent-skills", "model-runtime", "model-adapters", "embedded-agent-runtime", "deepseek-bridge", "integrations"];

function tsFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...tsFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

function importsOf(source: string): string[] {
  return [...source.matchAll(/from\s+"(@cvg\/[^"]+)"/g)].map((match) => match[1]!);
}

for (const file of tsFiles("packages/domain/src")) {
  for (const imported of importsOf(readFileSync(file, "utf8"))) {
    const pkg = imported.slice("@cvg/".length);
    if (runtimePackages.includes(pkg)) failures.push(`${file}: domain must not import ${imported}`);
  }
}
for (const file of tsFiles("packages/agent-kernel/src")) {
  for (const imported of importsOf(readFileSync(file, "utf8"))) {
    if (["@cvg/domain", "@cvg/persistence", "@cvg/agent-tools", "@cvg/harness", "@cvg/embedded-agent-runtime"].includes(imported)) failures.push(`${file}: kernel must not import ${imported}`);
  }
}
for (const file of tsFiles("apps/api/src/application")) {
  for (const imported of importsOf(readFileSync(file, "utf8"))) {
    if (["@cvg/model-adapters", "@cvg/harness-adapters", "@cvg/deepseek-bridge"].includes(imported)) failures.push(`${file}: application services must depend on the AgentRuntime port, not ${imported}`);
  }
}

const domainPackage = JSON.parse(readFileSync("packages/domain/package.json", "utf8")) as { dependencies?: Record<string, string> };
for (const dependency of Object.keys(domainPackage.dependencies ?? {})) {
  if (runtimePackages.includes(dependency.slice("@cvg/".length))) failures.push(`packages/domain depends on ${dependency}`);
}

const embedded = readFileSync("packages/embedded-agent-runtime/src/index.ts", "utf8");
if (!/modelProvider: ModelProvider/.test(embedded)) failures.push("embedded runtime must depend on the ModelProvider abstraction");
if (!/DisabledAgentRuntime/.test(readFileSync("packages/agent-runtime/src/index.ts", "utf8"))) failures.push("agent-runtime must export the disabled runtime");
if (!/implements AgentRuntime/.test(embedded)) failures.push("embedded runtime must implement the AgentRuntime port");

if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`ARCHITECTURE_VERIFIED runtimePackages=${runtimePackages.length} domainImports=0 applicationProviderImports=0\n`);
