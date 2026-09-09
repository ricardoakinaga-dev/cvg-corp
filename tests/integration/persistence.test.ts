import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { CvgStore, digest, idempotent, serializeSnapshot } from "@cvg/domain";
import { GovernedHarness } from "@cvg/harness";
import { createRuntime } from "@cvg/api";
import { decryptRecoveryBundle, encryptRecoveryBundle, PersistenceConflictError, PersistenceCorruptionError, PersistenceUnavailableError, PostgresPersistence } from "@cvg/persistence";

type QueryResult = { rows: Array<Record<string, unknown>> };

function fakePool(options: { revision?: string; failSnapshotInsert?: boolean; auditLedgerConflict?: boolean } = {}): { pool: Pool; statements: string[] } {
  let revision = options.revision ?? "0";
  const statements: string[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
      statements.push(sql.trim().replace(/\s+/g, " "));
      if (sql.includes("select revision::text")) return { rows: revision === "0" ? [] : [{ revision }] };
      if (sql.startsWith("insert into cvg_audit_ledger")) return { rows: options.auditLedgerConflict ? [] : [{ audit_id: String(params[0]) }] };
      if (sql.startsWith("insert into command_receipts")) return { rows: [{ id: String(params[0]) }] };
      if (sql.startsWith("insert into cvg_command_receipt_ledger")) return { rows: [{ receipt_id: String(params[0]) }] };
      if (sql.startsWith("insert into cvg_state_snapshots")) {
        if (options.failSnapshotInsert) throw new Error("synthetic snapshot write failure");
        revision = String(params[0]);
      }
      return { rows: [] };
    },
    release(): void { /* no-op fake */ }
  } as unknown as PoolClient;
  const pool = {
    async query(sql: string): Promise<QueryResult> {
      const normalized = sql.trim().replace(/\s+/g, " ");
      statements.push(normalized);
      if (sql.includes("current_database()")) return { rows: [{ database: "cvg_synthetic", server_version: "16.0" }] };
      if (sql.includes("to_regclass('public.cvg_state_snapshots')")) return { rows: [{ snapshots: true, journal: true, audit: true, receipts: true, communications: true, outbox: true, usage_ledger: true, inbox: true, external_effects: true, runtime_scope_guards: true, ai_turn_scope: true, ai_draft_scope: true }] };
      if (sql.includes("from cvg_state_snapshots s")) return { rows: [] };
      if (sql.includes("select revision::text as revision")) return { rows: revision === "0" ? [] : [{ revision }] };
      return { rows: [] };
    },
    connect: async (): Promise<PoolClient> => client
  } as unknown as Pool;
  return { pool, statements };
}

function commitInput(store: CvgStore) {
  return {
    expectedRevision: null,
    snapshot: store.snapshot(),
    eventType: "BOOTSTRAP" as const,
    operation: "test.bootstrap",
    organizationId: store.bootstrapCredentials.organizationId,
    actorId: null,
    correlationId: "persistence-test",
    aggregateType: "Organization",
    aggregateId: store.bootstrapCredentials.organizationId,
    payload: { synthetic: true }
  };
}

function normalizedReadPool(): { pool: Pool; statements: string[]; scope: { organizationId: string | null } } {
  const statements: string[] = [];
  const scope = { organizationId: null as string | null };
  const client = {
    async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
      statements.push(sql.trim().replace(/\s+/g, " "));
      if (sql.includes("set_config('cvg.organization_id'")) scope.organizationId = String(params[0]);
      if (sql.startsWith("select g.id::text")) return { rows: [{ id: "00000000-0000-4000-0000-000000000101", display_name: "Marina Souza", phone: "+55 11 98888-1200", email: "marina@example.test", data_class: "D2", status: "ACTIVE" }] };
      if (sql.startsWith("select p.id::text")) return { rows: [{ id: "00000000-0000-4000-0000-000000000111", guardian_id: "00000000-0000-4000-0000-000000000101", name: "Luna", species: "Canina", breed: "Golden retriever", sex: "FEMALE", reproductive_status: "NEUTERED", birth_date: "2020-05-19", identifiers: ["MICRO-9812"], data_class: "D3", status: "ACTIVE", merged_into_id: null, status_changed_at: null, created_at: "2026-01-01T00:00:00.000Z", guardian_display_name: "Marina Souza", guardian_phone: "+55 11 98888-1200" }] };
      if (sql.startsWith("select a.id::text")) return { rows: [{ id: "00000000-0000-4000-0000-000000000151", organization_id: "00000000-0000-4000-0000-000000000010", unit_id: "00000000-0000-4000-0000-000000000011", workspace_id: "00000000-0000-4000-0000-000000000021", patient_id: "00000000-0000-4000-0000-000000000111", provider_id: "00000000-0000-4000-0000-000000000121", resource_id: null, service_id: "00000000-0000-4000-0000-000000000131", starts_at: "2026-01-01T10:00:00.000Z", ends_at: "2026-01-01T10:45:00.000Z", purpose: "Retorno", status: "CONFIRMED", version: 1, created_at: "2026-01-01T00:00:00.000Z", patient_name: "Luna", provider_name: "Dra. Ana Martins" }] };
      return { rows: [] };
    },
    release(): void { /* no-op fake */ }
  } as unknown as PoolClient;
  return { pool: { connect: async (): Promise<PoolClient> => client } as unknown as Pool, statements, scope };
}

