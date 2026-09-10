import test from "node:test";
import assert from "node:assert/strict";
import { id, type OpaqueId } from "@cvg/contracts";
import { DomainError } from "@cvg/domain";
import { blockedWorkerSink, createWorkerDependencies, CvgWorkerApplication, WORKER_LANES, type WorkerLane } from "../../apps/worker/src/worker.ts";
import type { DurableOutboxRecord, DurableWorkerHeartbeatInput, DurableWorkerHeartbeatRecord, DurableWorkerJobRecord, DurableWorkerLane } from "@cvg/persistence";

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

function workerJob(overrides: Partial<DurableWorkerJobRecord> = {}): DurableWorkerJobRecord {
  return {
    id: id("00000000-0000-4000-8000-000000000910"),
    organizationId: organizationId,
    lane: "jobs",
    jobType: "synthetic.rebuild",
    idempotencyKey: "worker-job-unit-1",
    payload: { synthetic: true },
    maxAttempts: 2,
    status: "CLAIMED",
    attempts: 1,
    availableAt: "2026-01-01T00:00:00.000Z",
    claimedBy: "worker-test",
    leaseUntil: "2099-01-01T00:00:00.000Z",
    fenceToken: 1n,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    processedAt: null,
    recordDigest: "synthetic-worker-job-digest",
    ...overrides
  };
}

function persistence(overrides: Partial<{
  check: () => Promise<{ database: string; serverVersion: string }>;
  assertSchema: () => Promise<void>;
  claimOutbox: () => Promise<DurableOutboxRecord[]>;
  completeOutbox: () => Promise<void>;
  failOutbox: () => Promise<"PENDING" | "QUARANTINED">;
  outboxStats: () => Promise<{ depth: number; oldestAgeMs: number; poisonMessages: number }>;
  claimWorkerJobs: (organizationId: OpaqueId, lane: DurableWorkerLane, workerId: string, limit?: number, leaseSeconds?: number) => Promise<DurableWorkerJobRecord[]>;
  completeWorkerJob: (organizationId: OpaqueId, jobId: OpaqueId, workerId: string, fenceToken: bigint) => Promise<void>;
  failWorkerJob: (organizationId: OpaqueId, jobId: OpaqueId, workerId: string, fenceToken: bigint, reason: string, quarantine?: boolean, retryAfterSeconds?: number) => Promise<"PENDING" | "QUARANTINED">;
  workerJobStats: (organizationId: OpaqueId, lane?: DurableWorkerLane) => Promise<{ depth: number; oldestAgeMs: number; poisonMessages: number }>;
  recordWorkerHeartbeat: (input: DurableWorkerHeartbeatInput) => Promise<DurableWorkerHeartbeatRecord>;
}> = {}) {
  return {
    check: overrides.check ?? (async () => ({ database: "synthetic", serverVersion: "synthetic" })),
    assertSchema: overrides.assertSchema ?? (async () => undefined),
    claimOutbox: overrides.claimOutbox ?? (async () => [record()]),
    completeOutbox: overrides.completeOutbox ?? (async () => undefined),
    failOutbox: overrides.failOutbox ?? (async () => "QUARANTINED" as const),
    ...(overrides.outboxStats ? { outboxStats: overrides.outboxStats } : {}),
    ...(overrides.claimWorkerJobs ? { claimWorkerJobs: overrides.claimWorkerJobs } : {}),
    ...(overrides.completeWorkerJob ? { completeWorkerJob: overrides.completeWorkerJob } : {}),
    ...(overrides.failWorkerJob ? { failWorkerJob: overrides.failWorkerJob } : {}),
    ...(overrides.workerJobStats ? { workerJobStats: overrides.workerJobStats } : {}),
    ...(overrides.recordWorkerHeartbeat ? { recordWorkerHeartbeat: overrides.recordWorkerHeartbeat } : {})
  };
}

test("worker entrypoint composition applies the configured limit to every durable lane", () => {
  const dependencies = createWorkerDependencies(persistence(), { workerMaxOutstandingOutbox: 37 }, { sink: blockedWorkerSink, sinkMode: "quarantine" });
  assert.equal(dependencies.maxOutstandingOutbox, 37);
  assert.equal(dependencies.maxOutstandingJobs, 37);
  assert.equal(dependencies.sinkMode, "quarantine");
});

