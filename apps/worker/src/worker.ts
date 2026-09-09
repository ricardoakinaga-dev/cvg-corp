import type { OpaqueId } from "@cvg/contracts";
import { DomainError } from "@cvg/domain";
import { OutboxWorker, type ExternalEffectLedger, type OutboxDeliveryDecision, type OutboxSink, type OutboxWorkerResult } from "@cvg/integrations";
import type { PostgresPersistence } from "@cvg/persistence";

export interface WorkerHealth {
  status: "READY" | "DEGRADED" | "UNAVAILABLE";
  process: "READY";
  persistence: "READY" | "UNAVAILABLE";
  dispatch: "READY" | "BLOCKED";
  reason: string | null;
}

export interface WorkerDependencies {
  persistence: Pick<PostgresPersistence, "check" | "assertSchema" | "claimOutbox" | "completeOutbox" | "failOutbox">;
  effects?: ExternalEffectLedger | null;
  sink?: OutboxSink;
  sinkMode?: "quarantine" | "enabled";
}

/** Separate process boundary for leases, outbox delivery and reconciliation. */
export class CvgWorkerApplication {
  private readonly relay: OutboxWorker;
  private stopped = false;

  constructor(private readonly dependencies: WorkerDependencies) {
    this.relay = new OutboxWorker(dependencies.persistence, dependencies.effects ?? null);
  }

  async health(): Promise<WorkerHealth> {
    try {
      await this.dependencies.persistence.check();
      await this.dependencies.persistence.assertSchema();
    } catch (error) {
      return { status: "UNAVAILABLE", process: "READY", persistence: "UNAVAILABLE", dispatch: "BLOCKED", reason: error instanceof Error ? error.message : String(error) };
    }
    if (!this.dependencies.sink || this.dependencies.sinkMode === "quarantine") return { status: "DEGRADED", process: "READY", persistence: "READY", dispatch: "BLOCKED", reason: "O sink está em quarentena; nenhum efeito externo será enviado." };
    return { status: "READY", process: "READY", persistence: "READY", dispatch: "READY", reason: null };
  }

  async runOnce(organizationId: OpaqueId, workerId: string, options: { limit?: number; leaseSeconds?: number; maxAttempts?: number } = {}): Promise<OutboxWorkerResult> {
    if (this.stopped) throw new DomainError("INVALID_STATE", "O worker já foi encerrado.", 409);
    if (!this.dependencies.sink) throw new DomainError("CAPABILITY_DISABLED", "Nenhum sink governado foi configurado; nenhum dispatch foi realizado.", 503);
    return this.relay.runOnce(organizationId, workerId, this.dependencies.sink, options);
  }

  stop(): void {
    this.stopped = true;
  }
}

/** Explicitly blocked sink useful for wiring checks; it never claims delivery. */
export const blockedWorkerSink: OutboxSink = {
  async deliver(): Promise<OutboxDeliveryDecision> {
    return "QUARANTINE";
  }
};
