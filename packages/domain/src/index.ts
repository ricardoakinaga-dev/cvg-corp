import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type {
  AiApproval,
  AiDraft,
  AiSession,
  AiTurn,
  AdministrationOccurrence,
  AuthChallenge,
  AuthSecurityState,
  AnimalPatient,
  Appointment,
  AuditRecord,
  Bed,
  BudgetReservation,
  Charge,
  ClinicalAddendum,
  ClinicalDocument,
  CommandReceipt,
  CommunicationMessage,
  CvgContext,
  DiagnosticRequest,
  DiagnosticResult,
  Dispensation,
  Encounter,
  Guardian,
  HospitalEpisode,
  KnowledgeDocument,
  LedgerEntry,
  Lot,
  MedicationOrder,
  OpaqueId,
  Organization,
  Payment,
  Product,
  Provider,
  QueueEntry,
  Resource,
  Role,
  RoleAssignment,
  ScopeType,
  Session,
  ServiceCatalogItem,
  Specimen,
  StockLocation,
  StockMovement,
  Unit,
  User,
  Workspace
} from "@cvg/contracts";
import { digestRecoveryCode, generateRecoveryCodes } from "@cvg/auth";
import { CAPABILITY_ROLES, evaluateCapability, isGrantableRole, sameRoleSet } from "./authorization.js";
import { validateSnapshotSemantics } from "./snapshot-validation.js";
export { validateSnapshotSemantics } from "./snapshot-validation.js";
import { id } from "@cvg/contracts";
import type {
  AiTurnInput,
  AppointmentInput,
  ChargeInput,
  ClinicalDocumentInput,
  ContextSelector,
  DiagnosticRequestInput,
  LoginInput,
  PatientInput,
  PaymentInput,
  PatientMergeInput,
  ResultInput,
  RoleAssignmentInput,
  StockMovementInput
} from "@cvg/contracts";

