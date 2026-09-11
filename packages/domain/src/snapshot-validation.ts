import { AUTHORITATIVE_DOMAIN_REGISTRY } from "@cvg/contracts";
import type { OpaqueId } from "@cvg/contracts";
import type { StoreSnapshot } from "./index.js";

export type SnapshotViolation = (message: string) => never;
type SnapshotCollectionKey = (typeof AUTHORITATIVE_DOMAIN_REGISTRY)[number]["snapshotKey"];

const SNAPSHOT_ARRAY_KEYS = [
  "organizations", "units", "workspaces", "users", "roleAssignments", "sessions", "auditRecords", "commandReceipts",
  "guardians", "patients", "providers", "services", "resources", "appointments", "queueEntries", "encounters",
  "clinicalDocuments", "clinicalAddenda", "diagnosticRequests", "specimens", "diagnosticResults", "hospitalEpisodes",
  "beds", "medicationOrders", "dispensations", "products", "lots", "stockLocations", "stockMovements", "charges",
  "payments", "ledgerEntries", "messages", "knowledgeDocuments", "aiSessions", "aiTurns", "aiDrafts", "aiApprovals",
  "budgetReservations", "administrationOccurrences", "authChallenges", "quarantined"
] as const satisfies ReadonlyArray<Exclude<keyof StoreSnapshot, "healthStatus">>;

const SNAPSHOT_FIELDS = new Set<string>(["healthStatus", ...SNAPSHOT_ARRAY_KEYS]);

