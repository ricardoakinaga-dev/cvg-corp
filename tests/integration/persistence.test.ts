import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { id } from "@cvg/contracts";
import { CvgStore, digest, idempotent, serializeSnapshot } from "@cvg/domain";
import { GovernedHarness } from "@cvg/harness";
import { MockHarnessAdapter } from "@cvg/harness-adapters";
import { createRuntime } from "@cvg/api";
import { AgentApplicationService } from "../../apps/api/src/application/agent-service.ts";
import { ExportApplicationService } from "../../apps/api/src/application/export-service.ts";
import { createRecoveryBundleManifest, decryptRecoveryBundle, encryptRecoveryBundle, OutboxLeaseLostError, PersistenceConflictError, PersistenceCorruptionError, PersistenceStateError, PersistenceUnavailableError, PostgresPersistence, validateRecoveryBundle, type DurableRecoveryBundle } from "@cvg/persistence";

type QueryResult = { rows: Array<Record<string, unknown>> };

function fakePool(options: { revision?: string; failSnapshotInsert?: boolean; auditLedgerConflict?: boolean } = {}): { pool: Pool; statements: string[] } {
  let revision = options.revision ?? "0";
  const statements: string[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
      statements.push(sql.trim().replace(/\s+/g, " "));
      if (sql.includes("select revision::text")) return { rows: revision === "0" ? [] : [{ revision }] };
      if (sql.startsWith("insert into ai_usage_ledger")) return { rows: [{ id: String(params[0]) }] };
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
      if (sql.includes("to_regclass('public.cvg_state_snapshots')")) return { rows: [{ snapshots: true, journal: true, audit: true, receipts: true, communications: true, outbox: true, usage_ledger: true, inbox: true, external_effects: true, rate_limit_buckets: true, runtime_role: true, runtime_scope_guards: true, auth_security: true, ai_turn_scope: true, ai_draft_scope: true, ai_turn_provenance_usage: true, audit_tamper_evident_chain: true, append_only_audit_guard: true, append_only_lock_privileges: true }] };
      if (sql.includes("as snapshot_scope_revision")) return { rows: [{ snapshot_scope_revision: true }] };
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

test("Postgres persistence fails closed when a contextual projection loses its scope", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const snapshot = store.snapshot();
  snapshot.guardians[0]!.unitId = null;
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await assert.rejects(
    () => persistence.commit({ ...commitInput(store), snapshot }),
    (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("complete unit/workspace scope")
  );
  assert.ok(fake.statements.some((statement) => statement === "ROLLBACK"));
});

test("AI projections derive mandatory tenant scope from the persisted session", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const option = store.contextOptions(store.bootstrapCredentials.userId)[0];
  assert.ok(option);
  const session = store.createSession(store.bootstrapCredentials.userId, digest("ai-projection-token"), "synthetic-csrf", 60);
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "ai.turn.SUMMARY", "ai-projection", null, null, session.id);
  const service = new AgentApplicationService(store, new MockHarnessAdapter(new GovernedHarness(store)));
  const input = { sessionId: null, prompt: "resumir a fila", purpose: "SUMMARY" as const, patientId: null, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: "ai-projection-1" };
  const first = await service.executeTurn(context, input);
  const replay = await service.executeTurn(context, input);
  assert.equal(replay.replayed, true);
  assert.equal(first.value.turn.provenance?.usageRecordId, first.value.turn.usage?.id);
  assert.equal(first.value.turn.provenance?.referencesDigest, digest(first.value.turn.references));
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  await persistence.commit({ ...commitInput(store), snapshot: store.snapshot() });
  const turnStatement = fake.statements.find((statement) => statement.startsWith("insert into ai_turns"));
  assert.ok(turnStatement?.includes("organization_id, unit_id, workspace_id, session_id"));
  assert.ok(turnStatement?.includes("usage_record_id, provenance_json"));
  assert.ok(fake.statements.some((statement) => statement.startsWith("insert into ai_usage_ledger")));
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

test("outbox failure cannot mutate an expired lease", async () => {
  const statements: string[] = [];
  const client = {
    async query(sql: string): Promise<QueryResult> {
      statements.push(sql.trim().replace(/\s+/g, " "));
      return { rows: [] };
    },
    release(): void { /* no-op fake */ }
  } as unknown as PoolClient;
  const pool = { connect: async (): Promise<PoolClient> => client } as unknown as Pool;
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool });
  await assert.rejects(
    () => persistence.failOutbox(id("00000000-0000-4000-0000-000000000010"), id("00000000-0000-4000-0000-000000000905"), "worker-a", 7n, "expired lease"),
    (error: unknown) => error instanceof OutboxLeaseLostError
  );
  assert.ok(statements.some((statement) => statement.includes("and lease_until > now() returning status")));
  assert.ok(statements.includes("ROLLBACK"));
});