export class DomainError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details: Record<string, unknown> | undefined;

  constructor(code: string, message: string, statusCode = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const now = (): string => new Date().toISOString();

export function defaultAuthSecurityState(createdAt = now()): AuthSecurityState {
  return {
    passwordChangedAt: createdAt,
    passwordExpiresAt: null,
    credentialVersion: 1,
    failedLoginAttempts: 0,
    lockedUntil: null,
    mfaRequired: false,
    mfaSecretRef: null,
    recoveryCodeDigests: [],
    recoveryCodesIssuedAt: null
  };
}

/** Exact resource boundary used by every scoped in-memory read. */
export function isInContext(resource: { organizationId: OpaqueId; unitId?: OpaqueId | null; workspaceId?: OpaqueId | null }, context: CvgContext): boolean {
  return resource.organizationId === context.organizationId && (resource.unitId ?? null) === context.unitId && (resource.workspaceId ?? null) === context.workspaceId;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [, saltText, digestText] = encoded.split("$");
  if (!saltText || !digestText) return false;
  try {
    const expected = Buffer.from(digestText, "base64url");
    const actual = scryptSync(password, Buffer.from(saltText, "base64url"), expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, canonicalReplacer)).digest("hex");
}

/** Hashes an audit record without allowing the hash field to hash itself. */
export function auditRecordHash(record: AuditRecord): string {
  const { recordHash: _recordHash, ...unsigned } = record;
  return digest(unsigned);
}

export interface AuditChainVerification {
  organizations: number;
  records: number;
  digest: string;
}

/**
 * Verifies the tamper-evident audit hash chain without trusting transport
 * order. Persistence readers may page or sort rows by database id, so the
 * predecessor hashes are the authoritative links for reconstructing each
 * organization's ledger order.
 */
export function verifyAuditChain(records: readonly AuditRecord[]): AuditChainVerification {
  const byOrganization = new Map<string, AuditRecord[]>();
  for (const record of records) {
    const bucket = byOrganization.get(record.organizationId) ?? [];
    bucket.push(record);
    byOrganization.set(record.organizationId, bucket);
  }

  const canonicalRecords: AuditRecord[] = [];
  for (const [organizationId, chain] of [...byOrganization.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const byHash = new Map<string, AuditRecord>();
    const childrenByPrevious = new Map<string | null, AuditRecord[]>();
    const ids = new Set<string>();
    for (const record of chain) {
      if (record.chainVersion !== 2) throw new Error(`audit ${record.id} has unsupported chain version`);
      if (record.organizationId !== organizationId) throw new Error(`audit ${record.id} changed organization scope`);
      if (record.recordHash !== auditRecordHash(record)) throw new Error(`audit ${record.id} has an invalid record hash`);
      if (ids.has(record.id)) throw new Error(`audit ${record.id} is duplicated`);
      ids.add(record.id);
      if (byHash.has(record.recordHash)) throw new Error(`audit ${record.id} duplicates a record hash`);
      byHash.set(record.recordHash, record);
      const children = childrenByPrevious.get(record.previousHash) ?? [];
      children.push(record);
      childrenByPrevious.set(record.previousHash, children);
    }
    for (const record of chain) {
      if (record.previousHash !== null && !byHash.has(record.previousHash)) throw new Error(`audit ${record.id} references a missing previous hash`);
    }
    const heads = childrenByPrevious.get(null) ?? [];
    if (heads.length !== 1) throw new Error(`organization ${organizationId} has ${heads.length} audit chain heads`);
    const ordered: AuditRecord[] = [];
    const visited = new Set<string>();
    let current: AuditRecord | undefined = heads[0];
    while (current) {
      if (visited.has(current.recordHash)) throw new Error(`audit ${current.id} introduces a chain cycle`);
      visited.add(current.recordHash);
      ordered.push(current);
      const children = childrenByPrevious.get(current.recordHash) ?? [];
      if (children.length > 1) throw new Error(`audit ${current.id} introduces a chain branch`);
      current = children[0];
    }
    if (ordered.length !== chain.length) throw new Error(`organization ${organizationId} has disconnected audit records`);
    canonicalRecords.push(...ordered);
  }
  return {
    organizations: byOrganization.size,
    records: records.length,
    digest: digest(canonicalRecords)
  };
}

function canonicalReplacer(_key: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
}

export function makeId(): OpaqueId {
  return id(randomUUID());
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export interface StoreOptions {
  bootstrapPassword?: string;
  seed?: boolean;
}

export interface SessionMetadata {
  deviceIdDigest?: string | null;
  userAgentDigest?: string | null;
  ipDigest?: string | null;
  mfaVerifiedAt?: string | null;
}

export interface BootstrapCredentials {
  login: string;
  password: string;
  userId: OpaqueId;
  organizationId: OpaqueId;
}

export interface PublicUser {
  id: OpaqueId;
  displayName: string;
  email: string;
  status: User["status"];
  roles: Array<Pick<RoleAssignment, "id" | "role" | "scopeType" | "unitId" | "workspaceId" | "revokedAt">>;
}

export interface ContextOption {
  organization: Pick<Organization, "id" | "name" | "slug">;
  unit: Unit;
  workspace: Workspace;
  roles: Role[];
}

export interface StoreSnapshot {
  healthStatus: "READY" | "QUARANTINED";
  organizations: Organization[];
  units: Unit[];
  workspaces: Workspace[];
  users: User[];
  roleAssignments: RoleAssignment[];
  sessions: Session[];
  auditRecords: AuditRecord[];
  commandReceipts: CommandReceipt[];
  guardians: Guardian[];
  patients: AnimalPatient[];
  providers: Provider[];
  services: ServiceCatalogItem[];
  resources: Resource[];
  appointments: Appointment[];
  queueEntries: QueueEntry[];
  encounters: Encounter[];
  clinicalDocuments: ClinicalDocument[];
  clinicalAddenda: ClinicalAddendum[];
  diagnosticRequests: DiagnosticRequest[];
  specimens: Specimen[];
  diagnosticResults: DiagnosticResult[];
  hospitalEpisodes: HospitalEpisode[];
  beds: Bed[];
  medicationOrders: MedicationOrder[];
  dispensations: Dispensation[];
  products: Product[];
  lots: Lot[];
  stockLocations: StockLocation[];
  stockMovements: StockMovement[];
  charges: Charge[];
  payments: Payment[];
  ledgerEntries: LedgerEntry[];
  messages: CommunicationMessage[];
  knowledgeDocuments: KnowledgeDocument[];
  aiSessions: AiSession[];
  aiTurns: AiTurn[];
  aiDrafts: AiDraft[];
  aiApprovals: AiApproval[];
  budgetReservations: BudgetReservation[];
  administrationOccurrences: AdministrationOccurrence[];
  authChallenges: AuthChallenge[];
  quarantined: Array<{ id: OpaqueId; kind: string; reason: string; createdAt: string }>;
}

const HYDRATABLE_DIAGNOSTIC_RESULT_STATUSES = new Set(["RECEIVED", "VALID", "REJECTED"]);

function validateHydratableDiagnosticResultStatus(result: { id?: unknown; status?: unknown }): void {
  if (typeof result.status !== "string" || !HYDRATABLE_DIAGNOSTIC_RESULT_STATUSES.has(result.status)) {
    throw new DomainError("INVALID_INPUT", `Snapshot inválido: resultado diagnóstico ${String(result.id ?? "<unknown>")} possui status não hidratável.`, 400);
  }
}

function validateDomainSnapshot(snapshot: StoreSnapshot): void {
  validateSnapshotSemantics(snapshot, (message) => {
    throw new DomainError("INVALID_INPUT", `Snapshot inválido: ${message}`, 400);
  });
}

function readOnlyMap<K, V>(map: Map<K, V>): ReadonlyMap<K, V> {
  const error = () => { throw new Error("CvgStore collections are read-only; use an explicit domain persistence seam"); };
  const view: ReadonlyMap<K, V> & { set: typeof error; delete: typeof error; clear: typeof error } = {
    get: (key) => {
      const value = map.get(key);
      return value === undefined ? undefined : clone(value);
    },
    has: (key) => map.has(key),
    keys: () => map.keys(),
    values: function* values(): MapIterator<V> {
      for (const value of map.values()) yield clone(value);
      return undefined;
    },
    entries: function* entries(): MapIterator<[K, V]> {
      for (const [key, value] of map.entries()) yield [key, clone(value)] as [K, V];
      return undefined;
    },
    forEach: (callback, thisArg) => {
      for (const [key, value] of map.entries()) callback.call(thisArg, clone(value), key, view);
    },
    get size() { return map.size; },
    [Symbol.iterator]: function* iterator(): MapIterator<[K, V]> {
      yield* view.entries();
      return undefined;
    },
    set: error,
    delete: error,
    clear: error
  };
  return Object.freeze(view);
}

export class CvgStore {
  private readonly organizationsStore = new Map<string, Organization>();
  public readonly organizations: ReadonlyMap<string, Organization> = readOnlyMap(this.organizationsStore);
  private readonly unitsStore = new Map<string, Unit>();
  public readonly units: ReadonlyMap<string, Unit> = readOnlyMap(this.unitsStore);
  private readonly workspacesStore = new Map<string, Workspace>();
  public readonly workspaces: ReadonlyMap<string, Workspace> = readOnlyMap(this.workspacesStore);
  private readonly usersStore = new Map<string, User>();
  public readonly users: ReadonlyMap<string, User> = readOnlyMap(this.usersStore);
  private readonly roleAssignmentsStore = new Map<string, RoleAssignment>();
  public readonly roleAssignments: ReadonlyMap<string, RoleAssignment> = readOnlyMap(this.roleAssignmentsStore);
  private readonly sessionsStore = new Map<string, Session>();
  public readonly sessions: ReadonlyMap<string, Session> = readOnlyMap(this.sessionsStore);
  private readonly auditRecordsStore = new Map<string, AuditRecord>();
  public readonly auditRecords: ReadonlyMap<string, AuditRecord> = readOnlyMap(this.auditRecordsStore);
  private readonly commandReceiptsStore = new Map<string, CommandReceipt>();
  public readonly commandReceipts: ReadonlyMap<string, CommandReceipt> = readOnlyMap(this.commandReceiptsStore);
  private readonly guardiansStore = new Map<string, Guardian>();
  public readonly guardians: ReadonlyMap<string, Guardian> = readOnlyMap(this.guardiansStore);
  private readonly patientsStore = new Map<string, AnimalPatient>();
  public readonly patients: ReadonlyMap<string, AnimalPatient> = readOnlyMap(this.patientsStore);
  private readonly providersStore = new Map<string, Provider>();
  public readonly providers: ReadonlyMap<string, Provider> = readOnlyMap(this.providersStore);
  private readonly servicesStore = new Map<string, ServiceCatalogItem>();
  public readonly services: ReadonlyMap<string, ServiceCatalogItem> = readOnlyMap(this.servicesStore);
  private readonly resourcesStore = new Map<string, Resource>();
  public readonly resources: ReadonlyMap<string, Resource> = readOnlyMap(this.resourcesStore);
  private readonly appointmentsStore = new Map<string, Appointment>();
  public readonly appointments: ReadonlyMap<string, Appointment> = readOnlyMap(this.appointmentsStore);
  private readonly queueEntriesStore = new Map<string, QueueEntry>();
  public readonly queueEntries: ReadonlyMap<string, QueueEntry> = readOnlyMap(this.queueEntriesStore);
  private readonly encountersStore = new Map<string, Encounter>();
  public readonly encounters: ReadonlyMap<string, Encounter> = readOnlyMap(this.encountersStore);
  private readonly clinicalDocumentsStore = new Map<string, ClinicalDocument>();
  public readonly clinicalDocuments: ReadonlyMap<string, ClinicalDocument> = readOnlyMap(this.clinicalDocumentsStore);
  private readonly clinicalAddendaStore = new Map<string, ClinicalAddendum>();
  public readonly clinicalAddenda: ReadonlyMap<string, ClinicalAddendum> = readOnlyMap(this.clinicalAddendaStore);
  private readonly diagnosticRequestsStore = new Map<string, DiagnosticRequest>();
  public readonly diagnosticRequests: ReadonlyMap<string, DiagnosticRequest> = readOnlyMap(this.diagnosticRequestsStore);
  private readonly specimensStore = new Map<string, Specimen>();
  public readonly specimens: ReadonlyMap<string, Specimen> = readOnlyMap(this.specimensStore);
  private readonly diagnosticResultsStore = new Map<string, DiagnosticResult>();
  public readonly diagnosticResults: ReadonlyMap<string, DiagnosticResult> = readOnlyMap(this.diagnosticResultsStore);
  private readonly hospitalEpisodesStore = new Map<string, HospitalEpisode>();
  public readonly hospitalEpisodes: ReadonlyMap<string, HospitalEpisode> = readOnlyMap(this.hospitalEpisodesStore);
  private readonly bedsStore = new Map<string, Bed>();
  public readonly beds: ReadonlyMap<string, Bed> = readOnlyMap(this.bedsStore);
  private readonly medicationOrdersStore = new Map<string, MedicationOrder>();
  public readonly medicationOrders: ReadonlyMap<string, MedicationOrder> = readOnlyMap(this.medicationOrdersStore);
  private readonly dispensationsStore = new Map<string, Dispensation>();
  public readonly dispensations: ReadonlyMap<string, Dispensation> = readOnlyMap(this.dispensationsStore);
  private readonly productsStore = new Map<string, Product>();
  public readonly products: ReadonlyMap<string, Product> = readOnlyMap(this.productsStore);
  private readonly lotsStore = new Map<string, Lot>();
  public readonly lots: ReadonlyMap<string, Lot> = readOnlyMap(this.lotsStore);
  private readonly stockLocationsStore = new Map<string, StockLocation>();
  public readonly stockLocations: ReadonlyMap<string, StockLocation> = readOnlyMap(this.stockLocationsStore);
  private readonly stockMovementsStore = new Map<string, StockMovement>();
  public readonly stockMovements: ReadonlyMap<string, StockMovement> = readOnlyMap(this.stockMovementsStore);
  private readonly chargesStore = new Map<string, Charge>();
  public readonly charges: ReadonlyMap<string, Charge> = readOnlyMap(this.chargesStore);
  private readonly paymentsStore = new Map<string, Payment>();
  public readonly payments: ReadonlyMap<string, Payment> = readOnlyMap(this.paymentsStore);
  private readonly ledgerEntriesStore = new Map<string, LedgerEntry>();
  public readonly ledgerEntries: ReadonlyMap<string, LedgerEntry> = readOnlyMap(this.ledgerEntriesStore);
  private readonly messagesStore = new Map<string, CommunicationMessage>();
  public readonly messages: ReadonlyMap<string, CommunicationMessage> = readOnlyMap(this.messagesStore);
  private readonly knowledgeDocumentsStore = new Map<string, KnowledgeDocument>();
  public readonly knowledgeDocuments: ReadonlyMap<string, KnowledgeDocument> = readOnlyMap(this.knowledgeDocumentsStore);
  private readonly aiSessionsStore = new Map<string, AiSession>();
  public readonly aiSessions: ReadonlyMap<string, AiSession> = readOnlyMap(this.aiSessionsStore);
  private readonly aiTurnsStore = new Map<string, AiTurn>();
  public readonly aiTurns: ReadonlyMap<string, AiTurn> = readOnlyMap(this.aiTurnsStore);
  private readonly aiDraftsStore = new Map<string, AiDraft>();
  public readonly aiDrafts: ReadonlyMap<string, AiDraft> = readOnlyMap(this.aiDraftsStore);
  private readonly aiApprovalsStore = new Map<string, AiApproval>();
  public readonly aiApprovals: ReadonlyMap<string, AiApproval> = readOnlyMap(this.aiApprovalsStore);
  private readonly budgetReservationsStore = new Map<string, BudgetReservation>();
  public readonly budgetReservations: ReadonlyMap<string, BudgetReservation> = readOnlyMap(this.budgetReservationsStore);
  private readonly administrationOccurrencesStore = new Map<string, AdministrationOccurrence>();
  public readonly administrationOccurrences: ReadonlyMap<string, AdministrationOccurrence> = readOnlyMap(this.administrationOccurrencesStore);
  private readonly authChallengesStore = new Map<string, AuthChallenge>();
  public readonly authChallenges: ReadonlyMap<string, AuthChallenge> = readOnlyMap(this.authChallengesStore);
  private readonly quarantinedStore: Array<{ id: OpaqueId; kind: string; reason: string; createdAt: string }> = [];
  public get quarantined(): ReadonlyArray<{ id: OpaqueId; kind: string; reason: string; createdAt: string }> {
    return Object.freeze(this.quarantinedStore.map(clone));
  }
  private readonly bootstrapCredentialsValue: BootstrapCredentials;
  private storageModeValue: "memory" | "postgres" = "memory";
  private healthStatusValue: "READY" | "QUARANTINED" = "READY";

  public get bootstrapCredentials(): BootstrapCredentials {
    return clone(this.bootstrapCredentialsValue);
  }

  public get storageMode(): "memory" | "postgres" {
    return this.storageModeValue;
  }

  public get healthStatus(): "READY" | "QUARANTINED" {
    return this.healthStatusValue;
  }

  /** Changes the adapter mode only during explicit runtime composition. */
  public setStorageMode(mode: "memory" | "postgres"): void {
    this.storageModeValue = mode;
  }

  /** Records an isolated quarantine item without inserting an invalid row into a governed collection. */
  recordQuarantine(kind: string, reason: string, resourceId: OpaqueId = makeId()): OpaqueId {
    this.quarantinedStore.push({ id: resourceId, kind, reason, createdAt: now() });
    return resourceId;
  }

  constructor(options: StoreOptions = {}) {
    const password = options.bootstrapPassword ?? randomBytes(18).toString("base64url");
    this.bootstrapCredentialsValue = { login: "admin@cvg.local", password, userId: id("00000000-0000-4000-8000-000000000001"), organizationId: id("00000000-0000-4000-8000-000000000010") };
    if (options.seed !== false) this.seed(password);
  }

  /**
   * Process-local callers use explicit persistence seams instead of mutating
   * the backing maps from application or worker code. PostgreSQL remains the
   * authoritative production boundary; these methods keep the memory adapter
   * equally discoverable by the universal PDP audit.
   */
  setCommandReceipt(receipt: CommandReceipt): CommandReceipt {
    const stored = clone(receipt);
    this.commandReceiptsStore.set(stored.idempotencyLookup, stored);
    return clone(stored);
  }

  persistAiSession(session: AiSession): AiSession {
    const stored = clone(session);
    this.aiSessionsStore.set(stored.id, stored);
    return clone(stored);
  }

  persistAiTurn(turn: AiTurn): AiTurn {
    const stored = clone(turn);
    this.aiTurnsStore.set(stored.id, stored);
    return clone(stored);
  }

  persistAiDraft(draft: AiDraft): AiDraft {
    const stored = clone(draft);
    this.aiDraftsStore.set(stored.id, stored);
    return clone(stored);
  }

  persistAiApproval(approval: AiApproval): AiApproval {
    const stored = clone(approval);
    this.aiApprovalsStore.set(stored.id, stored);
    return clone(stored);
  }

  persistBudgetReservation(reservation: BudgetReservation): BudgetReservation {
    const stored = clone(reservation);
    this.budgetReservationsStore.set(stored.id, stored);
    return clone(stored);
  }

  updateCommandReceipt(lookup: string, patch: Pick<Partial<CommandReceipt>, "status" | "result" | "completedAt" | "auditRecordId">): CommandReceipt {
    const receipt = this.commandReceiptsStore.get(lookup);
    if (!receipt) throw new DomainError("NOT_FOUND", "Receipt de comando não encontrado.", 404);
    if (patch.status !== undefined) receipt.status = patch.status;
    if (patch.result !== undefined) receipt.result = patch.result === null ? null : clone(patch.result);
    if (patch.completedAt !== undefined) receipt.completedAt = patch.completedAt;
    if (patch.auditRecordId !== undefined) receipt.auditRecordId = patch.auditRecordId;
    return clone(receipt);
  }

  linkCommandReceiptAudit(lookup: string, auditRecordId: OpaqueId): CommandReceipt | undefined {
    const receipt = this.commandReceiptsStore.get(lookup);
    if (!receipt) return undefined;
    receipt.auditRecordId = auditRecordId;
    return clone(receipt);
  }

  updateAiApproval(approvalId: OpaqueId, patch: Partial<Pick<AiApproval, "decision" | "decidedBy" | "reason">>): AiApproval {
    const approval = this.aiApprovalsStore.get(approvalId);
    if (!approval) throw new DomainError("NOT_FOUND", "Aprovação não encontrada.", 404);
    Object.assign(approval, patch);
    return clone(approval);
  }

  updateAiDraftStatus(draftId: OpaqueId, status: AiDraft["status"]): AiDraft {
    const draft = this.aiDraftsStore.get(draftId);
    if (!draft) throw new DomainError("NOT_FOUND", "Rascunho clínico não encontrado.", 404);
    draft.status = status;
    return clone(draft);
  }

  consumeBudgetReservation(reservationId: OpaqueId, units: number): BudgetReservation {
    if (!Number.isSafeInteger(units) || units < 0) throw new DomainError("INVALID_INPUT", "Unidades de budget inválidas.", 400);
    const reservation = this.budgetReservationsStore.get(reservationId);
    if (!reservation) throw new DomainError("NOT_FOUND", "Reserva de budget não encontrada.", 404);
    reservation.consumedUnits += units;
    if (reservation.consumedUnits >= reservation.reservedUnits) reservation.status = "EXHAUSTED";
    return clone(reservation);
  }

  private seed(password: string): void {
    const organizationId = this.bootstrapCredentials.organizationId;
    const centroId = id("00000000-0000-4000-8000-000000000011");
    const sulId = id("00000000-0000-4000-8000-000000000012");
    const clinicalCentroId = id("00000000-0000-4000-8000-000000000021");
    const receptionCentroId = id("00000000-0000-4000-8000-000000000022");
    const clinicalSulId = id("00000000-0000-4000-8000-000000000023");
    const createdAt = now();
    this.organizationsStore.set(organizationId, { id: organizationId, name: "CVG Saúde Animal", slug: "cvg-saude-animal", status: "ACTIVE", authorizationRevision: 1n, createdAt });
    this.unitsStore.set(centroId, { id: centroId, organizationId, name: "Unidade Centro", code: "CTR", status: "ACTIVE" });
    this.unitsStore.set(sulId, { id: sulId, organizationId, name: "Unidade Sul", code: "SUL", status: "ACTIVE" });
    this.workspacesStore.set(clinicalCentroId, { id: clinicalCentroId, organizationId, unitId: centroId, name: "Operação clínica", purpose: "Atendimento e cuidado", status: "ACTIVE" });
    this.workspacesStore.set(receptionCentroId, { id: receptionCentroId, organizationId, unitId: centroId, name: "Recepção", purpose: "Agenda e acolhimento", status: "ACTIVE" });
    this.workspacesStore.set(clinicalSulId, { id: clinicalSulId, organizationId, unitId: sulId, name: "Operação clínica", purpose: "Atendimento e cuidado", status: "ACTIVE" });

    const adminId = this.bootstrapCredentials.userId;
    const vetId = id("00000000-0000-4000-8000-000000000002");
    const receptionId = id("00000000-0000-4000-8000-000000000003");
    const stockId = id("00000000-0000-4000-8000-000000000004");
    const financeId = id("00000000-0000-4000-8000-000000000005");
    const operatorId = id("00000000-0000-4000-8000-000000000006");
    const userSeed = [
      [adminId, "admin@cvg.local", "Ricardo Akinaga", "admin", "Administrador da organização"],
      [vetId, "ana.vet@cvg.local", "Dra. Ana Martins", "veterinario", "Direção clínica"],
      [receptionId, "bia.recepcao@cvg.local", "Bia Costa", "recepcao", "Recepção"],
      [stockId, "leo.estoque@cvg.local", "Leo Ramos", "estoque", "Estoque e suprimentos"],
      [financeId, "mari.financeiro@cvg.local", "Mari Alves", "financeiro", "Financeiro"],
      [operatorId, "ops@cvg.local", "Operação CVG", "operador", "Operador técnico"]
    ] as const;
    for (const [userId, login, displayName, role, emailLabel] of userSeed) {
      const user: User = { id: userId, organizationId, login, displayName, email: login, status: "ACTIVE", passwordDigest: hashPassword(userId === adminId ? password : `${role}-synthetic-${userId.slice(-4)}`), lastLoginAt: null, security: defaultAuthSecurityState(createdAt), createdAt };
      this.usersStore.set(userId, user);
      if (userId === adminId) this.addAssignment({ id: makeId(), organizationId, userId, role: "admin", scopeType: "ORGANIZATION", unitId: null, workspaceId: null, grantedAt: createdAt, revokedAt: null });
      const typedRole = role as Role;
      const workspaceId = typedRole === "recepcao" ? receptionCentroId : typedRole === "operador" ? null : clinicalCentroId;
      this.addAssignment({ id: makeId(), organizationId, userId, role: typedRole, scopeType: workspaceId ? "WORKSPACE" : "UNIT", unitId: centroId, workspaceId, grantedAt: createdAt, revokedAt: null });
      void emailLabel;
    }

    const guardianA = id("00000000-0000-4000-8000-000000000101");
    const guardianB = id("00000000-0000-4000-8000-000000000102");
    this.guardiansStore.set(guardianA, { id: guardianA, organizationId, unitId: centroId, workspaceId: clinicalCentroId, displayName: "Marina Souza", phone: "+55 11 98888-1200", email: "marina.souza@example.test", dataClass: "D2", status: "ACTIVE" });
    this.guardiansStore.set(guardianB, { id: guardianB, organizationId, unitId: centroId, workspaceId: receptionCentroId, displayName: "João Mendes", phone: "+55 11 97777-4300", email: "joao.mendes@example.test", dataClass: "D2", status: "ACTIVE" });
    const patientA = id("00000000-0000-4000-8000-000000000111");
    const patientB = id("00000000-0000-4000-8000-000000000112");
    this.patientsStore.set(patientA, { id: patientA, organizationId, unitId: centroId, workspaceId: clinicalCentroId, guardianId: guardianA, name: "Luna", species: "Canina", breed: "Golden retriever", sex: "FEMALE", reproductiveStatus: "NEUTERED", birthDate: "2020-05-19", identifiers: ["MICRO-9812"], dataClass: "D3", status: "ACTIVE", mergedIntoId: null, statusChangedAt: null, createdAt });
    this.patientsStore.set(patientB, { id: patientB, organizationId, unitId: centroId, workspaceId: receptionCentroId, guardianId: guardianB, name: "Nino", species: "Felina", breed: "SRD", sex: "MALE", reproductiveStatus: "INTACT", birthDate: "2022-11-03", identifiers: ["MICRO-7341"], dataClass: "D3", status: "ACTIVE", mergedIntoId: null, statusChangedAt: null, createdAt });

    const providerA = id("00000000-0000-4000-8000-000000000121");
    const serviceConsult = id("00000000-0000-4000-8000-000000000131");
    const roomA = id("00000000-0000-4000-8000-000000000141");
    this.providersStore.set(providerA, { id: providerA, organizationId, displayName: "Dra. Ana Martins", specialty: "Clínica geral", role: "veterinario", unitId: centroId, status: "ACTIVE" });
    this.servicesStore.set(serviceConsult, { id: serviceConsult, organizationId, name: "Consulta clínica", durationMinutes: 45, priceCents: 22000, status: "ACTIVE" });
    this.resourcesStore.set(roomA, { id: roomA, organizationId, unitId: centroId, name: "Consultório 02", kind: "ROOM", status: "ACTIVE" });
    const day = new Date();
    day.setHours(10, 30, 0, 0);
    const startsAt = day.toISOString();
    const ends = new Date(day.getTime() + 45 * 60_000).toISOString();
    this.appointmentsStore.set(id("00000000-0000-4000-8000-000000000151"), { id: id("00000000-0000-4000-8000-000000000151"), organizationId, unitId: centroId, workspaceId: clinicalCentroId, patientId: patientA, providerId: providerA, resourceId: roomA, serviceId: serviceConsult, startsAt, endsAt: ends, purpose: "Retorno pós-operatório", status: "CONFIRMED", version: 1, createdAt });
    this.appointmentsStore.set(id("00000000-0000-4000-8000-000000000152"), { id: id("00000000-0000-4000-8000-000000000152"), organizationId, unitId: centroId, workspaceId: receptionCentroId, patientId: patientB, providerId: providerA, resourceId: roomA, serviceId: serviceConsult, startsAt: new Date(day.getTime() + 90 * 60_000).toISOString(), endsAt: new Date(day.getTime() + 135 * 60_000).toISOString(), purpose: "Avaliação dermatológica", status: "SCHEDULED", version: 1, createdAt });
    const queueId = makeId();
    this.queueEntriesStore.set(queueId, { id: queueId, organizationId, unitId: centroId, appointmentId: id("00000000-0000-4000-8000-000000000151"), patientId: patientA, status: "WAITING", priority: "URGENT", checkedInAt: createdAt });

    const locationId = id("00000000-0000-4000-8000-000000000161");
    const productId = id("00000000-0000-4000-8000-000000000171");
    const lotId = id("00000000-0000-4000-8000-000000000181");
    this.stockLocationsStore.set(locationId, { id: locationId, organizationId, unitId: centroId, name: "Farmácia — Centro" });
    this.productsStore.set(productId, { id: productId, organizationId, sku: "AMOX-50", name: "Amoxicilina 50 mg", category: "Antimicrobiano", unit: "comprimido", reorderPoint: 40, status: "ACTIVE" });
    this.lotsStore.set(lotId, { id: lotId, organizationId, productId, lotNumber: "AMX-25-08", expiresOn: "2027-08-31", quantity: 128, locationId, status: "AVAILABLE" });
    const bedId = id("00000000-0000-4000-8000-000000000191");
    this.bedsStore.set(bedId, { id: bedId, organizationId, unitId: centroId, name: "Baia de recuperação 01", status: "AVAILABLE" });
    const chargeId = makeId();
    this.chargesStore.set(chargeId, { id: chargeId, organizationId, unitId: centroId, patientId: patientA, description: "Consulta clínica", amountCents: 22000, currency: "BRL", status: "OPEN", createdAt });
    const knowledgeId = makeId();
    this.knowledgeDocumentsStore.set(knowledgeId, { id: knowledgeId, organizationId, unitId: centroId, workspaceId: clinicalCentroId, title: "Protocolo de retorno pós-operatório", source: "Direção clínica · fixture sintética", dataClass: "D1", version: 1, status: "APPROVED", content: "Confirmar sinais vitais, ferida operatória, dor e adesão à medicação.", createdAt });
  }

  private addAssignment(assignment: RoleAssignment): void {
    this.roleAssignmentsStore.set(assignment.id, assignment);
  }

  snapshot(): StoreSnapshot {
    const maps = [
      this.organizationsStore, this.unitsStore, this.workspacesStore, this.usersStore, this.roleAssignmentsStore, this.sessionsStore,
      this.auditRecordsStore, this.commandReceiptsStore, this.guardiansStore, this.patientsStore, this.providersStore, this.servicesStore,
      this.resourcesStore, this.appointmentsStore, this.queueEntriesStore, this.encountersStore, this.clinicalDocumentsStore,
      this.clinicalAddendaStore, this.diagnosticRequestsStore, this.specimensStore, this.diagnosticResultsStore, this.hospitalEpisodesStore,
      this.bedsStore, this.medicationOrdersStore, this.dispensationsStore, this.productsStore, this.lotsStore, this.stockLocationsStore,
      this.stockMovementsStore, this.chargesStore, this.paymentsStore, this.ledgerEntriesStore, this.messagesStore, this.knowledgeDocumentsStore,
      this.aiSessionsStore, this.aiTurnsStore, this.aiDraftsStore, this.aiApprovalsStore, this.budgetReservationsStore, this.administrationOccurrencesStore, this.authChallengesStore
    ];
    const values = maps.map((map) => [...map.values()].map(clone));
    return {
      healthStatus: this.healthStatusValue,
      organizations: values[0] as Organization[], units: values[1] as Unit[], workspaces: values[2] as Workspace[], users: values[3] as User[], roleAssignments: values[4] as RoleAssignment[], sessions: values[5] as Session[], auditRecords: values[6] as AuditRecord[], commandReceipts: values[7] as CommandReceipt[], guardians: values[8] as Guardian[], patients: values[9] as AnimalPatient[], providers: values[10] as Provider[], services: values[11] as ServiceCatalogItem[], resources: values[12] as Resource[], appointments: values[13] as Appointment[], queueEntries: values[14] as QueueEntry[], encounters: values[15] as Encounter[], clinicalDocuments: values[16] as ClinicalDocument[], clinicalAddenda: values[17] as ClinicalAddendum[], diagnosticRequests: values[18] as DiagnosticRequest[], specimens: values[19] as Specimen[], diagnosticResults: values[20] as DiagnosticResult[], hospitalEpisodes: values[21] as HospitalEpisode[], beds: values[22] as Bed[], medicationOrders: values[23] as MedicationOrder[], dispensations: values[24] as Dispensation[], products: values[25] as Product[], lots: values[26] as Lot[], stockLocations: values[27] as StockLocation[], stockMovements: values[28] as StockMovement[], charges: values[29] as Charge[], payments: values[30] as Payment[], ledgerEntries: values[31] as LedgerEntry[], messages: values[32] as CommunicationMessage[], knowledgeDocuments: values[33] as KnowledgeDocument[], aiSessions: values[34] as AiSession[], aiTurns: values[35] as AiTurn[], aiDrafts: values[36] as AiDraft[], aiApprovals: values[37] as AiApproval[], budgetReservations: values[38] as BudgetReservation[], administrationOccurrences: values[39] as AdministrationOccurrence[], authChallenges: values[40] as AuthChallenge[], quarantined: clone(this.quarantinedStore)
    };
  }

  restore(snapshot: StoreSnapshot): void {
    validateDomainSnapshot(snapshot);
    this.clearData();
    this.loadSnapshot(snapshot);
    this.quarantine("RESTORE", "journal independente e autoridade corrente não foram fornecidos");
  }

  quarantine(kind: string, reason: string): void {
    this.healthStatusValue = "QUARANTINED";
    for (const session of this.sessionsStore.values()) session.revokedAt = now();
    this.recordQuarantine(kind, reason);
  }

  hydrate(snapshot: StoreSnapshot): void {
    validateDomainSnapshot(snapshot);
    this.clearData();
    this.loadSnapshot(snapshot);
    this.healthStatusValue = snapshot.healthStatus;
  }

  private loadSnapshot(snapshot: StoreSnapshot): void {
    const entries: Array<[Map<string, unknown>, unknown[]]> = [
      [this.organizationsStore, snapshot.organizations], [this.unitsStore, snapshot.units], [this.workspacesStore, snapshot.workspaces], [this.usersStore, snapshot.users], [this.roleAssignmentsStore, snapshot.roleAssignments], [this.sessionsStore, snapshot.sessions], [this.auditRecordsStore, snapshot.auditRecords], [this.commandReceiptsStore, snapshot.commandReceipts], [this.guardiansStore, snapshot.guardians], [this.patientsStore, snapshot.patients], [this.providersStore, snapshot.providers], [this.servicesStore, snapshot.services], [this.resourcesStore, snapshot.resources], [this.appointmentsStore, snapshot.appointments], [this.queueEntriesStore, snapshot.queueEntries], [this.encountersStore, snapshot.encounters], [this.clinicalDocumentsStore, snapshot.clinicalDocuments], [this.clinicalAddendaStore, snapshot.clinicalAddenda], [this.diagnosticRequestsStore, snapshot.diagnosticRequests], [this.specimensStore, snapshot.specimens], [this.diagnosticResultsStore, snapshot.diagnosticResults], [this.hospitalEpisodesStore, snapshot.hospitalEpisodes], [this.bedsStore, snapshot.beds], [this.medicationOrdersStore, snapshot.medicationOrders], [this.dispensationsStore, snapshot.dispensations], [this.productsStore, snapshot.products], [this.lotsStore, snapshot.lots], [this.stockLocationsStore, snapshot.stockLocations], [this.stockMovementsStore, snapshot.stockMovements], [this.chargesStore, snapshot.charges], [this.paymentsStore, snapshot.payments], [this.ledgerEntriesStore, snapshot.ledgerEntries], [this.messagesStore, snapshot.messages], [this.knowledgeDocumentsStore, snapshot.knowledgeDocuments], [this.aiSessionsStore, snapshot.aiSessions], [this.aiTurnsStore, snapshot.aiTurns], [this.aiDraftsStore, snapshot.aiDrafts], [this.aiApprovalsStore, snapshot.aiApprovals], [this.budgetReservationsStore, snapshot.budgetReservations], [this.administrationOccurrencesStore, snapshot.administrationOccurrences], [this.authChallengesStore, snapshot.authChallenges]
    ];
    for (const [map, list] of entries) for (const value of list) {
      const resource = value as { id: OpaqueId; idempotencyLookup?: string };
      const key = map === this.commandReceiptsStore ? resource.idempotencyLookup ?? resource.id : resource.id;
      map.set(key, clone(value));
    }
    this.quarantinedStore.splice(0, this.quarantinedStore.length, ...snapshot.quarantined.map(clone));
  }

  private clearData(): void {
    for (const map of [this.organizationsStore, this.unitsStore, this.workspacesStore, this.usersStore, this.roleAssignmentsStore, this.sessionsStore, this.auditRecordsStore, this.commandReceiptsStore, this.guardiansStore, this.patientsStore, this.providersStore, this.servicesStore, this.resourcesStore, this.appointmentsStore, this.queueEntriesStore, this.encountersStore, this.clinicalDocumentsStore, this.clinicalAddendaStore, this.diagnosticRequestsStore, this.specimensStore, this.diagnosticResultsStore, this.hospitalEpisodesStore, this.bedsStore, this.medicationOrdersStore, this.dispensationsStore, this.productsStore, this.lotsStore, this.stockLocationsStore, this.stockMovementsStore, this.chargesStore, this.paymentsStore, this.ledgerEntriesStore, this.messagesStore, this.knowledgeDocumentsStore, this.aiSessionsStore, this.aiTurnsStore, this.aiDraftsStore, this.aiApprovalsStore, this.budgetReservationsStore, this.administrationOccurrencesStore, this.authChallengesStore]) map.clear();
  }

  private getUserRecord(userId: OpaqueId): User {
    const user = this.usersStore.get(userId);
    if (!user) throw new DomainError("UNAUTHENTICATED", "Sessão inválida.", 401);
    return user;
  }

  getUserByLogin(login: string): User | undefined {
    const normalized = login.trim().toLowerCase();
    const user = [...this.usersStore.values()].find((candidate) => candidate.login.toLowerCase() === normalized);
    return user ? clone(user) : undefined;
  }

  getUser(userId: OpaqueId): User {
    return clone(this.getUserRecord(userId));
  }

  createSession(userId: OpaqueId, tokenDigest: string, csrfToken: string, ttlMinutes: number, metadata: SessionMetadata = {}): Session {
    const user = this.getUserRecord(userId);
    const createdAt = now();
    const session: Session = { id: makeId(), tokenDigest, userId, organizationId: user.organizationId, csrfToken, expiresAt: new Date(Date.now() + ttlMinutes * 60_000).toISOString(), revokedAt: null, deviceIdDigest: metadata.deviceIdDigest ?? null, userAgentDigest: metadata.userAgentDigest ?? null, ipDigest: metadata.ipDigest ?? null, lastSeenAt: createdAt, mfaVerifiedAt: metadata.mfaVerifiedAt ?? null, credentialVersion: user.security.credentialVersion, createdAt };
    this.sessionsStore.set(session.id, session);
    return clone(session);
  }

  findSession(tokenDigest: string): Session | undefined {
    const session = [...this.sessionsStore.values()].find((candidate) => candidate.tokenDigest === tokenDigest);
    const user = session ? this.usersStore.get(session.userId) : undefined;
    if (!session || !user || user.status !== "ACTIVE" || session.revokedAt || Date.parse(session.expiresAt) <= Date.now() || session.credentialVersion !== user.security.credentialVersion) return undefined;
    if (this.healthStatus === "QUARANTINED") return undefined;
    return clone(session);
  }

  touchSession(session: Session): void {
    const current = this.sessionsStore.get(session.id);
    if (current) current.lastSeenAt = now();
  }

  revokeSession(session: Session): void {
    this.revokeSessionById(session.id);
  }

  revokeSessionById(sessionId: OpaqueId): void {
    const session = this.sessionsStore.get(sessionId);
    if (session) session.revokedAt = now();
  }

  markSessionMfaVerified(sessionId: OpaqueId, verifiedAt = now()): void {
    const session = this.sessionsStore.get(sessionId);
    if (!session) throw new DomainError("NOT_FOUND", "Sessão não encontrada.", 404);
    session.mfaVerifiedAt = verifiedAt;
  }

  revokeAllSessions(userId: OpaqueId, exceptSessionId: OpaqueId | null = null): number {
    let count = 0;
    for (const session of this.sessionsStore.values()) {
      if (session.userId === userId && session.id !== exceptSessionId && session.revokedAt === null) {
        session.revokedAt = now();
        count += 1;
      }
    }
    return count;
  }

  isAccountLocked(user: User): boolean {
    return user.security.lockedUntil !== null && Date.parse(user.security.lockedUntil) > Date.now();
  }

  recordLoginFailure(userId: OpaqueId, maxAttempts: number, lockoutMinutes: number): User {
    const user = this.getUserRecord(userId);
    const attempts = user.security.failedLoginAttempts + 1;
    user.security.failedLoginAttempts = attempts;
    if (attempts >= maxAttempts) user.security.lockedUntil = new Date(Date.now() + lockoutMinutes * 60_000).toISOString();
    return clone(user);
  }

  clearLoginFailures(user: User): void {
    const current = this.getUserRecord(user.id);
    current.security.failedLoginAttempts = 0;
    current.security.lockedUntil = null;
  }

  markUserLogin(userId: OpaqueId, loggedInAt = now()): User {
    const user = this.getUserRecord(userId);
    user.lastLoginAt = loggedInAt;
    return clone(user);
  }

  rotatePassword(userId: OpaqueId, passwordDigest: string, passwordExpiresAt: string | null): User {
    const user = this.getUserRecord(userId);
    user.passwordDigest = passwordDigest;
    user.security.passwordChangedAt = now();
    user.security.passwordExpiresAt = passwordExpiresAt;
    user.security.credentialVersion += 1;
    this.clearLoginFailures(user);
    this.revokeAllSessions(user.id);
    return clone(user);
  }

  issueRecoveryCodes(userId: OpaqueId, count = 8): string[] {
    const user = this.getUserRecord(userId);
    const codes = generateRecoveryCodes(count);
    user.security.recoveryCodeDigests = codes.map(digestRecoveryCode);
    user.security.recoveryCodesIssuedAt = now();
    return codes;
  }

  configureMfaFactor(userId: OpaqueId, secretRef: string): User {
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(secretRef)) throw new DomainError("INVALID_INPUT", "A referência do fator MFA é inválida.", 400);
    const user = this.getUserRecord(userId);
    user.security.mfaSecretRef = secretRef;
    user.security.mfaRequired = true;
    return clone(user);
  }

  revokeMfaFactor(userId: OpaqueId): User {
    const user = this.getUserRecord(userId);
    user.security.mfaSecretRef = null;
    user.security.mfaRequired = false;
    return clone(user);
  }

  consumeRecoveryCode(userId: OpaqueId, code: string): boolean {
    const user = this.getUserRecord(userId);
    const digest = digestRecoveryCode(code);
    const index = user.security.recoveryCodeDigests.indexOf(digest);
    if (index < 0) return false;
    user.security.recoveryCodeDigests.splice(index, 1);
    return true;
  }

  createAuthChallenge(type: AuthChallenge["type"], userId: OpaqueId, tokenDigest: string, ttlSeconds: number, maxAttempts: number): AuthChallenge {
    const user = this.getUserRecord(userId);
    const challenge: AuthChallenge = { id: makeId(), type, tokenDigest, userId, organizationId: user.organizationId, credentialVersion: user.security.credentialVersion, expiresAt: new Date(Date.now() + ttlSeconds * 1_000).toISOString(), attempts: 0, maxAttempts, status: "PENDING", consumedAt: null, createdAt: now() };
    this.authChallengesStore.set(challenge.id, challenge);
    return clone(challenge);
  }

  findAuthChallenge(type: AuthChallenge["type"], tokenDigest: string): AuthChallenge | undefined {
    const challenge = [...this.authChallengesStore.values()].find((candidate) => candidate.type === type && candidate.tokenDigest === tokenDigest);
    if (!challenge || challenge.status !== "PENDING") return undefined;
    const user = this.usersStore.get(challenge.userId);
    if (!user || user.status !== "ACTIVE" || user.security.credentialVersion !== challenge.credentialVersion) {
      challenge.status = "EXPIRED";
      return undefined;
    }
    if (Date.parse(challenge.expiresAt) <= Date.now()) {
      challenge.status = "EXPIRED";
      return undefined;
    }
    return clone(challenge);
  }

  recordChallengeFailure(challenge: AuthChallenge): AuthChallenge {
    const current = this.authChallengesStore.get(challenge.id);
    if (!current) throw new DomainError("NOT_FOUND", "O desafio de autenticação não foi encontrado.", 404);
    current.attempts += 1;
    if (current.attempts >= current.maxAttempts) {
      current.status = "LOCKED";
      current.consumedAt = now();
    }
    return clone(current);
  }

  consumeAuthChallenge(challenge: AuthChallenge): void {
    const current = this.authChallengesStore.get(challenge.id);
    if (!current || current.status !== "PENDING") throw new DomainError("MFA_INVALID", "O desafio de autenticação não está disponível.", 401);
    current.status = "CONSUMED";
    current.consumedAt = now();
  }

  effectiveAssignments(userId: OpaqueId, organizationId: OpaqueId): RoleAssignment[] {
    return [...this.roleAssignmentsStore.values()].filter((assignment) => assignment.userId === userId && assignment.organizationId === organizationId && !assignment.revokedAt).map(clone);
  }

  contextOptions(userId: OpaqueId): ContextOption[] {
    const user = this.getUser(userId);
    const assignments = this.effectiveAssignments(userId, user.organizationId);
    const options: ContextOption[] = [];
    for (const unit of this.unitsStore.values()) {
      if (unit.organizationId !== user.organizationId) continue;
      for (const workspace of this.workspacesStore.values()) {
        if (workspace.unitId !== unit.id) continue;
        const roles = assignments.filter((assignment) => this.assignmentMatches(assignment, unit.id, workspace.id)).map((assignment) => assignment.role);
        if (roles.length) {
          const organization = this.organizationsStore.get(user.organizationId);
          if (organization) options.push({ organization: { id: organization.id, name: organization.name, slug: organization.slug }, unit: clone(unit), workspace: clone(workspace), roles: [...new Set(roles)] });
        }
      }
    }
    return options;
  }

  resolveContext(userId: OpaqueId, selector: ContextSelector, purpose: string, correlationId: string, patientId: OpaqueId | null = null, encounterId: OpaqueId | null = null, sessionId: OpaqueId | null = null): CvgContext {
    const user = this.getUser(userId);
    const assignments = this.effectiveAssignments(userId, user.organizationId);
    const unit = selector.unitId ? this.unitsStore.get(selector.unitId) : undefined;
    const workspace = selector.workspaceId ? this.workspacesStore.get(selector.workspaceId) : undefined;
    if (unit && unit.organizationId !== user.organizationId) throw new DomainError("NOT_FOUND", "Contexto não encontrado.", 404);
    if (workspace && (workspace.organizationId !== user.organizationId || (unit && workspace.unitId !== unit.id))) throw new DomainError("NOT_FOUND", "Contexto não encontrado.", 404);
    const matching = assignments.filter((assignment) => this.assignmentMatches(assignment, unit?.id ?? null, workspace?.id ?? null));
    if (!matching.length) throw new DomainError("FORBIDDEN", "O ator não possui autorização para este contexto.", 403);
    return { organizationId: user.organizationId, unitId: unit?.id ?? null, workspaceId: workspace?.id ?? null, actorId: userId, sessionId, actorRoleSnapshot: [...new Set(matching.map((assignment) => assignment.role))], patientId, encounterId, purpose, policyRevision: String(this.organizationsStore.get(user.organizationId)?.authorizationRevision ?? 0n), correlationId };
  }

  private assignmentMatches(assignment: RoleAssignment, unitId: OpaqueId | null, workspaceId: OpaqueId | null): boolean {
    if (assignment.scopeType === "ORGANIZATION") return true;
    if (assignment.scopeType === "UNIT") return assignment.unitId === unitId;
    return assignment.unitId === unitId && assignment.workspaceId === workspaceId;
  }

  /**
   * Patient and guardian records carry their registration scope. A related
   * appointment/encounter may widen that access only to the exact context of
   * the relationship; organization ownership alone is never sufficient for a
   * scoped read.
   */
  private scopeMatches(context: CvgContext, unitId: OpaqueId | null, workspaceId: OpaqueId | null): boolean {
    if (!context.unitId) return false;
    return unitId === context.unitId && (!context.workspaceId || workspaceId === context.workspaceId);
  }

  private patientScopeMatches(patient: AnimalPatient, context: CvgContext): boolean {
    if (patient.organizationId !== context.organizationId) return false;
    if (!context.unitId) return false;
    if (this.scopeMatches(context, patient.unitId, patient.workspaceId)) return true;
    return [...this.appointmentsStore.values()].some((appointment) => appointment.patientId === patient.id && this.scopeMatches(context, appointment.unitId, appointment.workspaceId)) ||
      [...this.encountersStore.values()].some((encounter) => encounter.patientId === patient.id && this.scopeMatches(context, encounter.unitId, encounter.workspaceId)) ||
      [...this.messagesStore.values()].some((message) => message.patientId === patient.id && this.scopeMatches(context, message.unitId, message.workspaceId));
  }

  private guardianScopeMatches(guardian: Guardian, context: CvgContext): boolean {
    if (guardian.organizationId !== context.organizationId) return false;
    if (!context.unitId) return false;
    if (this.scopeMatches(context, guardian.unitId, guardian.workspaceId)) return true;
    return [...this.patientsStore.values()].some((patient) => patient.status === "ACTIVE" && patient.guardianId === guardian.id && this.patientScopeMatches(patient, context));
  }

  /**
   * Revalidates the security context at the domain boundary. A context is a
   * short-lived binding, not an authority that can outlive a role, tenant or
   * policy revision change.
   */
  validateContext(context: CvgContext): void {
    if (!context || typeof context !== "object" || !context.organizationId || !context.actorId || (context.sessionId !== null && !context.sessionId) || !Array.isArray(context.actorRoleSnapshot) || typeof context.purpose !== "string" || !context.purpose.trim() || typeof context.correlationId !== "string" || !context.correlationId.trim()) {
      throw new DomainError("POLICY_DENIED", "O contexto de segurança é inválido.", 403);
    }
    const organization = this.organizationsStore.get(context.organizationId);
    const actor = this.usersStore.get(context.actorId);
    if (!organization || organization.status !== "ACTIVE" || !actor || actor.organizationId !== organization.id || actor.status !== "ACTIVE") {
      throw new DomainError("POLICY_DENIED", "O contexto de segurança não está ativo.", 403);
    }
    if (context.sessionId !== null) {
      const session = this.sessionsStore.get(context.sessionId);
      if (!session || session.organizationId !== organization.id || session.userId !== context.actorId || session.revokedAt !== null || Date.parse(session.expiresAt) <= Date.now() || session.credentialVersion !== actor.security.credentialVersion) throw new DomainError("UNAUTHENTICATED", "A sessão vinculada ao contexto não está ativa.", 401);
    }
    if (!/^\d{1,18}$/.test(context.policyRevision)) {
      throw new DomainError("POLICY_STALE", "A versão da policy não pode ser validada.", 409);
    }
    let contextRevision: bigint;
    try {
      contextRevision = BigInt(context.policyRevision);
    } catch {
      throw new DomainError("POLICY_STALE", "A versão da policy não pode ser validada.", 409);
    }
    if (organization.authorizationRevision !== contextRevision) {
      throw new DomainError("POLICY_STALE", "A autorização mudou; selecione o contexto novamente.", 409);
    }
    if (context.workspaceId !== null && context.unitId === null) {
      throw new DomainError("POLICY_DENIED", "Workspace sem unidade não é um contexto válido.", 403);
    }
    const unit = context.unitId ? this.unitsStore.get(context.unitId) : null;
    const workspace = context.workspaceId ? this.workspacesStore.get(context.workspaceId) : null;
    if ((context.unitId && (!unit || unit.organizationId !== organization.id || unit.status !== "ACTIVE")) ||
        (context.workspaceId && (!workspace || workspace.organizationId !== organization.id || workspace.status !== "ACTIVE" || workspace.unitId !== context.unitId))) {
      throw new DomainError("POLICY_DENIED", "O contexto de unidade ou workspace não está autorizado.", 403);
    }
    const matching = this.effectiveAssignments(context.actorId, organization.id).filter((assignment) => this.assignmentMatches(assignment, context.unitId, context.workspaceId));
    const currentRoles = [...new Set(matching.map((assignment) => assignment.role))];
    if (!matching.length || !sameRoleSet(context.actorRoleSnapshot, currentRoles)) {
      throw new DomainError("POLICY_STALE", "A alçada do ator mudou; selecione o contexto novamente.", 409);
    }
    if (context.patientId) {
      const patient = this.patientsStore.get(context.patientId);
      if (!patient || patient.status === "MERGED" || !this.patientScopeMatches(patient, context)) {
        throw new DomainError("POLICY_DENIED", "O paciente não pertence ao contexto autorizado.", 403);
      }
    }
    if (context.encounterId) {
      const encounter = this.encountersStore.get(context.encounterId);
      if (!encounter || encounter.organizationId !== organization.id || (context.unitId && encounter.unitId !== context.unitId) || (context.workspaceId && encounter.workspaceId !== context.workspaceId) || (context.patientId && encounter.patientId !== context.patientId)) {
        throw new DomainError("POLICY_DENIED", "O atendimento não pertence ao contexto autorizado.", 403);
      }
    }
  }

  requireRole(context: CvgContext, allowed: Role[], capability: string): void {
    this.validateContext(context);
    const decision = evaluateCapability(capability, context.actorRoleSnapshot, allowed);
    if (!decision.allowed) {
      if (decision.reason === "ROLE_NOT_ALLOWED") throw new DomainError("FORBIDDEN", `A ação “${capability}” não está disponível para este perfil.`, 403);
      throw new DomainError("POLICY_DENIED", `A capability “${capability}” não possui uma policy server-side válida.`, 403);
    }
  }

  requireOrganization(context: CvgContext, organizationId: OpaqueId): void {
    if (context.organizationId !== organizationId) throw new DomainError("NOT_FOUND", "Recurso não encontrado.", 404);
  }

  recordAudit(input: Omit<AuditRecord, "id" | "createdAt" | "chainVersion" | "previousHash" | "recordHash">): AuditRecord {
    const previousHash = [...this.auditRecordsStore.values()].filter((record) => record.organizationId === input.organizationId).at(-1)?.recordHash ?? null;
    const unsigned: AuditRecord = { ...input, id: makeId(), chainVersion: 2, previousHash, recordHash: "", createdAt: now() };
    const audit: AuditRecord = { ...unsigned, recordHash: auditRecordHash(unsigned) };
    this.auditRecordsStore.set(audit.id, audit);
    return clone(audit);
  }

  getAssignment(assignmentId: OpaqueId): RoleAssignment {
    const assignment = this.roleAssignmentsStore.get(assignmentId);
    if (!assignment) throw new DomainError("NOT_FOUND", "Recurso não encontrado.", 404);
    return clone(assignment);
  }

  listUsers(context: CvgContext, query = ""): PublicUser[] {
    this.requireRole(context, ["admin"], "users:read");
    const normalized = query.toLowerCase();
    return [...this.usersStore.values()]
      .filter((user) => user.organizationId === context.organizationId && (!normalized || `${user.displayName} ${user.email}`.toLowerCase().includes(normalized)))
      .map((user) => ({ id: user.id, displayName: user.displayName, email: user.email, status: user.status, roles: this.effectiveAssignments(user.id, context.organizationId).map(({ id: assignmentId, role, scopeType, unitId, workspaceId, revokedAt }) => ({ id: assignmentId, role, scopeType, unitId, workspaceId, revokedAt })) }));
  }

  listAudit(context: CvgContext, limit = 25, cursor: string | null = null): AuditRecord[] {
    this.requireRole(context, ["admin"], "audit:read");
    return [...this.auditRecordsStore.values()]
      .filter((record) => record.organizationId === context.organizationId && (!cursor || record.id > cursor))
      .sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit).map((record) => clone(record));
  }

  listMessages(context: CvgContext): CommunicationMessage[] {
    this.requireRole(context, ["admin", "recepcao", "veterinario"], "communication:read");
    return [...this.messagesStore.values()].filter((message) => isInContext(message, context)).map(clone);
  }

  listKnowledgeDocuments(context: CvgContext): KnowledgeDocument[] {
    this.requireRole(context, ["admin", "veterinario", "recepcao"], "knowledge:read");
    return [...this.knowledgeDocumentsStore.values()].filter((document) => isInContext(document, context)).map(clone);
  }

  grantRole(context: CvgContext, input: RoleAssignmentInput): RoleAssignment {
    this.requireRole(context, ["admin"], "role:grant");
    const organization = this.organizationsStore.get(context.organizationId);
    if (!organization || organization.authorizationRevision !== BigInt(input.expectedRevision)) throw new DomainError("REVISION_CONFLICT", "A autorização mudou; recarregue o contexto antes de tentar novamente.", 409);
    const target = this.usersStore.get(input.userId);
    if (!target || target.organizationId !== context.organizationId) throw new DomainError("NOT_FOUND", "Recurso não encontrado.", 404);
    if (!isGrantableRole(input.role)) throw new DomainError("POLICY_DENIED", "Este papel não pode ser concedido pela superfície M1.", 403);
    if (input.userId === context.actorId) throw new DomainError("FORBIDDEN", "Um administrador não pode alterar o próprio vínculo.", 403);
    const unit = input.unitId ? this.unitsStore.get(input.unitId) : null;
    const workspace = input.workspaceId ? this.workspacesStore.get(input.workspaceId) : null;
    if ((unit && (unit.organizationId !== context.organizationId || unit.status !== "ACTIVE")) || (workspace && (workspace.organizationId !== context.organizationId || workspace.status !== "ACTIVE" || (unit && workspace.unitId !== unit.id)))) throw new DomainError("NOT_FOUND", "Recurso não encontrado.", 404);
    const duplicate = [...this.roleAssignmentsStore.values()].find((assignment) => assignment.organizationId === context.organizationId && assignment.userId === input.userId && assignment.role === input.role && assignment.scopeType === input.scopeType && assignment.unitId === input.unitId && assignment.workspaceId === input.workspaceId && !assignment.revokedAt);
    if (duplicate) throw new DomainError("ASSIGNMENT_EXISTS", "O vínculo ativo já existe.", 409);
    const assignment: RoleAssignment = { id: makeId(), organizationId: context.organizationId, userId: input.userId, role: input.role, scopeType: input.scopeType, unitId: input.unitId, workspaceId: input.workspaceId, grantedAt: now(), revokedAt: null };
    this.roleAssignmentsStore.set(assignment.id, assignment);
    organization.authorizationRevision += 1n;
    return clone(assignment);
  }

  revokeRole(context: CvgContext, assignmentId: OpaqueId, expectedRevision: string): RoleAssignment {
    this.requireRole(context, ["admin"], "role:revoke");
    const organization = this.organizationsStore.get(context.organizationId);
    if (!organization || organization.authorizationRevision !== BigInt(expectedRevision)) throw new DomainError("REVISION_CONFLICT", "A autorização mudou; recarregue o contexto antes de tentar novamente.", 409);
    const assignment = this.roleAssignmentsStore.get(assignmentId);
    if (!assignment || assignment.organizationId !== context.organizationId) throw new DomainError("NOT_FOUND", "Recurso não encontrado.", 404);
    if (assignment.revokedAt) throw new DomainError("ALREADY_REVOKED", "O vínculo já foi revogado.", 409);
    if (assignment.role === "admin" || assignment.userId === context.actorId) throw new DomainError("FORBIDDEN", "Administradores e o próprio vínculo exigem uma alçada separada.", 403);
    assignment.revokedAt = now();
    organization.authorizationRevision += 1n;
    return clone(assignment);
  }

  listGuardians(context: CvgContext, query = ""): Guardian[] {
    this.requireRole(context, ["admin", "veterinario", "recepcao"], "guardians:read");
    const normalized = query.trim().toLowerCase();
    return [...this.guardiansStore.values()].filter((guardian) => this.guardianScopeMatches(guardian, context) && guardian.status === "ACTIVE" && (!normalized || `${guardian.displayName} ${guardian.phone} ${guardian.email ?? ""}`.toLowerCase().includes(normalized))).map(clone);
  }

  createGuardian(context: CvgContext, input: { displayName: string; phone: string; email: string | null }): Guardian {
    this.requireRole(context, ["admin", "recepcao"], "guardians:create");
    const guardian: Guardian = { id: makeId(), organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId, displayName: input.displayName, phone: input.phone, email: input.email, dataClass: "D2", status: "ACTIVE" };
    this.guardiansStore.set(guardian.id, guardian);
    return clone(guardian);
  }

  private findPatientRecord(context: CvgContext, patientId: OpaqueId): AnimalPatient {
    const patient = this.patientsStore.get(patientId);
    if (!patient || patient.status === "MERGED" || !this.patientScopeMatches(patient, context)) throw new DomainError("NOT_FOUND", "Recurso não encontrado.", 404);
    return patient;
  }

  findPatient(context: CvgContext, patientId: OpaqueId): AnimalPatient {
    this.requireRole(context, ["admin", "veterinario", "recepcao", "financeiro", "estoque"], "patients:read");
    return clone(this.findPatientRecord(context, patientId));
  }

  listPatients(context: CvgContext, query = ""): Array<AnimalPatient & { guardian: Pick<Guardian, "id" | "displayName" | "phone"> | null }> {
    this.requireRole(context, ["admin", "veterinario", "recepcao", "financeiro", "estoque"], "patients:read");
    const normalized = query.trim().toLowerCase();
    return [...this.patientsStore.values()].filter((patient) => this.patientScopeMatches(patient, context) && patient.status === "ACTIVE" && (!normalized || `${patient.name} ${patient.species} ${patient.breed ?? ""}`.toLowerCase().includes(normalized))).map((patient) => clone({ ...patient, guardian: this.guardiansStore.get(patient.guardianId) ? (({ id: guardianId, displayName, phone }) => ({ id: guardianId, displayName, phone }))(this.guardiansStore.get(patient.guardianId)!) : null }));
  }

  createPatient(context: CvgContext, input: PatientInput): AnimalPatient {
    this.requireRole(context, ["admin", "recepcao", "veterinario"], "patients:create");
    const guardian = this.guardiansStore.get(input.guardianId);
    if (!guardian || !this.guardianScopeMatches(guardian, context)) throw new DomainError("NOT_FOUND", "Responsável não encontrado neste contexto.", 404);
    const patient: AnimalPatient = { id: makeId(), organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId, guardianId: input.guardianId, name: input.name, species: input.species, breed: input.breed, sex: input.sex, reproductiveStatus: input.reproductiveStatus, birthDate: input.birthDate, identifiers: [...input.identifiers], dataClass: "D3", status: "ACTIVE", mergedIntoId: null, statusChangedAt: null, createdAt: now() };
    this.patientsStore.set(patient.id, patient);
    return clone(patient);
  }

  disablePatient(context: CvgContext, patientId: OpaqueId): AnimalPatient {
    this.requireRole(context, ["admin", "recepcao", "veterinario"], "patients:disable");
    const patient = this.findPatientRecord(context, patientId);
    patient.status = "INACTIVE";
    patient.statusChangedAt = now();
    return clone(patient);
  }

  mergePatients(context: CvgContext, input: PatientMergeInput): AnimalPatient {
    this.requireRole(context, ["admin", "veterinario"], "patients:merge");
    const source = this.findPatientRecord(context, input.sourcePatientId);
    const target = this.findPatientRecord(context, input.targetPatientId);
    source.status = "MERGED";
    source.mergedIntoId = target.id;
    source.statusChangedAt = now();
    return clone(target);
  }

  createAppointment(context: CvgContext, input: AppointmentInput): Appointment {
    this.requireRole(context, ["admin", "recepcao", "veterinario"], "appointments:create");
    if (!context.unitId || !context.workspaceId) throw new DomainError("INVALID_INPUT", "Unidade e workspace são obrigatórios para agendar.", 400);
    const patient = this.findPatient(context, input.patientId);
    const provider = this.providersStore.get(input.providerId);
    const service = this.servicesStore.get(input.serviceId);
    const resource = input.resourceId ? this.resourcesStore.get(input.resourceId) : null;
    if (!provider || provider.organizationId !== context.organizationId || provider.unitId !== context.unitId || !service || service.organizationId !== context.organizationId || (input.resourceId && (!resource || resource.organizationId !== context.organizationId || resource.unitId !== context.unitId))) throw new DomainError("NOT_FOUND", "Recurso de agenda não encontrado.", 404);
    const overlaps = [...this.appointmentsStore.values()].some((appointment) => appointment.organizationId === context.organizationId && appointment.unitId === context.unitId && appointment.workspaceId === context.workspaceId && appointment.status !== "CANCELLED" && (appointment.providerId === input.providerId || (input.resourceId && appointment.resourceId === input.resourceId)) && new Date(input.startsAt).getTime() < new Date(appointment.endsAt).getTime() && new Date(input.endsAt).getTime() > new Date(appointment.startsAt).getTime());
    if (overlaps) throw new DomainError("CONFLICT", "A janela escolhida já está ocupada.", 409);
    void patient;
    const appointment: Appointment = { id: makeId(), organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId, patientId: input.patientId, providerId: input.providerId, resourceId: input.resourceId ?? null, serviceId: input.serviceId, startsAt: input.startsAt, endsAt: input.endsAt, purpose: input.purpose, status: "SCHEDULED", version: 1, createdAt: now() };
    this.appointmentsStore.set(appointment.id, appointment);
    return clone(appointment);
  }

  listAppointments(context: CvgContext, range: "today" | "week" = "today"): Appointment[] {
    this.requireRole(context, ["admin", "recepcao", "veterinario", "estoque", "financeiro"], "appointments:read");
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + (range === "week" ? 7 : 1));
    return [...this.appointmentsStore.values()].filter((appointment) => appointment.organizationId === context.organizationId && (!context.unitId || appointment.unitId === context.unitId) && (!context.workspaceId || appointment.workspaceId === context.workspaceId) && new Date(appointment.startsAt) >= start && new Date(appointment.startsAt) < end).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map(clone);
  }

  listQueue(context: CvgContext): QueueEntry[] {
    this.requireRole(context, ["admin", "recepcao", "veterinario"], "queue:read");
    return [...this.queueEntriesStore.values()].filter((entry) => {
      if (entry.organizationId !== context.organizationId || (context.unitId && entry.unitId !== context.unitId)) return false;
      if (!context.workspaceId) return true;
      const appointment = entry.appointmentId ? this.appointmentsStore.get(entry.appointmentId) : null;
      return Boolean(appointment && appointment.workspaceId === context.workspaceId);
    }).sort((a, b) => a.checkedInAt.localeCompare(b.checkedInAt)).map(clone);
  }

  createEncounter(context: CvgContext, input: { patientId: OpaqueId; appointmentId: OpaqueId | null; chiefComplaint: string; urgency: Encounter["urgency"] }): Encounter {
    this.requireRole(context, ["admin", "veterinario"], "encounters:create");
    if (!context.unitId || !context.workspaceId) throw new DomainError("INVALID_INPUT", "Contexto clínico incompleto.", 400);
    this.findPatient(context, input.patientId);
    if (input.appointmentId) {
      const appointment = this.appointmentsStore.get(input.appointmentId);
      if (!appointment || appointment.organizationId !== context.organizationId || appointment.unitId !== context.unitId || appointment.workspaceId !== context.workspaceId || appointment.patientId !== input.patientId) throw new DomainError("NOT_FOUND", "Reserva incompatível com o atendimento.", 404);
    }
    const encounter: Encounter = { id: makeId(), organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId, patientId: input.patientId, appointmentId: input.appointmentId, chiefComplaint: input.chiefComplaint, urgency: input.urgency, status: "OPEN", openedAt: now(), closedAt: null };
    this.encountersStore.set(encounter.id, encounter);
    return clone(encounter);
  }

  checkInAppointment(context: CvgContext, appointmentId: OpaqueId): QueueEntry {
    this.requireRole(context, ["admin", "recepcao", "veterinario"], "queue:check-in");
    const appointment = this.appointmentsStore.get(appointmentId);
    if (!appointment || appointment.organizationId !== context.organizationId || (context.unitId && appointment.unitId !== context.unitId) || (context.workspaceId && appointment.workspaceId !== context.workspaceId)) throw new DomainError("NOT_FOUND", "Reserva não encontrada.", 404);
    if (appointment.status === "CANCELLED" || appointment.status === "COMPLETED") throw new DomainError("INVALID_STATE", "A reserva não pode entrar na fila neste estado.", 409);
    const existing = [...this.queueEntriesStore.values()].find((entry) => entry.appointmentId === appointment.id && entry.status !== "CANCELLED" && entry.status !== "DONE");
    if (existing) return clone(existing);
    appointment.status = "CHECKED_IN";
    const entry: QueueEntry = { id: makeId(), organizationId: appointment.organizationId, unitId: appointment.unitId, appointmentId: appointment.id, patientId: appointment.patientId, status: "WAITING", priority: appointment.purpose.toLowerCase().includes("retorno") ? "URGENT" : "ROUTINE", checkedInAt: now() };
    this.queueEntriesStore.set(entry.id, entry);
    return clone(entry);
  }

  listEncounters(context: CvgContext): Encounter[] {
    this.requireRole(context, ["admin", "veterinario"], "encounters:read");
    return [...this.encountersStore.values()].filter((encounter) => encounter.organizationId === context.organizationId && (!context.unitId || encounter.unitId === context.unitId) && (!context.workspaceId || encounter.workspaceId === context.workspaceId)).map(clone);
  }

  createClinicalDocument(context: CvgContext, input: ClinicalDocumentInput): ClinicalDocument {
    this.requireRole(context, ["admin", "veterinario"], "clinical:write");
    const encounter = this.encountersStore.get(input.encounterId);
    if (!encounter || encounter.organizationId !== context.organizationId || (context.unitId && encounter.unitId !== context.unitId) || (context.workspaceId && encounter.workspaceId !== context.workspaceId)) throw new DomainError("NOT_FOUND", "Atendimento não encontrado.", 404);
    const document: ClinicalDocument = { id: makeId(), organizationId: context.organizationId, encounterId: encounter.id, patientId: encounter.patientId, authorId: context.actorId, documentType: input.documentType, title: input.title, content: input.content, dataClass: input.dataClass, status: "DRAFT", version: 1, signedAt: null, signedBy: null, createdAt: now() };
    this.clinicalDocumentsStore.set(document.id, document);
    return clone(document);
  }

  signClinicalDocument(context: CvgContext, documentId: OpaqueId, expectedVersion: string | null = null): ClinicalDocument {
    this.requireRole(context, ["veterinario"], "clinical:sign");
    const document = this.clinicalDocumentsStore.get(documentId);
    if (!document || document.organizationId !== context.organizationId) throw new DomainError("NOT_FOUND", "Documento não encontrado.", 404);
    const encounter = this.encountersStore.get(document.encounterId);
    if (!encounter || encounter.organizationId !== context.organizationId || encounter.patientId !== document.patientId || (context.unitId && encounter.unitId !== context.unitId) || (context.workspaceId && encounter.workspaceId !== context.workspaceId)) throw new DomainError("NOT_FOUND", "Documento não encontrado.", 404);
    if (expectedVersion !== null) {
      let parsedVersion: bigint;
      try {
        parsedVersion = BigInt(expectedVersion);
      } catch {
        throw new DomainError("INVALID_INPUT", "A versão esperada do documento é inválida.", 400);
      }
      if (parsedVersion !== BigInt(document.version)) throw new DomainError("REVISION_CONFLICT", "O documento clínico mudou; recarregue-o antes de assinar.", 409);
    }
    if (document.status === "SIGNED" || document.status === "PUBLISHED") throw new DomainError("CONFLICT", "Documento clínico já está assinado e não pode ser sobrescrito.", 409);
    document.status = "SIGNED";
    document.version += 1;
    document.signedAt = now();
    document.signedBy = context.actorId;
    return clone(document);
  }

  addClinicalAddendum(context: CvgContext, documentId: OpaqueId, reason: string, content: string): ClinicalAddendum {
    this.requireRole(context, ["veterinario"], "clinical:addendum");
    const document = this.clinicalDocumentsStore.get(documentId);
    if (!document || document.organizationId !== context.organizationId || document.status !== "SIGNED") throw new DomainError("INVALID_STATE", "Adendo só pode ser criado para documento assinado.", 409);
    const encounter = this.encountersStore.get(document.encounterId);
    if (!encounter || (context.unitId && encounter.unitId !== context.unitId) || (context.workspaceId && encounter.workspaceId !== context.workspaceId)) throw new DomainError("NOT_FOUND", "Documento não encontrado.", 404);
    const addendum: ClinicalAddendum = { id: makeId(), documentId, authorId: context.actorId, reason, content, createdAt: now() };
    this.clinicalAddendaStore.set(addendum.id, addendum);
    return clone(addendum);
  }

  createDiagnosticRequest(context: CvgContext, input: DiagnosticRequestInput): DiagnosticRequest {
    this.requireRole(context, ["veterinario"], "diagnostics:create");
    this.findPatient(context, input.patientId);
    if (!input.encounterId) throw new DomainError("INVALID_INPUT", "Atendimento é obrigatório para solicitar um exame.", 400);
    const encounter = this.encountersStore.get(input.encounterId);
    if (!encounter || encounter.organizationId !== context.organizationId || encounter.patientId !== input.patientId || (context.unitId && encounter.unitId !== context.unitId) || (context.workspaceId && encounter.workspaceId !== context.workspaceId)) throw new DomainError("NOT_FOUND", "Atendimento incompatível com o exame.", 404);
    const request: DiagnosticRequest = { id: makeId(), organizationId: context.organizationId, patientId: input.patientId, encounterId: input.encounterId, testName: input.testName, priority: input.priority, status: "REQUESTED", requestedBy: context.actorId, createdAt: now() };
    this.diagnosticRequestsStore.set(request.id, request);
    return clone(request);
  }

  createSpecimen(context: CvgContext, requestId: OpaqueId, label: string): Specimen {
    this.requireRole(context, ["veterinario"], "diagnostics:specimen");
    const request = this.diagnosticRequestsStore.get(requestId);
    if (!request || request.organizationId !== context.organizationId) throw new DomainError("NOT_FOUND", "Pedido de exame não encontrado.", 404);
    const encounter = request.encounterId ? this.encountersStore.get(request.encounterId) : null;
    if (!encounter || (context.unitId && encounter.unitId !== context.unitId) || (context.workspaceId && encounter.workspaceId !== context.workspaceId)) throw new DomainError("NOT_FOUND", "Pedido de exame não encontrado.", 404);
    if (request.status === "CANCELLED") throw new DomainError("INVALID_STATE", "Pedido cancelado não aceita amostra.", 409);
    const specimen: Specimen = { id: makeId(), organizationId: context.organizationId, requestId, patientId: request.patientId, label, collectedAt: now(), status: "COLLECTED" };
    this.specimensStore.set(specimen.id, specimen);
    request.status = "SPECIMEN_COLLECTED";
    return clone(specimen);
  }

  createResult(context: CvgContext, input: ResultInput): DiagnosticResult {
    this.requireRole(context, ["veterinario"], "diagnostics:result");
    const request = this.diagnosticRequestsStore.get(input.requestId);
    const specimen = this.specimensStore.get(input.specimenId);
    const encounter = request?.encounterId ? this.encountersStore.get(request.encounterId) : null;
    if (request && (request.organizationId !== context.organizationId || !encounter || (context.unitId && encounter.unitId !== context.unitId) || (context.workspaceId && encounter.workspaceId !== context.workspaceId))) throw new DomainError("NOT_FOUND", "Pedido de exame não encontrado.", 404);
    if (!request || !specimen || request.organizationId !== context.organizationId || specimen.organizationId !== context.organizationId || specimen.requestId !== request.id || specimen.patientId !== request.patientId) {
      const quarantinePatientId = request?.patientId ?? context.patientId;
      if (!quarantinePatientId) throw new DomainError("QUARANTINED", "Resultado incompatível sem paciente resolvido foi rejeitado sem persistência.", 409);
      const quarantineId = this.recordQuarantine("DIAGNOSTIC_RESULT", `Resultado incompatível: request=${input.requestId} specimen=${input.specimenId} patient=${quarantinePatientId}`);
      throw new DomainError("QUARANTINED", "Resultado incompatível enviado para quarentena.", 409, { resultId: quarantineId });
    }
    const result: DiagnosticResult = { id: makeId(), organizationId: context.organizationId, requestId: request.id, specimenId: specimen.id, patientId: request.patientId, value: input.value, source: input.source, sourceVersion: input.sourceVersion, status: "VALID", createdAt: now() };
    this.diagnosticResultsStore.set(result.id, result);
    request.status = "RESULTED";
    return clone(result);
  }

  listStock(context: CvgContext): Array<Lot & { product: Product | null; location: StockLocation | null }> {
    this.requireRole(context, ["admin", "estoque", "veterinario"], "stock:read");
    return [...this.lotsStore.values()].filter((lot) => lot.organizationId === context.organizationId && (!context.unitId || this.stockLocationsStore.get(lot.locationId)?.unitId === context.unitId)).map((lot) => clone({ ...lot, product: this.productsStore.get(lot.productId) ?? null, location: this.stockLocationsStore.get(lot.locationId) ?? null }));
  }

  listBeds(context: CvgContext): Bed[] {
    this.requireRole(context, ["admin", "veterinario"], "hospitalization:beds-read");
    return [...this.bedsStore.values()].filter((bed) => bed.organizationId === context.organizationId && (!context.unitId || bed.unitId === context.unitId)).map(clone);
  }

  listHospitalEpisodes(context: CvgContext): HospitalEpisode[] {
    this.requireRole(context, ["admin", "veterinario"], "hospitalization:read");
    return [...this.hospitalEpisodesStore.values()].filter((episode) => episode.organizationId === context.organizationId && (!context.unitId || episode.unitId === context.unitId)).map(clone);
  }

  createHospitalEpisode(context: CvgContext, input: { patientId: OpaqueId; encounterId: OpaqueId | null; bedId: OpaqueId | null }): HospitalEpisode {
    this.requireRole(context, ["veterinario"], "hospitalization:create");
    if (!context.unitId) throw new DomainError("INVALID_INPUT", "Unidade é obrigatória para internação.", 400);
    this.findPatient(context, input.patientId);
    if (input.encounterId) {
      const encounter = this.encountersStore.get(input.encounterId);
    if (!encounter || encounter.organizationId !== context.organizationId || encounter.unitId !== context.unitId || encounter.workspaceId !== context.workspaceId || encounter.patientId !== input.patientId) throw new DomainError("NOT_FOUND", "Atendimento incompatível com a internação.", 404);
    }
    const bed = input.bedId ? this.bedsStore.get(input.bedId) : null;
    if (input.bedId && (!bed || bed.organizationId !== context.organizationId || bed.unitId !== context.unitId || bed.status !== "AVAILABLE")) throw new DomainError("CONFLICT", "Leito indisponível para esta internação.", 409);
    const episode: HospitalEpisode = { id: makeId(), organizationId: context.organizationId, unitId: context.unitId, patientId: input.patientId, encounterId: input.encounterId, bedId: input.bedId, status: input.bedId ? "ADMITTED" : "PLANNED", admittedAt: input.bedId ? now() : null, dischargedAt: null };
    this.hospitalEpisodesStore.set(episode.id, episode);
    if (bed) bed.status = "OCCUPIED";
    return clone(episode);
  }

  createMedicationOrder(context: CvgContext, input: { patientId: OpaqueId; encounterId: OpaqueId | null; productId: OpaqueId; dose: string; route: string; frequency: string }): MedicationOrder {
    this.requireRole(context, ["veterinario"], "medication:prescribe");
    this.findPatient(context, input.patientId);
    if (!input.encounterId) throw new DomainError("INVALID_INPUT", "Atendimento é obrigatório para prescrever.", 400);
    const encounter = this.encountersStore.get(input.encounterId);
    if (!encounter || encounter.organizationId !== context.organizationId || encounter.patientId !== input.patientId || (context.unitId && encounter.unitId !== context.unitId) || (context.workspaceId && encounter.workspaceId !== context.workspaceId)) throw new DomainError("NOT_FOUND", "Atendimento incompatível com a prescrição.", 404);
    const product = this.productsStore.get(input.productId);
    if (!product || product.organizationId !== context.organizationId) throw new DomainError("NOT_FOUND", "Produto terapêutico não encontrado.", 404);
    const order: MedicationOrder = { id: makeId(), organizationId: context.organizationId, patientId: input.patientId, encounterId: input.encounterId, productId: input.productId, dose: input.dose, route: input.route, frequency: input.frequency, status: "ACTIVE", prescribedBy: context.actorId };
    this.medicationOrdersStore.set(order.id, order);
    return clone(order);
  }

  dispenseMedication(context: CvgContext, medicationOrderId: OpaqueId, lotId: OpaqueId, quantity: number): Dispensation {
    this.requireRole(context, ["admin", "estoque"], "medication:dispense");
    const order = this.medicationOrdersStore.get(medicationOrderId);
    const lot = this.lotsStore.get(lotId);
    const encounter = order?.encounterId ? this.encountersStore.get(order.encounterId) : null;
    if (!order || !lot || !encounter || order.organizationId !== context.organizationId || encounter.organizationId !== context.organizationId || (context.unitId && encounter.unitId !== context.unitId) || (context.workspaceId && encounter.workspaceId !== context.workspaceId) || lot.organizationId !== context.organizationId || order.productId !== lot.productId || (context.unitId && this.stockLocationsStore.get(lot.locationId)?.unitId !== context.unitId)) throw new DomainError("NOT_FOUND", "Prescrição ou lote não encontrado.", 404);
    this.createStockMovement(context, { productId: lot.productId, lotId, locationId: lot.locationId, quantity, movementType: "DISPENSE", reason: `Dispensação da prescrição ${medicationOrderId}`, referenceId: medicationOrderId });
    const dispensation: Dispensation = { id: makeId(), organizationId: context.organizationId, medicationOrderId, lotId, quantity, dispensedBy: context.actorId, createdAt: now() };
    this.dispensationsStore.set(dispensation.id, dispensation);
    return clone(dispensation);
  }

  administerMedication(context: CvgContext, medicationOrderId: OpaqueId, status: "ADMINISTERED" | "OMITTED" | "REFUSED", note: string | null): AdministrationOccurrence {
    this.requireRole(context, ["veterinario"], "medication:administer");
    const order = this.medicationOrdersStore.get(medicationOrderId);
    const encounter = order?.encounterId ? this.encountersStore.get(order.encounterId) : null;
    if (!order || !encounter || order.organizationId !== context.organizationId || encounter.organizationId !== context.organizationId || (context.unitId && encounter.unitId !== context.unitId) || (context.workspaceId && encounter.workspaceId !== context.workspaceId) || order.status !== "ACTIVE") throw new DomainError("NOT_FOUND", "Prescrição ativa não encontrada.", 404);
    const occurrence: AdministrationOccurrence = { id: makeId(), organizationId: context.organizationId, medicationOrderId, administeredBy: context.actorId, administeredAt: now(), status, note };
    this.administrationOccurrencesStore.set(occurrence.id, occurrence);
    return clone(occurrence);
  }

  listMedicationOrders(context: CvgContext): MedicationOrder[] {
    this.requireRole(context, ["admin", "veterinario", "estoque"], "medication:read");
    return [...this.medicationOrdersStore.values()].filter((order) => {
      const encounter = order.encounterId ? this.encountersStore.get(order.encounterId) : null;
      return order.organizationId === context.organizationId && Boolean(encounter) && (!context.unitId || encounter!.unitId === context.unitId) && (!context.workspaceId || encounter!.workspaceId === context.workspaceId);
    }).map(clone);
  }

  createStockMovement(context: CvgContext, input: StockMovementInput): StockMovement {
    this.requireRole(context, ["admin", "estoque"], "stock:write");
    const lot = this.lotsStore.get(input.lotId);
    const product = this.productsStore.get(input.productId);
    if (!lot || !product || lot.organizationId !== context.organizationId || product.organizationId !== context.organizationId || lot.productId !== product.id || (context.unitId && (lot.locationId !== input.locationId || this.stockLocationsStore.get(input.locationId)?.unitId !== context.unitId))) throw new DomainError("NOT_FOUND", "Lote não encontrado.", 404);
    const subtract = ["DISPENSE", "TRANSFER_OUT"].includes(input.movementType);
    const expiryTime = Date.parse(lot.expiresOn);
    if (!Number.isFinite(expiryTime)) throw new DomainError("CONFLICT", "Movimento rejeitado: a validade do lote é inválida.", 409, { expiresOn: lot.expiresOn });
    if (lot.status !== "AVAILABLE" || (subtract && (lot.quantity < input.quantity || expiryTime < Date.now()))) throw new DomainError("CONFLICT", expiryTime < Date.now() && subtract ? "Movimento rejeitado: lote vencido não pode sair do estoque." : "Movimento rejeitado: lote indisponível ou saldo insuficiente.", 409, { available: lot.quantity, expiresOn: lot.expiresOn });
    lot.quantity += subtract ? -input.quantity : input.quantity;
    const movement: StockMovement = { id: makeId(), organizationId: context.organizationId, productId: input.productId, lotId: input.lotId, locationId: input.locationId, quantity: input.quantity, movementType: input.movementType, reason: input.reason, referenceId: input.referenceId, createdBy: context.actorId, createdAt: now() };
    this.stockMovementsStore.set(movement.id, movement);
    return clone(movement);
  }

  createCharge(context: CvgContext, input: ChargeInput): Charge {
    this.requireRole(context, ["admin", "financeiro"], "finance:charge");
    if (!context.unitId) throw new DomainError("INVALID_INPUT", "Unidade é obrigatória para uma cobrança.", 400);
    if (input.patientId) this.findPatient(context, input.patientId);
    const charge: Charge = { id: makeId(), organizationId: context.organizationId, unitId: context.unitId, patientId: input.patientId, description: input.description, amountCents: input.amountCents, currency: input.currency, status: "OPEN", createdAt: now() };
    this.chargesStore.set(charge.id, charge);
    this.addLedger({ organizationId: context.organizationId, kind: "CHARGE", referenceId: charge.id, amountCents: charge.amountCents, currency: charge.currency, description: charge.description });
    return clone(charge);
  }

  createPayment(context: CvgContext, input: PaymentInput): Payment {
    this.requireRole(context, ["admin", "financeiro"], "finance:payment");
    const charge = this.chargesStore.get(input.chargeId);
    if (!charge || charge.organizationId !== context.organizationId || charge.unitId !== context.unitId) throw new DomainError("NOT_FOUND", "Cobrança não encontrada neste contexto.", 404);
    const paid = [...this.paymentsStore.values()].filter((payment) => payment.chargeId === charge.id && payment.status === "SETTLED").reduce((total, payment) => total + payment.amountCents, 0);
    if (paid + input.amountCents > charge.amountCents) throw new DomainError("CONFLICT", "Pagamento excede o saldo da cobrança.", 409);
    const payment: Payment = { id: makeId(), organizationId: context.organizationId, chargeId: charge.id, amountCents: input.amountCents, method: input.method, externalReference: input.externalReference, status: "SETTLED", createdAt: now() };
    this.paymentsStore.set(payment.id, payment);
    this.addLedger({ organizationId: context.organizationId, kind: "PAYMENT", referenceId: payment.id, amountCents: payment.amountCents, currency: charge.currency, description: `Pagamento ${payment.method}` });
    charge.status = paid + input.amountCents === charge.amountCents ? "PAID" : "PARTIALLY_PAID";
    return clone(payment);
  }

  requestRefund(context: CvgContext, paymentId: OpaqueId, reason: string): Payment {
    this.requireRole(context, ["admin", "financeiro"], "finance:refund");
    const payment = this.paymentsStore.get(paymentId);
    if (!payment || payment.organizationId !== context.organizationId) throw new DomainError("NOT_FOUND", "Pagamento não encontrado.", 404);
    if (payment.status !== "SETTLED") throw new DomainError("INVALID_STATE", "Somente pagamento liquidado pode receber estorno.", 409);
    const charge = this.chargesStore.get(payment.chargeId);
    if (!charge || charge.organizationId !== context.organizationId || charge.unitId !== context.unitId) throw new DomainError("NOT_FOUND", "Cobrança não encontrada neste contexto.", 404);
    payment.status = "REFUNDED";
    charge.status = "REFUNDED";
    this.addLedger({ organizationId: context.organizationId, kind: "REFUND", referenceId: payment.id, amountCents: -payment.amountCents, currency: charge.currency, description: `Estorno: ${reason}` });
    return clone(payment);
  }

  createKnowledgeDocument(context: CvgContext, input: { title: string; source: string; dataClass: KnowledgeDocument["dataClass"]; content: string }): KnowledgeDocument {
    this.requireRole(context, ["admin", "veterinario"], "knowledge:write");
    if (!context.unitId || !context.workspaceId) throw new DomainError("INVALID_INPUT", "Conhecimento precisa de unidade e workspace explícitos.", 400);
    if (!["D0", "D1", "D2"].includes(input.dataClass)) throw new DomainError("INVALID_INPUT", "Conhecimento clínico deve permanecer em D0–D2 até validação de classificação.", 400);
    const document: KnowledgeDocument = { id: makeId(), organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId, title: input.title, source: input.source, dataClass: input.dataClass, version: 1, status: "DRAFT", content: input.content, createdAt: now() };
    this.knowledgeDocumentsStore.set(document.id, document);
    return clone(document);
  }

  private addLedger(input: Omit<LedgerEntry, "id" | "createdAt">): LedgerEntry {
    const entry: LedgerEntry = { ...input, id: makeId(), createdAt: now() };
    this.ledgerEntriesStore.set(entry.id, entry);
    return entry;
  }

  createMessage(context: CvgContext, input: Pick<CommunicationMessage, "patientId" | "channel" | "recipient" | "template" | "body">): CommunicationMessage {
    this.requireRole(context, ["admin", "recepcao", "veterinario"], "communication:stage");
    if (!context.unitId || !context.workspaceId) throw new DomainError("INVALID_INPUT", "Comunicação precisa de unidade e workspace explícitos.", 400);
    if (input.patientId) this.findPatient(context, input.patientId);
    const message: CommunicationMessage = { ...input, id: makeId(), organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId, status: "APPROVAL_REQUIRED", createdBy: context.actorId, createdAt: now() };
    this.messagesStore.set(message.id, message);
    return clone(message);
  }

  decideMessage(context: CvgContext, messageId: OpaqueId, decision: "approved" | "rejected", reason: string | null = null): CommunicationMessage {
    this.requireRole(context, ["admin", "veterinario"], "communication:approve");
    const message = this.messagesStore.get(messageId);
    if (!message || message.organizationId !== context.organizationId || !this.scopeMatches(context, message.unitId, message.workspaceId)) throw new DomainError("NOT_FOUND", "Mensagem não encontrada neste contexto.", 404);
    if (message.status !== "APPROVAL_REQUIRED") throw new DomainError("INVALID_STATE", "A mensagem não está aguardando decisão.", 409);
    if (!message.createdBy || message.createdBy === context.actorId) throw new DomainError("POLICY_DENIED", "A aprovação de comunicação exige um segundo ator independente.", 403);
    message.decisionReason = reason;
    message.decidedBy = context.actorId;
    message.decidedAt = now();
    if (decision === "approved") {
      message.approvedBy = context.actorId;
      message.approvedAt = message.decidedAt;
    }
    message.status = decision === "approved" ? "QUEUED" : "FAILED";
    return clone(message);
  }
}

