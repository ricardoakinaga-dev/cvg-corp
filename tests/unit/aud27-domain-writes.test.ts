import test from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { CvgStore, digest, makeId } from "@cvg/domain";
import type { OpaqueId, Product } from "@cvg/contracts";
import { AUD27_SNAPSHOT_PRIMARY_KEYS, buildAud27NormalizedWritePlan, PersistenceProductSkuConflictError } from "@cvg/persistence";
import { aud27RemovalScope, orderAud27Removals } from "../../packages/persistence/src/aud27-removals.ts";
import { isEarlyAud27SnapshotKey, validateAud27NormalizedWrites } from "../../packages/persistence/src/aud27-domain-writes.ts";
import { listAppointments, listGuardians, listPatients, listQueue, type NormalizedEarlyReadDependencies } from "../../packages/persistence/src/normalized-early-reads.ts";
import { OperationalBackupJobCore, type OperationalBackupJobDependencies } from "../../packages/persistence/src/operational-backup-job.ts";
import { projectAiRows, type AiProjectionDependencies } from "../../packages/persistence/src/ai-projection.ts";
import { aiUsageDigest, projectAiTurnUsage } from "../../packages/persistence/src/ai-usage-projection.ts";
import { assertAuthoritativeWriteReplayExclusive, writeAuthoritativeAppointment, writeAuthoritativeClinicalDocument, writeAuthoritativeDiagnosticRequest, writeAuthoritativeDiagnosticResult, writeAuthoritativeEncounter, writeAuthoritativeGuardian, writeAuthoritativePatient, writeAuthoritativeSpecimen } from "../../packages/persistence/src/authoritative-writes.ts";
import { listAuthoritativeProducts, writeAuthoritativeProduct, type StockProductReadDependencies } from "../../packages/persistence/src/stock-product-persistence.ts";
import { CVG_LATEST_MIGRATION, CVG_REQUIRED_MIGRATION_MARKERS, CVG_RESTORE_AUTHORITY_ROLE } from "../../packages/persistence/src/index.ts";

function snapshots(): { before: ReturnType<CvgStore["snapshot"]>; after: ReturnType<CvgStore["snapshot"]> } {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  return { before: store.snapshot(), after: store.snapshot() };
}

test("persistence control constants keep the restore authority and latest migration marker explicit", () => {
  assert.equal(CVG_RESTORE_AUTHORITY_ROLE, "cvg_restore_authority");
  assert.equal(CVG_REQUIRED_MIGRATION_MARKERS.at(-1), CVG_LATEST_MIGRATION);
  assert.equal(CVG_REQUIRED_MIGRATION_MARKERS.length, 12);
});

