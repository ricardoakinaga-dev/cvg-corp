import { createHash } from "node:crypto";
import type { DataClass } from "@cvg/contracts";

/**
 * Model runtime: the provider boundary.  Model providers are replaceable
 * infrastructure; they are not the agent architecture.  Everything here is
 * provider-neutral and contains no business rule.
 */

export const MODEL_RUNTIME_VERSION = "model-runtime/1.0.0";

export type ModelHealthStatus = "READY" | "DEGRADED" | "UNAVAILABLE" | "DISABLED";

export interface ModelProviderHealth {
  status: ModelHealthStatus;
  checkedAt: string;
  reason: string | null;
  latencyMs: number | null;
}

export interface ModelProviderCapabilities {
  toolCalling: boolean;
  structuredOutput: boolean;
  streaming: boolean;
  reasoning: boolean;
  vision: boolean;
  contextWindow: number;
  maxOutput: number;
}

export interface ModelProviderDataPolicy {
  /** Data classes the provider is authorized to receive. Unknown is never a wildcard. */
  allowedDataClasses: readonly DataClass[];
  region: string | null;
  retention: "UNKNOWN" | "NONE" | "SESSION" | "TEMPORARY" | "EXTENDED";
  training: "UNKNOWN" | "NONE" | "OPT_IN" | "YES";
}

export type ModelMessageRole = "system" | "user" | "assistant" | "tool";

export interface ModelMessage {
  role: ModelMessageRole;
  content: string;
  toolName?: string;
  toolCallId?: string;
}

export interface ModelToolContract {
  name: string;
  version: string;
  description: string;
  risk: "READ_ONLY" | "DRAFT" | "REVERSIBLE" | "HIGH_IMPACT";
  inputSchemaDigest: string;
  inputSchema?: Record<string, unknown>;
}

export interface ModelRequest {
  messages: readonly ModelMessage[];
  tools: readonly ModelToolContract[];
  systemInstructions: string;
  maxOutputTokens: number;
  temperature: number | null;
  purpose: string;
  contextDigest: string;
  responseFormat: "TEXT" | "JSON_OBJECT";
  correlationId: string;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  costMicros: number | null;
  currency: string | null;
  source: "PROVIDER" | "LOCAL_SYNTHETIC" | "UNAVAILABLE";
}

export type ModelFinishReason = "stop" | "length" | "tool_calls" | "content_filter" | "error";

export type ModelReply =
  | { kind: "MESSAGE"; content: string }
  | { kind: "TOOL_CALL"; tool: string; input: unknown; callId: string }
  | { kind: "STRUCTURED"; value: unknown };

export interface ModelResponse {
  reply: ModelReply;
  usage: ModelUsage;
  providerId: string;
  model: string;
  responseDigest: string;
  finishReason: ModelFinishReason;
  providerRequestId: string | null;
  retryable: boolean;
}

export type ModelStreamEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; tool: string; input: unknown; callId: string }
  | { type: "usage"; usage: ModelUsage }
  | { type: "done"; finishReason: ModelFinishReason }
  | { type: "error"; code: ModelErrorCode; message: string; retryable: boolean };

export interface ModelCompleteOptions {
  signal?: AbortSignal;
  requestId?: string;
  timeoutMs?: number;
}

export interface ModelProvider {
  readonly providerId: string;
  health(signal?: AbortSignal): Promise<ModelProviderHealth>;
  capabilities(): ModelProviderCapabilities;
  dataPolicy(): ModelProviderDataPolicy;
  complete(request: ModelRequest, options?: ModelCompleteOptions): Promise<ModelResponse>;
  stream?(request: ModelRequest, options?: ModelCompleteOptions): AsyncIterable<ModelStreamEvent>;
  cancel(requestId: string): boolean;
}

export type ModelErrorCode =
  | "MODEL_UNAVAILABLE"
  | "MODEL_TIMEOUT"
  | "MODEL_RATE_LIMITED"
  | "MODEL_CONTEXT_TOO_LARGE"
  | "MODEL_INVALID_RESPONSE"
  | "MODEL_BAD_REQUEST"
  | "MODEL_CANCELLED"
  | "MODEL_POLICY_DENIED"
  | "MODEL_DEPENDENCY_UNAVAILABLE"
  | "MODEL_UNKNOWN";

export interface ModelRetryClassification {
  retryable: boolean;
  nonRetryable: boolean;
  reconciliationRequired: boolean;
  humanActionRequired: boolean;
}

