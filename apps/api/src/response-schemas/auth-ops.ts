import { z } from "zod";
import { idSchema, logoutResponseSchema, roleSchema, scopeTypeSchema } from "@cvg/contracts";

const timestampSchema = z.string().datetime({ offset: true });
const correlationSchema = z.string().regex(/^[A-Za-z0-9._-]{1,80}$/);
const revisionSchema = z.string().regex(/^\d{1,18}$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const positiveIntegerSchema = z.number().int().min(1);
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const nonNegativeNumberSchema = z.number().finite().nonnegative();

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const boundedList = <T extends z.ZodTypeAny>(schema: T, max = 1_000) => z.array(schema).max(max);

const healthStatusSchema = z.enum(["READY", "QUARANTINED"]);
const dependencyStatusSchema = z.enum(["READY", "UNAVAILABLE", "NOT_CONFIGURED", "DEGRADED"]);
const healthDependencyStatusSchema = z.enum(["READY", "UNAVAILABLE", "NOT_CONFIGURED", "DEGRADED", "NOT_REQUIRED"]);
const agentRuntimeStatusSchema = z.enum(["READY", "DEGRADED", "UNAVAILABLE", "DISABLED"]);

const healthResponseSchema = z.object({
  live: z.literal(true),
  status: healthStatusSchema,
  capabilities: z.object({
    demoOnly: z.boolean(),
    realProvidersBlocked: z.boolean(),
    realDataBlocked: z.literal(true)
  }).strict()
}).strict();

const readinessResponseSchema = z.object({
  ready: z.boolean(),
  status: healthStatusSchema,
  checks: z.object({
    database: z.enum(["READY", "NOT_CONFIGURED", "UNAVAILABLE"]),
    policyStore: z.enum(["READY", "UNAVAILABLE", "DEGRADED"]),
    secretProvider: dependencyStatusSchema,
    secretReferences: z.object({
      deepseekBearerToken: healthDependencyStatusSchema,
      deepseekContextSignature: healthDependencyStatusSchema
    }).strict(),
    authMfa: healthDependencyStatusSchema,
    agentRuntime: agentRuntimeStatusSchema,
    outbox: z.enum(["READY", "UNAVAILABLE", "NOT_CONFIGURED"]),
    auditLedger: z.enum(["READY", "UNAVAILABLE", "DEGRADED"]),
    queue: z.object({
      outboxDepth: nonNegativeIntegerSchema,
      oldestAgeMs: nonNegativeNumberSchema,
      poisonMessages: nonNegativeIntegerSchema,
      reconciliationLag: nonNegativeIntegerSchema,
      workerHeartbeatAgeMs: nonNegativeNumberSchema,
      workerHeartbeatCount: nonNegativeIntegerSchema
    }).strict()
  }).strict(),
  ai: z.object({
    status: agentRuntimeStatusSchema,
    degraded: z.boolean()
  }).strict()
}).strict();

const inboxReceiptSchema = z.object({
  accepted: z.boolean(),
  duplicate: z.boolean(),
  status: z.enum(["RECEIVED", "PROCESSED", "QUARANTINED", "RECONCILIATION_REQUIRED"]),
  inboxId: idSchema,
  recordDigest: digestSchema
}).strict();

const receiptIdSchema = idSchema;
const mfaFactorResponseSchema = z.union([
  z.object({
    enrolled: z.literal(true),
    method: z.literal("TOTP"),
    sessionsRevoked: nonNegativeIntegerSchema,
    receiptId: receiptIdSchema
  }).strict(),
  z.object({
    revoked: z.boolean(),
    method: z.literal("TOTP"),
    sessionsRevoked: nonNegativeIntegerSchema,
    receiptId: receiptIdSchema
  }).strict()
]);

const recoveryStartResponseSchema = z.object({
  accepted: z.literal(true),
  challengeId: z.string().trim().regex(/^[A-Za-z0-9_-]{32,160}$/),
  expiresAt: timestampSchema
}).strict();

const authenticatedUserSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  login: boundedText(160),
  displayName: boundedText(160),
  email: boundedText(320),
  status: z.enum(["ACTIVE", "DISABLED"]),
  lastLoginAt: timestampSchema.nullable(),
  createdAt: timestampSchema
}).strict();

