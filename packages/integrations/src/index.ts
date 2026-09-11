import type { OpaqueId } from "@cvg/contracts";
import { DomainError, digest, makeId, now } from "@cvg/domain";
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import { join, resolve, sep } from "node:path";
import type { DurableExternalEffectInput, DurableExternalEffectOutcome, DurableExternalEffectRecord, DurableExternalReconciliationEvidence, DurableInboxInput, DurableOutboxInput, DurableOutboxRecord, PostgresPersistence } from "@cvg/persistence";

export interface IntegrationContract {
  integrationId: string;
  owner: string;
  purpose: string;
  sourceOfTruth: string;
  serviceIdentity: string;
  credentialRef: string | null;
  allowedScopes: string[];
  endpointAndRegion: string | null;
  apiVersion: string | null;
  timeoutMs: number;
  retryBudget: number;
  idempotencyKey: string;
  dataClasses: string[];
  killSwitch: boolean;
  status: "PROPOSED" | "ENABLED" | "DISABLED" | "QUARANTINED";
}

export type SecretProviderStatus = "READY" | "UNAVAILABLE" | "NOT_CONFIGURED" | "DEGRADED";
export type SecretProviderKind = "none" | "env" | "file" | "docker" | "vault" | "aws" | "gcp" | "azure" | "kubernetes";

/**
 * A provider exposes only the ability to resolve an approved reference. The
 * gateway never stores or returns the secret value, and an integration still
 * owns the actual authenticated transport in its provider adapter.
 */
export interface SecretProvider {
  status(): SecretProviderStatus;
  has(reference: string): boolean;
  resolve?(reference: string): Promise<string | null>;
}

const secretReferencePattern = /^[A-Za-z0-9._:-]{1,160}$/;

/**
 * Checks a reference at the same boundary used by real dispatches. The value
 * is deliberately reduced to a boolean so health/readiness cannot disclose
 * secret material or provider-specific errors.
 */
export async function isSecretReferenceUsable(provider: SecretProvider | null, reference: string | null): Promise<boolean> {
  if (!provider || provider.status() !== "READY" || !reference || !secretReferencePattern.test(reference) || !provider.resolve) return false;
  try {
    if (!provider.has(reference)) return false;
    const value = await provider.resolve(reference);
    return typeof value === "string" && value.trim().length > 0;
  } catch {
    return false;
  }
}

/** Synthetic-only reference registry for tests and local wiring. */
export class StaticSecretProvider implements SecretProvider {
  private readonly references: ReadonlySet<string>;

  constructor(references: readonly string[]) {
    this.references = new Set(references.filter((reference) => /^[A-Za-z0-9._:-]{1,160}$/.test(reference)));
  }

  status(): SecretProviderStatus {
    return this.references.size ? "READY" : "UNAVAILABLE";
  }

  has(reference: string): boolean {
    return this.references.has(reference);
  }

  async resolve(reference: string): Promise<string | null> {
    void reference;
    return null;
  }
}

/**
 * Explicit fail-closed marker for provider kinds whose adapter is not present
 * in this checkout. Keeping the configured kind visible prevents a missing
 * Vault/cloud adapter from looking like an ordinary empty local registry.
 */
export class UnsupportedSecretProvider implements SecretProvider {
  readonly reason = "SECRET_PROVIDER_ADAPTER_UNAVAILABLE" as const;

  constructor(readonly kind: Exclude<SecretProviderKind, "none" | "env" | "file" | "docker">) {}

  status(): SecretProviderStatus {
    return "UNAVAILABLE";
  }

  has(_reference: string): boolean {
    return false;
  }

  async resolve(_reference: string): Promise<string | null> {
    return null;
  }
}

