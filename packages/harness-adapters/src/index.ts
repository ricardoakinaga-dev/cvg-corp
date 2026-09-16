import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { aiTurnWireSchema, id } from "@cvg/contracts";
import type { AiApproval, AiDraft, AiSession, AiTurn, AiTurnInput, CvgContext, OpaqueId } from "@cvg/contracts";
import { DSH_MANIFEST_VERSION, GovernedHarness, TOOL_REGISTRY, type HarnessTurnResult } from "@cvg/harness";
import { enforceApplicationPolicy } from "@cvg/agent-policy";
import { replayDigest, type AgentDraftPromotion, type AgentReplayResult, type AgentRuntime, type AgentRuntimeCapabilities, type AgentRuntimeHealth, type AgentTurnResult, AgentRuntimeUnavailableError, bridgeRequestSignature } from "@cvg/agent-runtime";

function nowIso(): string { return new Date().toISOString(); }

function capabilities(adapterId: string, provider: string, engineCommit: string, manifestVersion: string, toolNames: readonly string[]): AgentRuntimeCapabilities {
  return { adapterId, provider, engineCommit, manifestVersion, toolNames, supports: { cancellation: true, approvals: true, replay: true, provenance: true } };
}

function fromMockResult(result: HarnessTurnResult, correlationId: string): AgentTurnResult {
  return { ...result, provenance: { ...result.provenance, manifestVersion: DSH_MANIFEST_VERSION, correlationId } };
}

/** Adapts the deterministic local Harness to the provider-neutral runtime contract. */
export class MockHarnessAdapter implements AgentRuntime {
  readonly adapterId = "mock-harness";

  constructor(private readonly harness: GovernedHarness) {}

  async health(): Promise<AgentRuntimeHealth> {
    const health = this.harness.health();
    return { status: health.engine === "READY" ? "READY" : "DISABLED", capabilities: capabilities(this.adapterId, health.provider, health.engineCommit, health.manifestVersion, TOOL_REGISTRY.map((tool) => tool.name)), checkedAt: nowIso(), reason: null };
  }

  async createSession(context: CvgContext, input: Pick<AiTurnInput, "purpose" | "patientId" | "encounterId">) { return this.harness.createSession(context, input); }
  async executeTurn(context: CvgContext, input: AiTurnInput, approvalId: OpaqueId | null = null): Promise<AgentTurnResult> { return fromMockResult(await this.harness.executeTurn(context, input, approvalId), context.correlationId); }
  async approve(context: CvgContext, approvalId: OpaqueId, decision: "allowed-once" | "rejected", reason: string | null) { return this.harness.approve(context, approvalId, decision, reason); }
  async promoteDraft(context: CvgContext, draftId: OpaqueId): Promise<AgentDraftPromotion> { return this.harness.promoteDraft(context, draftId); }
  async replay(context: CvgContext, sessionId: OpaqueId): Promise<AgentReplayResult> { const replay = this.harness.replay(context, sessionId); const health = await this.health(); return { ...replay, provenance: health.capabilities }; }
  async shutdown(): Promise<void> { return Promise.resolve(); }
}

export interface DeepSeekHarnessConfig {
  baseUrl: string;
  expectedEngineCommit: string;
  expectedManifestVersion: string;
  expectedToolNames?: readonly string[];
  requestTimeoutMs: number;
  allowInsecureHttp?: boolean;
  resolveBearerToken?: () => Promise<string | null>;
  /** HMAC key for binding the serialized CVG context to the authenticated bridge call. */
  resolveContextSigningSecret?: () => Promise<string | null>;
}

export interface DeepSeekFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<DeepSeekFetchResponse>;

const healthSchema = z.object({
  status: z.enum(["READY", "DEGRADED", "UNAVAILABLE", "DISABLED"]),
  engineCommit: z.string().min(1),
  manifestVersion: z.string().min(1),
  tools: z.array(z.string().min(1)),
  supports: z.object({ cancellation: z.boolean(), approvals: z.boolean(), replay: z.boolean(), provenance: z.boolean() })
}).strict();

const payloadSchema = z.object({ data: z.unknown().optional() }).passthrough();
const opaqueIdSchema = z.string().min(1).max(200).transform((value) => id(value));
const nullableIdSchema = opaqueIdSchema.nullable();
const sessionWireSchema = z.object({
  id: opaqueIdSchema,
  organizationId: opaqueIdSchema,
  actorId: opaqueIdSchema,
  unitId: nullableIdSchema,
  workspaceId: nullableIdSchema,
  patientId: nullableIdSchema,
  encounterId: nullableIdSchema,
  purpose: z.enum(["SUMMARY", "DRAFT_CLINICAL", "KNOWLEDGE_QUERY", "OPERATIONS"]),
  engineCommit: z.string().min(1),
  profileDigest: z.string().min(1),
  status: z.enum(["ACTIVE", "CLOSED", "QUARANTINED"]),
  createdAt: z.string().min(1)
}).strict();
const turnWireSchema = aiTurnWireSchema;
const draftWireSchema = z.object({
  id: opaqueIdSchema,
  sessionId: opaqueIdSchema,
  encounterId: nullableIdSchema,
  draftType: z.enum(["CLINICAL_NOTE", "SUMMARY", "MESSAGE"]),
  content: z.string(),
  sourceTurnId: opaqueIdSchema,
  status: z.enum(["DRAFT", "REVIEWED", "REJECTED", "PROMOTED"]),
  createdAt: z.string().min(1)
}).strict();
const approvalWireSchema = z.object({
  id: opaqueIdSchema,
  organizationId: opaqueIdSchema,
  actorId: opaqueIdSchema,
  sessionId: opaqueIdSchema,
  turnId: opaqueIdSchema,
  toolName: z.string().min(1),
  resourceId: nullableIdSchema,
  patientId: nullableIdSchema,
  encounterId: nullableIdSchema,
  unitId: nullableIdSchema,
  workspaceId: nullableIdSchema,
  purpose: z.enum(["SUMMARY", "DRAFT_CLINICAL", "KNOWLEDGE_QUERY", "OPERATIONS"]),
  requestDigest: z.string().min(1),
  policyRevision: z.string().min(1),
  expiresAt: z.string().min(1),
  decision: z.enum(["allowed-once", "rejected", "unavailable", "consumed"]),
  decidedBy: nullableIdSchema,
  reason: z.string().nullable(),
  createdAt: z.string().min(1)
}).strict();
const provenanceWireSchema = z.object({
  provider: z.string().min(1),
  engineCommit: z.string().min(1),
  manifestVersion: z.string().min(1),
  profileDigest: z.string().min(1),
  policyRevision: z.string().min(1),
  references: z.array(z.object({ title: z.string(), source: z.string() }).strict()),
  correlationId: z.string().min(1)
}).strict();
const turnResultWireSchema = z.object({
  session: sessionWireSchema,
  turn: turnWireSchema,
  draft: draftWireSchema.nullable(),
  approval: approvalWireSchema.nullable(),
  provenance: provenanceWireSchema
}).strict();
const capabilityWireSchema = z.object({
  adapterId: z.string().min(1),
  provider: z.string().min(1),
  engineCommit: z.string().min(1),
  manifestVersion: z.string().min(1),
  toolNames: z.array(z.string().min(1)),
  supports: z.object({ cancellation: z.boolean(), approvals: z.boolean(), replay: z.boolean(), provenance: z.boolean() }).strict()
}).strict();
const replayWireSchema = z.object({ session: sessionWireSchema, turns: z.array(turnWireSchema), digest: z.string().regex(/^[a-f0-9]{64}$/), provenance: capabilityWireSchema }).strict();
const promotionWireSchema = z.object({ draft: draftWireSchema, documentId: opaqueIdSchema }).strict();

