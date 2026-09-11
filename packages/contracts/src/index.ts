import { z } from "zod";
import { API_SCHEMA_VERSION } from "./version.js";

export { API_SCHEMA_VERSION, API_VERSION, SESSION_FORMAT_VERSION } from "./version.js";

export type OpaqueId = string & { readonly __opaqueId: unique symbol };

export function id(value: string): OpaqueId {
  return value as OpaqueId;
}

export const roles = [
  "admin",
  "veterinario",
  "recepcao",
  "operador",
  "financeiro",
  "estoque",
  "workspace_manager"
] as const;
export type Role = (typeof roles)[number];

export const scopeTypes = ["ORGANIZATION", "UNIT", "WORKSPACE"] as const;
export type ScopeType = (typeof scopeTypes)[number];

export const dataClasses = ["D0", "D1", "D2", "D3", "D4", "D5"] as const;
export type DataClass = (typeof dataClasses)[number];

export const auditResults = ["ALLOWED", "DENIED", "ERROR", "UNKNOWN"] as const;
export type AuditResult = (typeof auditResults)[number];

export const errorCodes = [
  "INVALID_INPUT",
  "UNAUTHENTICATED",
  "AUTHENTICATION_FAILED",
  "MFA_REQUIRED",
  "MFA_INVALID",
  "ACCOUNT_LOCKED",
  "CREDENTIAL_EXPIRED",
  "RECOVERY_INVALID",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "REVISION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "ASSIGNMENT_EXISTS",
  "ALREADY_REVOKED",
  "CSRF_INVALID",
  "RATE_LIMITED",
  "DEPENDENCY_UNAVAILABLE",
  "OUTCOME_UNKNOWN",
  "QUARANTINED",
  "POLICY_DENIED",
  "APPROVAL_REQUIRED",
  "APPROVAL_REPLAY",
  "BUDGET_EXCEEDED",
  "ADMISSION_IN_PROGRESS",
  "CLAIM_ABANDONED",
  "POLICY_STALE",
  "CREDENTIAL_UNAVAILABLE",
  "EGRESS_DENIED",
  "COMPOSER_CONTEXT_LOST",
  "DUPLICATE_DELIVERY",
  "INVALID_STATE",
  "CAPABILITY_DISABLED",
  "INTERNAL_ERROR"
] as const;
export type ErrorCode = (typeof errorCodes)[number];

export const domainStatuses = [
  "DRAFT",
  "ACTIVE",
  "INACTIVE",
  "CANCELLED",
  "CONFIRMED",
  "CHECKED_IN",
  "IN_PROGRESS",
  "COMPLETED",
  "REVIEW",
  "SIGNED",
  "PUBLISHED",
  "QUARANTINED",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "DISPENSED",
  "ADMINISTERED",
  "PARTIAL",
  "PAID",
  "REFUNDED",
  "RECONCILING",
  "DELIVERED",
  "FAILED"
] as const;
export type DomainStatus = (typeof domainStatuses)[number];

export const roleSchema = z.enum(roles);
export const scopeTypeSchema = z.enum(scopeTypes);
export const idSchema = z.string().uuid().transform((value) => id(value));
export const revisionSchema = z.string().regex(/^\d{1,18}$/, "revision must be a decimal string");
export const idempotencyKeySchema = z.string().trim().min(1).max(128);

export const loginInputSchema = z.object({
  login: z.string().trim().min(3).max(160),
  password: z.string().min(8).max(256)
}).strict();
export type LoginInput = z.infer<typeof loginInputSchema>;

export const challengeTokenSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{32,160}$/, "challenge token has an invalid format");
export const mfaVerificationInputSchema = z.object({
  challengeId: challengeTokenSchema,
  code: z.string().trim().regex(/^\d{6}$/, "MFA code must contain six digits")
}).strict();
export type MfaVerificationInput = z.infer<typeof mfaVerificationInputSchema>;

export const mfaEnrollmentInputSchema = z.object({
  currentPassword: z.string().min(8).max(256),
  secretRef: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,160}$/),
  code: z.string().trim().regex(/^\d{6}$/, "MFA code must contain six digits")
}).strict();
export type MfaEnrollmentInput = z.infer<typeof mfaEnrollmentInputSchema>;

export const mfaFactorRevokeInputSchema = z.object({
  currentPassword: z.string().min(8).max(256)
}).strict();
export type MfaFactorRevokeInput = z.infer<typeof mfaFactorRevokeInputSchema>;

export const recoveryStartInputSchema = z.object({
  login: z.string().trim().min(3).max(160)
}).strict();
export type RecoveryStartInput = z.infer<typeof recoveryStartInputSchema>;

export const recoveryCompleteInputSchema = z.object({
  challengeId: challengeTokenSchema,
  recoveryCode: z.string().trim().min(8).max(80),
  newPassword: z.string().min(12).max(256)
}).strict();
export type RecoveryCompleteInput = z.infer<typeof recoveryCompleteInputSchema>;

export const passwordRotationInputSchema = z.object({
  currentPassword: z.string().min(8).max(256),
  newPassword: z.string().min(12).max(256)
}).strict();
export type PasswordRotationInput = z.infer<typeof passwordRotationInputSchema>;

export const contextSelectorSchema = z.object({
  unitId: idSchema.nullable().default(null),
  workspaceId: idSchema.nullable().default(null)
}).strict();
export type ContextSelector = z.infer<typeof contextSelectorSchema>;

