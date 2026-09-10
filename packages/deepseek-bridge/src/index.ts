import { z } from "zod";
import { aiTurnInputSchema, id, roles, type AiApproval, type AiDraft, type AiSession, type AiTurn, type AiTurnInput, type CvgContext, type OpaqueId } from "@cvg/contracts";
import type { AgentDraftPromotion, AgentReplayResult, AgentRuntime, AgentRuntimeCapabilities, AgentRuntimeHealth, AgentTurnResult } from "@cvg/agent-runtime";

export const DEEPSEEK_BRIDGE_SCHEMA_VERSION = 1 as const;
export const DEEPSEEK_BRIDGE_ADAPTER_ID = "deepseek-harness-bridge" as const;

export type DeepSeekBridgeErrorCode =
  | "CAPABILITY_DISABLED"
  | "NATIVE_UNAVAILABLE"
  | "UNAUTHENTICATED"
  | "CONTRACT_MISMATCH"
  | "INVALID_REQUEST"
  | "INVALID_RESPONSE"
  | "TIMEOUT"
  | "CANCELLED"
  | "DEPENDENCY_UNAVAILABLE";

export class DeepSeekBridgeError extends Error {
  override readonly name = "DeepSeekBridgeError";

  constructor(
    readonly code: DeepSeekBridgeErrorCode,
    message: string,
    readonly retryable: boolean = false
  ) {
    super(message);
  }
}

export interface DeepSeekNativeBaseRequest {
  correlationId: string;
  signal: AbortSignal;
}

export interface DeepSeekNativeSessionRequest extends DeepSeekNativeBaseRequest {
  context: CvgContext;
  input: Pick<AiTurnInput, "purpose" | "patientId" | "encounterId">;
}

export interface DeepSeekNativeTurnRequest extends DeepSeekNativeBaseRequest {
  context: CvgContext;
  input: AiTurnInput;
  approvalId: OpaqueId | null;
}

export interface DeepSeekNativeApprovalRequest extends DeepSeekNativeBaseRequest {
  context: CvgContext;
  approvalId: OpaqueId;
  decision: "allowed-once" | "rejected";
  reason: string | null;
}

export interface DeepSeekNativePromotionRequest extends DeepSeekNativeBaseRequest {
  context: CvgContext;
  draftId: OpaqueId;
}

export interface DeepSeekNativeReplayRequest extends DeepSeekNativeBaseRequest {
  context: CvgContext;
  sessionId: OpaqueId;
}

/**
 * The only seam where a native DeepSeek Harness may be attached. This port is
 * intentionally protocol-shaped: it has no CVG business rules and never
 * receives a default implementation that talks to the network.
 */
export interface DeepSeekNativeHarnessPort {
  health(request: DeepSeekNativeBaseRequest): Promise<unknown>;
  createSession(request: DeepSeekNativeSessionRequest): Promise<unknown>;
  executeTurn(request: DeepSeekNativeTurnRequest): Promise<unknown>;
  approve(request: DeepSeekNativeApprovalRequest): Promise<unknown>;
  promoteDraft(request: DeepSeekNativePromotionRequest): Promise<unknown>;
  replay(request: DeepSeekNativeReplayRequest): Promise<unknown>;
  shutdown(request: DeepSeekNativeBaseRequest): Promise<unknown>;
}

export interface DeepSeekBridgeConfig {
  expectedEngineCommit: string;
  expectedManifestVersion: string;
  expectedToolNames: readonly string[];
  requestTimeoutMs: number;
  nativePort?: DeepSeekNativeHarnessPort;
}

export interface DeepSeekHealthWire {
  status: AgentRuntimeHealth["status"];
  engineCommit: string;
  manifestVersion: string;
  tools: string[];
  supports: AgentRuntimeCapabilities["supports"];
}

