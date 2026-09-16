import { z } from "zod";
import { API_SCHEMA_VERSION, API_VERSION, SESSION_FORMAT_VERSION } from "./version.js";

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
  "DENIED_STALE_FENCE",
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
  "INTERNAL_ERROR",
  "API_COMPATIBILITY_UNAVAILABLE"
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
  movementType: z.enum(["RECEIPT", "DISPENSE", "TRANSFER_IN", "TRANSFER_OUT", "RETURN", "ADJUSTMENT", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"]),
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
  /** Fencing token for the durable claim; a takeover increments it. */
  claimEpoch?: number;
  /** Lease deadline while the claim is in flight; null once settled. */
  claimExpiresAt?: string | null;
  /** Whether the original attempt ever crossed the dispatch boundary. */
  dispatchState?: "NOT_STARTED" | "DISPATCHED";
  /** Set when a reconciled claim is finalized before any dispatch. */
  failurePhase?: "PRE_DISPATCH" | "POST_DISPATCH" | null;
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
  status: ChargeStatus;
  createdAt: string;
}

export interface Payment {
  id: OpaqueId;
  organizationId: OpaqueId;
  chargeId: OpaqueId;
  amountCents: number;
  method: z.infer<typeof paymentInputSchema>["method"];
  externalReference: string | null;
  status: PaymentStatus;
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
  /** Redacted agent-runtime counters (kill switches, denials, kernel events). */
  agentCounters: Record<string, number>;
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

export interface ApiPartial<T> {
  schemaVersion: typeof API_SCHEMA_VERSION;
  status: "PARTIAL";
  data: T;
  pending: PendingOperation[];
  correlationId: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiPartial<T> | ApiErrorBody;

export function success<T>(data: T, correlationId: string): ApiSuccess<T> {
  return { schemaVersion: API_SCHEMA_VERSION, data, correlationId };
}

export function failure(code: ErrorCode, message: string, correlationId: string, details?: Record<string, unknown>): ApiErrorBody {
  const boundedCode: ErrorCode = typeof code === "string" && (errorCodes as readonly string[]).includes(code) ? code : "INTERNAL_ERROR";
  const boundedMessage = (typeof message === "string" ? message : "").trim().slice(0, 2_000) || "Request failed";
  const boundedCorrelationId = correlationSchema.safeParse(correlationId).success ? correlationId : "unknown";
  const error = Object.create(null) as ApiErrorBody["error"];
  error.code = boundedCode;
  error.message = boundedMessage;
  if (details !== undefined) {
    try {
      const parsedDetails = errorDetailsSchema.safeParse(details);
      if (parsedDetails.success) {
        const safeDetails = structuredClone(parsedDetails.data);
        stripSerializationPrototypes(safeDetails, new WeakSet<object>());
        error.details = safeDetails;
      } else {
        error.details = Object.assign(Object.create(null), { detailsUnavailable: true });
      }
    } catch {
      error.details = Object.assign(Object.create(null), { detailsUnavailable: true });
    }
  }
  return Object.assign(Object.create(null), { schemaVersion: API_SCHEMA_VERSION, error, correlationId: boundedCorrelationId });
}

export function isApiError(value: unknown): value is ApiErrorBody {
  return typeof value === "object" && value !== null && "error" in value;
}

export function partial<T>(data: T, pending: PendingOperation[], correlationId: string): ApiPartial<T> {
  return { schemaVersion: API_SCHEMA_VERSION, status: "PARTIAL", data, pending, correlationId };
}

export function isApiPartial(value: unknown): value is ApiPartial<unknown> {
  return typeof value === "object" && value !== null && "status" in value && value.status === "PARTIAL";
}

const timestampSchema = z.string().datetime({ offset: true });
const nonNegativeCentsSchema = z.number().int().nonnegative();

const apiSuccessEnvelopeShape = z.object({
  schemaVersion: z.literal(API_SCHEMA_VERSION),
  data: z.unknown(),
  correlationId: correlationSchema
}).strict();

function hasBoundedErrorDetails(value: unknown, depth: number, seen: WeakSet<object>, budget: { nodes: number }): boolean {
  if (budget.nodes >= 128 || depth > 4) return false;
  budget.nodes += 1;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= 500;
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = (() => {
    const prototype = Object.getPrototypeOf(value);
    if (hasPrototypeProperty(value, "toJSON")) return false;
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype && prototype !== null) return false;
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 || lengthDescriptor.value > 32) return false;
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor) || !hasBoundedErrorDetails(descriptor.value, depth + 1, seen, budget)) return false;
      }
      for (const key of Reflect.ownKeys(value)) {
        if (key === "length") continue;
        if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= lengthDescriptor.value) return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) return false;
      }
      return true;
    }
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length > 32 || keys.some((key) => typeof key !== "string")) return false;
    return keys.every((key) => {
      if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,80}$/.test(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return Boolean(descriptor?.enumerable && "value" in descriptor && hasBoundedErrorDetails(descriptor.value, depth + 1, seen, budget));
    });
  })();
  seen.delete(value);
  return valid;
}

