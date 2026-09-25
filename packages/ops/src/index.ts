import type { CvgMetrics } from "@cvg/contracts";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeSync, closeSync, fsyncSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export interface MetricsSignals {
  dependencies?: Partial<CvgMetrics["dependencies"]>;
  domain?: Partial<CvgMetrics["domain"]>;
  queues?: Partial<CvgMetrics["queues"]>;
  agentRuntime?: CvgMetrics["agentRuntime"];
}

export interface RedactedLog {
  timestamp: string;
  level: "info" | "warn" | "error";
  event: string;
  correlationId: string;
  actorId: string | null;
  metadata: Record<string, string | number | boolean | null>;
  requestId?: string | null;
  traceId?: string | null;
  jobId?: string | null;
  operation?: string;
  outcome?: string | null;
}

export type TelemetryAttribute = string | number | boolean | null;

/** Stable correlation contract carried across HTTP, AI, worker and provider boundaries. */
export interface TelemetryCorrelationContext {
  requestId: string | null;
  correlationId: string | null;
  sessionId: string | null;
  toolInvocationId: string | null;
  jobId: string | null;
  outboxId: string | null;
  providerRequestId: string | null;
}

export type SpanEndReason = "response" | "error" | "abort" | "timeout" | "disconnect";
export type TelemetrySpanStatus = "OK" | "ERROR" | "CANCELLED" | "DEADLINE_EXCEEDED" | "DISCONNECTED";

export const TELEMETRY_BUDGETS = Object.freeze({
  maxOperations: 256,
  maxAgentCounters: 256,
  maxStatusCodes: 32,
  maxAttributes: 24,
  maxMetadataFields: 24,
  maxLabelLength: 96,
  maxValueLength: 256
});

const sensitiveKeyPattern = /(?:password|secret|token|credential|authorization|cookie|api[_-]?key|private[_-]?key|prompt|content|payload|body|query|url|uri|email|phone|address|patient|guardian|clinical)/i;
const secretValuePattern = /(?:bearer\s+|(?:password|secret|token|api[_-]?key|authorization)\s*[:=]\s*)[^\s,;]+/gi;

/**
 * A label is an operator-facing dimension, not a copy of user input. Keep the
 * character set and length bounded before it reaches a map, span or log.
 */
export function boundedTelemetryLabel(value: string, maximum = TELEMETRY_BUDGETS.maxLabelLength): string {
  // eslint-disable-next-line no-control-regex -- control bytes are deliberately scrubbed at the telemetry boundary.
  const bounded = value.trim().replace(/[\u0000-\u001f\u007f]/g, "_").slice(0, Math.max(1, maximum));
  return bounded || "unknown";
}

function boundedIdentifier(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length <= TELEMETRY_BUDGETS.maxLabelLength && /^[A-Za-z0-9_.:-]+$/.test(normalized)) return normalized;
  return `hash:${createHash("sha256").update(normalized).digest("hex").slice(0, 24)}`;
}

