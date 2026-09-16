import test from "node:test";
import assert from "node:assert/strict";
import { createDeepSeekModelProvider, createLocalModelProvider, MockModelProvider } from "@cvg/model-adapters";
import { ModelProviderError, type ModelRequest } from "@cvg/model-runtime";

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    messages: [{ role: "user", content: "olá" }],
    tools: [],
    systemInstructions: "sistema",
    maxOutputTokens: 256,
    temperature: null,
    purpose: "SUMMARY",
    contextDigest: "c".repeat(64),
    responseFormat: "TEXT",
    correlationId: "corr-1",
    ...overrides
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("mock provider is deterministic and declares tool calling", async () => {
  const mock = new MockModelProvider();
  const capabilities = mock.capabilities();
  assert.equal(capabilities.toolCalling, true);
  assert.equal(mock.dataPolicy().training, "NONE");
  const first = await mock.complete(request());
  const second = await mock.complete(request());
  assert.deepEqual(first.reply, second.reply);
  const unavailable = new MockModelProvider({ unavailable: true });
  assert.equal((await unavailable.health()).status, "UNAVAILABLE");
  await assert.rejects(unavailable.complete(request()), (error: unknown) => error instanceof ModelProviderError && error.code === "MODEL_UNAVAILABLE");
});

test("deepseek provider fails closed without a credential before any network call", async () => {
  let called = false;
  const provider = createDeepSeekModelProvider({
    apiKeyResolver: () => null,
    allowedDataClasses: ["D0", "D2"],
    fetchImpl: (async () => {
      called = true;
      return jsonResponse({});
    }) as typeof fetch
  });
  const health = await provider.health();
  assert.equal(health.status, "UNAVAILABLE");
  assert.equal(health.reason, "CREDENTIAL_UNAVAILABLE");
  await assert.rejects(provider.complete(request()), (error: unknown) => error instanceof ModelProviderError && error.code === "MODEL_DEPENDENCY_UNAVAILABLE");
  assert.equal(called, false);
  assert.deepEqual(provider.dataPolicy().allowedDataClasses, ["D0", "D2"]);
});

test("deepseek provider maps a chat-completions response with usage", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const provider = createDeepSeekModelProvider({
    apiKeyResolver: () => "test-key",
    allowedDataClasses: ["D0"],
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as unknown });
      return jsonResponse({ id: "req-1", model: "deepseek-v4-flash", choices: [{ message: { content: "olá mundo" }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 4 } });
    }) as typeof fetch
  });
  const response = await provider.complete(request());
  assert.equal(response.reply.kind, "MESSAGE");
  assert.equal(response.providerId, "deepseek");
  assert.equal(response.model, "deepseek-v4-flash");
  assert.equal(response.usage.inputTokens, 12);
  assert.equal(response.usage.outputTokens, 4);
  assert.equal(response.usage.source, "PROVIDER");
  assert.equal(response.usage.costMicros, null);
  assert.equal(calls[0]?.url, "https://api.deepseek.com/chat/completions");
});

test("deepseek provider maps tool calls and rejects malformed tool arguments", async () => {
  const toolProvider = createDeepSeekModelProvider({
    apiKeyResolver: () => "test-key",
    fetchImpl: (async () => jsonResponse({ choices: [{ message: { content: null, tool_calls: [{ id: "call-1", function: { name: "cvg.patient.read", arguments: "{\"id\":\"p1\"}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 8, completion_tokens: 2 } })) as typeof fetch
  });
  const response = await toolProvider.complete(request({ tools: [{ name: "cvg.patient.read", version: "1.0.0", description: "read", risk: "READ_ONLY", inputSchemaDigest: "s".repeat(64) }] }));
  assert.equal(response.reply.kind, "TOOL_CALL");
  if (response.reply.kind === "TOOL_CALL") {
    assert.equal(response.reply.tool, "cvg.patient.read");
    assert.deepEqual(response.reply.input, { id: "p1" });
  }
  const malformed = createDeepSeekModelProvider({
    apiKeyResolver: () => "test-key",
    fetchImpl: (async () => jsonResponse({ choices: [{ message: { tool_calls: [{ id: "call-1", function: { name: "cvg.patient.read", arguments: "{not json" } }] }, finish_reason: "tool_calls" }] })) as typeof fetch
  });
  await assert.rejects(malformed.complete(request()), (error: unknown) => error instanceof ModelProviderError && error.code === "MODEL_INVALID_RESPONSE");
});

test("deepseek provider normalizes HTTP errors and enforces timeout", async () => {
  const rateLimited = createDeepSeekModelProvider({
    apiKeyResolver: () => "test-key",
    fetchImpl: (async () => jsonResponse({ error: "slow down" }, 429)) as typeof fetch
  });
  await assert.rejects(rateLimited.complete(request()), (error: unknown) => error instanceof ModelProviderError && error.code === "MODEL_RATE_LIMITED" && error.classification.retryable);

  const unauthorized = createDeepSeekModelProvider({
    apiKeyResolver: () => "test-key",
    fetchImpl: (async () => jsonResponse({ error: "no" }, 401)) as typeof fetch
  });
  await assert.rejects(unauthorized.complete(request()), (error: unknown) => error instanceof ModelProviderError && error.code === "MODEL_POLICY_DENIED" && error.classification.humanActionRequired);

  const serverError = createDeepSeekModelProvider({
    apiKeyResolver: () => "test-key",
    fetchImpl: (async () => jsonResponse({ error: "boom" }, 503)) as typeof fetch
  });
  await assert.rejects(serverError.complete(request()), (error: unknown) => error instanceof ModelProviderError && error.code === "MODEL_UNAVAILABLE" && error.classification.retryable);

  const timeout = createDeepSeekModelProvider({
    apiKeyResolver: () => "test-key",
    timeoutMs: 100,
    fetchImpl: ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("PROVIDER_TIMEOUT"), { name: "AbortError" })));
    })) as typeof fetch
  });
  await assert.rejects(timeout.complete(request()), (error: unknown) => error instanceof ModelProviderError && error.code === "MODEL_TIMEOUT");
});

test("local provider declares on-prem data policy and works without credentials", async () => {
  const local = createLocalModelProvider({
    baseUrl: "http://127.0.0.1:11434",
    model: "local-model",
    fetchImpl: (async () => jsonResponse({ choices: [{ message: { content: "local" }, finish_reason: "stop" }] })) as typeof fetch
  });
  const policy = local.dataPolicy();
  assert.equal(policy.region, "on-prem");
  assert.equal(policy.training, "NONE");
  assert.equal(policy.retention, "NONE");
  const response = await local.complete(request());
  assert.equal(response.providerId, "local");
  assert.equal(response.reply.kind, "MESSAGE");
});

test("local provider rejects insecure configuration unless explicitly allowed", () => {
  assert.throws(() => createLocalModelProvider({ baseUrl: "http://localhost:1234", model: "m", allowInsecureHttp: false }));
  assert.throws(() => new MockModelProvider({}) && createDeepSeekModelProvider({ apiKeyResolver: () => "k", baseUrl: "ftp://api.deepseek.com" }));
});
