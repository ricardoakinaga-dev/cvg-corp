import { z } from "zod";

export const CVG_SECRET_PROVIDER_KINDS = ["none", "env", "file", "docker", "vault", "aws", "gcp", "azure", "kubernetes"] as const;
export type CvgSecretProviderKind = (typeof CVG_SECRET_PROVIDER_KINDS)[number];
export const CVG_RUNTIME_DATABASE_ROLE = "cvg_runtime" as const;

/** Extracts the database login without exposing any password material. */
export function databaseRoleFromUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return null;
    const username = decodeURIComponent(parsed.username);
    return username || null;
  } catch {
    return null;
  }
}

export function hasRuntimeDatabaseAuthority(value: string): boolean {
  return databaseRoleFromUrl(value) === CVG_RUNTIME_DATABASE_ROLE;
}

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
  /** Exact proxy addresses/CIDRs trusted to supply X-Forwarded-For. */
  trustedProxyIps: z.array(z.string().trim().regex(/^[A-Za-z0-9:./_-]{1,80}$/)).max(32).default([]),
  apiPort: z.coerce.number().int().min(1).max(65_535).default(4310),
  webOrigin: z.string().url().default("http://127.0.0.1:5173"),
  releaseSha: z.string().regex(/^[a-f0-9]{40}$/).nullable().default(null),
  releaseArtifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable().default(null),
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
  deepseekExpectedToolNames: z.array(z.string().trim().min(1).max(160)).max(256).default([]),
  deepseekBridgeTimeoutMs: z.number().int().min(100).max(120_000).default(5_000),
  deepseekBridgeHost: z.string().trim().min(1).max(255).default("127.0.0.1"),
  deepseekBridgePort: z.number().int().min(1).max(65_535).default(4_320),
  deepseekAcpCommand: z.string().trim().min(1).max(512).nullable().default(null),
  deepseekAcpArgsJson: z.string().trim().max(16_000).nullable().default(null),
  deepseekAcpEngineRoot: z.string().trim().min(1).max(2_000).nullable().default(null),
  deepseekAcpWorkspaceRoot: z.string().trim().min(1).max(2_000).nullable().default(null),
  deepseekAcpManifestPath: z.string().trim().min(1).max(2_000).nullable().default(null),
  deepseekAcpDshHome: z.string().trim().min(1).max(2_000).nullable().default(null),
  deepseekAcpExpectedAgentName: z.string().trim().min(1).max(200).default("deepseek-harness-acp"),
  deepseekAcpExpectedAgentVersion: z.string().trim().min(1).max(120).nullable().default(null),
  deepseekAcpModel: z.string().trim().min(1).max(200).default("deepseek-acp"),
  deepseekAcpPermissionMode: z.literal("read-only").default("read-only"),
  deepseekAcpStartupTimeoutMs: z.number().int().min(100).max(120_000).default(15_000),
  deepseekAcpShutdownTimeoutMs: z.number().int().min(100).max(30_000).default(2_000),
  deepseekBearerTokenRef: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,160}$/).nullable().default(null),
  deepseekContextSigningSecretRef: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,160}$/).nullable().default(null),
  recoveryEncryptionKeyRef: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,160}$/).nullable().default(null),
  secretDir: z.string().trim().min(1).max(1_024).default("/run/secrets/cvg"),
  workerOrganizationId: z.string().trim().min(1).max(200).nullable().default(null),
  workerId: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,120}$/).default("cvg-worker-local"),
  workerIntervalMs: z.number().int().min(1_000).max(30_000).default(5_000),
  workerMaxOutstandingOutbox: z.number().int().min(1).max(1_000_000).default(1_000),
  workerSinkMode: z.enum(["quarantine", "enabled"]).default("quarantine"),
  workerHeartbeatFile: z.string().trim().min(1).max(1_024).default("/tmp/cvg-worker/heartbeat"),
  secretProvider: z.enum(CVG_SECRET_PROVIDER_KINDS).default("none"),
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
  if (value.nodeEnv === "production" && !value.releaseSha) ctx.addIssue({ code: "custom", path: ["releaseSha"], message: "production requires the immutable release SHA" });
  if (value.nodeEnv === "production" && !value.releaseArtifactDigest) ctx.addIssue({ code: "custom", path: ["releaseArtifactDigest"], message: "production requires the immutable release artifact digest" });
  if (value.nodeEnv === "production" && (value.host === "localhost" || value.host === "127.0.0.1" || value.host === "::1" || value.host.startsWith("127."))) ctx.addIssue({ code: "custom", path: ["host"], message: "production cannot bind to a loopback host" });
  if (value.nodeEnv === "production" && value.demoMode) ctx.addIssue({ code: "custom", path: ["demoMode"], message: "demoMode is forbidden in production" });
  if (value.nodeEnv === "production" && !value.trustProxy) ctx.addIssue({ code: "custom", path: ["trustProxy"], message: "production requires an explicitly trusted TLS edge proxy" });
  if (value.nodeEnv === "production" && value.trustedProxyIps.length === 0) ctx.addIssue({ code: "custom", path: ["trustedProxyIps"], message: "production requires an explicit trusted proxy address/CIDR allowlist" });
  if (value.nodeEnv === "production" && value.storageMode !== "postgres") ctx.addIssue({ code: "custom", path: ["storageMode"], message: "production requires PostgreSQL durable storage" });
  if (value.nodeEnv === "production" && !hasRuntimeDatabaseAuthority(value.databaseUrl)) ctx.addIssue({ code: "custom", path: ["databaseUrl"], message: `production requires the non-privileged ${CVG_RUNTIME_DATABASE_ROLE} database role` });
  if (value.nodeEnv === "production" && value.secretProvider === "none") ctx.addIssue({ code: "custom", path: ["secretProvider"], message: "production requires an explicit secret provider" });
  if (value.nodeEnv === "production" && value.authMfaMode !== "required") ctx.addIssue({ code: "custom", path: ["authMfaMode"], message: "production requires MFA" });
  if (value.nodeEnv === "production" && value.passwordMaxAgeDays === 0) ctx.addIssue({ code: "custom", path: ["passwordMaxAgeDays"], message: "production requires credential rotation" });
  if (value.nodeEnv === "production" && !value.deepseekRuntimeEnabled) ctx.addIssue({ code: "custom", path: ["deepseekRuntimeEnabled"], message: "production cannot use the local mock runtime" });
  if (value.nodeEnv === "production" && value.deepseekBaseUrl && !value.deepseekBaseUrl.startsWith("https://")) ctx.addIssue({ code: "custom", path: ["deepseekBaseUrl"], message: "production DeepSeek bridge must use HTTPS" });
  if (value.deepseekRuntimeEnabled && !value.deepseekBaseUrl) ctx.addIssue({ code: "custom", path: ["deepseekBaseUrl"], message: "DeepSeek runtime requires an explicit base URL" });
  if (value.deepseekRuntimeEnabled && !value.deepseekExpectedEngineCommit) ctx.addIssue({ code: "custom", path: ["deepseekExpectedEngineCommit"], message: "DeepSeek runtime requires an approved engine commit" });
  if (value.deepseekRuntimeEnabled && /^0{40}$/.test(value.deepseekExpectedEngineCommit ?? "")) ctx.addIssue({ code: "custom", path: ["deepseekExpectedEngineCommit"], message: "DeepSeek runtime rejects a placeholder engine commit" });
  if (value.deepseekRuntimeEnabled && !value.deepseekExpectedManifestVersion) ctx.addIssue({ code: "custom", path: ["deepseekExpectedManifestVersion"], message: "DeepSeek runtime requires an approved manifest version" });
  if (value.deepseekRuntimeEnabled && value.nodeEnv === "production" && !value.deepseekBearerTokenRef) ctx.addIssue({ code: "custom", path: ["deepseekBearerTokenRef"], message: "production DeepSeek runtime requires an explicit bearer token reference" });
  if (value.deepseekRuntimeEnabled && value.nodeEnv === "production" && !value.deepseekContextSigningSecretRef) ctx.addIssue({ code: "custom", path: ["deepseekContextSigningSecretRef"], message: "production DeepSeek runtime requires an explicit context-signing secret reference" });
  if (value.storageMode === "postgres" && !value.databaseUrl) ctx.addIssue({ code: "custom", path: ["databaseUrl"], message: "PostgreSQL storage requires DATABASE_URL" });
  if (value.nodeEnv === "production" && value.rateLimitBackend !== "distributed") ctx.addIssue({ code: "custom", path: ["rateLimitBackend"], message: "production requires a distributed rate-limit backend" });
  if (value.nodeEnv === "production" && value.messagingProviderEndpoint && !value.messagingProviderEndpoint.startsWith("https://")) ctx.addIssue({ code: "custom", path: ["messagingProviderEndpoint"], message: "production messaging provider must use HTTPS" });
  if (value.workerSinkMode === "enabled" && (!value.messagingProviderEndpoint || !value.messagingCredentialRef)) ctx.addIssue({ code: "custom", path: ["workerSinkMode"], message: "enabled worker sink requires a messaging endpoint and credential reference" });
  if (value.workerSinkMode === "enabled" && value.messagingProviderAllowedHosts.length === 0) ctx.addIssue({ code: "custom", path: ["messagingProviderAllowedHosts"], message: "enabled worker sink requires an explicit provider host allowlist" });
  if (value.workerSinkMode === "enabled" && value.secretProvider === "none") ctx.addIssue({ code: "custom", path: ["secretProvider"], message: "enabled worker sink requires an explicit secret provider" });
});