/** Remove queries/fragments and replace identifier-like path segments. */
export function normalizeTelemetryOperation(value: string): string {
  const input = boundedTelemetryLabel(value).replace(/[?#].*$/, "");
  const methodMatch = /^([A-Za-z]+)\s+(.+)$/.exec(input);
  if (!methodMatch) return input.replace(/[^A-Za-z0-9_.:/-]/g, "_").slice(0, TELEMETRY_BUDGETS.maxLabelLength) || "unknown";
  const method = methodMatch[1]!.toUpperCase().slice(0, 16);
  const path = methodMatch[2]!.split(/[?#]/, 1)[0] ?? "/";
  const normalizedPath = path
    .split("/")
    .map((segment) => {
      if (!segment) return "";
      if (/^:[A-Za-z0-9_-]+$/.test(segment) || /^\{[A-Za-z0-9_-]+\}$/.test(segment)) return ":param";
      if (/^\d+$/.test(segment) || /^[0-9a-f]{16,}$/i.test(segment) || /^[0-9a-f]{8}-[0-9a-f-]{13,}$/i.test(segment) || segment.length > 32) return ":id";
      return segment.replace(/[^A-Za-z0-9_.~-]/g, "_").slice(0, 32);
    })
    .join("/") || "/";
  return `${method} ${normalizedPath}`.slice(0, TELEMETRY_BUDGETS.maxLabelLength);
}

const sensitiveMetricOperationSegment = /(?:password|secret|token|authorization|private[_-]?key|raw[_-]?response|provider[_-]?(?:body|error)|access[_-]?token|refresh[_-]?token|api[_-]?key|credential)/i;

/** Keep useful route aggregates while preventing sensitive route names from becoming map keys. */
function redactedMetricOperations(operations: ReadonlyMap<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [operation, count] of operations) {
    const match = /^([A-Z]+)\s+(.+)$/.exec(operation);
    const label = match
      ? `${match[1]} ${match[2]!.split("/").map((segment) => sensitiveMetricOperationSegment.test(segment) ? ":redacted" : segment).join("/")}`
      : sensitiveMetricOperationSegment.test(operation) ? "redacted" : operation;
    result[label] = (result[label] ?? 0) + count;
  }
  return result;
}

export function correlationAttributes(context: TelemetryCorrelationContext): Record<string, TelemetryAttribute> {
  return {
    requestId: boundedIdentifier(context.requestId),
    correlationId: boundedIdentifier(context.correlationId),
    sessionId: boundedIdentifier(context.sessionId),
    toolInvocationId: boundedIdentifier(context.toolInvocationId),
    jobId: boundedIdentifier(context.jobId),
    outboxId: boundedIdentifier(context.outboxId),
    providerRequestId: boundedIdentifier(context.providerRequestId)
  };
}

export interface OtelSpan {
  traceId: string;
  spanId: string;
  name: string;
  startedAt: number;
  finishedAt: number;
  statusCode: number;
  status: TelemetrySpanStatus;
  endReason: SpanEndReason;
  attributes: Record<string, TelemetryAttribute>;
}

export interface OtelSpanStart {
  traceId: string;
  spanId: string;
  name: string;
  startedAt: number;
  attributes: Record<string, TelemetryAttribute>;
}

export interface TelemetryExporter {
  export(span: OtelSpan): void | Promise<void>;
  /** Optional hook for exporters that can preserve the real provider IDs. */
  startSpan?(span: OtelSpanStart): { traceId: string; spanId: string } | void;
  /** Optional hook for exporters that own the span lifecycle. */
  finishSpan?(span: OtelSpan): void;
}

export interface DurableLogSink {
  append(entry: RedactedLog): void | Promise<void>;
  flush?(): void | Promise<void>;
  close?(): void | Promise<void>;
}

export interface FileDurableLogSinkOptions {
  path: string;
  maxBytes?: number;
  retentionMs?: number;
  maxBackups?: number;
  fsync?: boolean;
}

export interface DurableLogSinkStats {
  readonly path: string;
  readonly writes: number;
  readonly rotated: number;
  readonly failures: number;
}

/**
 * Small local append-only NDJSON sink for synthetic drills and explicitly
 * configured worker operation. It rotates only its own file and fsyncs each
 * record by default; it is not a substitute for an approved log platform.
 */
export class FileDurableLogSink implements DurableLogSink {
  private readonly path: string;
  private readonly maxBytes: number;
  private readonly retentionMs: number;
  private readonly maxBackups: number;
  private readonly fsync: boolean;
  private rotation = 0;
  private writes = 0;
  private rotated = 0;
  private failures = 0;

  constructor(options: FileDurableLogSinkOptions) {
    if (!options.path.trim()) throw new Error("durable log path is required");
    this.path = options.path;
    this.maxBytes = Math.max(256, Math.trunc(options.maxBytes ?? 8 * 1024 * 1024));
    this.retentionMs = Math.max(1_000, Math.trunc(options.retentionMs ?? 7 * 24 * 60 * 60 * 1_000));
    this.maxBackups = Math.max(1, Math.min(128, Math.trunc(options.maxBackups ?? 7)));
    this.fsync = options.fsync ?? true;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    chmodSync(dirname(this.path), 0o700);
    if (existsSync(this.path)) chmodSync(this.path, 0o600);
  }

  append(entry: RedactedLog): void {
    const line = `${JSON.stringify(entry)}\n`;
    try {
      this.rotateIfNeeded(Buffer.byteLength(line, "utf8"));
      const descriptor = openSync(this.path, "a", 0o600);
      try {
        writeSync(descriptor, line, undefined, "utf8");
        if (this.fsync) fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      chmodSync(this.path, 0o600);
      this.writes += 1;
      this.prune();
    } catch (error) {
      this.failures += 1;
      throw error;
    }
  }

  flush(): void {}
  close(): void {}

  stats(): DurableLogSinkStats {
    return { path: this.path, writes: this.writes, rotated: this.rotated, failures: this.failures };
  }

  private rotateIfNeeded(nextBytes: number): void {
    let currentBytes = 0;
    try { currentBytes = statSync(this.path).size; } catch { currentBytes = 0; }
    if (currentBytes === 0 || currentBytes + nextBytes <= this.maxBytes) return;
    const rotatedPath = `${this.path}.${Date.now()}-${this.rotation++}.jsonl`;
    renameSync(this.path, rotatedPath);
    chmodSync(rotatedPath, 0o600);
    this.rotated += 1;
  }

  private prune(): void {
    const directory = dirname(this.path);
    const prefix = `${basename(this.path)}.`;
    const cutoff = Date.now() - this.retentionMs;
    const candidates = readdirSync(directory)
      .filter((name) => name.startsWith(prefix) && name.endsWith(".jsonl"))
      .map((name) => {
        const candidate = join(directory, name);
        try { return { path: candidate, mtimeMs: statSync(candidate).mtimeMs }; } catch { return null; }
      })
      .filter((candidate): candidate is { path: string; mtimeMs: number } => candidate !== null)
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
    candidates.slice(this.maxBackups).forEach((candidate) => { try { unlinkSync(candidate.path); } catch { /* best effort retention cleanup */ } });
    candidates.filter((candidate) => candidate.mtimeMs < cutoff).forEach((candidate) => { try { unlinkSync(candidate.path); } catch { /* best effort retention cleanup */ } });
  }
}

export function readDurableLogFile(path: string): RedactedLog[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as RedactedLog);
}

export interface OpsTelemetryOptions {
  exporter?: TelemetryExporter;
  maxSpans?: number;
  maxLatencies?: number;
  maxLogs?: number;
  maxOperations?: number;
  maxAgentCounters?: number;
  maxStatusCodes?: number;
  maxAttributes?: number;
  maxMetadataFields?: number;
  durableLogSink?: DurableLogSink;
  maxPendingLogWrites?: number;
  telemetryMode?: CvgMetrics["telemetry"]["mode"];
}

/**
 * Fixed-capacity sliding window. Retention is bounded by construction, so
 * metrics never sort a lifetime history and memory cannot grow with traffic;
 * discards are counted instead of silently dropped.
 */
class BoundedBuffer<T> {
  private readonly items: T[] = [];
  private cursor = 0;
  dropped = 0;

  constructor(private readonly capacity: number) {}

  push(value: T): void {
    if (this.items.length < this.capacity) {
      this.items.push(value);
      return;
    }
    this.items[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.dropped += 1;
  }

  snapshot(): T[] {
    if (this.items.length < this.capacity || this.cursor === 0) return [...this.items];
    return [...this.items.slice(this.cursor), ...this.items.slice(0, this.cursor)];
  }

  get size(): number {
    return this.items.length;
  }
}

const clamp = (value: number | undefined, fallback: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(Math.floor(value ?? fallback), maximum));

export class OpsTelemetry {
  private readonly latencies: BoundedBuffer<number>;
  private readonly logBuffer: BoundedBuffer<RedactedLog>;
  private readonly spanBuffer: BoundedBuffer<OtelSpan>;
  private readonly completedSpanBudget: number;
  private readonly maxOperations: number;
  private readonly maxAgentCounters: number;
  private readonly maxStatusCodes: number;
  private readonly maxAttributes: number;
  private readonly maxMetadataFields: number;
  private readonly maxPendingLogWrites: number;
  private readonly durableLogSink: DurableLogSink | null;
  private requestsTotal = 0;
  private requestsDenied = 0;
  private requestsError = 0;
  private activeSessions = 0;
  private readonly operations = new Map<string, number>();
  private readonly agentCounters = new Map<string, number>();
  private readonly statusCodes = new Map<string, number>();
  private readonly openSpans = new Set<string>();
  private readonly pendingLogWrites = new Set<Promise<void>>();
  private readonly exporter: TelemetryExporter | null;
  private readonly telemetryMode: CvgMetrics["telemetry"]["mode"];
  private droppedSpans = 0;
  private duplicateSpanFinishes = 0;
  private startedSpanCount = 0;
  private finishedSpanCount = 0;
  private operationOverflow = 0;
  private agentCounterOverflow = 0;
  private statusCodeOverflow = 0;
  private metadataOverflow = 0;
  private durableLogFailures = 0;

  constructor(options: OpsTelemetryOptions = {}) {
    this.exporter = options.exporter ?? null;
    this.completedSpanBudget = clamp(options.maxSpans, 500, 1, 10_000);
    this.maxOperations = clamp(options.maxOperations, TELEMETRY_BUDGETS.maxOperations, 1, 2_048);
    this.maxAgentCounters = clamp(options.maxAgentCounters, TELEMETRY_BUDGETS.maxAgentCounters, 1, 2_048);
    this.maxStatusCodes = clamp(options.maxStatusCodes, TELEMETRY_BUDGETS.maxStatusCodes, 1, 128);
    this.maxAttributes = clamp(options.maxAttributes, TELEMETRY_BUDGETS.maxAttributes, 1, 128);
    this.maxMetadataFields = clamp(options.maxMetadataFields, TELEMETRY_BUDGETS.maxMetadataFields, 1, 128);
    this.maxPendingLogWrites = clamp(options.maxPendingLogWrites, 128, 1, 1_024);
    this.durableLogSink = options.durableLogSink ?? null;
    this.spanBuffer = new BoundedBuffer<OtelSpan>(this.completedSpanBudget);
    this.latencies = new BoundedBuffer<number>(clamp(options.maxLatencies, 2_048, 16, 65_536));
    this.logBuffer = new BoundedBuffer<RedactedLog>(clamp(options.maxLogs, 500, 16, 10_000));
    this.telemetryMode = options.telemetryMode ?? "REDACTED_BEST_EFFORT";
  }

  /** Bounded, most-recent-first-free window access used by tests and diagnostics. */
  get logs(): RedactedLog[] {
    return this.logBuffer.snapshot();
  }

  get spans(): OtelSpan[] {
    return this.spanBuffer.snapshot();
  }

  get latencySamples(): number {
    return this.latencies.size;
  }

  get openSpanCount(): number {
    return this.openSpans.size;
  }

  get lifecycle(): { started: number; finished: number; duplicateFinishes: number; open: number } {
    return { started: this.startedSpanCount, finished: this.finishedSpanCount, duplicateFinishes: this.duplicateSpanFinishes, open: this.openSpans.size };
  }

  get cardinality(): {
    operations: number;
    operationBudget: number;
    operationOverflow: number;
    agentCounters: number;
    agentCounterBudget: number;
    agentCounterOverflow: number;
    statusCodes: number;
    statusCodeBudget: number;
    statusCodeOverflow: number;
    metadataOverflow: number;
  } {
    return {
      operations: this.operations.size,
      operationBudget: this.maxOperations,
      operationOverflow: this.operationOverflow,
      agentCounters: this.agentCounters.size,
      agentCounterBudget: this.maxAgentCounters,
      agentCounterOverflow: this.agentCounterOverflow,
      statusCodes: this.statusCodes.size,
      statusCodeBudget: this.maxStatusCodes,
      statusCodeOverflow: this.statusCodeOverflow,
      metadataOverflow: this.metadataOverflow
    };
  }

  requestStarted(): number {
    this.requestsTotal += 1;
    return Date.now();
  }

  requestFinished(startedAt: number, statusCode: number, operation = "unknown"): void {
    const durationMs = Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : 0;
    this.latencies.push(durationMs);
    if (statusCode === 401 || statusCode === 403) this.requestsDenied += 1;
    if (statusCode >= 500) this.requestsError += 1;
    this.incrementBoundedMap(this.operations, normalizeTelemetryOperation(operation), this.maxOperations, "operation");
    const statusFamily = `${Math.floor(statusCode / 100)}xx`;
    this.incrementBoundedMap(this.statusCodes, statusFamily, this.maxStatusCodes, "statusCode");
  }

  /**
   * Redacted agent-runtime counters (kill switches, denials, kernel events).
   * Metric names are sanitized to a bounded charset and never carry tenant,
   * actor or resource identifiers.
   */
  increment(metric: string, value = 1): void {
    const safe = metric.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 80);
    if (!safe || !Number.isFinite(value)) return;
    this.incrementBoundedMap(this.agentCounters, safe, this.maxAgentCounters, "agentCounter", value);
  }

  sessionOpened(): void { this.activeSessions += 1; }
  sessionClosed(): void { this.activeSessions = Math.max(0, this.activeSessions - 1); }

  log(entry: RedactedLog): void {
    const sanitized = this.redactLog(entry);
    this.logBuffer.push(sanitized);
    if (!this.durableLogSink) return;
    if (this.pendingLogWrites.size >= this.maxPendingLogWrites) {
      this.durableLogFailures += 1;
      return;
    }
    try {
      const result = this.durableLogSink.append(sanitized);
      if (result instanceof Promise) {
        const pending = result.then(() => undefined, () => { this.durableLogFailures += 1; });
        this.pendingLogWrites.add(pending);
        void pending.finally(() => this.pendingLogWrites.delete(pending));
      }
    } catch {
      this.durableLogFailures += 1;
    }
  }

  logCorrelated(input: {
    context: TelemetryCorrelationContext;
    event: string;
    level?: RedactedLog["level"];
    metadata?: Record<string, string | number | boolean | null>;
    actorId?: string | null;
    traceId?: string | null;
    outcome?: string;
  }): void {
    const context = input.context;
    this.log({
      timestamp: new Date().toISOString(),
      level: input.level ?? "info",
      event: input.event,
      correlationId: context.correlationId ?? context.requestId ?? "unknown",
      actorId: input.actorId ?? null,
      metadata: input.metadata ?? {},
      requestId: context.requestId,
      traceId: input.traceId ?? null,
      jobId: context.jobId ?? context.outboxId,
      operation: input.event,
      outcome: input.outcome ?? null
    });
  }

  startSpan(name: string, attributes: Record<string, TelemetryAttribute> = {}): OtelSpanStart {
    const started: OtelSpanStart = { traceId: randomUUID(), spanId: randomUUID(), name: normalizeTelemetryOperation(name), startedAt: Date.now(), attributes: this.redactAttributes(attributes) };
    if (this.exporter?.startSpan) {
      try {
        const externalIds = this.exporter.startSpan(started);
        if (externalIds) {
          started.traceId = externalIds.traceId;
          started.spanId = externalIds.spanId;
        }
      } catch {
        this.droppedSpans += 1;
      }
    }
    this.openSpans.add(started.spanId);
    this.startedSpanCount += 1;
    return started;
  }

  startCorrelatedSpan(name: string, context: TelemetryCorrelationContext, attributes: Record<string, TelemetryAttribute> = {}) {
    return this.startSpan(name, { ...correlationAttributes(context), ...attributes });
  }

  finishSpan(span: OtelSpanStart, statusCode: number, reason?: SpanEndReason): void {
    if (!this.openSpans.delete(span.spanId)) {
      this.duplicateSpanFinishes += 1;
      return;
    }
    this.finishedSpanCount += 1;
    const endReason = reason ?? defaultSpanEndReason(statusCode);
    const finished: OtelSpan = {
      ...span,
      name: normalizeTelemetryOperation(span.name),
      finishedAt: Date.now(),
      statusCode: Number.isSafeInteger(statusCode) ? statusCode : 500,
      status: spanStatus(endReason, statusCode),
      endReason,
      attributes: { ...this.redactAttributes(span.attributes), "cvg.span.end_reason": endReason }
    };
    this.spanBuffer.push(finished);
    if (this.exporter) {
      try {
        if (this.exporter.finishSpan) {
          this.exporter.finishSpan(finished);
        } else {
          const result = this.exporter.export(finished);
          if (result instanceof Promise) void result.catch(() => { this.droppedSpans += 1; });
        }
      } catch {
        this.droppedSpans += 1;
      }
    }
  }

  private redactAttributes(attributes: Record<string, TelemetryAttribute>): Record<string, TelemetryAttribute> {
    const result: Record<string, TelemetryAttribute> = {};
    for (const [rawKey, rawValue] of Object.entries(attributes)) {
      if (Object.keys(result).length >= this.maxAttributes) {
        this.metadataOverflow += 1;
        break;
      }
      // eslint-disable-next-line no-control-regex -- metadata keys are scrubbed before bounded storage.
      const key = rawKey.replace(/[\u0000-\u001f\u007f]/g, "_").slice(0, 64) || "attribute";
      const value = key === "route" || key === "http.route" || key === "operation"
        ? (typeof rawValue === "string" ? normalizeTelemetryOperation(rawValue) : rawValue)
        : redactTelemetryValue(key, rawValue);
      result[key] = value;
    }
    return result;
  }

  private redactLog(entry: RedactedLog): RedactedLog {
    const metadata: Record<string, string | number | boolean | null> = {};
    for (const [rawKey, rawValue] of Object.entries(entry.metadata ?? {})) {
      if (Object.keys(metadata).length >= this.maxMetadataFields) {
        this.metadataOverflow += 1;
        break;
      }
      // eslint-disable-next-line no-control-regex -- metadata keys are scrubbed before durable logging.
      const key = rawKey.replace(/[\u0000-\u001f\u007f]/g, "_").slice(0, 64) || "field";
      metadata[key] = redactTelemetryValue(key, rawValue);
    }
    const sanitized: RedactedLog = {
      timestamp: entry.timestamp,
      level: entry.level,
      event: normalizeTelemetryOperation(entry.event),
      correlationId: boundedIdentifier(entry.correlationId) ?? "unknown",
      actorId: boundedIdentifier(entry.actorId),
      metadata
    };
    if (entry.requestId !== undefined) sanitized.requestId = boundedIdentifier(entry.requestId);
    if (entry.traceId !== undefined) sanitized.traceId = boundedIdentifier(entry.traceId);
    if (entry.jobId !== undefined) sanitized.jobId = boundedIdentifier(entry.jobId);
    if (entry.operation !== undefined) sanitized.operation = normalizeTelemetryOperation(entry.operation);
    if (entry.outcome !== undefined) sanitized.outcome = redactTelemetryValue("outcome", entry.outcome) as string | null;
    return sanitized;
  }

  private incrementBoundedMap(map: Map<string, number>, key: string, maximum: number, kind: "operation" | "agentCounter" | "statusCode", value = 1): void {
    if (map.has(key)) {
      map.set(key, (map.get(key) ?? 0) + value);
      return;
    }
    const overflowKey = "__overflow__";
    if (maximum > 1 && map.size < maximum - 1) {
      map.set(key, value);
      return;
    }
    map.set(overflowKey, (map.get(overflowKey) ?? 0) + value);
    if (kind === "operation") this.operationOverflow += 1;
    if (kind === "agentCounter") this.agentCounterOverflow += 1;
    if (kind === "statusCode") this.statusCodeOverflow += 1;
  }

  async flush(): Promise<void> {
    await Promise.all([...this.pendingLogWrites]);
    await this.durableLogSink?.flush?.();
  }

  async close(): Promise<void> {
    await this.flush();
    await this.durableLogSink?.close?.();
  }

  metrics(storageMode: "memory" | "postgres", signals: MetricsSignals = {}): CvgMetrics {
    const sorted = this.latencies.snapshot().sort((a, b) => a - b);
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
    const queues: CvgMetrics["queues"] = { outboxDepth: 0, oldestAgeMs: 0, poisonMessages: 0, reconciliationLag: 0, workerHeartbeatAgeMs: 0, workerHeartbeatCount: 0, ...signals.queues };
    return {
      requestsTotal: this.requestsTotal,
      requestsDenied: this.requestsDenied,
      requestsError: this.requestsError,
      latencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) },
      activeSessions: this.activeSessions,
      storageMode,
      operations: redactedMetricOperations(this.operations),
      agentCounters: Object.fromEntries(this.agentCounters),
      statusCodes: Object.fromEntries(this.statusCodes),
      dependencies,
      domain,
      queues,
      agentRuntime: signals.agentRuntime ?? "UNAVAILABLE",
      telemetry: {
        mode: this.telemetryMode,
        logsStored: this.logBuffer.size,
        dropped: this.droppedSpans + this.spanBuffer.dropped + this.latencies.dropped + this.logBuffer.dropped + this.operationOverflow + this.agentCounterOverflow + this.statusCodeOverflow + this.metadataOverflow + this.durableLogFailures,
        duplicates: this.duplicateSpanFinishes
      }
    };
  }
}

function redactTelemetryValue(key: string, value: TelemetryAttribute): TelemetryAttribute {
  if (sensitiveKeyPattern.test(key)) return "[REDACTED]";
  if (typeof value !== "string") return value;
  // eslint-disable-next-line no-control-regex -- values are scrubbed before redaction and persistence.
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, "_").replace(secretValuePattern, "[REDACTED]");
  return normalized.slice(0, TELEMETRY_BUDGETS.maxValueLength);
}

