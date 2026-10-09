import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { aiTurnWireSchema, aiUsageSettlementSchema, API_UPCASTERS, API_V2_COMPATIBILITY, ApiCompatibilityError, appointmentInputSchema, appointmentRangeSchema, commandEnvelopeSchema, contextSelectorSchema, contractDescriptorSchema, domainEventSchema, failure, governedExportInputSchema, id, isApiError, isApiPartial, loginResponseSchema, mfaFactorRevokeInputSchema, partial, passwordRotationInputSchema, patientMergeInputSchema, recoveryCompleteInputSchema, recoveryStartInputSchema, roleAssignmentInputSchema, success, upcastApiValue } from "@cvg/contracts";

const identifier = () => id(randomUUID());

test("governed D4 export contract fixes purpose, organization scope and TTL", () => {
  assert.deepEqual(governedExportInputSchema.parse({ purpose: "INCIDENT_RECOVERY" }), { purpose: "INCIDENT_RECOVERY", scopeType: "ORGANIZATION", ttlSeconds: 3_600 });
  assert.throws(() => governedExportInputSchema.parse({ purpose: "incident recovery validation" }));
  assert.throws(() => governedExportInputSchema.parse({ purpose: "INCIDENT_RECOVERY", scopeType: "UNIT" }));
  assert.throws(() => governedExportInputSchema.parse({ purpose: "INCIDENT_RECOVERY", ttlSeconds: 30 }));
});

