import { assertInternalMetricsPolicy, enforceApplicationPolicy } from "@cvg/agent-policy";
import type { CvgContext } from "@cvg/contracts";
import type { OpaqueId } from "@cvg/contracts";
import type { PostgresPersistence } from "@cvg/persistence";

export interface QueueSignals {
  outboxDepth: number;
  oldestAgeMs: number;
  poisonMessages: number;
  reconciliationLag: number;
  workerHeartbeatAgeMs: number;
  workerHeartbeatCount: number;
}
export type MetricsDependency = "READY" | "UNAVAILABLE" | "NOT_CONFIGURED";

export interface OperationalMetricsSnapshot {
  queueSignals: QueueSignals;
  outboxDependency: MetricsDependency;
}

/** Repository-facing read boundary for operational metrics. */
export class OperationalMetricsApplicationService {
  constructor(private readonly persistence: Pick<PostgresPersistence, "outboxStats" | "externalEffectStats" | "listWorkerHeartbeats" | "check"> | null) {}

  async read(context: CvgContext): Promise<OperationalMetricsSnapshot> {
    enforceApplicationPolicy(context, "metrics.read");
    return this.readScoped(context.organizationId);
  }

  /** Internal scrape is admitted by the runtime network route catalog. */
  async readInternal(organizationId: OpaqueId): Promise<OperationalMetricsSnapshot> {
    assertInternalMetricsPolicy(organizationId);
    return this.readScoped(organizationId);
  }

  private async readScoped(organizationId: OpaqueId): Promise<OperationalMetricsSnapshot> {
    const empty: OperationalMetricsSnapshot = {
      queueSignals: { outboxDepth: 0, oldestAgeMs: 0, poisonMessages: 0, reconciliationLag: 0, workerHeartbeatAgeMs: 0, workerHeartbeatCount: 0 },
      outboxDependency: this.persistence ? "UNAVAILABLE" : "NOT_CONFIGURED"
    };
    if (!this.persistence) return empty;
    try {
      const stats = await this.persistence.outboxStats(organizationId);
      const effectStats = await this.persistence.externalEffectStats(organizationId);
      const heartbeats = await this.persistence.listWorkerHeartbeats(organizationId);
      const workerHeartbeatAgeMs = heartbeats.length === 0
        ? 0
        : Math.max(...heartbeats.map((heartbeat) => Math.max(0, Date.now() - Date.parse(heartbeat.lastSeenAt))));
      return {
        queueSignals: {
          outboxDepth: stats.depth,
          oldestAgeMs: stats.oldestAgeMs,
          poisonMessages: stats.poisonMessages,
          reconciliationLag: effectStats.reconciliationRequired,
          workerHeartbeatAgeMs,
          workerHeartbeatCount: heartbeats.length
        },
        outboxDependency: "READY"
      };
    } catch {
      return empty;
    }
  }
}
