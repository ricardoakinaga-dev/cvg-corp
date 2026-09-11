import type { OpaqueId } from "@cvg/contracts";
import { DomainError, makeId, now } from "@cvg/domain";
import { enforceWorkerPolicy, WORKER_POLICY_REGISTRY, type WorkerPolicyRule } from "@cvg/agent-policy";
import { configuredSecretProvider, createMessagingExternalEffectQueryAdapter, HttpMessagingProvider, MessagingOutboxSink, OutboxWorker, reconcileUnknownExternalEffect, type ExternalEffectLedger, type ExternalEffectQueryAdapter, type OutboxDeliveryDecision, type OutboxSink, type OutboxMetricEvent, type OutboxWorkerHooks, type OutboxWorkerResult } from "@cvg/integrations";
import type { CvgConfig } from "@cvg/config";
import type { DurableWorkerJobInput, DurableWorkerJobRecord, DurableWorkerLane, PostgresPersistence } from "@cvg/persistence";
import { databasePoolSaturated, withAbortableTimeout, WorkerResourceController, type DatabasePoolCapacity, type WorkerResource, type WorkerResourceLimits } from "./runtime-controls.ts";

export const WORKER_LANES = ["outbox", "jobs", "schedule", "reconciliation", "notifications", "maintenance"] as const;
export type WorkerLane = (typeof WORKER_LANES)[number];
const WORKER_JOB_LANES = WORKER_LANES.filter((lane): lane is Exclude<WorkerLane, "outbox"> => lane !== "outbox");

// Keep the registry visible at the worker boundary so static and runtime gates
// cannot mistake a handler map for authorization.
export { WORKER_POLICY_REGISTRY };

export interface WorkerLaneContext {
  cycleId: OpaqueId;
  organizationId: OpaqueId;
  workerId: string;
  signal: AbortSignal;
  startedAt: string;
}

export interface WorkerLaneResult {
  status: "EXECUTED" | "BLOCKED" | "FAILED";
  processed: number;
  durationMs: number;
  reason: string | null;
  failed?: number;
  quarantined?: number;
}

export interface WorkerCycleResult extends OutboxWorkerResult {
  cycleId: OpaqueId;
  status: "COMPLETED" | "DEGRADED" | "FAILED";
  startedAt: string;
  durationMs: number;
  lanes: Record<WorkerLane, WorkerLaneResult>;
  backpressure: { active: boolean; depth: number | null; limit: number | null; databasePool: { active: boolean; capacity: DatabasePoolCapacity | null }; workerLanes: Partial<Record<Exclude<WorkerLane, "outbox">, { active: boolean; depth: number | null; limit: number; poisonMessages: number }>> };
  metrics: { laneRuns: number; laneFailures: number; budgetExceeded: number; backpressureEvents: number; poisonMessages: number; handlerAttempts: number; handlerSucceeded: number; handlerRetried: number; handlerQuarantined: number; auditFailures: number };
  resources: ReturnType<WorkerResourceController["snapshot"]>;
}

export type WorkerLaneRunner = (context: WorkerLaneContext) => Promise<number>;
export type WorkerJobHandler = (job: DurableWorkerJobRecord, context: WorkerLaneContext) => Promise<void>;

export interface WorkerJobHandlerDefinition {
  readonly lane: WorkerLane;
  readonly jobType: string;
  readonly resource: WorkerResource;
  /** Every durable handler must be admitted with an idempotency key. */
  readonly requiresIdempotencyKey: true;
  /** Every attempt outcome is written through the durable audit sink. */
  readonly requiresDurableAudit: true;
  /** Every attempt emits the worker metrics contract. */
  readonly emitsMetrics: true;
  /** Exhausted/ambiguous attempts are quarantined rather than acknowledged. */
  readonly quarantineOnExhaustion: true;
  readonly timeoutMs: number;
  readonly timeoutDisposition: "RETRY" | "QUARANTINE";
  readonly retryBaseSeconds: number;
  readonly retryMaxSeconds: number;
  /** Optional test seam; production composition uses the canonical registry. */
  readonly policyRegistry?: readonly WorkerPolicyRule[];
  validate(payload: Record<string, unknown>): void;
  handle: WorkerJobHandler;
}

export interface WorkerAuditEvent {
  readonly cycleId: OpaqueId;
  readonly organizationId: OpaqueId;
  readonly workerId: string;
  readonly jobId: OpaqueId;
  readonly lane: WorkerLane;
  readonly jobType: string;
  readonly idempotencyKey: string;
  readonly outcome: "STARTED" | "SUCCEEDED" | "RETRY_SCHEDULED" | "QUARANTINED";
  readonly attempt: number;
  readonly durationMs: number;
  readonly reason: string | null;
}

export function createDurableWorkerAuditSink(persistence: Pick<PostgresPersistence, "appendAuditRecord">): { record(event: WorkerAuditEvent): Promise<void> } {
  return {
    async record(event) {
      await persistence.appendAuditRecord({
        organizationId: event.organizationId,
        actorId: null,
        unitId: null,
        workspaceId: null,
        action: `${event.lane === "outbox" ? "worker.outbox" : "worker.job"}.${event.outcome.toLowerCase()}`,
        resourceType: event.lane === "outbox" ? "DurableOutbox" : "DurableWorkerJob",
        resourceId: event.jobId,
        result: event.outcome === "RETRY_SCHEDULED" || event.outcome === "QUARANTINED" ? "ERROR" : "ALLOWED",
        reason: event.reason,
        correlationId: event.cycleId,
        metadata: { workerId: event.workerId, lane: event.lane, jobType: event.jobType, idempotencyKey: event.idempotencyKey, attempt: event.attempt, durationMs: event.durationMs }
      });
    }
  };
}

export interface WorkerMetricEvent {
  readonly name: "worker.handler.attempt" | "worker.handler.succeeded" | "worker.handler.retry" | "worker.handler.quarantined" | "worker.audit.failed" | "worker.backpressure";
  readonly lane: WorkerLane;
  readonly jobType: string | null;
  readonly durationMs: number;
  readonly cycleId?: OpaqueId;
  readonly jobId?: OpaqueId;
  readonly outboxId?: OpaqueId | null;
  readonly providerRequestId?: string | null;
}

export interface WorkerLaneBudget {
  maxProcessed?: number;
  maxDurationMs?: number;
}

