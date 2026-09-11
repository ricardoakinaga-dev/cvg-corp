import type { AiSession, AnimalPatient, Appointment, AuditRecord, Bed, Charge, ClinicalDocument, CommunicationMessage, ContextSelector, CvgContext, DiagnosticRequest, DiagnosticResult, Encounter, Guardian, HospitalEpisode, KnowledgeDocument, LedgerEntry, Lot, MedicationOrder, OpaqueId, Payment, Product, QueueEntry, Specimen, StockLocation, User } from "@cvg/contracts";
import type { ContextOption, CvgStore, PublicUser } from "@cvg/domain";
import type { NormalizedAiSessionRead, NormalizedAppointmentRead, NormalizedEncounterRead, NormalizedMedicationOrderRead, NormalizedQueueRead, NormalizedStockRead, PostgresPersistence } from "@cvg/persistence";
import { enforceApplicationPolicy } from "@cvg/agent-policy";

export type PatientRead = AnimalPatient & { guardian: Pick<Guardian, "id" | "displayName" | "phone"> | null };
export type AppointmentRead = Appointment & { patient: { id: OpaqueId; name: string } | null; provider: string | null };
export type EncounterRead = Encounter & { patient: { id: OpaqueId; name: string } };
export type MedicationOrderRead = MedicationOrder & { product: Pick<Product, "id" | "name" | "unit"> | null };
export type StockRead = Lot & { product: Product | null; location: StockLocation | null };
export type QueueRead = QueueEntry & { patient: { id: OpaqueId; name: string } | null };
export type AiSessionRead = AiSession & { turns: number };

export interface GuardianReadRepository {
  list(context: CvgContext, query?: string): Promise<Guardian[]>;
}

export interface AppointmentReadRepository {
  list(context: CvgContext, range?: "today" | "week"): Promise<AppointmentRead[]>;
}

export interface AuditRepository {
  list(context: CvgContext, limit?: number, cursor?: string | null): Promise<AuditRecord[]>;
}

export interface EncounterRepository {
  list(context: CvgContext): Promise<EncounterRead[]>;
}

export interface ClinicalRepository {
  list(context: CvgContext): Promise<ClinicalDocument[]>;
}

export interface DiagnosticReadRepository {
  listRequests(context: CvgContext): Promise<DiagnosticRequest[]>;
  listSpecimens(context: CvgContext): Promise<Specimen[]>;
  listResults(context: CvgContext): Promise<DiagnosticResult[]>;
}

export interface HospitalizationReadRepository {
  listBeds(context: CvgContext): Promise<Bed[]>;
  listEpisodes(context: CvgContext): Promise<HospitalEpisode[]>;
}

export interface MedicationReadRepository {
  listOrders(context: CvgContext): Promise<MedicationOrderRead[]>;
}

export interface StockReadRepository {
  list(context: CvgContext): Promise<StockRead[]>;
}

export interface FinanceReadRepository {
  listCharges(context: CvgContext, openOnly?: boolean): Promise<Charge[]>;
  listPayments(context: CvgContext): Promise<Payment[]>;
  listLedgerEntries(context: CvgContext): Promise<LedgerEntry[]>;
}

export interface CommunicationReadRepository {
  list(context: CvgContext): Promise<CommunicationMessage[]>;
}

export interface KnowledgeReadRepository {
  list(context: CvgContext): Promise<KnowledgeDocument[]>;
}

export interface QueueReadRepository {
  list(context: CvgContext): Promise<QueueRead[]>;
}

export interface AiSessionReadRepository {
  list(context: CvgContext): Promise<AiSessionRead[]>;
}

/**
 * Identity and context reads remain backed by the hydrated CvgStore until a
 * durable identity projection is introduced. Routes depend on this port so
 * authentication/context resolution does not become a route-to-store edge.
 */
export interface IdentityContextReadRepository {
  getUser(userId: OpaqueId): User;
  listContextOptions(userId: OpaqueId): ContextOption[];
  resolveContext(userId: OpaqueId, selector: ContextSelector, purpose: string, correlationId: string, patientId: OpaqueId | null, encounterId: OpaqueId | null, sessionId: OpaqueId | null): CvgContext;
  listUsers(context: CvgContext, query?: string): PublicUser[];
}

