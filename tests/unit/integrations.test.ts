import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { id } from "@cvg/contracts";
import { DomainError } from "@cvg/domain";
import { createMessagingExternalEffectQueryAdapter, DockerSecretProvider, HttpMessagingProvider, inboxEventToOutbox, IntegrationGateway, MessagingCircuitBreaker, MessagingOutboxSink, MessagingProviderError, MessagingRateLimiter, OutboxWorker, reconcileUnknownExternalEffect, redactMessagingError, StaticSecretProvider, SyntheticMessagingProvider, verifyMessagingCallback, type ExternalEffectLedger } from "@cvg/integrations";
import type { DurableExternalEffectRecord, DurableExternalReconciliationEvidence, DurableInboxInput, DurableOutboxRecord } from "@cvg/persistence";

const organizationId = id("00000000-0000-4000-0000-000000000010");

function record(idValue: string, attempts: number): DurableOutboxRecord {
  return {
    id: id(idValue),
    organizationId,
    eventType: "synthetic.event",
    aggregateId: id("00000000-0000-4000-0000-000000000101"),
    payload: { synthetic: true },
    status: "CLAIMED",
    attempts,
    availableAt: "2026-01-01T00:00:00.000Z",
    claimedBy: "worker-1",
    leaseUntil: "2099-01-01T00:00:00.000Z",
    fenceToken: 4n,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    processedAt: null,
    recordDigest: "synthetic-digest"
  };
}

test("outbox worker acknowledges delivery and quarantines exhausted retries", async () => {
  const claimed = [record("00000000-0000-4000-0000-000000000201", 1), record("00000000-0000-4000-0000-000000000202", 2)];
  const completed: string[] = [];
  const failed: Array<{ id: string; quarantine: boolean }> = [];
  const worker = new OutboxWorker({
    claimOutbox: async () => claimed,
    completeOutbox: async (_organizationId, recordId) => { completed.push(recordId); },
    failOutbox: async (_organizationId, recordId, _workerId, _fenceToken, _reason, quarantine) => { failed.push({ id: recordId, quarantine: Boolean(quarantine) }); return quarantine ? "QUARANTINED" : "PENDING"; }
  });

  const result = await worker.runOnce(organizationId, "worker-1", { deliver: async (item) => item.id.endsWith("201") ? "DELIVERED" : "RETRY" }, { maxAttempts: 2 });
  assert.deepEqual(result, { claimed: 2, delivered: 1, retried: 0, quarantined: 1, outcomeUnknown: 0 });
  assert.deepEqual(completed, ["00000000-0000-4000-0000-000000000201"]);
  assert.deepEqual(failed, [{ id: "00000000-0000-4000-0000-000000000202", quarantine: true }]);
});

