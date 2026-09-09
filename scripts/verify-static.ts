import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { API_ROUTE_CATALOG } from "@cvg/contracts";
import { applicationPolicyFor } from "@cvg/agent-policy";

const failures: string[] = [];
const required = [
  "packages/contracts/src/index.ts", "packages/contracts/src/api-catalog.ts", "packages/domain/src/index.ts", "packages/harness/src/index.ts", "packages/agent-runtime/src/index.ts", "packages/agent-policy/src/index.ts", "packages/agent-tools/src/index.ts", "packages/auth/src/index.ts", "packages/harness-adapters/src/index.ts", "packages/config/src/index.ts", "apps/api/src/server.ts", "apps/api/src/routes/health.ts", "apps/api/src/application/read-services.ts", "apps/api/src/application/domain-command-service.ts", "apps/worker/src/main.ts", "apps/worker/src/worker.ts", "apps/web/src/main.tsx", "apps/web/src/app-shell/App.tsx", "apps/web/src/state/runtime-state.ts", "apps/web/src/styles.css", "db/migrations/001_initial.sql", "db/migrations/019_runtime_scope_guards.sql", "db/migrations/020_auth_security_boundary.sql", "scripts/benchmark-local.ts", "scripts/lint.ts", "tests/unit/auth.test.ts", "tests/unit/worker.test.ts", "tests/unit/domain.test.ts", "tests/integration/api.test.ts", "tests/integration/faults.test.ts"
];
for (const path of required) { try { const content = await readFile(path, "utf8"); if (content.trim().length < 40) failures.push(`${path}: empty artifact`); } catch { failures.push(`${path}: missing`); } }
const sourceFiles: string[] = [];
const walk = async (root: string): Promise<void> => { for (const item of await readdir(root, { withFileTypes: true })) { const path = join(root, item.name); if (item.isDirectory()) await walk(path); else if (/\.(ts|tsx|sql|json|css)$/.test(item.name)) sourceFiles.push(path); } };
await walk("apps"); await walk("packages"); await walk("db"); await walk("scripts");
for (const path of sourceFiles) {
  const content = await readFile(path, "utf8");
  if (/sk-[A-Za-z0-9]{20,}|postgres:\/\/[^\s]*@[^\s]+/.test(content) && !path.endsWith("docker-compose.yml")) failures.push(`${path}: possible credential literal`);
  if (/localStorage\s*\./.test(content)) failures.push(`${path}: localStorage is forbidden for the composer/offline contract`);
}
const docs = await readFile("docs/README.md", "utf8");
if (!docs.includes("Quality") && !docs.includes("qualidade")) failures.push("docs/README.md: documentation index not found");
const routeSources = await Promise.all([readFile("apps/api/src/app.ts", "utf8"), readFile("apps/api/src/routes/health.ts", "utf8")]);
const apiSource = routeSources[0];
const declaredRoutes = new Set<string>();
for (const source of routeSources) {
  for (const match of source.matchAll(/app\.(get|post|delete)\("\/api\/v1([^"?]*)"/g)) {
    const method = match[1];
    const path = match[2] ?? "/";
    if (method) declaredRoutes.add(`${method.toUpperCase()} ${path}`);
  }
}
const catalogRoutes = new Set(API_ROUTE_CATALOG.map((route) => `${route.method} ${route.path}`));
for (const route of declaredRoutes) if (!catalogRoutes.has(route)) failures.push(`API route catalog missing ${route}`);
for (const route of catalogRoutes) if (!declaredRoutes.has(route)) failures.push(`API route catalog declares non-existent ${route}`);
if (!apiSource.includes("authorizeApplicationRequest")) failures.push("apps/api/src/app.ts: application PDP is not wired into the request boundary");
for (const match of apiSource.matchAll(/requestContext\(request,\s*(?:"([^"]+)"|`([^`]+)`)/g)) {
  const operation = match[1] ?? match[2] ?? "";
  if (!applicationPolicyFor(operation)) failures.push(`apps/api/src/app.ts: requestContext operation ${operation} has no application policy rule`);
}
for (const match of apiSource.matchAll(/app\.(get|post|delete)\("([^\"]+)"[\s\S]*?(?=\n  app\.(?:get|post|delete)\(|\n  app\.setNotFoundHandler|\n  app\.setErrorHandler)/g)) {
  const path = match[2] ?? "";
  if (["/api/v1/auth/login", "/api/v1/auth/mfa/verify", "/api/v1/auth/recovery/start", "/api/v1/auth/recovery/complete", "/api/v1/auth/demo", "/api/v1/auth/logout", "/api/v1/integrations/:provider/events"].includes(path)) continue;
  if (!match[0].includes("requestContext(request") && !match[0].includes("enforceApplicationPolicy(request")) failures.push(`apps/api/src/app.ts: protected route ${path} bypasses requestContext/application policy`);
}
for (const method of ["listGuardians", "listPatients", "listAppointments"]) if (apiSource.includes(`persistence.${method}`)) failures.push(`apps/api/src/app.ts: ${method} bypasses the read application service`);
const directDomainMutations = ["grantRole", "revokeRole", "createGuardian", "disablePatient", "mergePatients", "createAppointment", "checkInAppointment", "createEncounter", "createClinicalDocument", "signClinicalDocument", "addClinicalAddendum", "createDiagnosticRequest", "createSpecimen", "createResult", "createStockMovement", "createHospitalEpisode", "createMedicationOrder", "dispenseMedication", "administerMedication", "createCharge", "createPayment", "requestRefund", "createMessage", "createKnowledgeDocument", "restore"];
for (const method of directDomainMutations) if (new RegExp(`store\\.${method}\\s*\\(`).test(apiSource)) failures.push(`apps/api/src/app.ts: ${method} bypasses the domain command service`);
if (failures.length) { for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`); process.exitCode = 1; } else process.stdout.write(`static verification passed: ${required.length} required artifacts, ${sourceFiles.length} source files\n`);