test("Postgres persistence commits journal and snapshot atomically", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const audit = store.recordAudit({ organizationId: store.bootstrapCredentials.organizationId, actorId: store.bootstrapCredentials.userId, unitId: null, workspaceId: null, action: "test.command", resourceType: "Fixture", resourceId: null, result: "ALLOWED", reason: null, correlationId: "persistence-test", metadata: {} });
  const command = idempotent(store, { organizationId: store.bootstrapCredentials.organizationId, actorId: store.bootstrapCredentials.userId, operation: "test.command", key: "persistence-command", resourceId: null, unitId: null, workspaceId: null, body: { value: 1 } }, () => ({ ok: true }));
  command.receipt.auditRecordId = audit.id;
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  const snapshot = store.snapshot();
  const result = await persistence.commit({ ...commitInput(store), snapshot, auditRecords: snapshot.auditRecords, commandReceipts: snapshot.commandReceipts });
  assert.equal(result.revision, 1n);
  assert.equal(result.snapshotDigest, digest(JSON.parse(serializeSnapshot(store.snapshot()))));
  assert.ok(fake.statements.some((statement) => statement === "BEGIN"));
  assert.ok(fake.statements.some((statement) => statement.includes("order by cvg_state_snapshots.revision desc")));
  assert.ok(fake.statements.some((statement) => statement.includes("set_config('cvg.organization_id'")));
  assert.ok(fake.statements.some((statement) => statement.includes("where organization_id = cvg_request_organization()")));
  assert.ok(fake.statements.some((statement) => statement.includes("insert into cvg_event_journal")));
  assert.ok(fake.statements.some((statement) => statement.includes("insert into audit_records")));
  assert.ok(fake.statements.some((statement) => statement.includes("insert into command_receipts")));
  assert.ok(fake.statements.some((statement) => statement.includes("insert into cvg_audit_ledger")));
  assert.ok(fake.statements.some((statement) => statement.includes("insert into cvg_command_receipt_ledger")));
  assert.ok(fake.statements.some((statement) => statement.includes("insert into cvg_state_snapshots")));
  assert.ok(fake.statements.some((statement) => statement === "COMMIT"));
});

test("AI projections derive mandatory tenant scope from the persisted session", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const option = store.contextOptions(store.bootstrapCredentials.userId)[0];
  assert.ok(option);
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "ai.turn.SUMMARY", "ai-projection");
  new GovernedHarness(store).executeTurn(context, { sessionId: null, prompt: "resumir a fila", purpose: "SUMMARY", patientId: null, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: "ai-projection-1" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  await persistence.commit({ ...commitInput(store), snapshot: store.snapshot() });
  const turnStatement = fake.statements.find((statement) => statement.startsWith("insert into ai_turns"));
  assert.ok(turnStatement?.includes("organization_id, unit_id, workspace_id, session_id"));
});

