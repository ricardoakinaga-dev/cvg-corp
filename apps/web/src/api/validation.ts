/**
 * Semantic payload validation for every endpoint consumed by the UI.
 *
 * The HTTP envelope is checked in `client.ts`; this registry closes the gap
 * where a valid envelope carried a payload that did not match the resource
 * contract.  Every registered schema is strict: unknown fields cannot be
 * silently forwarded and fields used by components are never stripped.
 */
import {
  logoutResponseSchema,
  financialBalanceSchema,
  type ContextOptionPayload,
  type LoginResponsePayload,
  type LogoutResponse,
  type MeResponsePayload
} from "@cvg/contracts";
import { z } from "zod";

type ParseResult<T> = { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
type PayloadSchema<T> = { safeParse(value: unknown): ParseResult<T> };

export type PayloadValidation =
  | { status: "validated"; data: unknown }
  | { status: "invalid"; issues: string };

/**
 * Success payloads that cannot carry a component-visible resource.  Health and
 * readiness are intentionally allowlisted because they are probes, not UI
 * state; logout is validated below because it drives session state.
 */
export const UNVALIDATED_ALLOWLIST: readonly string[] = [
  "GET /ready"
];

const UUID = z.string().uuid();
const TIMESTAMP = z.string().datetime({ offset: true });
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const NON_NEGATIVE_INT = z.number().int().nonnegative();
const NON_NEGATIVE_CENTS = z.number().int().nonnegative();
const SHA256 = z.string().regex(/^[a-f0-9]{64}$/);
const CATALOG_FINGERPRINT = z.string().regex(/^[a-f0-9]{8}$/);
const CURRENCY = z.string().regex(/^[A-Z]{3}$/);
const ROLE = z.enum(["admin", "veterinario", "recepcao", "operador", "financeiro", "estoque", "workspace_manager"]);
const SCOPE = z.enum(["ORGANIZATION", "UNIT", "WORKSPACE"]);
const text = (max = 500, min = 0) => z.string().trim().min(min).max(max);
const nullableUuid = UUID.nullable();
const nullableTimestamp = TIMESTAMP.nullable();

function strict<T extends z.ZodRawShape>(shape: T): z.ZodObject<T> {
  return z.object(shape).strict();
}

function listOf<T extends z.ZodTypeAny>(item: T, extras: z.ZodRawShape = {}): z.ZodObject<{ items: z.ZodArray<T> } & typeof extras> {
  return strict({ items: z.array(item), ...extras });
}

function wrapped<T extends z.ZodTypeAny>(key: string, item: T, extras: z.ZodRawShape = {}): z.ZodObject<z.ZodRawShape> {
  return strict({ [key]: item, ...extras });
}

const roleAssignmentEntity = strict({
  id: UUID,
  role: ROLE,
  scopeType: SCOPE,
  unitId: nullableUuid,
  workspaceId: nullableUuid,
  revokedAt: nullableTimestamp
});

const publicUserEntity = strict({
  id: UUID,
  organizationId: UUID.optional(),
  login: text(160, 1).optional(),
  displayName: text(200, 1),
  email: z.string().email(),
  status: z.enum(["ACTIVE", "DISABLED"]),
  lastLoginAt: nullableTimestamp.optional(),
  createdAt: TIMESTAMP.optional()
});

const adminUserEntity = publicUserEntity.extend({ roles: z.array(roleAssignmentEntity) }).strict();

const contextOptionEntity = strict({
  organization: strict({ id: UUID, name: text(200, 1), slug: text(120, 1) }),
  unit: strict({ id: UUID, organizationId: UUID.optional(), name: text(200, 1), code: text(80, 1), status: z.enum(["ACTIVE", "INACTIVE"]).optional() }),
  workspace: strict({ id: UUID, organizationId: UUID.optional(), unitId: UUID.optional(), name: text(200, 1), purpose: text(200, 1), status: z.enum(["ACTIVE", "INACTIVE"]).optional() }),
  roles: z.array(ROLE)
});

const authenticatedSessionSchema = strict({
  user: publicUserEntity,
  contexts: z.array(contextOptionEntity),
  csrfToken: text(300, 1),
  demo: z.boolean().optional()
});

const mfaChallengeSchema = strict({
  mfaRequired: z.literal(true),
  challengeId: z.string().regex(/^[A-Za-z0-9_-]{32,160}$/),
  expiresAt: TIMESTAMP
});

const loginResponseSchema = z.union([mfaChallengeSchema, authenticatedSessionSchema]);

const publicContextEntity = strict({
  organizationId: UUID,
  organizationName: text(200),
  unit: strict({ id: UUID, name: text(200, 1), code: text(80, 1) }).nullable(),
  workspace: strict({ id: UUID, name: text(200, 1), purpose: text(200, 1) }).nullable(),
  roles: z.array(ROLE),
  purpose: text(160, 1),
  policyRevision: text(160, 1),
  correlationId: text(80, 1)
});

const meResponseSchema = strict({
  user: publicUserEntity,
  roles: z.array(ROLE),
  context: publicContextEntity,
  csrfToken: text(300, 1)
});

const guardianReference = strict({
  id: UUID,
  displayName: text(200, 1),
  phone: text(40, 1).optional()
});

const guardianEntity = strict({
  id: UUID,
  organizationId: UUID.optional(),
  unitId: nullableUuid.optional(),
  workspaceId: nullableUuid.optional(),
  displayName: text(200, 1),
  phone: text(40, 1),
  email: z.string().email().nullable(),
  dataClass: z.literal("D2").optional(),
  status: z.enum(["ACTIVE", "INACTIVE"])
});

const patientEntity = strict({
  id: UUID,
  organizationId: UUID.optional(),
  unitId: nullableUuid.optional(),
  workspaceId: nullableUuid.optional(),
  guardianId: UUID.optional(),
  name: text(200, 1),
  species: text(80, 1),
  breed: text(120).nullable().optional(),
  guardian: guardianReference.nullable().optional(),
  sex: z.enum(["FEMALE", "MALE", "UNKNOWN"]).optional(),
  reproductiveStatus: z.enum(["INTACT", "NEUTERED", "UNKNOWN"]).optional(),
  birthDate: DATE.nullable().optional(),
  identifiers: z.array(text(160, 1)).max(64).optional(),
  dataClass: z.literal("D3").optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "MERGED"]),
  mergedIntoId: nullableUuid.optional(),
  statusChangedAt: nullableTimestamp.optional(),
  createdAt: TIMESTAMP.optional()
});

