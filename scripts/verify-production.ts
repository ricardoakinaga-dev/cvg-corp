import { lstat, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CVG_RUNTIME_DATABASE_ROLE, CVG_SECRET_PROVIDER_KINDS, databaseRoleFromUrl } from "@cvg/config";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productionMode = process.argv.includes("--production");
const structuralMode = process.argv.includes("--structural");
const failures: string[] = [];
const observations: string[] = [];

const requiredFiles = [
  "artifacts/operational-proof/local-verification-2026-09-10.json",
  "package.json",
  "tsconfig.json",
  ".github/workflows/ci.yml",
  ".github/dependabot.yml",
  "Dockerfile.api",
  "Dockerfile.web",
  "docker-compose.yml",
  "docker-compose.production.yml",
  "docker-compose.observability.yml",
  "docker/observability/otel-collector.yml",
  "docker/observability/tempo.yml",
  "docker/observability/prometheus.yml",
  "docker/observability/alerts.yml",
  "docker/observability/alertmanager.yml",
  "docker/observability/grafana/provisioning/datasources/datasource.yml",
  "docker/observability/grafana/provisioning/dashboards/dashboards.yml",
  "docker/observability/grafana/dashboards/cvg-runtime.json",
  "docker/.env.example",
  "docker/nginx/web.conf",
  "docker/nginx/proxy.conf",
  "docker/nginx/proxy.tls.conf",
  "docker/worker.ts",
  "apps/api/src/app.ts",
  "apps/api/src/application/diagnostic-service.ts",
  "apps/api/src/application/guardian-service.ts",
  "apps/api/src/application/export-service.ts",
  "apps/api/src/application/idempotency-service.ts",
  "apps/api/src/server.ts",
  "apps/worker/src/main.ts",
  "apps/worker/src/operational-backup.ts",
  "apps/worker/src/worker.ts",
  "packages/persistence/src/index.ts",
  "packages/ops/src/otel.ts",
  "packages/config/src/index.ts",
  "packages/agent-runtime/src/index.ts",
  "packages/harness/src/index.ts",
  "packages/agent-policy/src/index.ts",
  "packages/agent-tools/src/index.ts",
  "packages/deepseek-bridge/src/index.ts",
  "packages/deepseek-bridge/src/acp.ts",
  "apps/deepseek-bridge/src/server.ts",
  "packages/auth/src/index.ts",
  "db/migrations/019_runtime_scope_guards.sql",
  "db/migrations/020_auth_security_boundary.sql",
  "db/migrations/021_snapshot_revision_scope.sql",
  "db/migrations/022_runtime_database_role.sql",
  "db/migrations/023_distributed_rate_limit.sql",
  "db/migrations/024_external_effect_reconciliation_states.sql",
  "db/migrations/025_communication_approval_provenance.sql",
  "db/migrations/026_audit_tamper_evident_chain.sql",
  "db/migrations/027_append_only_audit_guard.sql",
  "db/migrations/028_append_only_lock_privileges.sql",
  "db/migrations/029_ai_turn_provenance_usage_and_dml_scope.sql",
  "db/migrations/030_break_glass_durable_lifecycle.sql",
  "db/migrations/031_worker_jobs_and_heartbeats.sql",
  "db/migrations/032_diagnostic_request_scope.sql",
  "db/migrations/033_diagnostic_specimen_result_scope.sql",
  "db/migrations/034_diagnostic_child_integrity_backstop.sql",
  "db/migrations/035_break_glass_scope.sql",
  "db/migrations/036_runtime_migration_metadata_privileges.sql",
  "docs/runbooks/deploy.md",
  "docs/runbooks/deployment.md",
  "docs/runbooks/rollback.md",
  "docs/runbooks/backup.md",
  "docs/runbooks/backup-incidente.md",
  "docs/runbooks/restore.md",
  "docs/runbooks/database-incident.md",
  "docs/runbooks/provider-outage.md",
  "docs/runbooks/deepseek-harness-outage.md",
  "docs/runbooks/security-incident.md",
  "docs/runbooks/credential-rotation.md",
  "docs/runbooks/worker-backlog.md",
  "docs/runbooks/quarantine.md",
  "docs/runbooks/break-glass.md",
  "docs/production-readiness-vNext.md",
  "docs/security-review-vNext.md",
  "docs/ai-runtime-vNext.md",
  "docs/deployment-vNext.md",
  "docs/verification-vNext.md",
  "docs/benchmarks/local-baseline.md",
  "docs/fault-matrix-vNext.md",
  "docs/error-taxonomy-vNext.md",
  "docs/state-of-the-art-scorecard.md",
  "docs/production-reality-audit-vNext.md",
  "docs/deepseek-integration-vNext.md",
  "docs/provider-integration-vNext.md",
  "docs/observability-vNext.md",
  "docs/staging-vNext.md",
  "docs/recovery-vNext.md",
  "docs/performance-vNext.md",
  "docs/final-closure-audit.md",
  "docs/deepseek-production-integration.md",
  "docs/provider-production-integration.md",
  "docs/pdp-universal-coverage.md",
  "docs/adr/021-authoritative-normalized-guardian-write.md",
  "docs/verification-2026-09-10-guardian-source-write.md",
  "docs/adr/022-authoritative-diagnostic-request-write.md",
  "docs/verification-2026-09-10-diagnostic-request-source-write.md",
  "docs/adr/023-authoritative-diagnostic-child-writes.md",
  "docs/verification-2026-09-10-diagnostic-child-source-writes.md",
  "docs/adr/026-universal-authoritative-invariants.md",
  "docs/authoritative-write-proof.md",
  "docs/postgres-concurrency-proof.md",
  ".gauntlet/critique-diagnostic-request-scope-20260910.md",
  ".gauntlet/critique-diagnostic-child-writes-20260910.md",
  "docs/observability-production.md",
  "docs/staging.md",
  "docs/load-and-chaos.md",
  "docs/recovery-proof.md",
  "docs/triple-aaa-final-scorecard.md",
  "docs/adr/015-deepseek-bridge-contract.md",
  "docs/adr/028-deepseek-acp-governance-boundary.md",
  "docs/runbooks/deepseek-bridge-outage.md",
  "scripts/verify-licenses.ts",
  "scripts/lint.ts",
  "scripts/verify-static.ts",
  "scripts/verify-worker-runtime.ts",
  "scripts/audit-design-tokens.ts",
  "scripts/check-contrast.ts",
  "scripts/verify-authoritative-writes.ts",
  "scripts/verify-postgres-concurrency.ts",
  "tests/unit/worker.test.ts",
  "tests/integration/worker-jobs.test.ts",
  "tests/integration/faults.test.ts",
  "tests/integration/provider-sandbox.test.ts",
  ".gauntlet/bar-v3.json",
  ".gauntlet/bar-v4.json",
  ".gauntlet/critique-v3-fresh.md",
  "scripts/verify-production.ts",
  "scripts/verify-release-provenance.ts",
  "scripts/verify-promotion-invariant.ts",
  "scripts/verify-container-smoke.ts",
  "scripts/verify-backup-retention.ts",
  "scripts/verify-triplo-aaa.ts",
  "scripts/verify-pdp-coverage.ts",
  "scripts/pdp-boundary.ts",
  "scripts/verify-staging.ts",
  "scripts/verify-deepseek-acp.ts",
  "scripts/verify-provider-sandbox.ts",
  "docs/deepseek-acp-bridge.md"
];

