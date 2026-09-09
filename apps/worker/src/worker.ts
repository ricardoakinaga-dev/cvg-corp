import type { OpaqueId } from "@cvg/contracts";
import { DomainError, makeId, now } from "@cvg/domain";
import { OutboxWorker, type ExternalEffectLedger, type OutboxDeliveryDecision, type OutboxSink, type OutboxWorkerResult } from "@cvg/integrations";
import type { PostgresPersistence } from "@cvg/persistence";

export const WORKER_LANES = ["outbox", "jobs", "schedule", "reconciliation", "notifications", "maintenance"] as const;
export type WorkerLane = (typeof WORKER_LANES)[number];

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
}

export interface WorkerCycleResult extends OutboxWorkerResult {
  cycleId: OpaqueId;
  status: "COMPLETED" | "DEGRADED" | "FAILED";
  startedAt: string;
  durationMs: number;
  lanes: Record<WorkerLane, WorkerLaneResult>;
}

export type WorkerLaneRunner = (context: WorkerLaneContext) => Promise<number>;

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
  persistence: Pick<PostgresPersistence, "check" | "assertSchema" | "claimOutbox" | "completeOutbox" | "failOutbox">;
  effects?: ExternalEffectLedger | null;
  sink?: OutboxSink;
  sinkMode?: "quarantine" | "enabled";
  lanes?: Partial<Record<Exclude<WorkerLane, "outbox">, WorkerLaneRunner>>;
}

/** Separate process boundary for leases, outbox delivery and reconciliation. */
export class CvgWorkerApplication {
  private readonly relay: OutboxWorker;
  private stopped = false;
  private readonly activeCycles = new Set<AbortController>();

  constructor(private readonly dependencies: WorkerDependencies) {
    this.relay = new OutboxWorker(dependencies.persistence, dependencies.effects ?? null);
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
    if (blockedLanes.length) return { status: "DEGRADED", process: "READY", lifecycle: this.stopped ? "STOPPED" : "RUNNING", persistence: "READY", dispatch: dispatchBlocked ? "BLOCKED" : "READY", lanes, reason: dispatchBlocked ? "O sink está em quarentena ou não foi configurado; nenhum efeito externo será enviado." : `Lanes sem runner configurado: ${blockedLanes.filter((lane) => lane !== "outbox").join(", ")}.` };
    return { status: "READY", process: "READY", lifecycle: this.stopped ? "STOPPED" : "RUNNING", persistence: "READY", dispatch: "READY", lanes, reason: null };
  }

  async runOnce(organizationId: OpaqueId, workerId: string, options: { limit?: number; leaseSeconds?: number; maxAttempts?: number } = {}): Promise<OutboxWorkerResult> {
    if (this.stopped) throw new DomainError("INVALID_STATE", "O worker já foi encerrado.", 409);
    if (!this.dependencies.sink) throw new DomainError("CAPABILITY_DISABLED", "Nenhum sink governado foi configurado; nenhum dispatch foi realizado.", 503);
    return this.relay.runOnce(organizationId, workerId, this.dependencies.sink, options);
  }

  async runCycle(organizationId: OpaqueId, workerId: string, options: { limit?: number; leaseSeconds?: number; maxAttempts?: number } = {}): Promise<WorkerCycleResult> {
    if (this.stopped) throw new DomainError("INVALID_STATE", "O worker já foi encerrado.", 409);
    const cycleId = makeId();
    const startedAt = now();
    const controller = new AbortController();
    this.activeCycles.add(controller);
    const lanes = {} as Record<WorkerLane, WorkerLaneResult>;
    try {
      let outbox: OutboxWorkerResult = { claimed: 0, delivered: 0, retried: 0, quarantined: 0, outcomeUnknown: 0 };
      if (!this.dependencies.sink || this.dependencies.sinkMode === "quarantine") {
        lanes.outbox = { status: "BLOCKED", processed: 0, durationMs: 0, reason: "outbox sink is not enabled; no records were claimed" };
      } else {
        const laneStarted = Date.now();
        try {
          outbox = await this.runOnce(organizationId, workerId, options);
          lanes.outbox = { status: "EXECUTED", processed: outbox.claimed, durationMs: Date.now() - laneStarted, reason: null };
        } catch (_error) {
          lanes.outbox = { status: "FAILED", processed: 0, durationMs: Date.now() - laneStarted, reason: "outbox lane failed closed" };
        }
      }
      for (const lane of WORKER_LANES) {
        if (lane === "outbox") continue;
        const runner = this.dependencies.lanes?.[lane];
        if (!runner) {
          lanes[lane] = { status: "BLOCKED", processed: 0, durationMs: 0, reason: "lane runner is not configured; no work was claimed" };
          continue;
        }
        const laneStarted = Date.now();
        try {
          const processed = await runner({ cycleId, organizationId, workerId, signal: controller.signal, startedAt });
          if (!Number.isSafeInteger(processed) || processed < 0) throw new Error("lane runner returned an invalid count");
          lanes[lane] = { status: "EXECUTED", processed, durationMs: Date.now() - laneStarted, reason: null };
        } catch (_error) {
          lanes[lane] = { status: "FAILED", processed: 0, durationMs: Date.now() - laneStarted, reason: "lane runner failed closed" };
        }
      }
      const laneStatuses = Object.values(lanes).map((lane) => lane.status);
      const status = laneStatuses.includes("FAILED") ? "FAILED" : laneStatuses.includes("BLOCKED") ? "DEGRADED" : "COMPLETED";
      return { ...outbox, cycleId, status, startedAt, durationMs: Date.now() - Date.parse(startedAt), lanes };
    } finally {
      this.activeCycles.delete(controller);
    }
  }

  stop(): void {
    this.stopped = true;
    for (const controller of this.activeCycles) controller.abort();
  }

  private laneAvailability(): Record<WorkerLane, "READY" | "BLOCKED"> {
    return {
      outbox: this.dependencies.sink && this.dependencies.sinkMode !== "quarantine" ? "READY" : "BLOCKED",
      jobs: this.dependencies.lanes?.jobs ? "READY" : "BLOCKED",
      schedule: this.dependencies.lanes?.schedule ? "READY" : "BLOCKED",
      reconciliation: this.dependencies.lanes?.reconciliation ? "READY" : "BLOCKED",
      notifications: this.dependencies.lanes?.notifications ? "READY" : "BLOCKED",
      maintenance: this.dependencies.lanes?.maintenance ? "READY" : "BLOCKED"
    };
  }

  private blockedLaneAvailability(): Record<WorkerLane, "READY" | "BLOCKED"> {
    return { outbox: "BLOCKED", jobs: "BLOCKED", schedule: "BLOCKED", reconciliation: "BLOCKED", notifications: "BLOCKED", maintenance: "BLOCKED" };
  }
}

/** Explicitly blocked sink useful for wiring checks; it never claims delivery. */
export const blockedWorkerSink: OutboxSink = {
  async deliver(): Promise<OutboxDeliveryDecision> {
    return "QUARANTINE";
  }
};
