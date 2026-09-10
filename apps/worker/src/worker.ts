import type { OpaqueId } from "@cvg/contracts";
import { DomainError, makeId, now } from "@cvg/domain";
import { configuredSecretProvider, createMessagingExternalEffectQueryAdapter, HttpMessagingProvider, MessagingOutboxSink, OutboxWorker, reconcileUnknownExternalEffect, type ExternalEffectLedger, type ExternalEffectQueryAdapter, type OutboxDeliveryDecision, type OutboxSink, type OutboxWorkerResult } from "@cvg/integrations";
import type { CvgConfig } from "@cvg/config";
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
  backpressure: { active: boolean; depth: number | null; limit: number | null };
  metrics: { laneRuns: number; laneFailures: number; budgetExceeded: number; backpressureEvents: number; poisonMessages: number };
}

export type WorkerLaneRunner = (context: WorkerLaneContext) => Promise<number>;

export interface WorkerLaneBudget {
  maxProcessed?: number;
  maxDurationMs?: number;
}

export interface WorkerCycleOptions {
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
  persistence: Pick<PostgresPersistence, "check" | "assertSchema" | "claimOutbox" | "completeOutbox" | "failOutbox"> & Partial<Pick<PostgresPersistence, "listExternalEffects" | "reconcileExternalEffect" | "claimExternalEffectForReconciliation" | "outboxStats">>;
  effects?: ExternalEffectLedger | null;
  sink?: OutboxSink;
  sinkMode?: "quarantine" | "enabled";
  reconciliationAdapter?: ExternalEffectQueryAdapter;
  lanes?: Partial<Record<Exclude<WorkerLane, "outbox">, WorkerLaneRunner>>;
  maxOutstandingOutbox?: number;
}