function defaultSpanEndReason(statusCode: number): SpanEndReason {
  if (statusCode === 408 || statusCode === 504) return "timeout";
  if (statusCode === 499) return "disconnect";
  return statusCode >= 500 ? "error" : "response";
}

function spanStatus(reason: SpanEndReason, statusCode: number): TelemetrySpanStatus {
  if (reason === "abort") return "CANCELLED";
  if (reason === "timeout") return "DEADLINE_EXCEEDED";
  if (reason === "disconnect") return "DISCONNECTED";
  return reason === "error" || statusCode >= 500 ? "ERROR" : "OK";
}

export class SpanLifecycleError extends Error {
  readonly reason: Exclude<SpanEndReason, "response" | "error">;
  readonly statusCode: number;

  constructor(reason: Exclude<SpanEndReason, "response" | "error">, statusCode: number, message: string) {
    super(message);
    this.name = "SpanLifecycleError";
    this.reason = reason;
    this.statusCode = statusCode;
  }
}

export interface SpanLifecycleOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  disconnect?: PromiseLike<unknown>;
  successStatusCode?: number;
}

/**
 * Runs one operation under one server span. Cancellation sources finish the
 * span immediately; a later response/error cannot finish it a second time.
 */
export async function runWithSpanLifecycle<T>(
  telemetry: OpsTelemetry,
  name: string,
  context: TelemetryCorrelationContext,
  operation: (signal: AbortSignal) => Promise<T>,
  options: SpanLifecycleOptions = {}
): Promise<T> {
  const span = telemetry.startCorrelatedSpan(name, context);
  const controller = new AbortController();
  let terminalReason: SpanEndReason | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectCancellation: ((error: SpanLifecycleError) => void) | undefined;
  const cancellation = new Promise<never>((_, reject) => { rejectCancellation = reject; });

  const cancel = (reason: Exclude<SpanEndReason, "response" | "error">, statusCode: number, message: string): void => {
    if (terminalReason !== null) return;
    terminalReason = reason;
    const error = new SpanLifecycleError(reason, statusCode, message);
    if (!controller.signal.aborted) controller.abort(error);
    telemetry.finishSpan(span, statusCode, reason);
    rejectCancellation?.(error);
  };
  const onAbort = (): void => cancel("abort", 499, "operation aborted before the response boundary");
  options.signal?.addEventListener("abort", onAbort, { once: true });

  if (options.signal?.aborted) onAbort();
  if (options.timeoutMs !== undefined) {
    const timeoutMs = Math.max(1, Math.min(120_000, Math.trunc(options.timeoutMs)));
    timer = setTimeout(() => cancel("timeout", 504, "operation deadline exceeded"), timeoutMs);
  }
  if (options.disconnect) {
    void Promise.resolve(options.disconnect).then(() => cancel("disconnect", 499, "socket disconnected before the response boundary"), () => undefined);
  }

  if (terminalReason !== null) {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    throw new SpanLifecycleError(terminalReason as Exclude<SpanEndReason, "response" | "error">, terminalReason === "timeout" ? 504 : 499, `operation ended with ${terminalReason}`);
  }

  const execution = Promise.resolve().then(() => operation(controller.signal));
  execution.catch(() => undefined);
  try {
    const value = await Promise.race([execution, cancellation]);
    if (terminalReason === null) telemetry.finishSpan(span, options.successStatusCode ?? 200, "response");
    return value;
  } catch (error) {
    if (terminalReason === null) telemetry.finishSpan(span, 500, "error");
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

const prometheusStatus = (status: string): number => status === "READY" ? 1 : 0;

/**
 * Render only aggregate, redacted process metrics. Dynamic route names and
 * tenant/actor identifiers are deliberately excluded from labels so the
 * endpoint can be scraped by an internal collector without becoming a data
 * export surface. SLO evaluation remains separate and is never inferred here.
 */
export function renderPrometheusMetrics(metrics: CvgMetrics): string {
  const lines = [
    "# HELP cvg_api_requests_total Total HTTP requests observed by the API process.",
    "# TYPE cvg_api_requests_total counter",
    `cvg_api_requests_total ${metrics.requestsTotal}`,
    "# HELP cvg_api_requests_denied_total Total HTTP requests denied by the API process.",
    "# TYPE cvg_api_requests_denied_total counter",
    `cvg_api_requests_denied_total ${metrics.requestsDenied}`,
    "# HELP cvg_api_errors_total Total HTTP 5xx responses observed by the API process.",
    "# TYPE cvg_api_errors_total counter",
    `cvg_api_errors_total ${metrics.requestsError}`,
    "# HELP cvg_api_latency_ms API latency percentile gauges in milliseconds.",
    "# TYPE cvg_api_latency_ms gauge",
    `cvg_api_latency_ms{quantile="0.50"} ${metrics.latencyMs.p50}`,
    `cvg_api_latency_ms{quantile="0.95"} ${metrics.latencyMs.p95}`,
    `cvg_api_latency_ms{quantile="0.99"} ${metrics.latencyMs.p99}`,
    "# HELP cvg_active_sessions Active authenticated sessions observed by the process.",
    "# TYPE cvg_active_sessions gauge",
    `cvg_active_sessions ${metrics.activeSessions}`,
    "# HELP cvg_agent_runtime_ready Whether the configured agent runtime is ready.",
    "# TYPE cvg_agent_runtime_ready gauge",
    `cvg_agent_runtime_ready ${prometheusStatus(metrics.agentRuntime)}`,
    "# HELP cvg_dependency_ready Whether a named local dependency is ready.",
    "# TYPE cvg_dependency_ready gauge",
    ...Object.entries(metrics.dependencies).map(([dependency, status]) => `cvg_dependency_ready{dependency="${dependency}"} ${prometheusStatus(status)}`),
    "# HELP cvg_outbox_depth Current pending or claimed outbox records.",
    "# TYPE cvg_outbox_depth gauge",
    `cvg_outbox_depth ${metrics.queues.outboxDepth}`,
    "# HELP cvg_outbox_oldest_age_ms Age of the oldest pending or claimed outbox record.",
    "# TYPE cvg_outbox_oldest_age_ms gauge",
    `cvg_outbox_oldest_age_ms ${metrics.queues.oldestAgeMs}`,
    "# HELP cvg_outbox_poison_messages Quarantined outbox records.",
    "# TYPE cvg_outbox_poison_messages gauge",
    `cvg_outbox_poison_messages ${metrics.queues.poisonMessages}`,
    "# HELP cvg_reconciliation_lag External effects awaiting reconciliation.",
    "# TYPE cvg_reconciliation_lag gauge",
    `cvg_reconciliation_lag ${metrics.queues.reconciliationLag}`,
    "# HELP cvg_worker_heartbeat_age_seconds Age of the oldest durable worker heartbeat observed by this process.",
    "# TYPE cvg_worker_heartbeat_age_seconds gauge",
    `cvg_worker_heartbeat_age_seconds ${Math.max(0, metrics.queues.workerHeartbeatAgeMs ?? 0) / 1_000}`,
    "# HELP cvg_worker_heartbeat_count Number of durable worker heartbeat records observed by this process.",
    "# TYPE cvg_worker_heartbeat_count gauge",
    `cvg_worker_heartbeat_count ${Math.max(0, metrics.queues.workerHeartbeatCount ?? 0)}`,
    "# HELP cvg_outcome_unknown_total Command receipts with an unknown external outcome.",
    "# TYPE cvg_outcome_unknown_total gauge",
    `cvg_outcome_unknown_total ${metrics.domain.outcomeUnknown}`,
    "# HELP cvg_quarantined_total Quarantined domain records observed by the API process.",
    "# TYPE cvg_quarantined_total gauge",
    `cvg_quarantined_total ${metrics.domain.quarantined}`,
    "# HELP cvg_telemetry_dropped Bounded telemetry records, labels or sink writes that were discarded.",
    "# TYPE cvg_telemetry_dropped gauge",
    `cvg_telemetry_dropped ${metrics.telemetry.dropped}`,
    "# HELP cvg_telemetry_logs_stored Number of redacted log records retained in the process window.",
    "# TYPE cvg_telemetry_logs_stored gauge",
    `cvg_telemetry_logs_stored ${metrics.telemetry.logsStored}`,
    "# HELP cvg_restore_rto_rpo_known Whether current approved external RTO/RPO evidence is available.",
    "# TYPE cvg_restore_rto_rpo_known gauge",
    "cvg_restore_rto_rpo_known 0"
  ];
  for (const [metric, value] of Object.entries(metrics.agentCounters ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`# HELP cvg_agent_${metric} Redacted agent-runtime counter ${metric}.`);
    lines.push(`# TYPE cvg_agent_${metric} counter`);
    lines.push(`cvg_agent_${metric} ${Math.max(0, value)}`);
  }
  return `${lines.join("\n")}\n`;
}

export type SloId =
  | "API_AVAILABILITY"
  | "API_P95_LATENCY"
  | "LOGIN_LATENCY"
  | "PATIENT_LOOKUP_LATENCY"
  | "OUTBOX_PROCESSING_DELAY"
  | "MESSAGE_DELIVERY_ACK"
  | "API_ERROR_RATIO"
  | "DEPENDENCY_AVAILABILITY"
  | "WORKER_HEARTBEAT"
  | "TELEMETRY_DROPS"
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
  { id: "RESTORE_RTO", name: "Restore recovery time objective", target: null, direction: "MAX", unit: "milliseconds", errorBudgetModel: "NOT_DERIVED", status: "PROPOSED", source: "UNKNOWN until approved external restore infrastructure is exercised", runbook: "docs/runbooks/restore.md" },
  { id: "RESTORE_RPO", name: "Restore recovery point objective", target: null, direction: "MAX", unit: "milliseconds", errorBudgetModel: "NOT_DERIVED", status: "PROPOSED", source: "UNKNOWN until approved external backup infrastructure is exercised", runbook: "docs/runbooks/restore.md" }
] as const satisfies readonly SloDefinition[];

/**
 * The compatibility catalog above remains intentionally small. This expanded
 * catalog is the operational coverage used by the local alert drill; every
 * target is still PROPOSED and must not be read as a production measurement.
 */
export const PROPOSED_OPERATIONAL_SLO_DEFINITIONS = [
  ...PROPOSED_SLO_DEFINITIONS,
  { id: "API_ERROR_RATIO", name: "API error ratio", target: 0.01, direction: "MAX", unit: "ratio", errorBudgetModel: "NOT_DERIVED", status: "PROPOSED", source: "docker/observability/slo.yml", runbook: "docs/runbooks/observability-slo-alerts.md" },
  { id: "DEPENDENCY_AVAILABILITY", name: "Critical dependency availability", target: 0.999, direction: "MIN", unit: "ratio", errorBudgetModel: "RATIO", status: "PROPOSED", source: "docker/observability/slo.yml", runbook: "docs/runbooks/database-incident.md" },
  { id: "WORKER_HEARTBEAT", name: "Worker heartbeat freshness", target: 60_000, direction: "MAX", unit: "milliseconds", errorBudgetModel: "NOT_DERIVED", status: "PROPOSED", source: "docker/observability/slo.yml", runbook: "docs/runbooks/worker-backlog.md" },
  { id: "TELEMETRY_DROPS", name: "Telemetry drop budget", target: 0, direction: "MAX", unit: "ratio", errorBudgetModel: "NOT_DERIVED", status: "PROPOSED", source: "docker/observability/slo.yml", runbook: "docs/runbooks/observability-logs.md" }
] as const satisfies readonly SloDefinition[];

export { createOpenTelemetryRuntime, OpenTelemetryConfigurationError, OpenTelemetryTelemetryExporter } from "./otel.ts";
export type { OpenTelemetryRuntime, OpenTelemetryRuntimeOptions } from "./otel.ts";

export type SloEvidenceStatus = "MEASURED" | "NOT_RUN" | "UNKNOWN";

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

export type SloAlertCondition = "BREACH" | "BUDGET_REMAINING_BELOW" | "EVIDENCE_NOT_RUN";
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
  { id: "SLO-ALERT-RESTORE-RTO-UNKNOWN", sloId: "RESTORE_RTO", condition: "EVIDENCE_NOT_RUN", threshold: null, severity: "CRITICAL", status: "PROPOSED", runbook: "docs/runbooks/restore.md" },
  { id: "SLO-ALERT-RESTORE-RPO-UNKNOWN", sloId: "RESTORE_RPO", condition: "EVIDENCE_NOT_RUN", threshold: null, severity: "CRITICAL", status: "PROPOSED", runbook: "docs/runbooks/restore.md" },
  { id: "SLO-ALERT-API-ERROR-RATIO", sloId: "API_ERROR_RATIO", condition: "BREACH", threshold: null, severity: "CRITICAL", status: "PROPOSED", runbook: "docs/runbooks/observability-slo-alerts.md" },
  { id: "SLO-ALERT-API-P95-LATENCY", sloId: "API_P95_LATENCY", condition: "BREACH", threshold: null, severity: "WARNING", status: "PROPOSED", runbook: "docs/runbooks/observability-slo-alerts.md" },
  { id: "SLO-ALERT-WORKER-HEARTBEAT", sloId: "WORKER_HEARTBEAT", condition: "BREACH", threshold: null, severity: "CRITICAL", status: "PROPOSED", runbook: "docs/runbooks/worker-backlog.md" },
  { id: "SLO-ALERT-TELEMETRY-DROPS", sloId: "TELEMETRY_DROPS", condition: "BREACH", threshold: null, severity: "WARNING", status: "PROPOSED", runbook: "docs/runbooks/observability-logs.md" }
] as const satisfies readonly SloAlertRule[];

