import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_OPS_RESPONSE_SCHEMAS } from "../../apps/api/src/response-schemas/auth-ops.ts";

const id = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
const id3 = "33333333-3333-4333-8333-333333333333";
const timestamp = "2026-09-21T12:00:00.000Z";
const digest = "a".repeat(64);
const correlationId = "corr-auth-ops";

const authenticatedUser = {
  id,
  organizationId: id2,
  login: "admin@example.test",
  displayName: "Admin",
  email: "admin@example.test",
  status: "ACTIVE",
  lastLoginAt: timestamp,
  createdAt: timestamp
};

const contextOption = {
  organization: { id: id2, name: "CVG", slug: "cvg" },
  unit: { id: id3, organizationId: id2, name: "Centro", code: "CTR", status: "ACTIVE" },
  workspace: { id, organizationId: id2, unitId: id3, name: "Recepção", purpose: "atendimento", status: "ACTIVE" },
  roles: ["admin"]
};

const session = {
  id,
  createdAt: timestamp,
  expiresAt: "2026-09-22T12:00:00.000Z",
  revokedAt: null,
  lastSeenAt: timestamp,
  device: "registered",
  mfaVerified: true,
  currentCredentialVersion: 1
};

const assignment = {
  id,
  organizationId: id2,
  userId: id3,
  role: "recepcao",
  scopeType: "UNIT",
  unitId: id3,
  workspaceId: null,
  grantedAt: timestamp,
  revokedAt: null
};

const listedUser = {
  id,
  displayName: "Recepção",
  email: "reception@example.test",
  status: "ACTIVE",
  roles: [{ id: id2, role: "recepcao", scopeType: "UNIT", unitId: id3, workspaceId: null, revokedAt: null }]
};

const guardian = { id, displayName: "Ana", phone: "+5511999999999", email: "ana@example.test", status: "ACTIVE" };
const patient = {
  id,
  name: "Luna",
  species: "Canina",
  breed: "Golden retriever",
  status: "ACTIVE",
  guardian: { id: id2, displayName: "Ana", phone: "+5511999999999" }
};
const expandedPatient = {
  ...patient,
  sex: "FEMALE",
  reproductiveStatus: "NEUTERED",
  birthDate: "2020-05-19",
  identifiers: ["micro-9812"]
};

const appointment = {
  id,
  organizationId: id2,
  unitId: id3,
  workspaceId: id2,
  patientId: id,
  providerId: id3,
  resourceId: null,
  serviceId: id2,
  startsAt: "2026-09-21T13:00:00.000Z",
  endsAt: "2026-09-21T14:00:00.000Z",
  purpose: "Consulta",
  status: "SCHEDULED",
  version: 1,
  createdAt: timestamp
};

const appointmentRead = {
  ...appointment,
  patient: { id, name: "Luna" },
  provider: "Dra. Vet"
};

const queueEntry = {
  id,
  organizationId: id2,
  unitId: id3,
  appointmentId: id2,
  patientId: id,
  status: "WAITING",
  priority: "ROUTINE",
  checkedInAt: timestamp
};

const queueRead = { ...queueEntry, patient: { id, name: "Luna" } };

const encounter = {
  id,
  organizationId: id2,
  unitId: id3,
  workspaceId: id2,
  patientId: id,
  appointmentId: id2,
  chiefComplaint: "Claudicação",
  urgency: "ROUTINE",
  status: "OPEN",
  openedAt: timestamp,
  closedAt: null
};

const auditRecord = {
  id,
  organizationId: id2,
  actorId: id3,
  unitId: id3,
  workspaceId: id2,
  action: "patients.read",
  resourceType: "AnimalPatient",
  resourceId: id,
  result: "ALLOWED",
  reason: null,
  correlationId,
  metadata: { count: 1, replay: false, note: null },
  chainVersion: 2,
  previousHash: null,
  recordHash: digest,
  createdAt: timestamp
};