export interface WorkerCycleOptions {
  /** Internal correlation used by the outbox attempt audit/metrics bridge. */
  cycleId?: OpaqueId;
  limit?: number;
  leaseSeconds?: number;
  maxAttempts?: number;
  laneConcurrency?: number;
  laneBudgets?: Partial<Record<Exclude<WorkerLane, "outbox">, WorkerLaneBudget>>;
}

export interface WorkerHealth {
  status: "READY" | "DEGRADED" | "UNAVAILABLE";
  process: "READY";
  lifecycle: "RUNNING" | "STOPPED";
  persistence: "READY" | "UNAVAILABLE";
  dispatch: "READY" | "BLOCKED";
  lanes: Record<WorkerLane, "READY" | "BLOCKED">;
  reason: string | null;
}

export interface WorkerDependencies {
  persistence: Pick<PostgresPersistence, "check" | "assertSchema" | "claimOutbox" | "completeOutbox" | "failOutbox"> & Partial<Pick<PostgresPersistence, "listExternalEffects" | "reconcileExternalEffect" | "claimExternalEffectForReconciliation" | "outboxStats" | "claimWorkerJobs" | "completeWorkerJob" | "failWorkerJob" | "workerJobStats" | "recordWorkerHeartbeat" | "listWorkerHeartbeats" | "enqueueWorkerJob" | "maintainWorkerRecords" | "poolCapacity">>;
  effects?: ExternalEffectLedger | null;
  sink?: OutboxSink;
  sinkMode?: "quarantine" | "enabled";
  reconciliationAdapter?: ExternalEffectQueryAdapter;
  lanes?: Partial<Record<Exclude<WorkerLane, "outbox">, WorkerLaneRunner>>;
  jobHandlerDefinitions?: readonly WorkerJobHandlerDefinition[];
  audit?: { record(event: WorkerAuditEvent): void | Promise<void> };
  /** The production factory sets this so durable jobs cannot run on telemetry-only audit. */
  auditRequired?: boolean;
  metrics?: { record(event: WorkerMetricEvent): void };
  resourceLimits?: Partial<WorkerResourceLimits>;
  databasePoolCapacity?: () => DatabasePoolCapacity;
  maxOutstandingOutbox?: number;
  maxOutstandingJobs?: number;
}

type ConfiguredWorkerSink = ReturnType<typeof createConfiguredWorkerSink>;

/** Keeps the two production entrypoints on one fail-closed dependency contract. */
export function createWorkerDependencies(
  persistence: WorkerDependencies["persistence"],
  config: Pick<CvgConfig, "workerMaxOutstandingOutbox">,
  configuredSink: ConfiguredWorkerSink,
  observability: Pick<WorkerDependencies, "audit" | "metrics" | "resourceLimits"> = {}
): WorkerDependencies {
  const effects = hasDurableEffectLedger(persistence) ? persistence : null;
  const jobHandlerDefinitions = createProductionWorkerJobHandlers({ persistence, effects, configuredSink, maxOutstandingJobs: config.workerMaxOutstandingOutbox });
  return {
    persistence,
    effects,
    sink: configuredSink.sink,
    sinkMode: configuredSink.sinkMode,
    maxOutstandingOutbox: config.workerMaxOutstandingOutbox,
    maxOutstandingJobs: config.workerMaxOutstandingOutbox,
    auditRequired: true,
    jobHandlerDefinitions,
    ...(persistence.poolCapacity ? { databasePoolCapacity: () => persistence.poolCapacity!() } : {}),
    ...observability,
    ...(configuredSink.queryAdapter ? { reconciliationAdapter: configuredSink.queryAdapter } : {})
  };
}

function hasDurableEffectLedger(
  persistence: WorkerDependencies["persistence"]
): persistence is WorkerDependencies["persistence"] & ExternalEffectLedger {
  const candidate = persistence as Partial<ExternalEffectLedger>;
  return typeof candidate.prepareExternalEffect === "function"
    && typeof candidate.markExternalEffectDispatched === "function"
    && typeof candidate.recordExternalEffectOutcome === "function";
}

function payloadObject(value: unknown, jobType: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("INVALID_INPUT", `${jobType} payload must be an object.`, 400);
  return value as Record<string, unknown>;
}

function boundedPayloadInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new DomainError("INVALID_INPUT", `${label} is outside its admitted range.`, 400);
  return value as number;
}

function parseScheduleTick(payload: Record<string, unknown>): readonly Omit<DurableWorkerJobInput, "id" | "organizationId">[] {
  const tasks = payload.tasks;
  if (!Array.isArray(tasks) || tasks.length > 25) throw new DomainError("INVALID_INPUT", "schedule.tick requires at most 25 tasks.", 400);
  return tasks.map((candidate, index) => {
    const task = payloadObject(candidate, `schedule.tick.tasks[${index}]`);
    const lane = task.lane;
    const jobType = task.jobType;
    const idempotencyKey = task.idempotencyKey;
    const nestedPayload = task.payload;
    if (lane !== "jobs" && lane !== "schedule" && lane !== "reconciliation" && lane !== "notifications" && lane !== "maintenance") throw new DomainError("INVALID_INPUT", `schedule.tick.tasks[${index}].lane is invalid.`, 400);
    if (typeof jobType !== "string" || typeof idempotencyKey !== "string") throw new DomainError("INVALID_INPUT", `schedule.tick.tasks[${index}] identity is invalid.`, 400);
    const admittedPayload = payloadObject(nestedPayload, `schedule.tick.tasks[${index}].payload`);
    enforceWorkerPolicy({ lane, jobType, organizationId: "scheduled-organization", idempotencyKey, payload: admittedPayload });
    const maxAttempts = task.maxAttempts === undefined ? 3 : boundedPayloadInteger(task.maxAttempts, `schedule.tick.tasks[${index}].maxAttempts`, 1, 20);
    const availableAt = task.availableAt;
    if (availableAt !== undefined && (typeof availableAt !== "string" || Number.isNaN(Date.parse(availableAt)))) throw new DomainError("INVALID_INPUT", `schedule.tick.tasks[${index}].availableAt is invalid.`, 400);
    return { lane, jobType, idempotencyKey, payload: admittedPayload, maxAttempts, ...(typeof availableAt === "string" ? { availableAt } : {}) };
  });
}