export interface IdempotencyInput {
  organizationId: OpaqueId;
  actorId: OpaqueId;
  /** Binds a command receipt to the authenticated session that created it. */
  sessionId?: OpaqueId | null;
  operation: string;
  key: string;
  resourceId: OpaqueId | null;
  unitId: OpaqueId | null;
  workspaceId: OpaqueId | null;
  body: unknown;
}

export function newCommandReceipt(input: IdempotencyInput): CommandReceipt {
  return {
    id: makeId(),
    organizationId: input.organizationId,
    actorId: input.actorId,
    unitId: input.unitId,
    workspaceId: input.workspaceId,
    auditRecordId: null,
    operation: input.operation,
    idempotencyLookup: idempotencyLookup(input),
    bodyDigest: digest({ v: 1, body: input.body }),
    status: "IN_FLIGHT",
    result: null,
    createdAt: now(),
    completedAt: null
  };
}

export function idempotencyLookup(input: IdempotencyInput): string {
  return digest({ v: 2, organizationId: input.organizationId, actorId: input.actorId, sessionId: input.sessionId ?? null, operation: input.operation, key: input.key, resourceId: input.resourceId, unitId: input.unitId, workspaceId: input.workspaceId });
}

export function idempotent<T>(store: CvgStore, input: IdempotencyInput, execute: () => T): { receipt: CommandReceipt; value: T; replayed: boolean } {
  const lookup = idempotencyLookup(input);
  const bodyDigest = digest({ v: 1, body: input.body });
  const existing = store.commandReceipts.get(lookup);
  if (existing) {
    if (existing.bodyDigest !== bodyDigest) throw new DomainError("IDEMPOTENCY_CONFLICT", "A chave já foi usada com outro corpo.", 409);
    if (existing.status === "SUCCEEDED") return { receipt: existing, value: existing.result as T, replayed: true };
    if (existing.status === "IN_FLIGHT" || existing.status === "OUTCOME_UNKNOWN") throw new DomainError("OUTCOME_UNKNOWN", "A execução anterior permanece em reconciliação.", 409, { receiptId: existing.id });
    throw new DomainError("CONFLICT", "A execução anterior falhou; use uma nova intenção.", 409);
  }
  store.setCommandReceipt(newCommandReceipt(input));
  try {
    const value = execute();
    const receipt = store.updateCommandReceipt(lookup, { status: "SUCCEEDED", result: value, completedAt: now() });
    return { receipt, value, replayed: false };
  } catch (error) {
    store.updateCommandReceipt(lookup, { status: error instanceof DomainError && error.code === "OUTCOME_UNKNOWN" ? "OUTCOME_UNKNOWN" : "FAILED", result: null, completedAt: now() });
    throw error;
  }
}