const opaqueIdSchema = z.string().trim().min(1).max(200).transform((value) => id(value));
const nullableIdSchema = opaqueIdSchema.nullable();
const correlationIdSchema = z.string().regex(/^[A-Za-z0-9._-]{1,80}$/);
const purposeSchema = z.enum(["SUMMARY", "DRAFT_CLINICAL", "KNOWLEDGE_QUERY", "OPERATIONS"]);
const contextSchema = z.object({
  organizationId: opaqueIdSchema,
  unitId: nullableIdSchema,
  workspaceId: nullableIdSchema,
  actorId: opaqueIdSchema,
  sessionId: nullableIdSchema,
  actorRoleSnapshot: z.array(z.enum(roles)).max(32),
  patientId: nullableIdSchema,
  encounterId: nullableIdSchema,
  purpose: z.string().trim().min(1).max(120),
  policyRevision: z.string().trim().min(1).max(160),
  correlationId: correlationIdSchema
}).strict();
const sessionInputSchema = z.object({
  purpose: purposeSchema,
  patientId: nullableIdSchema,
  encounterId: nullableIdSchema
}).strict();
const approvalInputSchema = z.object({
  decision: z.enum(["allowed-once", "rejected"]),
  reason: z.string().max(500).nullable()
}).strict();
const healthSchema = z.object({
  status: z.enum(["READY", "DEGRADED", "UNAVAILABLE", "DISABLED"]),
  engineCommit: z.string().trim().min(1).max(200),
  manifestVersion: z.string().trim().min(1).max(200),
  tools: z.array(z.string().trim().min(1).max(160)).max(256),
  supports: z.object({ cancellation: z.boolean(), approvals: z.boolean(), replay: z.boolean(), provenance: z.boolean() }).strict(),
  reason: z.string().trim().max(500).nullable().optional()
}).strict();
const sessionWireSchema = z.object({
  id: opaqueIdSchema,
  organizationId: opaqueIdSchema,
  actorId: opaqueIdSchema,
  unitId: nullableIdSchema,
  workspaceId: nullableIdSchema,
  patientId: nullableIdSchema,
  encounterId: nullableIdSchema,
  purpose: purposeSchema,
  engineCommit: z.string().trim().min(1).max(200),
  profileDigest: z.string().trim().min(1).max(256),
  status: z.enum(["ACTIVE", "CLOSED", "QUARANTINED"]),
  createdAt: z.string().datetime({ offset: true })
}).strict();
const referenceSchema = z.object({ title: z.string().max(500), source: z.string().max(2_000) }).strict();
const turnWireSchema = z.object({
  id: opaqueIdSchema,
  sessionId: opaqueIdSchema,
  prompt: z.string().max(8_000),
  response: z.string().nullable(),
  status: z.enum(["RECEIVED", "DENIED", "COMPLETED", "QUARANTINED", "OUTCOME_UNKNOWN"]),
  model: z.string().trim().min(1).max(200),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  references: z.array(referenceSchema).max(128),
  createdAt: z.string().datetime({ offset: true })
}).strict();
const draftWireSchema = z.object({
  id: opaqueIdSchema,
  sessionId: opaqueIdSchema,
  encounterId: nullableIdSchema,
  draftType: z.enum(["CLINICAL_NOTE", "SUMMARY", "MESSAGE"]),
  content: z.string().max(30_000),
  sourceTurnId: opaqueIdSchema,
  status: z.enum(["DRAFT", "REVIEWED", "REJECTED", "PROMOTED"]),
  createdAt: z.string().datetime({ offset: true })
}).strict();
const approvalWireSchema = z.object({
  id: opaqueIdSchema,
  organizationId: opaqueIdSchema,
  actorId: opaqueIdSchema,
  sessionId: opaqueIdSchema,
  turnId: opaqueIdSchema,
  toolName: z.string().trim().min(1).max(160),
  resourceId: nullableIdSchema,
  patientId: nullableIdSchema,
  encounterId: nullableIdSchema,
  unitId: nullableIdSchema,
  workspaceId: nullableIdSchema,
  purpose: purposeSchema,
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  policyRevision: z.string().trim().min(1).max(160),
  expiresAt: z.string().datetime({ offset: true }),
  decision: z.enum(["allowed-once", "rejected", "unavailable", "consumed"]),
  decidedBy: nullableIdSchema,
  reason: z.string().max(500).nullable(),
  createdAt: z.string().datetime({ offset: true })
}).strict();
const provenanceWireSchema = z.object({
  provider: z.literal("deepseek"),
  engineCommit: z.string().trim().min(1).max(200),
  manifestVersion: z.string().trim().min(1).max(200),
  profileDigest: z.string().trim().min(1).max(256),
  policyRevision: z.string().trim().min(1).max(160),
  references: z.array(referenceSchema).max(128),
  correlationId: correlationIdSchema
}).strict();
const capabilityWireSchema = z.object({
  adapterId: z.string().trim().min(1).max(160),
  provider: z.literal("deepseek"),
  engineCommit: z.string().trim().min(1).max(200),
  manifestVersion: z.string().trim().min(1).max(200),
  toolNames: z.array(z.string().trim().min(1).max(160)).max(256),
  supports: z.object({ cancellation: z.boolean(), approvals: z.boolean(), replay: z.boolean(), provenance: z.boolean() }).strict()
}).strict();
const turnResultWireSchema = z.object({
  session: sessionWireSchema,
  turn: turnWireSchema,
  draft: draftWireSchema.nullable(),
  approval: approvalWireSchema.nullable(),
  provenance: provenanceWireSchema
}).strict();
const replayWireSchema = z.object({
  session: sessionWireSchema,
  turns: z.array(turnWireSchema).max(10_000),
  digest: z.string().trim().min(1).max(256),
  provenance: capabilityWireSchema
}).strict();
const promotionWireSchema = z.object({ draft: draftWireSchema, documentId: opaqueIdSchema }).strict();