const appointmentCore = {
  id: UUID,
  organizationId: UUID.optional(),
  unitId: UUID.optional(),
  workspaceId: UUID.optional(),
  patientId: UUID.optional(),
  providerId: UUID.optional(),
  resourceId: nullableUuid.optional(),
  serviceId: UUID.optional(),
  startsAt: TIMESTAMP,
  endsAt: TIMESTAMP.optional(),
  purpose: text(240, 1),
  status: z.enum(["SCHEDULED", "CONFIRMED", "CHECKED_IN", "CANCELLED", "COMPLETED"]),
  version: NON_NEGATIVE_INT.optional(),
  createdAt: TIMESTAMP.optional()
};
const appointmentEntity = strict(appointmentCore);
const appointmentReadEntity = strict({ ...appointmentCore, patient: strict({ id: UUID.optional(), name: text(200, 1) }).nullable().optional(), provider: text(200).nullable().optional() });

const queueCore = {
  id: UUID,
  organizationId: UUID.optional(),
  unitId: UUID.optional(),
  appointmentId: nullableUuid.optional(),
  patientId: UUID.optional(),
  status: z.enum(["WAITING", "TRIAGE", "IN_SERVICE", "DONE", "CANCELLED"]),
  priority: z.enum(["ROUTINE", "URGENT", "EMERGENCY"]).optional(),
  checkedInAt: TIMESTAMP.optional()
};
const queueEntity = strict(queueCore);
const queueReadEntity = strict({ ...queueCore, patient: strict({ id: UUID.optional(), name: text(200, 1) }).nullable().optional() });

const encounterCore = {
  id: UUID,
  organizationId: UUID.optional(),
  unitId: UUID.optional(),
  workspaceId: UUID.optional(),
  patientId: UUID,
  appointmentId: nullableUuid.optional(),
  chiefComplaint: text(2_000, 1).optional(),
  urgency: z.enum(["ROUTINE", "URGENT", "EMERGENCY"]).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "SIGNED", "CLOSED"]),
  openedAt: TIMESTAMP.optional(),
  closedAt: nullableTimestamp.optional()
};
const encounterEntity = strict(encounterCore);
const encounterReadEntity = strict({ ...encounterCore, patient: strict({ id: UUID.optional(), name: text(200, 1) }).nullable().optional() });

