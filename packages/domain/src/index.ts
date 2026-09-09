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

export class CvgStore {
  public readonly organizations = new Map<string, Organization>();
  public readonly units = new Map<string, Unit>();
  public readonly workspaces = new Map<string, Workspace>();
  public readonly users = new Map<string, User>();
  public readonly roleAssignments = new Map<string, RoleAssignment>();
  public readonly sessions = new Map<string, Session>();
  public readonly auditRecords = new Map<string, AuditRecord>();
  public readonly commandReceipts = new Map<string, CommandReceipt>();
  public readonly guardians = new Map<string, Guardian>();
  public readonly patients = new Map<string, AnimalPatient>();
  public readonly providers = new Map<string, Provider>();
  public readonly services = new Map<string, ServiceCatalogItem>();
  public readonly resources = new Map<string, Resource>();
  public readonly appointments = new Map<string, Appointment>();
  public readonly queueEntries = new Map<string, QueueEntry>();
  public readonly encounters = new Map<string, Encounter>();
  public readonly clinicalDocuments = new Map<string, ClinicalDocument>();
  public readonly clinicalAddenda = new Map<string, ClinicalAddendum>();
  public readonly diagnosticRequests = new Map<string, DiagnosticRequest>();
  public readonly specimens = new Map<string, Specimen>();
  public readonly diagnosticResults = new Map<string, DiagnosticResult>();
  public readonly hospitalEpisodes = new Map<string, HospitalEpisode>();
  public readonly beds = new Map<string, Bed>();
  public readonly medicationOrders = new Map<string, MedicationOrder>();
  public readonly dispensations = new Map<string, Dispensation>();
  public readonly products = new Map<string, Product>();
  public readonly lots = new Map<string, Lot>();
  public readonly stockLocations = new Map<string, StockLocation>();
  public readonly stockMovements = new Map<string, StockMovement>();
  public readonly charges = new Map<string, Charge>();
  public readonly payments = new Map<string, Payment>();
  public readonly ledgerEntries = new Map<string, LedgerEntry>();
  public readonly messages = new Map<string, CommunicationMessage>();
  public readonly knowledgeDocuments = new Map<string, KnowledgeDocument>();
  public readonly aiSessions = new Map<string, AiSession>();
  public readonly aiTurns = new Map<string, AiTurn>();
  public readonly aiDrafts = new Map<string, AiDraft>();
  public readonly aiApprovals = new Map<string, AiApproval>();
  public readonly budgetReservations = new Map<string, BudgetReservation>();
  public readonly administrationOccurrences = new Map<string, AdministrationOccurrence>();
  public readonly authChallenges = new Map<string, AuthChallenge>();
  public readonly quarantined: Array<{ id: OpaqueId; kind: string; reason: string; createdAt: string }> = [];
  public readonly bootstrapCredentials: BootstrapCredentials;
  public storageMode: "memory" | "postgres" = "memory";
  public healthStatus: "READY" | "QUARANTINED" = "READY";

  constructor(options: StoreOptions = {}) {
    const password = options.bootstrapPassword ?? randomBytes(18).toString("base64url");
    this.bootstrapCredentials = { login: "admin@cvg.local", password, userId: id("00000000-0000-4000-8000-000000000001"), organizationId: id("00000000-0000-4000-8000-000000000010") };
    if (options.seed !== false) this.seed(password);
  }

  private seed(password: string): void {
    const organizationId = this.bootstrapCredentials.organizationId;
    const centroId = id("00000000-0000-4000-8000-000000000011");
    const sulId = id("00000000-0000-4000-8000-000000000012");
    const clinicalCentroId = id("00000000-0000-4000-8000-000000000021");
    const receptionCentroId = id("00000000-0000-4000-8000-000000000022");
    const clinicalSulId = id("00000000-0000-4000-8000-000000000023");
    const createdAt = now();
    this.organizations.set(organizationId, { id: organizationId, name: "CVG Saúde Animal", slug: "cvg-saude-animal", status: "ACTIVE", authorizationRevision: 1n, createdAt });
    this.units.set(centroId, { id: centroId, organizationId, name: "Unidade Centro", code: "CTR", status: "ACTIVE" });
    this.units.set(sulId, { id: sulId, organizationId, name: "Unidade Sul", code: "SUL", status: "ACTIVE" });
    this.workspaces.set(clinicalCentroId, { id: clinicalCentroId, organizationId, unitId: centroId, name: "Operação clínica", purpose: "Atendimento e cuidado", status: "ACTIVE" });
    this.workspaces.set(receptionCentroId, { id: receptionCentroId, organizationId, unitId: centroId, name: "Recepção", purpose: "Agenda e acolhimento", status: "ACTIVE" });
    this.workspaces.set(clinicalSulId, { id: clinicalSulId, organizationId, unitId: sulId, name: "Operação clínica", purpose: "Atendimento e cuidado", status: "ACTIVE" });

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
      this.users.set(userId, user);
      if (userId === adminId) this.addAssignment({ id: makeId(), organizationId, userId, role: "admin", scopeType: "ORGANIZATION", unitId: null, workspaceId: null, grantedAt: createdAt, revokedAt: null });
      const typedRole = role as Role;
      const workspaceId = typedRole === "recepcao" ? receptionCentroId : typedRole === "operador" ? null : clinicalCentroId;
      this.addAssignment({ id: makeId(), organizationId, userId, role: typedRole, scopeType: workspaceId ? "WORKSPACE" : "UNIT", unitId: centroId, workspaceId, grantedAt: createdAt, revokedAt: null });
      void emailLabel;
    }

    const guardianA = id("00000000-0000-4000-8000-000000000101");
    const guardianB = id("00000000-0000-4000-8000-000000000102");
    this.guardians.set(guardianA, { id: guardianA, organizationId, unitId: centroId, workspaceId: clinicalCentroId, displayName: "Marina Souza", phone: "+55 11 98888-1200", email: "marina.souza@example.test", dataClass: "D2", status: "ACTIVE" });
    this.guardians.set(guardianB, { id: guardianB, organizationId, unitId: centroId, workspaceId: receptionCentroId, displayName: "João Mendes", phone: "+55 11 97777-4300", email: "joao.mendes@example.test", dataClass: "D2", status: "ACTIVE" });
    const patientA = id("00000000-0000-4000-8000-000000000111");
    const patientB = id("00000000-0000-4000-8000-000000000112");
    this.patients.set(patientA, { id: patientA, organizationId, unitId: centroId, workspaceId: clinicalCentroId, guardianId: guardianA, name: "Luna", species: "Canina", breed: "Golden retriever", sex: "FEMALE", reproductiveStatus: "NEUTERED", birthDate: "2020-05-19", identifiers: ["MICRO-9812"], dataClass: "D3", status: "ACTIVE", mergedIntoId: null, statusChangedAt: null, createdAt });
    this.patients.set(patientB, { id: patientB, organizationId, unitId: centroId, workspaceId: receptionCentroId, guardianId: guardianB, name: "Nino", species: "Felina", breed: "SRD", sex: "MALE", reproductiveStatus: "INTACT", birthDate: "2022-11-03", identifiers: ["MICRO-7341"], dataClass: "D3", status: "ACTIVE", mergedIntoId: null, statusChangedAt: null, createdAt });

    const providerA = id("00000000-0000-4000-8000-000000000121");
    const serviceConsult = id("00000000-0000-4000-8000-000000000131");
    const roomA = id("00000000-0000-4000-8000-000000000141");
    this.providers.set(providerA, { id: providerA, organizationId, displayName: "Dra. Ana Martins", specialty: "Clínica geral", role: "veterinario", unitId: centroId, status: "ACTIVE" });
    this.services.set(serviceConsult, { id: serviceConsult, organizationId, name: "Consulta clínica", durationMinutes: 45, priceCents: 22000, status: "ACTIVE" });
    this.resources.set(roomA, { id: roomA, organizationId, unitId: centroId, name: "Consultório 02", kind: "ROOM", status: "ACTIVE" });
    const day = new Date();
    day.setHours(10, 30, 0, 0);
    const startsAt = day.toISOString();
    const ends = new Date(day.getTime() + 45 * 60_000).toISOString();
    this.appointments.set(id("00000000-0000-4000-8000-000000000151"), { id: id("00000000-0000-4000-8000-000000000151"), organizationId, unitId: centroId, workspaceId: clinicalCentroId, patientId: patientA, providerId: providerA, resourceId: roomA, serviceId: serviceConsult, startsAt, endsAt: ends, purpose: "Retorno pós-operatório", status: "CONFIRMED", version: 1, createdAt });
    this.appointments.set(id("00000000-0000-4000-8000-000000000152"), { id: id("00000000-0000-4000-8000-000000000152"), organizationId, unitId: centroId, workspaceId: receptionCentroId, patientId: patientB, providerId: providerA, resourceId: roomA, serviceId: serviceConsult, startsAt: new Date(day.getTime() + 90 * 60_000).toISOString(), endsAt: new Date(day.getTime() + 135 * 60_000).toISOString(), purpose: "Avaliação dermatológica", status: "SCHEDULED", version: 1, createdAt });
    const queueId = makeId();
    this.queueEntries.set(queueId, { id: queueId, organizationId, unitId: centroId, appointmentId: id("00000000-0000-4000-8000-000000000151"), patientId: patientA, status: "WAITING", priority: "URGENT", checkedInAt: createdAt });