export type CvgConfig = z.infer<typeof cvgConfigSchema>;

/**
 * A worker is a separate process boundary.  It does not need the API's web,
 * authentication, DeepSeek or release presentation settings in order to
 * start, but it does need its own durable queue and provider authority.  Keep
 * that contract separate from the API schema so a production worker cannot be
 * made unbootable by unrelated API-only requirements.
 */
export const cvgWorkerConfigSchema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
  storageMode: z.enum(["memory", "postgres"]).default("memory"),
  databaseUrl: z.string().trim().min(1).max(2_000).nullable().default(null),
  workerOrganizationId: z.string().trim().min(1).max(200).nullable().default(null),
  workerId: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,120}$/).default("cvg-worker-local"),
  workerIntervalMs: z.number().int().min(1_000).max(30_000).default(5_000),
  workerMaxOutstandingOutbox: z.number().int().min(1).max(1_000_000).default(1_000),
  workerSinkMode: z.enum(["quarantine", "enabled"]).default("quarantine"),
  workerHeartbeatFile: z.string().trim().min(1).max(1_024).default("/tmp/cvg-worker/heartbeat"),
  /** Operational backup is explicitly scoped to one organization per worker. */
  backupEnabled: z.boolean().default(false),
  backupOrganizationId: z.string().trim().min(1).max(200).nullable().default(null),
  backupDirectory: z.string().trim().min(1).max(1_024).nullable().default(null),
  backupIntervalMs: z.number().int().min(1_000).max(86_400_000).default(3_600_000),
  backupKeepLast: z.number().int().min(1).max(10_000).default(7),
  recoveryEncryptionKeyRef: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,160}$/).nullable().default(null),
  secretProvider: z.enum(CVG_SECRET_PROVIDER_KINDS).default("none"),
  secretDir: z.string().trim().min(1).max(1_024).default("/run/secrets/cvg"),
  messagingProviderEndpoint: z.string().url().nullable().default(null),
  messagingProviderAllowedHosts: z.array(z.string().trim().regex(/^[A-Za-z0-9.-]{1,253}$/)).max(20).default([]),
  messagingCredentialRef: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,160}$/).nullable().default(null),
  messagingSendPath: z.string().trim().regex(/^\/[A-Za-z0-9._~:/-]{1,200}$/).default("/messages"),
  messagingQueryPath: z.string().trim().regex(/^\/[A-Za-z0-9._~:/-]{1,200}$/).nullable().default(null)
}).strict().superRefine((value, ctx) => {
  if (value.storageMode !== "postgres") ctx.addIssue({ code: "custom", path: ["storageMode"], message: "worker requires PostgreSQL durable storage" });
  if (!value.databaseUrl) ctx.addIssue({ code: "custom", path: ["databaseUrl"], message: "worker requires DATABASE_URL" });
  if (!value.workerOrganizationId) ctx.addIssue({ code: "custom", path: ["workerOrganizationId"], message: "worker requires CVG_WORKER_ORGANIZATION_ID" });
  const backupFieldsConfigured = value.backupOrganizationId !== null || value.backupDirectory !== null || value.recoveryEncryptionKeyRef !== null;
  if (value.backupEnabled && (!value.backupOrganizationId || !value.backupDirectory || !value.recoveryEncryptionKeyRef)) ctx.addIssue({ code: "custom", path: ["backupOrganizationId"], message: "enabled operational backup requires an explicit organization, directory and recovery key reference" });
  if (!value.backupEnabled && backupFieldsConfigured) ctx.addIssue({ code: "custom", path: ["backupEnabled"], message: "backup organization, directory and key reference require CVG_BACKUP_ENABLED=true" });
  if (value.backupOrganizationId && value.workerOrganizationId && value.backupOrganizationId !== value.workerOrganizationId) ctx.addIssue({ code: "custom", path: ["backupOrganizationId"], message: "operational backup organization must equal the worker organization" });
  if (value.nodeEnv === "production") {
    if (value.workerSinkMode !== "enabled") ctx.addIssue({ code: "custom", path: ["workerSinkMode"], message: "production worker requires an enabled provider sink" });
    if (value.secretProvider === "none") ctx.addIssue({ code: "custom", path: ["secretProvider"], message: "production worker requires an explicit secret provider" });
    if (!value.messagingProviderEndpoint?.startsWith("https://")) ctx.addIssue({ code: "custom", path: ["messagingProviderEndpoint"], message: "production worker provider must use HTTPS" });
    if (!value.messagingCredentialRef) ctx.addIssue({ code: "custom", path: ["messagingCredentialRef"], message: "production worker requires a provider credential reference" });
    if (value.messagingProviderAllowedHosts.length === 0) ctx.addIssue({ code: "custom", path: ["messagingProviderAllowedHosts"], message: "production worker requires an explicit provider host allowlist" });
    if (value.databaseUrl && !hasRuntimeDatabaseAuthority(value.databaseUrl)) ctx.addIssue({ code: "custom", path: ["databaseUrl"], message: `production worker requires the non-privileged ${CVG_RUNTIME_DATABASE_ROLE} database role` });
    if (value.databaseUrl && /@(?:localhost|127(?:\.\d+){3}|\[::1\]|postgres)(?::|\/)/i.test(value.databaseUrl)) ctx.addIssue({ code: "custom", path: ["databaseUrl"], message: "production worker database must not point at the local Compose host" });
    if (!value.backupEnabled) ctx.addIssue({ code: "custom", path: ["backupEnabled"], message: "production worker requires CVG_BACKUP_ENABLED=true" });
    if (!value.backupOrganizationId) ctx.addIssue({ code: "custom", path: ["backupOrganizationId"], message: "production worker requires an explicit backup organization" });
    if (!value.backupDirectory) ctx.addIssue({ code: "custom", path: ["backupDirectory"], message: "production worker requires an explicit backup directory" });
    if (!value.recoveryEncryptionKeyRef) ctx.addIssue({ code: "custom", path: ["recoveryEncryptionKeyRef"], message: "production worker requires an explicit recovery encryption key reference" });
  }
  if (value.workerSinkMode === "enabled") {
    if (!value.messagingProviderEndpoint || !value.messagingCredentialRef) ctx.addIssue({ code: "custom", path: ["workerSinkMode"], message: "enabled worker sink requires a provider endpoint and credential reference" });
    if (value.messagingProviderAllowedHosts.length === 0) ctx.addIssue({ code: "custom", path: ["messagingProviderAllowedHosts"], message: "enabled worker sink requires an explicit provider host allowlist" });
    if (value.secretProvider === "none") ctx.addIssue({ code: "custom", path: ["secretProvider"], message: "enabled worker sink requires an explicit secret provider" });
  }
});