class StoreGuardianReadRepository implements GuardianReadRepository {
  constructor(private readonly store: CvgStore) {}

  async list(context: CvgContext, query = ""): Promise<Guardian[]> {
    return this.store.listGuardians(context, query);
  }
}

class PostgresGuardianReadRepository implements GuardianReadRepository {
  constructor(private readonly persistence: PostgresPersistence) {}

  list(context: CvgContext, query = ""): Promise<Guardian[]> {
    return this.persistence.listGuardians(context, query);
  }
}

class StoreAppointmentReadRepository implements AppointmentReadRepository {
  constructor(private readonly store: CvgStore) {}

  async list(context: CvgContext, range: "today" | "week" = "today"): Promise<AppointmentRead[]> {
    return this.store.listAppointments(context, range).map((appointment) => ({
      ...appointment,
      patient: this.store.patients.get(appointment.patientId) ? { id: appointment.patientId, name: this.store.patients.get(appointment.patientId)!.name } : null,
      provider: this.store.providers.get(appointment.providerId)?.displayName ?? null
    }));
  }
}

class PostgresAppointmentReadRepository implements AppointmentReadRepository {
  constructor(private readonly persistence: PostgresPersistence) {}

  async list(context: CvgContext, range: "today" | "week" = "today"): Promise<NormalizedAppointmentRead[]> {
    return this.persistence.listAppointments(context, range);
  }
}

class StoreAuditRepository implements AuditRepository {
  constructor(private readonly store: CvgStore) {}

  list(context: CvgContext, limit = 25, cursor: string | null = null): Promise<AuditRecord[]> {
    return Promise.resolve(this.store.listAudit(context, limit, cursor));
  }
}

class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly persistence: PostgresPersistence) {}

  list(context: CvgContext, limit = 25, cursor: string | null = null): Promise<AuditRecord[]> {
    return this.persistence.listAudit(context, limit, cursor);
  }
}

class StoreEncounterRepository implements EncounterRepository {
  constructor(private readonly store: CvgStore) {}

  async list(context: CvgContext): Promise<EncounterRead[]> {
    return this.store.listEncounters(context).map((encounter) => {
      const patient = this.store.patients.get(encounter.patientId);
      if (!patient) throw new Error(`encounter ${encounter.id} has no patient projection`);
      return { ...encounter, patient: { id: patient.id, name: patient.name } };
    });
  }
}

class PostgresEncounterRepository implements EncounterRepository {
  constructor(private readonly persistence: PostgresPersistence) {}

  list(context: CvgContext): Promise<NormalizedEncounterRead[]> {
    return this.persistence.listEncounters(context);
  }
}

class StoreClinicalRepository implements ClinicalRepository {
  constructor(private readonly store: CvgStore) {}

  async list(context: CvgContext): Promise<ClinicalDocument[]> {
    this.store.requireRole(context, ["admin", "veterinario"], "clinical:read");
    return [...this.store.clinicalDocuments.values()]
      .filter((document) => {
        const encounter = this.store.encounters.get(document.encounterId);
        return document.organizationId === context.organizationId && Boolean(encounter) && (!context.unitId || encounter!.unitId === context.unitId) && (!context.workspaceId || encounter!.workspaceId === context.workspaceId);
      })
      .map((document) => ({ ...document }));
  }
}

class PostgresClinicalRepository implements ClinicalRepository {
  constructor(private readonly persistence: PostgresPersistence) {}

  list(context: CvgContext): Promise<ClinicalDocument[]> {
    return this.persistence.listClinicalDocuments(context);
  }
}

class StoreDiagnosticReadRepository implements DiagnosticReadRepository {
  constructor(private readonly store: CvgStore) {}

  private inScope(context: CvgContext, encounterId: OpaqueId | null): boolean {
    const encounter = encounterId ? this.store.encounters.get(encounterId) : null;
    return Boolean(encounter) && encounter!.organizationId === context.organizationId && (!context.unitId || encounter!.unitId === context.unitId) && (!context.workspaceId || encounter!.workspaceId === context.workspaceId);
  }