const contextOptionSchema = z.object({
  organization: z.object({
    id: idSchema,
    name: boundedText(160),
    slug: boundedText(120)
  }).strict(),
  unit: z.object({
    id: idSchema,
    organizationId: idSchema,
    name: boundedText(160),
    code: boundedText(80),
    status: z.enum(["ACTIVE", "INACTIVE"])
  }).strict(),
  workspace: z.object({
    id: idSchema,
    organizationId: idSchema,
    unitId: idSchema,
    name: boundedText(160),
    purpose: boundedText(240),
    status: z.enum(["ACTIVE", "INACTIVE"])
  }).strict(),
  roles: boundedList(roleSchema, 16)
}).strict();

const demoLoginResponseSchema = z.object({
  user: authenticatedUserSchema,
  contexts: boundedList(contextOptionSchema),
  csrfToken: boundedText(256),
  demo: z.literal(true)
}).strict();

const sessionSchema = z.object({
  id: idSchema,
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
  revokedAt: timestampSchema.nullable(),
  lastSeenAt: timestampSchema,
  device: z.enum(["registered", "unidentified"]),
  mfaVerified: z.boolean(),
  currentCredentialVersion: positiveIntegerSchema
}).strict();

const sessionListResponseSchema = z.object({
  items: boundedList(sessionSchema),
  currentSessionId: idSchema
}).strict();

const sessionRevokeResponseSchema = z.object({
  revoked: z.literal(true),
  sessionId: idSchema,
  current: z.boolean(),
  receiptId: receiptIdSchema,
  replayed: z.boolean()
}).strict();

const contextListResponseSchema = boundedList(contextOptionSchema);

const contextResponseSchema = z.object({
  organizationId: idSchema,
  organizationName: boundedText(160),
  unit: z.object({
    id: idSchema,
    name: boundedText(160),
    code: boundedText(80)
  }).strict().nullable(),
  workspace: z.object({
    id: idSchema,
    name: boundedText(160),
    purpose: boundedText(240)
  }).strict().nullable(),
  roles: boundedList(roleSchema, 16),
  purpose: boundedText(160),
  policyRevision: revisionSchema,
  correlationId: correlationSchema
}).strict();

const roleAssignmentSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  userId: idSchema,
  role: roleSchema,
  scopeType: scopeTypeSchema,
  unitId: idSchema.nullable(),
  workspaceId: idSchema.nullable(),
  grantedAt: timestampSchema,
  revokedAt: timestampSchema.nullable()
}).strict().superRefine((value, ctx) => {
  if (value.scopeType === "ORGANIZATION" && (value.unitId !== null || value.workspaceId !== null)) {
    ctx.addIssue({ code: "custom", path: ["scopeType"], message: "organization assignments cannot carry unit or workspace scope" });
  }
  if (value.scopeType === "UNIT" && (value.unitId === null || value.workspaceId !== null)) {
    ctx.addIssue({ code: "custom", path: ["scopeType"], message: "unit assignments require only a unit scope" });
  }
  if (value.scopeType === "WORKSPACE" && (value.unitId === null || value.workspaceId === null)) {
    ctx.addIssue({ code: "custom", path: ["scopeType"], message: "workspace assignments require unit and workspace scope" });
  }
});

const listedUserSchema = z.object({
  id: idSchema,
  displayName: boundedText(160),
  email: boundedText(320),
  status: z.enum(["ACTIVE", "DISABLED"]),
  roles: boundedList(z.object({
    id: idSchema,
    role: roleSchema,
    scopeType: scopeTypeSchema,
    unitId: idSchema.nullable(),
    workspaceId: idSchema.nullable(),
    revokedAt: timestampSchema.nullable()
  }).strict(), 128)
}).strict();

const userListResponseSchema = z.object({
  items: boundedList(listedUserSchema),
  nextCursor: idSchema.nullable(),
  revision: revisionSchema
}).strict();

const roleAssignmentResponseSchema = z.object({
  assignment: roleAssignmentSchema,
  receiptId: receiptIdSchema,
  revision: revisionSchema
}).strict();

const unsafeMetadataKeys = new Set([
  "password",
  "passworddigest",
  "secret",
  "secretvalue",
  "apikey",
  "authorization",
  "bearertoken",
  "privatekey",
  "credential",
  "credentialdigest",
  "mfasecretref",
  "accesstoken",
  "refreshtoken",
  "rawresponse",
  "providerbody",
  "providererror",
  "signature",
  "signaturekeyref",
  "tokendigest"
]);

const safeMetadataValueSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null()
]);

/**
 * Audit metadata is the one intentionally broad nested boundary in this
 * slice: producers add bounded scalar facts by action. Keys and values stay
 * constrained, and sensitive field names are rejected rather than carried
 * through a generic nested payload.
 */
const auditMetadataSchema = z.record(
  z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/),
  safeMetadataValueSchema
).superRefine((value, ctx) => {
  for (const key of Object.keys(value)) {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (unsafeMetadataKeys.has(normalized)) {
      ctx.addIssue({ code: "custom", path: [key], message: "sensitive metadata fields are not part of the response contract" });
    }
  }
});

const auditRecordSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  actorId: idSchema.nullable(),
  unitId: idSchema.nullable(),
  workspaceId: idSchema.nullable(),
  action: boundedText(160),
  resourceType: boundedText(120),
  resourceId: idSchema.nullable(),
  result: z.enum(["ALLOWED", "DENIED", "ERROR", "UNKNOWN"]),
  reason: z.string().max(500).nullable(),
  correlationId: correlationSchema,
  metadata: auditMetadataSchema,
  chainVersion: z.literal(2),
  previousHash: digestSchema.nullable(),
  recordHash: digestSchema,
  createdAt: timestampSchema
}).strict();

const auditListResponseSchema = z.object({
  items: boundedList(auditRecordSchema, 100),
  nextCursor: idSchema.nullable(),
  revision: revisionSchema
}).strict();

const publicGuardianSchema = z.object({
  id: idSchema,
  displayName: boundedText(120),
  phone: boundedText(40),
  email: z.string().email().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE"])
}).strict();

const guardianListResponseSchema = z.object({
  items: boundedList(publicGuardianSchema)
}).strict();

const guardianResponseSchema = z.object({
  guardian: publicGuardianSchema,
  receiptId: receiptIdSchema
}).strict();

const patientGuardianSchema = z.object({
  id: idSchema,
  displayName: boundedText(120),
  phone: boundedText(40)
}).strict();

const publicPatientMinimumSchema = z.object({
  id: idSchema,
  name: boundedText(120),
  species: boundedText(80),
  breed: z.string().max(100).nullable(),
  status: z.enum(["ACTIVE", "INACTIVE", "MERGED"]),
  guardian: patientGuardianSchema
}).strict();

const publicPatientExpandedSchema = publicPatientMinimumSchema.extend({
  sex: z.enum(["FEMALE", "MALE", "UNKNOWN"]),
  reproductiveStatus: z.enum(["INTACT", "NEUTERED", "UNKNOWN"]),
  birthDate: z.string().date().nullable(),
  identifiers: boundedList(boundedText(80), 8)
}).strict();

const publicPatientSchema = z.union([publicPatientExpandedSchema, publicPatientMinimumSchema]);

const patientListResponseSchema = z.object({
  items: boundedList(publicPatientSchema)
}).strict();

const patientResponseSchema = z.union([
  publicPatientSchema,
  z.object({
    patient: publicPatientSchema,
    receiptId: receiptIdSchema
  }).strict()
]);

const patientMergeResponseSchema = z.object({
  targetPatient: publicPatientSchema,
  sourcePatientId: idSchema,
  receiptId: receiptIdSchema
}).strict();

const appointmentSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  unitId: idSchema,
  workspaceId: idSchema,
  patientId: idSchema,
  providerId: idSchema,
  resourceId: idSchema.nullable(),
  serviceId: idSchema,
  startsAt: timestampSchema,
  endsAt: timestampSchema,
  purpose: boundedText(240),
  status: z.enum(["SCHEDULED", "CONFIRMED", "CHECKED_IN", "CANCELLED", "COMPLETED"]),
  version: positiveIntegerSchema,
  createdAt: timestampSchema
}).strict();

const appointmentReadSchema = appointmentSchema.extend({
  patient: z.object({ id: idSchema, name: boundedText(120) }).strict().nullable(),
  provider: boundedText(160).nullable()
}).strict();

const appointmentListResponseSchema = z.object({
  items: boundedList(appointmentReadSchema)
}).strict();