/** Reads only explicitly named CVG_SECRET_* environment variables. */
export class EnvironmentSecretProvider implements SecretProvider {
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env, private readonly prefix = "CVG_SECRET_") {}

  status(): SecretProviderStatus {
    return Object.entries(this.environment).some(([key, value]) => key.startsWith(this.prefix) && typeof value === "string" && value.length > 0) ? "READY" : "NOT_CONFIGURED";
  }

  has(reference: string): boolean {
    return this.key(reference) in this.environment && Boolean(this.environment[this.key(reference)]);
  }

  async resolve(reference: string): Promise<string | null> {
    if (!this.has(reference)) return null;
    return this.environment[this.key(reference)] ?? null;
  }

  private key(reference: string): string {
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(reference)) return "__INVALID_SECRET_REFERENCE__";
    return `${this.prefix}${reference.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
  }
}

/** Reads one secret file below an explicitly configured directory; traversal is rejected. */
export class FileSecretProvider implements SecretProvider {
  private readonly root: string;

  constructor(rootDirectory: string) {
    this.root = resolve(rootDirectory);
  }

  status(): SecretProviderStatus {
    return existsSync(this.root) ? "DEGRADED" : "NOT_CONFIGURED";
  }

  has(reference: string): boolean {
    const file = this.file(reference);
    if (file === null || !existsSync(file)) return false;
    try {
      return readFileSync(file, "utf8").trim().length > 0;
    } catch {
      return false;
    }
  }

  async resolve(reference: string): Promise<string | null> {
    const file = this.file(reference);
    if (!file || !existsSync(file)) return null;
    return readFileSync(file, "utf8").trim() || null;
  }

  private file(reference: string): string | null {
    if (!secretReferencePattern.test(reference)) return null;
    const file = resolve(join(this.root, reference));
    return file === this.root || file.startsWith(`${this.root}${sep}`) ? file : null;
  }
}

/** Reads Docker/OCI secrets from a dedicated mounted directory. Availability of
 * the provider is separate from availability of each named secret. */
export class DockerSecretProvider implements SecretProvider {
  private readonly root: string;
  private readonly files: FileSecretProvider;

  constructor(rootDirectory = "/run/secrets/cvg") {
    this.root = resolve(rootDirectory);
    this.files = new FileSecretProvider(this.root);
  }

  status(): SecretProviderStatus {
    return existsSync(this.root) ? "READY" : "NOT_CONFIGURED";
  }

  has(reference: string): boolean {
    return this.files.has(reference);
  }

  resolve(reference: string): Promise<string | null> {
    return this.files.resolve(reference);
  }
}

export function configuredSecretProvider(kind: SecretProviderKind, environment: NodeJS.ProcessEnv = process.env, fileRoot = environment.CVG_SECRET_DIR ?? "/run/secrets/cvg"): SecretProvider | null {
  if (kind === "none") return null;
  if (kind === "env") return new EnvironmentSecretProvider(environment);
  if (kind === "file") return new FileSecretProvider(fileRoot);
  if (kind === "docker") return new DockerSecretProvider(fileRoot);
  return new UnsupportedSecretProvider(kind);
}

/** Provider-neutral message input. A caller may use `recipient`/`body` or the
 * transport-friendly aliases `to`/`content`; exactly one value per field is
 * required at runtime. The provider never logs these fields. */
export interface MessagingSendRequest {
  idempotencyKey: string;
  channel: "SMS" | "EMAIL" | "WHATSAPP";
  recipient?: string;
  to?: string;
  body?: string;
  content?: string;
  requestId?: string;
  metadata?: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface MessagingQueryRequest {
  requestId?: string;
  providerRequestId?: string | null;
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface MessagingReceipt {
  providerRequestId: string;
  providerMessageId: string;
  status: "ACCEPTED" | "DELIVERED";
  receivedAt: string;
  receiptDigest: string;
}

export interface MessagingSendDelivered {
  status: "DELIVERED";
  requestId: string;
  providerRequestId: string;
  receipt: MessagingReceipt;
}

export interface MessagingSendUnknown {
  status: "OUTCOME_UNKNOWN";
  requestId: string;
  providerRequestId: string | null;
  reason: string;
}

export type MessagingSendResult = MessagingSendDelivered | MessagingSendUnknown;
export type MessagingQueryStatus = "SUCCEEDED" | "PENDING" | "FAILED" | "OUTCOME_UNKNOWN";

export interface MessagingQueryResult {
  status: MessagingQueryStatus;
  requestId: string | null;
  providerRequestId: string | null;
  receipt: MessagingReceipt | null;
  error: string | null;
}

export type MessagingCallbackPayload = string | Uint8Array | Readonly<Record<string, unknown>>;
export type MessagingSecretResolver = (reference: string) => Promise<string | null>;

/** The only transport seam used by HttpMessagingProvider; tests inject it. */
export interface MessagingHttpResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers?: { get?(name: string): string | null } | Readonly<Record<string, string | undefined>>;
  /** Native fetch responses expose text(); injected transports may provide only json(). */
  text?(): Promise<string>;
  json(): Promise<unknown>;
}

export type MessagingFetch = (input: string, init?: RequestInit) => Promise<MessagingHttpResponse>;

export type MessagingFailure = "CONFIGURATION" | "CREDENTIAL" | "RATE_LIMITED" | "CIRCUIT_OPEN" | "TIMEOUT" | "TRANSPORT" | "INVALID_RESPONSE" | "CANCELLED" | "CONFLICT";
export type MessagingFailureOutcome = "NOT_SENT" | "OUTCOME_UNKNOWN";

export function redactMessagingError(error: unknown, sensitiveValues: readonly string[] = []): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "messaging provider error";
  let safe = raw || "messaging provider error";
  for (const value of sensitiveValues) {
    if (value) safe = safe.split(value).join("[REDACTED]");
  }
  safe = safe
    .replace(/bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/(authorization|token|secret|password|credential|api[-_]?key)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[REDACTED]")
    .replace(/https?:\/\/[^\s]+/gi, "[REDACTED_URL]")
    .replace(/[\r\n\t]/g, " ")
    .trim();
  return safe.slice(0, 240) || "messaging provider error";
}

function safeMessagingDetails(details: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const allowed = new Set(["retryAfterMs", "status", "state", "requestId", "providerRequestId", "failure"]);
  const safe = Object.fromEntries(Object.entries(details).filter(([key, value]) => allowed.has(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null)));
  return Object.keys(safe).length ? safe : undefined;
}

function defaultMessagingErrorCode(failure: MessagingFailure): { code: string; statusCode: number; outcome: MessagingFailureOutcome } {
  if (failure === "CONFIGURATION") return { code: "CAPABILITY_DISABLED", statusCode: 503, outcome: "NOT_SENT" };
  if (failure === "CREDENTIAL") return { code: "CREDENTIAL_UNAVAILABLE", statusCode: 503, outcome: "NOT_SENT" };
  if (failure === "RATE_LIMITED") return { code: "RATE_LIMITED", statusCode: 429, outcome: "NOT_SENT" };
  if (failure === "CIRCUIT_OPEN") return { code: "DEPENDENCY_UNAVAILABLE", statusCode: 503, outcome: "NOT_SENT" };
  if (failure === "CONFLICT") return { code: "IDEMPOTENCY_CONFLICT", statusCode: 409, outcome: "NOT_SENT" };
  if (failure === "CANCELLED") return { code: "OUTCOME_UNKNOWN", statusCode: 499, outcome: "OUTCOME_UNKNOWN" };
  if (failure === "TIMEOUT" || failure === "TRANSPORT") return { code: "OUTCOME_UNKNOWN", statusCode: 503, outcome: "OUTCOME_UNKNOWN" };
  return { code: "INVALID_STATE", statusCode: 502, outcome: "OUTCOME_UNKNOWN" };
}

export class MessagingProviderError extends DomainError {
  readonly failure: MessagingFailure;
  readonly outcome: MessagingFailureOutcome;

  constructor(failure: MessagingFailure, message: string, options: { details?: Record<string, unknown>; code?: string; statusCode?: number; outcome?: MessagingFailureOutcome } = {}) {
    const defaults = defaultMessagingErrorCode(failure);
    super(options.code ?? defaults.code, redactMessagingError(message), options.statusCode ?? defaults.statusCode, safeMessagingDetails(options.details));
    this.failure = failure;
    this.outcome = options.outcome ?? defaults.outcome;
  }
}

export interface MessagingRateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface MessagingRateLimiterOptions {
  maxRequests?: number;
  windowMs?: number;
  now?: () => number;
}

/** Small in-process limiter. Durable/distributed throttling remains an ops seam. */
export class MessagingRateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly clock: () => number;

  constructor(options: MessagingRateLimiterOptions = {}) {
    this.maxRequests = positiveInteger(options.maxRequests ?? 10, "maxRequests");
    this.windowMs = positiveInteger(options.windowMs ?? 1_000, "windowMs");
    this.clock = options.now ?? Date.now;
  }

  tryAcquire(key = "provider", atMs = this.clock()): MessagingRateLimitDecision {
    const bucketKey = key.trim() || "provider";
    const cutoff = atMs - this.windowMs;
    const active = (this.buckets.get(bucketKey) ?? []).filter((timestamp) => timestamp > cutoff);
    if (active.length >= this.maxRequests) {
      const oldest = active[0] ?? atMs;
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(1, this.windowMs - Math.max(0, atMs - oldest)) };
    }
    active.push(atMs);
    this.buckets.set(bucketKey, active);
    return { allowed: true, remaining: Math.max(0, this.maxRequests - active.length), retryAfterMs: 0 };
  }

  reset(key?: string): void {
    if (key === undefined) this.buckets.clear();
    else this.buckets.delete(key);
  }
}

export type MessagingCircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface MessagingCircuitDecision {
  allowed: boolean;
  state: MessagingCircuitState;
  retryAfterMs: number;
}

export interface MessagingCircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
}

/** Explicit single-process circuit state; a distributed breaker is a deployment seam. */
export class MessagingCircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly clock: () => number;
  private state: MessagingCircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private halfOpenInFlight = false;

  constructor(options: MessagingCircuitBreakerOptions = {}) {
    this.failureThreshold = positiveInteger(options.failureThreshold ?? 3, "failureThreshold");
    this.cooldownMs = positiveInteger(options.cooldownMs ?? 30_000, "cooldownMs");
    this.clock = options.now ?? Date.now;
  }

  beforeRequest(atMs = this.clock()): MessagingCircuitDecision {
    if (this.state === "CLOSED") return { allowed: true, state: this.state, retryAfterMs: 0 };
    if (this.state === "OPEN") {
      const openedAt = this.openedAt ?? atMs;
      const elapsed = Math.max(0, atMs - openedAt);
      if (elapsed < this.cooldownMs) return { allowed: false, state: this.state, retryAfterMs: this.cooldownMs - elapsed };
      this.state = "HALF_OPEN";
      this.halfOpenInFlight = true;
      return { allowed: true, state: this.state, retryAfterMs: 0 };
    }
    if (this.halfOpenInFlight) return { allowed: false, state: this.state, retryAfterMs: this.cooldownMs };
    this.halfOpenInFlight = true;
    return { allowed: true, state: this.state, retryAfterMs: 0 };
  }

  recordSuccess(): void {
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.halfOpenInFlight = false;
  }

  recordFailure(atMs = this.clock()): void {
    this.halfOpenInFlight = false;
    if (this.state === "HALF_OPEN" || this.consecutiveFailures + 1 >= this.failureThreshold) {
      this.state = "OPEN";
      this.openedAt = atMs;
      this.consecutiveFailures = this.failureThreshold;
      return;
    }
    this.consecutiveFailures += 1;
  }

  status(): { state: MessagingCircuitState; consecutiveFailures: number; retryAfterMs: number } {
    const decision = this.beforeStatus();
    return { state: decision.state, consecutiveFailures: this.consecutiveFailures, retryAfterMs: decision.retryAfterMs };
  }

  private beforeStatus(): MessagingCircuitDecision {
    if (this.state !== "OPEN") return { allowed: true, state: this.state, retryAfterMs: 0 };
    const elapsed = Math.max(0, this.clock() - (this.openedAt ?? this.clock()));
    return { allowed: elapsed >= this.cooldownMs, state: this.state, retryAfterMs: Math.max(0, this.cooldownMs - elapsed) };
  }
}

export interface MessagingProviderControlOptions {
  rateLimiter?: MessagingRateLimiter | null;
  rateLimit?: MessagingRateLimiterOptions;
  circuitBreaker?: MessagingCircuitBreaker | null;
  circuit?: MessagingCircuitBreakerOptions;
  now?: () => number;
}

interface MessagingControls {
  rateLimiter: MessagingRateLimiter | null;
  circuitBreaker: MessagingCircuitBreaker | null;
}

function createMessagingControls(options: MessagingProviderControlOptions): MessagingControls {
  const clock = options.now ?? Date.now;
  const rateLimiter = options.rateLimiter === undefined ? new MessagingRateLimiter({ ...options.rateLimit, now: clock }) : options.rateLimiter;
  const circuitBreaker = options.circuitBreaker === undefined ? new MessagingCircuitBreaker({ ...options.circuit, now: clock }) : options.circuitBreaker;
  return { rateLimiter, circuitBreaker };
}

function admitMessagingRequest(controls: MessagingControls, requestId: string): void {
  const rate = controls.rateLimiter?.tryAcquire("messaging");
  if (rate && !rate.allowed) throw new MessagingProviderError("RATE_LIMITED", "message provider rate limit reached", { details: { requestId, retryAfterMs: rate.retryAfterMs } });
  const circuit = controls.circuitBreaker?.beforeRequest();
  if (circuit && !circuit.allowed) throw new MessagingProviderError("CIRCUIT_OPEN", "message provider circuit is open", { details: { requestId, state: circuit.state, retryAfterMs: circuit.retryAfterMs } });
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

function boundedTimeout(value: number | undefined, fallback: number): number {
  const selected = value ?? fallback;
  if (!Number.isFinite(selected) || selected <= 0) throw new DomainError("INVALID_INPUT", "O deadline do provider deve ser positivo.", 400);
  return Math.min(30_000, Math.max(1, Math.trunc(selected)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedIdentifier(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) throw new DomainError("INVALID_INPUT", `${field} possui formato inválido.`, 400);
  return value;
}

function normalizedSendRequest(request: MessagingSendRequest, defaultTimeoutMs = 5_000): { requestId: string | null; idempotencyKey: string; channel: MessagingSendRequest["channel"]; recipient: string; body: string; metadata: Readonly<Record<string, unknown>> | null; signal: AbortSignal | null; timeoutMs: number } {
  if (!request || typeof request !== "object") throw new DomainError("INVALID_INPUT", "A mensagem do provider é inválida.", 400);
  const idempotencyKey = typeof request.idempotencyKey === "string" ? request.idempotencyKey.trim() : "";
  if (!idempotencyKey || idempotencyKey.length > 128 || /[\r\n]/.test(idempotencyKey)) throw new DomainError("INVALID_INPUT", "A chave de idempotência da mensagem é inválida.", 400);
  if (request.channel !== "SMS" && request.channel !== "EMAIL" && request.channel !== "WHATSAPP") throw new DomainError("INVALID_INPUT", "O canal da mensagem é inválido.", 400);
  const recipient = request.recipient ?? request.to;
  const aliasRecipient = request.recipient !== undefined && request.to !== undefined ? request.recipient === request.to : true;
  const body = request.body ?? request.content;
  const aliasBody = request.body !== undefined && request.content !== undefined ? request.body === request.content : true;
  if (!aliasRecipient || typeof recipient !== "string" || !recipient.trim() || recipient.length > 320 || /[\r\n]/.test(recipient)) throw new DomainError("INVALID_INPUT", "O destinatário da mensagem é inválido.", 400);
  if (!aliasBody || typeof body !== "string" || !body.trim() || body.length > 20_000) throw new DomainError("INVALID_INPUT", "O corpo da mensagem é inválido.", 400);
  if (request.metadata !== undefined && !isRecord(request.metadata)) throw new DomainError("INVALID_INPUT", "Os metadados da mensagem são inválidos.", 400);
  const requestId = boundedIdentifier(request.requestId, "requestId");
  if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) throw new DomainError("INVALID_INPUT", "O sinal da mensagem é inválido.", 400);
  return { requestId, idempotencyKey, channel: request.channel, recipient: recipient.trim(), body, metadata: request.metadata ?? null, signal: request.signal ?? null, timeoutMs: boundedTimeout(request.timeoutMs, defaultTimeoutMs) };
}

function normalizedQueryRequest(request: MessagingQueryRequest, defaultTimeoutMs = 5_000): { requestId: string | null; providerRequestId: string | null; idempotencyKey: string | null; signal: AbortSignal | null; timeoutMs: number } {
  if (!request || typeof request !== "object") throw new DomainError("INVALID_INPUT", "A consulta do provider é inválida.", 400);
  const requestId = boundedIdentifier(request.requestId, "requestId");
  const providerRequestId = boundedIdentifier(request.providerRequestId, "providerRequestId");
  const idempotencyKey = request.idempotencyKey === undefined ? null : typeof request.idempotencyKey === "string" && request.idempotencyKey.trim().length <= 128 && !/[\r\n]/.test(request.idempotencyKey) ? request.idempotencyKey.trim() || null : null;
  if (!requestId && !providerRequestId && !idempotencyKey) throw new DomainError("INVALID_INPUT", "A consulta precisa de uma identidade de mensagem.", 400);
  if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) throw new DomainError("INVALID_INPUT", "O sinal da consulta é inválido.", 400);
  return { requestId, providerRequestId, idempotencyKey, signal: request.signal ?? null, timeoutMs: boundedTimeout(request.timeoutMs, defaultTimeoutMs) };
}

function deterministicRequestId(prefix: "msg" | "query", idempotencyKey: string): string {
  return `${prefix}-${digest({ idempotencyKey }).slice(0, 32)}`;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 80 && !Number.isNaN(Date.parse(value));
}

function normalizeMessagingReceipt(raw: unknown, providerRequestIdHint: string | null = null): MessagingReceipt {
  if (!isRecord(raw)) throw new MessagingProviderError("INVALID_RESPONSE", "provider receipt is not an object");
  const rawProviderRequestId = raw.providerRequestId;
  if (rawProviderRequestId !== undefined && typeof rawProviderRequestId !== "string") throw new MessagingProviderError("INVALID_RESPONSE", "provider receipt request id is invalid");
  if (providerRequestIdHint && typeof rawProviderRequestId === "string" && rawProviderRequestId !== providerRequestIdHint) throw new MessagingProviderError("INVALID_RESPONSE", "provider receipt request id does not match the response");
  const providerRequestId = providerRequestIdHint ?? (typeof rawProviderRequestId === "string" ? rawProviderRequestId : null);
  const providerMessageId = typeof raw.providerMessageId === "string" ? raw.providerMessageId : typeof raw.messageId === "string" ? raw.messageId : null;
  const status = raw.status;
  const receivedAt = raw.receivedAt ?? raw.observedAt;
  if (!providerRequestId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(providerRequestId) || !providerMessageId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(providerMessageId) || (status !== "ACCEPTED" && status !== "DELIVERED") || !validTimestamp(receivedAt)) throw new MessagingProviderError("INVALID_RESPONSE", "provider receipt failed schema validation");
  return { providerRequestId, providerMessageId, status, receivedAt, receiptDigest: digest({ providerRequestId, providerMessageId, status, receivedAt }) };
}

function callbackBytes(payload: MessagingCallbackPayload): Uint8Array | null {
  try {
    if (typeof payload === "string") return new TextEncoder().encode(payload);
    if (payload instanceof Uint8Array) return payload;
    return new TextEncoder().encode(JSON.stringify(payload));
  } catch {
    return null;
  }
}

export function verifyMessagingCallback(payload: MessagingCallbackPayload, signature: string, secret: string): boolean {
  if (typeof signature !== "string" || !secret || typeof secret !== "string") return false;
  const bytes = callbackBytes(payload);
  if (!bytes) return false;
  const provided = signature.trim().replace(/^sha256=/i, "");
  if (!/^[a-f0-9]{64}$/i.test(provided)) return false;
  const expected = createHmac("sha256", secret).update(bytes).digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");
  const providedBytes = Buffer.from(provided, "hex");
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

export interface SyntheticMessagingProviderOptions extends MessagingProviderControlOptions {
  clock?: () => string;
  sendOutcome?: "DELIVERED" | "OUTCOME_UNKNOWN";
}

export interface MessagingProvider {
  send(request: MessagingSendRequest): Promise<MessagingSendResult>;
  queryStatus(request: MessagingQueryRequest): Promise<MessagingQueryResult>;
  query(request: MessagingQueryRequest): Promise<MessagingQueryResult>;
  normalizeReceipt(raw: unknown, providerRequestId?: string): MessagingReceipt;
  verifyCallback(payload: MessagingCallbackPayload, signature: string, secret: string): boolean;
}

interface SyntheticMessageRecord {
  requestDigest: string;
  requestId: string;
  result: MessagingSendDelivered;
}

const SYNTHETIC_TIMESTAMP = "2026-01-01T00:00:00.000Z";

/** Deterministic provider with no network/effect egress; useful for contract tests. */
export class SyntheticMessagingProvider implements MessagingProvider {
  private readonly records = new Map<string, SyntheticMessageRecord>();
  private readonly byRequestId = new Map<string, SyntheticMessageRecord>();
  private readonly byProviderRequestId = new Map<string, SyntheticMessageRecord>();
  private readonly controls: MessagingControls;
  private readonly clock: () => string;
  private readonly sendOutcome: "DELIVERED" | "OUTCOME_UNKNOWN";

  constructor(options: SyntheticMessagingProviderOptions = {}) {
    this.controls = createMessagingControls(options);
    this.clock = options.clock ?? (() => SYNTHETIC_TIMESTAMP);
    this.sendOutcome = options.sendOutcome ?? "DELIVERED";
  }

  async send(request: MessagingSendRequest): Promise<MessagingSendResult> {
    const normalized = normalizedSendRequest(request);
    const requestId = normalized.requestId ?? deterministicRequestId("msg", normalized.idempotencyKey);
    const requestDigest = digest({ idempotencyKey: normalized.idempotencyKey, channel: normalized.channel, recipient: normalized.recipient, body: normalized.body, metadata: normalized.metadata });
    const existing = this.records.get(normalized.idempotencyKey);
    if (existing) {
      if (existing.requestDigest !== requestDigest) throw new DomainError("IDEMPOTENCY_CONFLICT", "A chave de idempotência já foi usada com conteúdo diferente.", 409);
      return this.resultFor(existing.result);
    }
    admitMessagingRequest(this.controls, requestId);
    if (normalized.signal?.aborted) throw new MessagingProviderError("CANCELLED", "message send was cancelled before dispatch");
    const providerRequestId = `synthetic-request-${digest({ idempotencyKey: normalized.idempotencyKey }).slice(0, 24)}`;
    const providerMessageId = `synthetic-message-${digest({ idempotencyKey: normalized.idempotencyKey, requestDigest }).slice(0, 24)}`;
    const receipt = this.normalizeReceipt({ providerRequestId, providerMessageId, status: "DELIVERED", receivedAt: this.clock() }, providerRequestId);
    const delivered: MessagingSendDelivered = { status: "DELIVERED", requestId, providerRequestId, receipt };
    const stored: SyntheticMessageRecord = { requestDigest, requestId, result: delivered };
    this.records.set(normalized.idempotencyKey, stored);
    this.byRequestId.set(requestId, stored);
    this.byProviderRequestId.set(providerRequestId, stored);
    if (this.sendOutcome === "OUTCOME_UNKNOWN") {
      this.controls.circuitBreaker?.recordFailure();
      return { status: "OUTCOME_UNKNOWN", requestId, providerRequestId, reason: "synthetic response withheld; query is required" };
    }
    this.controls.circuitBreaker?.recordSuccess();
    return delivered;
  }

  async queryStatus(request: MessagingQueryRequest): Promise<MessagingQueryResult> {
    const normalized = normalizedQueryRequest(request);
    const queryRequestId = normalized.requestId ?? deterministicRequestId("query", normalized.idempotencyKey ?? normalized.providerRequestId ?? "unknown");
    admitMessagingRequest(this.controls, queryRequestId);
    const found = normalized.idempotencyKey ? this.records.get(normalized.idempotencyKey) : normalized.requestId ? this.byRequestId.get(normalized.requestId) : normalized.providerRequestId ? this.byProviderRequestId.get(normalized.providerRequestId) : undefined;
    if (!found) {
      this.controls.circuitBreaker?.recordSuccess();
      return { status: "FAILED", requestId: normalized.requestId ?? null, providerRequestId: normalized.providerRequestId ?? null, receipt: null, error: "synthetic message not found" };
    }
    this.controls.circuitBreaker?.recordSuccess();
    return { status: "SUCCEEDED", requestId: found.requestId, providerRequestId: found.result.providerRequestId, receipt: found.result.receipt, error: null };
  }

  async query(request: MessagingQueryRequest): Promise<MessagingQueryResult> {
    return this.queryStatus(request);
  }

  normalizeReceipt(raw: unknown, providerRequestId?: string): MessagingReceipt {
    return normalizeMessagingReceipt(raw, providerRequestId ?? null);
  }

  verifyCallback(payload: MessagingCallbackPayload, signature: string, secret: string): boolean {
    return verifyMessagingCallback(payload, signature, secret);
  }

  private resultFor(delivered: MessagingSendDelivered): MessagingSendResult {
    return this.sendOutcome === "DELIVERED" ? delivered : { status: "OUTCOME_UNKNOWN", requestId: delivered.requestId, providerRequestId: delivered.providerRequestId, reason: "synthetic response withheld; query is required" };
  }
}

export interface HttpMessagingProviderOptions extends MessagingProviderControlOptions {
  endpoint?: string | null;
  allowedHosts?: readonly string[];
  credentialRef?: string | null;
  secretResolver?: MessagingSecretResolver;
  resolveSecret?: MessagingSecretResolver;
  fetch?: MessagingFetch;
  defaultTimeoutMs?: number;
  sendPath?: string;
  queryPath?: string | ((request: MessagingQueryRequest) => string);
  allowInsecureEndpoint?: boolean;
  /** Maximum provider response body accepted by the adapter. */
  maxResponseBodyBytes?: number;
}

interface HttpAttemptResult {
  response: MessagingHttpResponse | null;
  payload?: unknown;
  failure: "TIMEOUT" | "TRANSPORT" | "INVALID_RESPONSE" | "CANCELLED" | null;
}

const DEFAULT_PROVIDER_RESPONSE_BODY_BYTES = 256 * 1024;

function boundedResponseBodyBytes(value: number | undefined): number {
  const selected = value ?? DEFAULT_PROVIDER_RESPONSE_BODY_BYTES;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > 4 * 1024 * 1024) throw new DomainError("INVALID_INPUT", "O limite de resposta do provider deve estar entre 1 byte e 4 MiB.", 400);
  return selected;
}

function responseContentLength(response: MessagingHttpResponse): number | null {
  const headers = response.headers;
  const hasGetter = headers && typeof headers === "object" && "get" in headers && typeof (headers as { get?: unknown }).get === "function";
  const raw = hasGetter
    ? (headers as { get: (name: string) => string | null }).get("content-length")
    : headers
      ? (headers as Readonly<Record<string, string | undefined>>)["content-length"]
      : undefined;
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function responseJson(response: MessagingHttpResponse, maxBodyBytes: number): Promise<unknown> {
  const declaredLength = responseContentLength(response);
  if (declaredLength !== null && declaredLength > maxBodyBytes) throw new Error("provider response body exceeds the configured limit");
  if (typeof response.text === "function") {
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > maxBodyBytes) throw new Error("provider response body exceeds the configured limit");
    return JSON.parse(raw) as unknown;
  }
  const payload = await response.json();
  let encoded: string;
  try { encoded = JSON.stringify(payload); } catch { throw new Error("provider response is not serializable"); }
  if (Buffer.byteLength(encoded, "utf8") > maxBodyBytes) throw new Error("provider response body exceeds the configured limit");
  return payload;
}

async function httpAttempt(fetcher: MessagingFetch, url: string, init: RequestInit, timeoutMs: number, callerSignal: AbortSignal | null, maxResponseBodyBytes: number): Promise<HttpAttemptResult> {
  if (callerSignal?.aborted) return { response: null, failure: "CANCELLED" };
  const controller = new AbortController();
  let timedOut = false;
  let invalidResponse = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = (): void => controller.abort();
  callerSignal?.addEventListener("abort", onAbort, { once: true });
  try {
    const operation = fetcher(url, { ...init, signal: controller.signal }).then(async (response) => {
      if (!response || typeof response.status !== "number" || (typeof response.text !== "function" && typeof response.json !== "function")) throw new Error("provider response transport is invalid");
      let payload: unknown;
      try {
        payload = await responseJson(response, maxResponseBodyBytes);
      } catch (error) {
        invalidResponse = true;
        throw error;
      }
      return { response, payload };
    });
    const timeout = new Promise<{ response: MessagingHttpResponse; payload: unknown }>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error("timeout"));
      }, timeoutMs);
    });
    const result = await Promise.race([operation, timeout]);
    return { response: result.response, payload: result.payload, failure: null };
  } catch {
    return { response: null, failure: callerSignal?.aborted ? "CANCELLED" : timedOut ? "TIMEOUT" : invalidResponse ? "INVALID_RESPONSE" : "TRANSPORT" };
  } finally {
    if (timer) clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onAbort);
  }
}

function providerEndpoint(options: HttpMessagingProviderOptions): string {
  if (typeof options.endpoint !== "string" || !options.endpoint.trim()) throw new MessagingProviderError("CONFIGURATION", "message provider endpoint is not configured");
  let parsed: URL;
  try {
    parsed = new URL(options.endpoint);
  } catch {
    throw new MessagingProviderError("CONFIGURATION", "message provider endpoint is invalid");
  }
  const hostname = parsed.hostname.toLowerCase();
  const privateLiteral = isIP(hostname) === 4
    ? hostname.startsWith("10.") || hostname.startsWith("127.") || hostname.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) || hostname.startsWith("169.254.")
    : isIP(hostname) === 6 && (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:") || hostname.startsWith("::ffff:127."));
  const allowedHosts = options.allowedHosts?.map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (parsed.username || parsed.password || (parsed.protocol !== "https:" && !options.allowInsecureEndpoint) || privateLiteral || (allowedHosts !== undefined && (!allowedHosts.length || !allowedHosts.includes(hostname)))) throw new MessagingProviderError("CONFIGURATION", "message provider endpoint is not an approved secure allowlisted URL");
  return parsed.toString().replace(/\/+$/, "");
}

function joinProviderEndpoint(endpoint: string, path: string): string {
  if (!path || /[\r\n]/.test(path)) throw new MessagingProviderError("CONFIGURATION", "message provider path is invalid");
  if (/^https?:\/\//i.test(path)) throw new MessagingProviderError("CONFIGURATION", "message provider path cannot change the approved endpoint");
  return `${endpoint}/${path.replace(/^\/+/, "")}`;
}

function httpFailureResult(failure: "TIMEOUT" | "TRANSPORT" | "INVALID_RESPONSE" | "CANCELLED", requestId: string, providerRequestId: string | null): MessagingSendUnknown {
  const reason = failure === "TIMEOUT" ? "provider timeout; query is required" : failure === "CANCELLED" ? "provider request cancelled; outcome requires reconciliation" : failure === "INVALID_RESPONSE" ? "provider response failed validation; query is required" : "provider transport failed; outcome requires reconciliation";
  return { status: "OUTCOME_UNKNOWN", requestId, providerRequestId, reason };
}

/** HTTP adapter with injected fetch and secret resolution. It performs no
 * retry: once transport starts, every ambiguous failure is OUTCOME_UNKNOWN. */
export class HttpMessagingProvider implements MessagingProvider {
  private readonly controls: MessagingControls;
  private readonly defaultTimeoutMs: number;
  private readonly maxResponseBodyBytes: number;

  constructor(private readonly options: HttpMessagingProviderOptions = {}) {
    this.controls = createMessagingControls(options);
    this.defaultTimeoutMs = boundedTimeout(options.defaultTimeoutMs, 5_000);
    this.maxResponseBodyBytes = boundedResponseBodyBytes(options.maxResponseBodyBytes);
  }

  async send(request: MessagingSendRequest): Promise<MessagingSendResult> {
    const normalized = normalizedSendRequest(request, this.defaultTimeoutMs);
    const requestId = normalized.requestId ?? deterministicRequestId("msg", normalized.idempotencyKey);
    const endpoint = providerEndpoint(this.options);
    const secret = await this.resolveSecret(normalized.timeoutMs, normalized.signal);
    admitMessagingRequest(this.controls, requestId);
    if (normalized.signal?.aborted) throw new MessagingProviderError("CANCELLED", "message send was cancelled before dispatch");
    let body: string;
    try {
      body = JSON.stringify({ requestId, idempotencyKey: normalized.idempotencyKey, channel: normalized.channel, to: normalized.recipient, body: normalized.body, metadata: normalized.metadata });
    } catch {
      throw new DomainError("INVALID_INPUT", "O payload da mensagem não pode ser serializado.", 400);
    }
    const attempt = await httpAttempt(this.fetcher(), joinProviderEndpoint(endpoint, this.options.sendPath ?? "/messages"), { method: "POST", redirect: "error", headers: { accept: "application/json", "content-type": "application/json", "x-request-id": requestId, "idempotency-key": normalized.idempotencyKey, authorization: `Bearer ${secret}` }, body }, normalized.timeoutMs || this.defaultTimeoutMs, normalized.signal, this.maxResponseBodyBytes);
    if (attempt.failure) {
      this.controls.circuitBreaker?.recordFailure();
      return httpFailureResult(attempt.failure, requestId, null);
    }
    const response = attempt.response;
    if (response?.status === 409) {
      this.controls.circuitBreaker?.recordSuccess();
      throw new MessagingProviderError("CONFLICT", "provider rejected the idempotency key for a different payload", { details: { status: response.status, requestId } });
    }
    if (!response || !response.ok || response.status < 200 || response.status >= 300) {
      this.controls.circuitBreaker?.recordFailure();
      return { status: "OUTCOME_UNKNOWN", requestId, providerRequestId: null, reason: `provider returned HTTP ${response?.status ?? "unknown"}; query is required` };
    }
    const payload = attempt.payload;
    const responseRecord = isRecord(payload) ? payload : null;
    const echoedRequestId = responseRecord?.requestId;
    const providerRequestId = typeof responseRecord?.providerRequestId === "string" ? responseRecord.providerRequestId : null;
    if ((echoedRequestId !== undefined && echoedRequestId !== requestId) || !providerRequestId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(providerRequestId)) {
      this.controls.circuitBreaker?.recordFailure();
      return httpFailureResult("INVALID_RESPONSE", requestId, providerRequestId);
    }
    try {
      const receipt = this.normalizeReceipt(responseRecord?.receipt, providerRequestId);
      if (responseRecord?.status !== undefined && responseRecord.status !== "ACCEPTED" && responseRecord.status !== "DELIVERED") throw new MessagingProviderError("INVALID_RESPONSE", "provider response status is invalid");
      if (responseRecord?.status !== undefined && responseRecord.status !== receipt.status) throw new MessagingProviderError("INVALID_RESPONSE", "provider response status does not match its receipt");
      this.controls.circuitBreaker?.recordSuccess();
      if (receipt.status === "ACCEPTED") return { status: "OUTCOME_UNKNOWN", requestId, providerRequestId, reason: "provider accepted the request; final delivery requires reconciliation" };
      return { status: "DELIVERED", requestId, providerRequestId, receipt };
    } catch {
      this.controls.circuitBreaker?.recordFailure();
      return httpFailureResult("INVALID_RESPONSE", requestId, providerRequestId);
    }
  }

  async queryStatus(request: MessagingQueryRequest): Promise<MessagingQueryResult> {
    const normalized = normalizedQueryRequest(request, this.defaultTimeoutMs);
    const requestId = normalized.requestId ?? deterministicRequestId("query", normalized.idempotencyKey ?? normalized.providerRequestId ?? "unknown");
    const endpoint = providerEndpoint(this.options);
    const secret = await this.resolveSecret(normalized.timeoutMs, normalized.signal);
    admitMessagingRequest(this.controls, requestId);
    if (normalized.signal?.aborted) throw new MessagingProviderError("CANCELLED", "message query was cancelled before dispatch");
    const identity = normalized.providerRequestId ?? normalized.requestId ?? normalized.idempotencyKey ?? requestId;
    const configuredPath = typeof this.options.queryPath === "function" ? this.options.queryPath(request) : this.options.queryPath ?? `/messages/${encodeURIComponent(identity)}`;
    const path = configuredPath.replace(":providerRequestId", encodeURIComponent(identity));
    const attempt = await httpAttempt(this.fetcher(), joinProviderEndpoint(endpoint, path), { method: "GET", redirect: "error", headers: { accept: "application/json", "x-request-id": requestId, authorization: `Bearer ${secret}` } }, normalized.timeoutMs || this.defaultTimeoutMs, normalized.signal, this.maxResponseBodyBytes);
    if (attempt.failure) {
      this.controls.circuitBreaker?.recordFailure();
      return { status: "OUTCOME_UNKNOWN", requestId, providerRequestId: normalized.providerRequestId, receipt: null, error: httpFailureResult(attempt.failure, requestId, normalized.providerRequestId).reason };
    }
    const response = attempt.response;
    if (response?.status === 404) {
      this.controls.circuitBreaker?.recordSuccess();
      return { status: "FAILED", requestId, providerRequestId: normalized.providerRequestId, receipt: null, error: "provider reported a final not-found result" };
    }
    if (!response || !response.ok || response.status < 200 || response.status >= 300) {
      this.controls.circuitBreaker?.recordFailure();
      return { status: "OUTCOME_UNKNOWN", requestId, providerRequestId: normalized.providerRequestId, receipt: null, error: "provider returned a non-success response; query must be retried by reconciliation policy" };
    }
    const payload = attempt.payload;
    const responseRecord = isRecord(payload) ? payload : null;
    const echoedRequestId = responseRecord?.requestId;
    const responseProviderRequestId = typeof responseRecord?.providerRequestId === "string" ? responseRecord.providerRequestId : normalized.providerRequestId;
    const status = responseRecord?.status;
    if (!responseRecord || (echoedRequestId !== undefined && echoedRequestId !== requestId) || !responseProviderRequestId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(responseProviderRequestId) || (normalized.providerRequestId !== null && responseProviderRequestId !== normalized.providerRequestId) || (status !== "SUCCEEDED" && status !== "PENDING" && status !== "FAILED")) {
      this.controls.circuitBreaker?.recordFailure();
      return { status: "OUTCOME_UNKNOWN", requestId, providerRequestId: typeof responseProviderRequestId === "string" ? responseProviderRequestId : null, receipt: null, error: "provider query response failed schema validation" };
    }
    if (status === "SUCCEEDED") {
      try {
        const receipt = this.normalizeReceipt(responseRecord?.receipt, responseProviderRequestId);
        this.controls.circuitBreaker?.recordSuccess();
        return { status, requestId, providerRequestId: responseProviderRequestId, receipt, error: null };
      } catch {
        this.controls.circuitBreaker?.recordFailure();
        return { status: "OUTCOME_UNKNOWN", requestId, providerRequestId: responseProviderRequestId, receipt: null, error: "provider query receipt failed validation" };
      }
    }
    this.controls.circuitBreaker?.recordSuccess();
    return { status, requestId, providerRequestId: responseProviderRequestId, receipt: null, error: status === "FAILED" ? "provider reported a message failure" : null };
  }

  async query(request: MessagingQueryRequest): Promise<MessagingQueryResult> {
    return this.queryStatus(request);
  }

  normalizeReceipt(raw: unknown, providerRequestId?: string): MessagingReceipt {
    return normalizeMessagingReceipt(raw, providerRequestId ?? null);
  }

  verifyCallback(payload: MessagingCallbackPayload, signature: string, secret: string): boolean {
    return verifyMessagingCallback(payload, signature, secret);
  }

  private fetcher(): MessagingFetch {
    if (this.options.fetch) return this.options.fetch;
    if (typeof globalThis.fetch !== "function") throw new MessagingProviderError("CONFIGURATION", "message provider fetch transport is unavailable");
    return globalThis.fetch.bind(globalThis) as MessagingFetch;
  }

  private async resolveSecret(timeoutMs: number, callerSignal: AbortSignal | null): Promise<string> {
    if (callerSignal?.aborted) throw new MessagingProviderError("CANCELLED", "message provider credential resolution was cancelled");
    const reference = typeof this.options.credentialRef === "string" ? this.options.credentialRef.trim() : "";
    const resolver = this.options.secretResolver ?? this.options.resolveSecret;
    if (!reference || !/^[A-Za-z0-9._:-]{1,160}$/.test(reference) || !resolver) throw new MessagingProviderError("CREDENTIAL", "message provider credential is not configured");
    let secret: string | null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      secret = await Promise.race([
        resolver(reference),
        new Promise<null>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("credential resolution timeout")), timeoutMs); })
      ]);
    } catch {
      throw new MessagingProviderError("CREDENTIAL", "message provider credential resolver failed or timed out");
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!secret || !secret.trim()) throw new MessagingProviderError("CREDENTIAL", "message provider credential is unavailable");
    return secret;
  }
}

export interface IntegrationAttempt {
  id: OpaqueId;
  integrationId: string;
  idempotencyKey: string;
  status: "BLOCKED" | "OUTCOME_UNKNOWN";
  reason: string;
  createdAt: string;
}

export { PROVIDER_REAL_PROOF_STAGES, isProviderProofEvidenceRef, providerRealProofAttestationPayload, providerRealProofChainDigest, validateProviderRealProofEvidence } from "./provider-proof.ts";
export type { ProviderRealProofAttestation, ProviderRealProofEvidence, ProviderRealProofStage, ProviderRealProofStageEvidence } from "./provider-proof.ts";

export interface OutboxDeliveryReceipt {
  status: "DELIVERED";
  providerRequestId: string;
  receipt: Record<string, unknown>;
}

export interface OutboxDeliveryUnknown {
  status: "OUTCOME_UNKNOWN";
  providerRequestId?: string | null;
  evidence?: Record<string, unknown> | null;
  reason?: string;
}

export type OutboxDeliveryDecision = "DELIVERED" | "RETRY" | "QUARANTINE" | "OUTCOME_UNKNOWN" | OutboxDeliveryReceipt | OutboxDeliveryUnknown;

export interface OutboxDispatchContext {
  effectId: OpaqueId;
  integrationId: string;
  idempotencyKey: string;
  fenceToken: bigint;
}

export interface OutboxSink {
  /** External egress must be admitted by the durable effect ledger first. */
  readonly requiresDurableEffectLedger?: boolean;
  deliver(record: DurableOutboxRecord, context?: OutboxDispatchContext): Promise<OutboxDeliveryDecision>;
}

export type MessagingOutboxMapper = (record: DurableOutboxRecord, context: OutboxDispatchContext) => MessagingSendRequest;

/** Bridges a governed outbox record to a provider-neutral messaging port. */
export class MessagingOutboxSink implements OutboxSink {
  readonly requiresDurableEffectLedger = true;

  constructor(private readonly provider: MessagingProvider, private readonly mapRequest: MessagingOutboxMapper) {}

  async deliver(record: DurableOutboxRecord, context?: OutboxDispatchContext): Promise<OutboxDeliveryDecision> {
    const dispatchContext: OutboxDispatchContext = context ?? { effectId: record.id, integrationId: `outbox:${record.eventType}`, idempotencyKey: record.id, fenceToken: record.fenceToken };
    const outcome = await this.provider.send(this.mapRequest(record, dispatchContext));
    if (outcome.status === "DELIVERED") return { status: "DELIVERED", providerRequestId: outcome.providerRequestId, receipt: { requestId: outcome.requestId, ...outcome.receipt } };
    return { status: "OUTCOME_UNKNOWN", providerRequestId: outcome.providerRequestId, evidence: { requestId: outcome.requestId }, reason: outcome.reason };
  }
}

/**
 * Converts a verified provider event into the local effect that acknowledges
 * it. The inbox row and this outbox row are committed by the persistence
 * adapter in one transaction; the provider payload never becomes an audit or
 * log field implicitly.
 */
export function inboxEventToOutbox(input: DurableInboxInput): DurableOutboxInput {
  const segment = (value: string): boolean => /^[A-Za-z0-9._:-]{1,160}$/.test(value);
  if (!segment(input.provider) || !segment(input.eventType)) throw new DomainError("INVALID_INPUT", "O evento externo não possui uma identidade transportável.", 400);
  const eventType = `integration.inbox.${input.provider}.${input.eventType}`;
  if (eventType.length > 240) throw new DomainError("INVALID_INPUT", "O tipo do evento externo excede o limite do contrato.", 400);
  return {
    id: makeId(),
    organizationId: input.organizationId,
    eventType,
    aggregateId: input.id,
    payload: {
      source: "SIGNED_INBOX",
      provider: input.provider,
      consumer: input.consumer,
      externalEventId: input.externalEventId,
      eventType: input.eventType,
      schemaVersion: input.schemaVersion,
      payload: input.payload
    }
  };
}

export interface OutboxWorkerResult {
  claimed: number;
  delivered: number;
  retried: number;
  quarantined: number;
  outcomeUnknown: number;
}

export interface OutboxAttemptEvent {
  readonly cycleId: OpaqueId;
  readonly organizationId: OpaqueId;
  readonly workerId: string;
  readonly outboxId: OpaqueId;
  readonly lane: "outbox";
  readonly jobType: "outbox.dispatch";
  readonly idempotencyKey: string;
  readonly outcome: "STARTED" | "SUCCEEDED" | "RETRY_SCHEDULED" | "QUARANTINED";
  readonly attempt: number;
  readonly durationMs: number;
  readonly reason: string | null;
  readonly providerRequestId: string | null;
}

export interface OutboxMetricEvent {
  readonly name: "worker.handler.attempt" | "worker.handler.succeeded" | "worker.handler.retry" | "worker.handler.quarantined";
  readonly cycleId: OpaqueId;
  readonly outboxId: OpaqueId;
  readonly jobType: "outbox.dispatch";
  readonly providerRequestId: string | null;
  readonly durationMs: number;
}

export interface OutboxWorkerHooks {
  readonly cycleId: OpaqueId;
  readonly audit?: (event: OutboxAttemptEvent) => void | Promise<void>;
  readonly metrics?: (event: OutboxMetricEvent) => void;
}

export interface ExternalEffectLedger {
  prepareExternalEffect(input: DurableExternalEffectInput, claim: { workerId: string; fenceToken: bigint; leaseSeconds?: number }): Promise<DurableExternalEffectRecord>;
  markExternalEffectDispatched(organizationId: OpaqueId, effectId: OpaqueId, workerId: string, fenceToken: bigint): Promise<DurableExternalEffectRecord>;
  recordExternalEffectOutcome(organizationId: OpaqueId, effectId: OpaqueId, workerId: string, fenceToken: bigint, outcome: DurableExternalEffectOutcome): Promise<DurableExternalEffectRecord>;
}

export interface ExternalEffectQueryContext {
  effectId: OpaqueId;
  integrationId: string;
  idempotencyKey: string;
  providerRequestId?: string | null;
  request: Record<string, unknown>;
  signal: AbortSignal;
}

export interface ExternalEffectQueryResult {
  status: "SUCCEEDED" | "FAILED_FINAL" | "QUARANTINED";
  providerRequestId: string | null;
  response: Record<string, unknown> | null;
  error?: string | null;
  source: "SYNTHETIC_PROVIDER_QUERY" | "PROVIDER_QUERY";
}

export interface ExternalEffectQueryAdapter {
  integrationIds: readonly string[];
  query(effect: ExternalEffectQueryContext): Promise<ExternalEffectQueryResult>;
}

export interface ExternalEffectReconciliationClaim {
  workerId: string;
  fenceToken: bigint;
}

export interface ExternalEffectReconciliationPersistence {
  listExternalEffects(organizationId: OpaqueId): Promise<DurableExternalEffectRecord[]>;
  reconcileExternalEffect(organizationId: OpaqueId, effectId: OpaqueId, evidence: DurableExternalReconciliationEvidence, claim?: ExternalEffectReconciliationClaim): Promise<DurableExternalEffectRecord>;
  /** Production persistence atomically moves an eligible effect to RECONCILING. */
  claimExternalEffectForReconciliation?(organizationId: OpaqueId, effectId: OpaqueId, workerId: string, leaseSeconds?: number): Promise<DurableExternalEffectRecord | null>;
}

/** Maps the provider-neutral messaging query to a durable final observation. */
export function createMessagingExternalEffectQueryAdapter(provider: Pick<MessagingProvider, "queryStatus">): ExternalEffectQueryAdapter {
  return {
    integrationIds: ["outbox:communication.message.approved"],
    async query(effect) {
      const result = await provider.queryStatus({ providerRequestId: effect.providerRequestId ?? null, idempotencyKey: effect.idempotencyKey, signal: effect.signal });
      if (result.status === "SUCCEEDED") return { status: "SUCCEEDED", providerRequestId: result.providerRequestId, response: result.receipt ? { receipt: result.receipt } : null, error: null, source: "PROVIDER_QUERY" };
      if (result.status === "FAILED") return { status: "FAILED_FINAL", providerRequestId: result.providerRequestId, response: null, error: result.error ?? "provider reported a final failure", source: "PROVIDER_QUERY" };
      throw new DomainError("DEPENDENCY_UNAVAILABLE", "O provider ainda não retornou um resultado final; o efeito permanece em reconciliação.", 503);
    }
  };
}

/**
 * Bounded relay orchestration. Persistence owns the lease/fence transaction;
 * the worker only receives claimed records and calls a governed sink. A lost
 * lease is allowed to fail loudly so no worker can acknowledge stale work.
 */
export class OutboxWorker {
  constructor(private readonly persistence: Pick<PostgresPersistence, "claimOutbox" | "completeOutbox" | "failOutbox">, private readonly effects: ExternalEffectLedger | null = null) {}

  async runOnce(organizationId: OpaqueId, workerId: string, sink: OutboxSink, options: { limit?: number; leaseSeconds?: number; maxAttempts?: number; hooks?: OutboxWorkerHooks } = {}): Promise<OutboxWorkerResult> {
    const maxAttempts = Math.min(20, Math.max(1, Math.trunc(options.maxAttempts ?? 5)));
    const records = await this.persistence.claimOutbox(organizationId, workerId, options.limit ?? 10, options.leaseSeconds ?? 30);
    const result: OutboxWorkerResult = { claimed: records.length, delivered: 0, retried: 0, quarantined: 0, outcomeUnknown: 0 };
    for (const record of records) {
      const attemptStarted = Date.now();
      const hooks = options.hooks;
      const cycleId = hooks?.cycleId ?? record.id;
      const recordAudit = async (outcome: OutboxAttemptEvent["outcome"], reason: string | null, providerRequestId: string | null = null): Promise<void> => {
        if (!hooks?.audit) return;
        await hooks.audit({ cycleId, organizationId: record.organizationId, workerId, outboxId: record.id, lane: "outbox", jobType: "outbox.dispatch", idempotencyKey: record.id, outcome, attempt: record.attempts, durationMs: Date.now() - attemptStarted, reason, providerRequestId });
      };
      const recordMetric = (name: OutboxMetricEvent["name"], providerRequestId: string | null = null): void => {
        hooks?.metrics?.({ name, cycleId, outboxId: record.id, jobType: "outbox.dispatch", providerRequestId, durationMs: Date.now() - attemptStarted });
      };
      await recordAudit("STARTED", null);
      recordMetric("worker.handler.attempt");
      if (sink.requiresDurableEffectLedger && !this.effects) {
        const reason = "external sink requires a durable effect ledger; dispatch was not attempted";
        await recordAudit("QUARANTINED", reason);
        recordMetric("worker.handler.quarantined");
        await this.persistence.failOutbox(organizationId, record.id, workerId, record.fenceToken, reason, true, 1);
        result.quarantined += 1;
        continue;
      }
      const effectInput: DurableExternalEffectInput = { id: record.id, organizationId: record.organizationId, outboxId: record.id, integrationId: `outbox:${record.eventType}`, idempotencyKey: record.id, request: { eventType: record.eventType, aggregateId: record.aggregateId, payload: record.payload, recordDigest: record.recordDigest } };
      let effect: DurableExternalEffectRecord | null = null;
      if (this.effects) {
        effect = await this.effects.prepareExternalEffect(effectInput, { workerId, fenceToken: record.fenceToken, leaseSeconds: options.leaseSeconds ?? 30 });
        if (effect.status === "SUCCEEDED") {
          await recordAudit("SUCCEEDED", null, effect.providerRequestId);
          recordMetric("worker.handler.succeeded", effect.providerRequestId);
          await this.persistence.completeOutbox(organizationId, record.id, workerId, record.fenceToken);
          result.delivered += 1;
          continue;
        }
        if (effect.status !== "ADMISSION_PENDING") {
          const quarantine = effect.status !== "FAILED_RETRYABLE";
          if (effect.status === "OUTCOME_UNKNOWN" || effect.status === "RECONCILIATION_REQUIRED" || effect.status === "DISPATCHED") result.outcomeUnknown += 1;
          const reason = `external effect is ${effect.status}; dispatch is blocked until reconciliation`;
          await recordAudit(quarantine ? "QUARANTINED" : "RETRY_SCHEDULED", reason, effect.providerRequestId);
          recordMetric(quarantine ? "worker.handler.quarantined" : "worker.handler.retry", effect.providerRequestId);
          await this.persistence.failOutbox(organizationId, record.id, workerId, record.fenceToken, reason, quarantine, 1);
          if (quarantine) result.quarantined += 1;
          else result.retried += 1;
          continue;
        }
        await this.effects.markExternalEffectDispatched(organizationId, effect.id, workerId, record.fenceToken);
      }
      let decision: OutboxDeliveryDecision = "OUTCOME_UNKNOWN";
      let reason = "sink did not return a delivery decision";
      let providerRequestId: string | null = null;
      let providerReceipt: Record<string, unknown> | null = null;
      try {
        const delivery = await sink.deliver(record, { effectId: effect?.id ?? record.id, integrationId: effect?.integrationId ?? `outbox:${record.eventType}`, idempotencyKey: effect?.idempotencyKey ?? record.id, fenceToken: record.fenceToken });
        if (typeof delivery === "object" && delivery !== null) {
          if (delivery.status === "DELIVERED") {
            if (!delivery.providerRequestId.trim() || !delivery.receipt || typeof delivery.receipt !== "object" || Array.isArray(delivery.receipt)) {
              decision = "OUTCOME_UNKNOWN";
              reason = "sink returned success without a verifiable provider receipt";
            } else {
              decision = "DELIVERED";
              providerRequestId = delivery.providerRequestId;
              providerReceipt = delivery.receipt;
              reason = "";
            }
          } else {
            decision = "OUTCOME_UNKNOWN";
            providerRequestId = delivery.providerRequestId ?? null;
            providerReceipt = delivery.evidence ?? null;
            reason = delivery.reason ?? "sink returned an outcome that requires reconciliation";
          }
        } else {
          decision = delivery;
          reason = decision === "RETRY" ? "sink requested a bounded retry" : decision === "QUARANTINE" ? "sink quarantined the record" : decision === "OUTCOME_UNKNOWN" ? "sink returned an outcome that requires reconciliation" : decision === "DELIVERED" ? "" : "sink did not return a delivery decision";
          if (decision === "DELIVERED" && this.effects) {
            decision = "OUTCOME_UNKNOWN";
            reason = "sink returned success without a verifiable provider receipt";
          }
        }
      } catch (error) {
        reason = redactMessagingError(error);
        decision = error instanceof MessagingProviderError && error.outcome === "NOT_SENT" ? "QUARANTINE" : "OUTCOME_UNKNOWN";
      }
      if (this.effects && effect) {
        const outcome: DurableExternalEffectOutcome = decision === "DELIVERED"
          ? { status: "SUCCEEDED", providerRequestId, response: providerReceipt }
          : decision === "RETRY"
            ? { status: "FAILED_RETRYABLE", error: reason }
            : decision === "QUARANTINE"
              ? { status: "QUARANTINED", error: reason }
              : { status: "OUTCOME_UNKNOWN", providerRequestId, response: providerReceipt, error: reason };
        await this.effects.recordExternalEffectOutcome(organizationId, effect.id, workerId, record.fenceToken, outcome);
      }
      if (decision === "DELIVERED") {
        await recordAudit("SUCCEEDED", null, providerRequestId);
        recordMetric("worker.handler.succeeded", providerRequestId);
        await this.persistence.completeOutbox(organizationId, record.id, workerId, record.fenceToken);
        result.delivered += 1;
        continue;
      }
      const quarantine = decision === "QUARANTINE" || decision === "OUTCOME_UNKNOWN" || record.attempts >= maxAttempts;
      await recordAudit(quarantine ? "QUARANTINED" : "RETRY_SCHEDULED", reason, providerRequestId);
      recordMetric(quarantine ? "worker.handler.quarantined" : "worker.handler.retry", providerRequestId);
      await this.persistence.failOutbox(organizationId, record.id, workerId, record.fenceToken, reason, quarantine, Math.min(300, 2 ** Math.min(record.attempts, 8)));
      if (quarantine) result.quarantined += 1;
      else result.retried += 1;
      if (decision === "OUTCOME_UNKNOWN") result.outcomeUnknown += 1;
    }
    return result;
  }
}

/**
 * Reconciliation is a trusted provider-query boundary, not an HTTP assertion.
 * The adapter supplies the observation; this function binds it to the exact
 * effect and computes the digest before persistence accepts the transition.
 */
export async function reconcileUnknownExternalEffect(
  persistence: ExternalEffectReconciliationPersistence,
  organizationId: OpaqueId,
  effectId: OpaqueId,
  adapter: ExternalEffectQueryAdapter,
  options: { timeoutMs?: number; workerId?: string; leaseSeconds?: number } = {}
): Promise<DurableExternalEffectRecord> {
  const listedEffect = (await persistence.listExternalEffects(organizationId)).find((candidate) => candidate.id === effectId);
  let effect = listedEffect;
  let claim: ExternalEffectReconciliationClaim | undefined;
  if (!effect) throw new DomainError("NOT_FOUND", "Efeito externo não encontrado nesta organização.", 404);
  if (effect.status !== "OUTCOME_UNKNOWN" && effect.status !== "RECONCILIATION_REQUIRED" && effect.status !== "RECONCILING") throw new DomainError("INVALID_STATE", "Somente efeitos sem resultado confirmado podem ser reconciliados.", 409);
  if (persistence.claimExternalEffectForReconciliation) {
    const workerId = options.workerId?.trim() || "reconciliation-worker";
    const claimed = await persistence.claimExternalEffectForReconciliation(organizationId, effectId, workerId, options.leaseSeconds ?? 30);
    if (!claimed) throw new DomainError("ADMISSION_IN_PROGRESS", "O efeito já está sendo reconciliado ou não está elegível; nenhuma query concorrente foi iniciada.", 409);
    effect = claimed;
    claim = { workerId, fenceToken: claimed.fenceToken };
  }
  if (effect.status !== "OUTCOME_UNKNOWN" && effect.status !== "RECONCILIATION_REQUIRED" && effect.status !== "RECONCILING") throw new DomainError("INVALID_STATE", "Somente efeitos sem resultado confirmado podem ser reconciliados.", 409);
  if (!adapter.integrationIds.includes(effect.integrationId)) throw new DomainError("CAPABILITY_DISABLED", "Não há query adapter autorizado para esta integração.", 503);
  const timeoutMs = Math.min(30_000, Math.max(100, Math.trunc(options.timeoutMs ?? 3_000)));
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: ExternalEffectQueryResult;
  try {
    const query = adapter.query({ effectId: effect.id, integrationId: effect.integrationId, idempotencyKey: effect.idempotencyKey, providerRequestId: effect.providerRequestId, request: effect.request, signal: controller.signal });
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new DomainError("DEPENDENCY_UNAVAILABLE", "A consulta do provider excedeu o deadline de reconciliação.", 503));
      }, timeoutMs);
    });
    result = await Promise.race([query, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!result || (result.status !== "SUCCEEDED" && result.status !== "FAILED_FINAL" && result.status !== "QUARANTINED") || (result.source !== "PROVIDER_QUERY" && result.source !== "SYNTHETIC_PROVIDER_QUERY") || (result.providerRequestId !== null && typeof result.providerRequestId !== "string") || (result.response !== null && (typeof result.response !== "object" || Array.isArray(result.response)))) {
    throw new DomainError("INVALID_STATE", "O query adapter retornou uma observação inválida.", 502);
  }
  const observedAt = now();
  const evidence: DurableExternalReconciliationEvidence = {
    status: result.status,
    providerRequestId: result.providerRequestId,
    response: result.response,
    error: result.error ?? null,
    source: result.source,
    observedAt,
    queryDigest: digest({ effectId: effect.id, status: result.status, providerRequestId: result.providerRequestId, response: result.response, observedAt })
  };
  return persistence.reconcileExternalEffect(organizationId, effect.id, evidence, claim);
}

export const integrationContracts: IntegrationContract[] = [
  { integrationId: "lab.synthetic", owner: "diagnostico", purpose: "Resultado sintético para testes de cadeia", sourceOfTruth: "CVG DiagnosticRequest/Result", serviceIdentity: "synthetic-only", credentialRef: null, allowedScopes: ["organization", "unit"], endpointAndRegion: null, apiVersion: "fixture-1", timeoutMs: 3_000, retryBudget: 0, idempotencyKey: "externalOrderId+specimenId", dataClasses: ["D3"], killSwitch: false, status: "ENABLED" },
  { integrationId: "payment.real", owner: "financeiro", purpose: "Pagamentos reais", sourceOfTruth: "provider/ledger reconciliation", serviceIdentity: "UNASSIGNED", credentialRef: null, allowedScopes: [], endpointAndRegion: null, apiVersion: null, timeoutMs: 0, retryBudget: 0, idempotencyKey: "paymentIntentId", dataClasses: ["D2"], killSwitch: true, status: "DISABLED" },
  { integrationId: "messaging.real", owner: "comunicacao", purpose: "Envio de mensagens reais", sourceOfTruth: "provider/message receipt", serviceIdentity: "UNASSIGNED", credentialRef: null, allowedScopes: [], endpointAndRegion: null, apiVersion: null, timeoutMs: 0, retryBudget: 0, idempotencyKey: "durableEffectId", dataClasses: ["D2", "D3"], killSwitch: true, status: "DISABLED" },
  { integrationId: "calendar.real", owner: "agenda", purpose: "Calendário externo", sourceOfTruth: "CONTRACT_REQUIRED", serviceIdentity: "UNASSIGNED", credentialRef: null, allowedScopes: [], endpointAndRegion: null, apiVersion: null, timeoutMs: 0, retryBudget: 0, idempotencyKey: "appointmentId+version", dataClasses: ["D1"], killSwitch: true, status: "DISABLED" }
];

export class IntegrationGateway {
  readonly attempts: IntegrationAttempt[] = [];

  constructor(private readonly secretProvider: SecretProvider | null = null) {}

  getHealth(): { enabled: number; disabled: number; killSwitches: string[]; secretProvider: SecretProviderStatus } {
    return { enabled: integrationContracts.filter((contract) => contract.status === "ENABLED").length, disabled: integrationContracts.filter((contract) => contract.status !== "ENABLED").length, killSwitches: integrationContracts.filter((contract) => contract.killSwitch).map((contract) => contract.integrationId), secretProvider: this.secretProvider?.status() ?? "NOT_CONFIGURED" };
  }

  execute(integrationId: string, scope: string, payload: unknown, idempotencyKey: string): never {
    const contract = integrationContracts.find((candidate) => candidate.integrationId === integrationId);
    if (!contract || contract.status !== "ENABLED" || contract.killSwitch || !contract.allowedScopes.includes(scope)) {
      this.attempts.push({ id: makeId(), integrationId, idempotencyKey, status: "BLOCKED", reason: "Integration disabled, unconfigured or outside allowlist; no external dispatch occurred.", createdAt: now() });
      throw new DomainError("CAPABILITY_DISABLED", "A integração está bloqueada até existir contrato, credencial e autoridade.", 403, { integrationId, payloadDigest: digest(payload) });
    }
    if (contract.credentialRef && (!this.secretProvider || this.secretProvider.status() !== "READY" || !this.secretProvider.has(contract.credentialRef))) {
      this.attempts.push({ id: makeId(), integrationId, idempotencyKey, status: "BLOCKED", reason: "Credential reference is unavailable or outside the configured provider; no external dispatch occurred.", createdAt: now() });
      throw new DomainError("CREDENTIAL_UNAVAILABLE", "A credencial referenciada não está disponível; nenhum dispatch foi realizado.", 503, { integrationId });
    }
    throw new DomainError("DEPENDENCY_UNAVAILABLE", "A integração sintética não possui provider externo configurado.", 503, { integrationId, idempotencyKey });
  }
}