export const roleAssignmentInputSchema = z.object({
  userId: idSchema,
  role: roleSchema,
  scopeType: z.enum(["UNIT", "WORKSPACE"]),
  unitId: idSchema.nullable().default(null),
  workspaceId: idSchema.nullable().default(null),
  expectedRevision: revisionSchema
}).strict().superRefine((value, ctx) => {
  if (value.scopeType === "UNIT" && !value.unitId) {
    ctx.addIssue({ code: "custom", path: ["unitId"], message: "unitId is required for UNIT scope" });
  }
  if (value.scopeType === "WORKSPACE" && (!value.unitId || !value.workspaceId)) {
    ctx.addIssue({ code: "custom", path: ["workspaceId"], message: "unitId and workspaceId are required for WORKSPACE scope" });
  }
  if (value.scopeType === "UNIT" && value.workspaceId) {
    ctx.addIssue({ code: "custom", path: ["workspaceId"], message: "workspaceId is forbidden for UNIT scope" });
  }
});
export type RoleAssignmentInput = z.infer<typeof roleAssignmentInputSchema>;

export const guardianInputSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(40),
  email: z.string().email().nullable().default(null)
}).strict();

export type GuardianInput = z.infer<typeof guardianInputSchema>;

export const patientInputSchema = z.object({
  guardianId: idSchema,
  name: z.string().trim().min(1).max(120),
  species: z.string().trim().min(1).max(80),
  breed: z.string().trim().max(100).nullable().default(null),
  sex: z.enum(["FEMALE", "MALE", "UNKNOWN"]).default("UNKNOWN"),
  reproductiveStatus: z.enum(["INTACT", "NEUTERED", "UNKNOWN"]).default("UNKNOWN"),
  birthDate: z.string().date().nullable().default(null),
  identifiers: z.array(z.string().trim().min(1).max(80)).max(8).default([])
}).strict();
export type PatientInput = z.infer<typeof patientInputSchema>;

export const patientMergeInputSchema = z.object({
  sourcePatientId: idSchema,
  targetPatientId: idSchema,
  reason: z.string().trim().min(5).max(500),
  confirmation: z.literal("MERGE_PATIENTS")
}).strict().superRefine((value, ctx) => {
  if (value.sourcePatientId === value.targetPatientId) ctx.addIssue({ code: "custom", path: ["targetPatientId"], message: "sourcePatientId and targetPatientId must differ" });
});
export type PatientMergeInput = z.infer<typeof patientMergeInputSchema>;

export const appointmentInputSchema = z.object({
  patientId: idSchema,
  providerId: idSchema,
  resourceId: idSchema.nullable().optional(),
  serviceId: idSchema,
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  purpose: z.string().trim().min(2).max(240)
}).strict().superRefine((value, ctx) => {
  if (new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()) {
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "endsAt must be after startsAt" });
  }
});
export type AppointmentInput = z.infer<typeof appointmentInputSchema>;

export const encounterInputSchema = z.object({
  patientId: idSchema,
  appointmentId: idSchema.nullable().default(null),
  chiefComplaint: z.string().trim().min(2).max(500),
  urgency: z.enum(["ROUTINE", "URGENT", "EMERGENCY"]).default("ROUTINE")
}).strict();
export type EncounterInput = z.infer<typeof encounterInputSchema>;

export const clinicalDocumentInputSchema = z.object({
  encounterId: idSchema,
  documentType: z.enum(["EVOLUTION", "TRIAGE", "DISCHARGE", "PRESCRIPTION", "REPORT"]),
  title: z.string().trim().min(2).max(180),
  content: z.string().trim().min(1).max(30_000),
  dataClass: z.enum(["D2", "D3"]).default("D3")
}).strict();
export type ClinicalDocumentInput = z.infer<typeof clinicalDocumentInputSchema>;

export const clinicalSignInputSchema = z.object({
  expectedVersion: revisionSchema
}).strict();
export type ClinicalSignInput = z.infer<typeof clinicalSignInputSchema>;

export const diagnosticRequestInputSchema = z.object({
  patientId: idSchema,
  encounterId: idSchema.nullable().default(null),
  testName: z.string().trim().min(2).max(180),
  priority: z.enum(["ROUTINE", "URGENT", "STAT"]).default("ROUTINE")
}).strict();
export type DiagnosticRequestInput = z.infer<typeof diagnosticRequestInputSchema>;

export const resultInputSchema = z.object({
  requestId: idSchema,
  specimenId: idSchema,
  value: z.string().trim().min(1).max(20_000),
  source: z.string().trim().min(1).max(160),
  externalOrderId: z.string().trim().max(160).nullable().default(null),
  sourceVersion: z.string().trim().max(80).default("synthetic-1")
}).strict();
export type ResultInput = z.infer<typeof resultInputSchema>;

export const specimenInputSchema = z.object({
  label: z.string().trim().min(2).max(160)
}).strict();
export type SpecimenInput = z.infer<typeof specimenInputSchema>;

export const hospitalEpisodeInputSchema = z.object({
  patientId: idSchema,
  encounterId: idSchema.nullable().default(null),
  bedId: idSchema.nullable().default(null)
}).strict();
export type HospitalEpisodeInput = z.infer<typeof hospitalEpisodeInputSchema>;

export const medicationOrderInputSchema = z.object({
  patientId: idSchema,
  encounterId: idSchema.nullable().default(null),
  productId: idSchema,
  dose: z.string().trim().min(1).max(120),
  route: z.string().trim().min(1).max(80),
  frequency: z.string().trim().min(1).max(120)
}).strict();
export type MedicationOrderInput = z.infer<typeof medicationOrderInputSchema>;

export const dispensationInputSchema = z.object({
  medicationOrderId: idSchema,
  lotId: idSchema,
  quantity: z.number().int().positive().max(1_000_000)
}).strict();
export type DispensationInput = z.infer<typeof dispensationInputSchema>;

