import { z } from "zod";

const booleanFromEnv = z.string().trim().toLowerCase().transform((value, ctx) => {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  ctx.addIssue({ code: "custom", message: "boolean must be true/false or 1/0" });
  return z.NEVER;
});

export const cvgConfigSchema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
  host: z.string().trim().min(1).max(255).default("127.0.0.1"),
  trustProxy: z.boolean().default(false),
  apiPort: z.coerce.number().int().min(1).max(65_535).default(4310),
  webOrigin: z.string().url().default("http://127.0.0.1:5173"),
  storageMode: z.enum(["memory", "postgres"]).default("memory"),
  demoMode: z.boolean().default(true),
  sessionTtlMinutes: z.number().int().min(5).max(1_440).default(480),
  authMfaMode: z.enum(["disabled", "optional", "required"]).default("disabled"),
  passwordMinLength: z.number().int().min(12).max(128).default(12),
  passwordMaxAgeDays: z.number().int().min(0).max(730).default(90),
  authMaxFailedAttempts: z.number().int().min(3).max(20).default(8),
  authLockoutMinutes: z.number().int().min(1).max(240).default(15),
  authChallengeTtlSeconds: z.number().int().min(60).max(900).default(300),
  authMaxChallengeAttempts: z.number().int().min(3).max(10).default(5),
  databaseUrl: z.string().trim().min(1).max(2_000).default("postgresql://127.0.0.1:5440/cvg_m1_synthetic"),
  bootstrapPassword: z.string().min(12).max(256).nullable().default(null),
  deepseekBaseUrl: z.string().url().nullable().default(null),
  deepseekRuntimeEnabled: z.boolean().default(false),
  deepseekExpectedEngineCommit: z.string().regex(/^[a-f0-9]{40}$/).nullable().default(null),
  deepseekExpectedManifestVersion: z.string().trim().min(1).max(120).nullable().default(null),
  deepseekBearerTokenRef: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,160}$/).nullable().default(null),
  secretDir: z.string().trim().min(1).max(1_024).default("/run/secrets/cvg"),
  workerOrganizationId: z.string().trim().min(1).max(200).nullable().default(null),
  workerId: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,120}$/).default("cvg-worker-local"),
  workerIntervalMs: z.number().int().min(1_000).max(30_000).default(5_000),
  workerMaxOutstandingOutbox: z.number().int().min(1).max(1_000_000).default(1_000),
  workerSinkMode: z.enum(["quarantine", "enabled"]).default("quarantine"),
  workerHeartbeatFile: z.string().trim().min(1).max(1_024).default("/tmp/cvg-worker/heartbeat"),
  secretProvider: z.enum(["none", "env", "file", "docker", "vault", "aws", "gcp", "azure", "kubernetes"]).default("none"),
  messagingProviderEndpoint: z.string().url().nullable().default(null),
  messagingProviderAllowedHosts: z.array(z.string().trim().regex(/^[A-Za-z0-9.-]{1,253}$/)).max(20).default([]),
  messagingCredentialRef: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,160}$/).nullable().default(null),
  messagingSendPath: z.string().trim().regex(/^\/[A-Za-z0-9._~:/-]{1,200}$/).default("/messages"),
  messagingQueryPath: z.string().trim().regex(/^\/[A-Za-z0-9._~:/-]{1,200}$/).nullable().default(null),
  rateLimitBackend: z.enum(["local", "distributed"]).default("local"),
  rateLimitRequestsPerWindow: z.number().int().min(1).max(10_000).default(120),
  rateLimitWindowSeconds: z.number().int().min(1).max(3_600).default(60)
}).strict().superRefine((value, ctx) => {
  if (value.nodeEnv === "production" && !value.webOrigin.startsWith("https://")) ctx.addIssue({ code: "custom", path: ["webOrigin"], message: "production webOrigin must use HTTPS" });
  if (value.nodeEnv === "production" && (value.host === "localhost" || value.host === "127.0.0.1" || value.host === "::1" || value.host.startsWith("127."))) ctx.addIssue({ code: "custom", path: ["host"], message: "production cannot bind to a loopback host" });
  if (value.nodeEnv === "production" && value.demoMode) ctx.addIssue({ code: "custom", path: ["demoMode"], message: "demoMode is forbidden in production" });
  if (value.nodeEnv === "production" && !value.trustProxy) ctx.addIssue({ code: "custom", path: ["trustProxy"], message: "production requires an explicitly trusted TLS edge proxy" });
  if (value.nodeEnv === "production" && value.storageMode !== "postgres") ctx.addIssue({ code: "custom", path: ["storageMode"], message: "production requires PostgreSQL durable storage" });
  if (value.nodeEnv === "production" && value.secretProvider === "none") ctx.addIssue({ code: "custom", path: ["secretProvider"], message: "production requires an explicit secret provider" });
  if (value.nodeEnv === "production" && value.authMfaMode !== "required") ctx.addIssue({ code: "custom", path: ["authMfaMode"], message: "production requires MFA" });
  if (value.nodeEnv === "production" && value.passwordMaxAgeDays === 0) ctx.addIssue({ code: "custom", path: ["passwordMaxAgeDays"], message: "production requires credential rotation" });
  if (value.nodeEnv === "production" && !value.deepseekRuntimeEnabled) ctx.addIssue({ code: "custom", path: ["deepseekRuntimeEnabled"], message: "production cannot use the local mock runtime" });
  if (value.nodeEnv === "production" && value.deepseekBaseUrl && !value.deepseekBaseUrl.startsWith("https://")) ctx.addIssue({ code: "custom", path: ["deepseekBaseUrl"], message: "production DeepSeek bridge must use HTTPS" });
  if (value.deepseekRuntimeEnabled && !value.deepseekBaseUrl) ctx.addIssue({ code: "custom", path: ["deepseekBaseUrl"], message: "DeepSeek runtime requires an explicit base URL" });
  if (value.deepseekRuntimeEnabled && !value.deepseekExpectedEngineCommit) ctx.addIssue({ code: "custom", path: ["deepseekExpectedEngineCommit"], message: "DeepSeek runtime requires an approved engine commit" });
  if (value.deepseekRuntimeEnabled && !value.deepseekExpectedManifestVersion) ctx.addIssue({ code: "custom", path: ["deepseekExpectedManifestVersion"], message: "DeepSeek runtime requires an approved manifest version" });
  if (value.deepseekRuntimeEnabled && value.nodeEnv === "production" && !value.deepseekBearerTokenRef) ctx.addIssue({ code: "custom", path: ["deepseekBearerTokenRef"], message: "production DeepSeek runtime requires an explicit bearer token reference" });
  if (value.storageMode === "postgres" && !value.databaseUrl) ctx.addIssue({ code: "custom", path: ["databaseUrl"], message: "PostgreSQL storage requires DATABASE_URL" });
  if (value.nodeEnv === "production" && value.rateLimitBackend !== "distributed") ctx.addIssue({ code: "custom", path: ["rateLimitBackend"], message: "production requires a distributed rate-limit backend" });
  if (value.nodeEnv === "production" && value.messagingProviderEndpoint && !value.messagingProviderEndpoint.startsWith("https://")) ctx.addIssue({ code: "custom", path: ["messagingProviderEndpoint"], message: "production messaging provider must use HTTPS" });
  if (value.workerSinkMode === "enabled" && (!value.messagingProviderEndpoint || !value.messagingCredentialRef)) ctx.addIssue({ code: "custom", path: ["workerSinkMode"], message: "enabled worker sink requires a messaging endpoint and credential reference" });
  if (value.workerSinkMode === "enabled" && value.messagingProviderAllowedHosts.length === 0) ctx.addIssue({ code: "custom", path: ["messagingProviderAllowedHosts"], message: "enabled worker sink requires an explicit provider host allowlist" });
  if (value.workerSinkMode === "enabled" && value.secretProvider === "none") ctx.addIssue({ code: "custom", path: ["secretProvider"], message: "enabled worker sink requires an explicit secret provider" });
});

