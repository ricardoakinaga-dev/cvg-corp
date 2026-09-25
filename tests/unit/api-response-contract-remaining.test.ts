import test from "node:test";
import assert from "node:assert/strict";
import { remainingResponseSchemas } from "../../apps/api/src/response-schemas/remaining.ts";

const ids = {
  organization: "00000000-0000-4000-8000-000000000001",
  actor: "00000000-0000-4000-8000-000000000002",
  unit: "00000000-0000-4000-8000-000000000003",
  workspace: "00000000-0000-4000-8000-000000000004",
  patient: "00000000-0000-4000-8000-000000000005",
  encounter: "00000000-0000-4000-8000-000000000006",
  product: "00000000-0000-4000-8000-000000000007",
  lot: "00000000-0000-4000-8000-000000000008",
  location: "00000000-0000-4000-8000-000000000009",
  movement: "00000000-0000-4000-8000-000000000010",
  episode: "00000000-0000-4000-8000-000000000011",
  bed: "00000000-0000-4000-8000-000000000012",
  order: "00000000-0000-4000-8000-000000000013",
  dispensation: "00000000-0000-4000-8000-000000000014",
  administration: "00000000-0000-4000-8000-000000000015",
  charge: "00000000-0000-4000-8000-000000000016",
  payment: "00000000-0000-4000-8000-000000000017",
  ledger: "00000000-0000-4000-8000-000000000018",
  message: "00000000-0000-4000-8000-000000000019",
  knowledge: "00000000-0000-4000-8000-000000000020",
  session: "00000000-0000-4000-8000-000000000021",
  turn: "00000000-0000-4000-8000-000000000022",
  draft: "00000000-0000-4000-8000-000000000023",
  approval: "00000000-0000-4000-8000-000000000024",
  receipt: "00000000-0000-4000-8000-000000000025"
} as const;

const timestamp = "2026-09-21T12:00:00.000Z";
const digest = "a".repeat(64);

const product = {
  id: ids.product,
  organizationId: ids.organization,
  sku: "AMOX-10",
  name: "Amoxicilina",
  category: "antibiotic",
  unit: "comprimido",
  reorderPoint: 10,
  status: "ACTIVE"
};
const location = { id: ids.location, organizationId: ids.organization, unitId: ids.unit, name: "Farmácia" };
const lot = {
  id: ids.lot,
  organizationId: ids.organization,
  productId: ids.product,
  lotNumber: "L-2026-01",
  expiresOn: "2027-01-31",
  quantity: 20,
  locationId: ids.location,
  status: "AVAILABLE"
};
const movement = {
  id: ids.movement,
  organizationId: ids.organization,
  productId: ids.product,
  lotId: ids.lot,
  locationId: ids.location,
  quantity: 5,
  movementType: "RECEIPT",
  reason: "Entrada inicial",
  referenceId: null,
  createdBy: ids.actor,
  createdAt: timestamp
};
const episode = {
  id: ids.episode,
  organizationId: ids.organization,
  unitId: ids.unit,
  patientId: ids.patient,
  encounterId: ids.encounter,
  bedId: ids.bed,
  status: "ADMITTED",
  admittedAt: timestamp,
  dischargedAt: null
};
const bed = { id: ids.bed, organizationId: ids.organization, unitId: ids.unit, name: "Canil 1", status: "OCCUPIED" };
const order = {
  id: ids.order,
  organizationId: ids.organization,
  patientId: ids.patient,
  encounterId: ids.encounter,
  productId: ids.product,
  dose: "10 mg",
  route: "oral",
  frequency: "a cada 12 horas",
  status: "ACTIVE",
  prescribedBy: ids.actor
};
const orderRead = { ...order, product: { id: ids.product, name: product.name, unit: product.unit } };
const dispensation = { id: ids.dispensation, organizationId: ids.organization, medicationOrderId: ids.order, lotId: ids.lot, quantity: 1, dispensedBy: ids.actor, createdAt: timestamp };
const administration = { id: ids.administration, organizationId: ids.organization, medicationOrderId: ids.order, administeredBy: ids.actor, administeredAt: timestamp, status: "ADMINISTERED", note: null };
const charge = { id: ids.charge, organizationId: ids.organization, unitId: ids.unit, patientId: ids.patient, description: "Consulta", amountCents: 10000, currency: "BRL", status: "OPEN", createdAt: timestamp };
const payment = { id: ids.payment, organizationId: ids.organization, chargeId: ids.charge, amountCents: 10000, method: "PIX", externalReference: null, status: "SETTLED", createdAt: timestamp };
const ledger = { id: ids.ledger, organizationId: ids.organization, kind: "CHARGE", referenceId: ids.charge, amountCents: 10000, currency: "BRL", description: "Consulta", createdAt: timestamp };
const message = { id: ids.message, organizationId: ids.organization, unitId: ids.unit, workspaceId: ids.workspace, patientId: ids.patient, channel: "SMS", recipient: "+5511999999999", template: "lembrete", body: "Seu atendimento está confirmado.", status: "APPROVAL_REQUIRED", createdBy: ids.actor, createdAt: timestamp };
const knowledge = { id: ids.knowledge, organizationId: ids.organization, unitId: ids.unit, workspaceId: ids.workspace, title: "Protocolo", source: "Manual", dataClass: "D1", version: 1, status: "INDEXED", createdAt: timestamp };
const knowledgeIndex = { document: { id: ids.knowledge, title: "Protocolo", source: "Manual", version: 1, dataClass: "D1", status: "INDEXED", checksum: digest }, chunks: [{ index: 0, text: "Conteúdo seguro", checksum: digest }] };
const capabilities = { adapterId: "local", provider: "local-stub", engineCommit: "engine-1", manifestVersion: "manifest-1", toolNames: ["read_patient"], supports: { cancellation: true, approvals: true, replay: true, provenance: true } };
const session = { id: ids.session, organizationId: ids.organization, actorId: ids.actor, unitId: ids.unit, workspaceId: ids.workspace, patientId: ids.patient, encounterId: ids.encounter, purpose: "SUMMARY", engineCommit: "engine-1", profileDigest: digest, status: "ACTIVE", createdAt: timestamp };
const provenance = { provider: "local-stub", engineCommit: "engine-1", manifestVersion: "manifest-1", profileDigest: digest, policyRevision: "1", references: [], referencesDigest: digest, correlationId: "contract-test" };
const turn = { id: ids.turn, sessionId: ids.session, prompt: "Summarize", response: "Summary", status: "COMPLETED", model: "local-model", inputTokens: 4, outputTokens: 3, references: [], provenance, createdAt: timestamp };
const draft = { id: ids.draft, sessionId: ids.session, encounterId: ids.encounter, draftType: "SUMMARY", content: "Draft", sourceTurnId: ids.turn, status: "DRAFT", createdAt: timestamp };
const approval = { id: ids.approval, organizationId: ids.organization, actorId: ids.actor, sessionId: ids.session, turnId: ids.turn, toolName: "read_patient", resourceId: ids.patient, patientId: ids.patient, encounterId: ids.encounter, unitId: ids.unit, workspaceId: ids.workspace, purpose: "SUMMARY", requestDigest: digest, policyRevision: "1", expiresAt: timestamp, decision: "unavailable", decidedBy: null, reason: null, createdAt: timestamp };