const errorDetailsSchema = z.custom<Record<string, unknown>>((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    if (!hasBoundedErrorDetails(value, 0, new WeakSet<object>(), { nodes: 0 })) return false;
    structuredClone(value);
    return true;
  } catch {
    return false;
  }
}, { message: "error details exceed the bounded diagnostic contract" });

const apiErrorEnvelopeShape = z.object({
  schemaVersion: z.literal(API_SCHEMA_VERSION),
  error: z.object({
    code: z.enum(errorCodes),
    message: z.string().trim().min(1).max(2_000),
    details: errorDetailsSchema.optional()
  }).strict(),
  correlationId: correlationSchema
}).strict();

const errorEnvelopeKeys = ["schemaVersion", "error", "correlationId"] as const;

function hasExactEnumerableDataKeys(value: object, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = [...required, ...optional];
  const keys = Reflect.ownKeys(value);
  if (keys.length < required.length || keys.length > allowed.length || !required.every((key) => keys.includes(key))) return false;
  return keys.every((key) => {
    if (typeof key !== "string" || !allowed.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(descriptor?.enumerable && "value" in descriptor);
  });
}

function isApiErrorEnvelopeDataOnly(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if ((prototype !== Object.prototype && prototype !== null) || hasPrototypeProperty(value, "toJSON") || !hasExactEnumerableDataKeys(value, errorEnvelopeKeys)) return false;
    const errorDescriptor = Object.getOwnPropertyDescriptor(value, "error");
    const error = errorDescriptor?.value;
    if (typeof error !== "object" || error === null || Array.isArray(error)) return false;
    const errorPrototype = Object.getPrototypeOf(error);
    if ((errorPrototype !== Object.prototype && errorPrototype !== null) || hasPrototypeProperty(error, "toJSON") || !hasExactEnumerableDataKeys(error, ["code", "message"], ["details"])) return false;
    const detailsDescriptor = Object.getOwnPropertyDescriptor(error, "details");
    if (detailsDescriptor && detailsDescriptor.value !== undefined && (!hasBoundedErrorDetails(detailsDescriptor.value, 0, new WeakSet<object>(), { nodes: 0 }) || (() => {
      try {
        structuredClone(detailsDescriptor.value);
        return false;
      } catch {
        return true;
      }
    })())) return false;
    structuredClone(value);
    return true;
  } catch {
    return false;
  }
}

function invalidContractSchema<T>(message: string): z.ZodError<T> {
  return new z.ZodError([{ code: "custom", path: [], message }]) as z.ZodError<T>;
}

function safeParseApiErrorEnvelope(value: unknown): ReturnType<typeof apiErrorEnvelopeShape.safeParse> {
  if (!isApiErrorEnvelopeDataOnly(value)) return { success: false, error: invalidContractSchema<z.infer<typeof apiErrorEnvelopeShape>>("error envelope contains invalid or unsafe properties") };
  try {
    return apiErrorEnvelopeShape.safeParse(value);
  } catch {
    return { success: false, error: invalidContractSchema<z.infer<typeof apiErrorEnvelopeShape>>("error envelope could not be validated safely") };
  }
}

function parseApiErrorEnvelope(value: unknown): ReturnType<typeof apiErrorEnvelopeShape.parse> {
  const result = safeParseApiErrorEnvelope(value);
  if (!result.success) throw result.error;
  return result.data;
}

async function safeParseApiErrorEnvelopeAsync(value: unknown): Promise<ReturnType<typeof apiErrorEnvelopeShape.safeParse>> {
  return safeParseApiErrorEnvelope(value);
}

async function parseApiErrorEnvelopeAsync(value: unknown): Promise<ReturnType<typeof apiErrorEnvelopeShape.parse>> {
  return parseApiErrorEnvelope(value);
}