async function assertWorkerJobAdmissionCapacity(persistence: WorkerDependencies["persistence"], organizationId: OpaqueId, limit: number): Promise<void> {
  if (!persistence.workerJobStats) throw new DomainError("DEPENDENCY_UNAVAILABLE", "worker job admission pressure could not be measured; producer admission is blocked", 503);
  const stats = await persistence.workerJobStats(organizationId);
  if (stats.depth >= limit) throw new DomainError("BUDGET_EXCEEDED", `worker job admission backpressure active at depth ${stats.depth}; limit ${limit}`, 503);
}

function createProductionWorkerJobHandlers(input: { persistence: WorkerDependencies["persistence"]; effects: ExternalEffectLedger | null; configuredSink: ConfiguredWorkerSink; maxOutstandingJobs: number }): readonly WorkerJobHandlerDefinition[] {
  const definitions: WorkerJobHandlerDefinition[] = [
    {
      lane: "jobs",
      jobType: "storage.verify",
      resource: "database",
      requiresIdempotencyKey: true,
      requiresDurableAudit: true,
      emitsMetrics: true,
      quarantineOnExhaustion: true,
      timeoutMs: 5_000,
      timeoutDisposition: "RETRY",
      retryBaseSeconds: 2,
      retryMaxSeconds: 60,
      validate(payload) {
        const object = payloadObject(payload, "storage.verify");
        if (object.mode !== "schema") throw new DomainError("INVALID_INPUT", "storage.verify supports only schema verification.", 400);
      },
      handle: async () => {
        await input.persistence.check();
        await input.persistence.assertSchema();
      }
    }
  ];

  if (input.persistence.enqueueWorkerJob) {
    definitions.push({
      lane: "schedule",
      jobType: "schedule.tick",
      resource: "database",
      requiresIdempotencyKey: true,
      requiresDurableAudit: true,
      emitsMetrics: true,
      quarantineOnExhaustion: true,
      timeoutMs: 10_000,
      timeoutDisposition: "RETRY",
      retryBaseSeconds: 2,
      retryMaxSeconds: 120,
      validate(payload) { void parseScheduleTick(payload); },
      handle: async (job) => {
        for (const task of parseScheduleTick(job.payload)) {
          // schedule.tick produces durable jobs. Admission is bounded
          // independently from consumers so a full queue rejects new work
          // while existing lanes keep draining.
          await assertWorkerJobAdmissionCapacity(input.persistence, job.organizationId, input.maxOutstandingJobs);
          await input.persistence.enqueueWorkerJob!({ id: makeId(), organizationId: job.organizationId, ...task });
        }
      }
    });
  }

  if (input.configuredSink.queryAdapter && input.persistence.listExternalEffects && input.persistence.reconcileExternalEffect) {
    definitions.push({
      lane: "reconciliation",
      jobType: "external.reconcile",
      resource: "provider",
      requiresIdempotencyKey: true,
      requiresDurableAudit: true,
      emitsMetrics: true,
      quarantineOnExhaustion: true,
      timeoutMs: 5_000,
      timeoutDisposition: "QUARANTINE",
      retryBaseSeconds: 5,
      retryMaxSeconds: 300,
      validate(payload) {
        const effectId = payloadObject(payload, "external.reconcile").effectId;
        if (typeof effectId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(effectId)) throw new DomainError("INVALID_INPUT", "external.reconcile effectId is invalid.", 400);
      },
      handle: async (job, context) => {
        const effectId = payloadObject(job.payload, "external.reconcile").effectId as string;
        await reconcileUnknownExternalEffect({ listExternalEffects: input.persistence.listExternalEffects!, reconcileExternalEffect: input.persistence.reconcileExternalEffect!, ...(input.persistence.claimExternalEffectForReconciliation ? { claimExternalEffectForReconciliation: input.persistence.claimExternalEffectForReconciliation } : {}) }, job.organizationId, effectId as OpaqueId, input.configuredSink.queryAdapter!, { timeoutMs: 4_000, workerId: context.workerId, leaseSeconds: 30 });
      }
    });
  }

  if (input.configuredSink.sinkMode === "enabled" && input.configuredSink.sink && (!input.configuredSink.sink.requiresDurableEffectLedger || input.effects)) {
    const relay = new OutboxWorker(input.persistence, input.effects);
    definitions.push({
      lane: "notifications",
      jobType: "communication.dispatch",
      resource: "provider",
      requiresIdempotencyKey: true,
      requiresDurableAudit: true,
      emitsMetrics: true,
      quarantineOnExhaustion: true,
      timeoutMs: 15_000,
      timeoutDisposition: "QUARANTINE",
      retryBaseSeconds: 5,
      retryMaxSeconds: 300,
      validate(payload) { boundedPayloadInteger(payloadObject(payload, "communication.dispatch").limit, "communication.dispatch.limit", 1, 25); },
      handle: async (job, context) => {
        const limit = boundedPayloadInteger(job.payload.limit, "communication.dispatch.limit", 1, 25);
        await relay.runOnce(job.organizationId, context.workerId, input.configuredSink.sink, { limit, leaseSeconds: 30, maxAttempts: job.maxAttempts });
      }
    });
  }

  if (input.persistence.maintainWorkerRecords) {
    definitions.push({
      lane: "maintenance",
      jobType: "maintenance.cleanup",
      resource: "database",
      requiresIdempotencyKey: true,
      requiresDurableAudit: true,
      emitsMetrics: true,
      quarantineOnExhaustion: true,
      timeoutMs: 10_000,
      timeoutDisposition: "RETRY",
      retryBaseSeconds: 10,
      retryMaxSeconds: 600,
      validate(payload) {
        const object = payloadObject(payload, "maintenance.cleanup");
        if (typeof object.completedBefore !== "string" || Number.isNaN(Date.parse(object.completedBefore))) throw new DomainError("INVALID_INPUT", "maintenance.cleanup completedBefore is invalid.", 400);
        if (Date.parse(object.completedBefore) > Date.now() - 86_400_000) throw new DomainError("INVALID_INPUT", "maintenance.cleanup retains at least 24 hours of completed records.", 400);
        boundedPayloadInteger(object.limit, "maintenance.cleanup.limit", 1, 5_000);
      },
      handle: async (job) => {
        const object = payloadObject(job.payload, "maintenance.cleanup");
        await input.persistence.maintainWorkerRecords!(job.organizationId, object.completedBefore as string, object.limit as number);
      }
    });
  }
  return Object.freeze(definitions);
}

