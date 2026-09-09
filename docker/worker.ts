import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { loadCvgConfig } from "@cvg/config";
import { id } from "@cvg/contracts";
import { PostgresPersistence } from "@cvg/persistence";
import { blockedWorkerSink, CvgWorkerApplication } from "../apps/worker/src/worker.ts";

const config = loadCvgConfig();
if (config.storageMode !== "postgres") throw new Error("@cvg/worker requires CVG_STORAGE=postgres");
if (!config.workerOrganizationId) throw new Error("CVG_WORKER_ORGANIZATION_ID is required before a worker can claim outbox records");

const sleep = async (durationMs: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
};

const writeHeartbeat = async (payload: Record<string, number | string>): Promise<void> => {
  await writeFile(config.workerHeartbeatFile, `${JSON.stringify({ ...payload, observedAt: new Date().toISOString() })}\n`, { encoding: "utf8", mode: 0o600 });
};

let stopping = false;
const stop = (): void => { stopping = true; };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function main(): Promise<void> {
  await mkdir(dirname(config.workerHeartbeatFile), { recursive: true, mode: 0o700 });
  const persistence = new PostgresPersistence({ connectionString: config.databaseUrl, max: 2, connectionTimeoutMillis: 2_500, idleTimeoutMillis: 30_000 });
  const worker = new CvgWorkerApplication({ persistence, sink: blockedWorkerSink, sinkMode: config.workerSinkMode });
  try {
    const health = await worker.health();
    if (health.status === "UNAVAILABLE") throw new Error(health.reason ?? "worker persistence is unavailable");
    if (!await persistence.loadLatest(id(config.workerOrganizationId))) throw new Error("the configured organization has not been bootstrapped");
    while (!stopping) {
      const result = await worker.runOnce(id(config.workerOrganizationId), config.workerId, { limit: 10, leaseSeconds: 30, maxAttempts: 5 });
      await writeHeartbeat({ status: health.status, dispatch: health.dispatch, claimed: result.claimed, delivered: result.delivered, retried: result.retried, quarantined: result.quarantined, outcomeUnknown: result.outcomeUnknown });
      if (!stopping) await sleep(config.workerIntervalMs);
    }
  } finally {
    await persistence.close();
  }
}

await main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : "UnknownError";
  process.stderr.write(`worker failed closed: ${name}\n`);
  process.exitCode = 1;
});
