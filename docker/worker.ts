import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { OutboxWorker, type OutboxSink } from "@cvg/integrations";
import { id } from "@cvg/contracts";
import { PostgresPersistence } from "@cvg/persistence";

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const boundedInteger = (name: string, fallback: number, minimum: number, maximum: number): number => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} is outside its allowed range`);
  return value;
};

const databaseUrl = required("DATABASE_URL");
const organizationId = id(required("CVG_ORGANIZATION_ID"));
const workerId = required("CVG_WORKER_ID");
const intervalMs = boundedInteger("CVG_WORKER_INTERVAL_MS", 5_000, 1_000, 30_000);
const heartbeatFile = process.env.CVG_WORKER_HEARTBEAT_FILE?.trim() || "/tmp/cvg-worker/heartbeat";
const sinkMode = process.env.CVG_WORKER_SINK_MODE?.trim() || "quarantine";

if (!/^[A-Za-z0-9._:-]{1,120}$/.test(workerId)) throw new Error("CVG_WORKER_ID is invalid");
if (sinkMode !== "quarantine") throw new Error("CVG_WORKER_SINK_MODE must be quarantine until a governed external sink exists");

const sink: OutboxSink = {
  deliver: async () => "QUARANTINE"
};

const sleep = async (durationMs: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
};

const writeHeartbeat = async (payload: Record<string, number | string>): Promise<void> => {
  await writeFile(heartbeatFile, `${JSON.stringify({ ...payload, observedAt: new Date().toISOString() })}\n`, { encoding: "utf8", mode: 0o600 });
};

let stopping = false;
const stop = (): void => { stopping = true; };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function main(): Promise<void> {
  await mkdir(dirname(heartbeatFile), { recursive: true, mode: 0o700 });
  const persistence = new PostgresPersistence({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 2_500, idleTimeoutMillis: 30_000 });
  const worker = new OutboxWorker(persistence, persistence);
  try {
    await persistence.check();
    await persistence.assertSchema();
    if (!await persistence.loadLatest(organizationId)) throw new Error("the configured organization has not been bootstrapped");
    while (!stopping) {
      const result = await worker.runOnce(organizationId, workerId, sink, { limit: 10, leaseSeconds: 30, maxAttempts: 5 });
      await writeHeartbeat({ status: "DEGRADED", dispatch: "QUARANTINE", claimed: result.claimed, delivered: result.delivered, retried: result.retried, quarantined: result.quarantined, outcomeUnknown: result.outcomeUnknown });
      if (!stopping) await sleep(intervalMs);
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
