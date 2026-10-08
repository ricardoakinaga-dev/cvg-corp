import { z } from "zod";
import {
  aiUsageSettlementSchema,
  chargeStatusSchema,
  currencyCodeSchema,
  financialBalanceSchema,
  idSchema,
  paymentStatusSchema,
  revisionSchema,
  roleSchema
} from "@cvg/contracts";

/**
 * The API currently emits at most 200 rows for the stock-movement route and
 * does not expose a larger unpaged collection at this boundary.  The same
 * ceiling keeps the remaining list contracts bounded while still accepting
 * that live response shape. `nextCursor` and `revision` are optional because
 * the current handlers only emit them on the paginated routes.
 */
const MAX_PAGE_ITEMS = 200;
const MAX_DYNAMIC_KEYS = 256;
const MAX_COUNTER = 1_000_000_000_000;

const timestampSchema = z.string().datetime({ offset: true });
const dateSchema = z.string().date();
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const correlationIdSchema = z.string().regex(/^[A-Za-z0-9._-]{1,80}$/);
const boundedText = (maximum: number, minimum = 1) => z.string().trim().min(minimum).max(maximum);
const versionSchema = z.number().int().min(1).max(1_000_000_000);
const nonNegativeInteger = (maximum = MAX_COUNTER) => z.number().int().nonnegative().max(maximum);
const signedInteger = (minimum: number, maximum: number) => z.number().int().min(minimum).max(maximum);

const runtimeStatusSchema = z.enum(["READY", "DEGRADED", "UNAVAILABLE", "DISABLED"]);
const auditResultSchema = z.enum(["ALLOWED", "DENIED", "ERROR", "UNKNOWN"]);

/**
 * These are the only intentionally open maps in this module. They represent
 * bounded aggregate keys (status/action/metric names), never domain records.
 * Keys are constrained and explicitly reject secret-bearing names so a
 * future counter cannot become a covert redaction bypass.
 */
const dynamicKeySchema = z.string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/ -]{0,119}$/)
  .refine((key) => !/(?:^|[_.:/ -])(?:password|secret|token|authorization|privatekey|rawresponse|providerbody|providererror|accesstoken|refreshtoken)(?:$|[_.:/ -])/i.test(key), "dynamic keys may not expose sensitive fields");

const boundedCounterMap = z.record(dynamicKeySchema, nonNegativeInteger())
  .refine((value) => Object.keys(value).length <= MAX_DYNAMIC_KEYS, "counter map has too many keys");

const productSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  sku: boundedText(40),
  name: boundedText(160),
  category: boundedText(80),
  unit: boundedText(40),
  reorderPoint: nonNegativeInteger(1_000_000),
  status: z.enum(["ACTIVE", "INACTIVE"])
}).strict();

const stockLocationSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  unitId: idSchema,
  name: boundedText(200)
}).strict();

const lotSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  productId: idSchema,
  lotNumber: boundedText(80),
  expiresOn: dateSchema,
  quantity: nonNegativeInteger(1_000_000_000),
  locationId: idSchema,
  status: z.enum(["AVAILABLE", "EXPIRED", "BLOCKED"])
}).strict();

const stockReadSchema = lotSchema.extend({
  product: productSchema.nullable(),
  location: stockLocationSchema.nullable()
}).strict();

const stockMovementSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  productId: idSchema,
  lotId: idSchema,
  locationId: idSchema,
  quantity: z.number().int().positive().max(1_000_000),
  movementType: z.enum(["RECEIPT", "DISPENSE", "TRANSFER_IN", "TRANSFER_OUT", "RETURN", "ADJUSTMENT", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"]),
  reason: boundedText(240),
  referenceId: idSchema.nullable(),
  createdBy: idSchema,
  createdAt: timestampSchema
}).strict();

const bedSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  unitId: idSchema,
  name: boundedText(200),
  status: z.enum(["AVAILABLE", "OCCUPIED", "MAINTENANCE"])
}).strict();

const hospitalEpisodeSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  unitId: idSchema,
  patientId: idSchema,
  encounterId: idSchema.nullable(),
  bedId: idSchema.nullable(),
  status: z.enum(["PLANNED", "ADMITTED", "PROCEDURE", "RECOVERY", "DISCHARGED"]),
  admittedAt: timestampSchema.nullable(),
  dischargedAt: timestampSchema.nullable()
}).strict();

const medicationOrderSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  patientId: idSchema,
  encounterId: idSchema.nullable(),
  productId: idSchema,
  dose: boundedText(120),
  route: boundedText(80),
  frequency: boundedText(120),
  status: z.enum(["DRAFT", "ACTIVE", "SUSPENDED", "COMPLETED"]),
  prescribedBy: idSchema
}).strict();

const medicationOrderReadSchema = medicationOrderSchema.extend({
  product: z.object({
    id: idSchema,
    name: boundedText(160),
    unit: boundedText(40)
  }).strict().nullable()
}).strict();

const dispensationSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  medicationOrderId: idSchema,
  lotId: idSchema,
  quantity: z.number().int().positive().max(1_000_000),
  dispensedBy: idSchema,
  createdAt: timestampSchema
}).strict();

const administrationSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  medicationOrderId: idSchema,
  administeredBy: idSchema,
  administeredAt: timestampSchema,
  status: z.enum(["ADMINISTERED", "OMITTED", "REFUSED"]),
  note: boundedText(500, 0).nullable()
}).strict();

const chargeSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  unitId: idSchema.nullable(),
  patientId: idSchema.nullable(),
  description: boundedText(240),
  amountCents: z.number().int().positive().max(100_000_000),
  currency: currencyCodeSchema,
  status: chargeStatusSchema,
  createdAt: timestampSchema
}).strict();

const paymentSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  chargeId: idSchema,
  amountCents: z.number().int().positive().max(100_000_000),
  method: z.enum(["PIX", "CARD", "CASH", "TRANSFER"]),
  externalReference: boundedText(160, 0).nullable(),
  status: paymentStatusSchema,
  createdAt: timestampSchema
}).strict();

const ledgerEntrySchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  kind: z.enum(["CHARGE", "PAYMENT", "REFUND", "ADJUSTMENT"]),
  referenceId: idSchema,
  amountCents: signedInteger(-100_000_000, 100_000_000),
  currency: currencyCodeSchema,
  description: boundedText(240),
  createdAt: timestampSchema
}).strict();

const communicationSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  unitId: idSchema.nullable(),
  workspaceId: idSchema.nullable(),
  patientId: idSchema.nullable(),
  channel: z.enum(["SMS", "EMAIL", "WHATSAPP"]),
  recipient: boundedText(200),
  template: boundedText(120),
  body: boundedText(4_000),
  status: z.enum(["STAGED", "APPROVAL_REQUIRED", "QUEUED", "SENT", "FAILED"]),
  createdBy: idSchema.optional(),
  decidedBy: idSchema.optional(),
  decidedAt: timestampSchema.optional(),
  approvedBy: idSchema.optional(),
  approvedAt: timestampSchema.optional(),
  decisionReason: boundedText(500, 0).nullable().optional(),
  createdAt: timestampSchema
}).strict();

const knowledgeSummarySchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  unitId: idSchema.nullable(),
  workspaceId: idSchema.nullable(),
  title: boundedText(180),
  source: boundedText(240),
  dataClass: z.enum(["D0", "D1", "D2"]),
  version: versionSchema,
  status: z.enum(["DRAFT", "APPROVED", "INDEXING", "INDEXED", "QUARANTINED"]),
  createdAt: timestampSchema
}).strict();

const knowledgeDocumentSchema = knowledgeSummarySchema.extend({
  content: boundedText(50_000)
}).strict();

/*
 * KnowledgeDocumentResponse is shared by create/approve/index/quarantine.
 * Create redacts content before serialization; the state-changing routes
 * return the reviewed document body. The union is intentionally broad only
 * at this nested route-shape boundary; KnowledgeListResponse is redacted.
 */
const knowledgeDocumentWireSchema = z.union([knowledgeSummarySchema, knowledgeDocumentSchema]);

const knowledgeIndexDocumentSchema = z.object({
  id: idSchema,
  title: boundedText(180),
  source: boundedText(240),
  version: versionSchema,
  dataClass: z.enum(["D0", "D1", "D2"]),
  status: z.enum(["DRAFT", "APPROVED", "INDEXING", "INDEXED", "QUARANTINED"]),
  checksum: digestSchema
}).strict();

const knowledgeChunkSchema = z.object({
  index: nonNegativeInteger(100_000),
  text: boundedText(400),
  checksum: digestSchema
}).strict();

