import test from "node:test";
import assert from "node:assert/strict";
import { id } from "@cvg/contracts";
import { DomainError } from "@cvg/domain";
import { blockedWorkerSink, CvgWorkerApplication } from "../../apps/worker/src/worker.ts";
import type { DurableOutboxRecord } from "@cvg/persistence";

const organizationId = id("00000000-0000-4000-0000-000000000010");

function record(): DurableOutboxRecord {
  return {
    id: id("00000000-0000-4000-0000-000000000901"),
    organizationId,
    eventType: "synthetic.worker.health",
    aggregateId: id("00000000-0000-4000-0000-000000000902"),
    payload: { synthetic: true },
    status: "CLAIMED",
    attempts: 1,
    availableAt: "2026-01-01T00:00:00.000Z",
    claimedBy: "worker-test",
    leaseUntil: "2099-01-01T00:00:00.000Z",
    fenceToken: 1n,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    processedAt: null,
    recordDigest: "synthetic-worker-digest"
  };
}

function persistence(overrides: Partial<{
  check: () => Promise<{ database: string; serverVersion: string }>;
  assertSchema: () => Promise<void>;
  claimOutbox: () => Promise<DurableOutboxRecord[]>;
  completeOutbox: () => Promise<void>;
  failOutbox: () => Promise<"PENDING" | "QUARANTINED">;
}> = {}) {
  return {
    check: overrides.check ?? (async () => ({ database: "synthetic", serverVersion: "synthetic" })),
    assertSchema: overrides.assertSchema ?? (async () => undefined),
    claimOutbox: overrides.claimOutbox ?? (async () => [record()]),
    completeOutbox: overrides.completeOutbox ?? (async () => undefined),
    failOutbox: overrides.failOutbox ?? (async () => "QUARANTINED" as const)
  };
}

test("separate worker exposes health, quarantine and stopped lifecycle", async () => {
  const quarantined = new CvgWorkerApplication({ persistence: persistence(), sink: blockedWorkerSink, sinkMode: "quarantine" });
  assert.deepEqual(await quarantined.health(), {
    status: "DEGRADED",
    process: "READY",
    persistence: "READY",
    dispatch: "BLOCKED",
    reason: "O sink está em quarentena; nenhum efeito externo será enviado."
  });
  assert.deepEqual(await quarantined.runOnce(organizationId, "worker-test"), { claimed: 1, delivered: 0, retried: 0, quarantined: 1, outcomeUnknown: 0 });

  const enabled = new CvgWorkerApplication({ persistence: persistence(), sink: { deliver: async () => "DELIVERED" }, sinkMode: "enabled" });
  assert.deepEqual(await enabled.health(), { status: "READY", process: "READY", persistence: "READY", dispatch: "READY", reason: null });
  enabled.stop();
  await assert.rejects(() => enabled.runOnce(organizationId, "worker-test"), (error: unknown) => error instanceof DomainError && error.code === "INVALID_STATE");
});

test("worker health fails closed when persistence is unavailable", async () => {
  const worker = new CvgWorkerApplication({
    persistence: persistence({ check: async () => { throw new Error("synthetic database outage"); } }),
    sink: blockedWorkerSink
  });
  assert.deepEqual(await worker.health(), {
    status: "UNAVAILABLE",
    process: "READY",
    persistence: "UNAVAILABLE",
    dispatch: "BLOCKED",
    reason: "synthetic database outage"
  });
});

test("worker without a sink refuses to claim external work", async () => {
  const worker = new CvgWorkerApplication({ persistence: persistence() });
  assert.deepEqual(await worker.health(), {
    status: "DEGRADED",
    process: "READY",
    persistence: "READY",
    dispatch: "BLOCKED",
    reason: "O sink está em quarentena; nenhum efeito externo será enviado."
  });
  await assert.rejects(() => worker.runOnce(organizationId, "worker-test"), (error: unknown) => error instanceof DomainError && error.code === "CAPABILITY_DISABLED");
});