  listRequests(context: CvgContext): Promise<DiagnosticRequest[]> {
    this.store.requireRole(context, ["admin", "veterinario"], "diagnostics:read");
    return Promise.resolve([...this.store.diagnosticRequests.values()].filter((request) => request.organizationId === context.organizationId && this.inScope(context, request.encounterId)).map((request) => ({ ...request })));
  }

  listSpecimens(context: CvgContext): Promise<Specimen[]> {
    this.store.requireRole(context, ["admin", "veterinario"], "diagnostics:read");
    return Promise.resolve([...this.store.specimens.values()].filter((specimen) => {
      const request = this.store.diagnosticRequests.get(specimen.requestId);
      return specimen.organizationId === context.organizationId && Boolean(request) && this.inScope(context, request!.encounterId);
    }).map((specimen) => ({ ...specimen })));
  }

  listResults(context: CvgContext): Promise<DiagnosticResult[]> {
    this.store.requireRole(context, ["admin", "veterinario"], "diagnostics:read");
    return Promise.resolve([...this.store.diagnosticResults.values()].filter((result) => {
      const request = this.store.diagnosticRequests.get(result.requestId);
      return result.organizationId === context.organizationId && Boolean(request) && this.inScope(context, request!.encounterId);
    }).map((result) => ({ ...result })));
  }
}

class PostgresDiagnosticReadRepository implements DiagnosticReadRepository {
  constructor(private readonly persistence: PostgresPersistence) {}

  listRequests(context: CvgContext): Promise<DiagnosticRequest[]> {
    return this.persistence.listDiagnosticRequests(context);
  }

  listSpecimens(context: CvgContext): Promise<Specimen[]> {
    return this.persistence.listSpecimens(context);
  }

  listResults(context: CvgContext): Promise<DiagnosticResult[]> {
    return this.persistence.listDiagnosticResults(context);
  }
}

class StoreHospitalizationReadRepository implements HospitalizationReadRepository {
  constructor(private readonly store: CvgStore) {}

  listBeds(context: CvgContext): Promise<Bed[]> {
    return Promise.resolve(this.store.listBeds(context));
  }

  listEpisodes(context: CvgContext): Promise<HospitalEpisode[]> {
    return Promise.resolve(this.store.listHospitalEpisodes(context));
  }
}

class PostgresHospitalizationReadRepository implements HospitalizationReadRepository {
  constructor(private readonly persistence: PostgresPersistence) {}

  listBeds(context: CvgContext): Promise<Bed[]> {
    return this.persistence.listBeds(context);
  }

  listEpisodes(context: CvgContext): Promise<HospitalEpisode[]> {
    return this.persistence.listHospitalEpisodes(context);
  }
}

class StoreMedicationReadRepository implements MedicationReadRepository {
  constructor(private readonly store: CvgStore) {}

  async listOrders(context: CvgContext): Promise<MedicationOrderRead[]> {
    return this.store.listMedicationOrders(context).map((order) => ({
      ...order,
      product: this.store.products.get(order.productId) ? { id: order.productId, name: this.store.products.get(order.productId)!.name, unit: this.store.products.get(order.productId)!.unit } : null
    }));
  }
}

class PostgresMedicationReadRepository implements MedicationReadRepository {
  constructor(private readonly persistence: PostgresPersistence) {}

  listOrders(context: CvgContext): Promise<NormalizedMedicationOrderRead[]> {
    return this.persistence.listMedicationOrders(context);
  }
}

class StoreStockReadRepository implements StockReadRepository {
  constructor(private readonly store: CvgStore) {}

  list(context: CvgContext): Promise<StockRead[]> {
    return Promise.resolve(this.store.listStock(context));
  }
}

class PostgresStockReadRepository implements StockReadRepository {
  constructor(private readonly persistence: PostgresPersistence) {}

  list(context: CvgContext): Promise<NormalizedStockRead[]> {
    return this.persistence.listStock(context);
  }
}

class StoreFinanceReadRepository implements FinanceReadRepository {
  constructor(private readonly store: CvgStore) {}

  listCharges(context: CvgContext, openOnly = false): Promise<Charge[]> {
    return Promise.resolve([...this.store.charges.values()]
      .filter((charge) => charge.organizationId === context.organizationId && charge.unitId === context.unitId && (!openOnly || (charge.status !== "PAID" && charge.status !== "REFUNDED")))
      .map((charge) => ({ ...charge })));
  }