class WorkerLaneFailure extends Error {
  constructor(public readonly processed: number, public readonly failed: number, public readonly quarantined: number, message: string) {
    super(message);
    this.name = "WorkerLaneFailure";
  }
}

/** Separate process boundary for tenant-scoped leases, fenced outbox delivery and reconciliation. */
export class CvgWorkerApplication {
  private readonly relay: OutboxWorker;
  private readonly resources: WorkerResourceController;
  private stopped = false;
  private readonly activeCycles = new Set<AbortController>();

  constructor(private readonly dependencies: WorkerDependencies) {
    this.relay = new OutboxWorker(dependencies.persistence, dependencies.effects ?? null);
    this.resources = new WorkerResourceController(dependencies.resourceLimits);
    const definitions = dependencies.jobHandlerDefinitions ?? [];
    const identities = new Set<string>();
    for (const definition of definitions) {
      const identity = `${definition.lane}/${definition.jobType}`;
      if (identities.has(identity)) throw new DomainError("INVALID_INPUT", `Duplicate worker handler definition ${identity}.`, 500);
      identities.add(identity);
      if (!definition.jobType.trim() || definition.timeoutMs < 1 || definition.retryBaseSeconds < 1 || definition.retryMaxSeconds < definition.retryBaseSeconds || definition.requiresIdempotencyKey !== true || definition.requiresDurableAudit !== true || definition.emitsMetrics !== true || definition.quarantineOnExhaustion !== true) throw new DomainError("INVALID_INPUT", `Invalid worker handler definition ${identity}; durable idempotency, audit, metrics, and quarantine guarantees are required.`, 500);
    }
  }

  async health(): Promise<WorkerHealth> {
    const lanes = this.laneAvailability();
    try {
      await this.dependencies.persistence.check();
      await this.dependencies.persistence.assertSchema();
    } catch (error) {
      return { status: "UNAVAILABLE", process: "READY", lifecycle: this.stopped ? "STOPPED" : "RUNNING", persistence: "UNAVAILABLE", dispatch: "BLOCKED", lanes: this.blockedLaneAvailability(), reason: error instanceof Error ? error.message : String(error) };
    }
    const blockedLanes = WORKER_LANES.filter((lane) => lanes[lane] === "BLOCKED");
    const dispatchBlocked = lanes.outbox === "BLOCKED";
    if (blockedLanes.length) return { status: "DEGRADED", process: "READY", lifecycle: this.stopped ? "STOPPED" : "RUNNING", persistence: "READY", dispatch: dispatchBlocked ? "BLOCKED" : "READY", lanes, reason: dispatchBlocked ? this.outboxBlockedReason() : `Lanes sem runner configurado: ${blockedLanes.filter((lane) => lane !== "outbox").join(", ")}.` };
    return { status: "READY", process: "READY", lifecycle: this.stopped ? "STOPPED" : "RUNNING", persistence: "READY", dispatch: "READY", lanes, reason: null };
  }

  async runOnce(organizationId: OpaqueId, workerId: string, options: WorkerCycleOptions = {}): Promise<OutboxWorkerResult> {
    if (this.stopped) throw new DomainError("INVALID_STATE", "O worker já foi encerrado.", 409);
    enforceWorkerPolicy({ lane: "outbox", jobType: "outbox.dispatch", organizationId, idempotencyKey: `outbox:${workerId}`, payload: { workerId } });
    const sink = this.dependencies.sink;
    if (!sink || !this.outboxDispatchReady()) throw new DomainError("CAPABILITY_DISABLED", this.outboxBlockedReason(), 503);
    if (this.dependencies.auditRequired && !this.dependencies.audit) throw new DomainError("DEPENDENCY_UNAVAILABLE", "durable worker audit is required before outbox execution", 503);
    const cycleId = options.cycleId ?? makeId();
    const hooks: OutboxWorkerHooks = {
      cycleId,
      ...(this.dependencies.audit ? { audit: (event) => this.dependencies.audit!.record({ ...event, jobId: event.outboxId }) } : {}),
      ...(this.dependencies.metrics ? { metrics: (event: OutboxMetricEvent) => this.dependencies.metrics!.record({ name: event.name, lane: "outbox", jobType: event.jobType, durationMs: event.durationMs, cycleId: event.cycleId, jobId: event.outboxId, outboxId: event.outboxId, providerRequestId: event.providerRequestId }) } : {})
    };
    const relayOptions: Parameters<OutboxWorker["runOnce"]>[3] = { hooks };
    if (options.limit !== undefined) relayOptions.limit = options.limit;
    if (options.leaseSeconds !== undefined) relayOptions.leaseSeconds = options.leaseSeconds;
    if (options.maxAttempts !== undefined) relayOptions.maxAttempts = options.maxAttempts;
    return this.relay.runOnce(organizationId, workerId, sink, relayOptions);
  }

  async runCycle(organizationId: OpaqueId, workerId: string, options: WorkerCycleOptions = {}): Promise<WorkerCycleResult> {
    return this.resources.runCycle(() => this.executeCycle(organizationId, workerId, options));
  }