test("normalized read repositories scope the transaction and preserve joined projections", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: [...store.units.values()][0]?.id ?? null, workspaceId: [...store.workspaces.values()][0]?.id ?? null }, "persistence.read", "persistence-read");
  const fake = normalizedReadPool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  const guardians = await persistence.listGuardians(context, "Marina");
  const patients = await persistence.listPatients(context, "Luna");
  const appointments = await persistence.listAppointments(context);

  assert.equal(fake.scope.organizationId, context.organizationId);
  assert.equal(guardians[0]?.displayName, "Marina Souza");
  assert.equal(patients[0]?.guardian?.displayName, "Marina Souza");
  assert.equal(appointments[0]?.patient?.name, "Luna");
  assert.ok(fake.statements.filter((statement) => statement === "BEGIN READ ONLY").length === 3);
  assert.ok(fake.statements.filter((statement) => statement === "COMMIT").length === 3);
  assert.ok(fake.statements.some((statement) => statement.includes("p.organization_id = cvg_request_organization()")));
  assert.ok(fake.statements.some((statement) => statement.includes("a.workspace_id = $2::uuid")));
});

test("Postgres persistence rolls back a failed projection and rejects stale writers", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const failing = fakePool({ failSnapshotInsert: true });
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: failing.pool });
  await assert.rejects(() => persistence.commit(commitInput(store)), (error: unknown) => error instanceof PersistenceUnavailableError);
  assert.ok(failing.statements.some((statement) => statement === "ROLLBACK"));

  const stale = fakePool({ revision: "4" });
  const stalePersistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: stale.pool });
  await assert.rejects(() => stalePersistence.commit({ ...commitInput(store), expectedRevision: 3n }), (error: unknown) => error instanceof PersistenceConflictError && error.actualRevision === 4n);
  assert.ok(stale.statements.some((statement) => statement === "ROLLBACK"));
});

test("Postgres persistence preserves corruption signals instead of downgrading them to outage", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  store.recordAudit({ organizationId: store.bootstrapCredentials.organizationId, actorId: store.bootstrapCredentials.userId, unitId: null, workspaceId: null, action: "test.corruption", resourceType: "Fixture", resourceId: null, result: "ALLOWED", reason: null, correlationId: "persistence-corruption", metadata: {} });
  const corrupt = fakePool({ auditLedgerConflict: true });
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: corrupt.pool });
  await assert.rejects(() => persistence.commit({ ...commitInput(store), auditRecords: store.snapshot().auditRecords }), (error: unknown) => error instanceof Error && error.name === "PersistenceCorruptionError");
  assert.ok(corrupt.statements.some((statement) => statement === "ROLLBACK"));
});

test("recovery bundle encryption round-trips BigInt state and rejects tampering", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const snapshot = store.snapshot();
  const bundle = {
    revision: 7n,
    snapshot,
    snapshotDigest: digest(JSON.parse(serializeSnapshot(snapshot))),
    eventId: randomUUID(),
    outboxRecords: [],
    usageRecords: [],
    inboxRecords: [],
    externalEffects: []
  };
  const key = randomBytes(32);
  const encrypted = encryptRecoveryBundle(bundle, key, "synthetic-kms-key");
  assert.equal(encrypted.algorithm, "AES-256-GCM");
  assert.doesNotMatch(JSON.stringify(encrypted), /Marina Souza/);
  const restored = decryptRecoveryBundle(encrypted, key);
  assert.equal(restored.revision, 7n);
  assert.equal(restored.eventId, bundle.eventId);
  assert.equal(serializeSnapshot(restored.snapshot), serializeSnapshot(snapshot));

  const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
  ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
  assert.throws(() => decryptRecoveryBundle({ ...encrypted, ciphertext: ciphertext.toString("base64") }, key), (error: unknown) => error instanceof PersistenceCorruptionError);
  assert.throws(() => decryptRecoveryBundle(encrypted, randomBytes(32)), (error: unknown) => error instanceof PersistenceCorruptionError);
  assert.throws(() => encryptRecoveryBundle(bundle, randomBytes(31), "synthetic-kms-key"), (error: unknown) => error instanceof Error && error.name === "PersistenceStateError");
});

test("PostgreSQL runtime wires bootstrap and HTTP mutations through the durable boundary", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  const runtime = await createRuntime({ store, persistence, config: { storageMode: "postgres", demoMode: true } });
  assert.equal(runtime.store.storageMode, "postgres");
  const result = await runtime.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { "content-type": "application/json" }, payload: JSON.stringify({ login: "admin@cvg.local", password: "synthetic-password-123" }) });
  assert.equal(result.statusCode, 200);
  assert.ok(fake.statements.filter((statement) => statement === "COMMIT").length >= 2);
  assert.ok(fake.statements.some((statement) => statement.includes("insert into cvg_event_journal")));
  await runtime.app.close();
});