function unwrap(payload: unknown): unknown {
  const parsed = payloadSchema.safeParse(payload);
  return parsed.success && parsed.data.data !== undefined ? parsed.data.data : payload;
}

function parseWire<T>(schema: z.ZodType<T>, payload: unknown, label: string): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new AgentRuntimeUnavailableError(`O DeepSeek Harness retornou ${label} fora do contrato CVG.`);
  return parsed.data;
}

function rejectBoundary(detail: string): never {
  throw new AgentRuntimeUnavailableError(`O DeepSeek Harness violou a fronteira de autoridade CVG: ${detail}`);
}

function assertSessionBinding(session: AiSession, context: CvgContext, expected: Pick<AiTurnInput, "purpose" | "patientId" | "encounterId">, expectedSessionId: OpaqueId | null = null): void {
  if (expectedSessionId && session.id !== expectedSessionId) rejectBoundary("a sessão retornada não corresponde à sessão solicitada");
  if (session.organizationId !== context.organizationId || session.actorId !== context.actorId || session.unitId !== context.unitId || session.workspaceId !== context.workspaceId || session.purpose !== expected.purpose || session.patientId !== expected.patientId || session.encounterId !== expected.encounterId) rejectBoundary("a sessão retornada escapou do ator, escopo ou propósito autenticado");
  if (session.status !== "ACTIVE") rejectBoundary("uma sessão não ativa não pode executar um turno");
}

function assertTurnResultBinding(result: AgentTurnResult, context: CvgContext, input: AiTurnInput, expectedEngineCommit: string, expectedManifestVersion: string): void {
  assertSessionBinding(result.session, context, input, input.sessionId);
  if (result.session.engineCommit !== expectedEngineCommit || result.provenance.profileDigest !== result.session.profileDigest) rejectBoundary("a sessão e provenance não correspondem ao engine/profile aprovado");
  if (result.turn.sessionId !== result.session.id || result.turn.prompt !== input.prompt) rejectBoundary("o turno retornado não corresponde à sessão ou ao prompt enviado");
  if (result.provenance.provider !== "deepseek" || result.provenance.engineCommit !== expectedEngineCommit || result.provenance.manifestVersion !== expectedManifestVersion || result.provenance.policyRevision !== context.policyRevision || result.provenance.correlationId !== context.correlationId) rejectBoundary("provenance, policy revision ou correlation ID não correspondem ao contexto CVG");
  if (result.approval) {
    const approval = result.approval;
    if (approval.turnId !== result.turn.id || approval.organizationId !== context.organizationId || approval.actorId !== context.actorId || approval.sessionId !== result.session.id || approval.unitId !== context.unitId || approval.workspaceId !== context.workspaceId || approval.patientId !== input.patientId || approval.encounterId !== input.encounterId || approval.purpose !== input.purpose || approval.resourceId !== (input.resourceId ?? input.encounterId ?? input.patientId) || approval.policyRevision !== context.policyRevision || (input.requestedTool !== null && approval.toolName !== input.requestedTool)) rejectBoundary("a aprovação retornada não está vinculada ao turno exato");
  }
  if (result.draft && (result.draft.sourceTurnId !== result.turn.id || result.draft.sessionId !== result.session.id || result.draft.encounterId !== input.encounterId)) rejectBoundary("o rascunho retornado escapou da sessão ou atendimento");
}

function assertReplayBinding(result: AgentReplayResult, context: CvgContext, sessionId: OpaqueId, expectedEngineCommit: string, expectedManifestVersion: string): void {
  if (result.session.id !== sessionId || result.session.organizationId !== context.organizationId || result.session.actorId !== context.actorId || result.session.unitId !== context.unitId || result.session.workspaceId !== context.workspaceId || result.provenance.engineCommit !== expectedEngineCommit || result.provenance.manifestVersion !== expectedManifestVersion || result.provenance.provider !== "deepseek") rejectBoundary("o replay retornado não está vinculado ao contexto ou ao profile aprovado");
  if (result.turns.some((turn) => turn.sessionId !== sessionId)) rejectBoundary("o replay contém turno de outra sessão");
  if (result.digest !== replayDigest(result.session, result.turns)) rejectBoundary("o digest do replay não corresponde ao ledger canônico recebido");
}

/**
 * Calls an explicitly configured CVG adapter protocol over HTTP. It verifies the harness manifest before any turn and never falls back to the local engine.
 */
export class DeepSeekHarnessAdapter implements AgentRuntime {
  readonly adapterId = "deepseek-harness-http";
  private readonly fetchImpl: FetchLike;
  private lastHealth: AgentRuntimeHealth | null = null;