test("authoritative writer seam preserves scoped writes and fail-closed conflicts", async () => {
  const id = makeId();
  const scoped = { id, organizationId: id, unitId: id, workspaceId: id };
  const encounter = scoped as never;
  const dependencies = { corruption: (message: string) => new Error(message) };
  const client = { query: async () => ({ rows: [{ id }] }) } as unknown as PoolClient;
  const conflictClient = { query: async () => ({ rows: [] }) } as unknown as PoolClient;

  await writeAuthoritativePatient(client, scoped as never, dependencies);
  await writeAuthoritativeAppointment(client, scoped as never, dependencies);
  await writeAuthoritativeEncounter(client, encounter, dependencies);
  await writeAuthoritativeClinicalDocument(client, { ...scoped, status: "SIGNED", version: 2, signedAt: "2026-09-22T00:00:00.000Z", signedBy: id } as never, encounter, dependencies);
  await writeAuthoritativeGuardian(client, scoped as never, dependencies);
  await writeAuthoritativeDiagnosticRequest(client, scoped as never, encounter, dependencies);
  await writeAuthoritativeSpecimen(client, scoped as never, encounter, dependencies);
  await writeAuthoritativeDiagnosticResult(client, scoped as never, encounter, dependencies);

  await assert.rejects(() => writeAuthoritativePatient(conflictClient, scoped as never, dependencies), /conflicts/);
  await assert.rejects(() => writeAuthoritativeAppointment(conflictClient, scoped as never, dependencies), /conflicts/);
  await assert.rejects(() => writeAuthoritativeEncounter(conflictClient, encounter, dependencies), /conflicts/);
  await assert.rejects(() => writeAuthoritativeClinicalDocument(conflictClient, { ...scoped, status: "SIGNED", version: 2, signedAt: "2026-09-22T00:00:00.000Z", signedBy: id } as never, encounter, dependencies), /conflicts/);
  await assert.rejects(() => writeAuthoritativeGuardian(conflictClient, scoped as never, dependencies), /conflicts/);
  await assert.rejects(() => writeAuthoritativeDiagnosticRequest(conflictClient, scoped as never, encounter, dependencies), /conflicts/);
  await assert.rejects(() => writeAuthoritativeSpecimen(conflictClient, scoped as never, encounter, dependencies), /conflicts/);
  await assert.rejects(() => writeAuthoritativeDiagnosticResult(conflictClient, scoped as never, encounter, dependencies), /conflicts/);

  const missingScope = { ...scoped, unitId: null };
  await assert.rejects(() => writeAuthoritativePatient(client, missingScope as never, dependencies), /no complete/);
  await assert.rejects(() => writeAuthoritativeAppointment(client, missingScope as never, dependencies), /no complete/);
  await assert.rejects(() => writeAuthoritativeEncounter(client, missingScope as never, dependencies), /no complete/);
  await assert.rejects(() => writeAuthoritativeClinicalDocument(client, { ...missingScope, status: "SIGNED", version: 2, signedAt: "2026-09-22T00:00:00.000Z", signedBy: id } as never, missingScope as never, dependencies), /no complete/);
  await assert.rejects(() => writeAuthoritativeGuardian(client, missingScope as never, dependencies), /no complete/);
  await assert.rejects(() => writeAuthoritativeDiagnosticRequest(client, missingScope as never, missingScope as never, dependencies), /no complete/);
  await assert.rejects(() => writeAuthoritativeSpecimen(client, missingScope as never, missingScope as never, dependencies), /no complete/);
  await assert.rejects(() => writeAuthoritativeDiagnosticResult(client, missingScope as never, missingScope as never, dependencies), /no complete/);
  assert.doesNotThrow(() => assertAuthoritativeWriteReplayExclusive(null, null, "guardian", dependencies));
  assert.throws(() => assertAuthoritativeWriteReplayExclusive(scoped, id, "guardian", dependencies), /write and replay/);
});

test("stock product catalog reads organization-scoped rows, including products without lots, and fails closed outside scope", async () => {
  const organizationId = makeId();
  const productId = makeId();
  const row = { id: productId, organization_id: organizationId, sku: "SKU-NOLOT-1", name: "Produto sem lote", category: "INSUMO", unit: "unidade", reorder_point: 4, status: "ACTIVE" };
  const reads: Array<{ operation: string; sql: string }> = [];
  const dependencies = (rows: unknown[]): StockProductReadDependencies => ({
    scopedRead: async (_context, operation, callback) => callback({
      async query(sql: string) {
        reads.push({ operation, sql });
        return { rows };
      }
    } as unknown as PoolClient),
    id: (value) => value as OpaqueId,
    text: (value, field) => { if (typeof value !== "string" || !value) throw new Error(`invalid ${field}`); return value; },
    integer: (value, field) => { if (!Number.isInteger(value)) throw new Error(`invalid ${field}`); return value as number; },
    enum: (value, allowed, field) => { if (!allowed.includes(value as never)) throw new Error(`invalid ${field}`); return value as never; },
    corruption: (message) => new Error(message)
  });
  const context = { organizationId } as Parameters<typeof listAuthoritativeProducts>[1];

  const products = await listAuthoritativeProducts(dependencies([row]), context);
  assert.deepEqual(products, [{ id: productId, organizationId, sku: "SKU-NOLOT-1", name: "Produto sem lote", category: "INSUMO", unit: "unidade", reorderPoint: 4, status: "ACTIVE" }]);
  assert.equal(reads[0]!.operation, "stock");
  assert.match(reads[0]!.sql, /from products where organization_id = cvg_request_organization\(\)/);
  assert.doesNotMatch(reads[0]!.sql, /lots/);
  await assert.rejects(() => listAuthoritativeProducts(dependencies([{ ...row, organization_id: makeId() }]), context), /outside the requested organization/);
  await assert.rejects(() => listAuthoritativeProducts(dependencies([{ ...row, status: "DELETED" }]), context), /invalid product.status/);
  await assert.rejects(() => listAuthoritativeProducts(dependencies([{ ...row, reorder_point: 1.5 }]), context), /invalid product.reorder_point/);
});

