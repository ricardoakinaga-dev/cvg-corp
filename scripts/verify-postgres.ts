import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import pg from "pg";
import { createRuntime, type CvgServerRuntime } from "@cvg/api";
import { id } from "@cvg/contracts";
import { digest } from "@cvg/domain";
import { OutboxWorker, type ExternalEffectQueryAdapter } from "@cvg/integrations";
import { OutboxLeaseLostError, PersistenceConflictError, PersistenceStateError, PostgresPersistence, type DurableInboxInput } from "@cvg/persistence";
import { AgentSessionError, PostgresAgentSessionStore, createScopedSqlExecutor } from "@cvg/agent-session";
import { verifyAgentSessionTtlContract } from "./lib/agent-session-contract.ts";

const AGENT_SESSION_TTL_VERIFICATION_MS = 120_000;

type AgentSessionTtlPhase = "AT_LIMIT" | "AFTER_LIMIT";

async function expireAgentSession(pool: pg.Pool, organizationId: string, sessionId: string, phase: AgentSessionTtlPhase): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('cvg.organization_id', $1, true)", [organizationId]);
    const offsetMs = phase === "AT_LIMIT" ? "0" : "1";
    const result = await client.query(
      "update agent_sessions set expires_at = now() - ($3 || ' milliseconds')::interval, updated_at = now() where session_id = $1 and organization_id = $2",
      [sessionId, organizationId, offsetMs]
    );
    if (result.rowCount !== 1) throw new Error(`agent session expiry probe updated ${result.rowCount ?? 0} rows for ${phase}`);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function verifyAgentSessionTtlMatrix(input: {
  primary: PostgresAgentSessionStore;
  secondary: PostgresAgentSessionStore;
  expiryPool: pg.Pool;
  organizationId: string;
  actorId: string;
  unitId: string;
  workspaceId: string;
}): Promise<string[]> {
  const failures: string[] = [];
  for (let iteration = 1; iteration <= 20; iteration += 1) {
    const sessionId = randomUUID();
    await input.primary.create({ sessionId, organizationId: input.organizationId, actorId: input.actorId, unitId: input.unitId, workspaceId: input.workspaceId, purpose: "SUMMARY", taskObjective: `ttl-matrix-${iteration}`, ttlMs: AGENT_SESSION_TTL_VERIFICATION_MS });
    if (!(await input.primary.load(sessionId, { organizationId: input.organizationId, actorId: input.actorId }))) failures.push(`iteration ${iteration}: session must load before expiry`);
    const lease = await input.primary.acquireLease({ sessionId, organizationId: input.organizationId, ownerId: `ttl-owner-a-${iteration}`, ttlMs: AGENT_SESSION_TTL_VERIFICATION_MS });
    if (!lease) {
      failures.push(`iteration ${iteration}: primary pool must acquire the lease before expiry`);
      continue;
    }
    if (await input.secondary.acquireLease({ sessionId, organizationId: input.organizationId, ownerId: `ttl-owner-b-${iteration}`, ttlMs: AGENT_SESSION_TTL_VERIFICATION_MS })) failures.push(`iteration ${iteration}: secondary pool bypassed the live owner fence`);
    if (!(await input.primary.renewLease({ sessionId, organizationId: input.organizationId, ownerId: lease.ownerId, ttlMs: AGENT_SESSION_TTL_VERIFICATION_MS, fence: lease.fence }))) failures.push(`iteration ${iteration}: primary pool could not renew before expiry`);

    await expireAgentSession(input.expiryPool, input.organizationId, sessionId, "AT_LIMIT");
    if (await input.secondary.load(sessionId, { organizationId: input.organizationId, actorId: input.actorId })) failures.push(`iteration ${iteration}: session loaded at the expiry boundary`);
    if (await input.secondary.acquireLease({ sessionId, organizationId: input.organizationId, ownerId: `ttl-owner-b-at-${iteration}`, ttlMs: AGENT_SESSION_TTL_VERIFICATION_MS })) failures.push(`iteration ${iteration}: secondary pool acquired at the expiry boundary`);
    if (await input.primary.renewLease({ sessionId, organizationId: input.organizationId, ownerId: lease.ownerId, ttlMs: AGENT_SESSION_TTL_VERIFICATION_MS, fence: lease.fence })) failures.push(`iteration ${iteration}: primary pool renewed at the expiry boundary`);

    await expireAgentSession(input.expiryPool, input.organizationId, sessionId, "AFTER_LIMIT");
    if (await input.primary.load(sessionId, { organizationId: input.organizationId, actorId: input.actorId })) failures.push(`iteration ${iteration}: session loaded after expiry`);
    if (await input.secondary.acquireLease({ sessionId, organizationId: input.organizationId, ownerId: `ttl-owner-b-after-${iteration}`, ttlMs: AGENT_SESSION_TTL_VERIFICATION_MS })) failures.push(`iteration ${iteration}: secondary pool acquired after expiry`);
    if (await input.primary.renewLease({ sessionId, organizationId: input.organizationId, ownerId: lease.ownerId, ttlMs: AGENT_SESSION_TTL_VERIFICATION_MS, fence: lease.fence })) failures.push(`iteration ${iteration}: primary pool renewed after expiry`);
    await input.primary.releaseLease({ sessionId, organizationId: input.organizationId, ownerId: lease.ownerId, fence: lease.fence });
  }
  return failures;
}

const databaseUrl = process.env.DATABASE_URL;
const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;
if (!databaseUrl || !migrationDatabaseUrl) {
  process.stderr.write("POSTGRES_BLOCKED_EXTERNAL DATABASE_URL and MIGRATION_DATABASE_URL are required; use explicitly identified runtime and schema-owner databases\n");
  process.exit(2);
}
const configuredDatabaseUrl = databaseUrl;

const bootstrapPassword = process.env.CVG_BOOTSTRAP_PASSWORD ?? "synthetic-password-123";
const runtimeConfig = { storageMode: "postgres" as const, demoMode: true, databaseUrl, bootstrapPassword };
const guardianPayload = JSON.stringify({ displayName: "Postgres Verification Guardian", phone: "+55 11 90000-0099", email: "postgres-verification@example.test" });
const guardianIdempotencyKey = "verify-postgres-guardian-v2";
const syntheticInboxSigningKey = "cvg-synthetic-inbox-signing-key";
const syntheticProviderQueryAdapter: ExternalEffectQueryAdapter = {
  integrationIds: ["outbox:verify.external.unknown"],
  query: async ({ signal }) => {
    if (signal.aborted) throw new Error("synthetic provider query timed out");
    return { status: "SUCCEEDED", providerRequestId: "synthetic-provider-effect-1", response: { synthetic: true, confirmed: true }, source: "SYNTHETIC_PROVIDER_QUERY" };
  }
};

function inboxSignature(input: Omit<DurableInboxInput, "signature">): string {
  const signedDigest = digest({ organizationId: input.organizationId, consumer: input.consumer, provider: input.provider, externalEventId: input.externalEventId, eventType: input.eventType, schemaVersion: input.schemaVersion, signatureAlgorithm: input.signatureAlgorithm, signatureKeyRef: input.signatureKeyRef, payload: input.payload });
  return createHmac("sha256", syntheticInboxSigningKey).update(signedDigest).digest("hex");
}

function rawInboxSignature(rawBody: string): string {
  return createHmac("sha256", syntheticInboxSigningKey).update(rawBody, "utf8").digest("hex");
}

function verifySyntheticInboxSignature(input: DurableInboxInput): boolean {
  if (input.signatureAlgorithm !== "HMAC-SHA256" || input.signatureKeyRef !== "synthetic-test-key" || !/^[a-f0-9]{64}$/.test(input.signature)) return false;
  const expected = input.rawBody ? rawInboxSignature(input.rawBody) : inboxSignature(input);
  return timingSafeEqual(Buffer.from(input.signature, "utf8"), Buffer.from(expected, "utf8"));
}

function newDurablePersistence(): PostgresPersistence {
  return new PostgresPersistence({ connectionString: configuredDatabaseUrl, inboxSignatureVerifier: verifySyntheticInboxSignature });
}

async function expectSqlRejected(client: { query: (text: string, values?: unknown[]) => Promise<unknown> }, label: string, text: string, values: unknown[]): Promise<void> {
  try {
    await client.query(text, values);
  } catch {
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

async function expectRlsDenied(client: { query: (text: string, values?: unknown[]) => Promise<unknown> }, label: string, text: string, values: unknown[]): Promise<void> {
  try {
    await client.query(text, values);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
    if (code === "42501") return;
    throw new Error(`${label} failed with SQLSTATE ${String(code ?? "UNKNOWN")} instead of row-level security denial`);
  }
  throw new Error(`${label} crossed the requested PostgreSQL row-level security scope`);
}

async function expectRlsInsertDenied(input: {
  client: pg.Client;
  label: string;
  sql: string;
  values: unknown[];
  organizationId: string;
  unitId: string;
  workspaceId: string;
}): Promise<void> {
  await input.client.query("begin");
  try {
    await input.client.query(
      "select set_config('cvg.organization_id', $1, true), set_config('cvg.unit_id', $2, true), set_config('cvg.workspace_id', $3, true)",
      [input.organizationId, input.unitId, input.workspaceId]
    );
    await expectRlsDenied(input.client, input.label, input.sql, input.values);
  } finally {
    await input.client.query("rollback");
  }
}

async function expectRlsRowCount(input: {
  client: pg.Client;
  label: string;
  table: "audit_records" | "command_receipts" | "role_assignments";
  rowId: string;
  expectedCount: 0 | 1;
  organizationId: string;
  unitId: string;
  workspaceId: string;
}): Promise<void> {
  await input.client.query("begin");
  try {
    await input.client.query(
      "select set_config('cvg.organization_id', $1, true), set_config('cvg.unit_id', $2, true), set_config('cvg.workspace_id', $3, true)",
      [input.organizationId, input.unitId, input.workspaceId]
    );
    const result = await input.client.query<{ count: number }>(`select count(*)::int as count from ${input.table} where id = $1`, [input.rowId]);
    const count = result.rows[0]?.count ?? -1;
    if (count !== input.expectedCount) throw new Error(`${input.label} returned ${count} rows; expected ${input.expectedCount}`);
  } finally {
    await input.client.query("rollback");
  }
}

async function expectRlsDmlRowCount(input: {
  client: pg.Client;
  label: string;
  sql: string;
  values: unknown[];
  expectedCount: 0 | 1;
  organizationId: string;
  unitId: string;
  workspaceId: string;
}): Promise<void> {
  await input.client.query("begin");
  try {
    await input.client.query(
      "select set_config('cvg.organization_id', $1, true), set_config('cvg.unit_id', $2, true), set_config('cvg.workspace_id', $3, true)",
      [input.organizationId, input.unitId, input.workspaceId]
    );
    const result = await input.client.query(input.sql, input.values);
    const count = result.rowCount ?? result.rows.length;
    if (count !== input.expectedCount) throw new Error(`${input.label} affected ${count} rows; expected ${input.expectedCount}`);
  } finally {
    await input.client.query("rollback");
  }
}

async function expectScopedDmlSqlState(input: {
  client: pg.Client;
  label: string;
  sql: string;
  values: unknown[];
  expectedSqlState: string;
  organizationId: string;
  unitId: string;
  workspaceId: string;
}): Promise<void> {
  await input.client.query("begin");
  try {
    await input.client.query(
      "select set_config('cvg.organization_id', $1, true), set_config('cvg.unit_id', $2, true), set_config('cvg.workspace_id', $3, true)",
      [input.organizationId, input.unitId, input.workspaceId]
    );
    try {
      await input.client.query(input.sql, input.values);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code === input.expectedSqlState) return;
      throw new Error(`${input.label} failed with SQLSTATE ${String(code ?? "UNKNOWN")} instead of ${input.expectedSqlState}`);
    }
    throw new Error(`${input.label} unexpectedly succeeded`);
  } finally {
    await input.client.query("rollback");
  }
}

type AuthenticatedContext = {
  headers: Record<string, string>;
  unitId: string;
  workspaceId: string;
};

async function login(runtime: CvgServerRuntime, credentials: { login: string; password: string } = { login: "admin@cvg.local", password: bootstrapPassword }): Promise<AuthenticatedContext> {
  const result = await runtime.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify(credentials)
  });
  if (result.statusCode !== 200) throw new Error(`login failed with ${result.statusCode}: ${result.body}`);
  const body = JSON.parse(result.body) as { data: { csrfToken: string; contexts: Array<{ unit: { id: string }; workspace: { id: string } }> } };
  const cookies = result.headers["set-cookie"];
  const cookie = Array.isArray(cookies) ? cookies.map((value) => value.split(";", 1)[0]).join("; ") : String(cookies ?? "");
  const selected = body.data.contexts[0];
  if (!selected) throw new Error("login returned no authorized context");
  return {
    headers: {
      cookie,
      "x-csrf-token": body.data.csrfToken,
      "x-cvg-unit-id": selected.unit.id,
      "x-cvg-workspace-id": selected.workspace.id,
      "content-type": "application/json"
    },
    unitId: selected.unit.id,
    workspaceId: selected.workspace.id
  };
}