export type CvgWorkerConfig = z.infer<typeof cvgWorkerConfigSchema>;

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

export class WorkerConfigError extends ConfigError {
  constructor(message: string, issues: readonly z.core.$ZodIssue[] = []) {
    super(message, issues);
    this.name = "WorkerConfigError";
  }
}

const knownEnvironmentKeys = new Set(["NODE_ENV", "SESSION_TTL_MINUTES", "CVG_AUTH_MFA_MODE", "CVG_PASSWORD_MIN_LENGTH", "CVG_PASSWORD_MAX_AGE_DAYS", "CVG_AUTH_MAX_FAILED_ATTEMPTS", "CVG_AUTH_LOCKOUT_MINUTES", "CVG_AUTH_CHALLENGE_TTL_SECONDS", "CVG_AUTH_MAX_CHALLENGE_ATTEMPTS", "DATABASE_URL", "CVG_HOST", "CVG_API_PORT", "CVG_WEB_ORIGIN", "CVG_RELEASE_SHA", "CVG_RELEASE_ARTIFACT_DIGEST", "CVG_TRUST_PROXY", "CVG_TRUSTED_PROXY_IPS", "CVG_STORAGE", "CVG_DEMO_MODE", "CVG_BOOTSTRAP_PASSWORD", "CVG_DEEPSEEK_BASE_URL", "CVG_DEEPSEEK_RUNTIME_ENABLED", "CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT", "CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION", "CVG_DEEPSEEK_EXPECTED_TOOL_NAMES", "CVG_DEEPSEEK_BRIDGE_TIMEOUT_MS", "CVG_DEEPSEEK_BRIDGE_HOST", "CVG_DEEPSEEK_BRIDGE_PORT", "CVG_DEEPSEEK_ACP_COMMAND", "CVG_DEEPSEEK_ACP_ARGS_JSON", "CVG_DEEPSEEK_ACP_ENGINE_ROOT", "CVG_DEEPSEEK_ACP_WORKSPACE_ROOT", "CVG_DEEPSEEK_ACP_MANIFEST_PATH", "CVG_DEEPSEEK_ACP_DSH_HOME", "CVG_DEEPSEEK_ACP_EXPECTED_AGENT_NAME", "CVG_DEEPSEEK_ACP_EXPECTED_AGENT_VERSION", "CVG_DEEPSEEK_ACP_MODEL", "CVG_DEEPSEEK_ACP_PERMISSION_MODE", "CVG_DEEPSEEK_ACP_STARTUP_TIMEOUT_MS", "CVG_DEEPSEEK_ACP_SHUTDOWN_TIMEOUT_MS", "CVG_DEEPSEEK_BEARER_TOKEN_REF", "CVG_DEEPSEEK_CONTEXT_SIGNING_SECRET_REF", "CVG_RECOVERY_ENCRYPTION_KEY_REF", "CVG_SECRET_DIR", "CVG_WORKER_ORGANIZATION_ID", "CVG_WORKER_ID", "CVG_WORKER_INTERVAL_MS", "CVG_WORKER_MAX_OUTSTANDING", "CVG_WORKER_SINK_MODE", "CVG_WORKER_HEARTBEAT_FILE", "CVG_SECRET_PROVIDER", "CVG_MESSAGING_PROVIDER_ENDPOINT", "CVG_MESSAGING_PROVIDER_ALLOWED_HOSTS", "CVG_MESSAGING_CREDENTIAL_REF", "CVG_MESSAGING_SEND_PATH", "CVG_MESSAGING_QUERY_PATH", "CVG_RATE_LIMIT_BACKEND", "CVG_RATE_LIMIT_REQUESTS_PER_WINDOW", "CVG_RATE_LIMIT_WINDOW_SECONDS"]);