export type DeepSeekBridgeContext = z.infer<typeof contextSchema>;

function nowIso(): string { return new Date().toISOString(); }

function stableTools(tools: readonly string[]): string[] {
  return [...new Set(tools)].sort();
}

function toolsMatch(actual: readonly string[], expected: readonly string[]): boolean {
  const actualSorted = stableTools(actual);
  const expectedSorted = stableTools(expected);
  return actualSorted.length === expectedSorted.length && actualSorted.every((tool, index) => tool === expectedSorted[index]);
}

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof DeepSeekBridgeError ? error.message : fallback;
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DeepSeekBridgeError("INVALID_REQUEST", `Payload ${label} fora do contrato CVG.`, false);
  return parsed.data;
}

function parseResponse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DeepSeekBridgeError("INVALID_RESPONSE", `Resposta ${label} fora do contrato CVG.`, false);
  return parsed.data;
}

function capability(
  engineCommit: string,
  manifestVersion: string,
  toolNames: readonly string[],
  supports: AgentRuntimeCapabilities["supports"]
): AgentRuntimeCapabilities {
  return {
    adapterId: DEEPSEEK_BRIDGE_ADAPTER_ID,
    provider: "deepseek",
    engineCommit,
    manifestVersion,
    toolNames: stableTools(toolNames),
    supports
  };
}

function unavailableHealth(config: DeepSeekBridgeConfig, reason: string): AgentRuntimeHealth {
  return {
    status: "UNAVAILABLE",
    capabilities: capability(config.expectedEngineCommit, config.expectedManifestVersion, config.expectedToolNames, { cancellation: false, approvals: false, replay: false, provenance: false }),
    checkedAt: nowIso(),
    reason
  };
}

function assertSessionBinding(session: AiSession, context: CvgContext, expected: Pick<AiTurnInput, "purpose" | "patientId" | "encounterId">, expectedEngineCommit: string, expectedSessionId: OpaqueId | null = null): void {
  if (expectedSessionId && session.id !== expectedSessionId) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "A sessão retornada não corresponde à sessão solicitada.");
  if (session.organizationId !== context.organizationId || session.actorId !== context.actorId || session.unitId !== context.unitId || session.workspaceId !== context.workspaceId || session.purpose !== expected.purpose || session.patientId !== expected.patientId || session.encounterId !== expected.encounterId) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "A sessão retornada escapou do ator, escopo ou propósito autenticado.");
  if (session.engineCommit !== expectedEngineCommit) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "A sessão retornada usa um engine commit não aprovado.");
  if (session.status !== "ACTIVE") throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "Uma sessão não ativa não pode executar um turno.");
}

