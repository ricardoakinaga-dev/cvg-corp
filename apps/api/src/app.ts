import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { Pool } from "pg";
import { z } from "zod";
import { generateOpaqueToken, passwordPolicyIssues, verifyTotpCode, type MfaSecretResolver } from "@cvg/auth";
import { loadCvgConfig, validateCvgConfig, ConfigError } from "@cvg/config";
import { assertPolicyAllowed, authorizeApplicationRequest, applicationPolicyFor, PolicyEvaluationError } from "@cvg/agent-policy";
import {
  API_VERSION,
  API_ROUTE_CATALOG,
  apiCatalogFingerprint,
  API_V2_COMPATIBILITY,
  administrationInputSchema,
  aiTurnInputSchema,
  appointmentInputSchema,
  chargeInputSchema,
  clinicalDocumentInputSchema,
  communicationApprovalInputSchema,
  contextSelectorSchema,
  dispensationInputSchema,
  diagnosticRequestInputSchema,
  failure,
  governedExportInputSchema,
  hospitalEpisodeInputSchema,
  id,
  idSchema,
  integrationInboxEventSchema,
  isApiError,
  knowledgeDocumentInputSchema,
  loginInputSchema,
  mfaEnrollmentInputSchema,
  mfaFactorRevokeInputSchema,
  mfaVerificationInputSchema,
  medicationOrderInputSchema,
  patientInputSchema,
  patientMergeInputSchema,
  paymentInputSchema,
  passwordRotationInputSchema,
  recoveryCompleteInputSchema,
  recoveryStartInputSchema,
  refundInputSchema,
  resultInputSchema,
  roleAssignmentInputSchema,
  specimenInputSchema,
  stockMovementInputSchema,
  success,
  type ApprovalInput,
  type ApiResponse,
  type CvgContext,
  type DataClass,
  type ErrorCode,
  type OpaqueId,
  type Role
} from "@cvg/contracts";
import {
  CvgStore,
  DomainError,
  digest,
  hashPassword,
  idempotent,
  isInContext,
  now,
  publicUser,
  parseSnapshot,
  serializeSnapshot,
  verifyPassword,
  type PublicUser,
  type StoreSnapshot
} from "@cvg/domain";
import { GovernedHarness, TOOL_REGISTRY } from "@cvg/harness";
import type { AgentRuntime } from "@cvg/agent-runtime";
import { DeepSeekHarnessAdapter, MockHarnessAdapter } from "@cvg/harness-adapters";
import { AgentRuntimeUnavailableError } from "@cvg/agent-runtime";
import { configuredSecretProvider, IntegrationGateway, inboxEventToOutbox, integrationContracts, isSecretReferenceUsable, OutboxWorker, reconcileUnknownExternalEffect, verifyMessagingCallback, type ExternalEffectQueryAdapter, type OutboxSink, type OutboxWorkerResult, type SecretProvider, type SecretProviderStatus } from "@cvg/integrations";
import { createOpenTelemetryRuntime, OpsTelemetry, renderPrometheusMetrics, type OpenTelemetryRuntime } from "@cvg/ops";
import { PersistenceConflictError, PersistenceCorruptionError, PersistenceSignatureError, PersistenceStateError, PersistenceUnavailableError, PostgresPersistence, type DurableExternalEffectRecord, type InboxSignatureVerifier } from "@cvg/persistence";
import { registerHealthRoutes } from "./routes/health.ts";
import { AgentApplicationService } from "./application/agent-service.ts";
import { PatientApplicationService, PostgresPatientRepository, StorePatientRepository } from "./application/patient-service.ts";
import { createReadApplicationService } from "./application/read-services.ts";
import { DomainCommandService } from "./application/domain-command-service.ts";
import { ExportApplicationService, governedExportDigest } from "./application/export-service.ts";

const SESSION_COOKIE = "cvg_session";
const CSRF_COOKIE = "cvg_csrf";
const DEFAULT_PORT = 4310;

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/[\[\]]/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized.startsWith("127.");
}

export interface ServerConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  trustProxy: boolean;
  port: number;
  webOrigin: string;
  storageMode: "memory" | "postgres";
  demoMode: boolean;
  sessionTtlMinutes: number;
  authMfaMode: "disabled" | "optional" | "required";
  passwordMinLength: number;
  passwordMaxAgeDays: number;
  authMaxFailedAttempts: number;
  authLockoutMinutes: number;
  authChallengeTtlSeconds: number;
  authMaxChallengeAttempts: number;
  databaseUrl: string;
  bootstrapPassword: string | null;
  deepseekBaseUrl: string | null;
  deepseekRuntimeEnabled: boolean;
  deepseekExpectedEngineCommit: string | null;
  deepseekExpectedManifestVersion: string | null;
  deepseekBearerTokenRef: string | null;
  deepseekContextSigningSecretRef: string | null;
  recoveryEncryptionKeyRef: string | null;
  secretDir: string;
  workerOrganizationId: string | null;
  secretProvider: "none" | "env" | "file" | "docker" | "vault" | "aws" | "gcp" | "azure" | "kubernetes";
  rateLimitBackend: "local" | "distributed";
  rateLimitRequestsPerWindow: number;
  rateLimitWindowSeconds: number;
}

export interface RateLimiter {
  readonly distributed: boolean;
  consume(input: { key: string; limit: number; windowMs: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  close?(): Promise<void>;
}

/** Bounded fallback for local/test use; production must inject a shared implementation. */
export class MemoryRateLimiter implements RateLimiter {
  readonly distributed = false;
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly maxKeys = 10_000) {}

  async consume(input: { key: string; limit: number; windowMs: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const nowMs = Date.now();
    const current = this.buckets.get(input.key);
    if (!current || current.resetAt <= nowMs) {
      if (this.buckets.size >= this.maxKeys) {
        const oldest = [...this.buckets.entries()].sort((left, right) => left[1].resetAt - right[1].resetAt)[0]?.[0];
        if (oldest) this.buckets.delete(oldest);
      }
      this.buckets.set(input.key, { count: 1, resetAt: nowMs + input.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (current.count >= input.limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - nowMs) / 1_000)) };
    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  async close(): Promise<void> {
    this.buckets.clear();
  }
}

/**
 * Atomic PostgreSQL fixed-window limiter. The bucket key is hashed before it
 * reaches the database so addresses and session identifiers never become
 * durable rate-limit metadata. The table is provisioned by migrations 023+.
 */
export class PostgresRateLimiter implements RateLimiter {
  readonly distributed = true;
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 2_500, idleTimeoutMillis: 30_000, application_name: "cvg-corp-rate-limit" });
  }

  async consume(input: { key: string; limit: number; windowMs: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || !Number.isSafeInteger(input.windowMs) || input.windowMs < 1) throw new DomainError("INVALID_INPUT", "Os parâmetros de rate limit são inválidos.", 400);
    try {
      const result = await this.pool.query<{ request_count: number; retry_after_ms: number }>(
        `insert into cvg_rate_limit_buckets(bucket_key, window_started_at, request_count, updated_at)
         values ($1, now(), 1, now())
         on conflict (bucket_key) do update set
           request_count = case
             when cvg_rate_limit_buckets.window_started_at <= now() - ($3::double precision * interval '1 millisecond') then 1
             else cvg_rate_limit_buckets.request_count + 1
           end,
           window_started_at = case
             when cvg_rate_limit_buckets.window_started_at <= now() - ($3::double precision * interval '1 millisecond') then now()
             else cvg_rate_limit_buckets.window_started_at
           end,
           updated_at = now()
         returning request_count, greatest(0, extract(epoch from ((window_started_at + ($3::double precision * interval '1 millisecond')) - now())) * 1000)::double precision as retry_after_ms`,
        [tokenDigest(input.key), input.limit, input.windowMs]
      );
      const row = result.rows[0];
      if (!row) throw new Error("rate-limit bucket write returned no row");
      const retryAfterSeconds = Math.max(1, Math.ceil(Number(row.retry_after_ms ?? input.windowMs) / 1_000));
      return { allowed: Number(row.request_count) <= input.limit, retryAfterSeconds: Number(row.request_count) <= input.limit ? 0 : retryAfterSeconds };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("DEPENDENCY_UNAVAILABLE", "O rate limit distribuído está indisponível; a solicitação foi bloqueada.", 503, { cause: error instanceof Error ? error.name : "unknown" });
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export interface ServerOptions {
  store?: CvgStore;
  harness?: GovernedHarness;
  agentRuntime?: AgentRuntime;
  telemetry?: OpsTelemetry;
  config?: Partial<ServerConfig>;
  persistence?: PostgresPersistence;
  inboxSignatureVerifier?: InboxSignatureVerifier;
  outboxSink?: OutboxSink;
  providerQueryAdapter?: ExternalEffectQueryAdapter;
  secretProvider?: SecretProvider;
  mfaSecretResolver?: MfaSecretResolver;
  rateLimiter?: RateLimiter;
}

export interface CvgServerRuntime {
  app: FastifyInstance;
  store: CvgStore;
  agentRuntime: AgentRuntime;
  telemetry: OpsTelemetry;
  integrations: IntegrationGateway;
  persistence: PostgresPersistence | null;
  config: ServerConfig;
  runOutboxOnce: (organizationId: OpaqueId, workerId: string, sink?: OutboxSink, options?: { limit?: number; leaseSeconds?: number; maxAttempts?: number }) => Promise<OutboxWorkerResult>;
  reconcileExternalEffect: (organizationId: OpaqueId, effectId: OpaqueId, adapter?: ExternalEffectQueryAdapter, options?: { timeoutMs?: number }) => Promise<DurableExternalEffectRecord>;
}

function getConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  let typed: ReturnType<typeof loadCvgConfig>;
  try {
    typed = loadCvgConfig();
  } catch (error) {
    if (error instanceof ConfigError) throw new DomainError("CAPABILITY_DISABLED", "A configuração do CVG é inválida; o processo não pode iniciar com defaults inseguros.", 503);
    throw error;
  }
  const validated = validateCvgConfig({
    nodeEnv: overrides.nodeEnv ?? typed.nodeEnv,
    host: overrides.host ?? typed.host,
    trustProxy: overrides.trustProxy ?? typed.trustProxy,
    apiPort: (overrides.port ?? typed.apiPort) || DEFAULT_PORT,
    webOrigin: overrides.webOrigin ?? typed.webOrigin,
    storageMode: overrides.storageMode ?? typed.storageMode,
    demoMode: overrides.demoMode ?? typed.demoMode,
    sessionTtlMinutes: overrides.sessionTtlMinutes ?? typed.sessionTtlMinutes,
    authMfaMode: overrides.authMfaMode ?? typed.authMfaMode,
    passwordMinLength: overrides.passwordMinLength ?? typed.passwordMinLength,
    passwordMaxAgeDays: overrides.passwordMaxAgeDays ?? typed.passwordMaxAgeDays,
    authMaxFailedAttempts: overrides.authMaxFailedAttempts ?? typed.authMaxFailedAttempts,
    authLockoutMinutes: overrides.authLockoutMinutes ?? typed.authLockoutMinutes,
    authChallengeTtlSeconds: overrides.authChallengeTtlSeconds ?? typed.authChallengeTtlSeconds,
    authMaxChallengeAttempts: overrides.authMaxChallengeAttempts ?? typed.authMaxChallengeAttempts,
    databaseUrl: overrides.databaseUrl ?? typed.databaseUrl,
    bootstrapPassword: overrides.bootstrapPassword ?? typed.bootstrapPassword,
    deepseekBaseUrl: overrides.deepseekBaseUrl ?? typed.deepseekBaseUrl,
    deepseekRuntimeEnabled: overrides.deepseekRuntimeEnabled ?? typed.deepseekRuntimeEnabled,
    deepseekExpectedEngineCommit: overrides.deepseekExpectedEngineCommit ?? typed.deepseekExpectedEngineCommit,
    deepseekExpectedManifestVersion: overrides.deepseekExpectedManifestVersion ?? typed.deepseekExpectedManifestVersion,
    deepseekBearerTokenRef: overrides.deepseekBearerTokenRef ?? typed.deepseekBearerTokenRef,
    deepseekContextSigningSecretRef: overrides.deepseekContextSigningSecretRef ?? typed.deepseekContextSigningSecretRef,
    recoveryEncryptionKeyRef: overrides.recoveryEncryptionKeyRef ?? typed.recoveryEncryptionKeyRef,
    secretDir: overrides.secretDir ?? typed.secretDir,
    workerOrganizationId: overrides.workerOrganizationId ?? typed.workerOrganizationId,
    secretProvider: overrides.secretProvider ?? typed.secretProvider,
    rateLimitBackend: overrides.rateLimitBackend ?? typed.rateLimitBackend,
    rateLimitRequestsPerWindow: overrides.rateLimitRequestsPerWindow ?? typed.rateLimitRequestsPerWindow,
    rateLimitWindowSeconds: overrides.rateLimitWindowSeconds ?? typed.rateLimitWindowSeconds
  });
  return { nodeEnv: validated.nodeEnv, host: validated.host, trustProxy: validated.trustProxy, port: validated.apiPort, webOrigin: validated.webOrigin, storageMode: validated.storageMode, demoMode: validated.demoMode, sessionTtlMinutes: validated.sessionTtlMinutes, authMfaMode: validated.authMfaMode, passwordMinLength: validated.passwordMinLength, passwordMaxAgeDays: validated.passwordMaxAgeDays, authMaxFailedAttempts: validated.authMaxFailedAttempts, authLockoutMinutes: validated.authLockoutMinutes, authChallengeTtlSeconds: validated.authChallengeTtlSeconds, authMaxChallengeAttempts: validated.authMaxChallengeAttempts, databaseUrl: validated.databaseUrl, bootstrapPassword: validated.bootstrapPassword, deepseekBaseUrl: validated.deepseekBaseUrl, deepseekRuntimeEnabled: validated.deepseekRuntimeEnabled, deepseekExpectedEngineCommit: validated.deepseekExpectedEngineCommit, deepseekExpectedManifestVersion: validated.deepseekExpectedManifestVersion, deepseekBearerTokenRef: validated.deepseekBearerTokenRef, deepseekContextSigningSecretRef: validated.deepseekContextSigningSecretRef, recoveryEncryptionKeyRef: validated.recoveryEncryptionKeyRef, secretDir: validated.secretDir, workerOrganizationId: validated.workerOrganizationId, secretProvider: validated.secretProvider, rateLimitBackend: validated.rateLimitBackend, rateLimitRequestsPerWindow: validated.rateLimitRequestsPerWindow, rateLimitWindowSeconds: validated.rateLimitWindowSeconds };
}

function tokenDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function persistenceDiagnostic(error: unknown): Record<string, string | null> {
  const cause = error instanceof PersistenceUnavailableError ? error.cause : error;
  const record = cause && typeof cause === "object" ? cause as { code?: unknown; constraint?: unknown; table?: unknown } : {};
  return {
    errorName: error instanceof Error ? error.name : "UnknownError",
    databaseCode: typeof record.code === "string" ? record.code : null,
    constraint: typeof record.constraint === "string" ? record.constraint : null,
    table: typeof record.table === "string" ? record.table : null
  };
}

function correlationId(request: FastifyRequest): string {
  const supplied = request.headers["x-correlation-id"];
  if (typeof supplied === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(supplied)) return supplied;
  return randomUUID();
}

function header(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];
  return typeof value === "string" ? value : null;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DomainError("INVALID_INPUT", "A entrada não atende ao contrato desta operação.", 400, { issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) });
  return parsed.data;
}