export const administrationInputSchema = z.object({
  medicationOrderId: idSchema,
  status: z.enum(["ADMINISTERED", "OMITTED", "REFUSED"]),
  note: z.string().trim().max(500).nullable().default(null)
}).strict();
export type AdministrationInput = z.infer<typeof administrationInputSchema>;

export const stockMovementInputSchema = z.object({
  productId: idSchema,
  lotId: idSchema,
  locationId: idSchema,
  quantity: z.number().int().positive().max(1_000_000),
  movementType: z.enum(["RECEIPT", "DISPENSE", "TRANSFER_IN", "TRANSFER_OUT", "RETURN", "ADJUSTMENT"]),
  reason: z.string().trim().min(3).max(240),
  referenceId: idSchema.nullable().default(null)
}).strict();
export type StockMovementInput = z.infer<typeof stockMovementInputSchema>;

export const chargeInputSchema = z.object({
  patientId: idSchema.nullable().default(null),
  description: z.string().trim().min(2).max(240),
  amountCents: z.number().int().positive().max(100_000_000),
  currency: z.string().length(3).default("BRL")
}).strict();
export type ChargeInput = z.infer<typeof chargeInputSchema>;

export const paymentInputSchema = z.object({
  chargeId: idSchema,
  amountCents: z.number().int().positive().max(100_000_000),
  method: z.enum(["PIX", "CARD", "CASH", "TRANSFER"]),
  externalReference: z.string().trim().max(160).nullable().default(null)
}).strict();
export type PaymentInput = z.infer<typeof paymentInputSchema>;

export const refundInputSchema = z.object({
  paymentId: idSchema,
  reason: z.string().trim().min(5).max(500)
}).strict();
export type RefundInput = z.infer<typeof refundInputSchema>;

export const knowledgeDocumentInputSchema = z.object({
  title: z.string().trim().min(2).max(180),
  source: z.string().trim().min(2).max(240),
  dataClass: z.enum(["D0", "D1", "D2"]),
  content: z.string().trim().min(1).max(50_000)
}).strict();
export type KnowledgeDocumentInput = z.infer<typeof knowledgeDocumentInputSchema>;

export const governedExportPurposes = ["INCIDENT_RECOVERY", "AUDIT_REVIEW", "MIGRATION_VALIDATION", "LEGAL_HOLD"] as const;
export type GovernedExportPurpose = (typeof governedExportPurposes)[number];

/** D4 exports are whole-organization recovery bundles.  A unit/workspace
 * selector must never be accepted and then silently ignored by persistence. */
export const governedExportInputSchema = z.object({
  purpose: z.enum(governedExportPurposes),
  scopeType: z.literal("ORGANIZATION").default("ORGANIZATION"),
  ttlSeconds: z.number().int().min(60).max(86_400).default(3_600)
}).strict();
export type GovernedExportInput = z.infer<typeof governedExportInputSchema>;

export const aiTurnInputSchema = z.object({
  sessionId: idSchema.nullable().default(null),
  prompt: z.string().trim().min(1).max(8_000),
  purpose: z.enum(["SUMMARY", "DRAFT_CLINICAL", "KNOWLEDGE_QUERY", "OPERATIONS"]),
  patientId: idSchema.nullable().default(null),
  encounterId: idSchema.nullable().default(null),
  resourceId: idSchema.nullable().optional(),
  requestedTool: z.string().trim().max(120).nullable().default(null),
  approvalId: idSchema.nullable().default(null),
  idempotencyKey: idempotencyKeySchema
}).strict();
export type AiTurnInput = z.infer<typeof aiTurnInputSchema>;

/**
 * Versioned wire schemas for a persisted AI turn.  The bridge and every
 * provider adapter must use this same schema so durable provenance/usage
 * fields cannot be silently dropped at an HTTP or process boundary.
 */
export const aiTurnReferenceSchema = z.object({
  title: z.string().max(500),
  source: z.string().max(2_000)
}).strict();

/** Transport IDs are opaque to the bridge; domain boundaries validate UUIDs
 * where a persisted CVG identifier is required. */
export const aiWireIdSchema = z.string().trim().min(1).max(200).transform((value) => id(value));

export const aiTurnProvenanceSchema = z.object({
  provider: z.string().trim().min(1).max(160),
  engineCommit: z.string().trim().min(1).max(200),
  manifestVersion: z.string().trim().min(1).max(200),
  profileDigest: z.string().trim().min(1).max(256),
  policyRevision: z.string().trim().min(1).max(160),
  references: z.array(aiTurnReferenceSchema).max(128),
  referencesDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  correlationId: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
  usageRecordId: aiWireIdSchema.optional()
}).strict();

export const aiUsageCostSchema = z.object({
  amountMicros: z.number().int().nonnegative().nullable(),
  currency: z.string().length(3).nullable(),
  source: z.enum(["LOCAL_SYNTHETIC", "PROVIDER", "UNAVAILABLE"]),
  pricingRevision: z.string().trim().min(1).max(160).nullable()
}).strict();

/**
 * Accounting facts travel with the usage ledger instead of being inferred
 * later from an AI turn.  A missing provider price is explicit and cannot be
 * mistaken for a zero-cost settlement.
 */
export const aiUsageSettlementSchema = z.object({
  model: z.string().trim().min(1).max(200),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  providerResponseDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  estimatedCost: aiUsageCostSchema,
  actualCost: aiUsageCostSchema,
  discrepancy: z.object({
    status: z.enum(["NOT_EVALUATED", "MATCHED", "MISMATCH"]),
    deltaMicros: z.number().int().nullable(),
    reason: z.string().trim().max(240).nullable()
  }).strict()
}).strict();

export type AiUsageCost = z.infer<typeof aiUsageCostSchema>;
export type AiUsageSettlement = z.infer<typeof aiUsageSettlementSchema>;

