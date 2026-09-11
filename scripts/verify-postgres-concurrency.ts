import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CvgStore } from "@cvg/domain";
import { PostgresPersistence } from "@cvg/persistence";

/**
 * This verifier deliberately uses OS processes. Two Pool instances in one
 * event loop are useful smoke coverage, but they do not prove the admission
 * boundary used by separately deployed API/worker processes.
 */
const databaseUrl = process.env.DATABASE_URL;
const childMode = process.env.CVG_POSTGRES_CONCURRENCY_CHILD === "1";
if (!databaseUrl) {
  process.stderr.write("POSTGRES_CONCURRENCY_BLOCKED_EXTERNAL DATABASE_URL is required\n");
  process.exit(2);
}

const store = new CvgStore({ bootstrapPassword: process.env.CVG_BOOTSTRAP_PASSWORD ?? "synthetic-password-123" });
const organizationId = store.bootstrapCredentials.organizationId;
const actorId = store.bootstrapCredentials.userId;
const key = process.env.CVG_POSTGRES_CONCURRENCY_KEY ?? `verify-postgres-concurrent-${randomUUID()}`;
const conflict = process.env.CVG_POSTGRES_CONCURRENCY_CONFLICT === "1";
const input = {
  organizationId,
  actorId,
  sessionId: null,
  operation: "verify.postgres.concurrent",
  key,
  resourceId: null,
  unitId: null,
  workspaceId: null,
  body: { verification: conflict ? "different-digest" : "same-key-two-processes" }
};

const wait = async (milliseconds: number): Promise<void> => await new Promise((resolve) => setTimeout(resolve, milliseconds));

async function runChild(): Promise<void> {
  const persistence = new PostgresPersistence({ connectionString: databaseUrl! });
  try {
    const claim = await persistence.claimCommandReceipt(input);
    process.stdout.write(`${JSON.stringify({ kind: "claim", status: claim.status })}\n`);
    if (conflict) {
      if (claim.status !== "CONFLICT") throw new Error(`expected IDEMPOTENCY_CONFLICT, observed ${claim.status}`);
      return;
    }

    if (claim.status === "CLAIMED") {
      // Keep the durable reservation open long enough for the other OS
      // process to observe IN_FLIGHT, then complete through the canonical
      // snapshot commit path (the same path used by API commands).
      await wait(1_500);
      const latest = await persistence.loadLatest(organizationId);
      if (!latest) throw new Error("the verification database has no canonical bootstrap snapshot");
      const completedAt = new Date().toISOString();
      await persistence.commit({
        expectedRevision: latest.revision,
        snapshot: latest.snapshot,
        eventType: "SYSTEM",
        operation: "verify.postgres.concurrent.complete",
        organizationId,
        actorId,
        correlationId: randomUUID(),
        aggregateType: "command_receipt",
        aggregateId: claim.receipt.id,
        payload: { verification: "same-key-two-processes", processBoundary: true },
        commandReceipts: [{ ...claim.receipt, status: "SUCCEEDED", result: { verified: true }, completedAt }]
      });
      process.stdout.write(`${JSON.stringify({ kind: "settled", status: "SUCCEEDED" })}\n`);
    }
  } finally {
    await persistence.close();
  }
}

async function requireCanonicalBootstrap(): Promise<boolean> {
  const persistence = new PostgresPersistence({ connectionString: databaseUrl! });
  try {
    const latest = await persistence.loadLatest(organizationId);
    if (latest) return true;
    process.stderr.write("POSTGRES_CONCURRENCY_BLOCKED_EXTERNAL canonical bootstrap snapshot is required\n");
    return false;
  } catch (error) {
    process.stderr.write(`POSTGRES_CONCURRENCY_BLOCKED_EXTERNAL canonical bootstrap preflight failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return false;
  } finally {
    await persistence.close();
  }
}

interface ChildResult {
  status: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function runProcess(environment: NodeJS.ProcessEnv): Promise<ChildResult> {
  const script = fileURLToPath(import.meta.url);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", script], {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      const claimLine = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith("{\"kind\":\"claim\""));
      if (!claimLine) {
        resolve({ status: "NO_CLAIM", stdout, stderr, exitCode });
        return;
      }
      try {
        const parsed = JSON.parse(claimLine) as { status?: unknown };
        resolve({ status: typeof parsed.status === "string" ? parsed.status : "INVALID", stdout, stderr, exitCode });
      } catch {
        resolve({ status: "INVALID", stdout, stderr, exitCode });
      }
    });
  });
}

async function runParent(): Promise<void> {
  const childEnvironment = {
    ...process.env,
    CVG_POSTGRES_CONCURRENCY_CHILD: "1",
    CVG_POSTGRES_CONCURRENCY_KEY: key,
    CVG_POSTGRES_CONCURRENCY_CONFLICT: "0"
  } satisfies NodeJS.ProcessEnv;
  const [first, second] = await Promise.all([runProcess(childEnvironment), runProcess(childEnvironment)]);
  const claims = [first, second].map((child) => child.status).sort();
  if (first.exitCode !== 0 || second.exitCode !== 0) throw new Error(`child process failed: ${JSON.stringify({ first, second })}`);
  if (claims[0] !== "CLAIMED" || claims[1] !== "IN_FLIGHT") throw new Error(`expected one CLAIMED and one IN_FLIGHT from separate processes, observed ${claims.join(",")}`);

  const replay = await runProcess({ ...childEnvironment, CVG_POSTGRES_CONCURRENCY_REPLAY: "1" });
  if (replay.exitCode !== 0 || replay.status !== "REPLAY") throw new Error(`expected a durable replay after the winning process committed, observed ${JSON.stringify(replay)}`);

  const divergent = await runProcess({ ...childEnvironment, CVG_POSTGRES_CONCURRENCY_CONFLICT: "1" });
  if (divergent.exitCode !== 0 || divergent.status !== "CONFLICT") throw new Error(`expected IDEMPOTENCY_CONFLICT for a divergent body, observed ${JSON.stringify(divergent)}`);

  process.stdout.write(`POSTGRES_CONCURRENCY_VERIFIED processes=2 claims=${claims.join(",")} replay=REPLAY conflict=IDEMPOTENCY_CONFLICT duplicateEffects=0\n`);
}

try {
  if (childMode) await runChild();
  else if (await requireCanonicalBootstrap()) await runParent();
  else process.exitCode = 2;
} catch (error) {
  process.stderr.write(`POSTGRES_CONCURRENCY_FAILED ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