const validPayloads: ReadonlyMap<string, unknown> = new Map([
  ["HealthResponse", { live: true, status: "READY", capabilities: { demoOnly: true, realProvidersBlocked: true, realDataBlocked: true } }],
  ["ReadinessResponse", {
    ready: true,
    status: "READY",
    checks: {
      database: "READY",
      policyStore: "READY",
      secretProvider: "READY",
      secretReferences: { deepseekBearerToken: "NOT_REQUIRED", deepseekContextSignature: "NOT_REQUIRED" },
      authMfa: "NOT_REQUIRED",
      agentRuntime: "DISABLED",
      outbox: "NOT_CONFIGURED",
      auditLedger: "DEGRADED",
      queue: { outboxDepth: 0, oldestAgeMs: 0, poisonMessages: 0, reconciliationLag: 0, workerHeartbeatAgeMs: 0, workerHeartbeatCount: 0 }
    },
    ai: { status: "DISABLED", degraded: true }
  }],
  ["InboxReceipt", { accepted: true, duplicate: false, status: "PROCESSED", inboxId: id, recordDigest: digest }],
  ["MfaFactorResponse", { enrolled: true, method: "TOTP", sessionsRevoked: 2, receiptId: id }],
  ["RecoveryStartResponse", { accepted: true, challengeId: "A".repeat(40), expiresAt: timestamp }],
  ["DemoLoginResponse", { user: authenticatedUser, contexts: [contextOption], csrfToken: "csrf-token", demo: true }],
  ["LogoutResponse", { sessionId: id, localState: "SIGNED_OUT", serverRevocation: "CONFIRMED", serverAttempted: true, serverObservation: { status: "REVOKED", observedAt: timestamp }, retryable: false, correlationId }],
  ["SessionListResponse", { items: [session], currentSessionId: id }],
  ["SessionRevokeResponse", { revoked: true, sessionId: id, current: false, receiptId: id2, replayed: false }],
  ["ContextListResponse", [contextOption]],
  ["ContextResponse", { organizationId: id2, organizationName: "CVG", unit: { id: id3, name: "Centro", code: "CTR" }, workspace: { id, name: "Recepção", purpose: "atendimento" }, roles: ["admin"], purpose: "context.select", policyRevision: "4", correlationId }],
  ["UserListResponse", { items: [listedUser], nextCursor: id, revision: "4" }],
  ["RoleAssignmentResponse", { assignment, receiptId: id2, revision: "5" }],
  ["AuditListResponse", { items: [auditRecord], nextCursor: id, revision: "5" }],
  ["GuardianListResponse", { items: [guardian] }],
  ["GuardianResponse", { guardian, receiptId: id2 }],
  ["PatientListResponse", { items: [patient, expandedPatient] }],
  ["PatientResponse", { patient: expandedPatient, receiptId: id2 }],
  ["PatientMergeResponse", { targetPatient: expandedPatient, sourcePatientId: id3, receiptId: id2 }],
  ["AppointmentListResponse", { items: [appointmentRead] }],
  ["AppointmentResponse", { appointment, receiptId: id2 }],
  ["QueueListResponse", { items: [queueRead] }],
  ["QueueEntryResponse", { queueEntry, receiptId: id2 }],
  ["QueueHandoffResponse", { queueEntry, encounter, receiptId: id2 }],
  ["SchedulingOptionsResponse", {
    providers: [{ id, organizationId: id2, displayName: "Dra. Vet", specialty: "Clínica", role: "veterinario", unitId: id3, status: "ACTIVE" }],
    services: [{ id: id2, organizationId: id2, name: "Consulta", durationMinutes: 30, priceCents: 10000, status: "ACTIVE" }],
    resources: [{ id: id3, organizationId: id2, unitId: id3, name: "Sala 1", kind: "ROOM", status: "ACTIVE" }]
  }]
]);

function schemaFor(name: string) {
  const schema = AUTH_OPS_RESPONSE_SCHEMAS.get(name);
  assert.ok(schema, `missing schema ${name}`);
  return schema;
}

function assertAccepts(name: string, value: unknown): void {
  const result = schemaFor(name).safeParse(value);
  assert.equal(result.success, true, `${name} should accept fixture: ${result.success ? "" : result.error.message}`);
}

function assertRejects(name: string, value: unknown): void {
  assert.equal(schemaFor(name).safeParse(value).success, false, `${name} should reject fixture`);
}

test("exports exactly the AUD27-008 response-schema names", () => {
  assert.deepEqual([...AUTH_OPS_RESPONSE_SCHEMAS.keys()], [...validPayloads.keys()]);
  for (const [name, schema] of AUTH_OPS_RESPONSE_SCHEMAS) assert.ok(schema, `${name} has a schema`);
});