test("separate worker exposes health, quarantine and stopped lifecycle", async () => {
  let quarantinedClaims = 0;
  const quarantined = new CvgWorkerApplication({ persistence: persistence({ claimOutbox: async () => { quarantinedClaims += 1; return [record()]; } }), sink: blockedWorkerSink, sinkMode: "quarantine" });
  assert.deepEqual(await quarantined.health(), {
    status: "DEGRADED",
    process: "READY",
    lifecycle: "RUNNING",
    persistence: "READY",
    dispatch: "BLOCKED",
    lanes: { outbox: "BLOCKED", jobs: "BLOCKED", schedule: "BLOCKED", reconciliation: "BLOCKED", notifications: "BLOCKED", maintenance: "BLOCKED" },
    reason: "O sink está em quarentena ou não foi configurado; nenhum efeito externo será enviado."
  });
  await assert.rejects(() => quarantined.runOnce(organizationId, "worker-test"), (error: unknown) => error instanceof DomainError && error.code === "CAPABILITY_DISABLED");
  assert.equal(quarantinedClaims, 0);

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

test("worker applies outbox backpressure before claiming and exposes poison metrics", async () => {
  let claims = 0;
  const worker = new CvgWorkerApplication({
    persistence: persistence({ claimOutbox: async () => { claims += 1; return [record()]; }, outboxStats: async () => ({ depth: 11, oldestAgeMs: 900_000, poisonMessages: 3 }) }),
    sink: { deliver: async () => "DELIVERED" },
    sinkMode: "enabled",
    maxOutstandingOutbox: 10,
    lanes: { jobs: async () => 0, schedule: async () => 0, reconciliation: async () => 0, notifications: async () => 0, maintenance: async () => 0 }
  });
  const result = await worker.runCycle(organizationId, "worker-backpressure");
  assert.equal(result.lanes.outbox.status, "BLOCKED");
  assert.equal(result.backpressure.active, true);
  assert.equal(result.metrics.backpressureEvents, 1);
  assert.equal(result.metrics.poisonMessages, 3);
  assert.equal(claims, 0);
});

test("worker enforces lane budgets and bounded concurrency", async () => {
  let active = 0;
  let maximumActive = 0;
  const lane = async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return 1;
  };
  const worker = new CvgWorkerApplication({
    persistence: persistence(),
    sink: { deliver: async () => "DELIVERED" },
    sinkMode: "enabled",
    lanes: { jobs: lane, schedule: lane, reconciliation: async () => 0, notifications: async () => 0, maintenance: async () => 0 }
  });
  const concurrent = await worker.runCycle(organizationId, "worker-concurrency", { laneConcurrency: 2 });
  assert.equal(maximumActive, 2);
  assert.equal(concurrent.status, "COMPLETED");

  const budgeted = await worker.runCycle(organizationId, "worker-budget", { laneBudgets: { jobs: { maxProcessed: 0 } } });
  assert.equal(budgeted.lanes.jobs.status, "FAILED");
  assert.equal(budgeted.metrics.budgetExceeded, 1);
});

test("worker executes durable jobs with handler fencing and records a cycle heartbeat", async () => {
  const job = workerJob();
  const completed: string[] = [];
  const heartbeatStatuses: string[] = [];
  const worker = new CvgWorkerApplication({
    persistence: persistence({
      claimWorkerJobs: async (_organizationId, lane) => lane === "jobs" ? [job] : [],
      completeWorkerJob: async (_organizationId, jobId) => { completed.push(jobId); },
      failWorkerJob: async () => "PENDING",
      recordWorkerHeartbeat: async (input) => {
        heartbeatStatuses.push(input.status);
        return { organizationId: input.organizationId, workerId: input.workerId, status: input.status, lane: input.lane, cycleId: input.cycleId, startedAt: input.startedAt, lastSeenAt: input.lastSeenAt ?? input.startedAt, expiresAt: input.expiresAt, detail: input.detail, updatedAt: input.lastSeenAt ?? input.startedAt };
      }
    }),
    sink: { deliver: async () => "DELIVERED" },
    sinkMode: "enabled",
    jobHandlers: { "synthetic.rebuild": async (claimed, context) => { assert.equal(claimed.fenceToken, 1n); assert.equal(context.workerId, "worker-durable"); } },
    lanes: { schedule: async () => 0, reconciliation: async () => 0, notifications: async () => 0, maintenance: async () => 0 }
  });
  assert.equal((await worker.health()).lanes.jobs, "READY");
  const result = await worker.runCycle(organizationId, "worker-durable");
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.lanes.jobs.processed, 1);
  assert.deepEqual(completed, [job.id]);
  assert.deepEqual(heartbeatStatuses, ["RUNNING", "RUNNING"]);
});