function hasPrototypeProperty(value: object, property: string): boolean {
  if (Object.prototype.hasOwnProperty.call(value, property)) return true;
  let prototype = Object.getPrototypeOf(value);
  const seen = new WeakSet<object>();
  for (let depth = 0; prototype !== null; depth += 1) {
    if (depth >= 16 || seen.has(prototype)) return true;
    seen.add(prototype);
    if (Object.prototype.hasOwnProperty.call(prototype, property)) return true;
    prototype = Object.getPrototypeOf(prototype);
  }
  return false;
}

function stripSerializationPrototypes(value: unknown, seen: WeakSet<object>): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) stripSerializationPrototypes(descriptor.value, seen);
  }
  Object.setPrototypeOf(value, null);
  seen.delete(value);
}

const ENVELOPE_GRAPH_MAX_DEPTH = 32;
const ENVELOPE_GRAPH_MAX_NODES = 65_536;
const ENVELOPE_GRAPH_MAX_KEYS = 16_384;
const ENVELOPE_GRAPH_MAX_ARRAY_LENGTH = 16_384;
const ENVELOPE_GRAPH_MAX_STRING_LENGTH = 1_000_000;

function isSerializableContractGraph(value: unknown, seen: WeakSet<object>, depth = 0, budget = { nodes: 0 }): boolean {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= ENVELOPE_GRAPH_MAX_STRING_LENGTH;
  if (typeof value !== "object" || seen.has(value)) return false;
  if (depth > ENVELOPE_GRAPH_MAX_DEPTH || budget.nodes >= ENVELOPE_GRAPH_MAX_NODES) return false;
  budget.nodes += 1;
  seen.add(value);
  try {
    const prototype = Object.getPrototypeOf(value);
    if (hasPrototypeProperty(value, "toJSON")) return false;
    const keys = Reflect.ownKeys(value);
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype && prototype !== null) return false;
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 || lengthDescriptor.value > ENVELOPE_GRAPH_MAX_ARRAY_LENGTH || keys.length > ENVELOPE_GRAPH_MAX_KEYS || keys.length !== lengthDescriptor.value + 1) return false;
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor) || !isSerializableContractGraph(descriptor.value, seen, depth + 1, budget)) return false;
      }
      return keys.every((key) => key === "length" || (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key) && Number(key) < lengthDescriptor.value && Boolean(Object.getOwnPropertyDescriptor(value, key)?.enumerable)));
    }
    if (prototype !== Object.prototype && prototype !== null) return false;
    if (keys.length > ENVELOPE_GRAPH_MAX_KEYS) return false;
    return keys.every((key) => {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return Boolean(descriptor && descriptor.enumerable && "value" in descriptor && isSerializableContractGraph(descriptor.value, seen, depth + 1, budget));
    });
  } catch {
    return false;
  } finally {
    seen.delete(value);
  }
}

function isPlainContractObject(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return (prototype === Object.prototype || prototype === null)
      && !hasPrototypeProperty(value, "toJSON")
      && hasExactEnumerableDataKeys(value, required, optional);
  } catch {
    return false;
  }
}

function isApiSuccessEnvelopeDataOnly(value: unknown): boolean {
  if (!isPlainContractObject(value, ["schemaVersion", "data", "correlationId"])) return false;
  try {
    if (!isSerializableContractGraph(value, new WeakSet<object>())) return false;
    structuredClone(value);
    return true;
  } catch {
    return false;
  }
}

function safeParseApiSuccessEnvelope(value: unknown): ReturnType<typeof apiSuccessEnvelopeShape.safeParse> {
  if (!isApiSuccessEnvelopeDataOnly(value)) return { success: false, error: invalidContractSchema<z.infer<typeof apiSuccessEnvelopeShape>>("success envelope contains invalid or unsafe properties") };
  try {
    return apiSuccessEnvelopeShape.safeParse(value);
  } catch {
    return { success: false, error: invalidContractSchema<z.infer<typeof apiSuccessEnvelopeShape>>("success envelope could not be validated safely") };
  }
}

function parseApiSuccessEnvelope(value: unknown): ReturnType<typeof apiSuccessEnvelopeShape.parse> {
  const result = safeParseApiSuccessEnvelope(value);
  if (!result.success) throw result.error;
  return result.data;
}

async function safeParseApiSuccessEnvelopeAsync(value: unknown): Promise<ReturnType<typeof apiSuccessEnvelopeShape.safeParse>> {
  return safeParseApiSuccessEnvelope(value);
}