  private async executeCycle(organizationId: OpaqueId, workerId: string, options: WorkerCycleOptions): Promise<WorkerCycleResult> {
    if (this.stopped) throw new DomainError("INVALID_STATE", "O worker já foi encerrado.", 409);
    const cycleId = makeId();
    const startedAt = now();
    const controller = new AbortController();
    this.activeCycles.add(controller);
    const lanes = {} as Record<WorkerLane, WorkerLaneResult>;
    const metrics = { laneRuns: 0, laneFailures: 0, budgetExceeded: 0, backpressureEvents: 0, poisonMessages: 0, handlerAttempts: 0, handlerSucceeded: 0, handlerRetried: 0, handlerQuarantined: 0, auditFailures: 0 };
    const laneConcurrency = Math.min(WORKER_LANES.length - 1, Math.max(1, Math.trunc(options.laneConcurrency ?? 1)));
    const backpressureLimit = this.dependencies.maxOutstandingOutbox ?? 1_000;
    const workerBackpressureLimit = this.dependencies.maxOutstandingJobs ?? 1_000;
    const workerBackpressure = {} as NonNullable<WorkerCycleResult["backpressure"]["workerLanes"]>;
    let databasePool: WorkerCycleResult["backpressure"]["databasePool"] = { active: false, capacity: null };
    if (this.dependencies.databasePoolCapacity) {
      const capacity = this.dependencies.databasePoolCapacity();
      databasePool = { active: databasePoolSaturated(capacity), capacity };
    }
    let backpressure: WorkerCycleResult["backpressure"] = { active: databasePool.active, depth: null, limit: this.dependencies.persistence.outboxStats ? backpressureLimit : null, databasePool, workerLanes: workerBackpressure };
    const heartbeatWriter = this.dependencies.persistence.recordWorkerHeartbeat;
    const heartbeatLeaseSeconds = Math.min(300, Math.max(1, Math.trunc(options.leaseSeconds ?? 30)));
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let heartbeatStarted = false;
    let heartbeatFailure: unknown = null;
    let finalHeartbeatDetail: string | null = null;
    let finalHeartbeatStatus: "RUNNING" | "DEGRADED" | "STOPPING" = "RUNNING";
    const writeHeartbeat = async (status: "RUNNING" | "DEGRADED" | "STOPPING" | "STOPPED", detail: string | null): Promise<void> => {
      if (!heartbeatWriter) return;
      const lastSeenAt = now();
      await heartbeatWriter({ organizationId, workerId, status, lane: null, cycleId, startedAt, lastSeenAt, expiresAt: new Date(Date.parse(lastSeenAt) + heartbeatLeaseSeconds * 1_000).toISOString(), detail });
    };
    try {
      if (databasePool.active) {
        metrics.backpressureEvents += 1;
        this.dependencies.metrics?.record({ name: "worker.backpressure", lane: "maintenance", jobType: null, durationMs: 0, cycleId, outboxId: null });
        for (const lane of WORKER_LANES) lanes[lane] = { status: "BLOCKED", processed: 0, durationMs: 0, reason: "database pool is saturated; no work was claimed" };
        return { claimed: 0, delivered: 0, retried: 0, quarantined: 0, outcomeUnknown: 0, cycleId, status: "DEGRADED", startedAt, durationMs: Date.now() - Date.parse(startedAt), lanes, backpressure, metrics, resources: this.resources.snapshot() };
      }
      if (heartbeatWriter) {
        await writeHeartbeat("RUNNING", "worker cycle started");
        heartbeatStarted = true;
        heartbeatTimer = setInterval(() => {
          void writeHeartbeat("RUNNING", "worker cycle heartbeat").catch((error: unknown) => {
            heartbeatFailure ??= error;
            controller.abort();
          });
        }, Math.max(1_000, Math.min(30_000, Math.floor(heartbeatLeaseSeconds * 500))));
      }
      let outbox: OutboxWorkerResult = { claimed: 0, delivered: 0, retried: 0, quarantined: 0, outcomeUnknown: 0 };
      if (this.dependencies.persistence.outboxStats) {
        try {
          const stats = await this.dependencies.persistence.outboxStats(organizationId);
          backpressure = { active: stats.depth >= backpressureLimit, depth: stats.depth, limit: backpressureLimit, databasePool, workerLanes: workerBackpressure };
          metrics.poisonMessages = stats.poisonMessages;
          if (backpressure.active) {
            metrics.backpressureEvents += 1;
          }
        } catch { /* consumers may still drain; producer admission fails closed at its own boundary */ }
      }
      if (this.dependencies.persistence.workerJobStats) {
        for (const lane of WORKER_JOB_LANES) {
          try {
            const stats = await this.dependencies.persistence.workerJobStats(organizationId, lane);
            workerBackpressure[lane] = { active: stats.depth >= workerBackpressureLimit, depth: stats.depth, limit: workerBackpressureLimit, poisonMessages: stats.poisonMessages };
            metrics.poisonMessages = Math.max(metrics.poisonMessages, stats.poisonMessages);
            if (stats.depth >= workerBackpressureLimit) {
              metrics.backpressureEvents += 1;
            }
          } catch { /* producer admission fails closed; consumers may continue draining */ }
        }
      }
      if (!this.outboxDispatchReady()) {
        lanes.outbox = { status: "BLOCKED", processed: 0, durationMs: 0, reason: this.outboxBlockedReason() };
      } else {
        const laneStarted = Date.now();
        try {
          metrics.laneRuns += 1;
          outbox = await this.resources.run("provider", () => this.runOnce(organizationId, workerId, { ...options, cycleId }));
          metrics.handlerAttempts += outbox.claimed;
          metrics.handlerSucceeded += outbox.delivered;
          metrics.handlerRetried += outbox.retried;
          metrics.handlerQuarantined += outbox.quarantined;
          metrics.poisonMessages = Math.max(metrics.poisonMessages, outbox.quarantined);
          lanes.outbox = { status: "EXECUTED", processed: outbox.claimed, durationMs: Date.now() - laneStarted, reason: null };
        } catch (_error) {
          metrics.laneFailures += 1;
          lanes.outbox = { status: "FAILED", processed: 0, durationMs: Date.now() - laneStarted, reason: "outbox lane failed closed" };
        }
      }
      const runLane = async (lane: Exclude<WorkerLane, "outbox">): Promise<void> => {
        const durableRunner = this.defaultDurableJobRunner(lane, options, metrics);
        // Production reconciliation must use the durable typed runner so
        // policy, fencing, audit, metrics, retry and quarantine are applied.
        // Keep the direct adapter runner only as a synthetic compatibility
        // seam when durable auditing is not required, and never prefer it over
        // an available durable definition.
        // Custom lane runners are a synthetic seam only. A production
        // composition with durable auditing must always use the typed durable
        // claim/handler path, even if a caller supplies a legacy runner map.
        const syntheticRunner = this.dependencies.auditRequired ? undefined : this.dependencies.lanes?.[lane];
        const runner = durableRunner
          ?? syntheticRunner
          ?? (lane === "reconciliation" && !this.dependencies.auditRequired ? this.defaultReconciliationRunner() : undefined);
        if (!runner) {
          lanes[lane] = { status: "BLOCKED", processed: 0, durationMs: 0, reason: "lane runner is not configured; no work was claimed" };
          return;
        }
        const laneStarted = Date.now();
        try {
          metrics.laneRuns += 1;
          const processed = await this.runBoundedLane(runner, { cycleId, organizationId, workerId, signal: controller.signal, startedAt }, options.laneBudgets?.[lane], metrics);
          if (!Number.isSafeInteger(processed) || processed < 0) throw new Error("lane runner returned an invalid count");
          lanes[lane] = { status: "EXECUTED", processed, durationMs: Date.now() - laneStarted, reason: null };
        } catch (error) {
          metrics.laneFailures += 1;
          if (error instanceof WorkerLaneFailure) {
            lanes[lane] = { status: "FAILED", processed: error.processed, failed: error.failed, quarantined: error.quarantined, durationMs: Date.now() - laneStarted, reason: "lane runner failed closed" };
          } else {
            lanes[lane] = { status: "FAILED", processed: 0, durationMs: Date.now() - laneStarted, reason: "lane runner failed closed" };
          }
        }
      };
      const nonOutboxLanes = WORKER_JOB_LANES;
      for (let offset = 0; offset < nonOutboxLanes.length; offset += laneConcurrency) {
        await Promise.all(nonOutboxLanes.slice(offset, offset + laneConcurrency).map((lane) => runLane(lane)));
      }
      const laneStatuses = Object.values(lanes).map((lane) => lane.status);
      const status = laneStatuses.includes("FAILED") ? "FAILED" : laneStatuses.includes("BLOCKED") ? "DEGRADED" : "COMPLETED";
      finalHeartbeatStatus = controller.signal.aborted ? "STOPPING" : status === "COMPLETED" ? "RUNNING" : "DEGRADED";
      finalHeartbeatDetail = JSON.stringify({ cycleId, status, lanes: Object.fromEntries(Object.entries(lanes).map(([lane, result]) => [lane, { status: result.status, processed: result.processed, failed: result.failed ?? 0, quarantined: result.quarantined ?? 0 }])) }).slice(0, 2_000);
      return { ...outbox, cycleId, status, startedAt, durationMs: Date.now() - Date.parse(startedAt), lanes, backpressure, metrics, resources: this.resources.snapshot() };
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      this.activeCycles.delete(controller);
      if (heartbeatWriter && heartbeatStarted) {
        try {
          await writeHeartbeat(controller.signal.aborted ? "STOPPING" : finalHeartbeatStatus, finalHeartbeatDetail ?? (heartbeatFailure ? "worker heartbeat failed" : "worker cycle completed"));
        } catch (error) {
          heartbeatFailure ??= error;
        }
      }
      if (heartbeatFailure) throw heartbeatFailure;
    }
  }

