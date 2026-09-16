import type { CvgContext, OpaqueId } from "@cvg/contracts";
import type { CvgStore, StoreSnapshot } from "@cvg/domain";
import { enforceApplicationPolicy } from "@cvg/agent-policy";

/**
 * Application command boundary for the domain. The HTTP layer may select and
 * serialize a use case, but it cannot invoke a domain mutation directly.
 * Persistence durability is committed by the request transaction hook after
 * this service returns.
 */
export class DomainCommandService {
  constructor(private readonly store: CvgStore) {}

  grantRole(context: CvgContext, input: Parameters<CvgStore["grantRole"]>[1]): ReturnType<CvgStore["grantRole"]> {
    return this.run(context, "role.grant", () => this.store.grantRole(context, input));
  }

  revokeRole(context: CvgContext, assignmentId: OpaqueId, expectedRevision: string): ReturnType<CvgStore["revokeRole"]> {
    return this.run(context, "role.revoke", () => this.store.revokeRole(context, assignmentId, expectedRevision));
  }

  createGuardian(context: CvgContext, input: Parameters<CvgStore["createGuardian"]>[1]): ReturnType<CvgStore["createGuardian"]> {
    return this.run(context, "guardians.create", () => this.store.createGuardian(context, input));
  }

  disablePatient(context: CvgContext, patientId: OpaqueId): ReturnType<CvgStore["disablePatient"]> {
    return this.run(context, "patients.disable", () => this.store.disablePatient(context, patientId));
  }

  mergePatients(context: CvgContext, input: Parameters<CvgStore["mergePatients"]>[1]): ReturnType<CvgStore["mergePatients"]> {
    return this.run(context, "patients.merge", () => this.store.mergePatients(context, input));
  }

  createAppointment(context: CvgContext, input: Parameters<CvgStore["createAppointment"]>[1]): ReturnType<CvgStore["createAppointment"]> {
    return this.run(context, "appointments.create", () => this.store.createAppointment(context, input));
  }

  checkInAppointment(context: CvgContext, appointmentId: OpaqueId): ReturnType<CvgStore["checkInAppointment"]> {
    return this.run(context, "queue.check-in", () => this.store.checkInAppointment(context, appointmentId));
  }

  confirmAppointment(context: CvgContext, appointmentId: OpaqueId, expectedVersion?: number | null): ReturnType<CvgStore["confirmAppointment"]> {
    return this.run(context, "appointments.confirm", () => this.store.confirmAppointment(context, appointmentId, expectedVersion));
  }

  cancelAppointment(context: CvgContext, appointmentId: OpaqueId, reason: string, expectedVersion?: number | null): ReturnType<CvgStore["cancelAppointment"]> {
    return this.run(context, "appointments.cancel", () => this.store.cancelAppointment(context, appointmentId, reason, expectedVersion));
  }

  rescheduleAppointment(context: CvgContext, appointmentId: OpaqueId, input: Parameters<CvgStore["rescheduleAppointment"]>[2]): ReturnType<CvgStore["rescheduleAppointment"]> {
    return this.run(context, "appointments.reschedule", () => this.store.rescheduleAppointment(context, appointmentId, input));
  }

  triageQueueEntry(context: CvgContext, queueEntryId: OpaqueId, priority: Parameters<CvgStore["triageQueueEntry"]>[2]): ReturnType<CvgStore["triageQueueEntry"]> {
    return this.run(context, "queue.triage", () => this.store.triageQueueEntry(context, queueEntryId, priority));
  }

  handoffQueueEntry(context: CvgContext, queueEntryId: OpaqueId, input: Parameters<CvgStore["handoffQueueEntry"]>[2]): ReturnType<CvgStore["handoffQueueEntry"]> {
    return this.run(context, "queue.handoff", () => this.store.handoffQueueEntry(context, queueEntryId, input));
  }

  createEncounter(context: CvgContext, input: Parameters<CvgStore["createEncounter"]>[1]): ReturnType<CvgStore["createEncounter"]> {
    return this.run(context, "encounters.create", () => this.store.createEncounter(context, input));
  }

  createClinicalDocument(context: CvgContext, input: Parameters<CvgStore["createClinicalDocument"]>[1]): ReturnType<CvgStore["createClinicalDocument"]> {
    return this.run(context, "clinical.write", () => this.store.createClinicalDocument(context, input));
  }