const readArtifacts = new Map<string, string>();

async function inspectArtifacts(): Promise<void> {
  for (const relative of requiredFiles) {
    const absolute = join(root, relative);
    try {
      const stats = await lstat(absolute);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        failures.push(`${relative}: must be a regular non-symlink file`);
        continue;
      }
      const content = await readFile(absolute, "utf8");
      if (content.trim().length < 20) failures.push(`${relative}: file is empty`);
      readArtifacts.set(relative, content);
    } catch {
      failures.push(`${relative}: missing or unreadable`);
    }
  }
}

function requireText(relative: string, fragment: string): void {
  const content = readArtifacts.get(relative);
  if (!content?.includes(fragment)) failures.push(`${relative}: missing required release control ${JSON.stringify(fragment)}`);
}

function requirePattern(relative: string, pattern: RegExp, message: string): void {
  if (!pattern.test(readArtifacts.get(relative) ?? "")) failures.push(`${relative}: ${message}`);
}

function rejectText(relative: string, expression: RegExp, message: string): void {
  if (expression.test(readArtifacts.get(relative) ?? "")) failures.push(`${relative}: ${message}`);
}

function inspectStaticContracts(): void {
  for (const [relative, content] of readArtifacts) {
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content) || /\bAKIA[0-9A-Z]{16}\b/.test(content) || /\bsk-[A-Za-z0-9]{20,}\b/.test(content) || /\bgh[pousr]_[A-Za-z0-9]{20,}\b/.test(content)) {
      failures.push(`${relative}: credential-like literal is forbidden`);
    }
    if (relative !== "scripts/verify-production.ts" && /:latest\b/.test(content)) failures.push(`${relative}: moving latest image/tag is forbidden`);
  }

  for (const fragment of ["npm ci", "USER node", "HEALTHCHECK", "node:24.20.0-bookworm-slim"]) requireText("Dockerfile.api", fragment);
  requireText("Dockerfile.api", "org.opencontainers.image.revision");
  for (const fragment of ["npm ci", "RUN npm run build", "nginxinc/nginx-unprivileged:1.31.5-alpine3.24@sha256:2ddec616f1cb58bcac057aa388f28cb81e35137641ef4226d321714499329bd1", "USER 101", "HEALTHCHECK"]) requireText("Dockerfile.web", fragment);
  requireText("Dockerfile.web", "org.opencontainers.image.revision");
  for (const service of ["postgres", "migrate", "api", "web", "worker", "proxy"]) {
    if (!new RegExp(`^  ${service}:`, "m").test(readArtifacts.get("docker-compose.yml") ?? "")) failures.push(`docker-compose.yml: service ${service} is missing`);
  }
  for (const service of ["postgres", "api", "web", "worker", "proxy"]) {
    const serviceBlock = new RegExp(`^  ${service}:[\\s\\S]*?(?=^  [A-Za-z0-9_-]+:|^volumes:|^networks:)`, "m").exec(readArtifacts.get("docker-compose.yml") ?? "")?.[0] ?? "";
    if (!serviceBlock.includes("healthcheck:")) failures.push(`docker-compose.yml: ${service} has no healthcheck`);
  }
  requireText("docker-compose.yml", "condition: service_completed_successfully");
  requireText("docker-compose.yml", "internal: true");
  requireText("docker-compose.yml", "CVG_WORKER_SINK_MODE");
  requireText("docker-compose.yml", "NODE_ENV: ${NODE_ENV:-development}");
  requireText("docker-compose.yml", "CVG_RATE_LIMIT_BACKEND");
  requireText("docker-compose.yml", "OTEL_EXPORTER_OTLP_ENDPOINT");
  for (const service of ["otel-collector", "tempo", "prometheus", "alertmanager", "grafana"]) {
    if (!new RegExp(`^  ${service}:`, "m").test(readArtifacts.get("docker-compose.observability.yml") ?? "")) failures.push(`docker-compose.observability.yml: service ${service} is missing`);
  }
  requireText("docker-compose.observability.yml", "internal: true");
  requireText("docker-compose.observability.yml", "GRAFANA_ADMIN_PASSWORD");
  requireText("docker/observability/otel-collector.yml", "attributes/redact");
  requireText("docker/observability/prometheus.yml", "rule_files:");
  requireText("docker/observability/alerts.yml", "runbook:");
  requireText("docker/observability/alertmanager.yml", "CVG_ALERTMANAGER_WEBHOOK_URL");
  rejectText("docker/observability/alertmanager.yml", /cvg-null/, "Alertmanager must not silently discard alerts through a null receiver");
  requireText("docker/observability/grafana/dashboards/cvg-runtime.json", "Outbox depth");
  requireText("docker/nginx/proxy.conf", "Content-Security-Policy");
  requireText("docker/nginx/web.conf", "Content-Security-Policy");
  rejectText("docker/nginx/proxy.conf", /Strict-Transport-Security/i, "cleartext development proxy must not advertise HSTS over HTTP");
  rejectText("docker/nginx/web.conf", /Strict-Transport-Security/i, "cleartext web server must not advertise HSTS over HTTP");
  requireText("docker/nginx/proxy.tls.conf", "listen 8443 ssl");
  requireText("docker/nginx/proxy.tls.conf", "ssl_protocols TLSv1.2 TLSv1.3");
  requireText("docker/nginx/proxy.tls.conf", "ssl_certificate /etc/nginx/tls/fullchain.pem");
  requireText("docker/nginx/proxy.tls.conf", "Strict-Transport-Security \"max-age=31536000; includeSubDomains; preload\"");
  requireText("docker/nginx/proxy.tls.conf", "proxy_cookie_flags ~ secure httponly samesite=strict");
  requireText("docker/nginx/proxy.tls.conf", "return 308 https://$host$request_uri");
  requireText("docker/nginx/proxy.tls.conf", "proxy_set_header X-Forwarded-For $remote_addr");
  rejectText("docker/nginx/proxy.tls.conf", /proxy_add_x_forwarded_for/, "the trusted TLS edge must overwrite X-Forwarded-For to prevent caller-controlled rate-limit identity");
  requireText("docker-compose.production.yml", "CVG_TLS_DIR");
  requireText("docker-compose.production.yml", "CVG_RUNTIME_DB_USER");
  requireText("docker-compose.production.yml", "CVG_RUNTIME_DB_PASSWORD");
  requireText("docker-compose.production.yml", "CVG_WEB_ORIGIN");
  requireText("docker-compose.production.yml", "CVG_RELEASE_SHA");
  requireText("docker-compose.production.yml", "CVG_RELEASE_ARTIFACT_DIGEST");
  requireText("docker-compose.production.yml", "CVG_AUTH_MFA_MODE");
  requireText("docker-compose.production.yml", "CVG_RATE_LIMIT_BACKEND");
  requireText("docker-compose.production.yml", "CVG_DEEPSEEK_RUNTIME_ENABLED");
  requireText("docker-compose.production.yml", "CVG_MESSAGING_PROVIDER_ENDPOINT");
  requireText("docker-compose.production.yml", "CVG_WORKER_SINK_MODE");
  requireText("packages/config/src/index.ts", "releaseArtifactDigest");
  requireText("apps/api/src/app.ts", "x-cvg-release-sha");
  requireText("docker-compose.production.yml", "ports: !override");
  requireText("docker/worker.ts", "CvgWorkerApplication");
  requireText("docker/worker.ts", "createWorkerDependencies");
  requireText("docker/worker.ts", "createDurableWorkerAuditSink");
  requirePattern("docker/worker.ts", /new CvgWorkerApplication\s*\(\s*createWorkerDependencies\s*\(\s*persistence\s*,\s*config\s*,\s*configuredSink(?:\s*,[\s\S]*?)?\)\s*\)/, "worker construction must use the shared dependency contract");
  requireText("docker/worker.ts", "process.exitCode = 1");
  requireText("apps/worker/src/main.ts", "createConfiguredWorkerSink");
  requireText("apps/worker/src/main.ts", "createWorkerDependencies");
  requireText("apps/worker/src/main.ts", "createDurableWorkerAuditSink");
  requirePattern("apps/worker/src/main.ts", /new CvgWorkerApplication\s*\(\s*createWorkerDependencies\s*\(\s*persistence\s*,\s*config\s*,\s*configuredSink(?:\s*,[\s\S]*?)?\)\s*\)/, "worker construction must use the shared dependency contract");
  requireText("apps/worker/src/worker.ts", "HttpMessagingProvider");
  requireText("apps/worker/src/worker.ts", "MessagingOutboxSink");
  requireText("apps/worker/src/worker.ts", "auditRequired: true");
  requireText("packages/persistence/src/index.ts", "appendAuditRecord");
  rejectText("apps/worker/src/worker.ts", /jobHandlers\??:/, "worker production must use typed durable handler definitions");
  requireText("packages/config/src/index.ts", "CVG_MESSAGING_PROVIDER_ENDPOINT");
  requireText("packages/config/src/index.ts", "Unknown CVG configuration key");
  requireText("packages/config/src/index.ts", "deepseekContextSigningSecretRef");
  requireText("packages/config/src/index.ts", "distributed rate-limit backend");
  requireText("apps/api/src/app.ts", "content-security-policy");
  requireText("apps/api/src/app.ts", "MemoryRateLimiter");
  requireText("packages/ops/src/otel.ts", "OTLPTraceExporter");
  requireText("packages/ops/src/otel.ts", "Production OTLP export requires HTTPS/TLS");
  requireText("packages/deepseek-bridge/src/acp.ts", "methods.client.session.requestPermission");
  requireText("packages/deepseek-bridge/src/acp.ts", "rev-parse");
  requireText("packages/deepseek-bridge/src/acp.ts", "read-only");
  requireText("packages/harness/src/index.ts", "enforceApplicationPolicy");
  requireText("packages/auth/src/index.ts", "validateWebAuthnAssertion");
  requireText("packages/auth/src/index.ts", "evaluateBreakGlass");
  requireText("packages/agent-tools/src/index.ts", "OUTCOME_UNKNOWN");
  requireText("db/migrations/021_snapshot_revision_scope.sql", "PRIMARY KEY (organization_id, revision)");
  requireText("db/migrations/022_runtime_database_role.sql", "nobypassrls");
  requireText("db/migrations/023_distributed_rate_limit.sql", "cvg_rate_limit_buckets");
  requireText("db/migrations/024_external_effect_reconciliation_states.sql", "FAILED_FINAL");
  requireText("db/migrations/025_communication_approval_provenance.sql", "approved_by");
  requireText("db/migrations/026_audit_tamper_evident_chain.sql", "previous_hash");
  requireText("db/migrations/027_append_only_audit_guard.sql", "append-only");
  requireText("db/migrations/028_append_only_lock_privileges.sql", "grant update");
  requireText("db/migrations/029_ai_turn_provenance_usage_and_dml_scope.sql", "usage_record_id");
  requireText("db/migrations/029_ai_turn_provenance_usage_and_dml_scope.sql", "provenance_json");
  requireText("db/migrations/029_ai_turn_provenance_usage_and_dml_scope.sql", "cvg_request_dml_scope_allows");
  requireText("db/migrations/030_break_glass_durable_lifecycle.sql", "break_glass_grants");
  requireText("db/migrations/030_break_glass_durable_lifecycle.sql", "mfa_method = 'WEBAUTHN'");
  requireText("db/migrations/030_break_glass_durable_lifecycle.sql", "cvg_break_glass_transition_guard");
  requireText("db/migrations/031_worker_jobs_and_heartbeats.sql", "cvg_worker_jobs");
  requireText("db/migrations/031_worker_jobs_and_heartbeats.sql", "cvg_worker_heartbeats");
  requireText("db/migrations/031_worker_jobs_and_heartbeats.sql", "force row level security");
  requireText("db/migrations/032_diagnostic_request_scope.sql", "diagnostic_requests_organization_encounter_scope_fk");
  requireText("db/migrations/032_diagnostic_request_scope.sql", "cvg_request_dml_scope_allows(unit_id, workspace_id)");
  requireText("db/migrations/033_diagnostic_specimen_result_scope.sql", "specimens_organization_request_scope_fk");
  requireText("db/migrations/033_diagnostic_specimen_result_scope.sql", "diagnostic_results_organization_specimen_scope_fk");
  requireText("db/migrations/033_diagnostic_specimen_result_scope.sql", "cvg_request_dml_scope_allows(unit_id, workspace_id)");
  requireText("db/migrations/034_diagnostic_child_integrity_backstop.sql", "cvg_diagnostic_specimen_integrity_guard");
  requireText("db/migrations/034_diagnostic_child_integrity_backstop.sql", "diagnostic_results_organization_request_specimen_patient_fk");
  requireText("db/migrations/034_diagnostic_child_integrity_backstop.sql", "cvg_request_dml_scope_allows(unit_id, workspace_id)");
  requireText("db/migrations/036_runtime_migration_metadata_privileges.sql", "revoke insert, update, delete on table public.schema_migrations from cvg_runtime");
  requireText("packages/persistence/src/index.ts", "claimWorkerJobs");
  requireText("packages/persistence/src/index.ts", "recordWorkerHeartbeat");
  requireText("packages/persistence/src/index.ts", "writeOperationalBackup");
  requireText("packages/persistence/src/index.ts", "verifyOperationalBackupDirectory");
  requireText("packages/persistence/src/index.ts", "class OperationalBackupJob");
  requireText("apps/worker/src/operational-backup.ts", "createOperationalBackupJob");
  requireText("scripts/verify-backup-retention.ts", "BACKUP_RETENTION_BLOCKED_EXTERNAL");
  requireText("apps/worker/src/worker.ts", "defaultDurableJobRunner");
  requireText("apps/api/src/application/export-service.ts", "encryptRecoveryBundle");
  requireText("apps/api/src/application/export-service.ts", "this.commands.execute");
  requireText("apps/api/src/application/idempotency-service.ts", "claimCommandReceipt");
  requireText("apps/api/src/application/idempotency-service.ts", "settleCommandReceipt");
  requireText("scripts/pdp-boundary.ts", "inspectApplicationPdpBoundaries");
  requireText("scripts/verify-pdp-coverage.ts", "inspectApplicationPdpBoundaries");
  requireText("scripts/verify-static.ts", "inspectApplicationPdpBoundaries");
  requireText("package.json", "verify:authoritative-writes");
  requireText("package.json", "verify:postgres:concurrency");
  requireText(".github/workflows/ci.yml", "npm run verify:authoritative-writes");
  requireText(".github/workflows/ci.yml", "npm run verify:postgres:concurrency");
  requireText("package.json", "npm run verify:pdp");
  requireText(".github/workflows/ci.yml", "npm run verify:pdp");
  requireText("apps/api/src/app.ts", "new DurableIdempotencyService");
  requireText(".gauntlet/bar-v3.json", "V3-AAA-001");
  requireText(".gauntlet/bar-v4.json", "CVG-BAR-2026-09-11-FINAL-PROMPT");
  requireText(".gauntlet/bar-v4.json", "39dfbb610267b61854b972bf8513f6562b0ee374aa308f7a79b38d21f2cdeae3");
  requireText(".github/workflows/ci.yml", "npm ci --ignore-scripts");
  requireText(".github/workflows/ci.yml", "npx playwright install --with-deps chromium");
  requireText(".github/workflows/ci.yml", "npm run lint");
  requireText(".github/workflows/ci.yml", "npm run test:contract");
  requireText(".github/workflows/ci.yml", "npm run test:security");
  requireText(".github/workflows/ci.yml", "npm run test:database");
  requireText(".github/workflows/ci.yml", "npm run test:fault");
  requireText(".github/workflows/ci.yml", "npm run test:e2e");
  requirePattern(".github/workflows/ci.yml", /- name: Upload browser E2E artifacts\s+if: \$\{\{ !cancelled\(\) \}\}[\s\S]+?path:\s+\|\s+artifacts\/playwright-report\/\s+test-results\/\s+if-no-files-found: warn/, "Browser E2E report and traces must be uploaded on failure");
  requireText(".github/workflows/ci.yml", "npm run db:migrate");
  requireText(".github/workflows/ci.yml", "npm run verify:postgres");
  requireText(".github/workflows/ci.yml", "npm run verify:postgres:restore");
  requireText(".github/workflows/ci.yml", "npm run audit:contrast");
  requireText(".github/workflows/ci.yml", "npm run audit:tokens");
  requireText(".github/workflows/ci.yml", "npm run audit:licenses");
  for (const action of [
    "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
    "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
    "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    "aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25"
  ]) requireText(".github/workflows/ci.yml", action);
  rejectText(".github/workflows/ci.yml", /^\s+uses:\s+[^\s@]+@(?![0-9a-f]{40}\b)\S+/gm, "GitHub Actions must be pinned to immutable commit SHAs");
  requireText(".github/dependabot.yml", "package-ecosystem: npm");
  requireText(".github/dependabot.yml", "package-ecosystem: docker");
  requireText("package.json", "tsx scripts/audit-design-tokens.ts");
  requireText("package.json", "tsx scripts/check-contrast.ts");
  requireText("package.json", "tsx scripts/verify-triplo-aaa.ts");
  requireText("package.json", "tsx scripts/verify-staging.ts");
  requireText("package.json", "tsx scripts/verify-deepseek-acp.ts");
  requireText("package.json", "tsx scripts/verify-provider-sandbox.ts");
  requireText("package.json", "tsx scripts/verify-backup-retention.ts");
  requireText(".github/workflows/ci.yml", "npm run verify:provider-sandbox");
  requireText("tests/unit/worker.test.ts", "worker entrypoint composition");
  requireText("tsconfig.json", '"docker/**/*.ts"');
  requireText("scripts/lint.ts", '"docker"');
  requireText(".github/workflows/ci.yml", "--build-arg CVG_SOURCE_REVISION=${{ github.sha }} --file Dockerfile.api");
  requireText(".github/workflows/ci.yml", "npm run verify:release-provenance -- --manifest artifacts/release-provenance.json");
  requirePattern(".github/workflows/ci.yml", /container-build:[\s\S]*?actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020[\s\S]*?npm ci --ignore-scripts[\s\S]*?docker build/, "container provenance job must install its pinned Node toolchain before invoking npm/tsx");
  requireText(".github/workflows/ci.yml", "docker buildx build");
  requireText(".github/workflows/ci.yml", "type=oci");
  requireText(".github/workflows/ci.yml", "index.json");
  rejectText(".github/workflows/ci.yml", /docker image inspect --format '\{\{\.Id\}\}'/, "release provenance must use a registry/OCI manifest digest, never a local image ID");
  rejectText(".github/workflows/ci.yml", /docker compose up|docker push|npm publish/, "CI must not deploy or publish");
  for (const relative of ["docs/runbooks/deploy.md", "docs/runbooks/rollback.md", "docs/runbooks/backup-incidente.md"]) {
    rejectText(relative, /password\s*[:=]\s*[^$\s]/i, "runbooks must not contain credential values");
  }
}