  private async runBoundedLane(runner: WorkerLaneRunner, context: WorkerLaneContext, budget: WorkerLaneBudget | undefined, metrics: { budgetExceeded: number }): Promise<number> {
    const maxProcessed = budget?.maxProcessed === undefined ? null : Math.max(0, Math.trunc(budget.maxProcessed));
    const maxDurationMs = budget?.maxDurationMs === undefined ? null : Math.max(1, Math.trunc(budget.maxDurationMs));
    const laneController = new AbortController();
    const onParentAbort = () => laneController.abort();
    context.signal.addEventListener("abort", onParentAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let budgetExceeded = false;
    const execution = runner({ ...context, signal: laneController.signal });
    execution.catch(() => undefined);
    try {
      const bounded = maxDurationMs === null ? execution : Promise.race([execution, new Promise<never>((_, reject) => { timer = setTimeout(() => { budgetExceeded = true; laneController.abort(); reject(new DomainError("BUDGET_EXCEEDED", "A lane do worker excedeu seu budget de tempo.", 503)); }, maxDurationMs); })]);
      const processed = await bounded;
      if (maxProcessed !== null && processed > maxProcessed) {
        budgetExceeded = true;
        throw new DomainError("BUDGET_EXCEEDED", "A lane do worker excedeu seu budget de itens.", 503);
      }
      return processed;
    } catch (error) {
      if (budgetExceeded) metrics.budgetExceeded += 1;
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      context.signal.removeEventListener("abort", onParentAbort);
    }
  }

  stop(): void {
    this.stopped = true;
    for (const controller of this.activeCycles) controller.abort();
  }

  private outboxDispatchReady(): boolean {
    const sink = this.dependencies.sink;
    return Boolean(sink && this.dependencies.sinkMode !== "quarantine" && (!sink.requiresDurableEffectLedger || this.dependencies.effects) && (!this.dependencies.auditRequired || this.dependencies.audit));
  }

  private outboxBlockedReason(): string {
    const sink = this.dependencies.sink;
    if (sink?.requiresDurableEffectLedger && !this.dependencies.effects) return "O sink exige um ledger durável de efeitos, mas ele não foi composto; nenhum efeito externo será enviado.";
    if (this.dependencies.auditRequired && !this.dependencies.audit) return "O worker exige auditoria durável para despachar o outbox; nenhum efeito externo será enviado.";
    return "O sink está em quarentena ou não foi configurado; nenhum efeito externo será enviado.";
  }

  private laneAvailability(): Record<WorkerLane, "READY" | "BLOCKED"> {
    return {
      outbox: this.outboxDispatchReady() ? "READY" : "BLOCKED",
      jobs: this.syntheticLaneAvailable("jobs") || this.hasDurableJobLane("jobs") ? "READY" : "BLOCKED",
      schedule: this.syntheticLaneAvailable("schedule") || this.hasDurableJobLane("schedule") ? "READY" : "BLOCKED",
      reconciliation: this.syntheticLaneAvailable("reconciliation") || this.hasDefaultReconciliation() || this.hasDurableJobLane("reconciliation") ? "READY" : "BLOCKED",
      notifications: this.syntheticLaneAvailable("notifications") || this.hasDurableJobLane("notifications") ? "READY" : "BLOCKED",
      maintenance: this.syntheticLaneAvailable("maintenance") || this.hasDurableJobLane("maintenance") ? "READY" : "BLOCKED"
    };
  }

  private blockedLaneAvailability(): Record<WorkerLane, "READY" | "BLOCKED"> {
    return { outbox: "BLOCKED", jobs: "BLOCKED", schedule: "BLOCKED", reconciliation: "BLOCKED", notifications: "BLOCKED", maintenance: "BLOCKED" };
  }

  private hasDefaultReconciliation(): boolean {
    return !this.dependencies.auditRequired && Boolean(this.dependencies.reconciliationAdapter && this.dependencies.persistence.listExternalEffects && this.dependencies.persistence.reconcileExternalEffect);
  }

  private syntheticLaneAvailable(lane: Exclude<WorkerLane, "outbox">): boolean {
    return !this.dependencies.auditRequired && Boolean(this.dependencies.lanes?.[lane]);
  }

  private hasDurableJobLane(_lane: DurableWorkerLane): boolean {
    const hasHandler = Boolean(this.dependencies.jobHandlerDefinitions?.some((definition) => definition.lane === _lane));
    if (this.dependencies.auditRequired && !this.dependencies.audit) return false;
    return Boolean(this.dependencies.persistence.claimWorkerJobs && this.dependencies.persistence.completeWorkerJob && this.dependencies.persistence.failWorkerJob && hasHandler);
  }

  private defaultDurableJobRunner(lane: DurableWorkerLane, options: WorkerCycleOptions, metrics: WorkerCycleResult["metrics"]): WorkerLaneRunner | undefined {
    const claimWorkerJobs = this.dependencies.persistence.claimWorkerJobs;
    const completeWorkerJob = this.dependencies.persistence.completeWorkerJob;
    const failWorkerJob = this.dependencies.persistence.failWorkerJob;
    const definitions = this.dependencies.jobHandlerDefinitions;
    if (!claimWorkerJobs || !completeWorkerJob || !failWorkerJob || !definitions?.length || (this.dependencies.auditRequired && !this.dependencies.audit)) return undefined;
    return async (context) => {
      const requestedLimit = Math.min(100, Math.max(1, Math.trunc(options.limit ?? 10)));
      const itemBudget = options.laneBudgets?.[lane]?.maxProcessed;
      const claimLimit = itemBudget === undefined ? requestedLimit : Math.min(requestedLimit, Math.max(0, Math.trunc(itemBudget)));
      if (claimLimit === 0) return 0;
      const jobs = await this.resources.run("database", () => claimWorkerJobs(context.organizationId, lane, context.workerId, claimLimit, options.leaseSeconds ?? 30));
      let processed = 0;
      let failed = 0;
      let quarantined = 0;
      let firstFailure: string | null = null;
      for (const job of jobs) {
        if (context.signal.aborted) {
          const status = await failWorkerJob(context.organizationId, job.id, context.workerId, job.fenceToken, "WORKER_SHUTDOWN_INTERRUPTED", false, 1);
          processed += 1;
          failed += 1;
          if (status === "QUARANTINED") {
            quarantined += 1;
            metrics.poisonMessages += 1;
          }
          break;
        }
        const definition = definitions?.find((candidate) => candidate.lane === job.lane && candidate.jobType === job.jobType);
        if (!definition) {
          await this.resources.run("database", () => failWorkerJob(context.organizationId, job.id, context.workerId, job.fenceToken, "NO_HANDLER_CONFIGURED", true, 1));
          processed += 1;
          failed += 1;
          quarantined += 1;
          metrics.poisonMessages += 1;
          firstFailure ??= `no handler configured for durable job type ${job.jobType}`;
          continue;
        }
        const handler = definition;
        const attemptStarted = Date.now();
        try {
          enforceWorkerPolicy({ lane: job.lane, jobType: job.jobType, organizationId: job.organizationId, idempotencyKey: job.idempotencyKey, payload: job.payload }, handler.policyRegistry);
          handler.validate(job.payload);
          metrics.handlerAttempts += 1;
          this.dependencies.metrics?.record({ name: "worker.handler.attempt", lane, jobType: job.jobType, durationMs: 0, cycleId: context.cycleId, jobId: job.id });
          await this.recordAudit(job, context, "STARTED", 0, null, metrics);
          await this.resources.run(handler.resource, () => withAbortableTimeout((signal) => handler.handle(job, { ...context, signal }), handler.timeoutMs, context.signal));
          if (context.signal.aborted) throw new DomainError("BUDGET_EXCEEDED", "Worker cycle was cancelled before durable completion.", 503);
          const durationMs = Date.now() - attemptStarted;
          metrics.handlerSucceeded += 1;
          this.dependencies.metrics?.record({ name: "worker.handler.succeeded", lane, jobType: job.jobType, durationMs, cycleId: context.cycleId, jobId: job.id });
          await this.recordAudit(job, context, "SUCCEEDED", durationMs, null, metrics);
          await this.resources.run("database", () => completeWorkerJob(context.organizationId, job.id, context.workerId, job.fenceToken));
          processed += 1;
        } catch (error) {
          const message = (error instanceof Error ? error.message : String(error)).trim().slice(0, 2_000) || "durable worker job failed";
          const timedOut = error instanceof DomainError && error.code === "BUDGET_EXCEEDED" && /deadline/i.test(error.message);
          const shouldQuarantine = job.attempts >= job.maxAttempts || (timedOut && handler.timeoutDisposition === "QUARANTINE");
          const retryAfterSeconds = Math.min(handler.retryMaxSeconds, handler.retryBaseSeconds * 2 ** Math.min(8, Math.max(0, job.attempts - 1)));
          const status = await this.resources.run("database", () => failWorkerJob(context.organizationId, job.id, context.workerId, job.fenceToken, message, shouldQuarantine, retryAfterSeconds));
          const durationMs = Date.now() - attemptStarted;
          processed += 1;
          failed += 1;
          firstFailure ??= message;
          if (status === "QUARANTINED") {
            quarantined += 1;
            metrics.poisonMessages += 1;
            metrics.handlerQuarantined += 1;
            this.dependencies.metrics?.record({ name: "worker.handler.quarantined", lane, jobType: job.jobType, durationMs, cycleId: context.cycleId, jobId: job.id });
            await this.recordAudit(job, context, "QUARANTINED", durationMs, message, metrics);
          } else {
            metrics.handlerRetried += 1;
            this.dependencies.metrics?.record({ name: "worker.handler.retry", lane, jobType: job.jobType, durationMs, cycleId: context.cycleId, jobId: job.id });
            await this.recordAudit(job, context, "RETRY_SCHEDULED", durationMs, message, metrics);
          }
        }
      }
      if (firstFailure) throw new WorkerLaneFailure(processed, failed, quarantined, firstFailure);
      return processed;
    };
  }

  private async recordAudit(job: DurableWorkerJobRecord, context: WorkerLaneContext, outcome: WorkerAuditEvent["outcome"], durationMs: number, reason: string | null, metrics: WorkerCycleResult["metrics"]): Promise<void> {
    try {
      if (!this.dependencies.audit) {
        if (this.dependencies.auditRequired) throw new DomainError("DEPENDENCY_UNAVAILABLE", "durable worker audit is required before job execution", 503);
        return;
      }
      await this.dependencies.audit.record({
        cycleId: context.cycleId,
        organizationId: context.organizationId,
        workerId: context.workerId,
        jobId: job.id,
        lane: job.lane,
        jobType: job.jobType,
        idempotencyKey: job.idempotencyKey,
        outcome,
        attempt: job.attempts,
        durationMs,
        reason
      });
    } catch (error) {
      metrics.auditFailures += 1;
      this.dependencies.metrics?.record({ name: "worker.audit.failed", lane: job.lane, jobType: job.jobType, durationMs, cycleId: context.cycleId, jobId: job.id });
      throw error;
    }
  }

  private defaultReconciliationRunner(): WorkerLaneRunner | undefined {
    if (!this.hasDefaultReconciliation()) return undefined;
    return async (context) => {
      const listExternalEffects = this.dependencies.persistence.listExternalEffects!;
      const reconcileExternalEffect = this.dependencies.persistence.reconcileExternalEffect!;
      const claimExternalEffectForReconciliation = this.dependencies.persistence.claimExternalEffectForReconciliation;
      const effects = await listExternalEffects(context.organizationId);
      let processed = 0;
      for (const effect of effects.filter((candidate) => candidate.status === "OUTCOME_UNKNOWN" || candidate.status === "RECONCILIATION_REQUIRED" || candidate.status === "RECONCILING").slice(0, 10)) {
        if (context.signal.aborted) break;
        try {
          await reconcileUnknownExternalEffect({ listExternalEffects, reconcileExternalEffect, ...(claimExternalEffectForReconciliation ? { claimExternalEffectForReconciliation } : {}) }, context.organizationId, effect.id, this.dependencies.reconciliationAdapter!, { timeoutMs: 3_000, workerId: context.workerId, leaseSeconds: 30 });
          processed += 1;
        } catch (error) {
          if (error instanceof DomainError && error.code === "DEPENDENCY_UNAVAILABLE") continue;
          throw error;
        }
      }
      return processed;
    };
  }
}

/** Explicitly blocked sink useful for wiring checks; it never claims delivery. */
export const blockedWorkerSink: OutboxSink = {
  async deliver(): Promise<OutboxDeliveryDecision> {
    return "QUARANTINE";
  }
};

function messagePayload(value: unknown): { messageId: string; channel: "SMS" | "EMAIL" | "WHATSAPP"; recipient: string; template: string; body: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("INVALID_INPUT", "O payload de comunicação não é um objeto.", 400);
  const payload = value as Record<string, unknown>;
  const messageId = typeof payload.messageId === "string" ? payload.messageId : "";
  const channel = payload.channel;
  const recipient = typeof payload.recipient === "string" ? payload.recipient : "";
  const template = typeof payload.template === "string" ? payload.template : "";
  const body = typeof payload.body === "string" ? payload.body : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(messageId) || (channel !== "SMS" && channel !== "EMAIL" && channel !== "WHATSAPP") || !recipient.trim() || recipient.length > 320 || !template.trim() || template.length > 120 || !body.trim() || body.length > 20_000) throw new DomainError("INVALID_INPUT", "O payload de comunicação não atende ao contrato do provider.", 400);
  return { messageId, channel, recipient: recipient.trim(), template: template.trim(), body };
}

