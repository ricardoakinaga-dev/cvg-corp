import { createHash } from "node:crypto";
import { financialBalanceSchema, type AdministrationOccurrence, type AiSession, type AnimalPatient, type Appointment, type AuditRecord, type Bed, type Charge, type ClinicalAddendum, type ClinicalDocument, type StockMovement, type CommunicationMessage, type ContextSelector, type CvgContext, type DiagnosticRequest, type DiagnosticResult, type Dispensation, type Encounter, type FinancialBalance, type Guardian, type HospitalEpisode, type KnowledgeDocument, type LedgerEntry, type Lot, type MedicationOrder, type OpaqueId, type Payment, type Product, type Provider, type QueueEntry, type Resource, type ServiceCatalogItem, type Specimen, type StockLocation, type User } from "@cvg/contracts";
import { computeFinancialBalance, type ContextOption, type CvgStore, type PublicUser } from "@cvg/domain";
import type { NormalizedAiSessionRead, NormalizedAppointmentRead, NormalizedEncounterRead, NormalizedMedicationOrderRead, NormalizedQueueRead, NormalizedStockRead, PostgresPersistence } from "@cvg/persistence";
import { enforceApplicationPolicy } from "@cvg/agent-policy";
import { DomainError } from "@cvg/domain";

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
  get(context: CvgContext, documentId: OpaqueId): Promise<ClinicalDocument | null>;
  listAddenda(context: CvgContext, documentId?: OpaqueId): Promise<ClinicalAddendum[]>;
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
  listDispensations(context: CvgContext): Promise<Dispensation[]>;
  listAdministrations(context: CvgContext): Promise<AdministrationOccurrence[]>;
}

export interface StockReadRepository {
  list(context: CvgContext): Promise<StockRead[]>;
  listMovements(context: CvgContext): Promise<StockMovement[]>;
  listLocations(context: CvgContext): Promise<StockLocation[]>;
}

export interface FinanceReadRepository {
  listCharges(context: CvgContext, openOnly?: boolean): Promise<Charge[]>;
  listPayments(context: CvgContext): Promise<Payment[]>;
  listLedgerEntries(context: CvgContext): Promise<LedgerEntry[]>;
}

export interface CommunicationReadRepository {
  list(context: CvgContext): Promise<CommunicationMessage[]>;
}

export type KnowledgeChunk = { index: number; text: string; checksum: string };
export type KnowledgeDocumentIndex = { document: { id: OpaqueId; title: string; source: string; version: number; dataClass: string; status: string; checksum: string }; chunks: KnowledgeChunk[] };
export type KnowledgeSearchHit = KnowledgeDocumentIndex & { score: number };

/** Deterministic chunk derivation: same content/version always yields the same checksums. */
export function deriveKnowledgeIndex(document: Pick<KnowledgeDocument, "id" | "title" | "source" | "version" | "dataClass" | "status" | "content">): KnowledgeDocumentIndex {
  const checksum = createHash("sha256").update(`${document.id}:${document.version}:${document.content}`).digest("hex");
  const paragraphs = document.content.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= 400) { pieces.push(paragraph); continue; }
    for (let offset = 0; offset < paragraph.length; offset += 400) pieces.push(paragraph.slice(offset, offset + 400).trim());
  }
  const chunks = pieces.filter(Boolean).map((text, index) => ({ index, text, checksum: createHash("sha256").update(`${document.id}:${document.version}:${index}:${text}`).digest("hex") }));
  return { document: { id: document.id, title: document.title, source: document.source, version: document.version, dataClass: document.dataClass, status: document.status, checksum }, chunks };
}

export interface KnowledgeReadRepository {
  list(context: CvgContext): Promise<KnowledgeDocument[]>;
  index(context: CvgContext, documentId: OpaqueId): Promise<KnowledgeDocumentIndex | null>;
  search(context: CvgContext, query: string): Promise<KnowledgeSearchHit[]>;
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

  async get(context: CvgContext, documentId: OpaqueId): Promise<ClinicalDocument | null> {
    this.store.requireRole(context, ["admin", "veterinario"], "clinical:read");
    try {
      return { ...this.store.findClinicalDocument(context, documentId) };
    } catch (error) {
      if (error instanceof DomainError && error.code === "NOT_FOUND") return null;
      throw error;
    }
  }