async function parseApiSuccessEnvelopeAsync(value: unknown): Promise<ReturnType<typeof apiSuccessEnvelopeShape.parse>> {
  return parseApiSuccessEnvelope(value);
}

export const apiSuccessEnvelopeSchema = new Proxy(apiSuccessEnvelopeShape, {
  get(target, property, receiver) {
    if (property === "safeParse") return safeParseApiSuccessEnvelope;
    if (property === "parse") return parseApiSuccessEnvelope;
    if (property === "safeParseAsync" || property === "spa") return safeParseApiSuccessEnvelopeAsync;
    if (property === "parseAsync") return parseApiSuccessEnvelopeAsync;
    return Reflect.get(target, property, receiver);
  }
});

export const apiErrorEnvelopeSchema = new Proxy(apiErrorEnvelopeShape, {
  get(target, property, receiver) {
    if (property === "safeParse") return safeParseApiErrorEnvelope;
    if (property === "parse") return parseApiErrorEnvelope;
    if (property === "safeParseAsync" || property === "spa") return safeParseApiErrorEnvelopeAsync;
    if (property === "parseAsync") return parseApiErrorEnvelopeAsync;
    return Reflect.get(target, property, receiver);
  }
});

export const pendingOperationReasonSchema = z.enum([
  "IN_FLIGHT",
  "OUTCOME_UNKNOWN",
  "DEPENDENCY_UNAVAILABLE",
  "POLICY_UNRESOLVED"
]);
export type PendingOperationReason = z.infer<typeof pendingOperationReasonSchema>;

const pendingOperationShape = z.object({
  operation: z.string().trim().min(1).max(160),
  receiptId: idSchema.nullable(),
  reason: pendingOperationReasonSchema,
  retryable: z.boolean()
}).strict();

function isDenseContractArray(value: unknown, minimum: number, maximum: number, itemGuard?: (item: unknown) => boolean): boolean {
  if (!Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor?.value;
    if ((prototype !== Array.prototype && prototype !== null) || hasPrototypeProperty(value, "toJSON") || !lengthDescriptor || !("value" in lengthDescriptor) || !Number.isInteger(length) || length < minimum || length > maximum) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1) return false;
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !("value" in descriptor) || (itemGuard && !itemGuard(descriptor.value))) return false;
    }
    const validKeys = keys.every((key) => key === "length" || (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key) && Number(key) < length && Boolean(Object.getOwnPropertyDescriptor(value, key)?.enumerable)));
    if (!validKeys) return false;
    structuredClone(value);
    return true;
  } catch {
    return false;
  }
}

function isPendingOperationDataOnly(value: unknown): boolean {
  if (!isPlainContractObject(value, ["operation", "receiptId", "reason", "retryable"])) return false;
  try {
    structuredClone(value);
    return true;
  } catch {
    return false;
  }
}

function safeParsePendingOperation(value: unknown): ReturnType<typeof pendingOperationShape.safeParse> {
  if (!isPendingOperationDataOnly(value)) return { success: false, error: invalidContractSchema<z.infer<typeof pendingOperationShape>>("pending operation contains invalid or unsafe properties") };
  try {
    return pendingOperationShape.safeParse(value);
  } catch {
    return { success: false, error: invalidContractSchema<z.infer<typeof pendingOperationShape>>("pending operation could not be validated safely") };
  }
}

function parsePendingOperation(value: unknown): ReturnType<typeof pendingOperationShape.parse> {
  const result = safeParsePendingOperation(value);
  if (!result.success) throw result.error;
  return result.data;
}

async function safeParsePendingOperationAsync(value: unknown): Promise<ReturnType<typeof pendingOperationShape.safeParse>> {
  return safeParsePendingOperation(value);
}

async function parsePendingOperationAsync(value: unknown): Promise<ReturnType<typeof pendingOperationShape.parse>> {
  return parsePendingOperation(value);
}

export const pendingOperationSchema = new Proxy(pendingOperationShape, {
  get(target, property, receiver) {
    if (property === "safeParse") return safeParsePendingOperation;
    if (property === "parse") return parsePendingOperation;
    if (property === "safeParseAsync" || property === "spa") return safeParsePendingOperationAsync;
    if (property === "parseAsync") return parsePendingOperationAsync;
    return Reflect.get(target, property, receiver);
  }
});
export type PendingOperation = z.infer<typeof pendingOperationSchema>;

const apiPartialEnvelopeShape = z.object({
  schemaVersion: z.literal(API_SCHEMA_VERSION),
  status: z.literal("PARTIAL"),
  data: z.unknown(),
  pending: z.array(pendingOperationShape).min(1).max(32),
  correlationId: correlationSchema
}).strict();

