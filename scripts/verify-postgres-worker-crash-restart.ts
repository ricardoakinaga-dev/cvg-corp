import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, open, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import pg from "pg";
import { id as opaqueId } from "@cvg/contracts";
import { digest } from "@cvg/domain";
import { OutboxWorker, type OutboxSink } from "@cvg/integrations";
import { PostgresPersistence, type DurableExternalReconciliationEvidence, type DurableOutboxRecord } from "@cvg/persistence";
import { CvgStore } from "@cvg/domain";

/**
 * CVG-AUD21-012: process-boundary crash/restart proof against disposable
 * PostgreSQL. The provider emulator is a second OS process and persists its
 * synthetic effects with fsync, so a worker kill cannot be mistaken for an
 * in-process exception path.
 *
 * Requires DATABASE_URL (runtime role), MIGRATION_DATABASE_URL (schema owner)
 * and ADMIN_DATABASE_URL (maintenance connection).
 */

const workerChildMode = process.env.CVG_AUD21_WORKER_CHILD;
const providerChildMode = process.env.CVG_AUD21_PROVIDER_CHILD === "1";
const runtimeUrl = process.env.DATABASE_URL;
const migrationUrl = process.env.MIGRATION_DATABASE_URL;
const adminUrl = process.env.ADMIN_DATABASE_URL ?? migrationUrl;
const scriptPath = fileURLToPath(import.meta.url);
const rootPath = fileURLToPath(new URL("../", import.meta.url));

type ProviderResponse = {
  status: "SUCCEEDED" | "FAILED_FINAL";
  providerRequestId: string | null;
  response: Record<string, unknown> | null;
};

type OutboxState = {
  status: string;
  attempts: number;
  claimedBy: string | null;
  leaseUntil: string | null;
  availableAt: string;
  processedAt: string | null;
};

type ChildResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

