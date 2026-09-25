import { randomUUID } from "node:crypto";
import { Client } from "pg";
import type { OpaqueId, Product } from "@cvg/contracts";
import { CvgStore, digest, makeId, type StoreSnapshot } from "@cvg/domain";
import { AUD27_SNAPSHOT_PRIMARY_KEYS, buildAud27NormalizedWritePlan, PersistenceCorruptionError, PersistenceProductSkuConflictError, PostgresPersistence, type Aud27NormalizedDomainWrite } from "@cvg/persistence";
import { assertAud27SnapshotCountParity, AUD27_NORMALIZED_TABLE_BY_KEY } from "./aud27-24-slice-parity.ts";

type Field = { select: string; alias: string; expected: unknown };
type ProjectionSpec = { table: string; fields: readonly Field[] };

const connectionString = process.env.CVG_AUD27_24_SLICES_URL?.trim() ?? "";
if (!connectionString) {
  process.stderr.write("AUD27_24_SLICES_BLOCKED provide CVG_AUD27_24_SLICES_URL explicitly; no database was contacted\n");
  process.exit(2);
}

const probe = new Client({ connectionString, connectionTimeoutMillis: 2_500, application_name: "cvg-aud27-24-slices-probe" });

function plain(column: string, expected: unknown, alias = column): Field {
  return { select: `${column} as ${alias}`, alias, expected };
}

function uuid(column: string, expected: string | null | undefined, alias = column): Field {
  return { select: `${column}::text as ${alias}`, alias, expected: expected ?? null };
}

function timestamp(column: string, expected: string | null | undefined, alias = column): Field {
  const select = expected === null || expected === undefined
    ? `case when ${column} is null then null else to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end as ${alias}`
    : `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ${alias}`;
  return { select, alias, expected: expected ?? null };
}

function date(column: string, expected: string, alias = column): Field {
  return { select: `${column}::text as ${alias}`, alias, expected };
}

function json(column: string, expected: unknown, alias = column): Field {
  return { select: `${column} as ${alias}`, alias, expected };
}