/** Builds the only enabled external sink; quarantine remains the safe default. */
export function createConfiguredWorkerSink(config: Pick<CvgConfig, "workerSinkMode" | "messagingProviderEndpoint" | "messagingProviderAllowedHosts" | "messagingCredentialRef" | "messagingSendPath" | "messagingQueryPath" | "secretProvider" | "secretDir">): { sink: OutboxSink; sinkMode: "quarantine" | "enabled"; queryAdapter?: ExternalEffectQueryAdapter } {
  if (config.workerSinkMode !== "enabled") return { sink: blockedWorkerSink, sinkMode: "quarantine" };
  if (!config.messagingProviderEndpoint || !config.messagingCredentialRef) throw new DomainError("CAPABILITY_DISABLED", "O sink de mensagens foi habilitado sem endpoint e referência de credencial aprovados.", 503);
  if (!config.messagingProviderAllowedHosts.length) throw new DomainError("CAPABILITY_DISABLED", "O sink de mensagens exige uma allowlist de hosts do provider.", 503);
  const secretProvider = configuredSecretProvider(config.secretProvider, process.env, config.secretDir);
  if (!secretProvider || secretProvider.status() !== "READY" || !secretProvider.resolve) throw new DomainError("CAPABILITY_DISABLED", "O sink de mensagens exige um SecretProvider pronto com resolução autorizada.", 503);
  if (!secretProvider.has(config.messagingCredentialRef)) throw new DomainError("CAPABILITY_DISABLED", "A referência de credencial do sink não está disponível no SecretProvider configurado.", 503);
  const provider = new HttpMessagingProvider({ endpoint: config.messagingProviderEndpoint, allowedHosts: config.messagingProviderAllowedHosts, credentialRef: config.messagingCredentialRef, sendPath: config.messagingSendPath, ...(config.messagingQueryPath ? { queryPath: config.messagingQueryPath } : {}), resolveSecret: (reference) => secretProvider.resolve!(reference) });
  const sink = new MessagingOutboxSink(provider, (record, context) => {
    if (record.eventType !== "communication.message.approved") throw new DomainError("CAPABILITY_DISABLED", "O sink de mensagens recebeu um evento que não pertence à sua integração.", 503);
    const payload = messagePayload(record.payload);
    return { idempotencyKey: context.idempotencyKey, requestId: payload.messageId, channel: payload.channel, recipient: payload.recipient, body: payload.body, metadata: { template: payload.template, organizationId: record.organizationId, effectId: context.effectId, outboxId: record.id } };
  });
  return { sink, sinkMode: "enabled", queryAdapter: createMessagingExternalEffectQueryAdapter(provider) };
}