type StartedChild = {
  child: ChildProcess;
  readonly stdout: string;
  readonly stderr: string;
  result: Promise<ChildResult>;
};

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function withDatabase(connectionString: string, name: string): string {
  const parsed = new URL(connectionString);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function appendDurableLine(path: string, value: Record<string, unknown>): Promise<void> {
  const handle = await open(path, "a", 0o600);
  try {
    await handle.write(`${JSON.stringify(value)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readJsonLines(path: string): Promise<Record<string, unknown>[]> {
  try {
    const content = await readFile(path, "utf8");
    return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

function providerPort(): number {
  const port = Number(process.env.CVG_AUD21_PROVIDER_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("CVG_AUD21_PROVIDER_PORT is required");
  return port;
}

async function callProvider(request: Record<string, unknown>): Promise<ProviderResponse> {
  const port = providerPort();
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let buffer = "";
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      callback();
      socket.destroy();
    };
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd < 0) return;
      const line = buffer.slice(0, lineEnd);
      try {
        const response = JSON.parse(line) as ProviderResponse;
        finish(() => resolve(response));
      } catch (error) {
        finish(() => reject(error));
      }
    });
    socket.on("error", (error) => finish(() => reject(error)));
  });
}

async function runProviderChild(): Promise<void> {
  const logPath = process.env.CVG_AUD21_PROVIDER_LOG;
  if (!logPath) throw new Error("CVG_AUD21_PROVIDER_LOG is required");
  const knownEffects = new Map<string, { providerRequestId: string; response: Record<string, unknown> }>();
  for (const row of await readJsonLines(logPath)) {
    if (row.kind === "effect" && typeof row.key === "string" && typeof row.providerRequestId === "string" && row.response && typeof row.response === "object" && !Array.isArray(row.response)) {
      knownEffects.set(row.key, { providerRequestId: row.providerRequestId, response: row.response as Record<string, unknown> });
    }
  }

  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let lineEnd = buffer.indexOf("\n");
      while (lineEnd >= 0) {
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 1);
        lineEnd = buffer.indexOf("\n");
        void (async () => {
          try {
            const request = JSON.parse(line) as { op?: unknown; key?: unknown; payload?: unknown };
            const key = typeof request.key === "string" ? request.key : "";
            if (!key) throw new Error("provider request key is required");
            await appendDurableLine(logPath, { kind: "request", op: request.op ?? null, key, observedAt: new Date().toISOString() });
            const existing = knownEffects.get(key);
            if (request.op === "query") {
              const response: ProviderResponse = existing
                ? { status: "SUCCEEDED", providerRequestId: existing.providerRequestId, response: existing.response }
                : { status: "FAILED_FINAL", providerRequestId: null, response: null };
              socket.end(`${JSON.stringify(response)}\n`);
              return;
            }
            if (request.op !== "deliver") throw new Error(`unsupported provider operation ${String(request.op)}`);
            if (existing) {
              socket.end(`${JSON.stringify({ status: "SUCCEEDED", providerRequestId: existing.providerRequestId, response: { ...existing.response, duplicate: true } } satisfies ProviderResponse)}\n`);
              return;
            }
            const providerRequestId = `synthetic-provider-${key}`;
            const response = { accepted: true, effectKey: key, payloadDigest: digest(request.payload ?? null) };
            knownEffects.set(key, { providerRequestId, response });
            await appendDurableLine(logPath, { kind: "effect", key, providerRequestId, response, observedAt: new Date().toISOString() });
            socket.end(`${JSON.stringify({ status: "SUCCEEDED", providerRequestId, response } satisfies ProviderResponse)}\n`);
          } catch (error) {
            socket.end(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
          }
        })();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("provider emulator did not expose a TCP port");
  process.stdout.write(`PROVIDER_READY ${address.port}\n`);

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      server.close(() => resolve());
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  });
}

function startedChild(environment: NodeJS.ProcessEnv): StartedChild {
  const child = spawn(process.execPath, ["--import", "tsx", scriptPath], {
    cwd: rootPath,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const result = new Promise<ChildResult>((resolve) => {
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal, stdout, stderr }));
  });
  return { child, get stdout() { return stdout; }, get stderr() { return stderr; }, result };
}

async function waitForOutput(child: StartedChild, marker: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.stdout.includes(marker)) return;
    const result = await Promise.race([child.result, wait(50).then(() => null)]);
    if (result) throw new Error(`child exited before ${marker}: ${JSON.stringify(result)}`);
  }
  throw new Error(`timed out waiting for child output ${marker}; stdout=${child.stdout}; stderr=${child.stderr}`);
}

async function runProcess(environment: NodeJS.ProcessEnv): Promise<ChildResult> {
  return (await startedChild(environment).result);
}

async function stopProcess(child: StartedChild): Promise<ChildResult> {
  if (!child.child.killed) child.child.kill("SIGTERM");
  const result = await Promise.race([child.result, wait(2_000).then(() => null)]);
  if (result) return result;
  child.child.kill("SIGKILL");
  return child.result;
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, (_key, candidate: unknown) => typeof candidate === "bigint" ? candidate.toString() : candidate);
}

function assertCleanChild(result: ChildResult, label: string): void {
  if (result.exitCode !== 0 || result.signal !== null) throw new Error(`${label} child failed: ${JSON.stringify(result)}`);
}

function assertKilledChild(result: ChildResult, label: string): void {
  if (result.signal !== "SIGKILL") throw new Error(`${label} did not crash with SIGKILL: ${JSON.stringify(result)}`);
}

async function applyMigrations(client: pg.Client): Promise<void> {
  const files = (await readdir("db/migrations")).filter((file) => file.endsWith(".sql")).sort();
  await client.query("create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now(), checksum text not null)");
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const sql = await readFile(join("db/migrations", file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into schema_migrations(version, checksum) values ($1, $2)", [version, checksum]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw new Error(`migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function childEnvironment(input: { mode: string; databaseUrl: string; organizationId: string; outboxId: string; providerPort: number; providerLog: string; workerId: string }): NodeJS.ProcessEnv {
  return {
    CVG_AUD21_WORKER_CHILD: input.mode,
    DATABASE_URL: input.databaseUrl,
    CVG_AUD21_ORGANIZATION_ID: input.organizationId,
    CVG_AUD21_OUTBOX_ID: input.outboxId,
    CVG_AUD21_PROVIDER_PORT: String(input.providerPort),
    CVG_AUD21_PROVIDER_LOG: input.providerLog,
    CVG_AUD21_WORKER_ID: input.workerId
  };
}

async function requireClaim(persistence: PostgresPersistence, organizationId: string, outboxId: string, workerId: string, leaseSeconds: number): Promise<DurableOutboxRecord> {
  const records = await persistence.claimOutbox(opaqueId(organizationId), workerId, 1, leaseSeconds);
  const record = records.find((candidate) => candidate.id === outboxId);
  if (!record) throw new Error(`worker child ${workerId} did not claim expected outbox ${outboxId}; claimed=${records.map((candidate) => candidate.id).join(",")}`);
  return record;
}

function effectInput(record: DurableOutboxRecord): { id: DurableOutboxRecord["id"]; organizationId: DurableOutboxRecord["organizationId"]; outboxId: DurableOutboxRecord["id"]; integrationId: string; idempotencyKey: string; request: Record<string, unknown> } {
  return {
    id: record.id,
    organizationId: record.organizationId,
    outboxId: record.id,
    integrationId: `outbox:${record.eventType}`,
    idempotencyKey: record.id,
    request: { eventType: record.eventType, aggregateId: record.aggregateId, payload: record.payload, recordDigest: record.recordDigest }
  };
}

async function providerDeliver(outboxId: string, payload: unknown): Promise<ProviderResponse> {
  return callProvider({ op: "deliver", key: outboxId, payload });
}

async function runWorkerOnce(mode: string, persistence: PostgresPersistence, organizationId: string, workerId: string): Promise<void> {
  const usesEffects = !mode.startsWith("poison");
  const worker = new OutboxWorker(persistence, usesEffects ? persistence : null);
  let sinkCalls = 0;
  const deliver = async (record: DurableOutboxRecord): Promise<"RETRY" | { status: "DELIVERED"; providerRequestId: string; receipt: Record<string, unknown> } | { status: "OUTCOME_UNKNOWN"; providerRequestId: string; evidence: Record<string, unknown>; reason: string }> => {
    sinkCalls += 1;
    if (mode.startsWith("replay")) throw new Error("blind retry reached the provider after a durable recovery marker");
    if (mode.startsWith("poison")) return "RETRY";
    const response = await providerDeliver(record.id, record.payload);
    if (!response.providerRequestId || !response.response) throw new Error("provider did not return a verifiable synthetic receipt");
    if (mode === "crash-after-effect-before-outcome") {
      process.kill(process.pid, "SIGKILL");
      throw new Error("unreachable after crash");
    }
    if (mode === "outcome-unknown") return { status: "OUTCOME_UNKNOWN", providerRequestId: response.providerRequestId, evidence: response.response, reason: "synthetic provider response was intentionally withheld from durable success" };
    return { status: "DELIVERED", providerRequestId: response.providerRequestId, receipt: response.response };
  };
  const sink: OutboxSink = usesEffects ? { requiresDurableEffectLedger: true, deliver } : { deliver };
  const result = await worker.runOnce(opaqueId(organizationId), workerId, sink, { limit: 1, leaseSeconds: mode === "crash-after-effect-before-outcome" ? 1 : 30, maxAttempts: mode.startsWith("poison") ? 2 : 5 });
  if (mode.startsWith("replay") && sinkCalls !== 0) throw new Error(`recovery path called provider ${sinkCalls} time(s)`);
  process.stdout.write(`${JSON.stringify({ mode, result, sinkCalls })}\n`);
}

async function runManualCrash(mode: string, persistence: PostgresPersistence, organizationId: string, outboxId: string, workerId: string): Promise<void> {
  const record = await requireClaim(persistence, organizationId, outboxId, workerId, mode === "after-ack" ? 30 : 1);
  if (mode === "before-effect") {
    process.kill(process.pid, "SIGKILL");
    throw new Error("unreachable after crash");
  }
  const effect = await persistence.prepareExternalEffect(effectInput(record), { workerId, fenceToken: record.fenceToken, leaseSeconds: mode === "after-ack" ? 30 : 1 });
  if (effect.status !== "ADMISSION_PENDING") throw new Error(`manual crash ${mode} did not admit effect: ${effect.status}`);
  await persistence.markExternalEffectDispatched(opaqueId(organizationId), effect.id, workerId, record.fenceToken);
  const provider = await providerDeliver(outboxId, record.payload);
  if (!provider.providerRequestId || !provider.response) throw new Error("manual crash provider did not return a receipt");
  await persistence.recordExternalEffectOutcome(opaqueId(organizationId), effect.id, workerId, record.fenceToken, { status: "SUCCEEDED", providerRequestId: provider.providerRequestId, response: provider.response });
  if (mode === "after-outcome-before-ack") {
    process.kill(process.pid, "SIGKILL");
    throw new Error("unreachable after crash");
  }
  await persistence.completeOutbox(opaqueId(organizationId), record.id, workerId, record.fenceToken);
  if (mode === "after-ack") {
    process.kill(process.pid, "SIGKILL");
    throw new Error("unreachable after crash");
  }
}

async function runLeaseHolder(persistence: PostgresPersistence, organizationId: string, outboxId: string, workerId: string): Promise<void> {
  const record = await requireClaim(persistence, organizationId, outboxId, workerId, 1);
  process.stdout.write(`LEASE_CLAIMED fence=${record.fenceToken.toString()}\n`);
  await wait(1_500);
  try {
    await persistence.completeOutbox(opaqueId(organizationId), record.id, workerId, record.fenceToken);
    throw new Error("stale worker acknowledged after lease takeover");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.toLowerCase().includes("lease")) throw error;
    process.stdout.write("LEASE_ACK_REJECTED\n");
  }
}

async function runReconciliation(persistence: PostgresPersistence, organizationId: string, outboxId: string): Promise<void> {
  const effects = await persistence.listExternalEffects(opaqueId(organizationId));
  const effect = effects.find((candidate) => candidate.outboxId === outboxId);
  if (!effect) throw new Error(`no external effect exists for ${outboxId}`);
  const provider = await callProvider({ op: "query", key: effect.idempotencyKey });
  if (provider.status !== "SUCCEEDED" || !provider.providerRequestId || !provider.response) throw new Error(`provider query did not find a final effect for ${outboxId}`);
  const observedAt = new Date().toISOString();
  const evidence: DurableExternalReconciliationEvidence = {
    status: "SUCCEEDED",
    providerRequestId: provider.providerRequestId,
    response: provider.response,
    source: "SYNTHETIC_PROVIDER_QUERY",
    observedAt,
    queryDigest: digest({ effectId: effect.id, status: "SUCCEEDED", providerRequestId: provider.providerRequestId, response: provider.response, observedAt })
  };
  const reconciled = await persistence.reconcileExternalEffect(opaqueId(organizationId), effect.id, evidence);
  if (reconciled.status !== "SUCCEEDED") throw new Error(`reconciliation ended in ${reconciled.status}`);
  process.stdout.write(`${JSON.stringify({ mode: "reconcile", effectId: effect.id, status: reconciled.status, source: reconciled.reconciliationSource })}\n`);
}

async function runWorkerChild(mode: string): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const organizationId = process.env.CVG_AUD21_ORGANIZATION_ID;
  const outboxId = process.env.CVG_AUD21_OUTBOX_ID;
  const workerId = process.env.CVG_AUD21_WORKER_ID;
  if (!databaseUrl || !organizationId || !outboxId || !workerId) throw new Error("worker child requires database, organization, outbox and worker identity");
  const persistence = new PostgresPersistence({ connectionString: databaseUrl });
  try {
    if (["before-effect", "after-outcome-before-ack", "after-ack"].includes(mode)) await runManualCrash(mode, persistence, organizationId, outboxId, workerId);
    else if (mode === "lease-holder") await runLeaseHolder(persistence, organizationId, outboxId, workerId);
    else if (mode === "reconcile") await runReconciliation(persistence, organizationId, outboxId);
    else await runWorkerOnce(mode, persistence, organizationId, workerId);
  } finally {
    await persistence.close();
  }
}

async function startProvider(logPath: string): Promise<{ child: StartedChild; port: number }> {
  const child = startedChild({ CVG_AUD21_PROVIDER_CHILD: "1", CVG_AUD21_PROVIDER_LOG: logPath });
  await waitForOutput(child, "PROVIDER_READY ");
  const match = child.stdout.match(/PROVIDER_READY (\d+)/);
  if (!match?.[1]) throw new Error(`provider child did not expose a port: ${child.stdout}`);
  return { child, port: Number(match[1]) };
}

async function runParent(): Promise<void> {
  if (!runtimeUrl || !migrationUrl || !adminUrl) {
    process.stderr.write("POSTGRES_WORKER_CRASH_RESTART_BLOCKED_EXTERNAL DATABASE_URL, MIGRATION_DATABASE_URL and ADMIN_DATABASE_URL are required\n");
    process.exitCode = 2;
    return;
  }
  const databaseName = `cvg_worker_crash_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  const tempDirectory = await mkdtemp(join(tmpdir(), "cvg-aud21-worker-"));
  const providerLog = join(tempDirectory, "provider.jsonl");
  let providerChild: StartedChild | null = null;
  let reader: pg.Pool | null = null;
  let persistence: PostgresPersistence | null = null;
  let created = false;
  try {
    await admin.connect();
    await admin.query(`drop database if exists ${quoteIdentifier(databaseName)} with (force)`);
    await admin.query(`create database ${quoteIdentifier(databaseName)}`);
    created = true;
    const owner = new pg.Client({ connectionString: withDatabase(migrationUrl, databaseName) });
    await owner.connect();
    try {
      await applyMigrations(owner);
      const runtimeUser = new URL(runtimeUrl).username;
      await owner.query(`grant connect on database ${quoteIdentifier(databaseName)} to ${quoteIdentifier(runtimeUser)}`);
      await owner.query(`grant usage on schema public to ${quoteIdentifier(runtimeUser)}`);
      await owner.query(`revoke insert, update, delete on table public.schema_migrations from ${quoteIdentifier(runtimeUser)}`);
      await owner.query(`grant select on table public.schema_migrations to ${quoteIdentifier(runtimeUser)}`);
      await owner.query(`revoke create on schema public from ${quoteIdentifier(runtimeUser)}`);
    } finally {
      await owner.end();
    }

    const targetUrl = withDatabase(runtimeUrl, databaseName);
    persistence = new PostgresPersistence({ connectionString: targetUrl });
    const store = new CvgStore({ bootstrapPassword: process.env.CVG_BOOTSTRAP_PASSWORD ?? "synthetic-password-123" });
    const organizationId = store.bootstrapCredentials.organizationId;
    await persistence.commit({ expectedRevision: null, snapshot: store.snapshot(), eventType: "BOOTSTRAP", operation: "system.bootstrap", organizationId, actorId: null, correlationId: randomUUID(), aggregateType: "Organization", aggregateId: organizationId, payload: { synthetic: true }, auditRecords: store.snapshot().auditRecords, commandReceipts: store.snapshot().commandReceipts });
    reader = new pg.Pool({ connectionString: targetUrl, max: 1, application_name: "cvg-aud21-worker-crash-reader" });
    const provider = await startProvider(providerLog);
    providerChild = provider.child;
    const providerPort = provider.port;
    const result: Record<string, unknown> = {};

    const outboxState = async (outboxId: string): Promise<OutboxState> => {
      const client = await reader!.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('cvg.organization_id', $1, true)", [organizationId]);
        const query = await client.query<OutboxState & { available_at: string; claimed_by: string | null; lease_until: string | null; processed_at: string | null }>("select status, attempts, claimed_by, lease_until, available_at, processed_at from outbox_records where id = $1", [outboxId]);
        await client.query("commit");
        const row = query.rows[0];
        if (!row) throw new Error(`outbox ${outboxId} does not exist`);
        return { status: row.status, attempts: Number(row.attempts), claimedBy: row.claimedBy, leaseUntil: row.leaseUntil, availableAt: row.available_at, processedAt: row.processedAt };
      } finally {
        client.release();
      }
    };
    const externalEffect = async (outboxId: string) => (await persistence!.listExternalEffects(organizationId)).find((effect) => effect.outboxId === outboxId) ?? null;
    const seedOutbox = async (eventType: string): Promise<string> => {
      const outboxId = randomUUID();
      const latest = await persistence!.loadLatest(organizationId);
      if (!latest) throw new Error("worker crash drill has no canonical bootstrap snapshot");
      await persistence!.commit({ expectedRevision: latest.revision, snapshot: latest.snapshot, eventType: "SYSTEM", operation: "verify.postgres.worker-crash.seed", organizationId, actorId: null, correlationId: `seed-${outboxId}`, aggregateType: "Outbox", aggregateId: opaqueId(outboxId), payload: { synthetic: true, outboxId }, outboxRecords: [{ id: opaqueId(outboxId), organizationId, eventType, aggregateId: organizationId, payload: { synthetic: true, outboxId } }] });
      return outboxId;
    };
    const envFor = (mode: string, outboxId: string, workerId: string): NodeJS.ProcessEnv => childEnvironment({ mode, databaseUrl: targetUrl, organizationId, outboxId, providerPort, providerLog, workerId });
    const run = async (mode: string, outboxId: string, workerId: string): Promise<ChildResult> => runProcess(envFor(mode, outboxId, workerId));
    const waitForAvailable = async (outboxId: string): Promise<void> => waitUntil(`retryable outbox ${outboxId}`, async () => {
      const state = await outboxState(outboxId);
      const availableAt = new Date(state.availableAt).getTime();
      return state.status === "PENDING" && Number.isFinite(availableAt) && availableAt + 250 <= Date.now();
    }, 8_000);
    const effectCount = async (outboxId: string): Promise<{ requests: number; deliveries: number }> => {
      const rows = await readJsonLines(providerLog);
      return {
        requests: rows.filter((row) => row.kind === "request" && row.op === "deliver" && row.key === outboxId).length,
        deliveries: rows.filter((row) => row.kind === "effect" && row.key === outboxId).length
      };
    };

    {
      const id = await seedOutbox("verify.worker.crash-before-effect");
      const crashed = await run("before-effect", id, "crash-before-effect");
      assertKilledChild(crashed, "crash-before-effect");
      await wait(1_200);
      const recovered = await run("normal-delivery", id, "restart-before-effect");
      assertCleanChild(recovered, "restart-before-effect");
      const state = await outboxState(id);
      const effect = await externalEffect(id);
      const counts = await effectCount(id);
      assertCondition(state.status === "DELIVERED" && effect?.status === "SUCCEEDED" && counts.deliveries === 1 && counts.requests === 1, `before-effect recovery was not exactly-once: ${safeJson({ state, effect, counts })}`);
      result.beforeEffect = { crashed: crashed.signal, restart: JSON.parse(recovered.stdout.trim()), state: state.status, effect: effect.status, counts };
    }

    {
      const id = await seedOutbox("verify.worker.crash-after-effect-before-outcome");
      const crashed = await run("crash-after-effect-before-outcome", id, "crash-after-effect");
      assertKilledChild(crashed, "crash-after-effect-before-outcome");
      const marker = await externalEffect(id);
      assertCondition(marker?.status === "DISPATCHED", `provider effect was not preceded by a durable dispatch marker: ${safeJson(marker)}`);
      await wait(1_200);
      const recovered = await run("replay-after-effect", id, "restart-after-effect");
      assertCleanChild(recovered, "restart-after-effect");
      const unknown = await externalEffect(id);
      assertCondition(unknown?.status === "OUTCOME_UNKNOWN", `dispatch marker did not become OUTCOME_UNKNOWN: ${safeJson(unknown)}`);
      const reconciled = await run("reconcile", id, "reconcile-after-effect");
      assertCleanChild(reconciled, "reconcile-after-effect");
      const state = await outboxState(id);
      const effect = await externalEffect(id);
      const counts = await effectCount(id);
      assertCondition(state.status === "DELIVERED" && effect?.status === "SUCCEEDED" && counts.deliveries === 1 && counts.requests === 1, `after-effect recovery duplicated or lost the effect: ${safeJson({ state, effect, counts })}`);
      result.afterEffectBeforeOutcome = { crashed: crashed.signal, restart: JSON.parse(recovered.stdout.trim()), reconciliation: reconciled.stdout.trim(), state: state.status, effect: effect.status, counts };
    }

    {
      const id = await seedOutbox("verify.worker.crash-after-outcome-before-ack");
      const crashed = await run("after-outcome-before-ack", id, "crash-after-outcome");
      assertKilledChild(crashed, "crash-after-outcome-before-ack");
      const committed = await externalEffect(id);
      assertCondition(committed?.status === "SUCCEEDED", `effect outcome was not committed before the crash: ${safeJson(committed)}`);
      await wait(1_200);
      const recovered = await run("replay-after-outcome", id, "restart-after-outcome");
      assertCleanChild(recovered, "restart-after-outcome");
      const state = await outboxState(id);
      const counts = await effectCount(id);
      assertCondition(state.status === "DELIVERED" && counts.deliveries === 1 && counts.requests === 1, `after-outcome replay did not only acknowledge the committed effect: ${safeJson({ state, counts })}`);
      result.afterOutcomeBeforeAck = { crashed: crashed.signal, restart: JSON.parse(recovered.stdout.trim()), state: state.status, counts };
    }

    {
      const id = await seedOutbox("verify.worker.crash-after-ack");
      const crashed = await run("after-ack", id, "crash-after-ack");
      assertKilledChild(crashed, "crash-after-ack");
      const beforeRestart = await outboxState(id);
      assertCondition(beforeRestart.status === "DELIVERED", `ack was not durable before post-ack crash: ${safeJson(beforeRestart)}`);
      const restarted = await run("replay-after-ack", id, "restart-after-ack");
      assertCleanChild(restarted, "restart-after-ack");
      const state = await outboxState(id);
      const counts = await effectCount(id);
      assertCondition(state.status === "DELIVERED" && counts.deliveries === 1 && counts.requests === 1, `post-ack restart redelivered work: ${safeJson({ state, counts })}`);
      result.afterAck = { crashed: crashed.signal, restart: JSON.parse(restarted.stdout.trim()), state: state.status, counts };
    }

    {
      const id = await seedOutbox("verify.worker.lease-loss");
      const holder = startedChild(envFor("lease-holder", id, "lease-holder-a"));
      await waitForOutput(holder, "LEASE_CLAIMED ");
      await wait(1_100);
      const recovered = await run("normal-delivery", id, "lease-holder-b");
      assertCleanChild(recovered, "lease-holder-b");
      const holderResult = await holder.result;
      assertCleanChild(holderResult, "lease-holder-a");
      assertCondition(holderResult.stdout.includes("LEASE_ACK_REJECTED"), `stale lease acknowledgement was not rejected: ${holderResult.stdout} ${holderResult.stderr}`);
      const state = await outboxState(id);
      const counts = await effectCount(id);
      assertCondition(state.status === "DELIVERED" && counts.deliveries === 1, `lease takeover did not produce one durable delivery: ${safeJson({ state, counts })}`);
      result.leaseLoss = { holder: holderResult.stdout.trim(), recovery: JSON.parse(recovered.stdout.trim()), state: state.status, counts };
    }

    {
      const id = await seedOutbox("verify.worker.duplicate");
      const first = await run("normal-delivery", id, "duplicate-worker-a");
      const second = await run("replay-after-ack", id, "duplicate-worker-b");
      assertCleanChild(first, "duplicate-worker-a");
      assertCleanChild(second, "duplicate-worker-b");
      const state = await outboxState(id);
      const counts = await effectCount(id);
      const secondResult = JSON.parse(second.stdout.trim()) as { result?: { claimed?: number } };
      assertCondition(state.status === "DELIVERED" && secondResult.result?.claimed === 0 && counts.deliveries === 1 && counts.requests === 1, `duplicate worker produced a second effect: ${safeJson({ state, secondResult, counts })}`);
      result.duplicate = { first: JSON.parse(first.stdout.trim()), second: secondResult, state: state.status, counts };
    }

    {
      const id = await seedOutbox("verify.worker.poison-retryable");
      const first = await run("poison-attempt", id, "poison-worker-a");
      assertCleanChild(first, "poison-worker-a");
      await waitForAvailable(id);
      const second = await run("poison-attempt", id, "poison-worker-b");
      assertCleanChild(second, "poison-worker-b");
      const third = await run("poison-attempt", id, "poison-worker-c");
      assertCleanChild(third, "poison-worker-c");
      const state = await outboxState(id);
      const thirdResult = JSON.parse(third.stdout.trim()) as { result?: { claimed?: number } };
      assertCondition(state.status === "QUARANTINED" && state.attempts === 2 && thirdResult.result?.claimed === 0, `poison retry did not exhaust into quarantine: ${safeJson({ state, first: first.stdout, second: second.stdout, thirdResult })}`);
      result.poisonRetryable = { first: JSON.parse(first.stdout.trim()), second: JSON.parse(second.stdout.trim()), third: thirdResult, state: state.status, attempts: state.attempts };
    }

    {
      const id = await seedOutbox("verify.worker.outcome-unknown");
      const first = await run("outcome-unknown", id, "unknown-worker-a");
      assertCleanChild(first, "unknown-worker-a");
      const second = await run("replay-after-unknown", id, "unknown-worker-b");
      assertCleanChild(second, "unknown-worker-b");
      const unknown = await externalEffect(id);
      const secondResult = JSON.parse(second.stdout.trim()) as { result?: { claimed?: number }; sinkCalls?: number };
      assertCondition(unknown?.status === "OUTCOME_UNKNOWN" && secondResult.result?.claimed === 0 && secondResult.sinkCalls === 0, `OUTCOME_UNKNOWN was retried blindly: ${safeJson({ unknown, secondResult })}`);
      const reconciled = await run("reconcile", id, "unknown-reconciler");
      assertCleanChild(reconciled, "unknown-reconciler");
      const state = await outboxState(id);
      const effect = await externalEffect(id);
      const counts = await effectCount(id);
      assertCondition(state.status === "DELIVERED" && effect?.status === "SUCCEEDED" && counts.deliveries === 1 && counts.requests === 1, `OUTCOME_UNKNOWN reconciliation was not durable: ${safeJson({ state, effect, counts })}`);
      result.outcomeUnknown = { first: JSON.parse(first.stdout.trim()), second: secondResult, reconciliation: reconciled.stdout.trim(), state: state.status, effect: effect.status, counts };
    }

    process.stdout.write(`POSTGRES_WORKER_CRASH_RESTART_VERIFIED ${JSON.stringify(result)}\n`);
  } finally {
    if (providerChild) await stopProcess(providerChild).catch(() => undefined);
    await reader?.end().catch(() => undefined);
    await persistence?.close().catch(() => undefined);
    if (created) await admin.query(`drop database if exists ${quoteIdentifier(databaseName)} with (force)`).catch(() => undefined);
    await admin.end().catch(() => undefined);
    await rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function waitUntil(label: string, predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await wait(100);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function main(): Promise<void> {
  if (providerChildMode) return runProviderChild();
  if (workerChildMode) return runWorkerChild(workerChildMode);
  return runParent();
}

try {
  await main();
} catch (error) {
  process.stderr.write(`POSTGRES_WORKER_CRASH_RESTART_FAILED ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