function assertTurnResultBinding(result: AgentTurnResult, context: CvgContext, input: AiTurnInput, expectedEngineCommit: string, expectedManifestVersion: string): void {
  assertSessionBinding(result.session, context, input, expectedEngineCommit, input.sessionId);
  if (result.turn.sessionId !== result.session.id || result.turn.prompt !== input.prompt) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "O turno retornado não corresponde à sessão ou ao prompt enviado.");
  if (result.provenance.provider !== "deepseek" || result.provenance.engineCommit !== expectedEngineCommit || result.provenance.manifestVersion !== expectedManifestVersion || result.provenance.policyRevision !== context.policyRevision || result.provenance.correlationId !== context.correlationId) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "Provenance, policy revision ou correlation ID não correspondem ao contexto CVG.");
  if (result.approval) {
    const approval = result.approval;
    const expectedResourceId = input.resourceId ?? input.encounterId ?? input.patientId ?? null;
    if (approval.organizationId !== context.organizationId || approval.actorId !== context.actorId || approval.sessionId !== result.session.id || approval.unitId !== context.unitId || approval.workspaceId !== context.workspaceId || approval.patientId !== input.patientId || approval.encounterId !== input.encounterId || approval.purpose !== input.purpose || approval.resourceId !== expectedResourceId || approval.policyRevision !== context.policyRevision || (input.requestedTool !== null && approval.toolName !== input.requestedTool)) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "A aprovação retornada não está vinculada ao turno exato.");
  }
  if (result.draft && (result.draft.sessionId !== result.session.id || result.draft.encounterId !== input.encounterId)) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "O rascunho retornado escapou da sessão ou atendimento.");
}

function assertReplayBinding(result: AgentReplayResult, context: CvgContext, sessionId: OpaqueId, expectedEngineCommit: string, expectedManifestVersion: string): void {
  if (result.session.id !== sessionId || result.session.organizationId !== context.organizationId || result.session.actorId !== context.actorId || result.session.unitId !== context.unitId || result.session.workspaceId !== context.workspaceId || result.session.engineCommit !== expectedEngineCommit || result.provenance.engineCommit !== expectedEngineCommit || result.provenance.manifestVersion !== expectedManifestVersion || result.provenance.provider !== "deepseek") throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "O replay retornado não está vinculado ao contexto ou ao profile aprovado.");
  if (result.turns.some((turn) => turn.sessionId !== sessionId)) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "O replay contém turno de outra sessão.");
}

export function parseBridgeContext(value: unknown): CvgContext {
  return parseInput(contextSchema, value, "context") as CvgContext;
}

export function parseBridgeSessionInput(value: unknown): Pick<AiTurnInput, "purpose" | "patientId" | "encounterId"> {
  return parseInput(sessionInputSchema, value, "session input");
}

export function parseBridgeTurnInput(value: unknown): AiTurnInput {
  return parseInput(aiTurnInputSchema, value, "turn input");
}

export function parseBridgeApprovalInput(value: unknown): { decision: "allowed-once" | "rejected"; reason: string | null } {
  return parseInput(approvalInputSchema, value, "approval input");
}

export function parseBridgeOpaqueId(value: unknown, label = "id"): OpaqueId {
  return parseInput(opaqueIdSchema, value, label);
}

export function healthToWire(health: AgentRuntimeHealth): DeepSeekHealthWire {
  return {
    status: health.status,
    engineCommit: health.capabilities.engineCommit,
    manifestVersion: health.capabilities.manifestVersion,
    tools: [...health.capabilities.toolNames],
    supports: health.capabilities.supports
  };
}

export interface DeepSeekBridgeErrorEnvelope {
  schemaVersion: typeof DEEPSEEK_BRIDGE_SCHEMA_VERSION;
  correlationId: string;
  error: { code: DeepSeekBridgeErrorCode; message: string; retryable: boolean };
}

export function toErrorEnvelope(error: unknown, correlationId: string): DeepSeekBridgeErrorEnvelope {
  const bridgeError = error instanceof DeepSeekBridgeError ? error : new DeepSeekBridgeError("DEPENDENCY_UNAVAILABLE", "A dependência DeepSeek Harness está indisponível.", true);
  return {
    schemaVersion: DEEPSEEK_BRIDGE_SCHEMA_VERSION,
    correlationId,
    error: { code: bridgeError.code, message: bridgeError.message, retryable: bridgeError.retryable }
  };
}