test("recovery bundle encryption round-trips BigInt state and rejects tampering", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const snapshot = store.snapshot();
  const recoveryData = {
    revision: 7n,
    snapshot,
    snapshotDigest: digest(JSON.parse(serializeSnapshot(snapshot))),
    eventId: randomUUID(),
    outboxRecords: [],
    usageRecords: [],
    inboxRecords: [],
    externalEffects: []
  };
  const bundle: DurableRecoveryBundle = {
    ...recoveryData,
    manifest: createRecoveryBundleManifest({ organizationId: store.bootstrapCredentials.organizationId, ...recoveryData, migrationFingerprint: digest([{ version: "020_auth_security_boundary", checksum: "synthetic-checksum" }]) })
  };
  const key = randomBytes(32);
  const encrypted = encryptRecoveryBundle(bundle, key, "synthetic-kms-key");
  assert.equal(encrypted.algorithm, "AES-256-GCM");
  assert.doesNotMatch(JSON.stringify(encrypted), /Marina Souza/);
  const restored = decryptRecoveryBundle(encrypted, key);
  assert.equal(restored.revision, 7n);
  assert.equal(restored.eventId, bundle.eventId);
  assert.equal(restored.manifest.watermark.revision, "7");
  assert.equal(restored.manifest.organizationId, store.bootstrapCredentials.organizationId);
  assert.equal(serializeSnapshot(restored.snapshot), serializeSnapshot(snapshot));

  const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
  ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
  assert.throws(() => decryptRecoveryBundle({ ...encrypted, ciphertext: ciphertext.toString("base64") }, key), (error: unknown) => error instanceof PersistenceCorruptionError);
  assert.throws(() => decryptRecoveryBundle(encrypted, randomBytes(32)), (error: unknown) => error instanceof PersistenceCorruptionError);
  assert.throws(() => encryptRecoveryBundle(bundle, randomBytes(31), "synthetic-kms-key"), (error: unknown) => error instanceof Error && error.name === "PersistenceStateError");
});

test("governed export binds policy, secret resolution and idempotent encrypted delivery", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const option = store.contextOptions(store.bootstrapCredentials.userId)[0];
  assert.ok(option);
  const session = store.createSession(store.bootstrapCredentials.userId, digest("export-token"), "synthetic-csrf", 60);
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "ops.export", "export-test", null, null, session.id);
  const snapshot = store.snapshot();
  const recoveryData = { revision: 9n, snapshot, snapshotDigest: digest(JSON.parse(serializeSnapshot(snapshot))), eventId: randomUUID(), outboxRecords: [], usageRecords: [], inboxRecords: [], externalEffects: [] };
  const bundle: DurableRecoveryBundle = { ...recoveryData, manifest: createRecoveryBundleManifest({ organizationId: store.bootstrapCredentials.organizationId, ...recoveryData, migrationFingerprint: digest([{ version: "029_ai_turn_provenance_usage_and_dml_scope", checksum: "synthetic-checksum" }]) }) };
  const persistence = { exportRecoveryBundle: async () => bundle } as unknown as PostgresPersistence;
  const key = randomBytes(32).toString("base64");
  const secretProvider = { status: () => "READY" as const, has: (reference: string) => reference === "synthetic-export-key", resolve: async (reference: string) => reference === "synthetic-export-key" ? key : null };
  const service = new ExportApplicationService(store, persistence, secretProvider, "synthetic-export-key");
  const first = await service.create(context, { purpose: "incident recovery validation", ttlSeconds: 300 }, "export-idempotency-1");
  const replay = await service.create(context, { purpose: "incident recovery validation", ttlSeconds: 300 }, "export-idempotency-1");
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.value.envelope.ciphertext, first.value.envelope.ciphertext);
  assert.doesNotMatch(JSON.stringify(first.value.envelope), /Marina Souza/);
  assert.equal(first.value.scope.organizationId, store.bootstrapCredentials.organizationId);
});

test("recovery manifest rejects partial, stale, and migration-incompatible restores", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const snapshot = store.snapshot();
  const recoveryData = {
    revision: 7n,
    snapshot,
    snapshotDigest: digest(JSON.parse(serializeSnapshot(snapshot))),
    eventId: randomUUID(),
    outboxRecords: [],
    usageRecords: [],
    inboxRecords: [],
    externalEffects: []
  };
  const migrationFingerprint = digest([{ version: "020_auth_security_boundary", checksum: "synthetic-checksum" }]);
  const bundle: DurableRecoveryBundle = {
    ...recoveryData,
    manifest: createRecoveryBundleManifest({ organizationId: store.bootstrapCredentials.organizationId, ...recoveryData, migrationFingerprint, createdAt: "2026-09-09T00:00:00.000Z" })
  };
  assert.doesNotThrow(() => validateRecoveryBundle(bundle, { expectedMigrationFingerprint: migrationFingerprint, minimumRevision: 7n, maxAgeMs: 86_400_000, now: "2026-09-09T12:00:00.000Z" }));

  const partial = { ...bundle, inboxRecords: undefined } as unknown as DurableRecoveryBundle;
  assert.throws(() => validateRecoveryBundle(partial), (error: unknown) => error instanceof PersistenceCorruptionError);
  assert.throws(() => validateRecoveryBundle(bundle, { minimumRevision: 8n }), (error: unknown) => error instanceof PersistenceStateError && error.message.includes("stale"));
  assert.throws(() => validateRecoveryBundle(bundle, { maxAgeMs: 60_000, now: "2026-09-09T12:00:00.000Z" }), (error: unknown) => error instanceof PersistenceStateError && error.message.includes("stale"));
  assert.throws(() => validateRecoveryBundle(bundle, { expectedMigrationFingerprint: digest([{ version: "021_future", checksum: "different" }]) }), (error: unknown) => error instanceof PersistenceStateError && error.message.includes("migration fingerprint"));

  const mismatchedWatermark = { ...bundle, manifest: { ...bundle.manifest, watermark: { ...bundle.manifest.watermark, revision: "6" } } };
  assert.throws(() => validateRecoveryBundle(mismatchedWatermark), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("watermark"));
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
