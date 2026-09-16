import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { aiUsageSettlementSchema, API_UPCASTERS, API_V2_COMPATIBILITY, ApiCompatibilityError, commandEnvelopeSchema, contractDescriptorSchema, domainEventSchema, governedExportInputSchema, id, loginResponseSchema, upcastApiValue } from "@cvg/contracts";

const identifier = () => id(randomUUID());

test("governed D4 export contract fixes purpose, organization scope and TTL", () => {
  assert.deepEqual(governedExportInputSchema.parse({ purpose: "INCIDENT_RECOVERY" }), { purpose: "INCIDENT_RECOVERY", scopeType: "ORGANIZATION", ttlSeconds: 3_600 });
  assert.throws(() => governedExportInputSchema.parse({ purpose: "incident recovery validation" }));
  assert.throws(() => governedExportInputSchema.parse({ purpose: "INCIDENT_RECOVERY", scopeType: "UNIT" }));
  assert.throws(() => governedExportInputSchema.parse({ purpose: "INCIDENT_RECOVERY", ttlSeconds: 30 }));
});

test("versioned command and event envelopes accept known-good input", () => {
  const timestamp = new Date().toISOString();
  const command = commandEnvelopeSchema.parse({
    schemaVersion: 1,
    commandId: identifier(),
    actionId: identifier(),
    commandType: "patients.create",
    actorId: identifier(),
    organizationId: identifier(),
    unitId: null,
    workspaceId: null,
    resourceType: "AnimalPatient",
    resourceId: null,
    expectedVersion: null,
    purpose: "patients.create",
    normalizedArgsDigest: "a".repeat(64),
    policyRevision: "local-synthetic-v1",
    idempotencyKey: "contract-test",
    budgetReservationId: null,
    approvalBindingId: null,
    parentActionId: null,
    egressIntent: "NONE",
    deadline: timestamp,
    payload: { known: true }
  });
  assert.equal(command.schemaVersion, 1);
  assert.equal(command.egressIntent, "NONE");

  const event = domainEventSchema.parse({
    schemaVersion: 1,
    eventId: identifier(),
    eventType: "PATIENT_CREATED",
    aggregateType: "AnimalPatient",
    aggregateId: identifier(),
    organizationId: identifier(),
    correlationId: "contract-test",
    causationId: null,
    occurredAt: timestamp,
    payloadDigest: "b".repeat(64),
    payload: { synthetic: true }
  });
  assert.equal(event.schemaVersion, 1);
});

test("versioned envelopes reject unknown fields and malformed digests", () => {
  const descriptor = contractDescriptorSchema.safeParse({ name: "cvg.command", version: "1.0.0", schemaVersion: 1, compatibility: "BACKWARD_COMPATIBLE", owner: "platform", digest: "c".repeat(64), unknown: true });
  assert.equal(descriptor.success, false);
  const event = domainEventSchema.safeParse({ schemaVersion: 1, eventId: identifier(), eventType: "TEST", aggregateType: "Fixture", aggregateId: null, organizationId: null, correlationId: "test", causationId: null, occurredAt: new Date().toISOString(), payloadDigest: "not-a-digest", payload: null });
  assert.equal(event.success, false);
});

test("prepared API compatibility is an explicit fail-closed upcaster registry", () => {
  assert.equal(API_V2_COMPATIBILITY.status, "PREPARED_ONLY");
  assert.equal(API_V2_COMPATIBILITY.upcasters, "FAIL_CLOSED_REGISTRY");
  assert.equal(API_V2_COMPATIBILITY.registered, API_UPCASTERS.length);
  assert.equal(API_V2_COMPATIBILITY.legacySchemasAccepted, false);

  const current = { schemaVersion: 1, correlationId: "compatibility-test", data: { ok: true } };
  const copied = upcastApiValue(current);
  assert.deepEqual(copied, current);
  assert.notEqual(copied, current);
  assert.throws(() => upcastApiValue({ schemaVersion: 0, data: {} }), (error: unknown) => error instanceof ApiCompatibilityError && error.code === "API_COMPATIBILITY_UNAVAILABLE");
  assert.throws(() => upcastApiValue({ schemaVersion: 2, data: {} }), (error: unknown) => error instanceof ApiCompatibilityError && error.code === "API_COMPATIBILITY_UNAVAILABLE");
  assert.throws(() => upcastApiValue(current, 2), (error: unknown) => error instanceof ApiCompatibilityError && error.code === "API_COMPATIBILITY_UNAVAILABLE");
});