export interface IdempotentAsyncOptions {
  /** A database-backed IN_FLIGHT receipt reserved before the command starts. */
  reservedReceipt?: CommandReceipt;
}

/** Runs one idempotent command whose implementation crosses an asynchronous adapter. */
export async function idempotentAsync<T>(store: CvgStore, input: IdempotencyInput, execute: () => Promise<T>, options: IdempotentAsyncOptions = {}): Promise<{ receipt: CommandReceipt; value: T; replayed: boolean }> {
  const lookup = idempotencyLookup(input);
  const bodyDigest = digest({ v: 1, body: input.body });
  const reservedReceipt = options.reservedReceipt;
  if (reservedReceipt && (reservedReceipt.idempotencyLookup !== lookup || reservedReceipt.bodyDigest !== bodyDigest || reservedReceipt.status !== "IN_FLIGHT")) throw new DomainError("INVALID_INPUT", "A reserva de idempotência não corresponde ao comando.", 400);
  const existing = store.commandReceipts.get(lookup);
  if (existing && (!reservedReceipt || existing.id !== reservedReceipt.id)) {
    if (existing.bodyDigest !== bodyDigest) throw new DomainError("IDEMPOTENCY_CONFLICT", "A chave já foi usada com outro corpo.", 409);
    if (existing.status === "SUCCEEDED") return { receipt: existing, value: existing.result as T, replayed: true };
    if (existing.status === "IN_FLIGHT" || existing.status === "OUTCOME_UNKNOWN") throw new DomainError("OUTCOME_UNKNOWN", "A execução anterior permanece em reconciliação.", 409, { receiptId: existing.id });
    throw new DomainError("CONFLICT", "A execução anterior falhou; use uma nova intenção.", 409);
  }
  store.setCommandReceipt(reservedReceipt ?? newCommandReceipt(input));
  try {
    const value = await execute();
    const receipt = store.updateCommandReceipt(lookup, { status: "SUCCEEDED", result: value, completedAt: now() });
    return { receipt, value, replayed: false };
  } catch (error) {
    store.updateCommandReceipt(lookup, { status: error instanceof DomainError && error.code === "OUTCOME_UNKNOWN" ? "OUTCOME_UNKNOWN" : "FAILED", result: null, completedAt: now() });
    throw error;
  }
}

