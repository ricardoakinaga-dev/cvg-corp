import test from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { CvgStore, makeId, type StoreSnapshot } from "@cvg/domain";
import { writeAud27DomainWrite, type Aud27ProjectionWriterDependencies } from "../../packages/persistence/src/aud27-domain-writer.ts";

type RecordedWrite = { sql: string; values: unknown[][] };

function recordingDependencies(): { dependencies: Aud27ProjectionWriterDependencies; recorded: RecordedWrite[] } {
  const recorded: RecordedWrite[] = [];
  const record = <T>(sql: string, rows: T[], values: (row: T) => unknown[]): void => {
    recorded.push({ sql, values: rows.map((row) => values(row)) });
  };
  const dependencies: Aud27ProjectionWriterDependencies = {
    writeRows: async (_client, sql, rows, values) => record(sql, rows, values),
    writeScopedRows: async (_client, sql, rows, _scope, values) => record(sql, rows, values),
    writeUnitRows: async (_client, sql, rows, _unit, values) => record(sql, rows, values),
    corruption: (message) => new Error(message)
  };
  return { recorded, dependencies };
}

function seeded<T>(rows: readonly T[], key: string): T {
  const row = rows[0];
  if (!row) throw new Error(`seeded snapshot is missing ${key}`);
  return row;
}

