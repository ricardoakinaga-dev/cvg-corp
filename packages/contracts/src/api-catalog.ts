export type ApiCatalogAuth = "PUBLIC" | "SESSION" | "SESSION+CSRF" | "SESSION+ROLE" | "SESSION+CSRF+ROLE";

export interface ApiRouteDescriptor {
  version: "v1";
  method: "GET" | "POST" | "DELETE";
  path: string;
  operation: string;
  auth: ApiCatalogAuth;
  requestSchema: string | null;
  responseSchema: string;
  idempotent: boolean;
  deprecation: string | null;
}

/** Machine-readable public contract inventory. It is intentionally data-only so CI can diff it. */
export const API_ROUTE_CATALOG: readonly ApiRouteDescriptor[] = [
  { version: "v1", method: "GET", path: "/health", operation: "health.read", auth: "PUBLIC", requestSchema: null, responseSchema: "HealthResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "GET", path: "/ready", operation: "readiness.read", auth: "PUBLIC", requestSchema: null, responseSchema: "ReadinessResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/integrations/:provider/events", operation: "integration.inbox", auth: "PUBLIC", requestSchema: "IntegrationInboxEvent", responseSchema: "InboxReceipt", idempotent: true, deprecation: null },
  { version: "v1", method: "POST", path: "/auth/login", operation: "auth.login", auth: "PUBLIC", requestSchema: "LoginInput", responseSchema: "LoginResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/auth/mfa/verify", operation: "auth.mfa.verify", auth: "PUBLIC", requestSchema: "MfaVerificationInput", responseSchema: "LoginResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/auth/mfa/enroll", operation: "identity.mfa.enroll", auth: "SESSION+CSRF", requestSchema: "MfaEnrollmentInput", responseSchema: "MfaFactorResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "POST", path: "/auth/mfa/revoke", operation: "identity.mfa.revoke", auth: "SESSION+CSRF", requestSchema: "MfaFactorRevokeInput", responseSchema: "MfaFactorResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "POST", path: "/auth/recovery/start", operation: "auth.recovery.start", auth: "PUBLIC", requestSchema: "RecoveryStartInput", responseSchema: "RecoveryStartResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/auth/recovery/complete", operation: "auth.recovery.complete", auth: "PUBLIC", requestSchema: "RecoveryCompleteInput", responseSchema: "LoginResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/auth/demo", operation: "auth.demo", auth: "PUBLIC", requestSchema: null, responseSchema: "DemoLoginResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/auth/logout", operation: "auth.logout", auth: "SESSION+CSRF", requestSchema: null, responseSchema: "LogoutResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/auth/password/rotate", operation: "identity.password.rotate", auth: "SESSION+CSRF", requestSchema: "PasswordRotationInput", responseSchema: "LoginResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "GET", path: "/auth/sessions", operation: "identity.sessions.read", auth: "SESSION", requestSchema: null, responseSchema: "SessionListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/auth/sessions/:id/revoke", operation: "identity.sessions.revoke", auth: "SESSION+CSRF", requestSchema: null, responseSchema: "SessionRevokeResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "GET", path: "/me", operation: "identity.read", auth: "SESSION", requestSchema: null, responseSchema: "IdentityResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "GET", path: "/contexts", operation: "contexts.read", auth: "SESSION", requestSchema: null, responseSchema: "ContextListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "GET", path: "/context", operation: "context.select", auth: "SESSION", requestSchema: "ContextSelector", responseSchema: "ContextResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "GET", path: "/users", operation: "users.read", auth: "SESSION+ROLE", requestSchema: null, responseSchema: "UserListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/role-assignments", operation: "role.grant", auth: "SESSION+CSRF+ROLE", requestSchema: "RoleAssignmentInput", responseSchema: "RoleAssignmentResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "DELETE", path: "/role-assignments/:id", operation: "role.revoke", auth: "SESSION+CSRF+ROLE", requestSchema: null, responseSchema: "RoleAssignmentResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "GET", path: "/audit", operation: "audit.read", auth: "SESSION+ROLE", requestSchema: null, responseSchema: "AuditListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "GET", path: "/guardians", operation: "guardians.read", auth: "SESSION", requestSchema: null, responseSchema: "GuardianListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/guardians", operation: "guardians.create", auth: "SESSION+CSRF", requestSchema: "GuardianInput", responseSchema: "GuardianResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "GET", path: "/patients", operation: "patients.read", auth: "SESSION", requestSchema: null, responseSchema: "PatientListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "GET", path: "/patients/:id", operation: "patients.read", auth: "SESSION", requestSchema: null, responseSchema: "PatientResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/patients", operation: "patients.create", auth: "SESSION+CSRF", requestSchema: "PatientInput", responseSchema: "PatientResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "POST", path: "/patients/:id/disable", operation: "patients.disable", auth: "SESSION+CSRF", requestSchema: null, responseSchema: "PatientResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "POST", path: "/patients/merge", operation: "patients.merge", auth: "SESSION+CSRF", requestSchema: "PatientMergeInput", responseSchema: "PatientMergeResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "GET", path: "/appointments", operation: "appointments.read", auth: "SESSION", requestSchema: null, responseSchema: "AppointmentListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/appointments", operation: "appointments.create", auth: "SESSION+CSRF", requestSchema: "AppointmentInput", responseSchema: "AppointmentResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "GET", path: "/queue", operation: "queue.read", auth: "SESSION", requestSchema: null, responseSchema: "QueueListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/appointments/:id/check-in", operation: "queue.check-in", auth: "SESSION+CSRF", requestSchema: null, responseSchema: "QueueEntryResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "GET", path: "/encounters", operation: "encounters.read", auth: "SESSION", requestSchema: null, responseSchema: "EncounterListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/encounters", operation: "encounters.create", auth: "SESSION+CSRF", requestSchema: "EncounterInput", responseSchema: "EncounterResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "GET", path: "/clinical/documents", operation: "clinical.read", auth: "SESSION", requestSchema: null, responseSchema: "ClinicalDocumentListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/clinical/documents", operation: "clinical.write", auth: "SESSION+CSRF", requestSchema: "ClinicalDocumentInput", responseSchema: "ClinicalDocumentResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "POST", path: "/clinical/documents/:id/sign", operation: "clinical.sign", auth: "SESSION+CSRF", requestSchema: "ClinicalSignInput", responseSchema: "ClinicalDocumentResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "POST", path: "/clinical/documents/:id/addenda", operation: "clinical.addendum", auth: "SESSION+CSRF", requestSchema: "ClinicalAddendumInput", responseSchema: "ClinicalAddendumResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "GET", path: "/diagnostics/requests", operation: "diagnostics.read", auth: "SESSION", requestSchema: null, responseSchema: "DiagnosticRequestListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/diagnostics/requests", operation: "diagnostics.create", auth: "SESSION+CSRF", requestSchema: "DiagnosticRequestInput", responseSchema: "DiagnosticRequestResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "GET", path: "/diagnostics/specimens", operation: "diagnostics.specimens.read", auth: "SESSION", requestSchema: null, responseSchema: "SpecimenListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/diagnostics/requests/:id/specimens", operation: "diagnostics.specimen", auth: "SESSION+CSRF", requestSchema: "SpecimenInput", responseSchema: "SpecimenResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "POST", path: "/diagnostics/results", operation: "diagnostics.result", auth: "SESSION+CSRF", requestSchema: "ResultInput", responseSchema: "ResultResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "GET", path: "/diagnostics/results", operation: "diagnostics.results.read", auth: "SESSION", requestSchema: null, responseSchema: "ResultListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "GET", path: "/stock", operation: "stock.read", auth: "SESSION", requestSchema: null, responseSchema: "StockListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/stock/movements", operation: "stock.write", auth: "SESSION+CSRF", requestSchema: "StockMovementInput", responseSchema: "StockMovementResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "GET", path: "/hospitalization/beds", operation: "hospitalization.beds.read", auth: "SESSION", requestSchema: null, responseSchema: "BedListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "GET", path: "/hospitalization/episodes", operation: "hospitalization.read", auth: "SESSION", requestSchema: null, responseSchema: "HospitalEpisodeListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/hospitalization/episodes", operation: "hospitalization.create", auth: "SESSION+CSRF", requestSchema: "HospitalEpisodeInput", responseSchema: "HospitalEpisodeResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "GET", path: "/medications/orders", operation: "medication.read", auth: "SESSION", requestSchema: null, responseSchema: "MedicationOrderListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/medications/orders", operation: "medication.prescribe", auth: "SESSION+CSRF", requestSchema: "MedicationOrderInput", responseSchema: "MedicationOrderResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "POST", path: "/medications/orders/:id/dispense", operation: "medication.dispense", auth: "SESSION+CSRF", requestSchema: "DispensationInput", responseSchema: "DispensationResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "POST", path: "/medications/orders/:id/administer", operation: "medication.administer", auth: "SESSION+CSRF", requestSchema: "AdministrationInput", responseSchema: "AdministrationResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "GET", path: "/finance/charges", operation: "finance.read", auth: "SESSION", requestSchema: null, responseSchema: "ChargeListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/finance/charges", operation: "finance.charge", auth: "SESSION+CSRF", requestSchema: "ChargeInput", responseSchema: "ChargeResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "POST", path: "/finance/payments", operation: "finance.payment", auth: "SESSION+CSRF", requestSchema: "PaymentInput", responseSchema: "PaymentResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "GET", path: "/finance/payments", operation: "finance.payments.read", auth: "SESSION", requestSchema: null, responseSchema: "PaymentListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "GET", path: "/finance/ledger", operation: "finance.ledger.read", auth: "SESSION", requestSchema: null, responseSchema: "LedgerListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/finance/refunds", operation: "finance.refund", auth: "SESSION+CSRF", requestSchema: "RefundInput", responseSchema: "PaymentResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "GET", path: "/communications", operation: "communication.read", auth: "SESSION", requestSchema: null, responseSchema: "CommunicationListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/communications", operation: "communication.stage", auth: "SESSION+CSRF", requestSchema: "CommunicationInput", responseSchema: "CommunicationResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "POST", path: "/communications/:id/approve", operation: "communication.approve", auth: "SESSION+CSRF", requestSchema: "CommunicationApprovalInput", responseSchema: "CommunicationResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "GET", path: "/knowledge", operation: "knowledge.read", auth: "SESSION", requestSchema: null, responseSchema: "KnowledgeListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/knowledge", operation: "knowledge.write", auth: "SESSION+CSRF", requestSchema: "KnowledgeDocumentInput", responseSchema: "KnowledgeDocumentResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "GET", path: "/capabilities", operation: "capabilities.read", auth: "SESSION", requestSchema: null, responseSchema: "CapabilityListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "GET", path: "/operations/summary", operation: "operations.summary", auth: "SESSION", requestSchema: null, responseSchema: "OperationsSummary", idempotent: false, deprecation: null },
  { version: "v1", method: "GET", path: "/metrics", operation: "metrics.read", auth: "SESSION+ROLE", requestSchema: null, responseSchema: "MetricsResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "GET", path: "/ops/snapshot", operation: "ops.snapshot", auth: "SESSION+ROLE", requestSchema: null, responseSchema: "SnapshotResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/ops/export", operation: "ops.export", auth: "SESSION+CSRF+ROLE", requestSchema: "GovernedExportInput", responseSchema: "EncryptedRecoveryBundle", idempotent: true, deprecation: null },
  { version: "v1", method: "POST", path: "/ops/restore", operation: "ops.restore", auth: "SESSION+CSRF+ROLE", requestSchema: "RestoreInput", responseSchema: "RestoreResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "GET", path: "/ai/health", operation: "ai.health", auth: "SESSION+ROLE", requestSchema: null, responseSchema: "AgentRuntimeHealth", idempotent: false, deprecation: null },
  { version: "v1", method: "GET", path: "/ai/sessions", operation: "ai.sessions.read", auth: "SESSION+ROLE", requestSchema: null, responseSchema: "AiSessionListResponse", idempotent: false, deprecation: null },
  { version: "v1", method: "POST", path: "/ai/turns", operation: "ai.turn", auth: "SESSION+CSRF", requestSchema: "AiTurnInput", responseSchema: "AgentTurnResult", idempotent: true, deprecation: null },
  { version: "v1", method: "POST", path: "/ai/approvals/:id", operation: "ai.approval", auth: "SESSION+CSRF", requestSchema: "ApprovalInput", responseSchema: "AiApprovalResponse", idempotent: true, deprecation: null },
  { version: "v1", method: "POST", path: "/ai/approvals/:id/retry", operation: "ai.approval.retry", auth: "SESSION+CSRF", requestSchema: "AiTurnInput", responseSchema: "AgentTurnResult", idempotent: true, deprecation: null },
  { version: "v1", method: "POST", path: "/ai/drafts/:id/promote", operation: "ai.draft.promote", auth: "SESSION+CSRF", requestSchema: null, responseSchema: "AgentDraftPromotion", idempotent: true, deprecation: null },
  { version: "v1", method: "GET", path: "/ai/sessions/:id/replay", operation: "ai.replay", auth: "SESSION+ROLE", requestSchema: null, responseSchema: "AgentReplayResult", idempotent: false, deprecation: null }
] as const;

export const API_V2_COMPATIBILITY = {
  status: "PREPARED_ONLY",
  basePath: "/api/v2",
  migration: "v1 envelopes remain supported until an approved deprecation window; no v2 route is enabled",
  upcasters: "NOT_IMPLEMENTED"
} as const;

export function apiCatalogFingerprint(catalog: readonly ApiRouteDescriptor[] = API_ROUTE_CATALOG): string {
  let hash = 2_166_136_261;
  for (const character of JSON.stringify(catalog)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
