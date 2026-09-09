import type { CvgMetrics } from "@cvg/contracts";
import { randomUUID } from "node:crypto";

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

export type TelemetryAttribute = string | number | boolean | null;

export interface OtelSpan {
  traceId: string;
  spanId: string;
  name: string;
  startedAt: number;
  finishedAt: number;
  statusCode: number;
  attributes: Record<string, TelemetryAttribute>;
}

export interface TelemetryExporter {
  export(span: OtelSpan): void | Promise<void>;
}

export interface OpsTelemetryOptions {
  exporter?: TelemetryExporter;
  maxSpans?: number;
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
  readonly spans: OtelSpan[] = [];
  private readonly exporter: TelemetryExporter | null;
  private readonly maxSpans: number;
  private droppedSpans = 0;

  constructor(options: OpsTelemetryOptions = {}) {
    this.exporter = options.exporter ?? null;
    this.maxSpans = Math.max(1, Math.min(options.maxSpans ?? 500, 10_000));
  }

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

  startSpan(name: string, attributes: Record<string, TelemetryAttribute> = {}): { traceId: string; spanId: string; name: string; startedAt: number; attributes: Record<string, TelemetryAttribute> } {
    return { traceId: randomUUID(), spanId: randomUUID(), name, startedAt: Date.now(), attributes: this.redactAttributes(attributes) };
  }

  finishSpan(span: { traceId: string; spanId: string; name: string; startedAt: number; attributes: Record<string, TelemetryAttribute> }, statusCode: number): void {
    const finished: OtelSpan = { ...span, finishedAt: Date.now(), statusCode, attributes: this.redactAttributes(span.attributes) };
    if (this.spans.length >= this.maxSpans) {
      this.spans.shift();
      this.droppedSpans += 1;
    }
    this.spans.push(finished);
    if (this.exporter) {
      try {
        const result = this.exporter.export(finished);
        if (result instanceof Promise) void result.catch(() => { this.droppedSpans += 1; });
      } catch {
        this.droppedSpans += 1;
      }
    }
  }

  private redactAttributes(attributes: Record<string, TelemetryAttribute>): Record<string, TelemetryAttribute> {
    return Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, /password|secret|token|credential|prompt|content/i.test(key) ? "[REDACTED]" : value]));
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
      telemetry: { mode: "REDACTED_BEST_EFFORT", logsStored: this.logs.length, dropped: this.droppedSpans, duplicates: 0 }
    };
  }
}

export type SloId =
  | "API_AVAILABILITY"
  | "API_P95_LATENCY"
  | "LOGIN_LATENCY"
  | "PATIENT_LOOKUP_LATENCY"
  | "OUTBOX_PROCESSING_DELAY"
  | "MESSAGE_DELIVERY_ACK"
  | "RESTORE_RTO"
  | "RESTORE_RPO";

export type SloDirection = "MIN" | "MAX";
export type SloUnit = "ratio" | "milliseconds";

export interface SloDefinition {
  readonly id: SloId;
  readonly name: string;
  readonly target: number | null;
  readonly direction: SloDirection;
  readonly unit: SloUnit;
  readonly errorBudgetModel: "RATIO" | "NOT_DERIVED";
  readonly status: "PROPOSED";
  readonly source: string;
  readonly runbook: string;
}

/**
 * Initial targets from the operational design are proposals, not production
 * measurements. A null target is intentional when the source asks for a
 * metric but does not approve a number yet.
 */
