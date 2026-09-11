import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { API_ROUTE_CATALOG } from "@cvg/contracts";
import { applicationPolicyFor, APPLICATION_POLICY_REGISTRY, toolPolicyFor, TOOL_POLICY_REGISTRY } from "@cvg/agent-policy";
import { TOOL_REGISTRY } from "@cvg/harness";
import { inspectApplicationPdpBoundaries, type PdpBoundarySource } from "./pdp-boundary.ts";
import { inspectHttpRouteInventory } from "./pdp-route-inventory.ts";

const failures: string[] = [];
const apiSources = await Promise.all([
  readFile("apps/api/src/app.ts", "utf8"),
  readFile("apps/api/src/routes/health.ts", "utf8")
]);

async function collectApplicationSources(directory: string): Promise<PdpBoundarySource[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources: PdpBoundarySource[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      sources.push(...await collectApplicationSources(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      sources.push({ path, source: await readFile(path, "utf8") });
    }
  }
  return sources;
}

const applicationPdpInspection = inspectApplicationPdpBoundaries([
  ...await collectApplicationSources("apps/api/src/application"),
  { path: "packages/harness/src/index.ts", source: await readFile("packages/harness/src/index.ts", "utf8") }
]);
const routeInventory = inspectHttpRouteInventory(await collectApplicationSources("apps/api/src"), API_ROUTE_CATALOG);
for (const finding of routeInventory.findings) failures.push(`HTTP inventory ${finding.path}:${finding.line} ${finding.code}: ${finding.detail}`);
for (const violation of applicationPdpInspection.findings) {
  const method = violation.method ? `.${violation.method}` : "";
  const operation = violation.operation ? ` (${violation.operation})` : "";
  failures.push(`PDP boundary ${violation.path}:${violation.className}${method}: ${violation.code}${operation} — ${violation.detail}`);
}
if (applicationPdpInspection.boundaryCount === 0) failures.push("application PDP boundary scan found no ApplicationService or DomainCommandService");

const operations = new Set<string>();
for (const source of apiSources) {
  for (const match of source.matchAll(/requestContext\(request,\s*(?:"([^"]+)"|`([^`]+)`)/g)) {
    const operation = (match[1] ?? match[2] ?? "").replace(/\$\{[^}]+\}/g, "SYNTHETIC");
    if (operation) operations.add(operation);
  }
  for (const match of source.matchAll(/enforceApplicationPolicy\(request,\s*context,\s*"([^"]+)"/g)) {
    if (match[1]) operations.add(match[1]);
  }
}

for (const operation of operations) {
  if (!applicationPolicyFor(operation)) failures.push(`route operation ${operation} has no registered application PDP rule`);
}

const protectedCatalog = API_ROUTE_CATALOG.filter((route) => route.auth !== "PUBLIC");
for (const route of protectedCatalog) {
  if (!applicationPolicyFor(route.operation)) failures.push(`catalog route ${route.method} ${route.path} has no registered application PDP rule`);
  const observed = route.operation === "ai.turn"
    ? [...operations].some((operation) => operation.startsWith("ai.turn."))
    : operations.has(route.operation);
  if (!observed) failures.push(`catalog route ${route.method} ${route.path} is not bound to requestContext`);
}
if (new Set(API_ROUTE_CATALOG.map((route) => `${route.method} ${route.path}`)).size !== API_ROUTE_CATALOG.length) failures.push("API route catalog contains duplicate method/path entries");

const boundarySources = await Promise.all([
  readFile("apps/api/src/application/domain-command-service.ts", "utf8"),
  readFile("apps/api/src/application/agent-service.ts", "utf8"),
  readFile("apps/api/src/application/patient-service.ts", "utf8"),
  readFile("apps/api/src/application/guardian-service.ts", "utf8"),
  readFile("apps/api/src/application/diagnostic-service.ts", "utf8"),
  readFile("apps/api/src/application/read-services.ts", "utf8"),
  readFile("apps/api/src/application/export-service.ts", "utf8"),
  readFile("apps/worker/src/worker.ts", "utf8"),
  readFile("packages/integrations/src/index.ts", "utf8"),
  readFile("packages/persistence/src/index.ts", "utf8")
]);
const [commandSource, agentSource, patientSource, guardianSource, diagnosticSource, readServiceSource, exportSource, workerSource, integrationSource, persistenceSource] = boundarySources;
for (const [name, source] of [["DomainCommandService", commandSource], ["AgentApplicationService", agentSource], ["PatientApplicationService", patientSource], ["GuardianApplicationService", guardianSource], ["DiagnosticRequestApplicationService", diagnosticSource], ["ReadApplicationService", readServiceSource], ["ExportApplicationService", exportSource]] as const) {
  if (!source.includes("enforceApplicationPolicy")) failures.push(`${name} does not enforce the application PDP at its use-case boundary`);
}
if (!exportSource.includes('enforceApplicationPolicy(context, "ops.export"') || !exportSource.includes("encryptRecoveryBundle") || !exportSource.includes("this.commands.execute")) failures.push("ExportApplicationService is missing policy, encryption or idempotency controls");
if (!agentSource.includes("this.commands.execute")) failures.push("AgentApplicationService is missing the durable command idempotency boundary");
if (!agentSource.includes('enforceApplicationPolicy(context, "ai.approval.retry"')) failures.push("AgentApplicationService retry must enforce the ai.approval.retry policy");
for (const match of commandSource.matchAll(/this\.(?:run|authorize)\(context,\s*"([^"]+)"/g)) {
  const operation = match[1] ?? "";
  if (operation && !applicationPolicyFor(operation)) failures.push(`DomainCommandService operation ${operation} has no application PDP rule`);
}
for (const operation of ["patients.read", "patients.create", "guardians.read", "appointments.read"]) {
  if (!patientSource.includes(`enforceApplicationPolicy(context, "${operation}`) && !readServiceSource.includes(`enforceApplicationPolicy(context, "${operation}`)) failures.push(`repository use-case operation ${operation} has no explicit PDP call`);
}
for (const fragment of ["WORKER_LANES", "WORKER_JOB_LANES", "WorkerLaneContext", "organizationId", "workerId", "outboxStats", "runBoundedLane", "claimOutbox", "claimWorkerJobs", "completeWorkerJob", "failWorkerJob", "reconcileUnknownExternalEffect", "fenceToken"]) {
  if (!workerSource.includes(fragment)) failures.push(`worker boundary is missing ${fragment} tenant/lease control`);
}
if (!integrationSource.includes("fenceToken") || !integrationSource.includes("completeOutbox") || !integrationSource.includes("failOutbox")) failures.push("worker boundary is missing fenced outbox completion controls");
for (const fragment of ["exportRecoveryBundle", "organizationTransaction", "validateRecoveryBundle"]) {
  if (!persistenceSource.includes(fragment)) failures.push(`durable export/recovery boundary is missing ${fragment}`);
}

const requiredDomains = ["guardians", "patients", "appointments", "encounters", "clinical", "diagnostics", "hospitalization", "medication", "stock", "finance", "communication", "audit"];
for (const domain of requiredDomains) {
  if (!([...operations].some((operation) => operation.startsWith(`${domain}.`)))) failures.push(`domain ${domain} has no requestContext-bound route`);
  if (!APPLICATION_POLICY_REGISTRY.some((rule) => rule.operation.startsWith(`${domain}.`))) failures.push(`domain ${domain} has no application policy registry entry`);
}

const registryOperations = APPLICATION_POLICY_REGISTRY.map((rule) => rule.operation);
if (new Set(registryOperations).size !== registryOperations.length) failures.push("application policy registry contains duplicate operations");
for (const rule of APPLICATION_POLICY_REGISTRY) {
  if (!/^[a-z][a-z0-9._:-]{1,119}$/.test(rule.capability)) failures.push(`invalid capability for ${rule.operation}`);
  if (rule.allowedRoles.length === 0 || rule.acceptedDataClasses.length === 0) failures.push(`incomplete role/data-class policy for ${rule.operation}`);
}

function toolRisk(risk: (typeof TOOL_REGISTRY)[number]["risk"]): "LOW" | "MEDIUM" | "CRITICAL" {
  if (risk === "READ_ONLY") return "LOW";
  if (risk === "DRAFT" || risk === "REVERSIBLE") return "MEDIUM";
  return "CRITICAL";
}

function sameList(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

const toolNames = TOOL_REGISTRY.map((tool) => tool.name);
if (new Set(toolNames).size !== toolNames.length) failures.push("harness tool registry contains duplicate names");
if (TOOL_POLICY_REGISTRY.length !== TOOL_REGISTRY.length) failures.push("canonical tool policy registry and harness tool registry have different sizes");
for (const tool of TOOL_REGISTRY) {
  const rule = toolPolicyFor(tool.name);
  if (!rule) {
    failures.push(`tool ${tool.name} has no canonical tool policy`);
    continue;
  }
  if (rule.operation !== tool.operation) failures.push(`tool ${tool.name} operation diverges from canonical policy`);
  if (rule.capability !== tool.capability) failures.push(`tool ${tool.name} capability diverges from canonical policy`);
  if (rule.risk !== toolRisk(tool.risk)) failures.push(`tool ${tool.name} risk diverges from canonical policy`);
  if (rule.approvalMode !== tool.approvalMode || rule.requiresApproval !== tool.requiresApproval) failures.push(`tool ${tool.name} approval metadata diverges from canonical policy`);
  if (!sameList(rule.allowedRoles, tool.allowedRoles)) failures.push(`tool ${tool.name} role allowlist diverges from canonical policy`);
  if (!sameList(rule.acceptedDataClasses, tool.acceptedDataClasses)) failures.push(`tool ${tool.name} data-class allowlist diverges from canonical policy`);
  if (rule.scope !== tool.scope || rule.resourceRequired !== tool.resourceRequired) failures.push(`tool ${tool.name} resource scope diverges from canonical policy`);
  if (rule.idempotency !== tool.idempotency || rule.auditAction !== tool.auditAction || !sameList(rule.secretRefs, tool.secretRefs) || rule.egress !== "LOCAL_ONLY") failures.push(`tool ${tool.name} execution controls diverge from canonical policy`);
  if (!applicationPolicyFor(tool.operation)) failures.push(`tool ${tool.name} operation has no application PDP rule`);
}
const canonicalToolNames = TOOL_POLICY_REGISTRY.map((rule) => rule.toolName);
if (new Set(canonicalToolNames).size !== canonicalToolNames.length) failures.push("canonical tool policy registry contains duplicate names");
for (const rule of TOOL_POLICY_REGISTRY) {
  if (!TOOL_REGISTRY.some((tool) => tool.name === rule.toolName)) failures.push(`canonical tool policy ${rule.toolName} has no harness implementation`);
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`PDP coverage passed: ${operations.size} request-bound operations, ${APPLICATION_POLICY_REGISTRY.length} registered rules, ${TOOL_POLICY_REGISTRY.length} canonical tool policies, ${requiredDomains.length} critical domains\n`);
}
