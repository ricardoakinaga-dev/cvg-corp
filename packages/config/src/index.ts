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
  apiPort: z.coerce.number().int().min(1).max(65_535).default(4310),
  webOrigin: z.string().url().default("http://127.0.0.1:5173"),
  storageMode: z.enum(["memory", "postgres"]).default("memory"),
  demoMode: z.boolean().default(true),
  sessionTtlMinutes: z.number().int().min(5).max(1_440).default(480),
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
  workerSinkMode: z.literal("quarantine").default("quarantine"),
  workerHeartbeatFile: z.string().trim().min(1).max(1_024).default("/tmp/cvg-worker/heartbeat"),
  secretProvider: z.enum(["none", "env", "file", "vault", "aws", "gcp", "azure", "kubernetes"]).default("none")
}).strict().superRefine((value, ctx) => {
  if (value.nodeEnv === "production" && !value.webOrigin.startsWith("https://")) ctx.addIssue({ code: "custom", path: ["webOrigin"], message: "production webOrigin must use HTTPS" });
  if (value.nodeEnv === "production" && value.demoMode) ctx.addIssue({ code: "custom", path: ["demoMode"], message: "demoMode is forbidden in production" });
  if (value.nodeEnv === "production" && value.storageMode !== "postgres") ctx.addIssue({ code: "custom", path: ["storageMode"], message: "production requires PostgreSQL durable storage" });
  if (value.nodeEnv === "production" && value.secretProvider === "none") ctx.addIssue({ code: "custom", path: ["secretProvider"], message: "production requires an explicit secret provider" });
  if (value.nodeEnv === "production" && !value.deepseekRuntimeEnabled) ctx.addIssue({ code: "custom", path: ["deepseekRuntimeEnabled"], message: "production cannot use the local mock runtime" });
  if (value.nodeEnv === "production" && value.deepseekBaseUrl && !value.deepseekBaseUrl.startsWith("https://")) ctx.addIssue({ code: "custom", path: ["deepseekBaseUrl"], message: "production DeepSeek bridge must use HTTPS" });
  if (value.deepseekRuntimeEnabled && !value.deepseekBaseUrl) ctx.addIssue({ code: "custom", path: ["deepseekBaseUrl"], message: "DeepSeek runtime requires an explicit base URL" });
  if (value.deepseekRuntimeEnabled && !value.deepseekExpectedEngineCommit) ctx.addIssue({ code: "custom", path: ["deepseekExpectedEngineCommit"], message: "DeepSeek runtime requires an approved engine commit" });
  if (value.deepseekRuntimeEnabled && !value.deepseekExpectedManifestVersion) ctx.addIssue({ code: "custom", path: ["deepseekExpectedManifestVersion"], message: "DeepSeek runtime requires an approved manifest version" });
  if (value.deepseekRuntimeEnabled && value.nodeEnv === "production" && !value.deepseekBearerTokenRef) ctx.addIssue({ code: "custom", path: ["deepseekBearerTokenRef"], message: "production DeepSeek runtime requires an explicit bearer token reference" });
  if (value.storageMode === "postgres" && !value.databaseUrl) ctx.addIssue({ code: "custom", path: ["databaseUrl"], message: "PostgreSQL storage requires DATABASE_URL" });
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

const knownEnvironmentKeys = new Set(["NODE_ENV", "SESSION_TTL_MINUTES", "DATABASE_URL", "CVG_HOST", "CVG_API_PORT", "CVG_WEB_ORIGIN", "CVG_STORAGE", "CVG_DEMO_MODE", "CVG_BOOTSTRAP_PASSWORD", "CVG_DEEPSEEK_BASE_URL", "CVG_DEEPSEEK_RUNTIME_ENABLED", "CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT", "CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION", "CVG_DEEPSEEK_BEARER_TOKEN_REF", "CVG_SECRET_DIR", "CVG_WORKER_ORGANIZATION_ID", "CVG_WORKER_ID", "CVG_WORKER_INTERVAL_MS", "CVG_WORKER_SINK_MODE", "CVG_WORKER_HEARTBEAT_FILE", "CVG_SECRET_PROVIDER"]);

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
    ...(environment.CVG_API_PORT === undefined ? {} : { apiPort: environment.CVG_API_PORT }),
    ...(environment.CVG_WEB_ORIGIN === undefined ? {} : { webOrigin: environment.CVG_WEB_ORIGIN }),
    ...(environment.CVG_STORAGE === undefined ? {} : { storageMode: environment.CVG_STORAGE }),
    ...(environment.CVG_DEMO_MODE === undefined ? {} : { demoMode: parseEnvironmentValue(environment.CVG_DEMO_MODE, (value) => booleanFromEnv.parse(value)) }),
    ...(environment.SESSION_TTL_MINUTES === undefined ? {} : { sessionTtlMinutes: Number(environment.SESSION_TTL_MINUTES) }),
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
    ...(environment.CVG_WORKER_SINK_MODE === undefined ? {} : { workerSinkMode: environment.CVG_WORKER_SINK_MODE }),
    ...(environment.CVG_WORKER_HEARTBEAT_FILE === undefined ? {} : { workerHeartbeatFile: environment.CVG_WORKER_HEARTBEAT_FILE }),
    ...(environment.CVG_SECRET_PROVIDER === undefined ? {} : { secretProvider: environment.CVG_SECRET_PROVIDER })
  };
  return validateCvgConfig(candidate);
}