  constructor(private readonly config: DeepSeekHarnessConfig, fetchImpl?: FetchLike) {
    let parsedUrl: URL;
    try { parsedUrl = new URL(config.baseUrl); } catch { throw new AgentRuntimeUnavailableError("Configuração do DeepSeek Harness inválida."); }
    if (!(parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:") || (parsedUrl.protocol === "http:" && !config.allowInsecureHttp) || config.requestTimeoutMs < 100 || config.requestTimeoutMs > 120_000) throw new AgentRuntimeUnavailableError("Configuração do DeepSeek Harness inválida.");
    this.fetchImpl = fetchImpl ?? (fetch as unknown as FetchLike);
  }

  async health(): Promise<AgentRuntimeHealth> {
    try {
      const body = await this.request("GET", "/v1/health");
      const parsed = healthSchema.safeParse(unwrap(body));
      if (!parsed.success) throw new AgentRuntimeUnavailableError("O health do DeepSeek Harness não atende ao contrato CVG.");
      const data = parsed.data;
      const expectedTools = this.config.expectedToolNames ?? TOOL_REGISTRY.map((tool) => tool.name);
      const actualTools = [...new Set(data.tools)].sort();
      const requiredTools = [...new Set(expectedTools)].sort();
      const toolsMatch = actualTools.length === requiredTools.length && actualTools.every((tool, index) => tool === requiredTools[index]);
      const manifestMatches = data.engineCommit === this.config.expectedEngineCommit && data.manifestVersion === this.config.expectedManifestVersion && toolsMatch;
      const supportsComplete = data.supports.cancellation && data.supports.approvals && data.supports.replay && data.supports.provenance;
      const status = data.status === "READY" && manifestMatches && supportsComplete ? "READY" : "UNAVAILABLE";
      const reason = !manifestMatches
        ? "Commit, manifest ou catálogo de tools do DeepSeek Harness não corresponde ao profile aprovado."
        : !supportsComplete
          ? "O DeepSeek Harness não expõe todas as capabilities obrigatórias (cancellation, approvals, replay e provenance)."
          : data.status === "READY" ? null : `Harness reportou ${data.status}.`;
      const result: AgentRuntimeHealth = { status, capabilities: { ...capabilities(this.adapterId, "deepseek", data.engineCommit, data.manifestVersion, data.tools), supports: data.supports }, checkedAt: nowIso(), reason };
      this.lastHealth = result;
      return result;
    } catch (error) {
      const result: AgentRuntimeHealth = { status: "UNAVAILABLE", capabilities: capabilities(this.adapterId, "deepseek", this.config.expectedEngineCommit, this.config.expectedManifestVersion, []), checkedAt: nowIso(), reason: error instanceof Error ? error.message : String(error) };
      this.lastHealth = result;
      return result;
    }
  }

  async createSession(context: CvgContext, input: Pick<AiTurnInput, "purpose" | "patientId" | "encounterId">) {
    await this.requireReady();
    const session = parseWire(sessionWireSchema, unwrap(await this.request("POST", "/v1/sessions", { context, input })), "session") as AiSession;
    assertSessionBinding(session, context, input);
    if (session.engineCommit !== this.config.expectedEngineCommit) rejectBoundary("a sessão retornada pertence a outro engine commit");
    return session;
  }

  async executeTurn(context: CvgContext, input: AiTurnInput, approvalId: OpaqueId | null = null): Promise<AgentTurnResult> {
    await this.requireReady();
    const result = parseWire(turnResultWireSchema, unwrap(await this.request("POST", `/v1/sessions/${input.sessionId ?? "new"}/turns`, { context, input, approvalId })), "turn") as AgentTurnResult;
    assertTurnResultBinding(result, context, input, this.config.expectedEngineCommit, this.config.expectedManifestVersion);
    return result;
  }

  async approve(context: CvgContext, approvalId: OpaqueId, decision: "allowed-once" | "rejected", reason: string | null): Promise<AiApproval> {
    await this.requireReady();
    const approval = parseWire(approvalWireSchema, unwrap(await this.request("POST", `/v1/approvals/${approvalId}`, { context, decision, reason })), "approval") as AiApproval;
    if (approval.id !== approvalId || approval.organizationId !== context.organizationId || approval.actorId !== context.actorId || approval.decidedBy !== context.actorId || approval.unitId !== context.unitId || approval.workspaceId !== context.workspaceId || approval.patientId !== context.patientId || approval.encounterId !== context.encounterId || approval.purpose !== context.purpose || approval.policyRevision !== context.policyRevision || approval.decision !== decision || approval.reason !== reason) rejectBoundary("a decisão de aprovação não corresponde ao ator, escopo ou argumentos enviados");
    return approval;
  }

  async promoteDraft(context: CvgContext, draftId: OpaqueId): Promise<AgentDraftPromotion> {
    await this.requireReady();
    const promotion = parseWire(promotionWireSchema, unwrap(await this.request("POST", `/v1/drafts/${draftId}/promote`, { context, draftId })), "draft promotion") as AgentDraftPromotion;
    if (promotion.draft.id !== draftId || promotion.draft.status !== "PROMOTED" || promotion.draft.encounterId !== context.encounterId) rejectBoundary("a promoção retornada não corresponde ao atendimento ou ao estado solicitado");
    return promotion;
  }

  async replay(context: CvgContext, sessionId: OpaqueId): Promise<AgentReplayResult> {
    await this.requireReady();
    const result = parseWire(replayWireSchema, unwrap(await this.request("GET", `/v1/sessions/${sessionId}/replay`, { context })), "replay") as AgentReplayResult;
    assertReplayBinding(result, context, sessionId, this.config.expectedEngineCommit, this.config.expectedManifestVersion);
    return result;
  }

  async shutdown(): Promise<void> {
    if (!this.lastHealth || this.lastHealth.status === "UNAVAILABLE") return;
    await this.request("POST", "/v1/shutdown").catch(() => undefined);
    this.lastHealth = { ...this.lastHealth, status: "DISABLED", reason: "adapter shutdown" };
  }

  private async requireReady(): Promise<void> {
    const health = await this.health();
    if (health.status !== "READY") throw new AgentRuntimeUnavailableError(health.reason ?? "DeepSeek Harness indisponível; nenhum turno foi enviado.");
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const token = this.config.resolveBearerToken ? await this.config.resolveBearerToken() : null;
      if (this.config.resolveBearerToken && !token?.trim()) throw new AgentRuntimeUnavailableError("DeepSeek Harness sem credencial resolvida; nenhum request foi enviado.");
      const headers: Record<string, string> = { accept: "application/json" };
      if (body !== undefined && method === "GET") headers["x-cvg-context"] = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
      if (body !== undefined && method !== "GET") headers["content-type"] = "application/json";
      if (token) headers.authorization = `Bearer ${token}`;
      const context = body && typeof body === "object" && !Array.isArray(body) && "context" in body ? (body as { context?: unknown }).context : undefined;
      if (context && typeof context === "object" && "correlationId" in context && typeof context.correlationId === "string") headers["x-cvg-correlation-id"] = context.correlationId;
      if (context !== undefined && this.config.resolveContextSigningSecret) {
        if (!context || typeof context !== "object" || Array.isArray(context) || typeof (context as { correlationId?: unknown }).correlationId !== "string") throw new AgentRuntimeUnavailableError("DeepSeek Harness recebeu contexto inválido; nenhum request foi enviado.");
        const signingSecret = await this.config.resolveContextSigningSecret();
        if (!signingSecret?.trim()) throw new AgentRuntimeUnavailableError("DeepSeek Harness sem segredo de assinatura de contexto resolvido; nenhum request foi enviado.");
        const issuedAt = String(Date.now());
        const nonce = randomUUID();
        headers["x-cvg-context-issued-at"] = issuedAt;
        headers["x-cvg-request-nonce"] = nonce;
        headers["x-cvg-context-signature"] = `sha256=${bridgeRequestSignature(signingSecret.trim(), method, path, issuedAt, body, nonce)}`;
      }
      const response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, "")}${path}`, { method, headers, redirect: "error", ...(body === undefined || method === "GET" ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new AgentRuntimeUnavailableError(`DeepSeek Harness respondeu HTTP ${response.status}.`);
      return payload;
    } catch (error) {
      if (error instanceof AgentRuntimeUnavailableError) throw error;
      throw new AgentRuntimeUnavailableError(`DeepSeek Harness indisponível: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Structural port so the durable ACP governance stays dependency-free. */
export interface DeepSeekAcpGovernanceStorePort {
  validateContext(context: CvgContext): void;
  requireRole(context: CvgContext, allowed: readonly string[], capability: string): void;
  readonly aiSessions: ReadonlyMap<string, AiSession>;
  readonly aiTurns: ReadonlyMap<string, AiTurn>;
  readonly aiApprovals: ReadonlyMap<string, AiApproval>;
  readonly aiDrafts: ReadonlyMap<string, AiDraft>;
  readonly encounters: ReadonlyMap<string, { id: string; organizationId: string; unitId: string | null; workspaceId: string | null; patientId: string }>;
  persistAiSession(session: AiSession): AiSession;
  persistAiTurn(turn: AiTurn): AiTurn;
  persistAiApproval(approval: AiApproval): AiApproval;
  persistAiDraft(draft: AiDraft): AiDraft;
  updateAiApproval(approvalId: OpaqueId, patch: Partial<Pick<AiApproval, "decision" | "decidedBy" | "reason">>): AiApproval;
  updateAiDraftStatus(draftId: OpaqueId, status: AiDraft["status"]): AiDraft;
  createClinicalDocument(context: CvgContext, input: { encounterId: OpaqueId; documentType: "EVOLUTION"; title: string; content: string; dataClass: "D3" }): { id: OpaqueId };
}

export interface DurableAcpGovernanceBudgetPort {
  reserve(units: number): Promise<string> | string;
  settle(reservationId: string, actualUnits: number | null): Promise<void> | void;
  release(reservationId: string): Promise<void> | void;
}

export interface DurableAcpGovernanceOptions {
  store: DeepSeekAcpGovernanceStorePort;
  /** Optional fallback when a caller cannot pass attested facts at session creation. */
  engineCommit?: string;
  /** Optional fallback when a caller cannot pass attested facts at session creation. */
  profileDigest?: string;
  manifestVersion?: string;
  toolNames?: readonly string[];
  budget?: DurableAcpGovernanceBudgetPort;
}

export interface DurableAcpGovernedTurn {
  session: AiSession;
  turn: AiTurn;
  draft: AiDraft | null;
  approval: AiApproval | null;
}

export interface DurableAcpTurnAuthorization {
  disposition: "ALLOW" | "DENY" | "APPROVAL_REQUIRED";
  result?: DurableAcpGovernedTurn;
}

function acpDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function acpEstimate(prompt: string): number {
  return Math.max(1, Math.ceil(prompt.length / 4));
}

function scopeOf(context: CvgContext, session: AiSession): boolean {
  return session.organizationId === context.organizationId
    && session.actorId === context.actorId
    && (session.unitId ?? null) === (context.unitId ?? null)
    && (session.workspaceId ?? null) === (context.workspaceId ?? null);
}

type AcpOutcome = {
  status: "COMPLETED" | "DENIED" | "OUTCOME_UNKNOWN";
  response: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  correlationId: string;
  reason?: string;
};

type PersistTurnOptions = {
  existing?: AiTurn;
  reservationId?: OpaqueId | null;
  reservedUnits?: number;
  consumedUnits?: number;
  usageStatus?: NonNullable<AiTurn["usage"]>["status"];
};

function stableTurnUsageKey(sessionId: OpaqueId, idempotencyKey: string): string {
  return `ai-turn:${acpDigest({ version: 1, sessionId, idempotencyKey })}`;
}

function observedTokenUnits(inputTokens: number, outputTokens: number): number | null {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(outputTokens) || outputTokens < 0) return null;
  const total = inputTokens + outputTokens;
  return Number.isSafeInteger(total) ? total : null;
}

function isTerminalTurn(turn: AiTurn): boolean {
  return turn.status === "COMPLETED" || turn.status === "DENIED" || turn.status === "QUARANTINED" || turn.status === "OUTCOME_UNKNOWN";
}

/**
 * Durable governance for the DeepSeek ACP port. Every authorization, turn,
 * approval, promotion and replay is persisted before it can influence the
 * native process; missing usage becomes OUTCOME_UNKNOWN instead of zero cost.
 */
export class DurableDeepSeekAcpGovernance {
  readonly toolNames: readonly string[];
  private readonly sessionLocks = new Map<string, Promise<unknown>>();

