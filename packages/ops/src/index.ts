import type { CvgMetrics } from "@cvg/contracts";

export interface MetricsSignals {
  dependencies?: Partial<CvgMetrics["dependencies"]>;
  domain?: Partial<CvgMetrics["domain"]>;
  queues?: Partial<CvgMetrics["queues"]>;
}

export interface RedactedLog {
  timestamp: string;
  level: "info" | "warn" | "error";
  event: string;
  correlationId: string;
  actorId: string | null;
  metadata: Record<string, string | number | boolean | null>;
}

export class OpsTelemetry {
  private readonly latencies: number[] = [];
  private requestsTotal = 0;
  private requestsDenied = 0;
  private requestsError = 0;
  private activeSessions = 0;
  private readonly operations = new Map<string, number>();
  private readonly statusCodes = new Map<string, number>();
  readonly logs: RedactedLog[] = [];

  requestStarted(): number {
    this.requestsTotal += 1;
    return Date.now();
  }

  requestFinished(startedAt: number, statusCode: number, operation = "unknown"): void {
    this.latencies.push(Math.max(0, Date.now() - startedAt));
    if (statusCode === 401 || statusCode === 403) this.requestsDenied += 1;
    if (statusCode >= 500) this.requestsError += 1;
    this.operations.set(operation, (this.operations.get(operation) ?? 0) + 1);
    const statusFamily = `${Math.floor(statusCode / 100)}xx`;
    this.statusCodes.set(statusFamily, (this.statusCodes.get(statusFamily) ?? 0) + 1);
  }

  sessionOpened(): void { this.activeSessions += 1; }
  sessionClosed(): void { this.activeSessions = Math.max(0, this.activeSessions - 1); }

  log(entry: RedactedLog): void {
    const sanitized = { ...entry, metadata: Object.fromEntries(Object.entries(entry.metadata).map(([key, value]) => [key, /password|secret|token|credential|prompt/i.test(key) ? "[REDACTED]" : value])) };
    this.logs.push(sanitized);
  }

  metrics(storageMode: "memory" | "postgres", signals: MetricsSignals = {}): CvgMetrics {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const percentile = (ratio: number): number => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))] ?? 0 : 0;
    const dependencies: CvgMetrics["dependencies"] = {
      database: storageMode === "postgres" ? "READY" : "NOT_CONFIGURED",
      policyStore: "READY",
      secretProvider: "DEGRADED",
      outbox: "NOT_CONFIGURED",
      auditLedger: storageMode === "postgres" ? "READY" : "DEGRADED",
      ...signals.dependencies
    };
    const domain: CvgMetrics["domain"] = {
      auditRecords: 0,
      commandReceipts: 0,
      unlinkedReceipts: 0,
      outcomeUnknown: 0,
      quarantined: 0,
      ...signals.domain
    };
    const queues: CvgMetrics["queues"] = { outboxDepth: 0, oldestAgeMs: 0, poisonMessages: 0, reconciliationLag: 0, ...signals.queues };
    return {
      requestsTotal: this.requestsTotal,
      requestsDenied: this.requestsDenied,
      requestsError: this.requestsError,
      latencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) },
      activeSessions: this.activeSessions,
      storageMode,
      operations: Object.fromEntries(this.operations),
      statusCodes: Object.fromEntries(this.statusCodes),
      dependencies,
      domain,
      queues,
      telemetry: { mode: "REDACTED_BEST_EFFORT", logsStored: this.logs.length, dropped: 0, duplicates: 0 }
    };
  }
}