test("stock product writer uses organization scope and fails closed on conflicting row identity", async () => {
  const id = makeId();
  const product: Product = { id, organizationId: id, sku: "SKU-AUTH-1", name: "Produto sintético", category: "INSUMO", unit: "unidade", reorderPoint: 0, status: "ACTIVE" };
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      return { rows: [{ id }] };
    }
  } as unknown as PoolClient;
  const dependencies = { corruption: (message: string) => new Error(message) };

  await writeAuthoritativeProduct(client, product, dependencies);

  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /insert into products\(id, organization_id, sku/);
  assert.match(calls[0]!.sql, /where products\.organization_id = excluded\.organization_id/);
  assert.match(calls[0]!.sql, /returning id::text/);
  assert.equal(calls[0]!.params[1], product.organizationId);
  assert.equal(calls[0]!.params.includes("unit_id"), false);
  const conflictingClient = { query: async () => ({ rows: [] }) } as unknown as PoolClient;
  await assert.rejects(() => writeAuthoritativeProduct(conflictingClient, product, dependencies), /conflicts with an existing normalized row/);
  const skuConflictClient = {
    async query() {
      throw Object.assign(new Error("duplicate key"), { code: "23505", constraint: "products_organization_id_sku_key" });
    }
  } as unknown as PoolClient;
  await assert.rejects(() => writeAuthoritativeProduct(skuConflictClient, product, dependencies), PersistenceProductSkuConflictError);
});

test("normalized early read seam preserves null joins and optional scope branches", async () => {
  const organizationId = makeId();
  const rowId = makeId();
  const client = {
    async query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }> {
      if (sql.includes("from guardians g")) return { rows: [{ id: rowId, unit_id: null, workspace_id: null, display_name: "Guardião", phone: "telefone", email: null, data_class: "D2", status: "ACTIVE" }] };
      if (sql.includes("from patients p")) return { rows: [{ id: rowId, unit_id: null, workspace_id: null, guardian_id: rowId, name: "Paciente", species: "Canina", breed: null, sex: "UNKNOWN", reproductive_status: "UNKNOWN", birth_date: null, identifiers: [], data_class: "D3", status: "ACTIVE", merged_into_id: null, status_changed_at: null, created_at: "2026-09-22T00:00:00.000Z", guardian_display_name: null, guardian_phone: null }] };
      if (sql.includes("from appointments a")) return { rows: [{ id: rowId, organization_id: organizationId, unit_id: rowId, workspace_id: rowId, patient_id: rowId, provider_id: rowId, resource_id: null, service_id: rowId, starts_at: "2026-09-22T10:00:00.000Z", ends_at: "2026-09-22T10:45:00.000Z", purpose: "leitura", status: "SCHEDULED", version: 1, created_at: "2026-09-22T00:00:00.000Z", patient_name: null, provider_name: null }] };
      return { rows: [{ id: rowId, organization_id: organizationId, unit_id: rowId, appointment_id: null, patient_id: rowId, status: "WAITING", priority: "ROUTINE", checked_in_at: "2026-09-22T09:00:00.000Z", appointment_workspace_id: null, patient_name: null }] };
    }
  } as never;
  const dependencies: NormalizedEarlyReadDependencies = {
    scopedRead: async (_context, _operation, callback) => callback(client),
    id: (value) => value as OpaqueId,
    text: (value) => String(value),
    timestamp: (value) => value instanceof Date ? value.toISOString() : String(value),
    nullableTimestamp: (value) => value === null ? null : value instanceof Date ? value.toISOString() : String(value),
    stringArray: (value) => [...(value as string[])],
    enum: (value) => value as never,
    corruption: (message) => new Error(message)
  };
  const context = { organizationId, actorId: rowId, unitId: null, workspaceId: null } as never;
  assert.equal((await listGuardians(dependencies, context))[0]?.unitId, null);
  assert.equal((await listPatients(dependencies, context))[0]?.guardian, null);
  assert.equal((await listAppointments(dependencies, context))[0]?.resourceId, null);
  assert.equal((await listQueue(dependencies, context))[0]?.appointmentId, null);
});

