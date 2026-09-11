import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { id, type OpaqueId } from "@cvg/contracts";
import { DomainError } from "@cvg/domain";
import { WORKER_TEST_POLICY_REGISTRY } from "@cvg/agent-policy";
import type { ExternalEffectLedger } from "@cvg/integrations";
import { blockedWorkerSink, createConfiguredWorkerSink, createWorkerDependencies, CvgWorkerApplication, WORKER_LANES, type WorkerJobHandlerDefinition, type WorkerLane } from "../../apps/worker/src/worker.ts";
import { WorkerResourceController, databasePoolSaturated } from "../../apps/worker/src/runtime-controls.ts";
import type { DurableExternalEffectRecord, DurableOutboxRecord, DurableWorkerHeartbeatInput, DurableWorkerHeartbeatRecord, DurableWorkerJobRecord, DurableWorkerLane } from "@cvg/persistence";

const organizationId = id("00000000-0000-4000-0000-000000000010");

test("enabled worker sink rejects a degraded file SecretProvider even when the named secret exists", () => {
  const secretDir = mkdtempSync(join(tmpdir(), "cvg-worker-secret-"));
  writeFileSync(join(secretDir, "provider.credential"), "synthetic-provider-secret\n", { mode: 0o600 });
  try {
    assert.throws(() => createConfiguredWorkerSink({
      workerSinkMode: "enabled",
      messagingProviderEndpoint: "https://provider.example.test",
      messagingProviderAllowedHosts: ["provider.example.test"],
      messagingCredentialRef: "provider.credential",
      messagingSendPath: "/messages",
      messagingQueryPath: null,
      secretProvider: "file",
      secretDir
    }), (error: unknown) => error instanceof DomainError && error.code === "CAPABILITY_DISABLED");
  } finally {
    rmSync(secretDir, { recursive: true, force: true });
  }
});

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

function typedDefinition(jobType: string, handle: WorkerJobHandlerDefinition["handle"], overrides: Partial<WorkerJobHandlerDefinition> = {}): WorkerJobHandlerDefinition {
  return {
    lane: "jobs",
    jobType,
    resource: "database",
    requiresIdempotencyKey: true,
    requiresDurableAudit: true,
    emitsMetrics: true,
    quarantineOnExhaustion: true,
    timeoutMs: 100,
    timeoutDisposition: "RETRY",
    retryBaseSeconds: 1,
    retryMaxSeconds: 10,
    policyRegistry: WORKER_TEST_POLICY_REGISTRY,
    validate: () => undefined,
    ...overrides,
    handle
  };
}

function effect(overrides: Partial<DurableExternalEffectRecord> = {}): DurableExternalEffectRecord {
  return {
    id: record().id,
    organizationId,
    outboxId: record().id,
    integrationId: "outbox:synthetic.worker.health",
    idempotencyKey: record().id,
    request: { synthetic: true },
    requestDigest: "synthetic-effect-request-digest",
    status: "ADMISSION_PENDING",
    attempts: 0,
    claimedBy: "worker-test",
    leaseUntil: "2099-01-01T00:00:00.000Z",
    fenceToken: 1n,
    providerRequestId: null,
    response: null,
    lastError: null,
    outcomeDigest: null,
    reconciliationSource: null,
    reconciledAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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
  poolCapacity: () => { total: number; idle: number; waiting: number; max: number };
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
    ...(overrides.recordWorkerHeartbeat ? { recordWorkerHeartbeat: overrides.recordWorkerHeartbeat } : {}),
    ...(overrides.poolCapacity ? { poolCapacity: overrides.poolCapacity } : {})
  };
}

test("worker entrypoint composition applies the configured limit to every durable lane", () => {
  const dependencies = createWorkerDependencies(persistence(), { workerMaxOutstandingOutbox: 37 }, { sink: blockedWorkerSink, sinkMode: "quarantine" });
  assert.equal(dependencies.maxOutstandingOutbox, 37);
  assert.equal(dependencies.maxOutstandingJobs, 37);
  assert.equal(dependencies.sinkMode, "quarantine");
  assert.equal(dependencies.effects, null);
});