const knowledgeIndexSchema = z.object({
  document: knowledgeIndexDocumentSchema,
  chunks: z.array(knowledgeChunkSchema).max(128)
}).strict();

const knowledgeSearchHitSchema = knowledgeIndexSchema.extend({
  score: z.number().finite().nonnegative().max(128)
}).strict();

const capabilitySchema = z.object({
  id: boundedText(120),
  label: boundedText(240),
  status: z.enum(["ENABLED", "BLOCKED", "DEGRADED"]),
  roles: z.array(roleSchema).max(16)
}).strict();

const integrationSummarySchema = z.object({
  integrationId: boundedText(160),
  status: z.enum(["PROPOSED", "ENABLED", "DISABLED", "QUARANTINED"]),
  killSwitch: z.boolean()
}).strict();

const apiCompatibilitySchema = z.object({
  version: z.literal("v1"),
  catalogVersion: z.literal(1),
  catalogFingerprint: z.string().regex(/^[a-f0-9]{8}$/),
  v2: z.object({
    status: z.literal("PREPARED_ONLY"),
    basePath: z.literal("/api/v2"),
    migration: boundedText(240),
    upcasters: z.literal("FAIL_CLOSED_REGISTRY"),
    registered: z.literal(0),
    legacySchemasAccepted: z.literal(false)
  }).strict()
}).strict();

const operationsSummarySchema = z.object({
  appointmentsToday: nonNegativeInteger(),
  waitingPatients: nonNegativeInteger(),
  lowStockItems: nonNegativeInteger(),
  openCharges: nonNegativeInteger(),
  ai: z.object({
    provider: boundedText(160),
    tools: nonNegativeInteger(),
    status: runtimeStatusSchema
  }).strict(),
  unit: boundedText(200, 0)
}).strict();

const queueSignalsSchema = z.object({
  outboxDepth: nonNegativeInteger(),
  oldestAgeMs: nonNegativeInteger(86_400_000 * 365),
  poisonMessages: nonNegativeInteger(),
  reconciliationLag: nonNegativeInteger(),
  workerHeartbeatAgeMs: nonNegativeInteger(86_400_000 * 365),
  workerHeartbeatCount: nonNegativeInteger()
}).strict();

const operationsSourceSchema = z.object({
  boundary: z.literal("ReadApplicationService"),
  storageMode: z.enum(["memory", "postgres"]),
  organizationId: idSchema,
  unitId: idSchema.nullable(),
  workspaceId: idSchema.nullable(),
  generatedAt: timestampSchema,
  filters: z.object({
    kind: z.enum(["operation", "quality", "cost", "audit", "incidents"]),
    from: timestampSchema.nullable(),
    to: timestampSchema.nullable(),
    limit: z.number().int().min(1).max(100)
  }).strict(),
  bounded: z.literal(true)
}).strict();

const operationReportSchema = z.object({
  appointments: z.object({ total: nonNegativeInteger(), byStatus: boundedCounterMap }).strict(),
  queue: z.object({ total: nonNegativeInteger(), waiting: nonNegativeInteger(), byStatus: boundedCounterMap }).strict(),
  stock: z.object({ totalLots: nonNegativeInteger(), lowStockLots: nonNegativeInteger() }).strict(),
  hospitalization: z.object({ beds: boundedCounterMap, episodes: boundedCounterMap }).strict(),
  communications: z.object({ total: nonNegativeInteger(), byStatus: boundedCounterMap }).strict()
}).strict();

const qualityReportSchema = z.object({
  clinical: z.object({ total: nonNegativeInteger(), byStatus: boundedCounterMap, unsigned: nonNegativeInteger() }).strict(),
  diagnostics: z.object({ total: nonNegativeInteger(), byStatus: boundedCounterMap, quarantined: nonNegativeInteger() }).strict(),
  audit: z.object({ records: nonNegativeInteger(), denied: nonNegativeInteger() }).strict(),
  receipts: z.object({ total: nonNegativeInteger(), unknown: nonNegativeInteger(), unlinked: nonNegativeInteger() }).strict(),
  quarantine: z.object({ total: nonNegativeInteger() }).strict()
}).strict();

const costReportSchema = z.object({
  currentBalance: financialBalanceSchema,
  window: z.object({
    charges: z.object({ total: nonNegativeInteger(), amountCents: nonNegativeInteger(100_000_000_000), byStatus: boundedCounterMap }).strict(),
    payments: z.object({ total: nonNegativeInteger(), settledAmountCents: nonNegativeInteger(100_000_000_000), byStatus: boundedCounterMap }).strict()
  }).strict()
}).strict();

