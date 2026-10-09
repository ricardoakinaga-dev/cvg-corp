import type { PoolClient } from "pg";
import type { OpaqueId } from "@cvg/contracts";
import type { StoreSnapshot } from "@cvg/domain";
import type { Aud27NormalizedDomainWrite, Aud27RemovedDomainRecord, Aud27SnapshotPrimaryKey } from "./aud27-domain-writes.js";

const AUD27_TABLE_BY_KEY: Record<Aud27SnapshotPrimaryKey, string> = {
  providers: "providers",
  services: "service_catalog_items",
  resources: "resources",
  queueEntries: "queue_entries",
  clinicalAddenda: "clinical_addenda",
  beds: "beds",
  hospitalEpisodes: "hospital_episodes",
  products: "products",
  stockLocations: "stock_locations",
  lots: "lots",
  stockMovements: "stock_movements",
  medicationOrders: "medication_orders",
  dispensations: "dispensations",
  administrationOccurrences: "administration_occurrences",
  charges: "charges",
  payments: "payments",
  ledgerEntries: "ledger_entries",
  messages: "communication_messages",
  knowledgeDocuments: "knowledge_documents",
  aiSessions: "ai_sessions",
  budgetReservations: "budget_reservations",
  aiTurns: "ai_turns",
  aiDrafts: "ai_drafts",
  aiApprovals: "ai_approvals"
};

export type Aud27ProjectionWriterDependencies = {
  writeRows: <T>(client: PoolClient, sql: string, rows: T[], values: (row: T) => unknown[]) => Promise<void>;
  writeScopedRows: <T>(client: PoolClient, sql: string, rows: T[], scope: (row: T) => { unitId: OpaqueId | null; workspaceId: OpaqueId | null }, values: (row: T) => unknown[]) => Promise<void>;
  writeUnitRows: <T>(client: PoolClient, sql: string, rows: T[], unit: (row: T) => OpaqueId | null, values: (row: T) => unknown[]) => Promise<void>;
  corruption: (message: string) => Error;
};

/**
 * AUD27-020: the residual normalized SQL writer is an isolated persistence
 * seam. Scope helpers remain owned by the transaction projector and are
 * injected here so this module cannot create a second scope policy.
 */