export const PROPOSED_SLO_DEFINITIONS = [
  { id: "API_AVAILABILITY", name: "API availability", target: 0.999, direction: "MIN", unit: "ratio", errorBudgetModel: "RATIO", status: "PROPOSED", source: "docs/06-operacao-qualidade-e-recuperacao.md#targets-iniciais-propostos", runbook: "docs/runbooks/database-incident.md" },
  { id: "API_P95_LATENCY", name: "API p95 latency", target: 300, direction: "MAX", unit: "milliseconds", errorBudgetModel: "NOT_DERIVED", status: "PROPOSED", source: "docs/06-operacao-qualidade-e-recuperacao.md#targets-iniciais-propostos/PERF-01", runbook: "docs/runbooks/database-incident.md" },
  { id: "LOGIN_LATENCY", name: "Login latency", target: null, direction: "MAX", unit: "milliseconds", errorBudgetModel: "NOT_DERIVED", status: "PROPOSED", source: "docs/prompt-state-of-the-art-triplo-aaa.md#fase-20-slo-error-budget", runbook: "docs/runbooks/security-incident.md" },
  { id: "PATIENT_LOOKUP_LATENCY", name: "Patient lookup latency", target: null, direction: "MAX", unit: "milliseconds", errorBudgetModel: "NOT_DERIVED", status: "PROPOSED", source: "docs/prompt-state-of-the-art-triplo-aaa.md#fase-20-slo-error-budget", runbook: "docs/runbooks/database-incident.md" },
  { id: "OUTBOX_PROCESSING_DELAY", name: "Outbox processing delay", target: null, direction: "MAX", unit: "milliseconds", errorBudgetModel: "NOT_DERIVED", status: "PROPOSED", source: "docs/prompt-state-of-the-art-triplo-aaa.md#fase-20-slo-error-budget", runbook: "docs/runbooks/worker-backlog.md" },
  { id: "MESSAGE_DELIVERY_ACK", name: "Message delivery acknowledgement", target: null, direction: "MAX", unit: "milliseconds", errorBudgetModel: "NOT_DERIVED", status: "PROPOSED", source: "docs/prompt-state-of-the-art-triplo-aaa.md#fase-20-slo-error-budget", runbook: "docs/runbooks/provider-outage.md" },
  { id: "RESTORE_RTO", name: "Restore recovery time objective", target: 3_600_000, direction: "MAX", unit: "milliseconds", errorBudgetModel: "NOT_DERIVED", status: "PROPOSED", source: "docs/06-operacao-qualidade-e-recuperacao.md#targets-iniciais-propostos/REL-02", runbook: "docs/runbooks/restore.md" },
  { id: "RESTORE_RPO", name: "Restore recovery point objective", target: 300_000, direction: "MAX", unit: "milliseconds", errorBudgetModel: "NOT_DERIVED", status: "PROPOSED", source: "docs/06-operacao-qualidade-e-recuperacao.md#targets-iniciais-propostos/REL-02", runbook: "docs/runbooks/restore.md" }
] as const satisfies readonly SloDefinition[];

export type SloEvidenceStatus = "MEASURED" | "NOT_RUN";

export interface SloObservation {
  readonly value: number | null;
  readonly sampleCount: number;
  readonly evidence: SloEvidenceStatus;
  readonly environment: "synthetic" | "production-like";
  readonly observedAt: string;
}

export type SloEvaluationStatus = "PASS" | "BREACH" | "NOT_RUN";

export interface SloEvaluation {
  readonly sloId: SloId;
  readonly status: SloEvaluationStatus;
  readonly target: number | null;
  readonly observedValue: number | null;
  readonly sampleCount: number;
  readonly errorBudgetConsumedRatio: number | null;
  readonly errorBudgetRemainingRatio: number | null;
  readonly reason: "pass" | "target_breached" | "target_tbd" | "observation_not_run" | "no_sample" | "invalid_observation";
}

function notRunEvaluation(definition: SloDefinition, observation: SloObservation, reason: SloEvaluation["reason"]): SloEvaluation {
  return {
    sloId: definition.id,
    status: "NOT_RUN",
    target: definition.target,
    observedValue: observation.value,
    sampleCount: observation.sampleCount,
    errorBudgetConsumedRatio: null,
    errorBudgetRemainingRatio: null,
    reason
  };
}

/**
 * Evaluate an explicit observation without treating local telemetry as a
 * production claim. No sample, TBD target or non-measured evidence fails
 * closed to NOT_RUN.
 */
export function evaluateSlo(definition: SloDefinition, observation: SloObservation): SloEvaluation {
  if (definition.target === null) return notRunEvaluation(definition, observation, "target_tbd");
  if (observation.evidence !== "MEASURED") return notRunEvaluation(definition, observation, "observation_not_run");
  if (!Number.isInteger(observation.sampleCount) || observation.sampleCount <= 0) return notRunEvaluation(definition, observation, "no_sample");
  if (observation.value === null || !Number.isFinite(observation.value)) return notRunEvaluation(definition, observation, "invalid_observation");

  const passes = definition.direction === "MIN" ? observation.value >= definition.target : observation.value <= definition.target;
  let errorBudgetConsumedRatio: number | null = null;
  let errorBudgetRemainingRatio: number | null = null;
  if (definition.errorBudgetModel === "RATIO") {
    const budget = definition.direction === "MIN" ? 1 - definition.target : Math.max(Math.abs(definition.target), 1);
    errorBudgetConsumedRatio = budget > 0 ? Math.max(0, (definition.target - observation.value) / budget) : passes ? 0 : Number.POSITIVE_INFINITY;
    errorBudgetRemainingRatio = Math.max(0, Math.min(1, 1 - errorBudgetConsumedRatio));
  }

  return {
    sloId: definition.id,
    status: passes ? "PASS" : "BREACH",
    target: definition.target,
    observedValue: observation.value,
    sampleCount: observation.sampleCount,
    errorBudgetConsumedRatio,
    errorBudgetRemainingRatio,
    reason: passes ? "pass" : "target_breached"
  };
}