  listPayments(context: CvgContext): Promise<Payment[]> {
    return Promise.resolve([...this.store.payments.values()]
      .filter((payment) => payment.organizationId === context.organizationId && this.store.charges.get(payment.chargeId)?.unitId === context.unitId)
      .map((payment) => ({ ...payment })));
  }

  listLedgerEntries(context: CvgContext): Promise<LedgerEntry[]> {
    return Promise.resolve([...this.store.ledgerEntries.values()]
      .filter((entry) => {
        if (entry.organizationId !== context.organizationId) return false;
        const chargeId = entry.kind === "CHARGE" ? entry.referenceId : entry.kind === "PAYMENT" || entry.kind === "REFUND" ? this.store.payments.get(entry.referenceId)?.chargeId : null;
        return chargeId ? this.store.charges.get(chargeId)?.unitId === context.unitId : false;
      })
      .map((entry) => ({ ...entry })));
  }
}

class PostgresFinanceReadRepository implements FinanceReadRepository {
  constructor(private readonly persistence: PostgresPersistence) {}

  listCharges(context: CvgContext, openOnly = false): Promise<Charge[]> {
    return this.persistence.listCharges(context, openOnly);
  }

  listPayments(context: CvgContext): Promise<Payment[]> {
    return this.persistence.listPayments(context);
  }

  listLedgerEntries(context: CvgContext): Promise<LedgerEntry[]> {
    return this.persistence.listLedgerEntries(context);
  }
}

class StoreCommunicationReadRepository implements CommunicationReadRepository {
  constructor(private readonly store: CvgStore) {}

  list(context: CvgContext): Promise<CommunicationMessage[]> {
    return Promise.resolve(this.store.listMessages(context));
  }
}

class PostgresCommunicationReadRepository implements CommunicationReadRepository {
  constructor(private readonly persistence: PostgresPersistence) {}

  list(context: CvgContext): Promise<CommunicationMessage[]> {
    return this.persistence.listMessages(context);
  }
}

class StoreKnowledgeReadRepository implements KnowledgeReadRepository {
  constructor(private readonly store: CvgStore) {}

  list(context: CvgContext): Promise<KnowledgeDocument[]> {
    return Promise.resolve(this.store.listKnowledgeDocuments(context));
  }
}

class PostgresKnowledgeReadRepository implements KnowledgeReadRepository {
  constructor(private readonly persistence: PostgresPersistence) {}

  list(context: CvgContext): Promise<KnowledgeDocument[]> {
    return this.persistence.listKnowledgeDocuments(context);
  }
}

class StoreQueueReadRepository implements QueueReadRepository {
  constructor(private readonly store: CvgStore) {}

  list(context: CvgContext): Promise<QueueRead[]> {
    return Promise.resolve(this.store.listQueue(context).map((entry) => ({
      ...entry,
      patient: this.store.patients.get(entry.patientId) ? { id: entry.patientId, name: this.store.patients.get(entry.patientId)!.name } : null
    })));
  }
}

class PostgresQueueReadRepository implements QueueReadRepository {
  constructor(private readonly persistence: PostgresPersistence) {}

  list(context: CvgContext): Promise<NormalizedQueueRead[]> {
    return this.persistence.listQueue(context);
  }
}

class StoreAiSessionReadRepository implements AiSessionReadRepository {
  constructor(private readonly store: CvgStore) {}

  list(context: CvgContext): Promise<AiSessionRead[]> {
    return Promise.resolve([...this.store.aiSessions.values()]
      .filter((session) => session.organizationId === context.organizationId && session.actorId === context.actorId && session.unitId === context.unitId && session.workspaceId === context.workspaceId)
      .map((session) => ({ ...session, turns: [...this.store.aiTurns.values()].filter((turn) => turn.sessionId === session.id).length })));
  }
}

class PostgresAiSessionReadRepository implements AiSessionReadRepository {
  constructor(private readonly persistence: PostgresPersistence) {}

  list(context: CvgContext): Promise<NormalizedAiSessionRead[]> {
    return this.persistence.listAiSessions(context);
  }
}

class StoreIdentityContextReadRepository implements IdentityContextReadRepository {
  constructor(private readonly store: CvgStore) {}