export async function writeAud27DomainWrite(
  client: PoolClient,
  snapshot: StoreSnapshot,
  write: Aud27NormalizedDomainWrite,
  dependencies: Aud27ProjectionWriterDependencies
): Promise<void> {
  const { writeRows, writeScopedRows, writeUnitRows, corruption } = dependencies;
  switch (write.snapshotKey) {
    case "providers":
      await writeUnitRows(client,
        "insert into providers(id, organization_id, unit_id, display_name, specialty, role, status) values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, display_name = excluded.display_name, specialty = excluded.specialty, role = excluded.role, status = excluded.status",
        [write.record], (row) => row.unitId,
        (row) => [row.id, row.organizationId, row.unitId, row.displayName, row.specialty, row.role, row.status]);
      return;
    case "services":
      await writeRows(client,
        "insert into service_catalog_items(id, organization_id, name, duration_minutes, price_cents, status) values ($1, $2, $3, $4, $5, $6) on conflict (id) do update set organization_id = excluded.organization_id, name = excluded.name, duration_minutes = excluded.duration_minutes, price_cents = excluded.price_cents, status = excluded.status",
        [write.record], (row) => [row.id, row.organizationId, row.name, row.durationMinutes, row.priceCents, row.status]);
      return;
    case "resources":
      await writeUnitRows(client,
        "insert into resources(id, organization_id, unit_id, name, kind, status) values ($1, $2, $3, $4, $5, $6) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, name = excluded.name, kind = excluded.kind, status = excluded.status",
        [write.record], (row) => row.unitId,
        (row) => [row.id, row.organizationId, row.unitId, row.name, row.kind, row.status]);
      return;
    case "queueEntries":
      await writeUnitRows(client,
        "insert into queue_entries(id, organization_id, unit_id, appointment_id, patient_id, status, priority, checked_in_at) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, appointment_id = excluded.appointment_id, patient_id = excluded.patient_id, status = excluded.status, priority = excluded.priority, checked_in_at = excluded.checked_in_at",
        [write.record], (row) => row.unitId,
        (row) => [row.id, row.organizationId, row.unitId, row.appointmentId, row.patientId, row.status, row.priority, row.checkedInAt]);
      return;
    case "clinicalAddenda": {
      const document = snapshot.clinicalDocuments.find((candidate) => candidate.id === write.record.documentId);
      const encounter = document ? snapshot.encounters.find((candidate) => candidate.id === document.encounterId) : null;
      if (!document || !encounter) throw corruption("clinical addendum " + write.record.id + " has no organization-bound document");
      await writeScopedRows(client,
        "insert into clinical_addenda(id, organization_id, unit_id, workspace_id, document_id, author_id, reason, content, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, document_id = excluded.document_id, author_id = excluded.author_id, reason = excluded.reason, content = excluded.content",
        [write.record], () => ({ unitId: encounter.unitId, workspaceId: encounter.workspaceId }),
        (row) => [row.id, document.organizationId, encounter.unitId, encounter.workspaceId, row.documentId, row.authorId, row.reason, row.content, row.createdAt]);
      return;
    }
    case "beds":
      await writeUnitRows(client,
        "insert into beds(id, organization_id, unit_id, name, status) values ($1, $2, $3, $4, $5) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, name = excluded.name, status = excluded.status",
        [write.record], (row) => row.unitId,
        (row) => [row.id, row.organizationId, row.unitId, row.name, row.status]);
      return;
    case "hospitalEpisodes":
      await writeUnitRows(client,
        "insert into hospital_episodes(id, organization_id, unit_id, patient_id, encounter_id, bed_id, status, admitted_at, discharged_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, patient_id = excluded.patient_id, encounter_id = excluded.encounter_id, bed_id = excluded.bed_id, status = excluded.status, admitted_at = excluded.admitted_at, discharged_at = excluded.discharged_at",
        [write.record], (row) => row.unitId,
        (row) => [row.id, row.organizationId, row.unitId, row.patientId, row.encounterId, row.bedId, row.status, row.admittedAt, row.dischargedAt]);
      return;
    case "products":
      await writeRows(client,
        "insert into products(id, organization_id, sku, name, category, unit, reorder_point, status) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do update set organization_id = excluded.organization_id, sku = excluded.sku, name = excluded.name, category = excluded.category, unit = excluded.unit, reorder_point = excluded.reorder_point, status = excluded.status",
        [write.record], (row) => [row.id, row.organizationId, row.sku, row.name, row.category, row.unit, row.reorderPoint, row.status]);
      return;
    case "stockLocations":
      await writeUnitRows(client,
        "insert into stock_locations(id, organization_id, unit_id, name) values ($1, $2, $3, $4) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, name = excluded.name",
        [write.record], (row) => row.unitId,
        (row) => [row.id, row.organizationId, row.unitId, row.name]);
      return;
    case "lots":
      await writeRows(client,
        "insert into lots(id, organization_id, product_id, lot_number, expires_on, quantity, location_id, status) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do update set organization_id = excluded.organization_id, product_id = excluded.product_id, lot_number = excluded.lot_number, expires_on = excluded.expires_on, quantity = excluded.quantity, location_id = excluded.location_id, status = excluded.status",
        [write.record], (row) => [row.id, row.organizationId, row.productId, row.lotNumber, row.expiresOn, row.quantity, row.locationId, row.status]);
      return;
    case "stockMovements":
      await writeRows(client,
        "insert into stock_movements(id, organization_id, product_id, lot_id, location_id, quantity, movement_type, reason, reference_id, created_by, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (id) do update set organization_id = excluded.organization_id, product_id = excluded.product_id, lot_id = excluded.lot_id, location_id = excluded.location_id, quantity = excluded.quantity, movement_type = excluded.movement_type, reason = excluded.reason, reference_id = excluded.reference_id, created_by = excluded.created_by",
        [write.record], (row) => [row.id, row.organizationId, row.productId, row.lotId, row.locationId, row.quantity, row.movementType, row.reason, row.referenceId, row.createdBy, row.createdAt]);
      return;
    case "medicationOrders":
      await writeRows(client,
        "insert into medication_orders(id, organization_id, patient_id, encounter_id, product_id, dose, route, frequency, status, prescribed_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (id) do update set organization_id = excluded.organization_id, patient_id = excluded.patient_id, encounter_id = excluded.encounter_id, product_id = excluded.product_id, dose = excluded.dose, route = excluded.route, frequency = excluded.frequency, status = excluded.status, prescribed_by = excluded.prescribed_by",
        [write.record], (row) => [row.id, row.organizationId, row.patientId, row.encounterId, row.productId, row.dose, row.route, row.frequency, row.status, row.prescribedBy]);
      return;
    case "dispensations":
      await writeRows(client,
        "insert into dispensations(id, organization_id, medication_order_id, lot_id, quantity, dispensed_by, created_at) values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do update set organization_id = excluded.organization_id, medication_order_id = excluded.medication_order_id, lot_id = excluded.lot_id, quantity = excluded.quantity, dispensed_by = excluded.dispensed_by",
        [write.record], (row) => [row.id, row.organizationId, row.medicationOrderId, row.lotId, row.quantity, row.dispensedBy, row.createdAt]);
      return;
    case "administrationOccurrences":
      await writeRows(client,
        "insert into administration_occurrences(id, organization_id, medication_order_id, administered_by, administered_at, status, note) values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do update set organization_id = excluded.organization_id, medication_order_id = excluded.medication_order_id, administered_by = excluded.administered_by, administered_at = excluded.administered_at, status = excluded.status, note = excluded.note",
        [write.record], (row) => [row.id, row.organizationId, row.medicationOrderId, row.administeredBy, row.administeredAt, row.status, row.note]);
      return;
    case "charges":
      await writeUnitRows(client,
        "insert into charges(id, organization_id, unit_id, patient_id, description, amount_cents, currency, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, patient_id = excluded.patient_id, description = excluded.description, amount_cents = excluded.amount_cents, currency = excluded.currency, status = excluded.status",
        [write.record], (row) => row.unitId,
        (row) => [row.id, row.organizationId, row.unitId, row.patientId, row.description, row.amountCents, row.currency, row.status, row.createdAt]);
      return;
    case "payments":
      await writeRows(client,
        "insert into payments(id, organization_id, charge_id, amount_cents, method, external_reference, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do update set organization_id = excluded.organization_id, charge_id = excluded.charge_id, amount_cents = excluded.amount_cents, method = excluded.method, external_reference = excluded.external_reference, status = excluded.status",
        [write.record], (row) => [row.id, row.organizationId, row.chargeId, row.amountCents, row.method, row.externalReference, row.status, row.createdAt]);
      return;
    case "ledgerEntries":
      await writeRows(client,
        "insert into ledger_entries(id, organization_id, kind, reference_id, amount_cents, currency, description, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do update set organization_id = excluded.organization_id, kind = excluded.kind, reference_id = excluded.reference_id, amount_cents = excluded.amount_cents, currency = excluded.currency, description = excluded.description",
        [write.record], (row) => [row.id, row.organizationId, row.kind, row.referenceId, row.amountCents, row.currency, row.description, row.createdAt]);
      return;
    case "messages":
      await writeScopedRows(client,
        "insert into communication_messages(id, organization_id, unit_id, workspace_id, patient_id, channel, recipient, template, body, status, created_by, decided_by, decided_at, approved_by, approved_at, decision_reason, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, patient_id = excluded.patient_id, channel = excluded.channel, recipient = excluded.recipient, template = excluded.template, body = excluded.body, status = excluded.status, created_by = excluded.created_by, decided_by = excluded.decided_by, decided_at = excluded.decided_at, approved_by = excluded.approved_by, approved_at = excluded.approved_at, decision_reason = excluded.decision_reason",
        [write.record], (row) => ({ unitId: row.unitId, workspaceId: row.workspaceId }),
        (row) => [row.id, row.organizationId, row.unitId, row.workspaceId, row.patientId, row.channel, row.recipient, row.template, row.body, row.status, row.createdBy ?? null, row.decidedBy ?? null, row.decidedAt ?? null, row.approvedBy ?? null, row.approvedAt ?? null, row.decisionReason ?? null, row.createdAt]);
      return;
    case "knowledgeDocuments":
      await writeScopedRows(client,
        "insert into knowledge_documents(id, organization_id, unit_id, workspace_id, title, source, data_class, version, status, content, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, title = excluded.title, source = excluded.source, data_class = excluded.data_class, version = excluded.version, status = excluded.status, content = excluded.content",
        [write.record], (row) => ({ unitId: row.unitId, workspaceId: row.workspaceId }),
        (row) => [row.id, row.organizationId, row.unitId, row.workspaceId, row.title, row.source, row.dataClass, row.version, row.status, row.content, row.createdAt]);
      return;
    case "aiSessions":
      await writeScopedRows(client,
        "insert into ai_sessions(id, organization_id, actor_id, unit_id, workspace_id, patient_id, encounter_id, purpose, engine_commit, profile_digest, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) on conflict (id) do update set organization_id = excluded.organization_id, actor_id = excluded.actor_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, patient_id = excluded.patient_id, encounter_id = excluded.encounter_id, purpose = excluded.purpose, engine_commit = excluded.engine_commit, profile_digest = excluded.profile_digest, status = excluded.status",
        [write.record], (row) => ({ unitId: row.unitId, workspaceId: row.workspaceId }),
        (row) => [row.id, row.organizationId, row.actorId, row.unitId, row.workspaceId, row.patientId, row.encounterId, row.purpose, row.engineCommit, row.profileDigest, row.status, row.createdAt]);
      return;
    case "aiTurns": {
      const session = snapshot.aiSessions.find((candidate) => candidate.id === write.record.sessionId);
      if (!session) throw corruption("ai turn " + write.record.id + " has no resolvable session scope");
      await writeScopedRows(client,
        "insert into ai_turns(id, organization_id, unit_id, workspace_id, session_id, prompt, response, status, model, input_tokens, output_tokens, references_json, usage_record_id, provenance_json, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14::jsonb, $15) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, session_id = excluded.session_id, prompt = excluded.prompt, response = excluded.response, status = excluded.status, model = excluded.model, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens, references_json = excluded.references_json, usage_record_id = excluded.usage_record_id, provenance_json = excluded.provenance_json",
        [write.record], () => ({ unitId: session.unitId, workspaceId: session.workspaceId }),
        (row) => [row.id, session.organizationId, session.unitId, session.workspaceId, row.sessionId, row.prompt, row.response, row.status, row.model, row.inputTokens, row.outputTokens, JSON.stringify(row.references), row.usage?.id ?? null, JSON.stringify(row.provenance ?? {}), row.createdAt]);
      return;
    }
    case "aiDrafts": {
      const session = snapshot.aiSessions.find((candidate) => candidate.id === write.record.sessionId);
      if (!session) throw corruption("ai draft " + write.record.id + " has no resolvable session scope");
      await writeScopedRows(client,
        "insert into ai_drafts(id, organization_id, unit_id, workspace_id, session_id, encounter_id, draft_type, content, source_turn_id, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, session_id = excluded.session_id, encounter_id = excluded.encounter_id, draft_type = excluded.draft_type, content = excluded.content, source_turn_id = excluded.source_turn_id, status = excluded.status",
        [write.record], () => ({ unitId: session.unitId, workspaceId: session.workspaceId }),
        (row) => [row.id, session.organizationId, session.unitId, session.workspaceId, row.sessionId, row.encounterId, row.draftType, row.content, row.sourceTurnId, row.status, row.createdAt]);
      return;
    }
    case "aiApprovals":
      await writeScopedRows(client,
        "insert into ai_approvals(id, organization_id, actor_id, session_id, turn_id, tool_name, resource_id, patient_id, encounter_id, unit_id, workspace_id, purpose, request_digest, policy_revision, expires_at, decision, decided_by, reason, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) on conflict (id) do update set organization_id = excluded.organization_id, actor_id = excluded.actor_id, session_id = excluded.session_id, turn_id = excluded.turn_id, tool_name = excluded.tool_name, resource_id = excluded.resource_id, patient_id = excluded.patient_id, encounter_id = excluded.encounter_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, purpose = excluded.purpose, request_digest = excluded.request_digest, policy_revision = excluded.policy_revision, expires_at = excluded.expires_at, decision = excluded.decision, decided_by = excluded.decided_by, reason = excluded.reason",
        [write.record], (row) => ({ unitId: row.unitId, workspaceId: row.workspaceId }),
        (row) => [row.id, row.organizationId, row.actorId, row.sessionId, row.turnId, row.toolName, row.resourceId, row.patientId, row.encounterId, row.unitId, row.workspaceId, row.purpose, row.requestDigest, row.policyRevision, row.expiresAt, row.decision, row.decidedBy, row.reason, row.createdAt]);
      return;
    case "budgetReservations":
      await writeRows(client,
        "insert into budget_reservations(id, organization_id, session_id, category, reserved_units, consumed_units, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do update set organization_id = excluded.organization_id, session_id = excluded.session_id, category = excluded.category, reserved_units = excluded.reserved_units, consumed_units = excluded.consumed_units, status = excluded.status",
        [write.record], (row) => [row.id, row.organizationId, row.sessionId, row.category, row.reservedUnits, row.consumedUnits, row.status, row.createdAt]);
      return;
    default:
      throw corruption("AUD27 normalized write has an unsupported snapshot key " + (write as { snapshotKey: string }).snapshotKey);
  }
}

/**
 * AUD27-011: removals are an explicit relational operation. The reverse
 * dependency order is owned by the transaction projector; this function owns
 * the tenant-scoped SQL shape for every residual slice.
 */
export async function removeAud27DomainRecord(client: PoolClient, removal: Aud27RemovedDomainRecord): Promise<void> {
  await client.query("select set_config('cvg.unit_id', $1, true)", [removal.unitId ?? ""]);
  await client.query("select set_config('cvg.workspace_id', $1, true)", [removal.workspaceId ?? ""]);
  await client.query(`delete from ${AUD27_TABLE_BY_KEY[removal.snapshotKey]} where id = $1 and organization_id = cvg_request_organization()`, [removal.id]);
}