export class UnavailableNativeHarnessPort implements DeepSeekNativeHarnessPort {
  constructor(private readonly reason = "Nenhum adapter nativo DeepSeek foi configurado.") {}

  async health(_request: DeepSeekNativeBaseRequest): Promise<unknown> {
    return { status: "UNAVAILABLE", engineCommit: "unavailable", manifestVersion: "unavailable", tools: [], supports: { cancellation: false, approvals: false, replay: false, provenance: false }, reason: this.reason };
  }

  async createSession(_request: DeepSeekNativeSessionRequest): Promise<unknown> { throw new DeepSeekBridgeError("NATIVE_UNAVAILABLE", this.reason, true); }
  async executeTurn(_request: DeepSeekNativeTurnRequest): Promise<unknown> { throw new DeepSeekBridgeError("NATIVE_UNAVAILABLE", this.reason, true); }
  async approve(_request: DeepSeekNativeApprovalRequest): Promise<unknown> { throw new DeepSeekBridgeError("NATIVE_UNAVAILABLE", this.reason, true); }
  async promoteDraft(_request: DeepSeekNativePromotionRequest): Promise<unknown> { throw new DeepSeekBridgeError("NATIVE_UNAVAILABLE", this.reason, true); }
  async replay(_request: DeepSeekNativeReplayRequest): Promise<unknown> { throw new DeepSeekBridgeError("NATIVE_UNAVAILABLE", this.reason, true); }
  async shutdown(_request: DeepSeekNativeBaseRequest): Promise<unknown> { return undefined; }
}

/**
 * Provider-neutral CVG boundary for a native DeepSeek Harness port. The class
 * owns only protocol adaptation, deadlines, cancellation and authority checks;
 * it does not implement sessions, tools, policy or business workflows.
 */
export class DeepSeekBridge implements AgentRuntime {
  readonly adapterId = DEEPSEEK_BRIDGE_ADAPTER_ID;
  private readonly config: DeepSeekBridgeConfig;
  private readonly native: DeepSeekNativeHarnessPort;
  private readonly hasNativePort: boolean;
  private lastHealth: AgentRuntimeHealth | null = null;

  constructor(config: DeepSeekBridgeConfig) {
    if (!config.expectedEngineCommit.trim() || !config.expectedManifestVersion.trim() || config.requestTimeoutMs < 100 || config.requestTimeoutMs > 120_000) throw new DeepSeekBridgeError("CAPABILITY_DISABLED", "Configuração do bridge DeepSeek inválida.");
    this.config = { ...config, expectedToolNames: stableTools(config.expectedToolNames) };
    this.hasNativePort = Boolean(config.nativePort);
    this.native = config.nativePort ?? new UnavailableNativeHarnessPort();
  }

  async health(signal?: AbortSignal): Promise<AgentRuntimeHealth> {
    if (signal?.aborted) throw new DeepSeekBridgeError("CANCELLED", "Health check DeepSeek cancelado.");
    if (!this.hasNativePort) {
      const result = unavailableHealth(this.config, "Nenhum adapter nativo DeepSeek foi configurado; o bridge não usa Mock ou fallback.");
      this.lastHealth = result;
      return result;
    }
    try {
      const raw = await this.invoke("health", undefined, signal, (request) => this.native.health(request));
      const data = parseResponse(healthSchema, raw, "health");
      const matches = data.engineCommit === this.config.expectedEngineCommit && data.manifestVersion === this.config.expectedManifestVersion && toolsMatch(data.tools, this.config.expectedToolNames);
      const supportsComplete = data.supports.cancellation && data.supports.approvals && data.supports.replay && data.supports.provenance;
      const status: AgentRuntimeHealth["status"] = matches && supportsComplete ? data.status : "UNAVAILABLE";
      const reason = !matches
        ? "Commit, manifest ou catálogo de tools do DeepSeek não corresponde ao profile aprovado."
        : !supportsComplete
          ? "O Native Harness não expõe todas as capabilities obrigatórias (cancellation, approvals, replay e provenance)."
          : data.reason ?? (data.status === "READY" ? null : `Native Harness reportou ${data.status}.`);
      const result: AgentRuntimeHealth = {
        status,
        capabilities: capability(data.engineCommit, data.manifestVersion, data.tools, data.supports),
        checkedAt: nowIso(),
        reason
      };
      this.lastHealth = result;
      return result;
    } catch (error) {
      if (error instanceof DeepSeekBridgeError && (error.code === "CANCELLED" || error.code === "TIMEOUT")) throw error;
      const reason = safeMessage(error, "Native DeepSeek Harness indisponível ou fora do contrato.");
      const result = unavailableHealth(this.config, reason);
      this.lastHealth = result;
      return result;
    }
  }