export const aiTurnUsageSchema = z.object({
  id: aiWireIdSchema,
  reservationId: aiWireIdSchema.nullable(),
  providerRequestId: z.string().max(512).nullable(),
  idempotencyKey: z.string().trim().min(1).max(256),
  usageKind: z.string().trim().min(1).max(160),
  reservedUnits: z.number().int().nonnegative(),
  consumedUnits: z.number().int().nonnegative(),
  status: z.enum(["RECEIVED", "SETTLED", "RECONCILIATION_REQUIRED", "QUARANTINED"]),
  record: z.record(z.string(), z.unknown()),
  settlement: aiUsageSettlementSchema.optional()
}).strict();

export const aiTurnWireSchema = z.object({
  id: aiWireIdSchema,
  sessionId: aiWireIdSchema,
  prompt: z.string().max(8_000),
  response: z.string().nullable(),
  status: z.enum(["RECEIVED", "DENIED", "COMPLETED", "QUARANTINED", "OUTCOME_UNKNOWN"]),
  model: z.string().trim().min(1).max(200),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  references: z.array(aiTurnReferenceSchema).max(128),
  provenance: aiTurnProvenanceSchema.optional(),
  usage: aiTurnUsageSchema.optional(),
  createdAt: z.string().datetime({ offset: true })
}).strict();

export const approvalInputSchema = z.object({
  decision: z.enum(["allowed-once", "rejected"]),
  reason: z.string().trim().max(500).nullable().default(null)
}).strict();
export type ApprovalInput = z.infer<typeof approvalInputSchema>;

export const communicationApprovalInputSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().max(500).nullable().default(null)
}).strict();
export type CommunicationApprovalInput = z.infer<typeof communicationApprovalInputSchema>;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/, "digest must be a sha-256 hex string");
const correlationSchema = z.string().regex(/^[A-Za-z0-9._-]{1,80}$/, "correlationId must be bounded and transport-safe");

export const integrationInboxEventSchema = z.object({
  organizationId: idSchema,
  consumer: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,120}$/),
  provider: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,120}$/),
  externalEventId: z.string().trim().min(1).max(240),
  eventType: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,160}$/),
  schemaVersion: z.literal(API_SCHEMA_VERSION),
  payload: z.record(z.string(), z.unknown())
}).strict();
export type IntegrationInboxEventInput = z.infer<typeof integrationInboxEventSchema>;

export const externalEffectReconciliationInputSchema = z.object({
  status: z.enum(["SUCCEEDED", "FAILED_FINAL", "QUARANTINED"]),
  providerRequestId: z.string().trim().max(240).nullable(),
  response: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().trim().max(2_000).nullable().default(null),
  source: z.enum(["SYNTHETIC_PROVIDER_QUERY", "PROVIDER_QUERY", "MANUAL_REVIEW"]),
  observedAt: z.string().datetime({ offset: true }),
  queryDigest: digestSchema
}).strict();
export type ExternalEffectReconciliationInput = z.infer<typeof externalEffectReconciliationInputSchema>;

export const contractDescriptorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  version: z.string().trim().regex(/^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/),
  schemaVersion: z.number().int().positive(),
  compatibility: z.enum(["BACKWARD_COMPATIBLE", "BREAKING", "EXPERIMENTAL"]),
  owner: z.string().trim().min(1).max(120),
  digest: digestSchema
}).strict();
export type ContractDescriptor = z.infer<typeof contractDescriptorSchema>;

export const commandEnvelopeSchema = z.object({
  schemaVersion: z.literal(API_SCHEMA_VERSION),
  commandId: idSchema,
  actionId: idSchema,
  commandType: z.string().trim().min(1).max(160),
  actorId: idSchema,
  organizationId: idSchema,
  unitId: idSchema.nullable().default(null),
  workspaceId: idSchema.nullable().default(null),
  resourceType: z.string().trim().min(1).max(120),
  resourceId: idSchema.nullable().default(null),
  expectedVersion: revisionSchema.nullable().default(null),
  purpose: z.string().trim().min(1).max(160),
  normalizedArgsDigest: digestSchema,
  policyRevision: z.string().trim().min(1).max(120),
  idempotencyKey: idempotencyKeySchema,
  budgetReservationId: idSchema.nullable().default(null),
  approvalBindingId: idSchema.nullable().default(null),
  parentActionId: idSchema.nullable().default(null),
  egressIntent: z.enum(["NONE", "LOCAL_ONLY", "EXTERNAL_PROVIDER"]).default("NONE"),
  deadline: z.string().datetime({ offset: true }),
  payload: z.unknown()
}).strict();
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;

export const domainEventSchema = z.object({
  schemaVersion: z.literal(API_SCHEMA_VERSION),
  eventId: idSchema,
  eventType: z.string().trim().min(1).max(160),
  aggregateType: z.string().trim().min(1).max(120),
  aggregateId: idSchema.nullable().default(null),
  organizationId: idSchema.nullable().default(null),
  correlationId: correlationSchema,
  causationId: idSchema.nullable().default(null),
  occurredAt: z.string().datetime({ offset: true }),
  payloadDigest: digestSchema,
  payload: z.unknown()
}).strict();
export type DomainEvent = z.infer<typeof domainEventSchema>;

export interface Organization {
  id: OpaqueId;
  name: string;
  slug: string;
  status: "ACTIVE" | "QUARANTINED";
  authorizationRevision: bigint;
  createdAt: string;
}

export interface Unit {
  id: OpaqueId;
  organizationId: OpaqueId;
  name: string;
  code: string;
  status: "ACTIVE" | "INACTIVE";
}