function safeId(value: string | null): OpaqueId | null {
  if (!value) return null;
  return id(parse(idSchema, value));
}

function requireIdempotencyKey(request: FastifyRequest): string {
  const key = header(request, "idempotency-key");
  if (!key || !/^[A-Za-z0-9._:-]{1,160}$/.test(key)) throw new DomainError("INVALID_INPUT", "Idempotency-Key é obrigatório e deve ser estável.", 400);
  return key;
}

function response<T>(reply: FastifyReply, payload: ApiResponse<T>, statusCode = 200): FastifyReply {
  return reply.code(statusCode).send(payload);
}

function publicContext(context: CvgContext, store: CvgStore): Record<string, unknown> {
  const unit = context.unitId ? store.units.get(context.unitId) : null;
  const workspace = context.workspaceId ? store.workspaces.get(context.workspaceId) : null;
  return { organizationId: context.organizationId, organizationName: store.organizations.get(context.organizationId)?.name ?? "", unit: unit ? { id: unit.id, name: unit.name, code: unit.code } : null, workspace: workspace ? { id: workspace.id, name: workspace.name, purpose: workspace.purpose } : null, roles: context.actorRoleSnapshot, purpose: context.purpose, policyRevision: context.policyRevision, correlationId: context.correlationId };
}

function publicPatientRecord(patient: StoreSnapshot["patients"][number], guardian: Pick<StoreSnapshot["guardians"][number], "id" | "displayName" | "phone"> | null, roles: Role[]): Record<string, unknown> {
  if (!guardian) throw new DomainError("NOT_FOUND", "Recurso não encontrado.", 404);
  const minimum = { id: patient.id, name: patient.name, species: patient.species, breed: patient.breed, status: patient.status, guardian: { id: guardian.id, displayName: guardian.displayName, phone: guardian.phone } };
  if (!roles.includes("veterinario")) return minimum;
  return { ...minimum, sex: patient.sex, reproductiveStatus: patient.reproductiveStatus, birthDate: patient.birthDate, identifiers: [...patient.identifiers] };
}

function publicPatient(store: CvgStore, patientId: OpaqueId, roles: Role[]): Record<string, unknown> {
  const patient = store.patients.get(patientId);
  const guardian = patient ? store.guardians.get(patient.guardianId) : null;
  if (!patient || !guardian) throw new DomainError("NOT_FOUND", "Recurso não encontrado.", 404);
  return publicPatientRecord(patient, guardian, roles);
}

function publicGuardian(guardian: { id: OpaqueId; displayName: string; phone: string; email: string | null; status: string }): Record<string, unknown> {
  return { id: guardian.id, displayName: guardian.displayName, phone: guardian.phone, email: guardian.email, status: guardian.status };
}

const commandOperationByAuditAction: Record<string, string> = {
  "identity.mfa.enroll": "identity.mfa.enroll",
  "identity.mfa.revoke": "identity.mfa.revoke",
  "role.grant": "role.grant",
  "role.revoke": "role.revoke",
  "guardians.create": "guardians.create",
  "patients.create": "patients.create",
  "patients.disable": "patients.disable",
  "patients.merge": "patients.merge",
  "appointments.create": "appointments.create",
  "queue.check-in": "queue.check-in",
  "encounters.create": "encounters.create",
  "clinical.write": "clinical.write",
  "clinical.sign": "clinical.sign",
  "clinical.addendum": "clinical.addendum",
  "diagnostics.create": "diagnostics.create",
  "diagnostics.specimen": "diagnostics.specimen",
  "diagnostics.result": "diagnostics.result",
  "stock.write": "stock.movement",
  "hospitalization.create": "hospitalization.create",
  "medication.prescribe": "medication.prescribe",
  "medication.dispense": "medication.dispense",
  "medication.administer": "medication.administer",
  "finance.charge": "finance.charge",
  "finance.payment": "finance.payment",
  "finance.refund": "finance.refund",
  "communication.stage": "communication.stage",
  "communication.approve": "communication.approve",
  "knowledge.write": "knowledge.write",
  "ai.turn": "ai.turn",
  "ai.approval": "ai.approval",
  "ai.approval.retry": "ai.approval.retry",
  "ai.draft.promote": "ai.draft.promote",
  "ops.export": "ops.export"
};