test("operational backup job seam preserves lifecycle state and injected failure boundaries", async () => {
  const dependencies: OperationalBackupJobDependencies = {
    write: async () => ({ path: "synthetic", manifest: {} as never, removed: [] }),
    verify: async () => ({ verified: [], removed: [] }),
    now: () => "2026-09-22T00:00:00.000Z",
    stateError: (message) => new Error(message),
    unavailableError: (message) => new Error(message)
  };
  const options = { directory: "synthetic", keyRef: "synthetic-key", intervalMs: 10_000, createBundle: async () => ({}) as never, resolveKey: async () => new Uint8Array([1]) };
  const job = new OperationalBackupJobCore(options as never, dependencies);
  const run = await job.runOnce();
  assert.equal(run.observedAt, "2026-09-22T00:00:00.000Z");
  job.start({ runImmediately: false });
  assert.equal(job.status().running, true);
  await job.stop();
  assert.equal(job.status().running, false);
  assert.throws(() => new OperationalBackupJobCore({ ...options, intervalMs: 0 } as never, dependencies), /interval/);

  let failureCallbacks = 0;
  const failing = new OperationalBackupJobCore({
    ...options,
    resolveKey: async () => null,
    onFailure: () => { failureCallbacks += 1; }
  } as never, dependencies);
  failing.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await failing.stop();
  assert.equal(failureCallbacks, 1);
  assert.match(failing.status().lastFailure ?? "", /unavailable/);
});

test("AUD27 normalized write plan is content-bound, ordered and limited to changed residual rows", () => {
  const { before, after } = snapshots();
  const service = after.services[0];
  const product = after.products[0];
  assert.ok(service);
  assert.ok(product);
  after.services[0] = { ...service, name: `${service.name} atualizado` };
  after.products[0] = { ...product, name: `${product.name} atualizado` };

  const plan = buildAud27NormalizedWritePlan(before, after);
  assert.deepEqual(plan.removed, []);
  assert.deepEqual(plan.writes.map((write) => `${write.snapshotKey}:${write.record.id}`), [
    `services:${service.id}`,
    `products:${product.id}`
  ]);
  assert.equal(plan.writes.find((write) => write.snapshotKey === "services")?.record.name, `${service.name} atualizado`);
  const serviceWrite = plan.writes.find((write) => write.snapshotKey === "services");
  assert.ok(serviceWrite);
  const normalizedIds = validateAud27NormalizedWrites(after, [serviceWrite], (message) => new Error(message));
  assert.equal(normalizedIds.get("services")?.has(service.id), true);
  assert.throws(() => validateAud27NormalizedWrites(after, [serviceWrite, serviceWrite], (message) => new Error(message)), /duplicate AUD27 normalized write services/);
  assert.throws(() => validateAud27NormalizedWrites(after, [{ ...serviceWrite, record: { ...serviceWrite.record, name: "divergente" } }], (message) => new Error(message)), /not identical/);
  assert.equal(isEarlyAud27SnapshotKey("services"), true);
  assert.equal(isEarlyAud27SnapshotKey("aiApprovals"), false);
});