const financialBalance = {
  currency: "BRL",
  chargedCents: 10000,
  settledPaymentCents: 0,
  pendingCents: 10000,
  state: "OPEN",
  refunds: { status: "NOT_APPLICABLE", amountCents: null },
  observedAt: timestamp
};

const source = { boundary: "ReadApplicationService", storageMode: "memory", organizationId: ids.organization, unitId: ids.unit, workspaceId: ids.workspace, generatedAt: timestamp, filters: { kind: "operation", from: null, to: null, limit: 50 }, bounded: true };
const operationReport = {
  appointments: { total: 0, byStatus: {} },
  queue: { total: 0, waiting: 0, byStatus: {} },
  stock: { totalLots: 0, lowStockLots: 0 },
  hospitalization: { beds: {}, episodes: {} },
  communications: { total: 0, byStatus: {} }
};

const metrics = {
  requestsTotal: 0,
  requestsDenied: 0,
  requestsError: 0,
  latencyMs: { p50: 0, p95: 0, p99: 0 },
  activeSessions: 0,
  agentRuntime: "READY",
  storageMode: "memory",
  operations: {},
  agentCounters: {},
  statusCodes: {},
  dependencies: { database: "NOT_CONFIGURED", policyStore: "READY", secretProvider: "NOT_CONFIGURED", outbox: "NOT_CONFIGURED", auditLedger: "DEGRADED" },
  domain: { auditRecords: 0, commandReceipts: 0, unlinkedReceipts: 0, outcomeUnknown: 0, quarantined: 0 },
  queues: { outboxDepth: 0, oldestAgeMs: 0, poisonMessages: 0, reconciliationLag: 0, workerHeartbeatAgeMs: 0, workerHeartbeatCount: 0 },
  telemetry: { mode: "REDACTED_BEST_EFFORT", logsStored: 0, dropped: 0, duplicates: 0 }
};