  async createSession(context: CvgContext, input: Pick<AiTurnInput, "purpose" | "patientId" | "encounterId">, signal?: AbortSignal): Promise<AiSession> {
    const safeContext = parseBridgeContext(context);
    const safeInput = parseBridgeSessionInput(input);
    this.assertContextPurpose(safeContext, safeInput);
    await this.requireReady(signal);
    const raw = await this.invoke("createSession", safeContext.correlationId, signal, (request) => this.native.createSession({ ...request, context: safeContext, input: safeInput }));
    const session = parseResponse(sessionWireSchema, raw, "session") as AiSession;
    assertSessionBinding(session, safeContext, safeInput, this.config.expectedEngineCommit);
    return session;
  }

  async executeTurn(context: CvgContext, input: AiTurnInput, approvalId: OpaqueId | null = null, signal?: AbortSignal): Promise<AgentTurnResult> {
    const safeContext = parseBridgeContext(context);
    const safeInput = parseBridgeTurnInput(input);
    const safeApprovalId = approvalId === null ? null : parseBridgeOpaqueId(approvalId, "approvalId");
    await this.requireReady(signal);
    const raw = await this.invoke("executeTurn", safeContext.correlationId, signal, (request) => this.native.executeTurn({ ...request, context: safeContext, input: safeInput, approvalId: safeApprovalId }));
    const result = parseResponse(turnResultWireSchema, raw, "turn") as AgentTurnResult;
    assertTurnResultBinding(result, safeContext, safeInput, this.config.expectedEngineCommit, this.config.expectedManifestVersion);
    return result;
  }