export async function createRuntime(options: ServerOptions = {}): Promise<CvgServerRuntime> {
  const config = getConfig(options.config);
  const ownsRateLimiter = !options.rateLimiter && config.nodeEnv === "production" && config.rateLimitBackend === "distributed";
  const rateLimiter = options.rateLimiter ?? (ownsRateLimiter ? new PostgresRateLimiter(config.databaseUrl) : new MemoryRateLimiter());
  if (config.nodeEnv === "production" && (config.rateLimitBackend !== "distributed" || !rateLimiter.distributed)) {
    await rateLimiter.close?.();
    throw new DomainError("CAPABILITY_DISABLED", "Produção exige um rate limiter distribuído; nenhum limite local pode ser promovido.", 503);
  }
  if (config.demoMode && config.storageMode === "memory" && !isLoopbackHost(config.host)) {
    throw new DomainError("CAPABILITY_DISABLED", "A demonstração sintética só pode ser exposta em loopback.", 503);
  }
  const secretProvider = options.secretProvider ?? configuredSecretProvider(config.secretProvider, process.env, config.secretDir);
  if (config.nodeEnv === "production" && (!secretProvider || secretProvider.status() !== "READY")) {
    if (ownsRateLimiter) await rateLimiter.close?.();
    throw new DomainError("CAPABILITY_DISABLED", "Produção exige uma autoridade de segredos pronta; o runtime foi mantido bloqueado.", 503);
  }
  const inboxSignatureVerifier: InboxSignatureVerifier | undefined = options.inboxSignatureVerifier ?? (secretProvider?.resolve ? async (input) => {
    if (!input.rawBody) return false;
    const secret = await secretProvider.resolve!(input.signatureKeyRef);
    return Boolean(secret && verifyMessagingCallback(input.rawBody, input.signature, secret));
  } : undefined);
  const persistence = config.storageMode === "postgres" ? options.persistence ?? new PostgresPersistence({ connectionString: config.databaseUrl, ...(inboxSignatureVerifier ? { inboxSignatureVerifier } : {}) }) : null;
  let store: CvgStore;
  try {
    if (options.store) store = options.store;
    else if (config.bootstrapPassword) store = new CvgStore({ bootstrapPassword: config.bootstrapPassword });
    else store = new CvgStore();
    if (persistence) {
      await persistence.check();
      await persistence.assertSchema();
      const latest = await persistence.loadLatest(store.bootstrapCredentials.organizationId);
      if (latest) store.hydrate(latest.snapshot);
      else {
        if (!config.bootstrapPassword && !options.store) throw new PersistenceUnavailableError("CVG_BOOTSTRAP_PASSWORD is required to initialize an empty PostgreSQL state");
        const organizationId = store.bootstrapCredentials.organizationId;
        const bootstrapSnapshot = store.snapshot();
        await persistence.commit({ expectedRevision: null, snapshot: bootstrapSnapshot, eventType: "BOOTSTRAP", operation: "system.bootstrap", organizationId, actorId: null, correlationId: randomUUID(), aggregateType: "Organization", aggregateId: organizationId, payload: { synthetic: config.demoMode, source: "server-bootstrap" }, auditRecords: bootstrapSnapshot.auditRecords, commandReceipts: bootstrapSnapshot.commandReceipts });
      }
    }
  } catch (error) {
    await persistence?.close();
    if (ownsRateLimiter) await rateLimiter.close?.();
    if (error instanceof DomainError) throw error;
    if (error instanceof PersistenceCorruptionError) throw new DomainError("QUARANTINED", "O estado persistido falhou na validação e foi mantido bloqueado.", 503);
    throw new DomainError("CAPABILITY_DISABLED", `A persistência PostgreSQL não está pronta: ${error instanceof Error ? error.message : String(error)}`, 503);
  }
  store.storageMode = config.storageMode;
  let otelRuntime: OpenTelemetryRuntime | null = null;
  const closeBeforeRuntimeFailure = async (message: string): Promise<never> => {
    await persistence?.close();
    if (ownsRateLimiter) await rateLimiter.close?.();
    await otelRuntime?.shutdown();
    throw new DomainError("CAPABILITY_DISABLED", message, 503);
  };
  const mfaSecretResolver: MfaSecretResolver | null = options.mfaSecretResolver ?? (secretProvider?.resolve ? { resolve: (reference: string) => secretProvider.resolve!(reference) } : null);
  const mfaUsers = [...store.users.values()].filter((user) => config.authMfaMode === "required" || user.security.mfaRequired);
  const resolveMfaReference = async (reference: string | null): Promise<boolean> => {
    if (!mfaSecretResolver || !reference || !/^[A-Za-z0-9._:-]{1,160}$/.test(reference)) return false;
    try {
      const value = await mfaSecretResolver.resolve(reference);
      return typeof value === "string" && value.trim().length > 0;
    } catch {
      return false;
    }
  };
  const authMfaStatus: "READY" | "UNAVAILABLE" | "NOT_REQUIRED" = mfaUsers.length === 0
    ? "NOT_REQUIRED"
    : mfaSecretResolver && (await Promise.all(mfaUsers.map((user) => resolveMfaReference(user.security.mfaSecretRef)))).every(Boolean)
      ? "READY"
      : "UNAVAILABLE";
  if (config.authMfaMode === "required" && !mfaSecretResolver) await closeBeforeRuntimeFailure("MFA é obrigatório, mas nenhum resolver de segredo foi configurado.");
  if (config.nodeEnv === "production" && authMfaStatus !== "READY") await closeBeforeRuntimeFailure("Produção exige uma referência de MFA resolvível para cada usuário ativo; o runtime foi mantido bloqueado.");
  const deepseekBearerTokenStatus: "READY" | "UNAVAILABLE" | "NOT_REQUIRED" = !config.deepseekRuntimeEnabled || !config.deepseekBearerTokenRef
    ? "NOT_REQUIRED"
    : await isSecretReferenceUsable(secretProvider, config.deepseekBearerTokenRef) ? "READY" : "UNAVAILABLE";
  if (config.nodeEnv === "production" && config.deepseekRuntimeEnabled && deepseekBearerTokenStatus !== "READY") await closeBeforeRuntimeFailure("Produção exige que a referência do bearer token DeepSeek seja resolvível; o runtime foi mantido bloqueado.");
  const deepseekContextSignatureStatus: "READY" | "UNAVAILABLE" | "NOT_REQUIRED" = !config.deepseekRuntimeEnabled || !config.deepseekContextSigningSecretRef
    ? "NOT_REQUIRED"
    : await isSecretReferenceUsable(secretProvider, config.deepseekContextSigningSecretRef) ? "READY" : "UNAVAILABLE";
  if (config.nodeEnv === "production" && config.deepseekRuntimeEnabled && deepseekContextSignatureStatus !== "READY") await closeBeforeRuntimeFailure("Produção exige que a referência de assinatura de contexto DeepSeek seja resolvível; o runtime foi mantido bloqueado.");
  const harness = options.harness ?? new GovernedHarness(store);
  const agentRuntime = options.agentRuntime ?? (() => {
    if (!config.deepseekRuntimeEnabled) return new MockHarnessAdapter(harness);
    if (!config.deepseekBaseUrl || !config.deepseekExpectedEngineCommit || !config.deepseekExpectedManifestVersion) throw new DomainError("CAPABILITY_DISABLED", "O runtime DeepSeek exige URL, commit e manifest aprovados.", 503);
    const bearerTokenRef = config.deepseekBearerTokenRef;
    const contextSigningSecretRef = config.deepseekContextSigningSecretRef;
    return new DeepSeekHarnessAdapter({ baseUrl: config.deepseekBaseUrl, expectedEngineCommit: config.deepseekExpectedEngineCommit, expectedManifestVersion: config.deepseekExpectedManifestVersion, expectedToolNames: TOOL_REGISTRY.map((tool) => tool.name), requestTimeoutMs: 5_000, allowInsecureHttp: config.nodeEnv !== "production", ...(bearerTokenRef ? { resolveBearerToken: () => secretProvider?.resolve?.(bearerTokenRef) ?? Promise.resolve(null) } : {}), ...(contextSigningSecretRef ? { resolveContextSigningSecret: () => secretProvider?.resolve?.(contextSigningSecretRef) ?? Promise.resolve(null) } : {}) });
  })();
  try {
    otelRuntime = createOpenTelemetryRuntime({ serviceName: "cvg-api", requireTls: config.nodeEnv === "production" });
  } catch {
    await closeBeforeRuntimeFailure("A configuração OpenTelemetry/OTLP é inválida; nenhum runtime foi iniciado.");
  }
  if (!otelRuntime) await closeBeforeRuntimeFailure("O runtime OpenTelemetry não pôde ser inicializado; nenhum serviço foi iniciado.");
  const activeOtelRuntime = otelRuntime as OpenTelemetryRuntime;
  if (config.nodeEnv === "production" && activeOtelRuntime.status !== "READY") await closeBeforeRuntimeFailure("Produção exige exportação OTLP OpenTelemetry pronta; o runtime foi mantido bloqueado.");
  if (config.nodeEnv === "production" && options.telemetry) await closeBeforeRuntimeFailure("Produção não aceita telemetry injetada fora do exportador OTLP aprovado.");
  const telemetry = options.telemetry ?? new OpsTelemetry({
    ...(activeOtelRuntime.exporter ? { exporter: activeOtelRuntime.exporter } : {}),
    telemetryMode: activeOtelRuntime.status === "READY" ? "OTEL_OTLP_REDACTED" : "REDACTED_BEST_EFFORT"
  });
  const integrations = new IntegrationGateway(secretProvider);
  const secretProviderStatus: SecretProviderStatus = secretProvider?.status() ?? (config.demoMode ? "DEGRADED" : "UNAVAILABLE");
  const agentApplication = new AgentApplicationService(store, agentRuntime);
  const patientApplication = new PatientApplicationService(persistence ? new PostgresPatientRepository(persistence, store) : new StorePatientRepository(store));
  const readApplication = createReadApplicationService(store, persistence);
  const domainCommands = new DomainCommandService(store);
  const exportApplication = new ExportApplicationService(store, persistence, secretProvider, config.recoveryEncryptionKeyRef);
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024, requestIdHeader: "x-request-id", trustProxy: config.trustProxy });
  app.addHook("onClose", async () => { await agentRuntime.shutdown(); });
  app.addHook("onClose", async () => { await otelRuntime?.shutdown(); });
  if (ownsRateLimiter) app.addHook("onClose", async () => { await rateLimiter.close?.(); });

  const rawRequestBodies = new WeakMap<object, string>();
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const rawBody = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
    rawRequestBodies.set(request, rawBody);
    try {
      done(null, JSON.parse(rawBody) as unknown);
    } catch (error) {
      done(error instanceof Error ? error : new Error("invalid JSON body"));
    }
  });

  const durableRequests = new WeakMap<FastifyRequest, { baseline: StoreSnapshot; revision: bigint }>();
  const durableReleases = new WeakMap<FastifyRequest, () => void>();
  const durableOutboxes = new WeakMap<FastifyRequest, import("@cvg/persistence").DurableOutboxInput[]>();
  let persistenceQueue = Promise.resolve();
  const acquireDurableRequest = async (): Promise<() => void> => {
    let release!: () => void;
    const predecessor = persistenceQueue;
    persistenceQueue = new Promise<void>((resolve) => { release = resolve; });
    await predecessor;
    return release;
  };
  const snapshotFingerprint = (snapshot: StoreSnapshot): string => digest(JSON.parse(serializeSnapshot(snapshot)) as unknown);

  if (persistence) {
    app.addHook("onRequest", async (request) => {
      if (!request.url.startsWith("/api/v1/") || request.url === "/api/v1/health" || request.url === "/api/v1/ready" || (request.method === "POST" && request.url.startsWith("/api/v1/integrations/"))) return;
      const release = await acquireDurableRequest();
      try {
        const latest = await persistence.loadLatest(store.bootstrapCredentials.organizationId);
        const revision = latest?.revision ?? await persistence.currentRevision(store.bootstrapCredentials.organizationId);
        if (latest) store.hydrate(latest.snapshot);
        durableRequests.set(request, { baseline: store.snapshot(), revision });
        durableReleases.set(request, release);
      } catch (error) {
        release();
        throw error;
      }
    });
    app.addHook("onSend", async (request, reply, payload) => {
      const transaction = durableRequests.get(request);
      if (!transaction) return payload;
      const snapshot = store.snapshot();
      if (snapshotFingerprint(snapshot) === snapshotFingerprint(transaction.baseline)) return payload;
      const baselineAuditIds = new Set(transaction.baseline.auditRecords.map((record) => record.id));
      const baselineReceiptDigests = new Map(transaction.baseline.commandReceipts.map((receipt) => [receipt.id, digest(receipt)]));
      const auditRecords = snapshot.auditRecords.filter((record) => !baselineAuditIds.has(record.id));
      const commandReceipts = snapshot.commandReceipts.filter((receipt) => baselineReceiptDigests.get(receipt.id) !== digest(receipt));
      const latestAudit = auditRecords.at(-1);
      const latestReceipt = commandReceipts.at(-1);
      const outboxRecords = durableOutboxes.get(request);
      try {
        await persistence.commit({
          expectedRevision: transaction.revision,
          snapshot,
          eventType: "HTTP_REQUEST",
          operation: latestReceipt?.operation ?? latestAudit?.action ?? `${request.method} ${request.url.split("?")[0]}`,
          organizationId: latestAudit?.organizationId ?? latestReceipt?.organizationId ?? null,
          actorId: latestAudit?.actorId ?? latestReceipt?.actorId ?? null,
          correlationId: latestAudit?.correlationId ?? correlationId(request),
          aggregateType: latestReceipt ? "CommandReceipt" : "HTTP",
          aggregateId: latestReceipt?.id ?? null,
          payload: { method: request.method, path: request.url.split("?")[0], statusCode: reply.statusCode, auditIds: auditRecords.map((record) => record.id), receiptIds: commandReceipts.map((receipt) => receipt.id) },
          auditRecords,
          commandReceipts,
          ...(outboxRecords ? { outboxRecords } : {})
        });
      } catch (error) {
        telemetry.log({ timestamp: now(), level: error instanceof PersistenceConflictError ? "warn" : "error", event: "persistence.commit.failed", correlationId: correlationId(request), actorId: null, metadata: persistenceDiagnostic(error) });
        if (error instanceof PersistenceConflictError) {
          let latest;
          try {
            latest = await persistence.loadLatest(store.bootstrapCredentials.organizationId);
          } catch (loadError) {
            if (loadError instanceof PersistenceCorruptionError) {
              store.hydrate(transaction.baseline);
              store.quarantine("PERSISTENCE_CORRUPTION", "o estado concorrente falhou na validação durante a reconciliação");
              throw new DomainError("QUARANTINED", "A persistência durável falhou na validação; o runtime foi colocado em quarentena.", 503);
            }
            latest = null;
          }
          if (latest) store.hydrate(latest.snapshot);
          throw new DomainError("CONFLICT", "O estado persistido mudou durante a operação; a tentativa foi rejeitada e o contexto deve ser recarregado.", 409);
        }
        if (error instanceof PersistenceCorruptionError) {
          store.hydrate(transaction.baseline);
          store.quarantine("PERSISTENCE_CORRUPTION", "a tentativa de commit encontrou um registro durável divergente");
          throw new DomainError("QUARANTINED", "A persistência durável falhou na validação; o runtime foi colocado em quarentena.", 503);
        }
        store.hydrate(transaction.baseline);
        throw new DomainError("DEPENDENCY_UNAVAILABLE", "A operação não foi confirmada porque a persistência durável falhou; nenhum sucesso deve ser inferido.", 503);
      }
      return payload;
    });
    app.addHook("onResponse", async (request) => {
      durableReleases.get(request)?.();
      durableReleases.delete(request);
      durableRequests.delete(request);
      durableOutboxes.delete(request);
    });
    app.addHook("onClose", async () => { await persistence.close(); });
  }

  await app.register(cookie);
  await app.register(cors, { origin: config.webOrigin, credentials: true, methods: ["GET", "POST", "DELETE", "OPTIONS"] });
  app.addHook("onRequest", async (request) => {
    if (!request.url.startsWith("/api/v1/") || request.url === "/api/v1/health" || request.url === "/api/v1/ready") return;
    const rawSession = request.cookies[SESSION_COOKIE];
    const session = rawSession ? store.findSession(tokenDigest(rawSession)) : null;
    const organization = session?.organizationId ?? "anonymous";
    const route = String((request.routeOptions as { url?: string }).url ?? request.url.split("?")[0]);
    const category = route.startsWith("/api/v1/auth/") ? "auth" : route.startsWith("/api/v1/ai/") ? "ai" : route.startsWith("/api/v1/integrations/") ? "webhook" : "api";
    const key = `route:${category}:${tokenDigest(`${request.ip}|${organization}|${request.method}|${route}`)}`;
    const decision = await rateLimiter.consume({ key, limit: config.rateLimitRequestsPerWindow, windowMs: config.rateLimitWindowSeconds * 1_000 });
    if (!decision.allowed) throw new DomainError("RATE_LIMITED", "Muitas solicitações; aguarde antes de tentar novamente.", 429, { retryAfterSeconds: decision.retryAfterSeconds });
  });
  app.addHook("onSend", async (request, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    reply.header("content-security-policy", "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'");
    reply.header("cross-origin-opener-policy", "same-origin");
    reply.header("cross-origin-resource-policy", "same-origin");
    if (config.nodeEnv === "production") reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    if (request.url.startsWith("/api/v1/")) reply.header("cache-control", "no-store");
  });

  await registerHealthRoutes(app, {
    store,
    persistence,
    agentRuntime,
    secretProviderStatus,
    authMfaStatus,
    deepseekBearerTokenStatus,
    deepseekContextSignatureStatus,
    secretProviderRequired: config.nodeEnv === "production" || config.deepseekRuntimeEnabled,
    config
  });

  const startedAt = new WeakMap<object, { startedAt: number; span: ReturnType<OpsTelemetry["startSpan"]> }>();
  app.addHook("onRequest", async (request) => {
    const started = telemetry.requestStarted();
    startedAt.set(request, { startedAt: started, span: telemetry.startSpan(`${request.method} ${request.url.split("?")[0]}`, { requestId: String(request.id), correlationId: correlationId(request), method: request.method }) });
  });
  app.addHook("onResponse", async (request, reply) => {
    const started = startedAt.get(request);
    if (started !== undefined) {
      telemetry.requestFinished(started.startedAt, reply.statusCode, `${request.method} ${request.url.split("?")[0]}`);
      telemetry.finishSpan(started.span, reply.statusCode);
    }
  });

  const requireSession = (request: FastifyRequest) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) throw new DomainError("UNAUTHENTICATED", "É necessário iniciar uma sessão.", 401);
    const session = store.findSession(tokenDigest(raw));
    if (!session) throw new DomainError("UNAUTHENTICATED", "A sessão é inválida, expirada ou foi revogada.", 401);
    store.touchSession(session);
    return session;
  };

  const requireCsrf = (request: FastifyRequest, session: ReturnType<typeof requireSession>) => {
    const origin = header(request, "origin");
    if (origin && origin !== config.webOrigin) throw new DomainError("CSRF_INVALID", "Origem não permitida.", 403);
    const csrf = header(request, "x-csrf-token");
    if (!csrf || csrf !== session.csrfToken || request.cookies[CSRF_COOKIE] !== session.csrfToken) throw new DomainError("CSRF_INVALID", "Token de proteção inválido.", 403);
  };

  const enforceApplicationPolicy = (request: FastifyRequest, context: CvgContext, purpose: string, resourceId: OpaqueId | null = null, resourceFacts: { dataClass?: DataClass } = {}): void => {
    const rule = applicationPolicyFor(purpose);
    if (!rule) throw new DomainError("CAPABILITY_DISABLED", "A operação não possui uma policy de aplicação registrada; o runtime falhou fechado.", 503);
    const decision = authorizeApplicationRequest(context, purpose, { resourceId, dataClass: resourceFacts.dataClass ?? rule.acceptedDataClasses[0] ?? "D0", requestDigest: tokenDigest(`${request.method}:${request.url}:${context.correlationId}`) });
    try {
      assertPolicyAllowed(decision);
    } catch (error) {
      if (error instanceof PolicyEvaluationError && error.code === "APPROVAL_REQUIRED") throw new DomainError("POLICY_DENIED", "A operação exige uma aprovação contextual antes de continuar.", 409, { policyRevision: decision.policyRevision, reason: decision.reason });
      throw new DomainError("FORBIDDEN", "A policy de aplicação negou esta operação no contexto atual.", 403, { policyRevision: decision.policyRevision, reason: decision.reason });
    }
  };

  const requestContext = (request: FastifyRequest, purpose: string, patientId: OpaqueId | null = null, encounterId: OpaqueId | null = null, allowImplicitContext = false, validatePatient = true, policyResourceId: OpaqueId | null = null): { session: ReturnType<typeof requireSession>; context: CvgContext } => {
    const session = requireSession(request);
    const unitHeader = header(request, "x-cvg-unit-id");
    const workspaceHeader = header(request, "x-cvg-workspace-id");
    let unitId: OpaqueId | null = null;
    let workspaceId: OpaqueId | null = null;
    if (unitHeader) unitId = safeId(unitHeader);
    if (workspaceHeader) workspaceId = safeId(workspaceHeader);
    if (!unitId || !workspaceId) {
      if (!allowImplicitContext) throw new DomainError("INVALID_INPUT", "Unidade e workspace são obrigatórios para esta operação.", 400);
      const first = store.contextOptions(session.userId)[0];
      if (first) {
        unitId ??= first.unit.id;
        workspaceId ??= first.workspace.id;
      }
    }
    const context = store.resolveContext(session.userId, { unitId, workspaceId }, purpose, correlationId(request), patientId, encounterId, session.id);
    enforceApplicationPolicy(request, context, purpose, policyResourceId ?? encounterId ?? patientId);
    if (patientId && validatePatient) store.findPatient(context, patientId);
    if (encounterId) {
      const encounter = store.encounters.get(encounterId);
      if (!encounter || encounter.organizationId !== context.organizationId || (context.unitId && encounter.unitId !== context.unitId) || (context.workspaceId && encounter.workspaceId !== context.workspaceId) || (patientId && encounter.patientId !== patientId)) throw new DomainError("NOT_FOUND", "Atendimento não encontrado.", 404);
    }
    return { session, context };
  };

  const checkLoginRate = async (request: FastifyRequest, login: string): Promise<void> => {
    const decision = await rateLimiter.consume({ key: `login:${request.ip}:${tokenDigest(login.trim().toLowerCase())}`, limit: config.authMaxFailedAttempts, windowMs: 5 * 60_000 });
    if (!decision.allowed) throw new DomainError("RATE_LIMITED", "Muitas tentativas de login; aguarde antes de tentar novamente.", 429, { retryAfterSeconds: decision.retryAfterSeconds });
  };

  const passwordPolicy = {
    minLength: config.passwordMinLength,
    maxLength: 256,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSymbol: true,
    rejectIdentifier: true
  } as const;
  const sessionMetadata = (request: FastifyRequest) => {
    const deviceId = header(request, "x-cvg-device-id");
    const userAgent = header(request, "user-agent");
    return {
      deviceIdDigest: deviceId && /^[A-Za-z0-9._:-]{8,160}$/.test(deviceId) ? tokenDigest(deviceId) : null,
      userAgentDigest: userAgent ? tokenDigest(userAgent.slice(0, 512)) : null,
      ipDigest: request.ip ? tokenDigest(request.ip) : null
    };
  };
  const passwordExpiry = (): string | null => config.passwordMaxAgeDays > 0 ? new Date(Date.now() + config.passwordMaxAgeDays * 86_400_000).toISOString() : null;
  const setSessionCookies = (reply: FastifyReply, rawToken: string, csrfToken: string, secure: boolean): void => {
    reply.setCookie(SESSION_COOKIE, rawToken, { httpOnly: true, sameSite: "strict", secure, path: "/", maxAge: config.sessionTtlMinutes * 60 });
    reply.setCookie(CSRF_COOKIE, csrfToken, { httpOnly: false, sameSite: "strict", secure, path: "/", maxAge: config.sessionTtlMinutes * 60 });
  };
  const createAuthenticatedSession = (request: FastifyRequest, reply: FastifyReply, user: ReturnType<CvgStore["getUser"]>, mfaVerifiedAt: string | null = null) => {
    const rawToken = generateOpaqueToken();
    const csrfToken = randomBytes(24).toString("base64url");
    const session = store.createSession(user.id, tokenDigest(rawToken), csrfToken, config.sessionTtlMinutes, { ...sessionMetadata(request), mfaVerifiedAt });
    user.lastLoginAt = now();
    store.clearLoginFailures(user);
    setSessionCookies(reply, rawToken, csrfToken, config.nodeEnv === "production" || !isLoopbackHost(config.host));
    telemetry.sessionOpened();
    return session;
  };
  const authPayload = (user: ReturnType<CvgStore["getUser"]>, session: ReturnType<CvgStore["createSession"]>) => ({
    user: publicUser(user),
    contexts: store.contextOptions(user.id).map((option) => ({ organization: option.organization, unit: option.unit, workspace: option.workspace, roles: option.roles })),
    csrfToken: session.csrfToken
  });
  const publicSession = (session: ReturnType<CvgStore["createSession"]>) => ({
    id: session.id,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt,
    lastSeenAt: session.lastSeenAt,
    device: session.deviceIdDigest ? "registered" : "unidentified",
    mfaVerified: session.mfaVerifiedAt !== null,
    currentCredentialVersion: session.credentialVersion
  });

  const audit = (context: CvgContext, action: string, resourceType: string, resourceId: OpaqueId | null, result: "ALLOWED" | "DENIED" | "ERROR" | "UNKNOWN", reason: string | null = null, metadata: Record<string, string | number | boolean | null> = {}) => {
    const record = store.recordAudit({ organizationId: context.organizationId, actorId: context.actorId, unitId: context.unitId, workspaceId: context.workspaceId, action, resourceType, resourceId, result, reason, correlationId: context.correlationId, metadata });
    const operation = commandOperationByAuditAction[action];
    if (result !== "ALLOWED" || !operation) return record;
    const receipt = [...store.commandReceipts.values()].reverse().find((candidate) => candidate.organizationId === context.organizationId && candidate.actorId === context.actorId && candidate.operation === operation && candidate.status === "SUCCEEDED" && candidate.auditRecordId === null);
    if (receipt) receipt.auditRecordId = record.id;
    return record;
  };

  app.post("/api/v1/integrations/:provider/events", async (request, reply) => {
    if (!persistence) throw new DomainError("CAPABILITY_DISABLED", "O recebimento de eventos externos exige persistência PostgreSQL e verificador de assinatura.", 503);
    const params = parse(z.object({ provider: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,120}$/) }).strict(), request.params);
    const body = parse(integrationInboxEventSchema, request.body);
    if (body.provider !== params.provider) throw new DomainError("INVALID_INPUT", "O provider da rota não corresponde ao provider assinado.", 400);
    if (body.organizationId !== store.bootstrapCredentials.organizationId) throw new DomainError("NOT_FOUND", "A organização não está vinculada a este runtime.", 404);
    const signature = header(request, "x-cvg-signature");
    const signatureKeyRef = header(request, "x-cvg-signature-key-ref");
    if (!signature || !signatureKeyRef) throw new PersistenceSignatureError("inbox event signature headers are required");
    const input = { id: id(randomUUID()), ...body, signatureAlgorithm: "HMAC-SHA256" as const, signatureKeyRef, signature, rawBody: rawRequestBodies.get(request) ?? "" };
    try {
      const receipt = await persistence.processInboxEvent(input, [inboxEventToOutbox(input)]);
      telemetry.log({ timestamp: now(), level: receipt.status === "QUARANTINED" ? "warn" : "info", event: "integration.inbox.accepted", correlationId: correlationId(request), actorId: null, metadata: { provider: body.provider, status: receipt.status, duplicate: receipt.duplicate } });
      return response(reply, success({ accepted: receipt.status === "PROCESSED", duplicate: receipt.duplicate, status: receipt.status, inboxId: receipt.id, recordDigest: receipt.recordDigest }, correlationId(request)), 202);
    } catch (error) {
      if (error instanceof PersistenceSignatureError) throw new DomainError("FORBIDDEN", "A assinatura do evento externo não foi validada.", 403);
      if (error instanceof PersistenceUnavailableError) throw new DomainError("DEPENDENCY_UNAVAILABLE", "O recebimento externo está indisponível porque o verificador não está configurado.", 503);
      throw error;
    }
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    const input = parse(loginInputSchema, request.body);
    await checkLoginRate(request, input.login);
    const user = store.getUserByLogin(input.login);
    if (user && store.isAccountLocked(user)) throw new DomainError("RATE_LIMITED", "Muitas tentativas de login; aguarde antes de tentar novamente.", 429, { retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(user.security.lockedUntil!) - Date.now()) / 1_000)) });
    if (!user || user.status !== "ACTIVE" || !verifyPassword(input.password, user.passwordDigest) || store.healthStatus === "QUARANTINED") {
      if (user && user.status === "ACTIVE" && store.healthStatus !== "QUARANTINED") {
        store.recordLoginFailure(user.id, config.authMaxFailedAttempts, config.authLockoutMinutes);
        store.recordAudit({ organizationId: user.organizationId, actorId: user.id, unitId: null, workspaceId: null, action: "auth.login", resourceType: "User", resourceId: user.id, result: "DENIED", reason: "AUTHENTICATION_FAILED", correlationId: correlationId(request), metadata: { failedAttempts: user.security.failedLoginAttempts } });
      }
      throw new DomainError("AUTHENTICATION_FAILED", "Login ou senha inválidos.", 401);
    }
    const corr = randomUUID();
    if (user.security.passwordExpiresAt && Date.parse(user.security.passwordExpiresAt) <= Date.now()) {
      store.recordAudit({ organizationId: user.organizationId, actorId: user.id, unitId: null, workspaceId: null, action: "auth.login", resourceType: "User", resourceId: user.id, result: "DENIED", reason: "CREDENTIAL_EXPIRED", correlationId: corr, metadata: { storageMode: store.storageMode } });
      throw new DomainError("CREDENTIAL_EXPIRED", "A senha expirou e precisa ser substituída por um fluxo de recuperação autorizado.", 401);
    }
    const requiresMfa = config.authMfaMode === "required" || user.security.mfaRequired;
    if (requiresMfa) {
      if (!mfaSecretResolver || !user.security.mfaSecretRef) throw new DomainError("CAPABILITY_DISABLED", "MFA obrigatório sem uma referência de segredo resolvível; o login foi bloqueado.", 503);
      const rawChallenge = generateOpaqueToken();
      const challenge = store.createAuthChallenge("MFA", user.id, tokenDigest(rawChallenge), config.authChallengeTtlSeconds, config.authMaxChallengeAttempts);
      store.recordAudit({ organizationId: user.organizationId, actorId: user.id, unitId: null, workspaceId: null, action: "auth.mfa.challenge", resourceType: "AuthChallenge", resourceId: challenge.id, result: "ALLOWED", reason: null, correlationId: corr, metadata: { factor: "TOTP", expiresAt: challenge.expiresAt } });
      return response(reply, success({ mfaRequired: true, challengeId: rawChallenge, expiresAt: challenge.expiresAt }, corr), 202);
    }
    const session = createAuthenticatedSession(request, reply, user);
    store.recordAudit({ organizationId: user.organizationId, actorId: user.id, unitId: null, workspaceId: null, action: "auth.login", resourceType: "Session", resourceId: session.id, result: "ALLOWED", reason: null, correlationId: corr, metadata: { storageMode: store.storageMode, mfa: false } });
    return response(reply, success(authPayload(user, session), corr));
  });

  app.post("/api/v1/auth/mfa/verify", async (request, reply) => {
    const input = parse(mfaVerificationInputSchema, request.body);
    const corr = correlationId(request);
    const challenge = store.findAuthChallenge("MFA", tokenDigest(input.challengeId));
    if (!challenge) throw new DomainError("MFA_INVALID", "O desafio de autenticação é inválido, expirou ou já foi consumido.", 401);
    const user = store.getUser(challenge.userId);
    const secretRef = user.security.mfaSecretRef;
    if (!mfaSecretResolver || !secretRef) throw new DomainError("CAPABILITY_DISABLED", "O resolver de MFA não está disponível; nenhum login foi liberado.", 503);
    const secret = await mfaSecretResolver.resolve(secretRef);
    if (!secret || !verifyTotpCode(secret, input.code)) {
      store.recordChallengeFailure(challenge);
      store.recordAudit({ organizationId: user.organizationId, actorId: user.id, unitId: null, workspaceId: null, action: "auth.mfa.verify", resourceType: "AuthChallenge", resourceId: challenge.id, result: "DENIED", reason: challenge.status === "LOCKED" ? "MFA_CHALLENGE_LOCKED" : "MFA_INVALID", correlationId: corr, metadata: { attempts: challenge.attempts } });
      throw new DomainError(challenge.status === "LOCKED" ? "ACCOUNT_LOCKED" : "MFA_INVALID", challenge.status === "LOCKED" ? "O desafio atingiu o limite de tentativas." : "O código MFA é inválido.", challenge.status === "LOCKED" ? 429 : 401);
    }
    store.consumeAuthChallenge(challenge);
    const session = createAuthenticatedSession(request, reply, user, now());
    store.recordAudit({ organizationId: user.organizationId, actorId: user.id, unitId: null, workspaceId: null, action: "auth.login", resourceType: "Session", resourceId: session.id, result: "ALLOWED", reason: "mfa_verified", correlationId: corr, metadata: { storageMode: store.storageMode, mfa: true } });
    return response(reply, success(authPayload(user, session), corr));
  });

  app.post("/api/v1/auth/mfa/enroll", async (request, reply) => {
    const { session, context } = requestContext(request, "identity.mfa.enroll", null, null, true);
    requireCsrf(request, session);
    const input = parse(mfaEnrollmentInputSchema, request.body);
    const user = store.getUser(session.userId);
    if (!verifyPassword(input.currentPassword, user.passwordDigest)) {
      audit(context, "identity.mfa.enroll", "User", user.id, "DENIED", "AUTHENTICATION_FAILED");
      throw new DomainError("AUTHENTICATION_FAILED", "A senha atual é inválida.", 401);
    }
    if (!mfaSecretResolver) throw new DomainError("CAPABILITY_DISABLED", "O resolver de MFA não está disponível; nenhum fator foi cadastrado.", 503);
    let secret: string | null = null;
    try { secret = await mfaSecretResolver.resolve(input.secretRef); } catch { secret = null; }
    if (!secret || !verifyTotpCode(secret, input.code)) {
      audit(context, "identity.mfa.enroll", "User", user.id, "DENIED", "MFA_INVALID");
      throw new DomainError("MFA_INVALID", "O fator MFA não pôde ser validado.", 401);
    }
    const key = requireIdempotencyKey(request);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "identity.mfa.enroll", key, resourceId: user.id, unitId: context.unitId, workspaceId: context.workspaceId, body: { secretRef: input.secretRef, codeDigest: tokenDigest(input.code) } }, () => {
      store.configureMfaFactor(user.id, input.secretRef);
      const sessionsRevoked = store.revokeAllSessions(user.id, session.id);
      session.mfaVerifiedAt = now();
      return { enrolled: true, method: "TOTP" as const, sessionsRevoked };
    });
    audit(context, "identity.mfa.enroll", "User", user.id, "ALLOWED", null, { method: "TOTP", replay: result.replayed, sessionsRevoked: result.value.sessionsRevoked });
    return response(reply, success({ ...result.value, receiptId: result.receipt.id }, context.correlationId), result.replayed ? 200 : 201);
  });

  app.post("/api/v1/auth/mfa/revoke", async (request, reply) => {
    const { session, context } = requestContext(request, "identity.mfa.revoke", null, null, true);
    requireCsrf(request, session);
    const input = parse(mfaFactorRevokeInputSchema, request.body);
    const user = store.getUser(session.userId);
    if (config.authMfaMode === "required") throw new DomainError("CAPABILITY_DISABLED", "O MFA obrigatório não pode ser revogado nesta configuração.", 409);
    if (!verifyPassword(input.currentPassword, user.passwordDigest)) {
      audit(context, "identity.mfa.revoke", "User", user.id, "DENIED", "AUTHENTICATION_FAILED");
      throw new DomainError("AUTHENTICATION_FAILED", "A senha atual é inválida.", 401);
    }
    const key = requireIdempotencyKey(request);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "identity.mfa.revoke", key, resourceId: user.id, unitId: context.unitId, workspaceId: context.workspaceId, body: { currentPasswordDigest: tokenDigest(input.currentPassword) } }, () => {
      const hadFactor = user.security.mfaSecretRef !== null;
      store.revokeMfaFactor(user.id);
      const sessionsRevoked = store.revokeAllSessions(user.id);
      return { revoked: hadFactor, method: "TOTP" as const, sessionsRevoked };
    });
    audit(context, "identity.mfa.revoke", "User", user.id, "ALLOWED", null, { method: "TOTP", replay: result.replayed, sessionsRevoked: result.value.sessionsRevoked });
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.clearCookie(CSRF_COOKIE, { path: "/" });
    telemetry.sessionClosed();
    return response(reply, success({ ...result.value, receiptId: result.receipt.id }, context.correlationId));
  });

  app.post("/api/v1/auth/recovery/start", async (request, reply) => {
    const input = parse(recoveryStartInputSchema, request.body);
    const rawChallenge = generateOpaqueToken();
    const user = store.getUserByLogin(input.login);
    const expiresAt = new Date(Date.now() + config.authChallengeTtlSeconds * 1_000).toISOString();
    const corr = correlationId(request);
    if (user?.status === "ACTIVE" && store.healthStatus !== "QUARANTINED") {
      const challenge = store.createAuthChallenge("RECOVERY", user.id, tokenDigest(rawChallenge), config.authChallengeTtlSeconds, config.authMaxChallengeAttempts);
      store.recordAudit({ organizationId: user.organizationId, actorId: user.id, unitId: null, workspaceId: null, action: "auth.recovery.challenge", resourceType: "AuthChallenge", resourceId: challenge.id, result: "ALLOWED", reason: null, correlationId: corr, metadata: { expiresAt: challenge.expiresAt } });
      return response(reply, success({ accepted: true, challengeId: rawChallenge, expiresAt: challenge.expiresAt }, corr), 202);
    }
    return response(reply, success({ accepted: true, challengeId: rawChallenge, expiresAt }, corr), 202);
  });

  app.post("/api/v1/auth/recovery/complete", async (request, reply) => {
    const input = parse(recoveryCompleteInputSchema, request.body);
    const issues = passwordPolicyIssues(input.newPassword, passwordPolicy);
    if (issues.length) throw new DomainError("INVALID_INPUT", "A nova senha não atende à política de segurança.", 400, { issues });
    const corr = correlationId(request);
    const challenge = store.findAuthChallenge("RECOVERY", tokenDigest(input.challengeId));
    if (!challenge) throw new DomainError("RECOVERY_INVALID", "A recuperação é inválida, expirou ou já foi consumida.", 401);
    const user = store.getUser(challenge.userId);
    const accountIssues = passwordPolicyIssues(input.newPassword, passwordPolicy, { identifier: user.login });
    if (accountIssues.length) throw new DomainError("INVALID_INPUT", "A nova senha não atende à política de segurança.", 400, { issues: accountIssues });
    if (!store.consumeRecoveryCode(user.id, input.recoveryCode)) {
      store.recordChallengeFailure(challenge);
      store.recordAudit({ organizationId: user.organizationId, actorId: user.id, unitId: null, workspaceId: null, action: "auth.recovery.complete", resourceType: "AuthChallenge", resourceId: challenge.id, result: "DENIED", reason: challenge.status === "LOCKED" ? "RECOVERY_CHALLENGE_LOCKED" : "RECOVERY_INVALID", correlationId: corr, metadata: { attempts: challenge.attempts } });
      throw new DomainError(challenge.status === "LOCKED" ? "ACCOUNT_LOCKED" : "RECOVERY_INVALID", "O código de recuperação é inválido.", challenge.status === "LOCKED" ? 429 : 401);
    }
    store.consumeAuthChallenge(challenge);
    store.rotatePassword(user.id, hashPassword(input.newPassword), passwordExpiry());
    const session = createAuthenticatedSession(request, reply, user, now());
    store.recordAudit({ organizationId: user.organizationId, actorId: user.id, unitId: null, workspaceId: null, action: "auth.recovery.complete", resourceType: "Session", resourceId: session.id, result: "ALLOWED", reason: "recovery_code_consumed", correlationId: corr, metadata: { sessionsRevoked: true } });
    return response(reply, success({ ...authPayload(user, session), recovered: true }, corr));
  });

  app.post("/api/v1/auth/password/rotate", async (request, reply) => {
    const { session, context } = requestContext(request, "identity.password.rotate", null, null, true);
    requireCsrf(request, session);
    const input = parse(passwordRotationInputSchema, request.body);
    const user = store.getUser(session.userId);
    if (!verifyPassword(input.currentPassword, user.passwordDigest)) throw new DomainError("AUTHENTICATION_FAILED", "A senha atual é inválida.", 401);
    if (verifyPassword(input.newPassword, user.passwordDigest)) throw new DomainError("INVALID_INPUT", "A nova senha deve ser diferente da senha atual.", 400);
    const issues = passwordPolicyIssues(input.newPassword, passwordPolicy, { identifier: user.login });
    if (issues.length) throw new DomainError("INVALID_INPUT", "A nova senha não atende à política de segurança.", 400, { issues });
    store.rotatePassword(user.id, hashPassword(input.newPassword), passwordExpiry());
    const newSession = createAuthenticatedSession(request, reply, user, session.mfaVerifiedAt);
    audit(context, "identity.password.rotate", "User", user.id, "ALLOWED", null, { sessionsRevoked: true });
    return response(reply, success({ ...authPayload(user, newSession), rotated: true }, context.correlationId));
  });

  app.get("/api/v1/auth/sessions", async (request, reply) => {
    const { session, context } = requestContext(request, "identity.sessions.read", null, null, true);
    const items = [...store.sessions.values()].filter((candidate) => candidate.userId === session.userId).sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt)).map(publicSession);
    audit(context, "identity.sessions.read", "Session", null, "ALLOWED", null, { count: items.length });
    return response(reply, success({ items, currentSessionId: session.id }, context.correlationId));
  });

  app.post("/api/v1/auth/sessions/:id/revoke", async (request, reply) => {
    const sessionId = id(parse(idSchema, (request.params as { id: string }).id));
    const { session, context } = requestContext(request, "identity.sessions.revoke", null, null, true, true, sessionId);
    requireCsrf(request, session);
    const target = store.sessions.get(sessionId);
    if (!target || target.userId !== session.userId) throw new DomainError("NOT_FOUND", "Sessão não encontrada.", 404);
    store.revokeSession(target);
    audit(context, "identity.sessions.revoke", "Session", target.id, "ALLOWED", null, { current: target.id === session.id });
    if (target.id === session.id) {
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      reply.clearCookie(CSRF_COOKIE, { path: "/" });
      telemetry.sessionClosed();
    }
    return response(reply, success({ revoked: true, sessionId: target.id, current: target.id === session.id }, context.correlationId));
  });

  app.post("/api/v1/auth/demo", async (request, reply) => {
    if (!config.demoMode || config.storageMode !== "memory") throw new DomainError("CAPABILITY_DISABLED", "A demonstração sintética não está habilitada neste ambiente.", 403);
    const user = store.getUser(store.bootstrapCredentials.userId);
    const corr = randomUUID();
    const session = createAuthenticatedSession(request, reply, user);
    store.recordAudit({ organizationId: user.organizationId, actorId: user.id, unitId: null, workspaceId: null, action: "auth.demo_session", resourceType: "Session", resourceId: session.id, result: "ALLOWED", reason: "local synthetic demo only", correlationId: corr, metadata: { demo: true } });
    return response(reply, success({ ...authPayload(user, session), demo: true }, corr));
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const { session, context } = requestContext(request, "auth.logout", null, null, true, false);
    requireCsrf(request, session);
    store.revokeSession(session);
    audit(context, "auth.logout", "Session", session.id, "ALLOWED");
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.clearCookie(CSRF_COOKIE, { path: "/" });
    telemetry.sessionClosed();
    return response(reply, success({ loggedOut: true }, context.correlationId));
  });

  app.get("/api/v1/me", async (request, reply) => {
    const { session, context } = requestContext(request, "identity.read", null, null, true);
    const user = store.getUser(session.userId);
    audit(context, "identity.read", "User", user.id, "ALLOWED");
    return response(reply, success({ user: publicUser(user), roles: context.actorRoleSnapshot, context: publicContext(context, store), csrfToken: session.csrfToken }, context.correlationId));
  });

  app.get("/api/v1/contexts", async (request, reply) => {
    const { session, context } = requestContext(request, "contexts.read", null, null, true);
    audit(context, "contexts.read", "Context", null, "ALLOWED");
    return response(reply, success(store.contextOptions(session.userId), context.correlationId));
  });

  app.get("/api/v1/context", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const selector = parse(contextSelectorSchema, { unitId: query.unitId ?? null, workspaceId: query.workspaceId ?? null });
    const session = requireSession(request);
    const context = store.resolveContext(session.userId, selector, "context.select", correlationId(request), null, null, session.id);
    enforceApplicationPolicy(request, context, "context.select", context.workspaceId);
    audit(context, "context.select", "Context", context.workspaceId, "ALLOWED");
    return response(reply, success(publicContext(context, store), context.correlationId));
  });

  app.get("/api/v1/users", async (request, reply) => {
    const { context } = requestContext(request, "users.read");
    const query = request.query as Record<string, unknown>;
    const users = store.listUsers(context, typeof query.q === "string" ? query.q : "");
    audit(context, "users.read", "User", null, "ALLOWED", null, { count: users.length });
    return response(reply, success({ items: users, nextCursor: users.at(-1)?.id ?? null, revision: store.organizations.get(context.organizationId)?.authorizationRevision.toString() ?? "0" }, context.correlationId));
  });

  app.post("/api/v1/role-assignments", async (request, reply) => {
    const session = requireSession(request);
    requireCsrf(request, session);
    const input = parse(roleAssignmentInputSchema, request.body);
    const { context } = requestContext(request, "role.grant", null, null, false, true, input.userId);
    const key = header(request, "idempotency-key");
    if (!key) throw new DomainError("INVALID_INPUT", "Idempotency-Key é obrigatório.", 400);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "role.grant", key, resourceId: input.userId, unitId: input.unitId, workspaceId: input.workspaceId, body: input }, () => domainCommands.grantRole(context, input));
    audit(context, "role.grant", "RoleAssignment", result.value.id, "ALLOWED", null, { replay: result.replayed });
    return response(reply, success({ assignment: result.value, receiptId: result.receipt.id, revision: store.organizations.get(context.organizationId)?.authorizationRevision.toString() ?? "0" }, context.correlationId), 201);
  });

  app.delete("/api/v1/role-assignments/:id", async (request, reply) => {
    const session = requireSession(request);
    requireCsrf(request, session);
    const params = request.params as { id: string };
    const query = request.query as Record<string, unknown>;
    const expectedRevision = typeof query.expectedRevision === "string" ? query.expectedRevision : "";
    const parsedId = id(parse(idSchema, params.id));
    const { context } = requestContext(request, "role.revoke", null, null, false, true, parsedId);
    const key = header(request, "idempotency-key");
    if (!key || !expectedRevision) throw new DomainError("INVALID_INPUT", "Idempotency-Key e expectedRevision são obrigatórios.", 400);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "role.revoke", key, resourceId: parsedId, unitId: null, workspaceId: null, body: { assignmentId: parsedId, expectedRevision } }, () => domainCommands.revokeRole(context, parsedId, expectedRevision));
    audit(context, "role.revoke", "RoleAssignment", parsedId, "ALLOWED");
    return response(reply, success({ assignment: result.value, receiptId: result.receipt.id, revision: store.organizations.get(context.organizationId)?.authorizationRevision.toString() ?? "0" }, context.correlationId));
  });

  app.get("/api/v1/audit", async (request, reply) => {
    const { context } = requestContext(request, "audit.read");
    const query = request.query as Record<string, unknown>;
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 25)));
    const cursor = typeof query.cursor === "string" ? query.cursor : null;
    const records = store.listAudit(context, Number.isFinite(limit) ? limit : 25, cursor);
    audit(context, "audit.read", "AuditRecord", null, "ALLOWED", null, { count: records.length });
    return response(reply, success({ items: records.map((record) => ({ ...record, metadata: { ...record.metadata } })), nextCursor: records.at(-1)?.id ?? null, revision: store.organizations.get(context.organizationId)?.authorizationRevision.toString() ?? "0" }, context.correlationId));
  });

  app.get("/api/v1/guardians", async (request, reply) => {
    const { context } = requestContext(request, "guardians.read");
    const query = request.query as Record<string, unknown>;
    const guardians = await readApplication.listGuardians(context, typeof query.q === "string" ? query.q : "");
    audit(context, "guardians.read", "Guardian", null, "ALLOWED", null, { count: guardians.length });
    return response(reply, success({ items: guardians.map(publicGuardian) }, context.correlationId));
  });

  app.post("/api/v1/guardians", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const { context } = requestContext(request, "guardians.create");
    const input = parse(z.object({ displayName: z.string().trim().min(2).max(120), phone: z.string().trim().min(8).max(40), email: z.string().email().nullable().default(null) }).strict(), request.body);
    const key = requireIdempotencyKey(request);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "guardians.create", key, resourceId: null, unitId: context.unitId, workspaceId: context.workspaceId, body: input }, () => domainCommands.createGuardian(context, input));
    audit(context, "guardians.create", "Guardian", result.value.id, "ALLOWED", null, { replay: result.replayed });
    return response(reply, success({ guardian: publicGuardian(result.value), receiptId: result.receipt.id }, context.correlationId), 201);
  });

  app.get("/api/v1/patients", async (request, reply) => {
    const { context } = requestContext(request, "patients.read");
    const query = request.query as Record<string, unknown>;
    const patients = await patientApplication.list(context, typeof query.q === "string" ? query.q : "");
    audit(context, "patients.read", "AnimalPatient", null, "ALLOWED", null, { count: patients.length });
    return response(reply, success({ items: patients.map((patient) => publicPatientRecord(patient, patient.guardian, context.actorRoleSnapshot)) }, context.correlationId));
  });

  app.get("/api/v1/patients/:id", async (request, reply) => {
    const patientId = id(parse(idSchema, (request.params as { id: string }).id));
    const { context } = requestContext(request, "patients.read", patientId, null, false, false);
    const patient = await patientApplication.get(context, patientId);
    if (!patient) throw new DomainError("NOT_FOUND", "Recurso não encontrado.", 404);
    enforceApplicationPolicy(request, context, "patients.read", patient.id, { dataClass: patient.dataClass });
    audit(context, "patients.read", "AnimalPatient", patient.id, "ALLOWED");
    return response(reply, success(publicPatientRecord(patient, patient.guardian, context.actorRoleSnapshot), context.correlationId));
  });

  app.post("/api/v1/patients", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const input = parse(patientInputSchema, request.body);
    const { context } = requestContext(request, "patients.create", null, null, false, true, input.guardianId);
    const key = requireIdempotencyKey(request);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "patients.create", key, resourceId: input.guardianId, unitId: context.unitId, workspaceId: context.workspaceId, body: input }, () => patientApplication.create(context, input));
    audit(context, "patients.create", "AnimalPatient", result.value.id, "ALLOWED");
    return response(reply, success({ patient: publicPatient(store, result.value.id, context.actorRoleSnapshot), receiptId: result.receipt.id }, context.correlationId), 201);
  });

  app.post("/api/v1/patients/:id/disable", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const patientId = id(parse(idSchema, (request.params as { id: string }).id));
    const { context } = requestContext(request, "patients.disable", patientId);
    const key = header(request, "idempotency-key");
    if (!key) throw new DomainError("INVALID_INPUT", "Idempotency-Key é obrigatório.", 400);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "patients.disable", key, resourceId: patientId, unitId: context.unitId, workspaceId: context.workspaceId, body: { patientId } }, () => domainCommands.disablePatient(context, patientId));
    audit(context, "patients.disable", "AnimalPatient", patientId, "ALLOWED", "registro preservado; apenas status alterado");
    return response(reply, success({ patient: publicPatient(store, result.value.id, context.actorRoleSnapshot), receiptId: result.receipt.id }, context.correlationId));
  });

  app.post("/api/v1/patients/merge", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const input = parse(patientMergeInputSchema, request.body);
    const { context } = requestContext(request, "patients.merge", input.sourcePatientId);
    const key = header(request, "idempotency-key");
    if (!key) throw new DomainError("INVALID_INPUT", "Idempotency-Key é obrigatório.", 400);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "patients.merge", key, resourceId: input.sourcePatientId, unitId: context.unitId, workspaceId: context.workspaceId, body: input }, () => domainCommands.mergePatients(context, input));
    audit(context, "patients.merge", "AnimalPatient", input.sourcePatientId, "ALLOWED", "confirmação humana explícita; histórico preservado", { targetPatientId: input.targetPatientId });
    return response(reply, success({ targetPatient: publicPatient(store, result.value.id, context.actorRoleSnapshot), sourcePatientId: input.sourcePatientId, receiptId: result.receipt.id }, context.correlationId), 202);
  });

  app.get("/api/v1/appointments", async (request, reply) => {
    const { context } = requestContext(request, "appointments.read");
    const query = request.query as Record<string, unknown>;
    const range = query.range === "week" ? "week" : "today";
    const appointments = await readApplication.listAppointments(context, range);
    audit(context, "appointments.read", "Appointment", null, "ALLOWED", null, { count: appointments.length });
    return response(reply, success({ items: appointments }, context.correlationId));
  });

  app.post("/api/v1/appointments", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const input = parse(appointmentInputSchema, request.body);
    const { context } = requestContext(request, "appointments.create", input.patientId, null, false, true, input.patientId);
    const key = header(request, "idempotency-key");
    if (!key) throw new DomainError("INVALID_INPUT", "Idempotency-Key é obrigatório.", 400);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "appointments.create", key, resourceId: null, unitId: context.unitId, workspaceId: context.workspaceId, body: input }, () => domainCommands.createAppointment(context, input));
    audit(context, "appointments.create", "Appointment", result.value.id, "ALLOWED");
    return response(reply, success({ appointment: result.value, receiptId: result.receipt.id }, context.correlationId), 201);
  });

  app.get("/api/v1/queue", async (request, reply) => {
    const { context } = requestContext(request, "queue.read");
    const items = store.listQueue(context).map((entry) => ({ ...entry, patient: store.patients.get(entry.patientId) ? { id: entry.patientId, name: store.patients.get(entry.patientId)!.name } : null }));
    audit(context, "queue.read", "QueueEntry", null, "ALLOWED", null, { count: items.length });
    return response(reply, success({ items }, context.correlationId));
  });

  app.post("/api/v1/appointments/:id/check-in", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const appointmentId = id(parse(idSchema, (request.params as { id: string }).id));
    const { context } = requestContext(request, "queue.check-in", null, null, false, true, appointmentId);
    const key = header(request, "idempotency-key");
    if (!key) throw new DomainError("INVALID_INPUT", "Idempotency-Key é obrigatório.", 400);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "queue.check-in", key, resourceId: appointmentId, unitId: context.unitId, workspaceId: context.workspaceId, body: { appointmentId } }, () => domainCommands.checkInAppointment(context, appointmentId));
    audit(context, "queue.check-in", "QueueEntry", result.value.id, "ALLOWED");
    return response(reply, success({ queueEntry: result.value, receiptId: result.receipt.id }, context.correlationId), 201);
  });

  app.get("/api/v1/encounters", async (request, reply) => {
    const { context } = requestContext(request, "encounters.read");
    const encounters = store.listEncounters(context).map((encounter) => ({ ...encounter, patient: store.patients.get(encounter.patientId) ? { id: encounter.patientId, name: store.patients.get(encounter.patientId)!.name } : null }));
    audit(context, "encounters.read", "Encounter", null, "ALLOWED", null, { count: encounters.length });
    return response(reply, success({ items: encounters }, context.correlationId));
  });

  app.post("/api/v1/encounters", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const input = parse(z.object({ patientId: idSchema, appointmentId: idSchema.nullable().default(null), chiefComplaint: z.string().trim().min(2).max(500), urgency: z.enum(["ROUTINE", "URGENT", "EMERGENCY"]).default("ROUTINE") }).strict(), request.body);
    const { context } = requestContext(request, "encounters.create", input.patientId);
    const key = requireIdempotencyKey(request);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "encounters.create", key, resourceId: input.patientId, unitId: context.unitId, workspaceId: context.workspaceId, body: input }, () => domainCommands.createEncounter(context, input));
    audit(context, "encounters.create", "Encounter", result.value.id, "ALLOWED");
    return response(reply, success({ encounter: result.value, receiptId: result.receipt.id }, context.correlationId), 201);
  });

  app.get("/api/v1/clinical/documents", async (request, reply) => {
    const { context } = requestContext(request, "clinical.read");
    store.requireRole(context, ["admin", "veterinario"], "clinical:read");
    const documents = [...store.clinicalDocuments.values()].filter((document) => document.organizationId === context.organizationId && (!context.unitId || store.encounters.get(document.encounterId)?.unitId === context.unitId) && (!context.workspaceId || store.encounters.get(document.encounterId)?.workspaceId === context.workspaceId)).map(({ content: _content, ...document }) => document);
    audit(context, "clinical.read", "ClinicalDocument", null, "ALLOWED", null, { count: documents.length });
    return response(reply, success({ items: documents }, context.correlationId));
  });

  app.post("/api/v1/clinical/documents", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const input = parse(clinicalDocumentInputSchema, request.body);
    const { context } = requestContext(request, "clinical.write", null, input.encounterId, false, true, input.encounterId);
    const key = requireIdempotencyKey(request);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "clinical.write", key, resourceId: input.encounterId, unitId: context.unitId, workspaceId: context.workspaceId, body: input }, () => domainCommands.createClinicalDocument(context, input));
    audit(context, "clinical.write", "ClinicalDocument", result.value.id, "ALLOWED");
    return response(reply, success({ document: { ...result.value, content: undefined }, receiptId: result.receipt.id }, context.correlationId), 201);
  });

  app.post("/api/v1/clinical/documents/:id/sign", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const documentId = id(parse(idSchema, (request.params as { id: string }).id));
    const { context } = requestContext(request, "clinical.sign", null, null, false, false, documentId);
    const key = requireIdempotencyKey(request);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "clinical.sign", key, resourceId: documentId, unitId: context.unitId, workspaceId: context.workspaceId, body: { documentId } }, () => domainCommands.signClinicalDocument(context, documentId));
    audit(context, "clinical.sign", "ClinicalDocument", result.value.id, "ALLOWED");
    return response(reply, success({ document: { ...result.value, content: undefined }, receiptId: result.receipt.id }, context.correlationId));
  });

  app.post("/api/v1/clinical/documents/:id/addenda", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const documentId = id(parse(idSchema, (request.params as { id: string }).id));
    const input = parse(z.object({ reason: z.string().trim().min(5).max(500), content: z.string().trim().min(1).max(30_000) }).strict(), request.body);
    const { context } = requestContext(request, "clinical.addendum", null, null, false, false, documentId);
    const key = header(request, "idempotency-key");
    if (!key) throw new DomainError("INVALID_INPUT", "Idempotency-Key é obrigatório.", 400);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "clinical.addendum", key, resourceId: documentId, unitId: context.unitId, workspaceId: context.workspaceId, body: input }, () => domainCommands.addClinicalAddendum(context, documentId, input.reason, input.content));
    audit(context, "clinical.addendum", "ClinicalAddendum", result.value.id, "ALLOWED", "documento assinado permanece imutável");
    return response(reply, success({ addendum: result.value, receiptId: result.receipt.id }, context.correlationId), 201);
  });

  app.get("/api/v1/diagnostics/requests", async (request, reply) => {
    const { context } = requestContext(request, "diagnostics.read");
    store.requireRole(context, ["admin", "veterinario"], "diagnostics:read");
    const items = [...store.diagnosticRequests.values()].filter((item) => {
      const encounter = item.encounterId ? store.encounters.get(item.encounterId) : null;
      return item.organizationId === context.organizationId && Boolean(encounter) && (!context.unitId || encounter!.unitId === context.unitId) && (!context.workspaceId || encounter!.workspaceId === context.workspaceId);
    });
    audit(context, "diagnostics.read", "DiagnosticRequest", null, "ALLOWED", null, { count: items.length });
    return response(reply, success({ items }, context.correlationId));
  });

  app.post("/api/v1/diagnostics/requests", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const input = parse(diagnosticRequestInputSchema, request.body);
    const { context } = requestContext(request, "diagnostics.create", input.patientId, input.encounterId);
    const key = requireIdempotencyKey(request);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "diagnostics.create", key, resourceId: input.patientId, unitId: context.unitId, workspaceId: context.workspaceId, body: input }, () => domainCommands.createDiagnosticRequest(context, input));
    audit(context, "diagnostics.create", "DiagnosticRequest", result.value.id, "ALLOWED");
    return response(reply, success({ request: result.value, receiptId: result.receipt.id }, context.correlationId), 201);
  });

  app.get("/api/v1/diagnostics/specimens", async (request, reply) => {
    const { context } = requestContext(request, "diagnostics.specimens.read");
    store.requireRole(context, ["admin", "veterinario"], "diagnostics:read");
    const items = [...store.specimens.values()].filter((item) => {
      const requestRecord = store.diagnosticRequests.get(item.requestId);
      const encounter = requestRecord?.encounterId ? store.encounters.get(requestRecord.encounterId) : null;
      return item.organizationId === context.organizationId && Boolean(requestRecord && encounter) && (!context.unitId || encounter!.unitId === context.unitId) && (!context.workspaceId || encounter!.workspaceId === context.workspaceId);
    });
    audit(context, "diagnostics.specimens.read", "Specimen", null, "ALLOWED", null, { count: items.length });
    return response(reply, success({ items }, context.correlationId));
  });

  app.post("/api/v1/diagnostics/requests/:id/specimens", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const requestId = id(parse(idSchema, (request.params as { id: string }).id));
    const input = parse(specimenInputSchema, request.body);
    const { context } = requestContext(request, "diagnostics.specimen", null, null, false, false, requestId);
    const key = header(request, "idempotency-key");
    if (!key) throw new DomainError("INVALID_INPUT", "Idempotency-Key é obrigatório.", 400);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "diagnostics.specimen", key, resourceId: requestId, unitId: context.unitId, workspaceId: context.workspaceId, body: input }, () => domainCommands.createSpecimen(context, requestId, input.label));
    audit(context, "diagnostics.specimen", "Specimen", result.value.id, "ALLOWED");
    return response(reply, success({ specimen: result.value, receiptId: result.receipt.id }, context.correlationId), 201);
  });

  app.post("/api/v1/diagnostics/results", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const input = parse(resultInputSchema, request.body);
    const { context } = requestContext(request, "diagnostics.result", null, null, false, false, input.requestId);
    const key = requireIdempotencyKey(request);
    const idempotentResult = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "diagnostics.result", key, resourceId: input.requestId, unitId: context.unitId, workspaceId: context.workspaceId, body: input }, () => domainCommands.createResult(context, input));
    audit(context, "diagnostics.result", "DiagnosticResult", idempotentResult.value.id, "ALLOWED");
    return response(reply, success({ result: idempotentResult.value, receiptId: idempotentResult.receipt.id }, context.correlationId), 201);
  });

  app.get("/api/v1/diagnostics/results", async (request, reply) => {
    const { context } = requestContext(request, "diagnostics.results.read");
    store.requireRole(context, ["admin", "veterinario"], "diagnostics:read");
    const items = [...store.diagnosticResults.values()].filter((item) => {
      const requestRecord = store.diagnosticRequests.get(item.requestId);
      const encounter = requestRecord?.encounterId ? store.encounters.get(requestRecord.encounterId) : null;
      return item.organizationId === context.organizationId && Boolean(requestRecord && encounter) && (!context.unitId || encounter!.unitId === context.unitId) && (!context.workspaceId || encounter!.workspaceId === context.workspaceId);
    });
    audit(context, "diagnostics.results.read", "DiagnosticResult", null, "ALLOWED", null, { count: items.length });
    return response(reply, success({ items }, context.correlationId));
  });

  app.get("/api/v1/stock", async (request, reply) => {
    const { context } = requestContext(request, "stock.read");
    const items = store.listStock(context);
    audit(context, "stock.read", "Lot", null, "ALLOWED", null, { count: items.length });
    return response(reply, success({ items }, context.correlationId));
  });

  app.post("/api/v1/stock/movements", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const input = parse(stockMovementInputSchema, request.body);
    const { context } = requestContext(request, "stock.write", null, null, false, false, input.lotId);
    const key = header(request, "idempotency-key");
    if (!key) throw new DomainError("INVALID_INPUT", "Idempotency-Key é obrigatório.", 400);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "stock.movement", key, resourceId: input.lotId, unitId: context.unitId, workspaceId: context.workspaceId, body: input }, () => domainCommands.createStockMovement(context, input));
    audit(context, "stock.write", "StockMovement", result.value.id, "ALLOWED");
    return response(reply, success({ movement: result.value, receiptId: result.receipt.id }, context.correlationId), 201);
  });

  app.get("/api/v1/hospitalization/beds", async (request, reply) => {
    const { context } = requestContext(request, "hospitalization.beds.read");
    const items = store.listBeds(context);
    audit(context, "hospitalization.beds.read", "Bed", null, "ALLOWED", null, { count: items.length });
    return response(reply, success({ items }, context.correlationId));
  });

  app.get("/api/v1/hospitalization/episodes", async (request, reply) => {
    const { context } = requestContext(request, "hospitalization.read");
    const items = store.listHospitalEpisodes(context);
    audit(context, "hospitalization.read", "HospitalEpisode", null, "ALLOWED", null, { count: items.length });
    return response(reply, success({ items }, context.correlationId));
  });

  app.post("/api/v1/hospitalization/episodes", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const input = parse(hospitalEpisodeInputSchema, request.body);
    const { context } = requestContext(request, "hospitalization.create", input.patientId, input.encounterId);
    const key = header(request, "idempotency-key");
    if (!key) throw new DomainError("INVALID_INPUT", "Idempotency-Key é obrigatório.", 400);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "hospitalization.create", key, resourceId: input.patientId, unitId: context.unitId, workspaceId: context.workspaceId, body: input }, () => domainCommands.createHospitalEpisode(context, input));
    audit(context, "hospitalization.create", "HospitalEpisode", result.value.id, "ALLOWED");
    return response(reply, success({ episode: result.value, receiptId: result.receipt.id }, context.correlationId), 201);
  });

  app.get("/api/v1/medications/orders", async (request, reply) => {
    const { context } = requestContext(request, "medication.read");
    const items = store.listMedicationOrders(context).map((order) => ({ ...order, product: store.products.get(order.productId) ? { id: order.productId, name: store.products.get(order.productId)!.name, unit: store.products.get(order.productId)!.unit } : null }));
    audit(context, "medication.read", "MedicationOrder", null, "ALLOWED", null, { count: items.length });
    return response(reply, success({ items }, context.correlationId));
  });

  app.post("/api/v1/medications/orders", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const input = parse(medicationOrderInputSchema, request.body);
    const { context } = requestContext(request, "medication.prescribe", input.patientId, input.encounterId);
    const key = header(request, "idempotency-key");
    if (!key) throw new DomainError("INVALID_INPUT", "Idempotency-Key é obrigatório.", 400);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "medication.prescribe", key, resourceId: input.patientId, unitId: context.unitId, workspaceId: context.workspaceId, body: input }, () => domainCommands.createMedicationOrder(context, input));
    audit(context, "medication.prescribe", "MedicationOrder", result.value.id, "ALLOWED");
    return response(reply, success({ order: result.value, receiptId: result.receipt.id }, context.correlationId), 201);
  });

  app.post("/api/v1/medications/orders/:id/dispense", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const medicationOrderId = id(parse(idSchema, (request.params as { id: string }).id));
    const input = parse(dispensationInputSchema.omit({ medicationOrderId: true }), request.body);
    const { context } = requestContext(request, "medication.dispense", null, null, false, false, medicationOrderId);
    const key = header(request, "idempotency-key");
    if (!key) throw new DomainError("INVALID_INPUT", "Idempotency-Key é obrigatório.", 400);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "medication.dispense", key, resourceId: medicationOrderId, unitId: context.unitId, workspaceId: context.workspaceId, body: input }, () => domainCommands.dispenseMedication(context, medicationOrderId, input.lotId, input.quantity));
    audit(context, "medication.dispense", "Dispensation", result.value.id, "ALLOWED");
    return response(reply, success({ dispensation: result.value, receiptId: result.receipt.id }, context.correlationId), 201);
  });

  app.post("/api/v1/medications/orders/:id/administer", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const medicationOrderId = id(parse(idSchema, (request.params as { id: string }).id));
    const input = parse(administrationInputSchema.omit({ medicationOrderId: true }), request.body);
    const { context } = requestContext(request, "medication.administer", null, null, false, false, medicationOrderId);
    const key = header(request, "idempotency-key");
    if (!key) throw new DomainError("INVALID_INPUT", "Idempotency-Key é obrigatório.", 400);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "medication.administer", key, resourceId: medicationOrderId, unitId: context.unitId, workspaceId: context.workspaceId, body: input }, () => domainCommands.administerMedication(context, medicationOrderId, input.status, input.note));
    audit(context, "medication.administer", "AdministrationOccurrence", result.value.id, "ALLOWED");
    return response(reply, success({ occurrence: result.value, receiptId: result.receipt.id }, context.correlationId), 201);
  });

  app.get("/api/v1/finance/charges", async (request, reply) => {
    const { context } = requestContext(request, "finance.read");
    store.requireRole(context, ["admin", "financeiro"], "finance:read");
    const items = [...store.charges.values()].filter((charge) => charge.organizationId === context.organizationId && charge.unitId === context.unitId);
    audit(context, "finance.read", "Charge", null, "ALLOWED", null, { count: items.length });
    return response(reply, success({ items }, context.correlationId));
  });

  app.post("/api/v1/finance/charges", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const input = parse(chargeInputSchema, request.body);
    const { context } = requestContext(request, "finance.charge", input.patientId, null, false, true, input.patientId);
    const key = requireIdempotencyKey(request);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "finance.charge", key, resourceId: input.patientId, unitId: context.unitId, workspaceId: context.workspaceId, body: input }, () => domainCommands.createCharge(context, input));
    audit(context, "finance.charge", "Charge", result.value.id, "ALLOWED");
    return response(reply, success({ charge: result.value, receiptId: result.receipt.id }, context.correlationId), 201);
  });

  app.post("/api/v1/finance/payments", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const input = parse(paymentInputSchema, request.body);
    const { context } = requestContext(request, "finance.payment", null, null, false, true, input.chargeId);
    const key = header(request, "idempotency-key");
    if (!key) throw new DomainError("INVALID_INPUT", "Idempotency-Key é obrigatório.", 400);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "finance.payment", key, resourceId: input.chargeId, unitId: context.unitId, workspaceId: context.workspaceId, body: input }, () => domainCommands.createPayment(context, input));
    audit(context, "finance.payment", "Payment", result.value.id, "ALLOWED");
    return response(reply, success({ payment: result.value, receiptId: result.receipt.id }, context.correlationId), 201);
  });

  app.get("/api/v1/finance/payments", async (request, reply) => {
    const { context } = requestContext(request, "finance.payments.read");
    store.requireRole(context, ["admin", "financeiro"], "finance:read");
    const items = [...store.payments.values()].filter((payment) => payment.organizationId === context.organizationId && store.charges.get(payment.chargeId)?.unitId === context.unitId);
    audit(context, "finance.payments.read", "Payment", null, "ALLOWED", null, { count: items.length });
    return response(reply, success({ items }, context.correlationId));
  });

  app.get("/api/v1/finance/ledger", async (request, reply) => {
    const { context } = requestContext(request, "finance.ledger.read");
    store.requireRole(context, ["admin", "financeiro"], "finance:read");
    const items = [...store.ledgerEntries.values()].filter((entry) => {
      if (entry.organizationId !== context.organizationId) return false;
      const chargeId = entry.kind === "CHARGE" ? entry.referenceId : entry.kind === "PAYMENT" || entry.kind === "REFUND" ? store.payments.get(entry.referenceId)?.chargeId : null;
      return chargeId ? store.charges.get(chargeId)?.unitId === context.unitId : false;
    });
    audit(context, "finance.ledger.read", "LedgerEntry", null, "ALLOWED", null, { count: items.length });
    return response(reply, success({ items }, context.correlationId));
  });

  app.post("/api/v1/finance/refunds", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const input = parse(refundInputSchema, request.body);
    const { context } = requestContext(request, "finance.refund", null, null, false, false, input.paymentId);
    const key = header(request, "idempotency-key");
    if (!key) throw new DomainError("INVALID_INPUT", "Idempotency-Key é obrigatório.", 400);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "finance.refund", key, resourceId: input.paymentId, unitId: context.unitId, workspaceId: context.workspaceId, body: input }, () => domainCommands.requestRefund(context, input.paymentId, input.reason));
    audit(context, "finance.refund", "Payment", input.paymentId, "ALLOWED", "ledger compensatório criado");
    return response(reply, success({ payment: result.value, receiptId: result.receipt.id }, context.correlationId), 202);
  });

  app.get("/api/v1/communications", async (request, reply) => {
    const { context } = requestContext(request, "communication.read");
    const items = store.listMessages(context);
    audit(context, "communication.read", "CommunicationMessage", null, "ALLOWED", null, { count: items.length });
    return response(reply, success({ items }, context.correlationId));
  });

  app.post("/api/v1/communications", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const input = parse(z.object({ patientId: idSchema.nullable().default(null), channel: z.enum(["SMS", "EMAIL", "WHATSAPP"]), recipient: z.string().trim().min(5).max(200), template: z.string().trim().min(2).max(120), body: z.string().trim().min(1).max(4_000) }).strict(), request.body);
    const { context } = requestContext(request, "communication.stage", input.patientId, null, false, true, input.patientId);
    const key = requireIdempotencyKey(request);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "communication.stage", key, resourceId: input.patientId, unitId: context.unitId, workspaceId: context.workspaceId, body: input }, () => domainCommands.createMessage(context, input));
    audit(context, "communication.stage", "CommunicationMessage", result.value.id, "ALLOWED");
    return response(reply, success({ message: result.value, receiptId: result.receipt.id }, context.correlationId), 201);
  });

  app.post("/api/v1/communications/:id/approve", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const messageId = id(parse(idSchema, (request.params as { id: string }).id));
    const { context } = requestContext(request, "communication.approve", null, null, false, false, messageId);
    const input = parse(communicationApprovalInputSchema, request.body);
    if (input.decision === "approved" && !persistence) throw new DomainError("CAPABILITY_DISABLED", "A aprovação que libera egress exige persistência durável; nenhum envio foi liberado.", 503);
    const key = requireIdempotencyKey(request);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "communication.approve", key, resourceId: messageId, unitId: context.unitId, workspaceId: context.workspaceId, body: { messageId, ...input } }, () => domainCommands.decideMessage(context, messageId, input.decision, input.reason));
    if (input.decision === "approved" && !result.replayed) {
      durableOutboxes.set(request, [{ id: id(randomUUID()), organizationId: context.organizationId, eventType: "communication.message.approved", aggregateId: messageId, payload: { source: "CVG_COMMUNICATION_APPROVAL", messageId, channel: result.value.channel, recipient: result.value.recipient, template: result.value.template, body: result.value.body } }]);
    }
    audit(context, "communication.approve", "CommunicationMessage", messageId, "ALLOWED", input.reason);
    return response(reply, success({ message: result.value, receiptId: result.receipt.id, queued: input.decision === "approved" }, context.correlationId), input.decision === "approved" ? 202 : 200);
  });

  app.get("/api/v1/knowledge", async (request, reply) => {
    const { context } = requestContext(request, "knowledge.read");
    const items = store.listKnowledgeDocuments(context).map(({ content: _content, ...doc }) => doc);
    audit(context, "knowledge.read", "KnowledgeDocument", null, "ALLOWED", null, { count: items.length });
    return response(reply, success({ items }, context.correlationId));
  });

  app.post("/api/v1/knowledge", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const { context } = requestContext(request, "knowledge.write");
    const input = parse(knowledgeDocumentInputSchema, request.body);
    const key = header(request, "idempotency-key");
    if (!key) throw new DomainError("INVALID_INPUT", "Idempotency-Key é obrigatório.", 400);
    const result = idempotent(store, { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation: "knowledge.write", key, resourceId: null, unitId: context.unitId, workspaceId: context.workspaceId, body: input }, () => domainCommands.createKnowledgeDocument(context, input));
    audit(context, "knowledge.write", "KnowledgeDocument", result.value.id, "ALLOWED", "documento aguardando validação humana");
    return response(reply, success({ document: { ...result.value, content: undefined }, receiptId: result.receipt.id }, context.correlationId), 201);
  });

  app.get("/api/v1/ai/health", async (request, reply) => {
    const { context } = requestContext(request, "ai.health");
    store.requireRole(context, ["admin", "veterinario", "recepcao"], "ai:health");
    return response(reply, success(await agentApplication.health(), context.correlationId));
  });

  app.get("/api/v1/ai/sessions", async (request, reply) => {
    const { context } = requestContext(request, "ai.sessions.read");
    store.requireRole(context, ["admin", "veterinario", "recepcao"], "ai:sessions:read");
    const items = [...store.aiSessions.values()].filter((session) => session.organizationId === context.organizationId && session.actorId === context.actorId && isInContext(session, context)).map((session) => ({ ...session, turns: [...store.aiTurns.values()].filter((turn) => turn.sessionId === session.id).length }));
    audit(context, "ai.sessions.read", "AiSession", null, "ALLOWED", null, { count: items.length });
    return response(reply, success({ items }, context.correlationId));
  });

  app.post("/api/v1/ai/turns", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const input = parse(aiTurnInputSchema, request.body);
    const { context } = requestContext(request, `ai.turn.${input.purpose}`, input.patientId, input.encounterId, false, true, input.resourceId ?? null);
    const result = await agentApplication.executeTurn(context, input);
    const turnResult = result.value;
    audit(context, "ai.turn", "AiTurn", turnResult.turn.id, turnResult.turn.status === "DENIED" ? "DENIED" : "ALLOWED", turnResult.turn.status === "QUARANTINED" ? "untrusted content quarantined" : null, { inputTokens: turnResult.turn.inputTokens, outputTokens: turnResult.turn.outputTokens, provider: turnResult.provenance.provider, replay: result.replayed });
    return response(reply, success(turnResult, context.correlationId), turnResult.approval ? 202 : 201);
  });

  app.post("/api/v1/ai/approvals/:id", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const approvalId = id(parse(idSchema, (request.params as { id: string }).id));
    const input = parse(z.object({ decision: z.enum(["allowed-once", "rejected"]), reason: z.string().trim().max(500).nullable().default(null) }).strict(), request.body) as ApprovalInput;
    const { context } = requestContext(request, "ai.approval", null, null, false, true, approvalId);
    const key = requireIdempotencyKey(request);
    const result = await agentApplication.approve(context, approvalId, input.decision, input.reason, key);
    audit(context, "ai.approval", "AiApproval", result.value.id, "ALLOWED", input.reason);
    return response(reply, success({ approval: result.value, receiptId: result.receipt.id }, context.correlationId));
  });

  app.post("/api/v1/ai/approvals/:id/retry", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const approvalId = id(parse(idSchema, (request.params as { id: string }).id));
    const input = parse(aiTurnInputSchema, request.body);
    if (input.approvalId !== approvalId) throw new DomainError("INVALID_INPUT", "approvalId deve corresponder à aprovação da rota.", 400);
    const { context } = requestContext(request, "ai.approval.retry", input.patientId, input.encounterId, false, true, input.resourceId ?? approvalId);
    const result = await agentApplication.retryTurn(context, input, approvalId);
    const turnResult = result.value;
    audit(context, "ai.approval.retry", "AiTurn", turnResult.turn.id, "ALLOWED", "dispatch revalidado após approval", { provider: turnResult.provenance.provider, replay: result.replayed });
    return response(reply, success(turnResult, context.correlationId), turnResult.approval ? 202 : 201);
  });

  app.post("/api/v1/ai/drafts/:id/promote", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const draftId = id(parse(idSchema, (request.params as { id: string }).id));
    const { context } = requestContext(request, "ai.draft.promote", null, null, false, true, draftId);
    const key = requireIdempotencyKey(request);
    const result = await agentApplication.promoteDraft(context, draftId, key);
    audit(context, "ai.draft.promote", "AiDraft", draftId, "ALLOWED", "explicit human promotion");
    return response(reply, success({ ...result.value, receiptId: result.receipt.id }, context.correlationId));
  });

  app.get("/api/v1/ai/sessions/:id/replay", async (request, reply) => {
    const sessionId = id(parse(idSchema, (request.params as { id: string }).id));
    const { context } = requestContext(request, "ai.replay", null, null, false, true, sessionId);
    const replay = await agentApplication.replay(context, sessionId);
    audit(context, "ai.replay", "AiSession", sessionId, "ALLOWED", null, { digest: replay.digest });
    return response(reply, success(replay, context.correlationId));
  });

  app.get("/api/v1/capabilities", async (request, reply) => {
    const { context } = requestContext(request, "capabilities.read");
    const capabilities = [
      { id: "identity", label: "Identidade, contexto e permissões", status: "ENABLED", roles: ["admin", "veterinario", "recepcao", "estoque", "financeiro", "operador"] },
      { id: "patients", label: "Tutores e pacientes", status: "ENABLED", roles: ["admin", "veterinario", "recepcao"] },
      { id: "agenda", label: "Agenda, fila e check-in", status: "ENABLED", roles: ["admin", "veterinario", "recepcao"] },
      { id: "clinical", label: "Prontuário e assinatura", status: "ENABLED", roles: ["veterinario"] },
      { id: "stock", label: "Estoque por lote", status: "ENABLED", roles: ["admin", "estoque"] },
      { id: "finance", label: "Ledger financeiro", status: "ENABLED", roles: ["admin", "financeiro"] },
      { id: "ai", label: "Copiloto governado", status: "ENABLED", roles: ["admin", "veterinario", "recepcao"] },
      { id: "real-providers", label: "Providers externos reais", status: "BLOCKED", roles: [] },
      { id: "real-data", label: "Dados reais / produção", status: "BLOCKED", roles: [] },
      { id: "break-glass", label: "Break-glass", status: "BLOCKED", roles: [] }
    ];
    audit(context, "capabilities.read", "Capability", null, "ALLOWED");
    return response(reply, success({ items: capabilities, integrations: integrationContracts.map(({ integrationId, status, killSwitch }) => ({ integrationId, status, killSwitch })), currentRoles: context.actorRoleSnapshot, api: { version: API_VERSION, catalogVersion: 1, catalogFingerprint: apiCatalogFingerprint(API_ROUTE_CATALOG), v2: API_V2_COMPATIBILITY } }, context.correlationId));
  });

  app.get("/api/v1/operations/summary", async (request, reply) => {
    const { context } = requestContext(request, "operations.summary");
    const appointments = store.listAppointments(context);
    const waiting = store.listQueue(context).filter((entry) => entry.status === "WAITING");
    const stock = store.listStock(context);
    const lowStock = stock.filter((item) => (item.product?.reorderPoint ?? 0) >= item.quantity);
    const openCharges = [...store.charges.values()].filter((charge) => charge.organizationId === context.organizationId && charge.unitId === context.unitId && charge.status !== "PAID" && charge.status !== "REFUNDED");
    const runtimeHealth = await agentRuntime.health();
    const summary = { appointmentsToday: appointments.length, waitingPatients: waiting.length, lowStockItems: lowStock.length, openCharges: openCharges.length, ai: { provider: runtimeHealth.capabilities.provider, tools: runtimeHealth.capabilities.toolNames.length, status: runtimeHealth.status }, unit: context.unitId ? store.units.get(context.unitId)?.name ?? "" : "Organização" };
    audit(context, "operations.summary", "Dashboard", null, "ALLOWED");
    return response(reply, success(summary, context.correlationId));
  });

  app.get("/api/v1/metrics", async (request, reply) => {
    const { context } = requestContext(request, "metrics.read");
    store.requireRole(context, ["admin", "operador"], "metrics:read");
    const receipts = [...store.commandReceipts.values()];
    let queueSignals = { outboxDepth: 0, oldestAgeMs: 0, poisonMessages: 0, reconciliationLag: 0 };
    let outboxDependency: "READY" | "UNAVAILABLE" | "NOT_CONFIGURED" = "NOT_CONFIGURED";
    let agentRuntimeStatus: "READY" | "DEGRADED" | "UNAVAILABLE" | "DISABLED" = "UNAVAILABLE";
    try { agentRuntimeStatus = (await agentRuntime.health()).status; } catch { agentRuntimeStatus = "UNAVAILABLE"; }
    if (persistence) {
      try {
        const stats = await persistence.outboxStats(context.organizationId);
        const effectStats = await persistence.externalEffectStats(context.organizationId);
        queueSignals = { ...queueSignals, outboxDepth: stats.depth, oldestAgeMs: stats.oldestAgeMs, poisonMessages: stats.poisonMessages, reconciliationLag: effectStats.reconciliationRequired };
        outboxDependency = "READY";
      } catch {
        outboxDependency = "UNAVAILABLE";
      }
    }
    audit(context, "metrics.read", "Metrics", null, "ALLOWED");
    return response(reply, success(telemetry.metrics(store.storageMode, {
      dependencies: { database: persistence ? "READY" : "NOT_CONFIGURED", auditLedger: persistence ? "READY" : "DEGRADED", secretProvider: secretProviderStatus, outbox: outboxDependency },
      queues: queueSignals,
      agentRuntime: agentRuntimeStatus,
      domain: { auditRecords: store.auditRecords.size, commandReceipts: receipts.length, unlinkedReceipts: receipts.filter((receipt) => receipt.status === "SUCCEEDED" && receipt.auditRecordId === null).length, outcomeUnknown: receipts.filter((receipt) => receipt.status === "OUTCOME_UNKNOWN").length, quarantined: store.quarantined.length }
    }), context.correlationId));
  });

  /**
   * Internal scrape boundary for the observability stack. It is intentionally
   * outside the public /api/v1 catalog, is not routed by the proxy, and emits
   * aggregate redacted metrics only; tenant data and route labels never cross
   * this boundary. Production still requires the deployment network policy and
   * collector to be exercised before any SLO claim is made.
   */
  app.get("/internal/metrics", async (_request, reply) => {
    const receipts = [...store.commandReceipts.values()];
    let queueSignals = { outboxDepth: 0, oldestAgeMs: 0, poisonMessages: 0, reconciliationLag: 0 };
    let database: "READY" | "UNAVAILABLE" | "NOT_CONFIGURED" = persistence ? "READY" : "NOT_CONFIGURED";
    let outboxDependency: "READY" | "UNAVAILABLE" | "NOT_CONFIGURED" = "NOT_CONFIGURED";
    try {
      const agentHealth = await agentRuntime.health();
      if (persistence) {
        await persistence.check();
        const stats = await persistence.outboxStats(store.bootstrapCredentials.organizationId);
        const effectStats = await persistence.externalEffectStats(store.bootstrapCredentials.organizationId);
        queueSignals = { outboxDepth: stats.depth, oldestAgeMs: stats.oldestAgeMs, poisonMessages: stats.poisonMessages, reconciliationLag: effectStats.reconciliationRequired };
        outboxDependency = "READY";
      }
      const metrics = telemetry.metrics(store.storageMode, {
        agentRuntime: agentHealth.status,
        dependencies: { database, auditLedger: persistence ? "READY" : "DEGRADED", secretProvider: secretProviderStatus, outbox: outboxDependency },
        queues: queueSignals,
        domain: { auditRecords: store.auditRecords.size, commandReceipts: receipts.length, unlinkedReceipts: receipts.filter((receipt) => receipt.status === "SUCCEEDED" && receipt.auditRecordId === null).length, outcomeUnknown: receipts.filter((receipt) => receipt.status === "OUTCOME_UNKNOWN").length, quarantined: store.quarantined.length }
      });
      return reply.type("text/plain; version=0.0.4").header("cache-control", "no-store").send(renderPrometheusMetrics(metrics));
    } catch {
      database = persistence ? "UNAVAILABLE" : "NOT_CONFIGURED";
      const metrics = telemetry.metrics(store.storageMode, {
        agentRuntime: "UNAVAILABLE",
        dependencies: { database, auditLedger: persistence ? "UNAVAILABLE" : "DEGRADED", secretProvider: secretProviderStatus, outbox: "UNAVAILABLE" },
        queues: queueSignals,
        domain: { auditRecords: store.auditRecords.size, commandReceipts: receipts.length, unlinkedReceipts: receipts.filter((receipt) => receipt.status === "SUCCEEDED" && receipt.auditRecordId === null).length, outcomeUnknown: receipts.filter((receipt) => receipt.status === "OUTCOME_UNKNOWN").length, quarantined: store.quarantined.length }
      });
      return reply.type("text/plain; version=0.0.4").header("cache-control", "no-store").send(renderPrometheusMetrics(metrics));
    }
  });

  app.get("/api/v1/ops/snapshot", async (request, reply) => {
    const { context } = requestContext(request, "ops.snapshot");
    store.requireRole(context, ["admin"], "ops:snapshot");
    if (config.storageMode !== "memory") throw new DomainError("CAPABILITY_DISABLED", "Snapshot de demonstração só existe no modo sintético.", 403);
    const snapshot = store.snapshot();
    const serialized = JSON.parse(serializeSnapshot(snapshot)) as StoreSnapshot;
    audit(context, "ops.snapshot", "Snapshot", null, "ALLOWED");
    return response(reply, success({ schemaVersion: 1, createdAt: now(), digest: digest(serialized), redacted: true, snapshot: { organizations: serialized.organizations.map((organization) => ({ id: organization.id, name: organization.name, status: organization.status, authorizationRevision: organization.authorizationRevision })), counts: { units: serialized.units.length, workspaces: serialized.workspaces.length, users: serialized.users.length, patients: serialized.patients.length, auditRecords: serialized.auditRecords.length, commandReceipts: serialized.commandReceipts.length, quarantined: serialized.quarantined.length } } }, context.correlationId));
  });

  app.post("/api/v1/ops/export", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const { context } = requestContext(request, "ops.export");
    store.requireRole(context, ["admin"], "ops:export");
    const input = parse(governedExportInputSchema, request.body);
    const idempotencyKey = requireIdempotencyKey(request);
    const result = await exportApplication.create(context, input, idempotencyKey);
    audit(context, "ops.export", "RecoveryBundle", result.value.exportId, "ALLOWED", null, { purposeDigest: result.value.purposeDigest, expiresAt: result.value.expiresAt, payloadDigest: result.value.envelope.payloadDigest, exportDigest: governedExportDigest(result.value) });
    return response(reply, success({ ...result.value, receiptId: result.receipt.id, replayed: result.replayed }, context.correlationId), 201);
  });

  app.post("/api/v1/ops/restore", async (request, reply) => {
    const session = requireSession(request); requireCsrf(request, session);
    const { context } = requestContext(request, "ops.restore");
    store.requireRole(context, ["admin"], "ops:restore");
    if (config.storageMode !== "memory") throw new DomainError("CAPABILITY_DISABLED", "Restore de demonstração só existe no modo sintético.", 403);
    const body = request.body as { snapshot?: StoreSnapshot };
    if (!body?.snapshot) throw new DomainError("INVALID_INPUT", "Snapshot ausente.", 400);
    domainCommands.restore(context, parseSnapshot(JSON.stringify(body.snapshot)));
    audit(context, "ops.restore", "Snapshot", null, "ALLOWED", "restore completed only into quarantine");
    return response(reply, success({ status: store.healthStatus, loginBlocked: true, sessionsInvalidated: true, reason: "journal independente e autoridade corrente são necessários antes da liberação" }, context.correlationId), 202);
  });

  app.setNotFoundHandler((request, reply) => response(reply, failure("NOT_FOUND", "Recurso não encontrado.", correlationId(request)), 404));
  app.setErrorHandler((error, request, reply) => {
    const corr = correlationId(request);
    let code: ErrorCode = "INTERNAL_ERROR";
    let status = 500;
    let message = "Não foi possível concluir a operação.";
    let details: Record<string, unknown> | undefined;
    if (error instanceof DomainError) {
      code = (error.code as ErrorCode) || "INTERNAL_ERROR";
      status = error.statusCode;
      message = error.message;
      details = error.details;
    } else if (error instanceof PersistenceSignatureError) {
      code = "FORBIDDEN";
      status = 403;
      message = "A assinatura do evento externo não foi validada.";
    } else if (error instanceof PersistenceCorruptionError) {
      code = "QUARANTINED";
      status = 503;
      message = "O estado persistido foi colocado em quarentena e requer reconciliação.";
    } else if (error instanceof PersistenceConflictError) {
      code = "CONFLICT";
      status = 409;
      message = "O estado persistido mudou durante a operação; recarregue o contexto.";
    } else if (error instanceof PersistenceUnavailableError) {
      code = "DEPENDENCY_UNAVAILABLE";
      status = 503;
      message = "A dependência durável está indisponível; nenhum sucesso deve ser inferido.";
    } else if (error instanceof PersistenceStateError) {
      code = "INVALID_STATE";
      status = 409;
      message = "A operação não é válida para o estado persistido atual.";
    } else if (error instanceof AgentRuntimeUnavailableError) {
      code = "DEPENDENCY_UNAVAILABLE";
      status = 503;
      message = "O Agent Runtime está indisponível; nenhum turno ou efeito externo foi confirmado.";
    } else if (error instanceof z.ZodError) {
      code = "INVALID_INPUT";
      status = 400;
      message = "A entrada não atende ao contrato desta operação.";
      details = { issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })) };
    } else {
      const maybe = error as { validation?: unknown; statusCode?: number; message?: string };
      if (maybe.validation) { code = "INVALID_INPUT"; status = 400; message = "A entrada não atende ao contrato desta operação."; }
    }
    const rawSession = request.cookies[SESSION_COOKIE];
    const session = rawSession ? store.findSession(tokenDigest(rawSession)) : undefined;
    if (session && status >= 400) {
      store.recordAudit({ organizationId: session.organizationId, actorId: session.userId, unitId: null, workspaceId: null, action: "request.error", resourceType: "HTTP", resourceId: null, result: status === 403 || status === 401 ? "DENIED" : "ERROR", reason: code, correlationId: corr, metadata: { status, code } });
    }
    telemetry.log({ timestamp: now(), level: status >= 500 ? "error" : "warn", event: "http.request", correlationId: corr, actorId: session?.userId ?? null, metadata: { status, code } });
    return response(reply, failure(code, message, corr, details), status);
  });

  const runOutboxOnce = async (organizationId: OpaqueId, workerId: string, sink?: OutboxSink, workerOptions: { limit?: number; leaseSeconds?: number; maxAttempts?: number } = {}): Promise<OutboxWorkerResult> => {
    if (!persistence) throw new DomainError("CAPABILITY_DISABLED", "O worker durável exige persistência PostgreSQL.", 503);
    const selectedSink = sink ?? options.outboxSink;
    if (!selectedSink) throw new DomainError("CAPABILITY_DISABLED", "Nenhum sink externo foi configurado; nenhum dispatch foi realizado.", 503);
    return new OutboxWorker(persistence, persistence).runOnce(organizationId, workerId, selectedSink, workerOptions);
  };

  const reconcileExternalEffect = async (organizationId: OpaqueId, effectId: OpaqueId, adapter?: ExternalEffectQueryAdapter, queryOptions: { timeoutMs?: number } = {}): Promise<DurableExternalEffectRecord> => {
    if (!persistence) throw new DomainError("CAPABILITY_DISABLED", "A reconciliação durável exige persistência PostgreSQL.", 503);
    const selectedAdapter = adapter ?? options.providerQueryAdapter;
    if (!selectedAdapter) throw new DomainError("CAPABILITY_DISABLED", "Nenhum query adapter externo foi configurado; não há confirmação a inferir.", 503);
    return reconcileUnknownExternalEffect(persistence, organizationId, effectId, selectedAdapter, queryOptions);
  };

  return { app, store, agentRuntime, telemetry, integrations, persistence, config, runOutboxOnce, reconcileExternalEffect };
}

export async function startServer(options: ServerOptions = {}): Promise<CvgServerRuntime> {
  const runtime = await createRuntime(options);
  await runtime.app.listen({ host: runtime.config.host, port: runtime.config.port });
  return runtime;
}