  constructor(private readonly options: DurableAcpGovernanceOptions) {
    this.toolNames = options.toolNames ?? TOOL_REGISTRY.map((tool) => tool.name);
  }

  async createSession(context: CvgContext, input: Pick<AiTurnInput, "purpose" | "patientId" | "encounterId">, attestedFacts?: { engineCommit: string; profileDigest: string }): Promise<AiSession> {
    this.options.store.validateContext(context);
    enforceApplicationPolicy(context, `ai.turn.${input.purpose}`, { resourceId: input.patientId ?? input.encounterId });
    this.options.store.requireRole(context, ["admin", "veterinario", "recepcao"], "ai:session");
    const facts = attestedFacts ?? (this.options.engineCommit && this.options.profileDigest ? { engineCommit: this.options.engineCommit, profileDigest: this.options.profileDigest } : null);
    if (!facts) throw new Error("Fatos atestados (engineCommit/profileDigest) são obrigatórios para criar sessão ACP durável.");
    const session: AiSession = {
      id: id(randomUUID()),
      organizationId: context.organizationId,
      actorId: context.actorId,
      unitId: context.unitId,
      workspaceId: context.workspaceId,
      patientId: input.patientId,
      encounterId: input.encounterId,
      purpose: input.purpose,
      engineCommit: facts.engineCommit,
      profileDigest: facts.profileDigest,
      status: "ACTIVE",
      createdAt: nowIso()
    };
    return this.options.store.persistAiSession(session);
  }