const auditItemSchema = z.object({
  id: idSchema,
  action: boundedText(160),
  resourceType: boundedText(120),
  result: auditResultSchema,
  correlationId: correlationIdSchema,
  createdAt: timestampSchema
}).strict();

const auditReportSchema = z.object({
  total: nonNegativeInteger(100),
  byAction: boundedCounterMap,
  items: z.array(auditItemSchema).max(100)
}).strict();

const incidentItemSchema = z.object({
  id: idSchema,
  action: boundedText(160),
  result: auditResultSchema,
  reason: boundedText(2_000, 0).nullable(),
  correlationId: correlationIdSchema,
  createdAt: timestampSchema
}).strict();

const incidentsReportSchema = z.object({
  runtime: z.object({ status: runtimeStatusSchema, provider: boundedText(160) }).strict(),
  queue: queueSignalsSchema,
  audit: z.object({ denied: nonNegativeInteger(100), items: z.array(incidentItemSchema).max(100) }).strict(),
  receipts: z.object({ outcomeUnknown: nonNegativeInteger(), inFlight: nonNegativeInteger() }).strict(),
  quarantine: z.object({ total: nonNegativeInteger() }).strict()
}).strict();

const operationsReportSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("operation"), source: operationsSourceSchema, report: operationReportSchema }).strict(),
  z.object({ kind: z.literal("quality"), source: operationsSourceSchema, report: qualityReportSchema }).strict(),
  z.object({ kind: z.literal("cost"), source: operationsSourceSchema, report: costReportSchema }).strict(),
  z.object({ kind: z.literal("audit"), source: operationsSourceSchema, report: auditReportSchema }).strict(),
  z.object({ kind: z.literal("incidents"), source: operationsSourceSchema, report: incidentsReportSchema }).strict()
]);

const metricsSchema = z.object({
  requestsTotal: nonNegativeInteger(),
  requestsDenied: nonNegativeInteger(),
  requestsError: nonNegativeInteger(),
  latencyMs: z.object({
    p50: z.number().nonnegative().max(86_400_000),
    p95: z.number().nonnegative().max(86_400_000),
    p99: z.number().nonnegative().max(86_400_000)
  }).strict(),
  activeSessions: nonNegativeInteger(),
  agentRuntime: runtimeStatusSchema,
  storageMode: z.enum(["memory", "postgres"]),
  operations: boundedCounterMap,
  agentCounters: boundedCounterMap,
  statusCodes: boundedCounterMap,
  dependencies: z.object({
    database: z.enum(["READY", "UNAVAILABLE", "NOT_CONFIGURED", "DEGRADED"]),
    policyStore: z.enum(["READY", "UNAVAILABLE", "NOT_CONFIGURED", "DEGRADED"]),
    secretProvider: z.enum(["READY", "UNAVAILABLE", "NOT_CONFIGURED", "DEGRADED"]),
    outbox: z.enum(["READY", "UNAVAILABLE", "NOT_CONFIGURED", "DEGRADED"]),
    auditLedger: z.enum(["READY", "UNAVAILABLE", "NOT_CONFIGURED", "DEGRADED"])
  }).strict(),
  domain: z.object({
    auditRecords: nonNegativeInteger(),
    commandReceipts: nonNegativeInteger(),
    unlinkedReceipts: nonNegativeInteger(),
    outcomeUnknown: nonNegativeInteger(),
    quarantined: nonNegativeInteger()
  }).strict(),
  queues: queueSignalsSchema,
  telemetry: z.object({
    mode: z.enum(["REDACTED_BEST_EFFORT", "OTEL_OTLP_REDACTED"]),
    logsStored: nonNegativeInteger(),
    dropped: nonNegativeInteger(),
    duplicates: nonNegativeInteger()
  }).strict()
}).strict();

const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  createdAt: timestampSchema,
  digest: digestSchema,
  redacted: z.literal(true),
  snapshot: z.object({
    organizations: z.array(z.object({
      id: idSchema,
      name: boundedText(200),
      status: z.enum(["ACTIVE", "QUARANTINED"]),
      authorizationRevision: revisionSchema
    }).strict()).max(32),
    counts: z.object({
      units: nonNegativeInteger(),
      workspaces: nonNegativeInteger(),
      users: nonNegativeInteger(),
      patients: nonNegativeInteger(),
      auditRecords: nonNegativeInteger(),
      commandReceipts: nonNegativeInteger(),
      quarantined: nonNegativeInteger()
    }).strict()
  }).strict()
}).strict();