export interface Workspace {
  id: OpaqueId;
  organizationId: OpaqueId;
  unitId: OpaqueId;
  name: string;
  purpose: string;
  status: "ACTIVE" | "INACTIVE";
}

export interface User {
  id: OpaqueId;
  organizationId: OpaqueId;
  login: string;
  displayName: string;
  email: string;
  status: "ACTIVE" | "DISABLED";
  passwordDigest: string;
  lastLoginAt: string | null;
  security: AuthSecurityState;
  createdAt: string;
}

export interface AuthSecurityState {
  passwordChangedAt: string | null;
  passwordExpiresAt: string | null;
  credentialVersion: number;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  mfaRequired: boolean;
  mfaSecretRef: string | null;
  recoveryCodeDigests: string[];
  recoveryCodesIssuedAt: string | null;
}

export interface RoleAssignment {
  id: OpaqueId;
  organizationId: OpaqueId;
  userId: OpaqueId;
  role: Role;
  scopeType: ScopeType;
  unitId: OpaqueId | null;
  workspaceId: OpaqueId | null;
  grantedAt: string;
  revokedAt: string | null;
}

export interface Session {
  id: OpaqueId;
  tokenDigest: string;
  userId: OpaqueId;
  organizationId: OpaqueId;
  csrfToken: string;
  expiresAt: string;
  revokedAt: string | null;
  deviceIdDigest: string | null;
  userAgentDigest: string | null;
  ipDigest: string | null;
  lastSeenAt: string;
  mfaVerifiedAt: string | null;
  credentialVersion: number;
  createdAt: string;
}

export type AuthChallengeType = "MFA" | "RECOVERY";
export type AuthChallengeStatus = "PENDING" | "CONSUMED" | "LOCKED" | "EXPIRED";

export interface AuthChallenge {
  id: OpaqueId;
  type: AuthChallengeType;
  tokenDigest: string;
  userId: OpaqueId;
  organizationId: OpaqueId;
  credentialVersion: number;
  expiresAt: string;
  attempts: number;
  maxAttempts: number;
  status: AuthChallengeStatus;
  consumedAt: string | null;
  createdAt: string;
}

export interface CvgContext {
  organizationId: OpaqueId;
  unitId: OpaqueId | null;
  workspaceId: OpaqueId | null;
  actorId: OpaqueId;
  sessionId: OpaqueId | null;
  actorRoleSnapshot: Role[];
  patientId: OpaqueId | null;
  encounterId: OpaqueId | null;
  purpose: string;
  policyRevision: string;
  correlationId: string;
}

export interface AuditRecord {
  id: OpaqueId;
  organizationId: OpaqueId;
  actorId: OpaqueId | null;
  unitId: OpaqueId | null;
  workspaceId: OpaqueId | null;
  action: string;
  resourceType: string;
  resourceId: OpaqueId | null;
  result: AuditResult;
  reason: string | null;
  correlationId: string;
  metadata: Record<string, string | number | boolean | null>;
  chainVersion: 2;
  previousHash: string | null;
  recordHash: string;
  createdAt: string;
}

export interface CommandReceipt {
  id: OpaqueId;
  organizationId: OpaqueId;
  actorId: OpaqueId;
  unitId: OpaqueId | null;
  workspaceId: OpaqueId | null;
  auditRecordId: OpaqueId | null;
  operation: string;
  idempotencyLookup: string;
  bodyDigest: string;
  status: "IN_FLIGHT" | "SUCCEEDED" | "FAILED" | "OUTCOME_UNKNOWN";
  result: unknown;
  createdAt: string;
  completedAt: string | null;
}

export interface Guardian {
  id: OpaqueId;
  organizationId: OpaqueId;
  /** Registration scope; derived from the authenticated context, never client input. */
  unitId: OpaqueId | null;
  workspaceId: OpaqueId | null;
  displayName: string;
  phone: string;
  email: string | null;
  dataClass: "D2";
  status: "ACTIVE" | "INACTIVE";
}

export interface AnimalPatient {
  id: OpaqueId;
  organizationId: OpaqueId;
  /** Home/access scope; derived from the authenticated context, never client input. */
  unitId: OpaqueId | null;
  workspaceId: OpaqueId | null;
  guardianId: OpaqueId;
  name: string;
  species: string;
  breed: string | null;
  sex: "FEMALE" | "MALE" | "UNKNOWN";
  reproductiveStatus: "INTACT" | "NEUTERED" | "UNKNOWN";
  birthDate: string | null;
  identifiers: string[];
  dataClass: "D3";
  status: "ACTIVE" | "INACTIVE" | "MERGED";
  mergedIntoId: OpaqueId | null;
  statusChangedAt: string | null;
  createdAt: string;
}

export interface Provider {
  id: OpaqueId;
  organizationId: OpaqueId;
  displayName: string;
  specialty: string;
  role: "veterinario" | "tecnico";
  unitId: OpaqueId;
  status: "ACTIVE" | "INACTIVE";
}

export interface ServiceCatalogItem {
  id: OpaqueId;
  organizationId: OpaqueId;
  name: string;
  durationMinutes: number;
  priceCents: number;
  status: "ACTIVE" | "INACTIVE";
}

export interface Resource {
  id: OpaqueId;
  organizationId: OpaqueId;
  unitId: OpaqueId;
  name: string;
  kind: "ROOM" | "EQUIPMENT" | "BED";
  status: "ACTIVE" | "INACTIVE";
}

export interface Appointment {
  id: OpaqueId;
  organizationId: OpaqueId;
  unitId: OpaqueId;
  workspaceId: OpaqueId;
  patientId: OpaqueId;
  providerId: OpaqueId;
  resourceId: OpaqueId | null;
  serviceId: OpaqueId;
  startsAt: string;
  endsAt: string;
  purpose: string;
  status: "SCHEDULED" | "CONFIRMED" | "CHECKED_IN" | "CANCELLED" | "COMPLETED";
  version: number;
  createdAt: string;
}

