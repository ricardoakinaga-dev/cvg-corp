import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { API_ROUTE_CATALOG } from "@cvg/contracts";
import { applicationPolicyFor } from "@cvg/agent-policy";
import { inspectApplicationPdpBoundaries } from "./pdp-boundary.ts";
import { inspectRouteIdentityContextReads } from "./identity-context-boundary.ts";
import { EXPECTED_PROMPT_SHA256, PROMPT_REFERENCE, promptIntegrityValid, promptSha256, qualityBarPhaseInventoryValid } from "./prompt-integrity.ts";
import { EVIDENCE_SNAPSHOT_PATH, verifyEvidenceSnapshot, type EvidenceSnapshot } from "./verify-evidence-snapshot.ts";

const failures: string[] = [];
const required = [
  "README.md",
  "docs/README.md",
  "docs/prompt-final-operational-proof-2026-09-10.txt",
  "docs/final-operational-proof-audit.md",
  "docs/pdp-universal-proof.md",
  "docs/authoritative-write-proof.md",
  "docs/usage-settlement-proof.md",
  "docs/deepseek-real-proof.md",
  "docs/provider-real-proof.md",
  "docs/postgres-concurrency-proof.md",
  "docs/worker-production-proof.md",
  "docs/observability-proof.md",
  "docs/load-proof.md",
  "docs/chaos-proof.md",
  "docs/recovery-proof-final.md",
  "docs/accessibility-proof.md",
  "docs/security-red-team-final.md",
  "docs/triple-aaa-final-scorecard.md",
  "docs/api-compatibility-proof.md",
  "docs/release-provenance.md",
  "docs/staging.md",
  "docs/runbooks/deployment.md",
  "docs/runbooks/rollback.md",
  "docs/runbooks/backup.md",
  "docs/runbooks/backup-incidente.md",
  "docs/runbooks/break-glass.md",
  "docs/runbooks/credential-rotation.md",
  "docs/runbooks/database-incident.md",
  "docs/runbooks/deepseek-bridge-outage.md",
  "docs/runbooks/deepseek-harness-outage.md",
  "docs/runbooks/deploy.md",
  "docs/runbooks/provider-outage.md",
  "docs/runbooks/security-incident.md",
  "docs/runbooks/quarantine.md",
  "docs/runbooks/restore.md",
  "docs/runbooks/slo-breach.md",
  "docs/runbooks/worker-backlog.md",
  ".gauntlet/bar-v4.json",
  "tests/load/cvg-staging.k6.js",
  "tests/load/duration.js",
  "tests/load/duration.d.ts",
  "artifacts/operational-proof/local-verification-2026-09-10.json",
  "artifacts/operational-proof/triple-aaa-evidence.json",
  "artifacts/operational-proof/pdp-evidence.json",
  "artifacts/operational-proof/pdp-universal-evidence.json",
  "artifacts/operational-proof/authoritative-write-evidence.json",
  "artifacts/operational-proof/audit-chain-evidence.json",
  "artifacts/operational-proof/browser-matrix-local-2026-09-10.json",
  "artifacts/operational-proof/postgres-real-local-2026-09-10.json",
  "artifacts/operational-proof/security-red-team-local.json",
  "artifacts/operational-proof/resource-pressure-local.json",
  "artifacts/operational-proof/runbook-execution-local.json",
  EVIDENCE_SNAPSHOT_PATH,
  "packages/contracts/src/index.ts", "packages/contracts/src/version.ts", "packages/contracts/src/api-catalog.ts", "packages/domain/src/index.ts", "packages/domain/src/snapshot-validation.ts", "packages/harness/src/index.ts", "packages/agent-runtime/src/index.ts", "packages/agent-policy/src/index.ts", "packages/agent-tools/src/index.ts", "packages/auth/src/index.ts", "packages/harness-adapters/src/index.ts", "packages/deepseek-bridge/src/index.ts", "packages/deepseek-bridge/src/real-proof.ts", "packages/config/src/index.ts", "apps/api/src/server.ts", "apps/deepseek-bridge/src/server.ts", "apps/api/src/routes/health.ts", "apps/api/src/application/agent-service.ts", "apps/api/src/application/appointment-service.ts", "apps/api/src/application/diagnostic-service.ts", "apps/api/src/application/encounter-service.ts", "apps/api/src/application/patient-service.ts", "apps/api/src/application/guardian-service.ts", "apps/api/src/application/read-services.ts", "apps/api/src/application/domain-command-service.ts", "apps/api/src/application/clinical-command-service.ts", "apps/api/src/application/export-service.ts", "apps/api/src/application/idempotency-service.ts", "apps/api/src/application/integration-service.ts", "apps/api/src/application/operational-metrics-service.ts", "apps/api/src/application/break-glass-service.ts", "apps/worker/src/main.ts", "apps/worker/src/operational-backup.ts", "apps/worker/src/worker.ts", "docker/worker.ts", "tsconfig.json", "apps/web/src/main.tsx", "apps/web/src/app-shell/App.tsx", "apps/web/src/state/runtime-state.ts", "db/migrations/001_initial.sql", "db/migrations/019_runtime_scope_guards.sql", "db/migrations/020_auth_security_boundary.sql", "db/migrations/021_snapshot_revision_scope.sql", "db/migrations/022_runtime_database_role.sql", "db/migrations/023_distributed_rate_limit.sql", "db/migrations/024_external_effect_reconciliation_states.sql", "db/migrations/025_communication_approval_provenance.sql", "db/migrations/026_audit_tamper_evident_chain.sql", "db/migrations/027_append_only_audit_guard.sql", "db/migrations/028_append_only_lock_privileges.sql", "db/migrations/029_ai_turn_provenance_usage_and_dml_scope.sql", "db/migrations/030_break_glass_durable_lifecycle.sql", "db/migrations/031_worker_jobs_and_heartbeats.sql", "db/migrations/032_diagnostic_request_scope.sql", "db/migrations/033_diagnostic_specimen_result_scope.sql", "db/migrations/034_diagnostic_child_integrity_backstop.sql", "db/migrations/035_break_glass_scope.sql", "db/migrations/036_runtime_migration_metadata_privileges.sql", "scripts/benchmark-local.ts", "scripts/lint.ts", "scripts/pdp-boundary.ts", "scripts/pdp-route-inventory.ts", "scripts/identity-context-boundary.ts", "scripts/verify-pdp-universal.ts", "scripts/verify-audit-chain.ts", "scripts/verify-deepseek-real.ts", "scripts/verify-triplo-aaa.ts", "scripts/verify-provider-real.ts", "scripts/verify-provider-sandbox.ts", "tests/unit/auth.test.ts", "tests/unit/pdp-coverage.test.ts", "tests/unit/pdp-universal.test.ts", "tests/unit/pdp-route-inventory.test.ts", "tests/unit/identity-context-boundary.test.ts", "tests/unit/break-glass-service.test.ts", "tests/unit/worker.test.ts", "tests/unit/deepseek-bridge.test.ts", "tests/unit/deepseek-real-proof.test.ts", "tests/unit/triplo-aaa.test.ts", "tests/unit/domain.test.ts", "tests/integration/api.test.ts", "tests/integration/faults.test.ts", "tests/integration/provider-sandbox.test.ts", "tests/integration/worker-jobs.test.ts", "tests/integration/route-catalog.test.ts"
];
required.push("tests/unit/worker-backup.test.ts");
required.splice(required.indexOf("scripts/verify-deepseek-real.ts"), 0, "scripts/verify-authoritative-writes.ts");
required.splice(required.indexOf("scripts/verify-authoritative-writes.ts"), 0, "scripts/verify-postgres-concurrency.ts");
required.splice(required.indexOf("scripts/verify-deepseek-real.ts"), 0, "scripts/verify-release-provenance.ts", "scripts/verify-promotion-invariant.ts", "scripts/verify-container-smoke.ts", "scripts/verify-security-red-team.ts", "scripts/verify-resource-pressure.ts", "scripts/verify-runbook-execution.ts");
required.splice(required.indexOf("scripts/verify-deepseek-real.ts"), 0, "scripts/verify-backup-retention.ts");
required.splice(required.indexOf("scripts/verify-deepseek-real.ts"), 0, "scripts/verify-worker-runtime.ts");
for (const path of required) { try { const content = await readFile(path, "utf8"); if (content.trim().length < 40) failures.push(`${path}: empty artifact`); } catch { failures.push(`${path}: missing`); } }
const promptContent = await readFile(PROMPT_REFERENCE, "utf8").catch(() => "");
if (!promptContent || !promptIntegrityValid(promptContent)) failures.push(`${PROMPT_REFERENCE}: SHA-256 ${promptSha256(promptContent)} does not match the preserved prompt ${EXPECTED_PROMPT_SHA256}`);
const qualityBarContent = await readFile(".gauntlet/bar-v4.json", "utf8").catch(() => "");
if (!qualityBarContent) failures.push(".gauntlet/bar-v4.json: quality bar is missing");
else {
  try {
    if (!qualityBarPhaseInventoryValid(JSON.parse(qualityBarContent))) failures.push(".gauntlet/bar-v4.json: phase inventory or prompt binding is stale");
  } catch (error) {
    failures.push(`.gauntlet/bar-v4.json: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}
const snapshotContent = await readFile(EVIDENCE_SNAPSHOT_PATH, "utf8").catch(() => "");
if (!snapshotContent) failures.push(`${EVIDENCE_SNAPSHOT_PATH}: evidence snapshot is missing`);
else {
  try {
    const snapshot = JSON.parse(snapshotContent) as EvidenceSnapshot;
    for (const error of await verifyEvidenceSnapshot(snapshot)) failures.push(`evidence snapshot: ${error}`);
  } catch (error) {
    failures.push(`${EVIDENCE_SNAPSHOT_PATH}: invalid JSON or snapshot contract (${error instanceof Error ? error.message : String(error)})`);
  }
}
const sourceFiles: string[] = [];
const walk = async (root: string): Promise<void> => { for (const item of await readdir(root, { withFileTypes: true })) { const path = join(root, item.name); if (item.isDirectory()) await walk(path); else if (/\.(ts|tsx|sql|json|css)$/.test(item.name)) sourceFiles.push(path); } };
await walk("apps"); await walk("packages"); await walk("db"); await walk("scripts"); await walk("docker");
const applicationSources = await Promise.all(sourceFiles
  .filter((path) => (path.startsWith("apps/api/src/application/") || path === "packages/harness/src/index.ts") && path.endsWith(".ts"))
  .map(async (path) => ({ path, source: await readFile(path, "utf8") })));
const applicationPdpInspection = inspectApplicationPdpBoundaries(applicationSources);
for (const violation of applicationPdpInspection.findings) {
  const method = violation.method ? `.${violation.method}` : "";
  const operation = violation.operation ? ` (${violation.operation})` : "";
  failures.push(`PDP boundary ${violation.path}:${violation.className}${method}: ${violation.code}${operation} — ${violation.detail}`);
}
if (applicationPdpInspection.boundaryCount === 0) failures.push("application PDP boundary scan found no ApplicationService or DomainCommandService");
for (const path of sourceFiles) {
  const content = await readFile(path, "utf8");
  if (/sk-[A-Za-z0-9]{20,}|postgres:\/\/[^\s]*@[^\s]+/.test(content) && !path.endsWith("docker-compose.yml")) failures.push(`${path}: possible credential literal`);
  if (/localStorage\s*\./.test(content)) failures.push(`${path}: localStorage is forbidden for the composer/offline contract`);
}
const docs = await readFile("docs/README.md", "utf8");
if (!docs.includes("Quality") && !docs.includes("qualidade")) failures.push("docs/README.md: documentation index not found");
const packageManifest = await readFile("package.json", "utf8");
if (!packageManifest.includes("verify:pdp-universal") || !packageManifest.includes("verify:audit-chain") || !packageManifest.includes("verify:authoritative-writes") || !packageManifest.includes("verify:postgres:concurrency") || !packageManifest.includes("verify:deepseek-real") || !packageManifest.includes("verify:provider-real") || !packageManifest.includes("verify:worker-runtime") || !packageManifest.includes("verify:triplo-aaa") || !packageManifest.includes("verify:release-provenance") || !packageManifest.includes("verify:promotion-invariant") || !packageManifest.includes("verify:container-smoke") || !packageManifest.includes("verify:security-red-team") || !packageManifest.includes("verify:resource-pressure") || !packageManifest.includes("verify:runbook-execution") || !packageManifest.includes("verify:backup-retention") || !packageManifest.includes("verify:evidence-snapshot")) failures.push("package.json: operational proof gates are not declared");
const contractCatalog = await readFile("packages/contracts/src/api-catalog.ts", "utf8");
if (!contractCatalog.includes("API_UPCASTERS") || !contractCatalog.includes("upcastApiValue") || !contractCatalog.includes('upcasters: "FAIL_CLOSED_REGISTRY"')) failures.push("packages/contracts/src/api-catalog.ts: API compatibility must expose an executable fail-closed upcaster registry");
const ciWorkflow = await readFile(".github/workflows/ci.yml", "utf8");
if (!ciWorkflow.includes("npm run verify:pdp-universal") || !ciWorkflow.includes("npm run verify:audit-chain") || !ciWorkflow.includes("npm run verify:authoritative-writes") || !ciWorkflow.includes("npm run verify:postgres:concurrency") || !ciWorkflow.includes("npm run verify:release-provenance") || !ciWorkflow.includes("npm run verify:evidence-snapshot")) failures.push(".github/workflows/ci.yml: operational proof gates are not executed");
const containerJob = /container-build:[\s\S]*?(?=\n  [A-Za-z0-9_-]+:|$)/.exec(ciWorkflow)?.[0] ?? "";
if (!containerJob.includes("actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020") || !containerJob.includes("npm ci --ignore-scripts")) failures.push(".github/workflows/ci.yml: container provenance job must install the pinned Node toolchain locally");
if (containerJob.includes("docker image inspect --format '{{.Id}}'")) failures.push(".github/workflows/ci.yml: container provenance must not use a local image ID as a deployable digest");
if (!containerJob.includes("docker buildx build") || !containerJob.includes("type=oci") || !containerJob.includes("index.json") || !containerJob.includes("sha256:[a-f0-9]{64}")) failures.push(".github/workflows/ci.yml: container provenance must bind OCI manifest bytes to immutable sha256 digests");
if (!ciWorkflow.includes("artifacts/ci-results.json") || !ciWorkflow.includes("artifacts/sbom.cdx.json") || !ciWorkflow.includes("name: Upload release provenance")) failures.push(".github/workflows/ci.yml: release provenance upload must include the SBOM and completed CI result receipt");
const provenanceSource = await readFile("scripts/verify-release-provenance.ts", "utf8");
if (!provenanceSource.includes("ciResultsDigest") || !provenanceSource.includes("verifyCiResults") || !provenanceSource.includes("sbomPath")) failures.push("scripts/verify-release-provenance.ts: provenance must bind SBOM and completed CI result bytes");
const workerMain = await readFile("apps/worker/src/main.ts", "utf8");
const dockerWorker = await readFile("docker/worker.ts", "utf8");
const operationalBackup = await readFile("apps/worker/src/operational-backup.ts", "utf8");
const workerComposition = await readFile("apps/worker/src/worker.ts", "utf8");
const restoreScript = await readFile("scripts/verify-postgres-restore.ts", "utf8");
const productionVerifier = await readFile("scripts/verify-production.ts", "utf8");
const tsconfig = await readFile("tsconfig.json", "utf8");
const lintConfig = await readFile("scripts/lint.ts", "utf8");
// Production entrypoints may pass observability/resource controls as the
// fourth dependency argument. Guard the mandatory composition without
// rejecting those controls.
const configuredWorkerConstruction = /new CvgWorkerApplication\s*\(\s*createWorkerDependencies\s*\(\s*persistence\s*,\s*config\s*,\s*configuredSink(?:\s*,[\s\S]*?)?\)\s*\)/;
if (!configuredWorkerConstruction.test(workerMain)) failures.push("apps/worker/src/main.ts: configured worker construction contract is missing");
if (!configuredWorkerConstruction.test(dockerWorker)) failures.push("docker/worker.ts: configured worker construction contract is missing");
if (!workerMain.includes("createOperationalBackupJob") || !workerMain.includes("operationalBackup?.runOnce()") || !workerMain.includes("operationalBackup?.start({ runImmediately: false })") || !workerMain.includes("operationalBackup?.stop()")) failures.push("apps/worker/src/main.ts: operational backup must pass an initial preflight before the worker loop");
if (!dockerWorker.includes("createOperationalBackupJob") || !dockerWorker.includes("operationalBackup?.runOnce()") || !dockerWorker.includes("operationalBackup?.start({ runImmediately: false })") || !dockerWorker.includes("operationalBackup?.stop()")) failures.push("docker/worker.ts: operational backup must pass an initial preflight before the worker loop");
if (!operationalBackup.includes("exportRecoveryBundle") || !operationalBackup.includes("configured backup organization") || !operationalBackup.includes("OperationalBackupJob")) failures.push("apps/worker/src/operational-backup.ts: backup composition is not organization-scoped and fail-closed");
if (!workerComposition.includes("const effects = hasDurableEffectLedger(persistence) ? persistence : null")) failures.push("apps/worker/src/worker.ts: production composition must connect a complete durable effect ledger or remain fail-closed");
if (!workerComposition.includes("effects,")) failures.push("apps/worker/src/worker.ts: worker dependencies must expose the composed effect ledger");
if (!restoreScript.includes("auditRecords: restoredSnapshot.auditRecords")) failures.push("scripts/verify-postgres-restore.ts: restore must project the canonical audit records into the quarantine target");
if (!restoreScript.includes("commandReceipts: restoredSnapshot.commandReceipts")) failures.push("scripts/verify-postgres-restore.ts: restore must project the canonical command receipts into the quarantine target");
if (!restoreScript.includes("cvg_audit_ledger") || !restoreScript.includes("cvg_command_receipt_ledger")) failures.push("scripts/verify-postgres-restore.ts: restore must verify append-only audit and receipt ledgers in the target");
if (!restoreScript.includes("order by ledger.sequence_id")) failures.push("scripts/verify-postgres-restore.ts: restore must compare canonical records in append-only ledger order");
if (!restoreScript.includes("targetBundle.snapshot.sessions.some")) failures.push("scripts/verify-postgres-restore.ts: restore must verify revoked sessions after target persistence");
if (!tsconfig.includes('"docker/**/*.ts"')) failures.push("tsconfig.json: docker worker entrypoint is outside the typecheck include");
if (!lintConfig.includes('"docker"')) failures.push("scripts/lint.ts: docker is outside the lint roots");
if (!productionVerifier.includes("const structuralMode") || !productionVerifier.includes("verification mode is required") || !productionVerifier.includes("--production")) failures.push("scripts/verify-production.ts: synthetic structural and real production modes must be explicit");
const routeSources = await Promise.all([readFile("apps/api/src/app.ts", "utf8"), readFile("apps/api/src/routes/health.ts", "utf8")]);
const apiSource = routeSources[0];
if (!apiSource.includes("assertProductionRuntimeOverrides") || !apiSource.includes("PRODUCTION_INJECTION_KEYS")) failures.push("apps/api/src/app.ts: production runtime must reject injected synthetic dependencies");
for (const finding of inspectRouteIdentityContextReads("apps/api/src/app.ts", apiSource)) failures.push(`identity/context route read ${finding.path}:${finding.line}: ${finding.detail}`);
if (!apiSource.includes("x-cvg-release-sha") || !apiSource.includes("x-cvg-release-artifact-digest")) failures.push("apps/api/src/app.ts: release provenance headers are not bound to responses");
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
if (!apiSource.includes("new DurableIdempotencyService") || !apiSource.includes("commandExecutor.execute")) failures.push("apps/api/src/app.ts: durable command idempotency is not wired into the mutation boundary");
if (apiSource.includes("idempotent(store")) failures.push("apps/api/src/app.ts: direct process-local idempotency bypasses the durable command boundary");
for (const match of apiSource.matchAll(/requestContext\(request,\s*(?:"([^"]+)"|`([^`]+)`)/g)) {
  const operation = match[1] ?? match[2] ?? "";
  if (!applicationPolicyFor(operation)) failures.push(`apps/api/src/app.ts: requestContext operation ${operation} has no application policy rule`);
}
for (const match of apiSource.matchAll(/app\.(get|post|delete)\("([^\"]+)"[\s\S]*?(?=\n  app\.(?:get|post|delete)\(|\n  app\.setNotFoundHandler|\n  app\.setErrorHandler)/g)) {
  const path = match[2] ?? "";
  // Prometheus scrapes this redacted aggregate endpoint over the private observability network;
  // it is deliberately outside /api/v1, has no tenant/route labels and is not a user operation.
  if (path === "/internal/metrics") continue;
  if (["/api/v1/auth/login", "/api/v1/auth/mfa/verify", "/api/v1/auth/recovery/start", "/api/v1/auth/recovery/complete", "/api/v1/auth/demo", "/api/v1/auth/logout", "/api/v1/integrations/:provider/events"].includes(path)) continue;
  if (!match[0].includes("requestContext(request") && !match[0].includes("enforceApplicationPolicy(request")) failures.push(`apps/api/src/app.ts: protected route ${path} bypasses requestContext/application policy`);
}
for (const method of ["listGuardians", "listPatients", "listAppointments", "listQueue", "listEncounters", "listDiagnosticRequests", "listSpecimens", "listDiagnosticResults", "listBeds", "listHospitalEpisodes", "listMedicationOrders", "listStock", "listCharges", "listPayments", "listLedgerEntries", "listMessages", "listKnowledgeDocuments", "listAiSessions"]) if (apiSource.includes(`persistence.${method}`) || apiSource.includes(`store.${method}`)) failures.push(`apps/api/src/app.ts: ${method} bypasses the read application service`);
for (const collection of ["diagnosticRequests", "specimens", "diagnosticResults", "queueEntries", "charges", "payments", "ledgerEntries", "messages", "knowledgeDocuments", "aiSessions", "aiTurns"]) if (apiSource.includes(`store.${collection}.values()`)) failures.push(`apps/api/src/app.ts: ${collection} bypasses the read application service`);
if (apiSource.includes("store.clinicalDocuments")) failures.push("apps/api/src/app.ts: clinicalDocuments bypasses the read application service");
if (!apiSource.includes("new IntegrationInboxApplicationService") || !apiSource.includes("integrationInboxApplication.receive")) failures.push("apps/api/src/app.ts: signed integration callbacks bypass the integration application service");
if (!apiSource.includes("new OperationalMetricsApplicationService") || !apiSource.includes("operationalMetricsApplication.read")) failures.push("apps/api/src/app.ts: operational metrics bypass the metrics application service");
const workerSource = await readFile("apps/worker/src/worker.ts", "utf8");
if (!workerSource.includes("WORKER_POLICY_REGISTRY") || !workerSource.includes("enforceWorkerPolicy({")) failures.push("apps/worker/src/worker.ts: durable jobs bypass the canonical worker policy registry");
if (!workerSource.includes('secretProvider.status() !== "READY"')) failures.push("apps/worker/src/worker.ts: enabled provider sink must require a READY SecretProvider");
const acpSource = await readFile("packages/deepseek-bridge/src/acp.ts", "utf8");
const bridgeServerSource = await readFile("apps/deepseek-bridge/src/server.ts", "utf8");
if (!acpSource.includes("export interface DeepSeekAcpGovernance") || !acpSource.includes("authorizeTurn") || !acpSource.includes("recordTurn") || !acpSource.includes("loadSession")) failures.push("packages/deepseek-bridge/src/acp.ts: ACP must require explicit governance, durable result recording and restart session loading");
if (!bridgeServerSource.includes("governance?: DeepSeekAcpGovernance") || !bridgeServerSource.includes("options.governance")) failures.push("apps/deepseek-bridge/src/server.ts: ACP governance must be an explicit composition dependency");
if (!bridgeServerSource.includes('provider.status() !== "READY"')) failures.push("apps/deepseek-bridge/src/server.ts: secret resolvers must require a READY SecretProvider");
const auditVerifier = await readFile("scripts/verify-audit-chain.ts", "utf8");
if (!auditVerifier.includes("verifyAuditChain") || !auditVerifier.includes("tamper")) failures.push("scripts/verify-audit-chain.ts: executable tamper-evident chain verifier is incomplete");
const directDomainMutations = ["grantRole", "revokeRole", "createGuardian", "disablePatient", "mergePatients", "createAppointment", "checkInAppointment", "createEncounter", "createClinicalDocument", "signClinicalDocument", "addClinicalAddendum", "createDiagnosticRequest", "createSpecimen", "createResult", "createStockMovement", "createHospitalEpisode", "createMedicationOrder", "dispenseMedication", "administerMedication", "createCharge", "createPayment", "requestRefund", "createMessage", "createKnowledgeDocument", "restore"];
for (const method of directDomainMutations) if (new RegExp(`store\\.${method}\\s*\\(`).test(apiSource)) failures.push(`apps/api/src/app.ts: ${method} bypasses the domain command service`);
if (failures.length) { for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`); process.exitCode = 1; } else process.stdout.write(`static verification passed: ${required.length} required artifacts, ${sourceFiles.length} source files\n`);
