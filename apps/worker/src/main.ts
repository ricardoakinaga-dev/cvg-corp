import { loadWorkerConfig } from "@cvg/config";
import { id } from "@cvg/contracts";
import { createOpenTelemetryRuntime, OpsTelemetry } from "@cvg/ops";
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
const telemetry = new OpsTelemetry({
  ...(otelRuntime.exporter ? { exporter: otelRuntime.exporter } : {}),
  telemetryMode: otelRuntime.status === "READY" ? "OTEL_OTLP_REDACTED" : "REDACTED_BEST_EFFORT"
});
const worker = new CvgWorkerApplication(createWorkerDependencies(persistence, config, configuredSink, {
  resourceLimits: { workerCycles: 1, database: 4, provider: 2, ai: 1 },
  audit: createDurableWorkerAuditSink(persistence),
  metrics: {
    record(event) {
      const span = telemetry.startCorrelatedSpan(event.name, { requestId: null, correlationId: event.cycleId ?? null, sessionId: null, toolInvocationId: null, jobId: event.jobId ?? null, outboxId: event.outboxId ?? null, providerRequestId: event.providerRequestId ?? null }, { lane: event.lane, jobType: event.jobType, durationMs: event.durationMs });
      telemetry.finishSpan(span, event.name.endsWith("quarantined") ? 500 : event.name.endsWith("retry") || event.name.endsWith("backpressure") ? 503 : 200);
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
const stop = (): void => { stopping = true; worker.stop(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const sleep = async (durationMs: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
};

try {
  const health = await worker.health();
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
      const span = telemetry.startCorrelatedSpan("cvg.worker.run_cycle", { requestId: null, correlationId: workerOrganizationId, sessionId: null, toolInvocationId: null, jobId: null, outboxId: null, providerRequestId: null }, { workerId: config.workerId, organizationId: workerOrganizationId });
      try {
        const result = await worker.runCycle(id(workerOrganizationId), config.workerId, { limit: 10, leaseSeconds: 30, maxAttempts: 5 });
        telemetry.finishSpan(span, result.status === "FAILED" ? 500 : result.status === "DEGRADED" ? 503 : 200);
        process.stdout.write(`${JSON.stringify({ service: "cvg-worker", healthStatus: health.status, ...result })}\n`);
      } catch (error) {
        telemetry.finishSpan(span, 503);
        throw error;
      }
      if (!stopping) await sleep(config.workerIntervalMs);
    }
  }
} finally {
  await operationalBackup?.stop();
  await otelRuntime.shutdown();
  await persistence.close();
}