export interface QueueEntry {
  id: OpaqueId;
  organizationId: OpaqueId;
  unitId: OpaqueId;
  appointmentId: OpaqueId | null;
  patientId: OpaqueId;
  status: "WAITING" | "TRIAGE" | "IN_SERVICE" | "DONE" | "CANCELLED";
  priority: "ROUTINE" | "URGENT" | "EMERGENCY";
  checkedInAt: string;
}

export interface Encounter {
  id: OpaqueId;
  organizationId: OpaqueId;
  unitId: OpaqueId;
  workspaceId: OpaqueId;
  patientId: OpaqueId;
  appointmentId: OpaqueId | null;
  chiefComplaint: string;
  urgency: "ROUTINE" | "URGENT" | "EMERGENCY";
  status: "OPEN" | "IN_PROGRESS" | "SIGNED" | "CLOSED";
  openedAt: string;
  closedAt: string | null;
}

export interface ClinicalDocument {
  id: OpaqueId;
  organizationId: OpaqueId;
  encounterId: OpaqueId;
  patientId: OpaqueId;
  authorId: OpaqueId;
  documentType: "EVOLUTION" | "TRIAGE" | "DISCHARGE" | "PRESCRIPTION" | "REPORT";
  title: string;
  content: string;
  dataClass: "D2" | "D3";
  status: "DRAFT" | "REVIEW" | "SIGNED" | "PUBLISHED";
  version: number;
  signedAt: string | null;
  signedBy: OpaqueId | null;
  createdAt: string;
}

export interface ClinicalAddendum {
  id: OpaqueId;
  documentId: OpaqueId;
  authorId: OpaqueId;
  reason: string;
  content: string;
  createdAt: string;
}

export interface DiagnosticRequest {
  id: OpaqueId;
  organizationId: OpaqueId;
  patientId: OpaqueId;
  encounterId: OpaqueId | null;
  testName: string;
  priority: "ROUTINE" | "URGENT" | "STAT";
  status: "REQUESTED" | "SPECIMEN_COLLECTED" | "RESULTED" | "REVIEWED" | "CANCELLED";
  requestedBy: OpaqueId;
  createdAt: string;
}

export interface Specimen {
  id: OpaqueId;
  organizationId: OpaqueId;
  requestId: OpaqueId;
  patientId: OpaqueId;
  label: string;
  collectedAt: string;
  status: "COLLECTED" | "RECEIVED" | "REJECTED";
}

export interface DiagnosticResult {
  id: OpaqueId;
  organizationId: OpaqueId;
  requestId: OpaqueId;
  specimenId: OpaqueId;
  patientId: OpaqueId;
  value: string;
  source: string;
  sourceVersion: string;
  status: "RECEIVED" | "QUARANTINED" | "VALID" | "REJECTED";
  createdAt: string;
}

export interface HospitalEpisode {
  id: OpaqueId;
  organizationId: OpaqueId;
  unitId: OpaqueId;
  patientId: OpaqueId;
  encounterId: OpaqueId | null;
  bedId: OpaqueId | null;
  status: "PLANNED" | "ADMITTED" | "PROCEDURE" | "RECOVERY" | "DISCHARGED";
  admittedAt: string | null;
  dischargedAt: string | null;
}

export interface Bed {
  id: OpaqueId;
  organizationId: OpaqueId;
  unitId: OpaqueId;
  name: string;
  status: "AVAILABLE" | "OCCUPIED" | "MAINTENANCE";
}

export interface CareTask {
  id: OpaqueId;
  organizationId: OpaqueId;
  episodeId: OpaqueId;
  title: string;
  dueAt: string;
  assignedTo: OpaqueId | null;
  status: "PENDING" | "IN_PROGRESS" | "DONE" | "MISSED";
}

export interface MedicationOrder {
  id: OpaqueId;
  organizationId: OpaqueId;
  patientId: OpaqueId;
  encounterId: OpaqueId | null;
  productId: OpaqueId;
  dose: string;
  route: string;
  frequency: string;
  status: "DRAFT" | "ACTIVE" | "SUSPENDED" | "COMPLETED";
  prescribedBy: OpaqueId;
}

export interface Dispensation {
  id: OpaqueId;
  organizationId: OpaqueId;
  medicationOrderId: OpaqueId;
  lotId: OpaqueId;
  quantity: number;
  dispensedBy: OpaqueId;
  createdAt: string;
}

export interface AdministrationOccurrence {
  id: OpaqueId;
  organizationId: OpaqueId;
  medicationOrderId: OpaqueId;
  administeredBy: OpaqueId;
  administeredAt: string;
  status: "ADMINISTERED" | "OMITTED" | "REFUSED";
  note: string | null;
}

export interface Product {
  id: OpaqueId;
  organizationId: OpaqueId;
  sku: string;
  name: string;
  category: string;
  unit: string;
  reorderPoint: number;
  status: "ACTIVE" | "INACTIVE";
}

export interface Lot {
  id: OpaqueId;
  organizationId: OpaqueId;
  productId: OpaqueId;
  lotNumber: string;
  expiresOn: string;
  quantity: number;
  locationId: OpaqueId;
  status: "AVAILABLE" | "EXPIRED" | "BLOCKED";
}

export interface StockLocation {
  id: OpaqueId;
  organizationId: OpaqueId;
  unitId: OpaqueId;
  name: string;
}

