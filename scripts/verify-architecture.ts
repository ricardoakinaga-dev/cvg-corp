import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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

type SourceBudget = {
  path: string;
  maxLines: number;
  maxDecisionTokens: number;
};

/**
 * These are executable non-regression ceilings. They deliberately do not
 * claim that the current central modules are already decomposed; the first
 * extracted seams get tighter budgets while legacy owners retain their
 * current ceiling until a later decomposition slice lowers it.
 */
const sourceBudgets: SourceBudget[] = [
  { path: 'packages/persistence/src/index.ts', maxLines: 4800, maxDecisionTokens: 520 },
  { path: 'apps/api/src/app.ts', maxLines: 2500, maxDecisionTokens: 230 },
  { path: 'packages/domain/src/index.ts', maxLines: 2200, maxDecisionTokens: 310 },
  { path: 'packages/contracts/src/index.ts', maxLines: 2050, maxDecisionTokens: 150 },
  { path: 'packages/persistence/src/aud27-domain-writer.ts', maxLines: 220, maxDecisionTokens: 32 },
  { path: 'packages/persistence/src/aud27-domain-writes.ts', maxLines: 190, maxDecisionTokens: 12 },
  { path: 'packages/persistence/src/identity-projection.ts', maxLines: 100, maxDecisionTokens: 12 },
  { path: 'packages/persistence/src/ai-projection.ts', maxLines: 100, maxDecisionTokens: 8 },
  { path: 'packages/persistence/src/ai-usage-projection.ts', maxLines: 100, maxDecisionTokens: 8 },
  { path: 'packages/persistence/src/authoritative-writes.ts', maxLines: 120, maxDecisionTokens: 28 },
  { path: 'packages/persistence/src/operational-backup-job.ts', maxLines: 130, maxDecisionTokens: 18 },
  { path: 'packages/persistence/src/recovery-reconciliation.ts', maxLines: 120, maxDecisionTokens: 24 },
  { path: 'packages/persistence/src/persistence-errors.ts', maxLines: 60, maxDecisionTokens: 4 },
  { path: 'apps/api/src/rate-limiter.ts', maxLines: 250, maxDecisionTokens: 26 },
  { path: 'apps/api/src/sensitive-identifiers.ts', maxLines: 10, maxDecisionTokens: 0 },
  { path: 'packages/domain/src/idempotency.ts', maxLines: 200, maxDecisionTokens: 22 },
  { path: 'packages/domain/src/primitives.ts', maxLines: 25, maxDecisionTokens: 3 },
  { path: 'packages/domain/src/errors.ts', maxLines: 20, maxDecisionTokens: 0 }
];

function sourceMetrics(path: string): { lines: number; decisionTokens: number } {
  const source = readFileSync(path, 'utf8');
  return {
    lines: source.split(/\r?\n/).length,
    decisionTokens: [...source.matchAll(/\b(if|for|while|case|catch|switch)\b/g)].length
  };
}

for (const budget of sourceBudgets) {
  if (!existsSync(budget.path)) {
    failures.push(budget.path + ': source budget target is missing');
    continue;
  }
  const metrics = sourceMetrics(budget.path);
  if (metrics.lines > budget.maxLines) failures.push(budget.path + ': ' + metrics.lines + ' lines exceeds budget ' + budget.maxLines);
  if (metrics.decisionTokens > budget.maxDecisionTokens) failures.push(budget.path + ': ' + metrics.decisionTokens + ' decision tokens exceeds budget ' + budget.maxDecisionTokens);
}