const recoveryEnvelopeSchema = z.object({
  format: z.literal("CVG-RECOVERY-BUNDLE"),
  version: z.union([z.literal(1), z.literal(2)]),
  algorithm: z.literal("AES-256-GCM"),
  keyRef: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,160}$/),
  payloadDigest: digestSchema,
  expiresAt: timestampSchema.nullable(),
  nonce: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(128),
  ciphertext: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).min(1).max(512_000),
  authTag: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(128)
}).strict();

const encryptedRecoveryBundleSchema = z.object({
  exportId: idSchema,
  purpose: z.enum(["INCIDENT_RECOVERY", "AUDIT_REVIEW", "MIGRATION_VALIDATION", "LEGAL_HOLD"]),
  purposeDigest: digestSchema,
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
  scope: z.object({
    organizationId: idSchema,
    unitId: idSchema.nullable(),
    workspaceId: idSchema.nullable()
  }).strict(),
  manifest: z.object({
    format: z.literal("CVG-RECOVERY-MANIFEST"),
    version: z.literal(1),
    revision: z.string().regex(/^\d{1,30}$/),
    snapshotDigest: digestSchema,
    eventId: boundedText(200),
    migrationFingerprint: digestSchema
  }).strict(),
  envelope: recoveryEnvelopeSchema,
  receiptId: idSchema,
  replayed: z.boolean()
}).strict();

const restoreSchema = z.object({
  status: z.enum(["READY", "QUARANTINED"]),
  loginBlocked: z.literal(true),
  sessionsInvalidated: z.literal(true),
  reason: boundedText(500)
}).strict();

const aiReferenceSchema = z.object({
  title: boundedText(500),
  source: boundedText(2_000)
}).strict();

const aiCapabilitiesSchema = z.object({
  adapterId: boundedText(160),
  provider: boundedText(160),
  engineCommit: boundedText(200),
  manifestVersion: boundedText(200),
  toolNames: z.array(boundedText(160)).max(256),
  supports: z.object({
    cancellation: z.boolean(),
    approvals: z.boolean(),
    replay: z.boolean(),
    provenance: z.boolean()
  }).strict()
}).strict();

const aiSessionSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  actorId: idSchema,
  unitId: idSchema.nullable(),
  workspaceId: idSchema.nullable(),
  patientId: idSchema.nullable(),
  encounterId: idSchema.nullable(),
  purpose: z.enum(["SUMMARY", "DRAFT_CLINICAL", "KNOWLEDGE_QUERY", "OPERATIONS"]),
  engineCommit: boundedText(200),
  profileDigest: boundedText(256),
  status: z.enum(["ACTIVE", "CLOSED", "QUARANTINED"]),
  createdAt: timestampSchema
}).strict();

const aiSessionReadSchema = aiSessionSchema.extend({ turns: nonNegativeInteger() }).strict();

const aiApprovalSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  actorId: idSchema,
  sessionId: idSchema,
  turnId: idSchema,
  toolName: boundedText(160),
  resourceId: idSchema.nullable(),
  patientId: idSchema.nullable(),
  encounterId: idSchema.nullable(),
  unitId: idSchema.nullable(),
  workspaceId: idSchema.nullable(),
  purpose: z.enum(["SUMMARY", "DRAFT_CLINICAL", "KNOWLEDGE_QUERY", "OPERATIONS"]),
  requestDigest: digestSchema,
  policyRevision: boundedText(160),
  expiresAt: timestampSchema,
  decision: z.enum(["allowed-once", "rejected", "unavailable", "consumed"]),
  decidedBy: idSchema.nullable(),
  reason: boundedText(500, 0).nullable(),
  createdAt: timestampSchema
}).strict();

