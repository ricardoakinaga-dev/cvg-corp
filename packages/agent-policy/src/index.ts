import type { CvgContext, DataClass, OpaqueId, Role } from "@cvg/contracts";

export type PolicyRisk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type PolicyDecisionStatus = "ALLOW" | "DENY" | "APPROVAL_REQUIRED";
export type PolicyApprovalMode = "NONE" | "SAME_ACTOR" | "INDEPENDENT";

export interface PolicyResource {
  organizationId: OpaqueId;
  unitId: OpaqueId | null;
  workspaceId: OpaqueId | null;
  resourceId: OpaqueId | null;
  dataClass: DataClass;
}

export interface PolicyApprovalBinding {
  approvalId: OpaqueId;
  actorId: OpaqueId;
  approverId: OpaqueId | null;
  requestDigest: string;
  policyRevision: string;
  expiresAt: string;
  oneShot: boolean;
  consumed: boolean;
}

export interface PolicyRequest {
  context: CvgContext;
  operation: string;
  sessionId: OpaqueId | null;
  purpose: string;
  capability: string;
  risk: PolicyRisk;
  requiresApproval: boolean;
  approvalMode: PolicyApprovalMode;
  allowedRoles: readonly Role[];
  acceptedDataClasses: readonly DataClass[];
  resource: PolicyResource;
  requestDigest: string;
  constraints: Readonly<Record<string, string | number | boolean | null>>;
  approval?: PolicyApprovalBinding;
}

export interface PolicyObligation {
  kind: "HUMAN_APPROVAL" | "AUDIT" | "IDEMPOTENCY" | "CONTEXT_REVALIDATION";
  details: Record<string, string | number | boolean | null>;
}

export interface PolicyDecision {
  status: PolicyDecisionStatus;
  policyRevision: string;
  reason: string;
  obligations: PolicyObligation[];
}

export interface PolicyDecisionPoint {
  readonly revision: string;
  evaluate(request: PolicyRequest): PolicyDecision;
}

export class PolicyEvaluationError extends Error {
  readonly code: "POLICY_DENIED" | "APPROVAL_REQUIRED" | "INVALID_STATE";
  readonly decision: PolicyDecision;

  constructor(code: PolicyEvaluationError["code"], decision: PolicyDecision) {
    super(decision.reason);
    this.name = "PolicyEvaluationError";
    this.code = code;
    this.decision = decision;
  }
}

function deny(revision: string, reason: string): PolicyDecision {
  return { status: "DENY", policyRevision: revision, reason, obligations: [{ kind: "AUDIT", details: { result: "DENIED" } }] };
}

function approvalRequired(revision: string, request: PolicyRequest): PolicyDecision {
  return {
    status: "APPROVAL_REQUIRED",
    policyRevision: revision,
    reason: "A operação exige aprovação humana vinculada ao contexto e aos argumentos.",
    obligations: [
      { kind: "HUMAN_APPROVAL", details: { operation: request.operation, risk: request.risk, oneShot: true } },
      { kind: "AUDIT", details: { result: "UNKNOWN" } },
      { kind: "IDEMPOTENCY", details: { required: true } }
    ]
  };
}

function approvalIsValid(request: PolicyRequest, approval: PolicyApprovalBinding): boolean {
  return approval.actorId === request.context.actorId
    && approval.approverId !== null
    && (request.approvalMode !== "INDEPENDENT" || approval.approverId !== approval.actorId)
    && approval.requestDigest === request.requestDigest
    && approval.policyRevision === request.context.policyRevision
    && Date.parse(approval.expiresAt) > Date.now()
    && approval.oneShot
    && !approval.consumed;
}

/**
 * Evaluates actor, resource, context, data-class and approval obligations in one place.
 * The PDP has no persistence or provider dependency; callers persist its decision and audit.
 */
export class StaticPolicyDecisionPoint implements PolicyDecisionPoint {
  readonly revision: string;