export function classifyModelError(code: ModelErrorCode): ModelRetryClassification {
  switch (code) {
    case "MODEL_TIMEOUT":
    case "MODEL_RATE_LIMITED":
    case "MODEL_UNAVAILABLE":
    case "MODEL_DEPENDENCY_UNAVAILABLE":
      return { retryable: true, nonRetryable: false, reconciliationRequired: false, humanActionRequired: false };
    case "MODEL_POLICY_DENIED":
      return { retryable: false, nonRetryable: true, reconciliationRequired: false, humanActionRequired: true };
    case "MODEL_BAD_REQUEST":
    case "MODEL_CONTEXT_TOO_LARGE":
      return { retryable: false, nonRetryable: true, reconciliationRequired: false, humanActionRequired: false };
    case "MODEL_CANCELLED":
      return { retryable: false, nonRetryable: true, reconciliationRequired: false, humanActionRequired: false };
    case "MODEL_INVALID_RESPONSE":
      return { retryable: true, nonRetryable: false, reconciliationRequired: false, humanActionRequired: false };
    default:
      return { retryable: false, nonRetryable: true, reconciliationRequired: true, humanActionRequired: false };
  }
}

export class ModelProviderError extends Error {
  readonly classification: ModelRetryClassification;

  constructor(
    readonly code: ModelErrorCode,
    message: string,
    readonly providerId: string,
    readonly details: Record<string, string | number | boolean | null> = {}
  ) {
    super(message);
    this.name = "ModelProviderError";
    this.classification = classifyModelError(code);
  }
}

export interface ModelRetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Injectable for deterministic tests; production uses Math.random. */
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_MODEL_RETRY: ModelRetryOptions = { maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 4_000 };

/** Exponential backoff with jitter, applied only to classification.retryable errors. */
export async function withModelRetry<T>(operation: () => Promise<T>, options: Partial<ModelRetryOptions> = {}): Promise<T> {
  const config = { ...DEFAULT_MODEL_RETRY, ...options };
  const random = config.random ?? Math.random;
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let attempt = 0;
  let lastError: unknown;
  while (attempt < Math.max(1, config.maxAttempts)) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!(error instanceof ModelProviderError) || !error.classification.retryable) throw error;
      if (attempt >= config.maxAttempts) break;
      const exponential = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** (attempt - 1));
      await sleep(Math.max(0, Math.floor(exponential / 2 + random() * (exponential / 2))));
    }
  }
  throw lastError;
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxAttempts: number;
  clock?: () => number;
}

export class CircuitBreaker {
  private failures = 0;
  private state: CircuitState = "CLOSED";
  private openedAt = 0;
  private halfOpenAttempts = 0;

  constructor(private readonly options: CircuitBreakerOptions) {}

  currentState(now = this.now()): CircuitState {
    if (this.state === "OPEN" && now - this.openedAt >= this.options.resetTimeoutMs) return "HALF_OPEN";
    return this.state;
  }

  canAttempt(now = this.now()): boolean {
    const state = this.currentState(now);
    if (state === "CLOSED") return true;
    if (state === "OPEN") return false;
    if (this.halfOpenAttempts >= this.options.halfOpenMaxAttempts) return false;
    this.state = "HALF_OPEN";
    this.halfOpenAttempts += 1;
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.halfOpenAttempts = 0;
    this.state = "CLOSED";
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.state === "HALF_OPEN" || this.failures >= this.options.failureThreshold) {
      this.state = "OPEN";
      this.openedAt = this.now();
      this.halfOpenAttempts = 0;
    }
  }

  snapshot(): { state: CircuitState; failures: number } {
    return { state: this.currentState(), failures: this.failures };
  }

  private now(): number {
    return this.options.clock ? this.options.clock() : Date.now();
  }
}

export interface ModelRoutingPolicy {
  requiredCapabilities: readonly (keyof ModelProviderCapabilities)[];
  dataClasses: readonly DataClass[];
  allowedFallback: boolean;
  preferredProviderIds?: readonly string[];
  modelProviderId?: string | null;
}

export interface ModelRouteDecision {
  allowed: boolean;
  providerId: string | null;
  reason: string;
  fallbackFrom: string | null;
  candidates: readonly string[];
}

export interface ModelRoutingCandidate {
  provider: ModelProvider;
  /** Lower is tried first. */
  priority: number;
  /** Static flag or dynamic predicate (kill switches evaluated per routing call). */
  enabled: boolean | (() => boolean);
}

