import test from "node:test";
import assert from "node:assert/strict";
import { id } from "@cvg/contracts";
import { DomainError } from "@cvg/domain";
import { inboxEventToOutbox, IntegrationGateway, OutboxWorker, reconcileUnknownExternalEffect, StaticSecretProvider, type ExternalEffectLedger } from "@cvg/integrations";
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

test("integration gateway exposes secret-provider health without exposing secret material", () => {
  const unconfigured = new IntegrationGateway();
  assert.equal(unconfigured.getHealth().secretProvider, "NOT_CONFIGURED");
  const synthetic = new StaticSecretProvider(["synthetic-provider-key"]);
  const configured = new IntegrationGateway(synthetic);
  assert.equal(configured.getHealth().secretProvider, "READY");
  assert.equal(synthetic.has("synthetic-provider-key"), true);
  assert.equal("secret" in synthetic, false);
});