async function exercise(runtime: CvgServerRuntime): Promise<{ receiptId: string; guardianId: string; auth: AuthenticatedContext }> {
  const auth = await login(runtime);
  const result = await runtime.app.inject({
    method: "POST",
    url: "/api/v1/guardians",
    headers: { ...auth.headers, "idempotency-key": guardianIdempotencyKey },
    payload: guardianPayload
  });
  if (result.statusCode !== 201) throw new Error(`durable mutation failed with ${result.statusCode}: ${result.body}; diagnostics=${JSON.stringify(runtime.telemetry.logs)}`);
  const body = JSON.parse(result.body) as { data: { guardian: { id: string }; receiptId: string } };
  const replay = await runtime.app.inject({
    method: "POST",
    url: "/api/v1/guardians",
    headers: { ...auth.headers, "idempotency-key": guardianIdempotencyKey },
    payload: guardianPayload
  });
  if (replay.statusCode !== 201) throw new Error(`idempotent replay failed with ${replay.statusCode}: ${replay.body}`);
  const replayBody = JSON.parse(replay.body) as { data: { guardian: { id: string }; receiptId: string } };
  if (replayBody.data.receiptId !== body.data.receiptId || replayBody.data.guardian.id !== body.data.guardian.id) throw new Error("idempotent replay returned a different receipt or resource");
  return { receiptId: body.data.receiptId, guardianId: body.data.guardian.id, auth };
}

async function exerciseDiagnosticRequest(runtime: CvgServerRuntime, patientId: string): Promise<{ requestId: string; encounterId: string; specimenId: string; resultId: string; auth: AuthenticatedContext }> {
  const auth = await login(runtime, { login: "ana.vet@cvg.local", password: "veterinario-synthetic-0002" });
  const encounter = await runtime.app.inject({
    method: "POST",
    url: "/api/v1/encounters",
    headers: { ...auth.headers, "idempotency-key": "verify-postgres-diagnostic-encounter-v1" },
    payload: JSON.stringify({ patientId, appointmentId: null, chiefComplaint: "synthetic diagnostic verification", urgency: "ROUTINE" })
  });
  if (encounter.statusCode !== 201) throw new Error(`diagnostic verification encounter failed with ${encounter.statusCode}: ${encounter.body}`);
  const encounterBody = JSON.parse(encounter.body) as { data: { encounter: { id: string } } };
  const encounterId = encounterBody.data.encounter.id;
  const payload = JSON.stringify({ patientId, encounterId, testName: "Postgres diagnostic verification", priority: "ROUTINE" });
  const result = await runtime.app.inject({
    method: "POST",
    url: "/api/v1/diagnostics/requests",
    headers: { ...auth.headers, "idempotency-key": "verify-postgres-diagnostic-v1" },
    payload
  });
  if (result.statusCode !== 201) throw new Error(`diagnostic verification create failed with ${result.statusCode}: ${result.body}`);
  const body = JSON.parse(result.body) as { data: { request: { id: string }; receiptId: string } };
  const replay = await runtime.app.inject({
    method: "POST",
    url: "/api/v1/diagnostics/requests",
    headers: { ...auth.headers, "idempotency-key": "verify-postgres-diagnostic-v1" },
    payload
  });
  if (replay.statusCode !== 201) throw new Error(`diagnostic verification replay failed with ${replay.statusCode}: ${replay.body}`);
  const replayBody = JSON.parse(replay.body) as { data: { request: { id: string }; receiptId: string } };
  if (replayBody.data.request.id !== body.data.request.id || replayBody.data.receiptId !== body.data.receiptId) throw new Error("diagnostic verification replay returned a different request or receipt");
  const specimenPayload = JSON.stringify({ label: "Postgres diagnostic specimen" });
  const specimen = await runtime.app.inject({
    method: "POST",
    url: `/api/v1/diagnostics/requests/${body.data.request.id}/specimens`,
    headers: { ...auth.headers, "idempotency-key": "verify-postgres-diagnostic-specimen-v1" },
    payload: specimenPayload
  });
  if (specimen.statusCode !== 201) throw new Error(`diagnostic specimen verification create failed with ${specimen.statusCode}: ${specimen.body}`);
  const specimenBody = JSON.parse(specimen.body) as { data: { specimen: { id: string }; receiptId: string } };
  const specimenReplay = await runtime.app.inject({
    method: "POST",
    url: `/api/v1/diagnostics/requests/${body.data.request.id}/specimens`,
    headers: { ...auth.headers, "idempotency-key": "verify-postgres-diagnostic-specimen-v1" },
    payload: specimenPayload
  });
  if (specimenReplay.statusCode !== 201) throw new Error(`diagnostic specimen verification replay failed with ${specimenReplay.statusCode}: ${specimenReplay.body}`);
  const specimenReplayBody = JSON.parse(specimenReplay.body) as { data: { specimen: { id: string }; receiptId: string } };
  if (specimenReplayBody.data.specimen.id !== specimenBody.data.specimen.id || specimenReplayBody.data.receiptId !== specimenBody.data.receiptId) throw new Error("diagnostic specimen verification replay returned a different specimen or receipt");
  const resultPayload = JSON.stringify({ requestId: body.data.request.id, specimenId: specimenBody.data.specimen.id, value: "synthetic-result-42", source: "synthetic-postgres-lab", sourceVersion: "synthetic-1" });
  const diagnosticResult = await runtime.app.inject({
    method: "POST",
    url: "/api/v1/diagnostics/results",
    headers: { ...auth.headers, "idempotency-key": "verify-postgres-diagnostic-result-v1" },
    payload: resultPayload
  });
  if (diagnosticResult.statusCode !== 201) throw new Error(`diagnostic result verification create failed with ${diagnosticResult.statusCode}: ${diagnosticResult.body}`);
  const resultBody = JSON.parse(diagnosticResult.body) as { data: { result: { id: string }; receiptId: string } };
  const resultReplay = await runtime.app.inject({
    method: "POST",
    url: "/api/v1/diagnostics/results",
    headers: { ...auth.headers, "idempotency-key": "verify-postgres-diagnostic-result-v1" },
    payload: resultPayload
  });
  if (resultReplay.statusCode !== 201) throw new Error(`diagnostic result verification replay failed with ${resultReplay.statusCode}: ${resultReplay.body}`);
  const resultReplayBody = JSON.parse(resultReplay.body) as { data: { result: { id: string }; receiptId: string } };
  if (resultReplayBody.data.result.id !== resultBody.data.result.id || resultReplayBody.data.receiptId !== resultBody.data.receiptId) throw new Error("diagnostic result verification replay returned a different result or receipt");
  return { requestId: body.data.request.id, encounterId, specimenId: specimenBody.data.specimen.id, resultId: resultBody.data.result.id, auth };
}

const first = await createRuntime({ config: runtimeConfig, persistence: newDurablePersistence(), providerQueryAdapter: syntheticProviderQueryAdapter });
let firstResult: { receiptId: string; guardianId: string; auth: AuthenticatedContext };
try {
  firstResult = await exercise(first);
} finally {
  await first.app.close();
}