  async loadSession(context: CvgContext, sessionId: OpaqueId): Promise<AiSession | null> {
    this.options.store.validateContext(context);
    enforceApplicationPolicy(context, "ai.sessions.read", { resourceId: sessionId });
    const session = this.options.store.aiSessions.get(sessionId);
    if (!session || !scopeOf(context, session)) return null;
    return session;
  }

  private turnDigest(context: CvgContext, session: AiSession, input: AiTurnInput, toolName: string): string {
    return acpDigest({
      toolName,
      sessionId: session.id,
      actorId: context.actorId,
      resourceId: input.resourceId ?? input.encounterId ?? input.patientId ?? null,
      patientId: input.patientId,
      encounterId: input.encounterId,
      purpose: input.purpose,
      policyRevision: context.policyRevision,
      unitId: context.unitId,
      workspaceId: context.workspaceId,
      prompt: input.prompt
    });
  }

  private findTurn(sessionId: OpaqueId, usageKey: string): AiTurn | undefined {
    return [...this.options.store.aiTurns.values()].filter((turn) => turn.sessionId === sessionId && turn.usage?.idempotencyKey === usageKey).at(-1);
  }

  private resultForTurn(session: AiSession, turn: AiTurn): DurableAcpGovernedTurn {
    const draft = [...this.options.store.aiDrafts.values()].find((candidate) => candidate.sourceTurnId === turn.id) ?? null;
    const approval = [...this.options.store.aiApprovals.values()].find((candidate) => candidate.turnId === turn.id) ?? null;
    return { session, turn, draft, approval };
  }

  private assertCurrentTurnAuthority(context: CvgContext, session: AiSession, input: AiTurnInput): void {
    this.options.store.validateContext(context);
    const current = this.options.store.aiSessions.get(session.id);
    if (!current || current.id !== session.id || !scopeOf(context, current) || current.status !== "ACTIVE" || current.purpose !== input.purpose || current.patientId !== input.patientId || current.encounterId !== input.encounterId || (input.sessionId !== null && input.sessionId !== session.id)) {
      throw new Error("ACP context/session/purpose changed before completion.");
    }
    const resourceId = input.resourceId ?? input.encounterId;
    if (resourceId) {
      const encounter = this.options.store.encounters.get(resourceId);
      if (encounter && (encounter.organizationId !== context.organizationId || encounter.unitId !== context.unitId || encounter.workspaceId !== context.workspaceId || encounter.patientId !== (input.patientId ?? encounter.patientId))) {
        throw new Error("ACP resource scope changed before completion.");
      }
    }
  }

  private persistTurn(context: CvgContext, session: AiSession, input: AiTurnInput, outcome: AcpOutcome | { status: AiTurn["status"]; response: string | null; model: string; inputTokens: number; outputTokens: number; correlationId: string; reason?: string }, options: PersistTurnOptions = {}): AiTurn {
    const current = options.existing;
    const turnId = current?.id ?? id(randomUUID());
    const usageId = current?.usage?.id ?? id(randomUUID());
    const references: Array<{ title: string; source: string }> = [];
    const estimated = acpEstimate(input.prompt);
    const observed = observedTokenUnits(outcome.inputTokens, outcome.outputTokens);
    const usageMissing = observed === null;
    const status: AiTurn["status"] = outcome.status;
    const reservationId = options.reservationId !== undefined ? options.reservationId : current?.usage?.reservationId ?? null;
    const reservedUnits = options.reservedUnits ?? current?.usage?.reservedUnits ?? estimated;
    const consumed = options.consumedUnits ?? Math.max(current?.usage?.consumedUnits ?? 0, observed ?? 0);
    const usageStatus = options.usageStatus ?? (status === "OUTCOME_UNKNOWN" ? "RECONCILIATION_REQUIRED" : status === "RECEIVED" ? "RECEIVED" : "SETTLED");
    const idempotencyKey = current?.usage?.idempotencyKey ?? stableTurnUsageKey(session.id, input.idempotencyKey);
    const turn: AiTurn = {
      id: turnId,
      sessionId: session.id,
      prompt: input.prompt,
      response: outcome.response === null && outcome.reason ? outcome.reason : outcome.response,
      status,
      model: outcome.model,
      inputTokens: usageMissing ? 0 : outcome.inputTokens,
      outputTokens: usageMissing ? 0 : outcome.outputTokens,
      references,
      provenance: {
        provider: "deepseek",
        engineCommit: session.engineCommit,
        manifestVersion: session.profileDigest,
        profileDigest: session.profileDigest,
        policyRevision: context.policyRevision,
        references,
        referencesDigest: acpDigest(references),
        correlationId: outcome.correlationId,
        usageRecordId: usageId
      },
      usage: {
        id: usageId,
        reservationId,
        providerRequestId: null,
        idempotencyKey,
        usageKind: "TOKENS",
        reservedUnits,
        consumedUnits: consumed,
        status: usageStatus,
        record: { kind: "AI_TURN_USAGE", turnId, sessionId: session.id, model: outcome.model, provider: "deepseek", engineCommit: session.engineCommit, manifestVersion: session.profileDigest, profileDigest: session.profileDigest, policyRevision: context.policyRevision, correlationId: outcome.correlationId, referencesDigest: acpDigest(references), responseDigest: acpDigest(outcome.response ?? ""), reservationId, reservedUnits, consumedUnits: consumed, settlementStatus: usageStatus },
        settlement: {
          model: outcome.model,
          inputTokens: usageMissing ? 0 : outcome.inputTokens,
          outputTokens: usageMissing ? 0 : outcome.outputTokens,
          providerResponseDigest: acpDigest({ provider: "deepseek", response: outcome.response ?? "" }),
          estimatedCost: { amountMicros: null, currency: null, source: "UNAVAILABLE", pricingRevision: null },
          actualCost: { amountMicros: null, currency: null, source: "UNAVAILABLE", pricingRevision: null },
          discrepancy: { status: "NOT_EVALUATED", deltaMicros: null, reason: usageMissing ? "usage missing or invalid; recorded as OUTCOME_UNKNOWN" : "provider pricing evidence was not supplied" }
        }
      },
      createdAt: current?.createdAt ?? nowIso()
    };
    return this.options.store.persistAiTurn(turn);
  }

