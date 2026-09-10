import { createHash } from "node:crypto";
import type { CvgContext, DataClass, OpaqueId, Role } from "@cvg/contracts";
import { applicationPolicyFor, assertPolicyAllowed, toolPolicyFor, type PolicyApprovalMode, type PolicyDecision, type PolicyDecisionPoint, type PolicyResource, type PolicyRisk } from "@cvg/agent-policy";

export type ToolEgress = "NONE" | "LOCAL_ONLY" | "EXTERNAL_PROVIDER";

export interface ToolDescriptor<TInput = unknown> {
  name: string;
  version: string;
  description: string;
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
  timeoutMs: number;
  egress: ToolEgress;
  parseInput: (value: unknown) => TInput;
}

export interface ToolExecutionRequest {
  context: CvgContext;
  sessionId: OpaqueId;
  resource: PolicyResource;
  input: unknown;
  idempotencyKey: string;
  requestDigest?: string;
  approval?: {
    approvalId: OpaqueId;
    actorId: OpaqueId;
    approverId: OpaqueId | null;
    requestDigest: string;
    policyRevision: string;
    expiresAt: string;
    oneShot: boolean;
    consumed: boolean;
  };
}

export interface ToolExecutionResult<TOutput> {
  result: TOutput;
  requestDigest: string;
  policyRevision: string;
  decision: PolicyDecision;
  descriptor: ToolDescriptor;
}

export class ToolGatewayError extends Error {
  readonly code: "INVALID_INPUT" | "POLICY_DENIED" | "APPROVAL_REQUIRED" | "CAPABILITY_DISABLED" | "IDEMPOTENCY_CONFLICT" | "OUTCOME_UNKNOWN";
  readonly details: Record<string, unknown>;

  constructor(code: ToolGatewayError["code"], message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ToolGatewayError";
    this.code = code;
    this.details = details;
  }
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${stableSerialize(nested)}`).join(",")}}`;
}

/** Computes the canonical digest used to bind a tool request to its policy decision. */
export function toolExecutionDigest(tool: ToolDescriptor, request: ToolExecutionRequest, parsedInput: unknown): string {
  return createHash("sha256").update(stableSerialize({ version: 2, tool: tool.name, toolVersion: tool.version, operation: tool.operation, sessionId: request.sessionId, actorId: request.context.actorId, organizationId: request.context.organizationId, unitId: request.context.unitId, workspaceId: request.context.workspaceId, resourceId: request.resource.resourceId, dataClass: request.resource.dataClass, input: parsedInput })).digest("hex");
}

export interface AuthorizedToolExecution {
  requestDigest: string;
  policyRevision: string;
  decision: PolicyDecision;
  descriptor: ToolDescriptor;
  parsedInput: unknown;
}

export interface ToolExecutionLedgerInput {
  lookup: string;
  requestDigest: string;
  operation: string;
  organizationId: OpaqueId;
  actorId: OpaqueId;
  unitId: OpaqueId | null;
  workspaceId: OpaqueId | null;
}

export interface ToolExecutionLedgerRecord {
  requestDigest: string;
  result: unknown;
  policyRevision: string;
  decision: PolicyDecision;
}

export type ToolExecutionLedgerClaim =
  | { status: "NEW" }
  | { status: "REPLAY"; record: ToolExecutionLedgerRecord }
  | { status: "IN_FLIGHT" | "OUTCOME_UNKNOWN" }
  | { status: "CONFLICT" };

/** Durable command/effect storage supplied by the application boundary. */
export interface ToolExecutionLedger {
  claim(input: ToolExecutionLedgerInput): Promise<ToolExecutionLedgerClaim> | ToolExecutionLedgerClaim;
  complete(lookup: string, record: ToolExecutionLedgerRecord): Promise<void> | void;
  markOutcomeUnknown(lookup: string, requestDigest: string): Promise<void> | void;
  markFailed(lookup: string, requestDigest: string): Promise<void> | void;
}

/** Explicitly ephemeral fixture for isolated gateway tests; production wiring uses the domain ledger. */
export class InMemoryToolExecutionLedger implements ToolExecutionLedger {
  private readonly records = new Map<string, { state: "IN_FLIGHT" | "SUCCEEDED" | "OUTCOME_UNKNOWN" | "FAILED"; requestDigest: string; record?: ToolExecutionLedgerRecord }>();

