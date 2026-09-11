import { z } from "zod";
import { randomUUID } from "node:crypto";
import { aiTurnWireSchema, id } from "@cvg/contracts";
import type { AiApproval, AiDraft, AiSession, AiTurn, AiTurnInput, CvgContext, OpaqueId } from "@cvg/contracts";
import { DSH_MANIFEST_VERSION, GovernedHarness, TOOL_REGISTRY, type HarnessTurnResult } from "@cvg/harness";
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