export type SloAlertCondition = "BREACH" | "BUDGET_REMAINING_BELOW";
export type SloAlertSeverity = "WARNING" | "CRITICAL";

export interface SloAlertRule {
  readonly id: string;
  readonly sloId: SloId;
  readonly condition: SloAlertCondition;
  readonly threshold: number | null;
  readonly severity: SloAlertSeverity;
  readonly status: "PROPOSED";
  readonly runbook: string;
}

export const PROPOSED_SLO_ALERT_RULES = [
  { id: "SLO-ALERT-API-AVAILABILITY-BREACH", sloId: "API_AVAILABILITY", condition: "BREACH", threshold: null, severity: "CRITICAL", status: "PROPOSED", runbook: "docs/runbooks/database-incident.md" },
  { id: "SLO-ALERT-API-AVAILABILITY-BUDGET", sloId: "API_AVAILABILITY", condition: "BUDGET_REMAINING_BELOW", threshold: 0.5, severity: "WARNING", status: "PROPOSED", runbook: "docs/runbooks/database-incident.md" },
  { id: "SLO-ALERT-OUTBOX-BREACH", sloId: "OUTBOX_PROCESSING_DELAY", condition: "BREACH", threshold: null, severity: "WARNING", status: "PROPOSED", runbook: "docs/runbooks/worker-backlog.md" },
  { id: "SLO-ALERT-RESTORE-RTO-BREACH", sloId: "RESTORE_RTO", condition: "BREACH", threshold: null, severity: "CRITICAL", status: "PROPOSED", runbook: "docs/runbooks/restore.md" }
] as const satisfies readonly SloAlertRule[];

export type SloAlertStatus = "OK" | "ALERT" | "NOT_RUN";

export interface SloAlertEvaluation {
  readonly ruleId: string;
  readonly sloId: SloId;
  readonly status: SloAlertStatus;
  readonly severity: SloAlertSeverity;
  readonly runbook: string;
  readonly reason: "condition_clear" | "slo_breached" | "budget_low" | "evaluation_not_run" | "budget_not_available" | "rule_invalid";
}

/** Alert evaluation is pure and deterministic; dispatch belongs to an approved collector. */
export function evaluateSloAlerts(evaluations: readonly SloEvaluation[], rules: readonly SloAlertRule[] = PROPOSED_SLO_ALERT_RULES): SloAlertEvaluation[] {
  const bySlo = new Map(evaluations.map((evaluation) => [evaluation.sloId, evaluation]));
  return rules.map((rule) => {
    const evaluation = bySlo.get(rule.sloId);
    if (!evaluation || evaluation.status === "NOT_RUN") return { ruleId: rule.id, sloId: rule.sloId, status: "NOT_RUN", severity: rule.severity, runbook: rule.runbook, reason: "evaluation_not_run" };
    if (rule.condition === "BREACH") {
      return { ruleId: rule.id, sloId: rule.sloId, status: evaluation.status === "BREACH" ? "ALERT" : "OK", severity: rule.severity, runbook: rule.runbook, reason: evaluation.status === "BREACH" ? "slo_breached" : "condition_clear" };
    }
    if (rule.threshold === null || !Number.isFinite(rule.threshold) || evaluation.errorBudgetRemainingRatio === null) return { ruleId: rule.id, sloId: rule.sloId, status: "NOT_RUN", severity: rule.severity, runbook: rule.runbook, reason: rule.threshold === null || !Number.isFinite(rule.threshold) ? "rule_invalid" : "budget_not_available" };
    const low = evaluation.errorBudgetRemainingRatio <= rule.threshold;
    return { ruleId: rule.id, sloId: rule.sloId, status: low ? "ALERT" : "OK", severity: rule.severity, runbook: rule.runbook, reason: low ? "budget_low" : "condition_clear" };
  });
}