export type SloAlertStatus = "OK" | "ALERT" | "NOT_RUN";

export interface SloAlertEvaluation {
  readonly ruleId: string;
  readonly sloId: SloId;
  readonly status: SloAlertStatus;
  readonly severity: SloAlertSeverity;
  readonly runbook: string;
  readonly reason: "condition_clear" | "slo_breached" | "budget_low" | "evaluation_not_run" | "budget_not_available" | "rule_invalid" | "evidence_not_run";
}

/** Alert evaluation is pure and deterministic; dispatch belongs to an approved collector. */
export function evaluateSloAlerts(evaluations: readonly SloEvaluation[], rules: readonly SloAlertRule[] = PROPOSED_SLO_ALERT_RULES): SloAlertEvaluation[] {
  const bySlo = new Map(evaluations.map((evaluation) => [evaluation.sloId, evaluation]));
  return rules.map((rule) => {
    const evaluation = bySlo.get(rule.sloId);
    if (!evaluation) return { ruleId: rule.id, sloId: rule.sloId, status: "NOT_RUN", severity: rule.severity, runbook: rule.runbook, reason: "evaluation_not_run" };
    if (rule.condition === "EVIDENCE_NOT_RUN") {
      return { ruleId: rule.id, sloId: rule.sloId, status: evaluation.status === "NOT_RUN" ? "ALERT" : "OK", severity: rule.severity, runbook: rule.runbook, reason: evaluation.status === "NOT_RUN" ? "evidence_not_run" : "condition_clear" };
    }
    if (evaluation.status === "NOT_RUN") return { ruleId: rule.id, sloId: rule.sloId, status: "NOT_RUN", severity: rule.severity, runbook: rule.runbook, reason: "evaluation_not_run" };
    if (rule.condition === "BREACH") {
      return { ruleId: rule.id, sloId: rule.sloId, status: evaluation.status === "BREACH" ? "ALERT" : "OK", severity: rule.severity, runbook: rule.runbook, reason: evaluation.status === "BREACH" ? "slo_breached" : "condition_clear" };
    }
    if (rule.threshold === null || !Number.isFinite(rule.threshold) || evaluation.errorBudgetRemainingRatio === null) return { ruleId: rule.id, sloId: rule.sloId, status: "NOT_RUN", severity: rule.severity, runbook: rule.runbook, reason: rule.threshold === null || !Number.isFinite(rule.threshold) ? "rule_invalid" : "budget_not_available" };
    const low = evaluation.errorBudgetRemainingRatio <= rule.threshold;
    return { ruleId: rule.id, sloId: rule.sloId, status: low ? "ALERT" : "OK", severity: rule.severity, runbook: rule.runbook, reason: low ? "budget_low" : "condition_clear" };
  });
}