test("worker quarantines an unknown durable job handler and keeps the poison visible", async () => {
  const job = workerJob({ jobType: "synthetic.unknown", attempts: 2 });
  const failures: Array<{ jobId: string; quarantine: boolean }> = [];
  const worker = new CvgWorkerApplication({
    persistence: persistence({
      claimWorkerJobs: async (_organizationId, lane) => lane === "jobs" ? [job] : [],
      completeWorkerJob: async () => undefined,
      failWorkerJob: async (_organizationId, jobId, _workerId, _fence, _reason, quarantine) => { failures.push({ jobId, quarantine: Boolean(quarantine) }); return "QUARANTINED"; }
    }),
    sink: { deliver: async () => "DELIVERED" },
    sinkMode: "enabled",
    jobHandlers: { "synthetic.other": async () => undefined },
    lanes: { schedule: async () => 0, reconciliation: async () => 0, notifications: async () => 0, maintenance: async () => 0 }
  });
  const result = await worker.runCycle(organizationId, "worker-poison");
  assert.equal(result.status, "FAILED");
  assert.equal(result.lanes.jobs.status, "FAILED");
  assert.equal(result.lanes.jobs.quarantined, 1);
  assert.equal(result.metrics.poisonMessages, 1);
  assert.deepEqual(failures, [{ jobId: job.id, quarantine: true }]);
});

test("worker fails closed before claiming when durable heartbeat cannot be written", async () => {
  let claims = 0;
  const worker = new CvgWorkerApplication({
    persistence: persistence({
      claimWorkerJobs: async () => { claims += 1; return []; },
      completeWorkerJob: async () => undefined,
      failWorkerJob: async () => "PENDING",
      recordWorkerHeartbeat: async () => { throw new Error("synthetic heartbeat outage"); }
    }),
    sink: { deliver: async () => "DELIVERED" },
    sinkMode: "enabled",
    jobHandlers: { "synthetic.rebuild": async () => undefined },
    lanes: { schedule: async () => 0, reconciliation: async () => 0, notifications: async () => 0, maintenance: async () => 0 }
  });
  await assert.rejects(() => worker.runCycle(organizationId, "worker-heartbeat-failure"), /synthetic heartbeat outage/);
  assert.equal(claims, 0);
});

test("worker applies per-lane durable backpressure before claiming internal jobs", async () => {
  let claims = 0;
  const worker = new CvgWorkerApplication({
    persistence: persistence({
      claimWorkerJobs: async () => { claims += 1; return []; },
      completeWorkerJob: async () => undefined,
      failWorkerJob: async () => "PENDING",
      workerJobStats: async (_organizationId, lane) => lane === "jobs" ? { depth: 3, oldestAgeMs: 900_000, poisonMessages: 2 } : { depth: 0, oldestAgeMs: 0, poisonMessages: 0 }
    }),
    sink: { deliver: async () => "DELIVERED" },
    sinkMode: "enabled",
    maxOutstandingJobs: 2,
    jobHandlers: { "synthetic.rebuild": async () => undefined },
    lanes: { schedule: async () => 0, reconciliation: async () => 0, notifications: async () => 0, maintenance: async () => 0 }
  });
  const result = await worker.runCycle(organizationId, "worker-backpressure-jobs");
  assert.equal(result.lanes.jobs.status, "BLOCKED");
  assert.equal(result.backpressure.workerLanes.jobs?.active, true);
  assert.equal(result.metrics.backpressureEvents, 1);
  assert.equal(result.metrics.poisonMessages, 2);
  assert.equal(claims, 0);
});