  getUser(userId: OpaqueId): User {
    return this.store.getUser(userId);
  }

  listContextOptions(userId: OpaqueId): ContextOption[] {
    return this.store.contextOptions(userId);
  }

  resolveContext(userId: OpaqueId, selector: ContextSelector, purpose: string, correlationId: string, patientId: OpaqueId | null, encounterId: OpaqueId | null, sessionId: OpaqueId | null): CvgContext {
    return this.store.resolveContext(userId, selector, purpose, correlationId, patientId, encounterId, sessionId);
  }

  listUsers(context: CvgContext, query = ""): PublicUser[] {
    return this.store.listUsers(context, query);
  }
}

/** Read-side use cases select a repository behind one application boundary. */
export class ReadApplicationService {
  constructor(private readonly guardians: GuardianReadRepository, private readonly appointments: AppointmentReadRepository, private readonly audit: AuditRepository, private readonly encounters: EncounterRepository, private readonly clinical: ClinicalRepository, private readonly diagnostics: DiagnosticReadRepository, private readonly hospitalization: HospitalizationReadRepository, private readonly medications: MedicationReadRepository, private readonly stock: StockReadRepository, private readonly finance: FinanceReadRepository, private readonly communications: CommunicationReadRepository, private readonly knowledge: KnowledgeReadRepository, private readonly queue: QueueReadRepository, private readonly aiSessions: AiSessionReadRepository, private readonly identityContext: IdentityContextReadRepository) {}

  /**
   * Authentication must establish a user before a CvgContext exists. These
   * two methods are the only pre-context identity reads admitted to the API
   * composition; they deliberately do not evaluate application policy.
   */
  getUserForAuthentication(userId: OpaqueId): User {
    return this.identityContext.getUser(userId);
  }

  listContextOptionsForAuthentication(userId: OpaqueId): ContextOption[] {
    return this.identityContext.listContextOptions(userId);
  }

  /** Context selection is the remaining pre-context step; requestContext applies the request-bound PDP immediately after it. */
  resolveContext(userId: OpaqueId, selector: ContextSelector, purpose: string, correlationId: string, patientId: OpaqueId | null = null, encounterId: OpaqueId | null = null, sessionId: OpaqueId | null = null): CvgContext {
    return this.identityContext.resolveContext(userId, selector, purpose, correlationId, patientId, encounterId, sessionId);
  }

  getCurrentUser(context: CvgContext): User {
    enforceApplicationPolicy(context, "identity.read");
    return this.identityContext.getUser(context.actorId);
  }

  listContextOptions(context: CvgContext): ContextOption[] {
    enforceApplicationPolicy(context, "contexts.read");
    return this.identityContext.listContextOptions(context.actorId);
  }

  listUsers(context: CvgContext, query = ""): PublicUser[] {
    enforceApplicationPolicy(context, "users.read");
    return this.identityContext.listUsers(context, query);
  }

  listGuardians(context: CvgContext, query?: string): Promise<Guardian[]> {
    enforceApplicationPolicy(context, "guardians.read");
    return this.guardians.list(context, query);
  }

  listAppointments(context: CvgContext, range: "today" | "week" = "today"): Promise<AppointmentRead[]> {
    enforceApplicationPolicy(context, "appointments.read");
    return this.appointments.list(context, range);
  }

  listAudit(context: CvgContext, limit = 25, cursor: string | null = null): Promise<AuditRecord[]> {
    enforceApplicationPolicy(context, "audit.read");
    return this.audit.list(context, limit, cursor);
  }

  listEncounters(context: CvgContext): Promise<EncounterRead[]> {
    enforceApplicationPolicy(context, "encounters.read");
    return this.encounters.list(context);
  }

  listClinicalDocuments(context: CvgContext): Promise<ClinicalDocument[]> {
    enforceApplicationPolicy(context, "clinical.read");
    return this.clinical.list(context);
  }

  listDiagnosticRequests(context: CvgContext): Promise<DiagnosticRequest[]> {
    enforceApplicationPolicy(context, "diagnostics.read");
    return this.diagnostics.listRequests(context);
  }

  listSpecimens(context: CvgContext): Promise<Specimen[]> {
    enforceApplicationPolicy(context, "diagnostics.specimens.read");
    return this.diagnostics.listSpecimens(context);
  }