function isApiPartialEnvelopeDataOnly(value: unknown): boolean {
  try {
    if (!isPlainContractObject(value, ["schemaVersion", "status", "data", "pending", "correlationId"])) return false;
    const pending = Object.getOwnPropertyDescriptor(value, "pending")?.value;
    if (!isDenseContractArray(pending, 1, 32, isPendingOperationDataOnly)) return false;
    if (!isSerializableContractGraph(value, new WeakSet<object>())) return false;
    structuredClone(value);
    return true;
  } catch {
    return false;
  }
}

function safeParseApiPartialEnvelope(value: unknown): ReturnType<typeof apiPartialEnvelopeShape.safeParse> {
  if (!isApiPartialEnvelopeDataOnly(value)) return { success: false, error: invalidContractSchema<z.infer<typeof apiPartialEnvelopeShape>>("partial envelope contains invalid or unsafe properties") };
  try {
    return apiPartialEnvelopeShape.safeParse(value);
  } catch {
    return { success: false, error: invalidContractSchema<z.infer<typeof apiPartialEnvelopeShape>>("partial envelope could not be validated safely") };
  }
}

function parseApiPartialEnvelope(value: unknown): ReturnType<typeof apiPartialEnvelopeShape.parse> {
  const result = safeParseApiPartialEnvelope(value);
  if (!result.success) throw result.error;
  return result.data;
}

async function safeParseApiPartialEnvelopeAsync(value: unknown): Promise<ReturnType<typeof apiPartialEnvelopeShape.safeParse>> {
  return safeParseApiPartialEnvelope(value);
}

async function parseApiPartialEnvelopeAsync(value: unknown): Promise<ReturnType<typeof apiPartialEnvelopeShape.parse>> {
  return parseApiPartialEnvelope(value);
}

export const apiPartialEnvelopeSchema = new Proxy(apiPartialEnvelopeShape, {
  get(target, property, receiver) {
    if (property === "safeParse") return safeParseApiPartialEnvelope;
    if (property === "parse") return parseApiPartialEnvelope;
    if (property === "safeParseAsync" || property === "spa") return safeParseApiPartialEnvelopeAsync;
    if (property === "parseAsync") return parseApiPartialEnvelopeAsync;
    return Reflect.get(target, property, receiver);
  }
});

export const commandReceiptStatusSchema = z.enum([
  "IN_FLIGHT",
  "SUCCEEDED",
  "FAILED",
  "OUTCOME_UNKNOWN"
]);
export type CommandReceiptStatus = z.infer<typeof commandReceiptStatusSchema>;

export const commandReceiptSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  actorId: idSchema,
  unitId: idSchema.nullable(),
  workspaceId: idSchema.nullable(),
  auditRecordId: idSchema.nullable(),
  operation: z.string().trim().min(1).max(160),
  idempotencyLookup: z.string().trim().min(1).max(256),
  bodyDigest: digestSchema,
  status: commandReceiptStatusSchema,
  result: z.unknown(),
  createdAt: timestampSchema,
  completedAt: timestampSchema.nullable()
}).strict().superRefine((value, ctx) => {
  if (value.status === "IN_FLIGHT" && (value.result !== null || value.completedAt !== null)) {
    ctx.addIssue({ code: "custom", path: ["status"], message: "in-flight receipts cannot expose a result or completion time" });
  }
  if (value.status !== "IN_FLIGHT" && value.completedAt === null) {
    ctx.addIssue({ code: "custom", path: ["completedAt"], message: "terminal receipts require a completion time" });
  }
  if (value.status !== "SUCCEEDED" && value.result !== null) {
    ctx.addIssue({ code: "custom", path: ["result"], message: "non-success receipts cannot expose a result" });
  }
});
export type CommandReceiptWire = z.infer<typeof commandReceiptSchema>;

export const receiptReferenceSchema = z.object({
  receiptId: idSchema,
  status: commandReceiptStatusSchema,
  replayed: z.boolean()
}).strict().superRefine((value, ctx) => {
  if (value.replayed && value.status !== "SUCCEEDED") {
    ctx.addIssue({ code: "custom", path: ["replayed"], message: "only a successful receipt can be replayed" });
  }
});
export type ReceiptReference = z.infer<typeof receiptReferenceSchema>;