  private deny(context: CvgContext, session: AiSession, input: AiTurnInput, reason: string): DurableAcpGovernedTurn {
    const turn = this.persistTurn(context, session, input, { status: "DENIED", response: reason, model: "deepseek-acp", inputTokens: 0, outputTokens: 0, correlationId: context.correlationId, reason });
    return { session, turn, draft: null, approval: null };
  }

  async authorizeTurn(context: CvgContext, session: AiSession, input: AiTurnInput, approvalId: OpaqueId | null): Promise<DurableAcpTurnAuthorization> {
    return this.withSessionLock(session.id, () => this.authorizeTurnOnce(context, session, input, approvalId));
  }

  private async authorizeTurnOnce(context: CvgContext, session: AiSession, input: AiTurnInput, approvalId: OpaqueId | null): Promise<DurableAcpTurnAuthorization> {
    this.options.store.validateContext(context);
    enforceApplicationPolicy(context, `ai.turn.${input.purpose}`, { resourceId: input.resourceId ?? input.encounterId ?? input.patientId });
    const durable = this.options.store.aiSessions.get(session.id);
    if (!durable || !scopeOf(context, durable) || durable.status !== "ACTIVE" || durable.purpose !== input.purpose || durable.patientId !== input.patientId || durable.encounterId !== input.encounterId) {
      return { disposition: "DENY", result: this.deny(context, session, input, "Sessão ACP ausente, fora do escopo ou divergente do profile atestado.") };
    }
    const usageKey = stableTurnUsageKey(durable.id, input.idempotencyKey);
    const existing = this.findTurn(durable.id, usageKey);
    if (existing && existing.prompt !== input.prompt) return { disposition: "DENY", result: this.deny(context, durable, input, "A chave de idempotência já foi usada com argumentos diferentes.") };
    if (existing && isTerminalTurn(existing)) return { disposition: "DENY", result: this.resultForTurn(durable, existing) };
    if (existing?.usage?.reservationId) {
      let consumedUnits = existing.usage.consumedUnits;
      if (this.options.budget) {
        try {
          await this.options.budget.settle(existing.usage.reservationId, null);
          consumedUnits = Math.max(consumedUnits, existing.usage.reservedUnits);
        } catch {
          // Keep the persisted link and reconciliation status for recovery.
        }
      }
      const recovered = this.persistTurn(context, durable, input, { status: "OUTCOME_UNKNOWN", response: null, model: existing.model, inputTokens: existing.inputTokens, outputTokens: existing.outputTokens, correlationId: context.correlationId, reason: "ACP_ADMISSION_ALREADY_EXISTS; reconciliação obrigatória antes de novo dispatch." }, { existing, reservationId: existing.usage.reservationId, reservedUnits: existing.usage.reservedUnits, consumedUnits, usageStatus: "RECONCILIATION_REQUIRED" });
      return { disposition: "DENY", result: this.resultForTurn(durable, recovered) };
    }
    const tool = input.requestedTool ? TOOL_REGISTRY.find((candidate) => candidate.name === input.requestedTool) : undefined;
    if (input.requestedTool && !tool) return { disposition: "DENY", result: this.deny(context, session, input, "Tool não registrada no catálogo canônico CVG.") };
    if (tool) {
      try {
        this.options.store.requireRole(context, tool.allowedRoles, tool.capability);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "FORBIDDEN") {
          return { disposition: "DENY", result: this.deny(context, session, input, "Role sem permissão para a capability solicitada.") };
        }
        throw error;
      }
    }
    if (tool?.requiresApproval) {
      const requestDigest = this.turnDigest(context, session, input, tool.name);
      const approval = approvalId ? this.options.store.aiApprovals.get(approvalId) : undefined;
      if (approvalId && (!approval || approval.organizationId !== context.organizationId || approval.actorId !== context.actorId || approval.sessionId !== session.id || approval.toolName !== tool.name || approval.resourceId !== (input.resourceId ?? input.encounterId ?? input.patientId) || approval.patientId !== input.patientId || approval.encounterId !== input.encounterId || approval.unitId !== context.unitId || approval.workspaceId !== context.workspaceId || approval.purpose !== input.purpose || approval.policyRevision !== context.policyRevision || approval.requestDigest !== requestDigest || Date.parse(approval.expiresAt) <= Date.now() || approval.decidedBy === null || approval.decision === "rejected" || approval.decision === "consumed")) {
        return { disposition: "DENY", result: this.deny(context, session, input, "Approval ausente, incompatível ou já consumida; nenhum dispatch ACP foi realizado.") };
      }
      if (!approval) {
        const turn = existing ?? this.persistTurn(context, durable, input, { status: "RECEIVED", response: null, model: "deepseek-acp", inputTokens: 0, outputTokens: 0, correlationId: context.correlationId }, { reservationId: null, reservedUnits: acpEstimate(input.prompt), consumedUnits: 0, usageStatus: "RECEIVED" });
        const priorApproval = [...this.options.store.aiApprovals.values()].find((candidate) => candidate.turnId === turn.id);
        if (priorApproval) return { disposition: "APPROVAL_REQUIRED", result: { session: durable, turn, draft: null, approval: priorApproval } };
        const pending: AiApproval = { id: id(randomUUID()), organizationId: context.organizationId, actorId: context.actorId, sessionId: session.id, turnId: turn.id, toolName: tool.name, resourceId: input.resourceId ?? input.encounterId ?? input.patientId, patientId: input.patientId, encounterId: input.encounterId, unitId: context.unitId, workspaceId: context.workspaceId, purpose: input.purpose, requestDigest, policyRevision: context.policyRevision, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), decision: "unavailable", decidedBy: null, reason: "Ação exige confirmação contextual e não pode ser presumida.", createdAt: nowIso() };
        return { disposition: "APPROVAL_REQUIRED", result: { session: durable, turn, draft: null, approval: this.options.store.persistAiApproval(pending) } };
      }
      if (approval.decision !== "allowed-once" || approval.decidedBy === null || (tool.risk === "HIGH_IMPACT" && approval.decidedBy === approval.actorId)) return { disposition: "DENY", result: this.deny(context, durable, input, "Approval ausente, incompatível ou já consumida; nenhum dispatch ACP foi realizado.") };
    }
    if (!this.options.budget) return { disposition: "DENY", result: this.deny(context, durable, input, "ACP sem budget/reservation durável; nenhum dispatch foi admitido.") };
    let reservationId: string;
    try {
      reservationId = await this.options.budget.reserve(acpEstimate(input.prompt));
    } catch {
      return { disposition: "DENY", result: this.deny(context, durable, input, "Budget/reservation indisponível; nenhum dispatch ACP foi realizado.") };
    }
    if (!reservationId.trim()) return { disposition: "DENY", result: this.deny(context, durable, input, "Budget retornou uma reserva sem vínculo estável; nenhum dispatch ACP foi realizado.") };
    try {
      this.persistTurn(context, durable, input, { status: "RECEIVED", response: null, model: "deepseek-acp", inputTokens: 0, outputTokens: 0, correlationId: context.correlationId }, { ...(existing ? { existing } : {}), reservationId: id(reservationId), reservedUnits: acpEstimate(input.prompt), consumedUnits: 0, usageStatus: "RECEIVED" });
    } catch (error) {
      try {
        await Promise.resolve(this.options.budget.release(reservationId));
      } catch (releaseError) {
        const primaryMessage = error instanceof Error ? error.message : "erro desconhecido";
        const releaseMessage = releaseError instanceof Error ? releaseError.message : "erro desconhecido";
        throw new Error(`Falha ao persistir turno ACP (${primaryMessage}) e a reserva ${reservationId} exige reconciliação (${releaseMessage}).`);
      }
      throw error;
    }
    return { disposition: "ALLOW" };
  }

  async recordTurn(context: CvgContext, session: AiSession, input: AiTurnInput, outcome: AcpOutcome): Promise<DurableAcpGovernedTurn> {
    return this.withSessionLock(session.id, () => this.recordTurnOnce(context, session, input, outcome));
  }

  private async recordTurnOnce(context: CvgContext, session: AiSession, input: AiTurnInput, outcome: AcpOutcome): Promise<DurableAcpGovernedTurn> {
    const durable = this.options.store.aiSessions.get(session.id) ?? session;
    const usageKey = stableTurnUsageKey(session.id, input.idempotencyKey);
    const existing = this.findTurn(session.id, usageKey);
    if (existing && existing.prompt !== input.prompt) return this.resultForTurn(durable, this.persistTurn(context, durable, input, { status: "DENIED", response: "A chave de idempotência já foi usada com argumentos diferentes.", model: outcome.model, inputTokens: 0, outputTokens: 0, correlationId: context.correlationId }));

    let authorityError = false;
    const correlationError = outcome.correlationId !== context.correlationId;
    if (outcome.status !== "DENIED" || correlationError) {
      try {
        this.assertCurrentTurnAuthority(context, durable, input);
      } catch {
        authorityError = true;
      }
    }
    if (existing && isTerminalTurn(existing)) {
      if (!authorityError || existing.status !== "COMPLETED") return this.resultForTurn(durable, existing);
      const scrubbed = this.persistTurn(context, durable, input, { status: "OUTCOME_UNKNOWN", response: null, model: existing.model, inputTokens: existing.inputTokens, outputTokens: existing.outputTokens, correlationId: context.correlationId, reason: "ACP_AUTHORITY_REVOKED_BEFORE_DISCLOSURE" }, { existing, reservationId: existing.usage?.reservationId ?? null, reservedUnits: existing.usage?.reservedUnits ?? acpEstimate(input.prompt), consumedUnits: existing.usage?.consumedUnits ?? 0, usageStatus: "RECONCILIATION_REQUIRED" });
      return this.resultForTurn(durable, scrubbed);
    }

    const reservationId = existing?.usage?.reservationId ?? null;
    const observed = observedTokenUnits(outcome.inputTokens, outcome.outputTokens);
    let settlementConfirmed = !reservationId && outcome.status === "DENIED";
    let settlementError = false;
    if (reservationId) {
      if (!this.options.budget) {
        settlementError = true;
      } else if (outcome.status === "DENIED") {
        try {
          await this.options.budget.release(reservationId);
          settlementConfirmed = true;
        } catch {
          settlementError = true;
        }
      } else {
        try {
          await this.options.budget.settle(reservationId, observed === null || outcome.status === "OUTCOME_UNKNOWN" ? null : observed);
          settlementConfirmed = true;
        } catch {
          settlementError = true;
        }
      }
    }
    if (outcome.status === "COMPLETED" && !authorityError) {
      try {
        this.assertCurrentTurnAuthority(context, durable, input);
      } catch {
        authorityError = true;
      }
    }

    const canComplete = outcome.status === "COMPLETED" && !authorityError && !correlationError && !settlementError && Boolean(reservationId) && settlementConfirmed && observed !== null;
    const finalStatus: AcpOutcome["status"] = canComplete ? "COMPLETED" : outcome.status === "DENIED" && !authorityError && !correlationError ? "DENIED" : "OUTCOME_UNKNOWN";
    const reason = finalStatus === "COMPLETED" ? outcome.reason : correlationError ? "ACP_CORRELATION_MISMATCH" : authorityError ? "ACP_AUTHORITY_REVOKED_BEFORE_COMPLETION" : !reservationId && outcome.status !== "DENIED" ? "ACP_BUDGET_RESERVATION_MISSING" : settlementError ? "ACP_BUDGET_SETTLEMENT_REQUIRED" : outcome.reason ?? "ACP_OUTCOME_REQUIRES_RECONCILIATION";
    const finalOutcome: AcpOutcome = { status: finalStatus, response: finalStatus === "COMPLETED" || (finalStatus === "OUTCOME_UNKNOWN" && !authorityError && !settlementError && outcome.status === "OUTCOME_UNKNOWN") ? outcome.response : null, model: outcome.model, inputTokens: observed === null ? 0 : outcome.inputTokens, outputTokens: observed === null ? 0 : outcome.outputTokens, correlationId: outcome.correlationId, ...(reason ? { reason } : {}) };
    const reservedUnits = existing?.usage?.reservedUnits ?? acpEstimate(input.prompt);
    const consumedUnits = Math.max(existing?.usage?.consumedUnits ?? 0, observed ?? 0, finalStatus === "OUTCOME_UNKNOWN" && reservationId && (observed === null || outcome.status === "OUTCOME_UNKNOWN") ? reservedUnits : 0);
    const usageStatus: NonNullable<AiTurn["usage"]>["status"] = finalStatus === "OUTCOME_UNKNOWN" || settlementError ? "RECONCILIATION_REQUIRED" : "SETTLED";
    const turn = this.persistTurn(context, durable, input, finalOutcome, { ...(existing ? { existing } : {}), reservationId, reservedUnits, consumedUnits, usageStatus });
    if (finalStatus === "COMPLETED" && input.approvalId) {
      const approval = this.options.store.aiApprovals.get(input.approvalId);
      if (approval && approval.sessionId === session.id) this.options.store.updateAiApproval(input.approvalId, { decision: "consumed" });
    }
    let draft: AiDraft | null = null;
    if (finalStatus === "COMPLETED" && input.purpose === "DRAFT_CLINICAL") {
      draft = this.options.store.persistAiDraft({ id: id(randomUUID()), sessionId: session.id, encounterId: input.encounterId, draftType: "CLINICAL_NOTE", content: outcome.response ?? "", sourceTurnId: turn.id, status: "DRAFT", createdAt: nowIso() });
    }
    return { session: durable, turn, draft, approval: null };
  }

  async approve(context: CvgContext, approvalId: OpaqueId, decision: "allowed-once" | "rejected", reason: string | null): Promise<AiApproval> {
    this.options.store.validateContext(context);
    enforceApplicationPolicy(context, "ai.approval", { resourceId: approvalId });
    this.options.store.requireRole(context, ["admin", "veterinario", "recepcao", "estoque", "financeiro"], "ai:approval");
    const approval = this.options.store.aiApprovals.get(approvalId);
    if (!approval || approval.sessionId === undefined) throw new Error("Aprovação não encontrada.");
    const session = this.options.store.aiSessions.get(approval.sessionId);
    const tool = TOOL_REGISTRY.find((candidate) => candidate.name === approval.toolName);
    if (!tool || !session || session.organizationId !== context.organizationId || session.actorId !== approval.actorId || approval.organizationId !== context.organizationId || approval.unitId !== context.unitId || approval.workspaceId !== context.workspaceId || approval.policyRevision !== context.policyRevision || Date.parse(approval.expiresAt) <= Date.now()) throw new Error("A aprovação expirou ou não corresponde ao contexto atual.");
    this.options.store.requireRole(context, tool.allowedRoles, tool.capability);
    if (tool.risk === "HIGH_IMPACT" && approval.actorId === context.actorId) throw new Error("Ações de alto impacto exigem aprovador independente.");
    if (approval.decision !== "unavailable") throw new Error("Aprovação já foi decidida.");
    return this.options.store.updateAiApproval(approvalId, { decision, decidedBy: context.actorId, reason });
  }

  async promoteDraft(context: CvgContext, draftId: OpaqueId): Promise<AgentDraftPromotion> {
    this.options.store.validateContext(context);
    enforceApplicationPolicy(context, "ai.draft.promote", { resourceId: draftId });
    this.options.store.requireRole(context, ["veterinario"], "clinical:write");
    const draft = this.options.store.aiDrafts.get(draftId);
    if (!draft || draft.encounterId === null) throw new Error("Rascunho clínico não encontrado.");
    const encounter = this.options.store.encounters.get(draft.encounterId);
    if (!encounter || encounter.organizationId !== context.organizationId) throw new Error("Atendimento não encontrado.");
    if (draft.status !== "DRAFT" && draft.status !== "REVIEWED") throw new Error("Rascunho não está disponível para promoção.");
    const document = this.options.store.createClinicalDocument(context, { encounterId: id(encounter.id), documentType: "EVOLUTION", title: "Rascunho do copiloto — revisão humana", content: draft.content, dataClass: "D3" });
    const promoted = this.options.store.updateAiDraftStatus(draftId, "PROMOTED");
    return { draft: promoted, documentId: document.id };
  }

  async replay(context: CvgContext, sessionId: OpaqueId): Promise<{ session: AiSession; turns: AiTurn[]; digest: string }> {
    this.options.store.validateContext(context);
    enforceApplicationPolicy(context, "ai.replay", { resourceId: sessionId });
    const session = this.options.store.aiSessions.get(sessionId);
    if (!session || !scopeOf(context, session)) throw new Error("Sessão ACP não encontrada.");
    const turns = [...this.options.store.aiTurns.values()].filter((turn) => turn.sessionId === sessionId);
    return { session, turns, digest: replayDigest(session, turns) };
  }

  private async withSessionLock<T>(sessionId: OpaqueId, work: () => Promise<T>): Promise<T> {
    const previous = this.sessionLocks.get(sessionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(work);
    this.sessionLocks.set(sessionId, current);
    try {
      return await current;
    } finally {
      if (this.sessionLocks.get(sessionId) === current) this.sessionLocks.delete(sessionId);
    }
  }
}

export function createDurableDeepSeekAcpGovernance(options: DurableAcpGovernanceOptions): DurableDeepSeekAcpGovernance {
  return new DurableDeepSeekAcpGovernance(options);
}