    const locationId = id("00000000-0000-4000-8000-000000000161");
    const productId = id("00000000-0000-4000-8000-000000000171");
    const lotId = id("00000000-0000-4000-8000-000000000181");
    this.stockLocations.set(locationId, { id: locationId, organizationId, unitId: centroId, name: "Farmácia — Centro" });
    this.products.set(productId, { id: productId, organizationId, sku: "AMOX-50", name: "Amoxicilina 50 mg", category: "Antimicrobiano", unit: "comprimido", reorderPoint: 40, status: "ACTIVE" });
    this.lots.set(lotId, { id: lotId, organizationId, productId, lotNumber: "AMX-25-08", expiresOn: "2027-08-31", quantity: 128, locationId, status: "AVAILABLE" });
    const bedId = id("00000000-0000-4000-8000-000000000191");
    this.beds.set(bedId, { id: bedId, organizationId, unitId: centroId, name: "Baia de recuperação 01", status: "AVAILABLE" });
    const chargeId = makeId();
    this.charges.set(chargeId, { id: chargeId, organizationId, unitId: centroId, patientId: patientA, description: "Consulta clínica", amountCents: 22000, currency: "BRL", status: "OPEN", createdAt });
    const knowledgeId = makeId();
    this.knowledgeDocuments.set(knowledgeId, { id: knowledgeId, organizationId, unitId: centroId, workspaceId: clinicalCentroId, title: "Protocolo de retorno pós-operatório", source: "Direção clínica · fixture sintética", dataClass: "D1", version: 1, status: "APPROVED", content: "Confirmar sinais vitais, ferida operatória, dor e adesão à medicação.", createdAt });
  }

  private addAssignment(assignment: RoleAssignment): void {
    this.roleAssignments.set(assignment.id, assignment);
  }

  snapshot(): StoreSnapshot {
    const maps = [
      this.organizations, this.units, this.workspaces, this.users, this.roleAssignments, this.sessions,
      this.auditRecords, this.commandReceipts, this.guardians, this.patients, this.providers, this.services,
      this.resources, this.appointments, this.queueEntries, this.encounters, this.clinicalDocuments,
      this.clinicalAddenda, this.diagnosticRequests, this.specimens, this.diagnosticResults, this.hospitalEpisodes,
      this.beds, this.medicationOrders, this.dispensations, this.products, this.lots, this.stockLocations,
      this.stockMovements, this.charges, this.payments, this.ledgerEntries, this.messages, this.knowledgeDocuments,
      this.aiSessions, this.aiTurns, this.aiDrafts, this.aiApprovals, this.budgetReservations, this.administrationOccurrences, this.authChallenges
    ];
    const values = maps.map((map) => [...map.values()].map(clone));
    return {
      healthStatus: this.healthStatus,
      organizations: values[0] as Organization[], units: values[1] as Unit[], workspaces: values[2] as Workspace[], users: values[3] as User[], roleAssignments: values[4] as RoleAssignment[], sessions: values[5] as Session[], auditRecords: values[6] as AuditRecord[], commandReceipts: values[7] as CommandReceipt[], guardians: values[8] as Guardian[], patients: values[9] as AnimalPatient[], providers: values[10] as Provider[], services: values[11] as ServiceCatalogItem[], resources: values[12] as Resource[], appointments: values[13] as Appointment[], queueEntries: values[14] as QueueEntry[], encounters: values[15] as Encounter[], clinicalDocuments: values[16] as ClinicalDocument[], clinicalAddenda: values[17] as ClinicalAddendum[], diagnosticRequests: values[18] as DiagnosticRequest[], specimens: values[19] as Specimen[], diagnosticResults: values[20] as DiagnosticResult[], hospitalEpisodes: values[21] as HospitalEpisode[], beds: values[22] as Bed[], medicationOrders: values[23] as MedicationOrder[], dispensations: values[24] as Dispensation[], products: values[25] as Product[], lots: values[26] as Lot[], stockLocations: values[27] as StockLocation[], stockMovements: values[28] as StockMovement[], charges: values[29] as Charge[], payments: values[30] as Payment[], ledgerEntries: values[31] as LedgerEntry[], messages: values[32] as CommunicationMessage[], knowledgeDocuments: values[33] as KnowledgeDocument[], aiSessions: values[34] as AiSession[], aiTurns: values[35] as AiTurn[], aiDrafts: values[36] as AiDraft[], aiApprovals: values[37] as AiApproval[], budgetReservations: values[38] as BudgetReservation[], administrationOccurrences: values[39] as AdministrationOccurrence[], authChallenges: values[40] as AuthChallenge[], quarantined: clone(this.quarantined)
    };
  }

  restore(snapshot: StoreSnapshot): void {
    this.clearData();
    this.loadSnapshot(snapshot);
    this.quarantine("RESTORE", "journal independente e autoridade corrente não foram fornecidos");
  }

  quarantine(kind: string, reason: string): void {
    this.healthStatus = "QUARANTINED";
    for (const session of this.sessions.values()) session.revokedAt = now();
    this.quarantined.push({ id: makeId(), kind, reason, createdAt: now() });
  }

  hydrate(snapshot: StoreSnapshot): void {
    this.clearData();
    this.loadSnapshot(snapshot);
    this.healthStatus = snapshot.healthStatus;
  }

  private loadSnapshot(snapshot: StoreSnapshot): void {
    const entries: Array<[Map<string, unknown>, unknown[]]> = [
      [this.organizations, snapshot.organizations], [this.units, snapshot.units], [this.workspaces, snapshot.workspaces], [this.users, snapshot.users], [this.roleAssignments, snapshot.roleAssignments], [this.sessions, snapshot.sessions], [this.auditRecords, snapshot.auditRecords], [this.commandReceipts, snapshot.commandReceipts], [this.guardians, snapshot.guardians], [this.patients, snapshot.patients], [this.providers, snapshot.providers], [this.services, snapshot.services], [this.resources, snapshot.resources], [this.appointments, snapshot.appointments], [this.queueEntries, snapshot.queueEntries], [this.encounters, snapshot.encounters], [this.clinicalDocuments, snapshot.clinicalDocuments], [this.clinicalAddenda, snapshot.clinicalAddenda], [this.diagnosticRequests, snapshot.diagnosticRequests], [this.specimens, snapshot.specimens], [this.diagnosticResults, snapshot.diagnosticResults], [this.hospitalEpisodes, snapshot.hospitalEpisodes], [this.beds, snapshot.beds], [this.medicationOrders, snapshot.medicationOrders], [this.dispensations, snapshot.dispensations], [this.products, snapshot.products], [this.lots, snapshot.lots], [this.stockLocations, snapshot.stockLocations], [this.stockMovements, snapshot.stockMovements], [this.charges, snapshot.charges], [this.payments, snapshot.payments], [this.ledgerEntries, snapshot.ledgerEntries], [this.messages, snapshot.messages], [this.knowledgeDocuments, snapshot.knowledgeDocuments], [this.aiSessions, snapshot.aiSessions], [this.aiTurns, snapshot.aiTurns], [this.aiDrafts, snapshot.aiDrafts], [this.aiApprovals, snapshot.aiApprovals], [this.budgetReservations, snapshot.budgetReservations], [this.administrationOccurrences, snapshot.administrationOccurrences], [this.authChallenges, snapshot.authChallenges]
    ];
    for (const [map, list] of entries) for (const value of list) {
      const resource = value as { id: OpaqueId; idempotencyLookup?: string };
      const key = map === this.commandReceipts ? resource.idempotencyLookup ?? resource.id : resource.id;
      map.set(key, clone(value));
    }
    this.quarantined.splice(0, this.quarantined.length, ...snapshot.quarantined.map(clone));
  }

  private clearData(): void {
    for (const map of [this.organizations, this.units, this.workspaces, this.users, this.roleAssignments, this.sessions, this.auditRecords, this.commandReceipts, this.guardians, this.patients, this.providers, this.services, this.resources, this.appointments, this.queueEntries, this.encounters, this.clinicalDocuments, this.clinicalAddenda, this.diagnosticRequests, this.specimens, this.diagnosticResults, this.hospitalEpisodes, this.beds, this.medicationOrders, this.dispensations, this.products, this.lots, this.stockLocations, this.stockMovements, this.charges, this.payments, this.ledgerEntries, this.messages, this.knowledgeDocuments, this.aiSessions, this.aiTurns, this.aiDrafts, this.aiApprovals, this.budgetReservations, this.administrationOccurrences, this.authChallenges]) map.clear();
  }

  getUserByLogin(login: string): User | undefined {
    const normalized = login.trim().toLowerCase();
    return [...this.users.values()].find((user) => user.login.toLowerCase() === normalized);
  }

  getUser(userId: OpaqueId): User {
    const user = this.users.get(userId);
    if (!user) throw new DomainError("UNAUTHENTICATED", "Sessão inválida.", 401);
    return user;
  }

  createSession(userId: OpaqueId, tokenDigest: string, csrfToken: string, ttlMinutes: number, metadata: SessionMetadata = {}): Session {
    const user = this.getUser(userId);
    const createdAt = now();
    const session: Session = { id: makeId(), tokenDigest, userId, organizationId: user.organizationId, csrfToken, expiresAt: new Date(Date.now() + ttlMinutes * 60_000).toISOString(), revokedAt: null, deviceIdDigest: metadata.deviceIdDigest ?? null, userAgentDigest: metadata.userAgentDigest ?? null, ipDigest: metadata.ipDigest ?? null, lastSeenAt: createdAt, mfaVerifiedAt: metadata.mfaVerifiedAt ?? null, credentialVersion: user.security.credentialVersion, createdAt };
    this.sessions.set(session.id, session);
    return session;
  }

  findSession(tokenDigest: string): Session | undefined {
    const session = [...this.sessions.values()].find((candidate) => candidate.tokenDigest === tokenDigest);
    const user = session ? this.users.get(session.userId) : undefined;
    if (!session || !user || user.status !== "ACTIVE" || session.revokedAt || Date.parse(session.expiresAt) <= Date.now() || session.credentialVersion !== user.security.credentialVersion) return undefined;
    if (this.healthStatus === "QUARANTINED") return undefined;
    return session;
  }

  touchSession(session: Session): void {
    session.lastSeenAt = now();
  }

  revokeSession(session: Session): void {
    session.revokedAt = now();
  }

  revokeAllSessions(userId: OpaqueId, exceptSessionId: OpaqueId | null = null): number {
    let count = 0;
    for (const session of this.sessions.values()) {
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
    const user = this.getUser(userId);
    const attempts = user.security.failedLoginAttempts + 1;
    user.security.failedLoginAttempts = attempts;
    if (attempts >= maxAttempts) user.security.lockedUntil = new Date(Date.now() + lockoutMinutes * 60_000).toISOString();
    return user;
  }

  clearLoginFailures(user: User): void {
    user.security.failedLoginAttempts = 0;
    user.security.lockedUntil = null;
  }

  rotatePassword(userId: OpaqueId, passwordDigest: string, passwordExpiresAt: string | null): User {
    const user = this.getUser(userId);
    user.passwordDigest = passwordDigest;
    user.security.passwordChangedAt = now();
    user.security.passwordExpiresAt = passwordExpiresAt;
    user.security.credentialVersion += 1;
    this.clearLoginFailures(user);
    this.revokeAllSessions(user.id);
    return user;
  }

  issueRecoveryCodes(userId: OpaqueId, count = 8): string[] {
    const user = this.getUser(userId);
    const codes = generateRecoveryCodes(count);
    user.security.recoveryCodeDigests = codes.map(digestRecoveryCode);
    user.security.recoveryCodesIssuedAt = now();
    return codes;
  }

  consumeRecoveryCode(userId: OpaqueId, code: string): boolean {
    const user = this.getUser(userId);
    const digest = digestRecoveryCode(code);
    const index = user.security.recoveryCodeDigests.indexOf(digest);
    if (index < 0) return false;
    user.security.recoveryCodeDigests.splice(index, 1);
    return true;
  }

  createAuthChallenge(type: AuthChallenge["type"], userId: OpaqueId, tokenDigest: string, ttlSeconds: number, maxAttempts: number): AuthChallenge {
    const user = this.getUser(userId);
    const challenge: AuthChallenge = { id: makeId(), type, tokenDigest, userId, organizationId: user.organizationId, credentialVersion: user.security.credentialVersion, expiresAt: new Date(Date.now() + ttlSeconds * 1_000).toISOString(), attempts: 0, maxAttempts, status: "PENDING", consumedAt: null, createdAt: now() };
    this.authChallenges.set(challenge.id, challenge);
    return challenge;
  }

  findAuthChallenge(type: AuthChallenge["type"], tokenDigest: string): AuthChallenge | undefined {
    const challenge = [...this.authChallenges.values()].find((candidate) => candidate.type === type && candidate.tokenDigest === tokenDigest);
    if (!challenge || challenge.status !== "PENDING") return undefined;
    const user = this.users.get(challenge.userId);
    if (!user || user.status !== "ACTIVE" || user.security.credentialVersion !== challenge.credentialVersion) {
      challenge.status = "EXPIRED";
      return undefined;
    }
    if (Date.parse(challenge.expiresAt) <= Date.now()) {
      challenge.status = "EXPIRED";
      return undefined;
    }
    return challenge;
  }

  recordChallengeFailure(challenge: AuthChallenge): void {
    challenge.attempts += 1;
    if (challenge.attempts >= challenge.maxAttempts) {
      challenge.status = "LOCKED";
      challenge.consumedAt = now();
    }
  }

  consumeAuthChallenge(challenge: AuthChallenge): void {
    if (challenge.status !== "PENDING") throw new DomainError("MFA_INVALID", "O desafio de autenticação não está disponível.", 401);
    challenge.status = "CONSUMED";
    challenge.consumedAt = now();
  }

  effectiveAssignments(userId: OpaqueId, organizationId: OpaqueId): RoleAssignment[] {
    return [...this.roleAssignments.values()].filter((assignment) => assignment.userId === userId && assignment.organizationId === organizationId && !assignment.revokedAt);
  }

  contextOptions(userId: OpaqueId): ContextOption[] {
    const user = this.getUser(userId);
    const assignments = this.effectiveAssignments(userId, user.organizationId);
    const options: ContextOption[] = [];
    for (const unit of this.units.values()) {
      if (unit.organizationId !== user.organizationId) continue;
      for (const workspace of this.workspaces.values()) {
        if (workspace.unitId !== unit.id) continue;
        const roles = assignments.filter((assignment) => this.assignmentMatches(assignment, unit.id, workspace.id)).map((assignment) => assignment.role);
        if (roles.length) {
          const organization = this.organizations.get(user.organizationId);
          if (organization) options.push({ organization: { id: organization.id, name: organization.name, slug: organization.slug }, unit: clone(unit), workspace: clone(workspace), roles: [...new Set(roles)] });
        }
      }
    }
    return options;
  }

  resolveContext(userId: OpaqueId, selector: ContextSelector, purpose: string, correlationId: string, patientId: OpaqueId | null = null, encounterId: OpaqueId | null = null, sessionId: OpaqueId | null = null): CvgContext {
    const user = this.getUser(userId);
    const assignments = this.effectiveAssignments(userId, user.organizationId);
    const unit = selector.unitId ? this.units.get(selector.unitId) : undefined;
    const workspace = selector.workspaceId ? this.workspaces.get(selector.workspaceId) : undefined;
    if (unit && unit.organizationId !== user.organizationId) throw new DomainError("NOT_FOUND", "Contexto não encontrado.", 404);
    if (workspace && (workspace.organizationId !== user.organizationId || (unit && workspace.unitId !== unit.id))) throw new DomainError("NOT_FOUND", "Contexto não encontrado.", 404);
    const matching = assignments.filter((assignment) => this.assignmentMatches(assignment, unit?.id ?? null, workspace?.id ?? null));
    if (!matching.length) throw new DomainError("FORBIDDEN", "O ator não possui autorização para este contexto.", 403);
    return { organizationId: user.organizationId, unitId: unit?.id ?? null, workspaceId: workspace?.id ?? null, actorId: userId, sessionId, actorRoleSnapshot: [...new Set(matching.map((assignment) => assignment.role))], patientId, encounterId, purpose, policyRevision: String(this.organizations.get(user.organizationId)?.authorizationRevision ?? 0n), correlationId };
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
    return [...this.appointments.values()].some((appointment) => appointment.patientId === patient.id && this.scopeMatches(context, appointment.unitId, appointment.workspaceId)) ||
      [...this.encounters.values()].some((encounter) => encounter.patientId === patient.id && this.scopeMatches(context, encounter.unitId, encounter.workspaceId)) ||
      [...this.messages.values()].some((message) => message.patientId === patient.id && this.scopeMatches(context, message.unitId, message.workspaceId));
  }

  private guardianScopeMatches(guardian: Guardian, context: CvgContext): boolean {
    if (guardian.organizationId !== context.organizationId) return false;
    if (!context.unitId) return false;
    if (this.scopeMatches(context, guardian.unitId, guardian.workspaceId)) return true;
    return [...this.patients.values()].some((patient) => patient.status === "ACTIVE" && patient.guardianId === guardian.id && this.patientScopeMatches(patient, context));
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
    const organization = this.organizations.get(context.organizationId);
    const actor = this.users.get(context.actorId);
    if (!organization || organization.status !== "ACTIVE" || !actor || actor.organizationId !== organization.id || actor.status !== "ACTIVE") {
      throw new DomainError("POLICY_DENIED", "O contexto de segurança não está ativo.", 403);
    }
    if (context.sessionId !== null) {
      const session = this.sessions.get(context.sessionId);
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
    const unit = context.unitId ? this.units.get(context.unitId) : null;
    const workspace = context.workspaceId ? this.workspaces.get(context.workspaceId) : null;
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
      const patient = this.patients.get(context.patientId);
      if (!patient || patient.status === "MERGED" || !this.patientScopeMatches(patient, context)) {
        throw new DomainError("POLICY_DENIED", "O paciente não pertence ao contexto autorizado.", 403);
      }
    }
    if (context.encounterId) {
      const encounter = this.encounters.get(context.encounterId);
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

  recordAudit(input: Omit<AuditRecord, "id" | "createdAt">): AuditRecord {
    const audit: AuditRecord = { ...input, id: makeId(), createdAt: now() };
    this.auditRecords.set(audit.id, audit);
    return audit;
  }

  getAssignment(assignmentId: OpaqueId): RoleAssignment {
    const assignment = this.roleAssignments.get(assignmentId);
    if (!assignment) throw new DomainError("NOT_FOUND", "Recurso não encontrado.", 404);
    return assignment;
  }

  listUsers(context: CvgContext, query = ""): PublicUser[] {
    this.requireRole(context, ["admin"], "users:read");
    const normalized = query.toLowerCase();
    return [...this.users.values()]
      .filter((user) => user.organizationId === context.organizationId && (!normalized || `${user.displayName} ${user.email}`.toLowerCase().includes(normalized)))
      .map((user) => ({ id: user.id, displayName: user.displayName, email: user.email, status: user.status, roles: this.effectiveAssignments(user.id, context.organizationId).map(({ id: assignmentId, role, scopeType, unitId, workspaceId, revokedAt }) => ({ id: assignmentId, role, scopeType, unitId, workspaceId, revokedAt })) }));
  }

  listAudit(context: CvgContext, limit = 25, cursor: string | null = null): AuditRecord[] {
    this.requireRole(context, ["admin"], "audit:read");
    return [...this.auditRecords.values()]
      .filter((record) => record.organizationId === context.organizationId && (!cursor || record.id > cursor))
      .sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit).map((record) => ({ ...record, metadata: { ...record.metadata } }));
  }

  listMessages(context: CvgContext): CommunicationMessage[] {
    this.requireRole(context, ["admin", "recepcao", "veterinario"], "communication:read");
    return [...this.messages.values()].filter((message) => isInContext(message, context)).map(clone);
  }

  listKnowledgeDocuments(context: CvgContext): KnowledgeDocument[] {
    this.requireRole(context, ["admin", "veterinario", "recepcao"], "knowledge:read");
    return [...this.knowledgeDocuments.values()].filter((document) => isInContext(document, context)).map(clone);
  }

  grantRole(context: CvgContext, input: RoleAssignmentInput): RoleAssignment {
    this.requireRole(context, ["admin"], "role:grant");
    const organization = this.organizations.get(context.organizationId);
    if (!organization || organization.authorizationRevision !== BigInt(input.expectedRevision)) throw new DomainError("REVISION_CONFLICT", "A autorização mudou; recarregue o contexto antes de tentar novamente.", 409);
    const target = this.users.get(input.userId);
    if (!target || target.organizationId !== context.organizationId) throw new DomainError("NOT_FOUND", "Recurso não encontrado.", 404);
    if (!isGrantableRole(input.role)) throw new DomainError("POLICY_DENIED", "Este papel não pode ser concedido pela superfície M1.", 403);
    if (input.userId === context.actorId) throw new DomainError("FORBIDDEN", "Um administrador não pode alterar o próprio vínculo.", 403);
    const unit = input.unitId ? this.units.get(input.unitId) : null;
    const workspace = input.workspaceId ? this.workspaces.get(input.workspaceId) : null;
    if ((unit && (unit.organizationId !== context.organizationId || unit.status !== "ACTIVE")) || (workspace && (workspace.organizationId !== context.organizationId || workspace.status !== "ACTIVE" || (unit && workspace.unitId !== unit.id)))) throw new DomainError("NOT_FOUND", "Recurso não encontrado.", 404);
    const duplicate = [...this.roleAssignments.values()].find((assignment) => assignment.organizationId === context.organizationId && assignment.userId === input.userId && assignment.role === input.role && assignment.scopeType === input.scopeType && assignment.unitId === input.unitId && assignment.workspaceId === input.workspaceId && !assignment.revokedAt);
    if (duplicate) throw new DomainError("ASSIGNMENT_EXISTS", "O vínculo ativo já existe.", 409);
    const assignment: RoleAssignment = { id: makeId(), organizationId: context.organizationId, userId: input.userId, role: input.role, scopeType: input.scopeType, unitId: input.unitId, workspaceId: input.workspaceId, grantedAt: now(), revokedAt: null };
    this.roleAssignments.set(assignment.id, assignment);
    organization.authorizationRevision += 1n;
    return assignment;
  }

  revokeRole(context: CvgContext, assignmentId: OpaqueId, expectedRevision: string): RoleAssignment {
    this.requireRole(context, ["admin"], "role:revoke");
    const organization = this.organizations.get(context.organizationId);
    if (!organization || organization.authorizationRevision !== BigInt(expectedRevision)) throw new DomainError("REVISION_CONFLICT", "A autorização mudou; recarregue o contexto antes de tentar novamente.", 409);
    const assignment = this.roleAssignments.get(assignmentId);
    if (!assignment || assignment.organizationId !== context.organizationId) throw new DomainError("NOT_FOUND", "Recurso não encontrado.", 404);
    if (assignment.revokedAt) throw new DomainError("ALREADY_REVOKED", "O vínculo já foi revogado.", 409);
    if (assignment.role === "admin" || assignment.userId === context.actorId) throw new DomainError("FORBIDDEN", "Administradores e o próprio vínculo exigem uma alçada separada.", 403);
    assignment.revokedAt = now();
    organization.authorizationRevision += 1n;
    return assignment;
  }

  listGuardians(context: CvgContext, query = ""): Guardian[] {
    this.requireRole(context, ["admin", "veterinario", "recepcao"], "guardians:read");
    const normalized = query.trim().toLowerCase();
    return [...this.guardians.values()].filter((guardian) => this.guardianScopeMatches(guardian, context) && guardian.status === "ACTIVE" && (!normalized || `${guardian.displayName} ${guardian.phone} ${guardian.email ?? ""}`.toLowerCase().includes(normalized))).map(clone);
  }

  createGuardian(context: CvgContext, input: { displayName: string; phone: string; email: string | null }): Guardian {
    this.requireRole(context, ["admin", "recepcao"], "guardians:create");
    const guardian: Guardian = { id: makeId(), organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId, displayName: input.displayName, phone: input.phone, email: input.email, dataClass: "D2", status: "ACTIVE" };
    this.guardians.set(guardian.id, guardian);
    return guardian;
  }

  findPatient(context: CvgContext, patientId: OpaqueId): AnimalPatient {
    this.requireRole(context, ["admin", "veterinario", "recepcao", "financeiro", "estoque"], "patients:read");
    const patient = this.patients.get(patientId);
    if (!patient || patient.status === "MERGED" || !this.patientScopeMatches(patient, context)) throw new DomainError("NOT_FOUND", "Recurso não encontrado.", 404);
    return patient;
  }

  listPatients(context: CvgContext, query = ""): Array<AnimalPatient & { guardian: Pick<Guardian, "id" | "displayName" | "phone"> | null }> {
    this.requireRole(context, ["admin", "veterinario", "recepcao", "financeiro", "estoque"], "patients:read");
    const normalized = query.trim().toLowerCase();
    return [...this.patients.values()].filter((patient) => this.patientScopeMatches(patient, context) && patient.status === "ACTIVE" && (!normalized || `${patient.name} ${patient.species} ${patient.breed ?? ""}`.toLowerCase().includes(normalized))).map((patient) => ({ ...patient, guardian: this.guardians.get(patient.guardianId) ? (({ id: guardianId, displayName, phone }) => ({ id: guardianId, displayName, phone }))(this.guardians.get(patient.guardianId)!) : null }));
  }

  createPatient(context: CvgContext, input: PatientInput): AnimalPatient {
    this.requireRole(context, ["admin", "recepcao", "veterinario"], "patients:create");
    const guardian = this.guardians.get(input.guardianId);
    if (!guardian || !this.guardianScopeMatches(guardian, context)) throw new DomainError("NOT_FOUND", "Responsável não encontrado neste contexto.", 404);
    const patient: AnimalPatient = { id: makeId(), organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId, guardianId: input.guardianId, name: input.name, species: input.species, breed: input.breed, sex: input.sex, reproductiveStatus: input.reproductiveStatus, birthDate: input.birthDate, identifiers: [...input.identifiers], dataClass: "D3", status: "ACTIVE", mergedIntoId: null, statusChangedAt: null, createdAt: now() };
    this.patients.set(patient.id, patient);
    return patient;
  }

  disablePatient(context: CvgContext, patientId: OpaqueId): AnimalPatient {
    this.requireRole(context, ["admin", "recepcao", "veterinario"], "patients:disable");
    const patient = this.findPatient(context, patientId);
    patient.status = "INACTIVE";
    patient.statusChangedAt = now();
    return patient;
  }

  mergePatients(context: CvgContext, input: PatientMergeInput): AnimalPatient {
    this.requireRole(context, ["admin", "veterinario"], "patients:merge");
    const source = this.findPatient(context, input.sourcePatientId);
    const target = this.findPatient(context, input.targetPatientId);
    source.status = "MERGED";
    source.mergedIntoId = target.id;
    source.statusChangedAt = now();
    return target;
  }

  createAppointment(context: CvgContext, input: AppointmentInput): Appointment {
    this.requireRole(context, ["admin", "recepcao", "veterinario"], "appointments:create");
    if (!context.unitId || !context.workspaceId) throw new DomainError("INVALID_INPUT", "Unidade e workspace são obrigatórios para agendar.", 400);
    const patient = this.findPatient(context, input.patientId);
    const provider = this.providers.get(input.providerId);
    const service = this.services.get(input.serviceId);
    const resource = input.resourceId ? this.resources.get(input.resourceId) : null;
    if (!provider || provider.organizationId !== context.organizationId || provider.unitId !== context.unitId || !service || service.organizationId !== context.organizationId || (input.resourceId && (!resource || resource.organizationId !== context.organizationId || resource.unitId !== context.unitId))) throw new DomainError("NOT_FOUND", "Recurso de agenda não encontrado.", 404);
    const overlaps = [...this.appointments.values()].some((appointment) => appointment.organizationId === context.organizationId && appointment.unitId === context.unitId && appointment.workspaceId === context.workspaceId && appointment.status !== "CANCELLED" && (appointment.providerId === input.providerId || (input.resourceId && appointment.resourceId === input.resourceId)) && new Date(input.startsAt).getTime() < new Date(appointment.endsAt).getTime() && new Date(input.endsAt).getTime() > new Date(appointment.startsAt).getTime());
    if (overlaps) throw new DomainError("CONFLICT", "A janela escolhida já está ocupada.", 409);
    void patient;
    const appointment: Appointment = { id: makeId(), organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId, patientId: input.patientId, providerId: input.providerId, resourceId: input.resourceId, serviceId: input.serviceId, startsAt: input.startsAt, endsAt: input.endsAt, purpose: input.purpose, status: "SCHEDULED", version: 1, createdAt: now() };
    this.appointments.set(appointment.id, appointment);
    return appointment;
  }

  listAppointments(context: CvgContext, range: "today" | "week" = "today"): Appointment[] {
    this.requireRole(context, ["admin", "recepcao", "veterinario", "estoque", "financeiro"], "appointments:read");
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + (range === "week" ? 7 : 1));
    return [...this.appointments.values()].filter((appointment) => appointment.organizationId === context.organizationId && (!context.unitId || appointment.unitId === context.unitId) && (!context.workspaceId || appointment.workspaceId === context.workspaceId) && new Date(appointment.startsAt) >= start && new Date(appointment.startsAt) < end).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  listQueue(context: CvgContext): QueueEntry[] {
    this.requireRole(context, ["admin", "recepcao", "veterinario"], "queue:read");
    return [...this.queueEntries.values()].filter((entry) => {
      if (entry.organizationId !== context.organizationId || (context.unitId && entry.unitId !== context.unitId)) return false;
      if (!context.workspaceId) return true;
      const appointment = entry.appointmentId ? this.appointments.get(entry.appointmentId) : null;
      return Boolean(appointment && appointment.workspaceId === context.workspaceId);
    }).sort((a, b) => a.checkedInAt.localeCompare(b.checkedInAt));
  }

  createEncounter(context: CvgContext, input: { patientId: OpaqueId; appointmentId: OpaqueId | null; chiefComplaint: string; urgency: Encounter["urgency"] }): Encounter {
    this.requireRole(context, ["admin", "veterinario"], "encounters:create");
    if (!context.unitId || !context.workspaceId) throw new DomainError("INVALID_INPUT", "Contexto clínico incompleto.", 400);
    this.findPatient(context, input.patientId);
    if (input.appointmentId) {
      const appointment = this.appointments.get(input.appointmentId);
      if (!appointment || appointment.organizationId !== context.organizationId || appointment.unitId !== context.unitId || appointment.workspaceId !== context.workspaceId || appointment.patientId !== input.patientId) throw new DomainError("NOT_FOUND", "Reserva incompatível com o atendimento.", 404);
    }
    const encounter: Encounter = { id: makeId(), organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId, patientId: input.patientId, appointmentId: input.appointmentId, chiefComplaint: input.chiefComplaint, urgency: input.urgency, status: "OPEN", openedAt: now(), closedAt: null };
    this.encounters.set(encounter.id, encounter);
    return encounter;
  }

  checkInAppointment(context: CvgContext, appointmentId: OpaqueId): QueueEntry {
    this.requireRole(context, ["admin", "recepcao", "veterinario"], "queue:check-in");
    const appointment = this.appointments.get(appointmentId);
    if (!appointment || appointment.organizationId !== context.organizationId || (context.unitId && appointment.unitId !== context.unitId) || (context.workspaceId && appointment.workspaceId !== context.workspaceId)) throw new DomainError("NOT_FOUND", "Reserva não encontrada.", 404);
    if (appointment.status === "CANCELLED" || appointment.status === "COMPLETED") throw new DomainError("INVALID_STATE", "A reserva não pode entrar na fila neste estado.", 409);
    const existing = [...this.queueEntries.values()].find((entry) => entry.appointmentId === appointment.id && entry.status !== "CANCELLED" && entry.status !== "DONE");
    if (existing) return existing;
    appointment.status = "CHECKED_IN";
    const entry: QueueEntry = { id: makeId(), organizationId: appointment.organizationId, unitId: appointment.unitId, appointmentId: appointment.id, patientId: appointment.patientId, status: "WAITING", priority: appointment.purpose.toLowerCase().includes("retorno") ? "URGENT" : "ROUTINE", checkedInAt: now() };
    this.queueEntries.set(entry.id, entry);
    return entry;
  }

  listEncounters(context: CvgContext): Encounter[] {
    this.requireRole(context, ["admin", "veterinario"], "encounters:read");
    return [...this.encounters.values()].filter((encounter) => encounter.organizationId === context.organizationId && (!context.unitId || encounter.unitId === context.unitId) && (!context.workspaceId || encounter.workspaceId === context.workspaceId));
  }

  createClinicalDocument(context: CvgContext, input: ClinicalDocumentInput): ClinicalDocument {
    this.requireRole(context, ["admin", "veterinario"], "clinical:write");
    const encounter = this.encounters.get(input.encounterId);
    if (!encounter || encounter.organizationId !== context.organizationId || (context.unitId && encounter.unitId !== context.unitId) || (context.workspaceId && encounter.workspaceId !== context.workspaceId)) throw new DomainError("NOT_FOUND", "Atendimento não encontrado.", 404);
    const document: ClinicalDocument = { id: makeId(), organizationId: context.organizationId, encounterId: encounter.id, patientId: encounter.patientId, authorId: context.actorId, documentType: input.documentType, title: input.title, content: input.content, dataClass: input.dataClass, status: "DRAFT", version: 1, signedAt: null, signedBy: null, createdAt: now() };
    this.clinicalDocuments.set(document.id, document);
    return document;
  }

  signClinicalDocument(context: CvgContext, documentId: OpaqueId): ClinicalDocument {
    this.requireRole(context, ["veterinario"], "clinical:sign");
    const document = this.clinicalDocuments.get(documentId);
    if (!document || document.organizationId !== context.organizationId) throw new DomainError("NOT_FOUND", "Documento não encontrado.", 404);
    const encounter = this.encounters.get(document.encounterId);
    if (!encounter || (context.unitId && encounter.unitId !== context.unitId) || (context.workspaceId && encounter.workspaceId !== context.workspaceId)) throw new DomainError("NOT_FOUND", "Documento não encontrado.", 404);
    if (document.status === "SIGNED" || document.status === "PUBLISHED") throw new DomainError("CONFLICT", "Documento clínico já está assinado e não pode ser sobrescrito.", 409);
    document.status = "SIGNED";
    document.signedAt = now();
    document.signedBy = context.actorId;
    return document;
  }

  addClinicalAddendum(context: CvgContext, documentId: OpaqueId, reason: string, content: string): ClinicalAddendum {
    this.requireRole(context, ["veterinario"], "clinical:addendum");
    const document = this.clinicalDocuments.get(documentId);
    if (!document || document.organizationId !== context.organizationId || document.status !== "SIGNED") throw new DomainError("INVALID_STATE", "Adendo só pode ser criado para documento assinado.", 409);
    const encounter = this.encounters.get(document.encounterId);
    if (!encounter || (context.unitId && encounter.unitId !== context.unitId) || (context.workspaceId && encounter.workspaceId !== context.workspaceId)) throw new DomainError("NOT_FOUND", "Documento não encontrado.", 404);
    const addendum: ClinicalAddendum = { id: makeId(), documentId, authorId: context.actorId, reason, content, createdAt: now() };
    this.clinicalAddenda.set(addendum.id, addendum);
    return addendum;
  }

  createDiagnosticRequest(context: CvgContext, input: DiagnosticRequestInput): DiagnosticRequest {
    this.requireRole(context, ["veterinario"], "diagnostics:create");
    this.findPatient(context, input.patientId);
    if (!input.encounterId) throw new DomainError("INVALID_INPUT", "Atendimento é obrigatório para solicitar um exame.", 400);
    const encounter = this.encounters.get(input.encounterId);
    if (!encounter || encounter.organizationId !== context.organizationId || encounter.patientId !== input.patientId || (context.unitId && encounter.unitId !== context.unitId) || (context.workspaceId && encounter.workspaceId !== context.workspaceId)) throw new DomainError("NOT_FOUND", "Atendimento incompatível com o exame.", 404);
    const request: DiagnosticRequest = { id: makeId(), organizationId: context.organizationId, patientId: input.patientId, encounterId: input.encounterId, testName: input.testName, priority: input.priority, status: "REQUESTED", requestedBy: context.actorId, createdAt: now() };
    this.diagnosticRequests.set(request.id, request);
    return request;
  }

  createSpecimen(context: CvgContext, requestId: OpaqueId, label: string): Specimen {
    this.requireRole(context, ["veterinario"], "diagnostics:specimen");
    const request = this.diagnosticRequests.get(requestId);
    if (!request || request.organizationId !== context.organizationId) throw new DomainError("NOT_FOUND", "Pedido de exame não encontrado.", 404);
    const encounter = request.encounterId ? this.encounters.get(request.encounterId) : null;
    if (!encounter || (context.unitId && encounter.unitId !== context.unitId) || (context.workspaceId && encounter.workspaceId !== context.workspaceId)) throw new DomainError("NOT_FOUND", "Pedido de exame não encontrado.", 404);
    if (request.status === "CANCELLED") throw new DomainError("INVALID_STATE", "Pedido cancelado não aceita amostra.", 409);
    const specimen: Specimen = { id: makeId(), organizationId: context.organizationId, requestId, patientId: request.patientId, label, collectedAt: now(), status: "COLLECTED" };
    this.specimens.set(specimen.id, specimen);
    request.status = "SPECIMEN_COLLECTED";
    return specimen;
  }

  createResult(context: CvgContext, input: ResultInput): DiagnosticResult {
    this.requireRole(context, ["veterinario"], "diagnostics:result");
    const request = this.diagnosticRequests.get(input.requestId);
    const specimen = this.specimens.get(input.specimenId);
    const encounter = request?.encounterId ? this.encounters.get(request.encounterId) : null;
    if (request && (request.organizationId !== context.organizationId || !encounter || (context.unitId && encounter.unitId !== context.unitId) || (context.workspaceId && encounter.workspaceId !== context.workspaceId))) throw new DomainError("NOT_FOUND", "Pedido de exame não encontrado.", 404);
    if (!request || !specimen || request.organizationId !== context.organizationId || specimen.organizationId !== context.organizationId || specimen.requestId !== request.id || specimen.patientId !== request.patientId) {
      const quarantinePatientId = request?.patientId ?? context.patientId;
      if (!quarantinePatientId) throw new DomainError("QUARANTINED", "Resultado incompatível sem paciente resolvido foi rejeitado sem persistência.", 409);
      const quarantined: DiagnosticResult = { id: makeId(), organizationId: context.organizationId, requestId: input.requestId, specimenId: input.specimenId, patientId: quarantinePatientId, value: input.value, source: input.source, sourceVersion: input.sourceVersion, status: "QUARANTINED", createdAt: now() };
      this.diagnosticResults.set(quarantined.id, quarantined);
      throw new DomainError("QUARANTINED", "Resultado incompatível enviado para quarentena.", 409, { resultId: quarantined.id });
    }
    const result: DiagnosticResult = { id: makeId(), organizationId: context.organizationId, requestId: request.id, specimenId: specimen.id, patientId: request.patientId, value: input.value, source: input.source, sourceVersion: input.sourceVersion, status: "VALID", createdAt: now() };
    this.diagnosticResults.set(result.id, result);
    request.status = "RESULTED";
    return result;
  }

  listStock(context: CvgContext): Array<Lot & { product: Product | null; location: StockLocation | null }> {
    this.requireRole(context, ["admin", "estoque", "veterinario"], "stock:read");
    return [...this.lots.values()].filter((lot) => lot.organizationId === context.organizationId && (!context.unitId || this.stockLocations.get(lot.locationId)?.unitId === context.unitId)).map((lot) => ({ ...lot, product: this.products.get(lot.productId) ?? null, location: this.stockLocations.get(lot.locationId) ?? null }));
  }

  listBeds(context: CvgContext): Bed[] {
    this.requireRole(context, ["admin", "veterinario"], "hospitalization:beds-read");
    return [...this.beds.values()].filter((bed) => bed.organizationId === context.organizationId && (!context.unitId || bed.unitId === context.unitId)).map(clone);
  }

  listHospitalEpisodes(context: CvgContext): HospitalEpisode[] {
    this.requireRole(context, ["admin", "veterinario"], "hospitalization:read");
    return [...this.hospitalEpisodes.values()].filter((episode) => episode.organizationId === context.organizationId && (!context.unitId || episode.unitId === context.unitId)).map(clone);
  }

  createHospitalEpisode(context: CvgContext, input: { patientId: OpaqueId; encounterId: OpaqueId | null; bedId: OpaqueId | null }): HospitalEpisode {
    this.requireRole(context, ["veterinario"], "hospitalization:create");
    if (!context.unitId) throw new DomainError("INVALID_INPUT", "Unidade é obrigatória para internação.", 400);
    this.findPatient(context, input.patientId);
    if (input.encounterId) {
      const encounter = this.encounters.get(input.encounterId);
    if (!encounter || encounter.organizationId !== context.organizationId || encounter.unitId !== context.unitId || encounter.workspaceId !== context.workspaceId || encounter.patientId !== input.patientId) throw new DomainError("NOT_FOUND", "Atendimento incompatível com a internação.", 404);
    }
    const bed = input.bedId ? this.beds.get(input.bedId) : null;
    if (input.bedId && (!bed || bed.organizationId !== context.organizationId || bed.unitId !== context.unitId || bed.status !== "AVAILABLE")) throw new DomainError("CONFLICT", "Leito indisponível para esta internação.", 409);
    const episode: HospitalEpisode = { id: makeId(), organizationId: context.organizationId, unitId: context.unitId, patientId: input.patientId, encounterId: input.encounterId, bedId: input.bedId, status: input.bedId ? "ADMITTED" : "PLANNED", admittedAt: input.bedId ? now() : null, dischargedAt: null };
    this.hospitalEpisodes.set(episode.id, episode);
    if (bed) bed.status = "OCCUPIED";
    return episode;
  }

  createMedicationOrder(context: CvgContext, input: { patientId: OpaqueId; encounterId: OpaqueId | null; productId: OpaqueId; dose: string; route: string; frequency: string }): MedicationOrder {
    this.requireRole(context, ["veterinario"], "medication:prescribe");
    this.findPatient(context, input.patientId);
    if (!input.encounterId) throw new DomainError("INVALID_INPUT", "Atendimento é obrigatório para prescrever.", 400);
    const encounter = this.encounters.get(input.encounterId);
    if (!encounter || encounter.organizationId !== context.organizationId || encounter.patientId !== input.patientId || (context.unitId && encounter.unitId !== context.unitId) || (context.workspaceId && encounter.workspaceId !== context.workspaceId)) throw new DomainError("NOT_FOUND", "Atendimento incompatível com a prescrição.", 404);
    const product = this.products.get(input.productId);
    if (!product || product.organizationId !== context.organizationId) throw new DomainError("NOT_FOUND", "Produto terapêutico não encontrado.", 404);
    const order: MedicationOrder = { id: makeId(), organizationId: context.organizationId, patientId: input.patientId, encounterId: input.encounterId, productId: input.productId, dose: input.dose, route: input.route, frequency: input.frequency, status: "ACTIVE", prescribedBy: context.actorId };
    this.medicationOrders.set(order.id, order);
    return order;
  }

  dispenseMedication(context: CvgContext, medicationOrderId: OpaqueId, lotId: OpaqueId, quantity: number): Dispensation {
    this.requireRole(context, ["admin", "estoque"], "medication:dispense");
    const order = this.medicationOrders.get(medicationOrderId);
    const lot = this.lots.get(lotId);
    const encounter = order?.encounterId ? this.encounters.get(order.encounterId) : null;
    if (!order || !lot || !encounter || order.organizationId !== context.organizationId || encounter.organizationId !== context.organizationId || (context.unitId && encounter.unitId !== context.unitId) || (context.workspaceId && encounter.workspaceId !== context.workspaceId) || lot.organizationId !== context.organizationId || order.productId !== lot.productId || (context.unitId && this.stockLocations.get(lot.locationId)?.unitId !== context.unitId)) throw new DomainError("NOT_FOUND", "Prescrição ou lote não encontrado.", 404);
    this.createStockMovement(context, { productId: lot.productId, lotId, locationId: lot.locationId, quantity, movementType: "DISPENSE", reason: `Dispensação da prescrição ${medicationOrderId}`, referenceId: medicationOrderId });
    const dispensation: Dispensation = { id: makeId(), organizationId: context.organizationId, medicationOrderId, lotId, quantity, dispensedBy: context.actorId, createdAt: now() };
    this.dispensations.set(dispensation.id, dispensation);
    return dispensation;
  }

  administerMedication(context: CvgContext, medicationOrderId: OpaqueId, status: "ADMINISTERED" | "OMITTED" | "REFUSED", note: string | null): AdministrationOccurrence {
    this.requireRole(context, ["veterinario"], "medication:administer");
    const order = this.medicationOrders.get(medicationOrderId);
    const encounter = order?.encounterId ? this.encounters.get(order.encounterId) : null;
    if (!order || !encounter || order.organizationId !== context.organizationId || encounter.organizationId !== context.organizationId || (context.unitId && encounter.unitId !== context.unitId) || (context.workspaceId && encounter.workspaceId !== context.workspaceId) || order.status !== "ACTIVE") throw new DomainError("NOT_FOUND", "Prescrição ativa não encontrada.", 404);
    const occurrence: AdministrationOccurrence = { id: makeId(), organizationId: context.organizationId, medicationOrderId, administeredBy: context.actorId, administeredAt: now(), status, note };
    this.administrationOccurrences.set(occurrence.id, occurrence);
    return occurrence;
  }

  listMedicationOrders(context: CvgContext): MedicationOrder[] {
    this.requireRole(context, ["admin", "veterinario", "estoque"], "medication:read");
    return [...this.medicationOrders.values()].filter((order) => {
      const encounter = order.encounterId ? this.encounters.get(order.encounterId) : null;
      return order.organizationId === context.organizationId && Boolean(encounter) && (!context.unitId || encounter!.unitId === context.unitId) && (!context.workspaceId || encounter!.workspaceId === context.workspaceId);
    }).map(clone);
  }

  createStockMovement(context: CvgContext, input: StockMovementInput): StockMovement {
    this.requireRole(context, ["admin", "estoque"], "stock:write");
    const lot = this.lots.get(input.lotId);
    const product = this.products.get(input.productId);
    if (!lot || !product || lot.organizationId !== context.organizationId || product.organizationId !== context.organizationId || lot.productId !== product.id || (context.unitId && (lot.locationId !== input.locationId || this.stockLocations.get(input.locationId)?.unitId !== context.unitId))) throw new DomainError("NOT_FOUND", "Lote não encontrado.", 404);
    const subtract = ["DISPENSE", "TRANSFER_OUT"].includes(input.movementType);
    const expiryTime = Date.parse(lot.expiresOn);
    if (!Number.isFinite(expiryTime)) throw new DomainError("CONFLICT", "Movimento rejeitado: a validade do lote é inválida.", 409, { expiresOn: lot.expiresOn });
    if (lot.status !== "AVAILABLE" || (subtract && (lot.quantity < input.quantity || expiryTime < Date.now()))) throw new DomainError("CONFLICT", expiryTime < Date.now() && subtract ? "Movimento rejeitado: lote vencido não pode sair do estoque." : "Movimento rejeitado: lote indisponível ou saldo insuficiente.", 409, { available: lot.quantity, expiresOn: lot.expiresOn });
    lot.quantity += subtract ? -input.quantity : input.quantity;
    const movement: StockMovement = { id: makeId(), organizationId: context.organizationId, productId: input.productId, lotId: input.lotId, locationId: input.locationId, quantity: input.quantity, movementType: input.movementType, reason: input.reason, referenceId: input.referenceId, createdBy: context.actorId, createdAt: now() };
    this.stockMovements.set(movement.id, movement);
    return movement;
  }

  createCharge(context: CvgContext, input: ChargeInput): Charge {
    this.requireRole(context, ["admin", "financeiro"], "finance:charge");
    if (!context.unitId) throw new DomainError("INVALID_INPUT", "Unidade é obrigatória para uma cobrança.", 400);
    if (input.patientId) this.findPatient(context, input.patientId);
    const charge: Charge = { id: makeId(), organizationId: context.organizationId, unitId: context.unitId, patientId: input.patientId, description: input.description, amountCents: input.amountCents, currency: input.currency, status: "OPEN", createdAt: now() };
    this.charges.set(charge.id, charge);
    this.addLedger({ organizationId: context.organizationId, kind: "CHARGE", referenceId: charge.id, amountCents: charge.amountCents, currency: charge.currency, description: charge.description });
    return charge;
  }

  createPayment(context: CvgContext, input: PaymentInput): Payment {
    this.requireRole(context, ["admin", "financeiro"], "finance:payment");
    const charge = this.charges.get(input.chargeId);
    if (!charge || charge.organizationId !== context.organizationId || charge.unitId !== context.unitId) throw new DomainError("NOT_FOUND", "Cobrança não encontrada neste contexto.", 404);
    const paid = [...this.payments.values()].filter((payment) => payment.chargeId === charge.id && payment.status === "SETTLED").reduce((total, payment) => total + payment.amountCents, 0);
    if (paid + input.amountCents > charge.amountCents) throw new DomainError("CONFLICT", "Pagamento excede o saldo da cobrança.", 409);
    const payment: Payment = { id: makeId(), organizationId: context.organizationId, chargeId: charge.id, amountCents: input.amountCents, method: input.method, externalReference: input.externalReference, status: "SETTLED", createdAt: now() };
    this.payments.set(payment.id, payment);
    this.addLedger({ organizationId: context.organizationId, kind: "PAYMENT", referenceId: payment.id, amountCents: payment.amountCents, currency: charge.currency, description: `Pagamento ${payment.method}` });
    charge.status = paid + input.amountCents === charge.amountCents ? "PAID" : "PARTIALLY_PAID";
    return payment;
  }

  requestRefund(context: CvgContext, paymentId: OpaqueId, reason: string): Payment {
    this.requireRole(context, ["admin", "financeiro"], "finance:refund");
    const payment = this.payments.get(paymentId);
    if (!payment || payment.organizationId !== context.organizationId) throw new DomainError("NOT_FOUND", "Pagamento não encontrado.", 404);
    if (payment.status !== "SETTLED") throw new DomainError("INVALID_STATE", "Somente pagamento liquidado pode receber estorno.", 409);
    const charge = this.charges.get(payment.chargeId);
    if (!charge || charge.organizationId !== context.organizationId || charge.unitId !== context.unitId) throw new DomainError("NOT_FOUND", "Cobrança não encontrada neste contexto.", 404);
    payment.status = "REFUNDED";
    charge.status = "REFUNDED";
    this.addLedger({ organizationId: context.organizationId, kind: "REFUND", referenceId: payment.id, amountCents: -payment.amountCents, currency: charge.currency, description: `Estorno: ${reason}` });
    return payment;
  }

  createKnowledgeDocument(context: CvgContext, input: { title: string; source: string; dataClass: KnowledgeDocument["dataClass"]; content: string }): KnowledgeDocument {
    this.requireRole(context, ["admin", "veterinario"], "knowledge:write");
    if (!context.unitId || !context.workspaceId) throw new DomainError("INVALID_INPUT", "Conhecimento precisa de unidade e workspace explícitos.", 400);
    if (!["D0", "D1", "D2"].includes(input.dataClass)) throw new DomainError("INVALID_INPUT", "Conhecimento clínico deve permanecer em D0–D2 até validação de classificação.", 400);
    const document: KnowledgeDocument = { id: makeId(), organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId, title: input.title, source: input.source, dataClass: input.dataClass, version: 1, status: "DRAFT", content: input.content, createdAt: now() };
    this.knowledgeDocuments.set(document.id, document);
    return document;
  }

  private addLedger(input: Omit<LedgerEntry, "id" | "createdAt">): LedgerEntry {
    const entry: LedgerEntry = { ...input, id: makeId(), createdAt: now() };
    this.ledgerEntries.set(entry.id, entry);
    return entry;
  }

  createMessage(context: CvgContext, input: Pick<CommunicationMessage, "patientId" | "channel" | "recipient" | "template" | "body">): CommunicationMessage {
    this.requireRole(context, ["admin", "recepcao", "veterinario"], "communication:stage");
    if (!context.unitId || !context.workspaceId) throw new DomainError("INVALID_INPUT", "Comunicação precisa de unidade e workspace explícitos.", 400);
    if (input.patientId) this.findPatient(context, input.patientId);
    const message: CommunicationMessage = { ...input, id: makeId(), organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId, status: "APPROVAL_REQUIRED", createdAt: now() };
    this.messages.set(message.id, message);
    return message;
  }
}

export interface IdempotencyInput {
  organizationId: OpaqueId;
  actorId: OpaqueId;
  operation: string;
  key: string;
  resourceId: OpaqueId | null;
  unitId: OpaqueId | null;
  workspaceId: OpaqueId | null;
  body: unknown;
}

export function idempotencyLookup(input: IdempotencyInput): string {
  return digest({ v: 1, organizationId: input.organizationId, actorId: input.actorId, operation: input.operation, key: input.key, resourceId: input.resourceId, unitId: input.unitId, workspaceId: input.workspaceId });
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
  const receipt: CommandReceipt = { id: makeId(), organizationId: input.organizationId, actorId: input.actorId, unitId: input.unitId, workspaceId: input.workspaceId, auditRecordId: null, operation: input.operation, idempotencyLookup: lookup, bodyDigest, status: "IN_FLIGHT", result: null, createdAt: now(), completedAt: null };
  store.commandReceipts.set(lookup, receipt);
  try {
    const value = execute();
    receipt.status = "SUCCEEDED";
    receipt.result = clone(value);
    receipt.completedAt = now();
    return { receipt, value, replayed: false };
  } catch (error) {
    receipt.status = error instanceof DomainError && error.code === "OUTCOME_UNKNOWN" ? "OUTCOME_UNKNOWN" : "FAILED";
    receipt.result = null;
    receipt.completedAt = now();
    throw error;
  }
}

/** Runs one idempotent command whose implementation crosses an asynchronous adapter. */
export async function idempotentAsync<T>(store: CvgStore, input: IdempotencyInput, execute: () => Promise<T>): Promise<{ receipt: CommandReceipt; value: T; replayed: boolean }> {
  const lookup = idempotencyLookup(input);
  const bodyDigest = digest({ v: 1, body: input.body });
  const existing = store.commandReceipts.get(lookup);
  if (existing) {
    if (existing.bodyDigest !== bodyDigest) throw new DomainError("IDEMPOTENCY_CONFLICT", "A chave já foi usada com outro corpo.", 409);
    if (existing.status === "SUCCEEDED") return { receipt: existing, value: existing.result as T, replayed: true };
    if (existing.status === "IN_FLIGHT" || existing.status === "OUTCOME_UNKNOWN") throw new DomainError("OUTCOME_UNKNOWN", "A execução anterior permanece em reconciliação.", 409, { receiptId: existing.id });
    throw new DomainError("CONFLICT", "A execução anterior falhou; use uma nova intenção.", 409);
  }
  const receipt: CommandReceipt = { id: makeId(), organizationId: input.organizationId, actorId: input.actorId, unitId: input.unitId, workspaceId: input.workspaceId, auditRecordId: null, operation: input.operation, idempotencyLookup: lookup, bodyDigest, status: "IN_FLIGHT", result: null, createdAt: now(), completedAt: null };
  store.commandReceipts.set(lookup, receipt);
  try {
    const value = await execute();
    receipt.status = "SUCCEEDED";
    receipt.result = clone(value);
    receipt.completedAt = now();
    return { receipt, value, replayed: false };
  } catch (error) {
    receipt.status = error instanceof DomainError && error.code === "OUTCOME_UNKNOWN" ? "OUTCOME_UNKNOWN" : "FAILED";
    receipt.result = null;
    receipt.completedAt = now();
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
  const healthStatus = record.healthStatus === undefined ? "READY" : record.healthStatus;
  if (healthStatus !== "READY" && healthStatus !== "QUARANTINED") throw new DomainError("INVALID_INPUT", "Snapshot inválido: healthStatus desconhecido.", 400);
  const arrayFields = [
    "organizations", "units", "workspaces", "users", "roleAssignments", "sessions", "auditRecords", "commandReceipts",
    "guardians", "patients", "providers", "services", "resources", "appointments", "queueEntries", "encounters",
    "clinicalDocuments", "clinicalAddenda", "diagnosticRequests", "specimens", "diagnosticResults", "hospitalEpisodes",
    "beds", "medicationOrders", "dispensations", "products", "lots", "stockLocations", "stockMovements", "charges",
    "payments", "ledgerEntries", "messages", "knowledgeDocuments", "aiSessions", "aiTurns", "aiDrafts", "aiApprovals",
    "budgetReservations", "administrationOccurrences", "quarantined"
  ] as const;
  for (const field of arrayFields) {
    const value = record[field];
    if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || typeof (item as { id?: unknown }).id !== "string")) throw new DomainError("INVALID_INPUT", `Snapshot inválido: ${field} deve ser uma lista de recursos identificados.`, 400);
  }
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
  return { ...record, healthStatus, organizations, users, sessions, authChallenges: rawAuthChallenges, auditRecords: scopedAuditRecords, commandReceipts, guardians: scopedPeople("guardians"), patients: scopedPeople("patients"), messages: scoped("messages"), knowledgeDocuments: scoped("knowledgeDocuments"), aiSessions: scoped("aiSessions") } as unknown as StoreSnapshot;
}