function projectionSpec(snapshot: StoreSnapshot, write: Aud27NormalizedDomainWrite): ProjectionSpec {
  switch (write.snapshotKey) {
    case "providers": {
      const row = write.record;
      return { table: "providers", fields: [uuid("id", row.id), uuid("organization_id", row.organizationId), uuid("unit_id", row.unitId), plain("display_name", row.displayName), plain("specialty", row.specialty), plain("role", row.role), plain("status", row.status)] };
    }
    case "services": {
      const row = write.record;
      return { table: "service_catalog_items", fields: [uuid("id", row.id), uuid("organization_id", row.organizationId), plain("name", row.name), plain("duration_minutes", row.durationMinutes), plain("price_cents", row.priceCents), plain("status", row.status)] };
    }
    case "resources": {
      const row = write.record;
      return { table: "resources", fields: [uuid("id", row.id), uuid("organization_id", row.organizationId), uuid("unit_id", row.unitId), plain("name", row.name), plain("kind", row.kind), plain("status", row.status)] };
    }
    case "queueEntries": {
      const row = write.record;
      return { table: "queue_entries", fields: [uuid("id", row.id), uuid("organization_id", row.organizationId), uuid("unit_id", row.unitId), uuid("appointment_id", row.appointmentId), uuid("patient_id", row.patientId), plain("status", row.status), plain("priority", row.priority), timestamp("checked_in_at", row.checkedInAt)] };
    }
    case "clinicalAddenda": {
      const row = write.record;
      const document = snapshot.clinicalDocuments.find((candidate) => candidate.id === row.documentId);
      const encounter = document ? snapshot.encounters.find((candidate) => candidate.id === document.encounterId) : null;
      if (!document || !encounter) throw new Error(`clinical addendum ${row.id} has no fixture scope`);
      return { table: "clinical_addenda", fields: [uuid("id", row.id), uuid("organization_id", document.organizationId), uuid("unit_id", encounter.unitId), uuid("workspace_id", encounter.workspaceId), uuid("document_id", row.documentId), uuid("author_id", row.authorId), plain("reason", row.reason), plain("content", row.content), timestamp("created_at", row.createdAt)] };
    }
    case "beds": {
      const row = write.record;
      return { table: "beds", fields: [uuid("id", row.id), uuid("organization_id", row.organizationId), uuid("unit_id", row.unitId), plain("name", row.name), plain("status", row.status)] };
    }
    case "hospitalEpisodes": {
      const row = write.record;
      return { table: "hospital_episodes", fields: [uuid("id", row.id), uuid("organization_id", row.organizationId), uuid("unit_id", row.unitId), uuid("patient_id", row.patientId), uuid("encounter_id", row.encounterId), uuid("bed_id", row.bedId), plain("status", row.status), timestamp("admitted_at", row.admittedAt), timestamp("discharged_at", row.dischargedAt)] };
    }
    case "products": {
      const row = write.record;
      return { table: "products", fields: [uuid("id", row.id), uuid("organization_id", row.organizationId), plain("sku", row.sku), plain("name", row.name), plain("category", row.category), plain("unit", row.unit), plain("reorder_point", row.reorderPoint), plain("status", row.status)] };
    }
    case "stockLocations": {
      const row = write.record;
      return { table: "stock_locations", fields: [uuid("id", row.id), uuid("organization_id", row.organizationId), uuid("unit_id", row.unitId), plain("name", row.name)] };
    }
    case "lots": {
      const row = write.record;
      return { table: "lots", fields: [uuid("id", row.id), uuid("organization_id", row.organizationId), uuid("product_id", row.productId), plain("lot_number", row.lotNumber), date("expires_on", row.expiresOn), plain("quantity", row.quantity), uuid("location_id", row.locationId), plain("status", row.status)] };
    }
    case "stockMovements": {
      const row = write.record;
      return { table: "stock_movements", fields: [uuid("id", row.id), uuid("organization_id", row.organizationId), uuid("product_id", row.productId), uuid("lot_id", row.lotId), uuid("location_id", row.locationId), plain("quantity", row.quantity), plain("movement_type", row.movementType), plain("reason", row.reason), uuid("reference_id", row.referenceId), uuid("created_by", row.createdBy), timestamp("created_at", row.createdAt)] };
    }
    case "medicationOrders": {
      const row = write.record;
      return { table: "medication_orders", fields: [uuid("id", row.id), uuid("organization_id", row.organizationId), uuid("patient_id", row.patientId), uuid("encounter_id", row.encounterId), uuid("product_id", row.productId), plain("dose", row.dose), plain("route", row.route), plain("frequency", row.frequency), plain("status", row.status), uuid("prescribed_by", row.prescribedBy)] };
    }
    case "dispensations": {
      const row = write.record;
      return { table: "dispensations", fields: [uuid("id", row.id), uuid("organization_id", row.organizationId), uuid("medication_order_id", row.medicationOrderId), uuid("lot_id", row.lotId), plain("quantity", row.quantity), uuid("dispensed_by", row.dispensedBy), timestamp("created_at", row.createdAt)] };
    }
    case "administrationOccurrences": {
      const row = write.record;
      return { table: "administration_occurrences", fields: [uuid("id", row.id), uuid("organization_id", row.organizationId), uuid("medication_order_id", row.medicationOrderId), uuid("administered_by", row.administeredBy), timestamp("administered_at", row.administeredAt), plain("status", row.status), plain("note", row.note)] };
    }
    case "charges": {
      const row = write.record;
      return { table: "charges", fields: [uuid("id", row.id), uuid("organization_id", row.organizationId), uuid("unit_id", row.unitId), uuid("patient_id", row.patientId), plain("description", row.description), plain("amount_cents", row.amountCents), plain("currency", row.currency), plain("status", row.status), timestamp("created_at", row.createdAt)] };
    }
    case "payments": {
      const row = write.record;
      return { table: "payments", fields: [uuid("id", row.id), uuid("organization_id", row.organizationId), uuid("charge_id", row.chargeId), plain("amount_cents", row.amountCents), plain("method", row.method), plain("external_reference", row.externalReference), plain("status", row.status), timestamp("created_at", row.createdAt)] };
    }
    case "ledgerEntries": {
      const row = write.record;
      return { table: "ledger_entries", fields: [uuid("id", row.id), uuid("organization_id", row.organizationId), plain("kind", row.kind), uuid("reference_id", row.referenceId), plain("amount_cents", row.amountCents), plain("currency", row.currency), plain("description", row.description), timestamp("created_at", row.createdAt)] };
    }
    case "messages": {
      const row = write.record;
      return { table: "communication_messages", fields: [uuid("id", row.id), uuid("organization_id", row.organizationId), uuid("unit_id", row.unitId), uuid("workspace_id", row.workspaceId), uuid("patient_id", row.patientId), plain("channel", row.channel), plain("recipient", row.recipient), plain("template", row.template), plain("body", row.body), plain("status", row.status), uuid("created_by", row.createdBy), uuid("decided_by", row.decidedBy), timestamp("decided_at", row.decidedAt), uuid("approved_by", row.approvedBy), timestamp("approved_at", row.approvedAt), plain("decision_reason", row.decisionReason), timestamp("created_at", row.createdAt)] };
    }
    case "knowledgeDocuments": {
      const row = write.record;
      return { table: "knowledge_documents", fields: [uuid("id", row.id), uuid("organization_id", row.organizationId), uuid("unit_id", row.unitId), uuid("workspace_id", row.workspaceId), plain("title", row.title), plain("source", row.source), plain("data_class", row.dataClass), plain("version", row.version), plain("status", row.status), plain("content", row.content), timestamp("created_at", row.createdAt)] };
    }
    case "aiSessions": {
      const row = write.record;
      return { table: "ai_sessions", fields: [uuid("id", row.id), uuid("organization_id", row.organizationId), uuid("actor_id", row.actorId), uuid("unit_id", row.unitId), uuid("workspace_id", row.workspaceId), uuid("patient_id", row.patientId), uuid("encounter_id", row.encounterId), plain("purpose", row.purpose), plain("engine_commit", row.engineCommit), plain("profile_digest", row.profileDigest), plain("status", row.status), timestamp("created_at", row.createdAt)] };
    }
    case "budgetReservations": {
      const row = write.record;
      return { table: "budget_reservations", fields: [uuid("id", row.id), uuid("organization_id", row.organizationId), uuid("session_id", row.sessionId), plain("category", row.category), plain("reserved_units", row.reservedUnits), plain("consumed_units", row.consumedUnits), plain("status", row.status), timestamp("created_at", row.createdAt)] };
    }
    case "aiTurns": {
      const row = write.record;
      const session = snapshot.aiSessions.find((candidate) => candidate.id === row.sessionId);
      if (!session) throw new Error(`AI turn ${row.id} has no fixture session`);
      return { table: "ai_turns", fields: [uuid("id", row.id), uuid("organization_id", session.organizationId), uuid("unit_id", session.unitId), uuid("workspace_id", session.workspaceId), uuid("session_id", row.sessionId), plain("prompt", row.prompt), plain("response", row.response), plain("status", row.status), plain("model", row.model), plain("input_tokens", row.inputTokens), plain("output_tokens", row.outputTokens), json("references_json", row.references), uuid("usage_record_id", row.usage?.id), json("provenance_json", row.provenance ?? {}), timestamp("created_at", row.createdAt)] };
    }
    case "aiDrafts": {
      const row = write.record;
      const session = snapshot.aiSessions.find((candidate) => candidate.id === row.sessionId);
      if (!session) throw new Error(`AI draft ${row.id} has no fixture session`);
      return { table: "ai_drafts", fields: [uuid("id", row.id), uuid("organization_id", session.organizationId), uuid("unit_id", session.unitId), uuid("workspace_id", session.workspaceId), uuid("session_id", row.sessionId), uuid("encounter_id", row.encounterId), plain("draft_type", row.draftType), plain("content", row.content), uuid("source_turn_id", row.sourceTurnId), plain("status", row.status), timestamp("created_at", row.createdAt)] };
    }
    case "aiApprovals": {
      const row = write.record;
      return { table: "ai_approvals", fields: [uuid("id", row.id), uuid("organization_id", row.organizationId), uuid("actor_id", row.actorId), uuid("session_id", row.sessionId), uuid("turn_id", row.turnId), plain("tool_name", row.toolName), uuid("resource_id", row.resourceId), uuid("patient_id", row.patientId), uuid("encounter_id", row.encounterId), uuid("unit_id", row.unitId), uuid("workspace_id", row.workspaceId), plain("purpose", row.purpose), plain("request_digest", row.requestDigest), plain("policy_revision", row.policyRevision), timestamp("expires_at", row.expiresAt), plain("decision", row.decision), uuid("decided_by", row.decidedBy), plain("reason", row.reason), timestamp("created_at", row.createdAt)] };
    }
    default:
      throw new Error(`unsupported AUD27 slice ${(write as { snapshotKey: string }).snapshotKey}`);
  }
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

async function verifyProjection(client: Client, snapshot: StoreSnapshot, write: Aud27NormalizedDomainWrite): Promise<void> {
  const spec = projectionSpec(snapshot, write);
  const result = await client.query<Record<string, unknown>>(`select ${spec.fields.map((field) => field.select).join(", ")} from ${spec.table} where id = $1`, [write.record.id]);
  const row = result.rows[0];
  if (!row) throw new Error(`normalized projection missing ${write.snapshotKey}:${write.record.id} in ${spec.table}`);
  const mismatches = spec.fields.filter((field) => !valuesEqual(row[field.alias], field.expected)).map((field) => ({ field: field.alias, expected: field.expected, actual: row[field.alias] }));
  if (mismatches.length > 0) throw new Error(`normalized projection parity mismatch ${write.snapshotKey}:${write.record.id}: ${JSON.stringify(mismatches)}`);
}

async function tableCounts(client: Client): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const table of new Set(Object.values(AUD27_NORMALIZED_TABLE_BY_KEY))) {
    const result = await client.query<{ count: number }>(`select count(*)::int as count from ${table}`);
    counts.set(table, result.rows[0]?.count ?? 0);
  }
  return counts;
}