const clinicalSummaryEntity = strict({
  id: UUID,
  organizationId: UUID.optional(),
  encounterId: UUID,
  patientId: UUID,
  authorId: UUID.optional(),
  documentType: z.enum(["EVOLUTION", "TRIAGE", "DISCHARGE", "PRESCRIPTION", "REPORT"]),
  title: text(300, 1),
  dataClass: z.enum(["D2", "D3"]),
  status: z.enum(["DRAFT", "REVIEW", "SIGNED", "PUBLISHED"]),
  version: NON_NEGATIVE_INT,
  signedAt: nullableTimestamp,
  signedBy: nullableUuid,
  createdAt: TIMESTAMP
});
const clinicalDocumentEntity = clinicalSummaryEntity.extend({ content: text(30_000) }).strict();
const addendumEntity = strict({ id: UUID, documentId: UUID, authorId: UUID, reason: text(500, 1), content: text(30_000, 1), createdAt: TIMESTAMP });

const diagnosticRequestEntity = strict({
  id: UUID,
  organizationId: UUID.optional(),
  patientId: UUID,
  encounterId: nullableUuid,
  testName: text(240, 1),
  priority: z.enum(["ROUTINE", "URGENT", "STAT"]),
  status: z.enum(["REQUESTED", "SPECIMEN_COLLECTED", "RESULTED", "REVIEWED", "CANCELLED"]),
  requestedBy: UUID,
  createdAt: TIMESTAMP
});
const specimenEntity = strict({ id: UUID, organizationId: UUID.optional(), requestId: UUID, patientId: UUID, label: text(200, 1), collectedAt: TIMESTAMP, status: z.enum(["COLLECTED", "RECEIVED", "REJECTED"]) });
const diagnosticResultEntity = strict({ id: UUID, organizationId: UUID.optional(), requestId: UUID, specimenId: UUID, patientId: UUID, value: text(30_000, 1), source: text(240, 1), sourceVersion: text(160, 1), status: z.enum(["RECEIVED", "QUARANTINED", "VALID", "REJECTED"]), createdAt: TIMESTAMP });

const episodeEntity = strict({ id: UUID, organizationId: UUID.optional(), unitId: UUID.optional(), patientId: UUID, encounterId: nullableUuid, bedId: nullableUuid, status: z.enum(["PLANNED", "ADMITTED", "PROCEDURE", "RECOVERY", "DISCHARGED"]), admittedAt: nullableTimestamp, dischargedAt: nullableTimestamp });
const bedEntity = strict({ id: UUID, organizationId: UUID.optional(), unitId: UUID.optional(), name: text(200, 1), status: z.enum(["AVAILABLE", "OCCUPIED", "MAINTENANCE"]) });

const productEntity = strict({ id: UUID, organizationId: UUID.optional(), sku: text(120, 1), name: text(200, 1), category: text(160, 1), unit: text(60, 1), reorderPoint: NON_NEGATIVE_INT, status: z.enum(["ACTIVE", "INACTIVE"]) });
const medicationOrderEntity = strict({ id: UUID, organizationId: UUID.optional(), patientId: UUID, encounterId: nullableUuid, productId: UUID, dose: text(160, 1), route: text(120, 1), frequency: text(120, 1), status: z.enum(["DRAFT", "ACTIVE", "SUSPENDED", "COMPLETED"]), prescribedBy: UUID, product: strict({ id: UUID, name: text(200, 1), unit: text(60, 1) }).nullable().optional() });
const dispensationEntity = strict({ id: UUID, organizationId: UUID.optional(), medicationOrderId: UUID, lotId: UUID, quantity: NON_NEGATIVE_INT, dispensedBy: UUID.optional(), createdAt: TIMESTAMP });
const administrationEntity = strict({ id: UUID, organizationId: UUID.optional(), medicationOrderId: UUID, administeredBy: UUID.optional(), administeredAt: TIMESTAMP, status: z.enum(["ADMINISTERED", "OMITTED", "REFUSED"]), note: text(500).nullable() });