export function publicUser(user: User): Omit<User, "passwordDigest" | "security"> {
  const { passwordDigest: _passwordDigest, security: _security, ...safe } = user;
  return safe;
}

export function serializeSnapshot(snapshot: StoreSnapshot): string {
  return JSON.stringify(snapshot, (_key, value) => typeof value === "bigint" ? `${value}` : value, 2);
}

function nullableString(value: unknown, fallback: string | null = null): string | null {
  return value === null || typeof value === "string" ? value : fallback;
}

function normalizedAuthSecurity(value: unknown, createdAt: string): AuthSecurityState {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const credentialVersion = typeof raw.credentialVersion === "number" && Number.isSafeInteger(raw.credentialVersion) && raw.credentialVersion > 0 ? raw.credentialVersion : 1;
  const failedLoginAttempts = typeof raw.failedLoginAttempts === "number" && Number.isSafeInteger(raw.failedLoginAttempts) && raw.failedLoginAttempts >= 0 ? raw.failedLoginAttempts : 0;
  const recoveryCodeDigests = Array.isArray(raw.recoveryCodeDigests) ? raw.recoveryCodeDigests.filter((code): code is string => typeof code === "string" && /^[a-f0-9]{64}$/.test(code)) : [];
  return {
    passwordChangedAt: nullableString(raw.passwordChangedAt, createdAt),
    passwordExpiresAt: nullableString(raw.passwordExpiresAt),
    credentialVersion,
    failedLoginAttempts,
    lockedUntil: nullableString(raw.lockedUntil),
    mfaRequired: raw.mfaRequired === true,
    mfaSecretRef: nullableString(raw.mfaSecretRef),
    recoveryCodeDigests,
    recoveryCodesIssuedAt: nullableString(raw.recoveryCodesIssuedAt)
  };
}