const persistenceIndex = readFileSync('packages/persistence/src/index.ts', 'utf8');
const aud27Writer = readFileSync('packages/persistence/src/aud27-domain-writer.ts', 'utf8');
const identityProjection = readFileSync('packages/persistence/src/identity-projection.ts', 'utf8');
const aiProjection = readFileSync('packages/persistence/src/ai-projection.ts', 'utf8');
const aiUsageProjection = readFileSync('packages/persistence/src/ai-usage-projection.ts', 'utf8');
const authoritativeWrites = readFileSync('packages/persistence/src/authoritative-writes.ts', 'utf8');
const recoveryReconciliation = readFileSync('packages/persistence/src/recovery-reconciliation.ts', 'utf8');
const apiApp = readFileSync('apps/api/src/app.ts', 'utf8');
const rateLimiter = readFileSync('apps/api/src/rate-limiter.ts', 'utf8');
const domainIndex = readFileSync('packages/domain/src/index.ts', 'utf8');
const idempotency = readFileSync('packages/domain/src/idempotency.ts', 'utf8');
const aud27Keys = [
  'providers', 'services', 'resources', 'queueEntries', 'clinicalAddenda', 'beds', 'hospitalEpisodes', 'products',
  'stockLocations', 'lots', 'stockMovements', 'medicationOrders', 'dispensations', 'administrationOccurrences',
  'charges', 'payments', 'ledgerEntries', 'messages', 'knowledgeDocuments', 'aiSessions', 'budgetReservations',
  'aiTurns', 'aiDrafts', 'aiApprovals'
];
const writerCases = [...aud27Writer.matchAll(/^\s+case "([^"]+)":/gm)].map((match) => match[1]!);
if (!persistenceIndex.includes('from "./aud27-domain-writer.js"')) failures.push('persistence index must import the AUD27 writer seam');
if (!persistenceIndex.includes('writeAud27DomainWrite(client, snapshot, write, aud27ProjectionWriterDependencies)')) failures.push('persistence index must delegate AUD27 writes through injected dependencies');
if (persistenceIndex.includes('switch (write.snapshotKey)')) failures.push('persistence index must not retain the AUD27 normalized writer switch');
if (!persistenceIndex.includes('from "./identity-projection.js"')) failures.push('persistence index must import the identity projection seam');
if (!identityProjection.includes('export async function projectIdentity')) failures.push('identity projection seam must export projectIdentity');
if (persistenceIndex.includes('async function projectIdentity')) failures.push('persistence index must not retain the identity projection body');
if (!persistenceIndex.includes('from "./ai-projection.js"')) failures.push('persistence index must import the AI projection seam');
if (!persistenceIndex.includes('projectAiRows(client, snapshot, aiSessions, budgetReservations, aiTurns, aiDrafts, aiApprovals, aiProjectionDependencies)')) failures.push('persistence index must delegate AI rows through the projection seam');
if (!aiProjection.includes('export async function projectAiRows')) failures.push('AI projection seam must export projectAiRows');
if (!persistenceIndex.includes('projectAiTurnUsage(client, snapshot, aiProjectionDependencies.corruption)')) failures.push('persistence index must delegate AI usage projection through the AI seam');
if (!persistenceIndex.includes('from "./ai-usage-projection.js"')) failures.push('persistence index must import the AI usage projection seam');
if (!aiUsageProjection.includes('export async function projectAiTurnUsage')) failures.push('AI usage projection seam must export projectAiTurnUsage');
if (persistenceIndex.includes('async function projectAiTurnUsage')) failures.push('persistence index must not retain the AI usage projection body');
if (!persistenceIndex.includes('aiUsageDigest(') || !aiUsageProjection.includes('export function aiUsageDigest')) failures.push('AI usage digest must be owned by the AI usage projection seam');
if (!persistenceIndex.includes('from "./authoritative-writes.js"')) failures.push('persistence index must import the authoritative writes seam');
if (!authoritativeWrites.includes('export async function writeAuthoritativePatient')) failures.push('authoritative writes seam must export command-owned writers');
if (persistenceIndex.includes('async function writeAuthoritativePatient')) failures.push('persistence index must not retain the authoritative patient writer body');
if (!persistenceIndex.includes('export * from "./recovery-reconciliation.js"')) failures.push('persistence index must export the recovery reconciliation seam');
if (!recoveryReconciliation.includes('export function reconcileRestoredSnapshot')) failures.push('recovery reconciliation seam must own restore reconciliation');
if (persistenceIndex.includes('function reconcileRestoredSnapshot(')) failures.push('persistence index must not retain restore reconciliation implementation');
if (!apiApp.includes('export * from "./rate-limiter.ts"')) failures.push('API app must preserve public rate limiter exports');
if (!rateLimiter.includes('export class PostgresRateLimiter')) failures.push('rate limiter seam must own the distributed limiter');
if (apiApp.includes('class PostgresRateLimiter')) failures.push('API app must not retain the distributed rate limiter implementation');
if (!domainIndex.includes('export * from "./idempotency.js"')) failures.push('domain index must preserve the idempotency public barrel');
if (!idempotency.includes('export async function idempotentAsync')) failures.push('domain idempotency seam must own asynchronous receipt lifecycle');
if (domainIndex.includes('export async function idempotentAsync')) failures.push('domain index must not retain idempotency lifecycle implementation');
if (writerCases.length !== aud27Keys.length || new Set(writerCases).size !== writerCases.length || writerCases.some((key) => !aud27Keys.includes(key))) {
  failures.push('AUD27 writer seam must cover exactly ' + aud27Keys.length + ' normalized cases');
}

function runtimeImportCycles(): string[] {
  const roots = ['packages/domain/src', 'packages/persistence/src', 'packages/contracts/src', 'apps/api/src'];
  const files = roots.flatMap((root) => tsFiles(root));
  const absoluteFiles = new Set(files.map((file) => resolve(file)));
  const graph = new Map<string, string[]>(files.map((file) => [resolve(file), []]));
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const relativeImports = [
      ...source.matchAll(/^\s*import\s+(?!type\b|\()[^;\n]*\sfrom\s+["'](\.[^"']+)["']/gm),
      ...source.matchAll(/^\s*export\s+(?!type\b)(?:\*|\{[^}]*\})(?:\s+as\s+\w+)?[^;\n]*\sfrom\s+["'](\.[^"']+)["']/gm)
    ];
    for (const match of relativeImports) {
      const imported = resolve(dirname(file), match[1]!.replace(/\.js$/, '.ts'));
      if (absoluteFiles.has(imported)) graph.get(resolve(file))!.push(imported);
    }
  }
  const states = new Map<string, 'visiting' | 'visited'>();
  const stack: string[] = [];
  const cycles: string[] = [];
  const visit = (file: string): void => {
    states.set(file, 'visiting');
    stack.push(file);
    for (const imported of graph.get(file) ?? []) {
      if (states.get(imported) === 'visiting') {
        const start = stack.indexOf(imported);
        cycles.push([...stack.slice(start), imported].join(' -> '));
      } else if (!states.has(imported)) visit(imported);
    }
    stack.pop();
    states.set(file, 'visited');
  };
  for (const file of graph.keys()) if (!states.has(file)) visit(file);
  return [...new Set(cycles)];
}

const cycles = runtimeImportCycles();
for (const cycle of cycles) failures.push('runtime import cycle: ' + cycle);

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
process.stdout.write(`ARCHITECTURE_VERIFIED runtimePackages=${runtimePackages.length} domainImports=0 applicationProviderImports=0 aud27WriterCases=${writerCases.length} budgets=${sourceBudgets.length} runtimeImportCycles=${cycles.length}\n`);
