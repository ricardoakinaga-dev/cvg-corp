import { lstat, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures: string[] = [];
const observations: string[] = [];

const requiredFiles = [
  "package.json",
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
  "apps/api/src/application/export-service.ts",
  "apps/api/src/server.ts",
  "apps/worker/src/main.ts",
  "apps/worker/src/worker.ts",
  "packages/ops/src/otel.ts",
  "packages/config/src/index.ts",
  "packages/agent-runtime/src/index.ts",
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
  "docs/observability-production.md",
  "docs/staging.md",
  "docs/load-and-chaos.md",
  "docs/recovery-proof.md",
  "docs/triple-aaa-final-scorecard.md",
  "docs/adr/015-deepseek-bridge-contract.md",
  "docs/runbooks/deepseek-bridge-outage.md",
  "scripts/verify-licenses.ts",
  "scripts/lint.ts",
  "scripts/audit-design-tokens.ts",
  "scripts/check-contrast.ts",
  "tests/unit/worker.test.ts",
  "tests/integration/faults.test.ts",
  "tests/integration/provider-sandbox.test.ts",
  ".gauntlet/bar-v3.json",
  ".gauntlet/critique-v3-fresh.md",
  "scripts/verify-production.ts",
  "scripts/verify-triplo-aaa.ts",
  "scripts/verify-pdp-coverage.ts",
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
  for (const fragment of ["npm ci", "RUN npm run build", "nginxinc/nginx-unprivileged:1.31.5-alpine3.24@sha256:2ddec616f1cb58bcac057aa388f28cb81e35137641ef4226d321714499329bd1", "USER 101", "HEALTHCHECK"]) requireText("Dockerfile.web", fragment);
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
  requireText("docker/observability/grafana/dashboards/cvg-runtime.json", "Outbox depth");
  requireText("docker/nginx/proxy.conf", "Content-Security-Policy");
  requireText("docker/nginx/web.conf", "Content-Security-Policy");
  requireText("docker/nginx/proxy.conf", "Strict-Transport-Security");
  requireText("docker/nginx/web.conf", "Strict-Transport-Security");
  requireText("docker/nginx/proxy.tls.conf", "listen 8443 ssl");
  requireText("docker/nginx/proxy.tls.conf", "ssl_protocols TLSv1.2 TLSv1.3");
  requireText("docker/nginx/proxy.tls.conf", "ssl_certificate /etc/nginx/tls/fullchain.pem");
  requireText("docker/nginx/proxy.tls.conf", "return 308 https://$host$request_uri");
  requireText("docker-compose.production.yml", "CVG_TLS_DIR");
  requireText("docker-compose.production.yml", "CVG_WEB_ORIGIN");
  requireText("docker-compose.production.yml", "ports: !override");
  requireText("docker/worker.ts", "CvgWorkerApplication");
  requireText("docker/worker.ts", "process.exitCode = 1");
  requireText("apps/worker/src/main.ts", "createConfiguredWorkerSink");
  requireText("apps/worker/src/worker.ts", "HttpMessagingProvider");
  requireText("apps/worker/src/worker.ts", "MessagingOutboxSink");
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
  requireText("apps/api/src/application/export-service.ts", "encryptRecoveryBundle");
  requireText("apps/api/src/application/export-service.ts", "idempotentAsync");
  requireText(".gauntlet/bar-v3.json", "V3-AAA-001");
  requireText(".github/workflows/ci.yml", "npm ci --ignore-scripts");
  requireText(".github/workflows/ci.yml", "npx playwright install --with-deps chromium");
  requireText(".github/workflows/ci.yml", "npm run lint");
  requireText(".github/workflows/ci.yml", "npm run test:contract");
  requireText(".github/workflows/ci.yml", "npm run test:security");
  requireText(".github/workflows/ci.yml", "npm run test:database");
  requireText(".github/workflows/ci.yml", "npm run test:fault");
  requireText(".github/workflows/ci.yml", "npm run test:e2e");
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
  requireText(".github/workflows/ci.yml", "npm run verify:provider-sandbox");
  requireText(".github/workflows/ci.yml", "docker build --file Dockerfile.api");
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
  deploy?: { resources?: { limits?: { cpus?: string; memory?: string } } };
};

type ComposeConfig = {
  services?: Record<string, ComposeService>;
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
    NODE_ENV: "development",
    CVG_WEB_ORIGIN: "http://localhost:8080",
    CVG_DEMO_MODE: "true",
    CVG_SECRET_PROVIDER: "none",
    CVG_SECRET_DIR: "/run/secrets/cvg",
    CVG_DEEPSEEK_RUNTIME_ENABLED: "false",
    CVG_PROXY_BIND: "127.0.0.1",
    CVG_PROXY_PORT: "8080",
    CVG_POSTGRES_PORT: "5440",
    CVG_API_IMAGE: "cvg-corp/api:verify",
    CVG_WEB_IMAGE: "cvg-corp/web:verify",
    CVG_WORKER_SINK_MODE: "quarantine",
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
  const environment = { ...syntheticComposeEnvironment(), OTEL_COLLECTOR_IMAGE: "otel/opentelemetry-collector-contrib:verify", TEMPO_IMAGE: "grafana/tempo:verify", PROMETHEUS_IMAGE: "prom/prometheus:verify", ALERTMANAGER_IMAGE: "prom/alertmanager:verify", GRAFANA_IMAGE: "grafana/grafana:verify" };
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
  const environment = { ...syntheticComposeEnvironment(), NODE_ENV: "production", CVG_WEB_ORIGIN: "https://cvg.example.test", CVG_TRUST_PROXY: "true", CVG_DEMO_MODE: "false", CVG_TLS_DIR: "/srv/cvg/tls" };
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
  if (environment.NODE_ENV !== "production" || environment.CVG_TRUST_PROXY !== "true" || environment.CVG_DEMO_MODE !== "false") failures.push("docker-compose.production.yml: API production environment is not fail-closed");
  if (!environment.CVG_WEB_ORIGIN?.startsWith("https://")) failures.push("docker-compose.production.yml: API web origin must use HTTPS");
  if (proxy.image !== "nginxinc/nginx-unprivileged:1.31.5-alpine3.24@sha256:2ddec616f1cb58bcac057aa388f28cb81e35137641ef4226d321714499329bd1") failures.push("docker-compose.production.yml: proxy image must match the approved immutable digest");
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
  if (!process.argv.includes("--production")) return;
  const environment = process.env;
  const requiredNames = ["DATABASE_URL", "CVG_BOOTSTRAP_PASSWORD", "CVG_WEB_ORIGIN", "CVG_TRUST_PROXY", "CVG_DEEPSEEK_BASE_URL", "CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT", "CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION", "CVG_DEEPSEEK_BEARER_TOKEN_REF", "CVG_DEEPSEEK_CONTEXT_SIGNING_SECRET_REF", "CVG_RECOVERY_ENCRYPTION_KEY_REF"];
  for (const name of requiredNames) if (!environment[name]?.trim()) failures.push(`production configuration: ${name} is required`);
  if (!environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() && !environment.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()) failures.push("production configuration: OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is required");
  if (environment.NODE_ENV !== "production") failures.push("production configuration: NODE_ENV must be production");
  if (environment.CVG_STORAGE !== "postgres") failures.push("production configuration: CVG_STORAGE must be postgres");
  if (environment.CVG_TRUST_PROXY !== "true") failures.push("production configuration: CVG_TRUST_PROXY must be true behind the TLS edge");
  if (environment.CVG_DEMO_MODE !== "false") failures.push("production configuration: CVG_DEMO_MODE must be false");
  if (environment.CVG_SECRET_PROVIDER === undefined || environment.CVG_SECRET_PROVIDER === "none") failures.push("production configuration: an explicit secret provider is required");
  if (environment.CVG_DEEPSEEK_RUNTIME_ENABLED !== "true") failures.push("production configuration: the mock runtime must be disabled");
  if (environment.CVG_WEB_ORIGIN && !environment.CVG_WEB_ORIGIN.startsWith("https://")) failures.push("production configuration: CVG_WEB_ORIGIN must use HTTPS");
  if (environment.CVG_DEEPSEEK_BASE_URL && !environment.CVG_DEEPSEEK_BASE_URL.startsWith("https://")) failures.push("production configuration: DeepSeek bridge must use HTTPS");
  const otelEndpoint = environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? environment.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (otelEndpoint && !otelEndpoint.startsWith("https://")) failures.push("production configuration: OTLP export must use HTTPS");
  if (environment.CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT && !/^[a-f0-9]{40}$/.test(environment.CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT)) failures.push("production configuration: expected engine commit must be a 40-character hex value");
  if (environment.CVG_BOOTSTRAP_PASSWORD && /replace|local-only|synthetic|verify/i.test(environment.CVG_BOOTSTRAP_PASSWORD)) failures.push("production configuration: placeholder bootstrap password is forbidden");
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

if (failures.length === 0 && !process.argv.includes("--production")) runLocalGates();

if (failures.length === 0) {
  const rendered = runComposeConfig();
  if (rendered.config) {
    inspectComposeConfig(rendered.config);
    observations.push("docker compose config validated with synthetic non-secret values; no service was started");
  } else if (!rendered.available) {
    observations.push("Docker Compose unavailable; only artifact/static checks were executed");
  }
  const observability = runObservabilityComposeConfig();
  if (observability.config) {
    inspectObservabilityComposeConfig(observability.config);
    observations.push("observability Compose config validated with synthetic non-secret values; no collector, dashboard or alert service was started");
  } else if (!observability.available) {
    observations.push("Docker Compose unavailable for observability; only observability artifact/static checks were executed");
  }
  const production = runProductionComposeConfig();
  if (production.config) {
    inspectProductionComposeConfig(production.config);
    observations.push("production TLS overlay Compose config validated with synthetic non-secret values; no service was started");
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
  process.stdout.write("PASS release artifacts and Compose configuration are structurally valid; production approval, service startup and external integrations were not executed\n");
}