type ComposeService = {
  image?: string;
  build?: { dockerfile?: string };
  command?: string | string[];
  depends_on?: Record<string, { condition?: string }>;
  healthcheck?: { test?: unknown };
  ports?: Array<{ host_ip?: string; published?: string | number; target?: number }>;
  volumes?: Array<{ source?: string; target?: string; read_only?: boolean } | string>;
  environment?: Record<string, string>;
  read_only?: boolean;
  user?: string;
  security_opt?: string[];
  cap_drop?: string[];
  secrets?: Array<{ source?: string; target?: string } | string>;
  deploy?: { resources?: { limits?: { cpus?: string; memory?: string } } };
};

type ComposeConfig = {
  services?: Record<string, ComposeService>;
  secrets?: Record<string, { external?: boolean; name?: string }>;
  volumes?: Record<string, { external?: boolean; name?: string }>;
  networks?: Record<string, { internal?: boolean }>;
};

function commandNotFound(error: Error | undefined): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function syntheticComposeEnvironment(): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "XDG_CONFIG_HOME"]) {
    if (process.env[name] !== undefined) inherited[name] = process.env[name];
  }
  return {
    ...inherited,
    POSTGRES_PASSWORD: "verify-local-only-password",
    MIGRATION_DATABASE_URL: "postgresql://cvg_migration:verify-local-only-password@postgres:5432/cvg_local",
    DATABASE_URL: "postgresql://cvg_runtime:verify-local-only-runtime-password@postgres:5432/cvg_local",
    CVG_RUNTIME_DB_USER: "cvg_runtime",
    CVG_RUNTIME_DB_PASSWORD: "verify-local-only-runtime-password",
    CVG_BOOTSTRAP_PASSWORD: "verify-local-only-bootstrap-password",
    CVG_WORKER_ORGANIZATION_ID: "00000000-0000-4000-8000-000000000010",
    CVG_BACKUP_ORGANIZATION_ID: "00000000-0000-4000-8000-000000000010",
    CVG_BACKUP_ENABLED: "true",
    CVG_BACKUP_DIRECTORY: "/var/lib/cvg/backups",
    CVG_BACKUP_INTERVAL_MS: "3600000",
    CVG_BACKUP_KEEP_LAST: "7",
    NODE_ENV: "development",
    CVG_WEB_ORIGIN: "http://localhost:8080",
    CVG_TRUST_PROXY: "false",
    CVG_TRUSTED_PROXY_IPS: "loopback",
    CVG_DEMO_MODE: "true",
    CVG_SECRET_PROVIDER: "file",
    CVG_SECRET_DIR: "/run/secrets/cvg",
    CVG_DEEPSEEK_RUNTIME_ENABLED: "true",
    CVG_DEEPSEEK_BASE_URL: "https://deepseek.verify.invalid",
    CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT: "1111111111111111111111111111111111111111",
    CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    CVG_DEEPSEEK_BEARER_TOKEN_REF: "verify-deepseek-bearer",
    CVG_DEEPSEEK_CONTEXT_SIGNING_SECRET_REF: "verify-deepseek-context",
    CVG_RECOVERY_ENCRYPTION_KEY_REF: "verify-recovery-key",
    CVG_AUTH_MFA_MODE: "required",
    CVG_PASSWORD_MAX_AGE_DAYS: "90",
    CVG_RATE_LIMIT_BACKEND: "distributed",
    CVG_WORKER_SINK_MODE: "enabled",
    CVG_MESSAGING_PROVIDER_ENDPOINT: "https://provider.verify.invalid",
    CVG_MESSAGING_PROVIDER_ALLOWED_HOSTS: "provider.verify.invalid",
    CVG_MESSAGING_CREDENTIAL_REF: "verify-provider-credential",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.verify.invalid",
    CVG_TLS_DIR: "/srv/cvg/tls",
    CVG_PROXY_BIND: "127.0.0.1",
    CVG_PROXY_PORT: "8080",
    CVG_POSTGRES_PORT: "5440",
    CVG_API_IMAGE: "cvg-corp/api:verify",
    CVG_WEB_IMAGE: "cvg-corp/web:verify",
    GRAFANA_ADMIN_USER: "verify-grafana-admin",
    GRAFANA_ADMIN_PASSWORD: "verify-local-only-grafana-password"
  };
}