  async listAddenda(context: CvgContext, documentId?: OpaqueId): Promise<ClinicalAddendum[]> {
    this.store.requireRole(context, ["admin", "veterinario"], "clinical:read");
    return [...this.store.clinicalAddenda.values()]
      .filter((addendum) => addendum.documentId === documentId || documentId === undefined)
      .filter((addendum) => {
        const document = this.store.clinicalDocuments.get(addendum.documentId);
        if (!document || document.organizationId !== context.organizationId) return false;
        const encounter = this.store.encounters.get(document.encounterId);
        return Boolean(encounter) && (!context.unitId || encounter!.unitId === context.unitId) && (!context.workspaceId || encounter!.workspaceId === context.workspaceId);
      })
      .map((addendum) => ({ ...addendum }));
  }
}

class PostgresClinicalRepository implements ClinicalRepository {
  constructor(private readonly persistence: PostgresPersistence, private readonly store: CvgStore) {}

  list(context: CvgContext): Promise<ClinicalDocument[]> {
    return this.persistence.listClinicalDocuments(context);
  }

  get(context: CvgContext, documentId: OpaqueId): Promise<ClinicalDocument | null> {
    return this.list(context).then((documents) => documents.find((document) => document.id === documentId) ?? null);
  }

  async listAddenda(context: CvgContext, documentId?: OpaqueId): Promise<ClinicalAddendum[]> {
    return new StoreClinicalRepository(this.store).listAddenda(context, documentId);
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

  async listDispensations(context: CvgContext): Promise<Dispensation[]> {
    const orders = new Map(this.store.listMedicationOrders(context).map((order) => [order.id, order]));
    return [...this.store.dispensations.values()].filter((dispensation) => dispensation.organizationId === context.organizationId && orders.has(dispensation.medicationOrderId)).map((dispensation) => ({ ...dispensation }));
  }

  async listAdministrations(context: CvgContext): Promise<AdministrationOccurrence[]> {
    const orders = new Map(this.store.listMedicationOrders(context).map((order) => [order.id, order]));
    return [...this.store.administrationOccurrences.values()].filter((occurrence) => occurrence.organizationId === context.organizationId && orders.has(occurrence.medicationOrderId)).map((occurrence) => ({ ...occurrence }));
  }
}

class PostgresMedicationReadRepository implements MedicationReadRepository {
  constructor(private readonly persistence: PostgresPersistence, private readonly store: CvgStore) {}

  listOrders(context: CvgContext): Promise<NormalizedMedicationOrderRead[]> {
    return this.persistence.listMedicationOrders(context);
  }

  listDispensations(context: CvgContext): Promise<Dispensation[]> {
    return new StoreMedicationReadRepository(this.store).listDispensations(context);
  }

  listAdministrations(context: CvgContext): Promise<AdministrationOccurrence[]> {
    return new StoreMedicationReadRepository(this.store).listAdministrations(context);
  }
}

class StoreStockReadRepository implements StockReadRepository {
  constructor(private readonly store: CvgStore) {}

  list(context: CvgContext): Promise<StockRead[]> {
    return Promise.resolve(this.store.listStock(context));
  }

  listMovements(context: CvgContext): Promise<StockMovement[]> {
    this.store.requireRole(context, ["admin", "estoque", "veterinario"], "stock:read");
    return Promise.resolve([...this.store.stockMovements.values()].filter((movement) => {
      if (movement.organizationId !== context.organizationId) return false;
      const lot = this.store.lots.get(movement.lotId);
      return Boolean(lot) && (!context.unitId || this.store.stockLocations.get(lot!.locationId)?.unitId === context.unitId);
    }).map((movement) => ({ ...movement })));
  }

  listLocations(context: CvgContext): Promise<StockLocation[]> {
    this.store.requireRole(context, ["admin", "estoque", "veterinario"], "stock:read");
    return Promise.resolve([...this.store.stockLocations.values()].filter((location) => location.organizationId === context.organizationId && (!context.unitId || location.unitId === context.unitId)).map((location) => ({ ...location })));
  }
}

class PostgresStockReadRepository implements StockReadRepository {
  constructor(private readonly persistence: PostgresPersistence, private readonly store: CvgStore) {}

  list(context: CvgContext): Promise<NormalizedStockRead[]> {
    return this.persistence.listStock(context);
  }

  listMovements(context: CvgContext): Promise<StockMovement[]> {
    return new StoreStockReadRepository(this.store).listMovements(context);
  }

