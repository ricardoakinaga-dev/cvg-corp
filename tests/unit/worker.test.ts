import test from "node:test";
import assert from "node:assert/strict";
import { id } from "@cvg/contracts";
import { DomainError } from "@cvg/domain";
import { blockedWorkerSink, CvgWorkerApplication, WORKER_LANES, type WorkerLane } from "../../apps/worker/src/worker.ts";
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
    lifecycle: "RUNNING",
    persistence: "READY",
    dispatch: "BLOCKED",
    lanes: { outbox: "BLOCKED", jobs: "BLOCKED", schedule: "BLOCKED", reconciliation: "BLOCKED", notifications: "BLOCKED", maintenance: "BLOCKED" },
    reason: "O sink está em quarentena ou não foi configurado; nenhum efeito externo será enviado."
  });
  assert.deepEqual(await quarantined.runOnce(organizationId, "worker-test"), { claimed: 1, delivered: 0, retried: 0, quarantined: 1, outcomeUnknown: 0 });

  const laneRunners = { jobs: async () => 0, schedule: async () => 0, reconciliation: async () => 0, notifications: async () => 0, maintenance: async () => 0 };
  const enabled = new CvgWorkerApplication({ persistence: persistence(), sink: { deliver: async () => "DELIVERED" }, sinkMode: "enabled", lanes: laneRunners });
  assert.deepEqual(await enabled.health(), { status: "READY", process: "READY", lifecycle: "RUNNING", persistence: "READY", dispatch: "READY", lanes: { outbox: "READY", jobs: "READY", schedule: "READY", reconciliation: "READY", notifications: "READY", maintenance: "READY" }, reason: null });
  enabled.stop();
  assert.equal((await enabled.health()).lifecycle, "STOPPED");
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
    lifecycle: "RUNNING",
    persistence: "UNAVAILABLE",
    dispatch: "BLOCKED",
    lanes: { outbox: "BLOCKED", jobs: "BLOCKED", schedule: "BLOCKED", reconciliation: "BLOCKED", notifications: "BLOCKED", maintenance: "BLOCKED" },
    reason: "synthetic database outage"
  });
});

test("worker without a sink refuses to claim external work", async () => {
  const worker = new CvgWorkerApplication({ persistence: persistence() });
  assert.deepEqual(await worker.health(), {
    status: "DEGRADED",
    process: "READY",
    lifecycle: "RUNNING",
    persistence: "READY",
    dispatch: "BLOCKED",
    lanes: { outbox: "BLOCKED", jobs: "BLOCKED", schedule: "BLOCKED", reconciliation: "BLOCKED", notifications: "BLOCKED", maintenance: "BLOCKED" },
    reason: "O sink está em quarentena ou não foi configurado; nenhum efeito externo será enviado."
  });
  await assert.rejects(() => worker.runOnce(organizationId, "worker-test"), (error: unknown) => error instanceof DomainError && error.code === "CAPABILITY_DISABLED");
});

test("worker cycle executes every configured lane and exposes per-lane counts", async () => {
  const calls: WorkerLane[] = [];
  const lanes = {
    jobs: async () => { calls.push("jobs"); return 2; },
    schedule: async () => { calls.push("schedule"); return 3; },
    reconciliation: async () => { calls.push("reconciliation"); return 4; },
    notifications: async () => { calls.push("notifications"); return 5; },
    maintenance: async () => { calls.push("maintenance"); return 6; }
  };
  const worker = new CvgWorkerApplication({ persistence: persistence(), sink: { deliver: async () => "DELIVERED" }, sinkMode: "enabled", lanes });
  const result = await worker.runCycle(organizationId, "worker-cycle");
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.delivered, 1);
  assert.deepEqual(Object.keys(result.lanes), [...WORKER_LANES]);
  assert.deepEqual(calls, ["jobs", "schedule", "reconciliation", "notifications", "maintenance"]);
  assert.deepEqual(Object.fromEntries(WORKER_LANES.map((lane) => [lane, result.lanes[lane].status])), { outbox: "EXECUTED", jobs: "EXECUTED", schedule: "EXECUTED", reconciliation: "EXECUTED", notifications: "EXECUTED", maintenance: "EXECUTED" });
  assert.deepEqual(Object.fromEntries(WORKER_LANES.slice(1).map((lane) => [lane, result.lanes[lane].processed])), { jobs: 2, schedule: 3, reconciliation: 4, notifications: 5, maintenance: 6 });
});

test("worker cycle blocks unconfigured lanes without claiming outbox work", async () => {
  let claims = 0;
  const worker = new CvgWorkerApplication({
    persistence: persistence({ claimOutbox: async () => { claims += 1; return [record()]; } }),
    sink: blockedWorkerSink,
    sinkMode: "quarantine"
  });
  const result = await worker.runCycle(organizationId, "worker-blocked");
  assert.equal(result.status, "DEGRADED");
  assert.equal(result.claimed, 0);
  assert.equal(claims, 0);
  assert.equal(Object.values(result.lanes).every((lane) => lane.status === "BLOCKED"), true);
});

test("worker cycle contains a lane failure and keeps the failure visible", async () => {
  let observedSignal: AbortSignal | undefined;
  const worker = new CvgWorkerApplication({
    persistence: persistence(),
    sink: { deliver: async () => "DELIVERED" },
    sinkMode: "enabled",
    lanes: {
      jobs: async ({ signal }) => { observedSignal = signal; throw new Error("synthetic lane fault"); },
      schedule: async () => 0,
      reconciliation: async () => 0,
      notifications: async () => 0,
      maintenance: async () => 0
    }
  });
  const result = await worker.runCycle(organizationId, "worker-failure");
  assert.equal(result.status, "FAILED");
  assert.equal(result.lanes.jobs.status, "FAILED");
  assert.equal(result.lanes.jobs.reason, "lane runner failed closed");
  assert.ok(observedSignal);
});
