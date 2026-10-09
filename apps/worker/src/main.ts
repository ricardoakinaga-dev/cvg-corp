import { loadWorkerConfig } from "@cvg/config";
import { id } from "@cvg/contracts";
import { createOpenTelemetryRuntime, FileDurableLogSink, OpsTelemetry, runWithSpanLifecycle, SpanLifecycleError } from "@cvg/ops";
import { PostgresPersistence } from "@cvg/persistence";
import { createOperationalBackupJob } from "./operational-backup.ts";
import { createConfiguredWorkerSink, createDurableWorkerAuditSink, createWorkerDependencies, CvgWorkerApplication } from "./worker.ts";

const config = loadWorkerConfig();
if (config.storageMode !== "postgres") throw new Error("@cvg/worker requires CVG_STORAGE=postgres");
if (!config.workerOrganizationId) throw new Error("CVG_WORKER_ORGANIZATION_ID is required before a worker can claim outbox records");
if (!config.databaseUrl) throw new Error("DATABASE_URL is required before a worker can claim outbox records");
const workerOrganizationId = config.workerOrganizationId;
const databaseUrl = config.databaseUrl;

const persistence = new PostgresPersistence({ connectionString: databaseUrl });
const configuredSink = createConfiguredWorkerSink(config);
const otelRuntime = createOpenTelemetryRuntime({ serviceName: "cvg-worker", requireTls: config.nodeEnv === "production" });
if (config.nodeEnv === "production" && otelRuntime.status !== "READY") throw new Error("Produção exige exportação OTLP OpenTelemetry pronta para o worker.");
const durableLogFile = process.env.CVG_DURABLE_LOG_FILE?.trim();
const durableLogSink = durableLogFile ? new FileDurableLogSink({ path: durableLogFile, maxBytes: 8 * 1024 * 1024, maxBackups: 7 }) : null;
const telemetry = new OpsTelemetry({
  ...(otelRuntime.exporter ? { exporter: otelRuntime.exporter } : {}),
  ...(durableLogSink ? { durableLogSink } : {}),
  telemetryMode: otelRuntime.status === "READY" ? "OTEL_OTLP_REDACTED" : "REDACTED_BEST_EFFORT"
});
const worker = new CvgWorkerApplication(createWorkerDependencies(persistence, config, configuredSink, {
  resourceLimits: { workerCycles: 1, database: 4, provider: 2, ai: 1 },
  audit: createDurableWorkerAuditSink(persistence),
  metrics: {
    record(event) {
      const span = telemetry.startCorrelatedSpan(event.name, { requestId: null, correlationId: event.cycleId ?? null, sessionId: null, toolInvocationId: null, jobId: event.jobId ?? null, outboxId: event.outboxId ?? null, providerRequestId: event.providerRequestId ?? null }, { lane: event.lane, jobType: event.jobType, durationMs: event.durationMs });
      const statusCode = event.name.endsWith("quarantined") ? 500 : event.name.endsWith("retry") || event.name.endsWith("backpressure") ? 503 : 200;
      telemetry.finishSpan(span, statusCode, statusCode >= 500 ? "error" : "response");
      telemetry.logCorrelated({ context: { requestId: null, correlationId: event.cycleId ?? null, sessionId: null, toolInvocationId: null, jobId: event.jobId ?? null, outboxId: event.outboxId ?? null, providerRequestId: event.providerRequestId ?? null }, event: event.name, level: statusCode >= 500 ? "error" : "info", metadata: { lane: event.lane, jobType: event.jobType, durationMs: event.durationMs }, outcome: statusCode >= 500 ? "ERROR" : "OBSERVED" });
    }
  }
}));
const operationalBackup = createOperationalBackupJob({
  persistence,
  config,
  environment: process.env,
  onFailure: (error) => {
    const name = error instanceof Error ? error.name : "UnknownError";
    process.stderr.write(`operational backup blocked: ${name}\n`);
  }
});
let stopping = false;
const lifecycleController = new AbortController();
const stop = (): void => { stopping = true; lifecycleController.abort(new Error("worker shutdown requested")); worker.stop(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const sleep = async (durationMs: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
};

try {
  const health = await worker.health();
  telemetry.logCorrelated({ context: { requestId: null, correlationId: workerOrganizationId, sessionId: null, toolInvocationId: null, jobId: null, outboxId: null, providerRequestId: null }, event: "worker.health", level: health.status === "UNAVAILABLE" ? "error" : "info", metadata: { status: health.status, persistence: health.persistence, dispatch: health.dispatch }, outcome: health.status });
  if (health.status === "UNAVAILABLE") {
    process.stdout.write(`${JSON.stringify({ service: "cvg-worker", ...health })}\n`);
    process.exitCode = 1;
  } else {
    if (!await persistence.loadLatest(id(workerOrganizationId))) throw new Error("the configured organization has not been bootstrapped");
    // A worker must prove that the first encrypted backup can be created and
    // verified before it announces a healthy long-running process.
    await operationalBackup?.runOnce();
    operationalBackup?.start({ runImmediately: false });
    process.stdout.write(`${JSON.stringify({ service: "cvg-worker", ...health })}\n`);
    while (!stopping) {
      try {
        const result = await runWithSpanLifecycle(telemetry, "cvg.worker.run_cycle", { requestId: null, correlationId: workerOrganizationId, sessionId: null, toolInvocationId: null, jobId: null, outboxId: null, providerRequestId: null }, (signal) => worker.runCycle(id(workerOrganizationId), config.workerId, { limit: 10, leaseSeconds: 30, maxAttempts: 5, signal }), { signal: lifecycleController.signal });
        telemetry.logCorrelated({ context: { requestId: null, correlationId: result.cycleId, sessionId: null, toolInvocationId: null, jobId: null, outboxId: null, providerRequestId: null }, event: "worker.cycle.completed", level: result.status === "COMPLETED" ? "info" : "warn", metadata: { status: result.status, durationMs: result.durationMs, laneRuns: result.metrics.laneRuns, laneFailures: result.metrics.laneFailures }, outcome: result.status });
        process.stdout.write(`${JSON.stringify({ service: "cvg-worker", healthStatus: health.status, ...result })}\n`);
      } catch (error) {
        if (stopping && error instanceof SpanLifecycleError) break;
        telemetry.logCorrelated({ context: { requestId: null, correlationId: workerOrganizationId, sessionId: null, toolInvocationId: null, jobId: null, outboxId: null, providerRequestId: null }, event: "worker.cycle.failed", level: "error", metadata: { error: error instanceof Error ? error.name : "UnknownError" }, outcome: "FAILED" });
        throw error;
      }
      if (!stopping) await sleep(config.workerIntervalMs);
    }
  }
} finally {
  await operationalBackup?.stop();
  await telemetry.close();
  await otelRuntime.shutdown();
  await persistence.close();
}