function runComposeConfig(): { available: boolean; config: ComposeConfig | null } {
  const version = spawnSync("docker", ["compose", "version"], { cwd: root, env: syntheticComposeEnvironment(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (commandNotFound(version.error) || version.status !== 0) return { available: false, config: null };
  const result = spawnSync("docker", ["compose", "-f", "docker-compose.yml", "config", "--format", "json"], { cwd: root, env: syntheticComposeEnvironment(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (commandNotFound(result.error)) return { available: false, config: null };
  if (result.status !== 0 || !result.stdout.trim()) {
    failures.push("docker-compose.yml: docker compose config failed");
    return { available: true, config: null };
  }
  try {
    return { available: true, config: JSON.parse(result.stdout) as ComposeConfig };
  } catch {
    failures.push("docker-compose.yml: docker compose config did not return JSON");
    return { available: true, config: null };
  }
}

function runObservabilityComposeConfig(): { available: boolean; config: ComposeConfig | null } {
  const environment = { ...syntheticComposeEnvironment(), CVG_ALERTMANAGER_WEBHOOK_URL: "https://alerts.verify.invalid/webhook", OTEL_COLLECTOR_IMAGE: "otel/opentelemetry-collector-contrib:verify", TEMPO_IMAGE: "grafana/tempo:verify", PROMETHEUS_IMAGE: "prom/prometheus:verify", ALERTMANAGER_IMAGE: "prom/alertmanager:verify", GRAFANA_IMAGE: "grafana/grafana:verify" };
  const version = spawnSync("docker", ["compose", "version"], { cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (commandNotFound(version.error) || version.status !== 0) return { available: false, config: null };
  const result = spawnSync("docker", ["compose", "-f", "docker-compose.observability.yml", "config", "--format", "json"], { cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (commandNotFound(result.error)) return { available: false, config: null };
  if (result.status !== 0 || !result.stdout.trim()) {
    failures.push("docker-compose.observability.yml: docker compose config failed");
    return { available: true, config: null };
  }
  try {
    return { available: true, config: JSON.parse(result.stdout) as ComposeConfig };
  } catch {
    failures.push("docker-compose.observability.yml: docker compose config did not return JSON");
    return { available: true, config: null };
  }
}

function runProductionComposeConfig(): { available: boolean; config: ComposeConfig | null } {
  const environment = { ...syntheticComposeEnvironment(), NODE_ENV: "production", CVG_WEB_ORIGIN: "https://cvg.example.test", CVG_RELEASE_SHA: "0123456789abcdef0123456789abcdef01234567", CVG_RELEASE_ARTIFACT_DIGEST: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", CVG_TRUST_PROXY: "true", CVG_DEMO_MODE: "false", CVG_TLS_DIR: "/srv/cvg/tls" };
  const version = spawnSync("docker", ["compose", "version"], { cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (commandNotFound(version.error) || version.status !== 0) return { available: false, config: null };
  const result = spawnSync("docker", ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.production.yml", "config", "--format", "json"], { cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (commandNotFound(result.error)) return { available: false, config: null };
  if (result.status !== 0 || !result.stdout.trim()) {
    failures.push("docker-compose.production.yml: docker compose config failed");
    return { available: true, config: null };
  }
  try {
    return { available: true, config: JSON.parse(result.stdout) as ComposeConfig };
  } catch {
    failures.push("docker-compose.production.yml: docker compose config did not return JSON");
    return { available: true, config: null };
  }
}

function inspectObservabilityComposeConfig(config: ComposeConfig): void {
  const services = config.services ?? {};
  for (const name of ["otel-collector", "tempo", "prometheus", "alertmanager", "grafana"]) {
    if (!services[name]) failures.push(`docker-compose.observability.yml: rendered service ${name} is missing`);
    if (name !== "grafana" && services[name]?.ports && services[name]?.ports.length) failures.push(`docker-compose.observability.yml: ${name} must not publish a host port`);
  }
  if (config.networks?.observability?.internal !== true) failures.push("docker-compose.observability.yml: observability network must be internal");
}

function inspectProductionComposeConfig(config: ComposeConfig): void {
  const proxy = config.services?.proxy;
  const api = config.services?.api;
  const worker = config.services?.worker;
  if (!proxy || !api) {
    failures.push("docker-compose.production.yml: rendered API/proxy services are missing");
    return;
  }
  const ports = proxy.ports ?? [];
  const hasPort = (published: string, target: number): boolean => ports.some((port) => String(port.published) === published && port.target === target);
  if (!hasPort("80", 8080) || !hasPort("443", 8443)) failures.push("docker-compose.production.yml: proxy must publish HTTP redirect on 80 and TLS on 443");
  if (ports.some((port) => String(port.published) === "8080")) failures.push("docker-compose.production.yml: cleartext development port 8080 must not be published");
  const volumes = proxy.volumes ?? [];
  for (const target of ["/etc/nginx/conf.d/default.conf", "/etc/nginx/tls/fullchain.pem", "/etc/nginx/tls/privkey.pem"]) {
    const volume = volumes.find((entry) => typeof entry !== "string" && entry.target === target);
    if (!volume || typeof volume === "string" || volume.read_only !== true) failures.push(`docker-compose.production.yml: ${target} must be mounted read-only`);
  }
  const environment = api.environment ?? {};
  const declaredSecrets = config.secrets ?? {};
  for (const name of ["cvg-deepseek-bearer", "cvg-deepseek-context", "cvg-recovery-key", "cvg-messaging-credential"]) {
    if (declaredSecrets[name]?.external !== true || !declaredSecrets[name]?.name?.trim()) failures.push(`docker-compose.production.yml: external Docker secret ${name} must be declared with an explicit name`);
  }
  const secretEntries = (service: ComposeService | undefined): Array<{ source?: string; target?: string }> => (service?.secrets ?? []).filter((entry): entry is { source?: string; target?: string } => typeof entry !== "string");
  const apiSecrets = secretEntries(api);
  const workerSecrets = secretEntries(worker);
  for (const source of ["cvg-deepseek-bearer", "cvg-deepseek-context", "cvg-recovery-key"]) {
    if (!apiSecrets.some((entry) => entry.source === source && entry.target?.startsWith("cvg/"))) failures.push(`docker-compose.production.yml: API must mount external secret ${source} below /run/secrets/cvg`);
  }
  if (!workerSecrets.some((entry) => entry.source === "cvg-messaging-credential" && entry.target?.startsWith("cvg/"))) failures.push("docker-compose.production.yml: worker must mount its messaging credential below /run/secrets/cvg");
  if (!workerSecrets.some((entry) => entry.source === "cvg-recovery-key" && entry.target?.startsWith("cvg/"))) failures.push("docker-compose.production.yml: worker must mount the recovery key below /run/secrets/cvg");
  if (environment.CVG_SECRET_DIR !== "/run/secrets/cvg") failures.push("docker-compose.production.yml: API must use the Docker secret directory");
  if (environment.NODE_ENV !== "production" || environment.CVG_TRUST_PROXY !== "true" || environment.CVG_DEMO_MODE !== "false") failures.push("docker-compose.production.yml: API production environment is not fail-closed");
  if (!environment.CVG_WEB_ORIGIN?.startsWith("https://")) failures.push("docker-compose.production.yml: API web origin must use HTTPS");
  if (!/^[a-f0-9]{40}$/.test(environment.CVG_RELEASE_SHA ?? "")) failures.push("docker-compose.production.yml: API must bind an exact release SHA");
  if (!/^sha256:[a-f0-9]{64}$/.test(environment.CVG_RELEASE_ARTIFACT_DIGEST ?? "")) failures.push("docker-compose.production.yml: API must bind an immutable release artifact digest");
  if (proxy.image !== "nginxinc/nginx-unprivileged:1.31.5-alpine3.24@sha256:2ddec616f1cb58bcac057aa388f28cb81e35137641ef4226d321714499329bd1") failures.push("docker-compose.production.yml: proxy image must match the approved immutable digest");
  const workerEnvironment = worker?.environment ?? {};
  if (!worker) failures.push("docker-compose.production.yml: rendered worker service is missing");
  if (workerEnvironment.NODE_ENV !== "production" || workerEnvironment.CVG_STORAGE !== "postgres") failures.push("docker-compose.production.yml: worker must use its role-specific production/PostgreSQL contract");
  if (workerEnvironment.CVG_SECRET_DIR !== "/run/secrets/cvg") failures.push("docker-compose.production.yml: worker must use the Docker secret directory");
  if (!workerEnvironment.CVG_WORKER_ORGANIZATION_ID?.trim()) failures.push("docker-compose.production.yml: worker organization binding is missing");
  if (workerEnvironment.CVG_BACKUP_ENABLED !== "true") failures.push("docker-compose.production.yml: worker operational backup must be enabled");
  if (!workerEnvironment.CVG_BACKUP_ORGANIZATION_ID?.trim() || workerEnvironment.CVG_BACKUP_ORGANIZATION_ID !== workerEnvironment.CVG_WORKER_ORGANIZATION_ID) failures.push("docker-compose.production.yml: worker backup organization must equal its worker organization");
  if (workerEnvironment.CVG_BACKUP_DIRECTORY !== "/var/lib/cvg/backups") failures.push("docker-compose.production.yml: worker backup directory must use the persistent backup volume");
  if (!workerEnvironment.CVG_BACKUP_INTERVAL_MS?.trim() || !/^\d+$/.test(workerEnvironment.CVG_BACKUP_INTERVAL_MS) || Number(workerEnvironment.CVG_BACKUP_INTERVAL_MS) < 1_000) failures.push("docker-compose.production.yml: worker backup interval must be a positive duration");
  if (!workerEnvironment.CVG_BACKUP_KEEP_LAST?.trim() || !/^\d+$/.test(workerEnvironment.CVG_BACKUP_KEEP_LAST) || Number(workerEnvironment.CVG_BACKUP_KEEP_LAST) < 1) failures.push("docker-compose.production.yml: worker backup retention must be positive");
  if (!workerEnvironment.CVG_RECOVERY_ENCRYPTION_KEY_REF?.trim()) failures.push("docker-compose.production.yml: worker recovery key reference is missing");
  const backupVolume = config.volumes?.cvg_corp_backups;
  if (backupVolume?.external !== true || !backupVolume.name?.trim()) failures.push("docker-compose.production.yml: backup volume must be an explicitly named external volume");
  if (workerEnvironment.CVG_WORKER_SINK_MODE !== "enabled") failures.push("docker-compose.production.yml: worker provider sink must be enabled");
  if (workerEnvironment.CVG_SECRET_PROVIDER === "none" || !workerEnvironment.CVG_SECRET_PROVIDER) failures.push("docker-compose.production.yml: worker secret provider is missing");
  if (!workerEnvironment.CVG_MESSAGING_PROVIDER_ENDPOINT?.startsWith("https://")) failures.push("docker-compose.production.yml: worker messaging provider must use HTTPS");
  if (!workerEnvironment.CVG_MESSAGING_PROVIDER_ALLOWED_HOSTS?.trim() || !workerEnvironment.CVG_MESSAGING_CREDENTIAL_REF?.trim()) failures.push("docker-compose.production.yml: worker provider allowlist and credential reference are required");
}

function inspectComposeConfig(config: ComposeConfig): void {
  const services = config.services ?? {};
  const longRunning = ["postgres", "api", "web", "worker", "proxy"];
  for (const name of longRunning) {
    const service = services[name];
    if (!service) {
      failures.push(`docker-compose.yml: rendered service ${name} is missing`);
      continue;
    }
    if (!service.healthcheck || !Array.isArray(service.healthcheck.test) || service.healthcheck.test.length < 2) failures.push(`docker-compose.yml: rendered service ${name} has no executable healthcheck`);
    if (service.read_only !== true) failures.push(`docker-compose.yml: ${name} must be read-only`);
    if (!service.security_opt?.includes("no-new-privileges:true")) failures.push(`docker-compose.yml: ${name} must disable privilege escalation`);
    if (name !== "postgres" && !service.cap_drop?.includes("ALL")) failures.push(`docker-compose.yml: ${name} must drop all Linux capabilities`);
    if (!service.deploy?.resources?.limits?.cpus || !service.deploy.resources.limits.memory) failures.push(`docker-compose.yml: ${name} must declare CPU and memory limits`);
  }
  const migration = services.migrate;
  if (!migration?.deploy?.resources?.limits?.cpus || !migration.deploy.resources.limits.memory) failures.push("docker-compose.yml: migrate must declare CPU and memory limits");

  for (const name of ["api", "web", "worker", "migrate"]) {
    if ((services[name]?.ports ?? []).length > 0) failures.push(`docker-compose.yml: ${name} must not publish a host port`);
  }
  const postgresPorts = services.postgres?.ports ?? [];
  if (postgresPorts.length !== 1 || postgresPorts[0]?.host_ip !== "127.0.0.1") failures.push("docker-compose.yml: PostgreSQL must be bound to loopback only");
  if (services.api?.build?.dockerfile !== "Dockerfile.api" || services.web?.build?.dockerfile !== "Dockerfile.web") failures.push("docker-compose.yml: API/web build sources are not pinned to the release Dockerfiles");
  if (!String(services.worker?.command ?? "").includes("docker/worker.ts")) failures.push("docker-compose.yml: worker entrypoint is not wired");
  if (services.api?.depends_on?.migrate?.condition !== "service_completed_successfully") failures.push("docker-compose.yml: API must wait for successful migrations");
  if (services.worker?.depends_on?.api?.condition !== "service_healthy") failures.push("docker-compose.yml: worker must wait for a healthy API bootstrap");
  if (services.proxy?.depends_on?.api?.condition !== "service_healthy" || services.proxy?.depends_on?.web?.condition !== "service_healthy") failures.push("docker-compose.yml: proxy must wait for healthy API and web services");
  if (config.networks?.backend?.internal !== true) failures.push("docker-compose.yml: backend network must be internal");
  for (const name of ["postgres", "proxy"]) {
    if (!services[name]?.image || /:latest\b/.test(services[name]?.image ?? "")) failures.push(`docker-compose.yml: ${name} image is not explicitly versioned`);
  }
}

function inspectProductionEnvironment(): void {
  if (!productionMode) return;
  const environment = process.env;
  const requiredNames = ["DATABASE_URL", "CVG_BOOTSTRAP_PASSWORD", "CVG_WEB_ORIGIN", "CVG_RELEASE_SHA", "CVG_RELEASE_ARTIFACT_DIGEST", "CVG_HOST", "CVG_TRUST_PROXY", "CVG_TRUSTED_PROXY_IPS", "CVG_TLS_DIR", "CVG_DEEPSEEK_BASE_URL", "CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT", "CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION", "CVG_DEEPSEEK_BEARER_TOKEN_REF", "CVG_DEEPSEEK_CONTEXT_SIGNING_SECRET_REF", "CVG_RECOVERY_ENCRYPTION_KEY_REF", "CVG_WORKER_ORGANIZATION_ID", "CVG_BACKUP_ENABLED", "CVG_BACKUP_ORGANIZATION_ID", "CVG_BACKUP_DIRECTORY", "CVG_BACKUP_INTERVAL_MS", "CVG_BACKUP_KEEP_LAST", "CVG_SECRET_PROVIDER", "CVG_MESSAGING_PROVIDER_ENDPOINT", "CVG_MESSAGING_PROVIDER_ALLOWED_HOSTS", "CVG_MESSAGING_CREDENTIAL_REF", "CVG_RUNTIME_DB_USER", "CVG_RUNTIME_DB_PASSWORD"];
  for (const name of requiredNames) if (!environment[name]?.trim()) failures.push(`production configuration: ${name} is required`);
  if (!environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() && !environment.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()) failures.push("production configuration: OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is required");
  if (environment.NODE_ENV !== "production") failures.push("production configuration: NODE_ENV must be production");
  if (environment.CVG_STORAGE !== "postgres") failures.push("production configuration: CVG_STORAGE must be postgres");
  if (environment.CVG_TRUST_PROXY !== "true") failures.push("production configuration: CVG_TRUST_PROXY must be true behind the TLS edge");
  if (!environment.CVG_TRUSTED_PROXY_IPS?.trim()) failures.push("production configuration: CVG_TRUSTED_PROXY_IPS must name the TLS edge address/CIDR allowlist");
  if (environment.CVG_DEMO_MODE !== "false") failures.push("production configuration: CVG_DEMO_MODE must be false");
  if (environment.CVG_HOST && (environment.CVG_HOST === "localhost" || environment.CVG_HOST === "127.0.0.1" || environment.CVG_HOST === "::1" || environment.CVG_HOST.startsWith("127."))) failures.push("production configuration: CVG_HOST must not bind the API to loopback");
  if (environment.CVG_AUTH_MFA_MODE !== "required") failures.push("production configuration: CVG_AUTH_MFA_MODE must be required");
  if (!environment.CVG_PASSWORD_MAX_AGE_DAYS || !/^\d+$/.test(environment.CVG_PASSWORD_MAX_AGE_DAYS) || Number(environment.CVG_PASSWORD_MAX_AGE_DAYS) <= 0) failures.push("production configuration: CVG_PASSWORD_MAX_AGE_DAYS must be a positive rotation interval");
  if (environment.CVG_RATE_LIMIT_BACKEND !== "distributed") failures.push("production configuration: CVG_RATE_LIMIT_BACKEND must be distributed");
  if (environment.CVG_SECRET_PROVIDER === undefined || environment.CVG_SECRET_PROVIDER === "none") failures.push("production configuration: an explicit secret provider is required");
  else if (!(CVG_SECRET_PROVIDER_KINDS as readonly string[]).includes(environment.CVG_SECRET_PROVIDER)) failures.push(`production configuration: CVG_SECRET_PROVIDER must be one of ${CVG_SECRET_PROVIDER_KINDS.filter((kind) => kind !== "none").join(", ")}`);
  if (environment.CVG_DEEPSEEK_RUNTIME_ENABLED !== "true") failures.push("production configuration: the mock runtime must be disabled");
  if (environment.CVG_WORKER_SINK_MODE !== "enabled") failures.push("production configuration: the worker sink must be enabled; quarantine is not a production provider");
  if (environment.CVG_WEB_ORIGIN && !environment.CVG_WEB_ORIGIN.startsWith("https://")) failures.push("production configuration: CVG_WEB_ORIGIN must use HTTPS");
  if (environment.CVG_DEEPSEEK_BASE_URL && !environment.CVG_DEEPSEEK_BASE_URL.startsWith("https://")) failures.push("production configuration: DeepSeek bridge must use HTTPS");
  if (environment.CVG_MESSAGING_PROVIDER_ENDPOINT && !environment.CVG_MESSAGING_PROVIDER_ENDPOINT.startsWith("https://")) failures.push("production configuration: messaging provider must use HTTPS");
  if (environment.CVG_TLS_DIR && (!environment.CVG_TLS_DIR.startsWith("/") || /\s/.test(environment.CVG_TLS_DIR))) failures.push("production configuration: CVG_TLS_DIR must be an absolute path without whitespace");
  const otelEndpoint = environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? environment.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (otelEndpoint && !otelEndpoint.startsWith("https://")) failures.push("production configuration: OTLP export must use HTTPS");
  if (environment.CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT && !/^[a-f0-9]{40}$/.test(environment.CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT)) failures.push("production configuration: expected engine commit must be a 40-character hex value");
  if (/^0{40}$/.test(environment.CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT ?? "")) failures.push("production configuration: placeholder DeepSeek engine commit is forbidden");
  if (environment.CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION && !/^sha256:[a-f0-9]{64}$/.test(environment.CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION)) failures.push("production configuration: expected DeepSeek manifest version must be an immutable sha256 digest");
  if (!/^[a-f0-9]{40}$/.test(environment.CVG_RELEASE_SHA ?? "")) failures.push("production configuration: CVG_RELEASE_SHA must be an exact 40-character Git SHA");
  if (!/^sha256:[a-f0-9]{64}$/.test(environment.CVG_RELEASE_ARTIFACT_DIGEST ?? "")) failures.push("production configuration: CVG_RELEASE_ARTIFACT_DIGEST must be immutable");
  if (environment.CVG_BOOTSTRAP_PASSWORD && /replace|local-only|synthetic|verify/i.test(environment.CVG_BOOTSTRAP_PASSWORD)) failures.push("production configuration: placeholder bootstrap password is forbidden");
  for (const [name, value] of [["CVG_DEEPSEEK_BEARER_TOKEN_REF", environment.CVG_DEEPSEEK_BEARER_TOKEN_REF], ["CVG_DEEPSEEK_CONTEXT_SIGNING_SECRET_REF", environment.CVG_DEEPSEEK_CONTEXT_SIGNING_SECRET_REF], ["CVG_RECOVERY_ENCRYPTION_KEY_REF", environment.CVG_RECOVERY_ENCRYPTION_KEY_REF], ["CVG_MESSAGING_CREDENTIAL_REF", environment.CVG_MESSAGING_CREDENTIAL_REF]] as const) {
    if (value && /placeholder|local-only|synthetic|replace|example|dummy|verify|default/i.test(value)) failures.push(`production configuration: ${name} contains a placeholder reference`);
  }
  if (environment.CVG_MESSAGING_PROVIDER_ALLOWED_HOSTS !== undefined && !environment.CVG_MESSAGING_PROVIDER_ALLOWED_HOSTS.split(",").some((host) => /^[A-Za-z0-9.-]{1,253}$/.test(host.trim()))) failures.push("production configuration: messaging provider host allowlist is empty or malformed");
  if (environment.CVG_WORKER_ORGANIZATION_ID && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(environment.CVG_WORKER_ORGANIZATION_ID.trim())) failures.push("production configuration: CVG_WORKER_ORGANIZATION_ID must be a UUID organization binding");
  if (environment.CVG_BACKUP_ENABLED !== "true") failures.push("production configuration: CVG_BACKUP_ENABLED must be true");
  if (environment.CVG_BACKUP_ORGANIZATION_ID && environment.CVG_BACKUP_ORGANIZATION_ID !== environment.CVG_WORKER_ORGANIZATION_ID) failures.push("production configuration: CVG_BACKUP_ORGANIZATION_ID must equal CVG_WORKER_ORGANIZATION_ID");
  if (environment.CVG_BACKUP_DIRECTORY && (!environment.CVG_BACKUP_DIRECTORY.startsWith("/") || /\s/.test(environment.CVG_BACKUP_DIRECTORY))) failures.push("production configuration: CVG_BACKUP_DIRECTORY must be an absolute path without whitespace");
  if (!environment.CVG_BACKUP_INTERVAL_MS || !/^\d+$/.test(environment.CVG_BACKUP_INTERVAL_MS) || Number(environment.CVG_BACKUP_INTERVAL_MS) < 1_000) failures.push("production configuration: CVG_BACKUP_INTERVAL_MS must be a positive duration");
  if (!environment.CVG_BACKUP_KEEP_LAST || !/^\d+$/.test(environment.CVG_BACKUP_KEEP_LAST) || Number(environment.CVG_BACKUP_KEEP_LAST) < 1) failures.push("production configuration: CVG_BACKUP_KEEP_LAST must be positive");
  const databaseRole = environment.DATABASE_URL ? databaseRoleFromUrl(environment.DATABASE_URL) : null;
  if (environment.DATABASE_URL && databaseRole !== CVG_RUNTIME_DATABASE_ROLE) failures.push(`production configuration: DATABASE_URL must use the non-privileged ${CVG_RUNTIME_DATABASE_ROLE} role`);
  if (environment.CVG_RUNTIME_DB_USER && environment.CVG_RUNTIME_DB_USER.trim() !== CVG_RUNTIME_DATABASE_ROLE) failures.push(`production configuration: CVG_RUNTIME_DB_USER must be ${CVG_RUNTIME_DATABASE_ROLE}`);
  if (environment.CVG_RUNTIME_DB_PASSWORD && /replace|local-only|synthetic|verify|example|dummy|default/i.test(environment.CVG_RUNTIME_DB_PASSWORD)) failures.push("production configuration: placeholder runtime database password is forbidden");
  if (environment.DATABASE_URL && /@(?:localhost|127(?:\.\d+){3}|\[::1\]|postgres)(?::|\/)/i.test(environment.DATABASE_URL)) failures.push("production configuration: database must not point at the local Compose host");
}

function runLocalGate(label: string, command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: root, env: { ...process.env, FORCE_COLOR: "0" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (commandNotFound(result.error)) {
    failures.push(`${label}: command is unavailable`);
    return;
  }
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ""}`.trim().split("\n").slice(-3).join(" | ");
    failures.push(`${label}: failed${detail ? ` (${detail})` : ""}`);
  }
}

function runLocalGates(): void {
  runLocalGate("repository lint", "npm", ["run", "lint"]);
  runLocalGate("typecheck", "npm", ["run", "typecheck"]);
  runLocalGate("contract tests", "npm", ["run", "test:contract"]);
  runLocalGate("security tests", "npm", ["run", "test:security"]);
  runLocalGate("database/recovery tests", "npm", ["run", "test:database"]);
  runLocalGate("fault/worker tests", "npm", ["run", "test:fault"]);
  runLocalGate("unit/integration tests", "npm", ["test"]);
  runLocalGate("web build", "npm", ["run", "build"]);
  runLocalGate("application PDP coverage", "npm", ["run", "verify:pdp"]);
  runLocalGate("static verification", "npm", ["run", "verify:static"]);
  runLocalGate("browser E2E", "npm", ["run", "test:e2e"]);
  runLocalGate("contrast audit", "npm", ["run", "audit:contrast"]);
  runLocalGate("design token audit", "npm", ["run", "audit:tokens"]);
  runLocalGate("dependency audit", "npm", ["audit", "--omit=dev"]);
  runLocalGate("license policy", "npm", ["run", "audit:licenses"]);
  runLocalGate("CycloneDX SBOM", "npm", ["sbom", "--sbom-format", "cyclonedx"]);
  runLocalGate("synthetic benchmark", "npm", ["run", "benchmark:local"]);
  runLocalGate("provider loopback sandbox", "npm", ["run", "verify:provider-sandbox"]);
  runLocalGate("diff whitespace", "git", ["diff", "--check"]);
}

await inspectArtifacts();
inspectStaticContracts();
inspectProductionEnvironment();
if (!productionMode && !structuralMode) failures.push("verification mode is required: pass --production with real environment or --structural for synthetic Compose contracts");

if (failures.length === 0 && structuralMode && !productionMode) runLocalGates();

if (failures.length === 0) {
  const rendered = runComposeConfig();
  if (rendered.config) {
    inspectComposeConfig(rendered.config);
    observations.push("docker compose structural config validated with synthetic non-secret values; no service was started");
  } else if (!rendered.available) {
    observations.push("Docker Compose unavailable; only artifact/static checks were executed");
  }
  const observability = runObservabilityComposeConfig();
  if (observability.config) {
    inspectObservabilityComposeConfig(observability.config);
    observations.push("observability Compose structural config validated with synthetic non-secret values; no collector, dashboard or alert service was started");
  } else if (!observability.available) {
    observations.push("Docker Compose unavailable for observability; only observability artifact/static checks were executed");
  }
  const production = runProductionComposeConfig();
  if (production.config) {
    inspectProductionComposeConfig(production.config);
    observations.push("production TLS overlay Compose structural config validated with synthetic non-secret values; no service was started");
  } else if (!production.available) {
    observations.push("Docker Compose unavailable for production TLS overlay; only production artifact/static checks were executed");
  }
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
  process.exitCode = 1;
} else if (observations.some((observation) => observation.startsWith("Docker Compose unavailable"))) {
  for (const observation of observations) process.stdout.write(`LIMITED ${observation}\n`);
  process.stderr.write("FAIL-CLOSED: runtime/configuration dependency was unavailable; release verification is incomplete\n");
  process.exitCode = 2;
} else {
  for (const observation of observations) process.stdout.write(`PASS ${observation}\n`);
  process.stdout.write(`${productionMode ? "PASS production configuration inputs and" : "PASS structural"} release/Compose checks completed; production approval, service startup and external integrations were not executed\n`);
}
