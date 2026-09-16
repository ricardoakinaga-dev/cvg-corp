import test from "node:test";
import assert from "node:assert/strict";
import { createDeepSeekModelProvider, createLocalModelProvider, MockModelProvider } from "@cvg/model-adapters";
import { ModelProviderError, type ModelProvider, type ModelRequest, type ModelResponse } from "@cvg/model-runtime";

/**
 * Every ModelProvider must satisfy the same contract.  The suite asserts the
 * uniform shape (health, capabilities, data policy, response envelope, usage,
 * cancellation and error normalization) without duplicating adapter-specific
 * mapping tests.
 */

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    messages: [{ role: "user", content: "olá" }],
    tools: [],
    systemInstructions: "sistema",
    maxOutputTokens: 128,
    temperature: null,
    purpose: "SUMMARY",
    contextDigest: "c".repeat(64),
    responseFormat: "TEXT",
    correlationId: "contract-1",
    ...overrides
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const okBody = (content: string) => ({ id: "req-1", model: "provider-model", choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 3 } });

function providers(): { name: string; provider: ModelProvider }[] {
  return [
    { name: "mock", provider: new MockModelProvider({ script: [{ reply: { kind: "MESSAGE", content: "mock" }, usage: { inputTokens: 1, outputTokens: 1, costMicros: 0, currency: "USD", source: "LOCAL_SYNTHETIC" }, providerId: "mock-model", model: "mock-1", responseDigest: "a".repeat(64), finishReason: "stop", providerRequestId: "m", retryable: false }] }) },
    { name: "deepseek", provider: createDeepSeekModelProvider({ apiKeyResolver: () => "contract-key", fetchImpl: (async () => jsonResponse(okBody("deepseek"))) as typeof fetch }) },
    { name: "local", provider: createLocalModelProvider({ baseUrl: "http://127.0.0.1:11434", model: "local-model", fetchImpl: (async () => jsonResponse(okBody("local"))) as typeof fetch }) }
  ];
}

for (const { name, provider } of providers()) {
  test(`${name} provider satisfies the shared ModelProvider contract`, async () => {
    assert.ok(provider.providerId.length > 0);
    const capabilities = provider.capabilities();
    for (const capability of ["toolCalling", "structuredOutput", "streaming", "reasoning", "vision"] as const) assert.equal(typeof capabilities[capability], "boolean", `${name}.${capability}`);
    assert.ok(Number.isInteger(capabilities.contextWindow) && capabilities.contextWindow > 0);
    assert.ok(Number.isInteger(capabilities.maxOutput) && capabilities.maxOutput > 0);
    const policy = provider.dataPolicy();
    assert.ok(Array.isArray(policy.allowedDataClasses));
    for (const dataClass of policy.allowedDataClasses) assert.match(dataClass, /^D[0-5]$/);
    assert.ok(["UNKNOWN", "NONE", "SESSION", "TEMPORARY", "EXTENDED"].includes(policy.retention));
    assert.ok(["UNKNOWN", "NONE", "OPT_IN", "YES"].includes(policy.training));

    const health = await provider.health();
    assert.ok(["READY", "DEGRADED", "UNAVAILABLE", "DISABLED"].includes(health.status));
    assert.equal(typeof health.checkedAt, "string");
    assert.equal(typeof provider.cancel("contract-request"), "boolean");

    const response = await provider.complete(request());
    assert.ok(["MESSAGE", "TOOL_CALL", "STRUCTURED"].includes(response.reply.kind));
    assert.match(response.responseDigest, /^[a-f0-9]{64}$/);
    assert.ok(Number.isInteger(response.usage.inputTokens) && response.usage.inputTokens >= 0);
    assert.ok(Number.isInteger(response.usage.outputTokens) && response.usage.outputTokens >= 0);
    assert.ok(["PROVIDER", "LOCAL_SYNTHETIC", "UNAVAILABLE"].includes(response.usage.source));
    assert.ok(["stop", "length", "tool_calls", "content_filter", "error"].includes(response.finishReason));
    assert.equal(typeof response.retryable, "boolean");
    assert.ok(response.providerId.length > 0 && response.model.length > 0);
  });
}

test("providers normalize HTTP failures into classified errors", async () => {
  const cases: { status: number; code: string; retryable: boolean }[] = [
    { status: 429, code: "MODEL_RATE_LIMITED", retryable: true },
    { status: 500, code: "MODEL_UNAVAILABLE", retryable: true },
    { status: 401, code: "MODEL_POLICY_DENIED", retryable: false },
    { status: 400, code: "MODEL_BAD_REQUEST", retryable: false }
  ];
  for (const item of cases) {
    for (const provider of [createDeepSeekModelProvider({ apiKeyResolver: () => "k", fetchImpl: (async () => jsonResponse({ error: "x" }, item.status)) as typeof fetch }), createLocalModelProvider({ baseUrl: "http://127.0.0.1:11434", model: "m", fetchImpl: (async () => jsonResponse({ error: "x" }, item.status)) as typeof fetch })]) {
      await assert.rejects(
        provider.complete(request()),
        (error: unknown) => error instanceof ModelProviderError && error.code === item.code && error.classification.retryable === item.retryable
      );
    }
  }
});

test("providers fail closed without credentials and never call the network", async () => {
  let calls = 0;
  const provider = createDeepSeekModelProvider({ apiKeyResolver: () => null, fetchImpl: (async () => { calls += 1; return jsonResponse(okBody("x")); }) as typeof fetch });
  const health = await provider.health();
  assert.equal(health.status, "UNAVAILABLE");
  await assert.rejects(provider.complete(request()), (error: unknown) => error instanceof ModelProviderError && error.code === "MODEL_DEPENDENCY_UNAVAILABLE");
  assert.equal(calls, 0);
});

test("tool calling is only advertised when the provider declares it", () => {
  const noTools = new MockModelProvider({ capabilities: { toolCalling: false } });
  assert.equal(noTools.capabilities().toolCalling, false);
  const toolProvider = createDeepSeekModelProvider({ apiKeyResolver: () => "k" });
  assert.equal(toolProvider.capabilities().toolCalling, true);
});

void (null as unknown as ModelResponse);