  listLocations(context: CvgContext): Promise<StockLocation[]> {
    return new StoreStockReadRepository(this.store).listLocations(context);
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

  async index(context: CvgContext, documentId: OpaqueId): Promise<KnowledgeDocumentIndex | null> {
    try {
      return deriveKnowledgeIndex(this.store.findKnowledgeDocument(context, documentId));
    } catch {
      return null;
    }
  }

  async search(context: CvgContext, query: string): Promise<KnowledgeSearchHit[]> {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter((token) => token.length >= 2);
    const documents = this.store.listKnowledgeDocuments(context).filter((document) => document.status === "INDEXED" && ["D0", "D1", "D2"].includes(document.dataClass));
    const hits: KnowledgeSearchHit[] = [];
    for (const document of documents) {
      if ((context.unitId && document.unitId !== context.unitId) || (context.workspaceId && document.workspaceId !== context.workspaceId)) continue;
      const index = deriveKnowledgeIndex(document);
      const matches = index.chunks.filter((chunk) => {
        if (!tokens.length) return true;
        const haystack = `${document.title} ${document.source} ${chunk.text}`.toLowerCase();
        return tokens.every((token) => haystack.includes(token));
      });
      if (matches.length > 0) hits.push({ ...index, chunks: matches.slice(0, 10), score: matches.length });
    }
    return hits.sort((left, right) => right.score - left.score).slice(0, 10);
  }
}

class PostgresKnowledgeReadRepository implements KnowledgeReadRepository {
  constructor(private readonly persistence: PostgresPersistence, private readonly store: CvgStore) {}

  list(context: CvgContext): Promise<KnowledgeDocument[]> {
    return this.persistence.listKnowledgeDocuments(context);
  }

  index(context: CvgContext, documentId: OpaqueId): Promise<KnowledgeDocumentIndex | null> {
    return new StoreKnowledgeReadRepository(this.store).index(context, documentId);
  }