function parseEnvironmentValue(value: string | undefined, parser: (value: string) => unknown): unknown {
  return value === undefined ? undefined : parser(value);
}

function optionalEnvironmentValue(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

/** Parses only the supported CVG environment keys and fails closed on unknown CVG_ variables. */
export function loadCvgConfig(environment: NodeJS.ProcessEnv = process.env): CvgConfig {
  const unknown = Object.keys(environment).filter((key) => key.startsWith("CVG_") && !knownEnvironmentKeys.has(key));
  if (unknown.length) throw new ConfigError(`Unknown CVG configuration key(s): ${unknown.join(", ")}`);
  const candidate = {
    ...(environment.NODE_ENV === undefined ? {} : { nodeEnv: environment.NODE_ENV }),
    ...(environment.CVG_HOST === undefined ? {} : { host: environment.CVG_HOST }),
    ...(environment.CVG_TRUST_PROXY === undefined ? {} : { trustProxy: parseEnvironmentValue(environment.CVG_TRUST_PROXY, (value) => booleanFromEnv.parse(value)) }),
    ...(environment.CVG_TRUSTED_PROXY_IPS === undefined ? {} : { trustedProxyIps: environment.CVG_TRUSTED_PROXY_IPS.split(",").map((value) => value.trim()).filter(Boolean) }),
    ...(environment.CVG_API_PORT === undefined ? {} : { apiPort: environment.CVG_API_PORT }),
    ...(environment.CVG_WEB_ORIGIN === undefined ? {} : { webOrigin: environment.CVG_WEB_ORIGIN }),
    ...(environment.CVG_RELEASE_SHA === undefined ? {} : { releaseSha: environment.CVG_RELEASE_SHA }),
    ...(environment.CVG_RELEASE_ARTIFACT_DIGEST === undefined ? {} : { releaseArtifactDigest: environment.CVG_RELEASE_ARTIFACT_DIGEST }),
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
    ...(environment.CVG_DEEPSEEK_EXPECTED_TOOL_NAMES === undefined ? {} : { deepseekExpectedToolNames: environment.CVG_DEEPSEEK_EXPECTED_TOOL_NAMES.split(",").map((value) => value.trim()).filter(Boolean) }),
    ...(environment.CVG_DEEPSEEK_BRIDGE_TIMEOUT_MS === undefined ? {} : { deepseekBridgeTimeoutMs: Number(environment.CVG_DEEPSEEK_BRIDGE_TIMEOUT_MS) }),
    ...(environment.CVG_DEEPSEEK_BRIDGE_HOST === undefined ? {} : { deepseekBridgeHost: environment.CVG_DEEPSEEK_BRIDGE_HOST }),
    ...(environment.CVG_DEEPSEEK_BRIDGE_PORT === undefined ? {} : { deepseekBridgePort: Number(environment.CVG_DEEPSEEK_BRIDGE_PORT) }),
    ...(environment.CVG_DEEPSEEK_ACP_COMMAND === undefined ? {} : { deepseekAcpCommand: environment.CVG_DEEPSEEK_ACP_COMMAND }),
    ...(environment.CVG_DEEPSEEK_ACP_ARGS_JSON === undefined ? {} : { deepseekAcpArgsJson: environment.CVG_DEEPSEEK_ACP_ARGS_JSON }),
    ...(environment.CVG_DEEPSEEK_ACP_ENGINE_ROOT === undefined ? {} : { deepseekAcpEngineRoot: environment.CVG_DEEPSEEK_ACP_ENGINE_ROOT }),
    ...(environment.CVG_DEEPSEEK_ACP_WORKSPACE_ROOT === undefined ? {} : { deepseekAcpWorkspaceRoot: environment.CVG_DEEPSEEK_ACP_WORKSPACE_ROOT }),
    ...(environment.CVG_DEEPSEEK_ACP_MANIFEST_PATH === undefined ? {} : { deepseekAcpManifestPath: environment.CVG_DEEPSEEK_ACP_MANIFEST_PATH }),
    ...(environment.CVG_DEEPSEEK_ACP_DSH_HOME === undefined ? {} : { deepseekAcpDshHome: environment.CVG_DEEPSEEK_ACP_DSH_HOME }),
    ...(environment.CVG_DEEPSEEK_ACP_EXPECTED_AGENT_NAME === undefined ? {} : { deepseekAcpExpectedAgentName: environment.CVG_DEEPSEEK_ACP_EXPECTED_AGENT_NAME }),
    ...(environment.CVG_DEEPSEEK_ACP_EXPECTED_AGENT_VERSION === undefined ? {} : { deepseekAcpExpectedAgentVersion: environment.CVG_DEEPSEEK_ACP_EXPECTED_AGENT_VERSION }),
    ...(environment.CVG_DEEPSEEK_ACP_MODEL === undefined ? {} : { deepseekAcpModel: environment.CVG_DEEPSEEK_ACP_MODEL }),
    ...(environment.CVG_DEEPSEEK_ACP_PERMISSION_MODE === undefined ? {} : { deepseekAcpPermissionMode: environment.CVG_DEEPSEEK_ACP_PERMISSION_MODE }),
    ...(environment.CVG_DEEPSEEK_ACP_STARTUP_TIMEOUT_MS === undefined ? {} : { deepseekAcpStartupTimeoutMs: Number(environment.CVG_DEEPSEEK_ACP_STARTUP_TIMEOUT_MS) }),
    ...(environment.CVG_DEEPSEEK_ACP_SHUTDOWN_TIMEOUT_MS === undefined ? {} : { deepseekAcpShutdownTimeoutMs: Number(environment.CVG_DEEPSEEK_ACP_SHUTDOWN_TIMEOUT_MS) }),
    ...(environment.CVG_DEEPSEEK_BEARER_TOKEN_REF === undefined ? {} : { deepseekBearerTokenRef: environment.CVG_DEEPSEEK_BEARER_TOKEN_REF }),
    ...(environment.CVG_DEEPSEEK_CONTEXT_SIGNING_SECRET_REF === undefined ? {} : { deepseekContextSigningSecretRef: environment.CVG_DEEPSEEK_CONTEXT_SIGNING_SECRET_REF }),
    ...(environment.CVG_RECOVERY_ENCRYPTION_KEY_REF === undefined ? {} : { recoveryEncryptionKeyRef: environment.CVG_RECOVERY_ENCRYPTION_KEY_REF }),
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

const workerEnvironmentKeys = new Set(["NODE_ENV", "DATABASE_URL", "CVG_STORAGE", "CVG_WORKER_ORGANIZATION_ID", "CVG_WORKER_ID", "CVG_WORKER_INTERVAL_MS", "CVG_WORKER_MAX_OUTSTANDING", "CVG_WORKER_SINK_MODE", "CVG_WORKER_HEARTBEAT_FILE", "CVG_BACKUP_ENABLED", "CVG_BACKUP_ORGANIZATION_ID", "CVG_BACKUP_DIRECTORY", "CVG_BACKUP_INTERVAL_MS", "CVG_BACKUP_KEEP_LAST", "CVG_RECOVERY_ENCRYPTION_KEY_REF", "CVG_SECRET_PROVIDER", "CVG_SECRET_DIR", "CVG_MESSAGING_PROVIDER_ENDPOINT", "CVG_MESSAGING_PROVIDER_ALLOWED_HOSTS", "CVG_MESSAGING_CREDENTIAL_REF", "CVG_MESSAGING_SEND_PATH", "CVG_MESSAGING_QUERY_PATH"]);

function validateWorkerConfig(value: unknown): CvgWorkerConfig {
  const parsed = cvgWorkerConfigSchema.safeParse(value);
  if (!parsed.success) throw new WorkerConfigError("Invalid CVG worker configuration.", parsed.error.issues);
  return parsed.data;
}

/** Parses the worker-only environment contract without requiring API settings. */
export function loadWorkerConfig(environment: NodeJS.ProcessEnv = process.env): CvgWorkerConfig {
  const unknown = Object.keys(environment).filter((key) => key.startsWith("CVG_") && !workerEnvironmentKeys.has(key));
  if (unknown.length) throw new WorkerConfigError(`Unknown CVG worker configuration key(s): ${unknown.join(", ")}`);
  const candidate = {
    ...(environment.NODE_ENV === undefined ? {} : { nodeEnv: environment.NODE_ENV }),
    ...(environment.CVG_STORAGE === undefined ? {} : { storageMode: environment.CVG_STORAGE }),
    ...(environment.DATABASE_URL === undefined ? {} : { databaseUrl: environment.DATABASE_URL }),
    ...(environment.CVG_WORKER_ORGANIZATION_ID === undefined ? {} : { workerOrganizationId: environment.CVG_WORKER_ORGANIZATION_ID }),
    ...(environment.CVG_WORKER_ID === undefined ? {} : { workerId: environment.CVG_WORKER_ID }),
    ...(environment.CVG_WORKER_INTERVAL_MS === undefined ? {} : { workerIntervalMs: Number(environment.CVG_WORKER_INTERVAL_MS) }),
    ...(environment.CVG_WORKER_MAX_OUTSTANDING === undefined ? {} : { workerMaxOutstandingOutbox: Number(environment.CVG_WORKER_MAX_OUTSTANDING) }),
    ...(environment.CVG_WORKER_SINK_MODE === undefined ? {} : { workerSinkMode: environment.CVG_WORKER_SINK_MODE }),
    ...(environment.CVG_WORKER_HEARTBEAT_FILE === undefined ? {} : { workerHeartbeatFile: environment.CVG_WORKER_HEARTBEAT_FILE }),
    ...(environment.CVG_BACKUP_ENABLED === undefined ? {} : { backupEnabled: booleanFromEnv.parse(environment.CVG_BACKUP_ENABLED) }),
    ...(optionalEnvironmentValue(environment.CVG_BACKUP_ORGANIZATION_ID) === undefined ? {} : { backupOrganizationId: optionalEnvironmentValue(environment.CVG_BACKUP_ORGANIZATION_ID) }),
    ...(optionalEnvironmentValue(environment.CVG_BACKUP_DIRECTORY) === undefined ? {} : { backupDirectory: optionalEnvironmentValue(environment.CVG_BACKUP_DIRECTORY) }),
    ...(environment.CVG_BACKUP_INTERVAL_MS === undefined ? {} : { backupIntervalMs: Number(environment.CVG_BACKUP_INTERVAL_MS) }),
    ...(environment.CVG_BACKUP_KEEP_LAST === undefined ? {} : { backupKeepLast: Number(environment.CVG_BACKUP_KEEP_LAST) }),
    ...(optionalEnvironmentValue(environment.CVG_RECOVERY_ENCRYPTION_KEY_REF) === undefined ? {} : { recoveryEncryptionKeyRef: optionalEnvironmentValue(environment.CVG_RECOVERY_ENCRYPTION_KEY_REF) }),
    ...(environment.CVG_SECRET_PROVIDER === undefined ? {} : { secretProvider: environment.CVG_SECRET_PROVIDER }),
    ...(environment.CVG_SECRET_DIR === undefined ? {} : { secretDir: environment.CVG_SECRET_DIR }),
    ...(optionalEnvironmentValue(environment.CVG_MESSAGING_PROVIDER_ENDPOINT) === undefined ? {} : { messagingProviderEndpoint: optionalEnvironmentValue(environment.CVG_MESSAGING_PROVIDER_ENDPOINT) }),
    ...(environment.CVG_MESSAGING_PROVIDER_ALLOWED_HOSTS === undefined ? {} : { messagingProviderAllowedHosts: environment.CVG_MESSAGING_PROVIDER_ALLOWED_HOSTS.split(",").map((value) => value.trim()).filter(Boolean) }),
    ...(optionalEnvironmentValue(environment.CVG_MESSAGING_CREDENTIAL_REF) === undefined ? {} : { messagingCredentialRef: optionalEnvironmentValue(environment.CVG_MESSAGING_CREDENTIAL_REF) }),
    ...(environment.CVG_MESSAGING_SEND_PATH === undefined ? {} : { messagingSendPath: environment.CVG_MESSAGING_SEND_PATH }),
    ...(optionalEnvironmentValue(environment.CVG_MESSAGING_QUERY_PATH) === undefined ? {} : { messagingQueryPath: optionalEnvironmentValue(environment.CVG_MESSAGING_QUERY_PATH) })
  };
  return validateWorkerConfig(candidate);
}
