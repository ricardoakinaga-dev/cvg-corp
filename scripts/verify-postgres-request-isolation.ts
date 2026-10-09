import { randomUUID } from "node:crypto";
import { CvgStore } from "@cvg/domain";
import { createRuntime } from "@cvg/api";
import { PostgresPersistence } from "@cvg/persistence";

/**
 * CVG-AUD19-014: proves that a remote-boundary request runs against an
 * isolated fork of the durable baseline.  While its commit is blocked:
 *  - the canonical store does not expose the uncommitted session/turn;
 *  - a concurrent durable writer can move the revision;
 * and when the blocked commit finally runs, the CAS conflict discards the
 * request's work instead of persisting it with a failure response.
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write("POSTGRES_ISOLATION_BLOCKED_EXTERNAL DATABASE_URL is required\n");
  process.exit(2);
}
const bootstrapPassword = process.env.CVG_BOOTSTRAP_PASSWORD ?? "synthetic-password-123";

interface CommitGate {
  persistence: PostgresPersistence;
  reached: Promise<void>;
  arm(): void;
  release(): void;
}

function withCommitGate(real: PostgresPersistence): CommitGate {
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
  let reachedResolve!: () => void;
  const reached = new Promise<void>((resolve) => { reachedResolve = resolve; });
  let armed = false;
  let blocked = false;
  const proxy = new Proxy(real, {
    get(target, property, receiver) {
      if (property === "commit") {
        return async (input: unknown) => {
          const payload = (input as { payload?: { path?: unknown } }).payload;
          if (armed && !blocked && payload?.path === "/api/v1/ai/turns") {
            blocked = true;
            reachedResolve();
            await gate;
          }
          return (target.commit as (value: unknown) => Promise<unknown>)(input);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  return { persistence: proxy as PostgresPersistence, reached, arm: () => { armed = true; }, release: releaseGate };
}

const organizationId = new CvgStore({ bootstrapPassword }).bootstrapCredentials.organizationId;
const store = new CvgStore({ bootstrapPassword });
const realPersistence = new PostgresPersistence({ connectionString: databaseUrl });
const gate = withCommitGate(realPersistence);
let runtime: Awaited<ReturnType<typeof createRuntime>> | null = null;
let conflictWriter: PostgresPersistence | null = null;
try {
  runtime = await createRuntime({
    store,
    persistence: gate.persistence,
    config: { storageMode: "postgres", demoMode: true, databaseUrl, bootstrapPassword, agentRuntimeMode: "embedded" }
  });
  const login = await runtime.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { "content-type": "application/json" }, payload: JSON.stringify({ login: "admin@cvg.local", password: bootstrapPassword }) });
  if (login.statusCode !== 200) throw new Error(`isolation drill could not authenticate: ${login.statusCode}`);
  const cookieHeaders = (Array.isArray(login.headers["set-cookie"]) ? login.headers["set-cookie"] : [login.headers["set-cookie"]]).filter((value): value is string => typeof value === "string");
  const cookie = cookieHeaders.map((value) => value.split(";")[0]).join("; ");
  const csrfCookie = cookieHeaders.find((value) => value.startsWith("cvg_csrf="));
  const csrf = csrfCookie ? decodeURIComponent(csrfCookie.split("=")[1]!.split(";")[0]!) : "";
  const contexts = await runtime.app.inject({ method: "GET", url: "/api/v1/contexts", headers: { cookie } });
  const contextList = (contexts.json() as { data?: Array<{ unit: { id: string }; workspace: { id: string } }> }).data ?? [];
  const context = contextList[0];
  if (!context) throw new Error("isolation drill has no authenticated context");

  // Positive control: a normal turn commits through the fork adoption path.
  const controlKey = `iso-control-${randomUUID()}`;
  const control = await runtime.app.inject({
    method: "POST",
    url: "/api/v1/ai/turns",
    headers: { cookie, "content-type": "application/json", "x-csrf-token": csrf, "x-cvg-unit-id": context.unit.id, "x-cvg-workspace-id": context.workspace.id, "idempotency-key": controlKey },
    payload: JSON.stringify({ sessionId: null, prompt: "controle de isolamento", purpose: "SUMMARY", patientId: null, encounterId: null, requestedTool: null, idempotencyKey: controlKey })
  });
  if (control.statusCode !== 201) throw new Error(`control turn failed: ${control.statusCode} ${control.body.slice(0, 300)}`);
  const controlTurn = (control.json() as { data: { turn: { id: string }; session: { id: string } } }).data;
  const afterControl = await realPersistence.loadLatest(organizationId);
  if (!afterControl?.snapshot.aiTurns.some((turn) => turn.id === controlTurn.turn.id)) throw new Error("control turn was not durably persisted through the fork adoption path");

  // Blocked turn: its commit is held while we inspect the canonical state.
  const blockedKey = `iso-blocked-${randomUUID()}`;
  gate.arm();
  const blockedRequest = runtime.app.inject({
    method: "POST",
    url: "/api/v1/ai/turns",
    headers: { cookie, "content-type": "application/json", "x-csrf-token": csrf, "x-cvg-unit-id": context.unit.id, "x-cvg-workspace-id": context.workspace.id, "idempotency-key": blockedKey },
    payload: JSON.stringify({ sessionId: null, prompt: "turno bloqueado no commit", purpose: "SUMMARY", patientId: null, encounterId: null, requestedTool: null, idempotencyKey: blockedKey })
  });
  await gate.reached;
  const canonicalDuringBlock = store.snapshot();
  if (canonicalDuringBlock.aiTurns.some((turn) => turn.usage?.idempotencyKey?.includes("iso-blocked") || turn.prompt === "turno bloqueado no commit")) throw new Error("the canonical store exposed an uncommitted remote-boundary turn");
  const durableDuringBlock = await realPersistence.loadLatest(organizationId);
  if (durableDuringBlock?.snapshot.aiTurns.some((turn) => turn.prompt === "turno bloqueado no commit")) throw new Error("the durable snapshot exposed an uncommitted remote-boundary turn");

  // A concurrent writer moves the revision while the blocked commit waits.
  conflictWriter = new PostgresPersistence({ connectionString: databaseUrl });
  const latest = await conflictWriter.loadLatest(organizationId);
  if (!latest) throw new Error("isolation drill lost the durable baseline");
  await conflictWriter.commit({
    expectedRevision: latest.revision,
    snapshot: latest.snapshot,
    eventType: "SYSTEM",
    operation: "verify.postgres.isolation.conflict",
    organizationId,
    actorId: null,
    correlationId: "verify-postgres-isolation-conflict",
    aggregateType: "Verification",
    aggregateId: null,
    payload: { synthetic: true }
  });

  gate.release();
  const blockedResponse = await blockedRequest;
  if (blockedResponse.statusCode !== 409) throw new Error(`the conflicting remote turn must fail with 409, observed ${blockedResponse.statusCode} ${blockedResponse.body.slice(0, 300)}`);
  const afterConflict = await realPersistence.loadLatest(organizationId);
  if (afterConflict?.snapshot.aiTurns.some((turn) => turn.prompt === "turno bloqueado no commit")) throw new Error("a conflicting request persisted its work despite the failure response");
  if (store.snapshot().aiTurns.some((turn) => turn.prompt === "turno bloqueado no commit")) throw new Error("a conflicting request left its mutation applied in the canonical store");
  const conflictTurnId = (blockedResponse.json() as { data?: { turn?: { id?: string } }; error?: { code?: string } }).error?.code ?? "CONFLICT";
  console.log(JSON.stringify({ requestIsolation: "PASS", controlCommitted: true, blockedTurnInvisible: true, conflictStatus: blockedResponse.statusCode, conflictCode: conflictTurnId, uncommittedTurnDiscarded: true, revisionBefore: latest.revision.toString(), revisionAfter: afterConflict?.revision.toString() }, null, 2));
} catch (error) {
  process.stderr.write(`POSTGRES_ISOLATION_FAILED ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  if (runtime) await runtime.app.close().catch(() => undefined);
  await conflictWriter?.close().catch(() => undefined);
  await realPersistence.close().catch(() => undefined);
}
