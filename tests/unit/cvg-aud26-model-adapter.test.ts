import test from "node:test";
import assert from "node:assert/strict";
import { createDeepSeekModelProvider } from "@cvg/model-adapters";
import { ModelProviderError, type ModelRequest } from "@cvg/model-runtime";

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
    correlationId: "cvg-aud26-model",
    ...overrides
  };
}

function responseBodyStream(chunks: readonly string[], onCancel: () => void, close = true): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (close) controller.close();
    },
    cancel() {
      onCancel();
    }
  });
}

test("model adapter rejects output requests above the configured model budget before dispatch", async () => {
  let dispatched = false;
  const provider = createDeepSeekModelProvider({
    apiKeyResolver: () => "fixture-key",
    maxOutputTokens: 64,
    fetchImpl: (async () => {
      dispatched = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch
  });
  await assert.rejects(
    () => provider.complete(request({ maxOutputTokens: 65 })),
    (error: unknown) => error instanceof ModelProviderError && error.code === "MODEL_BAD_REQUEST"
  );
  assert.equal(dispatched, false);
});

test("model adapter cancels a hostile chunked body at the byte budget without exposing body content", async () => {
  let cancelled = false;
  const provider = createDeepSeekModelProvider({
    apiKeyResolver: () => "fixture-key",
    maxResponseBodyBytes: 64,
    fetchImpl: (async () => new Response(responseBodyStream(["{\"choices\":[{\"message\":{\"content\":\"", "x".repeat(128)], () => { cancelled = true; }, false), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch
  });
  await assert.rejects(
    () => provider.complete(request()),
    (error: unknown) => error instanceof ModelProviderError && error.code === "MODEL_INVALID_RESPONSE" && !error.message.includes("xxx")
  );
  assert.equal(cancelled, true);
});

test("model adapter accepts a bounded chunked response and rejects invalid response shapes", async () => {
  const good = createDeepSeekModelProvider({
    apiKeyResolver: () => "fixture-key",
    maxResponseBodyBytes: 1_024,
    fetchImpl: (async () => new Response(responseBodyStream(["{\"choices\":[{\"message\":{\"content\":\"ok\"},", "\"finish_reason\":\"stop\"}]}"], () => undefined), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch
  });
  const response = await good.complete(request());
  assert.deepEqual(response.reply, { kind: "MESSAGE", content: "ok" });

  const invalid = createDeepSeekModelProvider({
    apiKeyResolver: () => "fixture-key",
    fetchImpl: (async () => new Response(JSON.stringify({ choices: [{ message: { content: 42 } }] }), { status: 200 })) as typeof fetch
  });
  await assert.rejects(invalid.complete(request()), (error: unknown) => error instanceof ModelProviderError && error.code === "MODEL_INVALID_RESPONSE");
});

test("model adapter sends true SSE streaming requests and emits bounded deltas incrementally", async () => {
  let requestBody: Record<string, unknown> | null = null;
  const provider = createDeepSeekModelProvider({
    apiKeyResolver: () => "fixture-key",
    fetchImpl: (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(responseBodyStream([
        'data: {"id":"stream-1","choices":[{"delta":{"content":"olá"}}]}\n\n',
        'data: {"id":"stream-1","choices":[{"delta":{"content":" mundo"},"finish_reason":"stop"}]}\n\n',
        'data: {"id":"stream-1","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n',
        "data: [DONE]\n\n"
      ], () => undefined), { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch
  });
  const events = [];
  for await (const event of provider.stream!(request())) events.push(event);
  assert.equal((requestBody as Record<string, unknown> | null)?.stream, true);
  assert.deepEqual(events.filter((event) => event.type === "text-delta"), [
    { type: "text-delta", delta: "olá" },
    { type: "text-delta", delta: " mundo" }
  ]);
  assert.equal(events.at(-1)?.type, "done");
  assert.equal(events.some((event) => event.type === "error"), false);
});

test("model stream cancels and rejects text beyond the requested output token budget", async () => {
  let cancelled = false;
  const provider = createDeepSeekModelProvider({
    apiKeyResolver: () => "fixture-key",
    fetchImpl: (async () => new Response(responseBodyStream([
      'data: {"choices":[{"delta":{"content":"123456789012"}}]}\n\n',
      "data: [DONE]\n\n"
    ], () => { cancelled = true; }, false), { status: 200, headers: { "content-type": "text/event-stream" } })) as typeof fetch
  });
  const events = [];
  for await (const event of provider.stream!(request({ maxOutputTokens: 2 }))) events.push(event);

  assert.equal(events.some((event) => event.type === "error" && event.code === "MODEL_INVALID_RESPONSE"), true);
  assert.equal(events.some((event) => event.type === "text-delta"), false);
  assert.equal(events.some((event) => event.type === "done"), false);
  assert.equal(cancelled, true);
});

test("model stream charges tool-call output against the requested token budget", async () => {
  const provider = createDeepSeekModelProvider({
    apiKeyResolver: () => "fixture-key",
    fetchImpl: (async () => new Response(responseBodyStream([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"lookup","arguments":"{\\"id\\":\\"123456789\\"}"}}]}}]}\n\n',
      "data: [DONE]\n\n"
    ], () => undefined), { status: 200, headers: { "content-type": "text/event-stream" } })) as typeof fetch
  });
  const events = [];
  for await (const event of provider.stream!(request({ maxOutputTokens: 2 }))) events.push(event);

  assert.equal(events.some((event) => event.type === "error" && event.code === "MODEL_INVALID_RESPONSE"), true);
  assert.equal(events.some((event) => event.type === "tool-call"), false);
  assert.equal(events.some((event) => event.type === "done"), false);
});

test("model stream rejects provider-reported usage above the requested token budget", async () => {
  const provider = createDeepSeekModelProvider({
    apiKeyResolver: () => "fixture-key",
    fetchImpl: (async () => new Response(responseBodyStream([
      'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":3}}\n\n',
      "data: [DONE]\n\n"
    ], () => undefined), { status: 200, headers: { "content-type": "text/event-stream" } })) as typeof fetch
  });
  const events = [];
  for await (const event of provider.stream!(request({ maxOutputTokens: 2 }))) events.push(event);

  assert.equal(events.some((event) => event.type === "error" && event.code === "MODEL_INVALID_RESPONSE"), true);
  assert.equal(events.some((event) => event.type === "usage"), false);
  assert.equal(events.some((event) => event.type === "done"), false);
});