function assertCountParity(before: Map<string, number>, after: Map<string, number>, phase: string): void {
  for (const [table, count] of before) {
    if (after.get(table) !== count) throw new Error(`replay changed row count for ${table} during ${phase}: before=${count} after=${after.get(table) ?? "missing"}`);
  }
}

function buildFixture(): { store: CvgStore; baseline: StoreSnapshot; candidate: StoreSnapshot; actorId: OpaqueId; organizationId: OpaqueId } {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const baseline = store.snapshot();
  const seededProvider = baseline.providers[0];
  if (!seededProvider) throw new Error("AUD27 fixture has no provider seed row");
  const untouchedProviderId = makeId();
  const untouchedProvider = { ...seededProvider, id: untouchedProviderId, displayName: `${seededProvider.displayName} unchanged parity row` };
  baseline.providers.push(untouchedProvider);
  const veterinarian = [...store.users.values()].find((user) => user.login.startsWith("ana."));
  if (!veterinarian) throw new Error("AUD27 fixture has no veterinarian");
  const option = store.contextOptions(veterinarian.id)[0];
  if (!option) throw new Error("AUD27 fixture has no context");
  const context = store.resolveContext(veterinarian.id, { unitId: option.unit.id, workspaceId: option.workspace.id }, "aud27.normalized-writes.24-slices", "aud27-24-slices");
  const patient = [...store.patients.values()].find((candidate) => candidate.unitId === context.unitId && candidate.workspaceId === context.workspaceId);
  const bed = [...store.beds.values()].find((candidate) => candidate.unitId === context.unitId);
  if (!patient || !bed) throw new Error("AUD27 fixture has no patient or bed");

  const encounter = store.createEncounter(context, { patientId: patient.id, appointmentId: null, chiefComplaint: "AUD27 24 slices", urgency: "ROUTINE" });
  const document = store.createClinicalDocument(context, { encounterId: encounter.id, documentType: "EVOLUTION", title: "AUD27 24 slices", content: "conteúdo sintético", dataClass: "D3" });
  store.reviewClinicalDocument(context, document.id, null);
  store.signClinicalDocument(context, document.id, null);
  store.addClinicalAddendum(context, document.id, "qualificação", "adendo sintético");
  store.createHospitalEpisode(context, { patientId: patient.id, encounterId: encounter.id, bedId: bed.id });
  const productBefore = [...store.products.values()][0];
  if (!productBefore) throw new Error("AUD27 fixture has no product");
  const medicationOrder = store.createMedicationOrder(context, { patientId: patient.id, encounterId: encounter.id, productId: productBefore.id, dose: "1 unidade", route: "oral", frequency: "12/12h" });
  const after = store.snapshot();
  after.providers.push(untouchedProvider);
  const product = after.products.find((candidate) => candidate.id === productBefore.id);
  const lot = after.lots.find((candidate) => candidate.productId === product?.id);
  const location = lot ? after.stockLocations.find((candidate) => candidate.id === lot.locationId) : undefined;
  const charge = after.charges[0];
  if (!product || !lot || !location || !charge) throw new Error("AUD27 fixture has incomplete stock/finance dependencies");

  const aiSession = {
    id: makeId(), organizationId: context.organizationId, actorId: veterinarian.id, unitId: context.unitId, workspaceId: context.workspaceId,
    patientId: patient.id, encounterId: encounter.id, purpose: "SUMMARY" as const, engineCommit: "aud27-24-slices", profileDigest: digest("aud27-profile"), status: "ACTIVE" as const, createdAt: "2026-09-22T00:00:00.000Z"
  };
  const aiTurn = {
    id: makeId(), sessionId: aiSession.id, prompt: "resumo", response: "resposta", status: "COMPLETED" as const, model: "synthetic", inputTokens: 1, outputTokens: 1, references: [], createdAt: "2026-09-22T00:00:01.000Z"
  };
  const aiDraft = {
    id: makeId(), sessionId: aiSession.id, encounterId: encounter.id, draftType: "SUMMARY" as const, content: "rascunho", sourceTurnId: aiTurn.id, status: "DRAFT" as const, createdAt: "2026-09-22T00:00:02.000Z"
  };
  const aiApproval = {
    id: makeId(), organizationId: context.organizationId, actorId: veterinarian.id, sessionId: aiSession.id, turnId: aiTurn.id, toolName: "patients.read", resourceId: patient.id,
    patientId: patient.id, encounterId: encounter.id, unitId: context.unitId, workspaceId: context.workspaceId, purpose: "SUMMARY" as const, requestDigest: digest("aud27-request"), policyRevision: "1",
    expiresAt: "2099-01-01T00:00:00.000Z", decision: "rejected" as const, decidedBy: null, reason: null, createdAt: "2026-09-22T00:00:03.000Z"
  };
  const budgetReservation = {
    id: makeId(), organizationId: context.organizationId, sessionId: aiSession.id, category: "TOKENS" as const, reservedUnits: 10, consumedUnits: 0, status: "RESERVED" as const, createdAt: "2026-09-22T00:00:04.000Z"
  };
  after.aiSessions.push(aiSession);
  after.aiTurns.push(aiTurn);
  after.aiDrafts.push(aiDraft);
  after.aiApprovals.push(aiApproval);
  after.budgetReservations.push(budgetReservation);
  after.stockMovements.push({ id: makeId(), organizationId: context.organizationId, productId: product.id, lotId: lot.id, locationId: location.id, quantity: 1, movementType: "RECEIPT", reason: "AUD27 24 slices", referenceId: null, createdBy: veterinarian.id, createdAt: "2026-09-22T00:00:05.000Z" });
  after.dispensations.push({ id: makeId(), organizationId: context.organizationId, medicationOrderId: medicationOrder.id, lotId: lot.id, quantity: 1, dispensedBy: veterinarian.id, createdAt: "2026-09-22T00:00:06.000Z" });
  after.administrationOccurrences.push({ id: makeId(), organizationId: context.organizationId, medicationOrderId: medicationOrder.id, administeredBy: veterinarian.id, administeredAt: "2026-09-22T00:00:07.000Z", status: "OMITTED", note: "AUD27 24 slices" });
  after.payments.push({ id: makeId(), organizationId: context.organizationId, chargeId: charge.id, amountCents: 1, method: "PIX", externalReference: "aud27-24-slices", status: "SETTLED", createdAt: "2026-09-22T00:00:08.000Z" });
  after.ledgerEntries.push({ id: makeId(), organizationId: context.organizationId, kind: "CHARGE", referenceId: charge.id, amountCents: charge.amountCents, currency: charge.currency, description: "AUD27 24 slices", createdAt: "2026-09-22T00:00:09.000Z" });
  after.messages.push({ id: makeId(), organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId, patientId: patient.id, channel: "SMS", recipient: "+5511999999999", template: "aud27", body: "mensagem sintética", status: "APPROVAL_REQUIRED", createdBy: veterinarian.id, decisionReason: null, createdAt: "2026-09-22T00:00:10.000Z" });

  const provider = after.providers[0];
  const service = after.services[0];
  const resource = after.resources[0];
  const queueEntry = after.queueEntries[0];
  const knowledge = after.knowledgeDocuments[0];
  if (!provider || !service || !resource || !queueEntry || !knowledge) throw new Error("AUD27 fixture has incomplete residual seed rows");
  after.providers[0] = { ...provider, displayName: `${provider.displayName} AUD27` };
  after.services[0] = { ...service, name: `${service.name} AUD27` };
  after.resources[0] = { ...resource, name: `${resource.name} AUD27` };
  after.queueEntries[0] = { ...queueEntry, priority: queueEntry.priority === "URGENT" ? "ROUTINE" : "URGENT" };
  const bedIndex = after.beds.findIndex((candidate) => candidate.id === bed.id);
  const productIndex = after.products.findIndex((candidate) => candidate.id === product.id);
  const locationIndex = after.stockLocations.findIndex((candidate) => candidate.id === location.id);
  const lotIndex = after.lots.findIndex((candidate) => candidate.id === lot.id);
  const chargeIndex = after.charges.findIndex((candidate) => candidate.id === charge.id);
  if (bedIndex < 0 || productIndex < 0 || locationIndex < 0 || lotIndex < 0 || chargeIndex < 0) throw new Error("AUD27 fixture failed to locate residual rows");
  after.beds[bedIndex] = { ...after.beds[bedIndex]!, name: `${after.beds[bedIndex]!.name} AUD27` };
  after.products[productIndex] = { ...after.products[productIndex]!, name: `${after.products[productIndex]!.name} AUD27` };
  after.stockLocations[locationIndex] = { ...after.stockLocations[locationIndex]!, name: `${after.stockLocations[locationIndex]!.name} AUD27` };
  after.lots[lotIndex] = { ...after.lots[lotIndex]!, lotNumber: `${after.lots[lotIndex]!.lotNumber}-AUD27` };
  after.charges[chargeIndex] = { ...after.charges[chargeIndex]!, description: `${after.charges[chargeIndex]!.description} AUD27`, status: "PARTIALLY_PAID" };
  after.knowledgeDocuments[0] = { ...knowledge, title: `${knowledge.title} AUD27` };
  return { store, baseline, candidate: after, actorId: veterinarian.id, organizationId: context.organizationId };
}

