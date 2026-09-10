import { loadCvgConfig } from "@cvg/config";
import { id } from "@cvg/contracts";
import { createOpenTelemetryRuntime, OpsTelemetry } from "@cvg/ops";
import { PostgresPersistence } from "@cvg/persistence";
import { createConfiguredWorkerSink, CvgWorkerApplication } from "./worker.ts";

const config = loadCvgConfig();
if (config.storageMode !== "postgres") throw new Error("@cvg/worker requires CVG_STORAGE=postgres");
if (!config.workerOrganizationId) throw new Error("CVG_WORKER_ORGANIZATION_ID is required before a worker can claim outbox records");

const persistence = new PostgresPersistence({ connectionString: config.databaseUrl });
const configuredSink = createConfiguredWorkerSink(config);
const worker = new CvgWorkerApplication({ persistence, sink: configuredSink.sink, sinkMode: configuredSink.sinkMode, maxOutstandingOutbox: config.workerMaxOutstandingOutbox, maxOutstandingJobs: config.workerMaxOutstandingOutbox, ...(configuredSink.queryAdapter ? { reconciliationAdapter: configuredSink.queryAdapter } : {}) });
const otelRuntime = createOpenTelemetryRuntime({ serviceName: "cvg-worker", requireTls: config.nodeEnv === "production" });
if (config.nodeEnv === "production" && otelRuntime.status !== "READY") throw new Error("Produção exige exportação OTLP OpenTelemetry pronta para o worker.");
const telemetry = new OpsTelemetry({
  ...(otelRuntime.exporter ? { exporter: otelRuntime.exporter } : {}),
  telemetryMode: otelRuntime.status === "READY" ? "OTEL_OTLP_REDACTED" : "REDACTED_BEST_EFFORT"
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
  process.stdout.write(`${JSON.stringify({ service: "cvg-worker", ...health })}\n`);
  if (health.status === "UNAVAILABLE") {
    process.exitCode = 1;
  } else {
    while (!stopping) {
      const span = telemetry.startSpan("cvg.worker.run_cycle", { workerId: config.workerId, organizationId: config.workerOrganizationId });
      try {
        const result = await worker.runCycle(id(config.workerOrganizationId), config.workerId, { limit: 10, leaseSeconds: 30, maxAttempts: 5 });
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
  await otelRuntime.shutdown();
  await persistence.close();
}