export class ModelRouter {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly candidates: readonly ModelRoutingCandidate[],
    private readonly breakerFactory: (providerId: string) => CircuitBreaker = (providerId) =>
      new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000, halfOpenMaxAttempts: 1 })
  ) {}

  route(policy: ModelRoutingPolicy): ModelRouteDecision {
    if (policy.modelProviderId) {
      const explicit = this.candidates.find((candidate) => candidate.provider.providerId === policy.modelProviderId);
      if (!explicit) return { allowed: false, providerId: null, reason: "PROVIDER_NOT_REGISTERED", fallbackFrom: null, candidates: [] };
      if (!this.isEnabled(explicit)) return { allowed: false, providerId: null, reason: "PROVIDER_DISABLED", fallbackFrom: null, candidates: [explicit.provider.providerId] };
      const rejection = this.rejectReason(explicit.provider, policy);
      if (rejection) return { allowed: false, providerId: null, reason: rejection, fallbackFrom: null, candidates: [explicit.provider.providerId] };
      return { allowed: true, providerId: explicit.provider.providerId, reason: "EXPLICIT", fallbackFrom: null, candidates: [explicit.provider.providerId] };
    }
    const preferred = policy.preferredProviderIds ?? [];
    const ordered = [...this.candidates].sort((a, b) => {
      const aPreferred = preferred.indexOf(a.provider.providerId);
      const bPreferred = preferred.indexOf(b.provider.providerId);
      if (aPreferred !== -1 || bPreferred !== -1) {
        if (aPreferred === -1) return 1;
        if (bPreferred === -1) return -1;
        return aPreferred - bPreferred;
      }
      return a.priority - b.priority;
    });
    const considered: string[] = [];
    let fallbackFrom: string | null = null;
    let lastReason: string | null = null;
    for (const candidate of ordered) {
      considered.push(candidate.provider.providerId);
      if (!this.isEnabled(candidate)) {
        fallbackFrom = fallbackFrom ?? candidate.provider.providerId;
        lastReason = "PROVIDER_DISABLED";
        continue;
      }
      const rejection = this.rejectReason(candidate.provider, policy);
      if (rejection) {
        fallbackFrom = fallbackFrom ?? candidate.provider.providerId;
        lastReason = rejection;
        continue;
      }
      const breaker = this.breakerFor(candidate.provider.providerId);
      if (!breaker.canAttempt()) {
        fallbackFrom = fallbackFrom ?? candidate.provider.providerId;
        lastReason = "CIRCUIT_OPEN";
        continue;
      }
      if (fallbackFrom && !policy.allowedFallback) {
        return { allowed: false, providerId: null, reason: "FALLBACK_NOT_ALLOWED", fallbackFrom, candidates: considered };
      }
      return { allowed: true, providerId: candidate.provider.providerId, reason: fallbackFrom ? "FALLBACK" : "PRIMARY", fallbackFrom, candidates: considered };
    }
    return { allowed: false, providerId: null, reason: lastReason ?? "NO_CAPABLE_PROVIDER", fallbackFrom, candidates: considered };
  }

  breakerFor(providerId: string): CircuitBreaker {
    let breaker = this.breakers.get(providerId);
    if (!breaker) {
      breaker = this.breakerFactory(providerId);
      this.breakers.set(providerId, breaker);
    }
    return breaker;
  }

  recordOutcome(providerId: string, success: boolean): void {
    const breaker = this.breakerFor(providerId);
    if (success) breaker.recordSuccess();
    else breaker.recordFailure();
  }

  private isEnabled(candidate: ModelRoutingCandidate): boolean {
    try {
      return typeof candidate.enabled === "function" ? candidate.enabled() : candidate.enabled;
    } catch {
      return false;
    }
  }

  private rejectReason(provider: ModelProvider, policy: ModelRoutingPolicy): string | null {
    const capabilities = provider.capabilities();
    for (const capability of policy.requiredCapabilities) {
      if (!capabilities[capability]) return `MISSING_CAPABILITY:${String(capability)}`;
    }
    const dataPolicy = provider.dataPolicy();
    for (const dataClass of policy.dataClasses) {
      if (!dataPolicy.allowedDataClasses.includes(dataClass)) return `DATA_CLASS_NOT_AUTHORIZED:${dataClass}`;
    }
    return null;
  }
}

export interface UsageReconciliation {
  status: "MATCHED" | "MISMATCH" | "NOT_EVALUATED";
  localEstimateTokens: number;
  providerReportedTokens: number | null;
  deltaTokens: number | null;
  reason: string | null;
}

/** Compares local estimate with provider usage without ever rewriting history. */
export function reconcileUsage(localEstimateTokens: number, providerUsage: ModelUsage | null, toleranceRatio = 0.25): UsageReconciliation {
  if (!providerUsage || providerUsage.source === "UNAVAILABLE") {
    return { status: "NOT_EVALUATED", localEstimateTokens, providerReportedTokens: null, deltaTokens: null, reason: "PROVIDER_USAGE_UNAVAILABLE" };
  }
  const reported = providerUsage.inputTokens + providerUsage.outputTokens;
  const delta = reported - localEstimateTokens;
  const tolerance = Math.max(8, Math.floor(Math.max(reported, localEstimateTokens) * toleranceRatio));
  if (Math.abs(delta) <= tolerance) return { status: "MATCHED", localEstimateTokens, providerReportedTokens: reported, deltaTokens: delta, reason: null };
  return { status: "MISMATCH", localEstimateTokens, providerReportedTokens: reported, deltaTokens: delta, reason: "TOKEN_DISCREPANCY" };
}

export function modelRequestDigest(request: ModelRequest): string {
  const canonical = {
    systemInstructions: request.systemInstructions,
    messages: request.messages.map((message) => ({ role: message.role, contentDigest: createHash("sha256").update(message.content).digest("hex"), toolName: message.toolName ?? null })),
    tools: request.tools.map((tool) => tool.name).sort(),
    maxOutputTokens: request.maxOutputTokens,
    temperature: request.temperature,
    purpose: request.purpose,
    contextDigest: request.contextDigest,
    responseFormat: request.responseFormat
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