  search(context: CvgContext, query: string): Promise<KnowledgeSearchHit[]> {
    return new StoreKnowledgeReadRepository(this.store).search(context, query);
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
  constructor(private readonly guardians: GuardianReadRepository, private readonly appointments: AppointmentReadRepository, private readonly audit: AuditRepository, private readonly encounters: EncounterRepository, private readonly clinical: ClinicalRepository, private readonly diagnostics: DiagnosticReadRepository, private readonly hospitalization: HospitalizationReadRepository, private readonly medications: MedicationReadRepository, private readonly stock: StockReadRepository, private readonly finance: FinanceReadRepository, private readonly communications: CommunicationReadRepository, private readonly knowledge: KnowledgeReadRepository, private readonly queue: QueueReadRepository, private readonly aiSessions: AiSessionReadRepository, private readonly identityContext: IdentityContextReadRepository, private readonly scheduling: SchedulingReadRepository) {}

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

  getClinicalDocument(context: CvgContext, documentId: OpaqueId): Promise<ClinicalDocument | null> {
    enforceApplicationPolicy(context, "clinical.read", { resourceId: documentId });
    return this.clinical.get(context, documentId);
  }

  listClinicalAddenda(context: CvgContext, documentId?: OpaqueId): Promise<ClinicalAddendum[]> {
    enforceApplicationPolicy(context, "clinical.read");
    return this.clinical.listAddenda(context, documentId);
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

  listDispensations(context: CvgContext): Promise<Dispensation[]> {
    enforceApplicationPolicy(context, "medication.read");
    return this.medications.listDispensations(context);
  }

  listMedicationAdministrations(context: CvgContext): Promise<AdministrationOccurrence[]> {
    enforceApplicationPolicy(context, "medication.read");
    return this.medications.listAdministrations(context);
  }

  listStock(context: CvgContext): Promise<StockRead[]> {
    enforceApplicationPolicy(context, "stock.read");
    return this.stock.list(context);
  }

  listStockMovements(context: CvgContext): Promise<StockMovement[]> {
    enforceApplicationPolicy(context, "stock.read");
    return this.stock.listMovements(context);
  }

  listStockLocations(context: CvgContext): Promise<StockLocation[]> {
    enforceApplicationPolicy(context, "stock.read");
    return this.stock.listLocations(context);
  }

  listCharges(context: CvgContext): Promise<Charge[]> {
    enforceApplicationPolicy(context, "finance.read");
    return this.finance.listCharges(context);
  }

  /** Shared balance contract: PAID charges never increase the open amount. */
  async financeBalance(context: CvgContext, currency = "BRL"): Promise<FinancialBalance> {
    enforceApplicationPolicy(context, "finance.read");
    const [charges, payments] = await Promise.all([this.finance.listCharges(context), this.finance.listPayments(context)]);
    return financialBalanceSchema.parse(computeFinancialBalance(charges, payments, { currency, observedAt: new Date().toISOString() }));
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

  getKnowledgeIndex(context: CvgContext, documentId: OpaqueId): Promise<KnowledgeDocumentIndex | null> {
    enforceApplicationPolicy(context, "knowledge.read", { resourceId: documentId });
    return this.knowledge.index(context, documentId);
  }

  searchKnowledge(context: CvgContext, query: string): Promise<KnowledgeSearchHit[]> {
    enforceApplicationPolicy(context, "knowledge.search");
    return this.knowledge.search(context, query);
  }

  listQueue(context: CvgContext): Promise<QueueRead[]> {
    enforceApplicationPolicy(context, "queue.read");
    return this.queue.list(context);
  }

  listSchedulingOptions(context: CvgContext): Promise<SchedulingOptions> {
    enforceApplicationPolicy(context, "scheduling.read", { dataClass: "D0" });
    return this.scheduling.list(context);
  }

  listAiSessions(context: CvgContext): Promise<AiSessionRead[]> {
    enforceApplicationPolicy(context, "ai.sessions.read");
    return this.aiSessions.list(context);
  }
}

export type SchedulingOptions = { providers: Provider[]; services: ServiceCatalogItem[]; resources: Resource[] };

export interface SchedulingReadRepository {
  list(context: CvgContext): Promise<SchedulingOptions>;
}

class StoreSchedulingReadRepository implements SchedulingReadRepository {
  constructor(private readonly store: CvgStore) {}

  list(context: CvgContext): Promise<SchedulingOptions> {
    const providers = [...this.store.providers.values()].filter((provider) => provider.organizationId === context.organizationId && (!context.unitId || provider.unitId === context.unitId) && provider.status === "ACTIVE").map((provider) => ({ ...provider }));
    const services = [...this.store.services.values()].filter((service) => service.organizationId === context.organizationId && service.status === "ACTIVE").map((service) => ({ ...service }));
    const resources = [...this.store.resources.values()].filter((resource) => resource.organizationId === context.organizationId && (!context.unitId || resource.unitId === context.unitId) && resource.status === "ACTIVE").map((resource) => ({ ...resource }));
    return Promise.resolve({ providers, services, resources });
  }
}

export function createReadApplicationService(store: CvgStore, persistence: PostgresPersistence | null): ReadApplicationService {
  return new ReadApplicationService(
    persistence ? new PostgresGuardianReadRepository(persistence) : new StoreGuardianReadRepository(store),
    persistence ? new PostgresAppointmentReadRepository(persistence) : new StoreAppointmentReadRepository(store),
    persistence ? new PostgresAuditRepository(persistence) : new StoreAuditRepository(store),
    persistence ? new PostgresEncounterRepository(persistence) : new StoreEncounterRepository(store),
    persistence ? new PostgresClinicalRepository(persistence, store) : new StoreClinicalRepository(store),
    persistence ? new PostgresDiagnosticReadRepository(persistence) : new StoreDiagnosticReadRepository(store),
    persistence ? new PostgresHospitalizationReadRepository(persistence) : new StoreHospitalizationReadRepository(store),
    persistence ? new PostgresMedicationReadRepository(persistence, store) : new StoreMedicationReadRepository(store),
    persistence ? new PostgresStockReadRepository(persistence, store) : new StoreStockReadRepository(store),
    persistence ? new PostgresFinanceReadRepository(persistence) : new StoreFinanceReadRepository(store),
    persistence ? new PostgresCommunicationReadRepository(persistence) : new StoreCommunicationReadRepository(store),
    persistence ? new PostgresKnowledgeReadRepository(persistence, store) : new StoreKnowledgeReadRepository(store),
    persistence ? new PostgresQueueReadRepository(persistence) : new StoreQueueReadRepository(store),
    persistence ? new PostgresAiSessionReadRepository(persistence) : new StoreAiSessionReadRepository(store),
    new StoreIdentityContextReadRepository(store),
    new StoreSchedulingReadRepository(store)
  );
}
