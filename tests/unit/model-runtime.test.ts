import test from "node:test";
import assert from "node:assert/strict";
import {
  CircuitBreaker,
  ModelProviderError,
  ModelRouter,
  classifyModelError,
  reconcileUsage,
  withModelRetry,
  type ModelProvider,
  type ModelProviderCapabilities,
  type ModelProviderDataPolicy,
  type ModelResponse
} from "@cvg/model-runtime";

function provider(id: string, overrides: { capabilities?: Partial<ModelProviderCapabilities>; dataPolicy?: Partial<ModelProviderDataPolicy> } = {}): ModelProvider {
  const capabilities: ModelProviderCapabilities = { toolCalling: true, structuredOutput: true, streaming: true, reasoning: false, vision: false, contextWindow: 100_000, maxOutput: 4_096, ...(overrides.capabilities ?? {}) };
  const dataPolicy: ModelProviderDataPolicy = { allowedDataClasses: ["D0", "D1", "D2"], region: "eu", retention: "NONE", training: "NONE", ...(overrides.dataPolicy ?? {}) };
  return {
    providerId: id,
    async health() { return { status: "READY", checkedAt: new Date().toISOString(), reason: null, latencyMs: 1 }; },
    capabilities: () => capabilities,
    dataPolicy: () => dataPolicy,
    async complete(): Promise<ModelResponse> {
      return { reply: { kind: "MESSAGE", content: id }, usage: { inputTokens: 1, outputTokens: 1, costMicros: 0, currency: "USD", source: "LOCAL_SYNTHETIC" }, providerId: id, model: `${id}-1`, responseDigest: "a".repeat(64), finishReason: "stop", providerRequestId: null, retryable: false };
    },
    cancel: () => false
  };
}

test("model router rejects providers without the required capability", () => {
  const router = new ModelRouter([{ provider: provider("no-tools", { capabilities: { toolCalling: false } }), priority: 0, enabled: true }]);
  const decision = router.route({ requiredCapabilities: ["toolCalling"], dataClasses: ["D0"], allowedFallback: false });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "MISSING_CAPABILITY:toolCalling");
});

test("model router never routes a data class the provider is not authorized for", () => {
  const router = new ModelRouter([{ provider: provider("limited", { dataPolicy: { allowedDataClasses: ["D0"] } }), priority: 0, enabled: true }]);
  const decision = router.route({ requiredCapabilities: [], dataClasses: ["D0", "D3"], allowedFallback: false });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "DATA_CLASS_NOT_AUTHORIZED:D3");
});

test("model router fails closed on fallback unless the policy allows it", () => {
  const candidates = [
    { provider: provider("primary", { capabilities: { toolCalling: false } }), priority: 0, enabled: true },
    { provider: provider("secondary"), priority: 1, enabled: true }
  ];
  const disallowed = new ModelRouter(candidates).route({ requiredCapabilities: ["toolCalling"], dataClasses: ["D0"], allowedFallback: false });
  assert.equal(disallowed.allowed, false);
  assert.equal(disallowed.reason, "FALLBACK_NOT_ALLOWED");
  const allowed = new ModelRouter(candidates).route({ requiredCapabilities: ["toolCalling"], dataClasses: ["D0"], allowedFallback: true });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.providerId, "secondary");
  assert.equal(allowed.fallbackFrom, "primary");
});

test("dynamic kill switches disable a provider per routing call", () => {
  let disabled = false;
  const router = new ModelRouter([{ provider: provider("primary"), priority: 0, enabled: () => !disabled }, { provider: provider("secondary"), priority: 1, enabled: true }]);
  assert.equal(router.route({ requiredCapabilities: [], dataClasses: ["D0"], allowedFallback: true }).providerId, "primary");
  disabled = true;
  const decision = router.route({ requiredCapabilities: [], dataClasses: ["D0"], allowedFallback: true });
  assert.equal(decision.providerId, "secondary");
  assert.equal(decision.fallbackFrom, "primary");
});

test("circuit breaker opens, blocks, half-opens and closes", () => {
  let now = 0;
  const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1_000, halfOpenMaxAttempts: 1, clock: () => now });
  assert.equal(breaker.canAttempt(), true);
  breaker.recordFailure();
  breaker.recordFailure();
  assert.equal(breaker.currentState(), "OPEN");
  assert.equal(breaker.canAttempt(), false);
  now = 1_100;
  assert.equal(breaker.canAttempt(), true);
  assert.equal(breaker.currentState(), "HALF_OPEN");
  assert.equal(breaker.canAttempt(), false);
  breaker.recordSuccess();
  assert.equal(breaker.currentState(), "CLOSED");
  assert.equal(breaker.snapshot().failures, 0);
});

test("retry applies jittered backoff only to retryable errors", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const result = await withModelRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new ModelProviderError("MODEL_TIMEOUT", "timeout", "deepseek");
    return "ok";
  }, { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1_000, random: () => 0.5, sleep: async (ms) => { delays.push(ms); } });
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [75, 150]);

  let nonRetryable = 0;
  await assert.rejects(
    withModelRetry(async () => {
      nonRetryable += 1;
      throw new ModelProviderError("MODEL_BAD_REQUEST", "bad request", "deepseek");
    }, { maxAttempts: 3, sleep: async () => undefined }),
    (error: unknown) => error instanceof ModelProviderError && error.code === "MODEL_BAD_REQUEST"
  );
  assert.equal(nonRetryable, 1);
});

test("retry classification keeps unknown outcomes explicit", () => {
  assert.deepEqual(classifyModelError("MODEL_TIMEOUT"), { retryable: true, nonRetryable: false, reconciliationRequired: false, humanActionRequired: false });
  assert.equal(classifyModelError("MODEL_POLICY_DENIED").humanActionRequired, true);
  assert.equal(classifyModelError("MODEL_UNKNOWN").reconciliationRequired, true);
  assert.equal(classifyModelError("MODEL_CONTEXT_TOO_LARGE").retryable, false);
});

test("usage reconciliation never silently rewrites a mismatch", () => {
  const matched = reconcileUsage(100, { inputTokens: 60, outputTokens: 45, costMicros: 0, currency: "USD", source: "PROVIDER" });
  assert.equal(matched.status, "MATCHED");
  const mismatch = reconcileUsage(100, { inputTokens: 300, outputTokens: 200, costMicros: 0, currency: "USD", source: "PROVIDER" });
  assert.equal(mismatch.status, "MISMATCH");
  assert.equal(mismatch.deltaTokens, 400);
  const unknown = reconcileUsage(100, null);
  assert.equal(unknown.status, "NOT_EVALUATED");
});
