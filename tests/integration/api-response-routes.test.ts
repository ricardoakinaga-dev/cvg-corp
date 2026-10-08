import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  API_RESPONSE_SCHEMA_CATALOG,
  API_ROUTE_CATALOG,
  apiErrorEnvelopeSchema,
  apiPartialEnvelopeSchema,
  apiSuccessEnvelopeSchema
} from "@cvg/contracts";
import { createRuntime } from "@cvg/api";
import { CvgStore, serializeSnapshot } from "@cvg/domain";
import { API_PAYLOAD_RESPONSE_SCHEMAS } from "../../apps/api/src/response-schemas/index.js";

const syntheticId = "00000000-0000-4000-8000-000000000001";

function syntheticTotpCode(secret: string, atMs = Date.now()): string {
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of secret) {
    buffer = (buffer << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)));
  const hmac = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = ((hmac[offset]! & 0x7f) << 24) | ((hmac[offset + 1]! & 0xff) << 16) | ((hmac[offset + 2]! & 0xff) << 8) | (hmac[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function concretePath(path: string): string {
  return path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_match, parameter: string) =>
    parameter === "provider" ? "synthetic-provider" : syntheticId
  );
}

type ResponseBody = {
  schemaVersion: number;
  data?: unknown;
  error?: { code: string; message: string };
  correlationId: string;
};

function makeClient(runtime: Awaited<ReturnType<typeof createRuntime>>) {
  let cookies = "";
  let csrf = "";
  let context: { unit: { id: string }; workspace: { id: string } } | null = null;

  const request = async (method: "GET" | "POST" | "DELETE", path: string, payload?: unknown, extraHeaders: Record<string, string> = {}) => {
    const headers: Record<string, string> = {
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
      cookie: cookies,
      ...(context ? { "x-cvg-unit-id": context.unit.id, "x-cvg-workspace-id": context.workspace.id } : {}),
      ...extraHeaders
    };
    if (method !== "GET" && csrf) headers["x-csrf-token"] = csrf;
    const result = await runtime.app.inject({
      method,
      url: `/api/v1${path}`,
      headers,
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) })
    });
    const setCookie = result.headers["set-cookie"];
    const setCookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const cookieMap = new Map<string, string>();
    for (const pair of cookies.split("; ").filter(Boolean)) {
      const separator = pair.indexOf("=");
      if (separator > 0) cookieMap.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    for (const value of setCookies) {
      if (typeof value !== "string") continue;
      const pair = value.split(";")[0] ?? "";
      const separator = pair.indexOf("=");
      if (separator > 0) cookieMap.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    cookies = [...cookieMap.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    csrf = decodeURIComponent(cookieMap.get("cvg_csrf") ?? "");
    return { statusCode: result.statusCode, body: result.json<ResponseBody>() };
  };

  return {
    request,
    context: () => context,
    setContext: (value: { unit: { id: string }; workspace: { id: string } } | null) => { context = value; },
    login: async (login: string, password: string) => {
      const result = await request("POST", "/auth/login", { login, password });
      assert.equal(result.statusCode, 200, JSON.stringify(result.body));
      const route = API_ROUTE_CATALOG.find((candidate) => candidate.method === "POST" && candidate.path === "/auth/login");
      assert.ok(route, "POST /auth/login must have a catalog descriptor");
      assert.equal(apiSuccessEnvelopeSchema.safeParse(result.body).success, true, "POST /auth/login must return a versioned success envelope");
      const payloadSchema = API_PAYLOAD_RESPONSE_SCHEMAS.get(route.responseSchema);
      assert.ok(payloadSchema, `POST /auth/login has no executable payload schema ${route.responseSchema}`);
      const payloadResult = payloadSchema.safeParse(result.body.data);
      assert.equal(payloadResult.success, true, `POST /auth/login payload failed ${route.responseSchema}: ${JSON.stringify(payloadResult.success ? null : payloadResult.error.issues)}`);
      const data = result.body.data as { contexts?: Array<{ unit: { id: string }; workspace: { id: string } }> } | undefined;
      context = data?.contexts?.[0] ?? null;
      assert.ok(context, `login for ${login} must provide a synthetic unit and workspace`);
      return result;
    }
  };
}

test("all cataloged API routes preserve versioned envelopes for synthetic invalid or unauthenticated requests", async (t) => {
  const runtime = await createRuntime({
    store: new CvgStore({ bootstrapPassword: "synthetic-response-route-password" }),
    config: {
      nodeEnv: "test",
      storageMode: "memory",
      demoMode: true,
      webOrigin: "http://127.0.0.1:5173"
    }
  });
  t.after(async () => runtime.app.close());

  assert.equal(API_ROUTE_CATALOG.length, 106);
  assert.equal(new Set(API_ROUTE_CATALOG.map((route) => route.responseSchema)).size, 81);
  assert.equal(API_RESPONSE_SCHEMA_CATALOG.length, 81);

  const seen = new Set<string>();
  let errorResponses = 0;
  let successResponses = 0;
  let emptyResponses = 0;
  for (const route of API_ROUTE_CATALOG) {
    const key = `${route.method} ${route.path}`;
    assert.equal(seen.has(key), false, `duplicate catalog route ${key}`);
    seen.add(key);

    const response = await runtime.app.inject({
      method: route.method,
      url: `/api/v1${concretePath(route.path)}`,
      ...(route.method === "GET" ? {} : {
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ syntheticInvalidFixture: true })
      })
    });
    assert.notEqual(response.statusCode, 500, `${key} raised an internal error`);

    if (response.statusCode === 204) {
      emptyResponses++;
      assert.equal(response.body, "", `${key} must not attach a body to 204`);
      continue;
    }

    const envelope = response.json<unknown>();
    if (response.statusCode >= 400) {
      errorResponses++;
      assert.equal(apiErrorEnvelopeSchema.safeParse(envelope).success, true, `${key} returned a non-versioned error envelope`);
    } else {
      successResponses++;
      const success = apiSuccessEnvelopeSchema.safeParse(envelope).success;
      const partial = apiPartialEnvelopeSchema.safeParse(envelope).success;
      assert.equal(success || partial, true, `${key} returned a non-versioned success envelope`);
    }
  }

  assert.equal(seen.size, 106);
  assert.equal(errorResponses + successResponses + emptyResponses, 106);
  assert.ok(errorResponses > 0, "synthetic requests should exercise actual route error responses");
  assert.ok(successResponses > 0, "synthetic requests should exercise actual route success responses");

  const authenticated = makeClient(runtime);
  await authenticated.login("admin@cvg.local", "synthetic-response-route-password");
  let authenticatedGetPayloads = 0;
  const authenticatedGetErrors: string[] = [];
  const authenticatedGetEmpty: string[] = [];
  const getRoutes = API_ROUTE_CATALOG.filter((route) => route.method === "GET");
  for (const route of getRoutes) {
    const key = `${route.method} ${route.path}`;
    const response = await authenticated.request("GET", concretePath(route.path));
    assert.notEqual(response.statusCode, 500, `${key} raised an internal error for an authenticated synthetic user: ${JSON.stringify(response.body)}`);
    if (response.statusCode === 204) {
      authenticatedGetEmpty.push(key);
      assert.equal(response.body, "", `${key} must not attach a body to 204`);
      continue;
    }
    if (response.statusCode >= 400) {
      authenticatedGetErrors.push(`${key} ${response.statusCode}`);
      assert.equal(apiErrorEnvelopeSchema.safeParse(response.body).success, true, `${key} returned a non-versioned authenticated error envelope`);
      continue;
    }

    const descriptor = API_RESPONSE_SCHEMA_CATALOG.find((candidate) => candidate.name === route.responseSchema);
    assert.ok(descriptor, `${key} has no nominal response schema ${route.responseSchema}`);
    const payloadSchema = API_PAYLOAD_RESPONSE_SCHEMAS.get(route.responseSchema);
    assert.ok(payloadSchema, `${key} has no executable payload schema ${route.responseSchema}`);
    const parsedPayload = payloadSchema.safeParse(response.body.data);
    assert.equal(parsedPayload.success, true, `${key} payload failed ${route.responseSchema}: ${JSON.stringify(parsedPayload.success ? null : parsedPayload.error.issues)}`);
    authenticatedGetPayloads++;
  }
  assert.equal(getRoutes.length, 46);
  assert.equal(authenticatedGetPayloads, 42);
  assert.deepEqual(authenticatedGetErrors.sort(), [
    "GET /ai/sessions/:id/replay 404",
    "GET /clinical/documents/:id 404",
    "GET /knowledge/:id/index 404",
    "GET /patients/:id 404"
  ]);
  assert.deepEqual(authenticatedGetEmpty, []);
  t.diagnostic(`authenticated GET payload schemas: ${authenticatedGetPayloads}/${getRoutes.length}; versioned errors=${authenticatedGetErrors.join(", ") || "none"}; empty 204s=${authenticatedGetEmpty.join(", ") || "none"}`);
});