export const sessionLifecycleStateSchema = z.enum([
  "ACTIVE",
  "EXPIRED",
  "REVOKED",
  "SIGN_OUT_PENDING",
  "UNKNOWN"
]);
export type SessionLifecycleState = z.infer<typeof sessionLifecycleStateSchema>;

export const sessionLifecycleSchema = z.object({
  sessionId: idSchema,
  state: sessionLifecycleStateSchema,
  observedBy: z.enum(["SERVER", "LOCAL"]),
  observedAt: timestampSchema
}).strict().superRefine((value, ctx) => {
  if (value.state === "REVOKED" && value.observedBy !== "SERVER") {
    ctx.addIssue({ code: "custom", path: ["observedBy"], message: "revocation requires a server observation" });
  }
});
export type SessionLifecycle = z.infer<typeof sessionLifecycleSchema>;

export const logoutLocalStateSchema = z.enum(["AUTHENTICATED", "SIGN_OUT_PENDING", "SIGNED_OUT"]);
export const serverRevocationSchema = z.enum(["CONFIRMED", "PENDING", "NOT_REVOKED", "NOT_OBSERVED", "UNKNOWN"]);

export const logoutServerObservationSchema = z.object({
  status: z.enum(["REVOKED", "PENDING", "NOT_REVOKED"]),
  observedAt: timestampSchema
}).strict();

/** Local sign-out and server revocation are separate facts; one never implies the other. */
export const logoutResponseSchema = z.object({
  sessionId: idSchema,
  localState: logoutLocalStateSchema,
  serverRevocation: serverRevocationSchema,
  serverAttempted: z.boolean(),
  serverObservation: logoutServerObservationSchema.nullable(),
  retryable: z.boolean(),
  correlationId: correlationSchema
}).strict().superRefine((value, ctx) => {
  if (!value.serverAttempted && value.serverRevocation !== "NOT_OBSERVED") {
    ctx.addIssue({ code: "custom", path: ["serverRevocation"], message: "an unattempted logout cannot claim a server result" });
  }
  if (value.serverRevocation === "NOT_OBSERVED" && value.serverAttempted) {
    ctx.addIssue({ code: "custom", path: ["serverAttempted"], message: "not-observed logout must not claim a server attempt" });
  }
  if (value.serverRevocation === "UNKNOWN" && (!value.serverAttempted || value.serverObservation !== null)) {
    ctx.addIssue({ code: "custom", path: ["serverObservation"], message: "unknown revocation requires an attempted request with no observed response" });
  }
  if (value.serverRevocation === "CONFIRMED" && (!value.serverObservation || value.serverObservation.status !== "REVOKED")) {
    ctx.addIssue({ code: "custom", path: ["serverObservation"], message: "confirmed revocation requires a server observation of revoked" });
  }
  if (value.serverRevocation === "PENDING" && (!value.serverObservation || value.serverObservation.status !== "PENDING")) {
    ctx.addIssue({ code: "custom", path: ["serverObservation"], message: "pending revocation requires a server observation of pending" });
  }
  if (value.serverRevocation === "NOT_REVOKED" && (!value.serverObservation || value.serverObservation.status !== "NOT_REVOKED")) {
    ctx.addIssue({ code: "custom", path: ["serverObservation"], message: "not-revoked status requires a server observation" });
  }
  if (value.serverRevocation === "NOT_OBSERVED" && value.serverObservation !== null) {
    ctx.addIssue({ code: "custom", path: ["serverObservation"], message: "not-observed logout cannot carry a server observation" });
  }
});
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;

