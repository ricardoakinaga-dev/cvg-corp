import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import pg from "pg";
import { createRuntime, type CvgServerRuntime } from "@cvg/api";
import { id } from "@cvg/contracts";
import { digest } from "@cvg/domain";
import { OutboxWorker, type ExternalEffectQueryAdapter } from "@cvg/integrations";
import { OutboxLeaseLostError, PersistenceConflictError, PersistenceStateError, PostgresPersistence, type DurableInboxInput } from "@cvg/persistence";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required; run npm run db:migrate first");
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

  const appointments = await second.app.inject({ method: "GET", url: "/api/v1/appointments", headers: auth.headers });
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
  const usageReplay = await second.persistence!.recordUsage(usageInput);
  if (usage.id !== usageReplay.id || usage.recordDigest !== usageReplay.recordDigest) throw new Error("usage ledger replay was not idempotent");

  // The persistence proof records only a grant already admitted by an
  // application boundary; WebAuthn verification and public activation remain
  // deliberately outside this synthetic database gate.
  const breakGlassIssuedAt = new Date(Date.now() - 1_000).toISOString();
  const breakGlassExpiresAt = new Date(Date.now() + 60_000).toISOString();
  const durableBreakGlass = await second.persistence!.createBreakGlassGrant({ grantId: id(randomUUID()), organizationId, actorId: second.store.bootstrapCredentials.userId, approverId: vetId, reason: "synthetic incident review", target: "patient:synthetic", mfaMethod: "WEBAUTHN", issuedAt: breakGlassIssuedAt, expiresAt: breakGlassExpiresAt });
  if (durableBreakGlass.status !== "ACTIVE" || durableBreakGlass.mfaMethod !== "WEBAUTHN") throw new Error("durable break-glass grant was not created as active WebAuthn evidence");
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
  const invalidSpecimenId = randomUUID();
  const invalidResultId = randomUUID();
  const currentRole = (await client.query<{ rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean }>(
    "select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname = current_user"
  )).rows[0];
  const needsTemporaryRole = !currentRole || currentRole.rolsuper || currentRole.rolbypassrls || currentRole.rolcreaterole || currentRole.rolcreatedb;
  if (needsTemporaryRole) await client.query(`create role "${rlsRole}" noinherit nosuperuser nobypassrls nocreatedb nocreaterole`);
  try {
    if (needsTemporaryRole) {
      await client.query(`grant usage on schema public to "${rlsRole}"`);
      await client.query(`grant select, update on organizations, patients, guardians, diagnostic_requests, specimens, diagnostic_results, outbox_records, ai_usage_ledger, integration_inbox_records, external_effects, break_glass_grants, ai_turns, ai_drafts, lifecycle_decisions, lifecycle_transition_events, inbox_records, appointments, encounters, clinical_documents, clinical_addenda, knowledge_documents, communication_messages, ai_sessions, ai_approvals, audit_records, command_receipts, role_assignments, providers, resources, queue_entries, beds, hospital_episodes, stock_locations, charges to "${rlsRole}"`);
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
    if (visibleOrganizationCount !== 1 || (visibleSnapshotCount ?? 0) < 1 || (visibleJournalCount ?? 0) < 1 || (visibleOutboxCount ?? 0) < 1 || (visibleUsageCount ?? 0) < 1 || (visibleInboxCount ?? 0) < 1 || (visibleExternalEffectsCount ?? 0) < 1 || (visibleBreakGlassCount ?? 0) < 2 || (visiblePatientCount ?? 0) < 1 || (visibleGuardianCount ?? 0) < 1 || (visibleDiagnosticRequestCount ?? 0) < 1 || (visibleSpecimenCount ?? 0) < 1 || (visibleDiagnosticResultCount ?? 0) < 1 || (visibleAppointmentCount ?? 0) < 1 || (visibleClinicalDocumentCount ?? 0) < 1 || (visibleClinicalAddendumCount ?? 0) < 1 || (visibleKnowledgeCount ?? 0) < 1 || (visibleProviderCount ?? 0) < 1 || (visibleRoleCount ?? 0) < 1 || (visibleAiTurnCount ?? 0) !== 0 || (visibleAiDraftCount ?? 0) !== 0 || (visibleLifecycleDecisionCount ?? 0) !== 0 || (visibleLifecycleEventCount ?? 0) !== 0 || (visibleLegacyInboxCount ?? 0) !== 0 || missingScopeClinicalDocumentCount !== 0 || missingScopeClinicalAddendumCount !== 0 || missingContextPatientCount !== 0 || missingContextGuardianCount !== 0 || missingContextDiagnosticRequestCount !== 0 || missingContextSpecimenCount !== 0 || missingContextDiagnosticResultCount !== 0 || hiddenWorkspacePatientCount !== 0 || hiddenWorkspaceGuardianCount !== 0 || hiddenWorkspaceDiagnosticRequestCount !== 0 || hiddenWorkspaceSpecimenCount !== 0 || hiddenWorkspaceDiagnosticResultCount !== 0 || hiddenWorkspaceAppointmentCount !== 0 || hiddenWorkspaceClinicalDocumentCount !== 0 || hiddenWorkspaceClinicalAddendumCount !== 0 || hiddenWorkspaceKnowledgeCount !== 0 || hiddenUnitPatientCount !== 0 || hiddenUnitGuardianCount !== 0 || hiddenUnitDiagnosticRequestCount !== 0 || hiddenUnitSpecimenCount !== 0 || hiddenUnitDiagnosticResultCount !== 0 || hiddenUnitAppointmentCount !== 0 || hiddenUnitClinicalDocumentCount !== 0 || hiddenUnitClinicalAddendumCount !== 0 || hiddenUnitKnowledgeCount !== 0 || hiddenUnitProviderCount !== 0 || hiddenOrganizationCount !== 0 || hiddenSnapshotCount !== 0 || hiddenJournalCount !== 0 || hiddenOutboxCount !== 0 || hiddenUsageCount !== 0 || hiddenInboxCount !== 0 || hiddenExternalEffectsCount !== 0 || hiddenBreakGlassCount !== 0 || forbiddenWorkspaceClinicalUpdate.rowCount !== 0 || forbiddenWorkspaceDiagnosticUpdate.rowCount !== 0 || forbiddenWorkspaceSpecimenUpdate.rowCount !== 0 || forbiddenWorkspaceDiagnosticResultUpdate.rowCount !== 0 || forbiddenUnitClinicalUpdate.rowCount !== 0 || forbiddenUnitDiagnosticUpdate.rowCount !== 0 || forbiddenUnitSpecimenUpdate.rowCount !== 0 || forbiddenUnitDiagnosticResultUpdate.rowCount !== 0 || unprotectedTables.length !== 0) throw new Error(`RLS did not isolate the complete domain catalog: ${JSON.stringify(unprotectedTables)}`);
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

console.log(JSON.stringify({ postgres: "PASS", restartRead: "PASS", normalizedReads: "PASS", diagnosticRequest: "PASS", diagnosticSpecimen: "PASS", diagnosticResult: "PASS", diagnosticChildIntegrity: "PASS", idempotency: "PASS", outbox: "PASS", externalEffects: "PASS", inbox: "PASS", usageLedger: "PASS", breakGlass: "PASS", cas: "PASS", rls: "PASS", rlsDomainTables: catalogProtection.domainTables, rlsProtectedTables: catalogProtection.protectedTables, organizationForeignKeys: catalogProtection.organizationForeignKeys, runtimeRole, migrationPrivileges, receiptId: firstResult.receiptId, counts }, null, 2));