test("valid synthetic success fixtures reach the remaining safely executable catalog routes", async (t) => {
  const password = "synthetic-response-success-password";
  const runtime = await createRuntime({
    store: new CvgStore({ bootstrapPassword: password }),
    config: {
      nodeEnv: "test",
      storageMode: "memory",
      demoMode: true,
      webOrigin: "http://127.0.0.1:5173"
    }
  });
  t.after(async () => runtime.app.close());

  const covered = new Set<string>();
  const success = async (
    client: ReturnType<typeof makeClient>,
    method: "GET" | "POST" | "DELETE",
    catalogPath: string,
    requestPath: string,
    payload?: unknown,
    headers: Record<string, string> = {}
  ) => {
    const route = API_ROUTE_CATALOG.find((candidate) => candidate.method === method && candidate.path === catalogPath);
    assert.ok(route, `missing catalog descriptor for ${method} ${catalogPath}`);
    const schema = API_RESPONSE_SCHEMA_CATALOG.find((candidate) => candidate.name === route.responseSchema);
    assert.ok(schema, `missing response schema descriptor for ${route.responseSchema}`);
    const response = await client.request(method, requestPath, payload, headers);
    const key = `${method} ${catalogPath}`;
    assert.ok(response.statusCode >= 200 && response.statusCode < 300, `${key}: ${JSON.stringify(response.body)}`);
    assert.equal(apiSuccessEnvelopeSchema.safeParse(response.body).success, true, `${key} must return a versioned success envelope`);
    assert.equal(response.body.schemaVersion, 1);
    const payloadSchema = API_PAYLOAD_RESPONSE_SCHEMAS.get(route.responseSchema);
    assert.ok(payloadSchema, `${key} has no executable payload schema ${route.responseSchema}`);
    const payloadResult = payloadSchema.safeParse(response.body.data);
    assert.equal(payloadResult.success, true, `${key} payload failed ${route.responseSchema}: ${JSON.stringify(payloadResult.success ? null : payloadResult.error.issues)}`);
    covered.add(key);
    return response;
  };

  const admin = makeClient(runtime);
  await admin.login("admin@cvg.local", password);
  covered.add("POST /auth/login");
  const secondAdmin = makeClient(runtime);
  await secondAdmin.login("admin@cvg.local", password);
  const sessions = await success(admin, "GET", "/auth/sessions", "/auth/sessions");
  const sessionData = sessions.body.data as { items: Array<{ id: string }>; currentSessionId: string };
  const revocableSession = sessionData.items.find((item) => item.id !== sessionData.currentSessionId);
  assert.ok(revocableSession, "a second synthetic admin session must be available to revoke");
  await success(admin, "POST", "/auth/sessions/:id/revoke", `/auth/sessions/${revocableSession.id}/revoke`, undefined, { "idempotency-key": "response-routes-session-revoke" });

  const demo = makeClient(runtime);
  const demoLogin = await success(demo, "POST", "/auth/demo", "/auth/demo");
  assert.equal((demoLogin.body.data as { demo: boolean }).demo, true);
  await success(admin, "GET", "/context", "/context");
  await success(admin, "GET", "/users", "/users");
  await success(admin, "GET", "/audit", "/audit?limit=5");
  await success(admin, "GET", "/guardians", "/guardians");

  const guardian = await success(admin, "POST", "/guardians", "/guardians", {
    displayName: "Fixture sintético MEL23",
    phone: "+55 11 90000-0101",
    email: "mel23.fixture@example.test"
  }, { "idempotency-key": "response-routes-guardian-1" });
  const guardianId = (guardian.body.data as { guardian: { id: string } }).guardian.id;
  const createPatient = async (name: string, key: string) => {
    const response = await success(admin, "POST", "/patients", "/patients", {
      guardianId,
      name,
      species: "Canina",
      breed: "Sintética",
      sex: "UNKNOWN",
      reproductiveStatus: "UNKNOWN",
      birthDate: null,
      identifiers: []
    }, { "idempotency-key": key });
    return (response.body.data as { patient: { id: string } }).patient.id;
  };
  const mergeSourceId = await createPatient("Paciente fonte fixture", "response-routes-patient-merge-source");
  const mergeTargetId = await createPatient("Paciente destino fixture", "response-routes-patient-merge-target");
  const disablePatientId = await createPatient("Paciente desativação fixture", "response-routes-patient-disable");
  const routeCoveragePatientId = await createPatient("Paciente cobertura MEL23", "response-routes-patient-coverage");
  await success(admin, "POST", "/patients/merge", "/patients/merge", {
    sourcePatientId: mergeSourceId,
    targetPatientId: mergeTargetId,
    reason: "Mesclar registros sintéticos de teste",
    confirmation: "MERGE_PATIENTS"
  }, { "idempotency-key": "response-routes-patient-merge" });
  await success(admin, "POST", "/patients/:id/disable", `/patients/${disablePatientId}/disable`, undefined, { "idempotency-key": "response-routes-patient-disable" });

  const adminContext = admin.context();
  assert.ok(adminContext);
  const organization = runtime.store.organizations.get(runtime.store.bootstrapCredentials.organizationId);
  assert.ok(organization);
  const provider = [...runtime.store.providers.values()].find((candidate) => candidate.unitId === adminContext.unit.id);
  const service = [...runtime.store.services.values()].find((candidate) => candidate.organizationId === organization.id);
  const resource = [...runtime.store.resources.values()].find((candidate) => candidate.unitId === adminContext.unit.id);
  assert.ok(provider && service && resource, "synthetic scheduling fixtures must exist in the admin context");
  const createCoverageAppointment = async (day: number, key: string) => {
    const start = Date.UTC(2035, 0, day, 10, 0, 0);
    const end = start + 45 * 60_000;
    return success(admin, "POST", "/appointments", "/appointments", {
      patientId: routeCoveragePatientId,
      providerId: provider.id,
      resourceId: resource.id,
      serviceId: service.id,
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(end).toISOString(),
      purpose: "Fixture sintético de cobertura de resposta"
    }, { "idempotency-key": key });
  };
  const confirmationAppointment = await createCoverageAppointment(1, "response-routes-appointment-confirm-create");
  const confirmationAppointmentId = (confirmationAppointment.body.data as { appointment: { id: string; version: number } }).appointment.id;
  const confirmationVersion = (confirmationAppointment.body.data as { appointment: { version: number } }).appointment.version;
  await success(admin, "POST", "/appointments/:id/confirm", `/appointments/${confirmationAppointmentId}/confirm`, {
    expectedVersion: confirmationVersion
  }, { "idempotency-key": "response-routes-appointment-confirm" });

  const rescheduleAppointment = await createCoverageAppointment(2, "response-routes-appointment-reschedule-create");
  const rescheduleData = rescheduleAppointment.body.data as { appointment: { id: string; version: number } };
  await success(admin, "POST", "/appointments/:id/reschedule", `/appointments/${rescheduleData.appointment.id}/reschedule`, {
    startsAt: "2035-01-10T12:00:00.000Z",
    endsAt: "2035-01-10T12:45:00.000Z",
    expectedVersion: rescheduleData.appointment.version
  }, { "idempotency-key": "response-routes-appointment-reschedule" });

  const queueAppointment = await createCoverageAppointment(3, "response-routes-queue-create");
  const queueAppointmentId = (queueAppointment.body.data as { appointment: { id: string } }).appointment.id;
  const checkIn = await success(admin, "POST", "/appointments/:id/check-in", `/appointments/${queueAppointmentId}/check-in`, undefined, { "idempotency-key": "response-routes-queue-check-in" });
  const queueEntryId = (checkIn.body.data as { queueEntry: { id: string } }).queueEntry.id;
  await success(admin, "POST", "/queue/:id/triage", `/queue/${queueEntryId}/triage`, {
    priority: "URGENT"
  }, { "idempotency-key": "response-routes-queue-triage" });
  await success(admin, "POST", "/queue/:id/handoff", `/queue/${queueEntryId}/handoff`, {
    chiefComplaint: "Fixture sintético de transição para atendimento",
    urgency: "ROUTINE"
  }, { "idempotency-key": "response-routes-queue-handoff" });

  const unitId = [...runtime.store.units.values()][0]!.id;
  const grantableRoles = ["recepcao", "veterinario", "estoque", "financeiro", "operador"] as const;
  const grantCandidate = [...runtime.store.users.values()].filter((user) => user.id !== runtime.store.bootstrapCredentials.userId).flatMap((user) => grantableRoles.map((role) => ({ user, role }))).find(({ user, role }) => ![...runtime.store.roleAssignments.values()].some((assignment) => assignment.organizationId === organization.id && assignment.userId === user.id && assignment.role === role && assignment.scopeType === "UNIT" && assignment.unitId === unitId && assignment.workspaceId === null && assignment.revokedAt === null));
  assert.ok(grantCandidate, "a synthetic non-admin role assignment fixture must be available");
  const grant = await success(admin, "POST", "/role-assignments", "/role-assignments", {
    userId: grantCandidate.user.id,
    role: grantCandidate.role,
    scopeType: "UNIT",
    unitId,
    workspaceId: null,
    expectedRevision: organization.authorizationRevision.toString()
  }, { "idempotency-key": "response-routes-role-grant" });
  assert.equal(grant.statusCode, 201, JSON.stringify(grant.body));
  const assignmentId = (grant.body.data as { assignment: { id: string } }).assignment.id;
  const postGrantRevision = runtime.store.organizations.get(organization.id)?.authorizationRevision.toString();
  assert.ok(postGrantRevision);
  await success(admin, "DELETE", "/role-assignments/:id", `/role-assignments/${assignmentId}?expectedRevision=${postGrantRevision}`, undefined, { "idempotency-key": "response-routes-role-revoke" });

  const vet = makeClient(runtime);
  await vet.login("ana.vet@cvg.local", "veterinario-synthetic-0002");
  await success(vet, "GET", "/ai/health", "/ai/health");
  await success(vet, "GET", "/scheduling/options", "/scheduling/options");
  await success(vet, "GET", "/hospitalization/episodes", "/hospitalization/episodes");
  await success(vet, "GET", "/medications/orders", "/medications/orders");
  const knowledge = await success(vet, "GET", "/knowledge", "/knowledge");
  const knowledgeDocument = (knowledge.body.data as { items: Array<{ id: string }> }).items[0];
  assert.ok(knowledgeDocument, "the clinical workspace must provide an approved synthetic knowledge document");
  await success(vet, "GET", "/knowledge/:id/index", `/knowledge/${knowledgeDocument.id}/index`);
  const vetContext = vet.context();
  assert.ok(vetContext);
  const cancellable = [...runtime.store.appointments.values()].find((appointment) => appointment.unitId === vetContext.unit.id && appointment.workspaceId === vetContext.workspace.id && appointment.status !== "CANCELLED" && appointment.status !== "COMPLETED");
  assert.ok(cancellable, "the demo store must provide one cancellable appointment");
  await success(vet, "POST", "/appointments/:id/cancel", `/appointments/${cancellable.id}/cancel`, {
    reason: "Fixture sintético para contrato de resposta",
    expectedVersion: cancellable.version
  }, { "idempotency-key": "response-routes-appointment-cancel" });

  const stock = makeClient(runtime);
  await stock.login("leo.estoque@cvg.local", "estoque-synthetic-0004");
  await success(stock, "GET", "/stock/locations", "/stock/locations");
  const products = await success(stock, "GET", "/stock/products", "/stock/products");
  assert.ok((products.body.data as { items: Array<{ sku: string }> }).items.some((product) => product.sku === "AMOX-50"));

  const communicationList = await success(admin, "GET", "/communications", "/communications");
  assert.ok(Array.isArray((communicationList.body.data as { items: unknown[] }).items));
  const message = await success(admin, "POST", "/communications", "/communications", {
    patientId: null,
    channel: "SMS",
    recipient: "+55 11 90000-0102",
    template: "synthetic-contract",
    body: "Mensagem sintética sem envio externo."
  }, { "idempotency-key": "response-routes-communication-stage" });
  const messageId = (message.body.data as { message: { id: string } }).message.id;
  await success(vet, "POST", "/communications/:id/approve", `/communications/${messageId}/approve`, {
    decision: "rejected",
    reason: "Fixture de contrato sem egress externo"
  }, { "idempotency-key": "response-routes-communication-reject" });

  await success(admin, "GET", "/operations/summary", "/operations/summary");
  const publicClient = makeClient(runtime);
  await success(publicClient, "GET", "/ai/ready", "/ai/ready");
  const aiSessions = await success(vet, "GET", "/ai/sessions", "/ai/sessions");
  assert.ok(Array.isArray((aiSessions.body.data as { items: unknown[] }).items));
  const vetPatients = await success(vet, "GET", "/patients", "/patients");
  const patientId = (vetPatients.body.data as { items: Array<{ id: string }> }).items[0]!.id;
  await success(vet, "GET", "/patients/:id", `/patients/${patientId}`);
  const encounter = await success(vet, "POST", "/encounters", "/encounters", {
    patientId,
    appointmentId: null,
    chiefComplaint: "Fixture sintético para resposta AI",
    urgency: "ROUTINE"
  }, { "idempotency-key": "response-routes-ai-encounter" });
  assert.equal(encounter.statusCode, 201, JSON.stringify(encounter.body));
  const encounterId = (encounter.body.data as { encounter: { id: string } }).encounter.id;
  const turn = await success(vet, "POST", "/ai/turns", "/ai/turns", {
    sessionId: null,
    prompt: "Resuma os dados clínicos sintéticos para revisão profissional.",
    purpose: "DRAFT_CLINICAL",
    patientId,
    encounterId,
    requestedTool: null,
    approvalId: null,
    idempotencyKey: "response-routes-ai-draft-turn"
  });
  assert.equal(turn.statusCode, 201, JSON.stringify(turn.body));
  const turnData = turn.body.data as { session: { id: string }; turn: { status: string }; draft: { id: string } | null };
  assert.equal(turnData.turn.status, "COMPLETED");
  assert.ok(turnData.draft, "a valid synthetic DRAFT_CLINICAL turn should provide a promote-able draft");
  const draftResponse = await success(vet, "POST", "/ai/drafts/:id/promote", `/ai/drafts/${turnData.draft!.id}/promote`, undefined, { "idempotency-key": "response-routes-ai-draft-promote" });
  const clinicalDocumentId = (draftResponse.body.data as { documentId: string }).documentId;
  assert.ok(clinicalDocumentId.length > 0);
  await success(vet, "GET", "/clinical/documents/:id", `/clinical/documents/${clinicalDocumentId}`);
  await success(vet, "GET", "/ai/sessions/:id/replay", `/ai/sessions/${turnData.session.id}/replay`);

  const clinicalCreate = await success(vet, "POST", "/clinical/documents", "/clinical/documents", {
    encounterId,
    documentType: "EVOLUTION",
    title: "Evolução sintética MEL23",
    content: "Achados sintéticos para validação do contrato de resposta.",
    dataClass: "D3"
  }, { "idempotency-key": "response-routes-clinical-create" });
  const clinicalDocument = (clinicalCreate.body.data as { document: { id: string; version: number } }).document;
  const clinicalUpdate = await success(vet, "POST", "/clinical/documents/:id/update", `/clinical/documents/${clinicalDocument.id}/update`, {
    content: "Conteúdo sintético revisado.",
    expectedVersion: String(clinicalDocument.version)
  }, { "idempotency-key": "response-routes-clinical-update" });
  const updatedClinicalDocument = (clinicalUpdate.body.data as { document: { version: number } }).document;
  const clinicalReview = await success(vet, "POST", "/clinical/documents/:id/review", `/clinical/documents/${clinicalDocument.id}/review`, {
    expectedVersion: String(updatedClinicalDocument.version)
  }, { "idempotency-key": "response-routes-clinical-review" });
  const reviewedClinicalDocument = (clinicalReview.body.data as { document: { version: number } }).document;
  await success(vet, "POST", "/clinical/documents/:id/sign", `/clinical/documents/${clinicalDocument.id}/sign`, {
    expectedVersion: String(reviewedClinicalDocument.version)
  }, { "idempotency-key": "response-routes-clinical-sign" });
  await success(vet, "POST", "/clinical/documents/:id/addenda", `/clinical/documents/${clinicalDocument.id}/addenda`, {
    reason: "Complemento sintético de validação",
    content: "Adendo controlado após a assinatura."
  }, { "idempotency-key": "response-routes-clinical-addendum" });

  const diagnosticRequest = await success(vet, "POST", "/diagnostics/requests", "/diagnostics/requests", {
    patientId,
    encounterId,
    testName: "Hemograma sintético MEL23",
    priority: "ROUTINE"
  }, { "idempotency-key": "response-routes-diagnostic-request" });
  const diagnosticRequestId = (diagnosticRequest.body.data as { request: { id: string } }).request.id;
  const specimen = await success(vet, "POST", "/diagnostics/requests/:id/specimens", `/diagnostics/requests/${diagnosticRequestId}/specimens`, {
    label: "MEL23-SYNTHETIC-SPECIMEN"
  }, { "idempotency-key": "response-routes-diagnostic-specimen" });
  const specimenId = (specimen.body.data as { specimen: { id: string } }).specimen.id;
  await success(vet, "POST", "/diagnostics/results", "/diagnostics/results", {
    requestId: diagnosticRequestId,
    specimenId,
    value: "resultado sintético sem alterações",
    source: "laboratório sintético",
    externalOrderId: null,
    sourceVersion: "synthetic-1"
  }, { "idempotency-key": "response-routes-diagnostic-result" });
  await success(vet, "POST", "/diagnostics/requests/:id/review", `/diagnostics/requests/${diagnosticRequestId}/review`, {}, {
    "idempotency-key": "response-routes-diagnostic-review"
  });

  const stockContext = stock.context();
  assert.ok(stockContext);
  const stockLocation = [...runtime.store.stockLocations.values()].find((candidate) => candidate.organizationId === runtime.store.bootstrapCredentials.organizationId && candidate.unitId === stockContext.unit.id);
  assert.ok(stockLocation, "the synthetic organization must have a stock location");
  const stockSuffix = Date.now().toString(36);
  const stockProductResponse = await success(stock, "POST", "/stock/products", "/stock/products", {
    sku: `MEL23-${stockSuffix}`,
    name: `Produto sintético ${stockSuffix}`,
    category: "Validação de contrato",
    unit: "unidade",
    reorderPoint: 1
  }, { "idempotency-key": "response-routes-stock-product" });
  const stockProductId = (stockProductResponse.body.data as { product: { id: string } }).product.id;
  const stockLotResponse = await success(stock, "POST", "/stock/lots", "/stock/lots", {
    productId: stockProductId,
    lotNumber: `MEL23-LOT-${stockSuffix}`,
    expiresOn: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10),
    quantity: 10,
    locationId: stockLocation.id
  }, { "idempotency-key": "response-routes-stock-lot" });
  const stockLotId = (stockLotResponse.body.data as { lot: { id: string } }).lot.id;
  await success(stock, "POST", "/stock/inventory", "/stock/inventory", {
    lotId: stockLotId,
    countedQuantity: 12,
    reason: "Contagem sintética de validação"
  }, { "idempotency-key": "response-routes-stock-inventory" });
  await success(stock, "POST", "/stock/movements", "/stock/movements", {
    productId: stockProductId,
    lotId: stockLotId,
    locationId: stockLocation.id,
    quantity: 1,
    movementType: "DISPENSE",
    reason: "Baixa sintética de validação",
    referenceId: null
  }, { "idempotency-key": "response-routes-stock-movement" });

  const medicationOrder = await success(vet, "POST", "/medications/orders", "/medications/orders", {
    patientId,
    encounterId,
    productId: stockProductId,
    dose: "1 unidade",
    route: "oral",
    frequency: "uma vez para validação sintética"
  }, { "idempotency-key": "response-routes-medication-order" });
  const medicationOrderId = (medicationOrder.body.data as { order: { id: string } }).order.id;
  await success(stock, "POST", "/medications/orders/:id/dispense", `/medications/orders/${medicationOrderId}/dispense`, {
    lotId: stockLotId,
    quantity: 1
  }, { "idempotency-key": "response-routes-medication-dispense" });
  await success(vet, "POST", "/medications/orders/:id/administer", `/medications/orders/${medicationOrderId}/administer`, {
    status: "ADMINISTERED",
    note: "Administração somente sintética"
  }, { "idempotency-key": "response-routes-medication-administer" });
  await success(vet, "POST", "/medications/orders/:id/status", `/medications/orders/${medicationOrderId}/status`, {
    status: "COMPLETED"
  }, { "idempotency-key": "response-routes-medication-status" });

  const vetContextForBed = vet.context();
  assert.ok(vetContextForBed);
  const availableBed = [...runtime.store.beds.values()].find((candidate) => candidate.unitId === vetContextForBed.unit.id && candidate.status === "AVAILABLE");
  assert.ok(availableBed, "the synthetic vet unit must have an available bed");
  const hospitalEpisode = await success(vet, "POST", "/hospitalization/episodes", "/hospitalization/episodes", {
    patientId,
    encounterId,
    bedId: availableBed.id
  }, { "idempotency-key": "response-routes-hospital-episode" });
  const hospitalEpisodeId = (hospitalEpisode.body.data as { episode: { id: string } }).episode.id;
  await success(vet, "POST", "/hospitalization/episodes/:id/status", `/hospitalization/episodes/${hospitalEpisodeId}/status`, {
    status: "PROCEDURE"
  }, { "idempotency-key": "response-routes-hospital-status" });
  const dischargeDocument = await success(vet, "POST", "/clinical/documents", "/clinical/documents", {
    encounterId,
    documentType: "DISCHARGE",
    title: "Alta sintética MEL23",
    content: "Plano sintético de alta para validação do contrato.",
    dataClass: "D3"
  }, { "idempotency-key": "response-routes-hospital-discharge-document" });
  const dischargeDocumentData = (dischargeDocument.body.data as { document: { id: string; version: number } }).document;
  const dischargeReview = await success(vet, "POST", "/clinical/documents/:id/review", `/clinical/documents/${dischargeDocumentData.id}/review`, {
    expectedVersion: String(dischargeDocumentData.version)
  }, { "idempotency-key": "response-routes-hospital-discharge-review" });
  const reviewedDischargeDocument = (dischargeReview.body.data as { document: { version: number } }).document;
  await success(vet, "POST", "/clinical/documents/:id/sign", `/clinical/documents/${dischargeDocumentData.id}/sign`, {
    expectedVersion: String(reviewedDischargeDocument.version)
  }, { "idempotency-key": "response-routes-hospital-discharge-sign" });
  await success(vet, "POST", "/hospitalization/episodes/:id/discharge", `/hospitalization/episodes/${hospitalEpisodeId}/discharge`, undefined, {
    "idempotency-key": "response-routes-hospital-discharge"
  });

  const finance = makeClient(runtime);
  await finance.login("mari.financeiro@cvg.local", "financeiro-synthetic-0005");
  const charge = await success(finance, "POST", "/finance/charges", "/finance/charges", {
    patientId,
    description: "Cobrança sintética MEL23",
    amountCents: 2500,
    currency: "BRL"
  }, { "idempotency-key": "response-routes-finance-charge" });
  const chargeId = (charge.body.data as { charge: { id: string } }).charge.id;
  const payment = await success(finance, "POST", "/finance/payments", "/finance/payments", {
    chargeId,
    amountCents: 2500,
    method: "PIX",
    externalReference: null
  }, { "idempotency-key": "response-routes-finance-payment" });
  const paymentId = (payment.body.data as { payment: { id: string } }).payment.id;
  await success(finance, "POST", "/finance/refunds", "/finance/refunds", {
    paymentId,
    reason: "Estorno exclusivamente sintético de validação"
  }, { "idempotency-key": "response-routes-finance-refund" });

  const knowledgeCreate = await success(vet, "POST", "/knowledge", "/knowledge", {
    title: `Conhecimento sintético MEL23 ${stockSuffix}`,
    source: "Fixture local de contrato",
    dataClass: "D1",
    content: `Conteúdo sintético isolado ${stockSuffix} para validação de resposta.`
  }, { "idempotency-key": "response-routes-knowledge-create" });
  const createdKnowledgeDocument = (knowledgeCreate.body.data as { document: { id: string; version: number } }).document;
  const knowledgeApproval = await success(vet, "POST", "/knowledge/:id/approve", `/knowledge/${createdKnowledgeDocument.id}/approve`, {
    expectedVersion: createdKnowledgeDocument.version
  }, { "idempotency-key": "response-routes-knowledge-approve" });
  const approvedKnowledge = (knowledgeApproval.body.data as { document: { version: number } }).document;
  const knowledgeIndex = await success(vet, "POST", "/knowledge/:id/index", `/knowledge/${createdKnowledgeDocument.id}/index`, {
    expectedVersion: approvedKnowledge.version
  }, { "idempotency-key": "response-routes-knowledge-index" });
  const indexedKnowledge = (knowledgeIndex.body.data as { document: { version: number } }).document;
  await success(vet, "POST", "/knowledge/:id/quarantine", `/knowledge/${createdKnowledgeDocument.id}/quarantine`, {
    reason: "Quarentena sintética após validar o fluxo",
    expectedVersion: indexedKnowledge.version
  }, { "idempotency-key": "response-routes-knowledge-quarantine" });

  const approvalTurn = await success(vet, "POST", "/ai/turns", "/ai/turns", {
    sessionId: null,
    prompt: "Preparar uma comunicação sintética sem envio externo.",
    purpose: "OPERATIONS",
    patientId: null,
    encounterId: null,
    requestedTool: "cvg.communication.stage",
    approvalId: null,
    idempotencyKey: "response-routes-ai-approval-turn"
  });
  const approvalTurnData = approvalTurn.body.data as { session: { id: string }; approval: { id: string } };
  assert.ok(approvalTurnData.approval, "the synthetic tool request must require explicit approval");
  await success(vet, "POST", "/ai/approvals/:id", `/ai/approvals/${approvalTurnData.approval.id}`, {
    decision: "allowed-once",
    reason: "Aprovação sintética para validar o contrato"
  }, { "idempotency-key": "response-routes-ai-approval-decision" });
  await success(vet, "POST", "/ai/approvals/:id/retry", `/ai/approvals/${approvalTurnData.approval.id}/retry`, {
    sessionId: approvalTurnData.session.id,
    prompt: "Preparar uma comunicação sintética sem envio externo.",
    purpose: "OPERATIONS",
    patientId: null,
    encounterId: null,
    requestedTool: "cvg.communication.stage",
    approvalId: approvalTurnData.approval.id,
    idempotencyKey: "response-routes-ai-approved-retry"
  });

  const authLifecycleClient = makeClient(runtime);
  const originalOpsPassword = "operador-synthetic-0006";
  const rotatedOpsPassword = "CVG-Rotated-2036!Synthetic";
  const recoveredOpsPassword = "CVG-Recovered-2036!Synthetic";
  await authLifecycleClient.login("ops@cvg.local", originalOpsPassword);
  await success(authLifecycleClient, "POST", "/auth/password/rotate", "/auth/password/rotate", {
    currentPassword: originalOpsPassword,
    newPassword: rotatedOpsPassword
  });
  const opsUser = [...runtime.store.users.values()].find((candidate) => candidate.login === "ops@cvg.local");
  assert.ok(opsUser, "the synthetic operator user must exist for recovery fixtures");
  const recoveryCodes = runtime.store.issueRecoveryCodes(opsUser.id, 1);
  const recoveryClient = makeClient(runtime);
  const recoveryChallenge = await success(recoveryClient, "POST", "/auth/recovery/start", "/auth/recovery/start", {
    login: "ops@cvg.local"
  });
  const recoveryChallengeId = (recoveryChallenge.body.data as { challengeId: string }).challengeId;
  await success(recoveryClient, "POST", "/auth/recovery/complete", "/auth/recovery/complete", {
    challengeId: recoveryChallengeId,
    recoveryCode: recoveryCodes[0],
    newPassword: recoveredOpsPassword
  });

  const mfaPassword = "synthetic-mfa-route-password";
  const mfaSecret = "JBSWY3DPEHPK3PXP";
  const mfaStore = new CvgStore({ bootstrapPassword: mfaPassword });
  const mfaRuntime = await createRuntime({
    store: mfaStore,
    config: { nodeEnv: "test", storageMode: "memory", demoMode: false, authMfaMode: "optional", webOrigin: "http://127.0.0.1:5173" },
    mfaSecretResolver: { resolve: (reference) => reference === "synthetic.mfa.admin" ? mfaSecret : null }
  });
  t.after(async () => mfaRuntime.app.close());
  const mfaUser = mfaStore.getUser(mfaStore.bootstrapCredentials.userId);
  const mfaEnrollClient = makeClient(mfaRuntime);
  await mfaEnrollClient.login(mfaUser.login, mfaPassword);
  await success(mfaEnrollClient, "POST", "/auth/mfa/enroll", "/auth/mfa/enroll", {
    currentPassword: mfaPassword,
    secretRef: "synthetic.mfa.admin",
    code: syntheticTotpCode(mfaSecret)
  }, { "idempotency-key": "response-routes-mfa-enroll" });
  const mfaVerifyClient = makeClient(mfaRuntime);
  const mfaChallengeResponse = await mfaVerifyClient.request("POST", "/auth/login", {
    login: mfaUser.login,
    password: mfaPassword
  });
  assert.equal(mfaChallengeResponse.statusCode, 202, JSON.stringify(mfaChallengeResponse.body));
  const mfaChallengeId = (mfaChallengeResponse.body.data as { challengeId: string }).challengeId;
  const mfaVerified = await success(mfaVerifyClient, "POST", "/auth/mfa/verify", "/auth/mfa/verify", {
    challengeId: mfaChallengeId,
    code: syntheticTotpCode(mfaSecret)
  });
  const mfaContexts = (mfaVerified.body.data as { contexts: Array<{ unit: { id: string }; workspace: { id: string } }> }).contexts;
  mfaVerifyClient.setContext(mfaContexts[0] ?? null);
  assert.ok(mfaVerifyClient.context(), "MFA verification must establish a synthetic request context");
  await success(mfaVerifyClient, "POST", "/auth/mfa/revoke", "/auth/mfa/revoke", {
    currentPassword: mfaPassword
  }, { "idempotency-key": "response-routes-mfa-revoke" });

  const getRoutes = API_ROUTE_CATALOG.filter((route) => route.method === "GET");
  const addedGetFixtures: string[] = [];
  for (const route of getRoutes) {
    const key = `${route.method} ${route.path}`;
    if (covered.has(key)) continue;
    await success(admin, "GET", route.path, concretePath(route.path));
    addedGetFixtures.push(key);
  }
  assert.equal(getRoutes.length, 46);
  assert.deepEqual(getRoutes.map((route) => `GET ${route.path}`).filter((key) => !covered.has(key)), []);
  t.diagnostic(`explicit schema-checked GET success fixtures: ${getRoutes.length}/${getRoutes.length}; added=${addedGetFixtures.length}`);

  const logoutClient = makeClient(runtime);
  await logoutClient.login("ops@cvg.local", recoveredOpsPassword);
  await success(logoutClient, "POST", "/auth/logout", "/auth/logout");

  // Restore deliberately quarantines and invalidates the isolated synthetic store,
  // so it is the final business request in this runtime.
  const snapshot = JSON.parse(serializeSnapshot(runtime.store.snapshot())) as unknown;
  await success(admin, "POST", "/ops/restore", "/ops/restore", { snapshot }, { "idempotency-key": "response-routes-ops-restore" });

  assert.equal(covered.size, 104);
  t.diagnostic(`explicit valid success payload-schema fixtures: ${covered.size}/106 catalog routes`);
  const successFixtureExceptions = ["POST /integrations/:provider/events", "POST /ops/export"];
  assert.deepEqual(API_ROUTE_CATALOG.map((route) => `${route.method} ${route.path}`).filter((key) => !covered.has(key)).sort(), successFixtureExceptions.sort());
  t.diagnostic("success fixture exceptions: integration ingress needs PostgreSQL/signature verification; governed export is disabled in the isolated memory runtime");
  assert.deepEqual([...covered].sort(), [
    "DELETE /role-assignments/:id",
    "GET /auth/sessions",
    "GET /ai/health",
    "GET /ai/ready",
    "GET /ai/sessions",
    "GET /ai/sessions/:id/replay",
    "GET /audit",
    "GET /clinical/documents/:id",
    "GET /communications",
    "GET /clinical/documents",
    "GET /clinical/documents/:id/addenda",
    "GET /contexts",
    "GET /context",
    "GET /capabilities",
    "GET /appointments",
    "GET /queue",
    "GET /encounters",
    "GET /diagnostics/requests",
    "GET /diagnostics/specimens",
    "GET /diagnostics/results",
    "GET /finance/charges",
    "GET /finance/payments",
    "GET /finance/ledger",
    "GET /guardians",
    "GET /health",
    "GET /hospitalization/beds",
    "GET /hospitalization/episodes",
    "GET /medications/dispensations",
    "GET /medications/administrations",
    "GET /knowledge",
    "GET /knowledge/search",
    "GET /knowledge/:id/index",
    "GET /medications/orders",
    "GET /me",
    "GET /operations/summary",
    "GET /operations/reports",
    "GET /metrics",
    "GET /ops/snapshot",
    "GET /ready",
    "GET /scheduling/options",
    "GET /stock/locations",
    "GET /stock/products",
    "GET /stock",
    "GET /stock/movements",
    "GET /users",
    "GET /patients",
    "GET /patients/:id",
    "POST /auth/login",
    "POST /auth/demo",
    "POST /auth/logout",
    "POST /auth/sessions/:id/revoke",
    "POST /ai/drafts/:id/promote",
    "POST /appointments/:id/cancel",
    "POST /communications",
    "POST /communications/:id/approve",
    "POST /guardians",
    "POST /ops/restore",
    "POST /appointments",
    "POST /appointments/:id/check-in",
    "POST /appointments/:id/confirm",
    "POST /appointments/:id/reschedule",
    "POST /auth/mfa/verify",
    "POST /auth/mfa/enroll",
    "POST /auth/mfa/revoke",
    "POST /auth/recovery/start",
    "POST /auth/recovery/complete",
    "POST /auth/password/rotate",
    "POST /clinical/documents",
    "POST /clinical/documents/:id/update",
    "POST /clinical/documents/:id/review",
    "POST /clinical/documents/:id/sign",
    "POST /clinical/documents/:id/addenda",
    "POST /diagnostics/requests",
    "POST /diagnostics/requests/:id/specimens",
    "POST /diagnostics/results",
    "POST /diagnostics/requests/:id/review",
    "POST /stock/products",
    "POST /stock/lots",
    "POST /stock/inventory",
    "POST /stock/movements",
    "POST /hospitalization/episodes",
    "POST /hospitalization/episodes/:id/status",
    "POST /hospitalization/episodes/:id/discharge",
    "POST /medications/orders",
    "POST /medications/orders/:id/dispense",
    "POST /medications/orders/:id/administer",
    "POST /medications/orders/:id/status",
    "POST /finance/charges",
    "POST /finance/payments",
    "POST /finance/refunds",
    "POST /knowledge",
    "POST /knowledge/:id/approve",
    "POST /knowledge/:id/index",
    "POST /knowledge/:id/quarantine",
    "POST /ai/approvals/:id",
    "POST /ai/approvals/:id/retry",
    "POST /role-assignments",
    "POST /encounters",
    "POST /ai/turns",
    "POST /patients",
    "POST /patients/:id/disable",
    "POST /patients/merge",
    "POST /queue/:id/handoff",
    "POST /queue/:id/triage"
  ].sort());
  const getRoutesWithSyntheticId404 = [
    "GET /ai/sessions/:id/replay",
    "GET /clinical/documents/:id",
    "GET /knowledge/:id/index",
    "GET /patients/:id"
  ];
  assert.deepEqual(getRoutesWithSyntheticId404.filter((route) => covered.has(route)).sort(), getRoutesWithSyntheticId404.sort());
  t.diagnostic(`synthetic-ID GET routes with versioned 404 probes also have valid schema-checked success fixtures: ${getRoutesWithSyntheticId404.length}/4`);
});