export function parseSnapshot(raw: string): StoreSnapshot {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") throw new DomainError("INVALID_INPUT", "Snapshot inválido.", 400);
  const record = parsed as Record<string, unknown>;
  const arrayFields = [
    "organizations", "units", "workspaces", "users", "roleAssignments", "sessions", "auditRecords", "commandReceipts",
    "guardians", "patients", "providers", "services", "resources", "appointments", "queueEntries", "encounters",
    "clinicalDocuments", "clinicalAddenda", "diagnosticRequests", "specimens", "diagnosticResults", "hospitalEpisodes",
    "beds", "medicationOrders", "dispensations", "products", "lots", "stockLocations", "stockMovements", "charges",
    "payments", "ledgerEntries", "messages", "knowledgeDocuments", "aiSessions", "aiTurns", "aiDrafts", "aiApprovals",
    "budgetReservations", "administrationOccurrences", "quarantined"
  ] as const;
  const allowedFields = new Set<string>(["healthStatus", "authChallenges", ...arrayFields]);
  const unknownField = Object.keys(record).find((field) => !allowedFields.has(field));
  if (unknownField) throw new DomainError("INVALID_INPUT", `Snapshot inválido: campo de topo desconhecido ${unknownField}.`, 400);
  const healthStatus = record.healthStatus === undefined ? "READY" : record.healthStatus;
  if (healthStatus !== "READY" && healthStatus !== "QUARANTINED") throw new DomainError("INVALID_INPUT", "Snapshot inválido: healthStatus desconhecido.", 400);
  for (const field of arrayFields) {
    const value = record[field];
    if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || typeof (item as { id?: unknown }).id !== "string")) throw new DomainError("INVALID_INPUT", `Snapshot inválido: ${field} deve ser uma lista de recursos identificados.`, 400);
  }
  for (const result of record.diagnosticResults as Array<Record<string, unknown>>) validateHydratableDiagnosticResultStatus(result);
  const rawAuthChallenges = record.authChallenges ?? [];
  if (!Array.isArray(rawAuthChallenges) || rawAuthChallenges.some((item) => !item || typeof item !== "object" || typeof (item as { id?: unknown }).id !== "string")) throw new DomainError("INVALID_INPUT", "Snapshot inválido: authChallenges deve ser uma lista de recursos identificados.", 400);
  const users = (record.users as Array<Record<string, unknown>>).map((user) => {
    const createdAt = typeof user.createdAt === "string" ? user.createdAt : now();
    return { ...user, security: normalizedAuthSecurity(user.security, createdAt) };
  });
  const userVersions = new Map(users.map((user) => {
    const userId = (user as unknown as { id?: unknown }).id;
    return [typeof userId === "string" ? userId : "", (user.security as AuthSecurityState).credentialVersion] as const;
  }));
  const sessions = (record.sessions as Array<Record<string, unknown>>).map((session) => {
    const createdAt = typeof session.createdAt === "string" ? session.createdAt : now();
    const userId = typeof session.userId === "string" ? session.userId : "";
    const credentialVersion = typeof session.credentialVersion === "number" && Number.isSafeInteger(session.credentialVersion) && session.credentialVersion > 0 ? session.credentialVersion : userVersions.get(userId) ?? 1;
    return { ...session, deviceIdDigest: nullableString(session.deviceIdDigest), userAgentDigest: nullableString(session.userAgentDigest), ipDigest: nullableString(session.ipDigest), lastSeenAt: typeof session.lastSeenAt === "string" ? session.lastSeenAt : createdAt, mfaVerifiedAt: nullableString(session.mfaVerifiedAt), credentialVersion };
  });
  const organizations = (record.organizations as Array<Record<string, unknown>>).map((organization) => {
    const revision = organization.authorizationRevision;
    try {
      if (typeof revision === "string" && /^\d+$/.test(revision)) return { ...organization, authorizationRevision: BigInt(revision) };
      if (typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0) return { ...organization, authorizationRevision: BigInt(revision) };
    } catch {
      // Fall through to the same safe input error as any malformed snapshot.
    }
    throw new DomainError("INVALID_INPUT", "Snapshot inválido: authorizationRevision deve ser um inteiro serializado.", 400);
  });
  const scopedAuditRecords = (record.auditRecords as Array<Record<string, unknown>>).map((audit) => ({
    ...audit,
    unitId: audit.unitId === null || typeof audit.unitId === "string" ? audit.unitId : null,
    workspaceId: audit.workspaceId === null || typeof audit.workspaceId === "string" ? audit.workspaceId : null
  }));
  const commandReceipts = (record.commandReceipts as Array<Record<string, unknown>>).map((receipt) => ({
    ...receipt,
    unitId: receipt.unitId === null || typeof receipt.unitId === "string" ? receipt.unitId : null,
    workspaceId: receipt.workspaceId === null || typeof receipt.workspaceId === "string" ? receipt.workspaceId : null,
    auditRecordId: receipt.auditRecordId === null || typeof receipt.auditRecordId === "string" ? receipt.auditRecordId : null
  }));
  const scoped = (field: "messages" | "knowledgeDocuments" | "aiSessions") => (record[field] as Array<Record<string, unknown>>).map((resource) => ({
    ...resource,
    unitId: resource.unitId === null || typeof resource.unitId === "string" ? resource.unitId : null,
    workspaceId: resource.workspaceId === null || typeof resource.workspaceId === "string" ? resource.workspaceId : null
  }));
  const scopedValue = (value: unknown): string | null => value === null || typeof value === "string" ? value : null;
  const patientScopes = new Map<string, { unitId: string; workspaceId: string }>();
  const scopeCandidates = [
    ...(record.appointments as Array<Record<string, unknown>>).map((appointment) => ({
      patientId: typeof appointment.patientId === "string" ? appointment.patientId : null,
      unitId: scopedValue(appointment.unitId),
      workspaceId: scopedValue(appointment.workspaceId),
      priority: 1,
      observedAt: typeof appointment.startsAt === "string" ? appointment.startsAt : "",
      id: typeof appointment.id === "string" ? appointment.id : ""
    })),
    ...(record.encounters as Array<Record<string, unknown>>).map((encounter) => ({
      patientId: typeof encounter.patientId === "string" ? encounter.patientId : null,
      unitId: scopedValue(encounter.unitId),
      workspaceId: scopedValue(encounter.workspaceId),
      priority: 2,
      observedAt: typeof encounter.openedAt === "string" ? encounter.openedAt : "",
      id: typeof encounter.id === "string" ? encounter.id : ""
    }))
  ];
  for (const candidate of scopeCandidates.sort((left, right) => left.priority - right.priority || left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id))) {
    if (candidate.patientId && candidate.unitId && candidate.workspaceId && !patientScopes.has(candidate.patientId)) patientScopes.set(candidate.patientId, { unitId: candidate.unitId, workspaceId: candidate.workspaceId });
  }
  const guardianScopes = new Map<string, { unitId: string; workspaceId: string }>();
  for (const patient of [...(record.patients as Array<Record<string, unknown>>)].sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")) || String(left.id).localeCompare(String(right.id)))) {
    const guardianId = typeof patient.guardianId === "string" ? patient.guardianId : null;
    const scope = patientScopes.get(typeof patient.id === "string" ? patient.id : "") ?? (scopedValue(patient.unitId) && scopedValue(patient.workspaceId) ? { unitId: scopedValue(patient.unitId)!, workspaceId: scopedValue(patient.workspaceId)! } : null);
    if (guardianId && scope && !guardianScopes.has(guardianId)) guardianScopes.set(guardianId, scope);
  }
  const scopedPeople = (field: "guardians" | "patients") => (record[field] as Array<Record<string, unknown>>).map((resource) => {
    const existingUnitId = scopedValue(resource.unitId);
    const existingWorkspaceId = scopedValue(resource.workspaceId);
    const inferred = field === "patients" ? patientScopes.get(typeof resource.id === "string" ? resource.id : "") : guardianScopes.get(typeof resource.id === "string" ? resource.id : "");
    return {
      ...resource,
      unitId: inferred?.unitId ?? existingUnitId,
      workspaceId: inferred?.workspaceId ?? existingWorkspaceId
    };
  });
  const snapshot = { ...record, healthStatus, organizations, users, sessions, authChallenges: rawAuthChallenges, auditRecords: scopedAuditRecords, commandReceipts, guardians: scopedPeople("guardians"), patients: scopedPeople("patients"), messages: scoped("messages"), knowledgeDocuments: scoped("knowledgeDocuments"), aiSessions: scoped("aiSessions") } as unknown as StoreSnapshot;
  validateDomainSnapshot(snapshot);
  return snapshot;
}