test("worker entrypoint composition wires a complete durable effect ledger before external dispatch", async () => {
  const transitions: string[] = [];
  let current = effect();
  const effects: ExternalEffectLedger = {
    prepareExternalEffect: async (input, claim) => {
      transitions.push("ADMISSION_PENDING");
      current = effect({ ...input, claimedBy: claim.workerId, fenceToken: claim.fenceToken, status: "ADMISSION_PENDING" });
      return current;
    },
    markExternalEffectDispatched: async () => {
      transitions.push("DISPATCHED");
      current = effect({ ...current, status: "DISPATCHED", attempts: 1 });
      return current;
    },
    recordExternalEffectOutcome: async (_organizationId, _effectId, _workerId, _fenceToken, outcome) => {
      transitions.push(outcome.status);
      current = effect({ ...current, status: outcome.status, providerRequestId: outcome.providerRequestId ?? null, response: outcome.response ?? null, lastError: outcome.error ?? null });
      return current;
    }
  };
  const durablePersistence = {
    ...persistence({ completeOutbox: async () => { transitions.push("COMPLETE"); } }),
    ...effects
  };
  let providerCalls = 0;
  const dependencies = createWorkerDependencies(durablePersistence, { workerMaxOutstandingOutbox: 37 }, {
    sink: {
      requiresDurableEffectLedger: true,
      deliver: async () => {
        providerCalls += 1;
        transitions.push("PROVIDER");
        return { status: "DELIVERED" as const, providerRequestId: "provider-1", receipt: { accepted: true } };
      }
    },
    sinkMode: "enabled"
  }, { audit: { record: async () => undefined } });
  assert.equal(dependencies.effects, durablePersistence);
  const result = await new CvgWorkerApplication(dependencies).runOnce(organizationId, "worker-composed");
  assert.deepEqual(result, { claimed: 1, delivered: 1, retried: 0, quarantined: 0, outcomeUnknown: 0 });
  assert.equal(providerCalls, 1);
  assert.deepEqual(transitions, ["ADMISSION_PENDING", "DISPATCHED", "PROVIDER", "SUCCEEDED", "COMPLETE"]);
});

test("outbox attempts emit durable audit and metrics before final acknowledgement", async () => {
  const transitions: string[] = [];
  const metrics: string[] = [];
  const worker = new CvgWorkerApplication({
    persistence: persistence({
      completeOutbox: async () => { transitions.push("COMPLETE"); },
      failOutbox: async () => { transitions.push("FAIL"); return "PENDING"; }
    }),
    sink: { deliver: async () => { transitions.push("PROVIDER"); return "DELIVERED"; } },
    sinkMode: "enabled",
    auditRequired: true,
    audit: { record: async (event) => { transitions.push(`AUDIT:${event.outcome}`); } },
    metrics: { record: (event) => { metrics.push(event.name); } }
  });
  const result = await worker.runOnce(organizationId, "worker-outbox-observed");
  assert.deepEqual(result, { claimed: 1, delivered: 1, retried: 0, quarantined: 0, outcomeUnknown: 0 });
  assert.deepEqual(transitions, ["AUDIT:STARTED", "PROVIDER", "AUDIT:SUCCEEDED", "COMPLETE"]);
  assert.deepEqual(metrics, ["worker.handler.attempt", "worker.handler.succeeded"]);
});