test("AI usage settlement keeps cost uncertainty explicit and binds tokens to the turn", () => {
  const settlement = aiUsageSettlementSchema.parse({
    model: "deepseek-test",
    inputTokens: 4,
    outputTokens: 3,
    providerResponseDigest: null,
    estimatedCost: { amountMicros: null, currency: null, source: "UNAVAILABLE", pricingRevision: null },
    actualCost: { amountMicros: null, currency: null, source: "UNAVAILABLE", pricingRevision: null },
    discrepancy: { status: "NOT_EVALUATED", deltaMicros: null, reason: "provider pricing evidence was not supplied" }
  });
  assert.equal(settlement.inputTokens + settlement.outputTokens, 7);
  assert.equal(settlement.estimatedCost.source, "UNAVAILABLE");
  assert.throws(() => aiUsageSettlementSchema.parse({ ...settlement, discrepancy: { ...settlement.discrepancy, deltaMicros: 1.5 } }));
});

test("login response discriminates a completed session from a pending MFA challenge", () => {
  const user = { id: randomUUID(), displayName: "Synthetic User", email: "user@example.test", status: "ACTIVE" };
  const context = { organization: { id: randomUUID(), name: "Org", slug: "org" }, unit: { id: randomUUID(), name: "Unit", code: "U1" }, workspace: { id: randomUUID(), name: "Workspace", purpose: "clinical" }, roles: ["admin"] };
  const session = loginResponseSchema.parse({ user, contexts: [context], csrfToken: "synthetic-csrf" });
  assert.equal("mfaRequired" in session, false);
  const challenge = loginResponseSchema.parse({ mfaRequired: true, challengeId: "a".repeat(32), expiresAt: new Date().toISOString() });
  assert.equal(challenge.mfaRequired, true);
  assert.throws(() => loginResponseSchema.parse({ mfaRequired: true, user, contexts: [context] }));
  assert.throws(() => loginResponseSchema.parse({ user, contexts: [context], mfaRequired: false }));
  assert.throws(() => loginResponseSchema.parse({ user: { ...user, id: "not-an-id" }, contexts: [context] }));
});

test("web client payload validation fails closed inside a valid envelope", async () => {
  const { validatePayload } = await import("../../apps/web/src/api/validation.ts");
  const user = { id: randomUUID(), displayName: "Synthetic User", email: "user@example.test", status: "ACTIVE" };
  const context = { organization: { id: randomUUID(), name: "Org", slug: "org" }, unit: { id: randomUUID(), name: "Unit", code: "U1" }, workspace: { id: randomUUID(), name: "Workspace", purpose: "clinical" }, roles: ["admin"] };
  const session = validatePayload("POST", "/auth/login", { user, contexts: [context], csrfToken: "synthetic-csrf" });
  assert.equal(session.status, "validated");
  const challenge = validatePayload("POST", "/auth/login", { mfaRequired: true, challengeId: "b".repeat(32), expiresAt: new Date().toISOString() });
  assert.equal(challenge.status, "validated");
  const invalidLogin = validatePayload("POST", "/auth/login", { contexts: [] });
  assert.equal(invalidLogin.status, "invalid");
  const invalidFinance = validatePayload("GET", "/finance/charges", { items: "not-an-array", balance: null });
  assert.equal(invalidFinance.status, "invalid");
  if (invalidFinance.status === "invalid") assert.match(invalidFinance.issues, /items/);
  const migrated = validatePayload("GET", "/patients", { items: [] });
  assert.equal(migrated.status, "passthrough");
});

test("partial envelopes and command receipts stay discriminated inside the contract", async () => {
  const { apiPartialEnvelopeSchema, apiSuccessEnvelopeSchema, commandReceiptSchema, FIRST_JOURNEY_CONTRACT_EXAMPLES, receiptReferenceSchema } = await import("@cvg/contracts");
  const partial = apiPartialEnvelopeSchema.parse(FIRST_JOURNEY_CONTRACT_EXAMPLES.partial);
  assert.equal(partial.status, "PARTIAL");
  assert.equal(partial.pending[0]?.reason, "POLICY_UNRESOLVED");
  assert.equal(partial.pending[0]?.retryable, false);
  assert.equal(apiPartialEnvelopeSchema.safeParse({ ...FIRST_JOURNEY_CONTRACT_EXAMPLES.partial, pending: [] }).success, false);
  const success = apiSuccessEnvelopeSchema.parse(FIRST_JOURNEY_CONTRACT_EXAMPLES.success);
  assert.equal("pending" in success, false);
  const receipt = commandReceiptSchema.parse({
    id: randomUUID(),
    organizationId: randomUUID(),
    actorId: randomUUID(),
    unitId: randomUUID(),
    workspaceId: null,
    auditRecordId: null,
    operation: "finance.charge",
    idempotencyLookup: "synthetic-lookup",
    bodyDigest: "d".repeat(64),
    status: "SUCCEEDED",
    result: { chargeId: randomUUID() },
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString()
  });
  const reference = receiptReferenceSchema.parse({ receiptId: receipt.id, status: "SUCCEEDED", replayed: true });
  assert.equal(reference.receiptId, receipt.id);
  assert.equal(commandReceiptSchema.safeParse({ ...receipt, status: "IN_FLIGHT", completedAt: new Date().toISOString() }).success, false);
});