  constructor(revision = "policy-vnext-1") {
    this.revision = revision;
  }

  evaluate(request: PolicyRequest): PolicyDecision {
    const { context, resource } = request;
    if (typeof request.operation !== "string" || !request.operation.trim() || typeof request.capability !== "string" || !/^[a-z][a-z0-9._:-]{1,119}$/.test(request.capability)) return deny(this.revision, "A operação e a capability precisam ser identificadas por uma policy válida.");
    if (request.sessionId === null || context.sessionId === null || request.sessionId !== context.sessionId) return deny(this.revision, "A sessão da solicitação não corresponde ao contexto autenticado.");
    if (!request.constraints || typeof request.constraints !== "object" || Array.isArray(request.constraints)) return deny(this.revision, "As constraints da policy são inválidas.");
    const registeredRule = applicationPolicyFor(request.operation);
    if (!registeredRule) return deny(this.revision, `A operação ${request.operation} não possui uma policy canônica registrada.`);
    if (registeredRule.capability !== request.capability) return deny(this.revision, "A capability não corresponde à operação registrada.");
    const riskRank: Record<PolicyRisk, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
    if (riskRank[request.risk] < riskRank[registeredRule.risk]) return deny(this.revision, "O risco declarado não pode ser menor que o risco da policy canônica.");
    if (registeredRule.requiresApproval && !request.requiresApproval) return deny(this.revision, "A policy canônica exige aprovação humana.");
    if (registeredRule.approvalMode === "INDEPENDENT" && request.approvalMode !== "INDEPENDENT") return deny(this.revision, "A policy canônica exige aprovação independente.");
    if (request.allowedRoles.some((role) => !registeredRule.allowedRoles.includes(role))) return deny(this.revision, "O descriptor declara uma role fora da policy canônica.");
    if (request.acceptedDataClasses.some((dataClass) => !registeredRule.acceptedDataClasses.includes(dataClass))) return deny(this.revision, "O descriptor declara uma classe de dados fora da policy canônica.");
    if (resource.resourceId !== null && typeof resource.resourceId !== "string") return deny(this.revision, "O recurso-alvo da policy é inválido.");
    if (request.constraints.resourceRequired === true && resource.resourceId === null) return deny(this.revision, "A operação exige um recurso-alvo explícito.");
    if (request.operation === "patients.read" && context.patientId !== null && resource.resourceId !== context.patientId) return deny(this.revision, "O paciente-alvo não corresponde ao contexto revalidado.");
    const notBefore = request.constraints.notBefore;
    if (notBefore !== undefined && (typeof notBefore !== "string" || !Number.isFinite(Date.parse(notBefore)) || Date.parse(notBefore) > Date.now())) return deny(this.revision, "A janela temporal da policy ainda não começou.");
    const expiresAt = request.constraints.expiresAt;
    if (expiresAt !== undefined && (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) return deny(this.revision, "A janela temporal da policy expirou.");
    if (context.organizationId !== resource.organizationId) return deny(this.revision, "O recurso pertence a outra organização.");
    if (!request.purpose.trim() || request.purpose !== context.purpose) return deny(this.revision, "A operação precisa estar vinculada à finalidade do contexto.");
    if (!context.actorRoleSnapshot.some((role) => request.allowedRoles.includes(role))) return deny(this.revision, "O ator não possui uma role permitida para esta capability.");
    if (!request.acceptedDataClasses.includes(resource.dataClass)) return deny(this.revision, "A classe de dados não é aceita por esta capability.");
    if (resource.unitId !== null && context.unitId !== resource.unitId) return deny(this.revision, "A unidade do recurso não corresponde ao contexto selecionado.");
    if (resource.workspaceId !== null && context.workspaceId !== resource.workspaceId) return deny(this.revision, "O workspace do recurso não corresponde ao contexto selecionado.");
    if (!context.unitId && (resource.unitId !== null || resource.workspaceId !== null)) return deny(this.revision, "Unidade e workspace são obrigatórios para este recurso.");
    if ((request.risk === "HIGH" || request.risk === "CRITICAL") && request.approvalMode !== "INDEPENDENT") return deny(this.revision, "Operações de alto impacto exigem aprovação independente.");
    if (request.requiresApproval || request.risk === "HIGH" || request.risk === "CRITICAL") {
      if (!request.approval) return approvalRequired(this.revision, request);
      if (!approvalIsValid(request, request.approval)) return deny(this.revision, "A aprovação expirou, foi consumida ou não está vinculada aos argumentos e à política atuais.");
    }
    return {
      status: "ALLOW",
      policyRevision: this.revision,
      reason: "A operação está autorizada no contexto atual.",
      obligations: [
        { kind: "AUDIT", details: { result: "ALLOWED" } },
        { kind: "IDEMPOTENCY", details: { required: true } },
        { kind: "CONTEXT_REVALIDATION", details: { required: true } }
      ]
    };
  }
}

export function assertPolicyAllowed(decision: PolicyDecision): void {
  if (decision.status === "DENY") throw new PolicyEvaluationError("POLICY_DENIED", decision);
  if (decision.status === "APPROVAL_REQUIRED") throw new PolicyEvaluationError("APPROVAL_REQUIRED", decision);
}

export interface ApplicationPolicyRule {
  operation: string;
  capability: string;
  allowedRoles: readonly Role[];
  acceptedDataClasses: readonly DataClass[];
  risk: PolicyRisk;
  approvalMode: PolicyApprovalMode;
  requiresApproval: boolean;
}

export interface ApplicationPolicyAuthorizationOptions {
  resourceId?: OpaqueId | null;
  dataClass?: DataClass;
  requestDigest?: string;
  resourceUnitId?: OpaqueId | null;
  resourceWorkspaceId?: OpaqueId | null;
  resourceRequired?: boolean;
}

export type ToolEgressPolicy = "NONE" | "LOCAL_ONLY" | "EXTERNAL_PROVIDER";

export interface ToolPolicyRule {
  toolName: string;
  operation: string;
  capability: string;
  risk: PolicyRisk;
  approvalMode: PolicyApprovalMode;
  allowedRoles: readonly Role[];
  acceptedDataClasses: readonly DataClass[];
  scope: "ORGANIZATION" | "UNIT" | "WORKSPACE";
  resourceRequired: boolean;
  requiresApproval: boolean;
  idempotency: "REQUIRED" | "OPTIONAL";
  auditAction: string;
  secretRefs: readonly string[];
  egress: ToolEgressPolicy;
}

const allApplicationRoles: readonly Role[] = ["admin", "veterinario", "recepcao", "operador", "financeiro", "estoque", "workspace_manager"];
const clinicalRoles: readonly Role[] = ["admin", "veterinario"];
const receptionRoles: readonly Role[] = ["admin", "recepcao", "veterinario"];
const patientRoles: readonly Role[] = ["admin", "veterinario", "recepcao", "financeiro", "estoque"];
const appointmentRoles: readonly Role[] = ["admin", "recepcao", "veterinario", "estoque", "financeiro"];
const aiRoles: readonly Role[] = ["admin", "veterinario", "recepcao"];
const d0: readonly DataClass[] = ["D0"];
const d2: readonly DataClass[] = ["D2"];
const d3: readonly DataClass[] = ["D3"];
const d4: readonly DataClass[] = ["D4"];

function applicationRule(operation: string, capability: string, allowedRoles: readonly Role[], acceptedDataClasses: readonly DataClass[], risk: PolicyRisk = "LOW"): ApplicationPolicyRule {
  return { operation, capability, allowedRoles, acceptedDataClasses, risk, approvalMode: "NONE", requiresApproval: false };
}

/**
 * The application boundary has an explicit policy catalog independent from the
 * domain implementation. Routes must resolve a rule before a repository or
 * use-case is allowed to run; an absent rule is a deployment defect, not an
 * implicit allow.
 */
export const APPLICATION_POLICY_REGISTRY: readonly ApplicationPolicyRule[] = [
  applicationRule("identity.read", "identity:read", allApplicationRoles, d0),
  applicationRule("identity.sessions.read", "identity:sessions:read", allApplicationRoles, d0),
  applicationRule("identity.sessions.revoke", "identity:sessions:revoke", allApplicationRoles, d0, "MEDIUM"),
  applicationRule("identity.password.rotate", "identity:password:rotate", allApplicationRoles, d0, "MEDIUM"),
  applicationRule("identity.mfa.enroll", "identity:mfa:enroll", allApplicationRoles, d0, "MEDIUM"),
  applicationRule("identity.mfa.revoke", "identity:mfa:revoke", allApplicationRoles, d0, "MEDIUM"),
  applicationRule("auth.logout", "auth:logout", allApplicationRoles, d0),
  applicationRule("contexts.read", "contexts:read", allApplicationRoles, d0),
  applicationRule("context.select", "context:select", allApplicationRoles, d0),
  applicationRule("users.read", "users:read", ["admin"], d4),
  applicationRule("role.grant", "role:grant", ["admin"], d4, "MEDIUM"),
  applicationRule("role.revoke", "role:revoke", ["admin"], d4, "MEDIUM"),
  applicationRule("audit.read", "audit:read", ["admin"], d4),
  applicationRule("guardians.read", "guardians:read", ["admin", "veterinario", "recepcao"], d2),
  applicationRule("guardians.create", "guardians:create", ["admin", "recepcao"], d2, "MEDIUM"),
  applicationRule("patients.read", "patients:read", patientRoles, d3),
  applicationRule("patients.create", "patients:create", receptionRoles, d3, "MEDIUM"),
  applicationRule("patients.disable", "patients:disable", receptionRoles, d3, "MEDIUM"),
  applicationRule("patients.merge", "patients:merge", clinicalRoles, d3, "MEDIUM"),
  applicationRule("appointments.read", "appointments:read", appointmentRoles, d2),
  applicationRule("appointments.create", "appointments:create", receptionRoles, d2, "MEDIUM"),
  applicationRule("queue.read", "queue:read", receptionRoles, d2),
  applicationRule("queue.check-in", "queue:check-in", receptionRoles, d2, "MEDIUM"),
  applicationRule("encounters.read", "encounters:read", clinicalRoles, d3),
  applicationRule("encounters.create", "encounters:create", clinicalRoles, d3, "MEDIUM"),
  applicationRule("clinical.read", "clinical:read", clinicalRoles, d3),
  applicationRule("clinical.write", "clinical:write", clinicalRoles, d3, "MEDIUM"),
  applicationRule("clinical.draft", "clinical:draft", clinicalRoles, d3, "MEDIUM"),
  applicationRule("clinical.sign", "clinical:sign", ["veterinario"], d3, "MEDIUM"),
  applicationRule("clinical.addendum", "clinical:addendum", ["veterinario"], d3, "MEDIUM"),
  applicationRule("diagnostics.read", "diagnostics:read", clinicalRoles, d3),
  applicationRule("diagnostics.create", "diagnostics:create", ["veterinario"], d3, "MEDIUM"),
  applicationRule("diagnostics.specimens.read", "diagnostics:specimens:read", clinicalRoles, d3),
  applicationRule("diagnostics.specimen", "diagnostics:specimen", ["veterinario"], d3, "MEDIUM"),
  applicationRule("diagnostics.result", "diagnostics:result", ["veterinario"], d3, "MEDIUM"),
  applicationRule("diagnostics.results.read", "diagnostics:results:read", clinicalRoles, d3),
  applicationRule("stock.read", "stock:read", ["admin", "estoque", "veterinario"], d2),
  applicationRule("stock.write", "stock:write", ["admin", "estoque"], d2, "MEDIUM"),
  applicationRule("stock.dispense", "stock:write", ["admin", "estoque"], d2, "CRITICAL"),
  applicationRule("hospitalization.beds.read", "hospitalization:beds-read", clinicalRoles, d3),
  applicationRule("hospitalization.read", "hospitalization:read", clinicalRoles, d3),
  applicationRule("hospitalization.create", "hospitalization:create", ["veterinario"], d3, "MEDIUM"),
  applicationRule("medication.read", "medication:read", ["admin", "veterinario", "estoque"], d3),
  applicationRule("medication.prescribe", "medication:prescribe", ["veterinario"], d3, "MEDIUM"),
  applicationRule("medication.dispense", "medication:dispense", ["admin", "estoque"], d3, "MEDIUM"),
  applicationRule("medication.administer", "medication:administer", ["veterinario"], d3, "MEDIUM"),
  applicationRule("finance.read", "finance:read", ["admin", "financeiro"], d2),
  applicationRule("finance.charge", "finance:charge", ["admin", "financeiro"], d2, "MEDIUM"),
  applicationRule("finance.payment", "finance:payment", ["admin", "financeiro"], d2, "MEDIUM"),
  applicationRule("finance.payments.read", "finance:payments:read", ["admin", "financeiro"], d2),
  applicationRule("finance.ledger.read", "finance:ledger:read", ["admin", "financeiro"], d2),
  applicationRule("finance.refund", "finance:refund", ["admin", "financeiro"], d2, "MEDIUM"),
  applicationRule("communication.read", "communication:read", receptionRoles, d2),
  applicationRule("communication.stage", "communication:stage", receptionRoles, d2, "MEDIUM"),
  applicationRule("communication.approve", "communication:approve", ["admin", "veterinario"], d2, "MEDIUM"),
  applicationRule("knowledge.read", "knowledge:read", receptionRoles, d2),
  applicationRule("knowledge.write", "knowledge:write", clinicalRoles, d2, "MEDIUM"),
  applicationRule("ai.health", "ai:health", aiRoles, d2),
  applicationRule("ai.sessions.read", "ai:sessions:read", aiRoles, d2),
  applicationRule("ai.turn", "ai:turn", aiRoles, d3, "MEDIUM"),
  applicationRule("ai.approval", "ai:approval", ["admin", "veterinario", "recepcao", "estoque", "financeiro"], d3, "MEDIUM"),
  applicationRule("ai.approval.retry", "ai:approval:retry", aiRoles, d3, "MEDIUM"),
  applicationRule("ai.draft.promote", "ai:draft:promote", ["veterinario"], d3, "MEDIUM"),
  applicationRule("ai.replay", "ai:replay", aiRoles, d3),
  applicationRule("capabilities.read", "capabilities:read", allApplicationRoles, d0),
  applicationRule("operations.summary", "operations:summary", appointmentRoles, d2),
  applicationRule("metrics.read", "metrics:read", ["admin", "operador"], d4),
  applicationRule("ops.snapshot", "ops:snapshot", ["admin"], d4, "MEDIUM"),
  applicationRule("ops.export", "ops:export", ["admin"], d4, "MEDIUM"),
  applicationRule("ops.restore", "ops:restore", ["admin"], d4, "MEDIUM")
];

const toolPolicy = (
  toolName: string,
  operation: string,
  capability: string,
  risk: PolicyRisk,
  approvalMode: PolicyApprovalMode,
  allowedRoles: readonly Role[],
  acceptedDataClasses: readonly DataClass[],
  scope: ToolPolicyRule["scope"],
  resourceRequired: boolean,
  requiresApproval: boolean
): ToolPolicyRule => ({ toolName, operation, capability, risk, approvalMode, allowedRoles, acceptedDataClasses, scope, resourceRequired, requiresApproval, idempotency: "REQUIRED", auditAction: operation, secretRefs: [], egress: "LOCAL_ONLY" });

/** Exact metadata for the model-visible tool registry. A tool cannot be
 * registered or executed by merely declaring a looser descriptor. */
export const TOOL_POLICY_REGISTRY: readonly ToolPolicyRule[] = [
  toolPolicy("cvg.patient.read", "patients.read", "patients:read", "LOW", "NONE", ["admin", "veterinario", "recepcao"], d3, "WORKSPACE", true, false),
  toolPolicy("cvg.agenda.read", "appointments.read", "appointments:read", "LOW", "NONE", ["admin", "veterinario", "recepcao"], d2, "WORKSPACE", false, false),
  toolPolicy("cvg.clinical.draft", "clinical.draft", "clinical:draft", "MEDIUM", "NONE", ["admin", "veterinario"], d3, "WORKSPACE", true, false),
  toolPolicy("cvg.communication.stage", "communication.stage", "communication:stage", "MEDIUM", "SAME_ACTOR", ["admin", "veterinario", "recepcao"], d2, "WORKSPACE", false, true),
  toolPolicy("cvg.stock.dispense", "stock.dispense", "stock:write", "CRITICAL", "INDEPENDENT", ["admin", "estoque"], d2, "UNIT", true, true),
  toolPolicy("cvg.finance.refund", "finance.refund", "finance:refund", "CRITICAL", "INDEPENDENT", ["admin", "financeiro"], d2, "UNIT", true, true)
];

const applicationPolicyByOperation = new Map(APPLICATION_POLICY_REGISTRY.map((rule) => [rule.operation, rule]));

export function applicationPolicyFor(operation: string): ApplicationPolicyRule | null {
  if (operation.startsWith("ai.turn.")) return applicationPolicyByOperation.get("ai.turn") ?? null;
  return applicationPolicyByOperation.get(operation) ?? null;
}

const toolPolicyByName = new Map(TOOL_POLICY_REGISTRY.map((rule) => [rule.toolName, rule]));

export function toolPolicyFor(toolName: string): ToolPolicyRule | null {
  return toolPolicyByName.get(toolName) ?? null;
}

export function authorizeApplicationRequest(context: CvgContext, operation: string, options: ApplicationPolicyAuthorizationOptions = {}): PolicyDecision {
  if (!context.sessionId) return deny(context.policyRevision, "A sessão autenticada é obrigatória para a policy de aplicação.");
  const rule = applicationPolicyFor(operation);
  if (!rule) return deny(context.policyRevision, `A operação ${operation} não possui uma policy de aplicação registrada.`);
  const dataClass = options.dataClass ?? rule.acceptedDataClasses[0] ?? "D0";
  return new StaticPolicyDecisionPoint(context.policyRevision).evaluate({
    context,
    operation: rule.operation,
    sessionId: context.sessionId,
    purpose: context.purpose,
    capability: rule.capability,
    risk: rule.risk,
    requiresApproval: rule.requiresApproval,
    approvalMode: rule.approvalMode,
    allowedRoles: rule.allowedRoles,
    acceptedDataClasses: rule.acceptedDataClasses,
    resource: { organizationId: context.organizationId, unitId: options.resourceUnitId === undefined ? context.unitId : options.resourceUnitId, workspaceId: options.resourceWorkspaceId === undefined ? context.workspaceId : options.resourceWorkspaceId, resourceId: options.resourceId ?? null, dataClass },
    requestDigest: options.requestDigest ?? context.correlationId,
    constraints: { source: "api-application-boundary", resourceRequired: options.resourceRequired ?? (options.resourceId !== undefined && options.resourceId !== null) }
  });
}

/** Reusable guard for application/use-case boundaries below the HTTP layer. */
export function enforceApplicationPolicy(context: CvgContext, operation: string, options: ApplicationPolicyAuthorizationOptions = {}): void {
  assertPolicyAllowed(authorizeApplicationRequest(context, operation, options));
}
