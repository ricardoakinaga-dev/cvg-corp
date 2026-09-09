import test from "node:test";
import assert from "node:assert/strict";
import { id } from "@cvg/contracts";
import { OutboxWorker, type ExternalEffectLedger } from "@cvg/integrations";
import { OutboxLeaseLostError, type DurableExternalEffectRecord, type DurableOutboxRecord } from "@cvg/persistence";

const organizationId = id("00000000-0000-4000-0000-000000000010");

function record(idValue: string): DurableOutboxRecord {
  return {
    id: id(idValue),
    organizationId,
    eventType: "synthetic.fault",
    aggregateId: id("00000000-0000-4000-0000-000000000903"),
    payload: { synthetic: true },
    status: "CLAIMED",
    attempts: 1,
    availableAt: "2026-01-01T00:00:00.000Z",
    claimedBy: "fault-worker-a",
    leaseUntil: "2099-01-01T00:00:00.000Z",
    fenceToken: 7n,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    processedAt: null,
    recordDigest: "synthetic-fault-digest"
  };
}

function effectFor(item: DurableOutboxRecord): DurableExternalEffectRecord {
  return {
    id: item.id,
    organizationId,
    outboxId: item.id,
    integrationId: "outbox:synthetic.fault",
    idempotencyKey: item.id,
    request: { synthetic: true },
    requestDigest: "synthetic-request-digest",
    status: "ADMISSION_PENDING",
    attempts: 0,
    claimedBy: "fault-worker-a",
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
}

test("fault harness quarantines a dispatch crash and never retries an unknown effect blindly", async () => {
  const item = record("00000000-0000-4000-0000-000000000904");
  let effect = effectFor(item);
  let sinkCalls = 0;
  const completed: string[] = [];
  const failures: Array<{ quarantine: boolean; reason: string }> = [];
  const effects: ExternalEffectLedger = {
    prepareExternalEffect: async () => effect,
    markExternalEffectDispatched: async () => {
      effect = { ...effect, status: "DISPATCHED", attempts: effect.attempts + 1 };
      return effect;
    },
    recordExternalEffectOutcome: async (_organizationId, _effectId, _workerId, _fenceToken, outcome) => {
      effect = { ...effect, status: outcome.status, lastError: outcome.error ?? null, claimedBy: null, leaseUntil: null };
      return effect;
    }
  };
  const worker = new OutboxWorker({
    claimOutbox: async () => [item],
    completeOutbox: async (_organizationId, idValue) => { completed.push(idValue); },
    failOutbox: async (_organizationId, _idValue, _workerId, _fenceToken, reason, quarantine) => {
      failures.push({ quarantine: Boolean(quarantine), reason });
      return quarantine ? "QUARANTINED" : "PENDING";
    }
  }, effects);

  const first = await worker.runOnce(organizationId, "fault-worker-a", {
    deliver: async () => {
      sinkCalls += 1;
      throw new Error("synthetic crash after dispatch marker");
    }
  });
  assert.deepEqual(first, { claimed: 1, delivered: 0, retried: 0, quarantined: 1, outcomeUnknown: 1 });
  assert.equal(effect.status, "OUTCOME_UNKNOWN");
  assert.deepEqual(completed, []);
  assert.equal(failures[0]?.quarantine, true);

  const second = await worker.runOnce(organizationId, "fault-worker-b", { deliver: async () => { sinkCalls += 1; return "DELIVERED"; } });
  assert.deepEqual(second, { claimed: 1, delivered: 0, retried: 0, quarantined: 1, outcomeUnknown: 1 });
  assert.equal(sinkCalls, 1, "an outcome without a provider receipt must not be dispatched again");
  assert.deepEqual(completed, []);
});

test("fault harness fails loudly when a stale worker loses its lease", async () => {
  const item = record("00000000-0000-4000-0000-000000000905");
  let failCalls = 0;
  const worker = new OutboxWorker({
    claimOutbox: async () => [item],
    completeOutbox: async () => { throw new OutboxLeaseLostError("synthetic fence advanced"); },
    failOutbox: async () => { failCalls += 1; return "QUARANTINED"; }
  });
  await assert.rejects(
    () => worker.runOnce(organizationId, "fault-worker-a", { deliver: async () => "DELIVERED" }),
    (error: unknown) => error instanceof OutboxLeaseLostError && error.message === "synthetic fence advanced"
  );
  assert.equal(failCalls, 0, "a stale worker must not mutate a record after losing its fence");
});
