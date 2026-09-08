import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { commandEnvelopeSchema, contractDescriptorSchema, domainEventSchema, id } from "@cvg/contracts";

const identifier = () => id(randomUUID());

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