export type CvgConfig = z.infer<typeof cvgConfigSchema>;

export class ConfigError extends Error {
  readonly issues: readonly z.core.$ZodIssue[];

  constructor(message: string, issues: readonly z.core.$ZodIssue[] = []) {
    super(message);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export function validateCvgConfig(value: unknown): CvgConfig {
  const parsed = cvgConfigSchema.safeParse(value);
  if (!parsed.success) throw new ConfigError("Invalid CVG configuration.", parsed.error.issues);
  return parsed.data;
}

const knownEnvironmentKeys = new Set(["NODE_ENV", "SESSION_TTL_MINUTES", "CVG_AUTH_MFA_MODE", "CVG_PASSWORD_MIN_LENGTH", "CVG_PASSWORD_MAX_AGE_DAYS", "CVG_AUTH_MAX_FAILED_ATTEMPTS", "CVG_AUTH_LOCKOUT_MINUTES", "CVG_AUTH_CHALLENGE_TTL_SECONDS", "CVG_AUTH_MAX_CHALLENGE_ATTEMPTS", "DATABASE_URL", "CVG_HOST", "CVG_API_PORT", "CVG_WEB_ORIGIN", "CVG_TRUST_PROXY", "CVG_STORAGE", "CVG_DEMO_MODE", "CVG_BOOTSTRAP_PASSWORD", "CVG_DEEPSEEK_BASE_URL", "CVG_DEEPSEEK_RUNTIME_ENABLED", "CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT", "CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION", "CVG_DEEPSEEK_BEARER_TOKEN_REF", "CVG_SECRET_DIR", "CVG_WORKER_ORGANIZATION_ID", "CVG_WORKER_ID", "CVG_WORKER_INTERVAL_MS", "CVG_WORKER_MAX_OUTSTANDING", "CVG_WORKER_SINK_MODE", "CVG_WORKER_HEARTBEAT_FILE", "CVG_SECRET_PROVIDER", "CVG_MESSAGING_PROVIDER_ENDPOINT", "CVG_MESSAGING_PROVIDER_ALLOWED_HOSTS", "CVG_MESSAGING_CREDENTIAL_REF", "CVG_MESSAGING_SEND_PATH", "CVG_MESSAGING_QUERY_PATH", "CVG_RATE_LIMIT_BACKEND", "CVG_RATE_LIMIT_REQUESTS_PER_WINDOW", "CVG_RATE_LIMIT_WINDOW_SECONDS"]);

function parseEnvironmentValue(value: string | undefined, parser: (value: string) => unknown): unknown {
  return value === undefined ? undefined : parser(value);
}

/** Parses only the supported CVG environment keys and fails closed on unknown CVG_ variables. */
export function loadCvgConfig(environment: NodeJS.ProcessEnv = process.env): CvgConfig {
  const unknown = Object.keys(environment).filter((key) => key.startsWith("CVG_") && !knownEnvironmentKeys.has(key));
  if (unknown.length) throw new ConfigError(`Unknown CVG configuration key(s): ${unknown.join(", ")}`);
  const candidate = {
    ...(environment.NODE_ENV === undefined ? {} : { nodeEnv: environment.NODE_ENV }),
    ...(environment.CVG_HOST === undefined ? {} : { host: environment.CVG_HOST }),
    ...(environment.CVG_TRUST_PROXY === undefined ? {} : { trustProxy: parseEnvironmentValue(environment.CVG_TRUST_PROXY, (value) => booleanFromEnv.parse(value)) }),
    ...(environment.CVG_API_PORT === undefined ? {} : { apiPort: environment.CVG_API_PORT }),
    ...(environment.CVG_WEB_ORIGIN === undefined ? {} : { webOrigin: environment.CVG_WEB_ORIGIN }),
    ...(environment.CVG_STORAGE === undefined ? {} : { storageMode: environment.CVG_STORAGE }),
    ...(environment.CVG_DEMO_MODE === undefined ? {} : { demoMode: parseEnvironmentValue(environment.CVG_DEMO_MODE, (value) => booleanFromEnv.parse(value)) }),
    ...(environment.SESSION_TTL_MINUTES === undefined ? {} : { sessionTtlMinutes: Number(environment.SESSION_TTL_MINUTES) }),
    ...(environment.CVG_AUTH_MFA_MODE === undefined ? {} : { authMfaMode: environment.CVG_AUTH_MFA_MODE }),
    ...(environment.CVG_PASSWORD_MIN_LENGTH === undefined ? {} : { passwordMinLength: Number(environment.CVG_PASSWORD_MIN_LENGTH) }),
    ...(environment.CVG_PASSWORD_MAX_AGE_DAYS === undefined ? {} : { passwordMaxAgeDays: Number(environment.CVG_PASSWORD_MAX_AGE_DAYS) }),
    ...(environment.CVG_AUTH_MAX_FAILED_ATTEMPTS === undefined ? {} : { authMaxFailedAttempts: Number(environment.CVG_AUTH_MAX_FAILED_ATTEMPTS) }),
    ...(environment.CVG_AUTH_LOCKOUT_MINUTES === undefined ? {} : { authLockoutMinutes: Number(environment.CVG_AUTH_LOCKOUT_MINUTES) }),
    ...(environment.CVG_AUTH_CHALLENGE_TTL_SECONDS === undefined ? {} : { authChallengeTtlSeconds: Number(environment.CVG_AUTH_CHALLENGE_TTL_SECONDS) }),
    ...(environment.CVG_AUTH_MAX_CHALLENGE_ATTEMPTS === undefined ? {} : { authMaxChallengeAttempts: Number(environment.CVG_AUTH_MAX_CHALLENGE_ATTEMPTS) }),
    ...(environment.DATABASE_URL === undefined ? {} : { databaseUrl: environment.DATABASE_URL }),
    ...(environment.CVG_BOOTSTRAP_PASSWORD === undefined ? {} : { bootstrapPassword: environment.CVG_BOOTSTRAP_PASSWORD }),
    ...(environment.CVG_DEEPSEEK_BASE_URL === undefined ? {} : { deepseekBaseUrl: environment.CVG_DEEPSEEK_BASE_URL }),
    ...(environment.CVG_DEEPSEEK_RUNTIME_ENABLED === undefined ? {} : { deepseekRuntimeEnabled: parseEnvironmentValue(environment.CVG_DEEPSEEK_RUNTIME_ENABLED, (value) => booleanFromEnv.parse(value)) }),
    ...(environment.CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT === undefined ? {} : { deepseekExpectedEngineCommit: environment.CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT }),
    ...(environment.CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION === undefined ? {} : { deepseekExpectedManifestVersion: environment.CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION }),
    ...(environment.CVG_DEEPSEEK_BEARER_TOKEN_REF === undefined ? {} : { deepseekBearerTokenRef: environment.CVG_DEEPSEEK_BEARER_TOKEN_REF }),
    ...(environment.CVG_SECRET_DIR === undefined ? {} : { secretDir: environment.CVG_SECRET_DIR }),
    ...(environment.CVG_WORKER_ORGANIZATION_ID === undefined ? {} : { workerOrganizationId: environment.CVG_WORKER_ORGANIZATION_ID }),
    ...(environment.CVG_WORKER_ID === undefined ? {} : { workerId: environment.CVG_WORKER_ID }),
    ...(environment.CVG_WORKER_INTERVAL_MS === undefined ? {} : { workerIntervalMs: Number(environment.CVG_WORKER_INTERVAL_MS) }),
    ...(environment.CVG_WORKER_MAX_OUTSTANDING === undefined ? {} : { workerMaxOutstandingOutbox: Number(environment.CVG_WORKER_MAX_OUTSTANDING) }),
    ...(environment.CVG_WORKER_SINK_MODE === undefined ? {} : { workerSinkMode: environment.CVG_WORKER_SINK_MODE }),
    ...(environment.CVG_WORKER_HEARTBEAT_FILE === undefined ? {} : { workerHeartbeatFile: environment.CVG_WORKER_HEARTBEAT_FILE }),
    ...(environment.CVG_SECRET_PROVIDER === undefined ? {} : { secretProvider: environment.CVG_SECRET_PROVIDER }),
    ...(environment.CVG_MESSAGING_PROVIDER_ENDPOINT === undefined ? {} : { messagingProviderEndpoint: environment.CVG_MESSAGING_PROVIDER_ENDPOINT }),
    ...(environment.CVG_MESSAGING_PROVIDER_ALLOWED_HOSTS === undefined ? {} : { messagingProviderAllowedHosts: environment.CVG_MESSAGING_PROVIDER_ALLOWED_HOSTS.split(",").map((value) => value.trim()).filter(Boolean) }),
    ...(environment.CVG_MESSAGING_CREDENTIAL_REF === undefined ? {} : { messagingCredentialRef: environment.CVG_MESSAGING_CREDENTIAL_REF }),
    ...(environment.CVG_MESSAGING_SEND_PATH === undefined ? {} : { messagingSendPath: environment.CVG_MESSAGING_SEND_PATH }),
    ...(environment.CVG_MESSAGING_QUERY_PATH === undefined ? {} : { messagingQueryPath: environment.CVG_MESSAGING_QUERY_PATH }),
    ...(environment.CVG_RATE_LIMIT_BACKEND === undefined ? {} : { rateLimitBackend: environment.CVG_RATE_LIMIT_BACKEND }),
    ...(environment.CVG_RATE_LIMIT_REQUESTS_PER_WINDOW === undefined ? {} : { rateLimitRequestsPerWindow: Number(environment.CVG_RATE_LIMIT_REQUESTS_PER_WINDOW) }),
    ...(environment.CVG_RATE_LIMIT_WINDOW_SECONDS === undefined ? {} : { rateLimitWindowSeconds: Number(environment.CVG_RATE_LIMIT_WINDOW_SECONDS) })
  };
  return validateCvgConfig(candidate);
}