  claim(input: ToolExecutionLedgerInput): ToolExecutionLedgerClaim {
    const existing = this.records.get(input.lookup);
    if (!existing) {
      this.records.set(input.lookup, { state: "IN_FLIGHT", requestDigest: input.requestDigest });
      return { status: "NEW" };
    }
    if (existing.requestDigest !== input.requestDigest) return { status: "CONFLICT" };
    if (existing.state === "SUCCEEDED" && existing.record) return { status: "REPLAY", record: existing.record };
    if (existing.state === "OUTCOME_UNKNOWN") return { status: "OUTCOME_UNKNOWN" };
    if (existing.state === "IN_FLIGHT") return { status: "IN_FLIGHT" };
    return { status: "CONFLICT" };
  }

  complete(lookup: string, record: ToolExecutionLedgerRecord): void {
    const existing = this.records.get(lookup);
    if (!existing || existing.requestDigest !== record.requestDigest) throw new ToolGatewayError("IDEMPOTENCY_CONFLICT", "O ledger da tool não corresponde ao digest autorizado.");
    this.records.set(lookup, { state: "SUCCEEDED", requestDigest: record.requestDigest, record });
  }

  markOutcomeUnknown(lookup: string, requestDigest: string): void {
    const existing = this.records.get(lookup);
    if (existing?.requestDigest === requestDigest) this.records.set(lookup, { state: "OUTCOME_UNKNOWN", requestDigest });
  }

  markFailed(lookup: string, requestDigest: string): void {
    const existing = this.records.get(lookup);
    if (existing?.requestDigest === requestDigest) this.records.set(lookup, { state: "FAILED", requestDigest });
  }
}

/**
 * The only execution entry point for model-visible tools. It delegates authorization to the PDP and never performs implicit egress.
 */
export class ToolGateway {
  private readonly descriptors = new Map<string, ToolDescriptor>();
  private readonly inFlight = new Map<string, { requestDigest: string; promise: Promise<ToolExecutionResult<unknown>> }>();

  constructor(private readonly policy: PolicyDecisionPoint, private readonly executionLedger: ToolExecutionLedger) {}

  register<TInput>(descriptor: ToolDescriptor<TInput>): void {
    if (!/^[a-z][a-z0-9._:-]{2,119}$/.test(descriptor.name) || !/^\d+\.\d+\.\d+$/.test(descriptor.version) || !descriptor.operation.trim() || descriptor.timeoutMs < 100 || descriptor.timeoutMs > 120_000) throw new ToolGatewayError("INVALID_INPUT", "Tool descriptor inválido.");
    if (descriptor.allowedRoles.length === 0 || descriptor.acceptedDataClasses.length === 0 || (descriptor.egress === "NONE" && descriptor.secretRefs.length > 0) || (descriptor.egress === "EXTERNAL_PROVIDER" && descriptor.secretRefs.length === 0)) throw new ToolGatewayError("INVALID_INPUT", "A metadata de role, classe de dados, segredo e egress da tool é inválida.", { name: descriptor.name });
    if ((descriptor.requiresApproval && descriptor.approvalMode === "NONE") || (!descriptor.requiresApproval && descriptor.approvalMode !== "NONE") || ((descriptor.risk === "HIGH" || descriptor.risk === "CRITICAL") && descriptor.approvalMode !== "INDEPENDENT")) throw new ToolGatewayError("INVALID_INPUT", "A combinação de risco e aprovação da tool é inválida.", { name: descriptor.name });
    if (descriptor.idempotency === "REQUIRED" && !descriptor.auditAction.trim()) throw new ToolGatewayError("INVALID_INPUT", "Tool com idempotência obrigatória precisa de auditAction.", { name: descriptor.name });
    const canonicalRule = toolPolicyFor(descriptor.name);
    if (!canonicalRule || descriptor.operation !== canonicalRule.operation || descriptor.capability !== canonicalRule.capability || descriptor.risk !== canonicalRule.risk || descriptor.approvalMode !== canonicalRule.approvalMode || descriptor.resourceRequired !== canonicalRule.resourceRequired || descriptor.requiresApproval !== canonicalRule.requiresApproval || descriptor.idempotency !== canonicalRule.idempotency || descriptor.auditAction !== canonicalRule.auditAction || descriptor.egress !== canonicalRule.egress || descriptor.secretRefs.length !== canonicalRule.secretRefs.length || descriptor.allowedRoles.length !== canonicalRule.allowedRoles.length || descriptor.allowedRoles.some((role, index) => role !== canonicalRule.allowedRoles[index]) || descriptor.acceptedDataClasses.length !== canonicalRule.acceptedDataClasses.length || descriptor.acceptedDataClasses.some((dataClass, index) => dataClass !== canonicalRule.acceptedDataClasses[index]) || descriptor.scope !== canonicalRule.scope) throw new ToolGatewayError("CAPABILITY_DISABLED", "O descriptor da tool não corresponde à policy canônica registrada.", { name: descriptor.name, operation: descriptor.operation });
    if (this.descriptors.has(descriptor.name)) throw new ToolGatewayError("INVALID_INPUT", "Tool já registrada.", { name: descriptor.name });
    this.descriptors.set(descriptor.name, descriptor);
  }