  listDiagnosticResults(context: CvgContext): Promise<DiagnosticResult[]> {
    enforceApplicationPolicy(context, "diagnostics.results.read");
    return this.diagnostics.listResults(context);
  }

  listBeds(context: CvgContext): Promise<Bed[]> {
    enforceApplicationPolicy(context, "hospitalization.beds.read");
    return this.hospitalization.listBeds(context);
  }

  listHospitalEpisodes(context: CvgContext): Promise<HospitalEpisode[]> {
    enforceApplicationPolicy(context, "hospitalization.read");
    return this.hospitalization.listEpisodes(context);
  }

  listMedicationOrders(context: CvgContext): Promise<MedicationOrderRead[]> {
    enforceApplicationPolicy(context, "medication.read");
    return this.medications.listOrders(context);
  }

  listStock(context: CvgContext): Promise<StockRead[]> {
    enforceApplicationPolicy(context, "stock.read");
    return this.stock.list(context);
  }

  listCharges(context: CvgContext): Promise<Charge[]> {
    enforceApplicationPolicy(context, "finance.read");
    return this.finance.listCharges(context);
  }

  listOpenChargesForOperationsSummary(context: CvgContext): Promise<Charge[]> {
    enforceApplicationPolicy(context, "operations.summary");
    return this.finance.listCharges(context, true);
  }

  listPayments(context: CvgContext): Promise<Payment[]> {
    enforceApplicationPolicy(context, "finance.payments.read");
    return this.finance.listPayments(context);
  }

  listLedgerEntries(context: CvgContext): Promise<LedgerEntry[]> {
    enforceApplicationPolicy(context, "finance.ledger.read");
    return this.finance.listLedgerEntries(context);
  }

  listMessages(context: CvgContext): Promise<CommunicationMessage[]> {
    enforceApplicationPolicy(context, "communication.read");
    return this.communications.list(context);
  }

  listKnowledgeDocuments(context: CvgContext): Promise<KnowledgeDocument[]> {
    enforceApplicationPolicy(context, "knowledge.read");
    return this.knowledge.list(context);
  }

  listQueue(context: CvgContext): Promise<QueueRead[]> {
    enforceApplicationPolicy(context, "queue.read");
    return this.queue.list(context);
  }

  listAiSessions(context: CvgContext): Promise<AiSessionRead[]> {
    enforceApplicationPolicy(context, "ai.sessions.read");
    return this.aiSessions.list(context);
  }
}

export function createReadApplicationService(store: CvgStore, persistence: PostgresPersistence | null): ReadApplicationService {
  return new ReadApplicationService(
    persistence ? new PostgresGuardianReadRepository(persistence) : new StoreGuardianReadRepository(store),
    persistence ? new PostgresAppointmentReadRepository(persistence) : new StoreAppointmentReadRepository(store),
    persistence ? new PostgresAuditRepository(persistence) : new StoreAuditRepository(store),
    persistence ? new PostgresEncounterRepository(persistence) : new StoreEncounterRepository(store),
    persistence ? new PostgresClinicalRepository(persistence) : new StoreClinicalRepository(store),
    persistence ? new PostgresDiagnosticReadRepository(persistence) : new StoreDiagnosticReadRepository(store),
    persistence ? new PostgresHospitalizationReadRepository(persistence) : new StoreHospitalizationReadRepository(store),
    persistence ? new PostgresMedicationReadRepository(persistence) : new StoreMedicationReadRepository(store),
    persistence ? new PostgresStockReadRepository(persistence) : new StoreStockReadRepository(store),
    persistence ? new PostgresFinanceReadRepository(persistence) : new StoreFinanceReadRepository(store),
    persistence ? new PostgresCommunicationReadRepository(persistence) : new StoreCommunicationReadRepository(store),
    persistence ? new PostgresKnowledgeReadRepository(persistence) : new StoreKnowledgeReadRepository(store),
    persistence ? new PostgresQueueReadRepository(persistence) : new StoreQueueReadRepository(store),
    persistence ? new PostgresAiSessionReadRepository(persistence) : new StoreAiSessionReadRepository(store),
    new StoreIdentityContextReadRepository(store)
  );
}