export interface StockMovement {
  id: OpaqueId;
  organizationId: OpaqueId;
  productId: OpaqueId;
  lotId: OpaqueId;
  locationId: OpaqueId;
  quantity: number;
  movementType: z.infer<typeof stockMovementInputSchema>["movementType"];
  reason: string;
  referenceId: OpaqueId | null;
  createdBy: OpaqueId;
  createdAt: string;
}

export interface Charge {
  id: OpaqueId;
  organizationId: OpaqueId;
  unitId: OpaqueId | null;
  patientId: OpaqueId | null;
  description: string;
  amountCents: number;
  currency: string;
  status: "OPEN" | "PARTIALLY_PAID" | "PAID" | "REFUNDED";
  createdAt: string;
}

export interface Payment {
  id: OpaqueId;
  organizationId: OpaqueId;
  chargeId: OpaqueId;
  amountCents: number;
  method: z.infer<typeof paymentInputSchema>["method"];
  externalReference: string | null;
  status: "PENDING" | "SETTLED" | "UNKNOWN" | "REFUNDED";
  createdAt: string;
}

export interface LedgerEntry {
  id: OpaqueId;
  organizationId: OpaqueId;
  kind: "CHARGE" | "PAYMENT" | "REFUND" | "ADJUSTMENT";
  referenceId: OpaqueId;
  amountCents: number;
  currency: string;
  description: string;
  createdAt: string;
}

export interface CommunicationMessage {
  id: OpaqueId;
  organizationId: OpaqueId;
  unitId: OpaqueId | null;
  workspaceId: OpaqueId | null;
  patientId: OpaqueId | null;
  channel: "SMS" | "EMAIL" | "WHATSAPP";
  recipient: string;
  template: string;
  body: string;
  status: "STAGED" | "APPROVAL_REQUIRED" | "QUEUED" | "SENT" | "FAILED";
  /** Provenance fields are optional for backwards-compatible snapshots; new messages always populate them. */
  createdBy?: OpaqueId;
  decidedBy?: OpaqueId;
  decidedAt?: string;
  approvedBy?: OpaqueId;
  approvedAt?: string;
  decisionReason?: string | null;
  createdAt: string;
}

export interface KnowledgeDocument {
  id: OpaqueId;
  organizationId: OpaqueId;
  unitId: OpaqueId | null;
  workspaceId: OpaqueId | null;
  title: string;
  source: string;
  dataClass: DataClass;
  version: number;
  status: "DRAFT" | "APPROVED" | "INDEXING" | "INDEXED" | "QUARANTINED";
  content: string;
  createdAt: string;
}

export interface AiSession {
  id: OpaqueId;
  organizationId: OpaqueId;
  actorId: OpaqueId;
  unitId: OpaqueId | null;
  workspaceId: OpaqueId | null;
  patientId: OpaqueId | null;
  encounterId: OpaqueId | null;
  purpose: z.infer<typeof aiTurnInputSchema>["purpose"];
  engineCommit: string;
  profileDigest: string;
  status: "ACTIVE" | "CLOSED" | "QUARANTINED";
  createdAt: string;
}

export type AiUsageStatus = "RECEIVED" | "SETTLED" | "RECONCILIATION_REQUIRED" | "QUARANTINED";

export interface AiTurnUsage {
  id: OpaqueId;
  reservationId: OpaqueId | null;
  providerRequestId: string | null;
  idempotencyKey: string;
  usageKind: string;
  reservedUnits: number;
  consumedUnits: number;
  status: AiUsageStatus;
  record: Record<string, unknown>;
  settlement?: AiUsageSettlement;
}

export interface AiTurnProvenance {
  provider: string;
  engineCommit: string;
  manifestVersion: string;
  profileDigest: string;
  policyRevision: string;
  references: Array<{ title: string; source: string }>;
  referencesDigest?: string;
  correlationId: string;
  usageRecordId?: OpaqueId;
}

export interface AiTurn {
  id: OpaqueId;
  sessionId: OpaqueId;
  prompt: string;
  response: string | null;
  status: "RECEIVED" | "DENIED" | "COMPLETED" | "QUARANTINED" | "OUTCOME_UNKNOWN";
  model: string;
  inputTokens: number;
  outputTokens: number;
  references: Array<{ title: string; source: string }>;
  /** New application-bound turns persist the exact evidence and usage link. */
  provenance?: AiTurnProvenance;
  usage?: AiTurnUsage;
  createdAt: string;
}

export interface AiDraft {
  id: OpaqueId;
  sessionId: OpaqueId;
  encounterId: OpaqueId | null;
  draftType: "CLINICAL_NOTE" | "SUMMARY" | "MESSAGE";
  content: string;
  sourceTurnId: OpaqueId;
  status: "DRAFT" | "REVIEWED" | "REJECTED" | "PROMOTED";
  createdAt: string;
}

export interface AiApproval {
  id: OpaqueId;
  organizationId: OpaqueId;
  actorId: OpaqueId;
  sessionId: OpaqueId;
  turnId: OpaqueId;
  toolName: string;
  resourceId: OpaqueId | null;
  patientId: OpaqueId | null;
  encounterId: OpaqueId | null;
  unitId: OpaqueId | null;
  workspaceId: OpaqueId | null;
  purpose: z.infer<typeof aiTurnInputSchema>["purpose"];
  requestDigest: string;
  policyRevision: string;
  expiresAt: string;
  decision: "allowed-once" | "rejected" | "unavailable" | "consumed";
  decidedBy: OpaqueId | null;
  reason: string | null;
  createdAt: string;
}

export interface BudgetReservation {
  id: OpaqueId;
  organizationId: OpaqueId;
  sessionId: OpaqueId;
  category: "TOKENS" | "MEDIA" | "TRANSCRIPTION" | "INTEGRATION";
  reservedUnits: number;
  consumedUnits: number;
  status: "RESERVED" | "RELEASED" | "EXHAUSTED";
  createdAt: string;
}