  list(): readonly ToolDescriptor[] {
    return [...this.descriptors.values()];
  }

  get(name: string): ToolDescriptor | undefined {
    return this.descriptors.get(name);
  }

  authorize(name: string, request: ToolExecutionRequest): AuthorizedToolExecution {
    const descriptor = this.descriptors.get(name);
    if (!descriptor) throw new ToolGatewayError("CAPABILITY_DISABLED", "A tool não está registrada.", { name });
    const canonicalRule = applicationPolicyFor(descriptor.operation);
    const toolRule = toolPolicyFor(name);
    if (!canonicalRule || !toolRule) throw new ToolGatewayError("CAPABILITY_DISABLED", "A operação da tool não possui uma policy canônica registrada.", { name, operation: descriptor.operation });
    const riskRank: Record<PolicyRisk, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
    if (descriptor.capability !== canonicalRule.capability || riskRank[descriptor.risk] < riskRank[canonicalRule.risk] || (canonicalRule.requiresApproval && !descriptor.requiresApproval) || (canonicalRule.approvalMode === "INDEPENDENT" && descriptor.approvalMode !== "INDEPENDENT") || descriptor.allowedRoles.some((role) => !canonicalRule.allowedRoles.includes(role)) || descriptor.acceptedDataClasses.some((dataClass) => !canonicalRule.acceptedDataClasses.includes(dataClass))) throw new ToolGatewayError("CAPABILITY_DISABLED", "O descriptor da tool não corresponde à policy canônica.", { name, operation: descriptor.operation });
    if (request.sessionId !== request.context.sessionId || !request.context.sessionId) throw new ToolGatewayError("POLICY_DENIED", "A tool exige uma sessão autenticada vinculada ao contexto.");
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(request.idempotencyKey)) throw new ToolGatewayError("INVALID_INPUT", "A chave de idempotência da tool é inválida.");
    if (request.resource.organizationId !== request.context.organizationId) throw new ToolGatewayError("POLICY_DENIED", "O recurso da tool pertence a outra organização.");
    if (descriptor.resourceRequired && request.resource.resourceId === null) throw new ToolGatewayError("POLICY_DENIED", "A tool exige um recurso-alvo explícito.");
    if (descriptor.scope === "UNIT" && request.resource.unitId === null) throw new ToolGatewayError("POLICY_DENIED", "A tool exige um alvo de unidade.");
    if (descriptor.scope === "WORKSPACE" && (request.resource.unitId === null || request.resource.workspaceId === null)) throw new ToolGatewayError("POLICY_DENIED", "A tool exige um alvo de unidade e workspace.");
    const parsedInput = (() => {
      try { return descriptor.parseInput(request.input); } catch (error) { throw new ToolGatewayError("INVALID_INPUT", "A entrada da tool não atende ao schema.", { cause: error instanceof Error ? error.message : String(error) }); }
    })();
    const computedDigest = toolExecutionDigest(descriptor, request, parsedInput);
    if (request.requestDigest !== undefined && request.requestDigest !== computedDigest) throw new ToolGatewayError("IDEMPOTENCY_CONFLICT", "O digest da solicitação não corresponde aos argumentos canônicos.", { expectedDigest: computedDigest, receivedDigest: request.requestDigest });
    const decision = this.policy.evaluate({ context: request.context, operation: descriptor.operation, sessionId: request.sessionId, purpose: request.context.purpose, capability: descriptor.capability, risk: descriptor.risk, requiresApproval: descriptor.requiresApproval, approvalMode: descriptor.approvalMode, allowedRoles: descriptor.allowedRoles, acceptedDataClasses: descriptor.acceptedDataClasses, resource: request.resource, requestDigest: computedDigest, constraints: { resourceRequired: descriptor.resourceRequired, scope: descriptor.scope, egress: descriptor.egress }, ...(request.approval ? { approval: { ...request.approval } } : {}) });
    try { assertPolicyAllowed(decision); } catch (error) {
      if (error instanceof Error && "code" in error && (error as { code?: unknown }).code === "APPROVAL_REQUIRED") throw new ToolGatewayError("APPROVAL_REQUIRED", decision.reason, { requestDigest: computedDigest, policyRevision: decision.policyRevision });
      throw new ToolGatewayError("POLICY_DENIED", decision.reason, { requestDigest: computedDigest, policyRevision: decision.policyRevision });
    }
    return { requestDigest: computedDigest, policyRevision: decision.policyRevision, decision, descriptor, parsedInput };
  }

  async execute<TInput, TOutput>(name: string, request: ToolExecutionRequest, executor: (input: TInput, signal: AbortSignal) => Promise<TOutput>): Promise<ToolExecutionResult<TOutput>> {
    const authorized = this.authorize(name, request);
    const descriptor = authorized.descriptor as ToolDescriptor<TInput>;
    const key = toolExecutionLookup(name, request);
    const running = this.inFlight.get(key);
    if (running) {
      if (running.requestDigest !== authorized.requestDigest) throw new ToolGatewayError("IDEMPOTENCY_CONFLICT", "A chave de idempotência está em execução com argumentos diferentes.", { name, idempotencyKey: request.idempotencyKey });
      return await running.promise as ToolExecutionResult<TOutput>;
    }
    const claim = await this.executionLedger.claim({ lookup: key, requestDigest: authorized.requestDigest, operation: descriptor.operation, organizationId: request.context.organizationId, actorId: request.context.actorId, unitId: request.context.unitId, workspaceId: request.context.workspaceId });
    if (claim.status === "CONFLICT") throw new ToolGatewayError("IDEMPOTENCY_CONFLICT", "A chave de idempotência já foi usada com argumentos diferentes.", { name, idempotencyKey: request.idempotencyKey });
    if (claim.status === "IN_FLIGHT" || claim.status === "OUTCOME_UNKNOWN") throw new ToolGatewayError("OUTCOME_UNKNOWN", "A execução anterior permanece em reconciliação; nenhum retry cego foi feito.", { name, idempotencyKey: request.idempotencyKey });
    if (claim.status === "REPLAY") return { result: claim.record.result as TOutput, requestDigest: claim.record.requestDigest, policyRevision: claim.record.policyRevision, decision: claim.record.decision, descriptor };
    const promise = this.runExecutor(descriptor, authorized, executor);
    this.inFlight.set(key, { requestDigest: authorized.requestDigest, promise: promise as Promise<ToolExecutionResult<unknown>> });
    try {
      const result = await promise;
      await this.executionLedger.complete(key, { requestDigest: result.requestDigest, result: result.result, policyRevision: result.policyRevision, decision: result.decision });
      return result;
    } catch (error) {
      if (error instanceof ToolGatewayError && error.code === "OUTCOME_UNKNOWN") await this.executionLedger.markOutcomeUnknown(key, authorized.requestDigest);
      else await this.executionLedger.markFailed(key, authorized.requestDigest);
      throw error;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async runExecutor<TInput, TOutput>(descriptor: ToolDescriptor<TInput>, authorized: AuthorizedToolExecution, executor: (input: TInput, signal: AbortSignal) => Promise<TOutput>): Promise<ToolExecutionResult<TOutput>> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ToolGatewayError("OUTCOME_UNKNOWN", "A execução excedeu o deadline; o resultado externo é desconhecido.", { timeoutMs: descriptor.timeoutMs })); }, descriptor.timeoutMs); });
    const execution = executor(authorized.parsedInput as TInput, controller.signal);
    execution.catch(() => undefined);
    try {
      const result = await Promise.race([execution, timeout]);
      return { result, requestDigest: authorized.requestDigest, policyRevision: authorized.policyRevision, decision: authorized.decision, descriptor };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export function toolExecutionLookup(name: string, request: ToolExecutionRequest): string {
  return createHash("sha256").update(stableSerialize({ version: 1, name, idempotencyKey: request.idempotencyKey, sessionId: request.sessionId, actorId: request.context.actorId, organizationId: request.context.organizationId })).digest("hex");
}

export function toolRegistryDigest(tools: readonly ToolDescriptor[]): string {
  return createHash("sha256").update(stableSerialize(tools.map(({ parseInput: _parseInput, ...descriptor }) => descriptor))).digest("hex");
}