const aiUsageRecordSchema = z.object({
  kind: z.literal("AI_TURN_USAGE"),
  turnId: idSchema,
  sessionId: idSchema,
  model: boundedText(200),
  provider: boundedText(160),
  engineCommit: boundedText(200),
  manifestVersion: boundedText(200),
  profileDigest: boundedText(256),
  policyRevision: boundedText(160),
  correlationId: correlationIdSchema,
  referencesDigest: digestSchema,
  responseDigest: digestSchema,
  reservationId: idSchema.nullable(),
  reservedUnits: nonNegativeInteger(),
  consumedUnits: nonNegativeInteger(),
  settlementStatus: z.enum(["RECEIVED", "SETTLED", "RECONCILIATION_REQUIRED", "QUARANTINED"]),
  settlement: aiUsageSettlementSchema
}).strict();

const aiUsageSchema = z.object({
  id: idSchema,
  reservationId: idSchema.nullable(),
  providerRequestId: boundedText(512, 0).nullable(),
  idempotencyKey: boundedText(256),
  usageKind: boundedText(160),
  reservedUnits: nonNegativeInteger(),
  consumedUnits: nonNegativeInteger(),
  status: z.enum(["RECEIVED", "SETTLED", "RECONCILIATION_REQUIRED", "QUARANTINED"]),
  record: aiUsageRecordSchema,
  settlement: aiUsageSettlementSchema.optional()
}).strict();

const aiTurnSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  prompt: boundedText(8_000),
  response: boundedText(30_000, 0).nullable(),
  status: z.enum(["RECEIVED", "DENIED", "COMPLETED", "QUARANTINED", "OUTCOME_UNKNOWN"]),
  model: boundedText(200),
  inputTokens: nonNegativeInteger(),
  outputTokens: nonNegativeInteger(),
  references: z.array(aiReferenceSchema).max(128),
  provenance: z.object({
    provider: boundedText(160),
    engineCommit: boundedText(200),
    manifestVersion: boundedText(200),
    profileDigest: boundedText(256),
    policyRevision: boundedText(160),
    references: z.array(aiReferenceSchema).max(128),
    referencesDigest: digestSchema.optional(),
    correlationId: correlationIdSchema,
    usageRecordId: idSchema.optional()
  }).strict().optional(),
  usage: aiUsageSchema.optional(),
  createdAt: timestampSchema
}).strict();

const aiDraftSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  encounterId: idSchema.nullable(),
  draftType: z.enum(["CLINICAL_NOTE", "SUMMARY", "MESSAGE"]),
  content: boundedText(30_000, 0),
  sourceTurnId: idSchema,
  status: z.enum(["DRAFT", "REVIEWED", "REJECTED", "PROMOTED"]),
  createdAt: timestampSchema
}).strict();

const agentRuntimeHealthSchema = z.object({
  status: runtimeStatusSchema,
  capabilities: aiCapabilitiesSchema,
  checkedAt: timestampSchema,
  reason: boundedText(500, 0).nullable()
}).strict();

const aiReadinessSchema = z.object({
  ready: z.boolean(),
  aiState: z.enum(["READY", "DISABLED", "AI_DEGRADED"]),
  status: runtimeStatusSchema,
  reason: boundedText(500, 0).nullable(),
  checkedAt: timestampSchema,
  capabilities: aiCapabilitiesSchema
}).strict();

const agentTurnResultSchema = z.object({
  session: aiSessionSchema,
  turn: aiTurnSchema,
  draft: aiDraftSchema.nullable(),
  approval: aiApprovalSchema.nullable(),
  provenance: z.object({
    provider: boundedText(160),
    engineCommit: boundedText(200),
    manifestVersion: boundedText(200),
    profileDigest: boundedText(256),
    policyRevision: boundedText(160),
    references: z.array(aiReferenceSchema).max(128),
    referencesDigest: digestSchema.optional(),
    correlationId: correlationIdSchema,
    usageRecordId: idSchema.optional()
  }).strict(),
  receiptId: idSchema
}).strict();

const agentDraftPromotionSchema = z.object({
  draft: aiDraftSchema,
  documentId: idSchema,
  receiptId: idSchema
}).strict();

const agentReplayResultSchema = z.object({
  session: aiSessionSchema,
  turns: z.array(aiTurnSchema).max(MAX_PAGE_ITEMS),
  digest: digestSchema,
  provenance: aiCapabilitiesSchema
}).strict();

const listResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) => z.object({
  items: z.array(itemSchema).max(MAX_PAGE_ITEMS),
  nextCursor: idSchema.nullable().optional(),
  revision: revisionSchema.optional()
}).strict();