export interface CvgMetrics {
  requestsTotal: number;
  requestsDenied: number;
  requestsError: number;
  latencyMs: { p50: number; p95: number; p99: number };
  activeSessions: number;
  agentRuntime: "READY" | "DEGRADED" | "UNAVAILABLE" | "DISABLED";
  storageMode: "memory" | "postgres";
  operations: Record<string, number>;
  statusCodes: Record<string, number>;
  dependencies: {
    database: "READY" | "UNAVAILABLE" | "NOT_CONFIGURED" | "DEGRADED";
    policyStore: "READY" | "UNAVAILABLE" | "NOT_CONFIGURED" | "DEGRADED";
    secretProvider: "READY" | "UNAVAILABLE" | "NOT_CONFIGURED" | "DEGRADED";
    outbox: "READY" | "UNAVAILABLE" | "NOT_CONFIGURED" | "DEGRADED";
    auditLedger: "READY" | "UNAVAILABLE" | "NOT_CONFIGURED" | "DEGRADED";
  };
  domain: {
    auditRecords: number;
    commandReceipts: number;
    unlinkedReceipts: number;
    outcomeUnknown: number;
    quarantined: number;
  };
  queues: {
    outboxDepth: number;
    oldestAgeMs: number;
    poisonMessages: number;
    reconciliationLag: number;
    /** Age of the oldest worker heartbeat observed for the scoped organization. */
    workerHeartbeatAgeMs?: number;
    /** Number of durable worker heartbeat records observed for the scoped organization. */
    workerHeartbeatCount?: number;
  };
  telemetry: { mode: "REDACTED_BEST_EFFORT" | "OTEL_OTLP_REDACTED"; logsStored: number; dropped: number; duplicates: number };
}

export interface ApiSuccess<T> {
  schemaVersion: typeof API_SCHEMA_VERSION;
  data: T;
  correlationId: string;
}

export interface ApiErrorBody {
  schemaVersion: typeof API_SCHEMA_VERSION;
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
  correlationId: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorBody;

export function success<T>(data: T, correlationId: string): ApiSuccess<T> {
  return { schemaVersion: API_SCHEMA_VERSION, data, correlationId };
}

export function failure(code: ErrorCode, message: string, correlationId: string, details?: Record<string, unknown>): ApiErrorBody {
  const error: ApiErrorBody["error"] = { code, message };
  if (details) error.details = details;
  return { schemaVersion: API_SCHEMA_VERSION, error, correlationId };
}

export function isApiError(value: unknown): value is ApiErrorBody {
  return typeof value === "object" && value !== null && "error" in value;
}

/**
 * Canonical ownership for every business collection in StoreSnapshot.  The
 * registry lives in contracts so the in-memory domain validator and the
 * PostgreSQL projector cannot silently diverge about which collections have
 * an authoritative normalized owner.
 */
export const AUTHORITATIVE_DOMAIN_REGISTRY = [
  { snapshotKey: "guardians", table: "guardians", scope: "contextual" },
  { snapshotKey: "patients", table: "patients", scope: "contextual" },
  { snapshotKey: "providers", table: "providers", scope: "unit" },
  { snapshotKey: "services", table: "service_catalog_items", scope: "organization" },
  { snapshotKey: "resources", table: "resources", scope: "unit" },
  { snapshotKey: "appointments", table: "appointments", scope: "contextual" },
  { snapshotKey: "queueEntries", table: "queue_entries", scope: "unit" },
  { snapshotKey: "encounters", table: "encounters", scope: "contextual" },
  { snapshotKey: "clinicalDocuments", table: "clinical_documents", scope: "contextual" },
  { snapshotKey: "clinicalAddenda", table: "clinical_addenda", scope: "organization" },
  { snapshotKey: "diagnosticRequests", table: "diagnostic_requests", scope: "contextual" },
  { snapshotKey: "specimens", table: "specimens", scope: "contextual" },
  { snapshotKey: "diagnosticResults", table: "diagnostic_results", scope: "contextual" },
  { snapshotKey: "beds", table: "beds", scope: "unit" },
  { snapshotKey: "hospitalEpisodes", table: "hospital_episodes", scope: "unit" },
  { snapshotKey: "products", table: "products", scope: "organization" },
  { snapshotKey: "stockLocations", table: "stock_locations", scope: "unit" },
  { snapshotKey: "lots", table: "lots", scope: "organization" },
  { snapshotKey: "stockMovements", table: "stock_movements", scope: "organization" },
  { snapshotKey: "medicationOrders", table: "medication_orders", scope: "organization" },
  { snapshotKey: "dispensations", table: "dispensations", scope: "organization" },
  { snapshotKey: "administrationOccurrences", table: "administration_occurrences", scope: "organization" },
  { snapshotKey: "charges", table: "charges", scope: "unit" },
  { snapshotKey: "payments", table: "payments", scope: "organization" },
  { snapshotKey: "ledgerEntries", table: "ledger_entries", scope: "organization" },
  { snapshotKey: "messages", table: "communication_messages", scope: "contextual" },
  { snapshotKey: "knowledgeDocuments", table: "knowledge_documents", scope: "contextual" },
  { snapshotKey: "aiSessions", table: "ai_sessions", scope: "contextual" },
  { snapshotKey: "aiTurns", table: "ai_turns", scope: "contextual" },
  { snapshotKey: "aiDrafts", table: "ai_drafts", scope: "contextual" },
  { snapshotKey: "aiApprovals", table: "ai_approvals", scope: "contextual" },
  { snapshotKey: "budgetReservations", table: "budget_reservations", scope: "organization" }
] as const;

export * from "./api-catalog.js";
