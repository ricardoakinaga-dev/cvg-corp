import { readFile } from "node:fs/promises";
import { applicationPolicyFor, APPLICATION_POLICY_REGISTRY } from "@cvg/agent-policy";

const failures: string[] = [];
const apiSources = await Promise.all([
  readFile("apps/api/src/app.ts", "utf8"),
  readFile("apps/api/src/routes/health.ts", "utf8")
]);
const operations = new Set<string>();
for (const source of apiSources) {
  for (const match of source.matchAll(/requestContext\(request,\s*(?:"([^"]+)"|`([^`]+)`)/g)) {
    const operation = (match[1] ?? match[2] ?? "").replace(/\$\{[^}]+\}/g, "SYNTHETIC");
    if (operation) operations.add(operation);
  }
}

for (const operation of operations) {
  if (!applicationPolicyFor(operation)) failures.push(`route operation ${operation} has no registered application PDP rule`);
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

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`PDP coverage passed: ${operations.size} request-bound operations, ${APPLICATION_POLICY_REGISTRY.length} registered rules, ${requiredDomains.length} critical domains\n`);
}