const remainingSchemaEntries: ReadonlyArray<readonly [string, z.ZodTypeAny]> = [
  ["StockListResponse", listResponseSchema(stockReadSchema)],
  ["StockMovementListResponse", listResponseSchema(stockMovementSchema)],
  ["StockLocationListResponse", listResponseSchema(stockLocationSchema)],
  ["ProductListResponse", listResponseSchema(productSchema)],
  ["ProductResponse", z.object({ product: productSchema, receiptId: idSchema }).strict()],
  ["LotResponse", z.object({ lot: lotSchema, movement: stockMovementSchema.nullable(), receiptId: idSchema }).strict()],
  ["InventoryCountResponse", z.object({ lot: lotSchema, movement: stockMovementSchema.nullable(), delta: signedInteger(-1_000_000, 1_000_000), receiptId: idSchema }).strict()],
  ["StockMovementResponse", z.object({ movement: stockMovementSchema, receiptId: idSchema }).strict()],
  ["BedListResponse", listResponseSchema(bedSchema)],
  ["HospitalEpisodeListResponse", listResponseSchema(hospitalEpisodeSchema)],
  ["HospitalEpisodeResponse", z.object({ episode: hospitalEpisodeSchema, receiptId: idSchema }).strict()],
  ["MedicationOrderListResponse", listResponseSchema(medicationOrderReadSchema)],
  ["DispensationListResponse", listResponseSchema(dispensationSchema)],
  ["AdministrationListResponse", listResponseSchema(administrationSchema)],
  ["MedicationOrderResponse", z.object({ order: medicationOrderSchema, receiptId: idSchema }).strict()],
  ["DispensationResponse", z.object({ dispensation: dispensationSchema, receiptId: idSchema }).strict()],
  ["AdministrationResponse", z.object({ occurrence: administrationSchema, receiptId: idSchema }).strict()],
  ["ChargeListResponse", z.object({ items: z.array(chargeSchema).max(MAX_PAGE_ITEMS), balance: financialBalanceSchema }).strict()],
  ["ChargeResponse", z.object({ charge: chargeSchema, receiptId: idSchema }).strict()],
  ["PaymentResponse", z.object({ payment: paymentSchema, receiptId: idSchema }).strict()],
  ["PaymentListResponse", listResponseSchema(paymentSchema)],
  ["LedgerListResponse", listResponseSchema(ledgerEntrySchema)],
  ["CommunicationListResponse", listResponseSchema(communicationSchema)],
  ["CommunicationResponse", z.object({ message: communicationSchema, receiptId: idSchema, queued: z.boolean().optional() }).strict()],
  ["KnowledgeListResponse", listResponseSchema(knowledgeSummarySchema)],
  ["KnowledgeDocumentResponse", z.object({ document: knowledgeDocumentWireSchema, receiptId: idSchema }).strict()],
  ["KnowledgeSearchResponse", listResponseSchema(knowledgeSearchHitSchema)],
  ["KnowledgeIndexResponse", knowledgeIndexSchema],
  ["CapabilityListResponse", z.object({ items: z.array(capabilitySchema).max(64), integrations: z.array(integrationSummarySchema).max(64), currentRoles: z.array(roleSchema).max(16), api: apiCompatibilitySchema }).strict()],
  ["OperationsSummary", operationsSummarySchema],
  ["OperationsReport", operationsReportSchema],
  ["MetricsResponse", metricsSchema],
  ["SnapshotResponse", snapshotSchema],
  ["EncryptedRecoveryBundle", encryptedRecoveryBundleSchema],
  ["RestoreResponse", restoreSchema],
  ["AgentRuntimeHealth", agentRuntimeHealthSchema],
  ["AiReadinessResponse", aiReadinessSchema],
  ["AiSessionListResponse", listResponseSchema(aiSessionReadSchema)],
  ["AgentTurnResult", agentTurnResultSchema],
  ["AiApprovalResponse", z.object({ approval: aiApprovalSchema, receiptId: idSchema }).strict()],
  ["AgentDraftPromotion", agentDraftPromotionSchema],
  ["AgentReplayResult", agentReplayResultSchema]
];

const remainingSchemaMap: ReadonlyMap<string, z.ZodTypeAny> = new Map(remainingSchemaEntries);

/** Payload schemas for the remaining hospital, operations, and AI routes. */
export const remainingResponseSchemas: ReadonlyMap<string, z.ZodTypeAny> = remainingSchemaMap;
export const REMAINING_RESPONSE_SCHEMAS = remainingSchemaMap;