  async approve(context: CvgContext, approvalId: OpaqueId, decision: "allowed-once" | "rejected", reason: string | null, signal?: AbortSignal): Promise<AiApproval> {
    const safeContext = parseBridgeContext(context);
    const safeApprovalId = parseBridgeOpaqueId(approvalId, "approvalId");
    const safeInput = parseBridgeApprovalInput({ decision, reason });
    await this.requireReady(signal);
    const raw = await this.invoke("approve", safeContext.correlationId, signal, (request) => this.native.approve({ ...request, context: safeContext, approvalId: safeApprovalId, ...safeInput }));
    const approval = parseResponse(approvalWireSchema, raw, "approval") as AiApproval;
    if (approval.id !== safeApprovalId || approval.organizationId !== safeContext.organizationId || approval.actorId !== safeContext.actorId || approval.decidedBy !== safeContext.actorId || approval.decision !== safeInput.decision || approval.reason !== safeInput.reason || approval.policyRevision !== safeContext.policyRevision) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "A decisão de aprovação não corresponde ao ator ou aos argumentos enviados.");
    return approval;
  }

  async promoteDraft(context: CvgContext, draftId: OpaqueId, signal?: AbortSignal): Promise<AgentDraftPromotion> {
    const safeContext = parseBridgeContext(context);
    const safeDraftId = parseBridgeOpaqueId(draftId, "draftId");
    await this.requireReady(signal);
    const raw = await this.invoke("promoteDraft", safeContext.correlationId, signal, (request) => this.native.promoteDraft({ ...request, context: safeContext, draftId: safeDraftId }));
    const promotion = parseResponse(promotionWireSchema, raw, "draft promotion") as AgentDraftPromotion;
    if (promotion.draft.id !== safeDraftId || promotion.draft.status !== "PROMOTED") throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "A promoção retornada não corresponde ao draft solicitado.");
    return promotion;
  }

  async replay(context: CvgContext, sessionId: OpaqueId, signal?: AbortSignal): Promise<AgentReplayResult> {
    const safeContext = parseBridgeContext(context);
    const safeSessionId = parseBridgeOpaqueId(sessionId, "sessionId");
    await this.requireReady(signal);
    const raw = await this.invoke("replay", safeContext.correlationId, signal, (request) => this.native.replay({ ...request, context: safeContext, sessionId: safeSessionId }));
    const result = parseResponse(replayWireSchema, raw, "replay") as AgentReplayResult;
    assertReplayBinding(result, safeContext, safeSessionId, this.config.expectedEngineCommit, this.config.expectedManifestVersion);
    return result;
  }

  async shutdown(signal?: AbortSignal): Promise<void> {
    if (!this.hasNativePort || this.lastHealth?.status === "DISABLED") return;
    await this.invoke("shutdown", this.lastHealth?.capabilities ? undefined : "shutdown", signal, (request) => this.native.shutdown(request));
    if (this.lastHealth) this.lastHealth = { ...this.lastHealth, status: "DISABLED", reason: "bridge shutdown" };
  }

  private assertContextPurpose(context: CvgContext, input: Pick<AiTurnInput, "purpose" | "patientId" | "encounterId">): void {
    if (context.purpose !== input.purpose || context.patientId !== input.patientId || context.encounterId !== input.encounterId) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "O propósito ou o alvo do contexto não corresponde ao request DeepSeek.");
  }

  private async requireReady(signal?: AbortSignal): Promise<void> {
    const health = await this.health(signal);
    if (health.status !== "READY") {
      const code: DeepSeekBridgeErrorCode = health.reason?.includes("Commit") || health.reason?.includes("manifest") || health.reason?.includes("tools") ? "CONTRACT_MISMATCH" : "NATIVE_UNAVAILABLE";
      throw new DeepSeekBridgeError(code, health.reason ?? "DeepSeek Harness indisponível; nenhum turno foi enviado.", code === "NATIVE_UNAVAILABLE");
    }
  }

  private async invoke<T>(operation: string, correlationId: string | undefined, parentSignal: AbortSignal | undefined, callback: (request: DeepSeekNativeBaseRequest) => Promise<T>): Promise<T> {
    const resolvedCorrelation = correlationId ?? `bridge-${operation}`;
    if (parentSignal?.aborted) throw new DeepSeekBridgeError("CANCELLED", `Operação DeepSeek ${operation} cancelada antes do envio.`);
    const controller = new AbortController();
    let timedOut = false;
    let cancelled = false;
    const onAbort = () => { cancelled = true; controller.abort(); };
    parentSignal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.config.requestTimeoutMs);
    try {
      return await callback({ correlationId: resolvedCorrelation, signal: controller.signal });
    } catch (error) {
      if (cancelled) throw new DeepSeekBridgeError("CANCELLED", `Operação DeepSeek ${operation} cancelada.`);
      if (timedOut) throw new DeepSeekBridgeError("TIMEOUT", `Operação DeepSeek ${operation} excedeu o deadline.`, true);
      if (error instanceof DeepSeekBridgeError) throw error;
      throw new DeepSeekBridgeError("DEPENDENCY_UNAVAILABLE", `A operação DeepSeek ${operation} falhou na dependência nativa.`, true);
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onAbort);
    }
  }
}

export const deepSeekBridgeSchemas = {
  context: contextSchema,
  sessionInput: sessionInputSchema,
  turnInput: aiTurnInputSchema,
  approvalInput: approvalInputSchema,
  health: healthSchema,
  session: sessionWireSchema,
  turn: turnWireSchema,
  draft: draftWireSchema,
  approval: approvalWireSchema,
  provenance: provenanceWireSchema,
  turnResult: turnResultWireSchema,
  replay: replayWireSchema,
  promotion: promotionWireSchema
} as const;

export * from "./acp.ts";