test("AUD27 normalized write plan reports deletion instead of silently treating it as an upsert", () => {
  const { before, after } = snapshots();
  const product = after.products[0];
  assert.ok(product);
  after.products = after.products.filter((row) => row.id !== product.id);

  const plan = buildAud27NormalizedWritePlan(before, after);
  assert.deepEqual(plan.writes, []);
  assert.deepEqual(plan.removed, [{ snapshotKey: "products", id: product.id, organizationId: product.organizationId, unitId: null, workspaceId: null }]);
});

test("AUD27 removal scope derives tenant and RLS scope from direct and parent-owned rows", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const before = store.snapshot();
  const veterinarian = [...store.users.values()].find((user) => user.login.startsWith("ana."));
  assert.ok(veterinarian);
  const option = store.contextOptions(veterinarian.id)[0];
  assert.ok(option);
  const context = store.resolveContext(veterinarian.id, { unitId: option.unit.id, workspaceId: option.workspace.id }, "aud27.removal-scope", "aud27-removal-scope");
  const patient = before.patients.find((candidate) => candidate.unitId === context.unitId && candidate.workspaceId === context.workspaceId);
  assert.ok(patient);
  const encounter = store.createEncounter(context, { patientId: patient.id, appointmentId: null, chiefComplaint: "remoção", urgency: "ROUTINE" });
  const document = store.createClinicalDocument(context, { encounterId: encounter.id, documentType: "EVOLUTION", title: "remoção", content: "conteúdo", dataClass: "D3" });
  store.reviewClinicalDocument(context, document.id, null);
  store.signClinicalDocument(context, document.id, null);
  const addendum = store.addClinicalAddendum(context, document.id, "remoção", "conteúdo");
  const snapshot = store.snapshot();
  const session = {
    id: makeId(), organizationId: context.organizationId, actorId: veterinarian.id, unitId: context.unitId, workspaceId: context.workspaceId,
    patientId: patient.id, encounterId: encounter.id, purpose: "SUMMARY" as const, engineCommit: "removal-scope", profileDigest: digest("removal-scope"), status: "ACTIVE" as const, createdAt: "2026-09-22T00:00:00.000Z"
  };
  const turn = { id: makeId(), sessionId: session.id, prompt: "p", response: "r", status: "COMPLETED" as const, model: "synthetic", inputTokens: 1, outputTokens: 1, references: [], createdAt: "2026-09-22T00:00:01.000Z" };
  const draft = { id: makeId(), sessionId: session.id, encounterId: encounter.id, draftType: "SUMMARY" as const, content: "d", sourceTurnId: turn.id, status: "DRAFT" as const, createdAt: "2026-09-22T00:00:02.000Z" };
  snapshot.aiSessions.push(session);
  snapshot.aiTurns.push(turn);
  snapshot.aiDrafts.push(draft);
  assert.deepEqual(aud27RemovalScope(snapshot, "products", snapshot.products[0]!.id), { organizationId: snapshot.products[0]!.organizationId, unitId: null, workspaceId: null });
  assert.deepEqual(aud27RemovalScope(snapshot, "clinicalAddenda", addendum.id), { organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId });
  assert.deepEqual(aud27RemovalScope(snapshot, "aiTurns", turn.id), { organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId });
  assert.deepEqual(aud27RemovalScope(snapshot, "aiDrafts", draft.id), { organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId });
  assert.deepEqual(orderAud27Removals([
    { snapshotKey: "providers", id: makeId(), organizationId: context.organizationId, unitId: null, workspaceId: null },
    { snapshotKey: "aiApprovals", id: makeId(), organizationId: context.organizationId, unitId: null, workspaceId: null }
  ]).map((removal) => removal.snapshotKey), ["aiApprovals", "providers"]);
  assert.throws(() => aud27RemovalScope(snapshot, "products", makeId()), /no organization scope/);
});