test("AUD27 normalized writer projects every snapshot-primary seam into its relational table", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const snapshot = store.snapshot();
  const organizationId = seeded(snapshot.organizations, "organizations").id;
  const unitId = seeded(snapshot.units, "units").id;
  const workspaceId = seeded(snapshot.workspaces, "workspaces").id;
  const actorId = seeded(snapshot.users, "users").id;
  const patientId = seeded(snapshot.patients, "patients").id;
  const now = new Date().toISOString();
  const encounter = { id: makeId(), organizationId, unitId, workspaceId, patientId, appointmentId: null, status: "OPEN", startedAt: now, closedAt: null } as unknown as StoreSnapshot["encounters"][number];
  const document = { id: makeId(), organizationId, encounterId: encounter.id, patientId, authorId: actorId, status: "SIGNED", createdAt: now } as unknown as StoreSnapshot["clinicalDocuments"][number];
  snapshot.encounters.push(encounter);
  snapshot.clinicalDocuments.push(document);
  const session = { id: makeId(), organizationId, actorId, unitId, workspaceId, patientId: null, encounterId: null, purpose: "synthetic", engineCommit: "0".repeat(40), profileDigest: "0".repeat(64), status: "ACTIVE", createdAt: now } as unknown as StoreSnapshot["aiSessions"][number];
  snapshot.aiSessions.push(session);
  const turn = { id: makeId(), organizationId, unitId, workspaceId, sessionId: session.id, prompt: "synthetic prompt", response: "synthetic response", status: "COMPLETED", model: "synthetic-model", inputTokens: 1, outputTokens: 2, references: [], usage: null, provenance: null, createdAt: now } as unknown as StoreSnapshot["aiTurns"][number];
  const draft = { id: makeId(), organizationId, unitId, workspaceId, sessionId: session.id, encounterId: null, draftType: "NOTE", content: "synthetic", sourceTurnId: turn.id, status: "DRAFT", createdAt: now } as unknown as StoreSnapshot["aiDrafts"][number];
  const approval = { id: makeId(), organizationId, actorId, sessionId: session.id, turnId: turn.id, toolName: "clinical.sign", resourceId: null, patientId: null, encounterId: null, unitId, workspaceId, purpose: "synthetic", requestDigest: "0".repeat(64), policyRevision: 1, expiresAt: now, decision: "PENDING", decidedBy: null, reason: null, createdAt: now } as unknown as StoreSnapshot["aiApprovals"][number];
  const reservation = { id: makeId(), organizationId, sessionId: session.id, category: "TOKENS", reservedUnits: 10, consumedUnits: 0, status: "RESERVED", createdAt: now } as unknown as StoreSnapshot["budgetReservations"][number];
  const addendum = { id: makeId(), organizationId, documentId: document.id, authorId: actorId, reason: "synthetic", content: "synthetic", createdAt: now } as unknown as StoreSnapshot["clinicalAddenda"][number];

  const cases: Array<{ snapshotKey: string; record: unknown; table: string }> = [
    { snapshotKey: "providers", record: seeded(snapshot.providers, "providers"), table: "insert into providers" },
    { snapshotKey: "services", record: seeded(snapshot.services, "services"), table: "insert into service_catalog_items" },
    { snapshotKey: "resources", record: seeded(snapshot.resources, "resources"), table: "insert into resources" },
    { snapshotKey: "queueEntries", record: seeded(snapshot.queueEntries, "queueEntries"), table: "insert into queue_entries" },
    { snapshotKey: "clinicalAddenda", record: addendum, table: "insert into clinical_addenda" },
    { snapshotKey: "beds", record: seeded(snapshot.beds, "beds"), table: "insert into beds" },
    { snapshotKey: "hospitalEpisodes", record: { id: makeId(), organizationId, unitId, patientId, encounterId: encounter.id, bedId: null, status: "OPEN", admittedAt: now, dischargedAt: null }, table: "insert into hospital_episodes" },
    { snapshotKey: "products", record: seeded(snapshot.products, "products"), table: "insert into products" },
    { snapshotKey: "stockLocations", record: seeded(snapshot.stockLocations, "stockLocations"), table: "insert into stock_locations" },
    { snapshotKey: "lots", record: seeded(snapshot.lots, "lots"), table: "insert into lots" },
    { snapshotKey: "stockMovements", record: { id: makeId(), organizationId, lotId: seeded(snapshot.lots, "lots").id, kind: "IN", quantity: 1, createdAt: now }, table: "insert into stock_movements" },
    { snapshotKey: "medicationOrders", record: { id: makeId(), organizationId, unitId, patientId, encounterId: encounter.id, status: "OPEN", createdAt: now }, table: "insert into medication_orders" },
    { snapshotKey: "dispensations", record: { id: makeId(), organizationId, medicationOrderId: makeId(), status: "DISPENSED", createdAt: now }, table: "insert into dispensations" },
    { snapshotKey: "administrationOccurrences", record: { id: makeId(), organizationId, medicationOrderId: makeId(), status: "ADMINISTERED", administeredAt: now }, table: "insert into administration_occurrences" },
    { snapshotKey: "charges", record: seeded(snapshot.charges, "charges"), table: "insert into charges" },
    { snapshotKey: "payments", record: { id: makeId(), organizationId, chargeId: seeded(snapshot.charges, "charges").id, amountCents: 100, status: "PAID", createdAt: now }, table: "insert into payments" },
    { snapshotKey: "ledgerEntries", record: { id: makeId(), organizationId, account: "synthetic", amountCents: 100, createdAt: now }, table: "insert into ledger_entries" },
    { snapshotKey: "messages", record: { id: makeId(), organizationId, unitId, workspaceId, channel: "WHATSAPP", direction: "OUTBOUND", body: "synthetic", status: "QUEUED", createdAt: now }, table: "insert into communication_messages" },
    { snapshotKey: "knowledgeDocuments", record: seeded(snapshot.knowledgeDocuments, "knowledgeDocuments"), table: "insert into knowledge_documents" },
    { snapshotKey: "aiSessions", record: session, table: "insert into ai_sessions" },
    { snapshotKey: "aiTurns", record: turn, table: "insert into ai_turns" },
    { snapshotKey: "aiDrafts", record: draft, table: "insert into ai_drafts" },
    { snapshotKey: "aiApprovals", record: approval, table: "insert into ai_approvals" },
    { snapshotKey: "budgetReservations", record: reservation, table: "insert into budget_reservations" }
  ];

  assert.equal(cases.length, 24);
  for (const entry of cases) {
    const { dependencies, recorded } = recordingDependencies();
    await writeAud27DomainWrite({} as PoolClient, snapshot, { snapshotKey: entry.snapshotKey, record: entry.record } as never, dependencies);
    assert.equal(recorded.length, 1, `${entry.snapshotKey} must emit exactly one normalized write`);
    assert.ok(recorded[0]!.sql.startsWith(entry.table), `${entry.snapshotKey} wrote ${recorded[0]!.sql.slice(0, 48)}`);
    assert.equal(recorded[0]!.values.length, 1, `${entry.snapshotKey} must project exactly one row`);
  }
});

test("AUD27 normalized writer fails closed when a dependent scope is missing", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const snapshot = store.snapshot();
  const { dependencies } = recordingDependencies();
  await assert.rejects(
    () => writeAud27DomainWrite({} as PoolClient, snapshot, { snapshotKey: "aiTurns", record: { id: makeId(), sessionId: makeId() } } as never, dependencies),
    /no resolvable session scope/
  );
  await assert.rejects(
    () => writeAud27DomainWrite({} as PoolClient, snapshot, { snapshotKey: "aiDrafts", record: { id: makeId(), sessionId: makeId() } } as never, dependencies),
    /no resolvable session scope/
  );
  await assert.rejects(
    () => writeAud27DomainWrite({} as PoolClient, snapshot, { snapshotKey: "clinicalAddenda", record: { id: makeId(), documentId: makeId() } } as never, dependencies),
    /no organization-bound document/
  );
});