  updateClinicalDraft(context: CvgContext, documentId: OpaqueId, input: Parameters<CvgStore["updateClinicalDraft"]>[2]): ReturnType<CvgStore["updateClinicalDraft"]> {
    return this.run(context, "clinical.write", () => this.store.updateClinicalDraft(context, documentId, input));
  }

  reviewClinicalDocument(context: CvgContext, documentId: OpaqueId, expectedVersion: string | null): ReturnType<CvgStore["reviewClinicalDocument"]> {
    return this.run(context, "clinical.draft", () => this.store.reviewClinicalDocument(context, documentId, expectedVersion));
  }

  signClinicalDocument(context: CvgContext, documentId: OpaqueId, expectedVersion: string | null = null): ReturnType<CvgStore["signClinicalDocument"]> {
    return this.run(context, "clinical.sign", () => this.store.signClinicalDocument(context, documentId, expectedVersion));
  }

  addClinicalAddendum(context: CvgContext, documentId: OpaqueId, reason: string, content: string): ReturnType<CvgStore["addClinicalAddendum"]> {
    return this.run(context, "clinical.addendum", () => this.store.addClinicalAddendum(context, documentId, reason, content));
  }

  createDiagnosticRequest(context: CvgContext, input: Parameters<CvgStore["createDiagnosticRequest"]>[1]): ReturnType<CvgStore["createDiagnosticRequest"]> {
    return this.run(context, "diagnostics.create", () => this.store.createDiagnosticRequest(context, input));
  }

  createSpecimen(context: CvgContext, requestId: OpaqueId, label: string): ReturnType<CvgStore["createSpecimen"]> {
    return this.run(context, "diagnostics.specimen", () => this.store.createSpecimen(context, requestId, label));
  }

  createResult(context: CvgContext, input: Parameters<CvgStore["createResult"]>[1]): ReturnType<CvgStore["createResult"]> {
    return this.run(context, "diagnostics.result", () => this.store.createResult(context, input));
  }

  reviewDiagnosticRequest(context: CvgContext, requestId: OpaqueId): ReturnType<CvgStore["reviewDiagnosticRequest"]> {
    return this.run(context, "diagnostics.review", () => this.store.reviewDiagnosticRequest(context, requestId));
  }

  createHospitalEpisode(context: CvgContext, input: Parameters<CvgStore["createHospitalEpisode"]>[1]): ReturnType<CvgStore["createHospitalEpisode"]> {
    return this.run(context, "hospitalization.create", () => this.store.createHospitalEpisode(context, input));
  }

  createMedicationOrder(context: CvgContext, input: Parameters<CvgStore["createMedicationOrder"]>[1]): ReturnType<CvgStore["createMedicationOrder"]> {
    return this.run(context, "medication.prescribe", () => this.store.createMedicationOrder(context, input));
  }

  dispenseMedication(context: CvgContext, medicationOrderId: OpaqueId, lotId: OpaqueId, quantity: number): ReturnType<CvgStore["dispenseMedication"]> {
    return this.run(context, "medication.dispense", () => this.store.dispenseMedication(context, medicationOrderId, lotId, quantity));
  }

  administerMedication(context: CvgContext, medicationOrderId: OpaqueId, status: Parameters<CvgStore["administerMedication"]>[2], note: string | null): ReturnType<CvgStore["administerMedication"]> {
    return this.run(context, "medication.administer", () => this.store.administerMedication(context, medicationOrderId, status, note));
  }

  updateHospitalEpisodeStatus(context: CvgContext, episodeId: OpaqueId, status: Parameters<CvgStore["updateHospitalEpisodeStatus"]>[2]): ReturnType<CvgStore["updateHospitalEpisodeStatus"]> {
    return this.run(context, "hospitalization.update", () => this.store.updateHospitalEpisodeStatus(context, episodeId, status));
  }

  dischargeHospitalEpisode(context: CvgContext, episodeId: OpaqueId): ReturnType<CvgStore["dischargeHospitalEpisode"]> {
    return this.run(context, "hospitalization.discharge", () => this.store.dischargeHospitalEpisode(context, episodeId));
  }