test("AUD27 normalized write inventory covers exactly the 24 residual snapshot collections", () => {
  assert.equal(AUD27_SNAPSHOT_PRIMARY_KEYS.length, 24);
  assert.equal(new Set(AUD27_SNAPSHOT_PRIMARY_KEYS).size, 24);
  assert.ok(AUD27_SNAPSHOT_PRIMARY_KEYS.includes("aiTurns"));
  assert.ok(AUD27_SNAPSHOT_PRIMARY_KEYS.includes("budgetReservations"));
});

test("AI projection seam writes session-linked turns and drafts with derived scope", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const snapshot = store.snapshot();
  const organization = snapshot.organizations[0];
  const unit = snapshot.units[0];
  const workspace = snapshot.workspaces[0];
  const actor = snapshot.users[0];
  assert.ok(organization);
  assert.ok(unit);
  assert.ok(workspace);
  assert.ok(actor);

  const session = {
    id: makeId(), organizationId: organization.id, actorId: actor.id, unitId: unit.id, workspaceId: workspace.id,
    patientId: null, encounterId: null, purpose: "SUMMARY" as const, engineCommit: "ai-seam-test", profileDigest: digest("ai-seam-profile"), status: "ACTIVE" as const, createdAt: "2026-09-22T00:00:00.000Z"
  };
  const turn = {
    id: makeId(), sessionId: session.id, prompt: "resumo", response: "resposta", status: "COMPLETED" as const, model: "synthetic", inputTokens: 1, outputTokens: 1, references: [], createdAt: "2026-09-22T00:00:01.000Z"
  };
  const draft = {
    id: makeId(), sessionId: session.id, encounterId: null, draftType: "SUMMARY" as const, content: "rascunho", sourceTurnId: turn.id, status: "DRAFT" as const, createdAt: "2026-09-22T00:00:02.000Z"
  };
  const approval = {
    id: makeId(), organizationId: organization.id, actorId: actor.id, sessionId: session.id, turnId: turn.id, toolName: "patients.read", resourceId: null,
    patientId: null, encounterId: null, unitId: unit.id, workspaceId: workspace.id, purpose: "SUMMARY" as const, requestDigest: digest("ai-seam-request"), policyRevision: "1",
    expiresAt: "2099-01-01T00:00:00.000Z", decision: "rejected" as const, decidedBy: null, reason: null, createdAt: "2026-09-22T00:00:03.000Z"
  };
  const reservation = {
    id: makeId(), organizationId: organization.id, sessionId: session.id, category: "TOKENS" as const, reservedUnits: 10, consumedUnits: 0, status: "RESERVED" as const, createdAt: "2026-09-22T00:00:04.000Z"
  };
  const projected = { ...snapshot, aiSessions: [session], aiTurns: [turn], aiDrafts: [draft], aiApprovals: [approval], budgetReservations: [reservation] };
  const statements: string[] = [];
  const writeRows = async <T>(_client: PoolClient, sql: string, rows: T[], values: (row: T) => unknown[]): Promise<void> => {
    for (const row of rows) statements.push(`${sql}:${JSON.stringify(values(row))}`);
  };
  const writeScopedRows = async <T>(_client: PoolClient, sql: string, rows: T[], scope: (row: T) => { unitId: OpaqueId | null; workspaceId: OpaqueId | null }, values: (row: T) => unknown[]): Promise<void> => {
    for (const row of rows) {
      const selected = scope(row);
      assert.equal(selected.unitId, unit.id);
      assert.equal(selected.workspaceId, workspace.id);
      statements.push(`${sql}:${JSON.stringify(values(row))}`);
    }
  };
  const dependencies: AiProjectionDependencies = {
    writeRows,
    writeScopedRows,
    corruption: (message) => new Error(message)
  };

  await projectAiRows(null as never, projected, projected.aiSessions, projected.budgetReservations, projected.aiTurns, projected.aiDrafts, projected.aiApprovals, dependencies);

  assert.equal(statements.length, 5);
  assert.ok(statements.some((statement) => statement.startsWith("insert into ai_sessions")));
  assert.ok(statements.some((statement) => statement.startsWith("insert into budget_reservations")));
  assert.ok(statements.some((statement) => statement.startsWith("insert into ai_turns")));
  assert.ok(statements.some((statement) => statement.startsWith("insert into ai_drafts")));
  assert.ok(statements.some((statement) => statement.startsWith("insert into ai_approvals")));
});