const lotEntity = strict({ id: UUID, organizationId: UUID.optional(), productId: UUID, lotNumber: text(160, 1), expiresOn: DATE, quantity: NON_NEGATIVE_INT, locationId: UUID, status: z.enum(["AVAILABLE", "EXPIRED", "BLOCKED"]), product: productEntity.nullable().optional(), location: strict({ id: UUID, organizationId: UUID.optional(), unitId: UUID.optional(), name: text(200, 1) }).nullable().optional() });
const stockLocationEntity = strict({ id: UUID, organizationId: UUID.optional(), unitId: UUID.optional(), name: text(200, 1) });
const stockMovementEntity = strict({ id: UUID, organizationId: UUID.optional(), productId: UUID, lotId: UUID, locationId: UUID, quantity: NON_NEGATIVE_INT, movementType: z.enum(["RECEIPT", "DISPENSE", "TRANSFER_IN", "TRANSFER_OUT", "RETURN", "ADJUSTMENT", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"]), reason: text(240, 1), referenceId: nullableUuid, createdBy: UUID, createdAt: TIMESTAMP });
const stockItemEntity = lotEntity;

const chargeEntity = strict({ id: UUID, organizationId: UUID.optional(), unitId: nullableUuid.optional(), patientId: nullableUuid.optional(), description: text(240, 1), amountCents: NON_NEGATIVE_CENTS, currency: CURRENCY, status: z.enum(["OPEN", "PARTIALLY_PAID", "PAID", "REFUNDED"]), createdAt: TIMESTAMP });
const paymentEntity = strict({ id: UUID, organizationId: UUID.optional(), chargeId: UUID, amountCents: NON_NEGATIVE_CENTS, method: z.enum(["PIX", "CARD", "CASH", "TRANSFER"]), externalReference: text(160).nullable(), status: z.enum(["PENDING", "SETTLED", "UNKNOWN", "REFUNDED"]), createdAt: TIMESTAMP });
const ledgerEntity = strict({ id: UUID, organizationId: UUID.optional(), kind: z.enum(["CHARGE", "PAYMENT", "REFUND", "ADJUSTMENT"]), referenceId: UUID, amountCents: z.number().int(), currency: CURRENCY, description: text(240, 1), createdAt: TIMESTAMP });

const knowledgeEntity = strict({
  id: UUID,
  organizationId: UUID.optional(),
  unitId: nullableUuid.optional(),
  workspaceId: nullableUuid.optional(),
  title: text(300, 1),
  source: text(240, 1),
  dataClass: z.enum(["D0", "D1", "D2"]),
  version: NON_NEGATIVE_INT,
  status: z.enum(["DRAFT", "APPROVED", "INDEXING", "INDEXED", "QUARANTINED"]),
  content: text(50_000).optional(),
  createdAt: TIMESTAMP
});
const knowledgeIndexDocumentEntity = strict({ id: UUID, title: text(300, 1), source: text(240, 1), version: NON_NEGATIVE_INT, dataClass: z.enum(["D0", "D1", "D2"]), status: z.enum(["DRAFT", "APPROVED", "INDEXING", "INDEXED", "QUARANTINED"]), checksum: SHA256 });
const knowledgeChunkEntity = strict({ index: NON_NEGATIVE_INT, text: text(10_000, 1), checksum: SHA256 });
const knowledgeIndexEntity = strict({ document: knowledgeIndexDocumentEntity, chunks: z.array(knowledgeChunkEntity) });
const knowledgeSearchHitEntity = knowledgeIndexEntity.extend({ score: z.number().finite().nonnegative() }).strict();

const messageEntity = strict({
  id: UUID,
  organizationId: UUID.optional(),
  unitId: nullableUuid.optional(),
  workspaceId: nullableUuid.optional(),
  patientId: nullableUuid,
  channel: z.enum(["SMS", "EMAIL", "WHATSAPP"]),
  recipient: text(240, 1),
  template: text(240, 1),
  body: text(10_000, 1),
  status: z.enum(["STAGED", "APPROVAL_REQUIRED", "QUEUED", "SENT", "FAILED"]),
  createdBy: UUID.optional(),
  createdAt: TIMESTAMP,
  decidedBy: nullableUuid.optional(),
  decidedAt: nullableTimestamp.optional(),
  approvedBy: nullableUuid.optional(),
  approvedAt: nullableTimestamp.optional(),
  decisionReason: text(500).nullable().optional()
});

const auditEntity = strict({
  id: UUID,
  organizationId: UUID,
  actorId: nullableUuid,
  unitId: nullableUuid,
  workspaceId: nullableUuid,
  action: text(160, 1),
  resourceType: text(120, 1),
  resourceId: nullableUuid,
  result: z.enum(["ALLOWED", "DENIED", "ERROR", "UNKNOWN"]),
  reason: text(500).nullable(),
  correlationId: text(80, 1),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  chainVersion: z.literal(2),
  previousHash: SHA256.nullable(),
  recordHash: SHA256,
  createdAt: TIMESTAMP
});

const aiReferenceEntity = strict({ title: text(500), source: text(2_000) });
const aiProvenanceEntity = strict({
  provider: text(160, 1),
  engineCommit: text(200, 1),
  manifestVersion: text(200, 1),
  profileDigest: text(256, 1),
  policyRevision: text(160, 1),
  references: z.array(aiReferenceEntity).max(128),
  referencesDigest: SHA256.optional(),
  correlationId: text(80, 1),
  usageRecordId: UUID.optional()
});
const aiUsageEntity = strict({
  id: UUID,
  reservationId: nullableUuid,
  providerRequestId: text(512).nullable(),
  idempotencyKey: text(256, 1),
  usageKind: text(160, 1),
  reservedUnits: NON_NEGATIVE_INT,
  consumedUnits: NON_NEGATIVE_INT,
  status: z.enum(["RECEIVED", "SETTLED", "RECONCILIATION_REQUIRED", "QUARANTINED"]),
  record: z.record(z.string(), z.unknown()),
  settlement: z.unknown().optional()
});
const aiTurnEntity = strict({
  id: UUID,
  sessionId: UUID,
  prompt: text(8_000, 0),
  response: text(30_000).nullable(),
  status: z.enum(["RECEIVED", "DENIED", "COMPLETED", "QUARANTINED", "OUTCOME_UNKNOWN"]),
  model: text(200, 1),
  inputTokens: NON_NEGATIVE_INT,
  outputTokens: NON_NEGATIVE_INT,
  references: z.array(aiReferenceEntity).max(128),
  provenance: aiProvenanceEntity.optional(),
  usage: aiUsageEntity.optional(),
  createdAt: TIMESTAMP
});
const aiDraftEntity = strict({
  id: UUID,
  sessionId: UUID,
  encounterId: nullableUuid,
  draftType: z.enum(["CLINICAL_NOTE", "SUMMARY", "MESSAGE"]),
  content: text(30_000),
  sourceTurnId: UUID,
  status: z.enum(["DRAFT", "REVIEWED", "REJECTED", "PROMOTED"]),
  createdAt: TIMESTAMP
});
const aiSessionEntity = strict({
  id: UUID,
  organizationId: UUID.optional(),
  actorId: UUID.optional(),
  unitId: nullableUuid.optional(),
  workspaceId: nullableUuid.optional(),
  patientId: nullableUuid.optional(),
  encounterId: nullableUuid.optional(),
  purpose: z.enum(["SUMMARY", "DRAFT_CLINICAL", "KNOWLEDGE_QUERY", "OPERATIONS"]),
  engineCommit: text(200, 1).optional(),
  profileDigest: text(256, 1).optional(),
  status: z.enum(["ACTIVE", "CLOSED", "QUARANTINED"]),
  createdAt: TIMESTAMP,
  turns: NON_NEGATIVE_INT.optional()
});
const aiApprovalEntity = strict({
  id: UUID,
  organizationId: UUID.optional(),
  actorId: UUID.optional(),
  sessionId: UUID,
  turnId: UUID,
  toolName: text(160, 1),
  resourceId: nullableUuid,
  patientId: nullableUuid,
  encounterId: nullableUuid,
  unitId: nullableUuid,
  workspaceId: nullableUuid,
  purpose: z.enum(["SUMMARY", "DRAFT_CLINICAL", "KNOWLEDGE_QUERY", "OPERATIONS"]),
  requestDigest: SHA256,
  policyRevision: text(160, 1),
  expiresAt: TIMESTAMP,
  decision: z.enum(["allowed-once", "rejected", "unavailable", "consumed"]),
  decidedBy: nullableUuid,
  reason: text(500).nullable(),
  createdAt: TIMESTAMP
});
const aiCapabilitiesEntity = strict({
  adapterId: text(160, 1),
  provider: text(160, 1),
  engineCommit: text(200, 1),
  manifestVersion: text(200, 1),
  toolNames: z.array(text(160, 1)),
  supports: strict({ cancellation: z.boolean(), approvals: z.boolean(), replay: z.boolean(), provenance: z.boolean() })
});
const aiHealthSchema = strict({
  status: z.enum(["READY", "DEGRADED", "UNAVAILABLE", "DISABLED"]),
  capabilities: aiCapabilitiesEntity.optional(),
  checkedAt: TIMESTAMP.optional(),
  reason: text(500).nullable().optional()
});

const operationsSummarySchema = strict({
  appointmentsToday: NON_NEGATIVE_INT,
  waitingPatients: NON_NEGATIVE_INT,
  lowStockItems: NON_NEGATIVE_INT,
  openCharges: NON_NEGATIVE_INT,
  ai: strict({ provider: text(160, 1), tools: NON_NEGATIVE_INT, status: z.enum(["READY", "DEGRADED", "UNAVAILABLE", "DISABLED"]).optional() }),
  unit: text(200)
});

const operationsReportSchema = strict({
  kind: z.enum(["operation", "quality", "cost", "audit", "incidents"]),
  source: strict({
    boundary: z.literal("ReadApplicationService"),
    storageMode: z.enum(["memory", "postgres"]),
    organizationId: UUID,
    unitId: nullableUuid,
    workspaceId: nullableUuid,
    generatedAt: TIMESTAMP,
    filters: strict({ kind: text(40, 1), from: nullableTimestamp, to: nullableTimestamp, limit: z.number().int().min(1).max(100) }),
    bounded: z.literal(true)
  }),
  report: z.record(z.string(), z.unknown())
});

const schedulingOptionsSchema = strict({
  providers: z.array(strict({ id: UUID, organizationId: UUID.optional(), displayName: text(200, 1), specialty: text(200), role: z.enum(["veterinario", "tecnico"]).optional(), unitId: UUID.optional(), status: z.enum(["ACTIVE", "INACTIVE"]).optional() })),
  services: z.array(strict({ id: UUID, organizationId: UUID.optional(), name: text(200, 1), durationMinutes: NON_NEGATIVE_INT, priceCents: NON_NEGATIVE_CENTS, status: z.enum(["ACTIVE", "INACTIVE"]).optional() })),
  resources: z.array(strict({ id: UUID, organizationId: UUID.optional(), unitId: UUID.optional(), name: text(200, 1), kind: z.enum(["ROOM", "EQUIPMENT", "BED"]), status: z.enum(["ACTIVE", "INACTIVE"]).optional() }))
});

const healthSchema = strict({
  live: z.literal(true),
  status: z.enum(["READY", "DEGRADED", "UNAVAILABLE"]),
  capabilities: strict({ demoOnly: z.boolean(), realProvidersBlocked: z.boolean(), realDataBlocked: z.boolean() })
});

const registryEntries: Array<[string, PayloadSchema<unknown>]> = [
  ["POST /auth/login", loginResponseSchema as unknown as PayloadSchema<LoginResponsePayload>],
  ["POST /auth/demo", z.union([mfaChallengeSchema, authenticatedSessionSchema.extend({ demo: z.literal(true) }).strict()]) as unknown as PayloadSchema<unknown>],
  ["POST /auth/mfa/verify", loginResponseSchema as unknown as PayloadSchema<LoginResponsePayload>],
  ["GET /me", meResponseSchema as unknown as PayloadSchema<MeResponsePayload>],
  ["GET /contexts", { safeParse: (value) => parseArray(contextOptionEntity, value) }],
  ["POST /auth/logout", logoutResponseSchema as unknown as PayloadSchema<LogoutResponse>],
  ["GET /health", healthSchema as unknown as PayloadSchema<unknown>],
  ["GET /operations/reports", operationsReportSchema as unknown as PayloadSchema<unknown>],
  ["GET /operations/summary", operationsSummarySchema as unknown as PayloadSchema<unknown>],
  ["GET /ai/health", aiHealthSchema as unknown as PayloadSchema<unknown>],
  ["GET /ai/sessions", listOf(aiSessionEntity) as unknown as PayloadSchema<unknown>],
  ["GET /ai/sessions/:id/replay", strict({ session: aiSessionEntity, turns: z.array(aiTurnEntity), digest: SHA256, provenance: aiCapabilitiesEntity }) as unknown as PayloadSchema<unknown>],
  ["POST /ai/turns", strict({ session: aiSessionEntity, turn: aiTurnEntity, draft: aiDraftEntity.nullable(), approval: aiApprovalEntity.nullable(), provenance: aiProvenanceEntity, receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /ai/approvals/:id", wrapped("approval", aiApprovalEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["GET /patients", listOf(patientEntity) as unknown as PayloadSchema<unknown>],
  ["GET /patients/:id", patientEntity as unknown as PayloadSchema<unknown>],
  ["GET /guardians", listOf(guardianEntity) as unknown as PayloadSchema<unknown>],
  ["GET /appointments", listOf(appointmentReadEntity) as unknown as PayloadSchema<unknown>],
  ["GET /scheduling/options", schedulingOptionsSchema as unknown as PayloadSchema<unknown>],
  ["GET /queue", listOf(queueReadEntity) as unknown as PayloadSchema<unknown>],
  ["GET /encounters", listOf(encounterReadEntity) as unknown as PayloadSchema<unknown>],
  ["GET /clinical/documents", listOf(clinicalSummaryEntity) as unknown as PayloadSchema<unknown>],
  ["GET /clinical/documents/:id", wrapped("document", clinicalDocumentEntity) as unknown as PayloadSchema<unknown>],
  ["GET /clinical/documents/:id/addenda", listOf(addendumEntity) as unknown as PayloadSchema<unknown>],
  ["GET /diagnostics/requests", listOf(diagnosticRequestEntity) as unknown as PayloadSchema<unknown>],
  ["GET /diagnostics/specimens", listOf(specimenEntity) as unknown as PayloadSchema<unknown>],
  ["GET /diagnostics/results", listOf(diagnosticResultEntity) as unknown as PayloadSchema<unknown>],
  ["GET /hospitalization/episodes", listOf(episodeEntity) as unknown as PayloadSchema<unknown>],
  ["GET /hospitalization/beds", listOf(bedEntity) as unknown as PayloadSchema<unknown>],
  ["GET /medications/orders", listOf(medicationOrderEntity) as unknown as PayloadSchema<unknown>],
  ["GET /medications/dispensations", listOf(dispensationEntity) as unknown as PayloadSchema<unknown>],
  ["GET /medications/administrations", listOf(administrationEntity) as unknown as PayloadSchema<unknown>],
  ["GET /stock", listOf(stockItemEntity) as unknown as PayloadSchema<unknown>],
  ["GET /stock/locations", listOf(stockLocationEntity) as unknown as PayloadSchema<unknown>],
  ["GET /stock/products", listOf(productEntity) as unknown as PayloadSchema<unknown>],
  ["GET /stock/movements", listOf(stockMovementEntity) as unknown as PayloadSchema<unknown>],
  ["GET /finance/charges", strict({ items: z.array(chargeEntity), balance: financialBalanceSchema }) as unknown as PayloadSchema<unknown>],
  ["GET /finance/payments", listOf(paymentEntity) as unknown as PayloadSchema<unknown>],
  ["GET /finance/ledger", listOf(ledgerEntity) as unknown as PayloadSchema<unknown>],
  ["GET /knowledge", listOf(knowledgeEntity) as unknown as PayloadSchema<unknown>],
  ["GET /knowledge/search", listOf(knowledgeSearchHitEntity) as unknown as PayloadSchema<unknown>],
  ["GET /knowledge/:id/index", knowledgeIndexEntity as unknown as PayloadSchema<unknown>],
  ["GET /communications", listOf(messageEntity) as unknown as PayloadSchema<unknown>],
  ["GET /audit", listOf(auditEntity, { nextCursor: nullableUuid, revision: text(32, 1) }) as unknown as PayloadSchema<unknown>],
  ["GET /users", listOf(adminUserEntity, { nextCursor: nullableUuid, revision: text(32, 1) }) as unknown as PayloadSchema<unknown>],
  ["GET /capabilities", strict({
    items: z.array(strict({ id: text(120, 1), label: text(240, 1), status: z.enum(["ENABLED", "BLOCKED", "DEGRADED"]), roles: z.array(ROLE) })),
    integrations: z.array(strict({ integrationId: text(160, 1), status: text(80, 1), killSwitch: z.boolean() })).optional(),
    currentRoles: z.array(ROLE).optional(),
     api: strict({ version: text(80, 1), catalogVersion: NON_NEGATIVE_INT, catalogFingerprint: CATALOG_FINGERPRINT, v2: z.record(z.string(), z.unknown()) }).optional()
  }) as unknown as PayloadSchema<unknown>],
  ["POST /role-assignments", strict({ assignment: roleAssignmentEntity.optional(), receiptId: UUID.optional(), revision: text(32, 1) }) as unknown as PayloadSchema<unknown>],
  ["DELETE /role-assignments/:id", strict({ assignment: roleAssignmentEntity.optional(), receiptId: UUID.optional(), revision: text(32, 1) }) as unknown as PayloadSchema<unknown>],
  ["POST /patients", wrapped("patient", patientEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /patients/merge", strict({ targetPatient: patientEntity, sourcePatientId: UUID, receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /patients/:id/disable", wrapped("patient", patientEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /guardians", wrapped("guardian", guardianEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /appointments", wrapped("appointment", appointmentEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /appointments/:id/check-in", wrapped("queueEntry", queueEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /appointments/:id/cancel", wrapped("appointment", appointmentEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /appointments/:id/confirm", wrapped("appointment", appointmentEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /appointments/:id/reschedule", wrapped("appointment", appointmentEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /queue/:id/handoff", strict({ queueEntry: queueEntity, encounter: encounterEntity, receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /queue/:id/triage", wrapped("queueEntry", queueEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /encounters", wrapped("encounter", encounterEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /clinical/documents", wrapped("document", clinicalSummaryEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /clinical/documents/:id/review", wrapped("document", clinicalDocumentEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /clinical/documents/:id/sign", wrapped("document", clinicalSummaryEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /clinical/documents/:id/update", wrapped("document", clinicalDocumentEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /clinical/documents/:id/addenda", wrapped("addendum", addendumEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /diagnostics/requests", wrapped("request", diagnosticRequestEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /diagnostics/requests/:id/specimens", wrapped("specimen", specimenEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /diagnostics/requests/:id/review", wrapped("request", diagnosticRequestEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /diagnostics/results", wrapped("result", diagnosticResultEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /hospitalization/episodes", wrapped("episode", episodeEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /hospitalization/episodes/:id/discharge", wrapped("episode", episodeEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /hospitalization/episodes/:id/status", wrapped("episode", episodeEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /medications/orders", wrapped("order", medicationOrderEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /medications/orders/:id/administer", wrapped("occurrence", administrationEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /medications/orders/:id/dispense", wrapped("dispensation", dispensationEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /medications/orders/:id/status", wrapped("order", medicationOrderEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /stock/products", wrapped("product", productEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /stock/lots", strict({ lot: lotEntity, movement: stockMovementEntity.nullable(), receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /stock/movements", wrapped("movement", stockMovementEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /stock/inventory", strict({ lot: lotEntity, movement: stockMovementEntity.nullable(), delta: z.number().int(), receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /finance/charges", wrapped("charge", chargeEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /finance/payments", wrapped("payment", paymentEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /finance/refunds", wrapped("payment", paymentEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /communications", wrapped("message", messageEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /communications/:id/approve", wrapped("message", messageEntity, { receiptId: UUID, queued: z.boolean() }) as unknown as PayloadSchema<unknown>],
  ["POST /knowledge", wrapped("document", knowledgeEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /knowledge/:id/quarantine", wrapped("document", knowledgeEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /knowledge/:id/approve", wrapped("document", knowledgeEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>],
  ["POST /knowledge/:id/index", wrapped("document", knowledgeEntity, { receiptId: UUID }) as unknown as PayloadSchema<unknown>]
];

const registry = new Map<string, PayloadSchema<unknown>>();
for (const [key, schema] of registryEntries) {
  if (registry.has(key)) throw new Error(`duplicate payload contract for ${key}`);
  registry.set(key, schema);
}

/** Normalizes dynamic path segments (`:id`) so the registry stays stable. */
export function normalizeValidationPath(path: string): string {
  const withoutQuery = path.split("?", 1)[0] ?? path;
  return withoutQuery.split("/").map((segment) => (/^[0-9a-fA-F-]{8,}$/.test(segment) ? ":id" : segment)).join("/");
}

function parseArray<T>(schema: PayloadSchema<T>, value: unknown): ParseResult<unknown> {
  if (!Array.isArray(value)) return { success: false, error: { issues: [{ path: [], message: "expected an array" }] } };
  const items: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const parsed = schema.safeParse(value[index]);
    if (!parsed.success) return { success: false, error: { issues: parsed.error.issues.map((issue) => ({ path: [index, ...issue.path], message: issue.message })) } };
    items.push(parsed.data);
  }
  return { success: true, data: items };
}

export function validatePayload(method: string, path: string, value: unknown): PayloadValidation {
  const key = `${method.toUpperCase()} ${normalizeValidationPath(path)}`;
  if (UNVALIDATED_ALLOWLIST.includes(key)) return { status: "validated", data: value };
  const schema = registry.get(key);
  if (!schema) return { status: "invalid", issues: `unregistered endpoint ${key}; payloads fail closed until a contract is registered` };
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.length ? issue.path.join(".") : "(root)"}: ${issue.message}`).join("; ");
    return { status: "invalid", issues };
  }
  return { status: "validated", data: parsed.data };
}

export { registry as payloadContractRegistry };

export type { ContextOptionPayload, LoginResponsePayload, LogoutResponse, MeResponsePayload };
