import { z } from "zod";
import { id } from "@cvg/contracts";
import type { AiApproval, AiDraft, AiSession, AiTurn, AiTurnInput, CvgContext, OpaqueId } from "@cvg/contracts";
import { DSH_MANIFEST_VERSION, GovernedHarness, TOOL_REGISTRY, type HarnessTurnResult } from "@cvg/harness";
import type { AgentDraftPromotion, AgentReplayResult, AgentRuntime, AgentRuntimeCapabilities, AgentRuntimeHealth, AgentTurnResult } from "@cvg/agent-runtime";
import { AgentRuntimeUnavailableError } from "@cvg/agent-runtime";

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
  async executeTurn(context: CvgContext, input: AiTurnInput, approvalId: OpaqueId | null = null): Promise<AgentTurnResult> { return fromMockResult(this.harness.executeTurn(context, input, approvalId), context.correlationId); }
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
const turnWireSchema = z.object({
  id: opaqueIdSchema,
  sessionId: opaqueIdSchema,
  prompt: z.string(),
  response: z.string().nullable(),
  status: z.enum(["RECEIVED", "DENIED", "COMPLETED", "QUARANTINED", "OUTCOME_UNKNOWN"]),
  model: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  references: z.array(z.object({ title: z.string(), source: z.string() }).strict()),
  createdAt: z.string().min(1)
}).strict();
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
const replayWireSchema = z.object({ session: sessionWireSchema, turns: z.array(turnWireSchema), digest: z.string().min(1), provenance: capabilityWireSchema }).strict();
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
      const status = data.status === "READY" && manifestMatches ? "READY" : "UNAVAILABLE";
      const reason = manifestMatches ? data.status === "READY" ? null : `Harness reportou ${data.status}.` : "Commit, manifest ou catálogo de tools do DeepSeek Harness não corresponde ao profile aprovado.";
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
    return parseWire(sessionWireSchema, unwrap(await this.request("POST", "/v1/sessions", { context, input })), "session") as AiSession;
  }

  async executeTurn(context: CvgContext, input: AiTurnInput, approvalId: OpaqueId | null = null): Promise<AgentTurnResult> {
    await this.requireReady();
    return parseWire(turnResultWireSchema, unwrap(await this.request("POST", `/v1/sessions/${input.sessionId ?? "new"}/turns`, { context, input, approvalId })), "turn") as AgentTurnResult;
  }

  async approve(context: CvgContext, approvalId: OpaqueId, decision: "allowed-once" | "rejected", reason: string | null): Promise<AiApproval> {
    await this.requireReady();
    return parseWire(approvalWireSchema, unwrap(await this.request("POST", `/v1/approvals/${approvalId}`, { context, decision, reason })), "approval") as AiApproval;
  }

  async promoteDraft(context: CvgContext, draftId: OpaqueId): Promise<AgentDraftPromotion> {
    await this.requireReady();
    return parseWire(promotionWireSchema, unwrap(await this.request("POST", `/v1/drafts/${draftId}/promote`, { context, draftId })), "draft promotion") as AgentDraftPromotion;
  }

  async replay(context: CvgContext, sessionId: OpaqueId): Promise<AgentReplayResult> {
    await this.requireReady();
    return parseWire(replayWireSchema, unwrap(await this.request("GET", `/v1/sessions/${sessionId}/replay`, { context })), "replay") as AgentReplayResult;
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
      const headers: Record<string, string> = { accept: "application/json" };
      if (body !== undefined) headers["content-type"] = "application/json";
      if (token) headers.authorization = `Bearer ${token}`;
      const response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, "")}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
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