/** Separate process boundary for tenant-scoped leases, fenced outbox delivery and reconciliation. */
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

  async runOnce(organizationId: OpaqueId, workerId: string, options: WorkerCycleOptions = {}): Promise<OutboxWorkerResult> {
    if (this.stopped) throw new DomainError("INVALID_STATE", "O worker já foi encerrado.", 409);
    if (!this.dependencies.sink || this.dependencies.sinkMode === "quarantine") throw new DomainError("CAPABILITY_DISABLED", "Nenhum sink governado foi configurado; nenhum dispatch foi realizado.", 503);
    return this.relay.runOnce(organizationId, workerId, this.dependencies.sink, options);
  }

  async runCycle(organizationId: OpaqueId, workerId: string, options: WorkerCycleOptions = {}): Promise<WorkerCycleResult> {
    if (this.stopped) throw new DomainError("INVALID_STATE", "O worker já foi encerrado.", 409);
    const cycleId = makeId();
    const startedAt = now();
    const controller = new AbortController();
    this.activeCycles.add(controller);
    const lanes = {} as Record<WorkerLane, WorkerLaneResult>;
    const metrics = { laneRuns: 0, laneFailures: 0, budgetExceeded: 0, backpressureEvents: 0, poisonMessages: 0 };
    const laneConcurrency = Math.min(WORKER_LANES.length - 1, Math.max(1, Math.trunc(options.laneConcurrency ?? 1)));
    const backpressureLimit = this.dependencies.maxOutstandingOutbox ?? 1_000;
    let backpressure: WorkerCycleResult["backpressure"] = { active: false, depth: null, limit: this.dependencies.persistence.outboxStats ? backpressureLimit : null };
    try {
      let outbox: OutboxWorkerResult = { claimed: 0, delivered: 0, retried: 0, quarantined: 0, outcomeUnknown: 0 };
      let outboxBlockedReason: string | null = null;
      if (this.dependencies.persistence.outboxStats) {
        try {
          const stats = await this.dependencies.persistence.outboxStats(organizationId);
          backpressure = { active: stats.depth >= backpressureLimit, depth: stats.depth, limit: backpressureLimit };
          metrics.poisonMessages = stats.poisonMessages;
          if (backpressure.active) {
            metrics.backpressureEvents += 1;
            outboxBlockedReason = `outbox backpressure active at depth ${stats.depth}; limit ${backpressureLimit}`;
          }
        } catch {
          outboxBlockedReason = "outbox pressure could not be measured; no work was claimed";
        }
      }
      if (!this.dependencies.sink || this.dependencies.sinkMode === "quarantine") {
        lanes.outbox = { status: "BLOCKED", processed: 0, durationMs: 0, reason: "outbox sink is not enabled; no records were claimed" };
      } else if (outboxBlockedReason) {
        lanes.outbox = { status: "BLOCKED", processed: 0, durationMs: 0, reason: outboxBlockedReason };
      } else {
        const laneStarted = Date.now();
        try {
          metrics.laneRuns += 1;
          outbox = await this.runOnce(organizationId, workerId, options);
          metrics.poisonMessages = Math.max(metrics.poisonMessages, outbox.quarantined);
          lanes.outbox = { status: "EXECUTED", processed: outbox.claimed, durationMs: Date.now() - laneStarted, reason: null };
        } catch (_error) {
          metrics.laneFailures += 1;
          lanes.outbox = { status: "FAILED", processed: 0, durationMs: Date.now() - laneStarted, reason: "outbox lane failed closed" };
        }
      }
      const runLane = async (lane: Exclude<WorkerLane, "outbox">): Promise<void> => {
        const runner = lane === "reconciliation" ? this.dependencies.lanes?.reconciliation ?? this.defaultReconciliationRunner() : this.dependencies.lanes?.[lane];
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
        } catch (_error) {
          metrics.laneFailures += 1;
          lanes[lane] = { status: "FAILED", processed: 0, durationMs: Date.now() - laneStarted, reason: "lane runner failed closed" };
        }
      };
      const nonOutboxLanes = WORKER_LANES.filter((lane): lane is Exclude<WorkerLane, "outbox"> => lane !== "outbox");
      for (let offset = 0; offset < nonOutboxLanes.length; offset += laneConcurrency) {
        await Promise.all(nonOutboxLanes.slice(offset, offset + laneConcurrency).map((lane) => runLane(lane)));
      }
      const laneStatuses = Object.values(lanes).map((lane) => lane.status);
      const status = laneStatuses.includes("FAILED") ? "FAILED" : laneStatuses.includes("BLOCKED") ? "DEGRADED" : "COMPLETED";
      return { ...outbox, cycleId, status, startedAt, durationMs: Date.now() - Date.parse(startedAt), lanes, backpressure, metrics };
    } finally {
      this.activeCycles.delete(controller);
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

  private laneAvailability(): Record<WorkerLane, "READY" | "BLOCKED"> {
    return {
      outbox: this.dependencies.sink && this.dependencies.sinkMode !== "quarantine" ? "READY" : "BLOCKED",
      jobs: this.dependencies.lanes?.jobs ? "READY" : "BLOCKED",
      schedule: this.dependencies.lanes?.schedule ? "READY" : "BLOCKED",
      reconciliation: this.dependencies.lanes?.reconciliation || this.hasDefaultReconciliation() ? "READY" : "BLOCKED",
      notifications: this.dependencies.lanes?.notifications ? "READY" : "BLOCKED",
      maintenance: this.dependencies.lanes?.maintenance ? "READY" : "BLOCKED"
    };
  }

  private blockedLaneAvailability(): Record<WorkerLane, "READY" | "BLOCKED"> {
    return { outbox: "BLOCKED", jobs: "BLOCKED", schedule: "BLOCKED", reconciliation: "BLOCKED", notifications: "BLOCKED", maintenance: "BLOCKED" };
  }

  private hasDefaultReconciliation(): boolean {
    return Boolean(this.dependencies.reconciliationAdapter && this.dependencies.persistence.listExternalEffects && this.dependencies.persistence.reconcileExternalEffect);
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
  if (!secretProvider?.resolve) throw new DomainError("CAPABILITY_DISABLED", "O sink de mensagens exige um SecretProvider com resolução autorizada.", 503);
  if (!secretProvider.has(config.messagingCredentialRef)) throw new DomainError("CAPABILITY_DISABLED", "A referência de credencial do sink não está disponível no SecretProvider configurado.", 503);
  const provider = new HttpMessagingProvider({ endpoint: config.messagingProviderEndpoint, allowedHosts: config.messagingProviderAllowedHosts, credentialRef: config.messagingCredentialRef, sendPath: config.messagingSendPath, ...(config.messagingQueryPath ? { queryPath: config.messagingQueryPath } : {}), resolveSecret: (reference) => secretProvider.resolve!(reference) });
  const sink = new MessagingOutboxSink(provider, (record, context) => {
    if (record.eventType !== "communication.message.approved") throw new DomainError("CAPABILITY_DISABLED", "O sink de mensagens recebeu um evento que não pertence à sua integração.", 503);
    const payload = messagePayload(record.payload);
    return { idempotencyKey: context.idempotencyKey, requestId: payload.messageId, channel: payload.channel, recipient: payload.recipient, body: payload.body, metadata: { template: payload.template, organizationId: record.organizationId, effectId: context.effectId, outboxId: record.id } };
  });
  return { sink, sinkMode: "enabled", queryAdapter: createMessagingExternalEffectQueryAdapter(provider) };
}