export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, "currency must be an uppercase ISO-4217 code");
export const chargeStatusSchema = z.enum(["OPEN", "PARTIALLY_PAID", "PAID", "REFUNDED"]);
export type ChargeStatus = z.infer<typeof chargeStatusSchema>;
export const paymentStatusSchema = z.enum(["PENDING", "SETTLED", "UNKNOWN", "REFUNDED"]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const financialBalanceStateSchema = z.enum([
  "OPEN",
  "PARTIALLY_PAID",
  "PAID",
  "REFUNDED",
  "REQUIRES_POLICY",
  "UNKNOWN"
]);
export type FinancialBalanceState = z.infer<typeof financialBalanceStateSchema>;

export const refundAssessmentSchema = z.object({
  status: z.enum(["NOT_APPLICABLE", "OBSERVED", "UNRESOLVED"]),
  amountCents: nonNegativeCentsSchema.nullable()
}).strict().superRefine((value, ctx) => {
  if (value.status === "OBSERVED" && value.amountCents === null) {
    ctx.addIssue({ code: "custom", path: ["amountCents"], message: "observed refunds require an amount" });
  }
  if (value.status !== "OBSERVED" && value.amountCents !== null) {
    ctx.addIssue({ code: "custom", path: ["amountCents"], message: "unobserved refunds cannot carry an amount" });
  }
});
export type RefundAssessment = z.infer<typeof refundAssessmentSchema>;

export const financialBalanceSchema = z.object({
  currency: currencyCodeSchema,
  chargedCents: nonNegativeCentsSchema,
  settledPaymentCents: nonNegativeCentsSchema,
  pendingCents: nonNegativeCentsSchema.nullable(),
  state: financialBalanceStateSchema,
  refunds: refundAssessmentSchema,
  observedAt: timestampSchema
}).strict().superRefine((value, ctx) => {
  if (value.settledPaymentCents > value.chargedCents) {
    ctx.addIssue({ code: "custom", path: ["settledPaymentCents"], message: "settled payments cannot exceed the charged amount" });
  }
  if (value.pendingCents !== null && value.pendingCents > value.chargedCents) {
    ctx.addIssue({ code: "custom", path: ["pendingCents"], message: "pending balance cannot exceed the charged amount" });
  }
  if (value.pendingCents === null && !["REQUIRES_POLICY", "UNKNOWN"].includes(value.state)) {
    ctx.addIssue({ code: "custom", path: ["state"], message: "unknown pending balance requires an explicit uncertain state" });
  }
  if (value.state === "OPEN" && (value.settledPaymentCents !== 0 || value.pendingCents !== value.chargedCents)) {
    ctx.addIssue({ code: "custom", path: ["state"], message: "open balances cannot include settled payments" });
  }
  if (value.state === "PARTIALLY_PAID" && (value.settledPaymentCents === 0 || value.pendingCents === null || value.pendingCents === 0 || value.settledPaymentCents + value.pendingCents !== value.chargedCents)) {
    ctx.addIssue({ code: "custom", path: ["state"], message: "partially paid balances require settled and pending amounts" });
  }
  if (value.state === "PAID" && (value.pendingCents !== 0 || value.settledPaymentCents !== value.chargedCents)) {
    ctx.addIssue({ code: "custom", path: ["state"], message: "paid balances require zero pending amount" });
  }
  if (value.state === "REFUNDED" && value.refunds.status !== "OBSERVED") {
    ctx.addIssue({ code: "custom", path: ["state"], message: "refunded balances require an observed refund" });
  }
  if (value.refunds.status === "UNRESOLVED" && value.state !== "REQUIRES_POLICY" && value.state !== "UNKNOWN") {
    ctx.addIssue({ code: "custom", path: ["state"], message: "unresolved refund policy cannot produce a settled financial state" });
  }
});
export type FinancialBalance = z.infer<typeof financialBalanceSchema>;

export const FIRST_JOURNEY_CONTRACT_EXAMPLES = Object.freeze({
  success: {
    schemaVersion: API_SCHEMA_VERSION,
    data: { receiptId: "00000000-0000-4000-8000-000000000001", status: "SUCCEEDED" },
    correlationId: "con-01-success"
  },
  error: {
    schemaVersion: API_SCHEMA_VERSION,
    error: { code: "DEPENDENCY_UNAVAILABLE", message: "dependency is not available", details: { retryable: true } },
    correlationId: "con-01-error"
  },
  partial: {
    schemaVersion: API_SCHEMA_VERSION,
    status: "PARTIAL",
    data: { items: [] },
    pending: [{ operation: "finance.balance", receiptId: null, reason: "POLICY_UNRESOLVED", retryable: false }],
    correlationId: "con-01-partial"
  }
} as const);

export const FIRST_JOURNEY_DOMAIN_EXAMPLES = Object.freeze({
  logout: {
    sessionId: "00000000-0000-4000-8000-000000000002",
    localState: "SIGNED_OUT",
    serverRevocation: "UNKNOWN",
    serverAttempted: true,
    serverObservation: null,
    retryable: true,
    correlationId: "con-01-logout"
  },
  session: {
    sessionId: "00000000-0000-4000-8000-000000000002",
    state: "ACTIVE",
    observedBy: "SERVER",
    observedAt: "2026-09-13T00:00:00.000Z"
  },
  financialBalance: {
    currency: "BRL",
    chargedCents: 10000,
    settledPaymentCents: 4000,
    pendingCents: 6000,
    state: "PARTIALLY_PAID",
    refunds: { status: "NOT_APPLICABLE", amountCents: null },
    observedAt: "2026-09-13T00:00:00.000Z"
  }
} as const);

/** Payloads observed by the web client when a session/context is established. */
export const userSummarySchema = z.looseObject({
  id: idSchema,
  displayName: z.string().min(1),
  email: z.string().min(1),
  status: z.string().min(1)
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const contextOptionSchema = z.looseObject({
  organization: z.looseObject({ id: idSchema, name: z.string().min(1), slug: z.string().min(1) }),
  unit: z.looseObject({ id: idSchema, name: z.string().min(1), code: z.string().min(1) }),
  workspace: z.looseObject({ id: idSchema, name: z.string().min(1), purpose: z.string().min(1) }),
  roles: z.array(z.string().min(1))
});
export type ContextOptionPayload = z.infer<typeof contextOptionSchema>;

export const authenticatedSessionPayloadSchema = z.looseObject({
  user: userSummarySchema,
  contexts: z.array(contextOptionSchema),
  csrfToken: z.string().min(1).optional()
}).superRefine((value, ctx) => {
  if (Object.prototype.hasOwnProperty.call(value, "mfaRequired")) {
    ctx.addIssue({ code: "custom", path: ["mfaRequired"], message: "a completed session must not carry the MFA challenge flag" });
  }
});
export type AuthenticatedSessionPayload = z.infer<typeof authenticatedSessionPayloadSchema>;

export const mfaChallengePayloadSchema = z.strictObject({
  mfaRequired: z.literal(true),
  challengeId: challengeTokenSchema,
  expiresAt: timestampSchema
});
export type MfaChallengePayload = z.infer<typeof mfaChallengePayloadSchema>;

/** A login is either a completed session or a pending MFA challenge, never both. */
export const loginResponseSchema = z.union([mfaChallengePayloadSchema, authenticatedSessionPayloadSchema]);
export type LoginResponsePayload = z.infer<typeof loginResponseSchema>;

export const meResponseSchema = z.looseObject({
  user: userSummarySchema,
  context: z.looseObject({
    organizationId: idSchema,
    unit: z.looseObject({ id: idSchema, name: z.string().min(1), code: z.string().min(1) }).nullable(),
    workspace: z.looseObject({ id: idSchema, name: z.string().min(1), purpose: z.string().min(1) }).nullable()
  })
});
export type MeResponsePayload = z.infer<typeof meResponseSchema>;

export const chargeSummarySchema = z.looseObject({
  id: idSchema,
  description: z.string().min(1),
  amountCents: nonNegativeCentsSchema,
  currency: currencyCodeSchema,
  status: chargeStatusSchema,
  createdAt: timestampSchema
});
export type ChargeSummary = z.infer<typeof chargeSummarySchema>;

export const financeChargesResponseSchema = z.looseObject({
  items: z.array(chargeSummarySchema),
  balance: financialBalanceSchema
});
export type FinanceChargesResponse = z.infer<typeof financeChargesResponseSchema>;

export const FIRST_JOURNEY_CONTRACT_REGISTRY = Object.freeze({
  ApiSuccess: apiSuccessEnvelopeSchema,
  ApiError: apiErrorEnvelopeSchema,
  ApiPartial: apiPartialEnvelopeSchema,
  CommandReceipt: commandReceiptSchema,
  ReceiptReference: receiptReferenceSchema,
  SessionLifecycle: sessionLifecycleSchema,
  LogoutResponse: logoutResponseSchema,
  FinancialBalance: financialBalanceSchema,
  UserSummary: userSummarySchema,
  ContextOption: contextOptionSchema,
  AuthenticatedSession: authenticatedSessionPayloadSchema,
  MfaChallenge: mfaChallengePayloadSchema,
  LoginResponse: loginResponseSchema,
  MeResponse: meResponseSchema,
  ChargeSummary: chargeSummarySchema,
  FinanceChargesResponse: financeChargesResponseSchema
} as const);

export const FIRST_JOURNEY_CONTRACT_MANIFEST = Object.freeze({
  apiVersion: API_VERSION,
  schemaVersion: API_SCHEMA_VERSION,
  sessionFormatVersion: SESSION_FORMAT_VERSION,
  compatibility: "V1_CURRENT_ONLY_FAIL_CLOSED",
  envelopeExamples: ["success", "error", "partial"],
  schemas: Object.keys(FIRST_JOURNEY_CONTRACT_REGISTRY)
} as const);

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