async function verifyEmptyDisposableDatabase(): Promise<void> {
  await probe.connect();
  const existing = await probe.query<{ count: number }>("select count(*)::int as count from organizations");
  if ((existing.rows[0]?.count ?? 0) !== 0) throw new Error("AUD27 24-slice verifier requires an empty disposable database; no data was mutated");
  const migration = await probe.query<{ exists: boolean }>("select exists (select 1 from schema_migrations where version = '048_aud27_migration_rls') as exists");
  if (!migration.rows[0]?.exists) throw new Error("AUD27 24-slice verifier requires migration 048_aud27_migration_rls");
  await probe.end();
}

async function main(): Promise<void> {
  await verifyEmptyDisposableDatabase();
  const fixture = buildFixture();
  const plan = buildAud27NormalizedWritePlan(fixture.baseline, fixture.candidate);
  if (plan.removed.length !== 0) throw new Error(`AUD27 24-slice fixture unexpectedly removed ${plan.removed.length} rows`);
  if (plan.writes.length !== AUD27_SNAPSHOT_PRIMARY_KEYS.length) throw new Error(`AUD27 24-slice fixture changed ${plan.writes.length} slices; expected ${AUD27_SNAPSHOT_PRIMARY_KEYS.length}`);
  const observedKeys = plan.writes.map((write) => write.snapshotKey);
  if (JSON.stringify(observedKeys) !== JSON.stringify([...AUD27_SNAPSHOT_PRIMARY_KEYS])) throw new Error(`AUD27 24-slice plan ordering/key set mismatch: ${JSON.stringify(observedKeys)}`);

  const persistence = new PostgresPersistence({ connectionString, max: 3, connectionTimeoutMillis: 2_500 });
  const verify = new Client({ connectionString, connectionTimeoutMillis: 2_500, application_name: "cvg-aud27-24-slices-probe" });
  try {
    await persistence.commit({ expectedRevision: null, snapshot: fixture.baseline, eventType: "BOOTSTRAP", operation: "aud27.normalized-writes.24-slices.bootstrap", organizationId: fixture.organizationId, actorId: null, correlationId: randomUUID(), aggregateType: "Organization", aggregateId: fixture.organizationId, payload: { synthetic: true, aud27: "24-slices" }, auditRecords: fixture.baseline.auditRecords, commandReceipts: fixture.baseline.commandReceipts });
    await persistence.commit({ expectedRevision: 1n, snapshot: fixture.candidate, eventType: "SYSTEM", operation: "aud27.normalized-writes.24-slices.apply", organizationId: fixture.organizationId, actorId: fixture.actorId, correlationId: randomUUID(), aggregateType: "AUD27", aggregateId: null, payload: { synthetic: true, aud27: "24-slices", normalizedSlices: 24 }, auditRecords: fixture.candidate.auditRecords, commandReceipts: fixture.candidate.commandReceipts, normalizedDomainWrites: plan.writes as readonly Aud27NormalizedDomainWrite[] });
    await verify.connect();
    for (const write of plan.writes) await verifyProjection(verify, fixture.candidate, write);
    const afterApply = await tableCounts(verify);
    assertAud27SnapshotCountParity(fixture.candidate, afterApply, "normalized apply");
    await persistence.commit({ expectedRevision: 2n, snapshot: fixture.candidate, eventType: "SYSTEM", operation: "aud27.normalized-writes.24-slices.replay", organizationId: fixture.organizationId, actorId: fixture.actorId, correlationId: randomUUID(), aggregateType: "AUD27", aggregateId: null, payload: { synthetic: true, aud27: "24-slices", replay: true }, auditRecords: fixture.candidate.auditRecords, commandReceipts: fixture.candidate.commandReceipts, normalizedDomainWrites: plan.writes as readonly Aud27NormalizedDomainWrite[] });
    for (const write of plan.writes) await verifyProjection(verify, fixture.candidate, write);
    const afterReplay = await tableCounts(verify);
    assertCountParity(afterApply, afterReplay, "normalized replay");
    assertAud27SnapshotCountParity(fixture.candidate, afterReplay, "normalized replay");
    const rollbackCandidate = structuredClone(fixture.candidate) as StoreSnapshot;
    const rollbackProductIndex = rollbackCandidate.products.findIndex((candidate) => candidate.id === fixture.candidate.products[0]?.id);
    if (rollbackProductIndex < 0 || !rollbackCandidate.products[rollbackProductIndex]) throw new Error("AUD27 rollback fixture has no product");
    rollbackCandidate.products[rollbackProductIndex] = { ...rollbackCandidate.products[rollbackProductIndex]!, name: `${rollbackCandidate.products[rollbackProductIndex]!.name} ROLLBACK` };
    const rollbackPlan = buildAud27NormalizedWritePlan(fixture.candidate, rollbackCandidate);
    if (rollbackPlan.writes.length !== 1 || rollbackPlan.writes[0]?.snapshotKey !== "products") throw new Error(`AUD27 rollback fixture changed an unexpected slice: ${JSON.stringify(rollbackPlan.writes.map((write) => write.snapshotKey))}`);
    let rollbackRejected = false;
    try {
      await persistence.commit({ expectedRevision: 3n, snapshot: rollbackCandidate, eventType: "SYSTEM", operation: "aud27.normalized-writes.24-slices.rollback", organizationId: fixture.organizationId, actorId: fixture.actorId, correlationId: randomUUID(), aggregateType: "AUD27", aggregateId: null, payload: { synthetic: true, aud27: "24-slices", rollback: true }, auditRecords: rollbackCandidate.auditRecords, commandReceipts: rollbackCandidate.commandReceipts, normalizedDomainWrites: rollbackPlan.writes as readonly Aud27NormalizedDomainWrite[], outboxRecords: [{ id: makeId(), organizationId: makeId(), eventType: "AUD27_ROLLBACK_INVALID_SCOPE", aggregateId: makeId(), payload: { synthetic: true } }] });
    } catch (error) {
      rollbackRejected = error instanceof Error && /different organization scope/.test(error.message);
    }
    if (!rollbackRejected) throw new Error("AUD27 normalized projection rollback did not reject the cross-tenant outbox");
    for (const write of plan.writes) await verifyProjection(verify, fixture.candidate, write);
    const afterRollback = await tableCounts(verify);
    assertCountParity(afterReplay, afterRollback, "failed normalized commit rollback");
    assertAud27SnapshotCountParity(fixture.candidate, afterRollback, "failed normalized commit rollback");

    const authoritativeProduct: Product = {
      id: makeId(), organizationId: fixture.organizationId, sku: `AUD27-${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`,
      name: "Produto autoritativo sintético", category: "INSUMO", unit: "unidade", reorderPoint: 2, status: "ACTIVE"
    };
    const productSnapshot = structuredClone(fixture.candidate) as StoreSnapshot;
    productSnapshot.products.push(authoritativeProduct);
    const productPlan = buildAud27NormalizedWritePlan(fixture.candidate, productSnapshot);
    if (productPlan.writes.length !== 1 || productPlan.writes[0]?.snapshotKey !== "products") throw new Error(`AUD27 product fixture changed an unexpected slice: ${JSON.stringify(productPlan.writes.map((write) => write.snapshotKey))}`);

    await verify.query("create table aud27_product_dml_probe (product_id uuid primary key, mutation_count integer not null default 0)");
    await verify.query("insert into aud27_product_dml_probe(product_id) values ($1)", [authoritativeProduct.id]);
    await verify.query(`create function aud27_capture_product_dml() returns trigger language plpgsql as $$ begin if exists (select 1 from aud27_product_dml_probe where product_id = new.id) then update aud27_product_dml_probe set mutation_count = mutation_count + 1 where product_id = new.id; end if; return new; end $$`);
    await verify.query("create trigger aud27_product_dml_probe_trigger after insert or update on products for each row execute function aud27_capture_product_dml()");

    let productRollbackRejected = false;
    try {
      await persistence.commit({ expectedRevision: 3n, snapshot: productSnapshot, eventType: "SYSTEM", operation: "aud27.products.create.rollback", organizationId: fixture.organizationId, actorId: fixture.actorId, correlationId: randomUUID(), aggregateType: "Product", aggregateId: authoritativeProduct.id, payload: { synthetic: true, aud27: "product-create-rollback" }, auditRecords: productSnapshot.auditRecords, commandReceipts: productSnapshot.commandReceipts, normalizedProductWrite: authoritativeProduct, normalizedDomainWrites: productPlan.writes, outboxRecords: [{ id: makeId(), organizationId: makeId(), eventType: "AUD27_PRODUCT_ROLLBACK_INVALID_SCOPE", aggregateId: authoritativeProduct.id, payload: { synthetic: true } }] });
    } catch (error) {
      productRollbackRejected = error instanceof Error && /different organization scope/.test(error.message);
    }
    if (!productRollbackRejected) throw new Error("AUD27 authoritative product transaction did not reject the cross-tenant outbox");
    const rolledBackProduct = await verify.query("select id::text as id from products where id = $1", [authoritativeProduct.id]);
    if (rolledBackProduct.rowCount !== 0 || await persistence.currentRevision(fixture.organizationId) !== 3n) throw new Error("AUD27 failed product transaction left a normalized row or advanced the snapshot revision");

    await persistence.commit({ expectedRevision: 3n, snapshot: productSnapshot, eventType: "SYSTEM", operation: "aud27.products.create", organizationId: fixture.organizationId, actorId: fixture.actorId, correlationId: randomUUID(), aggregateType: "Product", aggregateId: authoritativeProduct.id, payload: { synthetic: true, aud27: "product-create" }, auditRecords: productSnapshot.auditRecords, commandReceipts: productSnapshot.commandReceipts, normalizedProductWrite: authoritativeProduct, normalizedDomainWrites: productPlan.writes });
    await verifyProjection(verify, productSnapshot, productPlan.writes[0]!);
    const afterProductCreate = await tableCounts(verify);
    if (afterProductCreate.get("products") !== (afterRollback.get("products") ?? 0) + 1) throw new Error(`AUD27 product create count mismatch: before=${afterRollback.get("products")} after=${afterProductCreate.get("products")}`);

    const duplicateSkuProduct: Product = { ...authoritativeProduct, id: makeId(), name: "Duplicado sintético" };
    const duplicateSkuSnapshot = structuredClone(productSnapshot) as StoreSnapshot;
    duplicateSkuSnapshot.products.push(duplicateSkuProduct);
    let duplicateSkuRejected = false;
    try {
      const duplicatePlan = buildAud27NormalizedWritePlan(productSnapshot, duplicateSkuSnapshot);
      await persistence.commit({ expectedRevision: 4n, snapshot: duplicateSkuSnapshot, eventType: "SYSTEM", operation: "aud27.products.duplicate-sku", organizationId: fixture.organizationId, actorId: fixture.actorId, correlationId: randomUUID(), aggregateType: "Product", aggregateId: duplicateSkuProduct.id, payload: { synthetic: true, aud27: "product-duplicate-sku" }, auditRecords: duplicateSkuSnapshot.auditRecords, commandReceipts: duplicateSkuSnapshot.commandReceipts, normalizedProductWrite: duplicateSkuProduct, normalizedDomainWrites: duplicatePlan.writes });
    } catch (error) {
      duplicateSkuRejected = error instanceof PersistenceProductSkuConflictError;
    }
    if (!duplicateSkuRejected || await persistence.currentRevision(fixture.organizationId) !== 4n) throw new Error("AUD27 duplicate organization SKU was not rejected atomically by the database unique constraint");
    const duplicateProductRow = await verify.query("select id::text as id from products where id = $1", [duplicateSkuProduct.id]);
    if (duplicateProductRow.rowCount !== 0) throw new Error("AUD27 duplicate-SKU failure left a product row behind");

    await persistence.commit({ expectedRevision: 4n, snapshot: productSnapshot, eventType: "SYSTEM", operation: "aud27.products.create.replay", organizationId: fixture.organizationId, actorId: fixture.actorId, correlationId: randomUUID(), aggregateType: "Product", aggregateId: authoritativeProduct.id, payload: { synthetic: true, aud27: "product-create", replay: true }, auditRecords: productSnapshot.auditRecords, commandReceipts: productSnapshot.commandReceipts, normalizedProductReplayId: authoritativeProduct.id, normalizedDomainWrites: productPlan.writes });
    await verifyProjection(verify, productSnapshot, productPlan.writes[0]!);
    const replayDml = await verify.query<{ mutation_count: number }>("select mutation_count from aud27_product_dml_probe where product_id = $1", [authoritativeProduct.id]);
    if (replayDml.rows[0]?.mutation_count !== 1) throw new Error(`AUD27 product replay executed unexpected normalized DML: mutations=${replayDml.rows[0]?.mutation_count ?? "missing"}`);
    const afterProductReplay = await tableCounts(verify);
    assertCountParity(afterProductCreate, afterProductReplay, "authoritative product replay");
    if (await persistence.currentRevision(fixture.organizationId) !== 5n) throw new Error("AUD27 product replay did not advance only the durable event revision");

    const changedProviderId = plan.writes.find((write) => write.snapshotKey === "providers")?.record.id;
    const unchangedProvider = fixture.candidate.providers.find((provider) => provider.id !== changedProviderId);
    if (!unchangedProvider) throw new Error("AUD27 known-bad fixture has no unchanged provider row");
    const deleted = await verify.query("delete from providers where id = $1", [unchangedProvider.id]);
    if (deleted.rowCount !== 1) throw new Error("AUD27 known-bad fixture did not delete exactly one unchanged provider row");
    let missingUnchangedRowRejected = false;
    try {
      assertAud27SnapshotCountParity(fixture.candidate, await tableCounts(verify), "known-bad missing unchanged provider");
    } catch (error) {
      missingUnchangedRowRejected = error instanceof Error && error.message.includes(`providers expected=${fixture.candidate.providers.length} actual=${fixture.candidate.providers.length - 1}`);
    }
    if (!missingUnchangedRowRejected) throw new Error("AUD27 full snapshot parity accepted a database missing an unchanged seed provider row");

    const secondOrganizationId = makeId();
    const secondOrganizationStore = new CvgStore({ seed: false });
    const secondOrganizationSnapshot = secondOrganizationStore.snapshot();
    secondOrganizationSnapshot.organizations.push({ id: secondOrganizationId, name: "Organização sintética AUD27", slug: `aud27-${randomUUID().replaceAll("-", "")}`, status: "ACTIVE", authorizationRevision: 1n, createdAt: "2026-09-22T00:00:00.000Z" });
    const sameSkuOtherOrganization: Product = { ...authoritativeProduct, id: makeId(), organizationId: secondOrganizationId, name: "Mesmo SKU em outra organização" };
    secondOrganizationSnapshot.products.push(sameSkuOtherOrganization);
    await persistence.commit({ expectedRevision: null, snapshot: secondOrganizationSnapshot, eventType: "BOOTSTRAP", operation: "aud27.products.cross-organization-sku", organizationId: secondOrganizationId, actorId: null, correlationId: randomUUID(), aggregateType: "Product", aggregateId: sameSkuOtherOrganization.id, payload: { synthetic: true, aud27: "product-cross-organization-sku" }, normalizedProductWrite: sameSkuOtherOrganization });
    const otherOrganizationRow = await verify.query<{ organization_id: string; sku: string }>("select organization_id::text as organization_id, sku from products where id = $1", [sameSkuOtherOrganization.id]);
    if (otherOrganizationRow.rows[0]?.organization_id !== secondOrganizationId || otherOrganizationRow.rows[0]?.sku !== authoritativeProduct.sku) throw new Error("AUD27 organization-scoped SKU invariant rejected or corrupted a same-SKU product in another organization");

    await persistence.commit({ expectedRevision: 5n, snapshot: productSnapshot, eventType: "SYSTEM", operation: "aud27.products.cross-organization-isolation-probe", organizationId: fixture.organizationId, actorId: fixture.actorId, correlationId: randomUUID(), aggregateType: "AUD27", aggregateId: null, payload: { synthetic: true, aud27: "product-cross-organization-isolation-probe" }, auditRecords: productSnapshot.auditRecords, commandReceipts: productSnapshot.commandReceipts });
    const revisionBeforeDivergence = await persistence.currentRevision(fixture.organizationId);
    const otherOrganizationRevision = await persistence.currentRevision(secondOrganizationId);
    const otherOrganizationRowAfterCommit = await verify.query<{ organization_id: string; sku: string }>("select organization_id::text as organization_id, sku from products where id = $1", [sameSkuOtherOrganization.id]);
    if (revisionBeforeDivergence !== 6n || otherOrganizationRevision !== 1n || otherOrganizationRowAfterCommit.rows[0]?.organization_id !== secondOrganizationId || otherOrganizationRowAfterCommit.rows[0]?.sku !== authoritativeProduct.sku) {
      throw new Error(`AUD27 product preflight did not isolate organizations; organization_revision=${revisionBeforeDivergence} other_organization_revision=${otherOrganizationRevision} other_product_preserved=${otherOrganizationRowAfterCommit.rows[0]?.organization_id === secondOrganizationId && otherOrganizationRowAfterCommit.rows[0]?.sku === authoritativeProduct.sku}`);
    }

    const divergenceProbeProduct = fixture.candidate.products[0];
    if (!divergenceProbeProduct) throw new Error("AUD27 divergence fixture has no product to tamper");
    const tamperedProductName = `${divergenceProbeProduct.name} OUT_OF_BAND`;
    const tamper = await verify.query(
      "update products set name = $2 where id = $1 and organization_id = $3",
      [divergenceProbeProduct.id, tamperedProductName, fixture.organizationId]
    );
    if (tamper.rowCount !== 1) throw new Error("AUD27 divergence fixture did not tamper exactly one synthetic product row");
    let unrelatedCommitRejected = false;
    try {
      await persistence.commit({
        expectedRevision: revisionBeforeDivergence,
        snapshot: productSnapshot,
        eventType: "SYSTEM",
        operation: "aud27.products.divergence-probe",
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        correlationId: randomUUID(),
        aggregateType: "AUD27",
        aggregateId: null,
        payload: { synthetic: true, aud27: "products-divergence-probe" },
        auditRecords: productSnapshot.auditRecords,
        commandReceipts: productSnapshot.commandReceipts
      });
    } catch (error) {
      unrelatedCommitRejected = error instanceof PersistenceCorruptionError && /products projection diverged/i.test(error.message);
    }
    const preservedTamper = await verify.query<{ name: string }>("select name from products where id = $1 and organization_id = $2", [divergenceProbeProduct.id, fixture.organizationId]);
    const revisionAfterDivergence = await persistence.currentRevision(fixture.organizationId);
    if (!unrelatedCommitRejected || preservedTamper.rows[0]?.name !== tamperedProductName || revisionAfterDivergence !== revisionBeforeDivergence) {
      throw new Error(`AUD27 unrelated commit failed to block and preserve product divergence; rejected=${unrelatedCommitRejected} preserved=${preservedTamper.rows[0]?.name === tamperedProductName} revision=${revisionAfterDivergence}`);
    }

    process.stdout.write(`AUD27_24_SLICES_VERIFIED fixture=PASS source=synthetic slices=24 plan_order=PASS real_postgres=PASS row_parity=24/24 snapshot_count_parity=24/24 replay=PASS duplicate_rows=0 rollback=PASS missing_unchanged_seed=REJECTED product_create=PASS product_replay_no_dml=PASS product_duplicate_org_sku=REJECTED product_cross_org_sku=PASS product_cross_org_isolation=PASS product_rollback=PASS product_divergence=BLOCKED_AND_PRESERVED authority=SNAPSHOT_PRIMARY cutover=NOT_CLAIMED candidate_cleanup=disposable\n`);
  } finally {
    await verify.end().catch(() => undefined);
    await persistence.close().catch(() => undefined);
  }
}

try {
  await main();
} catch (error) {
  const detail = error instanceof Error && error.cause instanceof Error ? `${error.message}; cause=${error.cause.message}` : error instanceof Error ? error.message : String(error);
  process.stderr.write(`AUD27_24_SLICES_FAILED ${detail}\n`);
  process.exitCode = 1;
} finally {
  await probe.end().catch(() => undefined);
}
