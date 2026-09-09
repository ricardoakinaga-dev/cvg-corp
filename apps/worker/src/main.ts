import { loadCvgConfig } from "@cvg/config";
import { id } from "@cvg/contracts";
import { PostgresPersistence } from "@cvg/persistence";
import { blockedWorkerSink, CvgWorkerApplication } from "./worker.ts";

const config = loadCvgConfig();
if (config.storageMode !== "postgres") throw new Error("@cvg/worker requires CVG_STORAGE=postgres");
if (!config.workerOrganizationId) throw new Error("CVG_WORKER_ORGANIZATION_ID is required before a worker can claim outbox records");

const persistence = new PostgresPersistence({ connectionString: config.databaseUrl });
const worker = new CvgWorkerApplication({ persistence, sink: blockedWorkerSink, sinkMode: config.workerSinkMode });
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
      const result = await worker.runOnce(id(config.workerOrganizationId), config.workerId, { limit: 10, leaseSeconds: 30, maxAttempts: 5 });
      process.stdout.write(`${JSON.stringify({ service: "cvg-worker", status: health.status, ...result })}\n`);
      if (!stopping) await sleep(config.workerIntervalMs);
    }
  }
} finally {
  await persistence.close();
}
