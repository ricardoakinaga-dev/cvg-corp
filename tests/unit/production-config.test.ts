import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function runProductionVerification(environment: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/verify-production.ts", "--production"], {
    cwd: process.cwd(),
    env: environment,
    encoding: "utf8"
  });
}

test("production verification fails closed before any runtime work when required authority is absent", () => {
  const result = runProductionVerification({ PATH: process.env.PATH ?? "", FORCE_COLOR: "0" });
  assert.equal(result.status, 1);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /production configuration: DATABASE_URL is required/);
  assert.match(output, /production configuration: CVG_DEEPSEEK_BASE_URL is required/);
  assert.match(output, /production configuration: CVG_RELEASE_ARTIFACT_DIGEST is required/);
  assert.equal(output.includes("PASS release artifacts"), false);
});

test("production verification rejects insecure, placeholder and disabled production controls", () => {
  const base: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "",
    FORCE_COLOR: "0",
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://cvg_runtime:secret@db.example.test:5432/cvg",
    CVG_BOOTSTRAP_PASSWORD: "A-strong-production-bootstrap-password-9!",
    CVG_WEB_ORIGIN: "https://cvg.example.test",
    CVG_HOST: "0.0.0.0",
    CVG_RELEASE_SHA: "a".repeat(40),
    CVG_RELEASE_ARTIFACT_DIGEST: `sha256:${"b".repeat(64)}`,
    CVG_TRUST_PROXY: "true",
    CVG_TRUSTED_PROXY_IPS: "loopback",
    CVG_WORKER_ORGANIZATION_ID: "00000000-0000-4000-8000-000000000010",
    CVG_BACKUP_ENABLED: "true",
    CVG_BACKUP_ORGANIZATION_ID: "00000000-0000-4000-8000-000000000010",
    CVG_BACKUP_DIRECTORY: "/var/lib/cvg/backups",
    CVG_BACKUP_INTERVAL_MS: "3600000",
    CVG_BACKUP_KEEP_LAST: "7",
    CVG_TLS_DIR: "/srv/cvg/tls",
    CVG_STORAGE: "postgres",
    CVG_DEMO_MODE: "false",
    CVG_SECRET_PROVIDER: "vault",
    CVG_RUNTIME_DB_USER: "cvg_runtime",
    CVG_RUNTIME_DB_PASSWORD: "a-real-runtime-password-9!",
    CVG_AUTH_MFA_MODE: "required",
    CVG_PASSWORD_MAX_AGE_DAYS: "90",
    CVG_RATE_LIMIT_BACKEND: "distributed",
    CVG_DEEPSEEK_RUNTIME_ENABLED: "true",
    CVG_DEEPSEEK_BASE_URL: "https://deepseek.example.test",
    CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT: "c".repeat(40),
    CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION: `sha256:${"d".repeat(64)}`,
    CVG_DEEPSEEK_BEARER_TOKEN_REF: "vault-deepseek-bearer",
    CVG_DEEPSEEK_CONTEXT_SIGNING_SECRET_REF: "vault-deepseek-context",
    CVG_RECOVERY_ENCRYPTION_KEY_REF: "vault-recovery-key",
    CVG_WORKER_SINK_MODE: "enabled",
    CVG_MESSAGING_PROVIDER_ENDPOINT: "https://provider.example.test",
    CVG_MESSAGING_PROVIDER_ALLOWED_HOSTS: "provider.example.test",
    CVG_MESSAGING_CREDENTIAL_REF: "vault-provider-credential",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.test"
  };
  const cases: Array<[string, Partial<NodeJS.ProcessEnv>, RegExp]> = [
    ["missing TLS", { CVG_TLS_DIR: undefined }, /CVG_TLS_DIR is required/],
    ["missing worker organization", { CVG_WORKER_ORGANIZATION_ID: undefined }, /CVG_WORKER_ORGANIZATION_ID is required/],
    ["unknown secret provider", { CVG_SECRET_PROVIDER: "bogus" }, /CVG_SECRET_PROVIDER must be one of/],
    ["privileged runtime database role", { DATABASE_URL: "postgresql://postgres:secret@db.example.test:5432/cvg" }, /DATABASE_URL must use the non-privileged cvg_runtime role/],
    ["missing runtime authority", { CVG_RUNTIME_DB_USER: undefined }, /CVG_RUNTIME_DB_USER is required/],
    ["demo mode", { CVG_DEMO_MODE: "true" }, /CVG_DEMO_MODE must be false/],
    ["memory storage", { CVG_STORAGE: "memory" }, /CVG_STORAGE must be postgres/],
    ["insecure web origin", { CVG_WEB_ORIGIN: "http://cvg.example.test" }, /CVG_WEB_ORIGIN must use HTTPS/],
    ["placeholder engine", { CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT: "0".repeat(40) }, /placeholder DeepSeek engine commit/],
    ["placeholder secret reference", { CVG_DEEPSEEK_BEARER_TOKEN_REF: "local-only-placeholder" }, /CVG_DEEPSEEK_BEARER_TOKEN_REF contains a placeholder/],
    ["missing MFA", { CVG_AUTH_MFA_MODE: "disabled" }, /CVG_AUTH_MFA_MODE must be required/],
    ["local rate limiter", { CVG_RATE_LIMIT_BACKEND: "local" }, /CVG_RATE_LIMIT_BACKEND must be distributed/],
    ["quarantined sink", { CVG_WORKER_SINK_MODE: "quarantine" }, /worker sink must be enabled/],
    ["insecure provider", { CVG_MESSAGING_PROVIDER_ENDPOINT: "http://provider.example.test" }, /messaging provider must use HTTPS/],
    ["malformed host allowlist", { CVG_MESSAGING_PROVIDER_ALLOWED_HOSTS: "" }, /host allowlist is empty or malformed/],
    ["insecure telemetry", { OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel.example.test" }, /OTLP export must use HTTPS/]
  ];
  for (const [name, overrides, expected] of cases) {
    const environment = { ...base, ...overrides };
    for (const [key, value] of Object.entries(environment)) if (value === undefined) delete environment[key];
    const result = runProductionVerification(environment);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 1, `${name} should fail closed; output=${output}`);
    assert.match(output, expected, name);
    assert.equal(output.includes("PASS release artifacts"), false, name);
  }
});