const validPayloads: Readonly<Record<string, unknown>> = {
  StockListResponse: { items: [{ ...lot, product, location }], nextCursor: null, revision: "1" },
  StockMovementListResponse: { items: [], nextCursor: null, revision: "1" },
  StockLocationListResponse: { items: [location] },
  ProductResponse: { product, receiptId: ids.receipt },
  LotResponse: { lot, movement: null, receiptId: ids.receipt },
  InventoryCountResponse: { lot, movement, delta: 5, receiptId: ids.receipt },
  StockMovementResponse: { movement, receiptId: ids.receipt },
  BedListResponse: { items: [bed] },
  HospitalEpisodeListResponse: { items: [episode] },
  HospitalEpisodeResponse: { episode, receiptId: ids.receipt },
  MedicationOrderListResponse: { items: [orderRead] },
  DispensationListResponse: { items: [dispensation] },
  AdministrationListResponse: { items: [administration] },
  MedicationOrderResponse: { order, receiptId: ids.receipt },
  DispensationResponse: { dispensation, receiptId: ids.receipt },
  AdministrationResponse: { occurrence: administration, receiptId: ids.receipt },
  ChargeListResponse: { items: [charge], balance: financialBalance },
  ChargeResponse: { charge, receiptId: ids.receipt },
  PaymentResponse: { payment, receiptId: ids.receipt },
  PaymentListResponse: { items: [payment] },
  LedgerListResponse: { items: [ledger] },
  CommunicationListResponse: { items: [message] },
  CommunicationResponse: { message, receiptId: ids.receipt, queued: false },
  KnowledgeListResponse: { items: [knowledge] },
  KnowledgeDocumentResponse: { document: knowledge, receiptId: ids.receipt },
  KnowledgeSearchResponse: { items: [{ ...knowledgeIndex, score: 1 }] },
  KnowledgeIndexResponse: knowledgeIndex,
  CapabilityListResponse: { items: [{ id: "stock", label: "Estoque", status: "ENABLED", roles: ["estoque"] }], integrations: [{ integrationId: "lab.synthetic", status: "ENABLED", killSwitch: false }], currentRoles: ["admin"], api: { version: "v1", catalogVersion: 1, catalogFingerprint: "a1b2c3d4", v2: { status: "PREPARED_ONLY", basePath: "/api/v2", migration: "v1 remains supported", upcasters: "FAIL_CLOSED_REGISTRY", registered: 0, legacySchemasAccepted: false } } },
  OperationsSummary: { appointmentsToday: 0, waitingPatients: 0, lowStockItems: 0, openCharges: 0, ai: { provider: "local-stub", tools: 1, status: "READY" }, unit: "Organização" },
  OperationsReport: { kind: "operation", source, report: operationReport },
  MetricsResponse: metrics,
  SnapshotResponse: { schemaVersion: 1, createdAt: timestamp, digest, redacted: true, snapshot: { organizations: [{ id: ids.organization, name: "CVG", status: "ACTIVE", authorizationRevision: "1" }], counts: { units: 0, workspaces: 0, users: 0, patients: 0, auditRecords: 0, commandReceipts: 0, quarantined: 0 } } },
  EncryptedRecoveryBundle: { exportId: ids.receipt, purpose: "AUDIT_REVIEW", purposeDigest: digest, createdAt: timestamp, expiresAt: timestamp, scope: { organizationId: ids.organization, unitId: null, workspaceId: null }, manifest: { format: "CVG-RECOVERY-MANIFEST", version: 1, revision: "1", snapshotDigest: digest, eventId: ids.receipt, migrationFingerprint: digest }, envelope: { format: "CVG-RECOVERY-BUNDLE", version: 2, algorithm: "AES-256-GCM", keyRef: "cvg-recovery-key", payloadDigest: digest, expiresAt: timestamp, nonce: "AA==", ciphertext: "AQ==", authTag: "Ag==" }, receiptId: ids.receipt, replayed: false },
  RestoreResponse: { status: "QUARANTINED", loginBlocked: true, sessionsInvalidated: true, reason: "restore completed only into quarantine" },
  AgentRuntimeHealth: { status: "READY", capabilities, checkedAt: timestamp, reason: null },
  AiReadinessResponse: { ready: true, aiState: "READY", status: "READY", reason: null, checkedAt: timestamp, capabilities },
  AiSessionListResponse: { items: [{ ...session, turns: 0 }] },
  AgentTurnResult: { session, turn, draft: null, approval: null, provenance, receiptId: ids.receipt },
  AiApprovalResponse: { approval, receiptId: ids.receipt },
  AgentDraftPromotion: { draft, documentId: ids.knowledge, receiptId: ids.receipt },
  AgentReplayResult: { session, turns: [turn], digest, provenance: capabilities }
};