test("worker factory keeps an enabled ledger-required sink blocked when persistence is partial", async () => {
  let providerCalls = 0;
  let claims = 0;
  const dependencies = createWorkerDependencies(persistence(), { workerMaxOutstandingOutbox: 37 }, {
    sink: {
      requiresDurableEffectLedger: true,
      deliver: async () => {
        providerCalls += 1;
        return { status: "DELIVERED" as const, providerRequestId: "provider-should-not-run", receipt: { accepted: true } };
      }
    },
    sinkMode: "enabled"
  });
  assert.equal(dependencies.effects, null);
  const worker = new CvgWorkerApplication({
    ...dependencies,
    persistence: persistence({ claimOutbox: async () => { claims += 1; return [record()]; } })
  });
  const health = await worker.health();
  assert.equal(health.lanes.outbox, "BLOCKED");
  assert.equal(health.dispatch, "BLOCKED");
  assert.equal(health.reason, "O sink exige um ledger durável de efeitos, mas ele não foi composto; nenhum efeito externo será enviado.");
  await assert.rejects(() => worker.runOnce(organizationId, "worker-partial-ledger"), (error: unknown) => error instanceof DomainError && error.code === "CAPABILITY_DISABLED");
  assert.equal(claims, 0);
  assert.equal(providerCalls, 0);
});

test("outbox dispatch is admitted by the worker policy before any claim", async () => {
  let claims = 0;
  const worker = new CvgWorkerApplication({
    persistence: persistence({ claimOutbox: async () => { claims += 1; return [record()]; } }),
    sink: { deliver: async () => "DELIVERED" },
    sinkMode: "enabled"
  });
  await assert.rejects(() => worker.runOnce(organizationId, "worker id with spaces"), /worker job idempotency key is invalid/);
  assert.equal(claims, 0);
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

test("worker exposes outbox backpressure while allowing consumers to drain", async () => {
  let claims = 0;
  const worker = new CvgWorkerApplication({
    persistence: persistence({ claimOutbox: async () => { claims += 1; return [record()]; }, outboxStats: async () => ({ depth: 11, oldestAgeMs: 900_000, poisonMessages: 3 }) }),
    sink: { deliver: async () => "DELIVERED" },
    sinkMode: "enabled",
    maxOutstandingOutbox: 10,
    lanes: { jobs: async () => 0, schedule: async () => 0, reconciliation: async () => 0, notifications: async () => 0, maintenance: async () => 0 }
  });
  const result = await worker.runCycle(organizationId, "worker-backpressure");
  assert.equal(result.lanes.outbox.status, "EXECUTED");
  assert.equal(result.backpressure.active, true);
  assert.equal(result.metrics.backpressureEvents, 1);
  assert.equal(result.metrics.poisonMessages, 3);
  assert.equal(claims, 1);
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
    jobHandlerDefinitions: [typedDefinition("synthetic.rebuild", async (claimed, context) => { assert.equal(claimed.fenceToken, 1n); assert.equal(context.workerId, "worker-durable"); })],
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
    jobHandlerDefinitions: [typedDefinition("synthetic.other", async () => undefined)],
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
    jobHandlerDefinitions: [typedDefinition("synthetic.rebuild", async () => undefined)],
    lanes: { schedule: async () => 0, reconciliation: async () => 0, notifications: async () => 0, maintenance: async () => 0 }
  });
  await assert.rejects(() => worker.runCycle(organizationId, "worker-heartbeat-failure"), /synthetic heartbeat outage/);
  assert.equal(claims, 0);
});

test("worker exposes durable queue pressure while allowing consumers to drain", async () => {
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
    jobHandlerDefinitions: [typedDefinition("synthetic.rebuild", async () => undefined)],
    lanes: { schedule: async () => 0, reconciliation: async () => 0, notifications: async () => 0, maintenance: async () => 0 }
  });
  const result = await worker.runCycle(organizationId, "worker-backpressure-jobs");
  assert.equal(result.lanes.jobs.status, "EXECUTED");
  assert.equal(result.backpressure.workerLanes.jobs?.active, true);
  assert.equal(result.metrics.backpressureEvents, 1);
  assert.equal(result.metrics.poisonMessages, 2);
  assert.equal(claims, 5);
});