const appointmentResponseSchema = z.object({
  appointment: appointmentSchema,
  receiptId: receiptIdSchema
}).strict();

const queueEntrySchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  unitId: idSchema,
  appointmentId: idSchema.nullable(),
  patientId: idSchema,
  status: z.enum(["WAITING", "TRIAGE", "IN_SERVICE", "DONE", "CANCELLED"]),
  priority: z.enum(["ROUTINE", "URGENT", "EMERGENCY"]),
  checkedInAt: timestampSchema
}).strict();

const queueReadSchema = queueEntrySchema.extend({
  patient: z.object({ id: idSchema, name: boundedText(120) }).strict().nullable()
}).strict();

const queueListResponseSchema = z.object({
  items: boundedList(queueReadSchema)
}).strict();

const queueEntryResponseSchema = z.object({
  queueEntry: queueEntrySchema,
  receiptId: receiptIdSchema
}).strict();

const encounterSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  unitId: idSchema,
  workspaceId: idSchema,
  patientId: idSchema,
  appointmentId: idSchema.nullable(),
  chiefComplaint: boundedText(500),
  urgency: z.enum(["ROUTINE", "URGENT", "EMERGENCY"]),
  status: z.enum(["OPEN", "IN_PROGRESS", "SIGNED", "CLOSED"]),
  openedAt: timestampSchema,
  closedAt: timestampSchema.nullable()
}).strict();

const queueHandoffResponseSchema = z.object({
  queueEntry: queueEntrySchema,
  encounter: encounterSchema,
  receiptId: receiptIdSchema
}).strict();

const providerSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  displayName: boundedText(160),
  specialty: boundedText(160),
  role: z.enum(["veterinario", "tecnico"]),
  unitId: idSchema,
  status: z.enum(["ACTIVE", "INACTIVE"])
}).strict();

const serviceSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  name: boundedText(160),
  durationMinutes: positiveIntegerSchema,
  priceCents: nonNegativeIntegerSchema,
  status: z.enum(["ACTIVE", "INACTIVE"])
}).strict();

const resourceSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  unitId: idSchema,
  name: boundedText(160),
  kind: z.enum(["ROOM", "EQUIPMENT", "BED"]),
  status: z.enum(["ACTIVE", "INACTIVE"])
}).strict();

const schedulingOptionsResponseSchema = z.object({
  providers: boundedList(providerSchema),
  services: boundedList(serviceSchema),
  resources: boundedList(resourceSchema)
}).strict();

/** Schemas owned by AUD27-008; values validate response payloads, not envelopes. */
export const AUTH_OPS_RESPONSE_SCHEMAS: ReadonlyMap<string, z.ZodTypeAny> = new Map<string, z.ZodTypeAny>([
  ["HealthResponse", healthResponseSchema],
  ["ReadinessResponse", readinessResponseSchema],
  ["InboxReceipt", inboxReceiptSchema],
  ["MfaFactorResponse", mfaFactorResponseSchema],
  ["RecoveryStartResponse", recoveryStartResponseSchema],
  ["DemoLoginResponse", demoLoginResponseSchema],
  ["LogoutResponse", logoutResponseSchema],
  ["SessionListResponse", sessionListResponseSchema],
  ["SessionRevokeResponse", sessionRevokeResponseSchema],
  ["ContextListResponse", contextListResponseSchema],
  ["ContextResponse", contextResponseSchema],
  ["UserListResponse", userListResponseSchema],
  ["RoleAssignmentResponse", roleAssignmentResponseSchema],
  ["AuditListResponse", auditListResponseSchema],
  ["GuardianListResponse", guardianListResponseSchema],
  ["GuardianResponse", guardianResponseSchema],
  ["PatientListResponse", patientListResponseSchema],
  ["PatientResponse", patientResponseSchema],
  ["PatientMergeResponse", patientMergeResponseSchema],
  ["AppointmentListResponse", appointmentListResponseSchema],
  ["AppointmentResponse", appointmentResponseSchema],
  ["QueueListResponse", queueListResponseSchema],
  ["QueueEntryResponse", queueEntryResponseSchema],
  ["QueueHandoffResponse", queueHandoffResponseSchema],
  ["SchedulingOptionsResponse", schedulingOptionsResponseSchema]
]);