const expectedNames = [
  "StockListResponse", "StockMovementListResponse", "StockLocationListResponse", "ProductResponse", "LotResponse", "InventoryCountResponse", "StockMovementResponse", "BedListResponse", "HospitalEpisodeListResponse", "HospitalEpisodeResponse", "MedicationOrderListResponse", "DispensationListResponse", "AdministrationListResponse", "MedicationOrderResponse", "DispensationResponse", "AdministrationResponse", "ChargeListResponse", "ChargeResponse", "PaymentResponse", "PaymentListResponse", "LedgerListResponse", "CommunicationListResponse", "CommunicationResponse", "KnowledgeListResponse", "KnowledgeDocumentResponse", "KnowledgeSearchResponse", "KnowledgeIndexResponse", "CapabilityListResponse", "OperationsSummary", "OperationsReport", "MetricsResponse", "SnapshotResponse", "EncryptedRecoveryBundle", "RestoreResponse", "AgentRuntimeHealth", "AiReadinessResponse", "AiSessionListResponse", "AgentTurnResult", "AiApprovalResponse", "AgentDraftPromotion", "AgentReplayResult"
] as const;

test("exports exactly the assigned response-schema names", () => {
  assert.deepEqual([...remainingResponseSchemas.keys()], expectedNames);
  assert.equal(remainingResponseSchemas.size, expectedNames.length);
  for (const name of expectedNames) assert.ok(remainingResponseSchemas.get(name));
});

test("accepts live success payload shapes, receipts, nulls, empty lists and bounded pagination", () => {
  for (const name of expectedNames) {
    const result = remainingResponseSchemas.get(name)!.safeParse(validPayloads[name]);
    assert.equal(result.success, true, `${name}: ${result.success ? "" : result.error.message}`);
  }

  const communication = remainingResponseSchemas.get("CommunicationResponse")!;
  assert.equal(communication.safeParse({ message, receiptId: ids.receipt }).success, true);

  const stockMovements = remainingResponseSchemas.get("StockMovementListResponse")!;
  assert.equal(stockMovements.safeParse({ items: Array.from({ length: 200 }, () => movement) }).success, true);
  assert.equal(stockMovements.safeParse({ items: Array.from({ length: 201 }, () => movement) }).success, false);
});

test("rejects missing and unknown top-level payload fields", () => {
  const productResponse = remainingResponseSchemas.get("ProductResponse")!;
  assert.equal(productResponse.safeParse({ product }).success, false);
  assert.equal(productResponse.safeParse({ product, receiptId: ids.receipt, unexpected: true }).success, false);

  const listResponse = remainingResponseSchemas.get("StockListResponse")!;
  assert.equal(listResponse.safeParse({}).success, false);
  assert.equal(listResponse.safeParse({ items: [], cursor: "not-a-contract-field" }).success, false);
});

test("rejects unsafe/redacted fields and invalid primitive values at nested boundaries", () => {
  const productResponse = remainingResponseSchemas.get("ProductResponse")!;
  assert.equal(productResponse.safeParse({ product: { ...product, passwordDigest: "secret" }, receiptId: ids.receipt }).success, false);

  const knowledgeList = remainingResponseSchemas.get("KnowledgeListResponse")!;
  assert.equal(knowledgeList.safeParse({ items: [{ ...knowledge, content: "must not leave the list boundary" }] }).success, false);

  const movementResponse = remainingResponseSchemas.get("StockMovementResponse")!;
  assert.equal(movementResponse.safeParse({ movement: { ...movement, quantity: "5" }, receiptId: ids.receipt }).success, false);

  const metricsResponse = remainingResponseSchemas.get("MetricsResponse")!;
  assert.equal(metricsResponse.safeParse({ ...metrics, operations: { password: 1 } }).success, false);
  assert.equal(metricsResponse.safeParse({ ...metrics, requestsTotal: -1 }).success, false);
});

test("rejects representative malformed domain and AI payloads", () => {
  const report = remainingResponseSchemas.get("OperationsReport")!;
  assert.equal(report.safeParse({ kind: "operation", source, report: { appointments: {} } }).success, false);

  const turnResult = remainingResponseSchemas.get("AgentTurnResult")!;
  assert.equal(turnResult.safeParse({ ...validPayloads.AgentTurnResult as object, turn: { ...turn, inputTokens: "4" } }).success, false);
  assert.equal(turnResult.safeParse({ ...validPayloads.AgentTurnResult as object, approval: { ...approval, providerBody: "redacted" } }).success, false);

  const recovery = remainingResponseSchemas.get("EncryptedRecoveryBundle")!;
  assert.equal(recovery.safeParse({ ...validPayloads.EncryptedRecoveryBundle as object, envelope: { ...(validPayloads.EncryptedRecoveryBundle as { envelope: object }).envelope, keyRef: "secret" } }).success, true);
  assert.equal(recovery.safeParse({ ...validPayloads.EncryptedRecoveryBundle as object, envelope: { ...(validPayloads.EncryptedRecoveryBundle as { envelope: object }).envelope, ciphertext: "not base64%" } }).success, false);
});