export function validateSnapshotSemantics(snapshot: StoreSnapshot, violation: SnapshotViolation): void {
  const record = snapshot as unknown as Record<string, unknown>;
  const unknownField = Object.keys(record).find((field) => !SNAPSHOT_FIELDS.has(field));
  if (unknownField) violation(`campo de topo desconhecido ${unknownField}`);
  if (record.healthStatus !== "READY" && record.healthStatus !== "QUARANTINED") violation("healthStatus desconhecido");
  for (const field of SNAPSHOT_ARRAY_KEYS) {
    if (!Array.isArray(record[field])) violation(`${field} deve ser uma lista`);
    const ids = new Set<string>();
    for (const row of record[field] as unknown[]) {
      const id = row && typeof row === "object" ? (row as { id?: unknown }).id : undefined;
      if (typeof id !== "string" || id.length === 0) violation(`${field} contém recurso sem id válido`);
      if (ids.has(id)) violation(`${field} contains duplicate id ${id}`);
      ids.add(id);
    }
  }
  const organizations = new Map(snapshot.organizations.map((row) => [row.id, row]));
  const units = new Map(snapshot.units.map((row) => [row.id, row]));
  const workspaces = new Map(snapshot.workspaces.map((row) => [row.id, row]));
  const users = new Map(snapshot.users.map((row) => [row.id, row]));
  const guardians = new Map(snapshot.guardians.map((row) => [row.id, row]));
  const patients = new Map(snapshot.patients.map((row) => [row.id, row]));
  const providers = new Map(snapshot.providers.map((row) => [row.id, row]));
  const services = new Map(snapshot.services.map((row) => [row.id, row]));
  const resources = new Map(snapshot.resources.map((row) => [row.id, row]));
  const appointments = new Map(snapshot.appointments.map((row) => [row.id, row]));
  const encounters = new Map(snapshot.encounters.map((row) => [row.id, row]));
  const diagnosticRequests = new Map(snapshot.diagnosticRequests.map((row) => [row.id, row]));
  const specimens = new Map(snapshot.specimens.map((row) => [row.id, row]));
  const diagnosticResults = new Map(snapshot.diagnosticResults.map((row) => [row.id, row]));
  const beds = new Map(snapshot.beds.map((row) => [row.id, row]));
  const episodes = new Map(snapshot.hospitalEpisodes.map((row) => [row.id, row]));
  const products = new Map(snapshot.products.map((row) => [row.id, row]));
  const locations = new Map(snapshot.stockLocations.map((row) => [row.id, row]));
  const lots = new Map(snapshot.lots.map((row) => [row.id, row]));
  const orders = new Map(snapshot.medicationOrders.map((row) => [row.id, row]));
  const charges = new Map(snapshot.charges.map((row) => [row.id, row]));
  const payments = new Map(snapshot.payments.map((row) => [row.id, row]));
  const aiSessions = new Map(snapshot.aiSessions.map((row) => [row.id, row]));
  const aiTurns = new Map(snapshot.aiTurns.map((row) => [row.id, row]));

  const same = (left: unknown, right: unknown, label: string): void => {
    if (left !== right) violation(`${label} mismatch`);
  };
  const exists = <T>(map: Map<string, T>, key: string | null | undefined, label: string): T => {
    if (!key || !map.has(key)) violation(`${label} ${key ?? "<empty>"} is not present`);
    return map.get(key)!;
  };
  const org = (row: { organizationId: OpaqueId }, label: string): void => { exists(organizations, row.organizationId, `${label}.organization`); };
  const scopePair = (row: { unitId: OpaqueId | null; workspaceId: OpaqueId | null }, label: string): void => {
    if ((row.unitId === null) !== (row.workspaceId === null)) violation(`${label} has no complete unit/workspace scope (partial scope)`);
    if (row.unitId) {
      const unit = exists(units, row.unitId, `${label}.unit`);
      const workspace = exists(workspaces, row.workspaceId, `${label}.workspace`);
      const organizationId = (row as unknown as { organizationId: OpaqueId }).organizationId;
      same(unit.organizationId, organizationId, `${label}.unit.organization`);
      same(workspace.organizationId, organizationId, `${label}.workspace.organization`);
      same(workspace.unitId, row.unitId, `${label}.workspace.unit`);
    }
  };
  const scopeEquals = (child: { unitId: OpaqueId | null; workspaceId: OpaqueId | null }, parent: { unitId: OpaqueId | null; workspaceId: OpaqueId | null }, label: string): void => {
    same(child.unitId, parent.unitId, `${label}.unit`);
    same(child.workspaceId, parent.workspaceId, `${label}.workspace`);
  };
  const parentOrg = (child: { organizationId: OpaqueId }, parent: { organizationId: OpaqueId }, label: string): void => same(child.organizationId, parent.organizationId, `${label}.organization`);

  for (const collection of AUTHORITATIVE_DOMAIN_REGISTRY) {
    // Child rows without a denormalized organization_id derive it from their
    // session/document parent and are checked below with that parent.
    if (collection.snapshotKey === "clinicalAddenda" || collection.snapshotKey === "aiTurns" || collection.snapshotKey === "aiDrafts") continue;
    const rows = snapshot[collection.snapshotKey as SnapshotCollectionKey] as Array<{ id: OpaqueId; organizationId?: OpaqueId }>;
    for (const row of rows) {
      if (row.organizationId) org(row as { organizationId: OpaqueId }, collection.snapshotKey);
    }
  }
  for (const unit of snapshot.units) org(unit, "unit");
  for (const workspace of snapshot.workspaces) {
    org(workspace, "workspace");
    same(exists(units, workspace.unitId, "workspace.unit").organizationId, workspace.organizationId, "workspace.unit.organization");
  }
  for (const user of snapshot.users) org(user, "user");
  const auditRecords = new Map(snapshot.auditRecords.map((row) => [row.id, row]));
  for (const audit of snapshot.auditRecords) {
    if (audit.actorId) parentOrg(audit, exists(users, audit.actorId, "audit.actor"), "audit.actor");
  }
  for (const receipt of snapshot.commandReceipts) {
    org(receipt, "commandReceipt");
    parentOrg(receipt, exists(users, receipt.actorId, "commandReceipt.actor"), "commandReceipt.actor");
    if (receipt.auditRecordId) parentOrg(receipt, exists(auditRecords, receipt.auditRecordId, "commandReceipt.audit"), "commandReceipt.audit");
  }
  for (const assignment of snapshot.roleAssignments) {
    org(assignment, "roleAssignment");
    parentOrg(assignment, exists(users, assignment.userId, "roleAssignment.user"), "roleAssignment.user");
    if (assignment.unitId) same(exists(units, assignment.unitId, "roleAssignment.unit").organizationId, assignment.organizationId, "roleAssignment.unit.organization");
    if (assignment.workspaceId) {
      const workspace = exists(workspaces, assignment.workspaceId, "roleAssignment.workspace");
      same(workspace.organizationId, assignment.organizationId, "roleAssignment.workspace.organization");
      same(workspace.unitId, assignment.unitId, "roleAssignment.workspace.unit");
    }
  }
  for (const session of snapshot.sessions) parentOrg(session, exists(users, session.userId, "session.user"), "session.user");
  for (const challenge of snapshot.authChallenges) parentOrg(challenge, exists(users, challenge.userId, "authChallenge.user"), "authChallenge.user");
  for (const guardian of snapshot.guardians) scopePair(guardian, "guardian");
  for (const patient of snapshot.patients) {
    scopePair(patient, "patient");
    const guardian = exists(guardians, patient.guardianId, "patient.guardian");
    parentOrg(patient, guardian, "patient.guardian");
    scopeEquals(patient, guardian, "patient.guardian");
    if (patient.mergedIntoId) {
      const target = exists(patients, patient.mergedIntoId, "patient.mergedInto");
      parentOrg(patient, target, "patient.mergedInto");
      scopeEquals(patient, target, "patient.mergedInto");
    }
  }
  for (const provider of snapshot.providers) {
    const unit = exists(units, provider.unitId, "provider.unit");
    same(unit.organizationId, provider.organizationId, "provider.unit.organization");
  }
  for (const service of snapshot.services) org(service, "service");
  for (const resource of snapshot.resources) same(exists(units, resource.unitId, "resource.unit").organizationId, resource.organizationId, "resource.unit.organization");
  for (const appointment of snapshot.appointments) {
    scopePair(appointment, "appointment");
    const patient = exists(patients, appointment.patientId, "appointment.patient");
    const provider = exists(providers, appointment.providerId, "appointment.provider");
    const service = exists(services, appointment.serviceId, "appointment.service");
    parentOrg(appointment, patient, "appointment.patient"); parentOrg(appointment, provider, "appointment.provider"); parentOrg(appointment, service, "appointment.service");
    scopeEquals(appointment, patient, "appointment.patient");
    same(provider.unitId, appointment.unitId, "appointment.provider.unit");
    if (appointment.resourceId) {
      const resource = exists(resources, appointment.resourceId, "appointment.resource");
      parentOrg(appointment, resource, "appointment.resource"); same(resource.unitId, appointment.unitId, "appointment.resource.unit");
    }
  }
  for (const entry of snapshot.queueEntries) {
    const patient = exists(patients, entry.patientId, "queue.patient"); parentOrg(entry, patient, "queue.patient");
    same(entry.unitId, patient.unitId, "queue.patient.unit");
    if (entry.appointmentId) { const appointment = exists(appointments, entry.appointmentId, "queue.appointment"); parentOrg(entry, appointment, "queue.appointment"); same(appointment.patientId, entry.patientId, "queue.appointment.patient"); same(appointment.unitId, entry.unitId, "queue.appointment.unit"); }
  }
  for (const encounter of snapshot.encounters) {
    scopePair(encounter, "encounter");
    const patient = exists(patients, encounter.patientId, "encounter.patient"); parentOrg(encounter, patient, "encounter.patient"); scopeEquals(encounter, patient, "encounter.patient");
    if (encounter.appointmentId) { const appointment = exists(appointments, encounter.appointmentId, "encounter.appointment"); parentOrg(encounter, appointment, "encounter.appointment"); scopeEquals(encounter, appointment, "encounter.appointment"); same(appointment.patientId, encounter.patientId, "encounter.appointment.patient"); }
  }
  for (const document of snapshot.clinicalDocuments) {
    const encounter = exists(encounters, document.encounterId, "clinical.encounter"); const patient = exists(patients, document.patientId, "clinical.patient"); const author = exists(users, document.authorId, "clinical.author");
    parentOrg(document, encounter, "clinical.encounter"); parentOrg(document, patient, "clinical.patient"); parentOrg(document, author, "clinical.author"); same(encounter.patientId, document.patientId, "clinical.patient"); scopeEquals(encounter, patient, "clinical.scope");
    if (document.signedBy) parentOrg(document, exists(users, document.signedBy, "clinical.signedBy"), "clinical.signedBy");
  }
  for (const addendum of snapshot.clinicalAddenda) { const document = exists(new Map(snapshot.clinicalDocuments.map((row) => [row.id, row])), addendum.documentId, "clinicalAddendum.document"); const author = exists(users, addendum.authorId, "clinicalAddendum.author"); same(author.organizationId, document.organizationId, "clinicalAddendum.author.organization"); }
  for (const request of snapshot.diagnosticRequests) {
    const patient = exists(patients, request.patientId, "diagnosticRequest.patient"); const requester = exists(users, request.requestedBy, "diagnosticRequest.requester"); parentOrg(request, patient, "diagnosticRequest.patient"); parentOrg(request, requester, "diagnosticRequest.requester");
    if (!request.encounterId) violation(`diagnosticRequest ${request.id} has no encounter`);
    const encounter = exists(encounters, request.encounterId, "diagnosticRequest.encounter"); parentOrg(request, encounter, "diagnosticRequest.encounter"); same(encounter.patientId, request.patientId, "diagnosticRequest.encounter.patient"); scopeEquals(encounter, patient, "diagnosticRequest.scope");
  }
  for (const specimen of snapshot.specimens) { const request = exists(diagnosticRequests, specimen.requestId, "specimen.request"); parentOrg(specimen, request, "specimen.request"); same(specimen.patientId, request.patientId, "specimen.request.patient"); }
  for (const result of snapshot.diagnosticResults) {
    if (result.status !== "RECEIVED" && result.status !== "VALID" && result.status !== "REJECTED") violation(`diagnosticResult ${result.id} has non-authoritative status ${result.status}`);
    const request = diagnosticRequests.get(result.requestId);
    const specimen = specimens.get(result.specimenId);
    if (!request || !specimen) violation(`diagnosticResult ${result.id} has no resolvable request/specimen parent`);
    parentOrg(result, request, "diagnosticResult.request"); parentOrg(result, specimen, "diagnosticResult.specimen"); same(specimen.requestId, request.id, "diagnosticResult.specimen.request"); same(result.patientId, request.patientId, "diagnosticResult.patient");
  }
  for (const bed of snapshot.beds) same(exists(units, bed.unitId, "bed.unit").organizationId, bed.organizationId, "bed.unit.organization");
  for (const episode of snapshot.hospitalEpisodes) { const patient = exists(patients, episode.patientId, "episode.patient"); parentOrg(episode, patient, "episode.patient"); same(exists(units, episode.unitId, "episode.unit").organizationId, episode.organizationId, "episode.unit.organization"); same(episode.unitId, patient.unitId, "episode.patient.unit"); if (episode.encounterId) { const encounter = exists(encounters, episode.encounterId, "episode.encounter"); parentOrg(episode, encounter, "episode.encounter"); same(encounter.patientId, episode.patientId, "episode.encounter.patient"); same(encounter.unitId, episode.unitId, "episode.encounter.unit"); } if (episode.bedId) { const bed = exists(beds, episode.bedId, "episode.bed"); parentOrg(episode, bed, "episode.bed"); same(bed.unitId, episode.unitId, "episode.bed.unit"); } }
  for (const product of snapshot.products) org(product, "product");
  for (const location of snapshot.stockLocations) same(exists(units, location.unitId, "stockLocation.unit").organizationId, location.organizationId, "stockLocation.unit.organization");
  for (const lot of snapshot.lots) { const product = exists(products, lot.productId, "lot.product"); const location = exists(locations, lot.locationId, "lot.location"); parentOrg(lot, product, "lot.product"); parentOrg(lot, location, "lot.location"); }
  for (const movement of snapshot.stockMovements) { const lot = exists(lots, movement.lotId, "stockMovement.lot"); const product = exists(products, movement.productId, "stockMovement.product"); const location = exists(locations, movement.locationId, "stockMovement.location"); const creator = exists(users, movement.createdBy, "stockMovement.createdBy"); parentOrg(movement, lot, "stockMovement.lot"); parentOrg(movement, product, "stockMovement.product"); parentOrg(movement, location, "stockMovement.location"); parentOrg(movement, creator, "stockMovement.createdBy"); same(lot.productId, movement.productId, "stockMovement.lot.product"); same(lot.locationId, movement.locationId, "stockMovement.lot.location"); }
  for (const order of snapshot.medicationOrders) { const patient = exists(patients, order.patientId, "medication.patient"); const product = exists(products, order.productId, "medication.product"); const prescriber = exists(users, order.prescribedBy, "medication.prescriber"); parentOrg(order, patient, "medication.patient"); parentOrg(order, product, "medication.product"); parentOrg(order, prescriber, "medication.prescriber"); if (!order.encounterId) violation(`medication ${order.id} has no encounter`); const encounter = exists(encounters, order.encounterId, "medication.encounter"); parentOrg(order, encounter, "medication.encounter"); same(encounter.patientId, order.patientId, "medication.encounter.patient"); scopeEquals(encounter, patient, "medication.scope"); }
  for (const dispensation of snapshot.dispensations) { const order = exists(orders, dispensation.medicationOrderId, "dispensation.order"); const lot = exists(lots, dispensation.lotId, "dispensation.lot"); const product = exists(products, lot.productId, "dispensation.product"); const dispenser = exists(users, dispensation.dispensedBy, "dispensation.dispensedBy"); parentOrg(dispensation, order, "dispensation.order"); parentOrg(dispensation, lot, "dispensation.lot"); parentOrg(dispensation, dispenser, "dispensation.dispensedBy"); parentOrg(dispensation, product, "dispensation.product"); same(order.productId, lot.productId, "dispensation.order.product"); }
  for (const occurrence of snapshot.administrationOccurrences) { const order = exists(orders, occurrence.medicationOrderId, "administration.order"); const administrator = exists(users, occurrence.administeredBy, "administration.administeredBy"); parentOrg(occurrence, order, "administration.order"); parentOrg(occurrence, administrator, "administration.administeredBy"); }
  for (const charge of snapshot.charges) { const unit = exists(units, charge.unitId, "charge.unit"); same(unit.organizationId, charge.organizationId, "charge.unit.organization"); if (charge.patientId) parentOrg(charge, exists(patients, charge.patientId, "charge.patient"), "charge.patient"); }
  for (const payment of snapshot.payments) { const charge = exists(charges, payment.chargeId, "payment.charge"); parentOrg(payment, charge, "payment.charge"); }
  for (const entry of snapshot.ledgerEntries) { if (entry.kind === "CHARGE") parentOrg(entry, exists(charges, entry.referenceId, "ledger.charge"), "ledger.charge"); if (entry.kind === "PAYMENT" || entry.kind === "REFUND") parentOrg(entry, exists(payments, entry.referenceId, "ledger.payment"), "ledger.payment"); }
  for (const message of snapshot.messages) { scopePair(message, "message"); if (message.patientId) { const patient = exists(patients, message.patientId, "message.patient"); parentOrg(message, patient, "message.patient"); scopeEquals(message, patient, "message.patient.scope"); } if (message.createdBy) parentOrg(message, exists(users, message.createdBy, "message.createdBy"), "message.createdBy"); if (message.decidedBy) parentOrg(message, exists(users, message.decidedBy, "message.decidedBy"), "message.decidedBy"); if (message.approvedBy) parentOrg(message, exists(users, message.approvedBy, "message.approvedBy"), "message.approvedBy"); }
  for (const document of snapshot.knowledgeDocuments) { scopePair(document, "knowledge"); if (document.unitId) same(exists(workspaces, document.workspaceId, "knowledge.workspace").unitId, document.unitId, "knowledge.workspace.unit"); }
  for (const session of snapshot.aiSessions) { scopePair(session, "aiSession"); parentOrg(session, exists(users, session.actorId, "aiSession.actor"), "aiSession.actor"); if (session.patientId) { const patient = exists(patients, session.patientId, "aiSession.patient"); parentOrg(session, patient, "aiSession.patient"); scopeEquals(session, patient, "aiSession.patient.scope"); } if (session.encounterId) { const encounter = exists(encounters, session.encounterId, "aiSession.encounter"); parentOrg(session, encounter, "aiSession.encounter"); scopeEquals(session, encounter, "aiSession.encounter.scope"); } }
  for (const turn of snapshot.aiTurns) {
    const session = exists(aiSessions, turn.sessionId, "aiTurn.session");
    if (turn.usage && turn.provenance?.usageRecordId !== turn.usage.id) violation(`aiTurn ${turn.id} usage provenance mismatch`);
    if ((turn.usage === undefined) !== (turn.provenance === undefined)) violation(`aiTurn ${turn.id} has incomplete provenance/usage`);
    if (turn.usage?.settlement && (turn.usage.settlement.model !== turn.model || turn.usage.settlement.inputTokens !== turn.inputTokens || turn.usage.settlement.outputTokens !== turn.outputTokens)) violation(`aiTurn ${turn.id} usage settlement does not match the canonical turn usage`);
    void session;
  }
  for (const draft of snapshot.aiDrafts) { const session = exists(aiSessions, draft.sessionId, "aiDraft.session"); const turn = exists(aiTurns, draft.sourceTurnId, "aiDraft.sourceTurn"); same(turn.sessionId, draft.sessionId, "aiDraft.sourceTurn.session"); if (draft.encounterId) { const encounter = exists(encounters, draft.encounterId, "aiDraft.encounter"); same(encounter.organizationId, session.organizationId, "aiDraft.encounter.organization"); same(encounter.unitId, session.unitId, "aiDraft.encounter.unit"); same(encounter.workspaceId, session.workspaceId, "aiDraft.encounter.workspace"); } }
  for (const approval of snapshot.aiApprovals) {
    const session = exists(aiSessions, approval.sessionId, "aiApproval.session");
    const turn = exists(aiTurns, approval.turnId, "aiApproval.turn");
    const actor = exists(users, approval.actorId, "aiApproval.actor");
    parentOrg(approval, session, "aiApproval.session");
    parentOrg(approval, actor, "aiApproval.actor");
    same(turn.sessionId, approval.sessionId, "aiApproval.turn.session");
    same(approval.actorId, session.actorId, "aiApproval.actor");
    if (approval.patientId) parentOrg(approval, exists(patients, approval.patientId, "aiApproval.patient"), "aiApproval.patient");
    if (approval.encounterId) parentOrg(approval, exists(encounters, approval.encounterId, "aiApproval.encounter"), "aiApproval.encounter");
    if (approval.unitId) parentOrg(approval, exists(units, approval.unitId, "aiApproval.unit"), "aiApproval.unit");
    if (approval.workspaceId) parentOrg(approval, exists(workspaces, approval.workspaceId, "aiApproval.workspace"), "aiApproval.workspace");
    if (approval.decidedBy) parentOrg(approval, exists(users, approval.decidedBy, "aiApproval.decidedBy"), "aiApproval.decidedBy");
  }
  for (const reservation of snapshot.budgetReservations) { const session = exists(aiSessions, reservation.sessionId, "budget.session"); parentOrg(reservation, session, "budget.session"); }
}