test("outbox worker records the external dispatch boundary before completing the outbox", async () => {
  const item = record("00000000-0000-4000-0000-000000000203", 1);
  const transitions: string[] = [];
  let effect: DurableExternalEffectRecord = {
    id: item.id,
    organizationId,
    outboxId: item.id,
    integrationId: "outbox:synthetic.event",
    idempotencyKey: item.id,
    request: { synthetic: true },
    requestDigest: "request-digest",
    status: "ADMISSION_PENDING",
    attempts: 0,
    claimedBy: "worker-1",
    leaseUntil: "2099-01-01T00:00:00.000Z",
    fenceToken: item.fenceToken,
    providerRequestId: null,
    response: null,
    lastError: null,
    outcomeDigest: null,
    reconciliationSource: null,
    reconciledAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  const effects: ExternalEffectLedger = {
    prepareExternalEffect: async () => effect,
    markExternalEffectDispatched: async () => {
      transitions.push("DISPATCHED");
      effect = { ...effect, status: "DISPATCHED", attempts: 1 };
      return effect;
    },
    recordExternalEffectOutcome: async (_organizationId, _effectId, _workerId, _fenceToken, outcome) => {
      transitions.push(outcome.status);
      effect = { ...effect, status: outcome.status, claimedBy: null, leaseUntil: null };
      return effect;
    }
  };
  const completed: string[] = [];
  const worker = new OutboxWorker({
    claimOutbox: async () => [item],
    completeOutbox: async (_organizationId, recordId) => { completed.push(recordId); },
    failOutbox: async () => "QUARANTINED"
  }, effects);

  const result = await worker.runOnce(organizationId, "worker-1", { deliver: async () => ({ status: "DELIVERED", providerRequestId: "synthetic-provider-1", receipt: { synthetic: true } }) });
  assert.deepEqual(result, { claimed: 1, delivered: 1, retried: 0, quarantined: 0, outcomeUnknown: 0 });
  assert.deepEqual(transitions, ["DISPATCHED", "SUCCEEDED"]);
  assert.deepEqual(completed, [item.id]);
});

test("signed inbox projection creates a bounded local outbox without copying signature metadata", () => {
  const input: DurableInboxInput = {
    id: id("00000000-0000-4000-0000-000000000204"),
    organizationId,
    consumer: "diagnostics.consumer",
    provider: "lab.synthetic",
    externalEventId: "provider-event-204",
    eventType: "result.received",
    schemaVersion: 1,
    signatureAlgorithm: "HMAC-SHA256",
    signatureKeyRef: "synthetic-test-key",
    signature: "a".repeat(64),
    payload: { resultId: "opaque-result", value: "redacted-fixture" }
  };
  const outbox = inboxEventToOutbox(input);
  assert.equal(outbox.organizationId, organizationId);
  assert.equal(outbox.aggregateId, input.id);
  assert.match(outbox.eventType, /^integration\.inbox\.lab\.synthetic\.result\.received$/);
  assert.equal((outbox.payload as { source: string }).source, "SIGNED_INBOX");
  assert.equal("signature" in outbox.payload, false);
  assert.deepEqual((outbox.payload as { payload: unknown }).payload, input.payload);
});

test("provider reconciliation binds the query proof to the exact effect", async () => {
  const effect: DurableExternalEffectRecord = {
    id: id("00000000-0000-4000-0000-000000000205"),
    organizationId,
    outboxId: id("00000000-0000-4000-0000-000000000206"),
    integrationId: "provider.synthetic.query",
    idempotencyKey: "effect-205",
    request: { orderId: "opaque-order" },
    requestDigest: "request-digest",
    status: "OUTCOME_UNKNOWN",
    attempts: 1,
    claimedBy: null,
    leaseUntil: null,
    fenceToken: 2n,
    providerRequestId: null,
    response: null,
    lastError: "timeout",
    outcomeDigest: null,
    reconciliationSource: null,
    reconciledAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  let captured: DurableExternalReconciliationEvidence | null = null;
  const result = await reconcileUnknownExternalEffect({
    listExternalEffects: async () => [effect],
    reconcileExternalEffect: async (_organizationId, effectId, evidence) => {
      captured = evidence;
      return { ...effect, id: effectId, status: evidence.status, providerRequestId: evidence.providerRequestId, response: evidence.response, outcomeDigest: evidence.queryDigest, reconciliationSource: evidence.source, reconciledAt: evidence.observedAt };
    }
  }, organizationId, effect.id, {
    integrationIds: [effect.integrationId],
    query: async ({ effectId, idempotencyKey, signal }) => {
      assert.equal(effectId, effect.id);
      assert.equal(idempotencyKey, effect.idempotencyKey);
      assert.equal(signal.aborted, false);
      return { status: "SUCCEEDED", providerRequestId: "provider-receipt-205", response: { confirmed: true }, source: "SYNTHETIC_PROVIDER_QUERY" };
    }
  });
  assert.equal(result.status, "SUCCEEDED");
  const observed = captured as unknown as DurableExternalReconciliationEvidence | null;
  if (!observed) throw new Error("reconciliation did not pass evidence to persistence");
  assert.equal(observed.status, "SUCCEEDED");
  assert.equal(observed.providerRequestId, "provider-receipt-205");
  assert.match(observed.queryDigest, /^[a-f0-9]{64}$/);
});

test("provider reconciliation enforces a hard query deadline", async () => {
  const effect: DurableExternalEffectRecord = {
    id: id("00000000-0000-4000-0000-000000000207"),
    organizationId,
    outboxId: id("00000000-0000-4000-0000-000000000208"),
    integrationId: "provider.synthetic.timeout",
    idempotencyKey: "effect-207",
    request: { orderId: "opaque-order" },
    requestDigest: "request-digest",
    status: "RECONCILIATION_REQUIRED",
    attempts: 1,
    claimedBy: null,
    leaseUntil: null,
    fenceToken: 2n,
    providerRequestId: null,
    response: null,
    lastError: "timeout",
    outcomeDigest: null,
    reconciliationSource: null,
    reconciledAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  await assert.rejects(
    () => reconcileUnknownExternalEffect({ listExternalEffects: async () => [effect], reconcileExternalEffect: async () => effect }, organizationId, effect.id, { integrationIds: [effect.integrationId], query: async () => new Promise(() => undefined) }, { timeoutMs: 100 }),
    (error: unknown) => error instanceof DomainError && error.code === "DEPENDENCY_UNAVAILABLE"
  );
});

test("provider reconciliation claims an eligible effect once before querying", async () => {
  const effect: DurableExternalEffectRecord = {
    id: id("00000000-0000-4000-0000-000000000209"), organizationId, outboxId: id("00000000-0000-4000-0000-000000000210"), integrationId: "provider.synthetic.claim", idempotencyKey: "effect-209", request: { orderId: "opaque-order" }, requestDigest: "request-digest", status: "OUTCOME_UNKNOWN", attempts: 1, claimedBy: null, leaseUntil: null, fenceToken: 2n, providerRequestId: null, response: null, lastError: "timeout", outcomeDigest: null, reconciliationSource: null, reconciledAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z"
  };
  let claimCalls = 0;
  let queryCalls = 0;
  let receivedClaim: { workerId: string; fenceToken: bigint } | undefined;
  const claimed = { ...effect, status: "RECONCILING" as const, claimedBy: "reconciliation-test", leaseUntil: "2099-01-01T00:00:00.000Z", fenceToken: 3n };
  const result = await reconcileUnknownExternalEffect({
    listExternalEffects: async () => [effect],
    claimExternalEffectForReconciliation: async () => { claimCalls += 1; return claimed; },
    reconcileExternalEffect: async (_organizationId, effectId, evidence, claim) => { receivedClaim = claim; return { ...claimed, id: effectId, status: evidence.status, providerRequestId: evidence.providerRequestId, response: evidence.response, outcomeDigest: evidence.queryDigest, reconciliationSource: evidence.source, reconciledAt: evidence.observedAt, claimedBy: null, leaseUntil: null }; }
  }, organizationId, effect.id, {
    integrationIds: [effect.integrationId],
    query: async ({ effectId, idempotencyKey, signal }) => { queryCalls += 1; assert.equal(effectId, effect.id); assert.equal(idempotencyKey, effect.idempotencyKey); assert.equal(signal.aborted, false); return { status: "SUCCEEDED", providerRequestId: "provider-209", response: { confirmed: true }, source: "SYNTHETIC_PROVIDER_QUERY" }; }
  }, { workerId: "reconciliation-test", leaseSeconds: 15 });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(claimCalls, 1);
  assert.equal(queryCalls, 1);
  assert.deepEqual(receivedClaim, { workerId: "reconciliation-test", fenceToken: 3n });
});

test("integration gateway exposes secret-provider health without exposing secret material", () => {
  const unconfigured = new IntegrationGateway();
  assert.equal(unconfigured.getHealth().secretProvider, "NOT_CONFIGURED");
  const synthetic = new StaticSecretProvider(["synthetic-provider-key"]);
  const configured = new IntegrationGateway(synthetic);
  assert.equal(configured.getHealth().secretProvider, "READY");
  assert.equal(synthetic.has("synthetic-provider-key"), true);
  assert.equal("secret" in synthetic, false);
  const docker = new DockerSecretProvider(process.cwd());
  assert.equal(docker.status(), "READY");
  assert.equal(docker.has("missing-synthetic-secret"), false);
});

test("synthetic messaging preserves idempotency and reconciles an unknown outcome", async () => {
  const provider = new SyntheticMessagingProvider({ sendOutcome: "OUTCOME_UNKNOWN" });
  const unknown = await provider.send({ idempotencyKey: "message-unknown-1", channel: "SMS", recipient: "+5511999999999", body: "fixture" });
  assert.equal(unknown.status, "OUTCOME_UNKNOWN");
  assert.equal(unknown.providerRequestId?.startsWith("synthetic-request-"), true);
  const observed = await provider.queryStatus({ requestId: unknown.requestId });
  assert.equal(observed.status, "SUCCEEDED");
  assert.equal(observed.providerRequestId, unknown.providerRequestId);
  const replay = await provider.send({ idempotencyKey: "message-unknown-1", channel: "SMS", recipient: "+5511999999999", body: "fixture" });
  assert.equal(replay.status, "OUTCOME_UNKNOWN");
  await assert.rejects(() => provider.send({ idempotencyKey: "message-unknown-1", channel: "SMS", recipient: "+5511999999999", body: "different" }), (error: unknown) => error instanceof DomainError && error.code === "IDEMPOTENCY_CONFLICT");
});

test("synthetic provider vertical closes outbox, unknown outcome and reconciliation without a blind resend", async () => {
  const item = { ...record("00000000-0000-0000-0000-000000000211", 1), eventType: "communication.message.approved", payload: { messageId: "vertical-message-211", channel: "SMS", recipient: "+5511999999999", template: "vertical", body: "fixture" } };
  let effect: DurableExternalEffectRecord = {
    id: item.id,
    organizationId,
    outboxId: item.id,
    integrationId: "outbox:communication.message.approved",
    idempotencyKey: item.id,
    request: { eventType: item.eventType, payload: item.payload },
    requestDigest: "vertical-request-digest",
    status: "ADMISSION_PENDING",
    attempts: 0,
    claimedBy: "vertical-worker",
    leaseUntil: "2099-01-01T00:00:00.000Z",
    fenceToken: item.fenceToken,
    providerRequestId: null,
    response: null,
    lastError: null,
    outcomeDigest: null,
    reconciliationSource: null,
    reconciledAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  const provider = new SyntheticMessagingProvider({ sendOutcome: "OUTCOME_UNKNOWN" });
  const baseSink = new MessagingOutboxSink(provider, (outbox, context) => ({ idempotencyKey: context.idempotencyKey, requestId: (outbox.payload as { messageId: string }).messageId, channel: "SMS", recipient: "+5511999999999", body: "fixture" }));
  let sinkCalls = 0;
  const sink = { ...baseSink, deliver: async (...args: Parameters<typeof baseSink.deliver>) => { sinkCalls += 1; return baseSink.deliver(...args); } };
  const failures: Array<{ quarantine: boolean; reason: string }> = [];
  const effects: ExternalEffectLedger = {
    prepareExternalEffect: async () => effect,
    markExternalEffectDispatched: async () => { effect = { ...effect, status: "DISPATCHED", attempts: effect.attempts + 1 }; return effect; },
    recordExternalEffectOutcome: async (_organizationId, _effectId, _workerId, _fenceToken, outcome) => {
      effect = { ...effect, status: outcome.status, providerRequestId: outcome.providerRequestId ?? effect.providerRequestId, response: outcome.response ?? null, lastError: outcome.error ?? null, claimedBy: null, leaseUntil: null };
      return effect;
    }
  };
  const worker = new OutboxWorker({
    claimOutbox: async () => [item],
    completeOutbox: async () => { throw new Error("unknown outcome must not complete the outbox"); },
    failOutbox: async (_organizationId, _recordId, _workerId, _fenceToken, reason, quarantine) => { failures.push({ quarantine: Boolean(quarantine), reason }); return quarantine ? "QUARANTINED" : "PENDING"; }
  }, effects);

  const first = await worker.runOnce(organizationId, "vertical-worker", sink);
  assert.deepEqual(first, { claimed: 1, delivered: 0, retried: 0, quarantined: 1, outcomeUnknown: 1 });
  assert.equal(effect.status, "OUTCOME_UNKNOWN");
  assert.equal(effect.providerRequestId?.startsWith("synthetic-request-"), true);
  assert.equal(sinkCalls, 1);
  assert.equal(failures[0]?.quarantine, true);

  const second = await worker.runOnce(organizationId, "vertical-worker-retry", sink);
  assert.deepEqual(second, { claimed: 1, delivered: 0, retried: 0, quarantined: 1, outcomeUnknown: 1 });
  assert.equal(sinkCalls, 1, "an unknown effect is reconciled, never resent blindly");

  const reconciled = await reconcileUnknownExternalEffect({
    listExternalEffects: async () => [effect],
    claimExternalEffectForReconciliation: async () => { effect = { ...effect, status: "RECONCILING", claimedBy: "reconciliation-worker", leaseUntil: "2099-01-01T00:00:00.000Z", fenceToken: effect.fenceToken + 1n }; return effect; },
    reconcileExternalEffect: async (_organizationId, _effectId, evidence, claim) => {
      assert.deepEqual(claim, { workerId: "reconciliation-worker", fenceToken: 5n });
      effect = { ...effect, status: evidence.status, providerRequestId: evidence.providerRequestId, response: evidence.response, outcomeDigest: evidence.queryDigest, reconciliationSource: evidence.source, reconciledAt: evidence.observedAt, claimedBy: null, leaseUntil: null };
      return effect;
    }
  }, organizationId, effect.id, createMessagingExternalEffectQueryAdapter(provider), { workerId: "reconciliation-worker", leaseSeconds: 30 });
  assert.equal(reconciled.status, "SUCCEEDED");
  assert.equal(reconciled.reconciliationSource, "PROVIDER_QUERY");
  assert.equal(reconciled.providerRequestId, effect.providerRequestId);
});

test("HTTP messaging validates receipts, keeps credentials out of results and never retries ambiguous transport", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const provider = new HttpMessagingProvider({
    endpoint: "https://provider.example.test/api",
    credentialRef: "messaging.token",
    secretResolver: async (reference) => reference === "messaging.token" ? "fixture-secret" : null,
    fetch: async (url, init) => {
      calls.push(init ? { url, init } : { url });
      return { ok: true, status: 202, json: async () => ({ requestId: "request-1", providerRequestId: "provider-1", status: "ACCEPTED", receipt: { providerRequestId: "provider-1", providerMessageId: "message-1", status: "ACCEPTED", receivedAt: "2026-01-01T00:00:00.000Z" } }) };
    }
  });
  const delivered = await provider.send({ requestId: "request-1", idempotencyKey: "http-message-1", channel: "EMAIL", to: "guardian@example.test", content: "fixture" });
  assert.equal(delivered.status, "DELIVERED");
  assert.equal(delivered.providerRequestId, "provider-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://provider.example.test/api/messages");
  assert.match(String(calls[0]?.init?.headers && (calls[0]?.init?.headers as Record<string, string>).authorization), /Bearer fixture-secret/);

  const unknownProvider = new HttpMessagingProvider({ endpoint: "https://provider.example.test", credentialRef: "messaging.token", secretResolver: async () => "fixture-secret", fetch: async () => new Promise(() => undefined) });
  const unknown = await unknownProvider.send({ idempotencyKey: "http-timeout-1", channel: "SMS", recipient: "+5511999999999", body: "fixture", timeoutMs: 100 });
  assert.equal(unknown.status, "OUTCOME_UNKNOWN");
  await assert.rejects(() => new HttpMessagingProvider({ endpoint: "http://provider.example.test", credentialRef: "messaging.token", secretResolver: async () => "fixture-secret" }).send({ idempotencyKey: "insecure-1", channel: "SMS", recipient: "+5511999999999", body: "fixture" }), (error: unknown) => error instanceof MessagingProviderError && error.failure === "CONFIGURATION");
});

test("messaging callbacks require a valid HMAC and external sinks require the durable effect ledger", async () => {
  const payload = JSON.stringify({ providerRequestId: "provider-1", status: "DELIVERED" });
  const signature = createHmac("sha256", "callback-secret").update(payload).digest("hex");
  assert.equal(verifyMessagingCallback(payload, `sha256=${signature}`, "callback-secret"), true);
  assert.equal(verifyMessagingCallback(payload, signature.slice(0, -1) + "0", "callback-secret"), false);

  const provider = new SyntheticMessagingProvider();
  const sink = new MessagingOutboxSink(provider, (_record, context) => ({ idempotencyKey: context.idempotencyKey, channel: "SMS", recipient: "+5511999999999", body: "fixture" }));
  assert.equal(sink.requiresDurableEffectLedger, true);
  let deliveredCalls = 0;
  const failed: string[] = [];
  const worker = new OutboxWorker({ claimOutbox: async () => [record("00000000-0000-4000-0000-000000000209", 1)], completeOutbox: async () => undefined, failOutbox: async (_organizationId, recordId) => { failed.push(recordId); return "QUARANTINED"; } });
  const result = await worker.runOnce(organizationId, "worker-without-ledger", { ...sink, deliver: async (...args) => { deliveredCalls += 1; return sink.deliver(...args); } });
  assert.deepEqual(result, { claimed: 1, delivered: 0, retried: 0, quarantined: 1, outcomeUnknown: 0 });
  assert.equal(deliveredCalls, 0);
  assert.deepEqual(failed, ["00000000-0000-4000-0000-000000000209"]);
});

test("HTTP messaging fails closed, rejects malformed receipts and redacts provider failures", async () => {
  let calls = 0;
  const injectedFetch = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({ requestId: "request-invalid", providerRequestId: "provider-invalid", receipt: { providerMessageId: "message-invalid", status: "BROKEN", receivedAt: "2026-01-01T00:00:00.000Z" } }) };
  };
  await assert.rejects(() => new HttpMessagingProvider({ fetch: injectedFetch }).send({ idempotencyKey: "no-endpoint", channel: "SMS", recipient: "+5511", body: "fixture" }), (error: unknown) => error instanceof DomainError && error.code === "CAPABILITY_DISABLED");
  await assert.rejects(() => new HttpMessagingProvider({ endpoint: "https://provider.example.test", credentialRef: "messaging.token", secretResolver: async () => null, fetch: injectedFetch }).send({ idempotencyKey: "no-credential", channel: "SMS", recipient: "+5511", body: "fixture" }), (error: unknown) => error instanceof DomainError && error.code === "CREDENTIAL_UNAVAILABLE");
  const invalid = await new HttpMessagingProvider({ endpoint: "https://provider.example.test", credentialRef: "messaging.token", secretResolver: async () => "fixture-secret", fetch: injectedFetch }).send({ idempotencyKey: "invalid-receipt", channel: "SMS", recipient: "+5511", body: "fixture" });
  assert.equal(invalid.status, "OUTCOME_UNKNOWN");
  assert.equal(calls, 1);
  assert.equal(redactMessagingError(new Error("authorization=fixture-secret Bearer fixture-token"), ["fixture-secret", "fixture-token"]).includes("fixture-secret"), false);
});

test("messaging rate limiter and circuit breaker stop new egress explicitly", async () => {
  let time = 0;
  const limited = new SyntheticMessagingProvider({ rateLimiter: new MessagingRateLimiter({ maxRequests: 1, windowMs: 1_000, now: () => time }) });
  await limited.send({ idempotencyKey: "rate-1", channel: "SMS", recipient: "+5511", body: "fixture" });
  await assert.rejects(() => limited.send({ idempotencyKey: "rate-2", channel: "SMS", recipient: "+5511", body: "fixture" }), (error: unknown) => error instanceof DomainError && error.code === "RATE_LIMITED");
  time = 1_001;
  const recovered = await limited.send({ idempotencyKey: "rate-2", channel: "SMS", recipient: "+5511", body: "fixture" });
  assert.equal(recovered.status, "DELIVERED");

  let providerCalls = 0;
  const breaker = new MessagingCircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000, now: () => 0 });
  const broken = new HttpMessagingProvider({ endpoint: "https://provider.example.test", credentialRef: "messaging.token", secretResolver: async () => "fixture-secret", circuitBreaker: breaker, fetch: async () => { providerCalls += 1; throw new Error("authorization=fixture-secret"); } });
  const first = await broken.send({ idempotencyKey: "circuit-1", channel: "SMS", recipient: "+5511", body: "fixture" });
  assert.equal(first.status, "OUTCOME_UNKNOWN");
  await assert.rejects(() => broken.send({ idempotencyKey: "circuit-2", channel: "SMS", recipient: "+5511", body: "fixture" }), (error: unknown) => error instanceof DomainError && error.code === "DEPENDENCY_UNAVAILABLE");
  assert.equal(providerCalls, 1);
});
