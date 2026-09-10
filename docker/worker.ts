import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { loadCvgConfig } from "@cvg/config";
import { id } from "@cvg/contracts";
import { createOpenTelemetryRuntime, OpsTelemetry } from "@cvg/ops";
import { PostgresPersistence } from "@cvg/persistence";
import { createConfiguredWorkerSink, CvgWorkerApplication } from "../apps/worker/src/worker.ts";

const config = loadCvgConfig();
if (config.storageMode !== "postgres") throw new Error("@cvg/worker requires CVG_STORAGE=postgres");
if (!config.workerOrganizationId) throw new Error("CVG_WORKER_ORGANIZATION_ID is required before a worker can claim outbox records");
const otelRuntime = createOpenTelemetryRuntime({ serviceName: "cvg-worker", requireTls: config.nodeEnv === "production" });
if (config.nodeEnv === "production" && otelRuntime.status !== "READY") throw new Error("Produção exige exportação OTLP OpenTelemetry pronta para o worker.");
const telemetry = new OpsTelemetry({
  ...(otelRuntime.exporter ? { exporter: otelRuntime.exporter } : {}),
  telemetryMode: otelRuntime.status === "READY" ? "OTEL_OTLP_REDACTED" : "REDACTED_BEST_EFFORT"
});

const sleep = async (durationMs: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
};

const writeHeartbeat = async (payload: Record<string, number | string>): Promise<void> => {
  await writeFile(config.workerHeartbeatFile, `${JSON.stringify({ ...payload, observedAt: new Date().toISOString() })}\n`, { encoding: "utf8", mode: 0o600 });
};

let stopping = false;
let activeWorker: CvgWorkerApplication | null = null;
const stop = (): void => { stopping = true; activeWorker?.stop(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function main(): Promise<void> {
  await mkdir(dirname(config.workerHeartbeatFile), { recursive: true, mode: 0o700 });
  const persistence = new PostgresPersistence({ connectionString: config.databaseUrl, max: 2, connectionTimeoutMillis: 2_500, idleTimeoutMillis: 30_000 });
  const configuredSink = createConfiguredWorkerSink(config);
  const worker = new CvgWorkerApplication({ persistence, sink: configuredSink.sink, sinkMode: configuredSink.sinkMode, maxOutstandingOutbox: config.workerMaxOutstandingOutbox, maxOutstandingJobs: config.workerMaxOutstandingOutbox, ...(configuredSink.queryAdapter ? { reconciliationAdapter: configuredSink.queryAdapter } : {}) });
  activeWorker = worker;
  try {
    const health = await worker.health();
    if (health.status === "UNAVAILABLE") throw new Error(health.reason ?? "worker persistence is unavailable");
    if (!await persistence.loadLatest(id(config.workerOrganizationId))) throw new Error("the configured organization has not been bootstrapped");
    while (!stopping) {
      const span = telemetry.startSpan("cvg.worker.run_cycle", { workerId: config.workerId, organizationId: config.workerOrganizationId });
      let result: Awaited<ReturnType<typeof worker.runCycle>>;
      try {
        result = await worker.runCycle(id(config.workerOrganizationId), config.workerId, { limit: 10, leaseSeconds: 30, maxAttempts: 5 });
        telemetry.finishSpan(span, result.status === "FAILED" ? 500 : result.status === "DEGRADED" ? 503 : 200);
      } catch (error) {
        telemetry.finishSpan(span, 503);
        throw error;
      }
      const blockedLanes = Object.entries(result.lanes).filter(([, lane]) => lane.status === "BLOCKED").map(([lane]) => lane).join(",");
      const failedLanes = Object.entries(result.lanes).filter(([, lane]) => lane.status === "FAILED").map(([lane]) => lane).join(",");
      await writeHeartbeat({ status: health.status, lifecycle: health.lifecycle, cycleStatus: result.status, cycleId: result.cycleId, blockedLanes, failedLanes, claimed: result.claimed, delivered: result.delivered, retried: result.retried, quarantined: result.quarantined, outcomeUnknown: result.outcomeUnknown });
      if (!stopping) await sleep(config.workerIntervalMs);
    }
  } finally {
    activeWorker = null;
    await otelRuntime.shutdown();
    await persistence.close();
  }
}

await main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : "UnknownError";
  process.stderr.write(`worker failed closed: ${name}\n`);
  process.exitCode = 1;
});