test("AI usage projection binds organization through the session and fails closed on provenance drift", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const snapshot = store.snapshot();
  const organization = snapshot.organizations[0];
  const actor = snapshot.users[0];
  assert.ok(organization);
  assert.ok(actor);
  const session = {
    id: makeId(), organizationId: organization.id, actorId: actor.id, unitId: null, workspaceId: null,
    patientId: null, encounterId: null, purpose: "SUMMARY" as const, engineCommit: "ai-usage-seam-test", profileDigest: digest("ai-usage-profile"), status: "ACTIVE" as const, createdAt: "2026-09-22T00:00:00.000Z"
  };
  const usage = {
    id: makeId(), reservationId: null, providerRequestId: "provider-usage-1", idempotencyKey: "ai-usage-seam-1", usageKind: "TOKENS",
    reservedUnits: 4, consumedUnits: 3, status: "SETTLED" as const, record: { source: "unit" }
  };
  const provenance = {
    provider: "synthetic", engineCommit: session.engineCommit, manifestVersion: session.profileDigest, profileDigest: session.profileDigest,
    policyRevision: "1", references: [], correlationId: "ai-usage-correlation", usageRecordId: usage.id
  };
  const turn = {
    id: makeId(), sessionId: session.id, prompt: "p", response: "r", status: "COMPLETED" as const, model: "synthetic", inputTokens: 1,
    outputTokens: 2, references: [], provenance, usage, createdAt: "2026-09-22T00:00:01.000Z"
  };
  const projected = { ...snapshot, aiSessions: [session], aiTurns: [turn] };
  const statements: Array<{ sql: string; params: readonly unknown[] }> = [];
  const client = {
    async query(sql: string, params: readonly unknown[] = []): Promise<{ rows: Array<{ id: string }> }> {
      statements.push({ sql, params });
      return { rows: [{ id: String(usage.id) }] };
    }
  } as unknown as PoolClient;
  const corruption = (message: string): Error => new Error(message);

  await projectAiTurnUsage(client, projected, corruption);
  assert.equal(statements.length, 1);
  assert.equal(statements[0]?.params[1], organization.id);
  assert.equal(statements[0]?.params[2], null);
  const digestInput = { organizationId: organization.id, ...usage, record: { ...usage.record, settlement: null } };
  assert.equal(aiUsageDigest(digestInput), aiUsageDigest({ ...digestInput, id: makeId() }));

  const { usage: _usage, provenance: _provenance, ...turnWithoutLinks } = turn;
  const { provenance: _missingProvenance, ...turnWithoutProvenance } = turn;
  await projectAiTurnUsage(client, { ...projected, aiTurns: [turnWithoutLinks] }, corruption);
  await assert.rejects(() => projectAiTurnUsage(client, { ...projected, aiTurns: [turnWithoutProvenance] }, corruption), /incomplete provenance\/usage pair/);
  await assert.rejects(() => projectAiTurnUsage(client, { ...projected, aiTurns: [{ ...turn, sessionId: makeId() }] }, corruption), /no resolvable session/);
  await assert.rejects(() => projectAiTurnUsage(client, { ...projected, aiTurns: [{ ...turn, provenance: { ...provenance, usageRecordId: makeId() } }] }, corruption), /does not bind/);

  const conflictingClient = { query: async (): Promise<{ rows: Array<{ id: string }> }> => ({ rows: [] }) } as unknown as PoolClient;
  await assert.rejects(() => projectAiTurnUsage(conflictingClient, projected, corruption), /conflicts with a different idempotency record/);
});