test("bounded input refinements and API factories cover their fail-closed branches", () => {
  const userId = identifier();
  const unitId = identifier();
  const workspaceId = identifier();
  const patientId = identifier();
  const providerId = identifier();
  const serviceId = identifier();

  assert.deepEqual(contextSelectorSchema.parse({}), { unitId: null, workspaceId: null });
  assert.deepEqual(mfaFactorRevokeInputSchema.parse({ currentPassword: "correct horse" }), { currentPassword: "correct horse" });
  assert.deepEqual(recoveryStartInputSchema.parse({ login: "synthetic-user" }), { login: "synthetic-user" });
  assert.deepEqual(recoveryCompleteInputSchema.parse({ challengeId: "c".repeat(32), recoveryCode: "recovery-code", newPassword: "new-password-123" }).challengeId, "c".repeat(32));
  assert.deepEqual(passwordRotationInputSchema.parse({ currentPassword: "old-password", newPassword: "new-password-123" }).newPassword, "new-password-123");

  assert.equal(roleAssignmentInputSchema.safeParse({ userId, role: "admin", scopeType: "UNIT", unitId, expectedRevision: "1" }).success, true);
  assert.equal(roleAssignmentInputSchema.safeParse({ userId, role: "admin", scopeType: "WORKSPACE", unitId, workspaceId, expectedRevision: "1" }).success, true);
  assert.equal(roleAssignmentInputSchema.safeParse({ userId, role: "admin", scopeType: "UNIT", expectedRevision: "1" }).success, false);
  assert.equal(roleAssignmentInputSchema.safeParse({ userId, role: "admin", scopeType: "WORKSPACE", unitId, expectedRevision: "1" }).success, false);
  assert.equal(roleAssignmentInputSchema.safeParse({ userId, role: "admin", scopeType: "UNIT", unitId, workspaceId, expectedRevision: "1" }).success, false);

  assert.equal(patientMergeInputSchema.safeParse({ sourcePatientId: patientId, targetPatientId: identifier(), reason: "duplicate record", confirmation: "MERGE_PATIENTS" }).success, true);
  assert.equal(patientMergeInputSchema.safeParse({ sourcePatientId: patientId, targetPatientId: patientId, reason: "duplicate record", confirmation: "MERGE_PATIENTS" }).success, false);

  const startsAt = "2026-09-21T10:00:00-03:00";
  assert.equal(appointmentRangeSchema.safeParse({ startsAt, endsAt: "2026-09-21T11:00:00-03:00" }).success, true);
  assert.equal(appointmentRangeSchema.safeParse({ startsAt, endsAt: "2026-09-21T09:00:00-03:00" }).success, false);
  assert.equal(appointmentRangeSchema.safeParse({ startsAt, endsAt: "2026-10-01T10:00:00-03:00" }).success, false);
  assert.equal(appointmentInputSchema.safeParse({ patientId, providerId, resourceId: null, serviceId, startsAt, endsAt: "2026-09-21T11:00:00-03:00", purpose: "consulta" }).success, true);
  assert.equal(appointmentInputSchema.safeParse({ patientId, providerId, serviceId, startsAt, endsAt: startsAt, purpose: "consulta" }).success, false);

  const valid = success({ ok: true }, "corr-1");
  assert.equal(valid.schemaVersion, 1);
  assert.equal(isApiError(valid), false);
  const partialResponse = partial({ ok: true }, [], "corr-2");
  assert.equal(isApiPartial(partialResponse), true);
  assert.equal(isApiPartial(null), false);
  const bounded = failure("NOT_FOUND", "  missing  ", "corr-3", { reason: "synthetic", nested: [true, 2] });
  assert.equal(bounded.error.code, "NOT_FOUND");
  assert.equal(bounded.error.message, "missing");
  assert.equal(bounded.error.details?.reason, "synthetic");
  const nested = bounded.error.details?.nested as { 0: unknown; 1: unknown; length: number };
  assert.equal(nested[0], true);
  assert.equal(nested[1], 2);
  const fallback = failure("not-a-code" as never, "", "bad correlation", { bad: () => "not cloneable" });
  assert.equal(fallback.error.code, "INTERNAL_ERROR");
  assert.equal(fallback.error.message, "Request failed");
  assert.equal(fallback.correlationId, "unknown");
  assert.equal(fallback.error.details?.detailsUnavailable, true);
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

test("AI wire contract preserves provenance, references and settled usage across the boundary", () => {
  const references = [{ title: "Synthetic protocol", source: "https://example.test/protocol" }];
  const usageId = identifier();
  const wire = aiTurnWireSchema.parse({
    id: identifier(),
    sessionId: identifier(),
    prompt: "Summarize the synthetic encounter",
    response: "Synthetic summary",
    status: "COMPLETED",
    model: "synthetic-model",
    inputTokens: 12,
    outputTokens: 9,
    references,
    provenance: {
      provider: "synthetic-provider",
      engineCommit: "engine-commit",
      manifestVersion: "manifest-v1",
      profileDigest: "profile-digest",
      policyRevision: "policy-v1",
      references,
      referencesDigest: "a".repeat(64),
      correlationId: "contract-ai-turn",
      usageRecordId: usageId
    },
    usage: {
      id: usageId,
      reservationId: null,
      providerRequestId: "provider-request",
      idempotencyKey: "contract-ai-usage",
      usageKind: "TOKENS",
      reservedUnits: 24,
      consumedUnits: 21,
      status: "SETTLED",
      record: { synthetic: true },
      settlement: {
        model: "synthetic-model",
        inputTokens: 12,
        outputTokens: 9,
        providerResponseDigest: "b".repeat(64),
        estimatedCost: { amountMicros: 12, currency: "USD", source: "LOCAL_SYNTHETIC", pricingRevision: "pricing-v1" },
        actualCost: { amountMicros: 12, currency: "USD", source: "LOCAL_SYNTHETIC", pricingRevision: "pricing-v1" },
        discrepancy: { status: "MATCHED", deltaMicros: 0, reason: null }
      }
    },
    createdAt: new Date().toISOString()
  });

  assert.equal(wire.status, "COMPLETED");
  assert.equal(wire.provenance?.usageRecordId, usageId);
  assert.equal(wire.usage?.settlement?.actualCost.amountMicros, 12);
  assert.throws(() => aiTurnWireSchema.parse({ ...wire, unexpected: true }));
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
  const validPatients = validatePayload("GET", "/patients", { items: [{ id: randomUUID(), name: "Luna", species: "canino", status: "ACTIVE" }] });
  assert.equal(validPatients.status, "validated");
  const malformedPatients = validatePayload("GET", "/patients", { items: [{ name: "sem id" }] });
  assert.equal(malformedPatients.status, "invalid");
  const semanticBad = [
    { items: [{ id: randomUUID(), name: "Luna", species: "canina", status: "ACTIVE", breed: 42 }] },
    { items: [{ id: randomUUID(), name: "Luna", species: "canina", status: "ACTIVE", guardian: "malformed" }] },
    { items: [{ id: "not-a-uuid", name: "Luna", species: "canina", status: "ACTIVE" }] },
    { items: [{ id: randomUUID(), name: "Luna", species: "canina", status: "WHATEVER" }] }
  ];
  for (const payload of semanticBad) {
    assert.equal(validatePayload("GET", "/patients", payload).status, "invalid", JSON.stringify(payload));
  }
  assert.equal(validatePayload("GET", "/finance/charges", { items: [], balance: { amountCents: -1 } }).status, "invalid");
  const unregistered = validatePayload("GET", "/not-a-contract", { anything: true });
  assert.equal(unregistered.status, "invalid");
  if (unregistered.status === "invalid") assert.match(unregistered.issues, /unregistered endpoint/);
});

test("CVG-AUD19-018: every UI-consumed endpoint has a runtime contract or a justified allowlist entry", async () => {
  const { readFile, readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { normalizeValidationPath, payloadContractRegistry, UNVALIDATED_ALLOWLIST } = await import("../../apps/web/src/api/validation.ts");
  const collect = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) files.push(...await collect(path));
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
    }
    return files;
  };
  const sources = await collect("apps/web/src");
  const consumed = new Set<string>();
  for (const file of sources) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/client\.(get|request)(?:<[^>]*>)?\(\s*[`"']([^`"']+)/g)) {
      const captures = [...(match[2] ?? "").matchAll(/\$\{([^}]*)\}/g)].map((capture) => capture[1] ?? "");
      const raw = (match[2] ?? "").replace(/\$\{[^}]*\}/g, ":id").replace(/\$\{.*$/, "").split("?", 1)[0] ?? "";
      if (!raw.startsWith("/")) continue;
      const window = source.slice(match.index ?? 0, (match.index ?? 0) + 240);
      const method = match[1] === "get" ? "GET" : /method:\s*["'](POST|DELETE|PUT|PATCH)["']/.exec(window)?.[1] ?? "GET";
      const normalized = normalizeValidationPath(raw);
      // A placeholder fed by a variable action is expanded to its registered
      // actions instead of a catch-all route (CVG-AUD20-014).
      consumed.add(`${method} ${normalized}`);
      if (captures.some((capture) => capture.includes("action")) && normalized.endsWith("/:id/:id")) {
        const base = normalized.slice(0, normalized.length - ":id".length);
        consumed.delete(`${method} ${normalized}`);
        for (const action of ["approve", "index", "quarantine"]) consumed.add(`${method} ${base}${action}`);
      }
    }
  }
  assert.ok(consumed.size >= 50, `expected a meaningful UI endpoint inventory, observed ${consumed.size}`);
  const missing = [...consumed].filter((key) => !payloadContractRegistry.has(key) && !UNVALIDATED_ALLOWLIST.includes(key));
  assert.deepEqual(missing, []);
});

