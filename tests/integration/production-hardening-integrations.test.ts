import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test, { type TestContext } from "node:test";
import {
  HttpMessagingProvider, MessagingProviderError, createMessagingExternalEffectQueryAdapter,
  type HttpMessagingProviderOptions
} from "@cvg/integrations";
import { id } from "@cvg/contracts";

const secret = "synthetic-loopback-hardening-secret";
const message = { idempotencyKey: "hardening-send-1", channel: "EMAIL" as const, to: "synthetic@example.invalid", body: "Synthetic fixture only" };
const providerRequestId = "hardening-provider-request";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((fulfill) => { resolve = fulfill; });
  return { promise, resolve };
}

function receipt(status: "ACCEPTED" | "DELIVERED") {
  return { providerRequestId, providerMessageId: "hardening-message", status, receivedAt: "2026-10-04T00:00:00.000Z" };
}

function respond(response: ServerResponse, payload: unknown) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function sandbox(t: TestContext, handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const options: HttpMessagingProviderOptions = {
    endpoint: "https://provider.example.test", allowedHosts: ["provider.example.test"],
    credentialRef: "synthetic.provider", secretResolver: async () => secret,
    rateLimiter: null, circuitBreaker: null,
    // This transport can reach only this test's loopback server. No real DNS/provider calls.
    fetch: async (input, init) => {
      const url = new URL(input);
      assert.equal(url.origin, "https://provider.example.test");
      return fetch(`${endpoint}${url.pathname}${url.search}`, { ...init, redirect: "manual" });
    }
  };
  return options;
}

test("production hardening: options cancellation during credentials prevents HTTP dispatch", async (t) => {
  let posts = 0;
  const options = await sandbox(t, (request, response) => {
    if (request.method === "POST") posts += 1;
    request.resume();
    respond(response, { providerRequestId, status: "DELIVERED", receipt: receipt("DELIVERED") });
  });
  const entered = deferred<void>();
  const credentials = deferred<string>();
  const controller = new AbortController();
  const provider = new HttpMessagingProvider({ ...options, secretResolver: async () => { entered.resolve(); return credentials.promise; } });
  const pending = provider.send({ ...message, signal: new AbortController().signal }, { signal: controller.signal })
    .then((result) => ({ result, error: null }), (error: unknown) => ({ result: null, error }));
  await entered.promise;
  controller.abort();
  credentials.resolve(secret);
  const observed = await pending;
  assert.equal(posts, 0, "cancelled dispatch must not reach the provider");
  assert.ok(observed.error instanceof MessagingProviderError);
  assert.equal(observed.error.failure, "CANCELLED");
  assert.equal(observed.error.outcome, "NOT_SENT");
});

test("production hardening: cancellation after dispatch remains unknown without automatic resend", async (t) => {
  const controller = new AbortController();
  let posts = 0;
  let queries = 0;
  const options = await sandbox(t, (request, response) => {
    request.resume();
    if (request.method === "POST") {
      posts += 1;
      controller.abort();
      respond(response, { providerRequestId, status: "DELIVERED", receipt: receipt("DELIVERED") });
    } else {
      queries += 1;
      respond(response, { providerRequestId, status: "SUCCEEDED", receipt: receipt("DELIVERED") });
    }
  });
  const provider = new HttpMessagingProvider(options);
  const result = await provider.send(message, { signal: controller.signal });
  assert.equal(result.status, "OUTCOME_UNKNOWN");
  const reconciled = await provider.queryStatus({ idempotencyKey: message.idempotencyKey });
  assert.equal(reconciled.status, "SUCCEEDED");
  assert.equal(posts, 1);
  assert.equal(queries, 1);
});

test("production hardening: cancellation does not wait for an unresolved credential dependency", async (t) => {
  let calls = 0;
  const options = await sandbox(t, (request, response) => {
    calls += 1;
    request.resume();
    respond(response, {});
  });
  const entered = deferred<void>();
  const credentials = deferred<string>();
  t.after(() => credentials.resolve(secret));
  const controller = new AbortController();
  const provider = new HttpMessagingProvider({
    ...options, defaultTimeoutMs: 1_000,
    secretResolver: async () => { entered.resolve(); return credentials.promise; }
  });
  const pending = provider.send({ ...message, signal: controller.signal })
    .then(() => null, (error: unknown) => error);
  await entered.promise;
  controller.abort();
  const error = await pending;
  assert.ok(error instanceof MessagingProviderError);
  assert.equal(error.failure, "CANCELLED");
  assert.equal(error.outcome, "NOT_SENT");
  assert.equal(calls, 0);
});

test("production hardening: an ACCEPTED query receipt cannot settle delivery", async (t) => {
  let receiptStatus: "ACCEPTED" | "DELIVERED" = "ACCEPTED";
  let posts = 0;
  let queries = 0;
  const options = await sandbox(t, (request, response) => {
    request.resume();
    if (request.method === "POST") posts += 1;
    else queries += 1;
    respond(response, { providerRequestId, status: "SUCCEEDED", receipt: receipt(receiptStatus) });
  });
  const provider = new HttpMessagingProvider(options);
  const result = await provider.queryStatus({ providerRequestId });
  assert.equal(result.status, "OUTCOME_UNKNOWN");
  assert.equal(result.receipt, null);
  const adapter = createMessagingExternalEffectQueryAdapter(provider);
  const effect = {
    effectId: id("00000000-0000-4000-8000-000000000001"), integrationId: "outbox:communication.message.approved",
    idempotencyKey: message.idempotencyKey, providerRequestId, request: {}, signal: new AbortController().signal
  };
  await assert.rejects(() => adapter.query(effect), { code: "DEPENDENCY_UNAVAILABLE" });
  receiptStatus = "DELIVERED";
  assert.equal((await adapter.query(effect)).status, "SUCCEEDED");
  assert.equal(posts, 0);
  assert.equal(queries, 3);
});

test("production hardening: unavailable configuration and credentials produce no HTTP effects", async (t) => {
  let calls = 0;
  const options = await sandbox(t, (request, response) => {
    calls += 1;
    request.resume();
    respond(response, {});
  });
  for (const scenario of [
    { name: "missing endpoint", options: { ...options, endpoint: "" }, failure: "CONFIGURATION" },
    { name: "missing credential", options: { ...options, credentialRef: "" }, failure: "CREDENTIAL" },
    { name: "resolver unavailable", options: { ...options, secretResolver: async () => { throw new Error(secret); } }, failure: "CREDENTIAL" }
  ]) {
    await t.test(scenario.name, async () => {
      await assert.rejects(() => new HttpMessagingProvider(scenario.options).send(message), (error: unknown) => {
        assert.ok(error instanceof MessagingProviderError);
        assert.equal(error.failure, scenario.failure);
        assert.equal(error.outcome, "NOT_SENT");
        assert.equal(error.message.includes(secret), false);
        return true;
      });
    });
  }
  assert.equal(calls, 0);
});