const second = await createRuntime({ config: runtimeConfig, persistence: newDurablePersistence(), providerQueryAdapter: syntheticProviderQueryAdapter });
let counts: Record<string, number> | undefined;
let catalogProtection = { domainTables: 0, protectedTables: 0, organizationForeignKeys: 0 };
let usageForAgent: { id: string } | null = null;
const runtimeRole = (process.env.CVG_RUNTIME_DB_USER ?? "cvg_runtime").trim();
let migrationPrivileges: { can_select: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean } | undefined;
try {
  const auth = await login(second);
  const restartedReplay = await second.app.inject({ method: "POST", url: "/api/v1/guardians", headers: { ...firstResult.auth.headers, "idempotency-key": guardianIdempotencyKey }, payload: guardianPayload });
  if (restartedReplay.statusCode !== 201) throw new Error(`restart idempotent replay failed with ${restartedReplay.statusCode}: ${restartedReplay.body}`);
  const restartedBody = JSON.parse(restartedReplay.body) as { data: { guardian: { id: string }; receiptId: string } };
  if (restartedBody.data.receiptId !== firstResult.receiptId || restartedBody.data.guardian.id !== firstResult.guardianId) throw new Error("restart idempotency returned a different receipt or resource");
  const listed = await second.app.inject({ method: "GET", url: "/api/v1/guardians?q=Postgres%20Verification%20Guardian", headers: auth.headers });
  if (listed.statusCode !== 200) throw new Error(`restart read failed with ${listed.statusCode}: ${listed.body}`);
  const listedBody = JSON.parse(listed.body) as { data: { items: Array<{ id: string }> } };
  if (!listedBody.data.items.some((item) => item.id === firstResult.guardianId)) throw new Error("durable guardian was not recovered after restart");

  const patients = await second.app.inject({ method: "GET", url: "/api/v1/patients?q=Luna", headers: auth.headers });
  if (patients.statusCode !== 200) throw new Error(`normalized patient read failed with ${patients.statusCode}: ${patients.body}`);
  const patientsBody = JSON.parse(patients.body) as { data: { items: Array<{ id: string; name: string; guardian?: { displayName: string } }> } };
  const luna = patientsBody.data.items.find((item) => item.name === "Luna");
  if (!luna || luna.guardian?.displayName !== "Marina Souza") throw new Error("normalized patient read did not return the joined guardian projection");

  const fixtureAppointment = [...second.store.appointments.values()].find((item) => item.patientId === luna.id && item.workspaceId === auth.workspaceId);
  if (!fixtureAppointment) throw new Error("persisted Luna appointment fixture is missing");
  const fixtureRange = new URLSearchParams({ startsAt: fixtureAppointment.startsAt, endsAt: fixtureAppointment.endsAt });
  const appointments = await second.app.inject({ method: "GET", url: `/api/v1/appointments?${fixtureRange}`, headers: auth.headers });
  if (appointments.statusCode !== 200) throw new Error(`normalized appointment read failed with ${appointments.statusCode}: ${appointments.body}`);
  const appointmentsBody = JSON.parse(appointments.body) as { data: { items: Array<{ id: string; workspaceId: string; patient?: { name: string }; provider: string | null }> } };
  if (!appointmentsBody.data.items.some((item) => item.workspaceId === auth.workspaceId && item.patient?.name === "Luna" && item.provider === "Dra. Ana Martins")) throw new Error("normalized appointment read did not honor the selected workspace projection");
  const diagnosticVerification = await exerciseDiagnosticRequest(second, luna.id);
  const specimens = await second.app.inject({ method: "GET", url: "/api/v1/diagnostics/specimens", headers: diagnosticVerification.auth.headers });
  if (specimens.statusCode !== 200) throw new Error(`normalized specimen read failed with ${specimens.statusCode}: ${specimens.body}`);
  const specimensBody = JSON.parse(specimens.body) as { data: { items: Array<{ id: string }> } };
  if (!specimensBody.data.items.some((item) => item.id === diagnosticVerification.specimenId)) throw new Error("normalized specimen read did not return the authoritative specimen");
  const results = await second.app.inject({ method: "GET", url: "/api/v1/diagnostics/results", headers: diagnosticVerification.auth.headers });
  if (results.statusCode !== 200) throw new Error(`normalized diagnostic result read failed with ${results.statusCode}: ${results.body}`);
  const resultsBody = JSON.parse(results.body) as { data: { items: Array<{ id: string }> } };
  if (!resultsBody.data.items.some((item) => item.id === diagnosticVerification.resultId)) throw new Error("normalized diagnostic result read did not return the authoritative result");
  const chainProbe = await second.app.inject({
    method: "POST",
    url: "/api/v1/diagnostics/requests",
    headers: { ...diagnosticVerification.auth.headers, "idempotency-key": "verify-postgres-diagnostic-chain-probe-v1" },
    payload: JSON.stringify({ patientId: luna.id, encounterId: diagnosticVerification.encounterId, testName: "Postgres diagnostic chain probe", priority: "ROUTINE" })
  });
  if (chainProbe.statusCode !== 201) throw new Error(`diagnostic chain probe request failed with ${chainProbe.statusCode}: ${chainProbe.body}`);
  const chainProbeRequestId = (JSON.parse(chainProbe.body) as { data: { request: { id: string } } }).data.request.id;

  const organizationId = second.store.bootstrapCredentials.organizationId;
  const outboxId = id(randomUUID());
  const staleOutboxId = id(randomUUID());
  const crashOutboxId = id(randomUUID());
  const effectOutboxId = id(randomUUID());
  const unknownOutboxId = id(randomUUID());
  const inboxOutboxId = id(randomUUID());
  const outboxStatsBefore = await second.persistence!.outboxStats(organizationId);
  const cleanupWorker = new OutboxWorker(second.persistence!);
  await cleanupWorker.runOnce(organizationId, "verify-worker-cleanup", { deliver: async () => "DELIVERED" }, { limit: 100 });
  const currentRevision = await second.persistence!.currentRevision(organizationId);
  await second.persistence!.commit({
    expectedRevision: currentRevision,
    snapshot: second.store.snapshot(),
    eventType: "SYSTEM",
    operation: "verify.postgres.outbox",
    organizationId,
    actorId: null,
    correlationId: "verify-postgres-outbox",
    aggregateType: "Guardian",
    aggregateId: id(firstResult.guardianId),
    payload: { synthetic: true },
    outboxRecords: [{ id: outboxId, organizationId, eventType: "verify.guardian.changed", aggregateId: id(firstResult.guardianId), payload: { synthetic: true, guardianId: firstResult.guardianId } }]
  });
  const worker = new OutboxWorker(second.persistence!);
  const workerRun = await worker.runOnce(organizationId, "verify-worker-1", { deliver: async (record) => record.id === outboxId ? "DELIVERED" : "QUARANTINE" }, { limit: 1 });
  if (workerRun.claimed !== 1 || workerRun.delivered !== 1 || workerRun.retried !== 0 || workerRun.quarantined !== 0) throw new Error(`outbox worker did not deliver exactly one record: ${JSON.stringify(workerRun)}`);
  const staleRevision = await second.persistence!.currentRevision(organizationId);
  await second.persistence!.commit({
    expectedRevision: staleRevision,
    snapshot: second.store.snapshot(),
    eventType: "SYSTEM",
    operation: "verify.postgres.outbox.lease",
    organizationId,
    actorId: null,
    correlationId: "verify-postgres-outbox-lease",
    aggregateType: "Guardian",
    aggregateId: id(firstResult.guardianId),
    payload: { synthetic: true, lease: true },
    outboxRecords: [{ id: staleOutboxId, organizationId, eventType: "verify.guardian.stale", aggregateId: id(firstResult.guardianId), payload: { synthetic: true, guardianId: firstResult.guardianId, lease: true } }]
  });
  const staleClaim = (await second.persistence!.claimOutbox(organizationId, "verify-worker-stale-a", 1, 1))[0];
  if (!staleClaim || staleClaim.id !== staleOutboxId) throw new Error("outbox lease test did not claim the expected record");
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const recoveredClaim = (await second.persistence!.claimOutbox(organizationId, "verify-worker-stale-b", 1, 30))[0];
  if (!recoveredClaim || recoveredClaim.id !== staleOutboxId || recoveredClaim.fenceToken <= staleClaim.fenceToken) throw new Error("expired outbox lease did not advance the fence token");
  try {
    await second.persistence!.completeOutbox(organizationId, staleClaim.id, "verify-worker-stale-a", staleClaim.fenceToken);
    throw new Error("stale outbox worker acknowledged after lease takeover");
  } catch (error) {
    if (!(error instanceof OutboxLeaseLostError)) throw error;
  }
  await second.persistence!.completeOutbox(organizationId, recoveredClaim.id, "verify-worker-stale-b", recoveredClaim.fenceToken);
  const outboxStats = await second.persistence!.outboxStats(organizationId);
  if (outboxStats.depth !== 0 || outboxStats.poisonMessages < outboxStatsBefore.poisonMessages) throw new Error(`outbox stats regressed after delivery: ${JSON.stringify(outboxStats)}`);

  const crashRevision = await second.persistence!.currentRevision(organizationId);
  await second.persistence!.commit({
    expectedRevision: crashRevision,
    snapshot: second.store.snapshot(),
    eventType: "SYSTEM",
    operation: "verify.postgres.external-effect.crash-after-marker",
    organizationId,
    actorId: null,
    correlationId: "verify-postgres-external-effect-crash-after-marker",
    aggregateType: "Guardian",
    aggregateId: id(firstResult.guardianId),
    payload: { synthetic: true, externalEffect: true, crashAfterDispatchMarker: true },
    outboxRecords: [{ id: crashOutboxId, organizationId, eventType: "verify.external.crash-after-marker", aggregateId: id(firstResult.guardianId), payload: { synthetic: true, effect: "crash-after-marker" } }]
  });
  const crashClaimA = (await second.persistence!.claimOutbox(organizationId, "verify-crash-worker-a", 1, 1))[0];
  if (!crashClaimA || crashClaimA.id !== crashOutboxId) throw new Error("crash-after-marker test did not claim the expected outbox record");
  const crashEffectInput = { id: crashOutboxId, organizationId, outboxId: crashOutboxId, integrationId: "outbox:verify.external.crash-after-marker", idempotencyKey: crashOutboxId, request: { synthetic: true, effect: "crash-after-marker" } };
  const crashEffect = await second.persistence!.prepareExternalEffect(crashEffectInput, { workerId: "verify-crash-worker-a", fenceToken: crashClaimA.fenceToken, leaseSeconds: 1 });
  if (crashEffect.status !== "ADMISSION_PENDING") throw new Error(`crash-after-marker test did not admit the effect: ${crashEffect.status}`);
  await second.persistence!.markExternalEffectDispatched(organizationId, crashEffect.id, "verify-crash-worker-a", crashClaimA.fenceToken);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const crashClaimB = (await second.persistence!.claimOutbox(organizationId, "verify-crash-worker-b", 1, 30))[0];
  if (!crashClaimB || crashClaimB.id !== crashOutboxId || crashClaimB.fenceToken <= crashClaimA.fenceToken) throw new Error("crash-after-marker test did not recover the expired outbox lease");
  const recoveredCrashEffect = await second.persistence!.prepareExternalEffect(crashEffectInput, { workerId: "verify-crash-worker-b", fenceToken: crashClaimB.fenceToken, leaseSeconds: 30 });
  if (recoveredCrashEffect.status !== "OUTCOME_UNKNOWN" || recoveredCrashEffect.lastError !== "DISPATCH_MARKER_RECOVERED_WITHOUT_OUTCOME") throw new Error("a dispatch marker without a provider outcome was not converted to reconciliation-required state");
  await second.persistence!.failOutbox(organizationId, crashClaimB.id, "verify-crash-worker-b", crashClaimB.fenceToken, "crash-after-dispatch marker requires reconciliation", true, 1);
  const crashObservedAt = new Date().toISOString();
  const crashEvidence = { status: "QUARANTINED" as const, providerRequestId: null, response: null, error: "synthetic crash drill intentionally has no provider receipt", source: "MANUAL_REVIEW" as const, observedAt: crashObservedAt, queryDigest: digest({ effectId: recoveredCrashEffect.id, status: "QUARANTINED", providerRequestId: null, response: null, observedAt: crashObservedAt }) };
  const reconciledCrashEffect = await second.persistence!.reconcileExternalEffect(organizationId, recoveredCrashEffect.id, crashEvidence);
  if (reconciledCrashEffect.status !== "QUARANTINED" || reconciledCrashEffect.reconciliationSource !== "MANUAL_REVIEW") throw new Error("crash-after-marker effect was not closed by explicit reconciliation evidence");

  const effectRevision = await second.persistence!.currentRevision(organizationId);
  await second.persistence!.commit({
    expectedRevision: effectRevision,
    snapshot: second.store.snapshot(),
    eventType: "SYSTEM",
    operation: "verify.postgres.external-effect",
    organizationId,
    actorId: null,
    correlationId: "verify-postgres-external-effect",
    aggregateType: "Guardian",
    aggregateId: id(firstResult.guardianId),
    payload: { synthetic: true, externalEffect: true },
    outboxRecords: [{ id: effectOutboxId, organizationId, eventType: "verify.external.deliver", aggregateId: id(firstResult.guardianId), payload: { synthetic: true, effect: "deliver" } }]
  });
  const effectWorker = new OutboxWorker(second.persistence!, second.persistence!);
  const effectRun = await effectWorker.runOnce(organizationId, "verify-effect-worker", { deliver: async () => ({ status: "DELIVERED", providerRequestId: "synthetic-provider-effect-0", receipt: { synthetic: true, accepted: true } }) }, { limit: 1 });
  if (effectRun.claimed !== 1 || effectRun.delivered !== 1 || effectRun.outcomeUnknown !== 0) throw new Error(`external effect worker did not persist a successful outcome: ${JSON.stringify(effectRun)}`);
  const successfulEffects = await second.persistence!.listExternalEffects(organizationId);
  const successfulEffect = successfulEffects.find((effect) => effect.outboxId === effectOutboxId);
  if (!successfulEffect || successfulEffect.status !== "SUCCEEDED" || successfulEffect.attempts !== 1) throw new Error("successful external effect was not durably marked before outbox completion");

  const unknownRevision = await second.persistence!.currentRevision(organizationId);
  await second.persistence!.commit({
    expectedRevision: unknownRevision,
    snapshot: second.store.snapshot(),
    eventType: "SYSTEM",
    operation: "verify.postgres.external-effect-unknown",
    organizationId,
    actorId: null,
    correlationId: "verify-postgres-external-effect-unknown",
    aggregateType: "Guardian",
    aggregateId: id(firstResult.guardianId),
    payload: { synthetic: true, externalEffect: true, unknown: true },
    outboxRecords: [{ id: unknownOutboxId, organizationId, eventType: "verify.external.unknown", aggregateId: id(firstResult.guardianId), payload: { synthetic: true, effect: "unknown" } }]
  });
  const unknownWorker = new OutboxWorker(second.persistence!, second.persistence!);
  const unknownRun = await unknownWorker.runOnce(organizationId, "verify-unknown-worker", { deliver: async () => "OUTCOME_UNKNOWN" }, { limit: 1 });
  if (unknownRun.claimed !== 1 || unknownRun.delivered !== 0 || unknownRun.quarantined !== 1 || unknownRun.outcomeUnknown !== 1) throw new Error(`unknown external effect was not quarantined: ${JSON.stringify(unknownRun)}`);
  const unknownBefore = (await second.persistence!.listExternalEffects(organizationId)).find((effect) => effect.outboxId === unknownOutboxId);
  if (!unknownBefore || unknownBefore.status !== "OUTCOME_UNKNOWN") throw new Error("unknown provider outcome was not held for reconciliation");
  const reconciled = await second.reconcileExternalEffect(organizationId, unknownBefore.id);
  if (reconciled.status !== "SUCCEEDED" || reconciled.providerRequestId !== "synthetic-provider-effect-1") throw new Error("external effect reconciliation did not persist the provider confirmation");

  const inboxUnsigned = { id: id(randomUUID()), organizationId, consumer: "verify-consumer", provider: "synthetic-provider", externalEventId: `synthetic-event-${randomUUID()}`, eventType: "guardian.changed", schemaVersion: 1, signatureAlgorithm: "HMAC-SHA256" as const, signatureKeyRef: "synthetic-test-key", payload: { synthetic: true, guardianId: firstResult.guardianId } };
  const inboxInput = { ...inboxUnsigned, signature: inboxSignature(inboxUnsigned) };
  const inboxProcessed = await second.persistence!.processInboxEvent(inboxInput, [{ id: inboxOutboxId, organizationId, eventType: "verify.inbox.applied", aggregateId: id(firstResult.guardianId), payload: { synthetic: true, inbox: true } }]);
  try {
    await second.persistence!.recordInboxEvent({ ...inboxInput, id: id(randomUUID()), signature: "0".repeat(64) });
    throw new Error("inbox accepted an invalid HMAC signature");
  } catch (error) {
    if (!(error instanceof PersistenceStateError)) throw error;
  }
  const inboxDuplicate = await second.persistence!.recordInboxEvent({ ...inboxInput, id: id(randomUUID()) });
  if (inboxProcessed.duplicate || !inboxDuplicate.duplicate || inboxProcessed.status !== "PROCESSED" || inboxDuplicate.status !== "PROCESSED" || inboxDuplicate.recordDigest !== inboxProcessed.recordDigest) throw new Error("inbox duplicate event was not deduplicated atomically with its local effect");
  const inboxConflictUnsigned = { ...inboxInput, id: id(randomUUID()), payload: { synthetic: true, guardianId: firstResult.guardianId, divergent: true } };
  const inboxConflict = await second.persistence!.recordInboxEvent({ ...inboxConflictUnsigned, signature: inboxSignature(inboxConflictUnsigned) });
  if (inboxConflict.status !== "QUARANTINED" || !inboxConflict.conflictDigest) throw new Error("divergent inbox replay was not quarantined");

  const ingressPayload = { organizationId, consumer: "verify-http-consumer", provider: "synthetic-provider", externalEventId: `http-event-${randomUUID()}`, eventType: "guardian.changed", schemaVersion: 1, payload: { synthetic: true, guardianId: firstResult.guardianId, transport: "raw-body" } };
  const ingressRawBody = JSON.stringify(ingressPayload);
  const ingressHeaders = { "content-type": "application/json", "x-cvg-signature-key-ref": "synthetic-test-key", "x-cvg-signature": rawInboxSignature(ingressRawBody) };
  const ingress = await second.app.inject({ method: "POST", url: "/api/v1/integrations/synthetic-provider/events", headers: ingressHeaders, payload: ingressRawBody });
  if (ingress.statusCode !== 202) throw new Error(`signed HTTP inbox ingress failed with ${ingress.statusCode}: ${ingress.body}`);
  const ingressBody = JSON.parse(ingress.body) as { data: { accepted: boolean; duplicate: boolean; status: string } };
  if (!ingressBody.data.accepted || ingressBody.data.duplicate || ingressBody.data.status !== "PROCESSED") throw new Error("signed HTTP inbox ingress did not atomically process its local effect");
  const ingressReplay = await second.app.inject({ method: "POST", url: "/api/v1/integrations/synthetic-provider/events", headers: ingressHeaders, payload: ingressRawBody });
  if (ingressReplay.statusCode !== 202 || !(JSON.parse(ingressReplay.body) as { data: { duplicate: boolean } }).data.duplicate) throw new Error("signed HTTP inbox ingress replay was not deduplicated");
  const invalidIngress = await second.app.inject({ method: "POST", url: "/api/v1/integrations/synthetic-provider/events", headers: { ...ingressHeaders, "x-cvg-signature": "0".repeat(64) }, payload: ingressRawBody });
  if (invalidIngress.statusCode !== 403) throw new Error(`invalid signed HTTP inbox ingress was not rejected: ${invalidIngress.statusCode}`);
  await cleanupWorker.runOnce(organizationId, "verify-worker-inbox-cleanup", { deliver: async () => "DELIVERED" }, { limit: 100 });

  const clinicalContext = second.store.resolveContext(second.store.bootstrapCredentials.userId, { unitId: id(auth.unitId), workspaceId: id(auth.workspaceId) }, "verify.clinical", "verify-postgres-clinical");
  const clinicalPatient = [...second.store.patients.values()][0];
  if (!clinicalPatient) throw new Error("clinical RLS fixture has no patient");
  const clinicalEncounter = second.store.createEncounter(clinicalContext, { patientId: clinicalPatient.id, appointmentId: null, chiefComplaint: "fixture clínico de escopo", urgency: "ROUTINE" });
  const clinicalDocument = second.store.createClinicalDocument(clinicalContext, { encounterId: clinicalEncounter.id, documentType: "EVOLUTION", title: "Fixture de escopo", content: "conteúdo sintético protegido", dataClass: "D3" });
  const vetId = [...second.store.users.values()].find((user) => user.login === "ana.vet@cvg.local")?.id;
  if (!vetId) throw new Error("clinical RLS fixture has no veterinarian");
  const vetOption = second.store.contextOptions(vetId)[0];
  if (!vetOption) throw new Error("veterinarian has no clinical context");
  const vetContext = second.store.resolveContext(vetId, { unitId: vetOption.unit.id, workspaceId: vetOption.workspace.id }, "verify.clinical.sign", "verify-postgres-clinical-sign");
  second.store.reviewClinicalDocument(vetContext, clinicalDocument.id, null);
  second.store.signClinicalDocument(vetContext, clinicalDocument.id);
  const clinicalAddendum = second.store.addClinicalAddendum(vetContext, clinicalDocument.id, "correção de fixture", "adendo sintético protegido");
  const clinicalRevision = await second.persistence!.currentRevision(organizationId);
  await second.persistence!.commit({ expectedRevision: clinicalRevision, snapshot: second.store.snapshot(), eventType: "SYSTEM", operation: "verify.postgres.clinical-scope", organizationId, actorId: vetId, correlationId: "verify-postgres-clinical-scope", aggregateType: "ClinicalDocument", aggregateId: clinicalDocument.id, payload: { synthetic: true, clinicalScope: true } });

  const metrics = await second.app.inject({ method: "GET", url: "/api/v1/metrics", headers: auth.headers });
  if (metrics.statusCode !== 200) throw new Error(`durable outbox metrics failed with ${metrics.statusCode}: ${metrics.body}`);
  const metricsBody = JSON.parse(metrics.body) as { data: { dependencies: { outbox: string }; queues: { outboxDepth: number; reconciliationLag: number } } };
  if (metricsBody.data.dependencies.outbox !== "READY" || metricsBody.data.queues.outboxDepth !== 0 || metricsBody.data.queues.reconciliationLag !== 0) throw new Error("durable outbox metrics did not expose the reconciled queue state");

  const usageInput = { id: id(randomUUID()), organizationId, reservationId: null, providerRequestId: "synthetic-provider-request-1", idempotencyKey: "verify-usage-v1", usageKind: "TOKENS", reservedUnits: 100, consumedUnits: 42, status: "RECEIVED" as const, record: { synthetic: true, model: "local-stub" } };
  const usage = await second.persistence!.recordUsage(usageInput);
  usageForAgent = usage;
  const usageReplay = await second.persistence!.recordUsage(usageInput);
  if (usage.id !== usageReplay.id || usage.recordDigest !== usageReplay.recordDigest) throw new Error("usage ledger replay was not idempotent");

  // The persistence proof records only a grant already admitted by an
  // application boundary; WebAuthn verification and public activation remain
  // deliberately outside this synthetic database gate.
  const breakGlassIssuedAt = new Date(Date.now() - 1_000).toISOString();
  const breakGlassExpiresAt = new Date(Date.now() + 60_000).toISOString();
  const durableBreakGlass = await second.persistence!.createBreakGlassGrant({ grantId: id(randomUUID()), organizationId, actorId: second.store.bootstrapCredentials.userId, approverId: vetId, reason: "synthetic incident review", target: "patient:synthetic", mfaMethod: "WEBAUTHN", issuedAt: breakGlassIssuedAt, expiresAt: breakGlassExpiresAt });
  if (durableBreakGlass.status !== "ACTIVE" || durableBreakGlass.mfaMethod !== "WEBAUTHN") throw new Error("durable break-glass grant was not created as active WebAuthn evidence");
  const scopedBreakGlassGrantId = id(randomUUID());
  const scopedBreakGlassActivation = await second.persistence!.createBreakGlassGrantWithAudit(
    { grantId: scopedBreakGlassGrantId, organizationId, actorId: second.store.bootstrapCredentials.userId, approverId: vetId, reason: "synthetic scoped activation review", target: "patient:synthetic-scoped", scope: "WORKSPACE", mfaMethod: "WEBAUTHN", issuedAt: breakGlassIssuedAt, expiresAt: breakGlassExpiresAt },
    { organizationId, actorId: second.store.bootstrapCredentials.userId, unitId: id(auth.unitId), workspaceId: id(auth.workspaceId), action: "verify.break_glass.scoped_activation", resourceType: "BreakGlassGrant", resourceId: scopedBreakGlassGrantId, result: "ALLOWED", reason: "synthetic scoped activation audit", correlationId: `verify-postgres-break-glass-${randomUUID()}`, metadata: { synthetic: true, scope: "WORKSPACE" } }
  );
  if (scopedBreakGlassActivation.grant.scope !== "WORKSPACE" || scopedBreakGlassActivation.audit.unitId !== id(auth.unitId) || scopedBreakGlassActivation.audit.workspaceId !== id(auth.workspaceId)) throw new Error("scoped durable break-glass activation did not persist its workspace scope and audit");
  const activeBreakGlass = await second.persistence!.assertActiveBreakGlassGrant(organizationId, durableBreakGlass.grantId);
  if (activeBreakGlass.grantId !== durableBreakGlass.grantId) throw new Error("durable break-glass active assertion returned a different grant");
  const revokedBreakGlass = await second.persistence!.revokeBreakGlassGrant(organizationId, durableBreakGlass.grantId);
  if (revokedBreakGlass.status !== "REVOKED" || !revokedBreakGlass.revokedAt) throw new Error("durable break-glass revocation was not persisted");
  const reviewedBreakGlass = await second.persistence!.reviewBreakGlassGrant(organizationId, durableBreakGlass.grantId, vetId, "independent synthetic post-incident review");
  if (reviewedBreakGlass.status !== "REVIEWED" || reviewedBreakGlass.reviewedBy !== vetId || !reviewedBreakGlass.reviewNote) throw new Error("durable break-glass review was not persisted");
  const expiringBreakGlass = await second.persistence!.createBreakGlassGrant({ grantId: id(randomUUID()), organizationId, actorId: second.store.bootstrapCredentials.userId, approverId: vetId, reason: "synthetic expiry review", target: "patient:synthetic-expiry", mfaMethod: "WEBAUTHN", issuedAt: breakGlassIssuedAt, expiresAt: new Date(Date.now() + 1_000).toISOString() });
  const expiredBreakGlass = await second.persistence!.getBreakGlassGrant(organizationId, expiringBreakGlass.grantId, Date.now() + 2_000);
  if (!expiredBreakGlass || expiredBreakGlass.status !== "EXPIRED") throw new Error("durable break-glass lazy expiry was not persisted");
  const reviewedExpiredBreakGlass = await second.persistence!.reviewBreakGlassGrant(organizationId, expiringBreakGlass.grantId, vetId, "independent synthetic expiry review");
  if (reviewedExpiredBreakGlass.status !== "REVIEWED") throw new Error("expired durable break-glass grant was not reviewable");

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  migrationPrivileges = (await client.query<{ can_select: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean }>(
    "select has_table_privilege($1, 'public.schema_migrations', 'SELECT') as can_select, has_table_privilege($1, 'public.schema_migrations', 'INSERT') as can_insert, has_table_privilege($1, 'public.schema_migrations', 'UPDATE') as can_update, has_table_privilege($1, 'public.schema_migrations', 'DELETE') as can_delete",
    [runtimeRole]
  )).rows[0];
  if (!migrationPrivileges || !migrationPrivileges.can_select || migrationPrivileges.can_insert || migrationPrivileges.can_update || migrationPrivileges.can_delete) throw new Error(`runtime role may mutate schema migration metadata: ${JSON.stringify({ runtimeRole, migrationPrivileges })}`);
  const latestOrganization = second.store.bootstrapCredentials.organizationId;
  await client.query("select set_config('cvg.organization_id', $1, false)", [latestOrganization]);
  await client.query("select set_config('cvg.unit_id', $1, false)", [auth.unitId]);
  await client.query("select set_config('cvg.workspace_id', $1, false)", [auth.workspaceId]);
  const persistedOrganization = (await client.query<{ organization_id: string }>(
    "select organization_id::text as organization_id from cvg_state_snapshots where organization_id = cvg_request_organization() order by revision desc limit 1"
  )).rows[0]?.organization_id;
  if (persistedOrganization !== latestOrganization) throw new Error("durable verification has no persisted organization in the authenticated RLS context");
  const diagnosticScope = (await client.query<{ unit_id: string; workspace_id: string }>(
    "select unit_id::text as unit_id, workspace_id::text as workspace_id from diagnostic_requests where id = $1",
    [diagnosticVerification.requestId]
  )).rows[0];
  if (diagnosticScope?.unit_id !== diagnosticVerification.auth.unitId || diagnosticScope.workspace_id !== diagnosticVerification.auth.workspaceId) throw new Error("authoritative diagnostic request did not persist the encounter-derived scope");
  const specimenScope = (await client.query<{ unit_id: string; workspace_id: string }>(
    "select unit_id::text as unit_id, workspace_id::text as workspace_id from specimens where id = $1",
    [diagnosticVerification.specimenId]
  )).rows[0];
  if (specimenScope?.unit_id !== diagnosticVerification.auth.unitId || specimenScope.workspace_id !== diagnosticVerification.auth.workspaceId) throw new Error("authoritative specimen did not persist the encounter-derived scope");
  const resultScope = (await client.query<{ unit_id: string; workspace_id: string }>(
    "select unit_id::text as unit_id, workspace_id::text as workspace_id from diagnostic_results where id = $1",
    [diagnosticVerification.resultId]
  )).rows[0];
  if (resultScope?.unit_id !== diagnosticVerification.auth.unitId || resultScope.workspace_id !== diagnosticVerification.auth.workspaceId) throw new Error("authoritative diagnostic result did not persist the encounter-derived scope");
  counts = (await client.query<{ snapshots: number; journal: number; audits: number; auditLedger: number; receipts: number; receiptLedger: number; guardians: number; diagnosticRequests: number; specimens: number; diagnosticResults: number; outbox: number; usageLedger: number; inbox: number; externalEffects: number; breakGlass: number }>(
    "select (select count(*)::int from cvg_state_snapshots) as snapshots, (select count(*)::int from cvg_event_journal) as journal, (select count(*)::int from audit_records) as audits, (select count(*)::int from cvg_audit_ledger) as \"auditLedger\", (select count(*)::int from command_receipts) as receipts, (select count(*)::int from cvg_command_receipt_ledger) as \"receiptLedger\", (select count(*)::int from guardians) as guardians, (select count(*)::int from diagnostic_requests) as \"diagnosticRequests\", (select count(*)::int from specimens) as specimens, (select count(*)::int from diagnostic_results) as \"diagnosticResults\", (select count(*)::int from outbox_records) as outbox, (select count(*)::int from ai_usage_ledger) as \"usageLedger\", (select count(*)::int from integration_inbox_records) as inbox, (select count(*)::int from external_effects) as \"externalEffects\", (select count(*)::int from break_glass_grants) as \"breakGlass\""
  )).rows[0];
  const rlsRole = `cvg_rls_verify_${randomUUID().replaceAll("-", "")}`;
  // The RLS probe asserts exact scope isolation, not emptiness: AI turns that
  // legitimately exist in the probed scope (for example from the isolation
  // gate) must be visible, while other scopes stay hidden.
  const sameScopeAiTurns = (await client.query<{ count: number }>(
    "select count(*)::int as count from ai_turns where organization_id = $1 and unit_id is not distinct from $2::uuid and workspace_id is not distinct from $3::uuid",
    [latestOrganization, auth.unitId, auth.workspaceId]
  )).rows[0]?.count ?? -1;
  const invalidSpecimenId = randomUUID();
  const invalidResultId = randomUUID();
  const currentRole = (await client.query<{ rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolreplication: boolean }>(
    "select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication from pg_roles where rolname = current_user"
  )).rows[0];
  const needsTemporaryRole = !currentRole || currentRole.rolsuper || currentRole.rolbypassrls || currentRole.rolcreaterole || currentRole.rolcreatedb || currentRole.rolreplication;
  if (needsTemporaryRole) await client.query(`create role "${rlsRole}" noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication`);
  try {
    if (needsTemporaryRole) {
      await client.query(`grant usage on schema public to "${rlsRole}"`);
      await client.query(`grant select, insert, update on organizations, patients, guardians, diagnostic_requests, specimens, diagnostic_results, outbox_records, ai_usage_ledger, integration_inbox_records, external_effects, break_glass_grants, ai_turns, ai_drafts, lifecycle_decisions, lifecycle_transition_events, inbox_records, appointments, encounters, clinical_documents, clinical_addenda, knowledge_documents, communication_messages, ai_sessions, ai_approvals, audit_records, command_receipts, role_assignments, providers, resources, queue_entries, beds, hospital_episodes, stock_locations, charges to "${rlsRole}"`);
      await client.query(`grant select on cvg_state_snapshots, cvg_event_journal to "${rlsRole}"`);
      await client.query(`set role "${rlsRole}"`);
    }
    await client.query("select set_config('cvg.organization_id', $1, false)", [latestOrganization]);
    await client.query("select set_config('cvg.unit_id', $1, false)", [auth.unitId]);
    await client.query("select set_config('cvg.workspace_id', $1, false)", [auth.workspaceId]);
    const visibleOrganizationCount = (await client.query<{ count: number }>("select count(*)::int as count from organizations")).rows[0]?.count;
    const visibleSnapshotCount = (await client.query<{ count: number }>("select count(*)::int as count from cvg_state_snapshots")).rows[0]?.count;
    const visibleJournalCount = (await client.query<{ count: number }>("select count(*)::int as count from cvg_event_journal")).rows[0]?.count;
    const visibleOutboxCount = (await client.query<{ count: number }>("select count(*)::int as count from outbox_records")).rows[0]?.count;
    const visibleUsageCount = (await client.query<{ count: number }>("select count(*)::int as count from ai_usage_ledger")).rows[0]?.count;
    const visibleInboxCount = (await client.query<{ count: number }>("select count(*)::int as count from integration_inbox_records")).rows[0]?.count;
    const visibleExternalEffectsCount = (await client.query<{ count: number }>("select count(*)::int as count from external_effects")).rows[0]?.count;
    const visibleBreakGlassCount = (await client.query<{ count: number }>("select count(*)::int as count from break_glass_grants")).rows[0]?.count;
    const visibleScopedBreakGlassAuditCount = (await client.query<{ count: number }>("select count(*)::int as count from audit_records where id = $1", [scopedBreakGlassActivation.audit.id])).rows[0]?.count;
    const visiblePatientCount = (await client.query<{ count: number }>("select count(*)::int as count from patients")).rows[0]?.count;
    const visibleGuardianCount = (await client.query<{ count: number }>("select count(*)::int as count from guardians")).rows[0]?.count;
    const visibleDiagnosticRequestCount = (await client.query<{ count: number }>("select count(*)::int as count from diagnostic_requests")).rows[0]?.count;
    const visibleSpecimenCount = (await client.query<{ count: number }>("select count(*)::int as count from specimens")).rows[0]?.count;
    const visibleDiagnosticResultCount = (await client.query<{ count: number }>("select count(*)::int as count from diagnostic_results")).rows[0]?.count;
    const visibleAppointmentCount = (await client.query<{ count: number }>("select count(*)::int as count from appointments")).rows[0]?.count;
    const visibleClinicalDocumentCount = (await client.query<{ count: number }>("select count(*)::int as count from clinical_documents")).rows[0]?.count;
    const visibleClinicalAddendumCount = (await client.query<{ count: number }>("select count(*)::int as count from clinical_addenda")).rows[0]?.count;
    const visibleKnowledgeCount = (await client.query<{ count: number }>("select count(*)::int as count from knowledge_documents")).rows[0]?.count;
    const visibleProviderCount = (await client.query<{ count: number }>("select count(*)::int as count from providers")).rows[0]?.count;
    const visibleRoleCount = (await client.query<{ count: number }>("select count(*)::int as count from role_assignments")).rows[0]?.count;
    const visibleAiTurnCount = (await client.query<{ count: number }>("select count(*)::int as count from ai_turns")).rows[0]?.count;
    const visibleAiDraftCount = (await client.query<{ count: number }>("select count(*)::int as count from ai_drafts")).rows[0]?.count;
    const visibleLifecycleDecisionCount = (await client.query<{ count: number }>("select count(*)::int as count from lifecycle_decisions")).rows[0]?.count;
    const visibleLifecycleEventCount = (await client.query<{ count: number }>("select count(*)::int as count from lifecycle_transition_events")).rows[0]?.count;
    const visibleLegacyInboxCount = (await client.query<{ count: number }>("select count(*)::int as count from inbox_records")).rows[0]?.count;
    await client.query("select set_config('cvg.unit_id', $1, false)", [""]);
    await client.query("select set_config('cvg.workspace_id', $1, false)", [""]);
    const missingScopeClinicalDocumentCount = (await client.query<{ count: number }>("select count(*)::int as count from clinical_documents")).rows[0]?.count;
    const missingScopeClinicalAddendumCount = (await client.query<{ count: number }>("select count(*)::int as count from clinical_addenda")).rows[0]?.count;
    const missingContextPatientCount = (await client.query<{ count: number }>("select count(*)::int as count from patients")).rows[0]?.count;
    const missingContextGuardianCount = (await client.query<{ count: number }>("select count(*)::int as count from guardians")).rows[0]?.count;
    const missingContextDiagnosticRequestCount = (await client.query<{ count: number }>("select count(*)::int as count from diagnostic_requests")).rows[0]?.count;
    const missingContextSpecimenCount = (await client.query<{ count: number }>("select count(*)::int as count from specimens")).rows[0]?.count;
    const missingContextDiagnosticResultCount = (await client.query<{ count: number }>("select count(*)::int as count from diagnostic_results")).rows[0]?.count;
    await expectSqlRejected(
      client,
      "encounter-bound specimen with null scope",
      "insert into specimens (id, organization_id, request_id, patient_id, label, collected_at, status, unit_id, workspace_id) values ($1, $2, $3, $4, $5, now(), $6, null, null)",
      [invalidSpecimenId, latestOrganization, diagnosticVerification.requestId, luna.id, "invalid null-scope specimen", "COLLECTED"]
    );
    await client.query("select set_config('cvg.unit_id', $1, false)", [auth.unitId]);
    await client.query("select set_config('cvg.workspace_id', $1, false)", [auth.workspaceId]);
    await expectSqlRejected(
      client,
      "result with mismatched request/specimen chain",
      "insert into diagnostic_results (id, organization_id, request_id, specimen_id, patient_id, value, source, source_version, status, created_at, unit_id, workspace_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10, $11)",
      [invalidResultId, latestOrganization, chainProbeRequestId, diagnosticVerification.specimenId, luna.id, "invalid chain", "synthetic-negative", "v1", "VALID", auth.unitId, auth.workspaceId]
    );
    await client.query("select set_config('cvg.unit_id', $1, false)", [auth.unitId]);
    await client.query("select set_config('cvg.workspace_id', $1, false)", [randomUUID()]);
    const hiddenWorkspaceAppointmentCount = (await client.query<{ count: number }>("select count(*)::int as count from appointments")).rows[0]?.count;
    const hiddenWorkspaceClinicalDocumentCount = (await client.query<{ count: number }>("select count(*)::int as count from clinical_documents")).rows[0]?.count;
    const hiddenWorkspaceClinicalAddendumCount = (await client.query<{ count: number }>("select count(*)::int as count from clinical_addenda")).rows[0]?.count;
    const hiddenWorkspaceKnowledgeCount = (await client.query<{ count: number }>("select count(*)::int as count from knowledge_documents")).rows[0]?.count;
    const hiddenWorkspacePatientCount = (await client.query<{ count: number }>("select count(*)::int as count from patients")).rows[0]?.count;
    const hiddenWorkspaceGuardianCount = (await client.query<{ count: number }>("select count(*)::int as count from guardians")).rows[0]?.count;
    const hiddenWorkspaceDiagnosticRequestCount = (await client.query<{ count: number }>("select count(*)::int as count from diagnostic_requests")).rows[0]?.count;
    const hiddenWorkspaceSpecimenCount = (await client.query<{ count: number }>("select count(*)::int as count from specimens")).rows[0]?.count;
    const hiddenWorkspaceDiagnosticResultCount = (await client.query<{ count: number }>("select count(*)::int as count from diagnostic_results")).rows[0]?.count;
    const forbiddenWorkspaceClinicalUpdate = await client.query("update clinical_documents set title = title where id = $1", [clinicalDocument.id]);
    const forbiddenWorkspaceDiagnosticUpdate = await client.query("update diagnostic_requests set test_name = test_name where id = $1", [diagnosticVerification.requestId]);
    const forbiddenWorkspaceSpecimenUpdate = await client.query("update specimens set label = label where id = $1", [diagnosticVerification.specimenId]);
    const forbiddenWorkspaceDiagnosticResultUpdate = await client.query("update diagnostic_results set value = value where id = $1", [diagnosticVerification.resultId]);
    await client.query("select set_config('cvg.unit_id', $1, false)", [randomUUID()]);
    await client.query("select set_config('cvg.workspace_id', $1, false)", [auth.workspaceId]);
    const hiddenUnitAppointmentCount = (await client.query<{ count: number }>("select count(*)::int as count from appointments")).rows[0]?.count;
    const hiddenUnitClinicalDocumentCount = (await client.query<{ count: number }>("select count(*)::int as count from clinical_documents")).rows[0]?.count;
    const hiddenUnitClinicalAddendumCount = (await client.query<{ count: number }>("select count(*)::int as count from clinical_addenda")).rows[0]?.count;
    const hiddenUnitKnowledgeCount = (await client.query<{ count: number }>("select count(*)::int as count from knowledge_documents")).rows[0]?.count;
    const hiddenUnitProviderCount = (await client.query<{ count: number }>("select count(*)::int as count from providers")).rows[0]?.count;
    const hiddenUnitPatientCount = (await client.query<{ count: number }>("select count(*)::int as count from patients")).rows[0]?.count;
    const hiddenUnitGuardianCount = (await client.query<{ count: number }>("select count(*)::int as count from guardians")).rows[0]?.count;
    const hiddenUnitDiagnosticRequestCount = (await client.query<{ count: number }>("select count(*)::int as count from diagnostic_requests")).rows[0]?.count;
    const hiddenUnitSpecimenCount = (await client.query<{ count: number }>("select count(*)::int as count from specimens")).rows[0]?.count;
    const hiddenUnitDiagnosticResultCount = (await client.query<{ count: number }>("select count(*)::int as count from diagnostic_results")).rows[0]?.count;
    const forbiddenUnitClinicalUpdate = await client.query("update clinical_addenda set content = content where id = $1", [clinicalAddendum.id]);
    const forbiddenUnitDiagnosticUpdate = await client.query("update diagnostic_requests set test_name = test_name where id = $1", [diagnosticVerification.requestId]);
    const forbiddenUnitSpecimenUpdate = await client.query("update specimens set label = label where id = $1", [diagnosticVerification.specimenId]);
    const forbiddenUnitDiagnosticResultUpdate = await client.query("update diagnostic_results set value = value where id = $1", [diagnosticVerification.resultId]);
    const scopeProbeRole = ["workspace_manager", "operador", "estoque", "financeiro", "recepcao", "veterinario", "admin"].find((role) => !second.store.snapshot().roleAssignments.some((assignment) => assignment.organizationId === latestOrganization && assignment.userId === second.store.bootstrapCredentials.userId && assignment.role === role && assignment.scopeType === "WORKSPACE" && assignment.unitId === auth.unitId && assignment.workspaceId === auth.workspaceId && assignment.revokedAt === null));
    if (!scopeProbeRole) throw new Error("RLS scope verifier could not find an unused workspace role fixture");
    const crossWorkspace = randomUUID();
    const crossTenant = randomUUID();
    const auditInsertSql = "insert into audit_records (id, organization_id, actor_id, unit_id, workspace_id, action, resource_type, result, correlation_id, metadata) values ($1, $2, $3, $4, $5, 'verify.rls.scope', 'verification', 'ALLOWED', $6, '{}'::jsonb)";
    const receiptInsertSql = "insert into command_receipts (id, organization_id, actor_id, unit_id, workspace_id, operation, idempotency_lookup, body_digest, status) values ($1, $2, $3, $4, $5, 'verify.rls.scope', $6, $7, 'IN_FLIGHT')";
    const roleInsertSql = "insert into role_assignments (id, organization_id, user_id, role, scope_type, unit_id, workspace_id) values ($1, $2, $3, $4, 'WORKSPACE', $5, $6)";
    const actorId = second.store.bootstrapCredentials.userId;
    const workspaceAuditValues = [randomUUID(), latestOrganization, actorId, auth.unitId, auth.workspaceId, `rls-workspace-${randomUUID()}`];
    const workspaceReceiptValues = [randomUUID(), latestOrganization, actorId, auth.unitId, auth.workspaceId, `rls-workspace-${randomUUID()}`, "a".repeat(64)];
    const workspaceRoleValues = [randomUUID(), latestOrganization, actorId, scopeProbeRole, auth.unitId, auth.workspaceId];
    const scopedReadFixtures = [
      { table: "audit_records", values: workspaceAuditValues, sql: auditInsertSql },
      { table: "command_receipts", values: workspaceReceiptValues, sql: receiptInsertSql },
      { table: "role_assignments", values: workspaceRoleValues, sql: roleInsertSql }
    ] as const;
    await client.query("begin");
    try {
      await client.query(
        "select set_config('cvg.organization_id', $1, true), set_config('cvg.unit_id', $2, true), set_config('cvg.workspace_id', $3, true)",
        [latestOrganization, auth.unitId, auth.workspaceId]
      );
      for (const fixture of scopedReadFixtures) {
        const inserted = await client.query(fixture.sql, fixture.values);
        if (inserted.rowCount !== 1) throw new Error(`${fixture.table} same-scope RLS fixture insert returned ${inserted.rowCount ?? 0} rows`);
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
    for (const fixture of scopedReadFixtures) {
      const rowId = String(fixture.values[0]);
      await expectRlsRowCount({ client, label: `${fixture.table} same-scope read`, table: fixture.table, rowId, expectedCount: 1, organizationId: latestOrganization, unitId: auth.unitId, workspaceId: auth.workspaceId });
      await expectRlsRowCount({ client, label: `${fixture.table} cross-workspace read`, table: fixture.table, rowId, expectedCount: 0, organizationId: latestOrganization, unitId: auth.unitId, workspaceId: crossWorkspace });
      await expectRlsRowCount({ client, label: `${fixture.table} cross-unit read`, table: fixture.table, rowId, expectedCount: 0, organizationId: latestOrganization, unitId: randomUUID(), workspaceId: auth.workspaceId });
      await expectRlsRowCount({ client, label: `${fixture.table} cross-tenant read`, table: fixture.table, rowId, expectedCount: 0, organizationId: crossTenant, unitId: auth.unitId, workspaceId: auth.workspaceId });
    }
    const dmlProbeClient = new pg.Client({ connectionString: migrationDatabaseUrl });
    await dmlProbeClient.connect();
    const dmlProbeRole = `${rlsRole}_dml`;
    let dmlProbeRoleCreated = false;
    try {
      const dmlProbeAuthority = (await dmlProbeClient.query<{ rolsuper: boolean; rolcreaterole: boolean }>(
        "select rolsuper, rolcreaterole from pg_roles where rolname = current_user"
      )).rows[0];
      if (!dmlProbeAuthority || (!dmlProbeAuthority.rolsuper && !dmlProbeAuthority.rolcreaterole)) throw new Error("migration connection cannot create the restricted DML RLS verifier role");
      await dmlProbeClient.query(`create role "${dmlProbeRole}" noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication`);
      dmlProbeRoleCreated = true;
      await dmlProbeClient.query(`grant usage on schema public to "${dmlProbeRole}"`);
      await dmlProbeClient.query(`grant select, insert, update, delete on audit_records, command_receipts, role_assignments to "${dmlProbeRole}"`);
      await dmlProbeClient.query(`set role "${dmlProbeRole}"`);
      const dmlOperations = [
        { table: "audit_records", rowId: String(workspaceAuditValues[0]), updateSql: "update audit_records set result = result where id = $1 returning id", updateValues: (rowId: string) => [rowId], deleteSql: "delete from audit_records where id = $1 returning id", appendOnlySql: "update audit_records set result = 'DENIED' where id = $1", appendOnlyValues: (rowId: string) => [rowId], appendOnlyDeleteSql: "delete from audit_records where id = $1" },
        { table: "command_receipts", rowId: String(workspaceReceiptValues[0]), updateSql: "update command_receipts set status = status where id = $1 returning id", updateValues: (rowId: string) => [rowId], deleteSql: "delete from command_receipts where id = $1 returning id", scopeChangeSql: "update command_receipts set workspace_id = $2 where id = $1 returning id", scopeChangeValues: (rowId: string) => [rowId, crossWorkspace] },
        { table: "role_assignments", rowId: String(workspaceRoleValues[0]), updateSql: "update role_assignments set role = role where id = $1 returning id", updateValues: (rowId: string) => [rowId], deleteSql: "delete from role_assignments where id = $1 returning id", scopeChangeSql: "update role_assignments set workspace_id = $2 where id = $1 returning id", scopeChangeValues: (rowId: string) => [rowId, crossWorkspace] }
      ] as const;
      for (const operation of dmlOperations) {
        await expectRlsDmlRowCount({ client: dmlProbeClient, label: `${operation.table} same-scope update`, sql: operation.updateSql, values: operation.updateValues(operation.rowId), expectedCount: 1, organizationId: latestOrganization, unitId: auth.unitId, workspaceId: auth.workspaceId });
        if ("scopeChangeSql" in operation) {
          await expectScopedDmlSqlState({ client: dmlProbeClient, label: `${operation.table} same-scope update cannot move row to another workspace`, sql: operation.scopeChangeSql, values: operation.scopeChangeValues(operation.rowId), expectedSqlState: "42501", organizationId: latestOrganization, unitId: auth.unitId, workspaceId: auth.workspaceId });
          await expectRlsDmlRowCount({ client: dmlProbeClient, label: `${operation.table} same-scope delete`, sql: operation.deleteSql, values: [operation.rowId], expectedCount: 1, organizationId: latestOrganization, unitId: auth.unitId, workspaceId: auth.workspaceId });
        } else {
          await expectScopedDmlSqlState({ client: dmlProbeClient, label: `${operation.table} same-scope mutation remains append-only`, sql: operation.appendOnlySql, values: operation.appendOnlyValues(operation.rowId), expectedSqlState: "55000", organizationId: latestOrganization, unitId: auth.unitId, workspaceId: auth.workspaceId });
          await expectScopedDmlSqlState({ client: dmlProbeClient, label: `${operation.table} same-scope delete remains append-only`, sql: operation.appendOnlyDeleteSql, values: [operation.rowId], expectedSqlState: "55000", organizationId: latestOrganization, unitId: auth.unitId, workspaceId: auth.workspaceId });
        }
        for (const wrongScope of [
          { label: "cross-workspace", organizationId: latestOrganization, unitId: auth.unitId, workspaceId: crossWorkspace },
          { label: "cross-unit", organizationId: latestOrganization, unitId: randomUUID(), workspaceId: auth.workspaceId },
          { label: "cross-tenant", organizationId: crossTenant, unitId: auth.unitId, workspaceId: auth.workspaceId }
        ]) {
          await expectRlsDmlRowCount({ client: dmlProbeClient, label: `${operation.table} ${wrongScope.label} update`, sql: operation.updateSql, values: operation.updateValues(operation.rowId), expectedCount: 0, organizationId: wrongScope.organizationId, unitId: wrongScope.unitId, workspaceId: wrongScope.workspaceId });
          await expectRlsDmlRowCount({ client: dmlProbeClient, label: `${operation.table} ${wrongScope.label} delete`, sql: operation.deleteSql, values: [operation.rowId], expectedCount: 0, organizationId: wrongScope.organizationId, unitId: wrongScope.unitId, workspaceId: wrongScope.workspaceId });
        }
      }
    } finally {
      await dmlProbeClient.query("reset role").catch(() => undefined);
      if (dmlProbeRoleCreated) {
        await dmlProbeClient.query(`revoke all privileges on audit_records, command_receipts, role_assignments from "${dmlProbeRole}"`).catch(() => undefined);
        await dmlProbeClient.query(`revoke usage on schema public from "${dmlProbeRole}"`).catch(() => undefined);
        await dmlProbeClient.query(`drop role "${dmlProbeRole}"`);
      }
      await dmlProbeClient.end();
    }
    for (const [label, sql, values] of [
      ["audit_records cross-workspace insert", auditInsertSql, workspaceAuditValues],
      ["command_receipts cross-workspace insert", receiptInsertSql, workspaceReceiptValues],
      ["role_assignments cross-workspace insert", roleInsertSql, workspaceRoleValues]
    ] as const) {
      await expectRlsInsertDenied({ client, label, sql, values: [...values], organizationId: latestOrganization, unitId: auth.unitId, workspaceId: crossWorkspace });
    }
    const tenantAuditValues = [randomUUID(), crossTenant, actorId, auth.unitId, auth.workspaceId, `rls-tenant-${randomUUID()}`];
    const tenantReceiptValues = [randomUUID(), crossTenant, actorId, auth.unitId, auth.workspaceId, `rls-tenant-${randomUUID()}`, "b".repeat(64)];
    const tenantRoleValues = [randomUUID(), crossTenant, actorId, scopeProbeRole, auth.unitId, auth.workspaceId];
    for (const [label, sql, values] of [
      ["audit_records cross-tenant insert", auditInsertSql, tenantAuditValues],
      ["command_receipts cross-tenant insert", receiptInsertSql, tenantReceiptValues],
      ["role_assignments cross-tenant insert", roleInsertSql, tenantRoleValues]
    ] as const) {
      await expectRlsInsertDenied({ client, label, sql, values: [...values], organizationId: latestOrganization, unitId: auth.unitId, workspaceId: auth.workspaceId });
    }
    await client.query("select set_config('cvg.organization_id', $1, false)", [randomUUID()]);
    const hiddenOrganizationCount = (await client.query<{ count: number }>("select count(*)::int as count from organizations")).rows[0]?.count;
    const hiddenSnapshotCount = (await client.query<{ count: number }>("select count(*)::int as count from cvg_state_snapshots")).rows[0]?.count;
    const hiddenJournalCount = (await client.query<{ count: number }>("select count(*)::int as count from cvg_event_journal")).rows[0]?.count;
    const hiddenOutboxCount = (await client.query<{ count: number }>("select count(*)::int as count from outbox_records")).rows[0]?.count;
    const hiddenUsageCount = (await client.query<{ count: number }>("select count(*)::int as count from ai_usage_ledger")).rows[0]?.count;
    const hiddenInboxCount = (await client.query<{ count: number }>("select count(*)::int as count from integration_inbox_records")).rows[0]?.count;
    const hiddenExternalEffectsCount = (await client.query<{ count: number }>("select count(*)::int as count from external_effects")).rows[0]?.count;
    const hiddenBreakGlassCount = (await client.query<{ count: number }>("select count(*)::int as count from break_glass_grants")).rows[0]?.count;
    const unprotectedTables = (await client.query<{ table_name: string }>("select c.relname as table_name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'schema_migrations' and (not c.relrowsecurity or not c.relforcerowsecurity) order by c.relname")).rows;
    if (visibleOrganizationCount !== 1 || (visibleSnapshotCount ?? 0) < 1 || (visibleJournalCount ?? 0) < 1 || (visibleOutboxCount ?? 0) < 1 || (visibleUsageCount ?? 0) < 1 || (visibleInboxCount ?? 0) < 1 || (visibleExternalEffectsCount ?? 0) < 1 || (visibleBreakGlassCount ?? 0) < 2 || (visibleScopedBreakGlassAuditCount ?? 0) !== 1 || (visiblePatientCount ?? 0) < 1 || (visibleGuardianCount ?? 0) < 1 || (visibleDiagnosticRequestCount ?? 0) < 1 || (visibleSpecimenCount ?? 0) < 1 || (visibleDiagnosticResultCount ?? 0) < 1 || (visibleAppointmentCount ?? 0) < 1 || (visibleClinicalDocumentCount ?? 0) < 1 || (visibleClinicalAddendumCount ?? 0) < 1 || (visibleKnowledgeCount ?? 0) < 1 || (visibleProviderCount ?? 0) < 1 || (visibleRoleCount ?? 0) < 1 || (visibleAiTurnCount ?? 0) !== sameScopeAiTurns || (visibleAiDraftCount ?? 0) !== 0 || (visibleLifecycleDecisionCount ?? 0) !== 0 || (visibleLifecycleEventCount ?? 0) !== 0 || (visibleLegacyInboxCount ?? 0) !== 0 || missingScopeClinicalDocumentCount !== 0 || missingScopeClinicalAddendumCount !== 0 || missingContextPatientCount !== 0 || missingContextGuardianCount !== 0 || missingContextDiagnosticRequestCount !== 0 || missingContextSpecimenCount !== 0 || missingContextDiagnosticResultCount !== 0 || hiddenWorkspacePatientCount !== 0 || hiddenWorkspaceGuardianCount !== 0 || hiddenWorkspaceDiagnosticRequestCount !== 0 || hiddenWorkspaceSpecimenCount !== 0 || hiddenWorkspaceDiagnosticResultCount !== 0 || hiddenWorkspaceAppointmentCount !== 0 || hiddenWorkspaceClinicalDocumentCount !== 0 || hiddenWorkspaceClinicalAddendumCount !== 0 || hiddenWorkspaceKnowledgeCount !== 0 || hiddenUnitPatientCount !== 0 || hiddenUnitGuardianCount !== 0 || hiddenUnitDiagnosticRequestCount !== 0 || hiddenUnitSpecimenCount !== 0 || hiddenUnitDiagnosticResultCount !== 0 || hiddenUnitAppointmentCount !== 0 || hiddenUnitClinicalDocumentCount !== 0 || hiddenUnitClinicalAddendumCount !== 0 || hiddenUnitKnowledgeCount !== 0 || hiddenUnitProviderCount !== 0 || hiddenOrganizationCount !== 0 || hiddenSnapshotCount !== 0 || hiddenJournalCount !== 0 || hiddenOutboxCount !== 0 || hiddenUsageCount !== 0 || hiddenInboxCount !== 0 || hiddenExternalEffectsCount !== 0 || hiddenBreakGlassCount !== 0 || forbiddenWorkspaceClinicalUpdate.rowCount !== 0 || forbiddenWorkspaceDiagnosticUpdate.rowCount !== 0 || forbiddenWorkspaceSpecimenUpdate.rowCount !== 0 || forbiddenWorkspaceDiagnosticResultUpdate.rowCount !== 0 || forbiddenUnitClinicalUpdate.rowCount !== 0 || forbiddenUnitDiagnosticUpdate.rowCount !== 0 || forbiddenUnitSpecimenUpdate.rowCount !== 0 || forbiddenUnitDiagnosticResultUpdate.rowCount !== 0 || unprotectedTables.length !== 0) throw new Error(`RLS did not isolate the complete domain catalog: ${JSON.stringify(unprotectedTables)}`);
    await client.query("reset role");
    const rejectedDiagnosticChildren = (await client.query<{ count: number }>("select count(*)::int as count from specimens where id = $1 union all select count(*)::int as count from diagnostic_results where id = $2", [invalidSpecimenId, invalidResultId])).rows;
    if (rejectedDiagnosticChildren.some((row) => row.count !== 0)) throw new Error("negative diagnostic child writes left rows behind");
    const protection = (await client.query<{ domain_tables: number; protected_tables: number; organization_foreign_keys: number }>("select count(*) filter (where c.relkind = 'r' and c.relname <> 'schema_migrations')::int as domain_tables, count(*) filter (where c.relkind = 'r' and c.relname <> 'schema_migrations' and c.relrowsecurity and c.relforcerowsecurity)::int as protected_tables, (select count(*)::int from pg_constraint where contype = 'f' and pg_get_constraintdef(oid) like 'FOREIGN KEY (organization_id,%') as organization_foreign_keys from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'")).rows[0];
    catalogProtection = { domainTables: protection?.domain_tables ?? 0, protectedTables: protection?.protected_tables ?? 0, organizationForeignKeys: protection?.organization_foreign_keys ?? 0 };
    if (catalogProtection.domainTables === 0 || catalogProtection.protectedTables !== catalogProtection.domainTables || catalogProtection.organizationForeignKeys < 1) throw new Error(`domain catalog protection is incomplete: ${JSON.stringify(catalogProtection)}`);
  } finally {
    await client.query("reset role").catch(() => undefined);
    if (needsTemporaryRole) {
      await client.query(`revoke all privileges on organizations, patients, guardians, diagnostic_requests, specimens, diagnostic_results, outbox_records, ai_usage_ledger, integration_inbox_records, external_effects, break_glass_grants, ai_turns, ai_drafts, lifecycle_decisions, lifecycle_transition_events, inbox_records, appointments, encounters, clinical_documents, clinical_addenda, knowledge_documents, communication_messages, ai_sessions, ai_approvals, audit_records, command_receipts, role_assignments, providers, resources, queue_entries, beds, hospital_episodes, stock_locations, charges from "${rlsRole}"`).catch(() => undefined);
      await client.query(`revoke all privileges on cvg_state_snapshots, cvg_event_journal from "${rlsRole}"`).catch(() => undefined);
      await client.query(`revoke usage on schema public from "${rlsRole}"`).catch(() => undefined);
      await client.query(`drop role "${rlsRole}"`);
    }
  }
  await client.end();
} finally {
  await second.app.close();
}

const baselinePersistence = new PostgresPersistence({ connectionString: databaseUrl });
const contenderA = new PostgresPersistence({ connectionString: databaseUrl });
const contenderB = new PostgresPersistence({ connectionString: databaseUrl });
try {
  const baseline = await baselinePersistence.loadLatest(second.store.bootstrapCredentials.organizationId);
  if (!baseline) throw new Error("durable verification has no latest snapshot for CAS test");
  const common = {
    expectedRevision: baseline.revision,
    snapshot: baseline.snapshot,
    eventType: "SYSTEM" as const,
    operation: "verify.postgres.cas",
    organizationId: baseline.snapshot.organizations[0]?.id ?? null,
    actorId: null,
    correlationId: "verify-postgres-cas",
    aggregateType: "Verification",
    aggregateId: null,
    payload: { synthetic: true }
  };
  const contenders = await Promise.allSettled([
    contenderA.commit({ ...common, eventId: randomUUID() }),
    contenderB.commit({ ...common, eventId: randomUUID() })
  ]);
  const successful = contenders.filter((result) => result.status === "fulfilled");
  const conflicts = contenders.filter((result) => result.status === "rejected" && result.reason instanceof PersistenceConflictError);
  if (successful.length !== 1 || conflicts.length !== 1) throw new Error("real PostgreSQL CAS did not produce exactly one winner and one conflict");
} finally {
  await baselinePersistence.close();
  await contenderA.close();
  await contenderB.close();
}

// Agent runtime session state against real PostgreSQL: tenant-scoped RLS,
// monotonic leases/fences, append-only ledger and tamper-evident checkpoints.
let agentSessionProof: Record<string, unknown> = { status: "NOT_RUN" };
let usageGuardProof: Record<string, unknown> = { status: "NOT_RUN" };
{
  const agentPool = new pg.Pool({ connectionString: databaseUrl, max: 2, application_name: "cvg-agent-runtime-verify-a" });
  const agentPoolB = new pg.Pool({ connectionString: databaseUrl, max: 2, application_name: "cvg-agent-runtime-verify-b" });
  try {
    const store = new PostgresAgentSessionStore(createScopedSqlExecutor({
      connect: async () => {
        const client = await agentPool.connect();
        return { query: async (text: string, params: readonly unknown[]) => ({ rows: (await client.query(text, params as unknown[])).rows as Record<string, unknown>[] }), release: () => client.release() };
      }
    }));
    const storeB = new PostgresAgentSessionStore(createScopedSqlExecutor({
      connect: async () => {
        const client = await agentPoolB.connect();
        return { query: async (text: string, params: readonly unknown[]) => ({ rows: (await client.query(text, params as unknown[])).rows as Record<string, unknown>[] }), release: () => client.release() };
      }
    }));
    const organizationId = String(second.store.bootstrapCredentials.organizationId);
    const actorId = String(second.store.bootstrapCredentials.userId);
    const option = second.store.contextOptions(second.store.bootstrapCredentials.userId)[0];
    if (!option) throw new Error("agent session verification requires a context option");
    const sessionId = randomUUID();
    await store.create({ sessionId, organizationId, actorId, unitId: String(option.unit.id), workspaceId: String(option.workspace.id), purpose: "SUMMARY", taskObjective: "verify-postgres agent session", ttlMs: 120_000 });
    const leaseA = await store.acquireLease({ sessionId, organizationId, ownerId: "verify-instance-a", ttlMs: 120_000 });
    if (!leaseA || leaseA.fence !== 1) throw new Error(`agent lease A expected fence 1, observed ${JSON.stringify(leaseA)}`);
    const leaseB = await storeB.acquireLease({ sessionId, organizationId, ownerId: "verify-instance-b", ttlMs: 120_000 });
    if (leaseB !== null) throw new Error("a live agent lease must block a second owner");
    const checkpoint = await store.checkpoint({ sessionId, organizationId, fence: leaseA.fence, payload: { turn: 1, state: "WAITING_APPROVAL" } });
    if (checkpoint.sequence !== 1) throw new Error(`checkpoint sequence expected 1, observed ${checkpoint.sequence}`);
    // The fence invariant is enforced by the database too: a tenant-scoped raw
    // append with a stale fence must be rejected by the 039 trigger.
    {
      const client = await agentPool.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('cvg.organization_id', $1, true)", [organizationId]);
        let staleRejected = false;
        try {
          await client.query("insert into agent_checkpoints (session_id, organization_id, sequence, schema_version, digest, payload, fence) values ($1,$2,99,1,$3,'{}'::jsonb,0)", [sessionId, organizationId, "a".repeat(64)]);
        } catch {
          staleRejected = true;
        }
        await client.query("rollback");
        if (!staleRejected) throw new Error("the database must reject an append with a stale fence");
      } finally {
        client.release();
      }
    }
    let staleRejected = false;
    try {
      await store.checkpoint({ sessionId, organizationId, fence: leaseA.fence + 5, payload: { forged: true } });
    } catch (error) {
      staleRejected = error instanceof AgentSessionError && error.code === "DENIED_STALE_FENCE";
    }
    if (!staleRejected) throw new Error("the agent session store must reject a future fence with DENIED_STALE_FENCE");
    const firstTurn = await store.appendTurn({ turnId: randomUUID(), sessionId, organizationId, sequence: 0, status: "COMPLETED", inputDigest: digest({ turn: 1 }), contextDigest: null, modelRequestDigest: null, modelResponseDigest: null, toolRequestIds: [], usageRecordId: null, provenance: { provider: "verify" }, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), fence: leaseA.fence });
    const secondTurn = await store.appendTurn({ turnId: randomUUID(), sessionId, organizationId, sequence: 0, status: "COMPLETED", inputDigest: digest({ turn: 2 }), contextDigest: null, modelRequestDigest: null, modelResponseDigest: null, toolRequestIds: [], usageRecordId: null, provenance: { provider: "verify" }, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), fence: leaseA.fence });
    if (firstTurn.sequence !== 1 || secondTurn.sequence !== 2) throw new Error(`agent turn sequence expected 1,2 observed ${firstTurn.sequence},${secondTurn.sequence}`);
    if (!usageForAgent) throw new Error("usage guard probe has no valid usage fixture");
    const validUsageTurn = await store.appendTurn({ turnId: randomUUID(), sessionId, organizationId, sequence: 0, status: "COMPLETED", inputDigest: digest({ turn: "valid-usage" }), contextDigest: null, modelRequestDigest: null, modelResponseDigest: null, toolRequestIds: [], usageRecordId: usageForAgent.id, provenance: { provider: "verify", usage: "valid" }, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), fence: leaseA.fence });
    if (validUsageTurn.usageRecordId !== usageForAgent.id || validUsageTurn.sequence !== 3) throw new Error("valid usage reference was not persisted on the next agent turn");

    const sideEffectCounts = async (): Promise<{ turns: number; audits: number; usage: number }> => {
      const client = await agentPool.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('cvg.organization_id', $1, true)", [organizationId]);
        const result = await client.query<{ turns: number; audits: number; usage: number }>(
          "select (select count(*)::int from agent_turns where session_id = $1) as turns, (select count(*)::int from cvg_audit_ledger) as audits, (select count(*)::int from ai_usage_ledger) as usage",
          [sessionId]
        );
        await client.query("rollback");
        return result.rows[0] ?? { turns: -1, audits: -1, usage: -1 };
      } finally {
        client.release();
      }
    };
    const beforeInvalidUsage = await sideEffectCounts();
    const expectInvalidUsage = async (usageRecordId: string, label: string): Promise<string> => {
      try {
        await store.appendTurn({ turnId: randomUUID(), sessionId, organizationId, sequence: 0, status: "COMPLETED", inputDigest: digest({ turn: label }), contextDigest: null, modelRequestDigest: null, modelResponseDigest: null, toolRequestIds: [], usageRecordId, provenance: { provider: "verify", usage: label }, startedAt: new Date().toISOString(), completedAt: null, fence: leaseA.fence });
      } catch (error) {
        if (error instanceof AgentSessionError && error.code === "SESSION_INVALID" && error.message.includes("usage reference is invalid")) return error.code;
        throw error;
      }
      throw new Error(`${label} usage reference was accepted`);
    };
    const danglingUsageCode = await expectInvalidUsage(randomUUID(), "dangling");
    const crossTenantOrganizationId = id(randomUUID());
    const ownerClient = new pg.Client({ connectionString: migrationDatabaseUrl });
    await ownerClient.connect();
    try {
      await ownerClient.query("insert into organizations(id, name, slug, status) values ($1, $2, $3, 'ACTIVE')", [crossTenantOrganizationId, "AUD23 cross-tenant fixture", `aud23-cross-${crossTenantOrganizationId}`]);
    } finally {
      await ownerClient.end().catch(() => undefined);
    }
    const crossTenantPersistence = new PostgresPersistence({ connectionString: databaseUrl });
    let crossTenantUsage: { id: string };
    try {
      crossTenantUsage = await crossTenantPersistence.recordUsage({ id: id(randomUUID()), organizationId: crossTenantOrganizationId, reservationId: null, providerRequestId: "aud23-cross-tenant-provider", idempotencyKey: "aud23-cross-tenant-usage", usageKind: "TOKENS", reservedUnits: 1, consumedUnits: 1, status: "RECEIVED", record: { synthetic: true, scope: "cross-tenant" } });
    } finally {
      await crossTenantPersistence.close();
    }
    const crossTenantCode = await expectInvalidUsage(crossTenantUsage.id, "cross-tenant");
    const afterInvalidUsage = await sideEffectCounts();
    if (JSON.stringify(beforeInvalidUsage) !== JSON.stringify(afterInvalidUsage)) throw new Error(`invalid usage references changed durable side effects: before=${JSON.stringify(beforeInvalidUsage)} after=${JSON.stringify(afterInvalidUsage)}`);
    usageGuardProof = { status: "PASS", validUsage: "PASS", danglingUsage: { status: "REJECTED", code: danglingUsageCode }, crossTenantUsage: { status: "REJECTED", code: crossTenantCode }, invalidSideEffects: { before: beforeInvalidUsage, after: afterInvalidUsage, unchanged: true }, crossTenantDisclosure: "generic SESSION_INVALID; no existence disclosure", staleFenceTaxonomy: "DENIED_STALE_FENCE remains reserved for invalid session/fence", sqlUsageParameter: "$10" };
    // Tenant-scoped append-only probe: with the GUC set, RLS admits the row and
    // the 038 trigger (or the missing UPDATE grant) must reject the mutation.
    {
      const client = await agentPool.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('cvg.organization_id', $1, true)", [organizationId]);
        let immutableRejected = false;
        try {
          await client.query("update agent_turns set status = 'FAILED' where turn_id = $1", [firstTurn.turnId]);
        } catch {
          immutableRejected = true;
        }
        await client.query("rollback");
        if (!immutableRejected) throw new Error("agent turn ledger must be append-only");
      } finally {
        client.release();
      }
    }
    const latest = await store.latestCheckpoint(sessionId, { organizationId, actorId });
    if (!latest || latest.sequence !== 1 || latest.payload["state"] !== "WAITING_APPROVAL") throw new Error("latest checkpoint did not round-trip");
    let staleCompletionRejected = false;
    try {
      await store.complete({ sessionId, organizationId, fence: leaseA.fence + 7, runState: "COMPLETED" });
    } catch (error) {
      staleCompletionRejected = error instanceof AgentSessionError && error.code === "DENIED_STALE_FENCE";
    }
    if (!staleCompletionRejected) throw new Error("stale completion must be rejected");
    const completed = await store.complete({ sessionId, organizationId, fence: leaseA.fence, runState: "COMPLETED" });
    if (completed.runState !== "COMPLETED") throw new Error("agent session completion did not persist");
    // CVG-AUD19-003/008: the same TTL/lease/mutex contract as the memory store,
    // executed against real PostgreSQL with expiry controlled by the database,
    // not by a wall-clock sleep that can race connection roundtrips.
    const ttlContractSessionId = randomUUID();
    const ttlContractFailures = await verifyAgentSessionTtlContract({
      store,
      organizationId,
      actorId,
      unitId: String(option.unit.id),
      workspaceId: String(option.workspace.id),
      sessionId: ttlContractSessionId,
      ttlMs: AGENT_SESSION_TTL_VERIFICATION_MS,
      expireSession: async () => { await expireAgentSession(agentPool, organizationId, ttlContractSessionId, "AT_LIMIT"); }
    });
    if (ttlContractFailures.length > 0) throw new Error(`agent session TTL contract failed: ${ttlContractFailures.join("; ")}`);
    const ttlMatrixFailures = await verifyAgentSessionTtlMatrix({ primary: store, secondary: storeB, expiryPool: agentPool, organizationId, actorId, unitId: String(option.unit.id), workspaceId: String(option.workspace.id) });
    if (ttlMatrixFailures.length > 0) throw new Error(`agent session TTL matrix failed: ${ttlMatrixFailures.join("; ")}`);
    const unscoped = await agentPool.query<{ count: number }>("select count(*)::int as count from agent_sessions");
    if (Number(unscoped.rows[0]?.count ?? -1) !== 0) throw new Error("agent_sessions leaked rows without a tenant GUC (RLS failure)");
    await store.releaseLease({ sessionId, organizationId, ownerId: leaseA.ownerId, fence: leaseA.fence });
    agentSessionProof = { status: "PASS", fence: leaseA.fence, checkpointSequence: checkpoint.sequence, turnSequences: [firstTurn.sequence, secondTurn.sequence], appendOnly: true, rlsUnscopedRows: 0, ttlContract: { status: "PASS", ttlMs: AGENT_SESSION_TTL_VERIFICATION_MS, repetitions: 20, phases: ["BEFORE", "AT_LIMIT", "AFTER_LIMIT"], pools: 2, clock: "DATABASE_EXPIRY_WRITE_NO_SLEEP" } };

    // CVG-AUD19-012: the runtime role holds only the granted matrix, and the
    // revoked operations fail as cvg_runtime.
    const matrix = await agentPool.query<Record<string, boolean>>(`select
      has_table_privilege(current_user, 'public.agent_sessions', 'SELECT') as sessions_select,
      has_table_privilege(current_user, 'public.agent_sessions', 'INSERT') as sessions_insert,
      has_table_privilege(current_user, 'public.agent_sessions', 'UPDATE') as sessions_update,
      has_table_privilege(current_user, 'public.agent_sessions', 'DELETE') as sessions_delete,
      has_table_privilege(current_user, 'public.agent_turns', 'SELECT') as turns_select,
      has_table_privilege(current_user, 'public.agent_turns', 'INSERT') as turns_insert,
      has_table_privilege(current_user, 'public.agent_turns', 'UPDATE') as turns_update,
      has_table_privilege(current_user, 'public.agent_turns', 'DELETE') as turns_delete,
      has_table_privilege(current_user, 'public.agent_checkpoints', 'UPDATE') as checkpoints_update,
      has_table_privilege(current_user, 'public.agent_checkpoints', 'DELETE') as checkpoints_delete,
      has_table_privilege(current_user, 'public.agent_leases', 'DELETE') as leases_delete,
      has_table_privilege(current_user, 'public.cvg_audit_ledger', 'UPDATE') as audit_update,
      has_table_privilege(current_user, 'public.cvg_audit_ledger', 'DELETE') as audit_delete,
      has_table_privilege(current_user, 'public.audit_records', 'UPDATE') as audit_records_update,
      has_table_privilege(current_user, 'public.cvg_event_journal', 'UPDATE') as journal_update,
      has_table_privilege(current_user, 'public.cvg_command_receipt_ledger', 'DELETE') as receipt_ledger_delete,
      has_table_privilege(current_user, 'public.ai_usage_ledger', 'UPDATE') as usage_update,
      has_table_privilege(current_user, 'public.ai_usage_ledger', 'DELETE') as usage_delete,
      has_table_privilege(current_user, 'public.command_receipts', 'DELETE') as receipts_delete,
      has_table_privilege(current_user, 'public.break_glass_grants', 'DELETE') as break_glass_delete
    `);
    const expectedMatrix: Record<string, boolean> = {
      sessions_select: true, sessions_insert: true, sessions_update: true, sessions_delete: false,
      turns_select: true, turns_insert: true, turns_update: false, turns_delete: false,
      checkpoints_update: false, checkpoints_delete: false, leases_delete: true,
      audit_update: true, audit_delete: false, audit_records_update: false, journal_update: false, receipt_ledger_delete: false,
      usage_update: true, usage_delete: false, receipts_delete: false, break_glass_delete: false
    };
    for (const [privilege, expected] of Object.entries(expectedMatrix)) {
      if (matrix.rows[0]?.[privilege] !== expected) throw new Error(`runtime privilege matrix diverged for ${privilege}: expected ${expected}, observed ${matrix.rows[0]?.[privilege]}`);
    }
    const negativeAttempts: Array<[string, string]> = [
      ["delete agent_sessions", "delete from agent_sessions where session_id = $1"],
      ["update agent_turns", "update agent_turns set status = 'FAILED' where session_id = $1"],
      ["delete agent_turns", "delete from agent_turns where session_id = $1"],
      ["update agent_checkpoints", "update agent_checkpoints set digest = digest where session_id = $1"],
      ["update audit_records", "update audit_records set result = 'DENIED' where organization_id = $1"],
      ["delete cvg_audit_ledger", "delete from cvg_audit_ledger where organization_id = $1"],
      ["mutate cvg_audit_ledger", "update cvg_audit_ledger set record = record || '{\"tamper\": true}'::jsonb where organization_id = $1"],
      ["delete cvg_command_receipt_ledger", "delete from cvg_command_receipt_ledger where organization_id = $1"],
      ["delete command_receipts", "delete from command_receipts where organization_id = $1"],
      ["delete break_glass_grants", "delete from break_glass_grants where organization_id = $1"]
    ];
    const auditRowsClient = await agentPool.connect();
    let auditRows = 0;
    try {
      await auditRowsClient.query("begin");
      await auditRowsClient.query("select set_config('cvg.organization_id', $1, true)", [organizationId]);
      const counted = await auditRowsClient.query<{ count: number }>("select count(*)::int as count from cvg_audit_ledger");
      auditRows = Number(counted.rows[0]?.count ?? 0);
      await auditRowsClient.query("rollback");
    } finally {
      auditRowsClient.release();
    }
    if (auditRows < 1) throw new Error("privilege matrix requires at least one audit ledger row to prove the append-only guard");
    const negativeResults: Record<string, string> = {};
    for (const [name, statement] of negativeAttempts) {
      const client = await agentPool.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('cvg.organization_id', $1, true)", [organizationId]);
        let rejected = false;
        try {
          await client.query(statement, [name.includes("agent_") ? sessionId : organizationId]);
        } catch {
          rejected = true;
        }
        await client.query("rollback");
        if (!rejected) throw new Error(`runtime role must not be able to ${name}`);
        negativeResults[name] = "REJECTED";
      } finally {
        client.release();
      }
    }
    // CVG-AUD20-002: terminal sessions are immutable and the runtime cannot
    // create the restore state or use a historical fence.
    const terminalSessionId = randomUUID();
    await store.create({ sessionId: terminalSessionId, organizationId, actorId, unitId: String(option.unit.id), workspaceId: String(option.workspace.id), purpose: "SUMMARY", taskObjective: "terminal-guard", ttlMs: 120_000 });
    const terminalLease = await store.acquireLease({ sessionId: terminalSessionId, organizationId, ownerId: "terminal-owner", ttlMs: 120_000 });
    if (!terminalLease) throw new Error("terminal guard could not acquire a lease");
    await store.complete({ sessionId: terminalSessionId, organizationId, fence: terminalLease.fence, runState: "COMPLETED" });
    const terminalProof: Record<string, string> = {};
    try {
      await store.appendTurn({ turnId: randomUUID(), sessionId: terminalSessionId, organizationId, sequence: 0, status: "COMPLETED", inputDigest: "a".repeat(64), contextDigest: null, modelRequestDigest: null, modelResponseDigest: null, toolRequestIds: [], usageRecordId: null, provenance: {}, startedAt: new Date().toISOString(), completedAt: null, fence: terminalLease.fence });
      throw new Error("terminal session accepted a new turn");
    } catch (error) {
      if (error instanceof Error && error.message === "terminal session accepted a new turn") throw error;
      terminalProof["turnAfterComplete"] = "REJECTED";
    }
    try {
      await store.checkpoint({ sessionId: terminalSessionId, organizationId, fence: terminalLease.fence, payload: { after: "terminal" } });
      throw new Error("terminal session accepted a checkpoint");
    } catch (error) {
      if (error instanceof Error && error.message === "terminal session accepted a checkpoint") throw error;
      terminalProof["checkpointAfterComplete"] = "REJECTED";
    }
    const renewedAfterComplete = await store.renewLease({ sessionId: terminalSessionId, organizationId, ownerId: terminalLease.ownerId, ttlMs: 120_000, fence: terminalLease.fence });
    if (renewedAfterComplete) throw new Error("terminal session renewed a lease after completion");
    terminalProof["renewAfterComplete"] = "REJECTED";
    {
      const client = await agentPool.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('cvg.organization_id', $1, true)", [organizationId]);
        let restoreStateRejected = false;
        try {
          await client.query("update agent_sessions set run_state = 'QUARANTINED_RESTORE' where session_id = $1", [terminalSessionId]);
        } catch { restoreStateRejected = true; }
        let historicalFenceRejected = false;
        try {
          await client.query("insert into agent_turns(turn_id, session_id, organization_id, sequence, status, input_digest, context_digest, model_request_digest, model_response_digest, tool_request_ids, usage_record_id, provenance, started_at, completed_at, fence) values ($1,$2,$3,99,'COMPLETED',$4,null,null,null,'[]'::jsonb,null,'{}'::jsonb,now(),null,0)", [randomUUID(), terminalSessionId, organizationId, "a".repeat(64)]);
        } catch { historicalFenceRejected = true; }
        await client.query("rollback");
        if (!restoreStateRejected) throw new Error("runtime role created QUARANTINED_RESTORE");
        if (!historicalFenceRejected) throw new Error("runtime role appended history with a non-authoritative fence");
        terminalProof["restoreState"] = "REJECTED";
        terminalProof["historicalFence"] = "REJECTED";
      } finally {
        client.release();
      }
    }
    {
      const ownerClient = new pg.Client({ connectionString: migrationDatabaseUrl, connectionTimeoutMillis: 2_500 });
      await ownerClient.connect();
      try {
        const runtimeIdentity = await agentPool.query<{ current_user: string }>("select current_user");
        const ownerIdentity = await ownerClient.query<{ current_user: string; table_owner: string | null }>("select current_user, (select tableowner from pg_tables where schemaname = 'public' and tablename = 'agent_sessions') as table_owner");
        const runtimeUser = runtimeIdentity.rows[0]?.current_user;
        const ownerRow = ownerIdentity.rows[0];
        if (!ownerRow || !ownerRow.table_owner || ownerRow.current_user !== ownerRow.table_owner || ownerRow.current_user === runtimeUser) throw new Error("MIGRATION_DATABASE_URL must identify a distinct owner of public.agent_sessions");
        await ownerClient.query("begin");
        await ownerClient.query("select set_config('cvg.organization_id', $1, true)", [organizationId]);
        let genericOwnerRejected = false;
        try {
          await ownerClient.query("update agent_sessions set run_state = 'RUNNING' where session_id = $1", [terminalSessionId]);
        } catch { genericOwnerRejected = true; }
        await ownerClient.query("rollback");
        if (!genericOwnerRejected) throw new Error("generic schema owner mutated a terminal agent session");
        terminalProof["genericOwnerTerminalWrite"] = "REJECTED";
      } finally {
        await ownerClient.end().catch(() => undefined);
      }
    }
    // CVG-AUD20-003: a table/sequence created after the migrations inherits no
    // runtime DML because the broad defaults were revoked.
    {
      const client = await agentPool.connect();
      const owner = new pg.Client({ connectionString: migrationDatabaseUrl });
      try {
        await owner.connect();
        await owner.query("create table if not exists cvg_future_privilege_probe(id uuid primary key)");
        await owner.query("create sequence if not exists cvg_future_sequence_probe");
        const probe = await client.query<{ table_insert: boolean; table_select: boolean; sequence_usage: boolean }>(
          "select has_table_privilege(current_user, 'public.cvg_future_privilege_probe', 'INSERT') as table_insert, has_table_privilege(current_user, 'public.cvg_future_privilege_probe', 'SELECT') as table_select, has_sequence_privilege(current_user, 'public.cvg_future_sequence_probe', 'USAGE') as sequence_usage"
        );
        if (probe.rows[0]?.table_insert !== false || probe.rows[0]?.table_select !== false || probe.rows[0]?.sequence_usage !== false) throw new Error(`future objects inherited runtime privileges: ${JSON.stringify(probe.rows[0])}`);
        terminalProof["futureTablePrivileges"] = "DENIED";
        terminalProof["futureSequencePrivileges"] = "DENIED";
      } finally {
        await owner.query("drop table if exists cvg_future_privilege_probe").catch(() => undefined);
        await owner.query("drop sequence if exists cvg_future_sequence_probe").catch(() => undefined);
        await owner.end().catch(() => undefined);
        client.release();
      }
    }
    agentSessionProof = { ...(agentSessionProof as Record<string, unknown>), privilegeMatrix: "PASS", negativeAttempts: negativeResults, terminalGuards: terminalProof };
  } catch (error) {
    await agentPool.end();
    await agentPoolB.end();
    throw error;
  }
  await agentPool.end();
  await agentPoolB.end();
}

console.log(JSON.stringify({ postgres: "PASS", restartRead: "PASS", normalizedReads: "PASS", diagnosticRequest: "PASS", diagnosticSpecimen: "PASS", diagnosticResult: "PASS", diagnosticChildIntegrity: "PASS", idempotency: "PASS", outbox: "PASS", externalEffects: "PASS", inbox: "PASS", usageLedger: "PASS", breakGlass: "PASS", cas: "PASS", rls: "PASS", agentSession: agentSessionProof, usageGuard: usageGuardProof, rlsDomainTables: catalogProtection.domainTables, rlsProtectedTables: catalogProtection.protectedTables, organizationForeignKeys: catalogProtection.organizationForeignKeys, runtimeRole, migrationPrivileges, receiptId: firstResult.receiptId, counts }, null, 2));
