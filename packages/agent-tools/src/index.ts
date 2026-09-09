import { createHash } from "node:crypto";
import type { CvgContext, DataClass, OpaqueId, Role } from "@cvg/contracts";
import { assertPolicyAllowed, type PolicyApprovalMode, type PolicyDecision, type PolicyDecisionPoint, type PolicyResource, type PolicyRisk } from "@cvg/agent-policy";

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

function requestDigest(tool: ToolDescriptor, request: ToolExecutionRequest, parsedInput: unknown): string {
  return createHash("sha256").update(stableSerialize({ version: 2, tool: tool.name, toolVersion: tool.version, operation: tool.operation, sessionId: request.sessionId, actorId: request.context.actorId, organizationId: request.context.organizationId, unitId: request.context.unitId, workspaceId: request.context.workspaceId, resourceId: request.resource.resourceId, dataClass: request.resource.dataClass, input: parsedInput, idempotencyKey: request.idempotencyKey })).digest("hex");
}

export interface AuthorizedToolExecution {
  requestDigest: string;
  policyRevision: string;
  decision: PolicyDecision;
  descriptor: ToolDescriptor;
  parsedInput: unknown;
}

/**
 * The only execution entry point for model-visible tools. It delegates authorization to the PDP and never performs implicit egress.
 */
export class ToolGateway {
  private readonly descriptors = new Map<string, ToolDescriptor>();
  private readonly completed = new Map<string, { requestDigest: string; result: ToolExecutionResult<unknown> }>();
  private readonly inFlight = new Map<string, { requestDigest: string; promise: Promise<ToolExecutionResult<unknown>> }>();

  constructor(private readonly policy: PolicyDecisionPoint) {}

  register<TInput>(descriptor: ToolDescriptor<TInput>): void {
    if (!/^[a-z][a-z0-9._:-]{2,119}$/.test(descriptor.name) || !/^\d+\.\d+\.\d+$/.test(descriptor.version) || !descriptor.operation.trim() || descriptor.timeoutMs < 100 || descriptor.timeoutMs > 120_000) throw new ToolGatewayError("INVALID_INPUT", "Tool descriptor inválido.");
    if (descriptor.allowedRoles.length === 0 || descriptor.acceptedDataClasses.length === 0 || (descriptor.egress === "NONE" && descriptor.secretRefs.length > 0) || (descriptor.egress === "EXTERNAL_PROVIDER" && descriptor.secretRefs.length === 0)) throw new ToolGatewayError("INVALID_INPUT", "A metadata de role, classe de dados, segredo e egress da tool é inválida.", { name: descriptor.name });
    if ((descriptor.requiresApproval && descriptor.approvalMode === "NONE") || (!descriptor.requiresApproval && descriptor.approvalMode !== "NONE") || ((descriptor.risk === "HIGH" || descriptor.risk === "CRITICAL") && descriptor.approvalMode !== "INDEPENDENT")) throw new ToolGatewayError("INVALID_INPUT", "A combinação de risco e aprovação da tool é inválida.", { name: descriptor.name });
    if (descriptor.idempotency === "REQUIRED" && !descriptor.auditAction.trim()) throw new ToolGatewayError("INVALID_INPUT", "Tool com idempotência obrigatória precisa de auditAction.", { name: descriptor.name });
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
    if (request.sessionId !== request.context.sessionId || !request.context.sessionId) throw new ToolGatewayError("POLICY_DENIED", "A tool exige uma sessão autenticada vinculada ao contexto.");
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(request.idempotencyKey)) throw new ToolGatewayError("INVALID_INPUT", "A chave de idempotência da tool é inválida.");
    if (request.resource.organizationId !== request.context.organizationId) throw new ToolGatewayError("POLICY_DENIED", "O recurso da tool pertence a outra organização.");
    if (descriptor.resourceRequired && request.resource.resourceId === null) throw new ToolGatewayError("POLICY_DENIED", "A tool exige um recurso-alvo explícito.");
    if (descriptor.scope === "UNIT" && request.resource.unitId === null) throw new ToolGatewayError("POLICY_DENIED", "A tool exige um alvo de unidade.");
    if (descriptor.scope === "WORKSPACE" && (request.resource.unitId === null || request.resource.workspaceId === null)) throw new ToolGatewayError("POLICY_DENIED", "A tool exige um alvo de unidade e workspace.");
    const parsedInput = (() => {
      try { return descriptor.parseInput(request.input); } catch (error) { throw new ToolGatewayError("INVALID_INPUT", "A entrada da tool não atende ao schema.", { cause: error instanceof Error ? error.message : String(error) }); }
    })();
    const digest = request.requestDigest ?? requestDigest(descriptor, request, parsedInput);
    const decision = this.policy.evaluate({ context: request.context, operation: descriptor.operation, sessionId: request.sessionId, purpose: request.context.purpose, capability: descriptor.capability, risk: descriptor.risk, requiresApproval: descriptor.requiresApproval, approvalMode: descriptor.approvalMode, allowedRoles: descriptor.allowedRoles, acceptedDataClasses: descriptor.acceptedDataClasses, resource: request.resource, requestDigest: digest, constraints: { resourceRequired: descriptor.resourceRequired, scope: descriptor.scope, egress: descriptor.egress }, ...(request.approval ? { approval: { ...request.approval } } : {}) });
    try { assertPolicyAllowed(decision); } catch (error) {
      if (error instanceof Error && "code" in error && (error as { code?: unknown }).code === "APPROVAL_REQUIRED") throw new ToolGatewayError("APPROVAL_REQUIRED", decision.reason, { requestDigest: digest, policyRevision: decision.policyRevision });
      throw new ToolGatewayError("POLICY_DENIED", decision.reason, { requestDigest: digest, policyRevision: decision.policyRevision });
    }
    return { requestDigest: digest, policyRevision: decision.policyRevision, decision, descriptor, parsedInput };
  }

  async execute<TInput, TOutput>(name: string, request: ToolExecutionRequest, executor: (input: TInput, signal: AbortSignal) => Promise<TOutput>): Promise<ToolExecutionResult<TOutput>> {
    const authorized = this.authorize(name, request);
    const descriptor = authorized.descriptor as ToolDescriptor<TInput>;
    const key = `${name}:${request.idempotencyKey}`;
    const prior = this.completed.get(key);
    if (prior) {
      if (prior.requestDigest !== authorized.requestDigest) throw new ToolGatewayError("IDEMPOTENCY_CONFLICT", "A chave de idempotência já foi usada com argumentos diferentes.", { name, idempotencyKey: request.idempotencyKey });
      return prior.result as ToolExecutionResult<TOutput>;
    }
    const running = this.inFlight.get(key);
    if (running) {
      if (running.requestDigest !== authorized.requestDigest) throw new ToolGatewayError("IDEMPOTENCY_CONFLICT", "A chave de idempotência está em execução com argumentos diferentes.", { name, idempotencyKey: request.idempotencyKey });
      return await running.promise as ToolExecutionResult<TOutput>;
    }
    const promise = this.runExecutor(descriptor, authorized, executor);
    this.inFlight.set(key, { requestDigest: authorized.requestDigest, promise: promise as Promise<ToolExecutionResult<unknown>> });
    try {
      const result = await promise;
      this.completed.set(key, { requestDigest: authorized.requestDigest, result: result as ToolExecutionResult<unknown> });
      return result;
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

export function toolRegistryDigest(tools: readonly ToolDescriptor[]): string {
  return createHash("sha256").update(stableSerialize(tools.map(({ parseInput: _parseInput, ...descriptor }) => descriptor))).digest("hex");
}