test("accepts actual success payload shapes, receipts, nulls, and empty collections", () => {
  for (const [name, payload] of validPayloads) assertAccepts(name, payload);

  assertAccepts("MfaFactorResponse", { revoked: false, method: "TOTP", sessionsRevoked: 0, receiptId: id });
  assertAccepts("PatientResponse", patient);
  assertAccepts("ContextListResponse", []);
  assertAccepts("GuardianListResponse", { items: [] });
  assertAccepts("PatientListResponse", { items: [] });
  assertAccepts("AppointmentListResponse", { items: [] });
  assertAccepts("QueueListResponse", { items: [] });
  assertAccepts("SchedulingOptionsResponse", { providers: [], services: [], resources: [] });
  assertAccepts("UserListResponse", { items: [], nextCursor: null, revision: "0" });
  assertAccepts("AuditListResponse", { items: [], nextCursor: null, revision: "0" });
});

test("rejects missing and unknown required top-level fields", () => {
  const objectPayloads = [...validPayloads].filter(([, payload]) => typeof payload === "object" && payload !== null && !Array.isArray(payload));
  for (const [name, payload] of objectPayloads) {
    const record = payload as Record<string, unknown>;
    const firstKey = Object.keys(record)[0];
    assert.ok(firstKey, `${name} fixture should have a required field`);
    const missing = { ...record };
    delete missing[firstKey];
    assertRejects(name, missing);
    assertRejects(name, { ...record, unexpectedField: true });
  }
  assertRejects("ContextListResponse", { items: [] });
});

test("rejects unsafe/redacted fields at explicit and broad nested boundaries", () => {
  assertRejects("DemoLoginResponse", { ...validPayloads.get("DemoLoginResponse") as object, passwordDigest: "sensitive" });
  assertRejects("DemoLoginResponse", { user: { ...authenticatedUser, passwordDigest: "sensitive" }, contexts: [], csrfToken: "csrf-token", demo: true });
  assertRejects("PatientResponse", { patient: { ...expandedPatient, secret: "sensitive" }, receiptId: id2 });
  assertRejects("AuditListResponse", { items: [{ ...auditRecord, metadata: { passwordDigest: "sensitive" } }], nextCursor: null, revision: "1" });
  assertRejects("InboxReceipt", { accepted: true, duplicate: false, status: "PROCESSED", inboxId: id, recordDigest: digest, signature: "raw" });
});

test("rejects invalid primitive values, malformed domain records, and unbounded lists", () => {
  assertRejects("HealthResponse", { live: "true", status: "READY", capabilities: { demoOnly: true, realProvidersBlocked: true, realDataBlocked: true } });
  assertRejects("InboxReceipt", { accepted: true, duplicate: false, status: "PROCESSED", inboxId: id, recordDigest: "not-a-digest" });
  assertRejects("RecoveryStartResponse", { accepted: true, challengeId: "short", expiresAt: timestamp });
  assertRejects("SessionListResponse", { items: [{ ...session, currentCredentialVersion: "1" }], currentSessionId: id });
  assertRejects("RoleAssignmentResponse", { assignment: { ...assignment, role: "root" }, receiptId: id2, revision: "1" });
  assertRejects("AuditListResponse", { items: [{ ...auditRecord, metadata: { nested: { value: true } } }], nextCursor: null, revision: "1" });
  assertRejects("PatientListResponse", { items: [{ ...expandedPatient, identifiers: ["ok", 4] }] });
  assertRejects("AppointmentResponse", { appointment: { ...appointment, version: 0 }, receiptId: id2 });
  assertRejects("QueueEntryResponse", { queueEntry: { ...queueEntry, priority: "LOW" }, receiptId: id2 });
  assertRejects("QueueHandoffResponse", { queueEntry, encounter: { ...encounter, closedAt: 4 }, receiptId: id2 });
  assertRejects("SchedulingOptionsResponse", { providers: [], services: [{ id: id2, organizationId: id2, name: "Consulta", durationMinutes: -1, priceCents: 10000, status: "ACTIVE" }], resources: [] });
  assertRejects("GuardianListResponse", { items: Array.from({ length: 1_001 }, () => guardian) });
  assertRejects("AuditListResponse", { items: Array.from({ length: 101 }, () => auditRecord), nextCursor: null, revision: "1" });
});