  updateMedicationOrderStatus(context: CvgContext, medicationOrderId: OpaqueId, status: Parameters<CvgStore["updateMedicationOrderStatus"]>[2]): ReturnType<CvgStore["updateMedicationOrderStatus"]> {
    return this.run(context, "medication.update", () => this.store.updateMedicationOrderStatus(context, medicationOrderId, status));
  }

  createStockMovement(context: CvgContext, input: Parameters<CvgStore["createStockMovement"]>[1]): ReturnType<CvgStore["createStockMovement"]> {
    return this.run(context, "stock.write", () => this.store.createStockMovement(context, input));
  }

  createProduct(context: CvgContext, input: Parameters<CvgStore["createProduct"]>[1]): ReturnType<CvgStore["createProduct"]> {
    return this.run(context, "stock.write", () => this.store.createProduct(context, input));
  }

  createLot(context: CvgContext, input: Parameters<CvgStore["createLot"]>[1]): ReturnType<CvgStore["createLot"]> {
    return this.run(context, "stock.write", () => this.store.createLot(context, input));
  }

  adjustStockInventory(context: CvgContext, input: Parameters<CvgStore["adjustStockInventory"]>[1]): ReturnType<CvgStore["adjustStockInventory"]> {
    return this.run(context, "stock.inventory", () => this.store.adjustStockInventory(context, input));
  }

  createCharge(context: CvgContext, input: Parameters<CvgStore["createCharge"]>[1]): ReturnType<CvgStore["createCharge"]> {
    return this.run(context, "finance.charge", () => this.store.createCharge(context, input));
  }

  createPayment(context: CvgContext, input: Parameters<CvgStore["createPayment"]>[1]): ReturnType<CvgStore["createPayment"]> {
    return this.run(context, "finance.payment", () => this.store.createPayment(context, input));
  }

  requestRefund(context: CvgContext, paymentId: OpaqueId, reason: string): ReturnType<CvgStore["requestRefund"]> {
    return this.run(context, "finance.refund", () => this.store.requestRefund(context, paymentId, reason));
  }

  createKnowledgeDocument(context: CvgContext, input: Parameters<CvgStore["createKnowledgeDocument"]>[1]): ReturnType<CvgStore["createKnowledgeDocument"]> {
    return this.run(context, "knowledge.write", () => this.store.createKnowledgeDocument(context, input));
  }

  approveKnowledgeDocument(context: CvgContext, documentId: OpaqueId, expectedVersion: number | null = null): ReturnType<CvgStore["approveKnowledgeDocument"]> {
    return this.run(context, "knowledge.approve", () => this.store.approveKnowledgeDocument(context, documentId, expectedVersion));
  }

  indexKnowledgeDocument(context: CvgContext, documentId: OpaqueId, expectedVersion: number | null = null): ReturnType<CvgStore["indexKnowledgeDocument"]> {
    return this.run(context, "knowledge.index", () => this.store.indexKnowledgeDocument(context, documentId, expectedVersion));
  }

  quarantineKnowledgeDocument(context: CvgContext, documentId: OpaqueId, reason: string, expectedVersion: number | null = null): ReturnType<CvgStore["quarantineKnowledgeDocument"]> {
    return this.run(context, "knowledge.quarantine", () => this.store.quarantineKnowledgeDocument(context, documentId, reason, expectedVersion));
  }

  createMessage(context: CvgContext, input: Parameters<CvgStore["createMessage"]>[1]): ReturnType<CvgStore["createMessage"]> {
    return this.run(context, "communication.stage", () => this.store.createMessage(context, input));
  }

  decideMessage(context: CvgContext, messageId: OpaqueId, decision: "approved" | "rejected", reason: string | null): ReturnType<CvgStore["decideMessage"]> {
    return this.run(context, "communication.approve", () => this.store.decideMessage(context, messageId, decision, reason));
  }

  restore(context: CvgContext, snapshot: StoreSnapshot): void {
    this.authorize(context, "ops.restore");
    this.store.restore(snapshot);
  }

  private run<T>(context: CvgContext, operation: string, command: () => T): T {
    this.authorize(context, operation);
    return command();
  }

  private authorize(context: CvgContext, operation: string): void {
    enforceApplicationPolicy(context, operation);
    this.store.validateContext(context);
  }
}