test("CVG-AUD21-006: semantic contracts preserve Knowledge fields and reject cross-family mutants", async () => {
  const { validatePayload } = await import("../../apps/web/src/api/validation.ts");
  const timestamp = "2026-09-20T12:00:00.000Z";
  const knowledge = {
    id: randomUUID(),
    title: "Protocolo sintético",
    source: "Direção clínica",
    dataClass: "D1",
    version: 1,
    status: "DRAFT",
    createdAt: timestamp
  };
  const validKnowledge = validatePayload("GET", "/knowledge", { items: [knowledge] });
  assert.equal(validKnowledge.status, "validated");
  if (validKnowledge.status === "validated") {
    const item = (validKnowledge.data as { items: typeof knowledge[] }).items[0];
    assert.equal(item?.source, knowledge.source);
    assert.equal(item?.dataClass, knowledge.dataClass);
    assert.equal(item?.createdAt, knowledge.createdAt);
  }
  for (const payload of [
    { items: [{ ...knowledge, source: 42 }] },
    { items: [{ ...knowledge, dataClass: "D9" }] },
    { items: [{ ...knowledge, createdAt: "not-a-timestamp" }] },
    { items: [{ ...knowledge, id: "not-a-uuid" }] },
    { items: [{ ...knowledge, unexpected: true }] }
  ]) assert.equal(validatePayload("GET", "/knowledge", payload).status, "invalid");

  const diagnostic = { id: randomUUID(), patientId: randomUUID(), encounterId: null, testName: "Hemograma", priority: "ROUTINE", status: "REQUESTED", requestedBy: randomUUID(), createdAt: timestamp };
  assert.equal(validatePayload("GET", "/diagnostics/requests", { items: [diagnostic] }).status, "validated");
  assert.equal(validatePayload("GET", "/diagnostics/requests", { items: [{ ...diagnostic, patientId: "patient-1" }] }).status, "invalid");
  assert.equal(validatePayload("GET", "/diagnostics/requests", { items: [{ ...diagnostic, status: "CORRUPTED" }] }).status, "invalid");

  const movement = { id: randomUUID(), productId: randomUUID(), lotId: randomUUID(), locationId: randomUUID(), quantity: 2, movementType: "RECEIPT", reason: "entrada sintética", referenceId: null, createdBy: randomUUID(), createdAt: timestamp };
  assert.equal(validatePayload("GET", "/stock/movements", { items: [movement] }).status, "validated");
  assert.equal(validatePayload("GET", "/stock/movements", { items: [{ ...movement, quantity: -1 }] }).status, "invalid");
  assert.equal(validatePayload("GET", "/stock/movements", { items: [{ ...movement, quantity: 1.5 }] }).status, "invalid");

  const session = { id: randomUUID(), purpose: "SUMMARY", status: "ACTIVE", createdAt: timestamp, turns: 0 };
  assert.equal(validatePayload("GET", "/ai/sessions", { items: [session] }).status, "validated");
  assert.equal(validatePayload("GET", "/ai/sessions", { items: [{ ...session, purpose: "INVALID" }] }).status, "invalid");
  assert.equal(validatePayload("GET", "/ai/sessions", { items: [{ ...session, status: "INVALID" }] }).status, "invalid");

  const capabilities = {
    adapterId: "mock-harness",
    provider: "LOCAL_STUB_ONLY",
    engineCommit: "e".repeat(40),
    manifestVersion: "0.1.1-rc.2",
    toolNames: ["cvg.patient.read"],
    supports: { cancellation: true, approvals: true, replay: true, provenance: true }
  };
  assert.equal(validatePayload("GET", "/capabilities", {
    items: [],
    api: { version: "v1", catalogVersion: 1, catalogFingerprint: "deadbeef", v2: {} }
  }).status, "validated");
  assert.equal(validatePayload("GET", "/capabilities", {
    items: [],
    api: { version: "v1", catalogVersion: 1, catalogFingerprint: "d".repeat(64), v2: {} }
  }).status, "invalid");
  assert.equal(validatePayload("GET", `/ai/sessions/${randomUUID()}/replay`, {
    session: {
      id: randomUUID(), organizationId: randomUUID(), actorId: randomUUID(), unitId: randomUUID(), workspaceId: randomUUID(),
      patientId: null, encounterId: null, purpose: "SUMMARY", engineCommit: "e".repeat(40), profileDigest: "d".repeat(64), status: "ACTIVE", createdAt: timestamp
    },
    turns: [],
    digest: "d".repeat(64),
    provenance: capabilities
  }).status, "validated");
  assert.equal(validatePayload("POST", "/auth/demo", {
    mfaRequired: true, challengeId: "m".repeat(32), expiresAt: timestamp
  }).status, "validated");
  assert.equal(validatePayload("POST", "/communications", {
    message: {
      id: randomUUID(), organizationId: randomUUID(), unitId: randomUUID(), workspaceId: randomUUID(), patientId: null,
      channel: "SMS", recipient: "+5511999999999", template: "Aviso", body: "Mensagem sintética", status: "APPROVAL_REQUIRED",
      createdBy: randomUUID(), createdAt: timestamp
    },
    receiptId: randomUUID()
  }).status, "validated");
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