test("worker resource bulkheads reject excess AI/provider work without an in-memory wait queue", async () => {
  const controls = new WorkerResourceController({ workerCycles: 1, database: 1, provider: 1, ai: 1 });
  let release: (() => void) | undefined;
  const active = controls.run("ai", () => new Promise<void>((resolve) => { release = resolve; }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  await assert.rejects(() => controls.run("ai", async () => undefined), (error: unknown) => error instanceof DomainError && error.code === "BUDGET_EXCEEDED");
  assert.deepEqual(controls.snapshot().resources.ai, { active: 1, limit: 1, rejected: 1 });
  release?.();
  await active;
  assert.deepEqual(controls.snapshot().resources.ai, { active: 0, limit: 1, rejected: 1 });
  assert.equal(databasePoolSaturated({ total: 4, idle: 0, waiting: 0, max: 4 }), true);
  assert.equal(databasePoolSaturated({ total: 4, idle: 1, waiting: 0, max: 4 }), false);
});

test("worker degrades before heartbeat or claim when the database pool is saturated", async () => {
  let claims = 0;
  let heartbeats = 0;
  const worker = new CvgWorkerApplication({
    persistence: persistence({
      claimOutbox: async () => { claims += 1; return [record()]; },
      recordWorkerHeartbeat: async () => { heartbeats += 1; throw new Error("heartbeat must not be attempted while saturated"); }
    }),
    sink: { deliver: async () => "DELIVERED" },
    sinkMode: "enabled",
    databasePoolCapacity: () => ({ total: 2, idle: 0, waiting: 3, max: 2 }),
    lanes: { jobs: async () => 0, schedule: async () => 0, reconciliation: async () => 0, notifications: async () => 0, maintenance: async () => 0 }
  });
  const result = await worker.runCycle(organizationId, "worker-db-saturated");
  assert.equal(result.status, "DEGRADED");
  assert.equal(result.backpressure.databasePool.active, true);
  assert.equal(Object.values(result.lanes).every((lane) => lane.status === "BLOCKED"), true);
  assert.equal(result.metrics.backpressureEvents, 1);
  assert.equal(claims, 0);
  assert.equal(heartbeats, 0);
});

test("durable item budget bounds the database claim instead of detecting excess after execution", async () => {
  const claimedLimits: number[] = [];
  const worker = new CvgWorkerApplication({
    persistence: persistence({
      claimWorkerJobs: async (_organizationId, lane, _workerId, limit) => { if (lane === "jobs") claimedLimits.push(limit ?? -1); return []; },
      completeWorkerJob: async () => undefined,
      failWorkerJob: async () => "PENDING"
    }),
    sink: { deliver: async () => "DELIVERED" },
    sinkMode: "enabled",
    jobHandlerDefinitions: [typedDefinition("synthetic.rebuild", async () => undefined)],
    lanes: { schedule: async () => 0, reconciliation: async () => 0, notifications: async () => 0, maintenance: async () => 0 }
  });
  const result = await worker.runCycle(organizationId, "worker-item-budget", { limit: 20, laneBudgets: { jobs: { maxProcessed: 2 } } });
  assert.equal(result.lanes.jobs.status, "EXECUTED");
  assert.deepEqual(claimedLimits, [2]);
});

test("typed handler timeout quarantines an ambiguous provider attempt and never acknowledges it late", async () => {
  const job = workerJob({ attempts: 1, maxAttempts: 4 });
  const transitions: string[] = [];
  const definition: WorkerJobHandlerDefinition = {
    lane: "jobs",
    jobType: "synthetic.rebuild",
    resource: "provider",
    requiresIdempotencyKey: true,
    requiresDurableAudit: true,
    emitsMetrics: true,
    quarantineOnExhaustion: true,
    timeoutMs: 5,
    timeoutDisposition: "QUARANTINE",
    retryBaseSeconds: 2,
    retryMaxSeconds: 30,
    policyRegistry: WORKER_TEST_POLICY_REGISTRY,
    validate(payload) { assert.equal(payload.synthetic, true); },
    handle: async () => { await new Promise((resolve) => setTimeout(resolve, 30)); transitions.push("HANDLER_RETURNED"); }
  };
  const worker = new CvgWorkerApplication({
    persistence: persistence({
      claimWorkerJobs: async (_organizationId, lane) => lane === "jobs" ? [job] : [],
      completeWorkerJob: async () => { transitions.push("COMPLETED"); },
      failWorkerJob: async (_organizationId, _jobId, _workerId, _fence, reason, quarantine) => { transitions.push(`${quarantine ? "QUARANTINED" : "RETRIED"}:${reason}`); return quarantine ? "QUARANTINED" : "PENDING"; }
    }),
    sink: { deliver: async () => "DELIVERED" },
    sinkMode: "enabled",
    jobHandlerDefinitions: [definition],
    lanes: { schedule: async () => 0, reconciliation: async () => 0, notifications: async () => 0, maintenance: async () => 0 }
  });
  const result = await worker.runCycle(organizationId, "worker-timeout");
  assert.equal(result.lanes.jobs.status, "FAILED");
  assert.equal(result.lanes.jobs.quarantined, 1);
  assert.equal(result.metrics.handlerQuarantined, 1);
  assert.equal(transitions.some((value) => value.startsWith("QUARANTINED:Worker handler deadline exceeded")), true);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(transitions.includes("HANDLER_RETURNED"), true);
  assert.equal(transitions.includes("COMPLETED"), false);
});

test("typed durable handlers emit redacted audit outcomes and aggregate metrics for a successful attempt", async () => {
  const job = workerJob();
  const audits: string[] = [];
  const metricNames: string[] = [];
  const definition: WorkerJobHandlerDefinition = {
    lane: "jobs",
    jobType: "synthetic.rebuild",
    resource: "database",
    requiresIdempotencyKey: true,
    requiresDurableAudit: true,
    emitsMetrics: true,
    quarantineOnExhaustion: true,
    timeoutMs: 100,
    timeoutDisposition: "RETRY",
    retryBaseSeconds: 1,
    retryMaxSeconds: 10,
    policyRegistry: WORKER_TEST_POLICY_REGISTRY,
    validate(payload) { if (payload.synthetic !== true) throw new Error("invalid typed payload"); },
    handle: async () => undefined
  };
  const worker = new CvgWorkerApplication({
    persistence: persistence({ claimWorkerJobs: async (_organizationId, lane) => lane === "jobs" ? [job] : [], completeWorkerJob: async () => undefined, failWorkerJob: async () => "PENDING" }),
    sink: { deliver: async () => "DELIVERED" },
    sinkMode: "enabled",
    jobHandlerDefinitions: [definition],
    audit: { record: (event) => { audits.push(`${event.outcome}:${event.jobType}:${event.attempt}`); } },
    metrics: { record: (event) => { metricNames.push(event.name); } },
    lanes: { schedule: async () => 0, reconciliation: async () => 0, notifications: async () => 0, maintenance: async () => 0 }
  });
  const result = await worker.runCycle(organizationId, "worker-observed");
  assert.deepEqual(audits, ["STARTED:outbox.dispatch:1", "SUCCEEDED:outbox.dispatch:1", "STARTED:synthetic.rebuild:1", "SUCCEEDED:synthetic.rebuild:1"]);
  assert.deepEqual(metricNames, ["worker.handler.attempt", "worker.handler.succeeded", "worker.handler.attempt", "worker.handler.succeeded"]);
  assert.equal(result.metrics.handlerAttempts, 2);
  assert.equal(result.metrics.handlerSucceeded, 2);
});

test("production worker refuses to acknowledge a job when the durable audit append fails", async () => {
  const job = workerJob();
  let handlerInvoked = false;
  let completed = false;
  let failed = false;
  const worker = new CvgWorkerApplication({
    persistence: persistence({
      claimWorkerJobs: async (_organizationId, lane) => lane === "jobs" ? [job] : [],
      completeWorkerJob: async () => { completed = true; },
      failWorkerJob: async () => { failed = true; return "PENDING"; }
    }),
    sink: { deliver: async () => "DELIVERED" },
    sinkMode: "enabled",
    auditRequired: true,
    audit: { record: async () => { throw new Error("audit ledger unavailable"); } },
    jobHandlerDefinitions: [typedDefinition("synthetic.rebuild", async () => { handlerInvoked = true; })],
    lanes: { schedule: async () => 0, reconciliation: async () => 0, notifications: async () => 0, maintenance: async () => 0 }
  });
  const result = await worker.runCycle(organizationId, "worker-audit-outage");
  assert.equal(result.lanes.jobs.status, "FAILED");
  assert.equal(result.metrics.handlerAttempts, 1);
  assert.equal(result.metrics.auditFailures > 0, true);
  assert.equal(handlerInvoked, false);
  assert.equal(completed, false);
  assert.equal(failed, true);
});

test("production worker factory blocks durable lanes without an audit sink", async () => {
  const dependencies = createWorkerDependencies({
    ...persistence({
      claimWorkerJobs: async () => [],
      completeWorkerJob: async () => undefined,
      failWorkerJob: async () => "PENDING"
    })
  }, { workerMaxOutstandingOutbox: 10 }, { sink: blockedWorkerSink, sinkMode: "quarantine" });
  const health = await new CvgWorkerApplication(dependencies).health();
  assert.equal(health.lanes.jobs, "BLOCKED");
});

test("production composition provides executable typed handlers for all five durable lanes", async () => {
  const invoked: string[] = [];
  const unknownEffect = effect({ status: "OUTCOME_UNKNOWN", claimedBy: null, leaseUntil: null });
  const fullPersistence = {
    ...persistence({ check: async () => { invoked.push("storage.check"); return { database: "synthetic", serverVersion: "synthetic" }; }, assertSchema: async () => { invoked.push("storage.schema"); } }),
    claimWorkerJobs: async () => [],
    completeWorkerJob: async () => undefined,
    failWorkerJob: async () => "PENDING" as const,
    enqueueWorkerJob: async (input: { id: OpaqueId; organizationId: OpaqueId; lane: DurableWorkerLane; jobType: string; idempotencyKey: string; payload: Record<string, unknown>; maxAttempts?: number; availableAt?: string }) => { invoked.push(`schedule:${input.jobType}`); return workerJob({ ...input, status: "PENDING", attempts: 0, maxAttempts: input.maxAttempts ?? 3, availableAt: input.availableAt ?? "2026-01-01T00:00:00.000Z", claimedBy: null, leaseUntil: null, fenceToken: 0n }); },
    workerJobStats: async () => ({ depth: 0, oldestAgeMs: 0, poisonMessages: 0 }),
    maintainWorkerRecords: async () => { invoked.push("maintenance.cleanup"); return { completedJobsPruned: 1, stoppedHeartbeatsPruned: 1 }; },
    poolCapacity: () => ({ total: 1, idle: 1, waiting: 0, max: 2 }),
    listExternalEffects: async () => [unknownEffect],
    claimExternalEffectForReconciliation: async () => effect({ ...unknownEffect, status: "RECONCILING", claimedBy: "worker-production", leaseUntil: "2099-01-01T00:00:00.000Z", fenceToken: 2n }),
    reconcileExternalEffect: async () => { invoked.push("external.reconcile"); return effect({ ...unknownEffect, status: "SUCCEEDED" }); }
  };
  const dependencies = createWorkerDependencies(fullPersistence, { workerMaxOutstandingOutbox: 100 }, {
    sink: { deliver: async () => { invoked.push("communication.dispatch"); return "DELIVERED"; } },
    sinkMode: "enabled",
    queryAdapter: { integrationIds: [unknownEffect.integrationId], query: async () => ({ status: "SUCCEEDED", providerRequestId: "provider-production-1", response: { accepted: true }, error: null, source: "PROVIDER_QUERY" }) }
  }, { audit: { record: async () => undefined } });
  const definitions = dependencies.jobHandlerDefinitions ?? [];
  assert.deepEqual(definitions.map(({ lane, jobType }) => `${lane}/${jobType}`), [
    "jobs/storage.verify",
    "schedule/schedule.tick",
    "reconciliation/external.reconcile",
    "notifications/communication.dispatch",
    "maintenance/maintenance.cleanup"
  ]);
  const context = { cycleId: id("00000000-0000-4000-8000-000000000920"), organizationId, workerId: "worker-production", signal: new AbortController().signal, startedAt: "2026-01-01T00:00:00.000Z" };
  const run = async (lane: DurableWorkerLane, jobType: string, payload: Record<string, unknown>): Promise<void> => {
    const definition = definitions.find((candidate) => candidate.lane === lane && candidate.jobType === jobType);
    assert.ok(definition);
    definition.validate(payload);
    await definition.handle(workerJob({ lane, jobType, payload }), context);
  };
  await run("jobs", "storage.verify", { mode: "schema" });
  await run("schedule", "schedule.tick", { tasks: [{ lane: "jobs", jobType: "storage.verify", idempotencyKey: "scheduled-storage-check", payload: { mode: "schema" }, maxAttempts: 3 }] });
  await run("reconciliation", "external.reconcile", { effectId: unknownEffect.id });
  await run("notifications", "communication.dispatch", { limit: 1 });
  await run("maintenance", "maintenance.cleanup", { completedBefore: "2020-01-01T00:00:00.000Z", limit: 10 });
  assert.deepEqual(invoked, ["storage.check", "storage.schema", "schedule:storage.verify", "external.reconcile", "communication.dispatch", "maintenance.cleanup"]);
  assert.equal(Object.values((await new CvgWorkerApplication(dependencies).health()).lanes).every((status) => status === "READY"), true);
});

test("reconciliation runCycle uses the durable handler with policy, audit, metrics and fencing", async () => {
  const unknownEffect = effect({ status: "OUTCOME_UNKNOWN", claimedBy: null, leaseUntil: null });
  const job = workerJob({ id: id("00000000-0000-4000-8000-000000000922"), lane: "reconciliation", jobType: "external.reconcile", idempotencyKey: "reconcile-job-1", payload: { effectId: unknownEffect.id } });
  const events: string[] = [];
  const audits: string[] = [];
  const metrics: string[] = [];
  const persistenceWithReconciliation = {
    ...persistence({
      claimWorkerJobs: async (_organizationId, lane) => lane === "reconciliation" ? [job] : [],
      completeWorkerJob: async (_organizationId, jobId) => { events.push(`complete:${jobId}`); },
      failWorkerJob: async (_organizationId, jobId, _workerId, _fenceToken, reason) => { events.push(`fail:${jobId}:${reason}`); return "PENDING" as const; },
      workerJobStats: async () => ({ depth: 0, oldestAgeMs: 0, poisonMessages: 0 })
    }),
    listExternalEffects: async () => [unknownEffect],
    claimExternalEffectForReconciliation: async () => effect({ ...unknownEffect, status: "RECONCILING", claimedBy: "worker-reconciliation", leaseUntil: "2099-01-01T00:00:00.000Z", fenceToken: 2n }),
    reconcileExternalEffect: async () => { events.push("reconciled"); return effect({ ...unknownEffect, status: "SUCCEEDED" }); }
  };
  const dependencies = createWorkerDependencies(persistenceWithReconciliation, { workerMaxOutstandingOutbox: 10 }, {
    sink: blockedWorkerSink,
    sinkMode: "quarantine",
    queryAdapter: { integrationIds: [unknownEffect.integrationId], query: async () => ({ status: "SUCCEEDED", providerRequestId: "provider-reconciliation-1", response: { accepted: true }, error: null, source: "PROVIDER_QUERY" }) }
  }, {
    audit: { record: async (event) => { audits.push(`${event.outcome}:${event.jobType}`); } },
    metrics: { record: (event) => { metrics.push(event.name); } }
  });
  const result = await new CvgWorkerApplication(dependencies).runCycle(organizationId, "worker-reconciliation");
  assert.equal(result.lanes.reconciliation.status, "EXECUTED");
  assert.equal(result.lanes.reconciliation.processed, 1);
  assert.equal(result.metrics.handlerAttempts, 1);
  assert.equal(result.metrics.handlerSucceeded, 1);
  assert.deepEqual(events, ["reconciled", `complete:${job.id}`]);
  assert.deepEqual(audits, ["STARTED:external.reconcile", "SUCCEEDED:external.reconcile"]);
  assert.deepEqual(metrics, ["worker.handler.attempt", "worker.handler.succeeded"]);
});

test("production audit mode cannot execute a custom lane runner before the durable handler", async () => {
  let customInvoked = false;
  const worker = new CvgWorkerApplication({
    persistence: persistence(),
    sink: blockedWorkerSink,
    sinkMode: "quarantine",
    auditRequired: true,
    audit: { record: async () => undefined },
    lanes: { reconciliation: async () => { customInvoked = true; return 1; } }
  });
  const health = await worker.health();
  assert.equal(health.lanes.reconciliation, "BLOCKED");
  const result = await worker.runCycle(organizationId, "worker-production-seam");
  assert.equal(result.lanes.reconciliation.status, "BLOCKED");
  assert.equal(customInvoked, false);
});

test("worker queue admission rejects producers at capacity while the consumer lane remains runnable", async () => {
  let admitted = 0;
  const dependencies = createWorkerDependencies({
    ...persistence({
      claimWorkerJobs: async () => [],
      completeWorkerJob: async () => undefined,
      failWorkerJob: async () => "PENDING",
      workerJobStats: async () => ({ depth: 2, oldestAgeMs: 1_000, poisonMessages: 0 })
    }),
    enqueueWorkerJob: async () => { admitted += 1; return workerJob({ status: "PENDING", attempts: 0, claimedBy: null, leaseUntil: null, fenceToken: 0n }); }
  }, { workerMaxOutstandingOutbox: 2 }, {
    sink: { deliver: async () => "DELIVERED" },
    sinkMode: "enabled"
  }, { audit: { record: async () => undefined } });
  const schedule = dependencies.jobHandlerDefinitions?.find((definition) => definition.jobType === "schedule.tick");
  assert.ok(schedule);
  await assert.rejects(() => schedule.handle(workerJob({ lane: "schedule", jobType: "schedule.tick", payload: { tasks: [{ lane: "jobs", jobType: "storage.verify", idempotencyKey: "capacity-test", payload: { mode: "schema" } }] } }), {
    cycleId: id("00000000-0000-4000-8000-000000000921"),
    organizationId,
    workerId: "worker-capacity",
    signal: new AbortController().signal,
    startedAt: "2026-01-01T00:00:00.000Z"
  }), (error: unknown) => error instanceof DomainError && error.code === "BUDGET_EXCEEDED");
  assert.equal(admitted, 0);

  const worker = new CvgWorkerApplication({ ...dependencies, lanes: { schedule: async () => 0, reconciliation: async () => 0, notifications: async () => 0, maintenance: async () => 0 } });
  const result = await worker.runCycle(organizationId, "worker-capacity");
  assert.equal(result.lanes.jobs.status, "EXECUTED");
  assert.equal(result.backpressure.workerLanes.jobs?.active, true);
});
